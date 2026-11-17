import { describe, expect, it } from 'vitest';
import { ANCHORS, DOT, DOT_POSES, DOT_RECT, GRID, MAT, SD_ID, applyDotPose, dotCentreHeight, freeSpot, isFree, isNear, obstacles, overlaps, placeMissing, rectOf, settle, signalAt, signalLoss, sizeOf, spotFor, zoneOf, type DotPose, type Placed } from './layout';

describe('workbench layout', () => {
  it('rotation swaps the footprint', () => {
    expect(sizeOf('nfc.card', 0).w).toBeCloseTo(85.6);
    expect(sizeOf('nfc.card', 1).w).toBeCloseTo(54);
    expect(sizeOf('nfc.card', 2).w).toBeCloseTo(85.6);
  });

  it('near is a distance to the right spot of the Dot', () => {
    // a tag against the left side is read; a hand further it is not
    expect(isNear('nfc.tag', { x: -(DOT.hw + 17), z: -14 }, 0)).toBe(true);
    expect(isNear('nfc.tag', { x: -(DOT.hw + 17 + 60), z: -14 }, 0)).toBe(false);
    // infrared is a beam out of the top edge: in front yes, beside or behind no
    expect(isNear('ir.tv', { x: 0, z: -170 }, 0)).toBe(true);
    expect(isNear('ir.tv', { x: 220, z: -60 }, 0)).toBe(false);
    expect(isNear('ir.remote', { x: 0, z: 150 }, 0)).toBe(false);
    // Wi-Fi reaches most of the table, not its far corners
    expect(isNear('wifi.router', { x: 150, z: -120 }, 0)).toBe(true);
    expect(isNear('wifi.router', { x: MAT.x1 - 70, z: MAT.z0 + 50 }, 0)).toBe(false);
    // the charger's cable has a length; the battery has no range at all
    expect(isNear('power.charger', { x: 0, z: DOT.hd + 60 }, 0)).toBe(true);
    expect(isNear('power.charger', { x: 250, z: -200 }, 0)).toBe(false);
    expect(zoneOf('power.battery')).toBeNull();
    expect(isNear(SD_ID, { x: ANCHORS.sd.x - 12, z: ANCHORS.sd.z }, 0)).toBe(true);
  });

  it('a dragged object snaps to the grid, stays on the mat and slides round what is in the way', () => {
    const obs = obstacles([], '');
    const p = settle('nfc.tag', { x: 101.3, z: -57.9 }, 0, obs)!;
    expect(p).toEqual({ x: 100, z: -60 });
    const on = settle('nfc.card', { x: 2, z: 3 }, 0, obs)!; // asked for the middle of the Dot
    expect(overlaps(rectOf('nfc.card', on, 0), DOT_RECT)).toBe(false);
    expect(on.x % GRID === 0 && on.z % GRID === 0).toBe(true);
    const edge = settle('wifi.router', { x: 5000, z: 5000 }, 0, obs)!;
    expect(rectOf('wifi.router', edge, 0).x1).toBeLessThan(MAT.x1);
    expect(rectOf('wifi.router', edge, 0).z1).toBeLessThan(MAT.z1);
  });

  it('finds free places and the near and far spots of every kind', () => {
    const placed: Placed[] = [];
    const crowded: string[] = [];
    for (const kind of ['nfc.tag', 'nfc.card', 'nfc.reader', 'rfid.card', 'rfid.tag', 'rfid.reader', 'wifi.router', 'ir.tv', 'ir.remote', 'power.charger']) {
      for (const near of [true, false]) {
        const pos = spotFor(kind, near, 0, obstacles(placed, ''));
        if (isNear(kind, pos, 0) !== near) crowded.push(`${kind} ${near}`);
        expect(isFree(kind, pos, 0, obstacles(placed, ''))).toBe(true);
        placed.push({ id: `${kind}${near}`, kind, pos, rot: 0 });
      }
    }
    expect(crowded).toEqual([]);
    // twenty more tags still find room
    for (let i = 0; i < 20; i++) {
      const pos = freeSpot('nfc.tag', { x: -100, z: 100 }, 0, obstacles(placed, ''));
      expect(isFree('nfc.tag', pos, 0, obstacles(placed, ''))).toBe(true);
      placed.push({ id: `t${i}`, kind: 'nfc.tag', pos, rot: 0 });
    }
    // the switch takes a near object just out of range, not across the table
    const from = { x: -(DOT.hw + 17), z: -14 };
    const out = spotFor('nfc.tag', false, 0, obstacles([], ''), from);
    expect(isNear('nfc.tag', out, 0)).toBe(false);
    expect(Math.hypot(out.x - from.x, out.z - from.z)).toBeLessThan(90);
  });

  it('places what has no place yet and keeps what has one', () => {
    const out = placeMissing([
      { id: 'a', kind: 'nfc.tag', near: true },
      { id: 'b', kind: 'nfc.tag', near: false, pos: { x: 120, z: 40 }, rot: 1 as const },
      { id: 'm', kind: 'motion.pose', near: true },
    ]);
    expect(isNear('nfc.tag', out[0].pos, out[0].rot)).toBe(true);
    expect(out[1].pos).toEqual({ x: 120, z: 40 });
    expect(out[1].rot).toBe(1);
    expect(out[2].pos).toEqual({ x: 0, z: 0 });
  });

  it('a router is heard weaker the further it stands', () => {
    expect(signalLoss({ x: 40, z: 0 })).toBe(0);
    expect(signalLoss({ x: 150, z: 0 })).toBeGreaterThan(5);
    expect(signalLoss({ x: 290, z: 0 })).toBeGreaterThan(signalLoss({ x: 150, z: 0 }));
    expect(signalAt(-45, { x: 290, z: 0 })).toBeLessThan(-55);
    expect(signalAt(-90, { x: 290, z: 0 })).toBe(-95);
    expect(signalAt(-45, undefined)).toBe(-45);
  });
});

