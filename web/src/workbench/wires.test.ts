import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { deviceTerms } from '../parts/geometry';
import { DOT } from './layout';
import { deviceTermWorld, wirePath } from './wires';

/** The Dot lying on its back as the Workbench poses it: the model's +Y (top edge) to the world's -Z, its +Z (screen) up. */
const LYING = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const pin = (n: number) => deviceTerms().find((t) => t.pin === n)!;

describe('the Dot header terminals on the table', () => {
  it('lying flat: pin 1 is in the top wall, left of the middle seen from above, in the row toward the screen', () => {
    const { pos, out } = deviceTermWorld(pin(1), new Vector3(0, DOT.h / 2, 0), LYING);
    expect(pos.x).toBeCloseTo(-4.5 * 2.54);
    expect(pos.y).toBeCloseTo(DOT.h / 2 + 1.27); // above the middle of the Dot's thickness: toward the screen
    expect(pos.z).toBeCloseTo(-(DOT.hd + 0.4)); // just out of the top edge, which points away from the viewer
    expect([out.x, out.y, out.z].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, -1]);
    const p20 = deviceTermWorld(pin(20), new Vector3(0, DOT.h / 2, 0), LYING).pos;
    expect(p20.x).toBeCloseTo(4.5 * 2.54);
    expect(p20.y).toBeCloseTo(DOT.h / 2 - 1.27);
  });
  it('puts every pin where the Dot\'s shell prints its name', () => {
    // as printed on the model's top wall, read from behind with the Dot face up (so from the table's +X to its -X)
    const screenRow = ['3V3', 'IO15', 'IO17', 'IO19', 'GND', 'IO14', 'IO12', 'IO10', 'IO8', '5V'];
    const backRow = ['5V', 'IO16', 'IO18', 'IO20', 'IO21', 'GND', 'IO13', 'IO11', 'IO9', '3V3'];
    const GPIO = [8, 9, 10, 11, 12, 13, 14, 21, 19, 20, 17, 18, 15, 16]; // EXP1..14 (J3_GPIO in runtime/web-adapter/bench.js)
    const label = (name: string) => (name.startsWith('EXP') ? `IO${GPIO[Number(name.slice(3)) - 1]}` : name);
    const at = deviceTerms().map((d) => ({ label: label(d.name), ...deviceTermWorld(d, new Vector3(0, DOT.h / 2, 0), LYING) }));
    const row = (up: boolean) => at.filter((t) => t.pos.y > DOT.h / 2 === up).sort((p, q) => q.pos.x - p.pos.x).map((t) => t.label);
    expect(row(true)).toEqual(screenRow);
    expect(row(false)).toEqual(backRow);
  });
  it('is the model pin position through the pose, wherever the Dot is and however it is turned', () => {
    const poses: [Vector3, Quaternion][] = [
      [new Vector3(0, DOT.h / 2, 0), LYING.clone()],
      [new Vector3(120, 14, -60), LYING.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.9))], // turned on the table
      [new Vector3(-40, 30, 75), LYING.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5))], // top edge lifted
      [new Vector3(5, 22, 5), new Quaternion().setFromAxisAngle(new Vector3(0.3, 0.8, 0.5).normalize(), 2.1)],
    ];
    for (const [p, q] of poses) {
      const m = new Matrix4().compose(p, q, new Vector3(1, 1, 1));
      for (const n of [1, 2, 3, 10, 11, 18, 20]) {
        const d = pin(n);
        const want = new Vector3(d.X, d.Y + 0.4, d.Z).applyMatrix4(m); // the pin in the Dot model's frame, placed by the model's matrix
        const got = deviceTermWorld(d, p, q).pos;
        expect(got.distanceTo(want)).toBeLessThan(1e-9);
      }
      // the wire leaves along the Dot's own +Y, the way the header opens
      const out = deviceTermWorld(pin(3), p, q).out;
      expect(out.distanceTo(new Vector3(0, 1, 0).transformDirection(m))).toBeLessThan(1e-9);
    }
  });
});

describe('the line a wire follows', () => {
  const flat = () => 0;
  const up = new Vector3(0, 1, 0);
  it('starts and ends exactly on its terminals and never goes under the table', () => {
    const header = deviceTermWorld(pin(3), new Vector3(0, DOT.h / 2, 0), LYING);
    const hole = new Vector3(88, 8.5, 71);
    for (const seed of [0, 1, 7, 12345]) {
      const pts = wirePath(header.pos, header.out, hole, up, seed, flat);
      expect(pts).toHaveLength(33);
      expect(pts[0].distanceTo(header.pos)).toBeLessThan(1e-9);
      expect(pts[pts.length - 1].distanceTo(hole)).toBeLessThan(1e-9);
      expect(Math.min(...pts.map((p) => p.y))).toBeGreaterThan(0.7); // the tube (0.75 mm) lies on the table, not in it
      for (let i = 1; i < pts.length; i++) expect(pts[i].distanceTo(pts[i - 1])).toBeLessThan(40); // one unbroken line
    }
  });
  it('leaves the Dot header away from the Dot and goes round the Dot when the other end is in front of it', () => {
    const header = deviceTermWorld(pin(10), new Vector3(0, DOT.h / 2, 0), LYING);
    const inDot = (x: number, z: number) => Math.abs(x) < DOT.hw + 3 && Math.abs(z) < DOT.hd + 3;
    const pts = wirePath(header.pos, header.out, new Vector3(4, 0, 120), up, 3, flat, inDot);
    expect(pts[2].z).toBeLessThan(header.pos.z); // first out of the top wall
    expect(pts.slice(8, 25).some((p) => inDot(p.x, p.z))).toBe(false); // the run on the table does not cross the Dot
  });
  it('lies on what is under it, and a short wire is an arch', () => {
    const a = new Vector3(0, 0, 0), b = new Vector3(100, 0, 0);
    const over = (x: number) => (x > 40 && x < 60 ? 10 : 0);
    const pts = wirePath(a, up, b, up, 0, (x) => over(x));
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(10);
    const arch = wirePath(a, up, new Vector3(12, 0, 0), up, 0, flat);
    expect(arch[16].y).toBeGreaterThan(5);
    expect(Math.min(...arch.map((p) => p.y))).toBeGreaterThanOrEqual(0);
  });
});
