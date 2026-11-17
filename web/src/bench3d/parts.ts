/**
 * Reusable builders for electronic parts, at real dimensions (millimetres; sources: the usual datasheet drawings).
 * Each adds to a Shape at a place on a board and returns what a model needs next (where the pins end, where a wire
 * goes in). `turn` is quarter turns clockwise seen from above; 0 leaves the part's mouth or front facing +Z.
 */
import { Matrix4 } from 'three';
import { circleLoop, roundedRectLoop, type Pt } from '../lib/bodyModel';
import type { V3 } from '../device3d/meshBuilder';
import { PAL } from './materials';
import { Shape, type Finish } from './shape';

export const PITCH = 2.54;
const DEG = Math.PI / 180;

/** Translation then quarter turns: the frame of a part standing at (x, y, z). */
export const place = (x: number, y: number, z: number, turn = 0): Matrix4 => new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationY((-turn * Math.PI) / 2));
const moved = (m: Matrix4, x: number, y: number, z: number): V3 => {
  const e = m.elements;
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
};

// ---------------------------------------------------------------------------------------------------------- boards
export interface PcbOptions {
  w: number;
  d: number;
  x?: number;
  z?: number;
  /** Underside of the board (default 0: lying on the table; boards on pins or standoffs sit higher). */
  y?: number;
  thick?: number;
  r?: number;
  finish?: Finish;
  /** Drilled holes: mounting holes get a tinned ring. */
  holes?: { x: number; z: number; d: number; plated?: boolean }[];
}
/** A board: solder mask on both faces round an FR4 core, rounded corners, drilled holes. Returns the height of its top face. */
export function pcb(s: Shape, o: PcbOptions): number {
  const y = o.y ?? 0, t = o.thick ?? 1.6, x = o.x ?? 0, z = o.z ?? 0;
  const loop = roundedRectLoop(x, z, o.w, o.d, o.r ?? 1.5, 5);
  const holes = (o.holes ?? []).map((h) => circleLoop(h.x, h.z, h.d / 2, 14));
  const [fam, col] = o.finish ?? PAL.pcbGreen;
  s.prism(fam, col, loop, y, y + t, 0.12, { cap: true, ao: 0.9, holes });
  for (const h of o.holes ?? []) {
    if (h.plated === false) continue;
    s.prism(...PAL.tin, circleLoop(h.x, h.z, h.d / 2 + 0.9, 18), y + t, y + t + 0.04, 0, { holes: [circleLoop(h.x, h.z, h.d / 2, 14)], ao: 1 });
  }
  return y + t;
}

/** A round solder pad with its hole (a through-hole footprint without a part in it). */
export function pad(s: Shape, x: number, z: number, y: number, d = 1.9, drill = 1.0, finish: Finish = PAL.tin): void {
  s.prism(...finish, circleLoop(x, z, d / 2, 14), y, y + 0.04, 0, { holes: [circleLoop(x, z, drill / 2, 10)], ao: 1 });
}

// --------------------------------------------------------------------------------------------------------- headers
export interface HeaderOptions {
  x: number;
  z: number;
  /** Top face of the board the header is soldered to. */
  y: number;
  /** Pins along the row. */
  n: number;
  rows?: 1 | 2;
  turn?: number;
  /** Socket strip (true) or pin strip. */
  female?: boolean;
  /** Pin length above the plastic (male) or body height (female). */
  length?: number;
  finish?: Finish;
}
/**
 * A 2.54 mm header, its row along X (before `turn`), centred on (x, z). Returns where a wire attaches for each pin:
 * the tip of a pin, or the mouth of a socket, row by row.
 */
