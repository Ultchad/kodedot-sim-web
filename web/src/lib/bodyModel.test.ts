import { describe, expect, it } from 'vitest';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../device/types';
import { SPEC, metrics } from './geometry';
import {
  BODY_CORNER_R_MM,
  BUTTON_PROUD_MM_ESTIMATE,
  DEPTH_MM_ESTIMATE,
  REAR_SLOPE_BOTTOM_ESTIMATE,
  REAR_SLOPE_TOP_ESTIMATE,
  backProfile,
  bodyDims,
  buttonHitRadius,
  controlCentre,
  crossDistance,
  crossLoop,
  dpadHit,
  glassMmToScreen,
  loopArea,
  loopBounds,
  pointInLoop,
  roundedRectLoop,
  screenToGlassMm,
} from './bodyModel';

const m = metrics(SPEC);
const d = bodyDims(m);
const ppm = SPEC.px_per_mm;

describe('dimensions (mm <-> px)', () => {
  it('body is the data: 46.65 x 77.0 mm, with the estimated depth', () => {
    expect(d.hw * 2).toBeCloseTo(578 / ppm, 6);
    expect(d.hh * 2).toBeCloseTo(954 / ppm, 6);
    expect(d.depth).toBe(DEPTH_MM_ESTIMATE);
    expect(d.zf).toBeCloseTo(-d.zb, 9);
    expect(d.depth).toBeGreaterThan(18);
    expect(d.depth).toBeLessThan(21);
  });
  it('lit picture is 410 x 502 px of the render; the black glass is wider all round', () => {
    expect(d.screen.w * ppm).toBeCloseTo(410, 6);
    expect(d.screen.h * ppm).toBeCloseTo(502, 6);
    // measured on the render: glass spans px 59..543 horizontally and 59..643 vertically
    const left = m.mmToPx(d.bezel.cx - d.bezel.w / 2, 0).x;
    const right = m.mmToPx(d.bezel.cx + d.bezel.w / 2, 0).x;
    const top = m.mmToPx(0, d.bezel.cy + d.bezel.h / 2).y;
    const bottom = m.mmToPx(0, d.bezel.cy - d.bezel.h / 2).y;
    expect(left).toBeCloseTo(59, 0);
    expect(right).toBeCloseTo(543, 0);
    expect(top).toBeCloseTo(59, 0);
    expect(bottom).toBeCloseTo(643, 0);
    expect(d.bezel.w - d.screen.w).toBeGreaterThan(5); // clearly wider than the picture
  });
  it('buttons: 119 px bodies at the JSON centres; the blue inlay is larger than the red one', () => {
    for (const id of ['top', 'bottom'] as const) {
      const b = d.buttons[id];
      const spec = id === 'top' ? SPEC.top_px : SPEC.bot_px;
      const px = m.mmToPx(b.x, b.y);
      expect(px.x).toBeCloseTo(spec.cx, 6);
      expect(px.y).toBeCloseTo(spec.cy, 6);
      expect(b.r * 2 * ppm).toBeCloseTo(119, 6);
      expect(b.colour).toBe(spec.colour);
    }
    expect(d.buttons.top.capR).toBeGreaterThan(d.buttons.bottom.capR * 1.5);
    expect(d.buttons.top.capR).toBeLessThan(d.buttons.top.r);
  });
  it('d-pad cross: 254 px span, 74 px arms, at the JSON centre', () => {
    expect(d.dpad.half * 2 * ppm).toBeCloseTo(254, 6);
    expect(d.dpad.armHalf * 2 * ppm).toBeCloseTo(74, 6);
    const loop = crossLoop(d.dpad.half, d.dpad.armHalf, d.dpad.innerR, 0, 12, 4);
    const bb = loopBounds(loop);
    expect(bb.x1 - bb.x0).toBeCloseTo(d.dpad.half * 2, 6);
    expect(bb.y1 - bb.y0).toBeCloseTo(d.dpad.half * 2, 6);
    expect(loopArea(loop)).toBeGreaterThan(0); // counter-clockwise
    expect(pointInLoop(loop, d.dpad.half - 1, 0)).toBe(true);
    expect(pointInLoop(loop, d.dpad.half - 2, d.dpad.half - 2)).toBe(false);
  });
  it('light guide and lanyard hole fill their JSON boxes, 2 mm clear of the outline', () => {
    const box = (b: { x: number[]; y: number[] }) => ({ x0: b.x[0], x1: b.x[1] + 1, y0: b.y[0], y1: b.y[1] + 1 });
    for (const [piece, spec] of [[d.led, SPEC.led_guide_px], [d.lanyard, SPEC.lanyard_hole_px]] as const) {
      const b = box(spec);
      const a = m.mmToPx(piece.bounds.x0, piece.bounds.y1);
      const c = m.mmToPx(piece.bounds.x1, piece.bounds.y0);
      expect(a.x).toBeCloseTo(b.x0, 0);
      expect(a.y).toBeCloseTo(b.y0, 0);
      expect(c.x).toBeCloseTo(b.x1, 0);
      expect(c.y).toBeCloseTo(b.y1, 0);
      expect(loopArea(piece.loop)).toBeGreaterThan(0);
    }
    // top-right and bottom-left
    expect(d.led.bounds.x1).toBeGreaterThan(d.hw - 2.2);
    expect(d.led.bounds.y1).toBeGreaterThan(d.hh - 2.2);
    expect(d.led.bounds.x1).toBeLessThan(d.hw - d.frontFillet);
    expect(d.lanyard.bounds.x0).toBeLessThan(-d.hw + 2.2);
    expect(d.lanyard.bounds.y0).toBeGreaterThan(-d.hh + d.frontFillet);
    // the hypotenuse faces the centre: the box corner nearest the centre is outside the piece
    expect(pointInLoop(d.led.loop, d.led.bounds.x0 + 0.3, d.led.bounds.y0 + 0.3)).toBe(false);
    expect(pointInLoop(d.led.loop, d.led.bounds.x1 - 1, d.led.bounds.y1 - 1)).toBe(true);
  });
  it('rounded rectangle helper keeps size, radius and winding', () => {
    const loop = roundedRectLoop(1, 2, 10, 6, 2, 8);
    const bb = loopBounds(loop);
    expect([bb.x0, bb.x1, bb.y0, bb.y1].map((v) => +v.toFixed(6))).toEqual([-4, 6, -1, 5]);
    expect(loopArea(loop)).toBeGreaterThan(60 - (4 - Math.PI) * 4 - 0.2);
    expect(loopArea(loop)).toBeLessThan(60);
    expect(BODY_CORNER_R_MM).toBeGreaterThan(4);
  });
});

