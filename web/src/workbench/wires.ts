/**
 * Terminals and jumper wires on the table. Terminal places come from the parts' manifests (parts/geometry.ts) through
 * where each part stands, and from the Dot's own header through the Dot's pose; wires are tubes drawn as one mesh.
 * Picking is done on the screen (the nearest terminal or wire to the pointer), so a 2.54 mm header can be hit.
 */
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SphereGeometry, Vector3, type Camera, type Quaternion } from 'three';
import type { BenchStore, Wire } from '../bench/store';
import { writeTube } from '../bench3d/shape';
import { deviceTerms, termWorld, type LocalTerm } from '../parts/geometry';
import { rectOf, sizeOf, type Rot } from './layout';

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
  /** Holes of a board (not drawn as dots: the board shows them). */
  hole: boolean;
}

const SEG = 26;
const RAD = 6;
const R_WIRE = 0.62;
const DEVICE = deviceTerms();

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
      this.spots.push({ term: d.term, name: d.name, owner: '', pos: new Vector3(d.X, d.Y + 0.4, d.Z).applyMatrix4(this.dotM), hole: false });
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
          if (mount) pos = new Vector3(t.x, t.y, t.z).applyMatrix4(this.m);
          else {
            const w = termWorld(t, o.pos, o.rot as Rot, lift);
            pos = new Vector3(w.x, w.y, w.z);
          }
          this.spots.push({ term: `${o.id}.${t.name}`, name: t.name, owner: o.name, pos, hole: hole && t.face === 'top' });
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
  private pathOf(a: Vector3, b: Vector3, seed: number, rects: { x0: number; x1: number; z0: number; z1: number; h: number }[]): Vector3[] {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const up = 5;
    const p1 = new Vector3(a.x, a.y + up, a.z), p5 = new Vector3(b.x, b.y + up, b.z);
    if (d < 26) {
      const mid = new Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + up + 3 + d * 0.22, (a.z + b.z) / 2);
      return [a, p1, mid, p5, b];
    }
    // lying on the table (or on what is under it), bowed to one side so that wires side by side stay apart
    const nx = -dz / d, nz = dx / d;
    const bow = ((seed % 5) - 2) * 3.2 + (seed & 1 ? 1 : -1) * Math.min(18, d * 0.07);
    const floor = (x: number, z: number) => {
      let y = 0;
      for (const r of rects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && r.h > y) y = r.h;
      return y + R_WIRE + 0.3;
    };
    const at = (t: number, k: number) => {
      const x = a.x + dx * t + nx * bow * k, z = a.z + dz * t + nz * bow * k;
      return new Vector3(x, floor(x, z), z);
    };
    const e = Math.min(0.3, 16 / d);
    return [a, p1, at(e, 0.5), at(0.5, 1), at(1 - e, 0.5), p5, b];
  }

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
      return { x0: r.x0 + 1, x1: r.x1 - 1, z0: r.z0 + 1, z1: r.z1 - 1, h: (this.parts?.liftOf(o.id) ?? 0) + sizeOf(o.kind, 0).h };
    });
    const list: { id: string; a: Vector3; b: Vector3; color: string; wide: boolean }[] = [];
    for (const w of st.wires as readonly Wire[]) {
      const a = this.byTerm.get(w.from), b = this.byTerm.get(w.to);
      if (!a || !b) continue;
      list.push({ id: w.id, a: a.pos, b: b.pos, color: w.color, wide: this.selected.has(w.id) || this.hoverWire === w.id });
    }
    const start = this.startTerm ? this.byTerm.get(this.startTerm) : undefined;
    const end = this.hoverTerm && this.hoverTerm !== this.startTerm ? this.byTerm.get(this.hoverTerm)?.pos : this.loose;
    if (start && end) list.push({ id: '', a: start.pos, b: end, color: this.color, wide: false });

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
      const curve = new CatmullRomCurve3(this.pathOf(w.a, w.b, seed, rects), false, 'centripetal');
      const pts = curve.getPoints(SEG);
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
