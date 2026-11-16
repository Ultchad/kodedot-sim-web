// A tiny bench: virtual clock + one-component mailbox + I2C master from the "device" side.
import { Worker } from 'node:worker_threads';
import { CLOCK, MB, MB_WDATA, MB_RDATA, MB_FIELDS, MB_BYTES, REQ_I2C, RING_CAP, REC_WORDS, K, MODE_REALTIME, MODE_STEPPED, nowRealUs } from './layout.mjs';

export class Bench {
  constructor(mode = 'stepped') {
    this.clockSab = new SharedArrayBuffer(64); this.clk = new BigInt64Array(this.clockSab);
    this.comps = [];
    if (mode === 'stepped') { Atomics.store(this.clk, CLOCK.MODE, MODE_STEPPED); Atomics.store(this.clk, CLOCK.STEPPED_NOW, 0n); }
    else { Atomics.store(this.clk, CLOCK.MODE, MODE_REALTIME); Atomics.store(this.clk, CLOCK.VIRT_BASE, 0n);
           Atomics.store(this.clk, CLOCK.REAL_BASE, nowRealUs()); Atomics.store(this.clk, CLOCK.RATE_PPM, 1000000n); }
    this.mode = mode;
  }
  now() { return Atomics.load(this.clk, CLOCK.STEPPED_NOW); }
  spawn(name, wasmPath) {
    const c = { name, mbSab: new SharedArrayBuffer(MB_BYTES), ringSab: new SharedArrayBuffer(4 * (8 + RING_CAP * REC_WORDS)), events: [] };
    c.mb = new Int32Array(c.mbSab); c.mbBytes = new Uint8Array(c.mbSab); c.ring = new Int32Array(c.ringSab);
    c.worker = new Worker(new URL('./component_worker.mjs', import.meta.url),
      { workerData: { name, wasmPath, clockSab: this.clockSab, mbSab: c.mbSab, ringSab: c.ringSab } });
    c.worker.on('error', (e) => { c.error = e; console.error(`[${name}] worker error:`, e); });
    this.comps.push(c); return c;
  }
  drain(c) {                                  // ring -> array of {kind,a,b,c,t,d,e}
    const out = [];
    for (;;) {
      const head = Atomics.load(c.ring, 0), tail = Atomics.load(c.ring, 1);
      if (head === tail) break;
      const o = 8 + head * REC_WORDS, r = c.ring;
      const t = (BigInt(r[o + 5]) << 32n) | BigInt(r[o + 4] >>> 0);
      out.push({ kind: r[o], a: r[o + 1], b: r[o + 2], c: r[o + 3], t, d: r[o + 6], e: r[o + 7] });
      Atomics.store(c.ring, 0, (head + 1) % RING_CAP);
    }
    return out;
  }
  serialText(evs) {                           // join UART records of port 0 into text
    const bytes = [];
    for (const ev of evs) if (ev.kind === K.UART && ev.a === 0)
      for (let j = 0; j < ev.b; j++) bytes.push(((j < 4 ? ev.d : ev.e) >>> (8 * (j % 4))) & 0xff);
    return Buffer.from(bytes).toString('utf8');
  }
  async blocked(c, timeoutMs = 5000) {        // wait until the component is parked in a wait
    const dl = Date.now() + timeoutMs;
    while (Atomics.load(c.mb, MB.STATE) !== 1) {
      if (c.error) throw c.error;
      const r = Atomics.waitAsync(c.mb, MB.STATE, 0, 50); await r.value;
      if (Date.now() > dl) throw new Error(`${c.name}: never blocked`);
    }
    return (BigInt(c.mb[MB.DL_HI] >>> 0) << 32n) | BigInt(c.mb[MB.DL_LO] >>> 0);
  }
  // stepped mode: advance virtual time to tUs, in the order the components' deadlines fall
  async stepUntil(tUs) {
    for (;;) {
      let min = null;
      for (const c of this.comps) { const d = await this.blocked(c); if (min === null || d < min) min = d; }
      if (min === null || min > tUs) { this.#setNow(tUs); return; }
      this.#setNow(min);
    }
  }
  #setNow(t) {
    Atomics.store(this.clk, CLOCK.STEPPED_NOW, t);
    for (const c of this.comps) { Atomics.store(c.mb, MB.STATE, 0); Atomics.add(c.mb, MB.WAKE, 1); Atomics.notify(c.mb, MB.WAKE); }
  }
  // the device side of an I2C transaction: write part then (repeated start) read part
  async i2c(c, addr, wbytes = [], rlen = 0) {
    c.mbBytes.set(wbytes, MB_WDATA);
    c.mb[MB.KIND] = REQ_I2C; c.mb[MB.ADDR] = addr; c.mb[MB.WLEN] = wbytes.length; c.mb[MB.RLEN] = rlen;
    Atomics.store(c.mb, MB.REQ, 1); Atomics.add(c.mb, MB.WAKE, 1); Atomics.notify(c.mb, MB.WAKE);
    while (Atomics.load(c.mb, MB.REQ) !== 2) { await Atomics.waitAsync(c.mb, MB.REQ, 1, 50).value; }
    const res = c.mb[MB.RES], n = c.mb[MB.RDONE];
    Atomics.store(c.mb, MB.REQ, 0);
    return { ack: res === 0, data: Array.from(c.mbBytes.subarray(MB_RDATA, MB_RDATA + n)) };
  }
  setField(c, idx, v) { new Float64Array(c.mbSab, MB_FIELDS, 32)[idx] = v; }   // plain store: fields are polled by the firmware
  outputs(evs) {
    return evs.filter(e => e.kind === K.OUTPUT).map(e => ({ idx: e.a, v: new Float64Array(new Int32Array([e.b, e.c]).buffer)[0], t: e.t }));
  }
  stop() { for (const c of this.comps) c.worker.terminate(); }
}
