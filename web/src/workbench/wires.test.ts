import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { deviceTerms } from '../parts/geometry';
import { BenchStore } from '../bench/store';
import { tubeIndices, writeTube } from '../bench3d/shape';
import { DOT, registerSize } from './layout';
import { BEND, R_WIRE, REST, STUB, Wires, deviceTermWorld, wirePath, writeRingIndices, writeRings, type WireBox, type WireEnd, type WireParts } from './wires';

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

// ---- helpers ---------------------------------------------------------------------------------------------------------
const UP = new Vector3(0, 1, 0);
const end = (x: number, y: number, z: number, out: Vector3 = UP, owner = ''): WireEnd => ({ pos: new Vector3(x, y, z), out: out.clone().normalize(), owner });
const box = (id: string, x0: number, x1: number, z0: number, z1: number, h: number, round = h > 24): WireBox => ({ id, x0, x1, z0, z1, h, round });
const DOT_BOX = box('device', -DOT.hw, DOT.hw, -DOT.hd, DOT.hd, DOT.h, true);
const pointsOf = (line: Float32Array) => Array.from({ length: line.length / 3 }, (_, i) => new Vector3(line[i * 3], line[i * 3 + 1], line[i * 3 + 2]));
/** Points every half millimetre along a line, each with how far along it is. */
function walk(line: Float32Array, step = 0.5): { p: Vector3; s: number; total: number }[] {
  const pts = pointsOf(line);
  const out: { p: Vector3; s: number; total: number }[] = [];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = pts[i].distanceTo(pts[i - 1]);
    for (let d = 0; d < l; d += step) out.push({ p: pts[i - 1].clone().lerp(pts[i], d / l), s: run + d, total: 0 });
    run += l;
  }
  out.push({ p: pts[pts.length - 1], s: run, total: 0 });
  for (const o of out) o.total = run;
  return out;
}
/** Is the tube round this point inside the box (by more than a twentieth of a millimetre)? */
const inside = (b: WireBox, p: Vector3) => p.x > b.x0 - R_WIRE + 0.05 && p.x < b.x1 + R_WIRE - 0.05 && p.z > b.z0 - R_WIRE + 0.05 && p.z < b.z1 + R_WIRE - 0.05 && p.y - R_WIRE < b.h - 0.05;
/** The boxes a wire's tube enters, leaving out each end's stub and bend where its own box is concerned. */
function entered(line: Float32Array, a: WireEnd, b: WireEnd, boxes: readonly WireBox[]): string[] {
  const hit = new Set<string>();
  const own = STUB + BEND + 4;
  for (const { p, s, total } of walk(line)) {
    for (const bx of boxes) {
      if (!inside(bx, p)) continue;
      if ((bx.id === a.owner && s < own) || (bx.id === b.owner && total - s < own)) continue;
      hit.add(`${bx.id} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
    }
  }
  return [...hit];
}
/** Share of triangles whose face looks the way their vertex normals point. */
function outward(pos: Float32Array, nor: Float32Array, idx: ArrayLike<number>, count = idx.length): number {
  let ok = 0, all = 0;
  for (let k = 0; k + 2 < count; k += 3) {
    const [a, b, c] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
    const e1 = new Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    const e2 = new Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]);
    const fn = e1.cross(e2);
    if (fn.lengthSq() < 1e-12) continue;
    all++;
    if (fn.dot(new Vector3(nor[a] + nor[b] + nor[c], nor[a + 1] + nor[b + 1] + nor[c + 1], nor[a + 2] + nor[b + 2] + nor[c + 2])) > 0) ok++;
  }
  return all ? ok / all : 0;
}

describe('the line a wire follows', () => {
  const header = (n: number): WireEnd => ({ ...deviceTermWorld(pin(n), new Vector3(0, DOT.h / 2, 0), LYING), owner: 'device' });

  it('starts and ends exactly on its terminals, leaves and arrives along their own direction, never goes under the table', () => {
    const a = header(3), b = end(88, 8.5, 71, UP, 'bb');
    const boxes = [DOT_BOX, box('bb', 40, 122, 44, 99, 8.5)];
    for (const seed of [0, 1, 7, 12345]) {
      const line = wirePath(a, b, boxes, { seed });
      const pts = pointsOf(line);
      expect(pts[0].distanceTo(a.pos)).toBeLessThan(1e-4);
      expect(pts[pts.length - 1].distanceTo(b.pos)).toBeLessThan(1e-4);
      // the first STUB millimetres are straight out of the header's opening (the Dot's top wall looks to -Z) ...
      for (const { p, s } of walk(line)) {
        if (s > STUB) break;
        expect(p.distanceTo(a.pos.clone().addScaledVector(a.out, s))).toBeLessThan(0.02);
      }
      // ... and the last ones straight down into the hole
      const w = walk(line);
      for (const { p, s, total } of w) if (total - s <= STUB) expect(Math.hypot(p.x - b.pos.x, p.z - b.pos.z)).toBeLessThan(0.02);
      expect(Math.min(...pts.slice(1, -1).map((p) => p.y))).toBeGreaterThanOrEqual(REST - 1e-6); // the tube lies on the table, not in it
      expect(entered(line, a, b, boxes)).toEqual([]);
    }
  });

  it('comes out of the Dot\'s header and goes round the Dot, never through its shell, when the other end is in front of it', () => {
    for (const n of [1, 2, 10, 11, 19, 20]) {
      const a = header(n), b = end(4, REST, 120);
      const line = wirePath(a, b, [DOT_BOX], { seed: n });
      const pts = pointsOf(line);
      expect(pts[1].z).toBeLessThan(a.pos.z - 1); // first out of the top wall, away from the Dot
      expect(entered(line, a, b, [DOT_BOX])).toEqual([]);
      // and not over the screen either: no point of the line is above the Dot's footprint
      for (const { p } of walk(line)) expect(Math.abs(p.x) < DOT.hw && Math.abs(p.z) < DOT.hd, `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(false);
    }
  });

  it('climbs over a low body in its way and is above it before the body begins', () => {
    const a = end(-60, REST, 0), b = end(260, REST, 0);
    const board = box('board', 80, 120, -30, 30, 10);
    const line = wirePath(a, b, [board]);
    expect(entered(line, a, b, [board])).toEqual([]);
    expect(entered(new Float32Array([-60, REST, 0, 260, REST, 0]), a, b, [board]).length).toBeGreaterThan(0); // the check itself sees a wire that goes through
    const over = walk(line).filter(({ p }) => p.x > 80 && p.x < 120);
    expect(over.length).toBeGreaterThan(20);
    for (const { p } of over) expect(p.y - R_WIRE).toBeGreaterThanOrEqual(10);
    // away from the body it lies on the table
    expect(walk(line).some(({ p }) => p.x > 10 && p.x < 40 && p.y < REST + 0.01)).toBe(true);
    expect(walk(line).some(({ p }) => p.x > 160 && p.x < 190 && p.y < REST + 0.01)).toBe(true);
  });

  it('goes round a tall body instead of over it, by the shorter side', () => {
    const a = end(0, REST, 0), b = end(200, REST, 6);
    const tower = box('tower', 80, 120, -30, 20, 60);
    const line = wirePath(a, b, [tower]);
    expect(entered(line, a, b, [tower])).toEqual([]);
    const ys = pointsOf(line).slice(2, -2).map((p) => p.y);
    expect(Math.max(...ys)).toBeLessThan(STUB + BEND + 1); // it did not climb
    expect(walk(line).some(({ p }) => p.x > 80 && p.x < 120 && p.z > 20)).toBe(true); // the +Z side is nearer
  });

  it('a short wire is an arch, a long one lies down between its ends', () => {
    const arch = pointsOf(wirePath(end(0, 8.5, 0), end(12, 8.5, 0), [box('bb', -40, 40, -27, 27, 8.5)]));
    const top = Math.max(...arch.map((p) => p.y));
    expect(top).toBeGreaterThan(8.5 + STUB);
    expect(top).toBeLessThan(8.5 + STUB + BEND + 0.01);
    const long = walk(wirePath(end(0, REST, 0), end(400, REST, 0), []));
    expect(long.filter(({ p }) => p.y < REST + 0.01).length).toBeGreaterThan(long.length * 0.6);
  });

  it('wires between the same two things fan out in the middle and keep their ends', () => {
    const a = end(0, 8.5, 0), b = end(150, 8.5, 2.54);
    const lines = [-2.4, 0, 2.4].map((fan) => wirePath(a, b, [], { fan }));
    const mid = lines.map((l) => {
      const w = walk(l);
      return w[Math.floor(w.length / 2)].p;
    });
    expect(mid[0].distanceTo(mid[1])).toBeGreaterThan(1.8);
    expect(mid[2].distanceTo(mid[1])).toBeGreaterThan(1.8);
    expect(mid[0].distanceTo(mid[2])).toBeGreaterThan(3.6);
    for (const l of lines) {
      const p = pointsOf(l);
      expect(p[0].distanceTo(a.pos)).toBeLessThan(1e-4);
      expect(p[p.length - 1].distanceTo(b.pos)).toBeLessThan(1e-4);
    }
  });

  it('never passes through a body: two hundred tables of boxes, holes, side pins and header pins', () => {
    let rnd = 12345;
    const r = (a: number, b: number) => {
      rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
      return a + (rnd / 0x7fffffff) * (b - a);
    };
    let wires = 0;
    for (let scene = 0; scene < 200; scene++) {
      // bodies that do not touch each other (a centimetre and a half apart), the Dot among them
      const boxes: WireBox[] = [DOT_BOX];
      for (let tries = 0; tries < 40 && boxes.length < 9; tries++) {
        const w = r(6, 150), d = r(6, 100), x = r(-280, 280 - w), z = r(-240, 160 - d);
        const h = r(0, 1) < 0.3 ? r(26, 90) : r(1.5, 22);
        const b = box(`b${boxes.length}`, x, x + w, z, z + d, h);
        if (boxes.every((o) => b.x0 > o.x1 + 16 || b.x1 < o.x0 - 16 || b.z0 > o.z1 + 16 || b.z1 < o.z0 - 16)) boxes.push(b);
      }
      const ends: WireEnd[] = [header(1 + Math.floor(r(0, 19.99)))];
      for (const b of boxes.slice(1)) {
        // a hole or a socket on top, and a pin on a side at half height
        ends.push(end(r(b.x0 + 1, b.x1 - 1), b.h, r(b.z0 + 1, b.z1 - 1), UP, b.id));
        const side = Math.floor(r(0, 3.99));
        const o = [new Vector3(-1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 0, 1)][side];
        ends.push(end(side === 0 ? b.x0 : side === 1 ? b.x1 : r(b.x0, b.x1), Math.max(REST, b.h / 2), side === 2 ? b.z0 : side === 3 ? b.z1 : r(b.z0, b.z1), o, b.id));
      }
      // a loose end on the bare table
      for (let tries = 0; tries < 20; tries++) {
        const x = r(-300, 300), z = r(-250, 170);
        if (boxes.every((o) => x < o.x0 - 14 || x > o.x1 + 14 || z < o.z0 - 14 || z > o.z1 + 14)) {
          ends.push(end(x, REST, z));
          break;
        }
      }
      for (let k = 0; k < 6; k++) {
        const a = ends[Math.floor(r(0, ends.length - 0.01))], b = ends[Math.floor(r(0, ends.length - 0.01))];
        if (a === b || a.pos.distanceTo(b.pos) < 3) continue;
        const line = wirePath(a, b, boxes, { fan: r(-6, 6), seed: k });
        wires++;
        const pts = pointsOf(line);
        expect(pts[0].distanceTo(a.pos)).toBeLessThan(1e-4);
        expect(pts[pts.length - 1].distanceTo(b.pos)).toBeLessThan(1e-4);
        expect(line.every((v) => Number.isFinite(v))).toBe(true);
        expect(Math.min(...pts.slice(1, -1).map((p) => p.y)), `scene ${scene}`).toBeGreaterThanOrEqual(REST - 1e-6);
        expect(entered(line, a, b, boxes), `scene ${scene}, wire ${k}: ${JSON.stringify(boxes)} ${JSON.stringify([a, b])}`).toEqual([]);
        expect(pts.length).toBeLessThan(150);
      }
    }
    expect(wires).toBeGreaterThan(800);
  });
});

