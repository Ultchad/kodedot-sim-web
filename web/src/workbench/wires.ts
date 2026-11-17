/**
 * Terminals and jumper wires on the table. Terminal places come from the parts' manifests (parts/geometry.ts) through
 * where each part stands, and from the Dot's own header through the Dot's pose. Picking is done on the screen (the
 * nearest terminal or wire to the pointer), so a 2.54 mm header can be hit.
 *
 * A wire is a round tube of opaque plastic in its colour with a metal pin at each end. It never passes through a body:
 * it leaves its terminal the way the terminal faces (straight up out of a hole or a socket, outward from a side pin
 * or from the Dot's header in its top wall), bends into its run, lies on the table, climbs over what is low and in its
 * way, goes round what is tall (the Dot with its module, a servo, a router), and comes into the other terminal along
 * that terminal's own direction. The line is `wirePath` (pure, unit-tested); each wire's tube is kept and made again
 * only when its ends or a body near its line change.
 */
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SphereGeometry, Vector3, type Camera, type Quaternion } from 'three';
import type { BenchStore, Wire } from '../bench/store';
import { deviceTerms, termWorld, turn, type DeviceTerm, type LocalTerm } from '../parts/geometry';
import { DESK, DOT, hasBody, rectOf, sizeOf, type Rot } from './layout';

/** What the wires need from the parts service (absent in tests: then only the Dot has terminals). */
export interface WireParts {
  terms(kind: string): LocalTerm[];
  /** How high a part stands: in a board's holes, or on its own legs. */
  liftOf(instance: string): number;
  mountOf(instance: string): number[] | null;
  getVersion(): number;
  /** Is the part standing in a board's holes (its legs are inside the board, not bare)? */
  inHoles?(instance: string): boolean;
  /** The pins of a module's connector to the Dot: in the header when the module is mounted, so nothing can be wired to them there. */
  connector?(kind: string): ReadonlySet<string> | null;
}
export interface TermSpot {
  term: string;
  /** What the tooltip says: the pin's name, and whose it is. */
  name: string;
  owner: string;
  pos: Vector3;
  /** The way a wire leaves it (unit vector). */
  out: Vector3;
  /** Holes of a board (not drawn as dots: the board shows them). */
  hole: boolean;
  /** Out of reach (a mounted module's connector pins): kept for wires already on it, not offered. */
  hidden?: boolean;
}

/** A solid thing on the table, as the box a wire keeps out of (mm; it stands on the table and is `h` high). */
export interface WireBox {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  /** Gone round, not climbed over: the Dot (its screen stays clear) and tall things. */
  round: boolean;
}
/** One end of a wire: the terminal's place, the way a wire leaves it, and the thing it is on (a box's id, or ''). */
export interface WireEnd {
  pos: Vector3;
  out: Vector3;
  owner: string;
}

/** Radius of the insulation and of the metal pin (a jumper wire: 1.6 mm over the insulation, a 0.64 mm pin). */
export const R_WIRE = 0.8;
const R_TIP = 0.32;
const SIDES = 6;
const TIP_SIDES = 5;
/** A pin is three rings: closed to a point inside the terminal, then its two ends. */
const TIP_RINGS = 3;
/** Straight out of the terminal (the pin and the start of the insulation), then the bend into the run. */
export const STUB = 4.5;
export const BEND = 5.5;
/** Where the insulation starts on the pin, and how far the pin goes into the terminal. */
const TIP_OUT = 2.4;
const TIP_IN = 1.4;
/** Height of the middle of a wire that lies on the table, and above a body it crosses. */
export const REST = R_WIRE + 0.25;
const CLEAR = R_WIRE + 1;
/** A body counts from this far outside its box (the wire's own radius and a little air). */
const GROW = R_WIRE + 0.9;
const STEP = 2.5;
/** Taller than this, a thing is gone round. */
export const ROUND_H = 24;
/** Going round: the line keeps BLOCK from the box, and turns its corners NODE away. */
const BLOCK = 5;
const NODE = 11;
/** How far a wire turns aside at an end that faces away from where it is going. */
const LOOP = 9;
/** How stiff a wire is: it falls 1 mm in the first sqrt(SAG) mm of run off a raised place, 4 mm in twice that. */
const SAG = 150;
const DEVICE = deviceTerms();

/**
 * Where a pin of the Dot's header is on the table, and which way a wire leaves it: the pin's place in the Dot's own
 * frame (parts/geometry.ts) through the Dot's pose, 0.4 mm out of the top wall, leaving along the Dot's +Y.
 */
export function deviceTermWorld(d: DeviceTerm, dotPos: Vector3, dotQuat: Quaternion, pos = new Vector3(), out = new Vector3()): { pos: Vector3; out: Vector3 } {
  pos.set(d.X, d.Y + 0.4, d.Z).applyQuaternion(dotQuat).add(dotPos);
  out.set(0, 1, 0).applyQuaternion(dotQuat);
  return { pos, out };
}

// ---- the line ------------------------------------------------------------------------------------------------------
type P2 = [number, number];
type P3 = [number, number, number];
const inRect = (b: WireBox, x: number, z: number, m: number) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
/** Does the segment pass through the box grown by `m` (its inside, not its edge)? */
function segHits(b: WireBox, ax: number, az: number, bx: number, bz: number, m: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 1e-9;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - (b.x0 - m)) && clip(dx, b.x1 + m - ax) && clip(-dz, az - (b.z0 - m)) && clip(dz, b.z1 + m - az) && t1 - t0 > 1e-6;
}

/** The corners to turn at on the way from s to g round the boxes (the shortest way), or [] when the straight line is free or there is no way. */
function wayRound(sx: number, sz: number, gx: number, gz: number, round: readonly WireBox[]): P2[] {
  const free = (ax: number, az: number, bx: number, bz: number) => {
    for (const b of round) if (segHits(b, ax, az, bx, bz, BLOCK)) return false;
    return true;
  };
  if (!round.length || free(sx, sz, gx, gz)) return [];
  const nodes: P2[] = [[sx, sz], [gx, gz]];
  for (const b of round) {
    for (const c of [[b.x0 - NODE, b.z0 - NODE], [b.x1 + NODE, b.z0 - NODE], [b.x1 + NODE, b.z1 + NODE], [b.x0 - NODE, b.z1 + NODE]] as P2[]) {
      if (c[0] < DESK.x0 || c[0] > DESK.x1 || c[1] < DESK.z0 || c[1] > DESK.z1) continue;
      if (round.some((o) => inRect(o, c[0], c[1], BLOCK))) continue;
      nodes.push(c);
    }
  }
  const n = nodes.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === 1) break;
    done[u] = 1;
    for (let w = 0; w < n; w++) {
      if (done[w]) continue;
      const d = dist[u] + Math.hypot(nodes[w][0] - nodes[u][0], nodes[w][1] - nodes[u][1]);
      if (d < dist[w] && free(nodes[u][0], nodes[u][1], nodes[w][0], nodes[w][1])) {
        dist[w] = d;
        prev[w] = u;
      }
    }
  }
  if (dist[1] === Infinity) return [];
  const via: P2[] = [];
  for (let i = prev[1]; i > 0; i = prev[i]) via.unshift(nodes[i]);
  return via;
}

