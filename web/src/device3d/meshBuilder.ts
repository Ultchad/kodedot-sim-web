/**
 * A small indexed-mesh builder: positions, normals, UVs and a per-vertex
 * occlusion shade, plus planar polygons with holes (ear clipping from three's
 * ShapeUtils). Pure data, no WebGL: usable in node for the unit tests.
 */
import { ShapeUtils, Vector2 } from 'three';

export type V3 = [number, number, number];
export type V2 = [number, number];

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** rgb multiplier (baked ambient occlusion), 0..1 */
  colors: Float32Array;
  indices: Uint32Array;
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }
  get triangleCount() {
    return this.idx.length / 3;
  }

  vertex(p: V3, n: V3, uv: V2 = [0, 0], shade = 1): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(shade, shade, shade);
    return i;
  }

  p(i: number): V3 {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  n(i: number): V3 {
    return [this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]];
  }
  setNormal(i: number, n: V3) {
    this.nrm[i * 3] = n[0];
    this.nrm[i * 3 + 1] = n[1];
    this.nrm[i * 3 + 2] = n[2];
  }
  setShade(i: number, s: number) {
    this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = s;
  }

  /** Triangle, re-wound if needed so that it faces `facing` (default: the average of its vertex normals). */
  tri(a: number, b: number, c: number, facing?: V3) {
    if (a === b || b === c || a === c) return;
    const pa = this.p(a);
    const g = cross(sub(this.p(b), pa), sub(this.p(c), pa));
    if (g[0] === 0 && g[1] === 0 && g[2] === 0) return; // degenerate
    const f = facing ?? add(add(this.n(a), this.n(b)), this.n(c));
    if (dot(g, f) >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  quad(a: number, b: number, c: number, d: number, facing?: V3) {
    // split along the shorter diagonal
    const ac = sub(this.p(a), this.p(c));
    const bd = sub(this.p(b), this.p(d));
    if (dot(ac, ac) <= dot(bd, bd)) {
      this.tri(a, b, c, facing);
      this.tri(a, c, d, facing);
    } else {
      this.tri(a, b, d, facing);
      this.tri(b, c, d, facing);
    }
  }

  /** Strip between two rows of vertex indices of equal length. `closed` joins the last column to the first. */
  strip(rowA: number[], rowB: number[], closed: boolean, facing?: V3) {
    const n = rowA.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      this.quad(rowA[i], rowA[j], rowB[j], rowB[i], facing);
    }
  }

  /**
   * Planar polygon with holes, given as loops of existing vertex indices.
   * `to2d` projects a vertex onto the polygon's plane. Triangles face `facing`.
   * Vertices that the ear clipper drops because they are exactly collinear are
   * stitched back in, so the result has no T-junctions.
   */
  polygon(contour: number[], holes: number[][], to2d: (p: V3) => V2, facing: V3) {
    const loops = [contour, ...holes];
    const flat: number[] = [];
    const pts2: Vector2[][] = loops.map((loop) =>
      loop.map((i) => {
        flat.push(i);
        const q = to2d(this.p(i));
        return new Vector2(q[0], q[1]);
      }),
    );
    const faces = ShapeUtils.triangulateShape(pts2[0], pts2.slice(1));
    const used = new Set<number>();
    const tris: [number, number, number][] = [];
    for (const f of faces) {
      const t: [number, number, number] = [flat[f[0]], flat[f[1]], flat[f[2]]];
      tris.push(t);
      used.add(t[0]).add(t[1]).add(t[2]);
    }
    // stitch dropped (collinear) vertices back into the triangle that spans them
    for (const loop of loops) {
      const n = loop.length;
      if (loop.every((i) => used.has(i))) continue;
      const start = loop.findIndex((i) => used.has(i));
      if (start < 0) continue;
      let k = 0;
      while (k < n) {
        const a = loop[(start + k) % n];
        const run: number[] = [];
        let m = k + 1;
        while (m < n + 1 && !used.has(loop[(start + m) % n])) run.push(loop[(start + m++) % n]);
        const c = loop[(start + m) % n];
        if (run.length) {
          const ti = tris.findIndex((t) => t.includes(a) && t.includes(c));
          if (ti >= 0) {
            const t = tris[ti];
            const x = t.find((v) => v !== a && v !== c)!;
            tris.splice(ti, 1);
            const chain = [a, ...run, c];
            for (let q = 0; q < chain.length - 1; q++) tris.push([chain[q], chain[q + 1], x]);
          }
        }
        k = m;
      }
    }
    for (const t of tris) this.tri(t[0], t[1], t[2], facing);
  }

  /** Replace every normal by the area-weighted average of the faces around the vertex (smooth shading). */
  computeNormals() {
    this.nrm.fill(0);
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      const g = cross(sub(this.p(b), this.p(a)), sub(this.p(c), this.p(a)));
      for (const v of [a, b, c]) {
        this.nrm[v * 3] += g[0];
        this.nrm[v * 3 + 1] += g[1];
        this.nrm[v * 3 + 2] += g[2];
      }
    }
    for (let v = 0; v < this.vertexCount; v++) this.setNormal(v, norm(this.n(v)));
  }

  /**
   * Surface of revolution about +Z. `profile` is a list of [radius, z] from the
   * outside in; corners sharper than `crease` radians stay hard edges.
   */
  lathe(profile: V2[], segments: number, shade: (r: number, z: number) => number = () => 1, crease = 0.6) {
    const segN: V2[] = [];
    for (let i = 0; i < profile.length - 1; i++) {
      const dr = profile[i + 1][0] - profile[i][0];
      const dz = profile[i + 1][1] - profile[i][1];
      const l = Math.hypot(dr, dz) || 1;
      segN.push([dz / l, -dr / l]);
    }
    // one or two normals per profile point
    const rows: { r: number; z: number; n: V2 }[][] = profile.map(([r, z], i) => {
      const a = segN[Math.max(0, i - 1)];
      const b = segN[Math.min(segN.length - 1, i)];
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
      if (i === 0 || i === profile.length - 1 || ang < crease) {
        const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
        return [{ r, z, n: [(a[0] + b[0]) / l, (a[1] + b[1]) / l] as V2 }];
      }
      return [{ r, z, n: a }, { r, z, n: b }];
    });
    const ring = (q: { r: number; z: number; n: V2 }): number[] => {
      const out: number[] = [];
      const count = q.r < 1e-6 ? 1 : segments;
      for (let s = 0; s < count; s++) {
        const a = (s / segments) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        out.push(this.vertex([q.r * c, q.r * sn, q.z], count === 1 ? [0, 0, Math.sign(q.n[1]) || 1] : [q.n[0] * c, q.n[0] * sn, q.n[1]], [0.5 + q.r * c * 0.05, 0.5 + q.r * sn * 0.05], shade(q.r, q.z)));
      }
      return out;
    };
    const rings = rows.map((row) => row.map(ring));
    for (let i = 0; i < profile.length - 1; i++) {
      const A = rings[i][rings[i].length - 1];
      const B = rings[i + 1][0];
      const facing = (k: number): V3 => {
        const a = (k / segments) * Math.PI * 2;
        return [segN[i][0] * Math.cos(a), segN[i][0] * Math.sin(a), segN[i][1]];
      };
      for (let s = 0; s < segments; s++) {
        const t = (s + 1) % segments;
        const f = facing(s + 0.5);
        if (B.length === 1) this.tri(A[s], A[t], B[0], f);
        else if (A.length === 1) this.tri(A[0], B[t], B[s], f);
        else this.quad(A[s], A[t], B[t], B[s], f);
      }
    }
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.col),
      indices: new Uint32Array(this.idx),
    };
  }
}

