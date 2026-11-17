// SPDX-License-Identifier: GPL-3.0-or-later
// The bench model (docs/component-api.md 5, 9.2): parts, terminals, wires, nets, hazards, buses, virtual time. Framework-free JS, no DOM, runs in
// Node and in the browser's page thread. The page owns one `Bench`; it renders `bench.state()` and calls the mutators below.
//
//   const bench = new Bench();                 // realtime clock; new Bench({clock: new BenchClock({mode: "stepped"})}) for tests
//   bench.attach(system);                      // a DotbenchSystem or DotbenchDevice: serves J3 over the exp area's link, across restarts
//   const def = await bench.loadPart(bytes);   // a .dotpart; def.ok false lists def.errors; registers it by manifest id
//   const p = bench.addPart("org.dotbench.led", {pos: {x, y, rot}, fields: {...}});   // -> instance id "p1"
//   const w = bench.connect("device.EXP4", p + ".A");   bench.disconnect(w);
//   bench.setField(p, "pressed", true);       bench.state();      // live pins, outputs, visuals, hazards (see state())
//   const layout = bench.serialise();         await bench.restore(layout);   // the .dotlayout of 9.2
//   bench.on("change", cb) / "output" / "edge" / "warning" / "link" / "part"
//
// Terminals are "<instance>.<pin>"; the device is the instance "device": EXP1..EXP14, V33, V5, GND (DEVICE_TERMINALS has the J3 pin numbers).
import { BenchClock } from "./bench-clock.js";
import { computeNets, solveSources, digital, conflicts } from "./bench-solver.js";
import { readDotpart, describeDotpart } from "./dotpart.js";
import { DeclarativePart, evalExpr } from "./bench-declarative.js";

