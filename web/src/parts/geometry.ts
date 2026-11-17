/**
 * Where terminals are, in the table's frame (mm, X right, Z toward the viewer, Y up), and what plugging a part into a
 * board of holes means. Pure: no engine, no scene.
 */
import type { Pos, Rot } from '../workbench/layout';

export interface PinGeo {
  name: string;
  face?: string;
  kind?: string;
  mm?: { x: number; y: number; z?: number };
  label?: Record<string, string>;
}
export interface BodyGeo {
  w_mm: number;
  d_mm: number;
  h_mm: number;
}
export interface GeoManifest {
  id: string;
  body: BodyGeo;
  pins: PinGeo[];
}

/** A terminal in its part's model frame (origin: centre of the footprint on the table). */
export interface LocalTerm {
  name: string;
  x: number;
  y: number;
  z: number;
  face: string;
  kind: string;
}
export interface Vec {
  x: number;
  y: number;
  z: number;
}

const cache = new WeakMap<object, LocalTerm[]>();
export function localTerms(m: GeoManifest): LocalTerm[] {
  let t = cache.get(m);
  if (!t) {
    const { w_mm: w, d_mm: d, h_mm: h } = m.body;
    t = m.pins
      .filter((p) => p.mm)
      .map((p) => {
        const face = p.face ?? 'top';
        const y = p.mm!.z ?? (face === 'top' ? h : face === 'bottom' ? 0 : h / 2);
        return { name: p.name, x: p.mm!.x - w / 2, y, z: p.mm!.y - d / 2, face, kind: p.kind ?? 'io' };
      });
    cache.set(m, t);
  }
  return t;
}

/** Quarter turns as the bodies make them (a turn about Y by -rot * 90 degrees). */
export function turn(x: number, z: number, rot: Rot): [number, number] {
  return rot === 1 ? [-z, x] : rot === 2 ? [-x, -z] : rot === 3 ? [z, -x] : [x, z];
}
export function termWorld(t: LocalTerm, pos: Pos, rot: Rot, lift = 0): Vec {
  const [x, z] = turn(t.x, t.z, rot);
  return { x: pos.x + x, y: t.y + lift, z: pos.z + z };
}

// ---- the Dot's own header ------------------------------------------------------------------------------------------
export interface DeviceTerm {
  term: string;
  name: string;
  pin: number;
  kind: string;
  /** In the Dot's own frame (X right, Y toward its top edge, Z out of the screen), mm from the centre of its box. */
  X: number;
  Y: number;
  Z: number;
}
/** The same table as DEVICE_TERMINALS in runtime/web-adapter/bench.js (kept here so the table can show the header before the engine is fetched). */
export const DEVICE_LIST: readonly { term: string; name: string; pin: number; alt?: number; kind: string }[] = [
  ...[3, 4, 5, 6, 7, 8, 9].map((p, i) => ({ term: `device.EXP${i + 1}`, name: `EXP${i + 1}`, pin: p, kind: 'io' })),
  ...[12, 13, 14, 15, 16, 17, 18].map((p, i) => ({ term: `device.EXP${i + 8}`, name: `EXP${i + 8}`, pin: p, kind: 'io' })),
  { term: 'device.V5', name: 'V5', pin: 1, alt: 20, kind: 'power_out' },
  { term: 'device.V33', name: 'V33', pin: 2, alt: 19, kind: 'power_out' },
  { term: 'device.GND', name: 'GND', pin: 10, alt: 11, kind: 'ground' },
];
/**
 * J3 in the top wall: 2 x 10 at 2.54 mm. The Dot's own shell prints the pinout beside the holes (seen from behind, the
 * Dot face up: 3V3 IO15 IO17 IO19 GND IO14 IO12 IO10 IO8 5V in the row toward the screen, 5V IO16 IO18 IO20 IO21 GND IO13
 * IO11 IO9 3V3 in the row toward the back), which is: odd pins toward the screen, pin 1 (5 V) at the Dot's left seen
 * from the front (-X), pin 19 (3V3) at its right. A module's connector is numbered the other way round (it faces the
 * header), so its V5 pin still meets pin 1.
 */
export function deviceTerms(list: readonly { term: string; name: string; pin: number; alt?: number; kind: string }[] = DEVICE_LIST, anchorY = 38.5): DeviceTerm[] {
  const out: DeviceTerm[] = [];
  const at = (t: (typeof list)[number], pin: number) => {
    const col = (pin - 1) >> 1;
    out.push({ term: t.term, name: t.name === 'V5' ? '5V' : t.name === 'V33' ? '3V3' : t.name, pin, kind: t.kind, X: (col - 4.5) * 2.54, Y: anchorY, Z: pin & 1 ? 1.27 : -1.27 });
  };
  for (const t of list) {
    at(t, t.pin);
    if (t.alt) at(t, t.alt);
  }
  return out;
}

// ---- plugging legs into holes ------------------------------------------------------------------------------------
const CELL = 2.54;
const key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;

