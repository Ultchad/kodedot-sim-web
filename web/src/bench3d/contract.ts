/**
 * The contract of a Bench3D model: one part, one file, `web/src/bench3d/models/<family>/<part-id>.model.ts`, default
 * export made with `defineModel`. Files are discovered by the registry (registry.ts): nobody edits a shared list.
 * README.md in this folder is the guide; this file is the law.
 *
 * COORDINATES (millimetres): the origin is the centre of the footprint on the table. X to the right, Z towards the
 * viewer, Y up. The model stands on y = 0 and must stay inside its footprint box: |x| <= w/2, |z| <= d/2, 0 <= y <= h.
 * The "front" of a part (a TV's screen, a connector's mouth, the side the user reads) faces +Z. The Workbench turns a
 * model in quarter turns about Y and never scales it.
 */
import { Box3, type Object3D } from 'three';
import type { V3 } from '../device3d/meshBuilder';
import { countTriangles } from './nodes';

export interface Terminal {
  /** Stable id used by the wiring: 'A', 'K', 'GND', 'D13', 'VIN' ... */
  id: string;
  /** What is printed or said about it (defaults to the id). */
  label?: string;
  /**
   * Where a wire's end sits, in the model frame: the top of a pin, the mouth of a socket, the middle of a pad or of a
   * screw clamp. The wire is drawn arriving at this point.
   */
  pos: V3;
  /** Unit vector along which a wire leaves the terminal. Default straight up [0, 1, 0]; a side screw terminal points sideways. */
  dir?: V3;
  kind?: 'pin' | 'socket' | 'pad' | 'screw' | 'lead' | 'wire';
}

export interface BuildCtx {
  /** Level of detail, 1 = full. Use `seg()` for the segment counts of round things so one model serves both. */
  detail: number;
  /** A segment count scaled by the detail, never below a sane minimum: `ctx.seg(24)`. */
  seg(n: number): number;
}

export interface AnimEnv {
  /** Seconds since the scene started, for blinking and spinning. */
  time: number;
  /** Seconds since the last call for this object. */
  dt: number;
}

export interface PartModel<S = Record<string, unknown>> {
  /** Unique id: the `id` of the part's manifest ('dotbench.led', 'dotbench.uno-r3') or the bench kind ('nfc.tag') it is the body of. */
  id: string;
  /** Plain name for the gallery and the harness. */
  title: string;
  /** The box the model stays inside: w along X, d along Z, h along Y. Real dimensions, from the datasheet. */
  footprintMm: { w: number; d: number; h: number };
  /**
   * How far leads or pins reach BELOW the seating plane y = 0 (the legs of an LED or a header that plug into a
   * breadboard or a socket). The body still stands on y = 0, as in the part's manifest (`h_mm` is the height above the
   * seating plane); the host decides whether the legs go into holes or the part is raised on them. Default 0.
   */
  plugMm?: number;
  /** Triangle budget, when the default for the footprint (see `budgetFor`) does not fit. Justify it in a comment. */
  budget?: number;
  /**
   * Builds the model ONCE (a template; the host clones it for every copy on the table, sharing geometry and materials).
   * Direct children of the returned root made by `Shape.toObject()` and `print()` are the static body. Anything that
   * moves or lights up goes in a NAMED child (`lamp`, `screen`, a sub-group) and is driven by `animate`.
   */
  build(ctx: BuildCtx): Object3D;
  /** Where wires attach. */
  terminals?: Terminal[];
  /**
   * Shows the part's live state on one copy: called when the state changes, and again every frame for as long as it
   * returns true (blinking, spinning). Must not allocate: look nodes up with `part(obj, name)`, set transforms and lamps.
   */
  animate?(state: S, obj: Object3D, env: AnimEnv): boolean | void;
  /** Named example states (include hazards: a burning LED, a stalled motor): the harness renders each of them. */
  states?: Record<string, S>;
}

