/**
 * The parts of a model that change: lamps (LEDs, indicator bars), screens (a picture drawn by code), and named
 * sub-groups that move. Plus what a host needs to put a model in a scene: `instantiate` and `disposeInstance`.
 *
 * A model's `build` makes a TEMPLATE. Nodes made here are marked "per instance": every copy gets its own material
 * (and canvas), so one router's lamp can be on while its neighbour's is off. Everything else is shared.
 */
import { AdditiveBlending, CanvasTexture, Color, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type BufferGeometry, type Material, type Object3D } from 'three';
import type { V3 } from '../device3d/meshBuilder';
import { asDecal } from '../device3d/decal';
import { quadGeometry, type Quad } from './print';
import type { Shape } from './shape';

let lens: BufferGeometry | null = null;
const LENS_OFF = 0x2a2a2c;

/**
 * A small lamp: an ellipsoid lens at `pos` with radii `size` (one number = a round dome). Off (dark lens) until
 * `setLamp` lights it. Use it for indicator LEDs and light bars; for an LED component with a moulded body, build the
 * body with a Shape and pass it to `glowing`.
 */
export function lamp(name: string, pos: V3, size: V3 | number): Mesh {
  lens ??= new IcosahedronGeometry(1, 1); // 80 triangles: a lamp is small on the table
  const m = new Mesh(lens, new MeshStandardMaterial({ color: LENS_OFF, roughness: 0.3, metalness: 0, emissive: new Color(0), emissiveIntensity: 0 }));
  m.name = name;
  m.position.set(...pos);
  if (typeof size === 'number') m.scale.setScalar(size);
  else m.scale.set(...size);
  m.userData.bench3d = 'lamp';
  m.userData.perInstance = true;
  return m;
}

/**
 * The leanest lamp: a flat lit patch (two triangles) for an SMD LED's top, a light window, a pixel of a matrix.
 * `quad` as for a print (`topQuad`, `frontQuad`). Driven by `setLamp` like any lamp.
 */
export function flatLamp(name: string, quad: Quad): Mesh {
  const m = new Mesh(quadGeometry(quad), asDecal(new MeshStandardMaterial({ color: LENS_OFF, roughness: 0.35, emissive: new Color(0), emissiveIntensity: 0 }), 0.2));
  m.name = name;
  m.userData.bench3d = 'lamp';
  m.userData.perInstance = true;
  return m;
}

let haloMap: CanvasTexture | null = null;
/**
 * The soft light a lamp throws on what is round it: a flat disc of radius `r` lying at `pos` (put it on the board
 * or the table under and round the LED), added to the picture. Invisible until `setLamp(obj, name, colour, level)`.
 */
export function halo(name: string, pos: V3, r: number): Mesh {
  if (!haloMap && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    haloMap = new CanvasTexture(c);
  }
  const mat = asDecal(new MeshBasicMaterial({ map: haloMap, transparent: true, blending: AdditiveBlending, toneMapped: false, opacity: 0 }), 0.25);
  const m = new Mesh(quadGeometry({ c: pos, u: [r, 0, 0], v: [0, 0, -r] }), mat);
  m.name = name;
  m.visible = false;
  m.renderOrder = 4;
  m.userData.bench3d = 'halo';
  m.userData.perInstance = true;
  return m;
}

/**
 * A moulded part that can glow as a whole (the dome of a 5 mm LED, a light pipe): the meshes of `shape` in a named
 * group, each with its own material per copy. Its colours are the unlit look; `setLamp` adds the light.
 */
export function glowing(name: string, shape: Shape): Object3D {
  const g = shape.toObject(name);
  g.userData.bench3d = 'lamp';
  for (const c of g.children) {
    const mesh = c as Mesh;
    mesh.material = (mesh.material as MeshStandardMaterial).clone();
    mesh.userData.bench3d = 'lamp-part';
    mesh.userData.perInstance = true;
  }
  return g;
}

/**
 * Lights a lamp of one copy: `colour` as 0xRRGGBB, `level` 0 (off) to 1 (full), above 1 for a glare (a burning LED).
 * No allocation.
 */
