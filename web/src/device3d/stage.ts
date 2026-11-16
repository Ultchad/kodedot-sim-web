/**
 * Staging maths that needs no WebGL: where the soft ground shadow goes for a
 * given orientation of the device.
 */
import type { BodyDims } from '../lib/bodyModel';

export interface Footprint {
  /** centre of the shadow on the ground plane */
  x: number;
  z: number;
  /** half extents along the shadow's own axes, and the rotation of those axes about +Y */
  a: number;
  b: number;
  angle: number;
  /** lowest point of the body (world y) */
  lowest: number;
}

/**
 * Projects the body's bounding box straight down. `m` is a column-major 4x4
 * (three's Matrix4.elements) holding the model's rotation and position.
 */
export function footprint(m: ArrayLike<number>, d: BodyDims): Footprint {
  const xs: number[] = [], zs: number[] = [];
  let lowest = Infinity;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * d.hw, y = sy * d.hh, z = (sz * d.depth) / 2;
        xs.push(m[0] * x + m[4] * y + m[8] * z + m[12]);
        zs.push(m[2] * x + m[6] * y + m[10] * z + m[14]);
        lowest = Math.min(lowest, m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
  const cx = xs.reduce((s, v) => s + v, 0) / 8;
  const cz = zs.reduce((s, v) => s + v, 0) / 8;
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < 8; i++) {
    sxx += (xs[i] - cx) ** 2;
    szz += (zs[i] - cz) ** 2;
    sxz += (xs[i] - cx) * (zs[i] - cz);
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz); // principal axis, measured from +X towards +Z
  const c = Math.cos(angle), s = Math.sin(angle);
  let a = 0, b = 0;
  for (let i = 0; i < 8; i++) {
    a = Math.max(a, Math.abs((xs[i] - cx) * c + (zs[i] - cz) * s));
    b = Math.max(b, Math.abs(-(xs[i] - cx) * s + (zs[i] - cz) * c));
  }
  return { x: cx, z: cz, a, b, angle, lowest };
}
