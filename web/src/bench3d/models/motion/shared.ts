/**
 * Shared builders of the motion family (motors, drivers, things that move). Everything here is built in code at real
 * dimensions (millimetres) and adds to a Shape, like the kit's own parts.ts; the ones marked KIT are candidates for it.
 */
import {
  Matrix4, PAL, PITCH, Shape, circleLoop, fromManifestMm, glowing, roundCorners, roundedRectLoop,
  type Finish, type ManifestBody, type ManifestPin, type Object3D, type PartState, type Pt, type V3,
} from '../../index';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------- the manifest
/** What the models of this family read of a part's manifest.json (imported as JSON, so its literals arrive as strings). */
export interface MotionManifest {
  id: string;
  name: { en: string };
  body: ManifestBody;
  picture: { width: number; height: number };
  pins: ManifestPin[];
  visuals?: { id: string; x: number; y: number; r?: number }[];
  behaviour?: { elements?: { type: string; steps_per_rev?: number }[] };
}
export const asManifest = (m: unknown): MotionManifest => m as MotionManifest;
/** Where a pin of the manifest is, in the model frame. */
export function pinAt(m: MotionManifest, name: string): V3 {
  const p = m.pins.find((q) => q.name === name);
  if (!p?.mm) throw new Error(`${m.id}: no pin "${name}" with a position`);
  return fromManifestMm(m.body, p.mm, p.face);
}
/** Where a visual of the manifest (given in picture pixels) is on the table plane of the model frame: [x, z]. */
export function visualAt(m: MotionManifest, id: string): [number, number] {
  const v = m.visuals?.find((q) => q.id === id);
  if (!v) throw new Error(`${m.id}: no visual "${id}"`);
  const k = m.picture.width / m.body.w_mm;
  return [v.x / k - m.body.w_mm / 2, v.y / k - m.body.d_mm / 2];
}

// --------------------------------------------------------------------------------------------------- live state
export const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};
/** Moves `cur` towards `target` by at most `step`. */
export const approach = (cur: number, target: number, step: number): number => (Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step);

/**
 * Degrees of a stepper's shaft from its live state: the part's unbounded `position` (in `unitsPerTurn` per turn) when
 * it is published, so that the shaft never has to guess which way round a wrapped angle went; else `angle`.
 */
export function stepperDegrees(st: PartState, unitsPerTurn: number): number {
  const p = st.outputs.position;
  return typeof p === 'number' && Number.isFinite(p) ? (p / unitsPerTurn) * 360 : num(st.outputs.angle);
}
/**
 * Eases the number kept under `key` of a copy's `userData` towards `target` (time constant 1 / `rate` seconds) and
 * returns it; the first call starts on the target. No allocation: for `animate`.
 */
export function follow(u: Record<string, unknown>, key: string, target: number, dt: number, rate = 24): number {
  const was = u[key];
  let cur = typeof was === 'number' ? was : target;
  const d = target - cur;
  cur = Math.abs(d) < 0.02 ? target : cur + d * Math.min(1, dt * rate);
  u[key] = cur;
  return cur;
}

// ------------------------------------------------------------------------------------------------------- frames
/** A frame whose local +Y runs along +X of the model (local X is down, local Z is Z): prisms and lathes lie along X. */
export const alongX = (x: number, y: number, z = 0): Matrix4 => new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationZ(-Math.PI / 2));
/** The same towards -X (local X is up). */
export const alongNegX = (x: number, y: number, z = 0): Matrix4 => new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationZ(Math.PI / 2));
/** A frame whose local +Y looks at the viewer (+Z): for things drawn on a front face. */
export const towardsZ = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationX(Math.PI / 2));
export const turnY = (quarter: number): Matrix4 => new Matrix4().makeRotationY((-quarter * Math.PI) / 2);

// ------------------------------------------------------------------------------------------------------- wiring
export const WIRE = { red: '#c8242c', black: '#1c1c1f', brown: '#8b5a2e', orange: '#ee7a1b', yellow: '#f0c419', blue: '#1b66c9', green: '#1f9d55', pink: '#e2679a', white: '#eceae4' } as const;
/** KIT: an insulated hook-up wire along `pts` (corners rounded). */
export function wire(s: Shape, colour: string, pts: V3[], o: { d?: number; bend?: number; seg?: number } = {}): void {
  s.tube('matte', colour, roundCorners(pts, o.bend ?? 1.6, 4), (o.d ?? 1.2) / 2, o.seg ?? 6);
}

