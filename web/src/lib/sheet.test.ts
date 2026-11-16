import { describe, expect, it } from 'vitest';
import { PEEK_PX, detentHeights, snapDetent } from './sheet';

describe('detentHeights', () => {
  it('orders peek < half < full on real phone heights', () => {
    for (const vh of [740, 844, 932]) {
      const d = detentHeights(vh);
      expect(d.peek).toBe(PEEK_PX);
      expect(d.half).toBeGreaterThan(d.peek);
      expect(d.full).toBeGreaterThan(d.half);
      expect(d.full).toBeLessThan(vh);
    }
  });
});

describe('snapDetent', () => {
  const vh = 844;
  const d = detentHeights(vh);
  it('snaps to the nearest detent when released slowly', () => {
    expect(snapDetent(d.peek + 30, vh)).toBe('peek');
    expect(snapDetent(d.half - 40, vh)).toBe('half');
    expect(snapDetent(d.full - 60, vh)).toBe('full');
  });
  it('a flick carries the sheet one detent further in its direction', () => {
    expect(snapDetent(d.peek + 60, vh, -1.2)).toBe('half'); // flick up from the bar
    expect(snapDetent(d.half + 40, vh, -1.2)).toBe('full');
    expect(snapDetent(d.full - 40, vh, 1.2)).toBe('half'); // flick down
    expect(snapDetent(d.half - 30, vh, 1.2)).toBe('peek');
  });
  it('never leaves the range', () => {
    expect(snapDetent(d.full + 500, vh, -3)).toBe('full');
    expect(snapDetent(0, vh, 3)).toBe('peek');
  });
});