export function pinHeader(s: Shape, o: HeaderOptions): V3[] {
  const rows = o.rows ?? 1;
  const m = place(o.x, o.y, o.z, o.turn);
  const w = o.n * PITCH, d = rows * PITCH;
  const [fam, col] = o.finish ?? PAL.plasticBlack;
  const out: V3[] = [];
  s.with(m, () => {
    if (o.female) {
      const h = o.length ?? 8.5;
      s.box(fam, col, 0, 0, w, d, 0, h, 0.25, 0.3, { ao: 0.9 });
      for (let r = 0; r < rows; r++) for (let i = 0; i < o.n; i++) {
        const px = (i - (o.n - 1) / 2) * PITCH, pz = (r - (rows - 1) / 2) * PITCH;
        // the square mouth of each contact, and a glint of the spring inside
        s.box('matte', '#0c0c0d', px, pz, 1.25, 1.25, h, h + 0.02, 0.1, 0, { ao: 1 });
        s.box(...PAL.gold, px, pz, 0.5, 0.5, h + 0.02, h + 0.03, 0.05, 0, { ao: 1 });
        s.box(...PAL.tin, px, pz, 0.6, 0.6, -2.6, 0, 0.05, 0.1, { cap: true });
      }
    } else {
      const len = o.length ?? 6;
      // the strip is notched between pins: one bevelled block per pin
      for (let i = 0; i < o.n; i++) s.box(fam, col, (i - (o.n - 1) / 2) * PITCH, 0, PITCH - 0.1, d - 0.1, 0, 2.5, 0.35, 0.3, { ao: 0.9 });
      for (let r = 0; r < rows; r++) for (let i = 0; i < o.n; i++) {
        const px = (i - (o.n - 1) / 2) * PITCH, pz = (r - (rows - 1) / 2) * PITCH;
        s.box(...PAL.gold, px, pz, 0.64, 0.64, -2.8, 2.5 + len, 0.06, 0.18, { cap: true, ao: 0.92 });
      }
    }
  });
  const top = o.female ? (o.length ?? 8.5) : 2.5 + (o.length ?? 6);
  for (let r = 0; r < rows; r++) for (let i = 0; i < o.n; i++) out.push(moved(m, (i - (o.n - 1) / 2) * PITCH, top, (r - (rows - 1) / 2) * PITCH));
  return out;
}

