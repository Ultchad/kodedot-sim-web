/**
 * Builders shared by the breadboards-and-power family. They work like the kit's own (parts.ts): add to a Shape at
 * real dimensions in millimetres, return what the model needs next. Candidates for the kit are marked KIT.
 */
import { MeshBuilder, type V3 } from '../../../device3d/meshBuilder';
import { Matrix4, PAL, Shape, circleLoop, place, type Finish, type ManifestBody, type ManifestPin, type Pt } from '../../index';

// ------------------------------------------------------------------------------------------------- outlines
/** The loop counter-clockwise in the footprint plane (x, z), whatever way it was given. */
function ccw(loop: Pt[]): Pt[] {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a >= 0 ? loop : [...loop].reverse();
}

/**
 * KIT. Rounds the corners of ANY simple polygon with true arcs, convex or not (the kit's `roundPolygon` wants a convex
 * one): a notch keeps its inner corners. `r` is one radius or one per vertex (0 leaves a corner sharp). A convex
 * corner that will be bevelled needs a radius clearly larger than the bevel, or none at all.
 */
export function roundLoop(verts: Pt[], r: number | number[], seg = 3): Pt[] {
  const n = verts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = verts[i], a = verts[(i + n - 1) % n], b = verts[(i + 1) % n];
    const ri = typeof r === 'number' ? r : r[i];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ua: Pt = [(a[0] - p[0]) / la, (a[1] - p[1]) / la], ub: Pt = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const half = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]))) / 2;
    const t = Math.min(ri / Math.tan(half), la / 2, lb / 2);
    if (!(ri > 0) || !(t > 1e-6) || half > Math.PI / 2 - 1e-3) {
      out.push([p[0], p[1]]);
      continue;
    }
    const rr = t * Math.tan(half);
    const bx = ua[0] + ub[0], bz = ua[1] + ub[1], bl = Math.hypot(bx, bz);
    const cx = p[0] + (bx / bl) * (rr / Math.sin(half)), cz = p[1] + (bz / bl) * (rr / Math.sin(half));
    const a0 = Math.atan2(p[1] + ua[1] * t - cz, p[0] + ua[0] * t - cx);
    let da = Math.atan2(p[1] + ub[1] * t - cz, p[0] + ub[0] * t - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) out.push([cx + rr * Math.cos(a0 + (da * k) / seg), cz + rr * Math.sin(a0 + (da * k) / seg)]);
  }
  return out;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export interface ExtrudeOptions {
  /** Leave a rectangular opening in the top face (the model fills it with its own surface, e.g. a field of holes). */
  hole?: Rect;
  /** No top face at all. */
  open?: boolean;
  /** How dark the walls get towards the bottom, 1 = none (as the kit's `ao`). */
  ao?: number;
  /** Close the underside. */
  cap?: boolean;
  /** Shade of the walls at their top (default 1): below 1 sets the sides off from the top face, the bevel stays bright. */
  wall?: number;
}
/**
 * KIT. A vertical solid over ANY simple loop, like `Shape.prism` but safe for outlines with notches and slots:
 * `Shape.prism` finds "outwards" from the loop's centroid, which turns the walls of a notch inside out; this one uses
 * the loop's winding. Flat top (optionally with a rectangular opening), a bevel that shades as a rounded edge, walls
 * that darken towards the surface they stand on. Corners sharper than 50 degrees stay crisp, gentler ones are smooth.
 */
