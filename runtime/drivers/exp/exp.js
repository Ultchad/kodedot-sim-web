// SPDX-License-Identifier: GPL-3.0-or-later
// Glue of the exp area: the raw link between the firmware's J3 fakes and the bench model (runtime/web-adapter/bench.js).
// Default export: (ctx) => link, called at every boot. Self-contained (no imports): it is packaged into the .dotbench.
// The glue emits ctx.emit("link", link), i.e. dev.on("area:exp:link", cb) / system.on(...) fires synchronously during boot, BEFORE
// the firmware's main() runs; the bench attaches there and so is serving before the first J3 call. The same object is
// dev.area("exp"). Layout of the block: runtime/drivers/exp/include/dotbench_exp.h.
//
// link API (all non-blocking; the page's thread must never wait on the firmware):
//   attach() / detach()           tell the firmware a bench serves (an unattached J3 answers nothing: no I2C ACK, no levels)
//   readPins() -> [{mode, pull, level, hz, duty}] x14    what the firmware does with each position (mode: z in out pwm adc)
//   v5Boost() -> bool             the PMIC's boost bit (the 5 V rail)
//   v33Pulse() -> bool            C5_EN was driven low (the C5 let go of J3's 3V3 enable: the no-link way to switch the rail on)
//   writeInputs(levels, mv)       the level (0/1) and the millivolts on each position, then wake the firmware's interrupt pump
//   takeRequest() -> null | {kind, p, w, rlen, seq}      one bus request (I2C/SPI/UART) the firmware waits on
//   reply(req, result, bytes?)    answer it (result: 0 ok, 1 nack address, 2 nack data, 3 stuck, 4 timeout, 5 refused)
//   rxPush(bytes) -> dropped      bytes into the firmware's UART receive ring (1024, overflow drops)
//   onDoorbell(cb) -> off         cb() when the firmware changed a pin, the boost bit or posted a request
const POS = 14, W = { MAGIC: 0, ABI: 1, ATTACHED: 2, BELL: 3, IN_SEQ: 4, V5: 5, RX_WAKE: 6, RX_HEAD: 7, RX_TAIL: 8, RX_DROP: 9, V33P: 10, PIN: 16, LEVEL: 128, MV: 144,
  RQ_STATE: 160, RQ_SEQ: 161, RQ_KIND: 162, RQ_P: 163, RQ_WLEN: 169, RQ_RLEN: 170, RQ_RESULT: 171, RQ_RDONE: 172 };
const B = { RQ_W: 704, RQ_R: 1728, RX: 2752 };
const MODES = ["z", "in", "out", "pwm", "adc"], PULLS = ["none", "up", "down"];

