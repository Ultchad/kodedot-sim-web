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
