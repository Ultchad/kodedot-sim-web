// SPDX-License-Identifier: GPL-3.0-or-later
// Radio core glue: the faked ESP32-C5 behind esp-hosted, and the bridge every radio-side area (wifi.js, net.js, later BLE and IR) uses.
// Default export: (ctx) => api (the guide's contract). Named exports are pure helpers (W, R, der, ESP) usable without a device.
//
// Bridge (see include/dotbench_radio.h): firmware threads fill call slots in shared memory; this glue picks them up with
// Atomics.waitAsync on the doorbell (and every onTick as a safety net), runs the op handler (sync or async), and completes the
// slot with Atomics.store/notify. Events to the firmware go through a single-producer byte ring consumed by the radio platform
// thread. Nothing here blocks the page. Without this glue attached the firmware's dbh_call fails at once (radio absent).
//
// The world (ctx.module.__dbw) is what wifi.js and net.js attach to:
//   w.op(name, fn)            fn(r: R, info) -> rc | { rc, out: Uint8Array } | Promise of those   (rc >= 0 ran; negative is the caller's DBH_ERR)
//   w.emit(name, bytes)       an event for the firmware (handler registered with dbh_on_event)
//   w.service(id, fn)         a KODE service of the C5: fn(op, payload: Uint8Array, hdr) -> { status, payload? } | Promise
//   w.peer(msgId, fn)         raw peer data (esp-hosted custom data) the P4 sends to the C5 under msgId: fn(bytes) ; reply with w.peerSend(msgId, bytes)
//   w.c5                      the co-processor: .usable() (link up, answering), .fault, .power, ...
//   w.timing                  { bootMs, rpcTimeoutMs, serviceMs, scanStepMs, joinMs, dhcpMs, leaveMs }  (fast defaults; w.realTiming() for chip-like ones)
//   w.sleep(ms) / w.after(ms, fn)   timers that are cancelled by dispose()
//   w.note(msg)               a bench message: console + ctx.emit("note")
// The glue that follows (BLE's HCI, IR) registers w.op("ble.*") / w.service / w.peer the same way: see docs/STATUS-radio.md.

export const ESP = { OK: 0, FAIL: -1, NO_MEM: 0x101, INVALID_ARG: 0x102, INVALID_STATE: 0x103, NOT_FOUND: 0x105, NOT_SUPPORTED: 0x106, TIMEOUT: 0x107 };
export const DBH = { NOHOST: -1000, TIMEOUT: -1001, BUSY: -1002, NOOP: -1003 };
export const HOSTED = { TRANSPORT_UP: 0, TRANSPORT_DOWN: 1, TRANSPORT_FAILURE: 2, CP_INIT: 3, CP_HEARTBEAT: 4, CP_DEINIT: 5 };
export const KODE = {
  MSG_REQ: 0x4B4F4401, MSG_RSP: 0x4B4F4481, WIRE: 3,
  SVC: { SELF: 0, VAULT: 1, ID: 2, BTKEYS: 3, SNIFF: 4 },
  ST: { OK: 0, REFUSED: 1, BAD_REQUEST: 2, NOT_FOUND: 3, STORAGE: 4, LOCKED: 5 },
  KIR_REQ: 0x4B495201, KIR_EVT: 0x4B495281,
};
const SSID_MAX = 32, PASS_MAX = 64, VAULT_MAX = 8;

const te = new TextEncoder(), td = new TextDecoder();
export const bytesOf = (s) => (typeof s === "string" ? te.encode(s) : s instanceof Uint8Array ? s : Uint8Array.from(s));

/** Little-endian writer, the other half of dbh_w_* / dbh_r_* in dotbench_radio.h. */
export class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { this.a.push(v & 255, (v >>> 8) & 255); return this; }
  u32(v) { this.a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); return this; }
  i8(v) { return this.u8(v); }
  bytes(b) { for (const x of bytesOf(b)) this.a.push(x); return this; }
  lp(b) { const x = bytesOf(b); this.u16(x.length); return this.bytes(x); }
  str(s) { return this.lp(te.encode(s)); }
  done() { return Uint8Array.from(this.a); }
}
export class R {
  constructor(b) { this.b = b; this.p = 0; this.bad = false; }
  get left() { return this.b.length - this.p; }
  u(n) { if (this.p + n > this.b.length) { this.bad = true; this.p = this.b.length; return 0; } let v = 0; for (let i = 0; i < n; i++) v += this.b[this.p + i] * 2 ** (8 * i); this.p += n; return v; }
  u8() { return this.u(1); }
  u16() { return this.u(2); }
  u32() { return this.u(4); }
  i32() { return this.u(4) | 0; }
  bytes(n) { if (this.p + n > this.b.length) { this.bad = true; this.p = this.b.length; return new Uint8Array(0); } const s = this.b.slice(this.p, this.p + n); this.p += n; return s; }
  rest() { return this.bytes(this.left); }
  lp() { return this.bytes(this.u16()); }
  str() { return td.decode(this.lp()); }
}
/** NUL-terminated string out of a fixed field. */
const cstr = (b) => { const i = b.indexOf(0); return td.decode(i < 0 ? b : b.subarray(0, i)); };
const fixed = (s, n) => { const o = new Uint8Array(n); o.set(te.encode(s).subarray(0, n - 1)); return o; };