export default function create(ctx) {
  const M = ctx.module;
  const base = typeof M._dbx_block === "function" ? M._dbx_block() >>> 0 : 0;
  const listeners = new Set();
  let disposed = false, i32 = null, u8 = null, lastBell = 0, armed = false;
  const A = () => { const b = ctx.heap().buffer; if (!i32 || i32.buffer !== b) { i32 = new Int32Array(b, base, 1024); u8 = new Uint8Array(b, base, 4096 * 2); } return i32; };
  if (!base) { ctx.emit("link", null); return null; }
  A();
  const shared = typeof SharedArrayBuffer !== "undefined" && ctx.heap().buffer instanceof SharedArrayBuffer;

  function readPin(i) {
    const a = A(), o = W.PIN + i * 8;
    for (let n = 0; n < 1000; n++) {
      const s1 = Atomics.load(a, o);
      if (s1 & 1) continue;
      const v = { mode: MODES[Atomics.load(a, o + 1)] ?? "z", pull: PULLS[Atomics.load(a, o + 2)] ?? "none", level: Atomics.load(a, o + 3) & 1, hz: Atomics.load(a, o + 4) >>> 0, duty: Atomics.load(a, o + 5) >>> 0 };
      if (Atomics.load(a, o) === s1) return v;
    }
    return { mode: "z", pull: "none", level: 0, hz: 0, duty: 0 };
  }
  const fire = () => { for (const cb of listeners) { try { cb(); } catch (e) { console.error(e); } } };
  function check() {
    const b = Atomics.load(A(), W.BELL);
    if (b !== lastBell) { lastBell = b; fire(); }
  }
  function arm() {
    if (armed || disposed || !shared || typeof Atomics.waitAsync !== "function" || !listeners.size) return;
    armed = true;
    const r = Atomics.waitAsync(A(), W.BELL, lastBell, 1000);
    const again = () => { armed = false; if (disposed) return; check(); arm(); };
    if (r.async) r.value.then(again); else queueMicrotask(again);
  }
  ctx.onTick(() => { if (!disposed) check(); });

  const link = {
    version: 1,
    get attached() { return Atomics.load(A(), W.ATTACHED) !== 0; },
    attach() { Atomics.store(A(), W.ATTACHED, 1); Atomics.add(A(), W.IN_SEQ, 1); Atomics.notify(A(), W.IN_SEQ); lastBell = Atomics.load(A(), W.BELL); },
    detach() { Atomics.store(A(), W.ATTACHED, 0); Atomics.add(A(), W.IN_SEQ, 1); Atomics.notify(A(), W.IN_SEQ); },
    readPins() { const out = []; for (let i = 0; i < POS; i++) out.push(readPin(i)); return out; },
    v5Boost() { return Atomics.load(A(), W.V5) !== 0; },
    v33Pulse() { return Atomics.load(A(), W.V33P) !== 0; },
    writeInputs(levels, mv) {
      const a = A();
      for (let i = 0; i < POS; i++) { Atomics.store(a, W.LEVEL + i, levels[i] ? 1 : 0); Atomics.store(a, W.MV + i, Math.max(0, Math.min(0x7fffffff, Math.round(mv[i] ?? 0)))); }
      Atomics.add(a, W.IN_SEQ, 1);
      Atomics.notify(a, W.IN_SEQ);
    },
    takeRequest() {
      const a = A();
      if (Atomics.compareExchange(a, W.RQ_STATE, 1, 2) !== 1) return null;
      const wlen = a[W.RQ_WLEN] >>> 0;
      return { kind: a[W.RQ_KIND], p: Array.from(a.subarray(W.RQ_P, W.RQ_P + 6)), w: u8.slice(B.RQ_W, B.RQ_W + Math.min(wlen, 1024)), rlen: a[W.RQ_RLEN] >>> 0, seq: a[W.RQ_SEQ] >>> 0 };
    },
    reply(req, result, bytes) {
      const a = A();
      let n = 0;
      if (bytes && bytes.length) { n = Math.min(bytes.length, 1024); u8.set(bytes.subarray ? bytes.subarray(0, n) : bytes.slice(0, n), B.RQ_R); }
      Atomics.store(a, W.RQ_RDONE, n);
      Atomics.store(a, W.RQ_RESULT, result | 0);
      const prev = Atomics.compareExchange(a, W.RQ_STATE, 2, 3);
      if (prev === 2) Atomics.notify(a, W.RQ_STATE);
      else if (prev === 4) Atomics.store(a, W.RQ_STATE, 0);   // the firmware gave up: the mailbox is ours to free
    },
    rxPush(bytes) {
      const a = A();
      let head = Atomics.load(a, W.RX_HEAD) >>> 0, tail = Atomics.load(a, W.RX_TAIL) >>> 0, dropped = 0;
      for (const b of bytes) {
        if (((head - tail) >>> 0) >= 1024) { dropped++; continue; }
        u8[B.RX + (head & 1023)] = b; head = (head + 1) >>> 0;
      }
      Atomics.store(a, W.RX_HEAD, head | 0);
      if (dropped) Atomics.add(a, W.RX_DROP, dropped);
      Atomics.add(a, W.RX_WAKE, 1); Atomics.notify(a, W.RX_WAKE);
      return dropped;
    },
    onDoorbell(cb) { listeners.add(cb); arm(); return () => { listeners.delete(cb); }; },
    dispose() { disposed = true; listeners.clear(); },
  };
  ctx.emit("link", link);
  return link;
}
