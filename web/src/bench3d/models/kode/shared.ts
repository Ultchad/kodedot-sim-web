/**
 * Shared builders of the Kode module family (the add-on modules that plug onto the Dot's 2x10 expansion header J3).
 *
 * The family's look, read off the owner's reference pictures (never copied): a matte black board whose four corners
 * swell into round ears round the mounting holes, amber silkscreen, black sockets, a 2x10 right-angle pin header at
 * the edge that meets the Dot (the three bare-board modules); a moulded block with a tongue, in the Dot's own
 * plastic, with two whip antennas (the two cased modules, case.ts).
 *
 * HOW A MODULE MEETS THE DOT is the manifest's: `mount.connector` gives where the 2x10 seats (`seat_mm`), which way
 * the pins point and how long they are, and every pin is a terminal with its own height. The models build the
 * connector from those numbers; `mount.placement` tells a host how to turn the part onto the Dot.
 *
 * Candidates for the kit (parts.ts): `outlineBoard` (a board with any outline), `rightAngleHeader`, `socketStrip`
 * and `pinStrip` (lean strips, for boards that lie flat on the table: no tails under the board), `screwBlock`,
 * `chipPassive`, `sot23`, `fpcConnector`, `whipAntenna`, `moulding` (a solid with real fillets from a side profile).
 */
import { ShapeUtils, Vector2 } from 'three';
import { Matrix4, PAL, PITCH, Shape, circleLoop, fromManifestMm, type Finish, type ManifestBody, type ManifestPin, type Pt, type V3 } from '../../index';

// ------------------------------------------------------------------------------------------------- the manifest
/** What the models of this family read of parts/<id>/manifest.json. */
export interface KodeManifest {
  id: string;
  body: ManifestBody;
  pins: readonly (ManifestPin & { abs_max_mv?: number; ref?: string })[];
  mount?: {
    via: string;
    orientations: readonly string[];
    pins: readonly { pin: string; gpio: number }[];
    rails: readonly { pin: string; rail: string }[];
    /** The 2x10 mating connector: where it seats, the way its pins point ('+y': out of the near edge, '-z': down). */
    connector?: { seat_mm: { x: number; y: number; z: number }; pin_dir: string; pin_length_mm: number };
  };
  /** Terminals that are one net on the board. */
  groups?: readonly { pins: readonly string[] }[];
  /** The side silhouette of a moulded housing: points (y: depth from the back, z: height), in manifest millimetres. */
  profile?: readonly { y: number; z: number }[];
  /** Reference points that are not terminals (the antenna jacks of the cased modules). */
  refs?: readonly { name: string; kind: string; mm: { x: number; y: number; z: number }; length_mm?: number }[];
}
/** A JSON import as the manifest type (JSON widens `face` to string). */
export const asManifest = (m: unknown): KodeManifest => m as KodeManifest;

/** Every pin of a manifest as a point of the model frame, by name. */
export function pinPoints(m: KodeManifest): Record<string, V3> {
  const out: Record<string, V3> = {};
  for (const p of m.pins) if (p.mm) out[p.name] = fromManifestMm(m.body, p.mm, p.face);
  return out;
}
/** The pins of the mating connector (the manifest marks each with `ref`: "J401.7", "KDINT.12"), as model points. */
export function connectorPins(m: KodeManifest): V3[] {
  return m.pins.filter((p) => p.mm && /^(J401|KDINT)\./.test(p.ref ?? '')).map((p) => fromManifestMm(m.body, p.mm!, p.face));
}
/**
 * The mating connector in the model frame: `seat` is the point of the manifest (the middle of the pin field where
 * the plastic ends), `length` how far the pins go on from there.
 */
export function connectorOf(m: KodeManifest): { seat: V3; length: number; dir: string } {
  const c = m.mount?.connector;
  if (c) return { seat: fromManifestMm(m.body, c.seat_mm), length: c.pin_length_mm, dir: c.pin_dir };
  // an older manifest: the pins' own middle, taken as half way along 8 mm pins leaving the near edge
  const pts = connectorPins(m);
  const mid = (k: number) => (Math.min(...pts.map((p) => p[k])) + Math.max(...pts.map((p) => p[k]))) / 2;
  return { seat: [mid(0), mid(1), mid(2) - 4], length: 8, dir: '+y' };
}

