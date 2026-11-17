/**
 * Shared builders of the passives family (resistor, capacitors, diode, LEDs). Several of them are candidates for the
 * kit (parts.ts / nodes.ts / print.ts): `axial`, `plate`, `ribbon`, `bentLead`, `cylinderStrip` with `printOnCylinder` and
 * `screenOnCylinder`, `hotShell`, `tint`.
 */
import { BufferAttribute, BufferGeometry, type Mesh, type MeshStandardMaterial } from 'three';
import { MeshBuilder } from '../../../device3d/meshBuilder';
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

// --------------------------------------------------------------------------------------------------- colours
/**
 * A colour for the Shape builders that is SEEN as `hex`. The kit's Shape.add linearises a colour twice (`Color.set`
 * already converts sRGB to linear, `convertSRGBToLinear` does it again), so a hex given to a builder comes out darker
 * and more saturated: orange turns red, yellow turns amber. Where the hue carries meaning (a resistor's bands, a
 * yellow LED) the colour is encoded once more here, so the double conversion lands on the intended one.
 */
export function asSeen(hex: string): string {
  const enc = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const n = parseInt(hex.slice(1), 16);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => enc(c / 255).toString(16).padStart(2, '0')).join('')}`;
}

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

/**
 * A flat ribbon lying on a surface (a crack, a score line, a seam): through the points `at` (each with the surface's
 * normal there), `w0` wide at its start and `w1` at its end, raised `lift` off the surface and moved `shift` sideways.
 */
export function ribbon(s: Shape, finish: Finish, at: { p: V3; n: V3 }[], w0: number, w1: number, lift = 0.04, shift = 0): void {
  const mb = new MeshBuilder();
  let prev: [number, number] | null = null;
  for (let i = 0; i < at.length; i++) {
    const a = at[Math.max(0, i - 1)].p, b = at[Math.min(at.length - 1, i + 1)].p, { p, n } = at[i];
    const t: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let sx = n[1] * t[2] - n[2] * t[1], sy = n[2] * t[0] - n[0] * t[2], sz = n[0] * t[1] - n[1] * t[0];
    const l = Math.hypot(sx, sy, sz) || 1;
    sx /= l;
    sy /= l;
    sz /= l;
    const w = (w0 + ((w1 - w0) * i) / (at.length - 1)) / 2;
    const c: V3 = [p[0] + n[0] * lift + sx * shift, p[1] + n[1] * lift + sy * shift, p[2] + n[2] * lift + sz * shift];
    const pair: [number, number] = [mb.vertex([c[0] - sx * w, c[1] - sy * w, c[2] - sz * w], n), mb.vertex([c[0] + sx * w, c[1] + sy * w, c[2] + sz * w], n)];
    if (prev) mb.quad(prev[0], prev[1], pair[1], pair[0], n);
    prev = pair;
  }
  s.add(finish[0], finish[1], mb.build());
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
export function setHot(obj: Object3D, name: string, hot: boolean, time: number, colour = 0xd62400): void {
  const n = part(obj, name);
  if (!n) return;
  n.visible = hot;
  if (hot) setLamp(obj, name, colour, 0.42 + 0.26 * Math.sin(time * 7));
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

// ------------------------------------------------------------------------------------------------ axial parts
/** How far the leads of this family's parts reach below the seating plane (into a breadboard). */
export const PLUG = 6;
/**
 * The two leads of a part lying along X at height `y`: out of the body's ends at x0 and x1, bent down at the
 * terminals `a` and `b` and on below the seating plane.
 */
export function axialLeadsTo(s: Shape, a: V3, b: V3, y: number, x0: number, x1: number, d = 0.55, plug = PLUG): void {
  bentLead(s, [[x0, y, a[2]], [a[0], y, a[2]], [a[0], -plug, a[2]]], d, Math.min(0.9, y * 0.7));
  bentLead(s, [[x1, y, b[2]], [b[0], y, b[2]], [b[0], -plug, b[2]]], d, Math.min(0.9, y * 0.7));
}
/** The clear shell of an axial body for `hotShell`: the body's outline as [radius, x], drawn a little larger. */
export function axialShell(y: number, profile: V2[], seg: number, colour = asSeen('#ea3a0e')): Shape {
  const s = new Shape();
  s.with(axial(y), () => s.lathe('glass', colour, 0, 0, profile.map(([r, x], i) => [r > 0 ? r + 0.1 : 0, x + (i < profile.length / 2 ? -0.1 : 0.1)] as V2), seg));
  return s;
}