// ----------------------------------------------------------------------------------- the parts engine's manifest
/**
 * A part's manifest (parts/<id>/manifest.json, docs/STATUS-parts.md "Page wiring" 12) gives its body and pins in
 * millimetres with the origin at the TOP-LEFT corner of the footprint seen from above: x right, y down the picture,
 * z up from the table. The model frame has its origin at the CENTRE of the footprint. The mapping is exact:
 *
 *   model X = mm.x - w_mm / 2        model Z = mm.y - d_mm / 2        model Y = mm.z
 *   footprintMm = { w: w_mm, d: d_mm, h: h_mm }
 *   mm.z missing: top -> h_mm, bottom -> 0, left/right/front/back -> h_mm / 2
 *   face -> dir:  top [0,1,0]  bottom [0,-1,0]  left [-1,0,0]  right [1,0,0]  front (y = d_mm) [0,0,1]  back (y = 0) [0,0,-1]
 *
 * so "down the picture" is "towards the viewer", and the picture.svg of a part is the model's top view.
 */
export interface ManifestBody {
  w_mm: number;
  d_mm: number;
  h_mm: number;
}
export type ManifestFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
export interface ManifestPin {
  name: string;
  mm?: { x: number; y: number; z?: number };
  face?: ManifestFace;
  label?: Record<string, string>;
}
const FACE_DIR: Record<ManifestFace, V3> = { top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], front: [0, 0, 1], back: [0, 0, -1] };
const FACE_KIND: Record<ManifestFace, Terminal['kind']> = { top: 'socket', bottom: 'lead', left: 'pad', right: 'pad', front: 'screw', back: 'pad' };

export const footprintOf = (body: ManifestBody): { w: number; d: number; h: number } => ({ w: body.w_mm, d: body.d_mm, h: body.h_mm });
/** A manifest position (mm from the top-left corner, z up) as a point of the model frame. */
export function fromManifestMm(body: ManifestBody, mm: { x: number; y: number; z?: number }, face: ManifestFace = 'top'): V3 {
  const y = mm.z ?? (face === 'top' ? body.h_mm : face === 'bottom' ? 0 : body.h_mm / 2);
  return [mm.x - body.w_mm / 2, y, mm.y - body.d_mm / 2];
}
/** A model-frame point back in manifest millimetres (to check a model against its manifest). */
export const toManifestMm = (body: ManifestBody, p: V3): { x: number; y: number; z: number } => ({ x: p[0] + body.w_mm / 2, y: p[2] + body.d_mm / 2, z: p[1] });
/** The terminals of a model straight from its part's manifest: same ids as the wiring (`<instance>.<pin name>`). */
export function terminalsFromManifest(m: { body: ManifestBody; pins: readonly ManifestPin[] }): Terminal[] {
  return m.pins
    .filter((p) => p.mm)
    .map((p) => ({ id: p.name, label: p.label?.en, pos: fromManifestMm(m.body, p.mm!, p.face), dir: FACE_DIR[p.face ?? 'top'], kind: FACE_KIND[p.face ?? 'top'] }));
}

/**
 * The live state a WIRED part's model receives: its entry of `bench.state().parts[]` of the parts engine, as it is
 * (STATUS-parts.md "Page wiring" 6 and 14). Read what your part publishes: LEDs `outputs.brightness` (0..1),
 * `overcurrent`, `burnt`; servo `angle`; motor `speed` (-1..1); stepper `angle`, `stalled`; relay `energized`;
 * buzzer `hz`; electrolytic `burst`; Uno R4 WiFi `matrix0..2`; and `power.on`, `fields`, `pins[<name>].mv`.
 */