// ---- DER (the CSR and the signature) ------------------------------------------------------------------------------
const derLen = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
export const der = {
  tlv: (t, c) => Uint8Array.from([t, ...derLen(c.length), ...c]),
  seq: (...p) => der.tlv(0x30, der.cat(...p)),
  set: (...p) => der.tlv(0x31, der.cat(...p)),
  cat: (...p) => { const o = []; for (const x of p) o.push(...x); return Uint8Array.from(o); },
  int: (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 128) b = Uint8Array.from([0, ...b]); return der.tlv(0x02, b); },
  oid: (s) => { const p = s.split(".").map(Number); const o = [p[0] * 40 + p[1]]; for (const n of p.slice(2)) { const t = [n & 127]; let v = n >>> 7; while (v) { t.unshift((v & 127) | 128); v >>>= 7; } o.push(...t); } return der.tlv(0x06, Uint8Array.from(o)); },
  utf8: (s) => der.tlv(0x0c, te.encode(s)),
  bits: (b) => der.tlv(0x03, Uint8Array.from([0, ...b])),
  /** IEEE P1363 (r||s) to a DER ECDSA-Sig-Value. */
  sig: (raw) => der.seq(der.int(raw.slice(0, raw.length / 2)), der.int(raw.slice(raw.length / 2))),
};

// ---- the world ------------------------------------------------------------------------------------------------------
const PERSIST = { vault: [], btkeys: new Map(), id: { key: null, spki: null, cert: null, locked: false }, swaps: 0, misses: 0, boots: 0 };

const FAST = { bootMs: 150, absentMs: 300, rpcTimeoutMs: 1200, serviceMs: 4, scanStepMs: 120, joinMs: 500, dhcpMs: 150, leaveMs: 40, pingScale: 1 };
const REAL = { bootMs: 700, absentMs: 3000, rpcTimeoutMs: 5000, serviceMs: 15, scanStepMs: 2900, joinMs: 3500, dhcpMs: 900, leaveMs: 200, pingScale: 1 };

