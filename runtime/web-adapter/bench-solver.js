// SPDX-License-Identifier: GPL-3.0-or-later
// The bench's net solver (docs/component-api.md 5.3 and 5.4): pure functions, no state, Node and browser.
// A net is a set of terminals joined by wires (and by closed switches / bridges). DC, resistive, no time:
//   V = sum(mv_i / ohms_i) / sum(1 / ohms_i)        over the net's voltage sources (a driven output, a pull resistor, a rail, a sensor)
// A net with no source is floating (reads 0 V, flagged). Sources with ohms <= 1000 are "strong"; two strong sources that disagree by more
// than 1000 mV are a short, two push-pull outputs that agree are contention.

export const STRONG_OHMS = 1000;
export const SHORT_MV = 1000;
export const HI_FRACTION = 0.75, LO_FRACTION = 0.25;

export class UnionFind {
  constructor() { this.p = new Map(); }
  find(a) {
    if (!this.p.has(a)) this.p.set(a, a);
    let r = a;
    while (this.p.get(r) !== r) r = this.p.get(r);
    for (let x = a; x !== r;) { const n = this.p.get(x); this.p.set(x, r); x = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

/**
 * @param {Iterable<string>} terms every terminal name
 * @param {Iterable<[string,string]>} pairs wires, bridges, closed switches
 * @returns {{netOf: Map<string, number>, nets: string[][]}}
 */
export function computeNets(terms, pairs) {
  const uf = new UnionFind();
  for (const t of terms) uf.find(t);
  for (const [a, b] of pairs) if (uf.p.has(a) && uf.p.has(b)) uf.union(a, b);
  const idx = new Map(), nets = [], netOf = new Map();
  for (const t of terms) {
    const r = uf.find(t);
    if (!idx.has(r)) { idx.set(r, nets.length); nets.push([]); }
    nets[idx.get(r)].push(t);
    netOf.set(t, idx.get(r));
  }
  return { netOf, nets };
}

/**
 * @typedef {{term: string, mv: number, ohms: number, kind: "out"|"od"|"pull"|"analog"|"rail", pwm?: boolean}} Source
 * @returns {{mv: number, rth: number, floating: boolean, strong: Source[]}}
 */
export function solveSources(sources) {
  let g = 0, i = 0;
  const strong = [];
  for (const s of sources) {
    const y = 1 / Math.max(s.ohms, 1e-3);
    g += y; i += s.mv * y;
    if (s.ohms <= STRONG_OHMS) strong.push(s);
  }
  if (g === 0) return { mv: 0, rth: Infinity, floating: true, strong };
  return { mv: i / g, rth: 1 / g, floating: false, strong };
}

/** Digital level with hysteresis for a reader whose supply is vdd (mV); between the thresholds the previous level holds. */
export function digital(mv, vdd, prev = 0) {
  if (!(vdd > 0)) return 0;
  if (mv >= HI_FRACTION * vdd) return 1;
  if (mv <= LO_FRACTION * vdd) return 0;
  return prev ? 1 : 0;
}

/**
 * Conflicts among the strong sources of one net.
 * @returns {{class: "short"|"contention", terms: string[], detail: string}[]}
 */
export function conflicts(sources) {
  const out = [];
  const strong = sources.filter((s) => s.ohms <= STRONG_OHMS);
  let lo = null, hi = null;
  for (const s of strong) { if (!lo || s.mv < lo.mv) lo = s; if (!hi || s.mv > hi.mv) hi = s; }
  if (lo && hi && hi.mv - lo.mv > SHORT_MV) {
    out.push({ class: "short", terms: [hi.term, lo.term], detail: `${hi.term} at ${(hi.mv / 1000).toFixed(1)} V against ${lo.term} at ${(lo.mv / 1000).toFixed(1)} V` });
  } else {
    const outs = strong.filter((s) => s.kind === "out");
    if (outs.length >= 2) out.push({ class: "contention", terms: outs.map((s) => s.term), detail: "two outputs on one net" });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------------
// Two-terminal elements (resistor, capacitor, diode, cell) and time. Units: volts in mV, conductance in S, current in mA (mV * S = mA).
// The per-net Thevenin solve above stays the DC fast path: only nets joined by a branch go through this nodal solve (modified nodal analysis
// with a dense Gauss elimination; a component has a handful of nodes because wires and breadboard strips are merged into nets first).
//   node:   {g, i}                     the net's own sources as a Norton equivalent to the 0 V reference (g = 1/rth, i = mv * g); g = 0 when it has none
//   branch: {a, b, kind, ...}          a, b are node indexes; the branch current I(a to b) is reported in `cur` (mA)
//     "r"     {g}                      resistor
//     "emf"   {g, e}                   I = g * (Va - Vb - e): a cell (+ at a), the forward diode model, a capacitor companion
//     "cap"   {c, esr, v}              backward Euler: ideal C (farads) holding v (mV) behind esr (ohms), step dt seconds: g = 1/(esr + dt/c), e = v
//     "diode" {vf, rs, on}             piecewise linear: off = open, on = vf in series with rs; `on` is updated until consistent
// A connected set of nodes with no reference (no source at all) is not solved, it is reported as floating; a set whose only sources are
// cells and branches (a battery loop) takes its `refs` node (a ground pin, a cell minus) as 0 V.
export const R_MIN = 0.001;
function gauss(A, b, n) {
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(A[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > best) { best = Math.abs(A[r][c]); p = r; }
    if (best < 1e-30) { A[c][c] = 1e-12; p = c; }
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]]; }
    const d = A[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d; if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
/**
 * @param {{g:number,i:number}[]} nodes
 * @param {object[]} branches (see above); `on` of diodes is read and updated
 * @param {{dt?: number, ref?: number}} o dt in seconds for capacitors (0 or missing: a capacitor holds its voltage behind a tiny resistance); ref: node to ground when no node has a source
 * @returns {{v: number[], cur: number[]}}
 */
export function solveNetwork(nodes, branches, o = {}) {
  const n = nodes.length, dt = o.dt > 0 ? o.dt : 1e-6;
  const nodeSrc = nodes.some((x) => x.g > 0), hasSrc = nodeSrc || branches.some((b) => b.kind === "emf" && b.g > 0);
  const ref = nodeSrc ? -1 : (o.ref ?? 0);
  const stamp = (bn) => {
    if (bn.kind === "r") return { g: bn.g, e: 0 };
    if (bn.kind === "emf") return { g: bn.g, e: bn.e };
    if (bn.kind === "cap") return { g: 1 / ((bn.esr ?? 0) + dt / bn.c), e: bn.v };
    if (bn.kind === "diode") return bn.on ? { g: 1 / Math.max(bn.rs, R_MIN), e: bn.vf } : null;
    return null;
  };
  let v = new Array(n).fill(0);
  for (let iter = 0; iter < 24; iter++) {
    const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
    for (let k = 0; k < n; k++) { A[k][k] += nodes[k].g + GMIN; b[k] += nodes[k].i; }
    for (const bn of branches) {
      const s = stamp(bn); if (!s) continue;
      const { a, b: c } = bn;
      A[a][a] += s.g; A[c][c] += s.g; A[a][c] -= s.g; A[c][a] -= s.g;
      b[a] += s.g * s.e; b[c] -= s.g * s.e;
    }
    if (ref >= 0) { for (let k = 0; k < n; k++) { A[ref][k] = 0; A[k][ref] = 0; } A[ref][ref] = 1; b[ref] = 0; }
    v = gauss(A, b, n);
    let flipped = false;
    for (const bn of branches) if (bn.kind === "diode") {
      const on = v[bn.a] - v[bn.b] > bn.vf;
      if (on !== !!bn.on) { bn.on = on; flipped = true; }
    }
    if (!flipped) break;
  }
  const cur = branches.map((bn) => { const s = stamp(bn); return s ? s.g * (v[bn.a] - v[bn.b] - s.e) : 0; });
  return { v, cur, dt, hasSrc };
}
export const GMIN = 1e-12;
