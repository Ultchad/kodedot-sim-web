/**
 * Everything that sits in the body: the glass, the lit picture, the light
 * guide, the side window, the contact pads, the screw, the round buttons and
 * the D-pad. Pure mesh data (unit-tested in node).
 */
import {
  BACK_FEATURES_ESTIMATE as BF,
  BUTTON_PROUD_MM_ESTIMATE,
  DPAD_PROUD_MM_ESTIMATE,
  backProfile,
  bodyDims,
  circleLoop,
  crossArmEdge,
  loopBounds,
  type BodyDims,
  type Pt,
} from '../lib/bodyModel';
import { backOpenings, frontParts, offsetLoop, wallOpenings } from './features';
import { MeshBuilder, norm, scale, sub, type MeshData, type V2, type V3 } from './meshBuilder';

interface Frame {
  at(a: number, b: number, depth: number): V3;
  inward: V3;
}

/**
 * A flat-topped insert: top face, a small 45 degree chamfer, then a wall going
 * `depth` into the body. `top` is how far the top face sits below the surface.
 * UVs span the loop's bounding box (0..1, v up).
 */
export function buildSlab(loop: Pt[], f: Frame, o: { top?: number; chamfer?: number; depth: number; hole?: { loop: Pt[]; depth: number } }): MeshData {
  const mb = new MeshBuilder();
  const top = o.top ?? 0;
  const c = o.chamfer ?? 0;
  const out = scale(f.inward, -1);
  const bb = loopBounds(loop);
  const uv = (a: number, b: number): V2 => [(a - bb.x0) / (bb.x1 - bb.x0), (b - bb.y0) / (bb.y1 - bb.y0)];
  const inner = c > 0 ? offsetLoop(loop, -c) : loop;
  const n = loop.length;
  const topRing = inner.map(([a, b]) => mb.vertex(f.at(a, b, top), out, uv(a, b)));
  const holes: number[][] = [];
  if (o.hole) {
    const h = o.hole;
    holes.push(h.loop.map(([a, b]) => mb.vertex(f.at(a, b, top), out, uv(a, b))));
    const hn = h.loop.length;
    const rim: number[] = [], low: number[] = [];
    for (let i = 0; i < hn; i++) {
      const t = sub(f.at(...h.loop[(i + 1) % hn], top), f.at(...h.loop[(i + hn - 1) % hn], top));
      // into the void of the hole
      const centre = f.at(h.loop.reduce((s, p) => s + p[0], 0) / hn, h.loop.reduce((s, p) => s + p[1], 0) / hn, top);
      const p = f.at(...h.loop[i], top);
      let wn = norm([t[1] * f.inward[2] - t[2] * f.inward[1], t[2] * f.inward[0] - t[0] * f.inward[2], t[0] * f.inward[1] - t[1] * f.inward[0]]);
      const toC = sub(centre, p);
      if (wn[0] * toC[0] + wn[1] * toC[1] + wn[2] * toC[2] < 0) wn = scale(wn, -1);
      rim.push(mb.vertex(p, wn, uv(...h.loop[i]), 0.5));
      low.push(mb.vertex(f.at(...h.loop[i], top + h.depth), wn, uv(...h.loop[i]), 0.12));
    }
    mb.strip(rim, low, true);
    const floor = h.loop.map(([a, b]) => mb.vertex(f.at(a, b, top + h.depth), out, uv(a, b), 0.1));
    mb.polygon(floor, [], pick2d(f.inward), out);
  }
  mb.polygon(topRing, holes, pick2d(f.inward), out);
  // side normals: outwards from the loop, in the plane of the face
  const sideN = loop.map((_, i) => {
    const t = sub(f.at(...loop[(i + 1) % n], 0), f.at(...loop[(i + n - 1) % n], 0));
    let wn = norm([t[1] * f.inward[2] - t[2] * f.inward[1], t[2] * f.inward[0] - t[0] * f.inward[2], t[0] * f.inward[1] - t[1] * f.inward[0]]);
    const centre = f.at((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, 0);
    const toP = sub(f.at(...loop[i], 0), centre);
    if (wn[0] * toP[0] + wn[1] * toP[1] + wn[2] * toP[2] < 0) wn = scale(wn, -1);
    return wn;
  });
  if (c > 0) {
    const cn = sideN.map((s) => norm([s[0] + out[0], s[1] + out[1], s[2] + out[2]]));
    const a = inner.map(([x, y], i) => mb.vertex(f.at(x, y, top), cn[i], uv(x, y)));
    const b = loop.map(([x, y], i) => mb.vertex(f.at(x, y, top + c), cn[i], uv(x, y)));
    mb.strip(a, b, true);
  }
  const w0 = loop.map(([x, y], i) => mb.vertex(f.at(x, y, top + c), sideN[i], uv(x, y), 0.8));
  const w1 = loop.map(([x, y], i) => mb.vertex(f.at(x, y, top + o.depth), sideN[i], uv(x, y), 0.4));
  mb.strip(w0, w1, true);
  return mb.build();
}

function pick2d(inward: V3): (p: V3) => V2 {
  const ax = Math.abs(inward[0]), ay = Math.abs(inward[1]), az = Math.abs(inward[2]);
  return (p) => (az >= ax && az >= ay ? [p[0], p[1]] : ax >= ay ? [p[1], p[2]] : [p[0], p[2]]);
}

/** Black glass, flush with the front face. */
export function buildGlass(d: BodyDims = bodyDims()): MeshData {
  return buildSlab(frontParts(d).bezel, { at: (a, b, depth) => [a, b, d.zf - depth], inward: [0, 0, -1] }, { chamfer: 0.1, depth: 0.85 });
}

/**
 * The lit picture: a flat rounded rectangle in ITS OWN frame (origin at the
 * centre of the picture, +Z out). UV (0,0) is the bottom-left pixel corner.
 */
export function buildScreen(d: BodyDims = bodyDims()): MeshData {
  const mb = new MeshBuilder();
  const ring = frontParts(d).screen.map(([x, y]) => mb.vertex([x, y, 0], [0, 0, 1], [x / d.screen.w + 0.5, y / d.screen.h + 0.5]));
  mb.polygon(ring, [], (p) => [p[0], p[1]], [0, 0, 1]);
  return mb.build();
}

/** Light guide, flush in the top-right corner of the front face. */
export function buildLed(d: BodyDims = bodyDims()): MeshData {
  return buildSlab(frontParts(d).led, { at: (a, b, depth) => [a, b, d.zf - depth], inward: [0, 0, -1] }, { chamfer: 0.08, depth: 0.85 });
}

/** Glossy window in the right wall. */
export function buildWindow(d: BodyDims = bodyDims()): MeshData {
  return buildSlab(wallOpenings(d).windowLoop, { at: (t, z, depth) => [d.hw - depth, t, z], inward: [-1, 0, 0] }, { chamfer: 0.1, depth: 0.75 });
}

/** One contact pad (index 0 = silver, towards +X). Sits just proud of the floor of the pill recess. */
export function buildPad(index: number, d: BodyDims = bodyDims()): MeshData {
  const prof = backProfile(d);
  const [x, y] = backOpenings().pads[index];
  return buildSlab(circleLoop(x, y, BF.pogo.padD / 2, 24), { at: (a, b, depth) => [a, b, prof.z(b) + depth], inward: [0, 0, 1] }, { top: BF.pogo.depth - 0.12, chamfer: 0.12, depth: 0.6 });
}

/** Screw head with a hexagonal socket, in its counterbore. */
export function buildScrew(d: BodyDims = bodyDims()): MeshData {
  const prof = backProfile(d);
  const s = BF.screw;
  const hex = circleLoop(s.x, s.y, 1.05, 6);
  return buildSlab(circleLoop(s.x, s.y, s.d / 2, 28), { at: (a, b, depth) => [a, b, prof.z(b) + depth], inward: [0, 0, 1] }, { top: s.depth - 0.2, chamfer: 0.25, depth: 0.7, hole: { loop: hex, depth: 0.9 } });
}

// ----------------------------------------------------------------- buttons
/**
 * Round button, in its own frame (z = 0 is the front face, +Z out): a black
 * body with a rounded shoulder and a shallow dish, and a coloured inlay in the
 * middle. Returns the two meshes.
 */
export function buildButton(id: 'top' | 'bottom', d: BodyDims = bodyDims()): { body: MeshData; inlay: MeshData; height: number } {
  const b = d.buttons[id];
  const R = b.r;
  const rc = b.capR;
  const h = BUTTON_PROUD_MM_ESTIMATE;
  const e = 0.55;
  const body: V2[] = [[R, -1.2], [R, h - e]];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    body.push([R - e + e * Math.cos(a), h - e + e * Math.sin(a)]);
  }
  body.push([rc + 0.4, h - 0.3], [rc + 0.05, h - 0.36], [rc + 0.05, h - 1.0]);
  const mbBody = new MeshBuilder();
  mbBody.lathe(body, 48, (_r, z) => (z < 0 ? 0.35 : 1));
  const inlay: V2[] = [[rc, h - 1.0], [rc, h - 0.4], [rc - 0.1, h - 0.3], [rc * 0.6, h - 0.27], [0, h - 0.25]];
  const mbIn = new MeshBuilder();
  mbIn.lathe(inlay, 40);
  return { body: mbBody.build(), inlay: mbIn.build(), height: h };
}

