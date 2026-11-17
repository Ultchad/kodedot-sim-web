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
import { DOT, type Rect } from './layout';
import { LYING, dotCorners, lowestY, lyingQuat, restTilt } from './rest';
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
  /** How the assembly lies by itself (radians about the Dot's X: a module deeper than the Dot's back props its top end up). */
  private rest = 0;
  private restGoal = 0;
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
    this.euler.set(p.pitch * DEG, p.roll * DEG, -p.heading * DEG, 'YXZ');
    this.q.setFromEuler(this.euler);
    // the way the Dot and its module lie by themselves comes first (about the Dot's own X), the hand's tilt on top;
    // then the whole assembly rests on its lowest point: the Dot's corners or the module's
    lyingQuat(this.q, this.rest, this.dotQuat);
    const low = Math.min(lowestY(this.corners, this.dotQuat), this.mounted ? lowestY(this.mounted, this.dotQuat) : Infinity);
    const wobble = this.shake > 0.01 ? Math.sin(this.shake * 60) * this.shake * 2.2 : 0;
    this.dotPos.set(wobble, -low + Math.abs(wobble) * 0.4, wobble * 0.3);
    const lift = -low - D.depth / 2; // how far the middle rose above lying flat
    const soft = 1.55 + lift * 0.03;
    this.dotShadow.position.x = this.dotPos.x;
    this.dotShadow.position.z = this.dotPos.z;
    this.dotShadow.rotation.z = p.heading * DEG;
    this.dotShadow.scale.set(D.hw * 2 * soft * 1.25, D.hh * 2 * soft * 1.12, 1);
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
      this.restGoal = mounted ? restTilt([this.corners, mounted]) : 0;
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
