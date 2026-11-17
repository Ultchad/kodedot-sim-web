/**
 * The solderless breadboard, built from a part's manifest: every hole is where a terminal is, every clip is where a
 * terminal group is. One builder serves the half (400) and the full (830) board.
 *
 * What is real geometry and what is print (decided against the budget, measured in the model files):
 * - The holes are GEOMETRY, but not one solid each. The clip under a strip of holes is one trough (chamfer, walls,
 *   two spring leaves of the clip, a dark floor) shared by all the holes of the strip; the plastic between two holes
 *   is a small web bridging the trough: its top and the two lead-in chamfers, nothing under them, so one looks past
 *   it into the dark of the trough and along the clip. A hole costs 6 triangles and a strip 22 more: the 830 holes
 *   of the full board are about 7,600 triangles and still have depth, a chamfer and a glint of metal from every angle.
 * - The top face is a few dozen large flat quads laid between the troughs. They overlap each other (same plane, same
 *   colour: nothing to see) and reach 0.03 mm over the mouth of each trough, so no edge of one quad ends in the
 *   middle of another's: no sparkling cracks, without paying for a triangulated face with hundreds of openings.
 * - Rail lines, + and - signs, column numbers and row letters are PRINT (one decal per 1024 px of board length).
 *
 * The body is the usual three mouldings (two rail strips and the terminal block with its centre channel) joined
 * along two seams, foam tape underneath. Sizes after the MB-102 family: holes 1.1 mm square under a 1.66 mm lead-in,
 * channel 3 mm wide, body 8.5 mm high.
 * Dovetails: the manifest's body is the moulding WITHOUT its tabs, so the mouldings fill the footprint and the slots
 * are cut in the left and back edges. The tabs of the right and front edges stand outside the footprint, inside the
 * allowance the manifest declares for them (`body.overhang_mm`, 1.2 mm a side). They are built by `tabs()` and
 * switched off by DRAW_TABS for one reason: the kit's contract check (`inspectModel`) does not know the allowance
 * yet and fails a model that leaves its footprint by more than 0.25 mm. Set DRAW_TABS when it does.
 * Rails: in each pair the row further from the viewer is + (red line), the nearer one - (blue), the lines on the
 * outside of the pair, as in the parts' picture.svg.
 */
import { MeshBuilder, type V3 } from '../../../device3d/meshBuilder';
import {
  FONT, INK, PAL, Shape, defineModel, footprintOf, fromManifestMm, print, terminalsFromManifest, text, topQuad,
  type BuildCtx, type Finish, type ManifestBody, type ManifestPin, type Object3D, type PartModel, type PartState, type Pt,
} from '../../index';
import { extrude, face, roundLoop, type Rect } from './builders';

// Colours are sRGB as they should look (the kit converts a hex colour to linear once).
const BODY_WHITE = '#d4dae0';

/** What the builder reads of parts/breadboard-<size>/manifest.json. */
export interface BoardManifest {
  id: string;
  /** `overhang_mm`: how far a model may draw outside the body on each side (the dovetail tabs). */
  body: ManifestBody & { overhang_mm?: { left?: number; right?: number; back?: number; front?: number } };
  pins: ManifestPin[];
  groups: { pins: string[] }[];
}

// ---- the moulding (design values; everything about the holes' places comes from the manifest)
const BODY: Finish = ['gloss', BODY_WHITE]; // ABS has a sheen; a cool white, so the board stands off the warm table
const SLOT = 1.1; // how deep a dovetail slot is cut
const TAB = 1.0; // how far a dovetail tab stands out: it fits the slot of the next board
/** Build the tabs outside the footprint (see the header: off until the contract check honours `body.overhang_mm`). */
const DRAW_TABS = false;
const RAIL_LINE = 2.1; // from a rail row to its coloured line
const FOAM = 0.9; // the adhesive foam and its backing paper
const BEVEL = 0.32;
const SEAM_R = 0.55; // the corners of each moulding where two meet: the seam reads as a fine groove down the side
const RIM = 1.62; // from a moulding's edge to the field of holes: past the slots and the bevel
const OPEN = 0.83; // half the mouth of a hole (the lead-in chamfer)
const HOLE = 0.55; // half the hole itself
const CHAMFER = 0.3; // depth of the lead-in
const DEEP = 1.3; // where the dark begins
const LIP = 0.03; // the top quads reach this far over a trough's mouth
const TRENCH = 3.0; // width of the centre channel
const TRENCH_DEEP = 2.6;
const SEAM = 0.3; // the gap between a rail strip and the terminal block

