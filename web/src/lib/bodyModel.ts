/**
 * Dimensions and pure geometry maths of the procedural 3D model. No three.js
 * and no DOM here: everything in this file is unit-tested in node. The meshes
 * are built from these numbers in src/device3d/.
 *
 * Frame (millimetres): origin at the centre of the body; +X right, +Y up
 * (towards the 20-pin connector edge), +Z towards the viewer. The front face is
 * the plane z = +DEPTH/2, the flat back plate is z = -DEPTH/2.
 *
 * Three kinds of number live here:
 *   - DATA: read from public/device/kode-dot.json through metrics().
 *   - MEASURED: taken off the maker's front render (public/device/kode-dot.png,
 *     orthographic, 12.39 px/mm), which the JSON describes but does not itemise.
 *   - ESTIMATE: read off the owner's reference pictures (never copied into the
 *     repository); the data has nothing along Z at all.
 */
import type { ButtonId } from '../device/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../device/types';
import { SPEC, metrics, type Metrics, type Vec2 } from './geometry';

// ---------------------------------------------------------------- estimates
/**
 * ESTIMATE: overall depth of the body. The edge-on reference (left side) shows
 * depth / height = 0.2585 (=> 19.9 mm for the 77.0 mm of the data) and the
 * angled reference, with a camera solved from the front-face features, fits
 * best between 19.5 and 20.0 mm. 19.8 is the value both agree on within +-0.4.
 */
export const DEPTH_MM_ESTIMATE = 19.8;
/** MEASURED on the render's alpha edge (circle fit, three corners: 4.23 to 4.29 mm). */
export const BODY_CORNER_R_MM = 4.27;
/**
 * ESTIMATE: the rounded edge between the front face and the walls is an
 * elliptical arc. It takes FRONT_FILLET_MM of the front face (the render keeps
 * every front feature 2.0 mm clear of the outline) and runs
 * FRONT_FILLET_DEPTH_MM down the wall (edge-on reference: the front corners are
 * cut about 1.6 mm x 2.3 mm; angled reference: a broad soft band beside the glass).
 */
export const FRONT_FILLET_MM_ESTIMATE = 1.8;
export const FRONT_FILLET_DEPTH_MM_ESTIMATE = 2.7;
/** ESTIMATE: fillet between the walls and the back. */
export const REAR_FILLET_MM_ESTIMATE = 1.8;
/**
 * ESTIMATE (edge-on reference): the back is not one plane. Its lower part is a
 * broad facet rising `depth` mm towards the front over the last `length` mm
 * before the bottom edge, and its top part does the same more gently. `blend`
 * is the radius that softens the crease between plate and facet.
 */
export const REAR_SLOPE_BOTTOM_ESTIMATE = { depth: 3.75, length: 11.2, blend: 7 };
export const REAR_SLOPE_TOP_ESTIMATE = { depth: 1.5, length: 12.3, blend: 16 };

/** MEASURED on the render: black glass border beyond the lit picture (37 px at the sides, 41 px above and below). */
export const BEZEL_SIDE_PX = 37;
export const BEZEL_TOP_BOTTOM_PX = 41;
/** MEASURED on the render (circle fit to the four bezel corners: 11.43 to 11.51 mm). */
export const BEZEL_CORNER_R_MM = 11.45;
/** MEASURED on the render: diameters of the coloured inlays (the blue one is larger than the red one). */
export const CAP_TOP_D_PX = 74;
export const CAP_BOTTOM_D_PX = 43;
/** MEASURED on the render: inner (concave) corner radius of the D-pad cross; the arm ends are full semicircles. */
export const DPAD_INNER_R_MM = 1.2;
/** MEASURED on the render: the light guide and the lanyard hole keep this distance from the outline. */
export const CORNER_PIECE_INSET_PX = 25;
/** MEASURED on the render: radius of the two acute tips of the light guide / lanyard hole. */
export const CORNER_PIECE_TIP_R_MM = 0.45;