describe('the tube', () => {
  it('is wound outward, so its near wall is drawn and it cannot be seen through', () => {
    const line = wirePath(end(0, 8.5, 0), end(90, 0.4, 60, new Vector3(1, 0, 0)), [box('bb', -40, 40, -27, 27, 8.5)]);
    const n = line.length / 3, sides = 6;
    const pos = new Float32Array(n * sides * 3), nor = new Float32Array(n * sides * 3), idx = new Uint32Array((n - 1) * sides * 6);
    expect(writeRings(pos, nor, 0, line, () => R_WIRE, sides)).toBe(n * sides);
    expect(writeRingIndices(idx, 0, 0, n, sides)).toBe(idx.length);
    expect(outward(pos, nor, idx)).toBe(1);
    // every vertex is R from the line's point it belongs to: a round section
    for (let i = 0; i < n; i++) for (let s = 0; s < sides; s++) expect(Math.hypot(pos[(i * sides + s) * 3] - line[i * 3], pos[(i * sides + s) * 3 + 1] - line[i * 3 + 1], pos[(i * sides + s) * 3 + 2] - line[i * 3 + 2])).toBeCloseTo(R_WIRE, 5);
  });
  it('the kit\'s tubes (cables, antennas, the charger\'s lead) are wound outward too', () => {
    for (const pts of [[[0, 0, 0], [10, 0, 0], [20, 4, 0]], [[0, 0, 0], [0, 10, 0], [0, 20, 3]], [[0, 0, 0], [0, 0, 10], [3, 5, 20], [9, 9, 9]]]) {
      const seg = 8, n = pts.length;
      const pos = new Float32Array(n * seg * 3), nor = new Float32Array(n * seg * 3);
      writeTube(pos, nor, pts, 1, seg);
      expect(outward(pos, nor, tubeIndices(n, seg))).toBe(1);
    }
  });
});

