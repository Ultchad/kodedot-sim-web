// SPDX-License-Identifier: GPL-3.0-or-later
// The wasm part runtime (docs/component-api.md 5.9, ABI 1): one Worker per powered part, the bench side of its mailbox and ring.
// A WasmPart is the "impl" the bench holds for a part whose manifest behaviour is wasm; it has the same shape as DeclarativePart
// (sources, joins, evaluate, edge, netsChanged, i2cSlaves, spiSlaves, uartPorts, onField, dispose) plus start(), parked(), deadline().
import { WORKER_SOURCE_URL } from "./bench-wasm-url.js";

export const RING_CAP = 2048, REC_WORDS = 8;
/** Mailbox layout (Int32 word indexes, byte offsets). Handed to the Worker with the init message, so it exists in exactly one place. */
export const L = {
  WAKE: 0, STATE: 1, DL_LO: 2, DL_HI: 3, REQ: 4, KIND: 5, ADDR: 6, WLEN: 7, RLEN: 8, RES: 9, RDONE: 10, HEARTBEAT: 12, MREPLY: 13, MRES: 14, MRDONE: 15,
  EV_HEAD: 16, EV_TAIL: 17, UART_HEAD: 18, UART_TAIL: 21, PARKS: 24, PIN_LVL: 64, PIN_MV: 128, EV: 256, EV_CAP: 256,
  WDATA: 4096, RDATA: 5120, UART_RX: 6144, FIELDS: 9216, BYTES: 12288, XFER_MAX: 256, RING_CAP, REC_WORDS,
  K: { PIN_MODE: 1, PIN_WRITE: 2, UART: 3, PWM: 4, I2C_SLAVE: 5, I2C_MASTER: 6, UART_BEGIN: 7, PIN_IRQ: 8, OUTPUT: 9, I2C_XFER: 10, SPI_BEGIN: 11, SPI_BEGIN2: 12, SPI_XFER: 13, DAC: 14 },
};
const R = { OK: 0, NACK_ADDR: 1, NACK_DATA: 2 };
const ARDUINO_CODE = { 0: 0, 1: 2, 2: 3 };       // bench result -> Wire.endTransmission code (others: 4)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let workerConfig = { url: null, source: null };
/** Page hook: give the Worker as a URL, or as source text (it becomes a blob: URL). Default: ./part-worker.js next to this file. */
export function configureWorker(o) { workerConfig = { ...workerConfig, ...o }; }

async function spawn() {
  // Emscripten defines a global Worker in Node (worker_threads' own class, which has no onmessage): Node always takes the worker_threads path
  if (typeof Worker !== "undefined" && !globalThis.process?.versions?.node) {
    let url = workerConfig.url ?? new URL(WORKER_SOURCE_URL, import.meta.url);
    if (workerConfig.source) url = URL.createObjectURL(new Blob([workerConfig.source], { type: "text/javascript" }));
    const w = new Worker(url, { type: "module" });
    return { post: (m) => w.postMessage(m), on: (cb) => { w.onmessage = (e) => cb(e.data); w.onerror = (e) => cb({ type: "error", message: e.message || "worker error" }); }, kill: () => w.terminate() };
  }
  const { Worker: NW } = await import("node:worker_threads"), { fileURLToPath } = await import("node:url");
  const w = new NW(fileURLToPath(workerConfig.url ?? new URL(WORKER_SOURCE_URL, import.meta.url)));
  return { post: (m) => w.postMessage(m), on: (cb) => { w.on("message", cb); w.on("error", (e) => cb({ type: "error", message: String(e?.stack || e) })); }, kill: () => w.terminate() };
}