// ----------------------------------------------------------------------------------------------------------- leads
/** A polyline with its corners rounded to `radius` (for a bent lead or a dressed wire). */
export function roundCorners(pts: V3[], radius: number, seg = 4): V3[] {
  if (pts.length < 3) return pts;
  const out: V3[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), lc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
    const r = Math.min(radius, la / 2, lc / 2);
    const p0: V3 = [b[0] + ((a[0] - b[0]) / la) * r, b[1] + ((a[1] - b[1]) / la) * r, b[2] + ((a[2] - b[2]) / la) * r];
    const p1: V3 = [b[0] + ((c[0] - b[0]) / lc) * r, b[1] + ((c[1] - b[1]) / lc) * r, b[2] + ((c[2] - b[2]) / lc) * r];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p1[1], u * u * p0[2] + 2 * u * t * b[2] + t * t * p1[2]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
/** A through-hole lead: a round wire along `pts`, bent with a radius where it turns. */
export function lead(s: Shape, pts: V3[], o: { d?: number; bend?: number; finish?: Finish } = {}): void {
  s.tube(...(o.finish ?? PAL.tin), roundCorners(pts, o.bend ?? 0.9), (o.d ?? 0.6) / 2, 6);
}
/**
 * The two leads of an axial part lying at height `y` along X between x0 and x1 (a resistor, a diode): out of the body's
 * ends, bent down into holes `span` apart. Returns the two hole positions on the board (at board height `board`).
 */
export function axialLeads(s: Shape, o: { x0: number; x1: number; z: number; y: number; span: number; board: number; d?: number }): [V3, V3] {
  const mid = (o.x0 + o.x1) / 2;
  const a = mid - o.span / 2, b = mid + o.span / 2;
  lead(s, [[o.x0, o.y, o.z], [a, o.y, o.z], [a, o.board - 2.5, o.z]], { d: o.d });
  lead(s, [[o.x1, o.y, o.z], [b, o.y, o.z], [b, o.board - 2.5, o.z]], { d: o.d });
  return [[a, o.board, o.z], [b, o.board, o.z]];
}

// ----------------------------------------------------------------------------------------------------------- chips
interface ChipAt {
  x: number;
  z: number;
  /** Top face of the board. */
  y: number;
  turn?: number;
}
function pinOne(s: Shape, x: number, z: number, y: number): void {
  s.disc('matte', '#3a3a3f', x, z, 0.35, y, y + 0.02, 0, 10, { ao: 1 });
}
/** SOIC: a black body with gull-wing leads on two sides, 1.27 mm pitch. `pins` is the total (8, 14, 16 ...). Rows along X. */
export function soic(s: Shape, o: ChipAt & { pins: number; bodyW?: number; pitch?: number }): void {
  const n = o.pins / 2, pitch = o.pitch ?? 1.27, bw = o.bodyW ?? 3.9;
  const len = n * pitch + 0.6;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, len, bw, 0.12, 1.6, 0.2, 0.28, { cap: true, ao: 0.95 });
    pinOne(s, -len / 2 + 0.8, bw / 2 - 0.8, 1.6);
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * pitch;
      // shoulder, then the foot on the pad
      s.box(...PAL.tin, px, side * (bw / 2 + 0.3), 0.42, 0.7, 0.7, 0.92, 0.04, 0.05, { cap: true, ao: 1 });
      s.box(...PAL.tin, px, side * (bw / 2 + 0.85), 0.42, 0.75, 0, 0.92, 0.04, 0.12, { ao: 0.9 });
    }
  });
}
/** QFP: a square body with leads on all four sides. */
export function qfp(s: Shape, o: ChipAt & { size: number; perSide: number; pitch?: number; h?: number }): void {
  const pitch = o.pitch ?? 0.8, h = o.h ?? 1.2;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, o.size, o.size, 0.1, h, 0.5, 0.3, { cap: true, ao: 0.95 });
    pinOne(s, -o.size / 2 + 1, o.size / 2 - 1, h);
    for (let q = 0; q < 4; q++) {
      s.with(new Matrix4().makeRotationY((q * Math.PI) / 2), () => {
        for (let i = 0; i < o.perSide; i++) s.box(...PAL.tin, (i - (o.perSide - 1) / 2) * pitch, o.size / 2 + 0.5, pitch * 0.45, 1.0, 0, 0.55, 0.03, 0.12, { ao: 0.9 });
      });
    }
  });
}
/** QFN: a flat body, the pads only show as tinned marks along its edges. */
export function qfn(s: Shape, o: ChipAt & { size: number; perSide: number; pitch?: number }): void {
  const pitch = o.pitch ?? 0.5;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, o.size, o.size, 0.03, 0.85, 0.15, 0.1, { ao: 0.95 });
    pinOne(s, -o.size / 2 + 0.7, o.size / 2 - 0.7, 0.85);
    for (let q = 0; q < 4; q++) {
      s.with(new Matrix4().makeRotationY((q * Math.PI) / 2), () => {
        // the pads only show as tinned marks at the foot of the body: flat, two triangles each
        for (let i = 0; i < o.perSide; i++) s.rect(...PAL.tin, (i - (o.perSide - 1) / 2) * pitch, o.size / 2 + 0.07, pitch * 0.5, 0.26, 0.03);
      });
    }
  });
}
/**
 * A radio module: a small board with a tinned shield can, and room for an antenna at its far end (-Z before `turn`)
 * that the model prints as a meander. Returns the height of the can's top (for a label print).
 */
export function moduleCan(s: Shape, o: ChipAt & { w: number; d: number; canD: number; h?: number; finish?: Finish }): number {
  const h = o.h ?? 2.4;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...(o.finish ?? PAL.pcbBlack), 0, 0, o.w, o.d, 0, 0.8, 0.4, 0.08, { ao: 0.95 });
    const cz = o.d / 2 - o.canD / 2 - 0.6;
    s.box(...PAL.tin, 0, cz, o.w - 1.4, o.canD, 0.8, 0.8 + h, 0.7, 0.35, { ao: 0.88 });
    // castellated pads along both long edges
    const n = Math.floor((o.d - 2) / 1.27);
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) s.box(...PAL.gold, side * (o.w / 2 - 0.35), -o.d / 2 + 1.4 + i * 1.27, 0.7, 0.7, 0.8, 0.83, 0.1, 0, { ao: 1 });
  });
  return o.y + 0.8 + h;
}