export function extrude(s: Shape, finish: Finish, outline: Pt[], y0: number, y1: number, bevel = 0.3, o: ExtrudeOptions = {}): void {
  const loop = ccw(outline);
  const n = loop.length;
  const mb = new MeshBuilder();
  const b = Math.max(0, Math.min(bevel, (y1 - y0) * 0.5));
  const ao = o.ao ?? 0.74;
  // outward normal of each edge i -> i + 1, and of each vertex (the mitre between its two edges)
  const en: Pt[] = loop.map((p, i) => {
    const q = loop[(i + 1) % n];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dz / l, -dx / l];
  });
  const vn: Pt[] = [], smooth: boolean[] = [], inset: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = en[(i + n - 1) % n], c = en[i];
    let mx = a[0] + c[0], mz = a[1] + c[1];
    const l = Math.hypot(mx, mz);
    if (l < 1e-6) {
      mx = c[0];
      mz = c[1];
    } else {
      mx /= l;
      mz /= l;
    }
    vn.push([mx, mz]);
    smooth.push(a[0] * c[0] + a[1] * c[1] > 0.64);
    const k = b / Math.max(0.5, mx * c[0] + mz * c[1]);
    inset.push([loop[i][0] - mx * k, loop[i][1] - mz * k]);
  }
  const up: V3 = [0, 1, 0];
  if (!o.open) {
    const top = inset.map(([x, z]) => mb.vertex([x, y1, z], up));
    const h = o.hole;
    const holes = h ? [[[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]].map(([x, z]) => mb.vertex([x, y1, z], up))] : [];
    mb.polygon(top, holes, (p) => [p[0], p[2]], up);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ni = smooth[i] ? vn[i] : en[i], nj = smooth[j] ? vn[j] : en[i];
    if (b > 0) {
      const q = Math.SQRT1_2;
      const a0 = mb.vertex([inset[i][0], y1, inset[i][1]], [ni[0] * q, q, ni[1] * q]);
      const a1 = mb.vertex([inset[j][0], y1, inset[j][1]], [nj[0] * q, q, nj[1] * q]);
      const b1 = mb.vertex([loop[j][0], y1 - b, loop[j][1]], [nj[0] * q, q, nj[1] * q]);
      const b0 = mb.vertex([loop[i][0], y1 - b, loop[i][1]], [ni[0] * q, q, ni[1] * q]);
      mb.quad(a0, a1, b1, b0, [en[i][0] * q, q, en[i][1] * q]);
    }
    if (y1 - b > y0) {
      const w0 = mb.vertex([loop[i][0], y1 - b, loop[i][1]], [ni[0], 0, ni[1]], [0, 0], o.wall ?? 1);
      const w1 = mb.vertex([loop[j][0], y1 - b, loop[j][1]], [nj[0], 0, nj[1]], [0, 0], o.wall ?? 1);
      const w2 = mb.vertex([loop[j][0], y0, loop[j][1]], [nj[0], 0, nj[1]], [0, 0], ao);
      const w3 = mb.vertex([loop[i][0], y0, loop[i][1]], [ni[0], 0, ni[1]], [0, 0], ao);
      mb.quad(w0, w1, w2, w3, [en[i][0], 0, en[i][1]]);
    }
  }
  if (o.cap) {
    const down: V3 = [0, -1, 0];
    mb.polygon(loop.map(([x, z]) => mb.vertex([x, y0, z], down, [0, 0], ao * 0.85)), [], (p) => [p[0], p[2]], down);
  }
  s.add(finish[0], finish[1], mb.build());
}

/** A flat quad with one normal and a shade per edge pair (a, b) and (c, d): the unit of hand-built surfaces. */
export function face(mb: MeshBuilder, a: V3, b: V3, c: V3, d: V3, n: V3, shadeAB = 1, shadeCD = shadeAB): void {
  mb.quad(mb.vertex(a, n, [0, 0], shadeAB), mb.vertex(b, n, [0, 0], shadeAB), mb.vertex(c, n, [0, 0], shadeCD), mb.vertex(d, n, [0, 0], shadeCD), n);
}

// ------------------------------------------------------------------------------------------------ small parts
interface At {
  x: number;
  z: number;
  /** Top face of the board. */
  y: number;
  turn?: number;
}

/**
 * KIT. The fixed part of a slide switch (the SS-12/SK-13 family: 8.6 x 3.7 x 3.5 mm steel can, slot along X): can,
 * slot, solder lugs. The knob moves, so the model builds it with `slideKnob` as a named part and slides it along X by
 * the `travel` this returns (positions -travel, 0, +travel for a three-way switch).
 */
/** How far the knob of a `slideSwitch` of width `w` moves from its middle to an end stop. */
export const slideTravel = (w = 8.6): number => (w - 3) / 2 - 1.05;
export function slideSwitch(s: Shape, o: At & { w?: number; d?: number; h?: number }): { travel: number; top: number } {
  const w = o.w ?? 8.6, d = o.d ?? 3.7, h = o.h ?? 3.5;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.plasticBlack, 0, 0, w - 0.5, d - 0.5, 0, 0.9, 0.15, 0.1, { ao: 0.9 });
    s.box(...PAL.tin, 0, 0, w, d, 0.5, h, 0.35, 0.3, { ao: 0.86 });
    // the slot the knob runs in
    s.box('matte', '#0d0d0f', 0, 0, w - 3, 1.5, h, h + 0.02, 0.2, 0, { ao: 1 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (w / 2 + 0.35), 0, 0.9, 1.5, 0, 1.3, 0.1, 0.15, { ao: 0.9 });
  });
  return { travel: slideTravel(w), top: o.y + h };
}
/** The knob of `slideSwitch`, standing at the switch's centre; add it with `toObject(name)` and move it along the slot. */
export function slideKnob(o: At & { h?: number; finish?: Finish }): Shape {
  const k = new Shape();
  const top = o.y + (o.h ?? 3.5);
  k.with(place(o.x, top, o.z, o.turn), () => {
    k.box(...(o.finish ?? PAL.plasticBlack), 0, 0, 1.9, 1.35, 0, 2.1, 0.2, 0.25, { ao: 0.85 });
    k.box(...(o.finish ?? PAL.plasticBlack), 0, 0, 2.6, 1.45, -0.05, 0.25, 0.2, 0.1, { ao: 1 });
  });
  return k;
}

