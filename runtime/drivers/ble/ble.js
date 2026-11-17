// SPDX-License-Identifier: GPL-3.0-or-later
// dotbench Bluetooth LE glue: the Sensor and Phone bench objects, and the air between them and the Dot's host fake (ble_host.c).
// Default export: (ctx) => api (the guide's contract). Named exports are pure helpers usable without a device.
//
//   const ble = device.area("ble");
//   const s = ble.addSensor({ name: "Kitchen temp", rssi: -58, temperature: 21.5, battery: 87 });   // advertises 0x181A + 0x180F near the Dot
//   s.update({ rssi: -80 }); s.update({ inRange: false }); s.setValue(23.1); s.remove();
//   const p = ble.addPhone({ name: "Pixel", io: "keyboard", pairing: "auto" });
//   await p.scan()              -> { sees, name, address, rssi, discoverable, hidden, bonded, uuids }   does the phone see the Dot advertising, and as what
//   await p.connect()           -> { ok, conn, reason }                    the Dot must be advertising (a hidden Dot only to a bonded phone)
//   await p.pair({ passkey })   -> { ok, status, authenticated }           passkey omitted: "auto" reads the code off the Dot's screen, "ask" waits for p.enterPasskey(n)
//                                  p.pair({ accept: false }) refuses it; a wrong passkey fails (status 0x401); p.cancelPairing()
//   p.secure / p.bonded / p.connected / p.state()
//   await p.read(ref) / p.write(ref, bytes|string, { noResponse }) / p.subscribe(ref, on)     ref: handle | uuid | "console-rx" | "console-tx" | "mirror" | "battery" | { app: n }
//   await p.console.send("line") ; p.console.lines ; await p.console.waitLine(/re/) ; p.mirror.bytes
//   p.stall(true)               the phone's controller has no buffers: the Dot's notifications get ENOMEM and retry
//   p.disconnect(); p.forget() (the phone's side of the bond); ble.bondPhone(p) (a phone that paired in kodeOS before)
//   ble.state() -> { stack, adv, scan, conn, bonds, passkey, ... }   ble.info()   ble.gatt()   ble.configure({ scanSpeed, smTimeoutMs, passkey })
//   ble.remove(id) / ble.clear() / ble.sensors() / ble.phones() / ble.lastPasskey()
// Events (page side: dev.on("area:ble:<type>", cb)): stack{up}  adv{on,...}  scan{on,passive}  created{id,kind}  removed{id}  connected{id,conn}
//   disconnected{id,reason}  passkey{id,passkey}  pairing{id,ok,status}  bonds{count}  notify{id,kind,handle,data}  console{id,line}  sensor{id,...}
// Objects are saved in the persistent region "ble" (JSON, after the bond store), so they survive a restart and a page reload.

export const OUT = { STACK: 1, ADV: 2, SCAN: 3, TERMINATE: 4, NOTIFY: 5, PASSKEY: 6, CONFIRM_REQ: 7, SEC_REQ: 8, CONN_PARAMS: 9, SM_RESULT: 10, ATT_RSP: 11,
  BONDS: 12, CONN_OK: 13, CONN_FAIL: 14, MTU: 15 };
export const IN = { CONNECT: 1, DISCONNECT: 2, ATT: 3, SM_PAIR: 4, SM_KEY: 5, SM_CANCEL: 6, SM_ENC: 7, DISC: 8, CONFIRM: 9, MTU: 10 };
const CFG = { SCAN_SPEED: 0, STALL: 1, PASSKEY: 2, SM_TIMEOUT_MS: 3, MUTE_CONFIRM: 4 };
const ATT = { READ: 1, WRITE: 2, WRITE_CMD: 3, CCCD: 4 };
export const ATT_ERR = { 2: "read not permitted", 3: "write not permitted", 5: "insufficient authentication", 10: "attribute not found", 13: "invalid attribute value length",
  14: "unlikely error", 15: "insufficient encryption", 17: "insufficient resources" };
const CONN_FAIL = { 0: "the Dot is not advertising", 1: "the Dot is not connectable", 2: "the Dot is already connected", 3: "the Dot's Bluetooth stack is down" };
export const STATE = { OFF: 0, IDLE: 1, ADVERTISING: 2, CONNECTED: 3 };
const LOG_MAX = 200;