/** A strip of holes over one clip: hole centres along its axis `u`, at `v` across it. */
interface Trough {
  alongX: boolean;
  u: number[];
  v: number;
}
interface Layout {
  body: BoardManifest['body'];
  pitch: number;
  /** Half extents of the mouldings. */
  X: number;
  Z: number;
  rails: Trough[];
  strips: Trough[];
  /** z of each rail row, sorted, and whether it is + (red line; the back row of its pair) or - (blue). */
  railRows: { z: number; plus: boolean; x0: number; x1: number; lineZ: number }[];
  /** x of every column of the terminal block with its number, z of every row with its letter. */
  cols: { x: number; n: number }[];
  rows: { z: number; letter: string }[];
  seamTop: number;
  seamBot: number;
  mid: number;
  /** Where the dovetail slots are: along the back edge (x) and the left edge (z). */
  slotsX: number[];
  slotsZ: number[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

export function layoutOf(m: BoardManifest): Layout {
  const body = m.body;
  const at = new Map<string, V3>();
  for (const p of m.pins) if (p.mm) at.set(p.name, fromManifestMm(body, p.mm, p.face));
  const troughs: Trough[] = [];
  let pitch = Infinity;
  for (const g of m.groups) {
    const pts = g.pins.map((n) => at.get(n)!).filter(Boolean);
    if (pts.length < 2) continue;
    const alongX = Math.abs(pts[pts.length - 1][0] - pts[0][0]) > Math.abs(pts[pts.length - 1][2] - pts[0][2]);
    const u = pts.map((p) => (alongX ? p[0] : p[2])).sort((a, b) => a - b);
    for (let i = 1; i < u.length; i++) pitch = Math.min(pitch, u[i] - u[i - 1]);
    troughs.push({ alongX, u, v: alongX ? pts[0][2] : pts[0][0] });
  }
  // a rail is one net but several clips' worth of holes: a new trough wherever a hole is skipped
  const split: Trough[] = [];
  for (const t of troughs) {
    let run = [t.u[0]];
    for (let i = 1; i < t.u.length; i++) {
      if (t.u[i] - t.u[i - 1] > pitch * 1.5) {
        split.push({ ...t, u: run });
        run = [];
      }
      run.push(t.u[i]);
    }
    split.push({ ...t, u: run });
  }
  const rails = split.filter((t) => t.alongX), strips = split.filter((t) => !t.alongX);
  const X = body.w_mm / 2, Z = body.d_mm / 2;
  const railZ = [...new Set(rails.map((t) => t.v))].sort((a, b) => a - b);
  const rowZ = [...new Set(strips.flatMap((t) => t.u))].sort((a, b) => a - b);
  const colX = [...new Set(strips.map((t) => t.v))].sort((a, b) => a - b);
  const mid = (Math.max(...rowZ.filter((z) => z < 0)) + Math.min(...rowZ.filter((z) => z > 0))) / 2;
  const topRails = railZ.filter((z) => z < mid), botRails = railZ.filter((z) => z > mid);
  const seamTop = (Math.max(...topRails) + rowZ[0]) / 2, seamBot = (Math.min(...botRails) + rowZ[rowZ.length - 1]) / 2;
  const railRows = railZ.map((z) => {
    const mine = rails.filter((t) => t.v === z);
    const pair = z < mid ? topRails : botRails;
    const away = Math.sign(z - pair.reduce((a, q) => a + q, 0) / pair.length) || Math.sign(z - mid);
    return { z, plus: z === Math.min(...pair), x0: Math.min(...mine.map((t) => t.u[0])), x1: Math.max(...mine.map((t) => t.u[t.u.length - 1])), lineZ: z + away * RAIL_LINE };
  });
  // the names say which column and row a hole is: "c17" is row c, column 17
  const cols = colX.map((x) => {
    const pin = m.pins.find((p) => p.mm && /^[a-z]\d+$/.test(p.name) && near(fromManifestMm(body, p.mm)[0], x))!;
    return { x, n: Number(pin.name.slice(1)) };
  });
  const rows = rowZ.map((z) => {
    const pin = m.pins.find((p) => p.mm && /^[a-z]\d+$/.test(p.name) && near(fromManifestMm(body, p.mm)[2], z))!;
    return { z, letter: pin.name[0] };
  });
  const nSlots = Math.max(2, Math.round((2 * X) / 41));
  const slotsX = Array.from({ length: nSlots }, (_, k) => ((k + 0.5) / nSlots - 0.5) * 2 * X);
  const slotsZ = [(seamTop + mid - TRENCH / 2) / 2, (seamBot + mid + TRENCH / 2) / 2];
  return { body, pitch, X, Z, rails, strips, railRows, cols, rows, seamTop, seamBot, mid, slotsX, slotsZ };
}

// ------------------------------------------------------------------------------------------------- geometry
/** A dovetail seen from above: `c` along the edge, standing out from `edge` by `out` (negative: a slot cut in). */
const dovetail = (c: number, grow: number): [number, number][] => [[c - 1.5 - grow, 0], [c - 2.1 - grow, 1], [c + 2.1 + grow, 1], [c + 1.5 + grow, 0]];

/**
 * The outline of a moulding: a rectangle with rounded corners and dovetail slots on its left (-X) and back (-Z) edges.
 * The lips of a slot stay sharp: a convex corner rounded with less than the bevel would curl the bevelled top edge.
 */
function outline(r: Rect, o: { slotsBack?: number[]; slotsLeft?: number[]; radii: [number, number, number, number] }): Pt[] {
  const pts: Pt[] = [], rad: number[] = [];
  const add = (x: number, z: number, radius = 0) => {
    pts.push([x, z]);
    rad.push(radius);
  };
  // back edge from left to right, then down the right, along the front, up the left
  add(r.x0, r.z0, o.radii[0]);
  for (const c of o.slotsBack ?? []) for (const [a, k] of dovetail(c, 0.1)) add(a, r.z0 + k * SLOT, k ? 0.15 : 0);
  add(r.x1, r.z0, o.radii[1]);
  add(r.x1, r.z1, o.radii[2]);
  add(r.x0, r.z1, o.radii[3]);
  for (const c of [...(o.slotsLeft ?? [])].reverse()) for (const [a, k] of dovetail(c, 0.1).reverse()) add(r.x0 + k * SLOT, a, k ? 0.15 : 0);
  return roundLoop(pts, rad, 3);
}

/** One trough with its webs. `fine` adds the straight walls under the chamfer and the leaves of the clip. */
function trough(t: Trough, top: number, fine: boolean, white: MeshBuilder, dark: MeshBuilder, metal: MeshBuilder): void {
  const P = (u: number, v: number, depth: number): V3 => (t.alongX ? [u, top - depth, t.v + v] : [t.v + v, top - depth, u]);
  const N = (nu: number, ny: number, nv: number): V3 => (t.alongX ? [nu, ny, nv] : [nv, ny, nu]);
  // coarse: the chamfer runs straight down to the floor, a countersink
  const h = fine ? HOLE : 0.42, cd = fine ? CHAMFER : 0.85, floor = fine ? DEEP : cd;
  const e = OPEN - h, len = Math.hypot(e, cd);
  const ny = e / len, nk = cd / len;
  // shades: the rim, the foot of the chamfer, the foot of the wall (coarse: the countersink goes dark by itself)
  const s0 = fine ? 0.95 : 0.78, s1 = fine ? 0.7 : 0.1, s2 = 0.1;
  const u0 = t.u[0] - OPEN, u1 = t.u[t.u.length - 1] + OPEN;
  for (const sg of [-1, 1]) {
    face(white, P(u0, sg * OPEN, 0), P(u1, sg * OPEN, 0), P(u1 - e, sg * h, cd), P(u0 + e, sg * h, cd), N(0, ny, -sg * nk), s0, s1);
    if (!fine) continue;
    face(white, P(u0 + e, sg * h, cd), P(u1 - e, sg * h, cd), P(u1 - e, sg * h, floor), P(u0 + e, sg * h, floor), N(0, 0, -sg), 0.46, s2);
    // a leaf of the spring clip: it leans in towards the middle of the strip
    const g = 0.26, l0 = 0.5, l1 = 1.02, ll = Math.hypot(h - g, l1 - l0);
    face(metal, P(u0 + e, sg * h, l0), P(u1 - e, sg * h, l0), P(u1 - e, sg * g, l1), P(u0 + e, sg * g, l1), N(0, (h - g) / ll, (-sg * (l1 - l0)) / ll), 0.7, 0.24);
  }
  face(dark, P(u0 + e, -h, floor), P(u1 - e, -h, floor), P(u1 - e, h, floor), P(u0 + e, h, floor), [0, 1, 0]);
  // a chamfer across the trough at `u`, looking along `dir`; the two ends of the trough also get their wall. A web
  // has none: nobody can see up under it, and past its chamfer the eye meets the dark of the trough
  const across = (u: number, dir: number, wall: boolean) => {
    face(white, P(u, -OPEN, 0), P(u, OPEN, 0), P(u + dir * e, h, cd), P(u + dir * e, -h, cd), N(dir * nk, ny, 0), s0, s1);
    if (fine && wall) face(white, P(u + dir * e, -h, cd), P(u + dir * e, h, cd), P(u + dir * e, h, floor), P(u + dir * e, -h, floor), N(dir, 0, 0), 0.46, s2);
  };
  across(u0, 1, true);
  across(u1, -1, true);
  for (let i = 0; i + 1 < t.u.length; i++) {
    const a = t.u[i] + OPEN, b = t.u[i + 1] - OPEN;
    face(white, P(a, -OPEN, 0), P(b, -OPEN, 0), P(b, OPEN, 0), P(a, OPEN, 0), [0, 1, 0]);
    across(a, -1, false);
    across(b, 1, false);
  }
}

/**
 * The top face inside `r` round rows of openings: bands between the rows, and in each row the pieces between two
 * openings. Every piece overlaps its neighbours and reaches LIP over the openings (see the header).
 */
function tiles(mb: MeshBuilder, r: Rect, y: number, rows: { z0: number; z1: number; opens: [number, number][] }[]): void {
  const O = 0.05;
  const quad = (x0: number, x1: number, z0: number, z1: number) => face(mb, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0]);
  let z = r.z0 - O;
  for (const row of rows) {
    quad(r.x0 - O, r.x1 + O, z, row.z0 + LIP);
    let x = r.x0 - O;
    for (const [a, b] of row.opens) {
      quad(x, a + LIP, row.z0, row.z1);
      x = b - LIP;
    }
    quad(x, r.x1 + O, row.z0, row.z1);
    z = row.z1 - LIP;
  }
  quad(r.x0 - O, r.x1 + O, z, r.z1 + O);
}

function buildBody(L: Layout, ctx: BuildCtx): Shape {
  const s = new Shape();
  const top = L.body.h_mm;
  const fine = ctx.detail >= 0.75;
  const { X, Z, seamTop, seamBot, mid } = L;
  const white = new MeshBuilder(), dark = new MeshBuilder(), metal = new MeshBuilder();

  // foam tape and its backing paper
  s.box(...PAL.ceramic, 0, 0, 2 * X - 0.5, 2 * Z - 0.5, 0, FOAM, 0.8, 0.1, { ao: 0.85 });

  // the four mouldings that carry holes, each with its field of holes left open in the top
  const pieces: { r: Rect; slotsBack?: number[]; slotsLeft?: number[]; radii: [number, number, number, number]; of: Trough[]; rail: boolean }[] = [
    { r: { x0: -X, x1: X, z0: -Z, z1: seamTop - SEAM / 2 }, slotsBack: L.slotsX, radii: [1.1, 1.1, SEAM_R, SEAM_R], of: L.rails.filter((t) => t.v < mid), rail: true },
    { r: { x0: -X, x1: X, z0: seamTop + SEAM / 2, z1: mid - TRENCH / 2 }, slotsLeft: [L.slotsZ[0]], radii: [SEAM_R, SEAM_R, SEAM_R, SEAM_R], of: L.strips.filter((t) => t.u[0] < mid), rail: false },
    { r: { x0: -X, x1: X, z0: mid + TRENCH / 2, z1: seamBot - SEAM / 2 }, slotsLeft: [L.slotsZ[1]], radii: [SEAM_R, SEAM_R, SEAM_R, SEAM_R], of: L.strips.filter((t) => t.u[0] > mid), rail: false },
    { r: { x0: -X, x1: X, z0: seamBot + SEAM / 2, z1: Z }, radii: [SEAM_R, SEAM_R, 1.1, 1.1], of: L.rails.filter((t) => t.v > mid), rail: true },
  ];
  for (const p of pieces) {
    const field: Rect = { x0: p.r.x0 + RIM, x1: p.r.x1 - RIM, z0: p.r.z0 + (p.slotsBack ? RIM : 0.7), z1: p.r.z1 - 0.7 };
    extrude(s, BODY, outline(p.r, p), FOAM, top, BEVEL, { hole: field, ao: 0.6, wall: 0.9 });
    const rows: { z0: number; z1: number; opens: [number, number][] }[] = [];
    if (p.rail) {
      for (const z of [...new Set(p.of.map((t) => t.v))].sort((a, b) => a - b)) {
        rows.push({ z0: z - OPEN, z1: z + OPEN, opens: p.of.filter((t) => t.v === z).sort((a, b) => a.u[0] - b.u[0]).map((t) => [t.u[0] - OPEN, t.u[t.u.length - 1] + OPEN]) });
      }
    } else {
      const cols = [...p.of].sort((a, b) => a.v - b.v);
      rows.push({ z0: cols[0].u[0] - OPEN, z1: cols[0].u[cols[0].u.length - 1] + OPEN, opens: cols.map((t) => [t.v - OPEN, t.v + OPEN]) });
    }
    tiles(white, field, top, rows);
    for (const t of p.of) trough(t, top, fine, white, dark, metal);
  }
  s.add(BODY[0], BODY[1], white.build());
  s.add('matte', '#08080a', dark.build());
  if (fine) s.add(PAL.steel[0], PAL.steel[1], metal.build());

  // the floor of the centre channel, open at both ends, and the shade that gathers in it: darker down the walls
  s.box(...BODY, 0, mid, 2 * X - 0.3, TRENCH + 0.2, FOAM, top - TRENCH_DEEP, 0.05, 0, { ao: 0.6 });
  const shade = new MeshBuilder();
  const fy = top - TRENCH_DEEP + 0.01, x0 = -X + 0.2, x1 = X - 0.2;
  face(shade, [x0, fy, mid - TRENCH / 2], [x1, fy, mid - TRENCH / 2], [x1, fy, mid + TRENCH / 2], [x0, fy, mid + TRENCH / 2], [0, 1, 0], 0.5);
  for (const sg of [-1, 1]) {
    const z = mid + sg * (TRENCH / 2 - 0.01);
    face(shade, [x0, top - BEVEL, z], [x1, top - BEVEL, z], [x1, fy, z], [x0, fy, z], [0, 0, -sg], 0.84, 0.46);
  }
  s.add(BODY[0], BODY[1], shade.build());
  // the seams: a rail strip is a moulding of its own, a dark line runs between it and the terminal block
  for (const z of [seamTop, seamBot]) s.box('matte', '#1e2024', 0, z, 2 * X - 0.5, SEAM + 0.2, FOAM, top - 0.75, 0.05, 0, { ao: 0.7 });

  if (DRAW_TABS) tabs(s, L);
  return s;
}

/**
 * The dovetail tabs: on the right edge of each half of the terminal block and along the front rail strip, opposite
 * the slots, no further out than the manifest allows on that side. Lower than the top face, as moulded.
 */
function tabs(s: Shape, L: Layout): void {
  const { X, Z } = L;
  const top = L.body.h_mm - 1.5;
  const right = Math.min(TAB, L.body.overhang_mm?.right ?? 0), front = Math.min(TAB, L.body.overhang_mm?.front ?? 0);
  if (right > 0.3) for (const z of L.slotsZ) s.prism(...BODY, dovetail(z, 0).map(([a, k]) => [X - 0.3 + k * (right + 0.3), a] as Pt), FOAM, top, 0.2, { ao: 0.6 });
  if (front > 0.3) for (const x of L.slotsX) s.prism(...BODY, dovetail(x, 0).map(([a, k]) => [a, Z - 0.3 + k * (front + 0.3)] as Pt), FOAM, top, 0.2, { ao: 0.6 });
}

// ---------------------------------------------------------------------------------------------------- print
const LEGEND = '#23272e';

function legends(L: Layout, g: CanvasRenderingContext2D): void {
  // rail lines with their signs at both ends
  for (const r of L.railRows) {
    const colour = r.plus ? INK.red : INK.blue;
    g.strokeStyle = g.fillStyle = colour;
    g.lineWidth = 0.5;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(r.x0 - 1.1, r.lineZ);
    g.lineTo(r.x1 + 1.1, r.lineZ);
    g.stroke();
    const sx = Math.min(2.3, (r.x0 + L.X) / 2 + 0.2);
    for (const x of [r.x0 - sx, r.x1 + sx]) {
      g.lineWidth = 0.4;
      g.beginPath();
      g.moveTo(x - 0.62, r.z);
      g.lineTo(x + 0.62, r.z);
      if (r.plus) {
        g.moveTo(x, r.z - 0.62);
        g.lineTo(x, r.z + 0.62);
      }
      g.stroke();
    }
  }
  g.fillStyle = LEGEND;
  // column numbers: the first and every fifth, above the first row and below the last
  const z0 = L.rows[0].z, z1 = L.rows[L.rows.length - 1].z;
  for (const c of L.cols) {
    if (c.n !== 1 && c.n % 5 !== 0) continue;
    text(g, String(c.n), c.x, z0 - 2.05, 1.6, { weight: 700, font: FONT });
    text(g, String(c.n), c.x, z1 + 2.15, 1.6, { weight: 700, font: FONT });
  }
  // row letters at both ends
  const x0 = L.cols[0].x, x1 = L.cols[L.cols.length - 1].x;
  // between the bottom of a slot and the mouths of the first column
  const off = Math.min(1.95, (x0 - OPEN + L.X - SLOT) / 2 + OPEN);
  for (const r of L.rows) {
    text(g, r.letter, x0 - off, r.z + 0.05, 1.55, { weight: 700, font: FONT });
    text(g, r.letter, x1 + off, r.z + 0.05, 1.55, { weight: 700, font: FONT });
  }
}

/** The legends as decals: one print per 1024 px of length, so the numbers stay sharp on the long board. */
function prints(L: Layout): Object3D[] {
  const PPM = 12;
  const n = Math.max(1, Math.ceil((2 * L.X * PPM) / 1024));
  const w = (2 * L.X) / n;
  return Array.from({ length: n }, (_, i) => {
    const cx = -L.X + w * (i + 0.5);
    return print({
      name: `legend${i}`,
      quad: topQuad(cx, 0, L.body.h_mm + 0.01, w / 2, L.Z),
      ppm: PPM,
      draw(g) {
        g.translate(-cx, 0);
        legends(L, g);
      },
    });
  });
}

/** The model of a breadboard part. A breadboard has no outputs and no hazards of its own: a static body, drawn as instances. */
export function breadboardModel(manifest: unknown, title: string, budget?: number): PartModel<PartState> {
  const m = manifest as BoardManifest;
  const L = layoutOf(m);
  return defineModel<PartState>({
    id: m.id,
    title,
    footprintMm: footprintOf(m.body),
    budget,
    terminals: terminalsFromManifest(m),
    build(ctx) {
      const root = buildBody(L, ctx).toObject();
      root.add(...prints(L));
      return root;
    },
  });
}
