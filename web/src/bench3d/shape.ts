/**
 * Shape: the geometry accumulator of the Bench3D kit. Parts are added as bevelled solids in a colour and a material
 * family; `toObject()` merges everything into ONE mesh per family (colour lives in the vertices), so a model costs a
 * handful of draw calls and the Workbench can draw any number of copies of it as instances.
 *
 * Model frame: millimetres, origin at the centre of the footprint on the table, X to the right, Z towards the viewer,
 * Y up; the model stands on y = 0. Pure data (MeshBuilder): `build()` works in node, so models are unit-testable.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, Vector3 } from 'three';
import { familyMaterial } from './materials';
import { circleLoop, roundedRectLoop, type Pt } from '../lib/bodyModel';
import { MeshBuilder, type MeshData, type V2, type V3 } from '../device3d/meshBuilder';

/**
 * Material families (materials.ts holds what each looks like): matte plastic and paper, glossy plastic, metal, soft
 * rubber, PCB solder mask, and clear glass or resin (drawn last, see-through).
 */
export type Family = 'matte' | 'gloss' | 'metal' | 'soft' | 'pcb' | 'glass';
export const FAMILIES: readonly Family[] = ['matte', 'gloss', 'metal', 'soft', 'pcb', 'glass'];
/** A family and a colour: what the palette (materials.ts `PAL`) holds, spread into the builders: `s.box(...PAL.tin, ...)`. */
export type Finish = readonly [Family, string];
export interface SolidOptions {
  /** Close the underside (for parts that are turned, raised or seen from below). */
  cap?: boolean;
  /** How dark the walls get towards the surface they stand on (baked contact shade), 0..1; 1 = none. Default 0.74. */
  ao?: number;
  /** Holes through the solid, as loops in the footprint plane (drill holes of a PCB, a slot). */
  holes?: Pt[][];
}

interface Acc {
  pos: number[];
  nrm: number[];
  col: number[];
  idx: number[];
}

const tmpV = new Vector3();
const tmpC = new Color();

export class Shape {
  private acc: Record<Family, Acc> = { matte: mk(), gloss: mk(), metal: mk(), soft: mk(), pcb: mk(), glass: mk() };
  private stack: Matrix4[] = [new Matrix4()];

