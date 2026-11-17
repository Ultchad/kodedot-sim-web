/**
 * The table of the Workbench, as plain numbers (no WebGL, unit-tested): where the Dot lies, how big every kind of object
 * is, the grid, what "near" means for each wireless area as a distance on the table, and where an object goes when it is
 * brought near or taken away with the switch.
 *
 * Table frame (millimetres): X to the right, Z towards the viewer, Y up. The Dot lies face up at the origin with its top
 * edge (the expansion connector) towards -Z.
 */
import { bodyDims, SIDE_FEATURES_ESTIMATE } from '../lib/bodyModel';

export interface Pos {
  x: number;
  z: number;
}
export type Rot = 0 | 1 | 2 | 3;
export interface Placed {
  id: string;
  kind: string;
  pos: Pos;
  rot: Rot;
}
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const D = bodyDims();
/** Half extents of the Dot's footprint on the table and its thickness. */
export const DOT = { hw: D.hw, hd: D.hh, h: D.depth } as const;
export const DOT_ID = 'dot';
export const SD_ID = 'fx:sd';

/** The desk mat: everything stays on it. */
export const MAT: Rect & { r: number } = { x0: -330, x1: 330, z0: -280, z1: 190, r: 26 };
/** The warm surface under the mat. */
export const DESK: Rect & { r: number; thick: number } = { x0: MAT.x0 - 44, x1: MAT.x1 + 44, z0: MAT.z0 - 44, z1: MAT.z1 + 44, r: 46, thick: 26 };
/** Snapping step, and the pitch of the dots drawn on the mat. */
export const GRID = 5;
export const GRID_DOTS = 10;
/** Room kept between two things on the table. */
export const GAP = 2;

/** Footprint at rotation 0 (w along X, d along Z) and height, per kind: the same numbers as the kind's Bench3D model (checked by a test). */
export const SIZES: Record<string, { w: number; d: number; h: number }> = {
  'nfc.tag': { w: 30, d: 30, h: 1.5 },
  'nfc.card': { w: 85.6, d: 54, h: 1.1 },
  'nfc.reader': { w: 68, d: 100, h: 13.5 },
  'rfid.card': { w: 85.6, d: 54, h: 2 },
  'rfid.tag': { w: 31, d: 46, h: 6.2 },
  'rfid.reader': { w: 54, d: 46, h: 96 },
  'wifi.router': { w: 118, d: 78, h: 88 },
  'ir.tv': { w: 150, d: 46, h: 104 },
  'ir.remote': { w: 40, d: 118, h: 12 },
  'power.charger': { w: 44, d: 44, h: 26 },
  'power.battery': { w: 36, d: 54, h: 6.8 },
  [SD_ID]: { w: 11, d: 15, h: 1.1 },
};
/** The Bench3D model that is the body of a kind (the microSD card is a fixture, not a bench kind). */
export const modelIdOf = (kind: string): string => (kind === SD_ID ? 'sd.card' : kind);
export const hasBody = (kind: string): boolean => kind in SIZES;

// ----------------------------------------------------------------------------------------------------------- zones

/**
 * Where on the Dot each radio lives. The maker publishes no positions for the coils, the infrared window or the USB-C
 * port, so these are estimates: both coils against the back cover (NFC in the upper half, the 125 kHz coil in the lower
 * half), infrared out of the top edge, USB-C in the middle of the bottom edge. The card slot is the one on the left wall.
 */
export const ANCHORS = {
  nfc: { x: 0, z: -14 },
  rfid: { x: 0, z: 13 },
  ir: { x: 0, z: -DOT.hd },
  wifi: { x: 0, z: 0 },
  usb: { x: 0, z: DOT.hd },
  sd: { x: -DOT.hw, z: -SIDE_FEATURES_ESTIMATE.slot.y },
} as const;

export type Zone =
  | { shape: 'circle'; x: number; z: number; r: number; /** 'edge': the nearest point of the object counts; 'centre': its middle */ by: 'edge' | 'centre' }
  | { shape: 'sector'; x: number; z: number; /** direction of the beam, radians from -Z towards +X */ dir: number; half: number; len: number };