describe('back profile (the taper)', () => {
  const p = backProfile(d);
  it('is the flat plate in the middle', () => {
    expect(p.z(0)).toBeCloseTo(d.zb, 9);
    expect(p.slope(0)).toBe(0);
  });
  it('rises towards the front at the bottom and, less, at the top', () => {
    expect(p.z(-d.hh) - d.zb).toBeCloseTo(REAR_SLOPE_BOTTOM_ESTIMATE.depth, 6);
    expect(p.z(d.hh) - d.zb).toBeCloseTo(REAR_SLOPE_TOP_ESTIMATE.depth, 6);
    expect(p.slope(-d.hh + 1)).toBeLessThan(0);
    expect(p.slope(d.hh - 1)).toBeGreaterThan(0);
  });
  it('is continuous and tangent-continuous across the softened creases', () => {
    let prevZ = p.z(-d.hh), prevS = p.slope(-d.hh);
    for (let y = -d.hh + 0.01; y <= d.hh; y += 0.01) {
      const z = p.z(y), s = p.slope(y);
      expect(Math.abs(z - prevZ)).toBeLessThan(0.006);
      expect(Math.abs(s - prevS)).toBeLessThan(0.003);
      // numeric derivative agrees
      expect((p.z(y + 1e-4) - p.z(y - 1e-4)) / 2e-4).toBeCloseTo(s, 3);
      prevZ = z;
      prevS = s;
    }
  });
  it('breaks are ascending and inside the straight part of the side walls', () => {
    for (let i = 1; i < p.breaks.length; i++) expect(p.breaks[i]).toBeGreaterThan(p.breaks[i - 1]);
    expect(p.breaks[0]).toBeGreaterThan(-(d.hh - d.cornerR));
    expect(p.breaks[p.breaks.length - 1]).toBeLessThan(d.hh - d.cornerR);
  });
});

