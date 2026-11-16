import { describe, expect, it } from 'vitest';
import { SPEC, dpadDirection, inflate, metrics, screenToUv, uvToScreen } from './geometry';

const m = metrics(SPEC);

describe('mm/px mapping', () => {
  it('body is about 46.7 x 77.0 mm', () => {
    expect(m.bodyMm.w).toBeCloseTo(46.65, 1);
    expect(m.bodyMm.h).toBeCloseTo(77.0, 1);
  });
  it('pxToMm and mmToPx are inverses', () => {
    for (const [px, py] of [[0, 0], [301, 490], [461.5, 731.3], [602, 979]]) {
      const mm = m.pxToMm(px, py);
      const back = m.mmToPx(mm.x, mm.y);
      expect(back.x).toBeCloseTo(px, 9);
      expect(back.y).toBeCloseTo(py, 9);
    }
  });
  it('body centre maps to the origin; Y is up', () => {
    const o = m.pxToMm(m.centre.x, m.centre.y);
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0);
    expect(m.pxToMm(m.centre.x, m.centre.y - 100).y).toBeGreaterThan(0);
  });
  it('screen is 410x502 px = ~33.1 x 40.5 mm and sits above the centre', () => {
    expect(m.screenMm.w).toBeCloseTo(410 / SPEC.px_per_mm, 6);
    expect(m.screenMm.h).toBeCloseTo(502 / SPEC.px_per_mm, 6);
    expect(m.screenMm.cy).toBeGreaterThan(0);
  });
  it('buttons: top is upper right, bottom lower; dpad lower left', () => {
    expect(m.buttons.top.mm.x).toBeGreaterThan(0);
    expect(m.buttons.top.mm.y).toBeGreaterThan(m.buttons.bottom.mm.y);
    expect(m.dpad.mm.x).toBeLessThan(0);
    expect(m.dpad.mm.y).toBeLessThan(0);
  });
});

describe('UV <-> screen', () => {
  it('maps corners (v up, y down)', () => {
    expect(uvToScreen(0, 1)).toEqual({ x: 0, y: 0 });
    expect(uvToScreen(1, 0)).toEqual({ x: 409, y: 501 });
    expect(uvToScreen(0.5, 0.5)).toEqual({ x: 205, y: 251 });
  });
  it('clamps out of range', () => {
    expect(uvToScreen(-1, 2)).toEqual({ x: 0, y: 0 });
    expect(uvToScreen(5, -5)).toEqual({ x: 409, y: 501 });
  });
  it('round trips every pixel centre', () => {
    for (const [x, y] of [[0, 0], [123, 456], [409, 501], [205, 251]]) {
      const uv = screenToUv(x, y);
      expect(uvToScreen(uv.x, uv.y)).toEqual({ x, y });
    }
  });
});

describe('dpadDirection / inflate', () => {
  const span = 254;
  const arm = 74;
  it('picks the arm under the point', () => {
    expect(dpadDirection(0, -100, span, arm)).toBe('up');
    expect(dpadDirection(0, 100, span, arm)).toBe('down');
    expect(dpadDirection(-100, 5, span, arm)).toBe('left');
    expect(dpadDirection(100, -5, span, arm)).toBe('right');
  });
  it('ignores dead corners and outside', () => {
    expect(dpadDirection(90, 90, span, arm)).toBeNull();
    expect(dpadDirection(130, 0, span, arm)).toBeNull();
  });
  it('inflates small targets to the minimum touch size', () => {
    expect(inflate(74, 0.41)).toBeCloseTo(44 / 0.41);
    expect(inflate(119, 0.67)).toBe(119);
  });
});