/**
 * KIT: a crimp housing for 2.54 mm pins ("Dupont"), `n` ways along X, standing on pins: its mouths look DOWN onto a
 * pin strip and the wires leave from its top. Returns where each wire leaves (top of each way).
 */
export function crimpHousing(s: Shape, o: { x: number; z: number; y: number; n: number; turn?: number; h?: number; finish?: Finish }): V3[] {
  const h = o.h ?? 14;
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0));
  const out: V3[] = [];
  s.with(m, () => {
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * PITCH;
      s.box(...(o.finish ?? PAL.plasticBlack), px, 0, PITCH - 0.06, PITCH - 0.06, 0, h, 0.3, 0.3, { cap: true, ao: 0.92 });
      // the latch window of each contact
      brick(s, DARK, px, PITCH / 2 - 0.02, 1.3, 0.06, h * 0.55, h * 0.55 + 2.2);
    }
  });
  const e = m.elements;
  for (let i = 0; i < o.n; i++) {
    const px = (i - (o.n - 1) / 2) * PITCH;
    out.push([e[0] * px + e[12], o.y + h, e[2] * px + e[14]]);
  }
  return out;
}

/** KIT: a jumper cap bridging two 2.54 mm pins (along X before `turn`), sitting on the strip's plastic at height `y`. */
export function jumperCap(s: Shape, o: { x: number; z: number; y: number; turn?: number; finish?: Finish }): void {
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    s.box(...(o.finish ?? PAL.plasticBlue), 0, 0, 2 * PITCH - 0.2, PITCH - 0.1, 0, 6, 0.35, 0.4, { ao: 0.9 });
    brick(s, DARK, 0, 0, 2 * PITCH - 1.4, 0.7, 6, 6.02);
  });
}

// ---------------------------------------------------------------------------------------------- small SMD parts
/**
 * KIT: a plain four-cornered block standing on y0: 10 triangles (18 with a bevel), where `Shape.box` spends 38 to 58
 * on its rounded corners. For parts too small to show a corner radius: chip resistors, leads, pads, stripes.
 */
export function brick(s: Shape, finish: Finish, cx: number, cz: number, w: number, d: number, y0: number, y1: number, bevel = 0, cap = false): void {
  s.prism(...finish, [[cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2], [cx - w / 2, cz - d / 2]], y0, y1, bevel, { ao: 1, cap });
}
const DARK: Finish = ['matte', '#0c0c0d'];
/** KIT: a chip resistor or capacitor (0805 by default) lying along X before `turn`. */
export function chip(s: Shape, o: { x: number; z: number; y: number; turn?: number; l?: number; w?: number; h?: number; body?: Finish }): void {
  const l = o.l ?? 2.0, w = o.w ?? 1.25, h = o.h ?? 0.55;
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    brick(s, o.body ?? PAL.epoxyBlack, 0, 0, l - 0.7, w, 0, h, 0.06);
    for (const sx of [-1, 1]) brick(s, PAL.tin, sx * (l / 2 - 0.2), 0, 0.42, w + 0.04, 0, h + 0.02);
  });
}
/** KIT: the white body of an SMD LED (0805) lying along X; put a `lamp` of radii about [0.75, 0.3, 0.5] at y + 0.55 over it. */
export function smdLedBody(s: Shape, o: { x: number; z: number; y: number; turn?: number }): void {
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    brick(s, ['matte', '#e9e4d6'], 0, 0, 1.5, 1.2, 0, 0.45, 0.05);
    brick(s, PAL.tin, 0, 0, 2.2, 1.25, 0, 0.3); // its two pads in one piece
  });
}
/**
 * KIT: the lens of an SMD LED as a part that lights up (`setLamp(obj, name, colour, level)`): 18 triangles, where a
 * `lamp()` costs 320. Put it on `smdLedBody` at the same place.
 */
