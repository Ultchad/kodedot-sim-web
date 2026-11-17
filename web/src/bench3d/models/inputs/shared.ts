/**
 * Shared by the inputs family (push button, slide switch, potentiometer, buzzer, HDC1080 breakout, antenna): the
 * manifest as the models read it, small builders, and the helpers of `animate` (no allocation in any of them).
 */
import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, type BufferGeometry } from 'three';
import { PAL, place, type Finish, type ManifestBody, type ManifestPin, type Shape } from '../../index';

/** What these models read of parts/<id>/manifest.json (the JSON import is cast to this once per model). */
export interface PartManifest {
  id: string;
  name: { en: string };
  body: ManifestBody;
  pins: ManifestPin[];
  fields?: { name: string; type: string; default?: string | number | boolean; min?: number; max?: number; step?: number; unit?: string; values?: { value: string | number; label?: { en?: string } }[] }[];
  controls?: { field: string; mode: string }[];
  visuals?: { id: string; effect: string; source?: { field?: string; output?: string }; scale?: { in: number[]; out: number[] } }[];
  outputs?: { name: string; min?: number; max?: number }[];
  behaviour?: { elements?: Record<string, unknown>[] };
}
export const asManifest = (json: unknown): PartManifest => json as PartManifest;
export const fieldDefault = (m: PartManifest, name: string): string | number | boolean | undefined => m.fields?.find((f) => f.name === name)?.default;

// ------------------------------------------------------------------------------------------------------- animate
/** `cur` moved towards `target` by at most `rate` (units per second) times `dt`. */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  const d = target - cur, step = rate * Math.max(dt, 0);
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------------------------------------------ builders
/**
 * A stamped flat leg at (x, z) going down into the board: a wide shoulder from `y1` down to `neck`, then the pin down
 * to `y0`. `turn` 0 has its flat faces looking along Z (wide along X); 1 turns it a quarter.
 */
export function flatLeg(s: Shape, o: { x: number; z: number; y0: number; y1: number; neck?: number; w?: number; shoulder?: number; t?: number; turn?: number; finish?: Finish }): void {
  const w = o.w ?? 0.6, t = o.t ?? 0.3, sh = o.shoulder ?? w, fin = o.finish ?? PAL.tin;
  s.with(place(o.x, 0, o.z, o.turn), () => {
    const neck = o.neck ?? o.y1;
    if (sh > w && neck < o.y1) s.box(...fin, 0, 0, sh, t, neck - 0.01, o.y1, 0.04, Math.min(0.12, sh / 4), { cap: true, ao: 0.95 });
    s.box(...fin, 0, 0, w, t, o.y0, sh > w ? neck : o.y1, 0.04, 0, { cap: true, ao: 0.92 });
  });
}

/** A two-terminal chip part lying on a board (0603 resistor, capacitor, LED base): tinned ends, a body between them. Long along X before `turn`. */
export function chip2(s: Shape, o: { x: number; z: number; y: number; l?: number; w?: number; h?: number; turn?: number; body?: Finish; stripe?: string }): void {
  const l = o.l ?? 1.6, w = o.w ?? 0.8, h = o.h ?? 0.45, end = Math.min(0.35, l * 0.22);
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...(o.body ?? PAL.epoxyBlack), 0, 0, l - end * 2 + 0.02, w, 0.02, h, 0, 0.05, { ao: 1 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (l / 2 - end / 2), 0, end, w + 0.04, 0, h + 0.02, 0.03, 0.06, { ao: 1 });
    if (o.stripe) s.box('matte', o.stripe, 0, 0, (l - end * 2) * 0.55, w * 0.5, h, h + 0.012, 0, 0, { ao: 1 });
  });
}

let ringGeo: BufferGeometry | null = null;
/**
 * A sound wave: a thin flat ring of unit radius, lying level, invisible until `animate` shows it (scale = radius in
 * millimetres, material opacity = strength). Each copy of the model gets its own material, like a lamp.
 */
export function waveRing(name: string, colour: number, seg = 28): Mesh {
  ringGeo ??= new RingGeometry(0.87, 1, seg, 1).rotateX(-Math.PI / 2);
  const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide }));
  m.name = name;
  m.visible = false;
  m.renderOrder = 4;
  m.userData.bench3d = 'wave';
  m.userData.perInstance = true;
  return m;
}
/** Shows a wave ring of one copy at height `y`, radius `r`, strength 0..1 (0 hides it). */
export function setWave(ring: Mesh, y: number, r: number, strength: number): void {
  ring.visible = strength > 0.004;
  if (!ring.visible) return;
  ring.position.y = y;
  ring.scale.set(r, 1, r);
  (ring.material as MeshBasicMaterial).opacity = strength;
}