describe('a bundle of wires', () => {
  it('two wires that would lie on each other between the same two things are pushed apart, the same way whichever way they were drawn', () => {
    registerSize('test.board', { w: 60, d: 30, h: 8.5 });
    const term = (name: string, x: number) => ({ name, x, y: 8.5, z: 0, face: 'top', kind: 'io' });
    const parts: WireParts = { terms: () => [term('a', -20), term('b', 20)], liftOf: () => 0, mountOf: () => null, getVersion: () => 0 };
    const bench = new BenchStore(null);
    const b1 = bench.addPart('test.board', 'B1', {}, { x: -150, z: -120 }), b2 = bench.addPart('test.board', 'B2', {}, { x: -150, z: 20 });
    // an X: a to b and b to a (the second drawn from the other board), their middles in the same place
    const w1 = bench.addWire(`${b1.id}.a`, `${b2.id}.b`)!, w2 = bench.addWire(`${b2.id}.a`, `${b1.id}.b`)!;
    const wires = new Wires(bench, parts, LYING.clone(), new Vector3(0, DOT.h / 2, 0));
    wires.draw();
    const m1 = wires.mid(w1.id)!, m2 = wires.mid(w2.id)!;
    expect(Math.hypot(m1.x - m2.x, m1.z - m2.z)).toBeGreaterThan(2);
    expect(Math.hypot(m1.x - m2.x, m1.z - m2.z)).toBeLessThan(8);
    wires.dispose();
  });
});