export function smdLedLens(name: string, o: { x: number; z: number; y: number; turn?: number }): Object3D {
  const s = new Shape();
  s.with(new Matrix4().makeTranslation(o.x, o.y + 0.45, o.z).multiply(turnY(o.turn ?? 0)), () => brick(s, ['matte', '#d9d3bf'], 0, 0, 1.25, 1.0, 0, 0.42, 0.14));
  return glowing(name, s);
}
/** KIT: an SMA / SOD rectifier diode lying along X, cathode bar towards -X. */
export function smdDiode(s: Shape, o: { x: number; z: number; y: number; turn?: number; l?: number; w?: number; h?: number }): void {
  const l = o.l ?? 4.3, w = o.w ?? 2.6, h = o.h ?? 2.1;
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    s.box(...PAL.epoxyBlack, 0, 0, l, w, 0.1, h, 0.1, 0.22, { ao: 0.95 });
    brick(s, ['matte', '#c9c9c4'], -l / 2 + 0.75, 0, 0.55, w - 0.3, h, h + 0.02);
    brick(s, PAL.tin, 0, 0, l + 1.2, 1.5, 0, 1.0); // both leads in one piece: the body hides the middle
  });
}
/** KIT: a SOT-23 transistor. */
export function sot23(s: Shape, o: { x: number; z: number; y: number; turn?: number }): void {
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    s.box(...PAL.epoxyBlack, 0, 0, 2.9, 1.3, 0.1, 1.05, 0.1, 0.15, { ao: 0.95 });
    for (const [px, pz] of [[-0.95, 1], [0.95, 1], [0, -1]] as Pt[]) brick(s, PAL.tin, px, pz * 0.95, 0.42, 0.7, 0, 0.5);
  });
}
/** KIT: a DIP package (2.54 mm pitch, rows 7.62 apart), pins along X; `socket` puts it in a socket. Returns the height of its top. */
export function dip(s: Shape, o: { x: number; z: number; y: number; pins: number; turn?: number; socket?: boolean }): number {
  const n = o.pins / 2, len = n * PITCH - 0.5;
  const base = o.socket ? 4.2 : 0.5;
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    if (o.socket) {
      // two rails of the socket and its end bars
      for (const sz of [-1, 1]) s.box(...PAL.plasticBlack, 0, sz * 3.81, len + 0.7, 2.3, 0, 4.2, 0.25, 0.2, { ao: 0.9 });
      for (const sx of [-1, 1]) s.box(...PAL.plasticBlack, sx * (len / 2 - 0.2), 0, 1.1, 6, 0, 2.6, 0.2, 0.2, { ao: 0.9 });
    }
    s.box(...PAL.epoxyBlack, 0, 0, len, 6.4, base, base + 3.3, 0.25, 0.35, { cap: true, ao: 0.95 });
    // the notch at the pin 1 end
    s.disc('matte', '#2c2c30', -len / 2 + 0.2, 0, 0.9, base + 3.3, base + 3.32, 0, 12, { ao: 1 });
    s.disc('matte', '#3a3a3f', -len / 2 + 1.6, 2.1, 0.4, base + 3.3, base + 3.32, 0, 10, { ao: 1 });
    for (const sz of [-1, 1]) for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * PITCH;
      brick(s, PAL.tin, px, sz * 3.5, 1.3, 0.7, base + 1.3, base + 1.75, 0, true);
      brick(s, PAL.tin, px, sz * 3.81, o.socket ? 0.5 : 1.2, 0.28, o.socket ? base - 0.6 : 0, base + 1.75);
    }
  });
  return o.y + base + 3.3;
}
/** KIT: a DPAK (TO-252) regulator lying on the board, its tab towards -Z before `turn`. Returns the height of its top. */
export function dpak(s: Shape, o: { x: number; z: number; y: number; turn?: number }): number {
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    s.box(...PAL.tin, 0, -3.4, 5.4, 1.6, 0, 0.55, 0.3, 0.08, { ao: 1 });
    s.box(...PAL.epoxyBlack, 0, 0, 6.6, 6.1, 0.05, 2.3, 0.3, 0.3, { ao: 0.95 });
    for (const sx of [-1, 1]) {
      brick(s, PAL.tin, sx * 2.28, 3.7, 0.8, 1.4, 0.55, 0.9, 0, true);
      brick(s, PAL.tin, sx * 2.28, 4.7, 0.8, 1.2, 0, 0.9, 0.1);
    }
    brick(s, PAL.tin, 0, 3.35, 0.8, 0.7, 0.55, 0.9, 0, true);
  });
  return o.y + 2.3;
}
/**
 * KIT: a shrouded wire-to-board header (JST XH style, 2.5 mm pitch), `n` ways along X, its latch wall towards +Z before
 * `turn`; with `plug`, the wire housing sits in it. Returns where each wire leaves: the top of the plug (or of the shroud).
 */
