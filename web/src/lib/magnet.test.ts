import { describe, expect, it } from 'vitest';
import { HOLD, HYSTERESIS, STRONG, WEAK, magnet, magnetRelease, magnetStart, quarterMarks, stepAngle, type MagnetState } from './magnet';

const marks = quarterMarks();
const drag = (): MagnetState => ({ on: null });

describe('magnetic angles', () => {
  it('leaves the angle alone far from every mark', () => {
    const s = drag();
    for (const a of [12, 20.5, 33, 60, 77.9, 100, 250.3]) expect(magnet(a, marks, s)).toBe(a);
    expect(s.on).toBeNull();
  });
  it('catches on entering the window, eases in, and is exactly the mark close to it', () => {
    const s = drag();
    expect(magnet(90 - STRONG - 0.5, marks, s)).toBe(90 - STRONG - 0.5);
    // just inside: a tug toward the mark (less than a degree and a half), not a jump onto it
    const inside = magnet(90 - STRONG + 0.01, marks, s);
    expect(s.on?.at).toBe(90);
    expect(inside).toBeGreaterThan(90 - STRONG);
    expect(inside - (90 - STRONG)).toBeLessThan(1.5);
    // it eases in: every step of the hand toward the mark moves the angle toward it, never past it
    let last = inside;
    for (let a = 90 - STRONG + 0.5; a < 90 - STRONG * HOLD; a += 0.5) {
      const v = magnet(a, marks, s);
      expect(v).toBeGreaterThan(last);
      expect(v).toBeLessThan(90);
      last = v;
    }
    // the inner part of the window is the mark itself, to the last digit, from either side
    for (const a of [90 - STRONG * HOLD, 89, 89.999, 90, 90.7, 90 + STRONG * HOLD]) expect(magnet(a, marks, s)).toBe(90);
  });
  it('lets go only past the wider edge, and takes hold again only inside the window', () => {
    const s = drag();
    magnet(90, marks, s);
    // going out: still held between the window and the wider edge, and the angle is back to the hand's at that edge
    const between = 90 + STRONG * (1 + (HYSTERESIS - 1) / 2);
    const held = magnet(between, marks, s);
    expect(s.on?.at).toBe(90);
    expect(held).toBeLessThan(between);
    expect(magnet(90 + STRONG * HYSTERESIS - 1e-6, marks, s)).toBeCloseTo(90 + STRONG * HYSTERESIS, 4);
    expect(magnet(90 + STRONG * HYSTERESIS + 0.01, marks, s)).toBe(90 + STRONG * HYSTERESIS + 0.01);
    expect(s.on).toBeNull();
    // coming back to where it was held a moment ago: free, until the window itself is entered (no chatter at the edge)
    expect(magnet(between, marks, s)).toBe(between);
    expect(s.on).toBeNull();
    expect(magnet(90 + STRONG - 0.01, marks, s)).toBeLessThan(90 + STRONG - 0.01);
    expect(s.on?.at).toBe(90);
  });
  it('pulls half as far on the diagonals', () => {
    const s = drag();
    expect(magnet(45 + WEAK + 0.2, marks, s)).toBe(45 + WEAK + 0.2);
    expect(magnet(45 + WEAK - 0.1, marks, s)).not.toBe(45 + WEAK - 0.1);
    expect(magnet(45.5, marks, s)).toBe(45);
    expect(magnet(135 - 5, marks, drag())).toBe(130); // 5 away: inside a straight mark's window, outside a diagonal's
    expect(quarterMarks(0, 359.999, false).every((m) => m.at % 90 === 0)).toBe(true);
  });
  it('meets a mark from both sides of the wrap', () => {
    const s = drag();
    expect(magnet(359.2, marks, s, { period: 360 })).toBe(360); // the same turn as 0: the caller wraps it
    expect(magnet(-0.5, marks, drag(), { period: 360 })).toBe(0);
    expect(magnetRelease(356, { on: marks[0] }, { period: 360 })).toBe(360);
    expect(magnet(355, marks, drag(), { period: 360 })).toBeGreaterThan(355);
    expect(magnet(355, marks, drag(), { period: 360 })).toBeLessThan(360);
    expect(magnet(725, marks, drag(), { period: 360 })).toBeLessThan(725); // toward 720, which is 0
  });
  it('is off with the modifier, and lets go of what it held', () => {
    const s = drag();
    magnet(90.5, marks, s);
    expect(s.on).not.toBeNull();
    expect(magnet(90.5, marks, s, { off: true })).toBe(90.5);
    expect(s.on).toBeNull();
    expect(magnet(89.9, marks, s, { off: true })).toBe(89.9);
    expect(magnetRelease(89.9, s, { off: true })).toBe(89.9);
  });
  it('lands exactly on the mark when the hand lets go inside the window, and keeps the hand\'s angle outside it', () => {
    const s = drag();
    magnet(84.5, marks, s);
    expect(magnetRelease(84.5, s)).toBe(90); // in the easing part of the window: it goes the rest of the way
    expect(s.on).toBeNull();
    magnet(90, marks, s);
    magnet(98, marks, s); // past the window, not yet past the wider edge
    expect(magnetRelease(98, s)).toBeCloseTo(magnet(98, marks, { on: marks.find((m) => m.at === 90)! }), 9); // where it was shown: nothing jumps
    expect(magnetRelease(30, drag())).toBe(30);
  });
  it('has no easing with reduced motion: the mark inside the window, the hand\'s angle outside', () => {
    const s = drag();
    expect(magnet(90 - STRONG + 0.1, marks, s, { reduced: true })).toBe(90);
    expect(magnet(90 + STRONG * 1.2, marks, s, { reduced: true })).toBe(90); // held until the wider edge
    expect(magnet(90 + STRONG * HYSTERESIS + 0.1, marks, s, { reduced: true })).toBe(90 + STRONG * HYSTERESIS + 0.1);
  });
  it('a drag that begins on a mark leaves it freely, and is caught again when it comes back', () => {
    const s = magnetStart(90, marks);
    expect(s.free?.at).toBe(90);
    for (const a of [90.4, 91, 93, 96]) expect(magnet(a, marks, s)).toBe(a); // a small correction is the hand's own
    expect(magnetRelease(93, s)).toBe(93);
    const t = magnetStart(90, marks);
    magnet(90 + STRONG * HYSTERESIS + 1, marks, t); // away
    expect(t.free).toBeNull();
    expect(magnet(91, marks, t)).toBe(90); // and back: caught
    expect(magnetStart(60, marks).free).toBeNull();
    expect(magnetStart(359, marks, 360).free?.at).toBe(0);
  });
  it('keyboard steps land on the marks', () => {
    expect(stepAngle(0, 1, 15)).toBe(15);
    expect(stepAngle(37, 1, 15)).toBe(45);
    expect(stepAngle(37, -1, 15)).toBe(30);
    expect(stepAngle(45, -1, 15)).toBe(30);
    expect(stepAngle(-7, -1, 5)).toBe(-10);
    let v = 3;
    for (let i = 0; i < 6; i++) v = stepAngle(v, 1, 15);
    expect(v).toBe(90);
  });
});