export class WasmPart {
  constructor(part, host) {
    this.part = part; this.host = host; this.bench = host.bench;
    this.m = part.def.manifest;
    this.byGpio = new Map(); this.byName = new Map();
    for (const p of this.m.pins) { this.byName.set(p.name, p); if (p.gpio !== undefined) this.byGpio.set(p.gpio, p); }
    this.pin = new Map();            // gpio -> state {mode: "z"|"in"|"out"|"od", pull, level, pwm, dac, irq}
    for (const p of this.m.pins) if (p.gpio !== undefined) {
      const d = p.default ?? "z";
      this.pin.set(p.gpio, { mode: d.startsWith("out") ? "out" : d.startsWith("in") ? "in" : "z", pull: d === "in_pullup" ? "up" : d === "in_pulldown" ? "down" : "none", level: d === "out_high" ? 1 : 0, pwm: null, dac: null, irq: 0 });
    }
    this.slaves = []; this.i2cMaster = null; this.spiMaster = null; this.uart = [null, null, null];
    this.fieldIdx = (this.m.fields ?? []).filter((f) => ["number", "integer", "boolean", "enum"].includes(f.type));
    this.sab = new SharedArrayBuffer(L.BYTES); this.mb = new Int32Array(this.sab); this.mb8 = new Uint8Array(this.sab); this.f64 = new Float64Array(this.sab, L.FIELDS, 32);
    this.ringSab = new SharedArrayBuffer(8 * 4 + RING_CAP * REC_WORDS * 4); this.ring = new Int32Array(this.ringSab);
    this.worker = null; this.dead = false; this.busy = false; this.lastBeat = 0; this.stale = 0; this.parkMark = -1;
    this.reqQueue = []; this.reqActive = false;
    this.consoleDecoder = new TextDecoder();
  }