/**
 * KIT. SOT-223 (6.5 x 3.5 x 1.6 mm body, three leads on the +Z side and the wide tab on the -Z side): the usual
 * linear regulator. Returns nothing; pass `into` to build the body in another Shape (a body that glows when it
 * overheats) while the leads stay in `s`.
 */
export function sot223(s: Shape, o: At & { into?: Shape }): void {
  const m = place(o.x, o.y, o.z, o.turn);
  const body = o.into ?? s;
  body.with(m, () => {
    body.box(...PAL.epoxyBlack, 0, 0, 6.5, 3.5, 0.1, 1.7, 0.25, 0.3, { cap: true, ao: 0.95 });
    body.disc('matte', '#3a3a3f', -2.4, 0.9, 0.3, 1.7, 1.72, 0, 8, { ao: 1 });
  });
  s.with(m, () => {
    // gull-wing leads, each one bevelled block from the body down to its pad
    for (const i of [-1, 0, 1]) s.box(...PAL.tin, i * 2.3, 2.6, 0.75, 1.8, 0, 0.95, 0.05, 0.3, { ao: 0.9 });
    s.box(...PAL.tin, 0, -2.6, 3.1, 1.8, 0, 0.95, 0.05, 0.3, { ao: 0.9 });
  });
}

/** KIT. A two-terminal chip part lying on the board along X: a resistor (black), a ceramic capacitor (tan), a tantalum (amber, with its bar). */
export function chip(s: Shape, o: At & { l?: number; w?: number; h?: number; finish?: Finish; bar?: boolean }): void {
  const l = o.l ?? 1.6, w = o.w ?? 0.8, h = o.h ?? 0.5;
  const cap = Math.min(0.45, l * 0.22);
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...(o.finish ?? PAL.epoxyBlack), 0, 0, l - cap, w, 0.02, h, 0.08, 0.06, { ao: 0.95 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (l / 2 - cap / 2), 0, cap, w + 0.04, 0, h + 0.02, 0.06, 0, { ao: 0.95 });
    if (o.bar) s.box('matte', '#7a4a12', -(l / 2 - cap - 0.35), 0, 0.45, w, h, h + 0.02, 0.02, 0, { ao: 1 });
  });
}

/**
 * KIT. The two snap terminals of a 9 V (PP3) battery standing on the plate at height `y`: the small hollow stud (+)
 * and the larger six-sided crown (-). `pos` and `neg` are the contact points (the terminals): their height is where
 * the rims end.
 */
export function pp3Snaps(s: Shape, o: { pos: V3; neg: V3; y: number; seg?: number }): void {
  const seg = o.seg ?? 16;
  const y = o.y, hp = o.pos[1] - y, hn = o.neg[1] - y;
  const [px, , pz] = o.pos, [nx, , nz] = o.neg;
  // + : a riveted stud with a rolled lip (5.8 mm over the lip) and a dimple in its top
  s.disc(...PAL.steel, px, pz, 3.9, y, y + 0.4, 0.15, seg, { ao: 1 });
  s.lathe(...PAL.tin, px, pz, [[2.5, y + 0.35], [2.5, y + hp * 0.5], [2.9, y + hp * 0.72], [2.9, y + hp * 0.9], [2.5, y + hp], [1.35, y + hp], [1.0, y + hp - 0.7], [0, y + hp - 0.7]], seg);
  // - : a crown of six spring petals round an opening
  s.disc(...PAL.steel, nx, nz, 4.7, y, y + 0.4, 0.15, seg, { ao: 1 });
  s.prism(...PAL.tin, circleLoop(nx, nz, 4.1, 6), y + 0.35, y + hn, 0.5, { ao: 0.88, holes: [circleLoop(nx, nz, 2.85, Math.max(8, seg - 4))] });
  s.disc('metal', '#33353a', nx, nz, 2.9, y + 0.35, y + 0.6, 0, Math.max(8, seg - 4), { ao: 1 });
  for (let i = 0; i < 6; i++) {
    const m = new Matrix4().makeTranslation(nx, 0, nz).multiply(new Matrix4().makeRotationY((i / 6) * Math.PI * 2));
    s.with(m, () => s.box('matte', '#101113', 3.3, 0, 1.0, 0.36, y + hn - 0.03, y + hn + 0.01, 0.05, 0, { ao: 1 }));
  }
}

/** A part's manifest as the kit's helpers want it (a JSON import types `face` as a plain string). */
export const asPart = (manifest: unknown): { id: string; body: ManifestBody; pins: ManifestPin[] } => manifest as { id: string; body: ManifestBody; pins: ManifestPin[] };
