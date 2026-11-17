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
import { POSE_AXES, type DotPose } from './layout';

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
 * How the Dot and what is mounted on it settle on the table when the Dot is put down a given way: the angle (radians)
 * about `axis` (in the Dot's frame) by which the assembly rocks from the pose until it lies on the lower edge of its
 * outline that is under its centre of mass. `up` is the Dot-frame direction that points up in the pose, `along` the
 * direction along which the assembly is long (the outline is seen square to both); `axis` is along x up, so a
 * positive angle lifts the +along end. `sets` are point sets in the Dot's frame (its own corners first); `com` is
 * where the weight is along `along` (the Dot's middle: the battery and the boards are in the Dot, a module is light).
 */
export function restTilt(sets: readonly Float32Array[], up: readonly [number, number, number] = [0, 0, 1], along: readonly [number, number, number] = [0, 1, 0], com = 0): number {
  // the outline from the side: (along, up) of every point; its lower hull, left to right (Andrew's monotone chain)
  const pts: [number, number][] = [];
  for (const s of sets) for (let i = 0; i < s.length; i += 3) pts.push([s[i] * along[0] + s[i + 1] * along[1] + s[i + 2] * along[2], s[i] * up[0] + s[i + 1] * up[1] + s[i + 2] * up[2]]);
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
    if (a[0] <= com && com <= b[0] && b[0] - a[0] > 1e-6) return Math.atan2(-(b[1] - a[1]), b[0] - a[0]) || 0;
  }
  return 0;
}

/** How far a legged part is raised when it stands on the table on its own legs (its model's `plugMm`). */
export const standLift = (plugMm: number | undefined): number => Math.max(0, plugMm ?? 0);

/** The Dot lying on its back: the model's front (+Z) looks up, its top edge (+Y) points away from the viewer (-Z). */
export const LYING = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const LYING_BACK = LYING.clone().invert();
const UP = new Vector3(0, 1, 0);
const qr = new Quaternion();

/** One way of putting the Dot down, for the scene: its rotation, and how it rocks when a module props it up. */
export interface PoseFrame {
  pose: DotPose;
  /** The Dot's frame to the table's. */
  base: Quaternion;
  /** In the Dot's frame: the direction that is up, the direction the assembly is long in, and the axis it rocks about. */
  up: [number, number, number];
  along: [number, number, number];
  axis: Vector3;
}
const frames = new Map<DotPose, PoseFrame>();
/** The frame of a pose, made from the same axes the table's numbers use (layout.ts, POSE_AXES). */
export function poseFrame(pose: DotPose): PoseFrame {
  let f = frames.get(pose);
  if (!f) {
    const a = POSE_AXES[pose];
    const base = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(...a.x), new Vector3(...a.y), new Vector3(...a.z)));
    // what points up: the Dot axis whose image is the table's +Y (each pose turns the Dot by quarter turns)
    const up: [number, number, number] = [a.x[1], a.y[1], a.z[1]];
    // standing, the Dot is short and deep at its foot: it could only rock front to back; lying or on its side, along its length
    const along: [number, number, number] = Math.abs(up[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
    const axis = new Vector3(...along).cross(new Vector3(...up)).normalize();
    frames.set(pose, (f = { pose, base, up, along, axis }));
  }
  return f;
}

/**
 * The Dot's attitude on the table: put down as `frame` says, turned on the table by `heading` degrees (clockwise seen
 * from above), tipped by the hand (`tilt`: pitch about the table's left-right line and roll about its near-far line,
 * as a rotation in the lying Dot's frame, or null), and rocked by `rest` about the frame's axis (how the assembly
 * lies by itself).
 */
export function restingQuat(frame: PoseFrame, tilt: Quaternion | null, headingDeg: number, rest: number, out: Quaternion): Quaternion {
  out.copy(frame.base);
  if (headingDeg !== 0) out.premultiply(qr.setFromAxisAngle(UP, (-headingDeg * Math.PI) / 180));
  // the hand's tilt is about the table's own lines, whichever way the Dot is put down
  if (tilt) out.premultiply(qr.copy(LYING).multiply(tilt).multiply(LYING_BACK));
  if (rest !== 0) out.multiply(qr.setFromAxisAngle(frame.axis, rest));
  return out;
}
/** As `restingQuat` for the lying Dot with the hand's tilt and turn in one rotation (kept for what only knows lying). */
export function lyingQuat(user: Quaternion | null, rest: number, out: Quaternion): Quaternion {
  out.copy(LYING);
  if (user) out.multiply(user);
  if (rest !== 0) out.multiply(qr.setFromAxisAngle(poseFrame('lying').axis, rest));
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
