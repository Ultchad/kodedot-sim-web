/**
 * Controls: the moving child of a model that the user works with the pointer in 3D (a button cap, a switch lever, a
 * knob). The kit has no hook for this yet (the IR remote's caps are found by name), so the inputs family marks them
 * here; it is a candidate for the kit.
 *
 * A model marks ONE named child per manifest control with `markControl(node, controlFromManifest(manifest, field))`.
 * The mark is plain data in `node.userData.control`, so it survives `instantiate()` (which clones the template).
 * The page ray-casts a copy, calls `controlOf(hit.object)` and then, by `mark.mode`:
 *   momentary  pointer down -> bench.setField(instance, field, values[1]); up or leave -> values[0]   (or bench.press)
 *   toggle     click -> bench.setField(instance, field, nextValue(mark, current))
 *   rotate     drag -> bench.setField(instance, field, turnValueAt(mark, dx, dz)), with (dx, dz) the pointer's point on
 *              the table plane minus the node's place, in the model frame (x right, z towards the viewer)
 * The model itself only shows the state it is given: nothing moves until the bench's state says so.
 */
import type { Object3D } from '../../index';
import type { PartManifest } from './shared';

export type ControlMode = 'momentary' | 'toggle' | 'rotate';
export type FieldValue = string | number | boolean;

export interface ControlMark {
  /** The manifest field this child drives. */
  field: string;
  mode: ControlMode;
  /** momentary: [released, held]. toggle: the values a click steps through, in order. */
  values?: FieldValue[];
  /**
   * rotate: the field's range, and the pointer's angle at each end in degrees clockwise seen from above, 0 pointing
   * away from the viewer (-Z). The node turns about its own Y axis.
   */
  turn?: { min: number; max: number; step?: number; minDeg: number; maxDeg: number };
}
export interface Control {
  node: Object3D;
  mark: ControlMark;
}

/** Marks `node` (a named child of the model's root) as the control of a field. Returns the node. */
export function markControl<T extends Object3D>(node: T, mark: ControlMark): T {
  node.userData.control = mark;
  return node;
}
/** The control a ray-cast hit belongs to: the hit object or the nearest parent that carries a mark. */
export function controlOf(hit: Object3D | null | undefined): Control | undefined {
  for (let n = hit ?? null; n; n = n.parent) if (n.userData.control) return { node: n, mark: n.userData.control as ControlMark };
  return undefined;
}
/** Every control of one copy (for keyboard access, or a part small enough that any click on it should press it). */
export function controlsIn(root: Object3D): Control[] {
  const out: Control[] = [];
  root.traverse((n) => {
    if (n.userData.control) out.push({ node: n, mark: n.userData.control as ControlMark });
  });
  return out;
}

/** The mark of a field's control, read from the manifest (`controls[]`, `fields[]`, and the rotate visual's scale). */
export function controlFromManifest(m: PartManifest, field: string): ControlMark {
  const c = m.controls?.find((x) => x.field === field);
  const f = m.fields?.find((x) => x.name === field);
  if (!c || !f) throw new Error(`${m.id}: no control for field "${field}"`);
  if (c.mode === 'momentary') return { field, mode: 'momentary', values: [false, true] };
  if (c.mode === 'toggle') return { field, mode: 'toggle', values: f.type === 'boolean' ? [false, true] : (f.values ?? []).map((v) => v.value) };
  const v = m.visuals?.find((x) => x.effect === 'rotate' && x.source?.field === field);
  const out = v?.scale?.out ?? [-135, 135];
  return { field, mode: 'rotate', turn: { min: f.min ?? 0, max: f.max ?? 1, step: f.step, minDeg: out[0], maxDeg: out[1] } };
}

/** toggle: the value after `current`. */
export function nextValue(mark: ControlMark, current: FieldValue): FieldValue {
  const v = mark.values ?? [false, true];
  return v[(v.indexOf(current) + 1) % v.length];
}
/** rotate: the pointer's angle (degrees clockwise from -Z) for a field value. */
export function turnDeg(t: NonNullable<ControlMark['turn']>, value: number): number {
  const k = Math.min(1, Math.max(0, (value - t.min) / (t.max - t.min || 1)));
  return t.minDeg + (t.maxDeg - t.minDeg) * k;
}
/**
 * rotate: the field value for a pointer at (dx, dz) from the knob's axis in the model frame. Angles in the dead arc
 * (behind the end stops) go to the nearer end; the result is snapped to the field's step.
 */
export function turnValueAt(mark: ControlMark, dx: number, dz: number): number {
  const t = mark.turn!;
  let deg = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 = away from the viewer, clockwise positive
  const mid = (t.minDeg + t.maxDeg) / 2;
  deg = ((((deg - mid + 180) % 360) + 360) % 360) - 180 + mid; // into mid +- 180
  const k = Math.min(1, Math.max(0, (deg - t.minDeg) / (t.maxDeg - t.minDeg || 1)));
  const v = t.min + (t.max - t.min) * k;
  return t.step ? Math.min(t.max, Math.max(t.min, Math.round(v / t.step) * t.step)) : v;
}