export function shroudedHeader(s: Shape, o: { x: number; z: number; y: number; n: number; turn?: number; pitch?: number; plug?: boolean; finish?: Finish }): V3[] {
  const pitch = o.pitch ?? 2.5, w = (o.n - 1) * pitch + 4.9, d = 5.75, h = 7;
  const fin = o.finish ?? PAL.plasticWhite;
  const top = o.plug ? h + 2.4 : h;
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0));
  s.with(m, () => {
    s.box(...fin, 0, 0, w, d, 0, 1.6, 0.3, 0.15, { ao: 0.92 });
    s.box(...fin, 0, -d / 2 + 0.4, w, 0.8, 1.6, h, 0.1, 0.2, { ao: 0.95 });
    for (const sx of [-1, 1]) s.box(...fin, sx * (w / 2 - 0.4), 0, 0.8, d, 1.6, h, 0.1, 0.2, { ao: 0.95 });
    // the latch wall is slotted: two posts
    for (const sx of [-1, 1]) s.box(...fin, sx * (w / 2 - 1.5), d / 2 - 0.4, 2.2, 0.8, 1.6, h, 0.1, 0.2, { ao: 0.95 });
    if (o.plug) {
      s.box(...PAL.paper, 0, 0, w - 1.9, d - 1.9, 1.6, top, 0.3, 0.3, { ao: 0.95 });
      for (let i = 0; i < o.n; i++) brick(s, DARK, (i - (o.n - 1) / 2) * pitch, d / 2 - 0.93, 1.3, 0.06, h + 0.3, top - 0.5);
    } else for (let i = 0; i < o.n; i++) brick(s, PAL.tin, (i - (o.n - 1) / 2) * pitch, 0, 0.64, 0.64, 1.6, 5.6, 0.1);
  });
  const e = m.elements;
  const out: V3[] = [];
  for (let i = 0; i < o.n; i++) {
    const px = (i - (o.n - 1) / 2) * pitch;
    out.push([e[0] * px + e[12], o.y + top, e[2] * px + e[14]]);
  }
  return out;
}
/** KIT: an extruded heatsink standing on end: a back plate (towards +Z before `turn`) with `fins` vertical fins behind it. */
export function finnedHeatsink(s: Shape, o: { x: number; z: number; y: number; w: number; d: number; h: number; fins: number; plate?: number; turn?: number; finish?: Finish }): void {
  const fin = o.finish ?? PAL.blackOxide, plate = o.plate ?? 2.6;
  s.with(new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(turnY(o.turn ?? 0)), () => {
    s.box(...fin, 0, o.d / 2 - plate / 2, o.w, plate, 0, o.h, 0.1, 0.25, { ao: 0.82 });
    const t = Math.min(1.5, (o.w / o.fins) * 0.5);
    for (let i = 0; i < o.fins; i++) s.box(...fin, -o.w / 2 + t / 2 + (i * (o.w - t)) / (o.fins - 1), -plate / 2, t, o.d - plate, 0, o.h, 0.1, 0.25, { ao: 0.72 });
  });
}
/** KIT: a cross-recessed screw head (pan head) standing on y, or lying along +X / +Z with a frame from `alongX` / `towardsZ`. */
export function screwHead(s: Shape, x: number, z: number, y: number, d = 2.4, h = 0.8, finish: Finish = PAL.steel): void {
  s.disc(...finish, x, z, d / 2, y, y + h, h * 0.55, 12, { ao: 1 });
  s.box('matte', '#3c3d42', x, z, d * 0.62, d * 0.16, y + h, y + h + 0.02, 0.03, 0, { ao: 1 });
  s.box('matte', '#3c3d42', x, z, d * 0.16, d * 0.62, y + h, y + h + 0.02, 0.03, 0, { ao: 1 });
}
/** A ring (washer, bushing lip, tyre of a hub) lying flat. */
export function ring(s: Shape, finish: Finish, x: number, z: number, r: number, bore: number, y0: number, y1: number, seg = 16, bevel = 0.1): void {
  s.prism(...finish, circleLoop(x, z, r, seg), y0, y1, bevel, { cap: true, ao: 1, holes: [circleLoop(x, z, bore, Math.max(8, seg - 4))] });
}
/** A plate with rounded corners and holes lying flat (a mounting ear, a faceplate). */
export function plate(s: Shape, finish: Finish, x: number, z: number, w: number, d: number, y0: number, y1: number, r: number, holes: { x: number; z: number; d: number }[] = [], bevel = 0.2): void {
  s.prism(...finish, roundedRectLoop(x, z, w, d, r, 3), y0, y1, bevel, { cap: true, ao: 0.95, holes: holes.map((h) => circleLoop(h.x, h.z, h.d / 2, 10)) });
}