export function setLamp(obj: Object3D, name: string, colour: number, level = 1): void {
  const n = part(obj, name);
  if (!n) return;
  const key = level <= 0 ? -1 : colour * 64 + Math.round(Math.min(4, level) * 15);
  if (n.userData.lampKey === key) return;
  n.userData.lampKey = key;
  if (n.userData.bench3d === 'halo') {
    const hm = (n as Mesh).material as MeshBasicMaterial;
    n.visible = level > 0;
    hm.color.setHex(colour);
    hm.opacity = Math.min(1, level * 0.75);
    return;
  }
  const one = (mesh: Mesh, simple: boolean) => {
    const m = mesh.material as MeshStandardMaterial;
    m.emissive.setHex(level > 0 ? colour : 0);
    m.emissiveIntensity = level > 0 ? 0.35 + level * 1.3 : 0;
    if (simple) m.color.setHex(level > 0 ? colour : LENS_OFF).multiplyScalar(level > 0 ? 0.35 : 1);
    else if (m.transparent) {
      // clear resin fills with light: the brighter, the less one sees through it
      const base = (m.userData.baseOpacity ??= m.opacity) as number;
      m.opacity = base + (1 - base) * Math.min(1, level) * 0.92;
    }
  };
  if ((n as Mesh).isMesh) one(n as Mesh, true);
  else for (const c of n.children) if ((c as Mesh).isMesh) one(c as Mesh, false);
}

/**
 * A surface whose picture is drawn by code for each copy: a display, a TV, a label with a gauge. `lit` screens shine
 * by themselves (not tone-mapped, like the Dot's own); unlit ones are print that changes.
 */
export function screen(name: string, quad: Quad, ppm: number, o: { lit?: boolean } = {}): Mesh {
  const lit = o.lit !== false;
  const mat: Material = lit ? new MeshBasicMaterial({ toneMapped: false, color: 0x050506 }) : asDecal(new MeshStandardMaterial({ transparent: true, roughness: 0.6 }));
  const m = new Mesh(quadGeometry(quad), mat);
  m.name = name;
  m.renderOrder = 2;
  m.userData.bench3d = 'screen';
  m.userData.perInstance = true;
  m.userData.screen = { w: Math.max(2, Math.round(2 * Math.hypot(...quad.u) * ppm)), h: Math.max(2, Math.round(2 * Math.hypot(...quad.v) * ppm)), lit };
  return m;
}

/**
 * Draws a screen of one copy, only when `key` differs from the last draw (so calling it every frame is free).
 * `draw` gets the canvas in pixels: (g, width, height).
 */
export function drawScreen(obj: Object3D, name: string, key: string | number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
  const n = part(obj, name) as Mesh | undefined;
  if (!n || n.userData.screenKey === key) return;
  n.userData.screenKey = key;
  const canvas = n.userData.canvas as HTMLCanvasElement | undefined;
  if (!canvas) return;
  const g = canvas.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  draw(g, canvas.width, canvas.height);
  (n.userData.texture as CanvasTexture).needsUpdate = true;
}

/** A named node of one copy (cached on the copy: a look-up costs nothing after the first). */
export function part(obj: Object3D, name: string): Object3D | undefined {
  let map = obj.userData.parts as Map<string, Object3D | undefined> | undefined;
  if (!map) obj.userData.parts = map = new Map();
  if (!map.has(name)) map.set(name, obj.getObjectByName(name));
  return map.get(name);
}

/** True for the meshes the Workbench may draw as instances: the static body and the prints directly under the root. */
export const isStatic = (o: Object3D, root: Object3D): boolean => o.userData.bench3d === 'static' && (o.parent === root || (o.parent?.parent === root && o.parent.name === '' && o.parent.userData.bench3d === undefined));

/**
 * One copy of a model for a scene. Geometry and shared materials are reused; lamps and screens get their own.
 * `dynamicOnly` leaves the static body out (the host draws it as instances).
 */
export function instantiate(template: Object3D, o: { dynamicOnly?: boolean } = {}): Object3D {
  const copy = template.clone(true);
  copy.userData = { ...template.userData, parts: undefined };
  const drop: Object3D[] = [];
  copy.traverse((n) => {
    if (o.dynamicOnly && isStatic(n, copy)) drop.push(n);
    if (!n.userData.perInstance) return;
    n.userData = { ...n.userData };
    const mesh = n as Mesh;
    mesh.material = (mesh.material as Material).clone();
    const sc = n.userData.screen as { w: number; h: number; lit: boolean } | undefined;
    if (sc && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = sc.w;
      canvas.height = sc.h;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      (mesh.material as MeshBasicMaterial).map = texture;
      if (sc.lit) (mesh.material as MeshBasicMaterial).color.setHex(0xffffff);
      n.userData.canvas = canvas;
      n.userData.texture = texture;
      n.userData.screenKey = undefined;
    }
    n.userData.lampKey = undefined;
  });
  for (const n of drop) n.parent?.remove(n);
  return copy;
}

/** Frees what `instantiate` made for one copy (not the shared geometry and materials). */
export function disposeInstance(obj: Object3D): void {
  obj.traverse((n) => {
    if (!n.userData.perInstance) return;
    ((n as Mesh).material as Material).dispose();
    (n.userData.texture as CanvasTexture | undefined)?.dispose();
  });
}

export function countTriangles(obj: Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const g = (o as Mesh).geometry as BufferGeometry | undefined;
    if ((o as Mesh).isMesh && g) n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return Math.round(n);
}
