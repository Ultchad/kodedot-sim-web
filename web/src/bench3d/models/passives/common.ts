/**
 * Shared builders of the passives family (resistor, capacitors, diode, LEDs). Several of them are candidates for the
 * kit (parts.ts / nodes.ts / print.ts): `axial`, `plate`, `bentLead`, `cylinderStrip` with `printOnCylinder` and
 * `screenOnCylinder`, `hotShell`, `tint`.
 */
import { BufferAttribute, BufferGeometry, type Mesh, type MeshStandardMaterial } from 'three';
import {
  Matrix4, PAL, Shape, glowing, part, print, roundCorners, screen, setLamp,
  type Finish, type ManifestBody, type ManifestPin, type Object3D, type PrintDef, type Pt, type Terminal, type V2, type V3,
} from '../../index';

// ------------------------------------------------------------------------------------------------- the manifest
/** What the models of this family read of a part's manifest.json. */
export interface PartManifest {
  id: string;
  name: { en: string };
  body: ManifestBody;
  pins: ManifestPin[];
  fields?: { name: string; default?: number | boolean | string }[];
  visuals?: { id: string; color?: string }[];
  behaviour?: { elements?: Record<string, unknown>[] };
}
/** A manifest.json import, typed (the JSON's `face` is a plain string to TypeScript). */
export const asManifest = (m: unknown): PartManifest => m as PartManifest;
export const fieldDefault = (m: PartManifest, name: string, fallback: number): number => Number(m.fields?.find((f) => f.name === name)?.default ?? fallback);
/** The colour of a manifest visual ('#ff3b30') as 0xRRGGBB. */
export const visualColour = (m: PartManifest, id: string, fallback: number): number => {
  const c = m.visuals?.find((v) => v.id === id)?.color;
  return c && /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : fallback;
};
export const terminalOf = (terminals: Terminal[], id: string): V3 => terminals.find((t) => t.id === id)!.pos;
/** A number of a part's live fields, or its default. */
export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// --------------------------------------------------------------------------------------------------- placing
/**
 * The frame of a part lying along X at height `y` (an axial resistor or diode): inside `s.with(axial(y, z), ...)`
 * a `lathe` or a `band` about (0, 0) turns about the part's own axis, and their "y" runs along X.
 * A `band` angle of PI is then the top of the part, PI / 2 its front (+Z).
 */
export const axial = (y: number, z = 0): Matrix4 => new Matrix4().makeTranslation(0, y, z).multiply(new Matrix4().makeRotationZ(-Math.PI / 2));

const UPRIGHT = new Matrix4().makeRotationX(Math.PI / 2);
/**
 * A flat plate standing in the XY plane (a stamped lead frame, a fin): its outline as [x, y] points, between depths
 * z0 and z1. Keep outlines convex or nearly so.
 */
export function plate(s: Shape, finish: Finish, outline: V2[], z0: number, z1: number, bevel = 0.04): void {
  s.with(UPRIGHT, () => s.prism(...finish, outline.map(([x, y]) => [x, -y] as Pt), z0, z1, bevel, { cap: true, ao: 1 }));
}

/** A round lead through `pts` with rounded bends (like the kit's `lead`, with the tube's sides as a parameter). */
export function bentLead(s: Shape, pts: V3[], d = 0.55, bend = 0.8, sides = 6, finish: Finish = PAL.tin): void {
  s.tube(...finish, roundCorners(pts, bend, 3), d / 2, sides);
}

