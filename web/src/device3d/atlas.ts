/**
 * UV layout of the body, shared by the mesh (which writes UVs) and the
 * occlusion painter (which draws into the same places). Everything is laid out
 * in millimetres on a square sheet, so no island is stretched:
 *
 *   front island   the front face with its fillet rolled flat around it
 *   back island    the back (mirrored, as seen from behind) with its fillet
 *   wall islands   four strips, one per side wall plus the corner after it,
 *                  u = distance along the outline, v = depth
 */
import { BODY_CORNER_R_MM, DEPTH_MM_ESTIMATE, type BodyDims } from '../lib/bodyModel';
import type { V2 } from './meshBuilder';

export const ATLAS_MM = 128;
const PAD = 1.2;
const FRONT = { x: 1, y: 1 };
const BACK = { x: 52, y: 1 };
const WALL_ROWS = [82, 104];
const WALL_X = [1, 78];

export type WallSide = 0 | 1 | 2 | 3; // right, top, left, bottom (counter-clockwise seen from the front)

const n = (x: number, y: number): V2 => [x / ATLAS_MM, y / ATLAS_MM];

export function uvFront(d: BodyDims, x: number, y: number): V2 {
  return n(FRONT.x + PAD + x + d.hw, FRONT.y + PAD + y + d.hh);
}
/** Mirrored in x: the island reads the right way round when looking at the back. */
export function uvBack(d: BodyDims, x: number, y: number): V2 {
  return n(BACK.x + PAD + d.hw - x, BACK.y + PAD + y + d.hh);
}
/** `along` = distance from the start of the island (the start of the straight side), `z` in the body frame. */
export function uvWall(side: WallSide, along: number, z: number): V2 {
  return n(WALL_X[side % 2] + along, WALL_ROWS[side < 2 ? 0 : 1] + z + DEPTH_MM_ESTIMATE / 2);
}
/** Distance along the wall island for a point on the straight part of a side, given its in-plane coordinate t (y for left/right, x for top/bottom). */
export function wallAlong(d: BodyDims, side: WallSide, t: number): number {
  const R = BODY_CORNER_R_MM;
  if (side === 0) return t + (d.hh - R);
  if (side === 1) return d.hw - R - t;
  if (side === 2) return d.hh - R - t;
  return t + (d.hw - R);
}