export const DEVICE = "device", VDD_DEVICE = 3300, V5_MV = 5000, DEVICE_SERIES_OHMS = 68, DEVICE_PULL_OHMS = 45000, GND_OHMS = 0.01;
export const BUDGET_MA = { V5: 500, V33: 300 };
/** The J3 header as the page draws it: terminal, physical pin (1..20), kind. */
export const DEVICE_TERMINALS = [
  ...[3, 4, 5, 6, 7, 8, 9].map((p, i) => ({ term: `device.EXP${i + 1}`, name: `EXP${i + 1}`, pin: p, kind: "io" })),
  ...[12, 13, 14, 15, 16, 17, 18].map((p, i) => ({ term: `device.EXP${i + 8}`, name: `EXP${i + 8}`, pin: p, kind: "io" })),
  { term: "device.V5", name: "V5", pin: 1, alt: 20, kind: "power_out" }, { term: "device.V33", name: "V33", pin: 2, alt: 19, kind: "power_out" },
  { term: "device.GND", name: "GND", pin: 10, alt: 11, kind: "ground" },
];
const POS = 14;
const R = { OK: 0, NACK_ADDR: 1, NACK_DATA: 2, STUCK: 3, TIMEOUT: 4, REFUSED: 5 };
const K = { I2C_OPEN: 1, I2C_CLOSE: 2, I2C_XFER: 3, I2C_PROBE: 4, SPI_OPEN: 5, SPI_CLOSE: 6, SPI_XFER: 7, UART_OPEN: 8, UART_CLOSE: 9, UART_WRITE: 10 };
const posTerm = (p) => `${DEVICE}.EXP${p + 1}`;
const mvTxt = (mv) => (mv / 1000).toFixed(1) + " V";
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Bench {
  /** @param {{clock?: BenchClock, wasm?: (part, host) => object}} [o] wasm: factory of the part runtime (default: ./bench-wasm.js, loaded on first use) */
  constructor(o = {}) {
    this.clock = o.clock ?? new BenchClock();
    this._wasmFactory = o.wasm ?? null;
    this.defs = new Map();            // manifest id -> def (readDotpart result)
    this.parts = new Map();           // instance -> part
    this.wires = new Map();           // wire id -> {id, from, to, color}
    this.version = 0;
    this.link = null;
    this.rails = { V33: false, V5: false };
    this.devicePins = Array.from({ length: POS }, () => ({ mode: "z", pull: "none", level: 0, hz: 0, duty: 0 }));
    this.masters = { i2c: null, spi: null, uart: null };
    this.events = [];                 // last bus warnings and diagnostics
    this.hazards = [];
    this._seq = 0; this._wseq = 0;
    this._on = new Map();
    this._net = new Map();            // term -> net info of the last solve
    this._lvl = new Map();            // term -> last digital level (hysteresis)
    this._power = new Map();          // instance -> bool
    this._prevMv = new Map();
    this._lastIn = "";
    this._flushing = false; this._again = false; this._pending = false;
    this._offs = [];
    this.clock._stepper = null;
    this._solve();
  }

  // ---------------------------------------------------------------- events
  on(type, cb) { if (!this._on.has(type)) this._on.set(type, new Set()); this._on.get(type).add(cb); return () => this._on.get(type)?.delete(cb); }
  _emit(type, data) { for (const cb of this._on.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } } }
  _warn(cls, text, extra = {}) {
    const key = cls + "|" + text;
    const last = this.events[this.events.length - 1];
    if (last && last.key === key) { last.count++; return; }
    const ev = { t: this.clock.now(), class: cls, text, key, count: 1, ...extra };
    this.events.push(ev); if (this.events.length > 50) this.events.shift();
    this._emit("warning", ev);
  }

  // ---------------------------------------------------------------- parts library
  /** Read, validate and register a .dotpart. Returns the def ({ok, errors, warnings, manifest, ...}); a def with errors is not registered. */
  async loadPart(bytes) {
    const def = await readDotpart(bytes);
    if (def.ok) this.registerPart(def);
    return def;
  }
  registerPart(def) { this.defs.set(def.manifest.id, def); this._emit("part", { type: "library", id: def.manifest.id }); return def.manifest.id; }
  /** What the import dialog shows. */
  describe(idOrDef) { return describeDotpart(typeof idOrDef === "string" ? this._def(idOrDef) : idOrDef); }
  library() { return [...this.defs.values()].map((d) => ({ id: d.manifest.id, version: d.manifest.version, name: d.manifest.name, category: d.manifest.category, kind: d.manifest.behaviour.type })); }
  _def(id) { const d = this.defs.get(id); if (!d) throw new Error(`unknown part ${id}: load its .dotpart first`); return d; }

  // ---------------------------------------------------------------- parts
  addPart(defId, o = {}) {
    const def = this._def(defId), m = def.manifest;
    let instance = o.instance;
    if (instance !== undefined) { if (!/^[a-z][a-z0-9_]{0,15}$/.test(instance) || instance === DEVICE || this.parts.has(instance)) throw new Error(`bad or taken instance id ${instance}`); }
    else do { instance = "p" + ++this._seq; } while (this.parts.has(instance));
    const n = /^p(\d+)$/.exec(instance); if (n) this._seq = Math.max(this._seq, +n[1]);
    const fields = {};
    for (const f of m.fields ?? []) fields[f.name] = f.default;
    for (const [k, v] of Object.entries(o.fields ?? {})) if (k in fields) fields[k] = this._coerce(m.fields.find((f) => f.name === k), v);
    const part = { instance, id: m.id, def, label: o.label ?? instance, pos: { x: 0, y: 0, rot: 0, ...(o.pos ?? {}) }, fields, outputs: {}, impl: null, starting: null,
      pins: new Map(m.pins.map((p) => [p.name, p])) };
    for (const out of m.outputs ?? []) part.outputs[out.name] = out.type === "boolean" ? false : 0;
    this.parts.set(instance, part);
    if (m.behaviour.type === "declarative") part.impl = new DeclarativePart(part, this._host(part));
    this._touch(); this._emit("part", { type: "added", instance });
    return instance;
  }
  removePart(instance) {
    const part = this.parts.get(instance); if (!part) return false;
    for (const w of [...this.wires.values()]) if (w.from.startsWith(instance + ".") || w.to.startsWith(instance + ".")) this.wires.delete(w.id);
    try { part.impl?.dispose?.(); } catch (e) { console.error(e); }
    this.parts.delete(instance); this._power.delete(instance);
    for (const t of [...this._lvl.keys()]) if (t.startsWith(instance + ".")) this._lvl.delete(t);
    this._touch(); this._emit("part", { type: "removed", instance });
    return true;
  }
  movePart(instance, pos, label) { const p = this._part(instance); if (pos) p.pos = { ...p.pos, ...pos }; if (label !== undefined) p.label = label; this.version++; this._emit("change", { version: this.version }); }
  _part(i) { const p = this.parts.get(i); if (!p) throw new Error(`no part ${i}`); return p; }
  _coerce(f, v) {
    if (!f) throw new Error("unknown field");
    if (f.type === "boolean") return !!v;
    if (f.type === "enum") { if (!f.values.some((x) => x.value === v)) throw new Error(`field ${f.name}: ${v} is not one of its values`); return v; }
    if (f.type === "number" || f.type === "integer") { let x = Number(v); if (!Number.isFinite(x)) throw new Error(`field ${f.name}: not a number`); if (f.min !== undefined) x = Math.max(f.min, x); if (f.max !== undefined) x = Math.min(f.max, x); return f.type === "integer" ? Math.round(x) : x; }
    return String(v).slice(0, f.maxLength ?? 64);
  }
  /** Set a field (what the property panel and a control do). */
  setField(instance, name, value) {
    const part = this._part(instance), f = (part.def.manifest.fields ?? []).find((x) => x.name === name);
    if (!f) throw new Error(`${instance} has no field ${name}`);
    const v = this._coerce(f, value);
    if (part.fields[name] === v) return v;
    part.fields[name] = v;
    part.impl?.onField?.(name, v);
    this._touch(); this._emit("part", { type: "field", instance, name, value: v });
    return v;
  }
  /** Momentary control: the field goes true, then false after `ms` of virtual time. */
  press(instance, name, ms = 150) { this.setField(instance, name, true); return new Promise((res) => this.clock.after(ms * 1000, () => { this.setField(instance, name, false); res(); })); }

  // ---------------------------------------------------------------- wires
  /** All terminals that exist: [{term, owner, pin, kind}]. */
  terminals() {
    const out = DEVICE_TERMINALS.map((t) => ({ term: t.term, owner: DEVICE, pin: t.name, kind: t.kind, header: t.pin }));
    for (const p of this.parts.values()) for (const pin of p.def.manifest.pins) if (pin.kind !== "nc") out.push({ term: `${p.instance}.${pin.name}`, owner: p.instance, pin: pin.name, kind: pin.kind });
    return out;
  }
  _has(term) { const [o, ...r] = term.split("."), pin = r.join("."); if (o === DEVICE) return DEVICE_TERMINALS.some((t) => t.name === pin); const p = this.parts.get(o); return !!p && p.pins.has(pin) && p.pins.get(pin).kind !== "nc"; }
  connect(a, b, o = {}) {
    for (const t of [a, b]) if (!this._has(t)) throw new Error(`no such terminal ${t}`);
    if (a === b) throw new Error("a wire needs two different terminals");
    for (const w of this.wires.values()) if ((w.from === a && w.to === b) || (w.from === b && w.to === a)) return w.id;
    let id = o.id; if (!id) do { id = "w" + ++this._wseq; } while (this.wires.has(id));
    const n = /^w(\d+)$/.exec(id); if (n) this._wseq = Math.max(this._wseq, +n[1]);
    this.wires.set(id, { id, from: a, to: b, color: o.color });
    this._touch(); return id;
  }
  disconnect(id) { if (!this.wires.delete(id)) return false; this._touch(); return true; }
  wireOf(a, b) { for (const w of this.wires.values()) if ((w.from === a && w.to === b) || (w.from === b && w.to === a)) return w.id; return null; }

  // ---------------------------------------------------------------- host handed to a part runtime
  _host(part) {
    const bench = this;
    return {
      bench, instance: part.instance, fields: part.fields, manifest: part.def.manifest,
      clock: () => bench.clock,
      term: (pin) => `${part.instance}.${pin}`,
      net: (term) => bench._netInfo(term),
      setOutput(name, v) { if (part.outputs[name] === v) return; part.outputs[name] = v; bench._emit("output", { instance: part.instance, name, value: v, t: bench.clock.now() }); },
      changed() { bench._touch(); },
      log(level, text) { bench._emit("log", { instance: part.instance, level, text, t: bench.clock.now() }); },
      warn(cls, text) { bench._warn(cls, `${part.instance}: ${text}`, { instance: part.instance }); },
      bench_i2c: (m, addr, w, rlen) => bench.i2cXfer(m, addr, w, rlen),
    };
  }
  _netInfo(term) { return this._net.get(term) ?? { mv: 0, mvHigh: 0, mvLow: 0, rth: Infinity, floating: true, level: 0, pwm: null, id: -1 }; }
  /** Live net data of a terminal (for the page and tests). */
  net(term) { this._flush(); return this._netInfo(term); }
  /** The id of a terminal's net (same id, same net), -1 when unknown. */
  netId(term) { this._flush(); return this._net.get(term)?.id ?? -1; }

  // ---------------------------------------------------------------- solving
  _touch() { this._dirty = true; this._flush(); }
  _flush() {
    if (this._flushing) { this._again = true; return; }
    this._flushing = true;
    try { do { this._again = false; if (this._dirty) { this._dirty = false; this._solve(); } } while (this._again || this._dirty); }
    finally { this._flushing = false; }
  }
  _supplyPin(m) { return m.pins.find((p) => p.kind === "power_in"); }
  _partMv(part, info) { const sp = this._supplyPin(part.def.manifest); if (!sp) return VDD_DEVICE; const n = info(`${part.instance}.${sp.name}`); return n.floating ? 0 : n.mv; }
  /** One pass: nets from wires and closed contacts, sources, solve. */
  _pass(power, prevMv) {
    const terms = DEVICE_TERMINALS.map((t) => t.term), pairs = [];
    for (const p of this.parts.values()) for (const pin of p.def.manifest.pins) if (pin.kind !== "nc") terms.push(`${p.instance}.${pin.name}`);
    for (const w of this.wires.values()) pairs.push([w.from, w.to]);
    for (const p of this.parts.values()) if (power.get(p.instance) && p.impl?.joins) for (const j of p.impl.joins()) pairs.push(j);
    const { netOf, nets } = computeNets(terms, pairs);
    const srcs = nets.map(() => []);
    const add = (s) => { const i = netOf.get(s.term); if (i !== undefined) srcs[i].push(s); };
    // device
    this.devicePins.forEach((d, i) => {
      const term = posTerm(i), series = DEVICE_SERIES_OHMS + 50;
      if (d.mode === "out") add({ term, mv: d.level ? VDD_DEVICE : 0, ohms: series, kind: "out" });
      else if (d.mode === "pwm") add({ term, mv: VDD_DEVICE, ohms: series, kind: "out", pwm: { hz: d.hz, duty: d.duty / 65536 } });
      else if (d.mode === "in" || d.mode === "z") { if (d.pull === "up") add({ term, mv: VDD_DEVICE, ohms: DEVICE_PULL_OHMS, kind: "pull" }); else if (d.pull === "down") add({ term, mv: 0, ohms: DEVICE_PULL_OHMS, kind: "pull" }); }
    });
    if (this.rails.V33) add({ term: "device.V33", mv: 3300, ohms: 1, kind: "rail" });
    if (this.rails.V5) add({ term: "device.V5", mv: V5_MV, ohms: 1, kind: "rail" });
    add({ term: "device.GND", mv: 0, ohms: GND_OHMS, kind: "rail" });
    // parts
    for (const p of this.parts.values()) {
      const m = p.def.manifest, on = power.get(p.instance);
      const vOf = (t) => prevMv.get(t) ?? 0;
      const sp = this._supplyPin(m), vhigh = sp ? vOf(`${p.instance}.${sp.name}`) || 0 : VDD_DEVICE;
      for (const pin of m.pins) {
        const term = `${p.instance}.${pin.name}`;
        if (pin.kind === "ground") add({ term, mv: 0, ohms: GND_OHMS, kind: "rail" });
        const rail = pin.pull_rail ?? sp?.name, rv = rail ? vOf(`${p.instance}.${rail}`) : VDD_DEVICE;
        if (pin.pullup_ohms && rv > 0) add({ term, mv: rv, ohms: pin.pullup_ohms, kind: "pull" });
        if (pin.pulldown_ohms) add({ term, mv: 0, ohms: pin.pulldown_ohms, kind: "pull" });
      }
      if (on && p.impl?.sources) for (const s of p.impl.sources(vhigh)) add(s);
    }
    // solve
    const info = nets.map((members, id) => {
      const list = srcs[id], pw = list.filter((s) => s.pwm && s.pwm.hz > 0);
      let r = solveSources(list), mvHigh = r.mv, mvLow = r.mv, pwm = null;
      if (pw.length) {
        pwm = { hz: pw[0].pwm.hz, duty: clamp(pw[0].pwm.duty, 0, 1) };
        mvLow = solveSources(list.map((s) => (s.pwm ? { ...s, mv: 0 } : s))).mv;
        r = { ...r, mv: pwm.duty * mvHigh + (1 - pwm.duty) * mvLow };
      }
      return { id, members, srcs: list, mv: r.mv, rth: r.rth, floating: r.floating, strong: r.strong, mvHigh, mvLow, pwm };
    });
    return { netOf, nets, info };
  }
  _powerOf(netOf, info) {
    const gnd = netOf.get("device.GND"), out = new Map(), why = new Map();
    for (const p of this.parts.values()) {
      const m = p.def.manifest, supplies = m.pins.filter((x) => x.kind === "power_in"), grounds = m.pins.filter((x) => x.kind === "ground");
      if (!supplies.length && !grounds.length) { out.set(p.instance, true); continue; }
      let on = true, reason = null;
      if (grounds.length && !grounds.some((g) => netOf.get(`${p.instance}.${g.name}`) === gnd)) { on = false; reason = "ground is not wired to GND"; }
      if (on) for (const s of supplies) {
        const n = info[netOf.get(`${p.instance}.${s.name}`)], mv = n.floating ? 0 : n.mv, lo = Math.max(s.min_mv ?? 0, 1);
        if (mv < lo) { on = false; reason = `${s.name} is ${mvTxt(mv)}, needs ${mvTxt(lo)}`; break; }
        if (s.max_mv !== undefined && mv > s.max_mv) { on = false; reason = `supply too high: ${s.name} is ${mvTxt(mv)}, limit ${mvTxt(s.max_mv)}`; break; }
      }
      out.set(p.instance, on); why.set(p.instance, reason);
    }
    return { power: out, why };
  }
  _solve() {
    let power = new Map(this._power);
    for (const p of this.parts.values()) if (!power.has(p.instance)) power.set(p.instance, false);
    let res = null, why = new Map(), prev = this._prevMv;
    for (let pass = 0; pass < 4; pass++) {
      res = this._pass(power, prev);
      this._net.clear();
      for (const [t, i] of res.netOf) this._net.set(t, { ...res.info[i], level: this._lvl.get(t) ?? 0 });
      const mv = new Map();
      for (const [t, i] of res.netOf) mv.set(t, res.info[i].floating ? 0 : res.info[i].mv);
      const pw = this._powerOf(res.netOf, res.info);
      why = pw.why;
      let changed = false;
      for (const [k, v] of pw.power) if (power.get(k) !== v) changed = true;
      for (const [t, v] of mv) if (Math.abs((prev.get(t) ?? 0) - v) > 1) changed = true;
      power = pw.power; prev = mv;
      if (!changed) break;
    }
    // commit nets
    this._net.clear();
    const { netOf, info } = res;
    const owner = (t) => t.split(".")[0];
    const now = this.clock.now();
    const edges = [];
    for (const [t, i] of netOf) {
      const n = info[i], o = owner(t);
      let vdd = VDD_DEVICE;
      if (o !== DEVICE) { const part = this.parts.get(o); vdd = this._partMv(part, (x) => { const k = netOf.get(x); return k === undefined ? { mv: 0, floating: true } : info[k]; }) || VDD_DEVICE; }
      let mvNow = n.mv;
      if (n.pwm) mvNow = ((now * n.pwm.hz) % 1e6) / 1e6 < n.pwm.duty ? n.mvHigh : n.mvLow;
      const was = this._lvl.get(t) ?? 0, level = n.floating ? 0 : digital(mvNow, vdd, was);
      this._lvl.set(t, level);
      if (level !== was) edges.push({ term: t, level });
      this._net.set(t, { ...n, level, vdd, term: t });
    }
    this._prevMv = prev;
    // part power transitions, then outputs
    const trans = [];
    for (const p of this.parts.values()) { const on = !!power.get(p.instance); if (on !== !!this._power.get(p.instance)) trans.push([p, on]); p.powerWhy = why.get(p.instance) ?? null; }
    this._power = power;
    for (const [p, on] of trans) this._applyPower(p, on);
    this._hazards(res);
    for (const p of this.parts.values()) if (power.get(p.instance)) { try { p.impl?.evaluate?.(); } catch (e) { console.error(e); } }
    for (const e of edges) {
      this._emit("edge", { ...e, t: now });
      const o = owner(e.term), part = this.parts.get(o);
      if (part && power.get(o)) part.impl?.edge?.(e.term.slice(o.length + 1), e.level, now);
    }
    for (const p of this.parts.values()) if (power.get(p.instance)) p.impl?.netsChanged?.();
    this._writeInputs();
    this.version++;
    this._emit("change", { version: this.version });
  }
  _applyPower(part, on) {
    if (part.def.manifest.behaviour.type === "wasm") {
      if (on) this._startWasm(part); else { try { part.impl?.dispose?.(); } catch (e) { console.error(e); } part.impl = null; part.starting = null; for (const k of Object.keys(part.outputs)) part.outputs[k] = typeof part.outputs[k] === "boolean" ? false : 0; }
    } else if (!on) { for (const k of Object.keys(part.outputs)) part.outputs[k] = typeof part.outputs[k] === "boolean" ? false : 0; part.impl?.last?.clear?.(); }
    this._emit("part", { type: "power", instance: part.instance, on });
  }
  async _startWasm(part) {
    if (part.starting) return;
    const token = part.starting = Symbol();
    try {
      let factory = this._wasmFactory;
      if (!factory) { const mod = await import("./bench-wasm.js"); factory = (p, h) => new mod.WasmPart(p, h); this._wasmFactory = factory; }
      if (part.starting !== token || !this._power.get(part.instance)) return;
      const impl = factory(part, this._host(part));
      part.impl = impl;
      await impl.start();
      if (part.starting !== token || !this._power.get(part.instance)) { impl.dispose(); if (part.impl === impl) part.impl = null; return; }
      this._touch();
    } catch (e) { this._warn("part", `${part.instance} failed to start: ${e.message}`, { instance: part.instance }); if (part.starting === token) { part.starting = null; part.impl = null; } }
  }

  // ---------------------------------------------------------------- hazards
  _hazards(res) {
    const { netOf, info } = res, out = [];
    const termsOf = (n) => n.members;
    for (const n of info) {
      if (n.members.length < 1) continue;
      for (const c of conflicts(n.srcs)) out.push({ ...c, net: n.id, text: c.class === "short" ? `short: ${c.detail}` : `contention: ${c.detail}: ${c.terms.join(", ")}` });
      const pw = n.srcs.filter((s) => s.pwm);
      if (pw.length > 1 && pw.some((s) => s.pwm.hz !== pw[0].pwm.hz || Math.abs(s.pwm.duty - pw[0].pwm.duty) > 1 / 1024)) out.push({ class: "short", terms: pw.map((s) => s.term), net: n.id, text: "short: two PWM outputs with different settings on one net" });
      for (const t of termsOf(n)) {
        const [o, ...r] = t.split("."), pin = r.join("."); if (o === DEVICE) continue;
        const p = this.parts.get(o)?.pins.get(pin); if (!p || p.kind === "ground" || p.kind === "power_in" || p.kind === "nc") continue;
        const lim = p.abs_max_mv ?? 3600, v = n.pwm ? n.mvHigh : n.mv;
        if (!n.floating && v > lim) out.push({ class: "overvoltage", terms: [t], net: n.id, text: `${mvTxt(v)} on a ${mvTxt(lim)} pin: ${t}` });
      }
    }
    for (const p of this.parts.values()) if (!this._power.get(p.instance) && p.powerWhy?.startsWith("supply too high")) out.push({ class: "overvoltage", terms: [p.instance], net: -1, text: `${p.instance}: ${p.powerWhy}` });
    const budget = { V5: 0, V33: 0 };
    for (const p of this.parts.values()) {
      if (!this._power.get(p.instance)) continue;
      const m = p.def.manifest, sp = this._supplyPin(m); if (!sp?.typ_ma) continue;
      const k = netOf.get(`${p.instance}.${sp.name}`);
      for (const rail of ["V5", "V33"]) if (k === netOf.get(`device.${rail}`)) budget[rail] += sp.typ_ma;
    }
    for (const rail of ["V5", "V33"]) if (budget[rail] > BUDGET_MA[rail]) out.push({ class: "budget", terms: [`device.${rail}`], net: -1, text: `${rail} load is ${budget[rail]} mA, the rail gives about ${BUDGET_MA[rail]} mA` });
    const key = (h) => h.class + "|" + h.terms.join(",");
    const before = new Set(this.hazards.map(key));
    this.hazards = out;
    for (const h of out) if (!before.has(key(h))) this._emit("hazard", h);
  }

  // ---------------------------------------------------------------- device endpoint (J3 over the exp link)
  /** Serve a DotbenchSystem or DotbenchDevice. Re-attaches at every boot of the firmware; the bench itself (parts, wires, fields) is untouched by restarts. */
  attach(target) {
    this.detach();
    const dev = target.device ?? target;
    this._target = target;
    this._offs.push(target.on("area:exp:link", (link) => this._onLink(link)));
    this._offs.push(target.on("area:radio:c5-gpio", (e) => { if (e && e.io === 5) { this.rails.V33 = !!e.level; this._touch(); } }));
    const cur = dev.area?.("exp");
    if (cur) this._onLink(cur);
    return this;
  }
  detach() { for (const o of this._offs.splice(0)) try { o(); } catch {} this._unlink(); this._target = null; }
  _unlink() {
    if (this._offBell) { this._offBell(); this._offBell = null; }
    if (this.link) { try { this.link.detach(); } catch {} }
    this.link = null;
  }
  _onLink(link) {
    this._unlink();
    this.masters = { i2c: null, spi: null, uart: null };
    this.rails = { V33: false, V5: false };
    this.devicePins = Array.from({ length: POS }, () => ({ mode: "z", pull: "none", level: 0, hz: 0, duty: 0 }));
    this._lastIn = "";
    this.link = link || null;
    if (link) {
      link.attach();
      this._offBell = link.onDoorbell(() => this.service());
    }
    this._emit("link", { attached: !!link });
    this._touch();
    if (link) this.service();
  }
  /** Drain the firmware's requests and pin changes. Called by the doorbell; tests may call it too. */
  service() {
    const link = this.link; if (!link) return;
    if (this._servicing) { this._serviceAgain = true; return; }
    this._servicing = true;
    try {
      do {
        this._serviceAgain = false;
        this.devicePins = link.readPins();
        const v5 = link.v5Boost(); if (v5 !== this.rails.V5) this.rails.V5 = v5;
        this._touch();
        let req;
        while ((req = link.takeRequest())) this._request(req);
      } while (this._serviceAgain);
    } finally { this._servicing = false; }
  }
  _writeInputs() {
    if (!this.link) return;
    const levels = [], mvs = [];
    for (let i = 0; i < POS; i++) { const n = this._netInfo(posTerm(i)); levels.push(n.level); mvs.push(n.floating ? 0 : n.mv); }
    const key = levels.join("") + "|" + mvs.map((x) => Math.round(x)).join(",");
    if (key === this._lastIn) return;
    this._lastIn = key;
    this.link.writeInputs(levels, mvs);
  }
  _request(req) {
    let r;
    try { r = this._route(req); } catch (e) { console.error(e); r = { result: R.REFUSED }; }
    const done = (x) => { try { this.link?.reply(req, x.result, x.r); } catch (e) { console.error(e); } };
    if (r && typeof r.then === "function") r.then(done, (e) => { console.error(e); done({ result: R.TIMEOUT }); }); else done(r);
  }
  _route(req) {
    const p = req.p;
    switch (req.kind) {
      case K.I2C_OPEN: this.masters.i2c = { sda: posTerm(p[0]), scl: posTerm(p[1]), hz: p[2] }; return { result: R.OK };
      case K.I2C_CLOSE: this.masters.i2c = null; return { result: R.OK };
      case K.I2C_PROBE: return this.i2cXfer(this.masters.i2c, p[0], new Uint8Array(0), 0);
      case K.I2C_XFER: return this.i2cXfer(this.masters.i2c, p[0], req.w, req.rlen);
      case K.SPI_OPEN: this.masters.spi = { sck: posTerm(p[0]), mosi: posTerm(p[1]), miso: posTerm(p[2]), cs: posTerm(p[3]), hz: p[4], mode: p[5] }; return { result: R.OK };
      case K.SPI_CLOSE: this.masters.spi = null; return { result: R.OK };
      case K.SPI_XFER: return this.spiXfer(this.masters.spi, req.w);
      case K.UART_OPEN: this.masters.uart = { tx: posTerm(p[0]), rx: posTerm(p[1]), baud: p[2] }; return { result: R.OK };
      case K.UART_CLOSE: this.masters.uart = null; return { result: R.OK };
      case K.UART_WRITE: { const u = this.masters.uart; if (u) this.uartSend(u.tx, req.w, u.baud, DEVICE); return { result: R.OK }; }
      default: return { result: R.REFUSED };
    }
  }

  // ---------------------------------------------------------------- buses (5.5), usable by the device and by a part acting as master
  _powered(p) { return !!this._power.get(p.instance); }
  /** @returns {Promise<{result:number, r?:Uint8Array}> | {result:number, r?:Uint8Array}} */
  i2cXfer(master, addr, w, rlen) {
    if (!master) return { result: R.REFUSED };
    const ns = this._netInfo(master.sda), nc = this._netInfo(master.scl);
    const held = (n) => !n.floating && n.level === 0 && n.strong.some((s) => s.mv < 800 && s.kind !== "pull");
    if (ns.floating || nc.floating || held(ns) || held(nc)) { this._warn("i2c", `I2C bus is stuck: ${ns.floating || nc.floating ? "no pull-up on SDA or SCL" : "SDA or SCL is held low"}`); return { result: R.STUCK }; }
    const cands = [];
    let crossed = null;
    for (const p of this.parts.values()) {
      if (!this._powered(p) || !p.impl?.i2cSlaves) continue;
      for (const s of p.impl.i2cSlaves()) {
        const a = this._netInfo(s.sda).id, b = this._netInfo(s.scl).id;
        if (a === ns.id && b === nc.id) { if (s.addr === addr) cands.push({ p, s }); }
        else if (a === nc.id && b === ns.id && s.addr === addr) crossed = p;
      }
    }
    if (!cands.length) {
      if (crossed) this._warn("i2c", `SDA and SCL look swapped on ${crossed.instance}`, { instance: crossed.instance });
      return { result: R.NACK_ADDR };
    }
    if (cands.length > 1) for (const c of cands) this._warn("i2c", `address collision at 0x${addr.toString(16)}: ${cands.map((x) => x.p.instance).join(", ")}`, { instance: c.p.instance });
    for (const c of cands) if (master.hz > (c.s.hzMax ?? 400000)) this._warn("i2c", `${c.p.instance} supports up to ${(c.s.hzMax ?? 400000) / 1000} kHz, bus runs at ${master.hz / 1000} kHz`, { instance: c.p.instance });
    const calls = cands.map((c) => { try { return c.s.handle(w, rlen); } catch (e) { console.error(e); return { ack: false }; } });
    const fin = (rs) => {
      if (!rs.some((x) => x && x.ack)) return { result: R.NACK_ADDR };
      const out = new Uint8Array(rlen).fill(0xff);
      for (const x of rs) if (x && x.ack) for (let i = 0; i < rlen; i++) out[i] &= x.r?.[i] ?? 0xff;
      return { result: R.OK, r: out };
    };
    if (calls.every((x) => !x || typeof x.then !== "function")) return fin(calls);
    return Promise.all(calls.map((x) => Promise.race([Promise.resolve(x), new Promise((res) => setTimeout(() => res(null), 100))]))).then((rs) => {
      if (rs.every((x) => x === null)) return { result: R.TIMEOUT };
      return fin(rs);
    });
  }
  spiXfer(master, w) {
    if (!master) return { result: R.REFUSED };
    const n = (t) => this._netInfo(t).id;
    const sel = [];
    for (const p of this.parts.values()) {
      if (!this._powered(p) || !p.impl?.spiSlaves) continue;
      for (const s of p.impl.spiSlaves()) {
        if (n(s.sck) !== n(master.sck) || n(s.mosi) !== n(master.mosi) || n(s.miso) !== n(master.miso)) continue;
        if (s.cs && n(s.cs) !== n(master.cs)) continue;
        sel.push({ p, s });
      }
    }
    if (!sel.length) {
      const miso = this._netInfo(master.miso), pulled = miso.srcs.some((s) => s.kind === "pull" && s.mv > VDD_DEVICE / 2);
      return { result: R.OK, r: new Uint8Array(w.length).fill(pulled ? 0xff : 0) };
    }
    const calls = sel.map(({ p, s }) => {
      const okMode = !s.modes || s.modes.includes(master.mode), okHz = !s.hzMax || master.hz <= s.hzMax;
      if (!okMode) this._warn("spi", `${p.instance} needs mode ${s.modes.join("/")}, bus is mode ${master.mode}`, { instance: p.instance });
      if (!okHz) this._warn("spi", `${p.instance} supports up to ${s.hzMax} Hz, bus runs at ${master.hz} Hz`, { instance: p.instance });
      const r = s.handle(w, master.mode, master.hz);
      return okMode && okHz ? r : (r && r.then ? r.then(() => ({ r: new Uint8Array(w.length) })) : { r: new Uint8Array(w.length) });
    });
    if (sel.length > 1) this._warn("spi", `two slaves answer on one SPI bus: ${sel.map((x) => x.p.instance).join(", ")}`);
    const fin = (rs) => { const out = new Uint8Array(w.length).fill(0xff); for (const x of rs) for (let i = 0; i < w.length; i++) out[i] &= x?.r?.[i] ?? 0xff; return { result: R.OK, r: out }; };
    if (calls.every((x) => !x || typeof x.then !== "function")) return fin(calls);
    return Promise.all(calls).then(fin);
  }
  /** A UART transmitter (device or part) puts bytes on its tx terminal; every receiver whose rx is on the same net gets them. */
  uartSend(txTerm, bytes, baud, from) {
    const tx = this._netInfo(txTerm).id; let delivered = 0;
    const rxs = [];
    if (from !== DEVICE && this.masters.uart) rxs.push({ who: DEVICE, rx: this.masters.uart.rx, baud: this.masters.uart.baud, push: (b) => this.link?.rxPush(b) });
    for (const p of this.parts.values()) { if (p.instance === from || !this._powered(p) || !p.impl?.uartPorts) continue; for (const u of p.impl.uartPorts()) rxs.push({ who: p.instance, rx: u.rx, baud: u.baud, push: (b) => u.push(b) }); }
    for (const r of rxs) {
      if (!r.rx || this._netInfo(r.rx).id !== tx) continue;
      if (Math.abs(r.baud - baud) > 0.03 * baud) { this._warn("uart", `${from} sends at ${baud} baud, ${r.who} listens at ${r.baud}: bytes dropped`); continue; }
      r.push(bytes); delivered++;
    }
    return delivered;
  }

  // ---------------------------------------------------------------- time
  /** Stepped clock: advance virtual time by `us` (fires timers, such as contact bounce, in order). */
  async advance(us) { await this.clock.advance(us); this._flush(); }

  // ---------------------------------------------------------------- state for the page
  /**
   * {version, t, rails, attached, device: {pins: [14 x {mode,pull,level,hz,duty, mv}]},
   *  parts: [{instance, id, label, pos, fields, outputs, visuals:{id: number}, power:{on, reason}, kind, pins:{name: {mv, level, floating, pwm}}}],
   *  wires: [{id, from, to, color, short}], hazards: [{class, terms, text}], events: [...bus warnings]}
   */
  state() {
    this._flush();
    const pinState = (t) => { const n = this._netInfo(t); return { mv: Math.round(n.floating ? 0 : n.mv), level: n.level, floating: n.floating, pwm: n.pwm ? { hz: n.pwm.hz, duty: n.pwm.duty } : null, net: n.id }; };
    const bad = new Set(this.hazards.filter((h) => h.class === "short").flatMap((h) => h.net >= 0 ? [h.net] : []));
    return {
      version: this.version, t: this.clock.now(), rails: { ...this.rails }, attached: !!this.link,
      device: { pins: this.devicePins.map((d, i) => ({ ...d, term: posTerm(i), ...pinState(posTerm(i)) })) },
      parts: [...this.parts.values()].map((p) => ({
        instance: p.instance, id: p.id, label: p.label, pos: { ...p.pos }, fields: { ...p.fields }, outputs: { ...p.outputs }, kind: p.def.manifest.behaviour.type,
        power: { on: !!this._power.get(p.instance), reason: p.powerWhy ?? null }, visuals: this._visuals(p),
        pins: Object.fromEntries(p.def.manifest.pins.filter((x) => x.kind !== "nc").map((x) => [x.name, pinState(`${p.instance}.${x.name}`)])),
      })),
      wires: [...this.wires.values()].map((w) => ({ ...w, short: bad.has(this._netInfo(w.from).id) })),
      hazards: this.hazards.map((h) => ({ ...h })), events: this.events.slice(-20).map(({ key, ...e }) => e),
    };
  }
  _visuals(p) {
    const out = {};
    for (const v of p.def.manifest.visuals ?? []) {
      const s = v.source; let x = 0;
      if (s.output !== undefined) x = Number(p.outputs[s.output]) || 0;
      else if (s.field !== undefined) x = Number(p.fields[s.field]) || 0;
      else if (s.pin !== undefined) { const n = this._netInfo(`${p.instance}.${s.pin}`); x = n.pwm ? n.pwm.duty : n.level; }
      else if (s.gpio !== undefined) { const pin = p.def.manifest.pins.find((q) => q.gpio === s.gpio); if (pin) { const n = this._netInfo(`${p.instance}.${pin.name}`); x = n.pwm ? n.pwm.duty : n.level; } }
      if (v.scale) { const [a, b] = v.scale.in, [c, d] = v.scale.out; x = c + ((clamp(x, Math.min(a, b), Math.max(a, b)) - a) / (b - a || 1)) * (d - c); }
      out[v.id] = x;
    }
    return out;
  }

  // ---------------------------------------------------------------- layout (.dotlayout, 9.2)
  serialise(name = "Bench") {
    return {
      format: "dotbench-layout", version: 1, name,
      device: { rails: { V33: "app", V5: "app" }, header: "kode-dot-j3" },
      parts: [...this.parts.values()].map((p) => ({ instance: p.instance, part: { id: p.id, version: p.def.manifest.version, sha256: p.def.sha256 }, label: p.label, pos: { ...p.pos }, fields: { ...p.fields } })),
      wires: [...this.wires.values()].map((w) => ({ id: w.id, from: w.from, to: w.to, ...(w.color ? { color: w.color } : {}) })),
    };
  }
  /** Replace the bench by a layout. Returns {missing: [{instance, id, version}], dropped: [string], notes: [string]}. Parts whose definition is not loaded are listed in `missing` and skipped, with their wires. */
  restore(layout) {
    if (!layout || layout.format !== "dotbench-layout") throw new Error("not a dotbench layout");
    if (layout.version !== 1) throw new Error(`layout version ${layout.version} is not supported`);
    for (const i of [...this.parts.keys()]) this.removePart(i);
    this.wires.clear(); this._seq = 0; this._wseq = 0;
    const missing = [], dropped = [], notes = [];
    for (const lp of layout.parts ?? []) {
      const def = this.defs.get(lp.part?.id);
      if (!def) { missing.push({ instance: lp.instance, id: lp.part?.id, version: lp.part?.version }); continue; }
      if (lp.part.version && lp.part.version !== def.manifest.version) notes.push(`${lp.instance}: layout was made with ${lp.part.id} ${lp.part.version}, ${def.manifest.version} is loaded`);
      const fields = {}; for (const [k, v] of Object.entries(lp.fields ?? {})) { try { this._coerce((def.manifest.fields ?? []).find((f) => f.name === k), v); fields[k] = v; } catch { notes.push(`${lp.instance}: field ${k} dropped`); } }
      this.addPart(lp.part.id, { instance: lp.instance, label: lp.label, pos: lp.pos, fields });
    }
    for (const w of layout.wires ?? []) {
      try { this.connect(w.from, w.to, { id: w.id, color: w.color }); } catch (e) { dropped.push(`${w.from} - ${w.to}: ${e.message}`); }
    }
    return { missing, dropped, notes };
  }

  dispose() {
    this.detach();
    for (const p of this.parts.values()) try { p.impl?.dispose?.(); } catch {}
    this.parts.clear(); this.wires.clear(); this.clock.dispose();
  }
}