  /** Everything added inside `fn` is placed by `m` (on top of the transforms already in force). */
  with(m: Matrix4, fn: () => void): void {
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m));
    fn();
    this.stack.pop();
  }
  at(x: number, y: number, z: number, fn: () => void): void {
    this.with(new Matrix4().makeTranslation(x, y, z), fn);
  }

  /** Adds mesh data (its vertex shade is kept as baked occlusion) in a colour, through `local` and the current transform. */
  add(family: Family, colour: string, m: MeshData, local?: Matrix4): void {
    const a = this.acc[family];
    const base = a.pos.length / 3;
    const mat = local ? this.stack[this.stack.length - 1].clone().multiply(local) : this.stack[this.stack.length - 1];
    tmpC.set(colour); // a hex colour is sRGB: three converts it to the linear working space once, here
    for (let i = 0; i < m.positions.length; i += 3) {
      tmpV.set(m.positions[i], m.positions[i + 1], m.positions[i + 2]).applyMatrix4(mat);
      a.pos.push(tmpV.x, tmpV.y, tmpV.z);
      tmpV.set(m.normals[i], m.normals[i + 1], m.normals[i + 2]).transformDirection(mat);
      a.nrm.push(tmpV.x, tmpV.y, tmpV.z);
      a.col.push(tmpC.r * m.colors[i], tmpC.g * m.colors[i + 1], tmpC.b * m.colors[i + 2]);
    }
    for (let i = 0; i < m.indices.length; i++) a.idx.push(base + m.indices[i]);
  }

  /**
   * A vertical prism over a loop given in the footprint plane (x, z), from y0 up to y1: flat top, a bevel that shades as
   * a rounded edge, walls that darken a little towards the surface they stand on. `cap` closes the underside (for parts
   * that are turned or seen from below).
   */
  prism(family: Family, colour: string, loop: Pt[], y0: number, y1: number, bevel = 0.5, o: SolidOptions = {}): void {
    const mb = new MeshBuilder();
    const n = loop.length;
    const b = Math.max(0, Math.min(bevel, (y1 - y0) * 0.5));
    const ao = o.ao ?? 0.74;
    // outward normals in the footprint plane, from the way the loop turns (so notches and other concave
    // outlines get walls that face out of the material, not towards the middle of the shape)
    const turn = signedArea(loop) >= 0 ? 1 : -1;
    const out: V2[] = loop.map((_, i) => {
      const a = loop[(i + n - 1) % n], c = loop[(i + 1) % n];
      const nx = (c[1] - a[1]) * turn, nz = -(c[0] - a[0]) * turn;
      const l = Math.hypot(nx, nz) || 1;
      return [nx / l, nz / l];
    });
    const up: V3 = [0, 1, 0];
    const top = loop.map(([x, z], i) => mb.vertex([x - out[i][0] * b, y1, z - out[i][1] * b], up));
    const holes = o.holes ?? [];
    mb.polygon(top, holes.map((h) => h.map(([x, z]) => mb.vertex([x, y1, z], up))), (p) => [p[0], p[2]], up);
    for (const h of holes) {
      // the wall of a hole faces into the hole (whatever the hole's shape and the way its loop turns)
      const m = h.length;
      const ht = signedArea(h) >= 0 ? -1 : 1;
      const inw: V3[] = h.map((_, i) => {
        const a = h[(i + m - 1) % m], c = h[(i + 1) % m];
        const nx = (c[1] - a[1]) * ht, nz = -(c[0] - a[0]) * ht;
        const l = Math.hypot(nx, nz) || 1;
        return [nx / l, 0, nz / l];
      });
      const h0 = h.map(([x, z], i) => mb.vertex([x, y1, z], inw[i], [0, 0], 0.55));
      const h1 = h.map(([x, z], i) => mb.vertex([x, y0, z], inw[i], [0, 0], 0.3));
      for (let i = 0; i < m; i++) mb.quad(h0[i], h0[(i + 1) % m], h1[(i + 1) % m], h1[i], inw[i]);
    }
    const side: V3[] = out.map(([nx, nz]) => [nx, 0, nz]);
    if (b > 0) {
      const bn: V3[] = out.map(([nx, nz]) => [nx * Math.SQRT1_2, Math.SQRT1_2, nz * Math.SQRT1_2]);
      const r0 = loop.map(([x, z], i) => mb.vertex([x - out[i][0] * b, y1, z - out[i][1] * b], bn[i]));
      const r1 = loop.map(([x, z], i) => mb.vertex([x, y1 - b, z], bn[i]));
      for (let i = 0; i < n; i++) mb.quad(r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i], bn[i]);
    }
    if (y1 - b > y0) {
      const w0 = loop.map(([x, z], i) => mb.vertex([x, y1 - b, z], side[i]));
      const w1 = loop.map(([x, z], i) => mb.vertex([x, y0, z], side[i], [0, 0], ao));
      for (let i = 0; i < n; i++) mb.quad(w0[i], w0[(i + 1) % n], w1[(i + 1) % n], w1[i], side[i]);
    }
    if (o.cap) {
      const down: V3 = [0, -1, 0];
      const under = loop.map(([x, z]) => mb.vertex([x, y0, z], down, [0, 0], ao * 0.85));
      mb.polygon(under, holes.map((h) => h.map(([x, z]) => mb.vertex([x, y0, z], down, [0, 0], ao * 0.85))), (p) => [p[0], p[2]], down);
    }
    this.add(family, colour, mb.build());
  }
  /** A rounded box standing on y0: `r` is the corner radius seen from above. */
  box(family: Family, colour: string, cx: number, cz: number, w: number, d: number, y0: number, y1: number, r = 1.2, bevel = 0.5, o: SolidOptions = {}): void {
    // corners get as many segments as their radius can show
    this.prism(family, colour, roundedRectLoop(cx, cz, w, d, r, r > 6 ? 7 : r > 2 ? 5 : r > 0.45 ? 3 : r > 0.12 ? 2 : 1), y0, y1, bevel, o);
  }
  disc(family: Family, colour: string, cx: number, cz: number, r: number, y0: number, y1: number, bevel = 0.4, seg = 28, o: SolidOptions = {}): void {
    this.prism(family, colour, circleLoop(cx, cz, r, seg), y0, y1, bevel, o);
  }
  /** A solid of revolution about the vertical through (cx, cz): `profile` is [radius, y] from the outside in (top last). */
  lathe(family: Family, colour: string, cx: number, cz: number, profile: V2[], seg = 24): void {
    const mb = new MeshBuilder();
    mb.lathe(profile, seg);
    // the builder revolves about +Z: stand it up
    this.add(family, colour, mb.build(), new Matrix4().makeTranslation(cx, 0, cz).multiply(new Matrix4().makeRotationX(-Math.PI / 2)));
  }
  /** A round tube along a polyline (a cable, an antenna, a key ring). */
  tube(family: Family, colour: string, pts: V3[], r: number, seg = 8, closed = false): void {
    const n = pts.length;
    const positions = new Float32Array(n * seg * 3);
    const normals = new Float32Array(n * seg * 3);
    writeTube(positions, normals, pts, r, seg, closed);
    const colors = new Float32Array(n * seg * 3).fill(1);
    this.add(family, colour, { positions, normals, colors, uvs: new Float32Array(n * seg * 2), indices: tubeIndices(n, seg, closed) });
    if (closed) return;
    // flat ends, so an antenna or a cut cable is not a hollow pipe
    for (const end of [0, n - 1]) {
      const mb = new MeshBuilder();
      const a0 = pts[end], b0 = pts[end === 0 ? 1 : n - 2];
      const l = Math.hypot(a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]) || 1;
      const out: V3 = [(a0[0] - b0[0]) / l, (a0[1] - b0[1]) / l, (a0[2] - b0[2]) / l];
      const c = mb.vertex(a0, out);
      const ring: number[] = [];
      for (let k = 0; k < seg; k++) {
        const o = (end * seg + k) * 3;
        ring.push(mb.vertex([positions[o], positions[o + 1], positions[o + 2]], out));
      }
      for (let k = 0; k < seg; k++) mb.tri(c, ring[k], ring[(k + 1) % seg], out);
      this.add(family, colour, mb.build());
    }
  }
  /** A flat-shaded box given by its centre and half extents, turned by `m` (legs, stands, tilted plates): bevelled on all edges. */
  block(family: Family, colour: string, hx: number, hy: number, hz: number, m: Matrix4, bevel = 0.5): void {
    const mb = new MeshBuilder();
    const b = Math.min(bevel, hx * 0.5, hy * 0.5, hz * 0.5);
    // three pairs of faces, each inset by the bevel, joined by bevel strips with averaged normals
    const face = (ax: 0 | 1 | 2, s: 1 | -1) => {
      const h = [hx, hy, hz];
      const u = ((ax + 1) % 3) as 0 | 1 | 2, v = ((ax + 2) % 3) as 0 | 1 | 2;
      const n: V3 = [0, 0, 0];
      n[ax] = s;
      const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => {
        const p: V3 = [0, 0, 0];
        p[ax] = s * h[ax];
        p[u] = a * (h[u] - b);
        p[v] = c * (h[v] - b);
        return mb.vertex(p, n);
      });
      mb.quad(ring[0], ring[1], ring[2], ring[3], n);
    };
    for (const ax of [0, 1, 2] as const) for (const s of [1, -1] as const) face(ax, s);
    // edges and corners: a convex hull strip per edge, built from the face corners
    const h = [hx, hy, hz];
    const corner = (sx: number, sy: number, sz: number, ax: number): V3 => {
      const s = [sx, sy, sz];
      const p: V3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) p[i] = s[i] * (i === ax ? h[i] : h[i] - b);
      return p;
    };
    for (const ax of [0, 1, 2] as const) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3;
      for (const su of [1, -1]) for (const sv of [1, -1]) {
        // the edge parallel to `ax` between face u and face v
        const n: V3 = [0, 0, 0];
        n[u] = su * Math.SQRT1_2;
        n[v] = sv * Math.SQRT1_2;
        const s = (t: number): [number, number, number] => {
          const q = [0, 0, 0];
          q[ax] = t;
          q[u] = su;
          q[v] = sv;
          return q as [number, number, number];
        };
        const a0 = mb.vertex(corner(...s(-1), u), n), a1 = mb.vertex(corner(...s(1), u), n);
        const b0 = mb.vertex(corner(...s(-1), v), n), b1 = mb.vertex(corner(...s(1), v), n);
        mb.quad(a0, a1, b1, b0, n);
      }
    }
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const n: V3 = [sx * 0.577, sy * 0.577, sz * 0.577];
      mb.tri(mb.vertex(corner(sx, sy, sz, 0), n), mb.vertex(corner(sx, sy, sz, 1), n), mb.vertex(corner(sx, sy, sz, 2), n), n);
    }
    this.add(family, colour, mb.build(), m);
  }

  /** A flat rectangle lying at height `y` (two triangles): a pad, a mark, a label area that needs no thickness. */
  rect(family: Family, colour: string, cx: number, cz: number, w: number, d: number, y: number): void {
    const mb = new MeshBuilder();
    const up: V3 = [0, 1, 0];
    const v = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => mb.vertex([cx + (a * w) / 2, y, cz + (b * d) / 2], up));
    mb.quad(v[0], v[1], v[2], v[3], up);
    this.add(family, colour, mb.build());
  }
  /** A cylinder between two points with flat ends (a pin, an axle, a lying capacitor body). */
  rod(family: Family, colour: string, a: V3, b: V3, r: number, seg = 12): void {
    this.tube(family, colour, [a, b], r, seg);
  }
  /**
   * A strip wrapped round a vertical cylinder at (cx, cz): from angle a0 to a1 (radians, 0 = +X, towards +Z), between
   * y0 and y1, a hair outside radius `r`. For the stripe of a capacitor's sleeve, a label band, a knurl.
   */
  band(family: Family, colour: string, cx: number, cz: number, r: number, y0: number, y1: number, a0: number, a1: number, seg = 8): void {
    const mb = new MeshBuilder();
    const lo: number[] = [], hi: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const n: V3 = [Math.cos(a), 0, Math.sin(a)];
      lo.push(mb.vertex([cx + n[0] * (r + 0.03), y0, cz + n[2] * (r + 0.03)], n));
      hi.push(mb.vertex([cx + n[0] * (r + 0.03), y1, cz + n[2] * (r + 0.03)], n));
    }
    for (let i = 0; i < seg; i++) mb.quad(lo[i], lo[i + 1], hi[i + 1], hi[i], mb.n(lo[i]));
    this.add(family, colour, mb.build());
  }

  /** One geometry per family that has anything in it. */
  build(): Partial<Record<Family, BufferGeometry>> {
    const out: Partial<Record<Family, BufferGeometry>> = {};
    for (const f of FAMILIES) {
      const a = this.acc[f];
      if (!a.idx.length) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(a.pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(a.nrm), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(a.col), 3));
      g.setIndex(new BufferAttribute(a.pos.length / 3 > 65535 ? new Uint32Array(a.idx) : new Uint16Array(a.idx), 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out[f] = g;
    }
    return out;
  }
  triangles(): number {
    return FAMILIES.reduce((s, f) => s + this.acc[f].idx.length / 3, 0);
  }
  /**
   * The merged meshes in a group, one per family, with the kit's shared materials. Used directly under a model's root
   * they are its static body (instanced by the Workbench); inside a named sub-group they are a moving part.
   */
  toObject(name = ''): Group {
    const g = new Group();
    g.name = name;
    const built = this.build();
    for (const f of FAMILIES) {
      const geo = built[f];
      if (!geo) continue;
      const m = new Mesh(geo, familyMaterial(f));
      m.name = `body:${f}`;
      m.userData.bench3d = 'static';
      m.userData.family = f;
      if (f === 'glass') m.renderOrder = 3;
      g.add(m);
    }
    return g;
  }
}

