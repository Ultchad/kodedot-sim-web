/**
 * Textures generated in code (nothing is downloaded, nothing is copied from
 * the reference pictures):
 *   - the occlusion sheet: soft dark halos where parts meet the body, painted
 *     into the body's UV atlas (device3d/atlas.ts);
 *   - a fine tiling grain (normal map) for the moulded matte plastic;
 *   - the blob used for the ground shadow.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { roundedRectLoop, type BodyDims, type Pt } from '../lib/bodyModel';
import { ATLAS_MM, uvBack, uvFront, uvWall, wallAlong, type WallSide } from './atlas';
import { backOpenings, frontOpenings, wallOpenings } from './features';
import type { V2 } from './meshBuilder';

const AO_SIZE = 1024;
const AO_INK = '86, 72, 60';
/** ESTIMATE (reference picture of the back): the back cover's outline runs about this far inside the body outline. */
export const BACK_SEAM_INSET_MM = 2.45;

export function makeOcclusionTexture(d: BodyDims): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = AO_SIZE;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, AO_SIZE, AO_SIZE);
  const pxPerMm = AO_SIZE / ATLAS_MM;
  const OFF = AO_SIZE * 3;
  /**
   * Only the blurred shadow of the loop lands on the sheet (the loop itself is
   * drawn off-canvas). `fill`: the whole footprint darkens (a part stands
   * there); otherwise only a band along the edge (the rim of a shallow recess).
   */
  const halo = (loop: Pt[], map: (a: number, b: number) => V2, blurMm: number, alpha: number, fill = true, lineMm = 0.25) => {
    g.save();
    g.shadowColor = `rgba(${AO_INK}, ${alpha})`;
    g.shadowBlur = blurMm * pxPerMm;
    g.shadowOffsetX = OFF;
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.lineWidth = lineMm * pxPerMm;
    g.beginPath();
    loop.forEach(([a, b], i) => {
      const [u, v] = map(a, b);
      const x = u * AO_SIZE - OFF, y = (1 - v) * AO_SIZE;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
    if (fill) g.fill();
    else g.stroke();
    g.restore();
  };
  const front = (a: number, b: number) => uvFront(d, a, b);
  const back = (a: number, b: number) => uvBack(d, a, b);
  const wall = (side: WallSide) => (t: number, z: number) => uvWall(side, wallAlong(d, side, t), z);

  // where a part stands in the body: wide soft contact shadow plus a tight dark seam
  const f = frontOpenings(d);
  for (const r of [f.dpad, f.top, f.bottom]) {
    halo(r.loop, front, 2.2, 0.5);
    halo(r.loop, front, 0.7, 0.55);
  }
  halo(f.bezel.loop, front, 0.8, 0.5, false, 0.3);
  halo(f.led.loop, front, 0.45, 0.4, false, 0.2);
  halo(d.lanyard.loop, front, 0.7, 0.45, false, 0.3);
  const w = wallOpenings(d);
  halo(w.windowRecess.loop, wall(0), 0.6, 0.5, false, 0.3);
  for (const r of w.connector) halo(r.loop, wall(1), 0.3, 0.4, false, 0.15);
  for (const r of w.grille) halo(r.loop, wall(2), 0.35, 0.3, false, 0.15);
  halo(w.slot.loop, wall(2), 0.4, 0.3, false, 0.2);
  const b = backOpenings();
  halo(b.deboss.loop, back, 0.5, 0.3, false, 0.2);
  halo(b.pogo.loop, back, 0.6, 0.35, false, 0.25);
  halo(b.screw.loop, back, 0.6, 0.45, false, 0.3);
  halo(d.lanyard.loop, back, 0.7, 0.45, false, 0.3);
  // the hairline where the back cover meets the shell: it follows the outline, just inside the rear fillet
  halo(roundedRectLoop(0, 0, 2 * (d.hw - BACK_SEAM_INSET_MM), 2 * (d.hh - BACK_SEAM_INSET_MM), Math.max(0.5, d.cornerR - BACK_SEAM_INSET_MM), 8), back, 0.28, 0.5, false, 0.16);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Tiling normal map of a fine, shallow grain. `tileMm` is the size of one tile on the body. */
export function makeGrainNormalMap(tileMm = 7, size = 256, seed = 7): CanvasTexture {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = rnd();
  // one wrapped 3x3 blur: grain of about two texels
  const b = new Float32Array(size * size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v += at(x + i, y + j) * (i === 0 && j === 0 ? 4 : i === 0 || j === 0 ? 2 : 1);
      b[y * size + x] = v / 16;
    }
  const bt = (x: number, y: number) => b[((y + size) % size) * size + ((x + size) % size)];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const k = 2.2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (bt(x + 1, y) - bt(x - 1, y)) * k;
      const dy = (bt(x, y + 1) - bt(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      img.data[o] = Math.round((-dx / l) * 127.5 + 127.5);
      img.data[o + 1] = Math.round((dy / l) * 127.5 + 127.5);
      img.data[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(ATLAS_MM / tileMm, ATLAS_MM / tileMm);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Soft rounded blob, darkest in the middle, fully transparent at the edge. */
export function makeShadowTexture(size = 256): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const OFF = size * 3;
  g.shadowColor = 'rgba(58, 42, 30, 1)';
  g.shadowBlur = size * 0.17;
  g.shadowOffsetX = OFF;
  g.fillStyle = '#000';
  g.beginPath();
  g.roundRect(size * 0.26 - OFF, size * 0.26, size * 0.48, size * 0.48, size * 0.12);
  g.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