// ---------------------------------------------------------------------------------------------------- transforms
/** Turns a prism so that its height runs along +Z and what was -Z looks up: for pins and connectors lying flat. */
export const LYING = new Matrix4().makeRotationX(Math.PI / 2);
/** Turns a prism so that its height runs along +X: a profile drawn in (z, y) extruded across the part. */
export const alongX = (): Matrix4 => new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const square = (x: number, z: number, a: number): Pt[] => [[x + a, z - a], [x + a, z + a], [x - a, z + a], [x - a, z - a]];
const rect = (x: number, z: number, w: number, d: number): Pt[] => [[x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2], [x - w / 2, z - d / 2]];

// -------------------------------------------------------------------------------------------------------- boards
export interface OutlineOptions {
  /** The box the outline touches: x0..x1, z0..z1 (z0 is the far edge). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Radius of the corner ears. */
  ear: number;
  /** How far the straight edges stand back from the box: far (-Z), near (+Z) and the two sides. */
  inset: { far: number; near: number; side: number };
  /** Radius of the hollow that joins an ear to an edge. */
  blend?: number;
}
/**
 * The outline of a Kode module board: a rectangle whose corners swell into round ears (each holds a mounting hole),
 * joined to the straight edges by a hollow. Returns the loop and the four ear centres.
 */
export function earOutline(o: OutlineOptions, seg = 5): { loop: Pt[]; ears: Pt[] } {
  const f = o.blend ?? 3, R = o.ear;
  // one corner in its own frame: the box corner at (0, 0), the board towards (-, -); u is the first edge met
  const corner = (insetU: number, insetV: number): Pt[] => {
    const out: Pt[] = [];
    const c: Pt = [-R, -R];
    const leg = (inset: number) => {
      const a = R - inset + f;
      return { a, d: Math.sqrt(Math.max(0, (R + f) * (R + f) - a * a)), phi: Math.atan2(Math.sqrt(Math.max(0, (R + f) * (R + f) - a * a)), a) };
    };
    const l1 = leg(insetU), l2 = leg(insetV);
    // hollow from the edge x = -insetU up to the ear
    const f1: Pt = [-insetU + f, c[1] - l1.d];
    for (let i = 0; i <= seg; i++) {
      const t = Math.PI - (l1.phi * i) / seg;
      out.push([f1[0] + f * Math.cos(t), f1[1] + f * Math.sin(t)]);
    }
    // the ear
    const a0 = -l1.phi, a1 = Math.PI / 2 + l2.phi, n = Math.max(6, Math.round(seg * 2.4));
    for (let i = 1; i < n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      out.push([c[0] + R * Math.cos(t), c[1] + R * Math.sin(t)]);
    }
    // hollow down to the edge z = -insetV
    const f2: Pt = [c[0] - l2.d, -insetV + f];
    for (let i = 0; i <= seg; i++) {
      const t = l2.phi - Math.PI / 2 - (l2.phi * i) / seg;
      out.push([f2[0] + f * Math.cos(t), f2[1] + f * Math.sin(t)]);
    }
    return out;
  };
  const loop: Pt[] = [];
  const nearRight = corner(o.inset.side, o.inset.near); // box corner (x1, z1): from the right edge round to the near edge
  const farRight = corner(o.inset.side, o.inset.far);
  for (const [px, pz] of nearRight) loop.push([o.x1 + px, o.z1 + pz]);
  for (const [px, pz] of [...nearRight].reverse()) loop.push([o.x0 - px, o.z1 + pz]);
  for (const [px, pz] of farRight) loop.push([o.x0 - px, o.z0 - pz]);
  for (const [px, pz] of [...farRight].reverse()) loop.push([o.x1 + px, o.z0 - pz]);
  return { loop, ears: [[o.x0 + R, o.z0 + R], [o.x1 - R, o.z0 + R], [o.x0 + R, o.z1 - R], [o.x1 - R, o.z1 - R]] };
}
/**
 * A board with any outline: solder mask round an FR4 core, drilled holes with their tinned rings. Returns the height
 * of its top face. (The kit's `pcb` is this with a rounded rectangle.)
 */
