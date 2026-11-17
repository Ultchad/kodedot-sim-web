// SPDX-License-Identifier: GPL-3.0-or-later
// The bench clock (docs/component-api.md 5.8): one virtual time, in microseconds, for the router, the declarative parts and every wasm part.
// It lives in a 64-byte SharedArrayBuffer so a part's Worker reads it with plain atomic loads (layout = the spike's, `CLOCK` indices of a
// BigInt64Array). Realtime (default): now = virt_base + (real_now - real_base) * rate. Stepped (tests, a "step" button): now is written
// by `advance()`. The device (the firmware's own threads) always runs in real time; stepped mode is for part-only work and tests.
export const CLOCK = { MODE: 0, VIRT_BASE: 1, REAL_BASE: 2, RATE_PPM: 3, PAUSED: 4, STEPPED_NOW: 5 };
export const MODE_REALTIME = 0n, MODE_STEPPED = 1n;
const realUs = () => Math.round((performance.timeOrigin + performance.now()) * 1000);

export class BenchClock {
  /** @param {{mode?: "realtime"|"stepped", rate?: number}} [o] */
  constructor(o = {}) {
    this.sab = typeof SharedArrayBuffer !== "undefined" ? new SharedArrayBuffer(64) : new ArrayBuffer(64);
    this.clk = new BigInt64Array(this.sab);
    this._timers = [];            // {at, fn, id}, sorted by at (stable)
    this._seq = 0;
    this._real = null;
    this._stepper = null;         // async (targetUs) => void, set by the bench so stepping also waits for wasm parts
    Atomics.store(this.clk, CLOCK.RATE_PPM, BigInt(Math.round((o.rate ?? 1) * 1e6)));
    if ((o.mode ?? "realtime") === "stepped") this._setStepped(0);
    else this._setRealtime(0);
  }
  _setRealtime(virt) {
    Atomics.store(this.clk, CLOCK.MODE, MODE_REALTIME);
    Atomics.store(this.clk, CLOCK.VIRT_BASE, BigInt(Math.round(virt)));
    Atomics.store(this.clk, CLOCK.REAL_BASE, BigInt(realUs()));
    Atomics.store(this.clk, CLOCK.PAUSED, 0n);
  }
  _setStepped(virt) { Atomics.store(this.clk, CLOCK.MODE, MODE_STEPPED); Atomics.store(this.clk, CLOCK.STEPPED_NOW, BigInt(Math.round(virt))); Atomics.store(this.clk, CLOCK.PAUSED, 0n); }
  get mode() { return Atomics.load(this.clk, CLOCK.MODE) === MODE_STEPPED ? "stepped" : "realtime"; }
  get paused() { return Atomics.load(this.clk, CLOCK.PAUSED) !== 0n; }
  get rate() { return Number(Atomics.load(this.clk, CLOCK.RATE_PPM)) / 1e6; }
  /** Virtual microseconds since the clock was created (a Number: exact below 2^53). */
  now() {
    if (this.mode === "stepped") return Number(Atomics.load(this.clk, CLOCK.STEPPED_NOW));
    const vb = Number(Atomics.load(this.clk, CLOCK.VIRT_BASE));
    if (this.paused) return vb;
    return vb + (realUs() - Number(Atomics.load(this.clk, CLOCK.REAL_BASE))) * this.rate;
  }
  setMode(mode) { const t = this.now(); if (mode === "stepped") this._setStepped(t); else this._setRealtime(t); this._rearm(); }
  setRate(x) { const t = this.now(); Atomics.store(this.clk, CLOCK.RATE_PPM, BigInt(Math.round(x * 1e6))); if (this.mode === "realtime") this._setRealtime(t); this._rearm(); }
  pause() { if (this.mode === "realtime" && !this.paused) { const t = this.now(); Atomics.store(this.clk, CLOCK.VIRT_BASE, BigInt(Math.round(t))); Atomics.store(this.clk, CLOCK.PAUSED, 1n); this._rearm(); } }
  resume() { if (this.mode === "realtime" && this.paused) { Atomics.store(this.clk, CLOCK.REAL_BASE, BigInt(realUs())); Atomics.store(this.clk, CLOCK.PAUSED, 0n); this._rearm(); } }

  /** Run fn when virtual time reaches atUs (never earlier). Returns a cancel function. */
  schedule(atUs, fn) {
    const t = { at: atUs, fn, id: ++this._seq };
    let i = this._timers.length;
    while (i > 0 && this._timers[i - 1].at > atUs) i--;
    this._timers.splice(i, 0, t);
    this._rearm();
    return () => { const k = this._timers.indexOf(t); if (k >= 0) { this._timers.splice(k, 1); this._rearm(); } };
  }
  after(us, fn) { return this.schedule(this.now() + us, fn); }
  /** Virtual time of the next timer, or Infinity. */
  nextTimer() { return this._timers.length ? this._timers[0].at : Infinity; }
  _rearm() {
    if (this._real) { clearTimeout(this._real); this._real = null; }
    if (this.mode !== "realtime" || this.paused || !this._timers.length) return;
    const ms = Math.max(0, (this._timers[0].at - this.now()) / 1000 / this.rate);
    this._real = setTimeout(() => { this._real = null; this._fireDue(); this._rearm(); }, Math.min(ms, 2 ** 30));
    this._real.unref?.();
  }
  _fireDue() {
    const now = this.now();
    while (this._timers.length && this._timers[0].at <= now) {
      const t = this._timers.shift();
      try { t.fn(); } catch (e) { console.error(e); }
    }
  }
  /** Stepped mode: set now = t and fire what is due, in order, with `now` equal to each timer's own time. */
  _stepTo(t) {
    while (this._timers.length && this._timers[0].at <= t) {
      const tm = this._timers.shift();
      Atomics.store(this.clk, CLOCK.STEPPED_NOW, BigInt(Math.round(Math.max(tm.at, this.now()))));
      try { tm.fn(); } catch (e) { console.error(e); }
    }
    Atomics.store(this.clk, CLOCK.STEPPED_NOW, BigInt(Math.round(t)));
  }
  /** Stepped mode: advance virtual time by `us`. With wasm parts running, `stepper` (set by the bench) waits for every part to park. */
  async advance(us) {
    if (this.mode !== "stepped") throw new Error("advance() needs the stepped clock");
    const target = this.now() + us;
    if (this._stepper) await this._stepper(target); else this._stepTo(target);
  }
  dispose() { if (this._real) clearTimeout(this._real); this._real = null; this._timers.length = 0; }
}
