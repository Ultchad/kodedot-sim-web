// SPDX-License-Identifier: GPL-3.0-or-later
// The declarative part runner (docs/component-api.md 4.2): the elements of a manifest evaluated in plain JS, inside the bench (no Worker).
// There is no scripting: every value is an `expr` over the part's fields. An unpowered part does nothing (the bench does not call us).
// Elements: switch, bridge, divider, source, drive, i2c_slave, h_bridge, servo, led, buzzer (led and buzzer are an addition to the design,
// see docs/STATUS-parts.md "decisions"); `wireless` binds a medium the bench does not simulate yet and is inert.

const num = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : Number(v) || 0);

/** An expr: a literal, {field, scale?, offset?} (a number) or {field, op, value} (a boolean). */
export function evalExpr(expr, fields) {
  if (expr === null || typeof expr !== "object") return expr;
  const v = fields[expr.field];
  if (expr.op !== undefined) {
    const a = typeof expr.value === "number" || typeof v === "number" ? num(v) : v, b = typeof expr.value === "number" || typeof v === "number" ? num(expr.value) : expr.value;
    switch (expr.op) { case "eq": return a === b; case "ne": return a !== b; case "gt": return a > b; case "ge": return a >= b; case "lt": return a < b; case "le": return a <= b; default: return false; }
  }
  return num(v) * (expr.scale ?? 1) + (expr.offset ?? 0);
}
const truthy = (v) => (typeof v === "string" ? v !== "" && v !== "0" && v !== "false" : !!v);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** The register file behind an `i2c_slave` element. */
export class RegisterFile {
  constructor(el, part) {
    this.el = el; this.part = part;
    this.ptrBytes = el.pointer_bytes ?? 1;
    this.autoInc = el.auto_increment ?? true;
    this.regs = new Map(el.registers.map((r) => [r.reg, r]));
    this.order = [...this.regs.keys()].sort((a, b) => a - b);
    this.stored = new Map(el.registers.map((r) => [r.reg, r.default ?? 0]));
    this.ptr = this.order[0] ?? 0;
    this.k = 0;                      // byte index inside the current register
  }
  address() { return typeof this.el.address === "object" ? Math.round(num(this.part.fields[this.el.address.field])) : this.el.address; }
  /** The register's bytes as a Number first, then bytes in the register's byte order. */
  value(r) {
    const v = r.value;
    if (!v) return this.stored.get(r.reg) ?? 0;
    let x = Math.round(num(this.part.fields[v.field]) * (v.scale ?? 1) + (v.offset ?? 0));
    x = x * 2 ** (v.left_align_bits ?? 0);
    const bits = r.size * 8, mod = 2 ** bits;
    x = ((x % mod) + mod) % mod;     // two's complement for negatives, wrap on overflow
    return x;
  }
  bytesOf(r) {
    const x = this.value(r), out = new Uint8Array(r.size), little = (r.value?.endian ?? "big") === "little";
    for (let i = 0; i < r.size; i++) { const sh = little ? i : r.size - 1 - i; out[i] = Math.floor(x / 2 ** (8 * sh)) & 0xff; }
    return out;
  }
  setBytes(r, bytes) {
    const little = (r.value?.endian ?? "big") === "little";
    let x = 0;
    for (let i = 0; i < r.size; i++) { const sh = little ? i : r.size - 1 - i; x += (bytes[i] ?? 0) * 2 ** (8 * sh); }
    this.stored.set(r.reg, x);
  }
  /** One transaction: write part (pointer then data), then a read of rlen bytes. */
  transact(w, rlen) {
    let data = w;
    if (w.length > 0 && this.ptrBytes === 1) { this.ptr = w[0]; this.k = 0; data = w.subarray(1); }
    if (data.length) {
      let r = this.regs.get(this.ptr), buf = [];
      for (const b of data) {
        if (!r) break;
        buf.push(b);
        if (buf.length === r.size) {
          if (r.access === "rw" && !r.value) this.setBytes(r, buf);
          buf = [];
          if (this.autoInc) { const n = this.order.find((x) => x > this.ptr); if (n === undefined) break; this.ptr = n; r = this.regs.get(n); }
        }
      }
    }
    const out = new Uint8Array(rlen);
    for (let i = 0; i < rlen; i++) {
      const r = this.regs.get(this.ptr);
      if (!r) { out[i] = 0xff; continue; }
      out[i] = this.bytesOf(r)[this.k];
      if (++this.k >= r.size) { this.k = 0; if (this.autoInc) { const n = this.order.find((x) => x > this.ptr); if (n !== undefined) this.ptr = n; } }
    }
    return out;
  }
}

