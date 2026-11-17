import { describe, expect, it } from 'vitest';
import { isFlatSheet } from './decal';

describe('isFlatSheet', () => {
  const quad = [0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  it('accepts a quad, whatever way it faces', () => {
    expect(isFlatSheet(quad, idx)).toBe(true);
    // the same quad tilted 30 degrees about X and lifted
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const tilted: number[] = [];
    for (let i = 0; i < quad.length; i += 3) tilted.push(quad[i], quad[i + 1] * c - quad[i + 2] * s + 3, quad[i + 1] * s + quad[i + 2] * c + 7);
    expect(isFlatSheet(tilted, idx)).toBe(true);
    expect(isFlatSheet(quad, null)).toBe(true); // a plain triangle list
  });
  it('rejects a sheet with a step and a box', () => {
    const stepped = [...quad];
    stepped[8] = 0.2; // one corner 0.2 off the plane
    expect(isFlatSheet(stepped, idx)).toBe(false);
    expect(isFlatSheet(stepped, idx, 0.5)).toBe(true);
    const box = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    expect(isFlatSheet(box, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])).toBe(false);
  });
  it('rejects degenerate input', () => {
    expect(isFlatSheet([0, 0, 0, 1, 0, 0], null)).toBe(false);
    expect(isFlatSheet([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2])).toBe(false); // a line
  });
});