/**
 * Edges that are not shared by exactly two triangles, after welding vertices
 * that sit at the same place (UV seams and hard edges duplicate vertices).
 * An empty result means the mesh is a closed, watertight surface.
 */
export function openEdges(mesh: MeshData, tolerance = 1e-4): number {
  return openEdgeList(mesh, tolerance).length;
}

/** Midpoints of the open edges (see openEdges). */
export function openEdgeList(mesh: MeshData, tolerance = 1e-4): V3[] {
  const key = (i: number) => {
    const q = (v: number) => Math.round(v / tolerance);
    return `${q(mesh.positions[i * 3])},${q(mesh.positions[i * 3 + 1])},${q(mesh.positions[i * 3 + 2])}`;
  };
  const ids = new Map<string, number>();
  const first: number[] = [];
  const weld = (i: number) => {
    const k = key(i);
    let id = ids.get(k);
    if (id === undefined) {
      ids.set(k, (id = ids.size));
      first.push(i);
    }
    return id;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [weld(mesh.indices[t]), weld(mesh.indices[t + 1]), weld(mesh.indices[t + 2])];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (a === b) continue;
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(k, (edges.get(k) ?? 0) + (a < b ? 1 : -1));
    }
  }
  // a closed oriented surface uses every edge once in each direction
  const out: V3[] = [];
  const P = (id: number, c: number) => mesh.positions[first[id] * 3 + c];
  for (const [k, v] of edges) {
    if (v === 0) continue;
    const [a, b] = k.split('_').map(Number);
    out.push([(P(a, 0) + P(b, 0)) / 2, (P(a, 1) + P(b, 1)) / 2, (P(a, 2) + P(b, 2)) / 2]);
  }
  return out;
}
