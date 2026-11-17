/**
 * Print on a model: silkscreen, legends, pin labels, coils. Functional, generic markings only: no brand,
 * real or invented, no maker's name, no logo-like mark (README.md, "No brands"). A print is a flat
 * quad with a small texture drawn by code, laid on the surface as a decal (device3d/decal.ts: pulled towards the
 * camera, never fighting the surface for depth). One texture per print per MODEL, shared by every copy on the table.
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector3, type Matrix4 } from 'three';
import type { V3 } from '../device3d/meshBuilder';
import { asDecal } from '../device3d/decal';

export interface Quad {
  /** Centre, half axis to the right (the canvas's x) and half axis up (against the canvas's y). Millimetres. */
  c: V3;
  u: V3;
  v: V3;
}
export interface PrintDef {
  quad: Quad;
  /** Texture pixels per millimetre: 6 to 8 for legends on big faces, 10 to 12 for small text, up to 24 for tiny parts. */
  ppm: number;
  /** Draws in MILLIMETRES: origin at the centre of the quad, x to the right, y down. The canvas starts transparent. */
  draw(g: CanvasRenderingContext2D): void;
  name?: string;
}

/** A quad lying on a horizontal face at height `y`: x to the right, the top of the drawing away from the viewer (-Z). */
export const topQuad = (cx: number, cz: number, y: number, hw: number, hd: number): Quad => ({ c: [cx, y, cz], u: [hw, 0, 0], v: [0, 0, -hd] });
/** A quad on a vertical face looking at the viewer (+Z) at depth `z`. */
export const frontQuad = (cx: number, cy: number, z: number, hw: number, hh: number): Quad => ({ c: [cx, cy, z], u: [hw, 0, 0], v: [0, hh, 0] });
/** A quad moved by a matrix (print on a tilted or turned part: give the quad in the part's own frame). */
export function movedQuad(q: Quad, m: Matrix4): Quad {
  const p = new Vector3(...q.c).applyMatrix4(m);
  const d = (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    const t = new Vector3(...a).transformDirection(m);
    return [t.x * l, t.y * l, t.z * l];
  };
  return { c: [p.x, p.y, p.z], u: d(q.u), v: d(q.v) };
}

