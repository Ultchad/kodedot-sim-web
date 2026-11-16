// SPDX-License-Identifier: GPL-3.0-or-later
// Wi-Fi bench glue: router objects and the C5's station, behind esp_wifi / esp_netif (wifi_shim.c). Needs the radio glue (radio.js);
// glue files cannot import each other, so both meet on ctx.module.__dbw (the "world").
//
// Router (a plain object with methods; several at once):
//   ssid, password, security ("open" | "wep" | "wpa" | "wpa2" | "wpa/wpa2" | "wpa3" | "wpa2/wpa3"), channel (1..14, 36..177), signal (dBm as the station sees it),
//   hidden, internet (reaches the real internet / what the net glue may fetch), on, inRange, dhcp (false: associates but hands out no address),
//   ip / netmask / gateway / dns (the DHCP lease), bssid, wrongPasswordReason (202 AUTH_FAIL, 15 4-way handshake timeout, 204 handshake timeout)
//   + net glue: hosts (local hosts with canned responses), udp peers, in-page broker (see net.js)
// api: addRouter(cfg) -> router     routers()     removeRouter(r)     station() -> state     setLossThreshold(dbm)
//      router.update(patch) .powerOff() .powerOn() .setSignal(dbm) .setInRange(b) .setInternet(b) .kick(reason) .remove() .snapshot()
// events (ctx.emit -> dev.on("area:wifi:<type>")): scan-done {count}  join-start {ssid,vault}  join-failed {ssid,reason,why}  connected {ssid,channel}
//   got-ip {ssid,ip}  disconnected {ssid,reason,why}  router {id,...}  rssi {dbm}
// The SDK's own behaviour (AO_Radio's scan sweep, saved networks, auto-rejoin, status, signal events) runs on the real firmware.

const REASON = { UNSPECIFIED: 1, AUTH_LEAVE: 3, ASSOC_LEAVE: 8, MIC_FAILURE: 14, HS_TIMEOUT_4WAY: 15, BEACON_TIMEOUT: 200, NO_AP_FOUND: 201, AUTH_FAIL: 202, ASSOC_FAIL: 203, HANDSHAKE_TIMEOUT: 204, CONNECTION_FAIL: 205 };
const AUTH = { open: 0, wep: 1, wpa: 2, wpa2: 3, "wpa/wpa2": 4, wpa3: 6, "wpa2/wpa3": 7 };
const WIFI = { SCAN_DONE: 1, STA_START: 2, STA_STOP: 3, STA_CONNECTED: 4, STA_DISCONNECTED: 5 };
const E_NOT_STARTED = 0x3002, E_STATE = 0x3004, E_NOT_CONNECT = 0x3006, E_SSID = 0x3009;
const CH5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177];

export const ip2u32 = (s) => { const p = String(s).split(".").map(Number); if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) throw new Error("bad IPv4 address " + s); return (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0; };
export const u32ip = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join(".");

function withWorld(M, cb) { if (M.__dbw) cb(M.__dbw); else (M.__dbwq ||= []).push(cb); }

let SEQ = 0;
const ROUTERS = [];   // module scope: bench objects survive a firmware restart within the page