/** ESTIMATE: how far the round buttons and the D-pad stand proud of the front face (edge-on reference: about 1 mm visible). */
export const BUTTON_PROUD_MM_ESTIMATE = 1.15;
export const DPAD_PROUD_MM_ESTIMATE = 1.45;
/** How far a held control travels. */
export const BUTTON_TRAVEL_MM = 0.6;
export const DPAD_TILT_RAD = 0.075;

/**
 * ESTIMATES for the features on the walls and on the back, from the reference
 * pictures (positions in the body frame, sizes in mm). `z` is the distance
 * BEHIND the front plane unless said otherwise.
 */
export const SIDE_FEATURES_ESTIMATE = {
  /** Right wall: glossy black window (angled reference, camera solved from the front face). */
  window: { y: 0.1, zBehind: 7.5, h: 12.7, w: 9.0, r: 2.3 },
  /** Left wall: speaker grille, 16 holes in three staggered columns (5, 6, 5). */
  grille: { y: 18, zBehind: DEPTH_MM_ESTIMATE / 2, pitchY: 3.0, pitchZ: 2.6, holeD: 1.2 },
  /** Left wall: narrow vertical card slot, near the front edge. */
  slot: { y: -2.8, zBehind: 3.85, len: 12.5, w: 1.9 },
  /** Top wall: two rows of ten small slots (the 20-pin expansion connector). */
  connector: { x: 0.7, pitch: 2.54, rowsBehind: [4.7, 12.1] as const, slotLen: 1.8, slotW: 0.62 },
};
export const BACK_FEATURES_ESTIMATE = {
  /**
   * Shallow debossed panel. The real device carries the maker's logo here
   * (about 19 x 8.5 mm, a little towards +X): it stays BLANK on purpose.
   */
  deboss: { x: 2.7, y: 11.8, w: 19, h: 8.5, r: 1.6, depth: 0.35 },
  /** Recessed pill with five magnetic contact pads: one silver (towards +X), four gold. */
  pogo: { x: 1.1, y: -15.3, pitch: 3.4, padD: 2.5, h: 4.4, depth: 0.5 },
  /** Small silver hex-socket screw beside the pill. */
  screw: { x: 17.6, y: -15.3, d: 4.0, depth: 0.45 },
};

// ------------------------------------------------------------------- shapes
export type Pt = [number, number];

const TAU = Math.PI * 2;

/** Signed area of a closed loop (positive = counter-clockwise). */
export function loopArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function loopBounds(loop: Pt[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of loop) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1 };
}

export function pointInLoop(loop: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Counter-clockwise circle. */
export function circleLoop(cx: number, cy: number, r: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Counter-clockwise rounded rectangle; `seg` segments per corner. r is clamped to half the short side. */
export function roundedRectLoop(cx: number, cy: number, w: number, h: number, r: number, seg: number): Pt[] {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  const out: Pt[] = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - k, cy - h / 2 + k, -Math.PI / 2],
    [cx + w / 2 - k, cy + h / 2 - k, 0],
    [cx - w / 2 + k, cy + h / 2 - k, Math.PI / 2],
    [cx - w / 2 + k, cy - h / 2 + k, Math.PI],
  ];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      const p: Pt = [ox + k * Math.cos(a), oy + k * Math.sin(a)];
      const last = out[out.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-9) continue;
      out.push(p);
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) out.pop();
  return out;
}

/**
 * Round the corners of a convex counter-clockwise polygon. radii[i] belongs to
 * vertex i; `seg(turn)` gives the number of segments for a corner turning by
 * `turn` radians.
 */
