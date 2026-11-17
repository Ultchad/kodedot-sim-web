/**
 * Shared builders of the Kode module family (the add-on modules that plug onto the Dot's 2x10 expansion header J3).
 *
 * The family's look, read off the owner's reference pictures (never copied): a matte black board whose four corners
 * swell into round ears round the mounting holes, amber silkscreen, black sockets, a 2x10 right-angle pin header at
 * the edge that meets the Dot (the three bare-board modules), or a moulded L-shaped case in the Dot's own plastic
 * with the pin block under its cap (the two cased modules).
 *
 * HOW A MODULE MEETS THE DOT. On the Workbench the Dot lies on its back with its top wall (where J3 is) looking away
 * from the viewer (-Z). Every model of this family therefore has its mating pins pointing at the viewer (+Z), at the
 * edge where the manifest puts the mount pins (the largest manifest y), parallel to the table. A right-angle header
 * is symmetric about its own axis, so "upright" and "turned" (the module rolled half a turn about that axis) both
 * plug in. `mountOf()` gives a host the row's middle and direction.
 *
 * Candidates for the kit (parts.ts): `outlineBoard` (a board with any outline), `rightAngleHeader`, `socketStrip`
 * (a lean female strip, one or two rows), `screwTerminal381`, `chipPassive`, `smaJack`, `fpcConnector`, `alongX`.
 */
import { Matrix4, PAL, PITCH, Shape, circleLoop, fromManifestMm, type Finish, type ManifestBody, type ManifestPin, type Pt, type V3 } from '../../index';

// ------------------------------------------------------------------------------------------------- the manifest
/** What the models of this family read of parts/<id>/manifest.json. */
export interface KodeManifest {
  id: string;
  body: ManifestBody;
  pins: readonly (ManifestPin & { abs_max_mv?: number })[];
  mount?: { via: string; orientations: readonly string[]; pins: readonly { pin: string; gpio: number }[]; rails: readonly { pin: string; rail: string }[] };
}
/** A JSON import as the manifest type (JSON widens `face` to string). */
export const asManifest = (m: unknown): KodeManifest => m as KodeManifest;

/** Every pin of a manifest as a point of the model frame, by name. */
export function pinPoints(m: KodeManifest): Record<string, V3> {
  const out: Record<string, V3> = {};
  for (const p of m.pins) if (p.mm) out[p.name] = fromManifestMm(m.body, p.mm, p.face);
  return out;
}
/**
 * Where the manifest's mount pins are, in the model frame: the middle of the block along X, the Z of its first row
 * (the one nearer the board) and of its last row.
 */
export function mountBlock(m: KodeManifest): { x: number; z0: number; z1: number } {
  const at = pinPoints(m);
  const names = [...(m.mount?.pins ?? []).map((p) => p.pin), ...(m.mount?.rails ?? []).map((p) => p.pin)].filter((n) => at[n]);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of names) {
    x0 = Math.min(x0, at[n][0]);
    x1 = Math.max(x1, at[n][0]);
    z0 = Math.min(z0, at[n][2]);
    z1 = Math.max(z1, at[n][2]);
  }
  return { x: (x0 + x1) / 2, z0, z1 };
}
/** What a host needs to plug a module of this family onto the Dot: stored on the model's root as `userData.kodeMount`. */
export interface KodeMount {
  /** Middle of the 2x10 pin field, at the pins' tips. */
  pos: V3;
  /** The way the pins point (into the Dot's header). */
  dir: V3;
  /** 'direct': a right-angle header in the board's plane; 'interposer': the pin block under the cap of a cased module. */
  via: string;
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
export function outlineBoard(s: Shape, o: { loop: Pt[]; y?: number; thick?: number; finish?: Finish; holes?: { x: number; z: number; d: number }[] }): number {
  const y = o.y ?? 0, t = o.thick ?? 1.6;
  const holes = (o.holes ?? []).map((h) => circleLoop(h.x, h.z, h.d / 2, 14));
  s.prism(...(o.finish ?? PAL.pcbBlack), o.loop, y, y + t, 0.12, { cap: true, ao: 0.9, holes });
  for (const h of o.holes ?? []) s.prism(...PAL.tin, circleLoop(h.x, h.z, h.d / 2 + 0.85, 18), y + t, y + t + 0.04, 0, { holes: [circleLoop(h.x, h.z, h.d / 2, 14)], ao: 1 });
  return y + t;
}

// ------------------------------------------------------------------------------------------------------- headers
/**
 * A 2-row right-angle pin header (the modules' J401): the plastic stands on the board with its face at z = `z`, the
 * pins leave along +Z in two layers and turn down into the board behind the plastic. `n` pins per row along X,
 * centred on `x`. Returns the middle of the pin field at the tips.
 */
export function rightAngleHeader(s: Shape, o: { x: number; y: number; z: number; n: number; length?: number; pins?: Finish; legs?: boolean }): V3 {
  const len = o.length ?? 6, pins = o.pins ?? PAL.tin, a = 0.32;
  s.at(o.x, o.y, o.z, () => {
    // the strip is notched between pins, like the straight one
    for (let i = 0; i < o.n; i++) s.box(...PAL.plasticBlack, (i - (o.n - 1) / 2) * PITCH, -PITCH / 2, PITCH - 0.1, PITCH, 0, 2 * PITCH, 0.3, 0.3, { ao: 0.9 });
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * PITCH;
      for (let r = 0; r < 2; r++) {
        const py = PITCH / 2 + r * PITCH, back = -PITCH - 1.3 - r * PITCH;
        // `legs: false`: something stands right behind the plastic (the Maker's breadboard) and hides the bends
        if (o.legs === false) {
          s.with(LYING, () => s.prism(...pins, square(px, -py, a), 0, len, 0.16, { ao: 1 }));
          continue;
        }
        s.with(LYING, () => s.prism(...pins, square(px, -py, a), back - a, len, 0.16, { ao: 1 }));
        s.prism(...pins, square(px, back, a), -2.6, py + a, 0.1, { ao: 0.95 });
      }
    }
  });
  return [o.x, o.y + PITCH, o.z + len];
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
      s.prism(...PAL.tin, square(px, pz, 0.3), -2.5, 0, 0, { ao: 0.9 });
    }
  });
}
/** A strip laid from its first to its last contact (two terminals of the manifest): finds the middle and the turn. */
export function stripBetween(a: V3, b: V3): { x: number; z: number; turn: number } {
  return { x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, turn: Math.abs(a[0] - b[0]) >= Math.abs(a[2] - b[2]) ? 0 : 1 };
}

