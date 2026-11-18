/**
 * The bench as a circuit: which terminals are joined (nets), what each net is called, and what each part is on a
 * schematic (its symbol, its reference designator, its value). Pure: no engine, no scene, no page.
 *
 * Nets come from the bench's real connectivity, the way the parts engine builds them before it solves
 * (runtime/web-adapter/bench.js `_pass`): jumper wires, a wire for every leg standing in a hole, the pins a part joins
 * inside itself (`groups` and `bridge` elements: a breadboard's rows), and the pairs a module on the Dot's header adds.
 * Contacts that open and close (a button, a relay) are NOT joined: they are parts of the drawing.
 */
import type { BenchObject, FieldValue } from '../bench/model';
import type { MountSide, Wire } from '../bench/store';
import { DEVICE_LIST, findPlug, hostOf, legsOf, type Plug } from '../parts/geometry';
import type { PartManifest } from '../parts/service';
import type { Rot } from '../workbench/layout';

/** GPIO of each position of the Dot's header (EXP1..EXP14), as runtime/web-adapter/bench.js `J3_GPIO`. */
export const J3_GPIO = [8, 9, 10, 11, 12, 13, 14, 21, 19, 20, 17, 18, 15, 16] as const;
export const DEVICE = 'device';

export type SymbolClass =
  | 'dot'
  | 'board'
  | 'module'
  | 'block'
  | 'resistor'
  | 'capacitor'
  | 'capacitor-pol'
  | 'diode'
  | 'led'
  | 'rgb-led'
  | 'switch'
  | 'potentiometer'
  | 'buzzer'
  | 'motor'
  | 'servo'
  | 'relay'
  | 'cell'
  /** Only joins nets (a breadboard): listed among the parts, never drawn. */
  | 'join';

export type NetKind = 'ground' | 'supply' | 'signal';

export interface ProjectPin {
  name: string;
  /** What is printed beside the pin. */
  label: string;
  kind: string;
  /** The net the pin is on, when that net joins it to something else. */
  net: ProjectNet | null;
  /** A wire, a hole or the header meets this very pin (not only a pin joined to it inside the part). */
  touched: boolean;
  /** The Dot's header position, for its own pins. */
  number?: number;
}
/** One contact set of a switch: a common terminal and the terminals it can meet. */
export interface Pole {
  com: string[];
  throws: string[][];
}
export interface ProjectPart {
  /** Instance on the bench (`p1`, ... or `device`). */
  id: string;
  /** Part id in the library (`dotbench.led`), `kode.dot` for the Dot. */
  kind: string;
  cls: SymbolClass;
  /** Reference designator: R1, D1, SW1, U1... */
  ref: string;
  /** The part's own names, by language. */
  names: { en: string; 'pt-BR'?: string; es?: string };
  value: string;
  pins: ProjectPin[];
  /** For a switch: its contact sets, and whether it springs back. */
  poles?: Pole[];
  momentary?: boolean;
  /** Carries a sketch (the compiler's board id). */
  core?: string;
}
export interface ProjectNet {
  name: string;
  kind: NetKind;
  /** The part pins a builder connects, in drawing order. */
  members: { part: ProjectPart; pin: ProjectPin }[];
}
export interface Project {
  /** Everything to draw, in reference order (the Dot first when it is wired). */
  parts: ProjectPart[];
  /** Breadboards and the like: on the parts list only. */
  joiners: ProjectPart[];
  nets: ProjectNet[];
  /** Jumper wires on the table. */
  wires: number;
}

export interface ProjectInput {
  objects: readonly BenchObject[];
  wires: readonly Wire[];
  mounts: Readonly<Record<string, MountSide>>;
  manifest(kind: string): PartManifest | undefined;
  /** Legs standing in holes, by instance; worked out from the places when not given. */
  plugs?: ReadonlyMap<string, Plug>;
}

// ---- legs in holes (the same rule as PartsService.plugs) -----------------------------------------------------------
export function plugsOf(input: ProjectInput): Map<string, Plug> {
  const parts = input.objects.filter((o) => o.area === 'part');
  const hosts = [];
  for (const o of parts) {
    const m = input.manifest(o.kind);
    const h = m && !input.mounts[o.id] ? hostOf(o.id, m, o.pos, o.rot as Rot) : null;
    if (h) hosts.push(h);
  }
  const out = new Map<string, Plug>();
  if (!hosts.length) return out;
  for (const o of parts) {
    const m = input.manifest(o.kind);
    const legs = m ? legsOf(m) : [];
    const plug = legs.length ? findPlug(legs, o.pos, o.rot as Rot, hosts, 0.3) : null;
    if (plug) out.set(o.id, plug);
  }
  return out;
}