describe('glass point -> screen pixel', () => {
  it('maps the corners and the centre of the lit picture', () => {
    expect(glassMmToScreen(-d.screen.w / 2 + 1e-6, d.screen.h / 2 - 1e-6, d)).toEqual({ x: 0, y: 0 });
    expect(glassMmToScreen(d.screen.w / 2 - 1e-6, -d.screen.h / 2 + 1e-6, d)).toEqual({ x: SCREEN_WIDTH - 1, y: SCREEN_HEIGHT - 1 });
    expect(glassMmToScreen(0, 0, d)).toEqual({ x: 205, y: 251 });
  });
  it('round-trips every pixel centre exactly', () => {
    for (let y = 0; y < SCREEN_HEIGHT; y += 7)
      for (let x = 0; x < SCREEN_WIDTH; x += 7) {
        const q = screenToGlassMm(x, y, d);
        expect(glassMmToScreen(q.x, q.y, d)).toEqual({ x, y });
      }
  });
  it('one pixel is 1 / 12.39 mm, so a 0.1 mm error stays within 2 px', () => {
    const q = screenToGlassMm(100, 200, d);
    for (const [ex, ey] of [[0.1, 0], [-0.1, 0.1], [0, -0.1]]) {
      const s = glassMmToScreen(q.x + ex, q.y + ey, d);
      expect(Math.abs(s.x - 100)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.y - 200)).toBeLessThanOrEqual(2);
    }
  });
  it('clamps outside the picture (a drag may leave the glass)', () => {
    expect(glassMmToScreen(-100, 100, d)).toEqual({ x: 0, y: 0 });
    expect(glassMmToScreen(100, -100, d)).toEqual({ x: SCREEN_WIDTH - 1, y: SCREEN_HEIGHT - 1 });
  });
});

describe('hit targets', () => {
  it('button targets are larger than the buttons and do not overlap each other', () => {
    const rt = buttonHitRadius('top', d), rb = buttonHitRadius('bottom', d);
    expect(rt).toBeGreaterThan(d.buttons.top.r + 0.8);
    expect(rb).toBeGreaterThan(d.buttons.bottom.r + 0.8);
    const gap = Math.hypot(d.buttons.top.x - d.buttons.bottom.x, d.buttons.top.y - d.buttons.bottom.y);
    expect(rt + rb).toBeLessThan(gap);
  });
  it('d-pad: each arm answers, also a little outside the cross; the far corners do not', () => {
    const k = d.dpad.half * 0.7;
    expect(dpadHit(0, k, d)).toBe('up');
    expect(dpadHit(0, -k, d)).toBe('down');
    expect(dpadHit(-k, 0, d)).toBe('left');
    expect(dpadHit(k, 0, d)).toBe('right');
    expect(dpadHit(d.dpad.half + 1, 0, d)).toBe('right'); // generous
    expect(dpadHit(k, d.dpad.armHalf + 1, d)).toBe('right');
    expect(dpadHit(d.dpad.half + 2, 0, d)).toBeNull();
    expect(dpadHit(d.dpad.half - 1, d.dpad.half - 1, d)).toBeNull();
  });
  it('d-pad target never reaches a round button', () => {
    for (const id of ['top', 'bottom'] as const) {
      const b = d.buttons[id];
      for (let a = 0; a < 360; a += 5) {
        const x = b.x + b.r * Math.cos((a * Math.PI) / 180) - d.dpad.x;
        const y = b.y + b.r * Math.sin((a * Math.PI) / 180) - d.dpad.y;
        expect(dpadHit(x, y, d)).toBeNull();
      }
    }
  });
  it('crossDistance is negative inside, zero on the edge, positive outside', () => {
    const { half, armHalf } = d.dpad;
    expect(crossDistance(0, 0, half, armHalf)).toBeCloseTo(-armHalf, 9);
    expect(crossDistance(half, 0, half, armHalf)).toBeCloseTo(0, 9);
    expect(crossDistance(half + 1, 0, half, armHalf)).toBeCloseTo(1, 9);
    expect(crossDistance(half - 2, half - 2, half, armHalf)).toBeGreaterThan(0);
  });
  it('control centres sit on the controls, proud of the front face', () => {
    expect(controlCentre('top', d).slice(0, 2)).toEqual([d.buttons.top.x, d.buttons.top.y]);
    expect(controlCentre('top', d)[2]).toBeGreaterThan(d.zf);
    expect(controlCentre('top', d)[2]).toBeLessThanOrEqual(d.zf + BUTTON_PROUD_MM_ESTIMATE);
    for (const id of ['up', 'down', 'left', 'right'] as const) {
      const c = controlCentre(id, d);
      expect(dpadHit(c[0] - d.dpad.x, c[1] - d.dpad.y, d)).toBe(id);
      expect(crossDistance(c[0] - d.dpad.x, c[1] - d.dpad.y, d.dpad.half, d.dpad.armHalf)).toBeLessThan(-1);
    }
  });
});
