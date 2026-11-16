import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../device/types';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a pointer position (client coordinates) over a rect that displays the
 * screen to integer screen pixels, clamped to the panel. `inside` tells whether
 * the pointer was really over the rect (a captured drag can leave it).
 */
export function pointerToScreen(
  clientX: number,
  clientY: number,
  rect: RectLike,
  width = SCREEN_WIDTH,
  height = SCREEN_HEIGHT,
): { x: number; y: number; inside: boolean } {
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v)));
  return {
    x: clamp(fx * width, width),
    y: clamp(fy * height, height),
    inside: rect.width > 0 && rect.height > 0 && fx >= 0 && fx < 1 && fy >= 0 && fy < 1,
  };
}