export default function create(ctx) {
  const M = ctx.module;
  const api = { routers: () => ROUTERS.slice() };
  let w = null;

  const st = {
    inited: false, started: false, mode: 0, cfg: { ssid: "", pass: "" },
    attempt: null,            // { token, ssid, vault }
    conn: null,               // { router, ip, rssi, ipUp }
    scan: { busy: false, recs: [], timer: null },
    lossTimer: null, lossThreshold: -92, beaconTimeoutMs: 250, ps: 0, band: 3,
  };
  api.station = () => ({ inited: st.inited, started: st.started, connecting: !!st.attempt, connected: st.conn && st.conn.ipUp ? { ssid: st.conn.router.ssid, ip: st.conn.ip, channel: st.conn.router.channel, rssi: st.conn.router.signal, routerId: st.conn.router.id } : null, associated: !!st.conn, ps: st.ps });
  api.setLossThreshold = (dbm) => { st.lossThreshold = dbm; };
  api.setBeaconTimeoutMs = (ms) => { st.beaconTimeoutMs = ms; };
  api.current = () => (st.conn && st.conn.ipUp ? st.conn.router : null);

  const emit = (type, data) => w?.event(type, data);
  const wifiEv = (id, payload = []) => { if (w.c5.link === "up") w.emit("wifi.event", new w.W().u8(0).u32(id).bytes(payload).done()); };
  const ipEv = (ip, mask, gw) => { if (w.c5.link === "up") w.emit("wifi.event", new w.W().u8(1).u32(0).u32(ip).u32(mask).u32(gw).done()); };
  const disconnectedEv = (reason, rssi = 0) => wifiEv(WIFI.STA_DISCONNECTED, new w.W().u16(reason).u8(rssi & 255).done());

  // ---- routers ----
  function normalise(cfg) {
    const r = Object.assign(Object.create(w.routerProto), {
      id: ++SEQ, ssid: "", password: "", security: null, channel: 6, signal: -45, hidden: false, internet: true, on: true, inRange: true, dhcp: true,
      wrongPasswordReason: REASON.AUTH_FAIL, latencyMs: 8, hosts: new Map(), udpPeers: [], broker: null, brokerOpts: null,
    }, cfg);
    if (r.security === null) r.security = r.password ? "wpa2" : "open";
    if (!(r.security in AUTH)) throw new Error(`security must be one of ${Object.keys(AUTH).join(", ")}`);
    if (r.security !== "open" && r.security !== "wep" && (r.password.length < 8 || r.password.length > 63) && r.password.length !== 64) throw new Error("a WPA passphrase is 8..63 characters (or 64 hex)");
    if (!r.ssid || new TextEncoder().encode(r.ssid).length > 32) throw new Error("an SSID is 1..32 bytes");
    if (!(r.channel >= 1 && r.channel <= 177)) throw new Error("channel 1..14 or 36..177");
    const n = r.id;
    r.bssid = r.bssid || [0x02, 0xde, 0xad, 0xbe, n >> 8 & 255, n & 255];
    r.netmask ||= "255.255.255.0";
    const net = `192.168.${(n % 250) + 1}`;
    r.ip ||= `${net}.${100 + (n % 100)}`;
    r.gateway ||= `${net}.1`;
    r.dns ||= r.gateway;
    ip2u32(r.ip); ip2u32(r.gateway); ip2u32(r.dns); ip2u32(r.netmask);
    return r;
  }
  const P = () => w.routerProto;
  function installProto() {
    Object.assign(P(), {
      update(patch) {
        const before = { on: this.on, inRange: this.inRange, signal: this.signal };
        for (const k of Object.keys(patch)) { if (k === "id") continue; this[k] = patch[k]; }
        if ("security" in patch || "password" in patch) normalise({ ...this, id: this.id }); // validates only
        routerChanged(this, before);
        return this;
      },
      powerOff() { return this.update({ on: false }); },
      powerOn() { return this.update({ on: true }); },
      setSignal(dbm) { return this.update({ signal: dbm }); },
      setInRange(b) { return this.update({ inRange: !!b }); },
      setInternet(b) { return this.update({ internet: !!b }); },
      remove() { api.removeRouter(this); },
      /** Deauthenticate the station now (the AP kicks it). */
      kick(reason = REASON.AUTH_LEAVE) { if (st.conn && st.conn.router === this) lose(reason, "kicked by " + this.ssid); },
      snapshot() { return { id: this.id, ssid: this.ssid, security: this.security, channel: this.channel, signal: this.signal, hidden: this.hidden, internet: this.internet, on: this.on, inRange: this.inRange, dhcp: this.dhcp, ip: this.ip, gateway: this.gateway, dns: this.dns, connected: !!(st.conn && st.conn.router === this && st.conn.ipUp) }; },
    });
  }
  api.addRouter = (cfg) => { const r = normalise(cfg); ROUTERS.push(r); emit("router", { id: r.id, change: "added", ssid: r.ssid }); return r; };
  api.removeRouter = (r) => {
    const i = ROUTERS.indexOf(r); if (i < 0) return;
    const was = st.conn && st.conn.router === r;
    ROUTERS.splice(i, 1);
    r.broker?.close?.();
    if (was) lose(REASON.BEACON_TIMEOUT, "router removed");
    emit("router", { id: r.id, change: "removed", ssid: r.ssid });
  };
  api.clearRouters = () => { for (const r of ROUTERS.slice()) api.removeRouter(r); };
  api.router = (ssid) => ROUTERS.find((r) => r.ssid === ssid);

  const heard = (r) => r.on && r.inRange && r.signal > -127;
  function routerChanged(r, before) {
    emit("router", { id: r.id, change: "updated", ssid: r.ssid });
    if (!(st.conn && st.conn.router === r)) return;
    const bad = !heard(r) || r.signal < st.lossThreshold;
    if (bad && !st.lossTimer) {
      st.lossTimer = w.after(st.beaconTimeoutMs, () => { st.lossTimer = null; if (st.conn && st.conn.router === r && (!heard(r) || r.signal < st.lossThreshold)) lose(REASON.BEACON_TIMEOUT, !r.on ? "router off" : "out of range"); });
    } else if (!bad && st.lossTimer) { w.cancel(st.lossTimer); st.lossTimer = null; }
    if (st.conn && st.conn.ipUp && r.signal !== before?.signal) emit("rssi", { dbm: r.signal });
  }

  // ---- association ----
  function lose(reason, why, quiet) {
    const c = st.conn;
    if (st.lossTimer) { w.cancel(st.lossTimer); st.lossTimer = null; }
    if (!c) return;
    st.conn = null;
    emit("disconnected", { ssid: c.router.ssid, reason, why });
    if (!quiet) disconnectedEv(reason, c.router.signal);
    w.note(`station left '${c.router.ssid}': ${why} (reason ${reason})`);
  }
  const cancelAttempt = () => { if (st.attempt) st.attempt.token.cancelled = true; st.attempt = null; };

  async function join(ssid, pass, { vault = false } = {}) {
    cancelAttempt();
    if (st.conn) lose(REASON.ASSOC_LEAVE, "leaving for a new join", true);
    const token = { cancelled: false };
    st.attempt = { token, ssid, vault };
    emit("join-start", { ssid, vault });
    const T = w.timing;
    const fail = (reason, why) => { if (token.cancelled) return; st.attempt = null; emit("join-failed", { ssid, reason, why }); w.note(`join '${ssid}' failed: ${why} (reason ${reason})`); disconnectedEv(reason); };
    await w.sleep(T.joinMs / 2);
    if (token.cancelled) return;
    const cands = ROUTERS.filter((r) => r.ssid === ssid && heard(r)).sort((a, b) => b.signal - a.signal);
    if (!cands.length) return fail(REASON.NO_AP_FOUND, ROUTERS.some((r) => r.ssid === ssid) ? "network is off or out of range" : "no such network");
    const r = cands[0];
    if (r.signal < st.lossThreshold) return fail(REASON.NO_AP_FOUND, "signal too weak to associate");
    const secured = r.security !== "open";
    const okpass = !secured || pass === r.password;
    await w.sleep(T.joinMs / 2);
    if (token.cancelled) return;
    if (!okpass) return fail(r.wrongPasswordReason, "wrong password");
    st.conn = { router: r, ip: null, ipUp: false };
    emit("connected", { ssid: r.ssid, channel: r.channel });
    wifiEv(WIFI.STA_CONNECTED, [r.channel]);
    if (!r.dhcp) { st.attempt = null; w.note(`'${r.ssid}' associated but its DHCP server does not answer`); return; }
    await w.sleep(T.dhcpMs);
    if (token.cancelled || !st.conn || st.conn.router !== r) return;
    st.attempt = null;
    st.conn.ip = r.ip; st.conn.ipUp = true;
    if (vault) w.vaultTouch(ssid);
    emit("got-ip", { ssid: r.ssid, ip: r.ip });
    ipEv(ip2u32(r.ip), ip2u32(r.netmask), ip2u32(r.gateway));
  }

  // ---- ops ----
  const gate = async () => { if (w.c5.usable()) return true; await w.sleep(w.timing.rpcTimeoutMs); return false; };
  const ops = {
    "wifi.init": async () => { if (!(await gate())) return w.ESP.TIMEOUT; st.inited = true; return 0; },
    "wifi.deinit": async () => { if (!(await gate())) return w.ESP.TIMEOUT; cancelAttempt(); lose(REASON.ASSOC_LEAVE, "deinit", true); st.inited = st.started = false; return 0; },
    "wifi.mode": async (r) => { if (!(await gate())) return w.ESP.TIMEOUT; st.mode = r.u8(); return 0; },
    "wifi.start": async () => { if (!(await gate())) return w.ESP.TIMEOUT; if (!st.inited) return w.ESP.INVALID_STATE; if (!st.started) { st.started = true; w.after(5, () => wifiEv(WIFI.STA_START)); } return 0; },
    "wifi.stop": async () => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      cancelAttempt();
      if (st.conn) { const c = st.conn; lose(REASON.ASSOC_LEAVE, "wifi stop"); void c; }
      if (st.scan.timer) { w.cancel(st.scan.timer); st.scan.timer = null; st.scan.busy = false; }
      if (st.started) { st.started = false; w.hooks2?.sniffStop?.(); w.after(5, () => wifiEv(WIFI.STA_STOP)); }
      return 0;
    },
    "wifi.config": async (r) => { if (!(await gate())) return w.ESP.TIMEOUT; const ssid = r.str(), pass = r.str(); if (!ssid) return E_SSID; st.cfg = { ssid, pass }; return 0; },
    "wifi.connect": async () => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      if (!st.started) return E_NOT_STARTED;
      if (!st.cfg.ssid) return E_SSID;
      join(st.cfg.ssid, st.cfg.pass).catch((e) => w.note("join: " + e.message));
      return 0;
    },
    "wifi.disconnect": async () => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      if (!st.started) return E_NOT_STARTED;
      const had = st.conn || st.attempt;
      cancelAttempt();
      if (st.conn) { const c = st.conn; st.conn = null; if (st.lossTimer) { w.cancel(st.lossTimer); st.lossTimer = null; } emit("disconnected", { ssid: c.router.ssid, reason: REASON.ASSOC_LEAVE, why: "asked" }); w.after(w.timing.leaveMs, () => disconnectedEv(REASON.ASSOC_LEAVE)); }
      else if (had) w.after(w.timing.leaveMs, () => disconnectedEv(REASON.ASSOC_LEAVE));
      return had ? 0 : E_NOT_CONNECT;
    },
    "wifi.scan": async (r) => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      if (!st.started) return E_NOT_STARTED;
      if (st.scan.busy) return E_STATE;
      const channel = r.u8(), showHidden = r.u8(), _type = r.u8(), amin = r.u32(), amax = r.u32(), passive = r.u32(), m24 = r.u16(), m5 = r.u32();
      let chans = [];
      if (channel) chans = [channel];
      else {
        for (let b = 1; b <= 14; b++) if ((m24 >>> b) & 1) chans.push(b);
        for (let i = 1; i <= 28; i++) if ((m5 >>> i) & 1) chans.push(CH5[i - 1]);
      }
      const band = st.band;   // 1 2.4 only, 2 5G only, 3 auto
      chans = chans.filter((c) => (c <= 14 ? band !== 2 : band !== 1));
      st.scan.busy = true; st.scan.recs = [];
      const dwell = channel ? Math.max(passive, amax, 20) : w.timing.scanStepMs;
      st.scan.timer = w.after(Math.min(dwell, w.timing.scanStepMs * 2 + 20), () => {
        st.scan.timer = null; st.scan.busy = false;
        const found = ROUTERS.filter((x) => heard(x) && chans.includes(x.channel) && (showHidden || !x.hidden)).sort((a, b) => b.signal - a.signal);
        st.scan.recs = found.map((x) => ({ ssid: x.hidden ? "" : x.ssid, bssid: x.bssid, primary: x.channel, rssi: x.signal, auth: AUTH[x.security] }));
        emit("scan-done", { count: st.scan.recs.length, channels: chans.length });
        wifiEv(WIFI.SCAN_DONE);
      });
      return 0;
    },
    "wifi.scan_stop": async () => { if (st.scan.timer) { w.cancel(st.scan.timer); st.scan.timer = null; } st.scan.busy = false; return 0; },
    "wifi.scan_num": async () => { if (!(await gate())) return w.ESP.TIMEOUT; return { rc: 0, out: new w.W().u16(st.scan.recs.length).done() }; },
    "wifi.scan_rec": async () => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      const x = st.scan.recs.shift();
      if (!x) return w.ESP.NOT_FOUND;
      return { rc: 0, out: new w.W().str(x.ssid).bytes(x.bssid).u8(x.primary).u8(x.rssi & 255).u8(x.auth).done() };
    },
    "wifi.scan_clear": async () => { st.scan.recs = []; return 0; },
    "wifi.ap_info": async () => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      if (!st.conn) return E_NOT_CONNECT;
      const x = st.conn.router;
      return { rc: 0, out: new w.W().str(x.ssid).bytes(x.bssid).u8(x.channel).u8(x.signal & 255).u8(AUTH[x.security]).done() };
    },
    "wifi.country": async () => { if (!(await gate())) return w.ESP.TIMEOUT; return { rc: 0, out: new w.W().u8(1).u8(13).done() }; },
    "wifi.ps": async (r) => { if (!(await gate())) return w.ESP.TIMEOUT; st.ps = r.u8(); return 0; },
    "wifi.band": async (r) => { if (!(await gate())) return w.ESP.TIMEOUT; st.band = r.u8(); return 0; },
    "netif.ip": async () => {
      if (!(await gate())) return w.ESP.TIMEOUT;
      if (!st.conn || !st.conn.ipUp) return E_NOT_CONNECT;
      const x = st.conn.router;
      return { rc: 0, out: new w.W().u32(ip2u32(x.ip)).u32(ip2u32(x.netmask)).u32(ip2u32(x.gateway)).u32(ip2u32(x.dns)).done() };
    },
  };

  const attach = (world) => {
    w = world;
    installProto();
    for (const [k, f] of Object.entries(ops)) w.op(k, f);
    w.wifi = api;
    Object.assign(w.hooks, {
      vaultJoin: (ssid, pass) => { join(ssid, pass, { vault: true }).catch((e) => w.note("vault join: " + e.message)); },
      c5Reset: () => { cancelAttempt(); if (st.conn) { st.conn = null; } if (st.lossTimer) { w.cancel(st.lossTimer); st.lossTimer = null; } st.inited = st.started = false; st.scan.busy = false; st.scan.recs = []; },
      routers: () => ROUTERS,
      joined: () => !!(st.conn && st.conn.ipUp),
      joinedChannel: () => (st.conn ? st.conn.router.channel : 0),
      wifiStarted: () => st.started,
    });
  };
  withWorld(M, attach);
  return api;
}