export interface Host {
  id: string;
  pos: Pos;
  rot: Rot;
  holes: LocalTerm[];
  grid: Map<string, LocalTerm[]>;
  hw: number;
  hd: number;
}
const grids = new WeakMap<object, Map<string, LocalTerm[]>>();
/** A part other parts plug into: it has sockets or holes on top. */
export function hostOf(id: string, m: GeoManifest, pos: Pos, rot: Rot): Host | null {
  const all = localTerms(m);
  let grid = grids.get(all);
  if (!grid) {
    grid = new Map();
    const holes = all.filter((t) => t.face === 'top');
    if (holes.length >= 6) {
      for (const h of holes) {
        const k = key(h.x, h.z);
        const a = grid.get(k);
        if (a) a.push(h);
        else grid.set(k, [h]);
      }
    }
    grids.set(all, grid);
  }
  if (!grid.size) return null;
  return { id, pos, rot, holes: all, grid, hw: m.body.w_mm / 2, hd: m.body.d_mm / 2 };
}
/** The legs a part stands on (they go into holes): none for a board of holes or a module. */
export function legsOf(m: GeoManifest): LocalTerm[] {
  const all = localTerms(m);
  const legs = all.filter((t) => t.face === 'bottom' && t.y < 0.5);
  return legs.length && legs.length === all.length ? legs : [];
}

function nearest(h: Host, x: number, z: number, tol: number): LocalTerm | null {
  let best: LocalTerm | null = null;
  let bd = tol * tol;
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const t of h.grid.get(`${cx + i},${cz + j}`) ?? []) {
        const d = (t.x - x) ** 2 + (t.z - z) ** 2;
        if (d <= bd) {
          bd = d;
          best = t;
        }
      }
    }
  }
  return best;
}

export interface Plug {
  host: string;
  /** Where the part stands once its legs are in the holes. */
  pos: Pos;
  /** How high the holes are: the part stands on them. */
  lift: number;
  /** [leg, hole] by pin name. */
  pairs: [string, string][];
}
/**
 * The holes under a part's legs, if every leg has one. `reach` is how far the part may be pulled to get there (mm): a
 * drop uses a couple of mm, a part already standing in holes a fraction.
 */
export function findPlug(legs: readonly LocalTerm[], pos: Pos, rot: Rot, hosts: readonly Host[], reach = 1.8): Plug | null {
  if (!legs.length) return null;
  for (const h of hosts) {
    const back = ((4 - h.rot) % 4) as Rot;
    // the legs in the host's own frame
    const local = legs.map((l) => {
      const [wx, wz] = turn(l.x, l.z, rot);
      return turn(pos.x + wx - h.pos.x, pos.z + wz - h.pos.z, back);
    });
    const [x0, z0] = local[0];
    if (Math.abs(x0) > h.hw + reach || Math.abs(z0) > h.hd + reach) continue;
    const first = nearest(h, x0, z0, reach);
    if (!first) continue;
    const dx = first.x - x0, dz = first.z - z0;
    const pairs: [string, string][] = [[legs[0].name, first.name]];
    const used = new Set([first.name]);
    let ok = true;
    for (let i = 1; i < legs.length && ok; i++) {
      const hole = nearest(h, local[i][0] + dx, local[i][1] + dz, 0.45);
      if (!hole || used.has(hole.name)) ok = false;
      else {
        used.add(hole.name);
        pairs.push([legs[i].name, hole.name]);
      }
    }
    if (!ok) continue;
    const [sx, sz] = turn(dx, dz, h.rot);
    return { host: h.id, pos: { x: pos.x + sx, z: pos.z + sz }, lift: first.y, pairs };
  }
  return null;
}

// ---- a module on the Dot's header --------------------------------------------------------------------------------
export interface MountGeo {
  connector?: { seat_mm: { x: number; y: number; z: number } };
  placement?: { anchor_dot_mm: { x: number; y: number; z: number }; upright?: Record<string, string>; turned?: Record<string, string> };
}
const AXIS: Record<string, [number, number, number]> = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
/**
 * The 4x4 (column-major, as three.js keeps it) that takes a point of the part's MODEL frame to the Dot's own frame for a
 * mounted module, or null when the manifest does not say where it sits.
 */
export function mountMatrix(body: BodyGeo, mount: MountGeo | undefined, side: 'upright' | 'turned'): number[] | null {
  const axes = mount?.placement?.[side];
  const seat = mount?.connector?.seat_mm;
  const anchor = mount?.placement?.anchor_dot_mm;
  if (!axes || !seat || !anchor) return null;
  const ax = AXIS[axes.x], ay = AXIS[axes.y], az = AXIS[axes.z];
  if (!ax || !ay || !az) return null;
  // model (X, Y, Z) = part (x - w/2, z, y - d/2): model X runs along part x, model Y along part z, model Z along part y
  const cx = ax, cy = az, cz = ay;
  // the part's seat in model coordinates lands on the anchor
  const sx = seat.x - body.w_mm / 2, sy = seat.z, sz = seat.y - body.d_mm / 2;
  const t = [0, 1, 2].map((i) => [anchor.x, anchor.y, anchor.z][i] - (cx[i] * sx + cy[i] * sy + cz[i] * sz));
  return [cx[0], cx[1], cx[2], 0, cy[0], cy[1], cy[2], 0, cz[0], cz[1], cz[2], 0, t[0], t[1], t[2], 1];
}