// ------------------------------------------------------------------------------------------------------ connectors
/** Turns a prism so that what was its top looks at +Z: for parts whose shape is drawn on their front face. */
const FRONT = new Matrix4().makeRotationX(90 * DEG);
const stadium = (w: number, h: number): Pt[] => roundedRectLoop(0, 0, w, h, h / 2, 6);

/** USB-C receptacle (8.94 x 3.26 mm mouth, 7.3 deep), its mouth flush with z = `z` facing +Z before `turn`. Returns the mouth centre. */
export function usbC(s: Shape, o: ChipAt): V3 {
  const m = place(o.x, o.y, o.z, o.turn);
  s.with(m.clone().multiply(new Matrix4().makeTranslation(0, 1.63, 0)).multiply(FRONT), () => {
    s.prism(...PAL.tin, stadium(8.94, 3.26), -7.3, 0, 0.25, { cap: true, ao: 0.9 });
    s.prism('matte', '#0b0b0c', stadium(8.2, 2.5), 0, 0.03, 0, { ao: 1 });
    s.prism(...PAL.plasticBlack, stadium(6.7, 0.7), 0.03, 0.05, 0, { ao: 1 });
  });
  return moved(m, 0, 1.63, 0);
}
/** Micro-USB receptacle (7.5 x 2.6 mm, 5.5 deep). */
export function microUsb(s: Shape, o: ChipAt): V3 {
  const m = place(o.x, o.y, o.z, o.turn);
  const mouth: Pt[] = [[-3.75, -1.3], [3.75, -1.3], [3.75, 0.3], [2.9, 1.3], [-2.9, 1.3], [-3.75, 0.3]];
  s.with(m.clone().multiply(new Matrix4().makeTranslation(0, 1.3, 0)).multiply(FRONT), () => {
    s.prism(...PAL.tin, mouth, -5.5, 0, 0.2, { cap: true, ao: 0.9 });
    s.prism('matte', '#0b0b0c', mouth.map(([x, y]) => [x * 0.86, y * 0.72] as Pt), 0, 0.03, 0, { ao: 1 });
    s.prism(...PAL.plasticBlack, roundedRectLoop(0, -0.25, 4.6, 0.5, 0.1, 2), 0.03, 0.05, 0, { ao: 1 });
  });
  return moved(m, 0, 1.3, 0);
}
/** USB-B receptacle (12 x 11 mm face, 16 deep): the square printer socket of an Uno. */
export function usbB(s: Shape, o: ChipAt): V3 {
  const m = place(o.x, o.y, o.z, o.turn);
  s.with(m.clone().multiply(new Matrix4().makeTranslation(0, 5.5, 0)).multiply(FRONT), () => {
    s.prism(...PAL.tin, roundedRectLoop(0, 0, 12, 11, 0.6, 3), -16, 0, 0.35, { cap: true, ao: 0.88 });
    s.prism('matte', '#0b0b0c', roundPolyMouth(), 0, 0.03, 0, { ao: 1 });
    s.prism(...PAL.plasticWhite, roundedRectLoop(0, 0.2, 5.4, 2.9, 0.3, 2), 0.03, 0.06, 0, { ao: 1 });
  });
  return moved(m, 0, 5.5, 0);
}
function roundPolyMouth(): Pt[] {
  // the B mouth: square with the two upper corners cut
  return [[-4.2, 3.9], [4.2, 3.9], [4.2, -2.2], [2.9, -3.8], [-2.9, -3.8], [-4.2, -2.2]];
}
/** DC barrel jack (9 x 11 mm face, 14.2 deep), 5.5 mm barrel. */
export function barrelJack(s: Shape, o: ChipAt): V3 {
  const m = place(o.x, o.y, o.z, o.turn);
  s.with(m, () => s.box(...PAL.plasticBlack, 0, -7.1, 9, 14.2, 0, 11, 0.6, 0.5, { ao: 0.88 }));
  s.with(m.clone().multiply(new Matrix4().makeTranslation(0, 6.2, 0)).multiply(FRONT), () => {
    s.prism('matte', '#070708', circleLoop(0, 0, 3.15, 20), 0, 0.03, 0, { ao: 1 });
    s.prism(...PAL.tin, circleLoop(0, 0, 1.05, 12), 0.03, 0.06, 0, { ao: 1 });
  });
  return moved(m, 0, 6.2, 0);
}