/**
 * A small pluggable screw terminal at 3.81 mm: `n` ways along X centred on `x`, the screws on the line z = `z`, the
 * wire entries looking at -Z (away from the viewer: the far edge of a board). Black, as on the Robotics module.
 */
export function screwTerminal381(s: Shape, o: { x: number; z: number; y: number; n: number; pitch?: number; finish?: Finish }): void {
  const pitch = o.pitch ?? 3.81, w = o.n * pitch, fin = o.finish ?? PAL.plasticGraphite;
  // the profile across the block, in (z, y): a step towards the wires, the screws on the high part
  const profile: Pt[] = [[-3.0, 0], [3.4, 0], [3.4, 8.2], [-0.9, 8.2], [-2.1, 6.2], [-3.0, 6.2]];
  s.at(o.x, o.y, o.z, () => {
    s.with(alongX(), () => s.prism(...fin, profile, -w / 2, w / 2, 0.25, { cap: true, ao: 0.92 }));
    for (let i = 0; i < o.n; i++) {
      const px = (i - (o.n - 1) / 2) * pitch;
      // the screw in its well, slot across
      s.disc('matte', '#0c0c0d', px, 0.9, 1.55, 8.2, 8.23, 0, 14, { ao: 1 });
      s.disc(...PAL.tin, px, 0.9, 1.3, 8.0, 8.3, 0.12, 14, { ao: 1 });
      s.prism('matte', '#3c3d42', rect(px, 0.9, 2.2, 0.42), 8.3, 8.33, 0, { ao: 1 });
      // the wire entry on the far face, with the clamp inside
      s.with(new Matrix4().makeTranslation(px, 3.1, -3.0).multiply(new Matrix4().makeRotationX(-Math.PI / 2)), () => {
        s.prism('matte', '#09090a', rect(0, 0, 2.6, 2.9), 0, 0.03, 0, { ao: 1 });
        s.prism(...PAL.tin, rect(0, -1.05, 2.2, 0.5), 0.03, 0.05, 0, { ao: 1 });
      });
      // the dividing rib between ways
      if (i > 0) s.prism('matte', '#151517', rect(px - pitch / 2, -2.55, 0.16, 0.9), 6.2, 6.24, 0, { ao: 1 });
      s.prism(...PAL.tin, square(px, 0.9, 0.4), -2.6, 0, 0, { ao: 0.9 });
    }
  });
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
/**
 * An SMA jack standing out of a wall: hex flange, threaded barrel, the socket in its mouth. Its axis leaves the point
 * (x, y, z) along -Z (before `m`); `len` is how far it stands out. Gold plated, as on the reference pictures.
 */
export function smaJack(s: Shape, o: { x: number; y: number; z: number; len?: number; seg?: number; m?: Matrix4 }): void {
  const len = o.len ?? 6.4, seg = o.seg ?? 16;
  const frame = (o.m ?? new Matrix4()).clone().multiply(new Matrix4().makeTranslation(o.x, o.y, o.z)).multiply(new Matrix4().makeRotationX(-Math.PI / 2));
  // in this frame the jack grows along +y from the wall at y = 0
  s.with(frame, () => {
    const hex: Pt[] = [];
    for (let i = 0; i < 6; i++) hex.push([Math.cos((i * Math.PI) / 3) * 4.5, Math.sin((i * Math.PI) / 3) * 4.5]);
    s.prism(...PAL.gold, hex, 0, 1.9, 0.25, { ao: 0.9 });
    s.disc(...PAL.gold, 0, 0, 3.1, 1.9, len, 0.3, seg, { ao: 0.92 });
    // the thread: three shallow rings, which is all the eye resolves
    for (let k = 0; k < 3; k++) s.disc('metal', '#b98a2c', 0, 0, 3.18, 2.7 + k * 1.05, 3.2 + k * 1.05, 0.1, seg, { ao: 1 });
    s.disc('matte', '#f1ede4', 0, 0, 2.05, len, len + 0.03, 0, seg, { ao: 1 });
    s.disc(...PAL.gold, 0, 0, 0.62, len + 0.03, len + 0.06, 0, 10, { ao: 1 });
    s.disc('matte', '#16130d', 0, 0, 0.3, len + 0.06, len + 0.08, 0, 8, { ao: 1 });
  });
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