export function outlineBoard(s: Shape, o: { loop: Pt[]; y?: number; thick?: number; finish?: Finish; holes?: { x: number; z: number; d: number }[]; ring?: Finish }): number {
  const y = o.y ?? 0, t = o.thick ?? 1.6;
  const holes = (o.holes ?? []).map((h) => circleLoop(h.x, h.z, h.d / 2, 14));
  s.prism(...(o.finish ?? PAL.pcbBlack), o.loop, y, y + t, 0.12, { cap: true, ao: 0.9, holes });
  for (const h of o.holes ?? []) s.prism(...(o.ring ?? PAL.gold), circleLoop(h.x, h.z, h.d / 2 + 0.6, 18), y + t, y + t + 0.04, 0, { holes: [circleLoop(h.x, h.z, h.d / 2, 14)], ao: 1 });
  return y + t;
}

// ------------------------------------------------------------------------------------------------------- headers
/** The boards' silkscreen as the pictures show it: a warm gold, a little softer than the kit's amber ink. */
export const SILK = '#f0a83e';
/** The bright tin of the modules' header pins (the pictures show them almost white). */
export const PIN_TIN: Finish = ['metal', '#e3e5e9'];
/**
 * A 2-row right-angle pin header (the modules' J401): the plastic stands on the board with its face at z = `z`, the
 * pins leave along +Z in two layers (1.27 and 3.81 mm above the board) and turn down into gold pads behind the
 * plastic. `n` pins per row along X, centred on `x`; `tail` is how far the legs go below the board's top (a board
 * that lies on the table has none below it).
 */
export function rightAngleHeader(s: Shape, o: { x: number; y: number; z: number; n: number; length?: number; pins?: Finish; tail?: number }): void {
  const len = o.length ?? 6, pins = o.pins ?? PIN_TIN, a = 0.32, tail = o.tail ?? 2.6;
  s.at(o.x, o.y, o.z, () => {
    // the strip is notched between pins, like the straight one
    for (let i = 0; i < o.n; i++) s.box(...PAL.plasticBlack, (i - (o.n - 1) / 2) * PITCH, -PITCH / 2, PITCH - 0.1, PITCH, 0, 2 * PITCH, 0.3, 0.3, { ao: 0.9 });
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * PITCH;
      for (let r = 0; r < 2; r++) {
        const py = PITCH / 2 + r * PITCH, back = -PITCH - 1.3 - r * PITCH;
        s.with(LYING, () => s.prism(...pins, square(px, -py, a), back - a, len, 0.16, { ao: 1 }));
        s.prism(...pins, square(px, back, a), -tail, py + a, 0.1, { ao: 0.95 });
        s.prism(...PAL.gold, circleLoop(px, back, 0.95, 8), 0, 0.05, 0, { ao: 1 });
      }
    }
  });
}

/**
 * A female socket strip, `n` contacts along X (before `turn`), one or two rows, centred on (x, z), standing on a board
 * whose top is `y`. Leaner than the kit's `pinHeader({ female })`: one body, a mouth and a glint per contact.
 */