const ZONES: Record<string, Zone> = {
  nfc: { shape: 'circle', ...ANCHORS.nfc, r: 46, by: 'edge' },
  rfid: { shape: 'circle', ...ANCHORS.rfid, r: 58, by: 'edge' },
  ir: { shape: 'sector', ...ANCHORS.ir, dir: 0, half: (33 * Math.PI) / 180, len: 255 },
  wifi: { shape: 'circle', ...ANCHORS.wifi, r: 300, by: 'centre' },
  power: { shape: 'circle', ...ANCHORS.usb, r: 105, by: 'edge' },
  sd: { shape: 'circle', ...ANCHORS.sd, r: 26, by: 'edge' },
};

/** The zone that decides "near" for a kind, or null when distance means nothing for it (the battery). */
export function zoneOf(kind: string): Zone | null {
  if (kind === SD_ID) return ZONES.sd;
  if (kind === 'power.battery' || !hasBody(kind)) return null;
  return ZONES[kind.split('.')[0]] ?? null;
}

export function sizeOf(kind: string, rot: Rot): { w: number; d: number; h: number } {
  const s = SIZES[kind] ?? { w: 30, d: 30, h: 10 };
  return rot % 2 ? { w: s.d, d: s.w, h: s.h } : s;
}
export function rectOf(kind: string, pos: Pos, rot: Rot): Rect {
  const s = sizeOf(kind, rot);
  return { x0: pos.x - s.w / 2, x1: pos.x + s.w / 2, z0: pos.z - s.d / 2, z1: pos.z + s.d / 2 };
}
export const DOT_RECT: Rect = { x0: -DOT.hw, x1: DOT.hw, z0: -DOT.hd, z1: DOT.hd };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Distance from a point to a rectangle (0 inside). */
export function distToRect(px: number, pz: number, r: Rect): number {
  return Math.hypot(px - clamp(px, r.x0, r.x1), pz - clamp(pz, r.z0, r.z1));
}

function inSector(z: Extract<Zone, { shape: 'sector' }>, px: number, pz: number): boolean {
  const dx = px - z.x, dz = pz - z.z;
  const along = dx * Math.sin(z.dir) - dz * Math.cos(z.dir);
  if (along <= 0 || Math.hypot(dx, dz) > z.len) return false;
  const across = Math.abs(dx * Math.cos(z.dir) + dz * Math.sin(z.dir));
  return Math.atan2(across, along) <= z.half;
}

/** Is an object at `pos` inside its zone (near the right spot of the Dot)? Kinds without a zone answer `fallback`. */
export function isNear(kind: string, pos: Pos, rot: Rot, fallback = false): boolean {
  const z = zoneOf(kind);
  if (!z) return fallback;
  if (z.shape === 'circle') return z.by === 'centre' ? Math.hypot(pos.x - z.x, pos.z - z.z) <= z.r : distToRect(z.x, z.z, rectOf(kind, pos, rot)) <= z.r;
  const r = rectOf(kind, pos, rot);
  // a beam: the middle of the object, or the middle of its side that faces the Dot
  return inSector(z, pos.x, pos.z) || inSector(z, clamp(z.x, r.x0, r.x1), clamp(z.z, r.z0, r.z1));
}

// ------------------------------------------------------------------------------------------------- snapping, overlap

export const snap = (v: number, step = GRID): number => Math.round(v / step) * step;

export function clampToMat(kind: string, pos: Pos, rot: Rot): Pos {
  const s = sizeOf(kind, rot);
  return { x: clamp(pos.x, MAT.x0 + s.w / 2 + 4, MAT.x1 - s.w / 2 - 4), z: clamp(pos.z, MAT.z0 + s.d / 2 + 4, MAT.z1 - s.d / 2 - 4) };
}

export const overlaps = (a: Rect, b: Rect, gap = GAP): boolean => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.z0 < b.z1 + gap && a.z1 > b.z0 - gap;

/** The rectangles an object may not overlap: the Dot and every other object with a body (`skip` are being moved with it). */
export function obstacles(all: readonly Placed[], skip: ReadonlySet<string> | string): Rect[] {
  const out: Rect[] = [DOT_RECT];
  for (const o of all) {
    if (typeof skip === 'string' ? o.id === skip : skip.has(o.id)) continue;
    if (hasBody(o.kind)) out.push(rectOf(o.kind, o.pos, o.rot));
  }
  return out;
}

