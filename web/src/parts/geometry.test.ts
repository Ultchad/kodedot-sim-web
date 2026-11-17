import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchStore } from '../bench/store';
import { deviceTerms, findPlug, hostOf, legsOf, localTerms, mountMatrix, termWorld, turn, type GeoManifest, type MountGeo } from './geometry';

const manifest = (id: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../parts', id, 'manifest.json'), 'utf8')) as GeoManifest & { mount?: MountGeo };

describe('terminals', () => {
  it('puts a pin in the model frame (origin: centre of the footprint)', () => {
    const led = manifest('led');
    const [a, k] = localTerms(led);
    expect(a.name).toBe('A');
    expect(a.x).toBeCloseTo(1.63 - 2.9);
    expect(k.x - a.x).toBeCloseTo(2.54);
    expect(a.y).toBe(0);
  });
  it('turns with the part as the bodies do', () => {
    expect(turn(1, 0, 1)).toEqual([-0, 1]);
    const w = termWorld({ name: 'x', x: 10, y: 2, z: 0, face: 'top', kind: 'io' }, { x: 100, z: 50 }, 2, 3);
    expect(w).toEqual({ x: 90, y: 5, z: 50 });
  });
  it('lists the 20 pins of the header, pin 1 and pin 20 both 5 V', () => {
    const t = deviceTerms();
    expect(t).toHaveLength(20);
    expect(t.filter((x) => x.term === 'device.V5').map((x) => x.pin).sort((a, b) => a - b)).toEqual([1, 20]);
    const p3 = t.find((x) => x.pin === 3)!, p18 = t.find((x) => x.pin === 18)!;
    expect(p3.term).toBe('device.EXP1');
    // a half turn about the Dot's long axis puts pin 3 where pin 18 was
    expect(-p3.X).toBeCloseTo(p18.X);
    expect(-p3.Z).toBeCloseTo(p18.Z);
  });
});

describe('legs in holes', () => {
  const board = manifest('breadboard-half'), led = manifest('led'), res = manifest('resistor');
  const hole = (name: string) => localTerms(board).find((t) => t.name === name)!;
  it('knows legs from sockets', () => {
    expect(legsOf(led)).toHaveLength(2);
    expect(legsOf(board)).toHaveLength(0);
    expect(hostOf('b', board, { x: 0, z: 0 }, 0)).not.toBeNull();
    expect(hostOf('l', led, { x: 0, z: 0 }, 0)).toBeNull();
  });
  it('pulls a part dropped near holes into them', () => {
    const host = hostOf('b', board, { x: 100, z: 40 }, 0)!;
    const a1 = hole('a1'), legA = localTerms(led)[0];
    const exact = { x: 100 + a1.x - legA.x, z: 40 + a1.z - legA.z };
    const plug = findPlug(legsOf(led), { x: exact.x + 0.9, z: exact.z - 0.7 }, 0, [host], 2.2)!;
    expect(plug.host).toBe('b');
    expect(plug.pos.x).toBeCloseTo(exact.x);
    expect(plug.pos.z).toBeCloseTo(exact.z);
    expect(plug.pairs).toEqual([['A', 'a1'], ['K', 'a2']]);
    expect(plug.lift).toBeCloseTo(8.5);
    // standing there already: found with the small reach too; off the board: nothing
    expect(findPlug(legsOf(led), plug.pos, 0, [host], 0.3)?.pairs).toEqual(plug.pairs);
    expect(findPlug(legsOf(led), { x: 300, z: 40 }, 0, [host], 2.2)).toBeNull();
  });
  it('works on a turned board with a turned part', () => {
    const host = hostOf('b', board, { x: 0, z: 0 }, 1)!;
    const a1 = hole('a1');
    const [hx, hz] = turn(a1.x, a1.z, 1);
    const legs = legsOf(res);
    const [lx, lz] = turn(legs[0].x, legs[0].z, 1);
    const plug = findPlug(legs, { x: hx - lx + 0.5, z: hz - lz }, 1, [host], 2.2)!;
    expect(plug.pairs[0]).toEqual(['A', 'a1']);
    expect(plug.pairs[1][1]).toBe('a5'); // 10.16 mm further along the row
  });
});

describe('a module on the header', () => {
  it('lands its connector seat on the Dot anchor', () => {
    const m = manifest('kode-robotics');
    const mat = mountMatrix(m.body, m.mount, 'upright')!;
    const seat = m.mount!.connector!.seat_mm;
    const p = [seat.x - m.body.w_mm / 2, seat.z, seat.y - m.body.d_mm / 2];
    const out = [0, 1, 2].map((i) => mat[i] * p[0] + mat[4 + i] * p[1] + mat[8 + i] * p[2] + mat[12 + i]);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(38.5);
    expect(out[2]).toBeCloseTo(0);
    // a rotation, not a mirror
    const det = mat[0] * (mat[5] * mat[10] - mat[6] * mat[9]) - mat[4] * (mat[1] * mat[10] - mat[2] * mat[9]) + mat[8] * (mat[1] * mat[6] - mat[2] * mat[5]);
    expect(det).toBeCloseTo(1);
    expect(mountMatrix(m.body, m.mount, 'turned')).not.toBeNull();
    expect(mountMatrix(manifest('kode-mesh-shape').body, manifest('kode-mesh-shape').mount, 'turned')).toBeNull();
  });
});

describe('wires in the store', () => {
  it('adds, refuses doubles, removes with the part, undoes', () => {
    const s = new BenchStore(null);
    const a = s.addPart('led', 'LED 1'), b = s.addPart('resistor', 'R 1');
    s.checkpoint();
    const w = s.addWire(`${a.id}.A`, `${b.id}.B`, '#2f6fdb')!;
    expect(w.id).toBe('w1');
    expect(s.addWire(`${b.id}.B`, `${a.id}.A`)).toBeNull();
    expect(s.addWire(`${a.id}.K`, 'device.GND')?.id).toBe('w2');
    s.checkpoint();
    s.remove(b.id);
    expect(s.getState().wires.map((x) => x.id)).toEqual(['w2']);
    s.undo();
    expect(s.getState().wires).toHaveLength(2);
    const saved = JSON.parse(JSON.stringify(s.exportData()));
    const t = new BenchStore(null);
    expect(t.importData(saved)).toBe(true);
    expect(t.getState().wires).toHaveLength(2);
    expect(t.importData({ nope: 1 })).toBe(false);
  });
});