export function socketStrip(s: Shape, o: { x: number; z: number; y: number; n: number; rows?: 1 | 2; turn?: number; h?: number; finish?: Finish }): void {
  const rows = o.rows ?? 1, h = o.h ?? 8.5;
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationY((-(o.turn ?? 0) * Math.PI) / 2));
  s.with(m, () => {
    s.box(...(o.finish ?? PAL.plasticBlack), 0, 0, o.n * PITCH, rows * PITCH, 0, h, 0.3, 0.3, { ao: 0.88 });
    for (let r = 0; r < rows; r++) for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * PITCH, pz = (r - (rows - 1) / 2) * PITCH;
      s.prism('matte', '#0a0a0b', square(px, pz, 0.68), h, h + 0.03, 0, { ao: 1 });
      s.prism(...PAL.gold, square(px, pz, 0.27), h + 0.03, h + 0.05, 0, { ao: 1 });
    }
  });
}
/** A straight male pin strip, `n` pins along X (before `turn`), on a board whose top is `y`: notched plastic, square pins. */
export function pinStrip(s: Shape, o: { x: number; z: number; y: number; n: number; turn?: number; length?: number; pins?: Finish }): void {
  const len = o.length ?? 6, pins = o.pins ?? PIN_TIN;
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationY((-(o.turn ?? 0) * Math.PI) / 2));
  s.with(m, () => {
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * PITCH;
      s.box(...PAL.plasticBlack, px, 0, PITCH - 0.1, PITCH - 0.1, 0, 2.5, 0.35, 0.3, { ao: 0.9 });
      s.prism(...pins, square(px, 0, 0.32), 2.5, 2.5 + len, 0.18, { ao: 0.95 });
    }
  });
}
/** A strip laid from its first to its last contact (two terminals of the manifest): finds the middle and the turn. */
export function stripBetween(a: V3, b: V3): { x: number; z: number; turn: number } {
  return { x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, turn: Math.abs(a[0] - b[0]) >= Math.abs(a[2] - b[2]) ? 0 : 1 };
}

/**
 * A screw terminal block as on the Robotics module: a plain black block, one big bright slotted screw per way on
 * top, the wire entries on the far face (-Z, the board's edge) and the small clamp windows on the near face.
 * `n` ways along X centred on `x`, the screws on the line z = `z`. Sizes follow the pitch (5.08 mm: 7.6 deep, 9.5 high).
 */
export function screwBlock(s: Shape, o: { x: number; z: number; y: number; n: number; pitch?: number; finish?: Finish; seg?: number }): { h: number; r: number } {
  const pitch = o.pitch ?? 5.08, w = o.n * pitch, fin = o.finish ?? PAL.plasticBlack;
  const d = pitch * 1.5, h = pitch * 1.85, r = pitch * 0.31, seg = o.seg ?? 16;
  s.at(o.x, o.y, o.z, () => {
    s.box(...fin, 0, 0, w, d, 0, h, 0.35, 0.45, { ao: 0.9 });
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * pitch;
      // the screw's well (the screw itself is the model's, so that it can show a live output)
      s.disc('matte', '#070708', px, 0, r + 0.35, h, h + 0.03, 0, seg, { ao: 1 });
      // wire entry on the far face, clamp window on the near one
      s.with(new Matrix4().makeTranslation(px, h * 0.36, -d / 2).multiply(new Matrix4().makeRotationX(-Math.PI / 2)), () => {
        s.prism('matte', '#060607', rect(0, 0, pitch * 0.62, pitch * 0.6), 0, 0.03, 0, { ao: 1 });
        s.prism(...PAL.tin, rect(0, -pitch * 0.2, pitch * 0.5, pitch * 0.12), 0.03, 0.05, 0, { ao: 1 });
      });
      s.with(new Matrix4().makeTranslation(px, h * 0.3, d / 2).multiply(new Matrix4().makeRotationX(Math.PI / 2)), () => {
        s.prism('matte', '#060607', rect(0, 0, pitch * 0.42, pitch * 0.42), 0, 0.03, 0, { ao: 1 });
        s.prism(...PAL.tin, rect(0, 0, pitch * 0.2, pitch * 0.2), 0.03, 0.05, 0, { ao: 1 });
      });
      if (i > 0) s.prism('matte', '#050506', rect(px - pitch / 2, 0, 0.14, d - 0.6), h, h + 0.03, 0, { ao: 1 });
    }
  });
  return { h, r };
}