  async start() {
    for (let i = 0; i < this.fieldIdx.length && i < 32; i++) this._field(i);
    const def = this.part.def;
    def._module ??= await WebAssembly.compile(def.wasm);
    this.worker = await spawn();
    const ready = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("the part did not start within 10 s")), 10000); t.unref?.();
      this.worker.on((m) => {
        if (m.type === "ready") { clearTimeout(t); res(); } else if (m.type === "bell") this.drain();
        else if (m.type === "error") { clearTimeout(t); if (!this.dead) { this.crashed = true; this.host.warn("crashed", `the part stopped: ${m.message.split("\n")[0]}`); this.host.changed(); } rej(new Error(m.message.split("\n")[0])); }
      });
    });
    this.worker.post({ type: "init", module: def._module, bytes: undefined, clockSab: this.host.clock().sab, mbSab: this.sab, ringSab: this.ringSab, L });
    await ready;
    this.watch = setInterval(() => this._watchdog(), 500); this.watch.unref?.();
    this.drain();
  }
  dispose() {
    this.dead = true;
    clearInterval(this.watch);
    try { this.worker?.kill(); } catch {}
    this.worker = null;
  }
  _watchdog() {
    if (this.dead) return;
    this.drain();                                   // fallback for a missed doorbell
    const hb = Atomics.load(this.mb, L.HEARTBEAT), st = Atomics.load(this.mb, L.STATE);
    if (st === 0 && hb === this.lastBeat) { if (++this.stale >= 4 && !this.busy) { this.busy = true; this.host.warn("busy", "the sketch runs a loop that never calls delay(), yield() or any pin function; it cannot serve requests (busy loop)"); } }
    else { this.stale = 0; if (this.busy) { this.busy = false; } }
    this.lastBeat = hb;
  }

  // ---- state shared with the Worker ----
  _field(i) {
    const f = this.fieldIdx[i], v = this.part.fields[f.name];
    this.f64[i] = typeof v === "boolean" ? +v : typeof v === "number" ? v : f.type === "enum" ? Math.max(0, f.values.findIndex((x) => x.value === v)) : 0;
  }
  onField(name) { const i = this.fieldIdx.findIndex((f) => f.name === name); if (i >= 0 && i < 32) this._field(i); this._wake(); }
  _wake() { this.parkMark = Atomics.load(this.mb, L.PARKS); this.woken = true; Atomics.add(this.mb, L.WAKE, 1); Atomics.notify(this.mb, L.WAKE); }
  /** True when the Worker sits in wait_until_us (stepped mode uses this to know the part has nothing more to do). */
  parked() {
    if (this.dead) return true;
    if (this.woken) { if (Atomics.load(this.mb, L.PARKS) > this.parkMark && Atomics.load(this.mb, L.STATE) === 1) this.woken = false; else return false; }
    return Atomics.load(this.mb, L.STATE) === 1;
  }
  deadline() { return Number(BigInt.asUintN(64, (BigInt(Atomics.load(this.mb, L.DL_HI) >>> 0) << 32n) | BigInt(Atomics.load(this.mb, L.DL_LO) >>> 0))); }
  wake() { this._wake(); }
  _term(gpio) { const p = this.byGpio.get(gpio); return p ? `${this.part.instance}.${p.name}` : null; }

  // ---- what the bench asks ----
  sources(vhigh) {
    const out = [];
    for (const [gpio, st] of this.pin) {
      const def = this.byGpio.get(gpio);
      if (!def || def.kind === "nc") continue;                 // a pin with no terminal only drives visuals
      const term = `${this.part.instance}.${def.name}`, ohms = 50 + (def.series_ohms ?? 0);
      if (st.dac !== null) { out.push({ term, mv: st.dac, ohms: 200, kind: "analog" }); continue; }
      if (st.mode === "out") { out.push(st.pwm && st.pwm.hz > 0 ? { term, mv: vhigh, ohms, kind: "out", pwm: { hz: st.pwm.hz, duty: st.pwm.duty / 65536 } } : { term, mv: st.level ? vhigh : 0, ohms, kind: "out" }); }
      else if (st.mode === "od") { if (!st.level) out.push({ term, mv: 0, ohms, kind: "od" }); else if (st.pull === "up") out.push({ term, mv: vhigh, ohms: 45000, kind: "pull" }); }
      else if (st.pull === "up") out.push({ term, mv: vhigh, ohms: 45000, kind: "pull" });
      else if (st.pull === "down") out.push({ term, mv: 0, ohms: 45000, kind: "pull" });
    }
    return out;
  }
  joins() { return []; }
  evaluate() {}
  /** Visual sources bound to a gpio, even one with no terminal. */
  gpioState(gpio) { const st = this.pin.get(gpio); if (!st) return null; return st.pwm && st.pwm.hz > 0 ? st.pwm.duty / 65536 : st.mode === "out" || st.mode === "od" ? st.level : 0; }
  netsChanged() {
    if (this.dead) return;
    for (const [gpio] of this.pin) {
      const term = this._term(gpio); if (!term) continue;
      const n = this.host.net(term);
      Atomics.store(this.mb, L.PIN_LVL + (gpio & 63), n.level);
      Atomics.store(this.mb, L.PIN_MV + (gpio & 63), Math.round(n.floating ? 0 : n.mv));
    }
  }
  edge(pinName, level) {
    const p = this.byName.get(pinName); if (!p || p.gpio === undefined) return;
    const st = this.pin.get(p.gpio), k = st?.irq;
    if (!k || (k === 3 && level !== 0) || (k === 4 && level !== 1)) return;
    const t = Atomics.load(this.mb, L.EV_TAIL), h = Atomics.load(this.mb, L.EV_HEAD);
    if (t - h >= L.EV_CAP) return;
    const o = L.EV + (t % L.EV_CAP) * 2;
    this.mb[o] = 1; this.mb[o + 1] = p.gpio | (level << 16);
    Atomics.store(this.mb, L.EV_TAIL, (t + 1) | 0);
    this._wake();
  }

  // ---- bus endpoints ----
  i2cSlaves() {
    return this.slaves.map((s) => ({
      addr: s.addr, sda: this._term(s.sda) ?? `${this.part.instance}.?`, scl: this._term(s.scl) ?? `${this.part.instance}.?`, hzMax: 400000,
      handle: (w, rlen) => this._slaveRequest(1, s.addr, w, rlen),
    }));
  }
  spiSlaves() { return []; }
  uartPorts() {
    const out = [];
    this.uart.forEach((u, port) => { if (u && port > 0 && u.rx >= 0) out.push({ rx: this._term(u.rx), baud: u.baud, push: (bytes) => this._uartIn(port, bytes) }); });
    return out;
  }
  _uartIn(port, bytes) {
    let head = Atomics.load(this.mb, L.UART_HEAD + port), tail = Atomics.load(this.mb, L.UART_TAIL + port);
    for (const b of bytes) {
      if (((tail - head) | 0) >= 1024) break;
      this.mb8[L.UART_RX + port * 1024 + (tail & 1023)] = b; tail = (tail + 1) | 0;
    }
    Atomics.store(this.mb, L.UART_TAIL + port, tail);
    this._wake();
  }
  /** Bytes typed into the part's console (Serial). */
  consoleIn(bytes) { this._uartIn(0, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes); }

  // one slave transaction at a time through the request slot (the part may be inside a delay: it serves it from there)
  _slaveRequest(kind, addr, w, rlen) {
    return new Promise((resolve) => { this.reqQueue.push({ kind, addr, w, rlen, resolve }); this._pumpReq(); });
  }
  async _pumpReq() {
    if (this.reqActive || this.dead) return;
    this.reqActive = true;
    try {
      while (this.reqQueue.length && !this.dead) {
        const q = this.reqQueue.shift(), mb = this.mb;
        let s = Atomics.load(mb, L.REQ);
        if (s === 2) { Atomics.store(mb, L.REQ, 0); s = 0; }
        if (s !== 0) { for (let i = 0; i < 20 && Atomics.load(mb, L.REQ) !== 0 && Atomics.load(mb, L.REQ) !== 2; i++) await sleep(5); if (Atomics.load(mb, L.REQ) === 2) Atomics.store(mb, L.REQ, 0); if (Atomics.load(mb, L.REQ) !== 0) { q.resolve({ ack: false, timeout: true }); continue; } }
        const wn = Math.min(q.w.length, L.XFER_MAX), rn = Math.min(q.rlen, L.XFER_MAX);
        this.mb8.set(q.w.subarray(0, wn), L.WDATA);
        mb[L.KIND] = q.kind; mb[L.ADDR] = q.addr; mb[L.WLEN] = wn; mb[L.RLEN] = rn;
        Atomics.store(mb, L.REQ, 1);
        this._wake();
        const t0 = Date.now(); let st = 1;
        for (;;) {
          st = Atomics.load(mb, L.REQ);
          if (st === 2) break;
          if (Date.now() - t0 > 100) break;
          if (typeof Atomics.waitAsync === "function") { const r = Atomics.waitAsync(mb, L.REQ, st, 20); if (r.async) await r.value; } else await sleep(1);
        }
        if (st === 2) {
          const res = mb[L.RES], n = mb[L.RDONE];
          Atomics.store(mb, L.REQ, 0);
          this.drain();        // everything the callback published (outputs, pin writes) was pushed before it returned: take it now
          q.resolve(res === 0 ? { ack: true, r: this.mb8.slice(L.RDATA, L.RDATA + n) } : { ack: false });
        } else if (Atomics.compareExchange(mb, L.REQ, 1, 0) === 1) q.resolve({ ack: false, timeout: true });   // never claimed: take it back
        else q.resolve({ ack: false, timeout: true });                                                         // being served too slowly: the bench moves on
      }
    } finally { this.reqActive = false; }
  }

  // ---- the part's outbound ring ----
  drain() {
    if (this.dead) return;
    const ring = this.ring; let head = Atomics.load(ring, 0), dirty = false;
    for (;;) {
      const tail = Atomics.load(ring, 1);
      if (head === tail) break;
      const o = 8 + head * REC_WORDS, k = ring[o], a = ring[o + 1], b = ring[o + 2], c = ring[o + 3], d = ring[o + 6], e = ring[o + 7];
      head = (head + 1) % RING_CAP; Atomics.store(ring, 0, head);
      try { if (this._record(k, a, b, c, d, e)) dirty = true; } catch (err) { console.error(err); }
    }
    if (dirty) this.host.changed();
  }
  _record(k, a, b, c, d, e) {
    const K = L.K;
    switch (k) {
      case K.PIN_MODE: { const st = this.pin.get(a) ?? this._adhoc(a); st.pwm = null; st.dac = null;
        st.mode = b === 1 ? "out" : b === 4 ? "od" : "in"; st.pull = b === 2 ? "up" : b === 3 ? "down" : "none"; return true; }
      case K.PIN_WRITE: { const st = this.pin.get(a) ?? this._adhoc(a); st.level = b ? 1 : 0; return true; }
      case K.PWM: { const st = this.pin.get(a) ?? this._adhoc(a); st.pwm = b > 0 ? { hz: b >>> 0, duty: Math.min(65536, c >>> 0) } : null; if (b > 0) st.mode = "out"; return true; }
      case K.DAC: { const st = this.pin.get(a) ?? this._adhoc(a); st.dac = b; return true; }
      case K.PIN_IRQ: { const st = this.pin.get(a) ?? this._adhoc(a); st.irq = b; return false; }
      case K.UART_BEGIN: { if (a >= 0 && a < 3) this.uart[a] = { baud: b >>> 0, rx: c, tx: d }; return false; }
      case K.UART: { const bytes = new Uint8Array(b); for (let j = 0; j < b; j++) bytes[j] = ((j < 4 ? d : e) >>> (8 * (j % 4))) & 0xff; this._uartOut(a, bytes); return false; }
      case K.I2C_SLAVE: { this.slaves = this.slaves.filter((s) => s.addr !== b); this.slaves.push({ port: a, addr: b, sda: c, scl: d }); this.host.changed(); return false; }
      case K.I2C_MASTER: { this.i2cMaster = { port: a, sda: b, scl: c, hz: d >>> 0 }; return false; }
      case K.OUTPUT: {
        const dv = new DataView(new ArrayBuffer(8)); dv.setInt32(0, b, true); dv.setInt32(4, c, true); const v = dv.getFloat64(0, true);
        const out = (this.m.outputs ?? [])[a]; if (out) this.host.setOutput(out.name, out.type === "boolean" ? v !== 0 : v);
        return false;
      }
      case K.I2C_XFER: this._i2cXfer(a, b, c, d, e); return false;
      case K.SPI_BEGIN: this.spiMaster = { ...(this.spiMaster ?? {}), port: a, sck: b, miso: c, mosi: d, cs: e }; return false;
      case K.SPI_BEGIN2: if (this.spiMaster) { this.spiMaster.hz = b >>> 0; this.spiMaster.mode = c; } return false;
      case K.SPI_XFER: this._spiXfer(a, b, e); return false;
      default: return false;
    }
  }
  _adhoc(gpio) { const st = { mode: "z", pull: "none", level: 0, pwm: null, dac: null, irq: 0 }; this.pin.set(gpio, st); return st; }
  _uartOut(port, bytes) {
    if (port === 0) { this.host.console(this.consoleDecoder.decode(bytes, { stream: true })); return; }
    const u = this.uart[port]; if (!u || u.tx < 0) return;
    const term = this._term(u.tx); if (term) this.bench.uartSend(term, bytes, u.baud, this.part.instance);
  }
  _reply(seq, res, bytes) {
    const mb = this.mb;
    if (bytes) this.mb8.set(bytes.subarray(0, L.XFER_MAX), L.RDATA);
    mb[L.MRDONE] = bytes ? Math.min(bytes.length, L.XFER_MAX) : 0; mb[L.MRES] = res;
    Atomics.store(mb, L.MREPLY, seq);
    Atomics.add(mb, L.WAKE, 1); Atomics.notify(mb, L.WAKE);
  }
  _i2cXfer(port, addr, wn, rnStop, seq) {
    const m = this.i2cMaster, rn = rnStop & 0xffff, w = this.mb8.slice(L.WDATA, L.WDATA + wn);
    const sda = m && this._term(m.sda), scl = m && this._term(m.scl);
    if (!sda || !scl) { this._reply(seq, 4); return; }
    const fin = (r) => this._reply(seq, ARDUINO_CODE[r.result] ?? 4, r.r);
    const r = this.bench.i2cXfer({ sda, scl, hz: m.hz }, addr, w, rn);
    if (r && typeof r.then === "function") r.then(fin, () => this._reply(seq, 4)); else fin(r);
  }
  _spiXfer(port, n, seq) {
    const m = this.spiMaster, w = this.mb8.slice(L.WDATA, L.WDATA + n);
    const t = (g) => this._term(g);
    if (!m || !t(m.sck) || !t(m.mosi) || !t(m.miso)) { this._reply(seq, 1); return; }
    const fin = (r) => this._reply(seq, r.result === 0 ? 0 : 1, r.r);
    const r = this.bench.spiXfer({ sck: t(m.sck), mosi: t(m.mosi), miso: t(m.miso), cs: t(m.cs) ?? t(m.sck), hz: m.hz ?? 1000000, mode: m.mode ?? 0 }, w);
    if (r && typeof r.then === "function") r.then(fin, () => this._reply(seq, 1)); else fin(r);
  }
}