/** A polyline with its corners rounded (each by a quadratic curve that takes at most `r` of the two sides). */
function rounded(p: P2[], r: number): P2[] {
  if (p.length < 3) return p;
  const out: P2[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], c = p[i], b = p[i + 1];
    const la = Math.hypot(c[0] - a[0], c[1] - a[1]), lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const cut = Math.min(r, la / 2, lb / 2);
    if (cut < 0.01) {
      out.push(c);
      continue;
    }
    const A: P2 = [c[0] + ((a[0] - c[0]) / la) * cut, c[1] + ((a[1] - c[1]) / la) * cut];
    const B: P2 = [c[0] + ((b[0] - c[0]) / lb) * cut, c[1] + ((b[1] - c[1]) / lb) * cut];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      out.push([u * u * A[0] + 2 * u * t * c[0] + t * t * B[0], u * u * A[1] + 2 * u * t * c[1] + t * t * B[1]]);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

/** Drops the points a line does not need (Ramer-Douglas-Peucker, `tol` mm): straight runs keep their two ends. */
function simplify(p: P3[], tol: number): P3[] {
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = p[i0], b = p[i1];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    let far = -1, fd = tol * tol;
    for (let i = i0 + 1; i < i1; i++) {
      const t = Math.max(0, Math.min(1, ((p[i][0] - a[0]) * dx + (p[i][1] - a[1]) * dy + (p[i][2] - a[2]) * dz) / l2));
      const ex = p[i][0] - a[0] - dx * t, ey = p[i][1] - a[1] - dy * t, ez = p[i][2] - a[2] - dz * t;
      const d = ex * ex + ey * ey + ez * ez;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([i0, far], [far, i1]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

export interface WirePathOptions {
  /** Sideways shift of the middle of the run (mm): wires between the same two things fan out instead of fusing. */
  fan?: number;
  /** Which way a long free run bows (its slack): even to one side, odd to the other. */
  seed?: number;
  /** Wires this one crosses: at each point (x, z) its middle is at least `y` high, so it passes over the other. */
  over?: readonly { x: number; z: number; y: number }[];
}
/**
 * The line a wire follows from terminal `a` to terminal `b`, as x, y, z triples (the middle of the tube).
 *
 * Out of each terminal straight along its `out` for STUB, a bend, then the run: in plan the straight line, or the
 * shortest way round the `round` boxes (corners rounded); in height on the table (REST), rising to each end and over
 * every box under the line (its top + CLEAR, reached before the box begins), so that no point of the run is inside a
 * box. Only the two stubs may be inside a box: the one their own terminal is on.
 */
export function wirePath(a: WireEnd, b: WireEnd, boxes: readonly WireBox[], o: WirePathOptions = {}): Float32Array {
  const end = (e: WireEnd) => {
    const p0: P3 = [e.pos.x, e.pos.y, e.pos.z];
    const p1: P3 = [p0[0] + e.out.x * STUB, Math.max(REST, p0[1] + e.out.y * STUB), p0[2] + e.out.z * STUB];
    const p2: P3 = [p0[0] + e.out.x * (STUB + BEND), Math.max(REST, p0[1] + e.out.y * (STUB + BEND)), p0[2] + e.out.z * (STUB + BEND)];
    return { p0, p1, p2 };
  };
  const A = end(a), B = end(b);
  const sx = A.p2[0], sz = A.p2[2], gx = B.p2[0], gz = B.p2[2];
  // what is gone round: tall things, unless an end is on or right against one (then the wire climbs it there)
  const reach = 140;
  const round = boxes.filter(
    (bx) => bx.round && !inRect(bx, sx, sz, BLOCK) && !inRect(bx, gx, gz, BLOCK) && bx.x1 > Math.min(sx, gx) - reach && bx.x0 < Math.max(sx, gx) + reach && bx.z1 > Math.min(sz, gz) - reach && bx.z0 < Math.max(sz, gz) + reach,
  );
  // an end that faces away from where the wire is going: the wire does not fold back on itself there, it first turns
  // aside (a loop of the bend's own size) and goes on from that point
  const aside = (e: WireEnd, x: number, z: number, tx: number, tz: number): P2 | null => {
    const oh = Math.hypot(e.out.x, e.out.z);
    const dl = Math.hypot(tx - x, tz - z);
    if (oh < 0.3 || dl < 1e-6) return null;
    const ox = e.out.x / oh, oz = e.out.z / oh, dx = (tx - x) / dl, dz = (tz - z) / dl;
    const along = dx * ox + dz * oz;
    if (along > -0.25) return null;
    let px = dx - along * ox, pz = dz - along * oz;
    const pl = Math.hypot(px, pz);
    if (pl < 0.2) {
      // straight behind: either side will do; the seed chooses, so that neighbours do not all take the same one
      const side = (o.seed ?? 0) & 1 ? -1 : 1;
      px = -oz * side;
      pz = ox * side;
    } else {
      px /= pl;
      pz /= pl;
    }
    const p: P2 = [x + px * LOOP, z + pz * LOOP];
    return round.some((r) => inRect(r, p[0], p[1], BLOCK)) ? null : p;
  };
  const la = aside(a, sx, sz, gx, gz), lb = aside(b, gx, gz, la ? la[0] : sx, la ? la[1] : sz);
  const from = la ?? [sx, sz], to = lb ?? [gx, gz];
  const via = wayRound(from[0], from[1], to[0], to[1], round);
  const plan = rounded([[sx, sz], ...(la ? [la] : []), ...via, ...(lb ? [lb] : []), [gx, gz]], 10);
  // the run by length
  const cum = [0];
  for (let i = 1; i < plan.length; i++) cum.push(cum[i - 1] + Math.hypot(plan[i][0] - plan[i - 1][0], plan[i][1] - plan[i - 1][1]));
  const S = cum[cum.length - 1];
  const n = Math.max(8, Math.min(140, Math.ceil(S / STEP)));
  const bx0 = new Float64Array(n + 1), bz0 = new Float64Array(n + 1);
  for (let k = 0, i = 1; k <= n; k++) {
    const s = (S * k) / n;
    while (i < plan.length - 1 && cum[i] < s) i++;
    const l = cum[i] - cum[i - 1];
    const t = l > 1e-9 ? (s - cum[i - 1]) / l : 0;
    bx0[k] = plan[i - 1][0] + (plan[i][0] - plan[i - 1][0]) * t;
    bz0[k] = plan[i - 1][1] + (plan[i][1] - plan[i - 1][1]) * t;
  }
  // slack and fan: the middle of the run shifted sideways, as far as that keeps it out of what it goes round
  const xs = new Float64Array(n + 1), zs = new Float64Array(n + 1);
  const bow = via.length || la || lb ? 0 : (o.seed ?? 0) & 1 ? -Math.min(7, S * 0.03) : Math.min(7, S * 0.03);
  const shift = (side: number): boolean => {
    let ok = true;
    for (let k = 0; k <= n; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(n, k + 1);
      const dx = bx0[k1] - bx0[k0], dz = bz0[k1] - bz0[k0];
      const l = Math.hypot(dx, dz) || 1;
      const w = side * Math.sin((Math.PI * k) / n);
      xs[k] = bx0[k] - (dz / l) * w;
      zs[k] = bz0[k] + (dx / l) * w;
      if (ok && w !== 0) for (const r of round) if (inRect(r, xs[k], zs[k], GROW)) ok = false;
    }
    return ok;
  };
  const fan = o.fan ?? 0;
  if (!shift(fan + bow) && !shift(fan)) shift(0);

  // how high. The least height at each point: the table, the top of the body under it, the end's own height at the two
  // ends, and a little more than the wire it crosses where it crosses one (`over`)
  const floor = new Float64Array(n + 1);
  let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
  for (let k = 0; k <= n; k++) {
    lx0 = Math.min(lx0, xs[k]);
    lx1 = Math.max(lx1, xs[k]);
    lz0 = Math.min(lz0, zs[k]);
    lz1 = Math.max(lz1, zs[k]);
  }
  const under = boxes.filter((bx) => bx.x1 + GROW > lx0 && bx.x0 - GROW < lx1 && bx.z1 + GROW > lz0 && bx.z0 - GROW < lz1);
  const least = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    let f = 0;
    for (const bx of under) if (bx.h > f && inRect(bx, xs[k], zs[k], GROW)) f = bx.h;
    floor[k] = f;
    least[k] = f > 0 ? f + CLEAR : REST;
  }
  const step = S / n || 1;
  least[0] = Math.max(least[0], A.p2[1]);
  least[n] = Math.max(least[n], B.p2[1]);
  for (const h of o.over ?? []) {
    const reach = step * 0.75 + 2 * R_WIRE;
    for (let k = 1; k < n; k++) if (least[k] < h.y && Math.hypot(xs[k] - h.x, zs[k] - h.z) < reach) least[k] = h.y;
  }
  // The wire's own shape over that: from every raised place it comes away level and falls off as a parabola (it is
  // stiff: SAG millimetres of run for the first millimetre of fall), so between two raised places close together it
  // arcs without touching the table, between two far apart it comes down and lies on the table, and it is at a body's
  // height before the body begins
  const ys = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    let y = least[k];
    for (let i = 0; i <= n; i++) {
      if (least[i] <= y) continue;
      const d = (i - k) * step;
      const v = least[i] - (d * d) / SAG;
      if (v > y) y = v;
    }
    ys[k] = y;
  }

  // and the bottoms of its dips rounded upward (never lowered: it stays clear of what it crosses), so that a wire
  // between two raised places comes down to the table in a curve, not in a V
  for (let pass = 0; pass < 10; pass++) {
    let before = ys[0];
    for (let k = 1; k < n; k++) {
      const cur = ys[k];
      ys[k] = Math.max(cur, (before + 2 * cur + ys[k + 1]) / 4);
      before = cur;
    }
  }

  // the whole line: stub, bend, run, bend, stub
  const j = Math.max(1, Math.min(Math.round(BEND / (S / n || 1)), Math.floor((n - 1) / 2)));
  const M = (k: number): P3 => [xs[k], ys[k], zs[k]];
  const line: P3[] = [A.p0, A.p1];
  const bend = (p: P3, c: P3, q: P3, back: boolean) => {
    for (let i = 1; i <= 5; i++) {
      const t = (back ? 6 - i : i) / 6, u = 1 - t;
      line.push([u * u * p[0] + 2 * u * t * c[0] + t * t * q[0], Math.max(REST, u * u * p[1] + 2 * u * t * c[1] + t * t * q[1]), u * u * p[2] + 2 * u * t * c[2] + t * t * q[2]]);
    }
  };
  bend(A.p1, M(0), M(j), false);
  for (let k = j; k <= n - j; k++) line.push(M(k));
  bend(B.p1, M(n), M(n - j), true);
  line.push(B.p1, B.p0);
  const kept = simplify(line, 0.16);
  const out = new Float32Array(kept.length * 3);
  kept.forEach((p, i) => out.set(p, i * 3));
  return out;
}

// ---- the tube ------------------------------------------------------------------------------------------------------
/**
 * Rings of `sides` vertices round a line (x, y, z triples), with the radius of each ring, written at `at` (in vertices)
 * of `pos` and `nor`; the frame is carried along the line so the tube does not twist. Returns the number of vertices.
 */
export function writeRings(pos: Float32Array, nor: Float32Array, at: number, line: ArrayLike<number>, radius: (i: number, n: number) => number, sides: number): number {
  const n = line.length / 3;
  let ux = 0, uy = 0, uz = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1) * 3, b = Math.min(n - 1, i + 1) * 3;
    let tx = line[b] - line[a], ty = line[b + 1] - line[a + 1], tz = line[b + 2] - line[a + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    if (i === 0) {
      // any direction square to the line: start from the axis the line follows least
      const ax = Math.abs(tx), ay = Math.abs(ty), az = Math.abs(tz);
      ux = ay <= ax && ay <= az ? 0 : ax <= az ? 1 : 0;
      uy = ay <= ax && ay <= az ? 1 : 0;
      uz = ay <= ax && ay <= az ? 0 : ax <= az ? 0 : 1;
    }
    const d = ux * tx + uy * ty + uz * tz;
    ux -= d * tx;
    uy -= d * ty;
    uz -= d * tz;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-6) {
      // the line turned straight into the frame's own direction: take any direction square to it
      ux = Math.abs(ty) < 0.9 ? -tz : 0;
      uy = Math.abs(ty) < 0.9 ? 0 : tz;
      uz = Math.abs(ty) < 0.9 ? tx : -ty;
      ul = Math.hypot(ux, uy, uz) || 1;
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
    const r = radius(i, n);
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const nx = ux * c + wx * sn, ny = uy * c + wy * sn, nz = uz * c + wz * sn;
      const k = (at + i * sides + s) * 3;
      pos[k] = line[i * 3] + nx * r;
      pos[k + 1] = line[i * 3 + 1] + ny * r;
      pos[k + 2] = line[i * 3 + 2] + nz * r;
      nor[k] = nx;
      nor[k + 1] = ny;
      nor[k + 2] = nz;
    }
  }
  return n * sides;
}
/** Triangles between the rings written by `writeRings`, wound so that their faces look outward. Returns the number of indices. */
export function writeRingIndices(idx: Uint32Array, at: number, first: number, rings: number, sides: number): number {
  let k = at;
  for (let i = 0; i + 1 < rings; i++) {
    const a = first + i * sides, b = a + sides;
    for (let s = 0; s < sides; s++) {
      const t = (s + 1) % sides;
      idx[k++] = a + s;
      idx[k++] = a + t;
      idx[k++] = b + s;
      idx[k++] = a + t;
      idx[k++] = b + t;
      idx[k++] = b + s;
    }
  }
  return k - at;
}