/** Per-part state of the declarative runner. `host`: {inst, fields, net(term) -> {mv, mvHigh, mvLow, rth, level, pwm, floating}, term(pin), setOutput(name, v), clock, changed()} */
export class DeclarativePart {
  constructor(part, host) {
    this.part = part; this.host = host;
    this.elements = part.def.manifest.behaviour.elements;
    this.regfiles = new Map();
    this.sw = new Map();          // element index -> {closed, cancel}
    this.warnings = [];
    this.elements.forEach((el, i) => {
      if (el.type === "i2c_slave") this.regfiles.set(i, new RegisterFile(el, part));
      if (el.type === "switch") this.sw.set(i, { closed: truthy(evalExpr(el.closed, part.fields)), cancel: null });
      if (el.type === "wireless") this.warnings.push(`wireless port ${el.port} is not simulated by this bench build`);
    });
    this.last = new Map();        // output name -> value, for servo hold
  }
  dispose() { for (const s of this.sw.values()) s.cancel?.(); }
  /** A field changed: switches follow, with their contact bounce. */
  onField() {
    this.elements.forEach((el, i) => {
      if (el.type !== "switch") return;
      const s = this.sw.get(i), want = truthy(evalExpr(el.closed, this.part.fields));
      if (want === s.target) return;
      s.target = want;
      s.cancel?.();
      const bounce = el.bounce_ms ?? 0;
      if (!bounce || want === s.closed) { s.closed = want; return; }
      // closing or opening: up to 4 alternating contact states inside bounce_ms, then the final one
      const clock = this.host.clock(), t0 = clock.now(), steps = 4, cancels = [];
      for (let k = 1; k <= steps; k++) {
        const state = k % 2 === 1 ? want : !want;
        cancels.push(clock.schedule(t0 + (bounce * 1000 * k) / (steps + 1), () => { s.closed = k === steps ? want : state; this.host.changed(); }));
      }
      s.closed = !want;
      cancels.push(clock.schedule(t0 + bounce * 1000, () => { s.closed = want; this.host.changed(); }));
      s.cancel = () => cancels.forEach((c) => c());
    });
  }
  /** Terminal pairs joined while powered (or always, for a part with no supply pin). */
  joins() {
    const out = [], T = (p) => this.host.term(p);
    this.elements.forEach((el, i) => {
      if (el.type === "bridge") out.push([T(el.a), T(el.b)]);
      else if (el.type === "switch" && this.sw.get(i).closed) out.push([T(el.a), T(el.b)]);
    });
    return out;
  }
  /** Voltage sources the elements contribute (divider wiper, analog source, driven pin). vhigh: this part's logic-high voltage. */
  sources(vhigh) {
    const out = [], T = (p) => this.host.term(p), f = this.part.fields;
    for (const el of this.elements) {
      if (el.type === "divider") {
        const top = this.host.net(T(el.top)), bot = this.host.net(T(el.bottom));
        const p = clamp(num(evalExpr(el.position, f)), 0, 1);
        const vt = top.floating ? 0 : top.mv, vb = bot.floating ? 0 : bot.mv;
        out.push({ term: T(el.wiper), mv: vb + p * (vt - vb), ohms: Math.max(1, el.ohms * p * (1 - p)), kind: "analog" });
      } else if (el.type === "source") {
        out.push({ term: T(el.pin), mv: num(evalExpr(el.mv, f)), ohms: el.ohms ?? 100, kind: "analog" });
      } else if (el.type === "drive") {
        const level = truthy(evalExpr(el.level, f)) ? 1 : 0, od = el.mode === "open_drain";
        const pin = this.part.def.manifest.pins.find((p) => p.name === el.pin), ohms = 50 + (pin?.series_ohms ?? 0);
        if (od) { if (!level) out.push({ term: T(el.pin), mv: 0, ohms, kind: "od" }); }
        else out.push({ term: T(el.pin), mv: level ? vhigh : 0, ohms, kind: "out" });
      }
    }
    return out;
  }
  /** After a solve: recompute the outputs (led, buzzer, servo, h_bridge). Returns true when one changed. */
  evaluate() {
    const f = this.part.fields, T = (p) => this.host.term(p);
    let changed = false;
    const set = (name, v) => { if (this.last.get(name) !== v) { this.last.set(name, v); this.host.setOutput(name, v); changed = true; } };
    for (const el of this.elements) {
      if (el.type === "led") {
        const A = this.host.net(T(el.anode)), K = this.host.net(T(el.cathode));
        const rs = typeof el.series_ohms === "object" ? num(f[el.series_ohms.field]) : (el.series_ohms ?? 0), vf = el.vf_mv ?? 1900, full = el.full_ma ?? 10;
        const cur = (va, vk, ra, rk) => (A.floating || K.floating ? 0 : Math.max(0, (va - vk - vf) / (rs + ra + rk)));   // mV / ohm = mA
        let mA;
        const pw = A.pwm ?? K.pwm;
        if (pw) {
          const d = pw.duty;
          mA = d * cur(A.mvHigh ?? A.mv, K.mvHigh ?? K.mv, A.rth, K.rth) + (1 - d) * cur(A.mvLow ?? A.mv, K.mvLow ?? K.mv, A.rth, K.rth);
        } else mA = cur(A.mv, K.mv, A.rth, K.rth);
        set(el.output, Math.round(clamp(mA / full, 0, 1) * 1000) / 1000);
      } else if (el.type === "buzzer") {
        const n = this.host.net(T(el.pin));
        let hz = n.pwm && n.pwm.duty > 0.02 && n.pwm.duty < 0.98 ? n.pwm.hz : 0;
        if (el.ref && this.host.net(T(el.ref)).mv > 800) hz = 0;
        set(el.output, hz);
      } else if (el.type === "servo") {
        const n = this.host.net(T(el.pin));
        if (n.pwm && n.pwm.hz > 0) {
          const us = (n.pwm.duty * 1e6) / n.pwm.hz, lo = el.min_us ?? 1000, hi = el.max_us ?? 2000, range = el.range_deg ?? 180;
          set(el.output, Math.round(clamp((us - lo) / (hi - lo), 0, 1) * range * 10) / 10);
        }
      } else if (el.type === "h_bridge") {
        const drv = (pin) => { const n = this.host.net(T(pin)); return n.pwm ? n.pwm.duty : n.level ? 1 : 0; };
        let sp = drv(el.in1) - drv(el.in2);
        if (el.enable && !this.host.net(T(el.enable)).level) sp = 0;
        set(el.output, Math.round(sp * 1000) / 1000);
      }
    }
    return changed;
  }
  /** I2C targets while powered: [{addr, sda, scl, transact(w, rlen) -> {ack, r}}]. */
  i2cSlaves() {
    const out = [];
    this.elements.forEach((el, i) => {
      if (el.type !== "i2c_slave") return;
      const rf = this.regfiles.get(i);
      out.push({ addr: rf.address(), sda: this.host.term(el.sda), scl: this.host.term(el.scl), hzMax: 400000, handle: (w, rlen) => ({ ack: true, r: rf.transact(w, rlen) }) });
    });
    return out;
  }
}