// --------------------------------------------------------------------------------------------------- small parts
/** A two-terminal chip part (resistor, capacitor): body between two tinned ends, its length along X before `turn`. */
export function chipPassive(s: Shape, o: { x: number; z: number; y: number; turn?: number; l?: number; w?: number; h?: number; body?: Finish }): void {
  const l = o.l ?? 2, w = o.w ?? 1.25, h = o.h ?? 0.6;
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationY((-(o.turn ?? 0) * Math.PI) / 2));
  s.with(m, () => {
    s.prism(...(o.body ?? PAL.epoxyBlack), rect(0, 0, l * 0.62, w), 0.02, h, 0.06, { ao: 0.95 });
    for (const sx of [-1, 1]) s.prism(...PAL.tin, rect((sx * l * 0.81) / 2, 0, l * 0.19, w + 0.04), 0, h + 0.03, 0.06, { ao: 0.95 });
  });
}
/** A small plastic package with gull-wing legs on two sides (SOT-23-5, a regulator): legs along X before `turn`. */
export function sot23(s: Shape, o: { x: number; z: number; y: number; turn?: number }): void {
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationY((-(o.turn ?? 0) * Math.PI) / 2));
  s.with(m, () => {
    s.prism(...PAL.epoxyBlack, rect(0, 0, 2.9, 1.6), 0.1, 1.15, 0.14, { cap: true, ao: 0.95 });
    for (const [px, pz] of [[-0.95, 1.15], [0, 1.15], [0.95, 1.15], [-0.95, -1.15], [0.95, -1.15]] as Pt[]) s.prism(...PAL.tin, rect(px, pz, 0.42, 0.75), 0, 0.5, 0.04, { ao: 0.95 });
  });
}
/** Gold flash over brass (SMA parts): paler than the kit's contact gold. */
export const BRASS: Finish = ['metal', '#e6d291'];
/**
 * A whip antenna on its SMA jack, standing along +Y from the face it is screwed into at (x, y, z), as the reference
 * pictures show it: a thin gold flange on the face, a round collar, the hex coupling nut (8 mm across flats), then the
 * black whip: a slight step at its foot, a slight taper, two fine grooves below the tip (`grooves`: how far below, mm)
 * and a round tip. `length` is the whole height above the face, `d` the whip's diameter at its foot.
 */
export function whipAntenna(s: Shape, o: { x: number; y: number; z: number; length: number; d?: number; grooves?: number; seg?: number }): void {
  const seg = o.seg ?? 16, R = (o.d ?? 8.4) / 2, L = o.length;
  s.at(o.x, o.y, o.z, () => {
    s.disc(...BRASS, 0, 0, 4.1, 0, 0.5, 0.15, seg, { ao: 0.9 });
    s.disc(...BRASS, 0, 0, 3.2, 0.5, 3.3, 0, seg, { ao: 0.8 });
    const hex: Pt[] = [];
    // each corner of the nut is two points a hair apart, so that its six faces shade flat
    for (let i = 0; i < 6; i++) for (const e of [-0.03, 0.03]) hex.push([Math.cos((i * Math.PI) / 3 + e) * 4.62, Math.sin((i * Math.PI) / 3 + e) * 4.62]);
    s.prism(...BRASS, hex, 3.3, 8.3, 0.3, { cap: true, ao: 0.95 });
    // the whip
    const y0 = 8.3, Rt = R * 0.88, tip = Rt * 0.9, g0 = L - tip - (o.grooves ?? 4);
    const taper = (y: number) => R + ((Rt - R) * (y - y0)) / (L - tip - y0);
    const prof: [number, number][] = [[R + 0.12, y0], [R + 0.12, y0 + 1.3], [taper(y0 + 1.5), y0 + 1.5]];
    for (const g of [g0 - 2.2, g0]) prof.push([taper(g), g], [taper(g) - 0.3, g + 0.22], [taper(g) - 0.3, g + 0.5], [taper(g + 0.72), g + 0.72]);
    prof.push([Rt, L - tip]);
    for (let i = 1; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      prof.push([Math.max(0, Rt * Math.cos(a)), L - tip + tip * Math.sin(a)]);
    }
    s.lathe('soft', '#1c1c1e', 0, 0, prof, seg);
  });
}

