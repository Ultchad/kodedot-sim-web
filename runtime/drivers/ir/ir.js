// SPDX-License-Identifier: GPL-3.0-or-later
// dotbench infrared glue: the TV and Remote bench objects, and the link between them and the Dot's fake kdrv_ir (ir_fake.c).
// Default export: (ctx) => api (the guide's contract). Named exports are pure helpers (NEC encode/decode) usable without a device.
//
// The link carries raw symbol trains (mark/space durations in microseconds, a carrier frequency, up to 256 symbols) both ways:
//   Dot -> world : every kdrv_ir_send() is popped here (each tick) and shown to every TV that is aimed at the Dot.
//   world -> Dot : a Remote injects its frame; the Dot hears it only if its IR is on, its receiver is armed (one capture per
//                  arming), not deaf, and the carrier is near 38 kHz. The result of each injection is reported to the page.
// Durations are flat arrays [mark, space, mark, space, ...], mark first (the same shape as kode_ir_raw_t.us); an odd count ends on a mark.
//
//   const ir = device.area("ir");
//   const tv  = ir.tv({ name: "Living room TV" });          // aimed at the Dot, powered off, volume 20, channel 1, address word 0xFB04
//   const rem = ir.remote({ name: "Remote" });              // pointed at the Dot; default buttons Power Vol+ Vol- Ch+ Ch- Mute
//   await rem.press("Power");                               // one frame -> { ok, reason, frames:[...] }
//   await rem.hold("Vol+", 700);                            // a frame, then NEC repeat frames every 108 ms until released
//   rem.down("Vol+"); ...; rem.up();                        // the same, by hand
//   rem.sendRaw([9000, 4500, 560, ...], 38000);             // any train; rem.addButton("Sony", { raw: [...], carrier: 40000 })
//   tv.state()  -> { power, volume, channel, muted, last: {...} }     tv.log() -> entries (newest last)     tv.raw() -> last non-NEC train
//   tv.aim(false) / rem.aim(false)                          // "pointing at the Dot": yes / no
//   tv.remove() / rem.remove() / ir.remove(id)              // objects come and go at run time; ids are kind + a running number shared by both kinds: "tv1", "remote2", "tv3", ...
//   ir.objects()  ir.get(id)  ir.state()  ir.configure({ link, rxDeaf, txDark, rxFitted, restHigh, echo, agcUs })  ir.config()  ir.poll()
// Events (page side: dev.on("area:ir:<type>", cb)); each is emitted as it happens:
//   tx {seq, n, carrier, durUs, nec:{addr,cmd}|null, heardBy:[ids]}      the Dot transmitted
//   tv {id, entry}   tv-state {id, state}                                  a TV saw something / its state changed
//   remote {id, button, result, reason}                                    a Remote frame was offered to the Dot (result per frame)
//   created {id, kind} / removed {id}
// Bench objects are saved in the persistent region "ir" (JSON), so they survive a restart of the device and a page reload.

export const NEC = { leader: [9000, 4500], mark: 560, zero: 560, one: 1690, repeat: [9000, 2250], carrier: 38000, repeatMs: 108, tol: 300 };
const K = { LINK: 0, RX_DEAF: 1, TX_DARK: 2, RX_FITTED: 3, REST_HIGH: 4, ECHO: 5, STRETCH_US: 6, DISARM: 7 };
const S = { INIT: 0, ARMED: 1, READY: 2, TX_BUSY: 3, SENDS: 4, SEND_REFUSED: 5, CAPTURES: 6, DROP_UNARMED: 7, DROP_DEAF: 8, DROP_CARRIER: 9,
  DROP_LINK: 10, DROP_NOINIT: 11, TX_LOST: 12, ECHOES: 13, ARMS: 14, TAKES: 15, COUNT: 16 };
const REASON = { 1: "heard", 2: "heard (truncated to 256 symbols)", 0: "the Dot's receiver is not armed (nothing is listening)", "-1": "the Dot's infrared block is down",
  "-2": "the Dot's receiver is deaf or not fitted", "-3": "carrier outside the receiver's 36 to 40 kHz band", "-4": "the Dot's infrared owner is not running",
  "-5": "empty train" };