/** One wire as it was last made: its line and the tube round it, and what they were made from. */
interface Built {
  /** Ends, fan and thickness. */
  key: string;
  /** The bodies near the line when it was made. */
  sig: string;
  /** The line's place on the table (with room round it): a body that comes or goes there makes the wire again. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The line by itself, and the line as drawn: lifted over the wires it crosses (the same array when it crosses none). */
  plain: Float32Array;
  line: Float32Array;
  /** The crossings the drawn line was lifted for. */
  overKey: string;
  length: number;
  pos: Float32Array;
  nor: Float32Array;
  rings: number;
  tipPos: Float32Array;
  tipNor: Float32Array;
}
interface Want {
  id: string;
  a: WireEnd;
  b: WireEnd;
  color: string;
  wide: boolean;
  fan: number;
  seed: number;
}

const HILITE = new Color('#ffac00');
const EMPTY = new Float32Array(0);

export class Wires {
  readonly group = new Group();
  /** 'wire' while the wire tool is on: terminals show. */
  tool: 'move' | 'wire' = 'move';
  hoverTerm: string | null = null;
  startTerm: string | null = null;
  hoverWire: string | null = null;
  selected: ReadonlySet<string> = new Set();
  /** The loose end of the wire being drawn (table point), or null. */
  loose: Vector3 | null = null;
  color = '#d9412b';

