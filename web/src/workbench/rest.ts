/**
 * How things rest on the table: nothing is ever under it. Pure geometry (three's maths only, no WebGL), unit-tested.
 *
 *  - A part with legs (`plugMm`: they reach below its seating plane) stands on them when it is not in a board's holes.
 *  - The Dot with a module on its header is one rigid thing. It lies on the lowest points of the whole assembly: when
 *    the module reaches lower than the Dot's back (the radio modules' tongue lies against the back), the top end of the
 *    Dot is propped up and the Dot rests tilted on its bottom edge and on the module, the way the real stack lies.
 *
 * Frames: the Dot's own (X right, Y toward its top edge, Z out of the screen, origin the centre of its box); lying on
 * the table its +Z is up and its +Y points away from the viewer.
 */
import { Euler, Matrix4, Quaternion, Vector3, type BufferAttribute, type Mesh, type Object3D } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

const v = new Vector3();
const m4 = new Matrix4();

/** Every vertex of an object's meshes, in the object's own frame (x, y, z triples). */
export function vertexCloud(root: Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const out: number[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    const pos = mesh.isMesh ? (mesh.geometry?.getAttribute('position') as BufferAttribute | undefined) : undefined;
    if (!pos) return;
    m4.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      out.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(out);
}

/**
 * The corners of the convex hull of a cloud: the only points that can be the lowest however the thing is turned, so
 * resting it costs a few hundred points instead of every vertex. A cloud too small or too flat for a hull is returned
 * whole.
 */
export function hullCorners(cloud: Float32Array): Float32Array {
  const seen = new Set<string>();
  const pts: Vector3[] = [];
  for (let i = 0; i < cloud.length; i += 3) {
    const k = `${Math.round(cloud[i] * 100)},${Math.round(cloud[i + 1] * 100)},${Math.round(cloud[i + 2] * 100)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push(new Vector3(cloud[i], cloud[i + 1], cloud[i + 2]));
  }
  if (pts.length < 8) return cloud;
  let hull: ConvexHull;
  try {
    hull = new ConvexHull().setFromPoints(pts);
  } catch {
    return cloud;
  }
  const on = new Set<Vector3>();
  for (const f of hull.faces) {
    let e = f.edge;
    do {
      on.add(e.head().point);
      e = e.next;
    } while (e !== f.edge);
  }
  if (on.size < 4) return cloud;
  const out = new Float32Array(on.size * 3);
  let n = 0;
  for (const p of on) {
    out[n++] = p.x;
    out[n++] = p.y;
    out[n++] = p.z;
  }
  return out;
}

/** Points through a column-major 4x4 (a mount matrix: the module's model frame to the Dot's frame), into a new array. */
export function transformed(points: Float32Array, matrix: ArrayLike<number>): Float32Array {
  m4.fromArray(matrix as number[]);
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    v.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(m4);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  return out;
}

/** The eight corners of the Dot's box in its own frame. */
export function dotCorners(hw: number, hh: number, zf: number, zb: number): Float32Array {
  const out = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    out[i * 3] = i & 1 ? hw : -hw;
    out[i * 3 + 1] = i & 2 ? hh : -hh;
    out[i * 3 + 2] = i & 4 ? zf : zb;
  }
  return out;
}

/**
 * The angle (radians, about the Dot's own X; positive lifts its top edge) at which the Dot and what is mounted on it
 * lie on the table: the lower edge of the assembly's outline, seen from the side, that is under its centre of mass.
 * `sets` are point sets in the Dot's frame (its own corners first); `comY` is where the weight is along the Dot (its
 * middle: the battery and the boards are in the Dot, a module is light).
 */
export function restTilt(sets: readonly Float32Array[], comY = 0): number {
  // the outline from the side: (Y, Z) of every point; its lower hull, left to right (Andrew's monotone chain)
  const pts: [number, number][] = [];
  for (const s of sets) for (let i = 0; i < s.length; i += 3) pts.push([s[i + 1], s[i + 2]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const low: [number, number][] = [];
  for (const p of pts) {
    while (low.length >= 2) {
      const a = low[low.length - 2], b = low[low.length - 1];
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 1e-9) low.pop();
      else break;
    }
    low.push(p);
  }
  for (let i = 0; i + 1 < low.length; i++) {
    const a = low[i], b = low[i + 1];
    if (a[0] <= comY && comY <= b[0] && b[0] - a[0] > 1e-6) return Math.atan2(-(b[1] - a[1]), b[0] - a[0]) || 0;
  }
  return 0;
}

/** How far a legged part is raised when it stands on the table on its own legs (its model's `plugMm`). */
export const standLift = (plugMm: number | undefined): number => Math.max(0, plugMm ?? 0);

/** The Dot lying on its back: the model's front (+Z) looks up, its top edge (+Y) points away from the viewer (-Z). */
export const LYING = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const X_AXIS = new Vector3(1, 0, 0);
const qr = new Quaternion();
/**
 * The Dot's attitude on the table: lying, then the hand's tilt (`user`, in the lying Dot's frame), then the way the
 * assembly lies by itself (`rest`, about the Dot's own X).
 */
export function lyingQuat(user: Quaternion | null, rest: number, out: Quaternion): Quaternion {
  out.copy(LYING);
  if (user) out.multiply(user);
  if (rest !== 0) out.multiply(qr.setFromAxisAngle(X_AXIS, rest));
  return out;
}
/** The height of the lowest of some points of the Dot's frame when the Dot is turned by `quat` about its centre. */
export function lowestY(pts: Float32Array, quat: Quaternion): number {
  let low = Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const y = v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(quat).y;
    if (y < low) low = y;
  }
  return low;
}
