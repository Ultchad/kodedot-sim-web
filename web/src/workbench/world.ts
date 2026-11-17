/**
 * The Workbench scene in plain three.js (React only mounts it and feeds it pointer events): the table, the camera rig,
 * where the Dot lies and how it is tilted, and (bodies.ts) everything that stands on the table.
 */
import { Euler, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Texture } from 'three';
import type { MotionPose } from '../device/motion';
import { bodyDims } from '../lib/bodyModel';
import { asDecal } from '../device3d/decal';
import { makeShadowTexture } from '../device3d/textures';
import { Wires, type WireParts } from './wires';
import { Bodies, type BodiesDeps } from './bodies';
import { OrbitRig } from './camera';
import { DOT, DOT_RECT, dotCentreHeight, type DotPose, type Rect } from './layout';
import { LYING, dotCorners, lowestY, poseFrame, restTilt, restingQuat, type PoseFrame } from './rest';
import { TABLE_DARK, TABLE_LIGHT, buildTable, type Table } from './table';

const D = bodyDims();
const DEG = Math.PI / 180;
/** How far the Dot can be tipped on the table by hand. */
export const TILT_LIMIT = { pitch: 75, roll: 75 } as const;

export class BenchWorld {
  readonly group = new Group();
  readonly rig = new OrbitRig();
  readonly table: Table;
  /** Where the Dot's model goes (outputs of `step`). */
  readonly dotQuat = new Quaternion().copy(LYING);
  readonly dotPos = new Vector3(0, D.depth / 2, 0);
  private pose = { pitch: 0, roll: 0, heading: 0 };
  private poseGoal = { pitch: 0, roll: 0, heading: 0 };
  private shake = 0;
  private dotShadow: Mesh;
  private shadowTex: Texture;
  private shadowMat: MeshBasicMaterial;
  private euler = new Euler(0, 0, 0, 'YXZ');
  private q = new Quaternion();
  /** The Dot's own corners, and the module on its header (points in the Dot's frame): what the assembly rests on. */
  private corners = dotCorners(D.hw, D.hh, D.zf, D.zb);
  private mounted: Float32Array | null = null;
  /** How the assembly lies by itself (radians about the pose's rocking axis: a module deeper than the Dot props one end up). */
  private rest = 0;
  private restGoal = 0;
  /** The way the Dot is put down, and the rotation shown while it is being put down another way. */
  private frame: PoseFrame = poseFrame('lying');
  private shown: PoseFrame = { ...this.frame, base: this.frame.base.clone() };
  /** What stands on the table. */
  readonly bodies: Bodies;
  /** Where the tilt handle floats: off the Dot's top edge, level with its face (it moves with the Dot). */
  readonly handlePos = new Vector3();

  readonly wires: Wires;

  constructor(dark: boolean, deps: Omit<BodiesDeps, 'dotQuat' | 'dotPos'> & { wireParts?: WireParts }) {
    this.group.name = 'workbench';
    this.table = buildTable(dark ? TABLE_DARK : TABLE_LIGHT);
    this.group.add(this.table.group);
    this.shadowTex = makeShadowTexture();
    this.shadowMat = asDecal(new MeshBasicMaterial({ map: this.shadowTex, transparent: true, toneMapped: false, opacity: 0.6 }), 0.15);
    this.dotShadow = new Mesh(new PlaneGeometry(1, 1), this.shadowMat);
    this.dotShadow.rotation.x = -Math.PI / 2;
    this.dotShadow.position.y = 0.02;
    this.dotShadow.raycast = () => {};
    this.dotShadow.renderOrder = 1;
    this.group.add(this.dotShadow);
    this.bodies = new Bodies({ ...deps, dotQuat: this.dotQuat, dotPos: this.dotPos });
    this.group.add(this.bodies.group);
    this.wires = new Wires(deps.bench, deps.wireParts, this.dotQuat, this.dotPos);
    this.group.add(this.wires.group);
    this.placeDot();
  }

  setDark(dark: boolean): void {
    this.table.setColours(dark ? TABLE_DARK : TABLE_LIGHT);
  }

