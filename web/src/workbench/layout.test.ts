import { describe, expect, it } from 'vitest';
import { ANCHORS, DOT, DOT_RECT, GRID, MAT, SD_ID, freeSpot, isFree, isNear, obstacles, overlaps, placeMissing, rectOf, settle, signalAt, signalLoss, sizeOf, spotFor, zoneOf, type Placed } from './layout';

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