// ---- what a part is on a schematic ---------------------------------------------------------------------------------
type El = { type: string; [key: string]: unknown };
const elementsOf = (m: PartManifest): El[] => m.behaviour.elements ?? [];

export function classOf(m: PartManifest): SymbolClass {
  const els = elementsOf(m);
  const types = new Set(els.map((e) => e.type));
  if (m.behaviour.type === 'wasm' || m.category === 'mcu') return 'board';
  const holes = m.pins.filter((p) => (p.face ?? 'top') === 'top').length;
  if (m.category === 'prototyping' || (holes >= 40 && els.length > 0 && els.every((e) => e.type === 'bridge'))) return 'join';
  if (m.category === 'kode-module') return 'module';
  const real = m.pins.filter((p) => p.kind !== 'nc').length;
  if (types.has('relay')) return 'relay';
  if (types.has('servo')) return 'servo';
  if (els.length && els.every((e) => e.type === 'switch')) return 'switch';
  if (types.has('divider') && real === 3) return 'potentiometer';
  if (real === 4 && els.length === 3 && els.every((e) => e.type === 'led' || e.type === 'diode')) return 'rgb-led';
  if (real === 2 && els.length === 1) {
    switch (els[0].type) {
      case 'resistor':
        return m.category === 'passive' ? 'resistor' : 'block';
      case 'capacitor':
        return /electrolytic|polari[sz]ed/i.test(m.id) || m.pins.some((p) => /^(POS|NEG|\+|-)$/i.test(p.name)) ? 'capacitor-pol' : 'capacitor';
      case 'diode':
      case 'led':
        return /led/i.test(m.id) || m.category === 'actuator' || els[0].type === 'led' ? 'led' : 'diode';
      case 'buzzer':
        return 'buzzer';
      case 'motor':
        return 'motor';
      case 'cell':
        return 'cell';
    }
  }
  return 'block';
}

const PREFIX: Record<SymbolClass, string> = {
  dot: 'U',
  board: 'U',
  module: 'U',
  block: 'U',
  resistor: 'R',
  capacitor: 'C',
  'capacitor-pol': 'C',
  diode: 'D',
  led: 'D',
  'rgb-led': 'D',
  switch: 'SW',
  potentiometer: 'RV',
  buzzer: 'BZ',
  motor: 'M',
  servo: 'M',
  relay: 'K',
  cell: 'BT',
  join: 'BB',
};
/** The order parts are numbered and drawn in: the Dot and the boards first. */
const ORDER: SymbolClass[] = ['dot', 'board', 'module', 'block', 'relay', 'servo', 'motor', 'cell', 'switch', 'potentiometer', 'resistor', 'capacitor', 'capacitor-pol', 'diode', 'led', 'rgb-led', 'buzzer', 'join'];

const trim = (n: number): string => String(Math.round(n * 100) / 100);
export function ohmsText(ohms: number): string {
  if (!Number.isFinite(ohms) || ohms < 0) return '';
  if (ohms >= 1e6) return `${trim(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${trim(ohms / 1e3)} kΩ`;
  return `${trim(ohms)} Ω`;
}
export function faradsText(uf: number): string {
  if (!Number.isFinite(uf) || uf <= 0) return '';
  if (uf >= 1) return `${trim(uf)} µF`;
  if (uf >= 1e-3) return `${trim(uf * 1e3)} nF`;
  return `${trim(uf * 1e6)} pF`;
}
/** A number an element takes from a field (`{field, scale?}`) or carries itself. */
function numberOf(v: unknown, fields: Record<string, FieldValue>): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as { field?: unknown }).field === 'string') {
    const n = Number(fields[(v as { field: string }).field]);
    const scale = (v as { scale?: unknown }).scale;
    return Number.isFinite(n) ? n * (typeof scale === 'number' ? scale : 1) : null;
  }
  return null;
}
const voltsText = (mv: number): string => `${trim(mv / 1000)} V`;