  private spots: TermSpot[] = [];
  private byTerm = new Map<string, TermSpot>();
  private key = '';
  private drawKey = '';
  private built = new Map<string, Built>();
  private boxes: WireBox[] = [];
  private boxKeys: string[] = [];
  /** How many wires were made again by the last `draw` (the rest were kept), for the tests and the cost measure. */
  remade = 0;
  private geo = new BufferGeometry();
  private tipGeo = new BufferGeometry();
  private cap = 0;
  private idxCap = 0;
  private tipCap = 0;
  private triangles = 0;
  private mesh: Mesh;
  private tips: Mesh;
  private dots: InstancedMesh;
  private dotCap = 0;
  private marks: Mesh[] = [];
  private poseTick = 0;
  private lastQuat = '';
  private m = new Matrix4();
  private dotM = new Matrix4();
  private one = new Vector3(1, 1, 1);
  private v = new Vector3();
  private c = new Color();
  private dummy = new Object3D();
  private looseEnd = new Vector3();

  constructor(
    private bench: BenchStore,
    private parts: WireParts | undefined,
    private dotQuat: Quaternion,
    private dotPos: Vector3,
  ) {
    // insulation: plain opaque plastic in the wire's colour, satin, written to the depth buffer like any solid body
    this.mesh = new Mesh(this.geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, envMapIntensity: 0.55, transparent: false, depthWrite: true, depthTest: true }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'wires';
    // the pins at the ends: tinned metal
    this.tips = new Mesh(this.tipGeo, new MeshStandardMaterial({ color: '#c9cbd0', roughness: 0.32, metalness: 0.85, transparent: false }));
    this.tips.frustumCulled = false;
    this.tips.name = 'wire-tips';
    const ball = new SphereGeometry(1, 10, 8);
    this.dots = new InstancedMesh(ball, new MeshBasicMaterial({ color: '#ffac00', transparent: true, opacity: 0.85, depthTest: false }), 1);
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    this.dots.renderOrder = 5;
    for (const col of ['#2f6fdb', '#ffac00']) {
      const mk = new Mesh(ball, new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false }));
      mk.visible = false;
      mk.renderOrder = 6;
      this.marks.push(mk);
    }
    this.group.add(this.mesh, this.tips, this.dots, ...this.marks);
  }

  // ---- terminals -----------------------------------------------------------------------------------------------
  /** Rebuilds the list of terminals when something they depend on changed. Returns true when it did. */
  refresh(): boolean {
    const st = this.bench.getState();
    const q = `${this.dotQuat.x.toFixed(4)},${this.dotQuat.y.toFixed(4)},${this.dotQuat.z.toFixed(4)},${this.dotPos.x.toFixed(2)},${this.dotPos.y.toFixed(2)}`;
    if (q !== this.lastQuat) {
      this.lastQuat = q;
      this.poseTick++;
    }
    const key = `${this.poseTick}|${this.parts?.getVersion() ?? 0}`;
    if (key === this.key && this.objs === st.objects && this.mounts === st.mounts) return false;
    this.key = key;
    this.objs = st.objects;
    this.mounts = st.mounts;
    this.spots = [];
    this.dotM.compose(this.dotPos, this.dotQuat, this.one);
    for (const d of DEVICE) {
      const w = deviceTermWorld(d, this.dotPos, this.dotQuat);
      this.spots.push({ term: d.term, name: d.name, owner: '', pos: w.pos, out: w.out, hole: false });
    }
    if (this.parts) {
      for (const o of st.objects) {
        if (o.area !== 'part') continue;
        const terms = this.parts.terms(o.kind);
        if (!terms.length) continue;
        const mount = this.parts.mountOf(o.id);
        const lift = mount ? 0 : this.parts.liftOf(o.id);
        const plugged = mount ? (this.parts.connector?.(o.kind) ?? null) : null;
        const inHoles = !mount && !!this.parts.inHoles?.(o.id);
        if (mount) this.m.fromArray(mount).premultiply(this.dotM);
        const hole = terms.length > 60;
        const size = sizeOf(o.kind, 0);
        for (const t of terms) {
          let pos: Vector3;
          // the way a wire leaves, in the part's own frame: a side pin sideways, a hole or a socket upward, a pin under
          // the body (a leg, a module's connector) outward past the nearest side, never up through the body it carries
          const out = t.face === 'left' ? new Vector3(-1, 0, 0) : t.face === 'right' ? new Vector3(1, 0, 0) : t.face === 'front' ? new Vector3(0, 0, 1) : t.face === 'back' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
          let drop = 0;
          if (t.face === 'bottom') {
            // in a board's holes the leg is inside the board: the wire leaves along the board, rising off it
            const up = inHoles ? 0.6 : 0, side = inHoles ? 0.8 : 1;
            if (Math.abs(t.x) / size.w >= Math.abs(t.z) / size.d && Math.abs(t.x) > 0.01) out.set(Math.sign(t.x) * side, up, 0);
            else out.set(0, up, (t.z < 0 ? -1 : 1) * side);
            // a bare leg the part stands on: the wire holds it half way down, under the body
            if (!mount && !inHoles && t.y < 0.5) drop = lift / 2;
          }
          if (mount) {
            pos = new Vector3(t.x, t.y, t.z).applyMatrix4(this.m);
            out.transformDirection(this.m);
          } else {
            const w = termWorld(t, o.pos, o.rot as Rot, lift);
            pos = new Vector3(w.x, w.y - drop, w.z);
            const [ox, oz] = turn(out.x, out.z, o.rot as Rot);
            out.set(ox, out.y, oz);
          }
          this.spots.push({ term: `${o.id}.${t.name}`, name: t.name, owner: o.name, pos, out, hole: hole && t.face === 'top', hidden: !!plugged?.has(t.name) });
        }
      }
    }
    this.byTerm = new Map();
    for (const s of this.spots) if (!this.byTerm.has(s.term)) this.byTerm.set(s.term, s);
    this.drawKey = '';
    return true;
  }
  private objs: unknown = null;
  private mounts: unknown = null;

  spot(term: string): TermSpot | undefined {
    return this.byTerm.get(term);
  }
  allSpots(): readonly TermSpot[] {
    return this.spots;
  }

  /** The terminal nearest the pointer on the screen, within `px`. `toScreen` writes x, y (CSS px) and z (NDC depth) of a world point. */
  pickTerm(x: number, y: number, camera: Camera, w: number, h: number, px = 13): TermSpot | null {
    let best: TermSpot | null = null;
    let bd = px * px;
    for (const s of this.spots) {
      if (s.hidden) continue;
      this.v.copy(s.pos).project(camera);
      if (this.v.z > 1) continue;
      const dx = (this.v.x * 0.5 + 0.5) * w - x, dy = (-this.v.y * 0.5 + 0.5) * h - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }
  pickWire(x: number, y: number, camera: Camera, w: number, h: number, px = 7): string | null {
    let best: string | null = null;
    let bd = px * px;
    for (const [id, b] of this.built) {
      if (!id) continue;
      const pts = b.line;
      let lx = 0, ly = 0;
      for (let i = 0; i < pts.length; i += 3) {
        this.v.set(pts[i], pts[i + 1], pts[i + 2]).project(camera);
        const sx = (this.v.x * 0.5 + 0.5) * w, sy = (-this.v.y * 0.5 + 0.5) * h;
        if (i > 0) {
          // distance from the pointer to this piece of the wire
          const ex = sx - lx, ey = sy - ly;
          const l2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((x - lx) * ex + (y - ly) * ey) / l2));
          const dx = lx + ex * t - x, dy = ly + ey * t - y;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = id;
          }
        }
        lx = sx;
        ly = sy;
      }
    }
    return best;
  }

  // ---- the bodies wires keep out of ----------------------------------------------------------------------------
  /** The box of everything solid on the table: the Dot where and how it lies, the module on it, every thing with a body. */
  private readBoxes(): void {
    const st = this.bench.getState();
    const boxes: WireBox[] = [];
    // a box given in some frame (x0..x1, y0..y1, z0..z1) through `m`: what it covers of the table, and how high it reaches
    const around = (id: string, lx0: number, lx1: number, ly0: number, ly1: number, lz0: number, lz1: number, m: Matrix4, round: boolean) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, h = 0;
      for (let i = 0; i < 8; i++) {
        this.v.set(i & 1 ? lx1 : lx0, i & 2 ? ly1 : ly0, i & 4 ? lz1 : lz0).applyMatrix4(m);
        x0 = Math.min(x0, this.v.x);
        x1 = Math.max(x1, this.v.x);
        z0 = Math.min(z0, this.v.z);
        z1 = Math.max(z1, this.v.z);
        h = Math.max(h, this.v.y);
      }
      boxes.push({ id, x0, x1, z0, z1, h, round });
    };
    this.dotM.compose(this.dotPos, this.dotQuat, this.one);
    // the Dot's box in its own frame: X across, Y along, Z through
    around('device', -DOT.hw, DOT.hw, -DOT.hd, DOT.hd, -DOT.h / 2, DOT.h / 2, this.dotM, true);
    for (const o of st.objects) {
      if (!hasBody(o.kind)) continue;
      const s = sizeOf(o.kind, 0);
      const mount = o.area === 'part' ? (this.parts?.mountOf(o.id) ?? null) : null;
      if (mount) {
        // a module on the header: its body's box (model frame: on y = 0, h high) where the mount puts it
        around(o.id, -s.w / 2, s.w / 2, 0, s.h, -s.d / 2, s.d / 2, this.m.fromArray(mount).premultiply(this.dotM), true);
        continue;
      }
      const r = rectOf(o.kind, o.pos, o.rot as Rot);
      const h = (o.area === 'part' ? (this.parts?.liftOf(o.id) ?? 0) : 0) + s.h;
      boxes.push({ id: o.id, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, h, round: h > ROUND_H });
    }
    this.boxes = boxes;
    this.boxKeys = boxes.map((b) => `${b.id}:${b.x0.toFixed(1)},${b.x1.toFixed(1)},${b.z0.toFixed(1)},${b.z1.toFixed(1)},${b.h.toFixed(1)}`);
  }
  /** The bodies that have to do with a wire's line: those in or against the rectangle it was made in. */
  private near(x0: number, x1: number, z0: number, z1: number): string {
    let s = '';
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.x1 > x0 && b.x0 < x1 && b.z1 > z0 && b.z0 < z1) s += this.boxKeys[i] + ';';
    }
    return s;
  }

  /** A wire's line by itself (no other wire considered), with the place on the table it was made in. */
  private route(w: Want, key: string): Built {
    const plain = wirePath(w.a, w.b, this.boxes, { fan: w.fan, seed: w.seed });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < plain.length; i += 3) {
      x0 = Math.min(x0, plain[i]);
      x1 = Math.max(x1, plain[i]);
      z0 = Math.min(z0, plain[i + 2]);
      z1 = Math.max(z1, plain[i + 2]);
    }
    const room = NODE + 6;
    const made: Built = { key, sig: '', x0: x0 - room, x1: x1 + room, z0: z0 - room, z1: z1 + room, plain, line: plain, overKey: '?', length: 0, pos: EMPTY, nor: EMPTY, rings: 0, tipPos: EMPTY, tipNor: EMPTY };
    made.sig = this.near(made.x0, made.x1, made.z0, made.z1);
    return made;
  }

  /**
   * Where a wire's line crosses the wires made before it at nearly their height (it would pass through them): the
   * points, and how high its middle must be there to pass over. The first and last stretch of either wire do not
   * count: the stubs go where their terminals are.
   */
  private crossings(b: Built, before: readonly Built[]): { x: number; z: number; y: number }[] {
    const out: { x: number; z: number; y: number }[] = [];
    const p = b.plain, ends = STUB + BEND + 1.5;
    const total = (l: Float32Array) => {
      let t = 0;
      for (let i = 3; i < l.length; i += 3) t += Math.hypot(l[i] - l[i - 3], l[i + 2] - l[i - 1]);
      return t;
    };
    let lenP = -1;
    for (const e of before) {
      // their places on the table overlap (both carry the same room round them)
      if (e.x1 < b.x0 + 2 * (NODE + 6) || e.x0 > b.x1 - 2 * (NODE + 6) || e.z1 < b.z0 + 2 * (NODE + 6) || e.z0 > b.z1 - 2 * (NODE + 6)) continue;
      const q = e.line;
      let lenQ = -1, runP = 0;
      for (let i = 3; i < p.length; i += 3) {
        const ax = p[i - 3], az = p[i - 1], bx = p[i], bz = p[i + 2];
        const segP = Math.hypot(bx - ax, bz - az);
        let runQ = 0;
        for (let k = 3; k < q.length; k += 3) {
          const cx = q[k - 3], cz = q[k - 1], dx = q[k], dz = q[k + 2];
          const segQ = Math.hypot(dx - cx, dz - cz);
          const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
          if (Math.abs(den) > 1e-9) {
            const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
              if (lenP < 0) lenP = total(p);
              if (lenQ < 0) lenQ = total(q);
              const sP = runP + segP * t, sQ = runQ + segQ * u;
              if (sP > ends && lenP - sP > ends && sQ > ends && lenQ - sQ > ends) {
                const yP = p[i - 2] + (p[i + 1] - p[i - 2]) * t, yQ = q[k - 2] + (q[k + 1] - q[k - 2]) * u;
                // through each other when their middles are less than two radii (and a hair) apart in height
                if (Math.abs(yP - yQ) < 2 * R_WIRE + 0.3) out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: yQ + 2 * R_WIRE + 0.5 });
              }
            }
          }
          runQ += segQ;
        }
        runP += segP;
      }
    }
    return out;
  }

  /** The tube round a wire's line (lifted over `over`), and its two pins. */
  private tube(b: Built, w: Want, over: readonly { x: number; z: number; y: number }[], overKey: string): void {
    const line = over.length ? wirePath(w.a, w.b, this.boxes, { fan: w.fan, seed: w.seed, over }) : b.plain;
    b.line = line;
    b.overKey = overKey;
    const n = line.length / 3;
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(line[i * 3] - line[i * 3 - 3], line[i * 3 + 1] - line[i * 3 - 2], line[i * 3 + 2] - line[i * 3 - 1]);
    b.length = length;
    // the insulation: the line without the bare ends of the two pins, closed down onto the pin at each end
    const R = w.wide ? R_WIRE * 1.6 : R_WIRE;
    const ins = new Float32Array((n + 2) * 3);
    const cut = (from: number, to: number, d: number, at: number) => {
      const dx = line[to] - line[from], dy = line[to + 1] - line[from + 1], dz = line[to + 2] - line[from + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const t = Math.min(0.9, d / l);
      ins[at] = line[from] + dx * t;
      ins[at + 1] = line[from + 1] + dy * t;
      ins[at + 2] = line[from + 2] + dz * t;
    };
    cut(0, 3, TIP_OUT, 0);
    cut(0, 3, TIP_OUT + 0.5, 3);
    ins.set(line.subarray(3, (n - 1) * 3), 6);
    cut((n - 1) * 3, (n - 2) * 3, TIP_OUT + 0.5, n * 3);
    cut((n - 1) * 3, (n - 2) * 3, TIP_OUT, (n + 1) * 3);
    b.rings = n + 2;
    b.pos = new Float32Array(b.rings * SIDES * 3);
    b.nor = new Float32Array(b.rings * SIDES * 3);
    writeRings(b.pos, b.nor, 0, ins, (i, m) => (i === 0 || i === m - 1 ? R_TIP : R), SIDES);
    // the pins: from inside the terminal to inside the insulation
    b.tipPos = new Float32Array(2 * TIP_RINGS * TIP_SIDES * 3);
    b.tipNor = new Float32Array(2 * TIP_RINGS * TIP_SIDES * 3);
    const pin = new Float32Array(TIP_RINGS * 3);
    [w.a, w.b].forEach((e, k) => {
      [-TIP_IN, -TIP_IN + 0.35, TIP_OUT + 0.6].forEach((d, i) => {
        pin[i * 3] = e.pos.x + e.out.x * d;
        pin[i * 3 + 1] = e.pos.y + e.out.y * d;
        pin[i * 3 + 2] = e.pos.z + e.out.z * d;
      });
      writeRings(b.tipPos, b.tipNor, k * TIP_RINGS * TIP_SIDES, pin, (i) => (i === 0 ? 0.04 : R_TIP), TIP_SIDES);
    });
  }

  // ---- drawing -------------------------------------------------------------------------------------------------
  /** Rewrites the wire meshes and the marks when anything they show changed. Returns true when it drew. */
  draw(): boolean {
    const changed = this.refresh();
    const st = this.bench.getState();
    const lk = this.loose ? `${this.loose.x.toFixed(1)},${this.loose.z.toFixed(1)}` : '';
    const key = `${this.tool}|${this.hoverTerm}|${this.startTerm}|${this.hoverWire}|${[...this.selected].join(',')}|${lk}|${this.color}`;
    if (!changed && key === this.drawKey && this.wiresRef === st.wires) return false;
    this.drawKey = key;
    this.wiresRef = st.wires;
    if (changed || !this.boxes.length) this.readBoxes();

    const list: Want[] = [];
    // wires between the same two things are a bundle: they bow the same way and keep apart in the middle
    const groups = new Map<string, number[]>();
    const ownerOf = (term: string) => term.slice(0, term.indexOf('.'));
    for (const w of st.wires as readonly Wire[]) {
      const a = this.byTerm.get(w.from), b = this.byTerm.get(w.to);
      if (!a || !b) continue;
      const ia = ownerOf(w.from), ib = ownerOf(w.to);
      // which way round the wire was drawn (its left is the others' right when it is the other way)
      const ori = ia <= ib ? 1 : -1;
      const g = ori > 0 ? `${ia}|${ib}` : `${ib}|${ia}`;
      const at = list.length;
      list.push({ id: w.id, a: { pos: a.pos, out: a.out, owner: ia }, b: { pos: b.pos, out: b.out, owner: ib }, color: w.color, wide: this.selected.has(w.id) || this.hoverWire === w.id, fan: 0, seed: ori > 0 ? 0 : 1 });
      const have = groups.get(g);
      if (have) have.push(at);
      else groups.set(g, [at]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // across the bundle (square to the way it runs): where each wire's middle would be by itself, in order
      let dx = 0, dz = 0;
      for (const at of g) {
        const w = list[at], k = w.seed ? -1 : 1;
        dx += (w.b.pos.x - w.a.pos.x) * k;
        dz += (w.b.pos.z - w.a.pos.z) * k;
      }
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const c = g.map((at) => ((list[at].a.pos.x + list[at].b.pos.x) / 2) * nx + ((list[at].a.pos.z + list[at].b.pos.z) / 2) * nz);
      const order = g.map((_, i) => i).sort((p, q) => c[p] - c[q] || p - q);
      // pushed apart where they would lie on each other, the bundle staying where it was
      const gap = Math.min(2.6, 14 / (g.length - 1));
      const p = new Array<number>(g.length);
      let last = -Infinity, off = 0;
      for (const i of order) {
        last = p[i] = Math.max(c[i], last + gap);
        off += c[i] - p[i];
      }
      off /= g.length;
      g.forEach((at, i) => {
        const shift = Math.max(-7, Math.min(7, p[i] + off - c[i]));
        list[at].fan = Math.abs(shift) < 0.05 ? 0 : (list[at].seed ? -shift : shift);
      });
    }
    const start = this.startTerm ? this.byTerm.get(this.startTerm) : undefined;
    const over = this.hoverTerm && this.hoverTerm !== this.startTerm ? this.byTerm.get(this.hoverTerm) : undefined;
    if (start && !over && this.loose) this.looseEnd.set(this.loose.x, Math.max(this.loose.y, REST), this.loose.z);
    const end = over?.pos ?? (this.loose ? this.looseEnd : null);
    if (start && end) list.push({ id: '', a: { pos: start.pos, out: start.out, owner: ownerOf(this.startTerm!) }, b: { pos: end, out: over?.out ?? UP, owner: over ? ownerOf(this.hoverTerm!) : '-' }, color: this.color, wide: false, fan: 0, seed: 0 });

    // each wire's tube: kept when its ends and the bodies near its line are what they were
    this.remade = 0;
    const live = new Set<string>();
    const done: Built[] = [];
    let verts = 0, tris = 0;
    for (const w of list) {
      live.add(w.id);
      const e = (p: WireEnd) => `${p.pos.x.toFixed(2)},${p.pos.y.toFixed(2)},${p.pos.z.toFixed(2)},${p.out.x.toFixed(3)},${p.out.y.toFixed(3)},${p.out.z.toFixed(3)},${p.owner}`;
      const k = `${e(w.a)}|${e(w.b)}|${w.fan.toFixed(2)}|${w.wide ? 1 : 0}`;
      let b = this.built.get(w.id);
      if (!b || b.key !== k || b.sig !== this.near(b.x0, b.x1, b.z0, b.z1)) {
        b = this.route(w, k);
        this.built.set(w.id, b);
      }
      // it passes over the wires made before it where it would go through them (the later wire is the upper one)
      const over = this.crossings(b, done);
      let ok = '';
      for (const c of over) ok += `${c.x.toFixed(1)},${c.z.toFixed(1)},${c.y.toFixed(1)};`;
      if (ok !== b.overKey) {
        this.tube(b, w, over, ok);
        this.remade++;
      }
      done.push(b);
      verts += b.rings * SIDES;
      tris += (b.rings - 1) * SIDES * 2;
    }
    for (const id of this.built.keys()) if (!live.has(id)) this.built.delete(id);

    // one mesh for the insulation, one for the pins: the kept tubes are copied in, nothing is computed again
    const idxNeed = tris * 3;
    if (verts > this.cap || idxNeed > this.idxCap || !this.cap) {
      this.cap = Math.max(verts, this.cap * 2, 2048);
      this.idxCap = Math.max(idxNeed, this.idxCap * 2, 2048 * 6);
      this.geo.dispose();
      this.geo = new BufferGeometry();
      for (const n of ['position', 'normal', 'color']) {
        const at = new BufferAttribute(new Float32Array(this.cap * 3), 3);
        at.setUsage(DynamicDrawUsage);
        this.geo.setAttribute(n, at);
      }
      const ix = new BufferAttribute(new Uint32Array(this.idxCap), 1);
      ix.setUsage(DynamicDrawUsage);
      this.geo.setIndex(ix);
      this.mesh.geometry = this.geo;
    }
    const tipVerts = list.length * 2 * TIP_RINGS * TIP_SIDES;
    if (tipVerts > this.tipCap || !this.tipCap) {
      this.tipCap = Math.max(tipVerts, this.tipCap * 2, 16 * 2 * TIP_RINGS * TIP_SIDES);
      this.tipGeo.dispose();
      this.tipGeo = new BufferGeometry();
      for (const n of ['position', 'normal']) {
        const at = new BufferAttribute(new Float32Array(this.tipCap * 3), 3);
        at.setUsage(DynamicDrawUsage);
        this.tipGeo.setAttribute(n, at);
      }
      // every pin is the same three rings: its triangles never change
      const per = TIP_RINGS * TIP_SIDES;
      const ix = new Uint32Array((this.tipCap / per) * (TIP_RINGS - 1) * TIP_SIDES * 6);
      for (let i = 0, k = 0; i < this.tipCap / per; i++) k += writeRingIndices(ix, k, i * per, TIP_RINGS, TIP_SIDES);
      this.tipGeo.setIndex(new BufferAttribute(ix, 1));
      this.tips.geometry = this.tipGeo;
    }
    const pos = this.geo.getAttribute('position') as BufferAttribute, nor = this.geo.getAttribute('normal') as BufferAttribute, col = this.geo.getAttribute('color') as BufferAttribute;
    const ix = this.geo.getIndex() as BufferAttribute;
    const tp = this.tipGeo.getAttribute('position') as BufferAttribute, tn = this.tipGeo.getAttribute('normal') as BufferAttribute;
    const ca = col.array as Float32Array;
    let v0 = 0, i0 = 0;
    list.forEach((w, n) => {
      const b = this.built.get(w.id)!;
      (pos.array as Float32Array).set(b.pos, v0 * 3);
      (nor.array as Float32Array).set(b.nor, v0 * 3);
      this.c.set(w.color);
      if (w.wide) this.c.lerp(HILITE, 0.3);
      const count = b.rings * SIDES;
      for (let i = v0; i < v0 + count; i++) {
        ca[i * 3] = this.c.r;
        ca[i * 3 + 1] = this.c.g;
        ca[i * 3 + 2] = this.c.b;
      }
      i0 += writeRingIndices(ix.array as Uint32Array, i0, v0, b.rings, SIDES);
      v0 += count;
      (tp.array as Float32Array).set(b.tipPos, n * 2 * TIP_RINGS * TIP_SIDES * 3);
      (tn.array as Float32Array).set(b.tipNor, n * 2 * TIP_RINGS * TIP_SIDES * 3);
    });
    pos.needsUpdate = nor.needsUpdate = col.needsUpdate = ix.needsUpdate = tp.needsUpdate = tn.needsUpdate = true;
    this.geo.setDrawRange(0, i0);
    this.tipGeo.setDrawRange(0, list.length * 2 * (TIP_RINGS - 1) * TIP_SIDES * 6);
    this.triangles = tris + list.length * 2 * (TIP_RINGS - 1) * TIP_SIDES * 2;

    // terminals as dots while wiring; the one under the pointer and the one a wire starts from as marks
    const show = this.tool === 'wire' ? this.spots.filter((s) => !s.hole && !s.hidden) : [];
    if (show.length > this.dotCap) {
      this.dotCap = Math.max(show.length, this.dotCap * 2, 64);
      const next = new InstancedMesh(this.dots.geometry, this.dots.material, this.dotCap);
      next.frustumCulled = false;
      next.renderOrder = 5;
      this.group.remove(this.dots);
      this.dots.dispose();
      this.dots = next;
      this.group.add(next);
    }
    show.forEach((s, i) => {
      this.dummy.position.copy(s.pos);
      this.dummy.scale.setScalar(0.62);
      this.dummy.updateMatrix();
      this.dots.setMatrixAt(i, this.dummy.matrix);
    });
    this.dots.count = show.length;
    this.dots.instanceMatrix.needsUpdate = true;
    [this.startTerm, this.hoverTerm].forEach((t, i) => {
      const s = t ? this.byTerm.get(t) : undefined;
      this.marks[i].visible = !!s;
      if (s) {
        this.marks[i].position.copy(s.pos);
        this.marks[i].scale.setScalar(i ? 1.25 : 1.1);
      }
    });
    return true;
  }
  private wiresRef: unknown = null;
  /** The middle of a wire as drawn (half way along it), or null. */
  mid(id: string): Vector3 | null {
    const b = this.built.get(id);
    if (!b) return null;
    const p = b.line;
    let run = 0;
    for (let i = 3; i < p.length; i += 3) {
      const l = Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
      if (run + l >= b.length / 2) {
        const t = l > 0 ? (b.length / 2 - run) / l : 0;
        return new Vector3(p[i - 3] + (p[i] - p[i - 3]) * t, p[i - 2] + (p[i + 1] - p[i - 2]) * t, p[i - 1] + (p[i + 2] - p[i - 1]) * t);
      }
      run += l;
    }
    return new Vector3(p[0], p[1], p[2]);
  }
  /** The line of a wire as drawn (x, y, z triples), for the checks. */
  lineOf(id: string): Float32Array | null {
    return this.built.get(id)?.line ?? null;
  }
  /** The boxes wires keep out of, as last read (for the checks). */
  bodies(): readonly WireBox[] {
    return this.boxes;
  }
  /** How many wires are drawn, and of how many triangles (for the frame time measure). */
  stats(): { wires: number; triangles: number; remade: number } {
    let wires = 0;
    for (const id of this.built.keys()) if (id) wires++;
    return { wires, triangles: this.triangles, remade: this.remade };
  }
  dispose(): void {
    this.geo.dispose();
    this.tipGeo.dispose();
    this.dots.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    (this.tips.material as MeshStandardMaterial).dispose();
  }
}

const UP = new Vector3(0, 1, 0);
