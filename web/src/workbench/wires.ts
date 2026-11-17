/**
 * Terminals and jumper wires on the table. Terminal places come from the parts' manifests (parts/geometry.ts) through
 * where each part stands, and from the Dot's own header through the Dot's pose; wires are tubes drawn as one mesh.
 * Picking is done on the screen (the nearest terminal or wire to the pointer), so a 2.54 mm header can be hit.
 */
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SphereGeometry, Vector3, type Camera, type Quaternion } from 'three';
import type { BenchStore, Wire } from '../bench/store';
import { writeTube } from '../bench3d/shape';
import { deviceTerms, termWorld, turn, type DeviceTerm, type LocalTerm } from '../parts/geometry';
import { DOT, rectOf, sizeOf, type Rot } from './layout';

/** What the wires need from the parts service (absent in tests: then only the Dot has terminals). */
export interface WireParts {
  terms(kind: string): LocalTerm[];
  liftOf(instance: string): number;
  mountOf(instance: string): number[] | null;
  getVersion(): number;
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
}

const SEG = 32;
const END = 8; // pieces of each end's curve (terminal to table)
const RAD = 6;
const R_WIRE = 0.75;
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

const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};
/**
 * The line a wire follows, as SEG + 1 points: out of each terminal the way the terminal faces, down to the table in
 * a curve that cannot dip under it (a Bezier stays inside its control points), then lying on the table, or on whatever
 * `floorAt` says is under it, bowed sideways by `seed` so that wires side by side stay apart. Short wires arch.
 */