export function valueOf(m: PartManifest, cls: SymbolClass, fields: Record<string, FieldValue>): string {
  const els = elementsOf(m);
  const all = { ...Object.fromEntries((m.fields ?? []).map((f) => [f.name, f.default])), ...fields };
  const first = els[0];
  if (!first) return '';
  switch (cls) {
    case 'resistor': {
      const n = numberOf(first.ohms, all);
      return n === null ? '' : ohmsText(n);
    }
    case 'capacitor':
    case 'capacitor-pol': {
      const n = numberOf(first.uf ?? first.farads_uf ?? { field: 'uf' }, all);
      return n === null ? '' : faradsText(n);
    }
    case 'led':
    case 'rgb-led': {
      // an LED that carries its own series resistor says so
      const n = numberOf(first.series_ohms, all);
      return n ? `+ ${ohmsText(n)}` : '';
    }
    case 'potentiometer': {
      const n = numberOf(first.ohms, all);
      return n === null ? '' : ohmsText(n);
    }
    case 'cell': {
      const n = numberOf(first.mv, all);
      return n === null ? '' : voltsText(n);
    }
    default:
      return '';
  }
}

/** The contact sets of a switch part: elements sharing a terminal are one pole. */
function polesOf(m: PartManifest): Pole[] {
  const group = new Map<string, string[]>();
  for (const g of m.groups ?? []) for (const p of g.pins) group.set(p, g.pins);
  const mates = (p: string) => group.get(p) ?? [p];
  const sw = elementsOf(m).filter((e) => e.type === 'switch' && typeof e.a === 'string' && typeof e.b === 'string') as unknown as { a: string; b: string }[];
  const count = new Map<string, number>();
  for (const s of sw) for (const t of [s.a, s.b]) count.set(t, (count.get(t) ?? 0) + 1);
  const poles: Pole[] = [];
  const byCom = new Map<string, Pole>();
  for (const s of sw) {
    // the common terminal is the one more contacts share ("COM" when it is a tie)
    const ca = count.get(s.a) ?? 0, cb = count.get(s.b) ?? 0;
    const aIsCom = ca !== cb ? ca > cb : !/^COM/i.test(s.b);
    const com = aIsCom ? s.a : s.b, other = aIsCom ? s.b : s.a;
    let pole = byCom.get(com);
    if (!pole) {
      pole = { com: mates(com), throws: [] };
      byCom.set(com, pole);
      poles.push(pole);
    }
    pole.throws.push(mates(other));
  }
  return poles;
}