export default function create(ctx) {
  const M = ctx.module;
  const timers = new Set();
  let disposed = false;
  const w = {
    W, R, ESP, DBH, KODE, HOSTED, der, bytesOf, cstr, fixed,
    ops: new Map(), events: new Map(), services: new Map(), peers: new Map(),
    timing: { ...FAST }, persist: PERSIST, notes: [],
    realTiming() { Object.assign(w.timing, REAL); },
    fastTiming() { Object.assign(w.timing, FAST); },
    op(name, fn) { w.ops.set(name, fn); },
    service(id, fn) { w.services.set(id, fn); },
    peer(id, fn) { w.peers.set(id >>> 0, fn); },
    sleep(ms) { return new Promise((res) => { const t = setTimeout(() => { timers.delete(t); res(); }, Math.max(0, ms)); t.unref?.(); timers.add(t); }); },
    after(ms, fn) { const t = setTimeout(() => { timers.delete(t); if (!disposed) try { fn(); } catch (e) { w.note("timer: " + e.message); } }, Math.max(0, ms)); t.unref?.(); timers.add(t); return t; },
    cancel(t) { clearTimeout(t); timers.delete(t); },
    note(msg) { w.notes.push(msg); if (w.notes.length > 500) w.notes.shift(); try { ctx.emit("note", { msg }); } catch {} if (w.verbose) console.log("[radio] " + msg); },
    event(type, data) { try { ctx.emit(type, data || {}); } catch {} for (const f of w.listeners) try { f(type, data || {}); } catch {} },
    listeners: new Set(),
    routerProto: {},   // methods of router bench objects: wifi.js and net.js both add theirs (glue files cannot import each other)
    hooks: {},     // set by wifi.js / net.js: { linkDown(why), linkUp(), hostDeinit(), vaultJoin(ssid, pass), routers() }
  };
  w.persist = PERSIST;

  // ---- memory access ----
  let buf = null, i32 = null;
  const I = () => { const b = ctx.heap().buffer; if (b !== buf) { buf = b; i32 = new Int32Array(b); } return i32; };
  const shared = () => typeof SharedArrayBuffer !== "undefined" && ctx.heap().buffer instanceof SharedArrayBuffer;
  const layoutPtr = (typeof M._dbh_layout === "function") ? M._dbh_layout() >>> 0 : 0;
  if (!layoutPtr) { w.note("the firmware has no radio bridge (dbh_layout): radio area not built in"); }
  const L = layoutPtr >> 2;
  const lay = () => { const a = I(); return { ev_size: a[L + 5] >>> 0, ev_buf: a[L + 6] >>> 0, nslots: a[L + 7], slot_size: a[L + 8] >>> 0, slots: a[L + 9] >>> 0 }; };
  const DB = L + 1, EVW = L + 2, EVH = L + 3, EVT = L + 4;

  // ---- calls: slot pickup ----
  function finish(slotAddr, rc, out) {
    const a = I(), base = slotAddr >> 2;
    const cap = a[base + 6] >>> 0;
    let n = 0;
    if (out && out.length) { n = Math.min(out.length, cap); ctx.heap().set(out.subarray(0, n), slotAddr + 64); }
    a[base + 5] = n;
    Atomics.store(a, base + 4, rc | 0);
    const prev = Atomics.compareExchange(a, base, 3, 4);
    if (prev === 3) Atomics.notify(a, base, 1);
    else if (prev === 5) Atomics.store(a, base, 0);   // the caller gave up: the slot is ours to free
  }
  function take(slotAddr) {
    const a = I(), base = slotAddr >> 2, h = ctx.heap();
    let end = slotAddr + 32; while (h[end] && end < slotAddr + 63) end++;
    const op = td.decode(h.slice(slotAddr + 32, end)   // a copy: TextDecoder refuses views of shared memory in Chrome);
    const inPtr = a[base + 2] >>> 0, inLen = a[base + 3] >>> 0;
    const input = h.slice(inPtr, inPtr + inLen);
    const fn = w.ops.get(op);
    w.stats.calls++;
    if (!fn) { w.stats.noop[op] = (w.stats.noop[op] || 0) + 1; finish(slotAddr, DBH.NOOP, null); return; }
    let res;
    try { res = fn(new R(input), { op }); } catch (e) { w.note(`op ${op} threw: ${e.message}`); finish(slotAddr, ESP.FAIL, null); return; }
    const done = (v) => {
      if (disposed) return;
      if (v === undefined || v === null) finish(slotAddr, 0, null);
      else if (typeof v === "number") finish(slotAddr, v, null);
      else if (v instanceof Uint8Array) finish(slotAddr, 0, v);
      else finish(slotAddr, v.rc | 0, v.out || null);
    };
    if (res && typeof res.then === "function") res.then(done, (e) => { w.note(`op ${op} failed: ${e.message}`); done(ESP.FAIL); });
    else done(res);
  }
  function pump() {
    if (!layoutPtr || disposed) return;
    const a = I(), l = lay();
    for (let i = 0; i < l.nslots; i++) {
      const addr = l.slots + i * l.slot_size;
      if (Atomics.compareExchange(a, addr >> 2, 2, 3) === 2) take(addr);
    }
  }
  w.stats = { calls: 0, noop: {}, evDropped: 0 };
  let armed = false;
  function arm() {
    if (!layoutPtr || disposed || !shared() || typeof Atomics.waitAsync !== "function") return;
    armed = true;
    const a = I(), cur = Atomics.load(a, DB);
    pump();
    const r = Atomics.waitAsync(a, DB, cur);
    if (r.async) r.value.then(() => { if (!disposed) arm(); });
    else queueMicrotask(arm);
  }

  // ---- events: the byte ring ----
  w.emit = (name, data) => {
    if (!layoutPtr || disposed) return false;
    const nb = te.encode(name), db = data ? bytesOf(data) : new Uint8Array(0);
    const total = (8 + nb.length + db.length + 3) & ~3;
    const a = I(), l = lay();
    const head = Atomics.load(a, EVH) >>> 0, tail = Atomics.load(a, EVT) >>> 0;
    if (total > l.ev_size - ((head - tail) >>> 0)) { w.stats.evDropped++; w.note(`event ring full: ${name} dropped`); return false; }
    const h = ctx.heap(), mask = l.ev_size - 1;
    const rec = new Uint8Array(total);
    rec[0] = nb.length & 255; rec[1] = nb.length >> 8;
    rec[4] = db.length & 255; rec[5] = (db.length >> 8) & 255; rec[6] = (db.length >> 16) & 255; rec[7] = (db.length >>> 24) & 255;
    rec.set(nb, 8); rec.set(db, 8 + nb.length);
    for (let i = 0; i < total; i++) h[l.ev_buf + ((head + i) & mask)] = rec[i];
    Atomics.store(a, EVH, (head + total) | 0);
    Atomics.add(a, EVW, 1);
    Atomics.notify(a, EVW, 1);
    return true;
  };

  // ---- the C5 ----
  const c5 = w.c5 = {
    power: true,            // the bench switch: the C5 has supply (and EN) or not
    fault: null,            // null | "absent" | "failed" | "mute"
    link: "down",           // "down" | "transport" | "up"   (what the host side has been told)
    parked: false,          // SELF_PARK was received: the next link-up does not reset the C5, its station survives
    fw: { major: 2, minor: 12, patch: 9 },
    chip: 23, target: "esp32c5",
    project: "kode_c5", version: "2.12.9", idf: "v5.5.1", date: "Jan  1 2026", time: "00:00:00",
    mac: [0x68, 0x67, 0x25, 0xc5, 0x00, 0x01],
    resetReason: 1,         // ESP_RST_POWERON for a first boot; SW (3) after the host asked
    heap: { free: 190000, low: 160000, largest: 110000 },
    pins: new Map(), ota: null, otaActivated: 0,
    hostInited: false, epoch: 0, bootTimer: null,
    usable() { return c5.power && c5.fault !== "absent" && c5.fault !== "failed" && c5.fault !== "mute" && c5.link === "up"; },
    reachable() { return c5.power && c5.fault !== "absent"; },
  };
  const hostedEvent = (id, reason = 0) => w.emit("hosted.event", new W().u8(id).u32(reason).done());
  const setLink = (s, why) => { if (c5.link !== s) { c5.link = s; w.event("link", { state: s, why }); } };

  /** The host side is told the link is gone (power, fault, drop). The C5's own state is the caller's business. */
  function linkLost(why) {
    if (c5.link === "down") return;
    setLink("down", why);
    c5.epoch++;
    if (c5.bootTimer) { w.cancel(c5.bootTimer); c5.bootTimer = null; }
    hostedEvent(HOSTED.TRANSPORT_FAILURE, 0);
    w.note(`C5 link lost (${why})`);
  }

  async function rpcGate() {
    if (c5.reachable() && c5.link !== "down" && c5.fault !== "mute" && c5.fault !== "failed") return true;
    await w.sleep(w.timing.rpcTimeoutMs);
    return false;
  }

  w.op("hosted.init", () => { c5.hostInited = true; return 0; });
  w.op("hosted.deinit", () => {
    c5.hostInited = false;
    if (c5.bootTimer) { w.cancel(c5.bootTimer); c5.bootTimer = null; }
    c5.epoch++;
    const was = c5.link;
    setLink("down", "host deinit");
    if (!c5.parked && was !== "down") w.hooks.hostDeinit?.();
    return 0;
  });
  w.op("hosted.connect", async () => {
    if (!c5.power || c5.fault === "absent") {
      await w.sleep(w.timing.absentMs);
      w.note(c5.power ? "C5 absent: SDIO card did not answer" : "C5 is switched off: SDIO card did not answer");
      return ESP.FAIL;
    }
    const epoch = ++c5.epoch;
    const fresh = !c5.parked;
    if (fresh) { PERSIST.boots++; c5.resetReason = PERSIST.boots > 1 ? 3 : 1; w.hooks.c5Reset?.(); }
    const kept = c5.parked;
    c5.parked = false;
    setLink("transport", "connect");
    w.after(20, () => { if (epoch === c5.epoch) hostedEvent(HOSTED.TRANSPORT_UP, 0); });
    if (c5.fault === "failed") { w.note("C5 fault 'failed': transport is up, the slave firmware never says CP_INIT"); return 0; }
    c5.bootTimer = w.after(kept ? 10 : w.timing.bootMs, () => {
      if (epoch !== c5.epoch || c5.fault === "failed") return;
      c5.bootTimer = null;
      setLink("up", "boot");
      hostedEvent(HOSTED.CP_INIT, kept ? 0 : c5.resetReason);
      w.hooks.linkUp?.({ kept });
    });
    return 0;
  });

  w.op("hosted.send", (r) => {
    const id = r.u32(), data = r.rest();
    if (c5.link === "down" || !c5.reachable()) return ESP.FAIL;
    if (c5.fault === "mute" || c5.fault === "failed") return 0;   // swallowed
    const fn = w.peers.get(id);
    if (!fn) return 0;
    w.after(w.timing.serviceMs, () => { try { fn(data); } catch (e) { w.note("peer handler: " + e.message); } });
    return 0;
  });
  w.peerSend = (msgId, bytes) => w.emit("hosted.peer", new W().u32(msgId).bytes(bytes).done());

  const appDesc = () => {
    const b = new Uint8Array(256), put = (o, s, n) => b.set(te.encode(s).subarray(0, n - 1), o);
    new DataView(b.buffer).setUint32(0, 0xABCD5432, true);
    put(16, c5.version, 32); put(48, c5.project, 32); put(80, c5.time, 16); put(96, c5.date, 16); put(112, c5.idf, 32);
    for (let i = 0; i < 32; i++) b[144 + i] = (0xa5 + i * 7) & 255;
    return b;
  };
  const GPIO = { CFG: 6, SET: 7, GET: 8, IN: 9 };
  w.op("hosted.rpc", async (r) => {
    const sub = r.u8();
    if (!(await rpcGate())) return ESP.TIMEOUT;
    switch (sub) {
      case 1: return { rc: 0, out: new W().u32(c5.fw.major).u32(c5.fw.minor).u32(c5.fw.patch).done() };
      case 2: return { rc: 0, out: new W().u32(c5.chip).str(c5.target).done() };
      case 3: return { rc: 0, out: appDesc() };
      case 4: return { rc: 0, out: new W().u32(c5.heap.free).u32(c5.heap.largest).u32(c5.heap.free >> 1).u32(c5.heap.largest >> 1).done() };
      case 5: return { rc: 0, out: Uint8Array.from(c5.mac) };
      case GPIO.CFG: { const lo = r.u32(), hi = r.u32(), mode = r.u32(); for (let i = 0; i < 64; i++) { const set = i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1; if (set) { const p = c5.pins.get(i) || { level: 0 }; p.mode = mode; p.input = !!(mode & 1); c5.pins.set(i, p); } } return 0; }
      case GPIO.SET: { const io = r.u32(), level = r.u32() ? 1 : 0; const p = c5.pins.get(io) || { mode: 0 }; p.level = level; c5.pins.set(io, p); w.event("c5-gpio", { io, level }); return 0; }
      case GPIO.GET: { const io = r.u32(); const p = c5.pins.get(io); return { rc: 0, out: Uint8Array.from([p ? (p.level ? 1 : 0) : 0]) }; }
      case GPIO.IN: { const io = r.u32(); const p = c5.pins.get(io) || { level: 0 }; p.input = true; c5.pins.set(io, p); return 0; }
      case 10: c5.ota = { bytes: 0, head: [] }; return 0;
      case 11: { if (!c5.ota) return ESP.INVALID_STATE; const n = r.u32(), head = r.rest(); if (c5.ota.bytes === 0) c5.ota.head = Array.from(head); c5.ota.bytes += n; return 0; }
      case 12: { if (!c5.ota || !c5.ota.bytes) return ESP.INVALID_STATE; c5.ota.done = true; return 0; }
      case 13: { if (!c5.ota?.done) return ESP.INVALID_STATE; c5.otaActivated++; c5.ota = null; w.note("C5 OTA activated (image contents are not interpreted; version unchanged)"); return 0; }
      default: return ESP.NOT_SUPPORTED;
    }
  });

  // ---- the KODE peer-data protocol: SELF / VAULT / ID / BTKEYS / SNIFF ----
  const reply = (hdr, status, payload) => {
    const p = payload || new Uint8Array(0);
    w.peerSend(KODE.MSG_RSP, new W().u8(KODE.WIRE).u8(hdr.service).u8(hdr.op).u8(hdr.seq).u8(status).u8(0).u16(p.length).bytes(p).done());
  };
  const sendEvent = (service, op, payload) => w.peerSend(KODE.MSG_RSP, new W().u8(KODE.WIRE).u8(service).u8(op).u8(0).u8(0).u8(0).u16(payload.length).bytes(payload).done());
  w.serviceEvent = sendEvent;
  w.peer(KODE.MSG_REQ, async (data) => {
    const r = new R(data);
    const version = r.u8(), service = r.u8(), op = r.u8(), seq = r.u8(), _st = r.u8(), _rs = r.u8(), len = r.u16();
    if (r.bad || version !== KODE.WIRE || data.length !== 8 + len) { w.note("KODE request dropped: bad header"); return; }
    const hdr = { service, op, seq };
    const fn = w.services.get(service);
    if (!fn) { reply(hdr, KODE.ST.BAD_REQUEST); return; }
    let res;
    try { res = await fn(op, data.slice(8), hdr); } catch (e) { w.note(`service ${service} op ${op}: ${e.message}`); res = { status: KODE.ST.STORAGE }; }
    if (res === null || res === undefined) return;   // a service may stay silent (the SDK's timeout is then the test)
    reply(hdr, res.status ?? 0, res.payload);
  });

  w.service(KODE.SVC.SELF, (op) => {
    if (op === 1) {
      const id = PERSIST.id, flags = (id.key ? 1 : 0) | (id.cert ? 2 : 0) | (id.locked ? 4 : 0);
      return { status: 0, payload: new W().u8(KODE.WIRE).u8(PERSIST.vault.length).u8(PERSIST.btkeys.size).u8(flags).u32(c5.heap.free).u32(c5.heap.low).u32(c5.heap.largest).u32(PERSIST.swaps).u32(PERSIST.misses).done() };
    }
    if (op === 2) { c5.parked = true; w.note("C5 parked: it keeps its station and waits for a new host"); return { status: 0 }; }
    return { status: KODE.ST.BAD_REQUEST };
  });

  const vault = PERSIST.vault;   // [{ssid, pass}] most recently used first
  const vaultTouch = (ssid) => { const i = vault.findIndex((v) => v.ssid === ssid); if (i > 0) vault.unshift(...vault.splice(i, 1)); };
  w.vaultTouch = vaultTouch;
  w.service(KODE.SVC.VAULT, (op, p) => {
    const E = KODE.ST;
    switch (op) {
      case 1: { // REMEMBER
        if (p.length !== 98) return { status: E.BAD_REQUEST };
        const ssid = cstr(p.subarray(0, 33)), pass = cstr(p.subarray(33));
        if (!ssid.length || te.encode(ssid).length > SSID_MAX || (pass.length && (te.encode(pass).length < 8 || te.encode(pass).length > PASS_MAX))) return { status: E.BAD_REQUEST };
        const i = vault.findIndex((v) => v.ssid === ssid);
        if (i >= 0) vault.splice(i, 1);
        vault.unshift({ ssid, pass });
        while (vault.length > VAULT_MAX) vault.pop();
        w.event("vault", { count: vault.length });
        return { status: E.OK };
      }
      case 2: { // JOIN
        if (p.length !== 33) return { status: E.BAD_REQUEST };
        const ssid = cstr(p);
        const v = vault.find((x) => x.ssid === ssid);
        if (!v) return { status: E.NOT_FOUND };
        if (!w.hooks.vaultJoin) return { status: E.REFUSED };
        w.hooks.vaultJoin(v.ssid, v.pass);
        return { status: E.OK };
      }
      case 3: { // LIST
        const o = new Uint8Array(1 + VAULT_MAX * 33);
        o[0] = vault.length;
        vault.forEach((v, i) => o.set(fixed(v.ssid, 33), 1 + i * 33));
        return { status: E.OK, payload: o };
      }
      case 4: { // FORGET
        if (p.length !== 33) return { status: E.BAD_REQUEST };
        const i = vault.findIndex((v) => v.ssid === cstr(p));
        if (i < 0) return { status: E.NOT_FOUND };
        vault.splice(i, 1);
        w.event("vault", { count: vault.length });
        return { status: E.OK };
      }
      case 5: vault.length = 0; w.event("vault", { count: 0 }); return { status: E.OK };
      default: return { status: E.BAD_REQUEST };
    }
  });

  // identity: a real P-256 key (WebCrypto), a real PKCS#10 CSR, real ECDSA signatures over the nonce
  const subtle = () => globalThis.crypto?.subtle;
  w.service(KODE.SVC.ID, async (op, p) => {
    const E = KODE.ST, id = PERSIST.id;
    switch (op) {
      case 1: { // CSR
        if (id.locked) return { status: E.LOCKED };
        if (!subtle()) return { status: E.STORAGE };
        if (!id.key) { id.key = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]); id.spki = new Uint8Array(await subtle().exportKey("spki", id.key.publicKey)); }
        const name = der.seq(der.set(der.seq(der.oid("2.5.4.3"), der.utf8("kode-dotbench"))));
        const info = der.seq(der.int(Uint8Array.from([0])), name, id.spki, Uint8Array.from([0xa0, 0x00]));
        const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, id.key.privateKey, info));
        const csr = der.seq(info, der.seq(der.oid("1.2.840.10045.4.3.2")), der.bits(der.sig(sig)));
        return { status: E.OK, payload: csr };
      }
      case 2: { // CERT_SET
        if (id.locked) return { status: E.LOCKED };
        if (!id.key) return { status: E.REFUSED };
        const r = new R(p), ul = r.u16(), cl = r.u16();
        if (r.bad || ul === 0 || ul + cl > 1536 || p.length < 4 + ul + cl) return { status: E.BAD_REQUEST };
        id.cert = { unit: p.slice(4, 4 + ul), chain: p.slice(4 + ul, 4 + ul + cl) };
        return { status: E.OK };
      }
      case 3: { // CERT_GET
        if (!id.cert) return { status: E.NOT_FOUND };
        return { status: E.OK, payload: new W().u16(id.cert.unit.length).u16(id.cert.chain.length).bytes(id.cert.unit).bytes(id.cert.chain).done() };
      }
      case 4: { // SIGN_AUTH
        if (p.length < 1 || p[0] < 1 || p[0] > 200 || p.length < 1 + p[0]) return { status: E.BAD_REQUEST };
        const nonce = p.slice(1, 1 + p[0]);
        if (!/^[A-Za-z0-9._-]+$/.test(td.decode(nonce))) return { status: E.BAD_REQUEST };
        if (!id.key || !id.cert) return { status: E.NOT_FOUND };
        const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, id.key.privateKey, nonce));
        return { status: E.OK, payload: der.sig(sig) };
      }
      case 5: if (!id.key || !id.cert) return { status: E.REFUSED }; id.locked = true; return { status: E.OK };
      case 6: return { status: E.OK, payload: Uint8Array.from([(id.key ? 1 : 0) | (id.cert ? 2 : 0) | (id.locked ? 4 : 0)]) };
      default: return { status: E.BAD_REQUEST };
    }
  });

  const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  w.service(KODE.SVC.BTKEYS, (op, p) => {
    const E = KODE.ST, keys = PERSIST.btkeys;
    switch (op) {
      case 1: if (p.length !== 32) return { status: E.BAD_REQUEST }; if (keys.size >= 32 && !keys.has(hexOf(p.slice(0, 16)))) return { status: E.STORAGE }; keys.set(hexOf(p.slice(0, 16)), p.slice(16)); return { status: E.OK };
      case 2: if (p.length !== 16) return { status: E.BAD_REQUEST }; return { status: keys.delete(hexOf(p)) ? E.OK : E.NOT_FOUND };
      case 3: keys.clear(); return { status: E.OK };
      case 4: if (p.length !== 16) return { status: E.BAD_REQUEST }; return { status: keys.has(hexOf(p)) ? E.OK : E.NOT_FOUND };
      default: return { status: E.BAD_REQUEST };
    }
  });

  // Wi-Fi frames heard: beacons of in-range routers on the listened channel, in batches, while the station state allows.
  const sniff = { on: false, channel: 0, wide: false, heard: 0, timer: null, why: 0 };
  const sniffState = () => new W().u8(sniff.on ? 1 : 0).u8(sniff.channel || (w.hooks.joinedChannel?.() || 0)).u8(w.hooks.joined?.() ? 1 : 0).u8(sniff.why).done();
  function beaconRec(rt, wide) {
    const fc = [0x80, 0x00], bssid = rt.bssid, ssidB = te.encode(rt.hidden ? "" : rt.ssid).subarray(0, 32);
    const head = new Uint8Array(wide ? 48 : 8);
    // fixed fields: timestamp(8) interval(2) capability(2), then the SSID element
    const full = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0x31, 0x04, 0, ssidB.length, ...ssidB]);
    head.set(full.subarray(0, head.length));
    const o = new W().i8(rt.signal).bytes(fc).bytes([255, 255, 255, 255, 255, 255]).bytes(bssid);
    if (wide) o.bytes(bssid);
    return o.u16(24 + 12 + 2 + ssidB.length).bytes(head).done();
  }
  function sniffTick() {
    const routers = (w.hooks.routers?.() || []).filter((r) => r.inRange && r.on && (!sniff.channel || r.channel === sniff.channel));
    const joinedCh = w.hooks.joinedChannel?.() || 0;
    const ch = sniff.channel || joinedCh || 0;
    const sel = routers.filter((r) => !ch || r.channel === ch).slice(0, 8);
    sniff.heard += sel.length;
    const recs = sel.map((r) => beaconRec(r, sniff.wide));
    const best = sel.length ? Math.max(...sel.map((r) => r.signal)) : -128;
    const hdr = new W().u8(ch).u8(recs.length).i8(best).u8(w.hooks.joined?.() ? 1 : 0).u32(sniff.heard).u16(recs.length).u16(0).done();
    sendEvent(KODE.SVC.SNIFF, 0x81, Uint8Array.from([...hdr, ...recs.flatMap((x) => Array.from(x))]));
  }
  w.service(KODE.SVC.SNIFF, (op, p) => {
    const E = KODE.ST;
    switch (op) {
      case 1: {
        if (p.length !== 2) return { status: E.BAD_REQUEST };
        const ch = p[0], flags = p[1];
        if (ch > 177 || (flags & ~1)) return { status: E.BAD_REQUEST };
        if (sniff.timer) { w.cancel(sniff.timer); sniff.timer = null; }
        sniff.on = false; sniff.why = 0; sniff.channel = ch; sniff.wide = !!(flags & 1); sniff.heard = 0;
        if (!w.hooks.wifiStarted?.()) sniff.why = 1;                                             // WIFI_OFF
        else if (w.hooks.joined?.() && ch && ch !== w.hooks.joinedChannel?.()) sniff.why = 2;   // JOINED: only its own channel
        else {
          sniff.on = true;
          const loop = () => { if (!sniff.on) return; sniffTick(); sniff.timer = w.after(500, loop); };
          sniff.timer = w.after(100, loop);
        }
        return { status: E.OK, payload: sniffState() };
      }
      case 2: sniff.on = false; sniff.why = 0; if (sniff.timer) { w.cancel(sniff.timer); sniff.timer = null; } return { status: E.OK, payload: sniffState() };
      case 3: return { status: E.OK, payload: sniffState() };
      default: return { status: E.BAD_REQUEST };
    }
  });
  w.hooks2 = { sniffStop() { sniff.on = false; if (sniff.timer) { w.cancel(sniff.timer); sniff.timer = null; } } };

  // Infrared: the default service says "the peripheral refused" until the IR area registers its own handler for KIR_MSG_REQ.
  w.irDefault = (data) => {
    const op = data[0], T = { send: 1, arm: 2, idle: 3, present: 4 };
    if (op === T.send || op === T.arm) w.peerSend(KODE.KIR_EVT, Uint8Array.from([op === T.send ? 1 : 4, 1, 1]));   // SENT / ARMED, KIR_FAIL
    else if (op === T.idle || op === T.present) w.peerSend(KODE.KIR_EVT, Uint8Array.from([3, 1, op, 1, 0]));       // LEVEL, KIR_FAIL
    else w.peerSend(KODE.KIR_EVT, Uint8Array.from([1, 1, 2]));
  };
  w.peer(KODE.KIR_REQ, (d) => w.irDefault(d));

  // ---- bench API ----
  const api = {
    world: w,
    /** Switch the C5's supply. Off while the link is up drops the link (TRANSPORT_FAILURE) and the station with it. */
    setPower(on) {
      on = !!on;
      if (c5.power === on) return;
      c5.power = on;
      w.event("power", { on });
      if (!on) { linkLost("power off"); w.hooks.c5Reset?.(); c5.parked = false; }
    },
    /** null | "absent" | "failed" | "mute". absent: nothing answers the SDIO bus; failed: the link comes up but the slave firmware never says CP_INIT;
     *  mute: CP_INIT arrived but every RPC and service request goes unanswered. */
    setFault(kind) {
      if (kind !== null && !["absent", "failed", "mute"].includes(kind)) throw new Error("fault is null, 'absent', 'failed' or 'mute'");
      c5.fault = kind;
      w.event("fault", { kind });
      if (kind === "absent") { linkLost("absent"); w.hooks.c5Reset?.(); }
    },
    /** The link drops while the C5 stays powered: the SDK notices (link lost) and reconnects; unless the C5 was parked it resets it, and the station goes. */
    dropLink(why = "dropped") { linkLost(why); },
    /** The C5 resets: link down, station gone. */
    reboot() { linkLost("reboot"); w.hooks.c5Reset?.(); c5.parked = false; },
    state() { return { power: c5.power, fault: c5.fault, link: c5.link, usable: c5.usable(), parked: c5.parked, fw: { ...c5.fw }, vault: vault.length, resetReason: c5.resetReason, otaActivated: c5.otaActivated }; },
    setFirmware(major, minor, patch, extra = {}) { Object.assign(c5.fw, { major, minor, patch }); c5.version = `${major}.${minor}.${patch}`; Object.assign(c5, extra); },
    vault: {
      list: () => vault.map((v) => v.ssid),
      entries: () => vault.map((v) => ({ ...v })),
      add(ssid, pass = "") { const i = vault.findIndex((v) => v.ssid === ssid); if (i >= 0) vault.splice(i, 1); vault.unshift({ ssid, pass }); while (vault.length > VAULT_MAX) vault.pop(); },
      clear() { vault.length = 0; },
    },
    identity: PERSIST.id,
    btkeys: PERSIST.btkeys,
    timing: w.timing,
    realTiming: () => w.realTiming(),
    fastTiming: () => w.fastTiming(),
    /** Forget the persisted C5 state (vault, keys, identity, boot count): a factory-fresh C5. */
    factoryReset() { vault.length = 0; PERSIST.btkeys.clear(); Object.assign(PERSIST.id, { key: null, spki: null, cert: null, locked: false }); PERSIST.swaps = PERSIST.misses = PERSIST.boots = 0; c5.parked = false; },
    pins: c5.pins,
    notes: w.notes,
    on(fn) { w.listeners.add(fn); return () => w.listeners.delete(fn); },
    poll() { pump(); },
    dispose() {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (layoutPtr) { try { Atomics.store(I(), L, 0); } catch {} }
      if (M.__dbw === w) delete M.__dbw;
    },
  };

  // attach: from here on dbh_call reaches this world
  if (layoutPtr) { Atomics.store(I(), L, 1); arm(); }
  ctx.onTick?.(() => { if (!disposed) pump(); });
  M.__dbw = w;
  for (const cb of (M.__dbwq || []).splice(0)) cb(w);
  api.fault = () => c5.fault;
  return api;
}