// ------------------------------------------------------------------ helpers
export const addrToBytes = (s) => {
  const m = /^([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2})$/i.exec(String(s));
  if (!m) throw new Error("an address is aa:bb:cc:dd:ee:ff");
  return m.slice(1).map((h) => parseInt(h, 16)).reverse();           // NimBLE's order: least significant first
};
export const bytesToAddr = (b) => [...b].reverse().map((x) => x.toString(16).padStart(2, "0")).join(":");
export const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s) => { const out = []; for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16)); return out; };
const toBytes = (v) => (typeof v === "string" ? [...new TextEncoder().encode(v)] : Array.isArray(v) || v instanceof Uint8Array ? [...v] : (() => { throw new Error("bytes or a string"); })());
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); return this; }
  u16(v) { return this.u8(v).u8(v >> 8); }
  u32(v) { return this.u16(v).u16(v >>> 16); }
  bytes(a) { for (const x of a) this.b.push(x & 255); return this; }
  out() { return Uint8Array.from(this.b); }
}
class R {
  constructor(u8) { this.u = u8; this.i = 0; }
  u8() { return this.u[this.i++]; }
  u16() { const lo = this.u8(); return lo | (this.u8() << 8); }
  u32() { const lo = this.u16(); return (lo + this.u16() * 65536) >>> 0; }
  bytes(n) { const o = this.u.slice(this.i, this.i + n); this.i += n; return o; }
  rest() { return this.u.slice(this.i); }
}

/** AD structures -> { flags, name, uuids16, uuids128, mfg, raw } */
export function parseAd(d) {
  const f = { name: null, uuids16: [], uuids128: [], mfg: null, flags: null };
  for (let i = 0; i < d.length;) {
    const l = d[i];
    if (!l || i + 1 + l > d.length) break;
    const t = d[i + 1], p = d.slice(i + 2, i + 1 + l);
    if (t === 0x01) f.flags = p[0];
    else if (t === 0x08 || t === 0x09) f.name = new TextDecoder().decode(Uint8Array.from(p));
    else if (t === 0x02 || t === 0x03) for (let k = 0; k + 1 < p.length; k += 2) f.uuids16.push(p[k] | (p[k + 1] << 8));
    else if (t === 0x06 || t === 0x07) for (let k = 0; k + 15 < p.length; k += 16) {
      const u = [...p.slice(k, k + 16)].reverse().map((x) => x.toString(16).padStart(2, "0")).join("");
      f.uuids128.push(`${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`);
    } else if (t === 0xff) f.mfg = [...p];
    i += 1 + l;
  }
  return f;
}
const adStruct = (type, bytes) => [bytes.length + 1, type, ...bytes];
const uuid16Bytes = (u) => [u & 255, u >> 8];