export function quadGeometry(q: Quad): BufferGeometry {
  const g = new BufferGeometry();
  const p = (a: number, b: number) => [q.c[0] + q.u[0] * a + q.v[0] * b, q.c[1] + q.u[1] * a + q.v[1] * b, q.c[2] + q.u[2] * a + q.v[2] * b];
  const n = new Vector3(q.u[1] * q.v[2] - q.u[2] * q.v[1], q.u[2] * q.v[0] - q.u[0] * q.v[2], q.u[0] * q.v[1] - q.u[1] * q.v[0]).normalize();
  g.setAttribute('position', new BufferAttribute(new Float32Array([...p(-1, -1), ...p(1, -1), ...p(1, 1), ...p(-1, 1)]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const MAX_PX = 1024;
const live: { canvas: HTMLCanvasElement; def: PrintDef; texture: CanvasTexture; k: number }[] = [];
let fontsWatched = false;

function paint(canvas: HTMLCanvasElement, def: PrintDef, k: number): void {
  const g = canvas.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(k, 0, 0, k, canvas.width / 2, canvas.height / 2);
  g.save();
  def.draw(g);
  g.restore();
}

/** The decal mesh of a print. Add it directly under the model's root: it is part of the static body. */
export function print(def: PrintDef): Mesh {
  const mat = asDecal(new MeshStandardMaterial({ transparent: true, roughness: 0.62, metalness: 0 }));
  const mesh = new Mesh(quadGeometry(def.quad), mat);
  mesh.name = `print:${def.name ?? ''}`;
  mesh.userData.bench3d = 'static';
  mesh.userData.print = true;
  mesh.renderOrder = 2;
  if (typeof document === 'undefined') return mesh; // node (unit tests): geometry only
  const hw = Math.hypot(...def.quad.u), hh = Math.hypot(...def.quad.v);
  const k = Math.min(def.ppm, MAX_PX / (2 * hw), MAX_PX / (2 * hh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(2 * hw * k));
  canvas.height = Math.max(2, Math.round(2 * hh * k));
  paint(canvas, def, k);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  mat.map = texture;
  live.push({ canvas, def, texture, k });
  // the page's fonts arrive after the first paint: draw the text again with them
  if (!fontsWatched && document.fonts) {
    fontsWatched = true;
    const again = () => {
      for (const p of live) {
        paint(p.canvas, p.def, p.k);
        p.texture.needsUpdate = true;
      }
      for (const l of redrawListeners) l();
    };
    void document.fonts.ready.then(again);
    document.fonts.addEventListener?.('loadingdone', again);
  }
  return mesh;
}
const redrawListeners = new Set<() => void>();
/** Called when prints were drawn again (fonts arrived), so an on-demand renderer can draw a frame. */
export function onPrintsRedrawn(l: () => void): () => void {
  redrawListeners.add(l);
  return () => redrawListeners.delete(l);
}

// ------------------------------------------------------------------------------------------------ drawing helpers
export const FONT = '"DM Sans", system-ui, sans-serif';
export const FONT_HEAD = '"Outfit", "DM Sans", system-ui, sans-serif';
export const FONT_MONO = '"DM Mono", ui-monospace, monospace';

type G = CanvasRenderingContext2D;

/** Starts a rounded rectangle path. */
export function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
/** Text centred on (x, y) by default. `size` is the cap height in millimetres, roughly. */
export function text(g: G, s: string, x: number, y: number, size: number, o: { weight?: number; font?: string; align?: CanvasTextAlign; spacing?: number; angle?: number } = {}): void {
  g.save();
  g.translate(x, y);
  if (o.angle) g.rotate(o.angle);
  g.font = `${o.weight ?? 600} ${size}px ${o.font ?? FONT}`;
  g.textAlign = o.align ?? 'center';
  g.textBaseline = 'middle';
  if (o.spacing) (g as unknown as { letterSpacing: string }).letterSpacing = `${o.spacing}px`;
  g.fillText(s, 0, 0);
  g.restore();
}
/** The contactless sign: `n` arcs opening towards `angle` (radians, 0 = to the right). Uses the stroke style. */
export function waves(g: G, x: number, y: number, r: number, n: number, angle: number, width: number): void {
  g.lineCap = 'round';
  g.lineWidth = width;
  for (let i = 1; i <= n; i++) {
    g.beginPath();
    g.arc(x, y, (r * i) / n, angle - 0.62, angle + 0.62);
    g.stroke();
  }
}
export function powerSign(g: G, x: number, y: number, r: number, width: number): void {
  g.lineCap = 'round';
  g.lineWidth = width;
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6 + Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(x, y - r * 1.15);
  g.lineTo(x, y - r * 0.2);
  g.stroke();
}
/** A lightning bolt of half height `s`. Uses the fill style. */
export function bolt(g: G, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x + 0.15 * s, y - s);
  g.lineTo(x - 0.55 * s, y + 0.12 * s);
  g.lineTo(x - 0.05 * s, y + 0.12 * s);
  g.lineTo(x - 0.2 * s, y + s);
  g.lineTo(x + 0.55 * s, y - 0.2 * s);
  g.lineTo(x + 0.05 * s, y - 0.2 * s);
  g.closePath();
  g.fill();
}
/**
 * A row of pin labels in silkscreen: `labels[i]` beside the pin at (x0 + i * pitch, y), reading along the row or,
 * with `vertical`, turned to read across it (the usual way next to a header).
 */
export function pinLabels(g: G, labels: readonly string[], x0: number, y: number, pitch: number, size: number, o: { vertical?: boolean; colour?: string; align?: CanvasTextAlign } = {}): void {
  g.fillStyle = o.colour ?? '#f4f1ea';
  labels.forEach((l, i) => text(g, l, x0 + i * pitch, y, size, { weight: 700, font: FONT_MONO, angle: o.vertical ? -Math.PI / 2 : 0, align: o.align ?? (o.vertical ? 'left' : 'center') }));
}
/** A silkscreen outline: the box drawn round a part on a board. */
export function silkBox(g: G, x: number, y: number, w: number, h: number, r = 0.4, width = 0.18, colour = '#f4f1ea'): void {
  g.strokeStyle = colour;
  g.lineWidth = width;
  rr(g, x, y, w, h, r);
  g.stroke();
}
