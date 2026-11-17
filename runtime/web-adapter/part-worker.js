// SPDX-License-Identifier: GPL-3.0-or-later
// One wasm part = one Worker running this file (ABI 1, docs/component-api.md 5.9). Self-contained on purpose (no imports): the page may turn
// it into a blob: URL. Works as a Node worker_threads worker and as a browser module Worker.
// Everything blocking is Atomics.wait in this Worker; the bench never waits. The layout of the mailbox arrives with the init message.
const wt = typeof process !== "undefined" && process.versions?.node && typeof WorkerGlobalScope === "undefined" ? await import("node:worker_threads") : null;
const post = (m) => (wt ? wt.parentPort.postMessage(m) : self.postMessage(m));
const onMessage = (cb) => (wt ? wt.parentPort.on("message", cb) : (self.onmessage = (e) => cb(e.data)));

onMessage(async (init) => {
  if (init?.type !== "init") return;
  try { await run(init); } catch (e) { post({ type: "error", message: String(e?.stack || e) }); }
});

async function run({ module, bytes, clockSab, mbSab, ringSab, L }) {
  const clk = new BigInt64Array(clockSab), mb = new Int32Array(mbSab), mb8 = new Uint8Array(mbSab), ring = new Int32Array(ringSab);
  const fields = new Float64Array(mbSab, L.FIELDS, 32);
  const MODE = 0, VIRT_BASE = 1, REAL_BASE = 2, RATE_PPM = 3, PAUSED = 4, STEPPED_NOW = 5;
  const realUs = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000));
  let X, mseq = 0, bootDone = false;
  const stepped = () => Atomics.load(clk, MODE) === 1n;
  const now = () => {
    if (stepped()) return Atomics.load(clk, STEPPED_NOW);
    const vb = Atomics.load(clk, VIRT_BASE);
    if (Atomics.load(clk, PAUSED) !== 0n) return vb;
    return vb + ((realUs() - Atomics.load(clk, REAL_BASE)) * Atomics.load(clk, RATE_PPM)) / 1000000n;
  };
  const RC = L.RING_CAP, RW = L.REC_WORDS;
  function push(kind, a = 0, b = 0, c = 0, d = 0, e = 0) {
    const t = now(), head = Atomics.load(ring, 0), tail = Atomics.load(ring, 1);
    if (((tail + 1) % RC) === head) { Atomics.add(ring, 2, 1); return; }
    const o = 8 + tail * RW;
    ring[o] = kind; ring[o + 1] = a; ring[o + 2] = b; ring[o + 3] = c;
    ring[o + 4] = Number(t & 0xffffffffn) | 0; ring[o + 5] = Number((t >> 32n) & 0xffffffffn) | 0; ring[o + 6] = d; ring[o + 7] = e;
    Atomics.store(ring, 1, (tail + 1) % RC);
    if (((tail + RC - head) % RC) === 0) post({ type: "bell" });    // the ring was empty before this record
  }
  const hb = () => Atomics.add(mb, L.HEARTBEAT, 1);

  // ---- requests from the bench, served inside blocking imports (this is how onReceive/onRequest and interrupts run) ----
  function service() {
    if (!X) return;
    // 1. a slave transaction (claimed with CAS so an import called from inside the callback does not re-dispatch it)
    if (Atomics.compareExchange(mb, L.REQ, 1, 3) === 1) {
      const kind = mb[L.KIND], addr = mb[L.ADDR], wn = mb[L.WLEN], rn = mb[L.RLEN];
      let res = 0, done = 0;
      if (kind === 1 && X.dp_i2c_slave_event) {
        const sc = X.dp_scratch(), mem = new Uint8Array(X.memory.buffer);
        mem.set(mb8.subarray(L.WDATA, L.WDATA + wn), sc);
        const r = X.dp_i2c_slave_event(0, addr, wn, rn);
        res = r < 0 ? 2 : 0;
        if (r > 0) mb8.set(new Uint8Array(X.memory.buffer, sc + 256, r), L.RDATA);
        done = Math.max(r, 0);
      } else res = 2;
      mb[L.RES] = res; mb[L.RDONE] = done;
      Atomics.store(mb, L.REQ, 2);
      Atomics.notify(mb, L.REQ);
    }
    // 2. pin edges
    for (;;) {
      const h = Atomics.load(mb, L.EV_HEAD), t = Atomics.load(mb, L.EV_TAIL);
      if (h === t) break;
      const o = L.EV + (h % L.EV_CAP) * 2, w0 = mb[o], w1 = mb[o + 1];
      Atomics.store(mb, L.EV_HEAD, (h + 1) | 0);
      if (w0 === 1 && X.dp_pin_event) X.dp_pin_event(w1 & 0xffff, (w1 >>> 16) & 1);
    }
    // 3. UART bytes
    for (let port = 0; port < 3; port++) {
      for (;;) {
        const h = Atomics.load(mb, L.UART_HEAD + port), t = Atomics.load(mb, L.UART_TAIL + port);
        if (h === t) break;
        const byte = mb8[L.UART_RX + port * 1024 + (h & 1023)];
        Atomics.store(mb, L.UART_HEAD + port, (h + 1) | 0);
        if (X.dp_uart_rx) X.dp_uart_rx(port, byte);
      }
    }
  }
  function waitUntil(deadline) {
    for (;;) {
      const seq = Atomics.load(mb, L.WAKE);                         // read BEFORE looking, so no wake-up is lost
      service();
      const t = now();
      if (t >= deadline) return;
      let timeoutMs = Infinity;                                     // stepped: only the host can move time
      if (!stepped() && Atomics.load(clk, PAUSED) === 0n) timeoutMs = Number(((deadline - t) * 1000000n) / Atomics.load(clk, RATE_PPM)) / 1000;
      mb[L.DL_LO] = Number(deadline & 0xffffffffn) | 0; mb[L.DL_HI] = Number((deadline >> 32n) & 0xffffffffn) | 0;
      Atomics.add(mb, L.PARKS, 1);
      Atomics.store(mb, L.STATE, 1); Atomics.notify(mb, L.STATE);
      Atomics.wait(mb, L.WAKE, seq, timeoutMs);
      Atomics.store(mb, L.STATE, 0);
    }
  }
  // a master transaction: block for the bench's reply, still serving requests (a slave callback may run meanwhile)
  function waitReply(seq) {
    for (;;) {
      const w = Atomics.load(mb, L.WAKE);
      service();
      if (Atomics.load(mb, L.MREPLY) === seq) return;
      Atomics.store(mb, L.STATE, 2); Atomics.notify(mb, L.STATE);
      Atomics.wait(mb, L.WAKE, w, 50);
      Atomics.store(mb, L.STATE, 0);
    }
  }
  const lv = new Int32Array(64).fill(-1);
  const imports = {
    dotbench: {
      time_us: () => { hb(); service(); return now(); },
      wait_until_us: (d) => { hb(); waitUntil(BigInt.asUintN(64, d)); },
      yield: () => { hb(); service(); },
      pin_mode: (p, m) => { hb(); push(L.K.PIN_MODE, p, m); lv[p & 63] = -1; },
      pin_write: (p, v) => { hb(); service(); if (lv[p & 63] !== v) { lv[p & 63] = v; push(L.K.PIN_WRITE, p, v); } },
      pin_read: (p) => { hb(); service(); return Atomics.load(mb, L.PIN_LVL + (p & 63)); },
      pin_irq: (p, k) => push(L.K.PIN_IRQ, p, k),
      pwm: (p, hz, duty) => { hb(); push(L.K.PWM, p, hz | 0, duty | 0); },
      adc_mv: (p) => { hb(); return Atomics.load(mb, L.PIN_MV + (p & 63)); },
      dac_mv: (p, mv) => push(L.K.DAC, p, mv),
      uart_begin: (port, baud, rx, tx) => push(L.K.UART_BEGIN, port, baud | 0, rx, tx),
      uart_write: (port, ptr, n) => {
        hb(); const m = new Uint8Array(X.memory.buffer, ptr, n);
        for (let i = 0; i < n; i += 8) {
          const chunk = m.subarray(i, Math.min(n, i + 8)); let d = 0, e = 0;
          for (let j = 0; j < chunk.length; j++) { if (j < 4) d |= chunk[j] << (8 * j); else e |= chunk[j] << (8 * (j - 4)); }
          push(L.K.UART, port, chunk.length, 0, d, e);
        }
      },
      field_f64: (i) => { hb(); service(); return i >= 0 && i < 32 ? fields[i] : 0; },
      output_f64: (i, v) => { const f = new Float64Array([v]), u = new Int32Array(f.buffer); push(L.K.OUTPUT, i, u[0], u[1]); },
      i2c_master_begin: (port, sda, scl, hz) => push(L.K.I2C_MASTER, port, sda, scl, hz | 0),
      i2c_xfer: (port, addr, wp, wn, rp, rn, stop) => {
        hb(); wn = Math.min(wn, L.XFER_MAX); rn = Math.min(rn, L.XFER_MAX);
        if (wn) mb8.set(new Uint8Array(X.memory.buffer, wp, wn), L.WDATA);
        const seq = ++mseq; push(L.K.I2C_XFER, port, addr, wn, rn | (stop ? 0x10000 : 0), seq);
        waitReply(seq);
        const res = mb[L.MRES], got = mb[L.MRDONE];
        if (rn && res === 0) { new Uint8Array(X.memory.buffer, rp, rn).set(mb8.subarray(L.RDATA, L.RDATA + Math.min(got, rn))); if (got < rn) new Uint8Array(X.memory.buffer, rp + got, rn - got).fill(0xff); }
        return res;
      },
      // persistent bytes of this part instance (EEPROM, Preferences): nvs_get(off, ptr, n) reads, nvs_set(off, ptr, n) writes and tells the bench
      nvs_get: (off, ptr, n) => { hb(); if (off < 0 || n < 0 || off + n > L.STORE_SIZE) return -1; new Uint8Array(X.memory.buffer, ptr, n).set(mb8.subarray(L.STORE + off, L.STORE + off + n)); return n; },
      nvs_set: (off, ptr, n) => { hb(); if (off < 0 || n < 0 || off + n > L.STORE_SIZE) return -1; mb8.set(new Uint8Array(X.memory.buffer, ptr, n), L.STORE + off); push(L.K.STORE, off, n); return n; },
      log: (ptr, n) => { hb(); imports.dotbench.uart_write(7, ptr, Math.min(n, 160)); },
      i2c_slave_begin: (port, addr, sda, scl) => push(L.K.I2C_SLAVE, port, addr, sda, scl),
      spi_begin: (port, sck, miso, mosi, cs, hz, mode) => { push(L.K.SPI_BEGIN, port, sck, miso, mosi, cs); push(L.K.SPI_BEGIN2, port, hz | 0, mode); },
      spi_xfer: (port, wp, rp, n) => {
        hb(); n = Math.min(n, L.XFER_MAX);
        mb8.set(new Uint8Array(X.memory.buffer, wp, n), L.WDATA);
        const seq = ++mseq; push(L.K.SPI_XFER, port, n, 0, 0, seq);
        waitReply(seq);
        const res = mb[L.MRES];
        if (rp) new Uint8Array(X.memory.buffer, rp, n).set(mb8.subarray(L.RDATA, L.RDATA + n));
        return res;
      },
    },
  };
  const mod = module ?? (await WebAssembly.compile(bytes));
  const inst = await WebAssembly.instantiate(mod, imports);
  X = inst.exports;
  X._initialize?.();
  post({ type: "ready" });
  X.dp_start();               // never returns; the bench stops the part with worker.terminate()
}