export const DEFAULT_BUTTONS = { Power: 0x08, "Vol+": 0x02, "Vol-": 0x03, "Ch+": 0x04, "Ch-": 0x05, Mute: 0x09 };
export const DEFAULT_TV_MAP = { 0x08: "power", 0x02: "vol+", 0x03: "vol-", 0x04: "ch+", 0x05: "ch-", 0x09: "mute" };
const REPEATABLE = new Set(["vol+", "vol-", "ch+", "ch-"]);
const LOG_MAX = 200;

// ------------------------------------------------------------------ NEC helpers

/** Classic NEC (8-bit address and command) as the SDK's 16-bit words: the inverted copy goes in the high byte (0x04 -> 0xFB04). */
export function classicWords(addr8, cmd8) {
  return { addr: (addr8 & 255) | (((~addr8) & 255) << 8), cmd: (cmd8 & 255) | (((~cmd8) & 255) << 8) };
}

/** One NEC frame as flat durations (leader, 32 bits LSB first: address word then command word, stop mark; no trailing space). */
export function necEncode(addr, cmd) {
  const out = [NEC.leader[0], NEC.leader[1]];
  const word = (((cmd & 0xffff) << 16) | (addr & 0xffff)) >>> 0;
  for (let i = 0; i < 32; i++) out.push(NEC.mark, (word >>> i) & 1 ? NEC.one : NEC.zero);
  out.push(NEC.mark);
  return out;
}
export const necRepeat = () => [NEC.repeat[0], NEC.repeat[1], NEC.mark];

const near = (v, nominal, tol = NEC.tol) => Math.abs(v - nominal) <= tol;

/** Read a train as NEC with the docs' 300 us tolerance: {kind:"nec", addr, cmd} | {kind:"repeat"} | null. This is the TV's own
 *  receiver, deliberately not the SDK's decoder, so a round trip checks the Dot's encoder with independent code. */
export function necDecode(d) {
  const n = d.length;
  if (n >= 3 && n <= 4 && near(d[0], NEC.repeat[0]) && near(d[1], NEC.repeat[1]) && near(d[2], NEC.mark)) return { kind: "repeat" };
  if (n < 67 || n > 68 || !near(d[0], NEC.leader[0]) || !near(d[1], NEC.leader[1])) return null;
  let word = 0;
  for (let i = 0; i < 32; i++) {
    const m = d[2 + 2 * i], s = d[3 + 2 * i];
    if (!near(m, NEC.mark)) return null;
    if (near(s, NEC.one)) word |= 2 ** i;
    else if (!near(s, NEC.zero)) return null;
  }
  if (!near(d[66], NEC.mark)) return null;
  return { kind: "nec", addr: word % 65536, cmd: Math.floor(word / 65536) };
}

/** Flat durations -> [mark, space, ...] pairs for the C side (an odd count ends on a mark with space 0). */
export function toSymbols(d) {
  const out = [];
  for (let i = 0; i < d.length; i += 2) out.push(d[i], d[i + 1] ?? 0);
  return out;
}

