import { describe, expect, it } from 'vitest';
import { ShakeDetector, orientationToPose } from './sensors';

describe('orientationToPose', () => {
  it('upright portrait is neutral', () => {
    expect(orientationToPose(0, 90, 0)).toEqual({ pitch: 0, roll: 0, heading: 0 });
  });
  it('maps tilt and wraps heading', () => {
    expect(orientationToPose(370, 60, -20)).toEqual({ pitch: -30, roll: -20, heading: 10 });
    expect(orientationToPose(null, 180, 120)).toEqual({ pitch: 90, roll: 90, heading: 0 });
  });
  it('returns null without data (desktop browsers send nulls)', () => {
    expect(orientationToPose(null, null, null)).toBeNull();
  });
});

describe('ShakeDetector', () => {
  it('needs several strong hits within the window, then cools down', () => {
    const d = new ShakeDetector(14, 3, 700, 1200);
    expect(d.feed(1, 1, 1, 0)).toBe(false);
    expect(d.feed(20, 0, 0, 100)).toBe(false);
    expect(d.feed(0, 20, 0, 200)).toBe(false);
    expect(d.feed(0, 0, 20, 300)).toBe(true);
    expect(d.feed(20, 0, 0, 400)).toBe(false);
    expect(d.feed(20, 0, 0, 500)).toBe(false);
    expect(d.feed(20, 0, 0, 600)).toBe(false); // cooldown
  });
  it('ignores spread-out hits', () => {
    const d = new ShakeDetector(14, 3, 700, 1200);
    expect(d.feed(20, 0, 0, 0)).toBe(false);
    expect(d.feed(20, 0, 0, 800)).toBe(false);
    expect(d.feed(20, 0, 0, 1600)).toBe(false);
  });
});