// ------------------------------------------------------------------- D-pad
/** Height of the D-pad's top surface at (x, y) from the pad centre: gently dished in the middle. */
export function dpadTop(x: number, y: number): number {
  const r = Math.min(1, Math.hypot(x, y) / 5.2);
  const k = 1 - r * r;
  return DPAD_PROUD_MM_ESTIMATE - 0.32 * k * k;
}

/**
 * ONE arm of the D-pad (the arm along +X, bounded by the two diagonals), in
 * the pad's frame (z = 0 is the front face). The four arms are this mesh
 * turned by 0, 90, 180 and 270 degrees; they meet exactly on the diagonals.
 */
export function buildDpadArm(d: BodyDims = bodyDims()): MeshData {
  const { half, armHalf: w, innerR } = d.dpad;
  const mb = new MeshBuilder();
  const re = 1.0; // top edge fillet
  const segEnd = 18, segIn = 5, nk = 6;
  const ex = half - w; // centre of the end semicircle
  const edge = (inset: number) => crossArmEdge(half, w, innerR, -inset, segEnd, segIn);
  const base = edge(0);
  // outward direction of the outline at each point (for the UVs of the wall, so the grain does not smear)
  const out = base.map(([x, y]): Pt => {
    const ax = Math.max(0, Math.min(ex, x));
    const l = Math.hypot(x - ax, y) || 1;
    return [(x - ax) / l, y / l];
  });
  const uv = (x: number, y: number): V2 => [0.5 + x / (2 * half), 0.5 + y / (2 * half)];
  const rows: number[][] = [];
  const topAtEdge = (i: number) => dpadTop(base[i][0], base[i][1]);
  const wallRow = (zOf: (i: number) => number, shade: number) =>
    rows.push(
      base.map(([x, y], i) => {
        const drop = topAtEdge(i) - zOf(i);
        return mb.vertex([x, y, zOf(i)], [0, 0, 1], uv(x + out[i][0] * drop, y + out[i][1] * drop), shade);
      }),
    );
  // skirt (hidden in the well) and wall
  wallRow(() => -1.2, 0.3);
  wallRow(() => -0.05, 0.55);
  wallRow((i) => topAtEdge(i) - re, 1);
  for (let k = 1; k <= nk; k++) {
    const th = (k / nk) * (Math.PI / 2);
    const inset = re * (1 - Math.cos(th));
    rows.push(edge(inset).map(([x, y]) => mb.vertex([x, y, dpadTop(x, y) - re * (1 - Math.sin(th))], [0, 0, 1], uv(x, y))));
  }
  const maxInset = w - 0.5;
  for (const inset of [re + 0.55, maxInset]) rows.push(edge(inset).map(([x, y]) => mb.vertex([x, y, dpadTop(x, y)], [0, 0, 1], uv(x, y))));
  // faces point away from the arm's axis
  const facing = (ids: number[]): V3 => {
    let x = 0, y = 0, z = 0;
    for (const i of ids) { const p = mb.p(i); x += p[0]; y += p[1]; z += p[2]; }
    x /= ids.length; y /= ids.length; z /= ids.length;
    const ax = Math.max(0, Math.min(ex, x));
    return [x - ax, y, z + 3];
  };
  for (let r = 0; r < rows.length - 1; r++) {
    const A = rows[r], B = rows[r + 1];
    for (let i = 0; i < A.length - 1; i++) mb.quad(A[i], A[i + 1], B[i + 1], B[i], facing([A[i], A[i + 1], B[i + 1], B[i]]));
  }
  // the middle of the arm: a spine along its axis, so the dish is followed (a fan from one point would crease)
  const last = rows[rows.length - 1];
  const spineAt = new Map<number, number>();
  const spine = (x: number) => {
    const sx = Math.max(0, Math.min(ex, x));
    const key = Math.round(sx * 1e5);
    let v = spineAt.get(key);
    if (v === undefined) spineAt.set(key, (v = mb.vertex([sx, 0, dpadTop(sx, 0)], [0, 0, 1], uv(sx, 0))));
    return v;
  };
  const centre = spine(0);
  const up: V3 = [0, 0, 1];
  for (let i = 0; i < last.length - 1; i++) {
    const a = last[i], b = last[i + 1];
    const sa = spine(mb.p(a)[0]), sb = spine(mb.p(b)[0]);
    mb.tri(a, b, sb, up);
    mb.tri(a, sb, sa, up);
  }
  // the two wedges between the diagonals, the spine and the centre
  mb.tri(centre, last[0], spine(mb.p(last[0])[0]), up);
  mb.tri(centre, spine(mb.p(last[last.length - 1])[0]), last[last.length - 1], up);
  mb.computeNormals();
  // the true normal on a seam lies in the seam's mirror plane
  const s = Math.SQRT1_2;
  for (const r of rows) {
    for (const [i, pn] of [[r[0], [s, s, 0]], [r[r.length - 1], [s, -s, 0]]] as [number, V3][]) {
      const n = mb.n(i);
      const k = n[0] * pn[0] + n[1] * pn[1] + n[2] * pn[2];
      mb.setNormal(i, norm([n[0] - k * pn[0], n[1] - k * pn[1], n[2] - k * pn[2]]));
    }
  }
  mb.setNormal(centre, [0, 0, 1]);
  return mb.build();
}