export function isFree(kind: string, pos: Pos, rot: Rot, obs: readonly Rect[]): boolean {
  const r = rectOf(kind, pos, rot);
  for (const o of obs) if (overlaps(r, o)) return false;
  return true;
}

/**
 * Where a dragged object ends up when the pointer asks for `want`: snapped to the grid, kept on the mat, and pushed out
 * of whatever it would overlap by the shortest way (it slides round the Dot and the other objects). Null when there is no
 * free place close by: the caller keeps the last good position.
 */
export function settle(kind: string, want: Pos, rot: Rot, obs: readonly Rect[], doSnap = true): Pos | null {
  let p = clampToMat(kind, doSnap ? { x: snap(want.x), z: snap(want.z) } : want, rot);
  const s = sizeOf(kind, rot);
  for (let i = 0; i < 6; i++) {
    const r = rectOf(kind, p, rot);
    const hit = obs.find((o) => overlaps(r, o));
    if (!hit) return p;
    // the four ways out of this obstacle, nearest first
    const outs: Pos[] = [
      { x: hit.x0 - GAP - s.w / 2, z: p.z },
      { x: hit.x1 + GAP + s.w / 2, z: p.z },
      { x: p.x, z: hit.z0 - GAP - s.d / 2 },
      { x: p.x, z: hit.z1 + GAP + s.d / 2 },
    ]
      .map((q) => (doSnap ? { x: q.x < p.x ? Math.floor(q.x / GRID) * GRID : q.x > p.x ? Math.ceil(q.x / GRID) * GRID : q.x, z: q.z < p.z ? Math.floor(q.z / GRID) * GRID : q.z > p.z ? Math.ceil(q.z / GRID) * GRID : q.z } : q))
      .sort((a, b) => Math.hypot(a.x - want.x, a.z - want.z) - Math.hypot(b.x - want.x, b.z - want.z));
    const next = outs.find((q) => {
      const c = clampToMat(kind, q, rot);
      return c.x === q.x && c.z === q.z && isFree(kind, q, rot, obs);
    });
    if (next) return next;
    p = clampToMat(kind, outs[0], rot);
  }
  return isFree(kind, p, rot, obs) ? p : null;
}

/**
 * The free place nearest to `want` that satisfies `ok` (inside a zone, outside it, anything). Searches the grid in
 * growing rings, so the answer is always a snapped position.
 */
const ANY = (): boolean => true;
export function freeSpot(kind: string, want: Pos, rot: Rot, obs: readonly Rect[], ok: (p: Pos) => boolean = ANY, step = GRID * 2): Pos {
  const start = clampToMat(kind, { x: snap(want.x), z: snap(want.z) }, rot);
  let best: Pos | null = null;
  let bestD = Infinity;
  const tryAt = (x: number, z: number) => {
    const p = clampToMat(kind, { x, z }, rot);
    if (p.x !== x || p.z !== z) return;
    const d = Math.hypot(x - want.x, z - want.z);
    if (d >= bestD || !isFree(kind, p, rot, obs) || !ok(p)) return;
    best = p;
    bestD = d;
  };
  tryAt(start.x, start.z);
  for (let ring = 1; ring <= 80 && (best === null || ring * step <= bestD + step); ring++) {
    const k = ring * step;
    for (let i = -ring; i <= ring; i++) {
      tryAt(start.x + i * step, start.z - k);
      tryAt(start.x + i * step, start.z + k);
      if (i > -ring && i < ring) {
        tryAt(start.x - k, start.z + i * step);
        tryAt(start.x + k, start.z + i * step);
      }
    }
  }
  // nowhere that satisfies `ok` (a crowded range): any free place, so that nothing ever overlaps
  return best ?? (ok === ANY ? start : freeSpot(kind, want, rot, obs, ANY, step));
}