export function wirePath(a: Vector3, aOut: Vector3, b: Vector3, bOut: Vector3, seed: number, floorAt: (x: number, z: number) => number, blocked: (x: number, z: number) => boolean = () => false): Vector3[] {
  const pts: Vector3[] = [];
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 30) {
    const h = 7 + d * 0.3;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      pts.push(new Vector3(bez(a.x, a.x + aOut.x * h, b.x + bOut.x * h, b.x, t), bez(a.y, a.y + aOut.y * h + 2, b.y + bOut.y * h + 2, b.y, t), bez(a.z, a.z + aOut.z * h, b.z + bOut.z * h, b.z, t)));
    }
    return pts;
  }
  const ux = dx / d, uz = dz / d, nx = -uz, nz = ux;
  const bow = ((seed % 5) - 2) * 3 + (seed & 1 ? 1 : -1) * Math.min(16, d * 0.06);
  const reach = Math.min(24, d * 0.3);
  const lift = R_WIRE + 0.25;
  // where each end comes down onto the table: toward the other end, but a pin that faces sideways is first left the
  // way it faces, and when the other end lies behind it the wire comes down beside the body, not through it
  const down = (p: Vector3, out: Vector3, sx: number, sz: number) => {
    const oh = Math.hypot(out.x, out.z);
    if (oh < 0.5) return new Vector3(p.x + sx * reach + nx * bow * 0.3, 0, p.z + sz * reach + nz * bow * 0.3);
    const ox = out.x / oh, oz = out.z / oh;
    let rx = sx, rz = sz;
    if (sx * ox + sz * oz < 0.2) {
      // sideways only (the part of the run that is square to the pin's facing)
      const side = sx * -oz + sz * ox >= 0 ? 1 : -1;
      rx = -oz * side;
      rz = ox * side;
    }
    return new Vector3(p.x + ox * 16 + rx * reach, 0, p.z + oz * 16 + rz * reach);
  };
  const t1 = down(a, aOut, ux, uz);
  const t2 = down(b, bOut, -ux, -uz);
  t1.y = floorAt(t1.x, t1.z) + lift;
  t2.y = floorAt(t2.x, t2.z) + lift;
  const end = (p: Vector3, out: Vector3, t: Vector3, sx: number, sz: number, k: number) => {
    // control points: out of the terminal, and flat along the wire's run at the touch-down height
    const h = 9;
    const c1 = new Vector3(p.x + out.x * h, Math.max(p.y + out.y * h + 1.5, t.y), p.z + out.z * h);
    const c2 = new Vector3(t.x - sx * h, t.y, t.z - sz * h);
    const u = k / END;
    return new Vector3(bez(p.x, c1.x, c2.x, t.x, u), Math.max(bez(p.y, c1.y, c2.y, t.y, u), Math.min(p.y, t.y)), bez(p.z, c1.z, c2.z, t.z, u));
  };
  const mid = SEG - 2 * END;
  // the run between: bowed a little; when it would cross something tall (the Dot, a battery), bowed further until it
  // goes round, to the side that needs the least
  const mx = (t1.x + t2.x) / 2, mz = (t1.z + t2.z) / 2;
  const rl = Math.hypot(t2.x - t1.x, t2.z - t1.z) || 1;
  const px = -(t2.z - t1.z) / rl, pz = (t2.x - t1.x) / rl;
  const crosses = (qx: number, qz: number) => {
    for (let i = 1; i < 12; i++) {
      const t = i / 12, u = 1 - t;
      if (blocked(u * u * t1.x + 2 * u * t * qx + t * t * t2.x, u * u * t1.z + 2 * u * t * qz + t * t * t2.z)) return true;
    }
    return false;
  };
  let cx = mx + px * bow * 1.4, cz = mz + pz * bow * 1.4;
  if (crosses(cx, cz)) {
    search: for (let k = 1; k <= 6; k++) {
      for (const sgn of bow >= 0 ? [1, -1] : [-1, 1]) {
        const qx = mx + px * sgn * k * 28, qz = mz + pz * sgn * k * 28;
        if (!crosses(qx, qz)) {
          cx = qx;
          cz = qz;
          break search;
        }
      }
    }
  }
  // each end arrives at its touch-down point along the run's own direction there (toward the control point)
  const d1 = Math.hypot(cx - t1.x, cz - t1.z) || 1, d2 = Math.hypot(cx - t2.x, cz - t2.z) || 1;
  for (let k = 0; k < END; k++) pts.push(end(a, aOut, t1, (cx - t1.x) / d1, (cz - t1.z) / d1, k));
  for (let i = 0; i <= mid; i++) {
    const t = i / mid, u = 1 - t;
    const x = u * u * t1.x + 2 * u * t * cx + t * t * t2.x, z = u * u * t1.z + 2 * u * t * cz + t * t * t2.z;
    pts.push(new Vector3(x, i === 0 ? t1.y : i === mid ? t2.y : floorAt(x, z) + lift, z));
  }
  for (let k = END - 1; k >= 0; k--) pts.push(end(b, bOut, t2, (cx - t2.x) / d2, (cz - t2.z) / d2, k));
  return pts;
}

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
  private paths = new Map<string, Float32Array>();
  private geo = new BufferGeometry();
  private cap = 0;
  private mesh: Mesh;
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

  constructor(
    private bench: BenchStore,
    private parts: WireParts | undefined,
    private dotQuat: Quaternion,
    private dotPos: Vector3,
  ) {
    this.mesh = new Mesh(this.geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.02 }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'wires';
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
    this.group.add(this.mesh, this.dots, ...this.marks);
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
        if (mount) this.m.fromArray(mount).premultiply(this.dotM);
        const hole = terms.length > 60;
        for (const t of terms) {
          let pos: Vector3;
          // a side pin is left sideways, any other upward (in the part's own frame)
          const out = t.face === 'left' ? new Vector3(-1, 0, 0) : t.face === 'right' ? new Vector3(1, 0, 0) : t.face === 'front' ? new Vector3(0, 0, 1) : t.face === 'back' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
          if (mount) {
            pos = new Vector3(t.x, t.y, t.z).applyMatrix4(this.m);
            out.transformDirection(this.m);
          } else {
            const w = termWorld(t, o.pos, o.rot as Rot, lift);
            pos = new Vector3(w.x, w.y, w.z);
            const [ox, oz] = turn(out.x, out.z, o.rot as Rot);
            out.set(ox, out.y, oz);
          }
          this.spots.push({ term: `${o.id}.${t.name}`, name: t.name, owner: o.name, pos, out, hole: hole && t.face === 'top' });
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
    for (const [id, pts] of this.paths) {
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

  // ---- drawing -------------------------------------------------------------------------------------------------
  /** Rewrites the wire mesh and the marks when anything they show changed. Returns true when it drew. */
  draw(): boolean {
    const changed = this.refresh();
    const st = this.bench.getState();
    const lk = this.loose ? `${this.loose.x.toFixed(1)},${this.loose.z.toFixed(1)}` : '';
    const key = `${this.tool}|${this.hoverTerm}|${this.startTerm}|${this.hoverWire}|${[...this.selected].join(',')}|${lk}|${this.color}`;
    if (!changed && key === this.drawKey && this.wiresRef === st.wires) return false;
    this.drawKey = key;
    this.wiresRef = st.wires;

    const rects = st.objects.filter((o) => o.area === 'part' && !st.mounts[o.id]).map((o) => {
      const r = rectOf(o.kind, o.pos, o.rot as Rot);
      return { id: o.id, x0: r.x0 + 1, x1: r.x1 - 1, z0: r.z0 + 1, z1: r.z1 - 1, h: (this.parts?.liftOf(o.id) ?? 0) + sizeOf(o.kind, 0).h };
    });
    const list: { id: string; a: Vector3; ao: Vector3; b: Vector3; bo: Vector3; color: string; wide: boolean; ia: string; ib: string }[] = [];
    const UP = new Vector3(0, 1, 0);
    // what a wire goes round rather than over: the Dot where it lies, and tall parts
    // (a part is not in the way of its own wires: they start on it; the Dot's leave its top wall, clear of it)
    const tall = [{ id: '', x0: -DOT.hw - 3, x1: DOT.hw + 3, z0: -DOT.hd - 3, z1: DOT.hd + 3 }, ...rects.filter((r) => r.h > 20).map((r) => ({ id: r.id, x0: r.x0 - 3, x1: r.x1 + 3, z0: r.z0 - 3, z1: r.z1 + 3 }))];
    const blockedFor = (ia: string, ib: string) => (x: number, z: number) => tall.some((r) => r.id !== ia && r.id !== ib && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
    const floorAt = (x: number, z: number) => {
      let y = 0;
      for (const r of rects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && r.h > y) y = r.h;
      return y;
    };
    for (const w of st.wires as readonly Wire[]) {
      const a = this.byTerm.get(w.from), b = this.byTerm.get(w.to);
      if (!a || !b) continue;
      list.push({ id: w.id, a: a.pos, ao: a.out, b: b.pos, bo: b.out, color: w.color, wide: this.selected.has(w.id) || this.hoverWire === w.id, ia: w.from.split('.')[0], ib: w.to.split('.')[0] });
    }
    const start = this.startTerm ? this.byTerm.get(this.startTerm) : undefined;
    const over = this.hoverTerm && this.hoverTerm !== this.startTerm ? this.byTerm.get(this.hoverTerm) : undefined;
    const end = over?.pos ?? this.loose;
    if (start && end) list.push({ id: '', a: start.pos, ao: start.out, b: end, bo: over?.out ?? UP, color: this.color, wide: false, ia: this.startTerm!.split('.')[0], ib: over ? this.hoverTerm!.split('.')[0] : '-' });

    const ring = RAD;
    const vPer = (SEG + 1) * ring;
    const need = list.length * vPer;
    if (need > this.cap || !this.cap) {
      this.cap = Math.max(need, this.cap * 2, vPer * 8);
      this.geo.dispose();
      this.geo = new BufferGeometry();
      for (const n of ['position', 'normal', 'color']) {
        const at = new BufferAttribute(new Float32Array(this.cap * 3), 3);
        at.setUsage(DynamicDrawUsage);
        this.geo.setAttribute(n, at);
      }
      const idx = new Uint32Array((this.cap / vPer) * SEG * RAD * 6);
      let k = 0;
      for (let w = 0; w < this.cap / vPer; w++) {
        for (let i = 0; i < SEG; i++) {
          for (let j = 0; j < RAD; j++) {
            const a = w * vPer + i * ring, c = a + ring, j1 = (j + 1) % ring;
            idx[k++] = a + j;
            idx[k++] = c + j;
            idx[k++] = a + j1;
            idx[k++] = a + j1;
            idx[k++] = c + j;
            idx[k++] = c + j1;
          }
        }
      }
      this.geo.setIndex(new BufferAttribute(idx, 1));
      this.mesh.geometry = this.geo;
    }
    const pos = this.geo.getAttribute('position') as BufferAttribute, nor = this.geo.getAttribute('normal') as BufferAttribute, col = this.geo.getAttribute('color') as BufferAttribute;
    this.paths.clear();
    list.forEach((w, n) => {
      let seed = 0;
      for (let i = 0; i < w.id.length; i++) seed = (seed * 31 + w.id.charCodeAt(i)) >>> 0;
      const pts = wirePath(w.a, w.ao, w.b, w.bo, seed, floorAt, blockedFor(w.ia, w.ib));
      const flat = pts.map((p) => [p.x, p.y, p.z]);
      const o = n * vPer * 3;
      writeTube((pos.array as Float32Array).subarray(o, o + vPer * 3), (nor.array as Float32Array).subarray(o, o + vPer * 3), flat, w.wide ? R_WIRE * 1.7 : R_WIRE, RAD);
      this.c.set(w.color);
      if (w.wide) this.c.lerp(new Color('#ffac00'), 0.3);
      const ca = col.array as Float32Array;
      for (let i = 0; i < vPer; i++) {
        ca[o + i * 3] = this.c.r;
        ca[o + i * 3 + 1] = this.c.g;
        ca[o + i * 3 + 2] = this.c.b;
      }
      if (w.id) {
        const keep = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => keep.set([p.x, p.y, p.z], i * 3));
        this.paths.set(w.id, keep);
      }
    });
    pos.needsUpdate = nor.needsUpdate = col.needsUpdate = true;
    this.geo.setDrawRange(0, list.length * SEG * RAD * 6);

    // terminals as dots while wiring; the one under the pointer and the one a wire starts from as marks
    const show = this.tool === 'wire' ? this.spots.filter((s) => !s.hole) : [];
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
  /** The middle of a wire as drawn, or null. */
  mid(id: string): Vector3 | null {
    const p = this.paths.get(id);
    if (!p) return null;
    const i = Math.floor(p.length / 6) * 3;
    return new Vector3(p[i], p[i + 1], p[i + 2]);
  }
  /** How many wires are drawn, and of how many triangles (for the frame time measure). */
  stats(): { wires: number; triangles: number } {
    return { wires: this.paths.size, triangles: this.paths.size * SEG * RAD * 2 };
  }
  dispose(): void {
    this.geo.dispose();
    this.dots.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
