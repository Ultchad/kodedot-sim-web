// SPDX-License-Identifier: GPL-3.0-or-later
// The declarative part runner (docs/component-api.md 4.2): the elements of a manifest evaluated in plain JS, inside the bench (no Worker).
// There is no scripting: every value is an `expr` over the part's fields. An unpowered part does nothing (the bench does not call us).
// Elements: switch, bridge, divider, source, drive, i2c_slave, h_bridge, servo, led, buzzer (led and buzzer are an addition to the design,
// see docs/STATUS-parts.md "decisions"); `wireless` binds a medium the bench does not simulate yet and is inert.
// Two-terminal elements solved with the net (bench-solver solveNetwork): resistor, capacitor, diode (also LEDs), cell. They load their nets,
// so a resistor between a GPIO and an LED really sets the LED current. Parts with them expose branches(), onBranch(), hazards(), repair().

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
    this.motion = new Map();      // element index -> {pos, last, lastT, stalled, lvl...}: steppers, relays
    this.diodeOn = new Map();     // branch id -> conducting (carried between solves)
    this.br = new Map();          // branch id -> last result {cur (mA, duty average), curHi, curLo, vd (mV)}
    this.capV = new Map();        // branch id -> capacitor voltage (mV, plus minus)
    this.failed = new Map();      // element index -> "reason": an element that burned out or burst (open circuit) until repair()
    this.since = new Map();       // latch key -> virtual time the condition began
  }
  /** Replace a failed element (the page's "new part" button). */
  repair() { this.failed.clear(); this.since.clear(); this.host.changed(); }
  _ohms(el) { const o = el.ohms; return Math.max(0.001, typeof o === "object" ? num(this.part.fields[o.field]) * (o.scale ?? 1) : num(o)); }
  /** A condition that must hold `delayMs` of virtual time before it latches. */
  _trip(key, cond, delayMs) {
    if (!cond) { if (this.since.delete(key)) { /* cancelled */ } return false; }
    const clock = this.host.clock(), now = clock.now();
    if (!this.since.has(key)) { this.since.set(key, now); if (delayMs > 0) clock.schedule(now + delayMs * 1000, () => this.host.changed()); }
    return now - this.since.get(key) >= delayMs * 1000 - 1;
  }
  /** Branches for the nodal solve (see bench-solver.js). */
  branches() {
    const out = [], T = (p) => this.host.term(p), f = this.part.fields;
    this.elements.forEach((el, i) => {
      if (this.failed.has(i)) return;
      const id = "e" + i;
      if (el.type === "resistor") out.push({ id, kind: "r", a: T(el.a), b: T(el.b), g: 1 / this._ohms(el) });
      else if (el.type === "capacitor") { if (!this.capV.has(id)) this.capV.set(id, 0); out.push({ id, kind: "cap", a: T(el.a), b: T(el.b), c: Math.max(1e-12, num(evalExpr(el.farads, f))), esr: el.esr_ohms ?? 0, v: this.capV.get(id) }); }
      else if (el.type === "motor") out.push({ id, kind: "r", a: T(el.a), b: T(el.b), g: 1 / Math.max(0.1, el.ohms ?? 8) });
      else if (el.type === "diode") out.push({ id, kind: "diode", a: T(el.anode), b: T(el.cathode), vf: el.vf_mv ?? 700, rs: el.rs_ohms ?? 10 });
      else if (el.type === "cell") out.push({ id, kind: "emf", a: T(el.pos), b: T(el.neg), g: 1 / Math.max(0.001, el.ohms ?? 1.5), e: num(evalExpr(el.mv, f)), refB: true });
    });
    return out;
  }
  clearBranches() { this.br.clear(); }
  onBranch(id, b, commitDt) {
    this.br.set(id, { cur: b.cur, curHi: b.curHi, curLo: b.curLo, vd: b.vd });
    if (b.kind === "diode") this.diodeOn.set(id, !!b.on);
    else if (b.kind === "cap" && commitDt > 0) this.capV.set(id, this.capV.get(id) + (b.cur * commitDt) / b.c);
  }
  /** Capacitor voltage in mV (plus minus), for tests and the page. */
  capVoltage(index) { return this.capV.get("e" + index) ?? 0; }
  hazards() {
    const out = [], T = (p) => this.host.term(p), N = (p) => this.host.net(T(p));
    this.elements.forEach((el, i) => {
      const id = "e" + i, r = this.br.get(id), inst = this.host.instance;
      if (this.failed.has(i)) { out.push({ class: this.failed.get(i).class, terms: [inst], net: -1, text: `${inst}: ${this.failed.get(i).text}` }); return; }
      if (el.type === "resistor" && el.rated_mw && r) { const pw = (r.cur * r.cur * this._ohms(el)) / 1000; if (pw > el.rated_mw) out.push({ class: "overpower", terms: [T(el.a), T(el.b)], net: N(el.a).id, text: `${inst}: resistor dissipates ${Math.round(pw)} mW, rated ${el.rated_mw} mW` }); }
      else if (el.type === "motor" && el.max_ma && r && Math.abs(r.cur) > el.max_ma) out.push({ class: "overcurrent", terms: [T(el.a), T(el.b)], net: N(el.a).id, text: `${inst}: ${Math.round(Math.abs(r.cur))} mA through a motor that stalls at ${el.max_ma} mA` });
      else if (el.type === "diode" && el.max_ma && r && r.cur > el.max_ma) out.push({ class: "overcurrent", terms: [T(el.anode), T(el.cathode)], net: N(el.anode).id, text: `${inst}: ${Math.round(r.cur)} mA through a ${el.max_ma} mA part: add a series resistor` });
      else if (el.type === "capacitor" && el.polarity) {
        const v = this.capV.get(id) ?? 0, rev = el.polarity.plus === el.a ? -v : v;
        if (rev > (el.polarity.reverse_mv ?? 1000)) out.push({ class: "polarity", terms: [T(el.a), T(el.b)], net: N(el.a).id, text: `${inst}: electrolytic capacitor connected backwards` });
      } else if (el.type === "cell") {
        if (N(el.pos).id === N(el.neg).id) out.push({ class: "short", terms: [T(el.pos), T(el.neg)], net: N(el.pos).id, text: `short: ${inst} plus wired to its own minus` });
        else if (el.max_ma && r && Math.abs(r.cur) > el.max_ma) out.push({ class: "overcurrent", terms: [T(el.pos), T(el.neg)], net: N(el.pos).id, text: `${inst}: ${Math.round(Math.abs(r.cur))} mA, the source gives ${el.max_ma} mA` });
      }
    });
    return out;
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
      else if (el.type === "relay") { const m = this._relay(i); out.push([T(el.com), T(m.closed ? el.no : el.nc)]); }
    });
    return out;
  }
  /** A part with no power still has its resting contacts (a relay's COM-NC). */
  joinsUnpowered() {
    const out = [];
    this.elements.forEach((el, i) => { if (el.type === "relay") { this._relay(i, true); out.push([this.host.term(el.com), this.host.term(el.nc)]); } });
    return out;
  }
  _relay(i, off) {
    let m = this.motion.get(i);
    if (!m) { m = { closed: false, want: false, cancel: null }; this.motion.set(i, m); }
    if (off && (m.closed || m.want)) { m.cancel?.(); m.closed = m.want = false; }
    return m;
  }
  /** A level seen on one of this part's pins (from a solve or precisely from a firmware part's pin write): drives the steppers' step counters. */
  onLevel(pin, level, t) {
    this.lvl ??= new Map(); this.lvl.set(pin, level ? 1 : 0);
    this.elements.forEach((el, i) => {
      if (el.type === "stepper_step_dir" && pin === el.step) {
        const m = this.motion.get(i) ?? (this.motion.set(i, { pos: 0, lvl: 0, lastT: -1e12, stalled: false, adj: 0 }), this.motion.get(i));
        const prev = m.lvl; m.lvl = level ? 1 : 0;
        if (prev === 0 && m.lvl === 1) this._stepPulse(el, m, t ?? this.host.clock().now());
      }
    });
  }
  edge(pin, level, t) { this.onLevel(pin, level, t); }
  /** The pins whose levels onLevel wants (for precise edges). */
  watchPins() { return this.elements.filter((e) => e.type === "stepper_step_dir").flatMap((e) => [e.step, e.dir, e.en, e.ms1, e.ms2, e.ms3, e.rst, e.slp].filter(Boolean)); }
  _stepPulse(el, m, t) {
    const lv = (p) => (p ? (this.lvl?.has(p) ? this.lvl.get(p) : this.host.net(this.host.term(p)).level) : 0);
    const en = el.en ? lv(el.en) : 0, awake = (el.rst ? lv(el.rst) : 1) && (el.slp ? lv(el.slp) : 1);
    if (en || !awake) return;
    const div = lv(el.ms1) && lv(el.ms2) && lv(el.ms3) ? 16 : [1, 2, 4, 8][lv(el.ms1) + 2 * lv(el.ms2)];   // A4988: MS1 MS2 MS3 = 000 full, 100 half, 010 quarter, 110 eighth, 111 sixteenth
    const fullSteps = 1 / div, dt = Math.max(1, t - m.lastT) / 1e6, rate = fullSteps / dt;
    m.lastT = t; m.rate = rate;
    if (rate > (el.max_sps ?? 2000)) { m.stalled = true; this.host.changed(); return; }
    m.stalled = false;
    m.pos += (lv(el.dir) ? 1 : -1) * (16 / div);
    m.div = div; m.moved = true;
    this.host.changed();
  }
  /** UL2003 / 28BYJ-48: decode the four coil inputs into a position in half steps. */
  _uln(el, i) {
    const m = this.motion.get(i) ?? (this.motion.set(i, { pos: 0, phase: -1, lastT: -1e12, stalled: false }), this.motion.get(i));
    const lv = [el.in1, el.in2, el.in3, el.in4].map((p) => this.host.net(this.host.term(p)).level), code = lv[0] | (lv[1] << 1) | (lv[2] << 2) | (lv[3] << 3);
    const SEQ = [0b0001, 0b0011, 0b0010, 0b0110, 0b0100, 0b1100, 0b1000, 0b1001], ph = SEQ.indexOf(code);
    if (ph < 0) return m;
    if (m.phase < 0) { m.phase = ph; return m; }
    let d = ((ph - m.phase + 12) % 8) - 4; if (d === -4) d = 4;
    if (d === 0 || d === 4) return m;
    const t = this.host.clock().now(), dt = Math.max(1, t - m.lastT) / 1e6;
    if (dt > 20e-6 && Math.abs(d) / dt > (el.max_sps ?? 1000)) { m.stalled = true; m.phase = ph; m.lastT = t; return m; }
    if (dt > 20e-6) m.stalled = false;
    m.pos += d; m.phase = ph; m.lastT = t;
    return m;
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
      } else if (el.type === "half_bridge") {
        const vsn = this.host.net(T(el.vs)), vs = vsn.floating ? 0 : vsn.mv, inn = this.host.net(T(el.in)), en = el.en ? this.host.net(T(el.en)) : null;
        const drop = el.drop_mv ?? 1400, hi = Math.max(0, vs - drop);
        if (vs < 4000) continue;
        const ohms = el.ohms ?? 2;
        if (en && !en.level && !en.pwm) continue;                         // disabled: high impedance, the load coasts
        if (inn.pwm && inn.pwm.hz > 0) out.push({ term: T(el.out), mv: hi, ohms, kind: "out", pwm: { hz: inn.pwm.hz, duty: inn.pwm.duty } });
        else if (en && en.pwm && inn.level) out.push({ term: T(el.out), mv: hi, ohms, kind: "out", pwm: { hz: en.pwm.hz, duty: en.pwm.duty } });
        else if (en && en.pwm) out.push({ term: T(el.out), mv: 0, ohms, kind: "out" });
        else out.push({ term: T(el.out), mv: inn.level ? hi : 0, ohms, kind: "out" });
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
    this.elements.forEach((el, i) => {
      const id = "e" + i, r = this.br.get(id);
      if (el.type === "diode") {
        const cur = this.failed.has(i) ? 0 : Math.max(0, r?.cur ?? 0), max = el.max_ma ?? Infinity;
        if (el.max_ma && !this.failed.has(i) && this._trip("burn" + i, cur > max * 1.05, el.burn_ms ?? 60)) this.failed.set(i, { class: "burnt", text: "LED burnt out (too much current)" });
        const over = cur > max * 1.05 || this.failed.has(i);
        if (el.output) set(el.output, Math.round(clamp(cur / (el.full_ma ?? 10), 0, 1) * 1000) / 1000);
        if (el.current_output) set(el.current_output, Math.round(cur * 100) / 100);
        if (el.overcurrent_output) set(el.overcurrent_output, over);
        if (el.burnt_output) set(el.burnt_output, this.failed.has(i));
      } else if (el.type === "capacitor") {
        const v = this.capV.get(id) ?? 0;
        if (el.polarity && !this.failed.has(i)) {
          const rev = el.polarity.plus === el.a ? -v : v;
          if (this._trip("rev" + i, rev > (el.polarity.reverse_mv ?? 1000), 40)) this.failed.set(i, { class: "polarity", text: "electrolytic capacitor burst (connected backwards)" });
        }
        if (el.max_mv && !this.failed.has(i) && Math.abs(v) > el.max_mv) this.failed.set(i, { class: "overvoltage", text: `capacitor over its ${el.max_mv / 1000} V rating` });
        const vs = this.failed.has(i) ? 0 : Math.round((el.polarity && el.polarity.plus !== el.a ? -v : v)), reversed = !!el.polarity && vs < -(el.polarity.reverse_mv ?? 1000) / 2;
        if (el.voltage_output) set(el.voltage_output, vs);
        if (el.failed_output) set(el.failed_output, this.failed.has(i));
        if (el.reversed_output) set(el.reversed_output, reversed);
      } else if (el.type === "resistor") {
        if (el.current_output) set(el.current_output, Math.round((r?.cur ?? 0) * 100) / 100);
        if (el.overpower_output) set(el.overpower_output, !!(el.rated_mw && r && (r.cur * r.cur * this._ohms(el)) / 1000 > el.rated_mw));
      } else if (el.type === "cell") {
        if (el.current_output) set(el.current_output, Math.round(Math.abs(r?.cur ?? 0) * 10) / 10);
        if (el.overload_output) set(el.overload_output, !!(el.max_ma && Math.abs(r?.cur ?? 0) > el.max_ma) || this.host.net(this.host.term(el.pos)).id === this.host.net(this.host.term(el.neg)).id);
      } else if (el.type === "motor") {
        const v = r?.vd ?? 0, a = Math.abs(v), rated = el.rated_mv ?? 6000, start = el.start_mv ?? 500;
        const f = a <= start ? 0 : Math.min(1.2, (a - start) / (rated - start)), sp = Math.round(Math.sign(v) * f * 1000) / 1000;
        if (el.speed_output) set(el.speed_output, sp);
        if (el.rpm_output) set(el.rpm_output, Math.round(sp * (el.rpm ?? 200) * 10) / 10);
        if (el.current_output) set(el.current_output, Math.round(Math.abs(r?.cur ?? 0)));
      } else if (el.type === "half_bridge") {
        if (el.output) { const o = this.host.net(this.host.term(el.out)), vs = this.host.net(this.host.term(el.vs)); set(el.output, vs.mv > 0 && !o.floating ? Math.round(clamp(o.mv / vs.mv, 0, 1) * 1000) / 1000 : 0); }
      } else if (el.type === "stepper_unipolar") {
        const m = this._uln(el, i), n = el.steps_per_rev ?? 4096;
        if (el.position_output) set(el.position_output, m.pos);
        if (el.angle_output) set(el.angle_output, Math.round((((m.pos % n) + n) % n) / n * 3600) / 10);
        if (el.stalled_output) set(el.stalled_output, !!m.stalled);
      } else if (el.type === "stepper_step_dir") {
        const m = this.motion.get(i) ?? { pos: 0, stalled: false }, n = (el.steps_per_rev ?? 200) * 16;
        if (el.position_output) set(el.position_output, m.pos);
        if (el.angle_output) set(el.angle_output, Math.round((((m.pos % n) + n) % n) / n * 3600) / 10);
        if (el.stalled_output) set(el.stalled_output, !!m.stalled);
        if (el.microstep_output) set(el.microstep_output, m.div ?? 1);
      } else if (el.type === "relay") {
        const m = this._relay(i), inn = this.host.net(this.host.term(el.in)), act = typeof el.active === "object" ? truthy(evalExpr(el.active, f)) : el.active === "high";
        const want = !inn.floating && (act ? !!inn.level : !inn.level);
        if (want !== m.want) {
          m.want = want; m.cancel?.();
          const clock = this.host.clock();
          m.cancel = clock.schedule(clock.now() + (el.coil_ms ?? 8) * 1000, () => { m.closed = want; this.host.changed(); });
        }
        if (el.energized_output) set(el.energized_output, m.want);
        if (el.closed_output) set(el.closed_output, m.closed);
      }
    });
    if (this.failed.size !== (this._nf ?? 0)) { this._nf = this.failed.size; this.host.changed(); }
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
