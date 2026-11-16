// One component instance: wasm module + the "dotbench" imports. Runs sketch code that blocks
// (delay, while(1)) by blocking THIS Worker in Atomics.wait; no Asyncify. Node flavour; the browser
// flavour differs only in how workerData and the wasm bytes arrive.
import { workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { CLOCK, MB, MB_FIELDS, MB_WDATA, MB_RDATA, REQ_I2C, RING_CAP, REC_WORDS, K, MODE_STEPPED, nowRealUs } from './layout.mjs';

const { wasmPath, clockSab, mbSab, ringSab, name } = workerData;
const clk = new BigInt64Array(clockSab);
const mb = new Int32Array(mbSab), mbBytes = new Uint8Array(mbSab);
const ring = new Int32Array(ringSab);
const fields = new Float64Array(mbSab, MB_FIELDS, 32);               // [0]=head [1]=tail [2]=dropped, records from word 8
let X;                                              // wasm exports

function now() {
  if (Atomics.load(clk, CLOCK.MODE) === MODE_STEPPED) return Atomics.load(clk, CLOCK.STEPPED_NOW);
  const vb = Atomics.load(clk, CLOCK.VIRT_BASE);
  if (Atomics.load(clk, CLOCK.PAUSED) !== 0n) return vb;
  return vb + ((nowRealUs() - Atomics.load(clk, CLOCK.REAL_BASE)) * Atomics.load(clk, CLOCK.RATE_PPM)) / 1000000n;
}
function push(kind, a = 0, b = 0, c = 0, d = 0, e = 0) {
  const t = now(), head = Atomics.load(ring, 0), tail = Atomics.load(ring, 1);
  if (((tail + 1) % RING_CAP) === head) { Atomics.add(ring, 2, 1); return; }   // full: drop and count
  const o = 8 + tail * REC_WORDS;
  ring[o] = kind; ring[o + 1] = a; ring[o + 2] = b; ring[o + 3] = c;
  ring[o + 4] = Number(t & 0xffffffffn) | 0; ring[o + 5] = Number((t >> 32n) & 0xffffffffn) | 0;
  ring[o + 6] = d; ring[o + 7] = e;
  Atomics.store(ring, 1, (tail + 1) % RING_CAP);
}

// bench -> component requests. Called at every import: this is where "interrupts" are delivered.
function service() {
  // claim the request (1 posted -> 3 serving) so that imports called from inside the callback do not re-dispatch it
  if (Atomics.compareExchange(mb, MB.REQ, 1, 3) !== 1) return;
  const kind = mb[MB.KIND], addr = mb[MB.ADDR], wn = mb[MB.WLEN], rn = mb[MB.RLEN];
  if (kind === REQ_I2C) {
    const sc = X.dp_scratch(), mem = new Uint8Array(X.memory.buffer);
    mem.set(mbBytes.subarray(MB_WDATA, MB_WDATA + wn), sc);
    const r = X.dp_i2c_slave_event(0, addr, wn, rn);
    mb[MB.RES] = r < 0 ? 2 : 0;                                  // 2 = NACK on address (Arduino code)
    if (r > 0) mbBytes.set(new Uint8Array(X.memory.buffer, sc + 256, r), MB_RDATA);
    mb[MB.RDONE] = Math.max(r, 0);
  }
  Atomics.store(mb, MB.REQ, 2);
  Atomics.notify(mb, MB.REQ);
}

function waitUntil(deadline) {
  for (;;) {
    const seq = Atomics.load(mb, MB.WAKE);                       // read BEFORE looking, so no wake-up is lost
    service();
    const t = now();
    if (t >= deadline) return;
    let timeoutMs = Infinity;                                    // stepped: only the host can move time
    if (Atomics.load(clk, CLOCK.MODE) !== MODE_STEPPED && Atomics.load(clk, CLOCK.PAUSED) === 0n)
      timeoutMs = Number(((deadline - t) * 1000000n) / Atomics.load(clk, CLOCK.RATE_PPM)) / 1000;
    mb[MB.DL_LO] = Number(deadline & 0xffffffffn) | 0; mb[MB.DL_HI] = Number((deadline >> 32n) & 0xffffffffn) | 0;
    Atomics.store(mb, MB.STATE, 1); Atomics.notify(mb, MB.STATE);
    Atomics.wait(mb, MB.WAKE, seq, timeoutMs);
    Atomics.store(mb, MB.STATE, 0);
  }
}

const levels = new Int32Array(64);
const hb = () => Atomics.add(mb, MB.HEARTBEAT, 1);
const imports = {
  dotbench: {
    time_us: () => { hb(); service(); return now(); },
    wait_until_us: (d) => { hb(); waitUntil(BigInt.asUintN(64, d)); },
    yield: () => { hb(); service(); },
    pin_mode: (p, m) => { hb(); push(K.PIN_MODE, p, m); },
    pin_write: (p, v) => { hb(); service(); if (levels[p] !== v) { levels[p] = v; push(K.PIN_WRITE, p, v); } },
    pin_read: (p) => { hb(); service(); return Atomics.load(mb, MB.PIN_IN + p); },
    pin_irq: (p, k) => push(K.PIN_IRQ, p, k),
    pwm: (p, hz, duty) => push(K.PWM, p, hz, duty),
    adc_mv: (p) => Atomics.load(mb, MB.PIN_IN + 32 + (p & 31)),
    uart_begin: (port, baud, rx, tx) => push(K.UART_BEGIN, port, baud, rx, tx),
    uart_write: (port, ptr, n) => {
      hb(); const m = new Uint8Array(X.memory.buffer, ptr, n);
      for (let i = 0; i < n; i += 8) {                          // 8 payload bytes per ring record
        const chunk = m.subarray(i, Math.min(n, i + 8)); let d = 0, e = 0;
        for (let j = 0; j < chunk.length; j++) { if (j < 4) d |= chunk[j] << (8 * j); else e |= chunk[j] << (8 * (j - 4)); }
        push(K.UART, port, chunk.length, 0, d, e);
      }
    },
    field_f64: (i) => { hb(); service(); return i >= 0 && i < 32 ? fields[i] : 0; },
    output_f64: (i, v) => { const f = new Float64Array([v]), u = new Int32Array(f.buffer); push(K.OUTPUT, i, u[0], u[1]); },
    i2c_master_begin: (port, sda, scl, hz) => push(K.I2C_MASTER, port, sda, scl, hz),
    i2c_xfer: () => 2,                                         // master side not exercised in this spike: NACK
    i2c_slave_begin: (port, addr, sda, scl) => push(K.I2C_SLAVE, port, addr, sda, scl),
  },
};

const mod = await WebAssembly.compile(readFileSync(wasmPath));
const inst = await WebAssembly.instantiate(mod, imports);
X = inst.exports;
X._initialize();          // run C++ static constructors (Serial, Wire objects): standalone wasm has no main
X.dp_start();             // never returns; the host stops the component with worker.terminate()