/** A closed loop (counter-clockwise) with every edge moved inwards by its own distance. */
function insetLoop(v: Pt[], d: number[]): Pt[] {
  const n = v.length;
  const lines = v.map((p, i) => {
    const q = v[(i + 1) % n];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = -(q[1] - p[1]) / l, ny = (q[0] - p[0]) / l; // inward normal of a counter-clockwise loop
    return { px: p[0] + nx * d[i], py: p[1] + ny * d[i], dx: (q[0] - p[0]) / l, dy: (q[1] - p[1]) / l };
  });
  return v.map((_, i) => {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const det = a.dx * b.dy - a.dy * b.dx;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / (det || 1);
    return [a.px + a.dx * t, a.py + a.dy * t] as Pt;
  });
}
/** A loop with its corners rounded, hollow (reflex) corners included: `seg` segments per corner, whatever its angle. */
function roundLoop(v: Pt[], radii: number[], seg: number): Pt[] {
  const n = v.length, out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = v[i], a = v[(i + n - 1) % n], b = v[(i + 1) % n];
    const ux = a[0] - p[0], uy = a[1] - p[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const ul = Math.hypot(ux, uy) || 1, vl = Math.hypot(vx, vy) || 1;
    const interior = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (ul * vl))));
    const r = Math.min(radii[i], 0.45 * ul * Math.tan(interior / 2), 0.45 * vl * Math.tan(interior / 2));
    const t = r / Math.tan(interior / 2), bl = Math.hypot(ux / ul + vx / vl, uy / ul + vy / vl) || 1;
    const k = r / Math.sin(interior / 2);
    const cx = p[0] + ((ux / ul + vx / vl) / bl) * k, cy = p[1] + ((uy / ul + vy / vl) / bl) * k;
    const a0 = Math.atan2(p[1] + (uy / ul) * t - cy, p[0] + (ux / ul) * t - cx);
    let da = Math.atan2(p[1] + (vy / vl) * t - cy, p[0] + (vx / vl) * t - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let q = 0; q <= seg; q++) out.push([cx + r * Math.cos(a0 + (da * q) / seg), cy + r * Math.sin(a0 + (da * q) / seg)]);
  }
  return out;
}
export interface MouldingOptions {
  /** Rings across each end fillet, and segments round each corner of the profile. */
  steps?: number;
  seg?: number;
  /** Baked shade of a vertex (1 = none), from its place and its normal: the form shadow a moulding throws on itself. */
  shade?(p: V3, n: V3): number;
}
/**
 * A moulded solid with real fillets: the side profile `verts` (a counter-clockwise loop in (z, y); hollow corners
 * allowed, so an L is one skin) swept along X from x0 to x1. Each corner of the profile is rounded to its
 * `cornerR`; each edge `i` (from vertex i to i + 1) meets the two end faces in a fillet of its own radius `endR[i]`.
 * One smooth-shaded skin with computed normals, and flat end faces.
 */