function mk(): Acc {
  return { pos: [], nrm: [], col: [], idx: [] };
}
/** Twice the signed area of a loop in the footprint plane (its sign says which way the loop turns). */
function signedArea(l: Pt[]): number {
  let s = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/** The convex outline round a set of points in the footprint plane (two circles make a teardrop or a stadium). */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Triangle indices of a tube of `n` rings of `seg` vertices. */
export function tubeIndices(n: number, seg: number, closed = false): Uint32Array {
  const rings = closed ? n : n - 1;
  const out = new Uint32Array(rings * seg * 6);
  let k = 0;
  for (let i = 0; i < rings; i++) {
    const a = i * seg, b = ((i + 1) % n) * seg;
    for (let s = 0; s < seg; s++) {
      const t = (s + 1) % seg;
      out[k++] = a + s;
      out[k++] = b + s;
      out[k++] = a + t;
      out[k++] = a + t;
      out[k++] = b + s;
      out[k++] = b + t;
    }
  }
  return out;
}

const _t = [0, 0, 0], _u = [0, 0, 0], _w = [0, 0, 0];
/**
 * Writes the rings of a tube along `pts` into existing arrays (no allocation: a cable that moves is rewritten in place).
 * The frame is carried along the line, starting from the world's up.
 */
export function writeTube(positions: Float32Array, normals: Float32Array, pts: ArrayLike<ArrayLike<number>>, r: number, seg: number, closed = false): void {
  const n = pts.length;
  let ux = 0, uy = 1, uz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    _t[0] = b[0] - a[0];
    _t[1] = b[1] - a[1];
    _t[2] = b[2] - a[2];
    const tl = Math.hypot(_t[0], _t[1], _t[2]) || 1;
    _t[0] /= tl;
    _t[1] /= tl;
    _t[2] /= tl;
    // keep `u` square to the tangent (carried from the ring before, so the tube does not twist)
    let d = ux * _t[0] + uy * _t[1] + uz * _t[2];
    if (Math.abs(d) > 0.98) {
      ux = 1;
      uy = 0;
      uz = 0;
      d = _t[0];
    }
    _u[0] = ux - d * _t[0];
    _u[1] = uy - d * _t[1];
    _u[2] = uz - d * _t[2];
    const ul = Math.hypot(_u[0], _u[1], _u[2]) || 1;
    ux = _u[0] / ul;
    uy = _u[1] / ul;
    uz = _u[2] / ul;
    _w[0] = _t[1] * uz - _t[2] * uy;
    _w[1] = _t[2] * ux - _t[0] * uz;
    _w[2] = _t[0] * uy - _t[1] * ux;
    const p = pts[i];
    for (let s = 0; s < seg; s++) {
      const ang = (s / seg) * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const nx = ux * c + _w[0] * sn, ny = uy * c + _w[1] * sn, nz = uz * c + _w[2] * sn;
      const o = (i * seg + s) * 3;
      positions[o] = p[0] + nx * r;
      positions[o + 1] = p[1] + ny * r;
      positions[o + 2] = p[2] + nz * r;
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
    }
  }
}
