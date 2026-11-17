/**
 * The module on the Dot's header, drawn as a child of the Dot's own model: one object for the Device view and for the
 * Workbench, placed by the one mount matrix there is (parts/geometry.ts `mountMatrix`, through `parts.mountOf`), so it
 * goes wherever the Dot goes: orbited in the Device view, lying, standing or tipped on the table, and while the view
 * changes from one to the other. Taking the module off removes it from both.
 */
import { Box3, Group, Vector3, type Object3D } from 'three';
import { makeCtx, type AnimEnv, type PartModel } from '../bench3d/contract';
import { disposeInstance, instantiate } from '../bench3d/nodes';
import { getModel } from '../bench3d/registry';
import type { BenchStore } from '../bench/store';
import { fallbackModel } from '../parts/fallbackModel';
import type { PartsService } from '../parts/service';
import { hullCorners, transformed, vertexCloud } from './rest';

const IDLE = { fields: {}, outputs: {}, visuals: {}, power: { on: false }, pins: {} };

export class DotModule {
  /** Add this to the Dot's model group. */
  readonly group = new Group();
  /** What the module covers in the Dot's own frame (empty when nothing is mounted): for framing the camera. */
  readonly box = new Box3();
  /** The module's instance id, or '' when nothing is mounted. */
  id = '';
  private mat: number[] | null = null;
  private model: PartModel | null = null;
  private copy: Object3D | null = null;
  private animating = true;
  private templates = new Map<string, { model: PartModel; template: Object3D; hull: Float32Array }>();
  private env: AnimEnv = { time: 0, dt: 0 };
  private v = new Vector3();

  constructor(
    private bench: BenchStore,
    private parts: PartsService,
  ) {
    this.group.name = 'dot-module';
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
  }

  /** Makes what is drawn equal to the bench: the mounted module, the way it is mounted. True when that changed. */
  sync(): boolean {
    const mounts = this.bench.getState().mounts;
    let id = '';
    for (const k in mounts) {
      id = k;
      break;
    }
    const kind = id ? (this.bench.get(id)?.kind ?? '') : '';
    const mat = id ? this.parts.mountOf(id) : null;
    if (!mat) id = '';
    if (id === this.id && mat === this.mat) return false;
    if (this.copy) {
      this.group.remove(this.copy);
      disposeInstance(this.copy);
      this.copy = null;
    }
    this.id = id;
    this.mat = mat;
    this.model = null;
    this.box.makeEmpty();
    this.group.visible = false;
    if (!mat) return true;
    let t = this.templates.get(kind);
    if (!t) {
      const manifest = this.parts.manifest(kind);
      const model = getModel(kind) ?? (manifest ? (fallbackModel(manifest, this.parts.picture(kind)) as unknown as PartModel) : null);
      if (!model) {
        // its package has not arrived yet: asked again on the next frame that is drawn
        this.mat = null;
        this.id = '';
        return false;
      }
      const template = model.build(makeCtx());
      this.templates.set(kind, (t = { model, template, hull: hullCorners(vertexCloud(template)) }));
    }
    this.model = t.model;
    this.copy = instantiate(t.template);
    this.group.add(this.copy);
    this.group.matrix.fromArray(mat);
    this.group.matrixWorldNeedsUpdate = true;
    this.group.visible = true;
    const pts = transformed(t.hull, mat);
    for (let i = 0; i < pts.length; i += 3) this.box.expandByPoint(this.v.set(pts[i], pts[i + 1], pts[i + 2]));
    this.animating = true;
    return true;
  }

  /** Shows the module's live state (its model's `animate`); true while it is still moving. */
  step(dt: number): boolean {
    this.env.time += dt;
    this.env.dt = dt;
    if (!this.copy || !this.model?.animate) return false;
    const st = this.parts.stateOf(this.id) ?? IDLE;
    this.animating = this.model.animate(st as never, this.copy, this.env) === true;
    return this.animating;
  }

  dispose(): void {
    if (this.copy) disposeInstance(this.copy);
    this.copy = null;
    this.group.removeFromParent();
  }
}