export function moulding(s: Shape, finish: Finish, verts: Pt[], cornerR: number[], endR: number[], x0: number, x1: number, o: MouldingOptions = {}): void {
  const steps = o.steps ?? 6, seg = o.seg ?? 5, n = verts.length;
  const R = Math.max(...endR);
  const hollow = verts.map((p, i) => {
    const a = verts[(i + n - 1) % n], b = verts[(i + 1) % n];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) < 0;
  });
  // the profile at depth `d` behind an end face: each edge stands back by what its own fillet takes there
  const station = (d: number): Pt[] => {
    const e = endR.map((r) => (d >= r ? 0 : r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)))));
    const radii = cornerR.map((r, i) => {
      const m = (e[(i + n - 1) % n] + e[i]) / 2;
      return hollow[i] ? r + m : Math.max(r - m, 0.06);
    });
    return roundLoop(insetLoop(verts, e), radii, seg);
  };
  const cuts: { x: number; ring: Pt[] }[] = [];
  for (let k = 0; k <= steps; k++) {
    const d = R * (1 - Math.cos((k / steps) * (Math.PI / 2)));
    cuts.push({ x: x0 + d, ring: station(d) });
  }
  for (let k = steps; k >= 0; k--) cuts.push({ x: x1 - R * (1 - Math.cos((k / steps) * (Math.PI / 2))), ring: cuts[k].ring });
  const m = cuts[0].ring.length, rows = cuts.length;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const P = (c: number, j: number): V3 => [cuts[c].x, cuts[c].ring[(j + m) % m][1], cuts[c].ring[(j + m) % m][0]];
  for (let c = 0; c < rows; c++) for (let j = 0; j < m; j++) {
    // the normal from the surface's own grid: along the ring, and along the sweep
    const a = P(c, j - 1), b = P(c, j + 1), u = P(Math.max(0, c - 1), j), w = P(Math.min(rows - 1, c + 1), j);
    const rx = b[0] - a[0], ry = b[1] - a[1], rz = b[2] - a[2], sx = w[0] - u[0], sy = w[1] - u[1], sz = w[2] - u[2];
    let nx = ry * sz - rz * sy, ny = rz * sx - rx * sz, nz = rx * sy - ry * sx;
    // outwards: a counter-clockwise ring in (z, y) has its outside to the right of its direction
    if (ny * -rz + nz * ry < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1, p = P(c, j);
    pos.push(...p);
    nrm.push(nx / l, ny / l, nz / l);
    const sh = o.shade ? o.shade(p, [nx / l, ny / l, nz / l]) : 1;
    col.push(sh, sh, sh);
  }
  const tri = (a: number, b: number, c: number) => {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) + gy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) + gz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]) >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  for (let c = 0; c < rows - 1; c++) for (let j = 0; j < m; j++) {
    const a = c * m + j, b = c * m + ((j + 1) % m);
    tri(a, b, b + m);
    tri(a, b + m, a + m);
  }
  // the two flat end faces
  for (const [c, sx] of [[0, -1], [rows - 1, 1]] as const) {
    const ring = cuts[c].ring, base = pos.length / 3;
    for (const [z, y] of ring) {
      pos.push(cuts[c].x, y, z);
      nrm.push(sx, 0, 0);
      const sh = o.shade ? o.shade([cuts[c].x, y, z], [sx, 0, 0]) : 1;
      col.push(sh, sh, sh);
    }
    for (const f of ShapeUtils.triangulateShape(ring.map(([z, y]) => new Vector2(z, y)), [])) tri(base + f[0], base + f[1], base + f[2]);
  }
  const count = pos.length / 3;
  s.add(finish[0], finish[1], { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), uvs: new Float32Array(count * 2), indices: new Uint32Array(idx) });
}

/** A flat-flex connector (0.5 mm pitch) lying on a board: body along X, the flap and the ribbon's entry at +Z before `turn`. */
export function fpcConnector(s: Shape, o: { x: number; z: number; y: number; w: number; turn?: number }): void {
  const m = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationY((-(o.turn ?? 0) * Math.PI) / 2));
  s.with(m, () => {
    s.box(...PAL.plasticCream, 0, -0.5, o.w, 2.6, 0, 1.25, 0.2, 0.15, { ao: 0.95 });
    s.box(...PAL.plasticBlack, 0, 1.35, o.w - 0.6, 1.3, 0, 1.0, 0.15, 0.15, { ao: 0.95 });
    for (const sx of [-1, 1]) s.prism(...PAL.tin, rect(sx * (o.w / 2 + 0.35), 0.2, 0.9, 1.9), 0, 0.7, 0.06, { ao: 0.95 });
    const n = Math.floor((o.w - 1) / 1);
    for (let i = 0; i < n; i++) s.prism(...PAL.tin, rect((i - (n - 1) / 2) * 1, -2.05, 0.45, 0.7), 0, 0.12, 0, { ao: 1 });
  });
}