describe('the Dot put down another way', () => {
  const each = (fn: (pose: DotPose) => void) => {
    try {
      for (const pose of DOT_POSES) {
        applyDotPose(pose);
        fn(pose);
      }
    } finally {
      applyDotPose('lying');
    }
  };
  it('has its footprint, its coils, its beam and its port where the Dot really is', () => {
    each((pose) => {
      const w = DOT_RECT.x1 - DOT_RECT.x0, d = DOT_RECT.z1 - DOT_RECT.z0;
      if (pose === 'lying') expect([w, d]).toEqual([DOT.hw * 2, DOT.hd * 2]);
      if (pose === 'standing') expect([w, d]).toEqual([DOT.hw * 2, DOT.h]);
      if (pose === 'side') expect([w, d]).toEqual([DOT.hd * 2, DOT.h]);
      expect(dotCentreHeight(pose)).toBeCloseTo(pose === 'lying' ? DOT.h / 2 : pose === 'standing' ? DOT.hd : DOT.hw);
      // the coils are on the back cover: under the lying Dot, behind the one that stands
      const nfc = zoneOf('nfc.tag')!;
      expect(nfc.shape).toBe('circle');
      if (pose !== 'lying') expect(nfc.z).toBeCloseTo(-DOT.h / 2);
      else expect([nfc.x, nfc.z]).toEqual([0, -14]);
    });
  });
  it('measures every range from there', () => {
    each((pose) => {
      // a tag right behind the Dot's back is in range standing and on its side, a tag 60 mm to the left of the lying Dot is not in range standing
      const behind = { x: 0, z: -DOT.h / 2 - 20 };
      expect(isNear('nfc.tag', behind, 0)).toBe(true);
      expect(isNear('nfc.tag', { x: -DOT.hw - 70, z: 60 }, 0)).toBe(false);
      // the infrared beam leaves the top edge: away from the viewer lying, to the right on its side, upward standing
      const tvAhead = isNear('ir.tv', { x: 0, z: -200 }, 0), tvRight = isNear('ir.tv', { x: 220, z: 0 }, 1);
      if (pose === 'lying') expect([tvAhead, tvRight]).toEqual([true, false]);
      if (pose === 'side') expect([tvAhead, tvRight]).toEqual([false, true]);
      if (pose === 'standing') {
        expect([tvAhead, tvRight]).toEqual([false, false]);
        expect(isNear('ir.tv', { x: 0, z: -90 }, 0)).toBe(true); // only what is close gets the light that comes back down
      }
      // standing on its bottom edge the USB-C port is against the table: nothing can be plugged in
      const plugged = isNear('power.charger', spotFor('power.charger', true, 0, [DOT_RECT]), 0);
      expect(plugged).toBe(pose !== 'standing');
      // the card slot stays reachable every way
      expect(isNear(SD_ID, spotFor(SD_ID, true, 0, [DOT_RECT]), 0)).toBe(true);
      // and whatever is brought near ends up beside the Dot, not on it
      for (const kind of ['nfc.tag', 'rfid.card', 'ir.remote', 'wifi.router']) {
        const p = spotFor(kind, true, 0, [DOT_RECT]);
        expect(isNear(kind, p, 0), `${pose} ${kind}`).toBe(true);
        expect(isFree(kind, p, 0, [DOT_RECT]), `${pose} ${kind}`).toBe(true);
      }
    });
  });
});