  /** The pose the motion sensors report: flat on the table is zero; pitch lifts the top edge, roll dips the right side. */
  setPose(p: MotionPose): void {
    this.poseGoal.pitch = p.pitch;
    this.poseGoal.roll = p.roll;
    this.poseGoal.heading = p.heading;
  }
  /** Puts the Dot down another way (the bench's `dotPose`); it turns over in a moment. */
  setDotPose(pose: DotPose): void {
    if (pose === this.frame.pose) return;
    this.frame = poseFrame(pose);
    this.shown.pose = pose;
    this.shown.up = this.frame.up;
    this.shown.along = this.frame.along;
    this.shown.axis = this.frame.axis;
    this.rest = 0;
    this.restGoal = this.mounted ? restTilt([this.corners, this.mounted], this.frame.up, this.frame.along) : 0;
  }
  get dotPoseShown(): DotPose {
    return this.frame.pose;
  }
  /** How far along a ray the Dot's box is hit, as it is put down and tipped now, or null. */
  dotHit(ray: { origin: Vector3; direction: Vector3 }): number | null {
    // the ray in the Dot's own frame, against its box
    this.q.copy(this.dotQuat).invert();
    const o = this.hitO.copy(ray.origin).sub(this.dotPos).applyQuaternion(this.q), d = this.hitD.copy(ray.direction).applyQuaternion(this.q);
    let t0 = 0, t1 = Infinity;
    const half = [D.hw, D.hh, D.depth / 2], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dd[k]) < 1e-9) {
        if (Math.abs(oo[k]) > half[k]) return null;
        continue;
      }
      const a = (-half[k] - oo[k]) / dd[k], b = (half[k] - oo[k]) / dd[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) return null;
    }
    return t0;
  }
  private hitO = new Vector3();
  private hitD = new Vector3();
  /** A short rattle of the Dot on the table (what "shake" looks like). */
  rattle(): void {
    this.shake = 1;
  }

  /** The rectangle of the table that holds the Dot with some room round it (the bodies widen it). */
  contentRect(): Rect {
    const b = this.bodies.bounds();
    const r = { x0: -DOT.hw - 95, x1: DOT.hw + 95, z0: -DOT.hd - 85, z1: DOT.hd + 60 };
    if (!b) return r;
    return { x0: Math.min(r.x0, b.x0 - 12), x1: Math.max(r.x1, b.x1 + 12), z0: Math.min(r.z0, b.z0 - 12), z1: Math.max(r.z1, b.z1 + 12) };
  }
  contentHeight(): number {
    return Math.max(DOT.h, this.bodies.bounds()?.h ?? 0);
  }

  private placeDot(): void {
    const p = this.pose;
    // the heading is taken the short way round (359 and 1 are two degrees apart)
    this.euler.set(p.pitch * DEG, p.roll * DEG, 0, 'YXZ');
    this.q.setFromEuler(this.euler);
    // put down the way the bench says (lying, standing, on its side), turned on the table, tipped by the hand, and
    // rocked the way the Dot and its module lie by themselves; then the whole assembly rests on its lowest point: the
    // Dot's corners or the module's
    restingQuat(this.shown, this.q, p.heading, this.rest, this.dotQuat);
    const low = Math.min(lowestY(this.corners, this.dotQuat), this.mounted ? lowestY(this.mounted, this.dotQuat) : Infinity);
    const wobble = this.shake > 0.01 ? Math.sin(this.shake * 60) * this.shake * 2.2 : 0;
    this.dotPos.set(wobble, -low + Math.abs(wobble) * 0.4, wobble * 0.3);
    const lift = Math.max(0, -low - dotCentreHeight(this.frame.pose)); // how far the middle rose above resting flat
    const soft = 1.55 + lift * 0.03;
    this.dotShadow.position.x = this.dotPos.x;
    this.dotShadow.position.z = this.dotPos.z;
    this.dotShadow.rotation.z = p.heading * DEG;
    this.dotShadow.scale.set((DOT_RECT.x1 - DOT_RECT.x0) * soft * 1.25, (DOT_RECT.z1 - DOT_RECT.z0) * soft * 1.12, 1);
    this.shadowMat.opacity = 0.62 / (1 + lift * 0.05);
    this.handlePos.set(0, D.hh + 15, D.zf).applyQuaternion(this.dotQuat).add(this.dotPos);
  }
  /** The pose shown right now (it glides to the one set). */
  shownPose(): Readonly<{ pitch: number; roll: number; heading: number }> {
    return this.pose;
  }

  /** Advances the camera, the Dot's tilt and whatever moves on the table. True while something is still moving. */
  step(dt: number, reduced: boolean): boolean {
    let busy = this.rig.step(dt, reduced);
    const p = this.pose, g = this.poseGoal;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 16);
    let dh = g.heading - p.heading;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const moving = Math.abs(g.pitch - p.pitch) > 0.02 || Math.abs(g.roll - p.roll) > 0.02 || Math.abs(dh) > 0.02;
    if (moving) {
      p.pitch += (g.pitch - p.pitch) * k;
      p.roll += (g.roll - p.roll) * k;
      p.heading += dh * k;
      busy = true;
    } else if (p.pitch !== g.pitch || p.roll !== g.roll || p.heading !== g.heading) {
      p.pitch = g.pitch;
      p.roll = g.roll;
      p.heading = g.heading;
    }
    if (this.shake > 0) {
      this.shake = reduced ? 0 : Math.max(0, this.shake - dt * 1.8);
      busy = busy || this.shake > 0;
    }
    // a module was put on the header or taken off: the assembly settles into the way it now lies
    const mounted = this.bodies.mountedPoints();
    if (mounted !== this.mounted) {
      this.mounted = mounted;
      this.restGoal = mounted ? restTilt([this.corners, mounted], this.frame.up, this.frame.along) : 0;
    }
    // being put down another way: the Dot turns over to it
    if (!this.shown.base.equals(this.frame.base)) {
      if (reduced || this.shown.base.angleTo(this.frame.base) < 0.004) this.shown.base.copy(this.frame.base);
      else {
        this.shown.base.slerp(this.frame.base, 1 - Math.exp(-dt * 11));
        busy = true;
      }
    }
    if (this.rest !== this.restGoal) {
      this.rest += (this.restGoal - this.rest) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
      if (Math.abs(this.restGoal - this.rest) < 0.0005) this.rest = this.restGoal;
      else busy = true;
    }
    this.placeDot();
    busy = this.bodies.step(dt, reduced) || busy;
    this.wires.draw();
    return busy;
  }

  dispose(): void {
    this.bodies.dispose();
    this.wires.dispose();
    this.table.dispose();
    this.shadowTex.dispose();
    this.shadowMat.dispose();
    this.dotShadow.geometry.dispose();
  }
}