// ----------------------------------------------------------------------------------------------------- small parts
/** A 6 mm tactile switch: metal cover, round plunger. The plunger is static here; a model that shows presses builds its own cap. */
export function tactButton(s: Shape, o: ChipAt & { size?: number; plunger?: number; cap?: Finish }): void {
  const sz = o.size ?? 6;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.plasticBlack, 0, 0, sz, sz, 0, 3.1, 0.4, 0.25, { ao: 0.9 });
    s.box(...PAL.tin, 0, 0, sz - 0.3, sz - 0.3, 3.1, 3.45, 0.6, 0.12, { ao: 1 });
    s.disc(...(o.cap ?? PAL.plasticBlack), 0, 0, 1.75, 3.45, 3.45 + (o.plunger ?? 1.5), 0.3, 16, { ao: 0.9 });
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) s.box(...PAL.tin, sx * (sz / 2 + 0.5), sz2 * (sz / 2 - 1.2), 1.2, 0.7, 0, 1.0, 0.05, 0.15, { ao: 0.9 });
  });
}
/** A radial electrolytic capacitor standing on the board: sleeve, score on the aluminium top, the negative stripe facing +Z. */
export function electrolytic(s: Shape, o: ChipAt & { d?: number; h?: number; sleeve?: Finish }): void {
  const r = (o.d ?? 6.3) / 2, h = o.h ?? 11;
  const [fam, col] = o.sleeve ?? (['gloss', '#1d2a44'] as const);
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.disc(...PAL.rubber, 0, 0, r - 0.25, 0, 0.5, 0.1, 20, { ao: 1 });
    s.lathe(fam, col, 0, 0, [[r, 0.4], [r, 1.2], [r - 0.18, 1.5], [r, 1.8], [r, h - 0.5], [r - 0.45, h]], 22);
    s.disc(...PAL.aluminium, 0, 0, r - 0.45, h - 0.2, h, 0.08, 20, { ao: 1 });
    s.band('matte', '#d9dce1', 0, 0, r, 2.2, h - 1, Math.PI / 2 - 0.42, Math.PI / 2 + 0.42, 6);
  });
}
/**
 * The body of a round LED (3 or 5 mm): a domed lens on a flange, as a separate Shape to hand to `glowing()` so it can
 * light up. Its leads are static: add them with `ledLeads`.
 */