export function roundPolygon(verts: Pt[], radii: number[], segPerQuarter = 6): Pt[] {
  const n = verts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = verts[i];
    const a = verts[(i + n - 1) % n];
    const b = verts[(i + 1) % n];
    const r = radii[i];
    const ux = a[0] - p[0], uy = a[1] - p[1];
    const vx = b[0] - p[0], vy = b[1] - p[1];
    const ul = Math.hypot(ux, uy), vl = Math.hypot(vx, vy);
    const cos = (ux * vx + uy * vy) / (ul * vl);
    const interior = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (r <= 0) {
      out.push([p[0], p[1]]);
      continue;
    }
    const t = r / Math.tan(interior / 2); // tangent length
    const p0: Pt = [p[0] + (ux / ul) * t, p[1] + (uy / ul) * t];
    const p1: Pt = [p[0] + (vx / vl) * t, p[1] + (vy / vl) * t];
    // centre on the bisector
    const bx = ux / ul + vx / vl, by = uy / ul + vy / vl;
    const bl = Math.hypot(bx, by);
    const d = r / Math.sin(interior / 2);
    const cx = p[0] + (bx / bl) * d, cy = p[1] + (by / bl) * d;
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    let a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    while (a1 < a0) a1 += TAU; // counter-clockwise
    const turn = a1 - a0;
    const seg = Math.max(2, Math.ceil((turn / (Math.PI / 2)) * segPerQuarter));
    for (let k = 0; k <= seg; k++) {
      const ang = a0 + (turn * k) / seg;
      out.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
    }
  }
  return out;
}

/**
 * The outline of the D-pad cross, counter-clockwise, grown by `grow` mm
 * (negative shrinks). Arm ends are semicircles, inner corners are concave arcs.
 * `segEnd` segments per semicircle, `segIn` per inner corner.
 */
export function crossLoop(half: number, armHalf: number, innerR: number, grow: number, segEnd: number, segIn: number): Pt[] {
  const arm = crossArmEdge(half, armHalf, innerR, grow, segEnd, segIn);
  const out: Pt[] = [];
  for (let q = 0; q < 4; q++) {
    const c = Math.cos((q * Math.PI) / 2), s = Math.sin((q * Math.PI) / 2);
    // drop the last point of each arm: it is the first point of the next one
    for (let i = 0; i < arm.length - 1; i++) out.push([c * arm[i][0] - s * arm[i][1], s * arm[i][0] + c * arm[i][1]]);
  }
  return out;
}

/**
 * The edge of ONE arm of the cross (the arm pointing along +X), as an open
 * polyline from the diagonal y = -x ... no: from the lower diagonal point
 * (on y = -x) counter-clockwise to the upper diagonal point (on y = x).
 */
export function crossArmEdge(half: number, armHalf: number, innerR: number, grow: number, segEnd: number, segIn: number): Pt[] {
  const w = armHalf + grow; // half width of the arm
  const endR = w; // full semicircle
  const ex = half + grow - endR; // centre of the end semicircle
  const q = armHalf + innerR; // centre of the concave corner arcs: (q, +-q)
  const ri = Math.max(1e-4, innerR - grow); // concave radius shrinks as the shape grows
  const out: Pt[] = [];
  // lower concave corner: centre (q, -q), from the diagonal (angle 135 deg) to the tangent with y = -w (angle 90 deg)
  for (let i = 0; i <= segIn; i++) {
    const a = (135 - (45 * i) / segIn) * (Math.PI / 180);
    out.push([q + ri * Math.cos(a), -q + ri * Math.sin(a)]);
  }
  // end semicircle from -90 deg to +90 deg
  for (let i = 0; i <= segEnd; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / segEnd;
    out.push([ex + endR * Math.cos(a), endR * Math.sin(a)]);
  }
  // upper concave corner: centre (q, q), from angle 270 deg to 225 deg
  for (let i = 0; i <= segIn; i++) {
    const a = (270 - (45 * i) / segIn) * (Math.PI / 180);
    out.push([q + ri * Math.cos(a), q + ri * Math.sin(a)]);
  }
  return out;
}