// ------------------------------------------------------------------------------------- print on a round surface
export interface CylinderStrip {
  /** A point of the axis, the axis (unit), the direction of angle 0 (unit) and of angle 90 degrees (unit). */
  o: V3;
  axis: V3;
  u: V3;
  v: V3;
  r: number;
  /** The strip: between angles a0 and a1 (radians) and between t0 and t1 along the axis. */
  a0: number;
  a1: number;
  t0: number;
  t1: number;
  /**
   * 'axis': the picture's width runs along the axis and its top is at a1 (a lying part: `axis` +X, `u` +Z, `v` +Y).
   * 'arc': the picture's width runs round the cylinder and its top is at t1 (a standing can: `axis` +Y, `u` +X, `v` +Z).
   */
  reads: 'axis' | 'arc';
  seg?: number;
}
/** The size in millimetres of the picture laid on a strip: [width, height]. */
export const stripSize = (c: CylinderStrip): [number, number] => {
  const arc = Math.abs(c.a1 - c.a0) * c.r, len = Math.abs(c.t1 - c.t0);
  return c.reads === 'axis' ? [len, arc] : [arc, len];
};
/** The geometry of a strip of a cylinder, with the UVs of a picture laid on it (see `CylinderStrip.reads`). */
export function cylinderStrip(c: CylinderStrip): BufferGeometry {
  const seg = c.seg ?? 6;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const r = c.r + 0.02;
  for (let i = 0; i <= seg; i++) {
    const f = i / seg;
    const a = c.a0 + (c.a1 - c.a0) * f;
    const n: V3 = [c.u[0] * Math.cos(a) + c.v[0] * Math.sin(a), c.u[1] * Math.cos(a) + c.v[1] * Math.sin(a), c.u[2] * Math.cos(a) + c.v[2] * Math.sin(a)];
    for (const [t, g] of [[c.t0, 0], [c.t1, 1]] as const) {
      pos.push(c.o[0] + c.axis[0] * t + n[0] * r, c.o[1] + c.axis[1] * t + n[1] * r, c.o[2] + c.axis[2] * t + n[2] * r);
      nrm.push(n[0], n[1], n[2]);
      if (c.reads === 'axis') uv.push(g, f);
      else uv.push(1 - f, g);
    }
  }
  // the outside is the front: axis x tangent points outwards
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, d = a + 2, e = a + 3;
    if (c.reads === 'axis') idx.push(a, b, e, a, e, d);
    else idx.push(d, a, b, d, b, e);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
const flatQuad = (c: CylinderStrip) => {
  const [w, h] = stripSize(c);
  return { c: [0, 0, 0] as V3, u: [w / 2, 0, 0] as V3, v: [0, h / 2, 0] as V3 };
};
/** A print (static, one texture per model) wrapped round a cylinder. `draw` works in millimetres from the middle of the strip. */
export function printOnCylinder(c: CylinderStrip, def: Omit<PrintDef, 'quad'>): Mesh {
  const m = print({ ...def, quad: flatQuad(c) });
  m.geometry.dispose();
  m.geometry = cylinderStrip(c);
  return m;
}
/** A picture drawn per copy (`drawScreen`) wrapped round a cylinder: the value printed on a capacitor's sleeve. */
export function screenOnCylinder(name: string, c: CylinderStrip, ppm: number): Mesh {
  const m = screen(name, flatQuad(c), ppm, { lit: false });
  m.geometry.dispose();
  m.geometry = cylinderStrip(c);
  return m;
}

// ------------------------------------------------------------------------------------------------- live looks
/**
 * A part running too hot: a thin clear shell round the body, hidden until `setHot` lights it. Build it from the
 * body's own outline, a little larger.
 */
export function hotShell(name: string, shell: Shape): Object3D {
  const g = glowing(name, shell);
  g.visible = false;
  return g;
}
/** Shows or hides a `hotShell`; while hot it pulses (call every frame: return true from `animate`). */
export function setHot(obj: Object3D, name: string, hot: boolean, time: number, colour = 0xff4a12): void {
  const n = part(obj, name);
  if (!n) return;
  n.visible = hot;
  if (hot) setLamp(obj, name, colour, 0.62 + 0.3 * Math.sin(time * 7));
}

/** Multiplies the colours of a `glowing` part of one copy (its materials are its own): 0xffffff is as built. */
export function tint(node: Object3D, hex: number): void {
  if (node.userData.tint === hex) return;
  node.userData.tint = hex;
  for (let i = 0; i < node.children.length; i++) {
    const m = (node.children[i] as Mesh).material as MeshStandardMaterial | undefined;
    if (m?.color) m.color.setHex(hex);
  }
}
/** Shows or hides a named part of one copy. */
export function show(obj: Object3D, name: string, on: boolean): void {
  const n = part(obj, name);
  if (n) n.visible = on;
}