// ---- nets ----------------------------------------------------------------------------------------------------------
class Union {
  private p = new Map<string, string>();
  add(t: string): void {
    if (!this.p.has(t)) this.p.set(t, t);
  }
  has(t: string): boolean {
    return this.p.has(t);
  }
  find(t: string): string {
    let r = t;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    while (this.p.get(t) !== r) {
      const n = this.p.get(t)!;
      this.p.set(t, r);
      t = n;
    }
    return r;
  }
  join(a: string, b: string): void {
    if (!this.p.has(a) || !this.p.has(b)) return;
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}

const deviceLabel = (name: string): string => (name === 'V5' ? '5V' : name === 'V33' ? '3V3' : name);
/** A supply pin's name as a net name: V5 and 5V are "5V", V33 is "3V3", numbered twins lose their number. */
function supplyName(pin: string): string {
  const base = pin.replace(/_(\d+|[A-Z])$/, '');
  if (/^(V5|5V|VCC5|VBUS)$/i.test(base)) return '5V';
  if (/^(V33|3V3|V3V3|3\.3V)$/i.test(base)) return '3V3';
  return base.toUpperCase();
}

export function buildProject(input: ProjectInput): Project {
  const objs = input.objects.filter((o) => o.area === 'part' && input.manifest(o.kind));
  const plugs = input.plugs ?? plugsOf(input);

  // -- every terminal, and the pairs that are one conductor
  const uf = new Union();
  const touched = new Set<string>();
  for (const d of DEVICE_LIST) uf.add(d.term);
  for (const o of objs) for (const pin of input.manifest(o.kind)!.pins) if (pin.kind !== 'nc') uf.add(`${o.id}.${pin.name}`);
  const touch = (a: string, b: string) => {
    if (!uf.has(a) || !uf.has(b)) return;
    uf.join(a, b);
    touched.add(a);
    touched.add(b);
  };
  for (const w of input.wires) touch(w.from, w.to);
  for (const [id, p] of plugs) for (const [leg, hole] of p.pairs) touch(`${id}.${leg}`, `${p.host}.${hole}`);
  for (const o of objs) {
    const m = input.manifest(o.kind)!;
    for (const g of m.groups ?? []) for (let i = 1; i < g.pins.length; i++) uf.join(`${o.id}.${g.pins[0]}`, `${o.id}.${g.pins[i]}`);
    for (const e of elementsOf(m)) if (e.type === 'bridge' && typeof e.a === 'string' && typeof e.b === 'string') uf.join(`${o.id}.${e.a}`, `${o.id}.${e.b}`);
    const side = input.mounts[o.id];
    if (side && m.mount) {
      for (const e of m.mount.pins ?? []) {
        const pos = (J3_GPIO as readonly number[]).indexOf(e.gpio) + 1;
        if (pos >= 1) touch(`${o.id}.${e.pin}`, `${DEVICE}.EXP${side === 'turned' ? 15 - pos : pos}`);
      }
      for (const e of m.mount.rails ?? []) touch(`${o.id}.${e.pin}`, `${DEVICE}.${e.rail}`);
    }
  }

  // -- the parts
  const made: ProjectPart[] = objs.map((o) => {
    const m = input.manifest(o.kind)!;
    const cls = classOf(m);
    const part: ProjectPart = {
      id: o.id,
      kind: o.kind,
      cls,
      ref: '',
      names: m.name,
      value: valueOf(m, cls, o.fields),
      pins: m.pins.filter((p) => p.kind !== 'nc').map((p) => ({ name: p.name, label: p.name, kind: p.kind, net: null, touched: touched.has(`${o.id}.${p.name}`) })),
    };
    if (cls === 'switch') {
      part.poles = polesOf(m);
      part.momentary = (m.controls ?? []).some((c) => c.mode === 'momentary') || (m.fields ?? []).some((f) => f.name === 'pressed');
    }
    if (m.behaviour.type === 'wasm' && m.behaviour.core) part.core = m.behaviour.core;
    return part;
  });
  const dot: ProjectPart = {
    id: DEVICE,
    kind: 'kode.dot',
    cls: 'dot',
    ref: '',
    names: { en: 'Kode Dot' },
    value: '',
    pins: DEVICE_LIST.map((d) => {
      const n = /^EXP(\d+)$/.exec(d.name);
      return { name: d.name, label: n ? `${d.name} (IO${J3_GPIO[Number(n[1]) - 1]})` : deviceLabel(d.name), kind: d.kind, net: null, touched: touched.has(d.term), number: d.pin };
    }),
  };

  // -- reference designators: by class, then in the order the parts came to the table
  const dotUsed = dot.pins.some((p) => p.touched);
  const ordered = [...(dotUsed ? [dot] : []), ...made].sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls));
  const next = new Map<string, number>();
  for (const p of ordered) {
    const pre = PREFIX[p.cls];
    const n = (next.get(pre) ?? 0) + 1;
    next.set(pre, n);
    p.ref = `${pre}${n}`;
  }
  const drawn = ordered.filter((p) => p.cls !== 'join');
  const joiners = ordered.filter((p) => p.cls === 'join');

  // -- nets: the terminals of drawn parts, grouped by conductor
  const sameGroup = new Map<string, string>(); // terminal -> a key shared by the pins its part joins inside itself
  for (const o of objs) for (const [i, g] of (input.manifest(o.kind)!.groups ?? []).entries()) for (const p of g.pins) sameGroup.set(`${o.id}.${p}`, `${o.id}#${i}`);
  const byRoot = new Map<string, { part: ProjectPart; pin: ProjectPin }[]>();
  for (const part of drawn) {
    for (const pin of part.pins) {
      const r = uf.find(`${part.id}.${pin.name}`);
      const list = byRoot.get(r);
      if (list) list.push({ part, pin });
      else byRoot.set(r, [{ part, pin }]);
    }
  }
  const nets: ProjectNet[] = [];
  const used = new Set<string>();
  const unique = (want: string): string => {
    let name = want;
    for (let k = 2; used.has(name); k++) name = `${want}_${k}`;
    used.add(name);
    return name;
  };
  const candidates: { all: { part: ProjectPart; pin: ProjectPin }[]; rank: number; want: string; kind: NetKind }[] = [];
  for (const all of byRoot.values()) {
    // a net is a connection when it joins pins that are not one pin already (a board's three GND pins are one)
    const distinct = new Set(all.map(({ part, pin }) => sameGroup.get(`${part.id}.${pin.name}`) ?? `${part.id}.${pin.name}`));
    if (distinct.size < 2) continue;
    const has = (id: string, pin: string) => all.some((x) => x.part.id === id && x.pin.name === pin);
    const source = (x: { part: ProjectPart }) => x.part.cls === 'board' || x.part.cls === 'module' || x.part.cls === 'dot';
    const cellPin = (which: 'pos' | 'neg') => all.find((x) => x.part.cls === 'cell' && cellTerm(input.manifest(x.part.kind)!, which) === x.pin.name);
    const ground = all.find((x) => x.pin.kind === 'ground' && source(x));
    const supply = all.find((x) => (x.pin.kind === 'power_out' || x.pin.kind === 'power_in') && source(x));
    const exp = all.filter((x) => x.part.id === DEVICE && /^EXP\d+$/.test(x.pin.name)).sort((a, b) => Number(a.pin.name.slice(3)) - Number(b.pin.name.slice(3)))[0];
    const board = all.find((x) => x.part.cls === 'board' && x.pin.touched) ?? all.find((x) => x.part.cls === 'board');
    const pos = cellPin('pos');
    let rank: number, want: string, kind: NetKind;
    if (has(DEVICE, 'GND')) [rank, want, kind] = [0, 'GND', 'ground'];
    else if (has(DEVICE, 'V5')) [rank, want, kind] = [1, '5V', 'supply'];
    else if (has(DEVICE, 'V33')) [rank, want, kind] = [1, '3V3', 'supply'];
    else if (ground || cellPin('neg')) [rank, want, kind] = [2, 'GND', 'ground'];
    else if (supply) [rank, want, kind] = [3, supplyName(supply.pin.name), 'supply'];
    else if (pos) [rank, want, kind] = [3, `+${pos.part.value.replace(/\s/g, '') || 'V'}`, 'supply'];
    else if (exp) [rank, want, kind] = [4, exp.pin.name, 'signal'];
    else if (board) [rank, want, kind] = [5, board.pin.name, 'signal'];
    else [rank, want, kind] = [6, '', 'signal'];
    candidates.push({ all, rank, want, kind });
  }
  // names are given in a fixed order, so two nets wanting one name always get the same answer
  const firstAt = (c: (typeof candidates)[number]) => Math.min(...c.all.map((x) => drawn.indexOf(x.part) * 1000 + x.part.pins.indexOf(x.pin)));
  candidates.sort((a, b) => a.rank - b.rank || firstAt(a) - firstAt(b));
  let anon = 0;
  for (const c of candidates) {
    let name: string;
    if (c.want) name = unique(c.want);
    else {
      do name = `N${++anon}`;
      while (used.has(name));
      used.add(name);
    }
    const net: ProjectNet = { name, kind: c.kind, members: [] };
    for (const x of c.all) x.pin.net = net;
    // the checklist names the pins something really meets; a net held together only inside parts keeps them all
    const met = c.all.filter((x) => x.pin.touched);
    net.members = (met.length >= 2 ? met : c.all).sort((a, b) => drawn.indexOf(a.part) - drawn.indexOf(b.part) || a.part.pins.indexOf(a.pin) - b.part.pins.indexOf(b.pin));
    nets.push(net);
  }
  return { parts: drawn, joiners, nets, wires: input.wires.length };
}

function cellTerm(m: PartManifest, which: 'pos' | 'neg'): string | null {
  const cell = elementsOf(m).find((e) => e.type === 'cell');
  const v = cell?.[which];
  return typeof v === 'string' ? v : null;
}

/** "U1.EXP1": how a pin is written in the connections table. */
export const pinText = (part: ProjectPart, pin: ProjectPin): string => `${part.ref}.${part.cls === 'dot' ? pin.label.replace(/ \(.*\)$/, '') : pin.label}`;

/** The parts list: equal parts with equal values on one line. */
export interface BomLine {
  refs: string[];
  part: ProjectPart;
  value: string;
  qty: number;
}
export function billOfMaterials(p: Project): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const part of [...p.parts, ...p.joiners]) {
    const key = `${part.kind}|${part.value}`;
    const line = lines.get(key);
    if (line) {
      line.refs.push(part.ref);
      line.qty++;
    } else lines.set(key, { refs: [part.ref], part, value: part.value, qty: 1 });
  }
  return [...lines.values()];
}