/** Signed distance to the cross outline (negative inside), exact enough for hit tests and wells. */
export function crossDistance(x: number, y: number, half: number, armHalf: number): number {
  const stadium = (px: number, py: number) => {
    const ax = Math.max(0, Math.abs(px) - (half - armHalf));
    return Math.hypot(ax, py) - armHalf;
  };
  return Math.min(stadium(x, y), stadium(y, x));
}

// ------------------------------------------------------------------- body dims
export interface CornerPiece {
  /** counter-clockwise outline in the body frame */
  loop: Pt[];
  /** inclusive bounding box (mm) */
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

export interface BodyDims {
  /** half width, half height, depth */
  hw: number;
  hh: number;
  depth: number;
  zf: number;
  zb: number;
  cornerR: number;
  /** front fillet: extent on the front face, and extent down the wall */
  frontFillet: number;
  frontFilletDepth: number;
  rearFillet: number;
  /** lit picture (the 410x502 panel) */
  screen: { cx: number; cy: number; w: number; h: number; r: number };
  /** black glass, wider than the lit picture */
  bezel: { cx: number; cy: number; w: number; h: number; r: number };
  buttons: Record<'top' | 'bottom', { x: number; y: number; r: number; capR: number; colour: string }>;
  dpad: { x: number; y: number; half: number; armHalf: number; innerR: number };
  led: CornerPiece;
  lanyard: CornerPiece;
}

/**
 * The light guide (top right) and the lanyard hole (bottom left) share one
 * shape: a right triangle whose legs run along the flat part of the front face
 * (CORNER_PIECE_INSET from the outline), whose right-angle corner follows the
 * body corner, and whose hypotenuse faces the centre. `sx, sy` pick the corner.
 * `box` is the JSON bounding box in mm (x0 < x1, y0 < y1).
 */
export function cornerPieceLoop(sx: 1 | -1, sy: 1 | -1, box: { x0: number; x1: number; y0: number; y1: number }, hw: number, hh: number, cornerR: number): Pt[] {
  // work in a frame where the corner is at +X +Y
  const X1 = sx > 0 ? box.x1 : -box.x0; // outer edge along x
  const Y1 = sy > 0 ? box.y1 : -box.y0;
  const X0 = sx > 0 ? box.x0 : -box.x1; // far tip
  const Y0 = sy > 0 ? box.y0 : -box.y1;
  const insetX = hw - X1;
  const insetY = hh - Y1;
  const inset = (insetX + insetY) / 2;
  const rc = Math.max(0.3, cornerR - inset); // concentric with the body corner
  const tip = CORNER_PIECE_TIP_R_MM;
  // rounding a 45 degree tip of radius t pulls the extreme point back by t*(cot(22.5 deg) - 1)
  const pull = tip * (1 / Math.tan(Math.PI / 8) - 1);
  const verts: Pt[] = [
    [X1, Y1], // right-angle corner (rounded with rc)
    [X0 - pull, Y1], // tip along the top edge
    [X1, Y0 - pull], // tip along the side edge
  ];
  const loop = roundPolygon(verts, [rc, tip, tip], 8);
  const mapped = loop.map(([x, y]): Pt => [sx * x, sy * y]);
  // mirroring flips the winding once per negative sign
  if (sx * sy < 0) mapped.reverse();
  return mapped;
}

export function bodyDims(m: Metrics = metrics(SPEC)): BodyDims {
  const hw = m.bodyMm.w / 2;
  const hh = m.bodyMm.h / 2;
  const ppm = m.ppm;
  const bezel = {
    cx: m.screenMm.cx,
    cy: m.screenMm.cy,
    w: m.screenMm.w + (2 * BEZEL_SIDE_PX) / ppm,
    h: m.screenMm.h + (2 * BEZEL_TOP_BOTTOM_PX) / ppm,
    r: BEZEL_CORNER_R_MM,
  };
  const boxMm = (b: { x: number[]; y: number[] }) => {
    const a = m.pxToMm(b.x[0], b.y[1] + 1); // bottom-left
    const c = m.pxToMm(b.x[1] + 1, b.y[0]); // top-right
    return { x0: a.x, x1: c.x, y0: a.y, y1: c.y };
  };
  const ledBox = boxMm(SPEC.led_guide_px);
  const lanBox = boxMm(SPEC.lanyard_hole_px);
  const led = cornerPieceLoop(1, 1, ledBox, hw, hh, BODY_CORNER_R_MM);
  const lanyard = cornerPieceLoop(-1, -1, lanBox, hw, hh, BODY_CORNER_R_MM);
  return {
    hw,
    hh,
    depth: DEPTH_MM_ESTIMATE,
    zf: DEPTH_MM_ESTIMATE / 2,
    zb: -DEPTH_MM_ESTIMATE / 2,
    cornerR: BODY_CORNER_R_MM,
    frontFillet: FRONT_FILLET_MM_ESTIMATE,
    frontFilletDepth: FRONT_FILLET_DEPTH_MM_ESTIMATE,
    rearFillet: REAR_FILLET_MM_ESTIMATE,
    screen: { ...m.screenMm },
    bezel,
    buttons: {
      top: { x: m.buttons.top.mm.x, y: m.buttons.top.mm.y, r: m.buttons.top.d / 2 / ppm, capR: CAP_TOP_D_PX / 2 / ppm, colour: m.buttons.top.colour },
      bottom: { x: m.buttons.bottom.mm.x, y: m.buttons.bottom.mm.y, r: m.buttons.bottom.d / 2 / ppm, capR: CAP_BOTTOM_D_PX / 2 / ppm, colour: m.buttons.bottom.colour },
    },
    dpad: { x: m.dpad.mm.x, y: m.dpad.mm.y, half: m.dpad.span / 2 / ppm, armHalf: m.dpad.arm_w / 2 / ppm, innerR: DPAD_INNER_R_MM },
    led: { loop: led, bounds: loopBounds(led) },
    lanyard: { loop: lanyard, bounds: loopBounds(lanyard) },
  };
}

// ------------------------------------------------------------- back profile
export interface BackProfile {
  /** z of the back surface at height y (it depends on y only) */
  z(y: number): number;
  /** dz/dy */
  slope(y: number): number;
  /** y values that split the back into planar bands (ascending, inside the body) */
  breaks: number[];
}

/**
 * The back as a height field over y: bottom facet, plate, top facet, with the
 * two creases replaced by circular arcs. `arcSeg` is the number of flat strips
 * that approximate each arc.
 */
export function backProfile(d: BodyDims = bodyDims(), arcSeg = 5): BackProfile {
  const bot = REAR_SLOPE_BOTTOM_ESTIMATE;
  const top = REAR_SLOPE_TOP_ESTIMATE;
  const mk = (s: { depth: number; length: number; blend: number }) => {
    const alpha = Math.atan2(s.depth, s.length);
    const t = s.blend * Math.tan(alpha / 2); // tangent length on the plate side
    return { alpha, t, R: s.blend, tan: s.depth / s.length, len: s.length };
  };
  const B = mk(bot);
  const Tp = mk(top);
  // u = distance from the crease towards the edge (u > 0 on the facet)
  const rise = (u: number, k: ReturnType<typeof mk>): [number, number] => {
    if (u <= -k.t) return [0, 0];
    const uArcEnd = k.t * Math.cos(k.alpha); // horizontal reach of the arc on the facet side
    if (u >= uArcEnd) return [u * k.tan, k.tan];
    const s = u + k.t; // 0 .. R sin(alpha)
    const root = Math.sqrt(Math.max(0, k.R * k.R - s * s));
    return [k.R - root, s / Math.max(1e-9, root)];
  };
  const yb = -d.hh + B.len; // bottom crease
  const yt = d.hh - Tp.len; // top crease
  const z = (y: number) => d.zb + rise(yb - y, B)[0] + rise(y - yt, Tp)[0];
  const slope = (y: number) => -rise(yb - y, B)[1] + rise(y - yt, Tp)[1];
  const breaks: number[] = [];
  for (let i = 0; i <= arcSeg; i++) {
    const a = B.alpha * (1 - i / arcSeg); // from the facet end of the arc to the plate end
    breaks.push(yb + B.t - B.R * Math.sin(a));
  }
  for (let i = 0; i <= arcSeg; i++) {
    const a = (Tp.alpha * i) / arcSeg;
    breaks.push(yt - Tp.t + Tp.R * Math.sin(a));
  }
  return { z, slope, breaks };
}

// ----------------------------------------------------------- screen mapping
/**
 * A point on the glass, in mm relative to the centre of the lit picture
 * (x right, y up), to the integer screen pixel under it. Points outside the
 * picture clamp to its edge (a drag that leaves the glass keeps tracking).
 */
export function glassMmToScreen(x: number, y: number, d: BodyDims = bodyDims()): Vec2 {
  const u = x / d.screen.w + 0.5;
  const v = 0.5 - y / d.screen.h;
  const cl = (n: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(n)));
  return { x: cl(u * SCREEN_WIDTH, SCREEN_WIDTH), y: cl(v * SCREEN_HEIGHT, SCREEN_HEIGHT) };
}