describe('wires on the table are kept', () => {
  const term = (name: string, x: number, y: number, z: number, face = 'top') => ({ name, x, y, z, face, kind: 'io' });
  const parts: WireParts = {
    terms: (kind) => (kind === 'test.board' ? [term('a', -20, 8.5, 0), term('b', 20, 8.5, 0), term('c', 0, 8.5, 10)] : kind === 'test.pin' ? [term('p', 0, 4, 0)] : []),
    liftOf: () => 0,
    mountOf: () => null,
    getVersion: () => 0,
  };
  it('a wire is made again only when its ends or a body near its line move', () => {
    registerSize('test.board', { w: 60, d: 30, h: 8.5 });
    registerSize('test.pin', { w: 8, d: 8, h: 4 });
    registerSize('test.block', { w: 20, d: 20, h: 12 });
    const bench = new BenchStore(null);
    const b1 = bench.addPart('test.board', 'B1', {}, { x: -200, z: -150 });
    const b2 = bench.addPart('test.board', 'B2', {}, { x: -60, z: -150 });
    const p1 = bench.addPart('test.pin', 'P1', {}, { x: 150, z: 100 });
    const p2 = bench.addPart('test.pin', 'P2', {}, { x: 250, z: 100 });
    const block = bench.addPart('test.block', 'X', {}, { x: 0, z: 150 });
    const w1 = bench.addWire(`${b1.id}.b`, `${b2.id}.a`, '#d9412b')!;
    const w2 = bench.addWire(`${p1.id}.p`, `${p2.id}.p`, '#2f6fdb')!;
    const wires = new Wires(bench, parts, LYING.clone(), new Vector3(0, DOT.h / 2, 0));
    expect(wires.draw()).toBe(true);
    expect(wires.stats()).toMatchObject({ wires: 2, remade: 2 });
    expect(wires.draw()).toBe(false); // nothing changed: nothing done
    const line1 = wires.lineOf(w1.id)!;
    // a body moves somewhere else on the table: both wires are kept as they are
    bench.moveMany([{ id: block.id, pos: { x: 0, z: 100 } }]);
    expect(wires.draw()).toBe(true);
    expect(wires.stats().remade).toBe(0);
    expect(wires.lineOf(w1.id)).toBe(line1);
    // it is put down across the second wire: that one is made again and now climbs over it
    bench.moveMany([{ id: block.id, pos: { x: 200, z: 100 } }]);
    wires.draw();
    expect(wires.stats().remade).toBe(1);
    expect(wires.lineOf(w1.id)).toBe(line1);
    expect(Math.max(...pointsOf(wires.lineOf(w2.id)!).map((p) => p.y))).toBeGreaterThan(12 + R_WIRE);
    expect(entered(wires.lineOf(w2.id)!, { pos: new Vector3(), out: UP, owner: p1.id }, { pos: new Vector3(), out: UP, owner: p2.id }, wires.bodies())).toEqual([]);
    // taken away again: made again, flat again
    bench.moveMany([{ id: block.id, pos: { x: 0, z: 150 } }]);
    wires.draw();
    expect(wires.stats().remade).toBe(1);
    expect(Math.max(...pointsOf(wires.lineOf(w2.id)!).map((p) => p.y))).toBeLessThan(4 + STUB + BEND + 0.5);
    // an end moves: only its wire
    bench.moveMany([{ id: b2.id, pos: { x: -80, z: -150 } }]);
    wires.draw();
    expect(wires.stats().remade).toBe(1);
    expect(wires.lineOf(w1.id)).not.toBe(line1);
    // a colour is not a shape
    bench.setWireColor(w1.id, '#2f9e57');
    wires.selected = new Set();
    wires.draw();
    expect(wires.stats().remade).toBe(0);
    expect(wires.stats().triangles).toBeGreaterThan(100);
    wires.dispose();
  });
});