// ------------------------------------------------------------------ the glue
export default function (ctx) {
  const heap = () => ctx.heap();
  const pBuf = ctx.alloc(2048), pInfo = ctx.alloc(4096), pStat = ctx.alloc(64), pTmp = ctx.alloc(64);
  const objs = new Map();
  let nextId = 1, dirty = false, closed = false, sinceChange = 0;
  const timers = new Set();
  const emit = (type, data) => ctx.emit(type, data);
  const markDirty = () => { dirty = true; };
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!closed) fn(); }, ms); timers.add(t); return t; };

  const dot = { up: false, synced: false, adv: { on: false, connectable: false, discoverable: false, itvlMs: 0, data: [], rsp: [] }, scan: { on: false, passive: false },
    conn: null, connPhone: null, bonds: 0, passkey: null, lastPasskey: null, mtu: 23, params: null, advAt: 0 };
  const cfg = { scanSpeed: 1, smTimeoutMs: 30000, passkey: -1 };

  // ---------------- the queue to the host
  function send(w) {
    const u = w.out();
    heap().set(u, pBuf);
    const rc = ctx.call("ble_in", pBuf, u.length);
    later(drain, 2);
    return rc;
  }
  const att = (() => {
    let id = 1; const waiting = new Map();
    return {
      request(conn, op, handle, data = [], offset = 0, timeoutMs = 5000) {
        const myId = id++;
        const p = new Promise((res) => {
          waiting.set(myId, res);
          later(() => { if (waiting.delete(myId)) res({ status: -1, error: "timeout", data: [] }); }, timeoutMs);
        });
        send(new W().u8(IN.ATT).u32(myId).u16(conn).u8(op).u16(handle).u16(offset).u16(data.length).bytes(data));
        if (op === ATT.WRITE_CMD) { waiting.delete(myId); return Promise.resolve({ status: 0, data: [] }); }
        return p;
      },
      answer(myId, status, data) { const r = waiting.get(myId); if (r) { waiting.delete(myId); r({ status, error: ATT_ERR[status], data }); } },
    };
  })();

  // ---------------- Sensors
  class Sensor {
    constructor(o, id) {
      this.id = id; this.kind = "sensor";
      this.name = String(o.name ?? "Sensor");
      this.rssi = clamp(Math.round(o.rssi ?? -60), -127, 20);
      this.inRange = o.inRange ?? true;
      this.address = o.address ?? `c0:de:00:00:${(Math.floor((nextId - 1) / 256) & 255).toString(16).padStart(2, "0")}:${((nextId - 1) & 255).toString(16).padStart(2, "0")}`;
      addrToBytes(this.address);
      this.addrType = o.addrType ?? 1;
      this.services = o.services ?? [0x181a, 0x180f];
      this.mfg = o.mfg ? (typeof o.mfg === "string" ? fromHex(o.mfg) : [...o.mfg]) : null;
      this.nameIn = o.nameIn === "rsp" ? "rsp" : "adv";
      this.interval = clamp(o.interval ?? 500, 20, 10240);
      this.temperature = o.temperature ?? 21.5;
      this.battery = clamp(o.battery ?? 100, 0, 100);
      this._next = 0;
      this.packets();
    }
    def() { return { kind: "sensor", id: this.id, name: this.name, rssi: this.rssi, inRange: this.inRange, address: this.address, addrType: this.addrType,
      services: this.services, mfg: this.mfg ? hex(this.mfg) : null, nameIn: this.nameIn, interval: this.interval, temperature: this.temperature, battery: this.battery }; }
    snapshot() { return this.def(); }
    state() { return this.def(); }
    /** The two packets this sensor sends: the advertisement and, when the name rides there, the scan response. */
    packets() {
      const nameAd = adStruct(0x09, [...new TextEncoder().encode(this.name)]);
      const adv = [...adStruct(0x01, [0x06])];
      if (this.nameIn === "adv") adv.push(...nameAd);
      if (this.services.length) adv.push(...adStruct(0x03, this.services.flatMap(uuid16Bytes)));
      if (this.mfg) adv.push(...adStruct(0xff, this.mfg));
      const rsp = this.nameIn === "rsp" ? nameAd : [];
      if (adv.length > 31) throw new Error(`the advertisement is ${adv.length} bytes; 31 is the limit (shorten the name, or put it in the scan response)`);
      if (rsp.length > 31) throw new Error("the name does not fit the scan response");
      return { adv, rsp };
    }
    update(p) {
      const old = this.def();
      try {
        for (const k of ["name", "address", "addrType", "services", "nameIn", "interval"]) if (k in p) this[k] = p[k];
        if ("rssi" in p) this.rssi = clamp(Math.round(p.rssi), -127, 20);
        if ("inRange" in p) this.inRange = !!p.inRange;
        if ("mfg" in p) this.mfg = p.mfg ? (typeof p.mfg === "string" ? fromHex(p.mfg) : [...p.mfg]) : null;
        if ("temperature" in p) this.temperature = +p.temperature;
        if ("battery" in p) this.battery = clamp(+p.battery, 0, 100);
        addrToBytes(this.address);
        this.packets();
      } catch (e) { Object.assign(this, { ...old, mfg: old.mfg ? fromHex(old.mfg) : null }); throw e; }
      markDirty(); emit("sensor", this.state());
      return this;
    }
    /** Set the temperature (degrees C) the sensor's characteristic holds. */
    setValue(c) { return this.update({ temperature: c }); }
    setBattery(pct) { return this.update({ battery: pct }); }
    /** What a central that connected would read: the GATT of the sensor (0x181A temperature, 0x180F battery). */
    read(uuid) {
      const u = typeof uuid === "number" ? uuid : parseInt(String(uuid), 16);
      if (u === 0x2a6e) { const v = Math.round(this.temperature * 100); return [v & 255, (v >> 8) & 255]; }
      if (u === 0x2a19) return [this.battery];
      return null;
    }
    gatt() { return [{ uuid: "181a", chars: [{ uuid: "2a6e", props: ["read", "notify"], value: this.read(0x2a6e) }] },
      { uuid: "180f", chars: [{ uuid: "2a19", props: ["read", "notify"], value: this.read(0x2a19) }] }]; }
    remove() { return removeObj(this.id); }
  }

  // ---------------- Phones
  class Phone {
    constructor(o, id) {
      this.id = id; this.kind = "phone";
      this.name = String(o.name ?? "Phone");
      this.address = o.address ?? `5a:11:00:00:${(Math.floor((nextId - 1) / 256) & 255).toString(16).padStart(2, "0")}:${((nextId - 1) & 255).toString(16).padStart(2, "0")}`;
      addrToBytes(this.address);
      this.rssi = clamp(Math.round(o.rssi ?? -50), -127, 20);
      this.inRange = o.inRange ?? true;
      this.io = o.io === "none" ? "none" : "keyboard";
      this.pairing = ["auto", "ask", "never"].includes(o.pairing) ? o.pairing : "auto";
      this.mtu = o.mtu ?? 247;
      this.mute = !!o.mute;
      this.bond = o.bond ?? null;          // { ltk: hex, auth: bool, dot: "aa:..." }
      this._reset();
      this.log = [];
    }
    _reset() {
      this.conn = null; this.encrypted = false; this.authenticated = false; this.pairingBusy = null; this.passkeyWaiter = null; this.gattCache = null;
      this.subs = new Set(); this.notifications = []; this._connWait = null; this.pairResolve = null; this.stalled = this.stalled ?? false;
      this.console = this._console(); this.mirror = { bytes: [], chunks: 0, subscribe: (on = true) => this.subscribe("mirror", on), clear: () => { this.mirror.bytes = []; this.mirror.chunks = 0; } };
      this.negotiatedMtu = 23;
    }
    def() { return { kind: "phone", id: this.id, name: this.name, address: this.address, rssi: this.rssi, inRange: this.inRange, io: this.io, pairing: this.pairing, mtu: this.mtu,
      mute: this.mute, bond: this.bond }; }
    get connected() { return this.conn !== null; }
    get secure() { return this.conn !== null && this.encrypted; }
    get bonded() { return !!this.bond; }
    state() { return { ...this.def(), connected: this.connected, secure: this.secure, authenticated: this.authenticated, conn: this.conn, mtu: this.negotiatedMtu, bonded: this.bonded,
      pairing_: this.pairingBusy ? "in progress" : "idle", stalled: !!this.stalled, subscriptions: [...this.subs] }; }
    snapshot() { return this.state(); }
    update(p) {
      for (const k of ["name", "io", "pairing", "mtu", "mute"]) if (k in p) this[k] = p[k];
      if ("address" in p) { addrToBytes(p.address); this.address = p.address; }
      if ("rssi" in p) this.rssi = clamp(Math.round(p.rssi), -127, 20);
      if ("bond" in p) this.bond = p.bond;
      if ("inRange" in p) {
        this.inRange = !!p.inRange;
        if (!this.inRange && this.connected) this._linkLost();
      }
      markDirty(); emit("phone", this.state());
      return this;
    }
    _linkLost() { send(new W().u8(IN.DISCONNECT).u16(this.conn).u8(0x08)); this._gone(0x08); }
    _gone(reason) {
      const had = this.conn !== null;
      const res = this.pairResolve;
      this._reset();
      if (res) res({ ok: false, status: "disconnected", reason });
      if (this._connWait) { this._connWait({ ok: false, reason: "disconnected" }); this._connWait = null; }
      if (dot.connPhone === this) { dot.connPhone = null; dot.conn = null; }
      if (had) emit("disconnected", { id: this.id, reason });
    }
    stall(on = true) { this.stalled = !!on; if (dot.connPhone === this || !on) ctx.call("ble_cfg", CFG.STALL, on ? 1 : 0); return this; }

    /** Does this phone see the Dot advertising, and as what. Samples the air for up to ms (a pulsed advert is not always on). */
    async scan(ms = 1500) {
      const t0 = Date.now();
      for (;;) {
        const r = this._look();
        if (r.sees || Date.now() - t0 >= ms) return r;
        await sleep(10);
      }
    }
    _look() {
      const a = dot.adv;
      const base = { sees: false, name: null, address: null, rssi: null, discoverable: false, hidden: false, bonded: this.bonded, uuids: [], connectable: false };
      if (!this.inRange || !dot.up || !dot.synced || !a.on) return base;
      const known = this.bonded;
      if (!a.discoverable && !known) return { ...base, hidden: true };
      const ad = parseAd(a.data), rs = parseAd(a.rsp);
      return { sees: true, name: rs.name ?? ad.name, address: dot.addr ?? null, rssi: this.rssi, discoverable: a.discoverable, hidden: !a.discoverable, bonded: known,
        uuids: [...ad.uuids128, ...rs.uuids128], connectable: a.connectable };
    }
    async connect() {
      if (this.connected) return { ok: true, conn: this.conn, reason: "already connected" };
      if (!this.inRange) return { ok: false, reason: "the phone is out of range" };
      const look = this._look();
      if (!look.sees) return { ok: false, reason: look.hidden ? "the Dot is hidden to a phone that has no bond with it" : "the phone does not see the Dot advertising" };
      const p = new Promise((res) => { this._connWait = res; later(() => { if (this._connWait === res) { this._connWait = null; res({ ok: false, reason: "timeout" }); } }, 5000); });
      send(new W().u8(IN.CONNECT).u8(1).bytes(addrToBytes(this.address)).u16(this.mtu));
      dot.connPhone = this;
      const r = await p;
      if (!r.ok && dot.connPhone === this) dot.connPhone = null;
      return r;
    }
    async disconnect() {
      if (!this.connected) return false;
      send(new W().u8(IN.DISCONNECT).u16(this.conn).u8(0x13));
      this._gone(0x13);
      return true;
    }
    forget() { this.bond = null; markDirty(); emit("phone", this.state()); return this; }

    // ---- security
    _encrypt() {
      if (!this.bond || !this.connected) return;
      send(new W().u8(IN.SM_ENC).u16(this.conn).bytes(fromHex(this.bond.ltk)));
    }
    /** Pair with the Dot. { passkey } types that code; omitted: "auto" reads the Dot's screen, "ask" waits for enterPasskey(). { accept:false } refuses. */
    pair(opts = {}) {
      if (!this.connected) return Promise.resolve({ ok: false, status: "not connected" });
      if (this.pairResolve) return this.pairPromise;
      this.pairOpts = opts;
      this.pairPromise = new Promise((res) => { this.pairResolve = res; });
      send(new W().u8(IN.SM_PAIR).u16(this.conn).u8(this.io === "keyboard" ? 1 : 0).u8(1));
      return this.pairPromise;
    }
    enterPasskey(n) { if (!this.connected) return false; send(new W().u8(IN.SM_KEY).u16(this.conn).u32(n)); return true; }
    cancelPairing() { if (!this.connected) return false; send(new W().u8(IN.SM_CANCEL).u16(this.conn)); return true; }
    _onPasskey(pk) {
      dot.passkey = pk; dot.lastPasskey = pk;
      emit("passkey", { id: this.id, passkey: pk });
      const o = this.pairOpts ?? {};
      if (o.accept === false) { later(() => this.cancelPairing(), 5); return; }
      if (o.passkey !== undefined) { later(() => this.enterPasskey(o.passkey), 5); return; }
      if (this.pairing === "auto") later(() => this.enterPasskey(pk), 5);
      // "ask": the page asks the user; enterPasskey() answers
    }
    _onSmResult(ok, status, auth, bonded, ltk) {
      dot.passkey = null;
      if (ok) {
        this.encrypted = true; this.authenticated = !!auth;
        if (bonded && hex(ltk) !== "0".repeat(32)) { this.bond = { ltk: hex(ltk), auth: !!auth, dot: dot.addr }; markDirty(); }
      } else { this.encrypted = false; }
      const res = this.pairResolve;
      this.pairResolve = null; this.pairOpts = null;
      emit("pairing", { id: this.id, ok, status, authenticated: !!auth });
      if (res) res({ ok, status, authenticated: !!auth });
      emit("phone", this.state());
    }
    _onSecReq() {
      if (this.bond) { this._encrypt(); return; }
      if (this.pairing === "auto") later(() => { if (this.connected && !this.encrypted && !this.pairResolve) this.pair(); }, 5);
    }
    /** Wait until the link is encrypted (a bonded phone does it by itself on connect). */
    async whenSecure(ms = 3000) {
      const t0 = Date.now();
      while (!this.secure) { if (!this.connected || Date.now() - t0 > ms) return false; await sleep(10); }
      return true;
    }

    // ---- GATT
    discover() {
      if (!this.connected) return null;
      ctx.call("ble_gatt_json", pInfo, 4096);
      const n = ctx.call("ble_gatt_json", pInfo, 4096);
      if (!n) return null;
      this.gattCache = JSON.parse(new TextDecoder().decode(heap().slice(pInfo, pInfo + n)));
      return this.gattCache;
    }
    _find(ref) {
      const g = this.gattCache ?? this.discover();
      if (!g) return null;
      const chars = g.flatMap((s) => s.chars.map((c) => ({ ...c, service: s.uuid })));
      if (typeof ref === "number") return chars.find((c) => c.handle === ref || c.cccd === ref) ?? null;
      if (typeof ref === "object" && ref && "app" in ref) return chars.find((c) => c.kind === "app" && c.index === ref.app) ?? null;
      const s = String(ref).toLowerCase();
      return chars.find((c) => c.kind === s) ?? chars.find((c) => c.uuid.toLowerCase() === s) ?? null;
    }
    async _att(op, handle, data, retry = true) {
      let r = await att.request(this.conn, op, handle, data);
      if (retry && (r.status === 5 || r.status === 15) && !this.encrypted && this.connected) {
        if (this.bond) { this._encrypt(); await this.whenSecure(2000); }
        else if (this.pairing === "auto") await this.pair();
        if (this.secure) r = await att.request(this.conn, op, handle, data);
      }
      return r;
    }
    async read(ref) {
      if (!this.connected) return { status: -1, error: "not connected", data: [] };
      const c = this._find(ref); if (!c) return { status: 10, error: ATT_ERR[10], data: [] };
      return this._att(ATT.READ, c.handle, []);
    }
    async write(ref, value, { noResponse = false } = {}) {
      if (!this.connected) return { status: -1, error: "not connected", data: [] };
      const c = this._find(ref); if (!c) return { status: 10, error: ATT_ERR[10], data: [] };
      return this._att(noResponse ? ATT.WRITE_CMD : ATT.WRITE, c.handle, toBytes(value));
    }
    async subscribe(ref, on = true) {
      if (!this.connected) return { status: -1, error: "not connected", data: [] };
      const c = this._find(ref); if (!c || !c.cccd) return { status: 10, error: ATT_ERR[10], data: [] };
      const r = await this._att(ATT.CCCD, c.cccd, [on ? 1 : 0, 0]);
      if (r.status === 0) { if (on) this.subs.add(c.handle); else this.subs.delete(c.handle); }
      return r;
    }
    _onNotify(handle, data) {
      if (!this.subs.has(handle)) return;
      const c = this._find(handle);
      const kind = c?.kind ?? "unknown";
      if (kind === "console-tx") this.console._rx(data);
      else if (kind === "mirror") { this.mirror.bytes.push(...data); this.mirror.chunks++; }
      this.notifications.push({ kind, handle, data: [...data], at: Date.now() });
      if (this.notifications.length > LOG_MAX) this.notifications.shift();
      emit("notify", { id: this.id, kind, handle, data: [...data] });
    }
    _console() {
      const me = this;
      const c = {
        lines: [], partial: "",
        _rx(data) {
          c.partial += new TextDecoder().decode(Uint8Array.from(data));
          let i;
          while ((i = c.partial.search(/[\r\n]/)) >= 0) {
            const line = c.partial.slice(0, i); c.partial = c.partial.slice(i + 1);
            if (line) { c.lines.push(line); emit("console", { id: me.id, line }); }
          }
        },
        subscribe: (on = true) => me.subscribe("console-tx", on),
        /** One console line: chunks of MTU-3, each a write with response. Resolves with the worst status (0 = every chunk taken). */
        async send(line) {
          const bytes = toBytes(line + "\n"), chunk = Math.max(20, me.negotiatedMtu - 3);
          let worst = 0;
          for (let i = 0; i < bytes.length; i += chunk) { const r = await me.write("console-rx", bytes.slice(i, i + chunk)); if (r.status !== 0) { worst = r.status; break; } }
          return { status: worst, error: ATT_ERR[worst] };
        },
        async waitLine(re, ms = 5000, from = 0) {
          const t0 = Date.now();
          for (;;) {
            const hit = c.lines.slice(from).find((l) => (re instanceof RegExp ? re.test(l) : l.includes(re)));
            if (hit !== undefined) return hit;
            if (Date.now() - t0 > ms) throw new Error(`no console line matching ${re} in ${ms} ms; have ${JSON.stringify(c.lines.slice(-8))}`);
            await sleep(10);
          }
        },
        clear() { c.lines = []; c.partial = ""; },
      };
      return c;
    }
    remove() { return removeObj(this.id); }
  }

  // ---------------- objects
  function add(o) { objs.set(o.id, o); markDirty(); emit("created", { id: o.id, kind: o.kind }); return o; }
  function removeObj(id) {
    const o = objs.get(id); if (!o) return false;
    if (o.kind === "phone" && o.connected) o.disconnect();
    objs.delete(id); markDirty(); emit("removed", { id });
    return true;
  }
  const newId = (kind) => `${kind}${nextId++}`;
  function save() {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, nextId, objects: [...objs.values()].map((o) => o.def()) }));
    if (bytes.length > 12000) { emit("persist-failed", { bytes: bytes.length }); return; }
    const p = ctx.call("ble_blob_ptr");
    heap().set(bytes, p);
    ctx.call("ble_blob_commit", bytes.length);
  }
  function load() {
    const len = ctx.call("ble_blob_len");
    if (!len) return;
    try {
      const p = ctx.call("ble_blob_ptr");
      const j = JSON.parse(new TextDecoder().decode(heap().slice(p, p + len)));
      if (j.v !== 1) return;
      nextId = j.nextId ?? 1;
      for (const d of j.objects) { const o = d.kind === "sensor" ? new Sensor(d, d.id) : new Phone(d, d.id); objs.set(o.id, o); }
    } catch (e) { emit("persist-failed", { error: String(e) }); }
  }

  // ---------------- the air: what the Dot sent
  function sendDisc(s, rsp) {
    const pk = s.packets();
    const w = new W().u8(IN.DISC).u8(rsp ? 4 : 0).u8(s.addrType).bytes(addrToBytes(s.address)).u8(s.rssi & 255);
    const d = rsp ? pk.rsp : pk.adv;
    if (rsp && !d.length) return;
    send(w.u8(d.length).bytes(d));
  }
  let scanTimer = null;
  function scanStep() {
    if (!dot.scan.on) return;
    const now = Date.now(), speed = Math.max(1, cfg.scanSpeed);
    for (const o of objs.values()) {
      if (o.kind !== "sensor" || !o.inRange || now < o._next) continue;
      o._next = now + Math.max(10, o.interval / speed);
      sendDisc(o, false);
      if (!dot.scan.passive) sendDisc(o, true);
    }
  }
  function scanSet(on, passive) {
    dot.scan = { on, passive };
    clearInterval(scanTimer); scanTimer = null;
    if (on) {
      for (const o of objs.values()) if (o.kind === "sensor") o._next = 0;
      scanStep();
      scanTimer = setInterval(scanStep, 10);
    }
    emit("scan", { on, passive });
  }

  function handle(type, r) {
    switch (type) {
      case OUT.STACK: { dot.up = !!r.u8(); dot.synced = !!r.u8(); if (!dot.up || !dot.synced) { dot.adv.on = false; scanSet(false, false); } emit("stack", { up: dot.up, synced: dot.synced }); break; }
      case OUT.ADV: {
        const on = !!r.u8(), connectable = !!r.u8(), discoverable = !!r.u8(), itvlMs = r.u16();
        const data = [...r.bytes(r.u8())], rsp = [...r.bytes(r.u8())];
        const was = dot.adv.on;
        dot.adv = { on, connectable, discoverable, itvlMs, data, rsp };
        if (!on && dot.connPhone === null) { /* the controller stopped advertising */ }
        if (on !== was) emit("adv", { on, connectable, discoverable, itvlMs, ...(on ? parseDotAdv() : {}) });
        break;
      }
      case OUT.SCAN: { const on = !!r.u8(), passive = !!r.u8(); r.u32(); scanSet(on, passive); break; }
      case OUT.TERMINATE: { const conn = r.u16(), why = r.u8(); const ph = dot.connPhone; if (ph && ph.conn === conn) ph._gone(why); break; }
      case OUT.NOTIFY: {
        const conn = r.u16(), h = r.u16(), n = r.u16(); const data = r.bytes(n);
        const ph = dot.connPhone;
        if (ph && ph.conn === conn && !ph.stalled) ph._onNotify(h, data);
        break;
      }
      case OUT.PASSKEY: { r.u16(); const pk = r.u32(); dot.connPhone?._onPasskey(pk); break; }
      case OUT.CONFIRM_REQ: { r.u16(); const ph = dot.connPhone; if (ph && !ph.mute) later(() => send(new W().u8(IN.CONFIRM).u8(1)), 10); break; }
      case OUT.SEC_REQ: { r.u16(); dot.connPhone?._onSecReq(); break; }
      case OUT.CONN_PARAMS: { r.u16(); dot.params = { itvlMin: r.u16(), itvlMax: r.u16(), latency: r.u16(), timeout: r.u16() }; break; }
      case OUT.SM_RESULT: { r.u16(); const ok = !!r.u8(), status = r.u16(), auth = r.u8(), bonded = r.u8(); const ltk = r.bytes(16); dot.connPhone?._onSmResult(ok, status, auth, bonded, ltk); break; }
      case OUT.ATT_RSP: { const id = r.u32(), st = r.u8(), n = r.u16(); att.answer(id, st, [...r.bytes(n)]); break; }
      case OUT.BONDS: { dot.bonds = r.u8(); emit("bonds", { count: dot.bonds }); break; }
      case OUT.CONN_OK: {
        const conn = r.u16(), mtu = r.u16(); const ph = dot.connPhone;
        if (ph) { ph.conn = conn; ph.negotiatedMtu = mtu; dot.conn = conn; const w = ph._connWait; ph._connWait = null; emit("connected", { id: ph.id, conn }); w?.({ ok: true, conn }); }
        break;
      }
      case OUT.CONN_FAIL: { const why = r.u8(); const ph = dot.connPhone; if (ph) { const w = ph._connWait; ph._connWait = null; dot.connPhone = null; w?.({ ok: false, reason: CONN_FAIL[why] ?? "refused" }); } break; }
      case OUT.MTU: { const conn = r.u16(), m = r.u16(); const ph = dot.connPhone; if (ph && ph.conn === conn) ph.negotiatedMtu = m; break; }
      default: break;
    }
  }
  const parseDotAdv = () => { const a = parseAd(dot.adv.data), b = parseAd(dot.adv.rsp); return { name: b.name ?? a.name, uuids: [...a.uuids128, ...b.uuids128] }; };

  function drain() {
    if (closed) return;
    for (let i = 0; i < 256; i++) {
      const n = ctx.call("ble_out_pop", pBuf, 2048);
      if (n <= 0) return;
      const u = heap().slice(pBuf, pBuf + n);
      try { handle(u[0], new R(u.slice(3))); } catch (e) { emit("error", { error: String(e) }); }
    }
  }
  function syncAddr() {
    ctx.call("ble_info", pInfo, 4096);
  }
  const readInfo = () => {
    const n = ctx.call("ble_info", pInfo, 4096);
    if (!n) return null;
    const j = JSON.parse(new TextDecoder().decode(heap().slice(pInfo, pInfo + n)));
    dot.addr = j.addr;
    return j;
  };

  ctx.onTick(() => {
    if (closed) return;
    drain();
    if (dirty && ++sinceChange >= 2) { dirty = false; sinceChange = 0; save(); }
  });
  load();
  ctx.call("ble_cfg", CFG.PASSKEY, -1);
  ctx.call("ble_cfg", CFG.SM_TIMEOUT_MS, cfg.smTimeoutMs);
  ctx.call("ble_cfg", CFG.SCAN_SPEED, 1);
  readInfo();

  const mk = (cls, kind) => (o = {}) => add(new cls(o, newId(kind)));
  const api = {
    addSensor: mk(Sensor, "sensor"),
    addPhone: mk(Phone, "phone"),
    get: (id) => objs.get(id) ?? null,
    sensors: () => [...objs.values()].filter((o) => o.kind === "sensor"),
    phones: () => [...objs.values()].filter((o) => o.kind === "phone"),
    objects: () => [...objs.values()].map((o) => o.snapshot()),
    remove: removeObj,
    removeSensor: removeObj,
    removePhone: removeObj,
    clear() { for (const id of [...objs.keys()]) removeObj(id); },
    /** Drain what the Dot sent now (the glue also does it every tick) and write the objects out. */
    poll() { drain(); if (dirty) { dirty = false; save(); } },
    /** The Dot's side: the host's own report plus what is on the air. */
    info: readInfo,
    state() {
      drain();
      const i = readInfo() ?? {};
      return { stack: { up: dot.up, synced: dot.synced }, state: i.state, name: i.name, address: i.addr, adv: { ...dot.adv, data: undefined, rsp: undefined, ...(dot.adv.on ? parseDotAdv() : {}) },
        scan: { ...dot.scan }, conn: dot.conn, connected: dot.conn !== null, secure: !!i.secure, bonds: i.bonds, bondList: i.bondList, passkey: dot.passkey, lastPasskey: dot.lastPasskey,
        console: !!i.console, mirror: !!i.mirror, mtu: i.mtu, links: i.links, txDrop: i.txDrop, txRetry: i.txRetry, hidden: !!i.hidden, hearing: !!i.hearing, params: dot.params };
    },
    gatt() { const n = ctx.call("ble_gatt_json", pInfo, 4096); return n ? JSON.parse(new TextDecoder().decode(heap().slice(pInfo, pInfo + n))) : []; },
    lastPasskey: () => dot.lastPasskey,
    /** scanSpeed: scans run this many times faster than asked (tests); smTimeoutMs: the security manager's timeout; passkey: force the code shown (>= 0). */
    configure(c = {}) {
      if ("scanSpeed" in c) { cfg.scanSpeed = clamp(+c.scanSpeed, 1, 1000); ctx.call("ble_cfg", CFG.SCAN_SPEED, cfg.scanSpeed); }
      if ("smTimeoutMs" in c) { cfg.smTimeoutMs = clamp(+c.smTimeoutMs, 100, 120000); ctx.call("ble_cfg", CFG.SM_TIMEOUT_MS, cfg.smTimeoutMs); }
      if ("passkey" in c) { cfg.passkey = c.passkey === null ? -1 : clamp(+c.passkey, 0, 999999); ctx.call("ble_cfg", CFG.PASSKEY, cfg.passkey); }
      return { ...cfg };
    },
    /** A phone that paired with the Dot in kodeOS before: plants the bond on both sides (the Dot's store and the phone's). */
    bondPhone(phone, { auth = true } = {}) {
      const ltk = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
      readInfo();
      heap().set(addrToBytes(phone.address), pTmp);
      heap().set(ltk, pTmp + 8);
      const n = ctx.call("ble_bond_inject", pTmp, 1, pTmp + 8, auth ? 1 : 0);
      if (n < 0) return false;
      phone.bond = { ltk: hex(ltk), auth, dot: dot.addr };
      markDirty();
      return true;
    },
    dispose() { closed = true; timers.forEach(clearTimeout); timers.clear(); clearInterval(scanTimer); },
  };
  return api;
}