export interface PartState {
  fields: Readonly<Record<string, number | boolean | string>>;
  outputs: Readonly<Record<string, number | boolean | string>>;
  visuals: Readonly<Record<string, number>>;
  power: { on: boolean; reason?: string };
  pins: Readonly<Record<string, { mv: number; level: number; floating: boolean; pwm?: unknown }>>;
  crashed?: boolean;
}
/** A PartState for `states` examples and tests. */
export const partState = (o: Partial<PartState> = {}): PartState => ({ fields: {}, outputs: {}, visuals: {}, power: { on: true }, pins: {}, ...o });

export function defineModel<S = Record<string, unknown>>(m: PartModel<S>): PartModel<S> {
  return m;
}

/** Default triangle budget by footprint area: small parts are drawn by the dozen. */
export function budgetFor(m: Pick<PartModel, 'footprintMm' | 'budget'>): number {
  if (m.budget) return m.budget;
  const area = m.footprintMm.w * m.footprintMm.d;
  return area < 150 ? 1200 : area < 900 ? 2500 : area < 3600 ? 6000 : area < 12000 ? 12000 : 20000;
}

export const makeCtx = (detail = 1): BuildCtx => ({ detail, seg: (n) => Math.max(6, Math.round(n * detail)) });

export interface ModelReport {
  id: string;
  triangles: number;
  budget: number;
  drawCalls: number;
  /** Bounding box of what was built. */
  box: { min: V3; max: V3 };
  problems: string[];
}

/** Builds a model and checks it against the contract. The unit test and the shot script both use this. */
export function inspectModel(m: PartModel, obj: Object3D = m.build(makeCtx())): ModelReport {
  const problems: string[] = [];
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(m.id)) problems.push(`id "${m.id}": lower case letters, digits, dots and dashes`);
  const { w, d, h } = m.footprintMm;
  if (!(w > 0 && d > 0 && h > 0)) problems.push('footprintMm must be positive');
  obj.updateMatrixWorld(true);
  const box = new Box3().setFromObject(obj);
  const tol = 0.25;
  if (box.min.x < -w / 2 - tol || box.max.x > w / 2 + tol) problems.push(`sticks out of the footprint along X: ${box.min.x.toFixed(2)} .. ${box.max.x.toFixed(2)} (w ${w})`);
  if (box.min.z < -d / 2 - tol || box.max.z > d / 2 + tol) problems.push(`sticks out of the footprint along Z: ${box.min.z.toFixed(2)} .. ${box.max.z.toFixed(2)} (d ${d})`);
  const plug = m.plugMm ?? 0;
  if (box.min.y < -plug - tol) problems.push(`goes under the table: y ${box.min.y.toFixed(2)}${plug ? ` (plugMm ${plug})` : ' (legs that plug in: declare plugMm)'}`);
  if (box.max.y > h + tol) problems.push(`taller than footprintMm.h: ${box.max.y.toFixed(2)} > ${h}`);
  if (box.max.x - box.min.x < w * 0.6 || box.max.z - box.min.z < d * 0.6) problems.push('the footprint is much larger than the model: give the real size');
  const triangles = countTriangles(obj);
  const budget = budgetFor(m);
  if (triangles > budget) problems.push(`${triangles} triangles, budget ${budget}`);
  if (triangles < 12) problems.push('nothing was built');
  let drawCalls = 0;
  obj.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh) drawCalls++;
  });
  if (drawCalls > 24) problems.push(`${drawCalls} meshes: merge static parts into one Shape`);
  const ids = new Set<string>();
  for (const t of m.terminals ?? []) {
    if (ids.has(t.id)) problems.push(`terminal "${t.id}" twice`);
    ids.add(t.id);
    const [x, y, z] = t.pos;
    if (Math.abs(x) > w / 2 + tol || Math.abs(z) > d / 2 + tol || y < -plug - tol || y > h + 2) problems.push(`terminal "${t.id}" is outside the footprint`);
    if (t.dir && Math.abs(Math.hypot(...t.dir) - 1) > 0.01) problems.push(`terminal "${t.id}": dir must be a unit vector`);
  }
  return { id: m.id, triangles, budget, drawCalls, box: { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, problems };
}