const hex4 = (v) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(4, "0");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, what, lo, hi) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${what} must be an integer ${lo}..${hi}`);
  return v;
};
function checkTrain(d) {
  if (!Array.isArray(d) || d.length < 1 || d.length > 512) throw new Error("a raw train is 1..512 durations");
  d.forEach((x) => num(x, "a duration", 1, 65535));
  return d.slice();
}

// ------------------------------------------------------------------ the glue

export default function (ctx) {
  const heapU32 = (p, n) => new Uint32Array(ctx.heap().buffer, p, n);
  const heapU16 = (p, n) => new Uint16Array(ctx.heap().buffer, p, n);
  const pHdr = ctx.alloc(32), pTx = ctx.alloc(256 * 4), pRx = ctx.alloc(256 * 4), pStat = ctx.alloc(S.COUNT * 4);
  const objs = new Map();
  let nextId = 1, dirty = false, closed = false;
  const timers = new Set();

  const emit = (type, data) => ctx.emit(type, data);
  const markDirty = () => { dirty = true; };

  // ---------------- TV
  class TV {
    constructor(o, id) {
      this.id = id; this.kind = "tv";
      this.name = String(o.name ?? "TV");
      this.aimed = o.aimed ?? true;
      this.address = num(o.address ?? 0xfb04, "address word", 0, 65535);
      this.map = { ...DEFAULT_TV_MAP, ...(o.map ?? {}) };
      this.power = !!o.power; this.volume = clamp(o.volume ?? 20, 0, 100); this.channel = clamp(o.channel ?? 1, 1, 99); this.muted = !!o.muted;
      this.fault = o.fault === "deaf" ? "deaf" : "none";
      this.lastNec = null; this.lastAt = 0; this.lastAction = null;
      this.seen = 0; this.missed = 0; this._log = []; this._raw = null;
      this.last = null;
    }
    def() { return { kind: "tv", id: this.id, name: this.name, aimed: this.aimed, address: this.address, map: this.map, power: this.power,
      volume: this.volume, channel: this.channel, muted: this.muted, fault: this.fault }; }
    state() { return { id: this.id, kind: "tv", name: this.name, aimed: this.aimed, address: this.address, power: this.power, volume: this.volume,
      channel: this.channel, muted: this.muted, fault: this.fault, seen: this.seen, missed: this.missed, last: this.last }; }
    snapshot() { return this.state(); }
    aim(v) { this.aimed = !!v; markDirty(); return this; }
    update(p) {
      for (const k of ["name", "aimed", "fault"]) if (k in p) this[k] = k === "aimed" ? !!p[k] : p[k];
      if ("address" in p) this.address = num(p.address, "address word", 0, 65535);
      if ("map" in p) this.map = { ...p.map };
      if ("power" in p) this.power = !!p.power;
      if ("volume" in p) this.volume = clamp(p.volume, 0, 100);
      if ("channel" in p) this.channel = clamp(p.channel, 1, 99);
      if ("muted" in p) this.muted = !!p.muted;
      markDirty(); this._changed();
      return this;
    }
    log() { return this._log.slice(); }
    clearLog() { this._log.length = 0; }
    raw() { return this._raw && { ...this._raw, durations: this._raw.durations.slice() }; }
    remove() { return removeObj(this.id); }
    _changed() { emit("tv-state", { id: this.id, state: this.state() }); }
    _push(e) {
      e.at = Date.now();
      this._log.push(e);
      if (this._log.length > LOG_MAX) this._log.shift();
      this.last = { type: e.type, addr: e.addr, cmd: e.cmd, action: e.action, why: e.why, at: e.at };
      emit("tv", { id: this.id, entry: e });
    }
    _action(a) {
      if (a === "power") this.power = !this.power;
      else if (!this.power) return false;
      else if (a === "vol+") { this.volume = clamp(this.volume + 1, 0, 100); this.muted = false; }
      else if (a === "vol-") { this.volume = clamp(this.volume - 1, 0, 100); }
      else if (a === "ch+") this.channel = this.channel >= 99 ? 1 : this.channel + 1;
      else if (a === "ch-") this.channel = this.channel <= 1 ? 99 : this.channel - 1;
      else if (a === "mute") this.muted = !this.muted;
      else return false;
      return true;
    }
    _lookup(cmd) {
      if (cmd in this.map) return this.map[cmd];
      const hi = cmd >> 8, lo = cmd & 255;
      if ((hi === 0 || hi === (~lo & 255)) && lo in this.map) return this.map[lo];
      return undefined;
    }
    /** One transmission of the Dot, offered to this TV. Returns true when the TV took it in. */
    hear(tx) {
      if (!this.aimed || this.fault === "deaf") { this.missed++; return false; }
      this.seen++;
      if (tx.carrier < 30000 || tx.carrier > 60000) { this._push({ type: "ignored", why: "carrier " + tx.carrier + " Hz is outside the TV's band", n: tx.n, carrier: tx.carrier }); return true; }
      const dec = necDecode(tx.durations);
      const now = Date.now();
      if (!dec) {
        this._raw = { durations: tx.durations.slice(), carrier: tx.carrier, n: tx.n, at: now };
        this._push({ type: "raw", n: tx.n, carrier: tx.carrier, durations: tx.durations.slice() });
        return true;
      }
      if (dec.kind === "repeat") {
        const a = this.lastAction;
        if (this.lastNec && now - this.lastAt < 300 && a && REPEATABLE.has(a)) {
          this.lastAt = now;
          const ok = this._action(a);
          this._push({ type: "repeat", addr: this.lastNec.addr, cmd: this.lastNec.cmd, action: a, applied: ok });
          if (ok) this._changed();
        } else this._push({ type: "ignored", why: "repeat frame with nothing to repeat" });
        return true;
      }
      if (dec.addr !== this.address) {
        this.lastNec = null;
        this._push({ type: "ignored", why: "wrong address " + hex4(dec.addr) + " (this TV listens to " + hex4(this.address) + ")", addr: dec.addr, cmd: dec.cmd });
        return true;
      }
      const a = this._lookup(dec.cmd);
      this.lastNec = dec; this.lastAt = now; this.lastAction = a ?? null;
      if (a === undefined) { this._push({ type: "nec", addr: dec.addr, cmd: dec.cmd, why: "no action for this command" }); return true; }
      const ok = this._action(a);
      this._push({ type: "nec", addr: dec.addr, cmd: dec.cmd, action: a, applied: ok, ...(ok ? {} : { why: "the TV is off" }) });
      if (ok) this._changed();
      return true;
    }
  }

  // ---------------- Remote
  class Remote {
    constructor(o, id) {
      this.id = id; this.kind = "remote";
      this.name = String(o.name ?? "Remote");
      this.aimed = o.aimed ?? true;
      this.classic = !!o.classic;
      this.address = num(o.address ?? 0xfb04, "address word", 0, 65535);
      this.carrier = num(o.carrier ?? 38000, "carrier", 1, 1000000);
      this.repeatOnHold = o.repeatOnHold ?? true;
      this.repeatMs = num(o.repeatMs ?? NEC.repeatMs, "repeatMs", 20, 2000);
      this.buttons = {};
      for (const [k, v] of Object.entries(o.buttons ?? DEFAULT_BUTTONS)) this.buttons[k] = this._norm(v);
      this._held = null;
      this.sent = 0; this.lastFrame = null;
    }
    _norm(v) {
      if (typeof v === "number") return { cmd: num(v, "command", 0, 65535) };
      if (v && Array.isArray(v.raw)) return { raw: checkTrain(v.raw), carrier: num(v.carrier ?? this.carrier, "carrier", 1, 1000000) };
      if (v && "cmd" in v) return { cmd: num(v.cmd, "command", 0, 65535) };
      throw new Error("a button is a command number, {cmd}, or {raw:[durations], carrier?}");
    }
    def() { return { kind: "remote", id: this.id, name: this.name, aimed: this.aimed, classic: this.classic, address: this.address, carrier: this.carrier,
      repeatOnHold: this.repeatOnHold, repeatMs: this.repeatMs, buttons: this.buttons }; }
    state() { return { id: this.id, kind: "remote", name: this.name, aimed: this.aimed, address: this.address, carrier: this.carrier, classic: this.classic,
      repeatOnHold: this.repeatOnHold, repeatMs: this.repeatMs, buttons: structuredClone(this.buttons), held: this._held && this._held.label, sent: this.sent,
      lastFrame: this.lastFrame }; }
    snapshot() { return this.state(); }
    aim(v) { this.aimed = !!v; markDirty(); return this; }
    update(p) {
      for (const k of ["name", "repeatOnHold"]) if (k in p) this[k] = p[k];
      if ("aimed" in p) this.aimed = !!p.aimed;
      if ("classic" in p) this.classic = !!p.classic;
      if ("address" in p) this.address = num(p.address, "address word", 0, 65535);
      if ("carrier" in p) this.carrier = num(p.carrier, "carrier", 1, 1000000);
      if ("repeatMs" in p) this.repeatMs = num(p.repeatMs, "repeatMs", 20, 2000);
      markDirty();
      return this;
    }
    addButton(label, def) { this.buttons[label] = this._norm(def); markDirty(); return this; }
    removeButton(label) { delete this.buttons[label]; markDirty(); return this; }
    remove() { this.up(); return removeObj(this.id); }
    _frame(b) {
      if (b.raw) return { durations: b.raw, carrier: b.carrier, nec: null };
      const addr = this.classic && this.address < 256 ? classicWords(this.address, 0).addr : this.address;
      const cmd = this.classic && b.cmd < 256 ? classicWords(0, b.cmd).cmd : b.cmd;
      return { durations: necEncode(addr, cmd), carrier: this.carrier, nec: { addr, cmd } };
    }
    _offer(label, durations, carrier, extra) {
      let rc;
      if (!this.aimed) rc = "not-aimed";
      else {
        const sym = toSymbols(durations);
        heapU16(pRx, 512).set(sym);
        rc = ctx.call("ir_rx_inject", pRx, sym.length / 2, carrier);
      }
      const ok = rc === 1 || rc === 2;
      const reason = rc === "not-aimed" ? "the remote is not pointed at the Dot" : REASON[rc];
      const result = { ok, code: rc, reason, ...extra };
      this.sent++;
      this.lastFrame = { button: label, durations: durations.length, carrier, ...extra, ok };
      emit("remote", { id: this.id, button: label, result: ok, reason, ...extra });
      return result;
    }
    /** One press and release: a single frame. */
    press(label) {
      const b = this.buttons[label];
      if (!b) throw new Error(`no button '${label}' on ${this.id}`);
      const f = this._frame(b);
      const r = this._offer(label, f.durations, f.carrier, f.nec ? { addr: f.nec.addr, cmd: f.nec.cmd } : {});
      return Promise.resolve({ ok: r.ok, reason: r.reason, frames: [r] });
    }
    /** Send any train now (flat durations, mark first, up to 512). */
    sendRaw(durations, carrier = this.carrier) {
      const d = checkTrain(durations);
      num(carrier, "carrier", 1, 1000000);
      const r = this._offer("(raw)", d, carrier, {});
      return Promise.resolve({ ok: r.ok, reason: r.reason, frames: [r] });
    }
    /** Press and keep holding: the frame now, then repeats every repeatMs (NEC: the 9000/2250 repeat frame; raw: the train again) until up(). */
    down(label) {
      const b = this.buttons[label];
      if (!b) throw new Error(`no button '${label}' on ${this.id}`);
      this.up();
      const f = this._frame(b);
      const held = { label, frames: [], timer: null };
      this._held = held;
      held.frames.push(this._offer(label, f.durations, f.carrier, f.nec ? { addr: f.nec.addr, cmd: f.nec.cmd } : {}));
      if (this.repeatOnHold) {
        const tick = () => {
          if (this._held !== held || closed) return;
          const d = b.raw ? b.raw : necRepeat();
          held.frames.push(this._offer(label, d, f.carrier, { repeat: true }));
          held.timer = setTimeout(tick, this.repeatMs); timers.add(held.timer);
        };
        held.timer = setTimeout(tick, this.repeatMs); timers.add(held.timer);
      }
      return held.frames[0];
    }
    /** Release: stops the repeats. Returns every frame offered while held ({ok, reason, frames}) or null when nothing was held. */
    up() {
      const h = this._held;
      if (!h) return null;
      this._held = null;
      clearTimeout(h.timer); timers.delete(h.timer);
      return { ok: h.frames.some((f) => f.ok), reason: h.frames[0].reason, frames: h.frames };
    }
    /** down(), wait ms, up(). */
    hold(label, ms) {
      this.down(label);
      return new Promise((res) => { const t = setTimeout(() => { timers.delete(t); res(this.up()); }, ms); timers.add(t); });
    }
  }

  // ---------------- registry and persistence
  function removeObj(id) {
    const o = objs.get(id);
    if (!o) return false;
    objs.delete(id);
    markDirty();
    emit("removed", { id });
    return true;
  }
  function add(o) { objs.set(o.id, o); markDirty(); emit("created", { id: o.id, kind: o.kind }); return o; }
  function save() {
    const text = JSON.stringify({ v: 1, nextId, objects: [...objs.values()].map((o) => o.def()) });
    const bytes = new TextEncoder().encode(text);
    const p = ctx.call("ir_blob_ptr");
    if (ctx.call("ir_blob_commit", 0) !== 0 || bytes.length > 32760) { emit("persist-failed", { bytes: bytes.length }); return; }
    ctx.heap().set(bytes, p);
    ctx.call("ir_blob_commit", bytes.length);
  }
  function load() {
    const len = ctx.call("ir_blob_len");
    if (!len) return;
    try {
      const p = ctx.call("ir_blob_ptr");
      const j = JSON.parse(new TextDecoder().decode(ctx.heap().slice(p, p + len)));
      if (j.v !== 1) return;
      nextId = j.nextId ?? 1;
      for (const d of j.objects) {
        const o = d.kind === "tv" ? new TV(d, d.id) : new Remote(d, d.id);
        objs.set(o.id, o);
      }
    } catch (e) { emit("persist-failed", { error: String(e) }); }
  }
  const newId = (kind) => `${kind}${nextId++}`;

  // ---------------- the link: what the Dot sent
  function drain() {
    for (let i = 0; i < 16; i++) {
      const n = ctx.call("ir_tx_pop", pHdr, pTx);
      if (!n) return;
      const h = heapU32(pHdr, 6);
      const seq = h[0], durUs = h[2], carrier = h[3];
      const sym = heapU16(pTx, n * 2);
      let d = Array.from(sym);
      if (d[d.length - 1] === 32767) d.pop();       // the frame's closing gap (a zero space is sent as the longest the RMT can express)
      const heardBy = [];
      const dec = necDecode(d);
      const rec = { seq, n, carrier, durUs, durations: d };
      for (const o of objs.values()) if (o.kind === "tv" && o.hear(rec)) heardBy.push(o.id);
      emit("tx", { seq, n, carrier, durUs, nec: dec && dec.kind === "nec" ? { addr: dec.addr, cmd: dec.cmd } : null, repeat: !!(dec && dec.kind === "repeat"), heardBy });
    }
  }
  let sinceChange = 0;
  ctx.onTick(() => {
    if (closed) return;
    drain();
    if (dirty && ++sinceChange >= 2) { dirty = false; sinceChange = 0; save(); }
  });

  load();

  const mk = (cls, kind) => (o = {}) => add(new cls(o, newId(kind)));
  return {
    tv: mk(TV, "tv"),
    remote: mk(Remote, "remote"),
    get: (id) => objs.get(id) ?? null,
    objects: () => [...objs.values()].map((o) => o.snapshot()),
    remove: removeObj,
    /** Drain the Dot's transmissions now (the glue also does it every tick) and write the objects out. */
    poll() { drain(); if (dirty) { dirty = false; save(); } },
    /** The Dot's side of the link: { init, armed, ready, txBusy, sends, sendRefused, captures, dropped:{unarmed,deaf,carrier,link,noinit}, txLost, echoes, arms, takes } */
    state() {
      ctx.call("ir_stats", pStat);
      const s = heapU32(pStat, S.COUNT);
      return { init: !!s[S.INIT], armed: !!s[S.ARMED], ready: !!s[S.READY], txBusy: !!s[S.TX_BUSY], sends: s[S.SENDS], sendRefused: s[S.SEND_REFUSED],
        captures: s[S.CAPTURES], dropped: { unarmed: s[S.DROP_UNARMED], deaf: s[S.DROP_DEAF], carrier: s[S.DROP_CARRIER], link: s[S.DROP_LINK], noinit: s[S.DROP_NOINIT] },
        txLost: s[S.TX_LOST], echoes: s[S.ECHOES], arms: s[S.ARMS], takes: s[S.TAKES] };
    },
    config: () => ({ link: !!ctx.call("ir_get", K.LINK), rxDeaf: !!ctx.call("ir_get", K.RX_DEAF), txDark: !!ctx.call("ir_get", K.TX_DARK),
      rxFitted: !!ctx.call("ir_get", K.RX_FITTED), restHigh: !!ctx.call("ir_get", K.REST_HIGH), echo: !!ctx.call("ir_get", K.ECHO), agcUs: ctx.call("ir_get", K.STRETCH_US) }),
    /** link=false: the Dot's infrared block is down ("radio off": every call is refused, nothing is heard). rxDeaf: arming works, nothing arrives.
     *  txDark: sends are accepted, nothing leaves. rxFitted=false: no receiver. restHigh=false: receiver output stuck low.
     *  echo: the Dot's own sends come back on its receiver at the end of the frame. agcUs: marks stretched (spaces shortened) by this much.
     *  disarm (one shot, not remembered): the C5 loses the receiver's arming; nothing is heard until the owner arms it again. */
    configure(c) {
      const map = { link: K.LINK, rxDeaf: K.RX_DEAF, txDark: K.TX_DARK, rxFitted: K.RX_FITTED, restHigh: K.REST_HIGH, echo: K.ECHO };
      for (const [k, key] of Object.entries(map)) if (k in c) ctx.call("ir_set", key, c[k] ? 1 : 0);
      if (c.disarm) ctx.call("ir_set", K.DISARM, 1);
      if ("agcUs" in c) ctx.call("ir_set", K.STRETCH_US, num(c.agcUs, "agcUs", 0, 1000));
      return this.config();
    },
    reset() { ctx.call("ir_reset"); },
    /** Stop every timer (called by nothing in the browser: the glue is recreated per boot; tests use it). */
    dispose() { closed = true; timers.forEach(clearTimeout); timers.clear(); },
  };
}
