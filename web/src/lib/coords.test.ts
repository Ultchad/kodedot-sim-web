import { describe, expect, it } from 'vitest';
import { pointerToScreen } from './coords';

const rect = { left: 100, top: 50, width: 205, height: 251 }; // half scale of 410x502

describe('pointerToScreen', () => {
  it('maps corners and centre', () => {
    expect(pointerToScreen(100, 50, rect)).toEqual({ x: 0, y: 0, inside: true });
    expect(pointerToScreen(100 + 102.5, 50 + 125.5, rect)).toEqual({ x: 205, y: 251, inside: true });
    expect(pointerToScreen(304.9, 300.9, rect)).toEqual({ x: 409, y: 501, inside: true });
  });
  it('clamps outside points and reports inside=false', () => {
    expect(pointerToScreen(0, 0, rect)).toEqual({ x: 0, y: 0, inside: false });
    expect(pointerToScreen(9999, 9999, rect)).toEqual({ x: 409, y: 501, inside: false });
    expect(pointerToScreen(305, 301, rect).inside).toBe(false);
  });
  it('handles a degenerate rect', () => {
    expect(pointerToScreen(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, inside: false });
  });
});