export function ledDome(o: { x: number; z: number; y: number; d?: number; h?: number; resin?: Finish; seg?: number }): Shape {
  const r = (o.d ?? 5) / 2;
  const s = new Shape();
  const [fam, col] = o.resin ?? PAL.resinRed;
  // total height: 8.6 mm for a 5 mm LED, 5.3 mm for a 3 mm one
  const straight = Math.max(0.2, (o.h ?? (o.d ?? 5) * 1.72) - 1 - r);
  const prof: [number, number][] = [[r + 0.45, o.y], [r + 0.45, o.y + 1], [r, o.y + 1.02], [r, o.y + 1 + straight]];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push([r * Math.cos(a), o.y + 1 + straight + r * Math.sin(a)]);
  }
  s.lathe(fam, col, o.x, o.z, prof, o.seg ?? 18);
  return s;
}
/** The two leads of a radial part (an LED, a capacitor) going down from height `y` into the board; returns the two entry points [anode-side -X, cathode-side +X]. */
export function ledLeads(s: Shape, o: { x: number; z: number; y: number; board: number; pitch?: number }): [V3, V3] {
  const p = (o.pitch ?? PITCH) / 2;
  for (const sx of [-1, 1]) s.box(...PAL.tin, o.x + sx * p, o.z, 0.5, 0.5, o.board - 2.5, o.y, 0.05, 0, { cap: true, ao: 0.95 });
  return [[o.x - p, o.board, o.z], [o.x + p, o.board, o.z]];
}
/** A screw terminal block, `n` ways along X at 5.08 mm, wire entries facing +Z before `turn`. Returns where each wire goes in. */
export function screwTerminal(s: Shape, o: ChipAt & { n: number; pitch?: number; finish?: Finish }): V3[] {
  const pitch = o.pitch ?? 5.08;
  const m = place(o.x, o.y, o.z, o.turn);
  const out: V3[] = [];
  const [fam, col] = o.finish ?? PAL.plasticBlue;
  s.with(m, () => {
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * pitch;
      s.box(fam, col, px, 0, pitch - 0.12, 7.6, 0, 10, 0.3, 0.45, { ao: 0.88 });
      s.disc(...PAL.tin, px, -0.6, 1.75, 10, 10.02, 0, 14, { ao: 1 });
      s.box('matte', '#3c3d42', px, -0.6, 2.9, 0.55, 10.02, 10.04, 0.1, 0, { ao: 1 });
    }
  });
  for (let i = 0; i < o.n; i++) {
    const px = (i - (o.n - 1) / 2) * pitch;
    s.with(m.clone().multiply(new Matrix4().makeTranslation(px, 3.4, 3.8)).multiply(FRONT), () => {
      s.prism('matte', '#101012', roundedRectLoop(0, 0, 3.2, 3.2, 0.3, 2), 0, 0.03, 0, { ao: 1 });
      s.prism(...PAL.tin, roundedRectLoop(0, -1.2, 2.8, 0.6, 0.1, 2), 0.03, 0.05, 0, { ao: 1 });
    });
    out.push(moved(m, px, 3.4, 3.8));
  }
  return out;
}
/** A finned heatsink: fins along Z. */
export function heatsink(s: Shape, o: ChipAt & { w: number; d: number; h: number; fins: number; finish?: Finish }): void {
  const fin = o.finish ?? PAL.blackOxide;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...fin, 0, 0, o.w, o.d, 0, 1.6, 0.3, 0.2, { ao: 0.9 });
    const t = Math.min(1.1, (o.w / o.fins) * 0.45);
    for (let i = 0; i < o.fins; i++) s.box(...fin, -o.w / 2 + t / 2 + (i * (o.w - t)) / (o.fins - 1), 0, t, o.d, 1.6, o.h, 0.15, 0.2, { ao: 0.8 });
  });
}
/** A vertical shaft, optionally with a D flat (towards +Z). */
export function shaft(s: Shape, o: { x: number; z: number; y0: number; y1: number; d: number; flat?: number; finish?: Finish }): void {
  const r = o.d / 2;
  let loop = circleLoop(o.x, o.z, r, 18);
  if (o.flat) loop = loop.map(([x, z]) => [x, Math.min(z, o.z + r - o.flat!)] as Pt);
  s.prism(...(o.finish ?? PAL.steel), loop, o.y0, o.y1, 0.2, { cap: true, ao: 0.95 });
}
/** A spur gear lying flat: `teeth` teeth on a pitch radius `r`, with a bore. */
export function gear(s: Shape, o: { x: number; z: number; y0: number; y1: number; r: number; teeth: number; bore?: number; finish?: Finish }): void {
  const loop: Pt[] = [];
  const depth = Math.min(o.r * 0.22, (Math.PI * o.r) / o.teeth);
  for (let i = 0; i < o.teeth; i++) {
    const a = (i / o.teeth) * Math.PI * 2, step = (Math.PI * 2) / o.teeth;
    for (const [f, rr] of [[0.0, o.r - depth / 2], [0.18, o.r + depth / 2], [0.42, o.r + depth / 2], [0.6, o.r - depth / 2]] as const) loop.push([o.x + Math.cos(a + f * step) * rr, o.z + Math.sin(a + f * step) * rr]);
  }
  s.prism(...(o.finish ?? PAL.plasticWhite), loop, o.y0, o.y1, 0.12, { cap: true, ao: 0.9, holes: o.bore ? [circleLoop(o.x, o.z, o.bore / 2, 14)] : [] });
}
