/**
 * The Workbench scene in plain three.js (React only mounts it and feeds it pointer events): the table, the camera rig,
 * where the Dot lies and how it is tilted, and (bodies.ts) everything that stands on the table.
 */
import { Euler, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Texture } from 'three';
import type { MotionPose } from '../device/motion';
import { bodyDims } from '../lib/bodyModel';
import { asDecal } from '../device3d/decal';
import { makeShadowTexture } from '../device3d/textures';
import { OrbitRig } from './camera';
import { DOT, type Rect } from './layout';
import { TABLE_DARK, TABLE_LIGHT, buildTable, type Table } from './table';

const D = bodyDims();
const DEG = Math.PI / 180;
/** The Dot lying on its back: the model's front (+Z) looks up, its top edge (+Y) points away from the viewer (-Z). */
const LYING = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
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
  private v = new Vector3();
  /** Extra things to step each frame (bodies). */
  protected steppers: ((dt: number, reduced: boolean) => boolean)[] = [];

  constructor(dark: boolean) {
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
  /** A short rattle of the Dot on the table (what "shake" looks like). */
  rattle(): void {
    this.shake = 1;
  }

  /** The rectangle of the table that holds the Dot with some room round it (the bodies widen it). */
  contentRect(): Rect {
    return { x0: -DOT.hw - 95, x1: DOT.hw + 95, z0: -DOT.hd - 85, z1: DOT.hd + 60 };
  }
  contentHeight(): number {
    return DOT.h;
  }

  private placeDot(): void {
    const p = this.pose;
    // the heading is taken the short way round (359 and 1 are two degrees apart)
    this.euler.set(p.pitch * DEG, p.roll * DEG, -p.heading * DEG, 'YXZ');
    this.q.setFromEuler(this.euler);
    this.dotQuat.copy(LYING).multiply(this.q);
    // rest on the lowest corner
    let low = Infinity;
    for (let i = 0; i < 8; i++) {
      this.v.set(i & 1 ? D.hw : -D.hw, i & 2 ? D.hh : -D.hh, i & 4 ? D.zf : D.zb).applyQuaternion(this.dotQuat);
      if (this.v.y < low) low = this.v.y;
    }
    const wobble = this.shake > 0.01 ? Math.sin(this.shake * 60) * this.shake * 2.2 : 0;
    this.dotPos.set(wobble, -low + Math.abs(wobble) * 0.4, wobble * 0.3);
    const lift = -low - D.depth / 2; // how far the middle rose above lying flat
    const soft = 1.55 + lift * 0.03;
    this.dotShadow.position.x = this.dotPos.x;
    this.dotShadow.position.z = this.dotPos.z;
    this.dotShadow.rotation.z = p.heading * DEG;
    this.dotShadow.scale.set(D.hw * 2 * soft * 1.25, D.hh * 2 * soft * 1.12, 1);
    this.shadowMat.opacity = 0.62 / (1 + lift * 0.05);
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
    this.placeDot();
    for (const s of this.steppers) busy = s(dt, reduced) || busy;
    return busy;
  }

  dispose(): void {
    this.table.dispose();
    this.shadowTex.dispose();
    this.shadowMat.dispose();
    this.dotShadow.geometry.dispose();
  }
}
