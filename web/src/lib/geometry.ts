/**
 * Device geometry. Every number comes from public/device/kode-dot.json (render
 * of the real device, see public/device/NOTICE.md); the only literals here are
 * the three ESTIMATES that the data does not contain, each named as such.
 */
import specJson from '../../public/device/kode-dot.json';
import type { ButtonId } from '../device/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../device/types';

export type DeviceSpec = typeof specJson;
export const SPEC: DeviceSpec = specJson;

/** ESTIMATE: thickness is not in the data. Used only for the 3D body depth. */
export const DEVICE_THICKNESS_MM_ESTIMATE = 12;
/** ESTIMATE measured by eye on the render's alpha edge (about 48 px at 12.39 px/mm). */
export const BODY_CORNER_RADIUS_MM_ESTIMATE = 4.0;
/** ESTIMATE from the render: coloured cap diameter / outer ring diameter (the JSON gives the ring). */
export const CAP_TO_RING_RATIO_ESTIMATE = 0.64;
/** Minimum comfortable touch target, CSS px. */
export const MIN_HIT_PX = 44;

export interface Vec2 {
  x: number;
  y: number;
}

export function metrics(spec: DeviceSpec = SPEC) {
  const ppm = spec.px_per_mm;
  const imgW = spec.size_px[0];
  const imgH = spec.size_px[1];
  const bx0 = spec.body_px.x[0];
  const bx1 = spec.body_px.x[1] + 1; // inclusive pixel index -> edge
  const by0 = spec.body_px.y[0];
  const by1 = spec.body_px.y[1] + 1;
  const bodyPx = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
  const centre = { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 };

  /** Image pixel -> mm relative to the body centre (X right, Y up). */
  const pxToMm = (px: number, py: number): Vec2 => ({ x: (px - centre.x) / ppm, y: -(py - centre.y) / ppm });
  /** Inverse of pxToMm. */
  const mmToPx = (x: number, y: number): Vec2 => ({ x: centre.x + x * ppm, y: centre.y - y * ppm });

  const s = spec.screen_px;
  const screenCentre = pxToMm(s.x + s.w / 2, s.y + s.h / 2);
  const dp = spec.dpad_px;
  const led = spec.led_guide_px;
  const ledCx = (led.x[0] + led.x[1] + 1) / 2;
  const ledCy = (led.y[0] + led.y[1] + 1) / 2;

  return {
    ppm,
    imgW,
    imgH,
    bodyPx,
    bodyMm: { w: bodyPx.w / ppm, h: bodyPx.h / ppm },
    centre,
    pxToMm,
    mmToPx,
    screenPx: { x: s.x, y: s.y, w: s.w, h: s.h },
    screenMm: { cx: screenCentre.x, cy: screenCentre.y, w: s.w / ppm, h: s.h / ppm, r: s.corner_r_mm },
    buttons: {
      top: { ...spec.top_px, mm: pxToMm(spec.top_px.cx, spec.top_px.cy) },
      bottom: { ...spec.bot_px, mm: pxToMm(spec.bot_px.cx, spec.bot_px.cy) },
    },
    dpad: { ...dp, mm: pxToMm(dp.cx, dp.cy) },
    led: { cx: ledCx, cy: ledCy, w: led.x[1] - led.x[0] + 1, h: led.y[1] - led.y[0] + 1, mm: pxToMm(ledCx, ledCy) },
  };
}
export type Metrics = ReturnType<typeof metrics>;

/** UV (origin bottom-left, v up) on the glass -> integer screen pixel (origin top-left). */
export function uvToScreen(u: number, v: number, w = SCREEN_WIDTH, h = SCREEN_HEIGHT): Vec2 {
  const clamp = (n: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(n)));
  return { x: clamp(u * w, w), y: clamp((1 - v) * h, h) };
}

/** Screen pixel centre -> UV. */
export function screenToUv(x: number, y: number, w = SCREEN_WIDTH, h = SCREEN_HEIGHT): Vec2 {
  return { x: (x + 0.5) / w, y: 1 - (y + 0.5) / h };
}

/** Smallest size (in device px) so that it is at least `min` CSS px at the given scale. */
export function inflate(sizePx: number, scale: number, min = MIN_HIT_PX): number {
  return Math.max(sizePx, min / scale);
}

/**
 * Which D-pad arm is under a point, given offsets from the pad centre in px
 * (y down). Points outside the cross return null. `armW` may be inflated for touch.
 */
export function dpadDirection(dx: number, dy: number, span: number, armW: number): Extract<ButtonId, 'up' | 'down' | 'left' | 'right'> | null {
  const half = span / 2;
  const hw = armW / 2;
  if (Math.abs(dx) > half || Math.abs(dy) > half) return null;
  if (Math.abs(dx) > hw && Math.abs(dy) > hw) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