/** Where each area's things wait when they are away from the Dot, and where they come to when brought near. */
const PARK: Record<string, { near: Pos; far: Pos }> = {
  nfc: { near: { x: -(DOT.hw + 22), z: -14 }, far: { x: -190, z: 70 } },
  rfid: { near: { x: DOT.hw + 26, z: 14 }, far: { x: 190, z: 70 } },
  ir: { near: { x: 0, z: -205 }, far: { x: -240, z: -120 } },
  wifi: { near: { x: 150, z: -120 }, far: { x: 255, z: -235 } },
  power: { near: { x: 0, z: DOT.hd + 60 }, far: { x: 150, z: 140 } },
  sd: { near: { x: -(DOT.hw + 14), z: ANCHORS.sd.z }, far: { x: -90, z: 60 } },
};
const parkOf = (kind: string) => PARK[kind === SD_ID ? 'sd' : kind.split('.')[0]] ?? { near: { x: -120, z: 120 }, far: { x: -120, z: 120 } };

/** The place an object goes to when the switch says near (inside its zone) or away (outside it), close to `from` when given. */
export function spotFor(kind: string, near: boolean, rot: Rot, obs: readonly Rect[], from?: Pos): Pos {
  const park = parkOf(kind);
  const zone = zoneOf(kind);
  if (!zone) return freeSpot(kind, from ?? park.far, rot, obs);
  let want = near ? park.near : park.far;
  if (from && !near) {
    // straight away from the Dot, just past the edge of the zone
    const dx = from.x - zone.x, dz = from.z - zone.z;
    const l = Math.hypot(dx, dz);
    const reach = (zone.shape === 'circle' ? zone.r : zone.len) + 40;
    if (zone.shape === 'circle' && l > 1 && reach < 200) want = { x: zone.x + (dx / l) * reach, z: zone.z + (dz / l) * reach };
  }
  if (from && near && zone.shape === 'circle' && zone.by === 'centre') {
    // a wide zone (Wi-Fi): come in along the line to the Dot, no further than needed
    const dx = from.x - zone.x, dz = from.z - zone.z;
    const l = Math.hypot(dx, dz) || 1;
    want = { x: zone.x + (dx / l) * (zone.r - 40), z: zone.z + (dz / l) * (zone.r - 40) };
  }
  return freeSpot(kind, want, rot, obs, (p) => isNear(kind, p, rot) === near);
}

/** A free place for something new that was not dropped anywhere in particular: beside what is already there. */
export function dropSpot(kind: string, near: boolean, obs: readonly Rect[]): Pos {
  return spotFor(kind, near, 0, obs);
}

/** Gives every object without a place one (benches saved before the table existed): near things near, the rest parked. */
export function placeMissing<T extends { id: string; kind: string; near: boolean; pos?: Pos; rot?: Rot }>(objects: readonly T[]): (T & { pos: Pos; rot: Rot })[] {
  const done: Placed[] = [];
  const out: (T & { pos: Pos; rot: Rot })[] = [];
  for (const o of objects) {
    const rot: Rot = o.rot === 1 || o.rot === 2 || o.rot === 3 ? o.rot : 0;
    let pos = o.pos && Number.isFinite(o.pos.x) && Number.isFinite(o.pos.z) ? { x: o.pos.x, z: o.pos.z } : null;
    if (hasBody(o.kind)) {
      const obs = obstacles(done, '');
      if (!pos) pos = spotFor(o.kind, o.near, rot, obs);
      else if (!isFree(o.kind, pos, rot, obs)) pos = freeSpot(o.kind, pos, rot, obs);
      done.push({ id: o.id, kind: o.kind, pos, rot });
    }
    out.push({ ...o, pos: pos ?? { x: 0, z: 0 }, rot });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ radio

/** How much weaker a router is heard at the Dot because of where it stands on the table (dB, 0 right beside it). */
export function signalLoss(pos: Pos): number {
  const d = Math.hypot(pos.x - ANCHORS.wifi.x, pos.z - ANCHORS.wifi.z);
  return Math.round(Math.max(0, 26 * Math.log10(Math.max(d, 60) / 60)));
}
/** The signal the Dot sees: what the router is set to, less the loss over the distance, inside what the radio reports. */
export const signalAt = (base: number, pos: Pos | undefined): number => clamp(Math.round(base - (pos ? signalLoss(pos) : 0)), -95, -30);