/** Centre of a screen pixel, in mm relative to the centre of the lit picture (x right, y up). */
export function screenToGlassMm(px: number, py: number, d: BodyDims = bodyDims()): Vec2 {
  return { x: ((px + 0.5) / SCREEN_WIDTH - 0.5) * d.screen.w, y: (0.5 - (py + 0.5) / SCREEN_HEIGHT) * d.screen.h };
}

// --------------------------------------------------------------- hit targets
/** The invisible press targets are larger than the parts: fingers and trackpads are imprecise. */
export const BUTTON_HIT_GROW_MM = 1.3;
export const DPAD_HIT_GROW_MM = 1.4;

export function buttonHitRadius(id: 'top' | 'bottom', d: BodyDims = bodyDims()): number {
  // the two round buttons are 12.2 mm apart: keep the targets from overlapping
  const a = d.buttons.top;
  const b = d.buttons.bottom;
  const gap = Math.hypot(a.x - b.x, a.y - b.y);
  return Math.min(d.buttons[id].r + BUTTON_HIT_GROW_MM, gap / 2 - 0.05);
}

/**
 * Which D-pad arm is under a point given in mm relative to the pad centre
 * (x right, y up). The target is the cross grown by DPAD_HIT_GROW_MM; the dead
 * centre belongs to whichever arm is nearer. Returns null outside the target.
 */
export function dpadHit(x: number, y: number, d: BodyDims = bodyDims()): Extract<ButtonId, 'up' | 'down' | 'left' | 'right'> | null {
  const { half, armHalf } = d.dpad;
  if (crossDistance(x, y, half, armHalf) > DPAD_HIT_GROW_MM) return null;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y > 0 ? 'up' : 'down';
}

/** Body-frame point at the middle of each control's top surface (used by the headless checks and tests). */
export function controlCentre(id: ButtonId, d: BodyDims = bodyDims()): [number, number, number] {
  if (id === 'top' || id === 'bottom') {
    const b = d.buttons[id];
    return [b.x, b.y, d.zf + BUTTON_PROUD_MM_ESTIMATE - 0.2];
  }
  const k = d.dpad.half * 0.68;
  const o = { up: [0, k], down: [0, -k], left: [-k, 0], right: [k, 0] }[id];
  return [d.dpad.x + o[0], d.dpad.y + o[1], d.zf + DPAD_PROUD_MM_ESTIMATE];
}
