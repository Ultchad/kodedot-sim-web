import { describe, expect, it } from 'vitest';
import { DIST_MAX, DIST_MIN, OrbitRig, POLAR_MAX, POLAR_MIN, nearestTurn } from './camera';
import { DESK } from './layout';
import { Selection, WorkbenchBus } from './state';

describe('Workbench camera', () => {
  it('never goes under the table, too far or off the table, whatever is asked', () => {
    const r = new OrbitRig();
    r.orbit(0, -100000); // drag up for ever
    expect(r.goal.pol).toBe(POLAR_MAX);
    r.orbit(0, 100000);
    expect(r.goal.pol).toBe(POLAR_MIN);
    r.zoom(1e9);
    expect(r.goal.dist).toBe(DIST_MAX);
    r.zoom(1e-9);
    expect(r.goal.dist).toBe(DIST_MIN);
    r.pan(1e7, 1e7, 800);
    expect(r.goal.x).toBeGreaterThanOrEqual(DESK.x0);
    expect(r.goal.x).toBeLessThanOrEqual(DESK.x1);
    expect(r.goal.z).toBeGreaterThanOrEqual(DESK.z0);
    expect(r.goal.z).toBeLessThanOrEqual(DESK.z1);
    r.jump();
    expect(r.pos.y).toBeGreaterThan(0);
  });

  it('pans the table with the pointer and settles on its goal', () => {
    const r = new OrbitRig();
    r.jump();
    const x0 = r.goal.x, z0 = r.goal.z;
    r.pan(100, 0, 800); // drag right: the table follows, so the camera's aim goes left
    expect(r.goal.x).toBeLessThan(x0);
    r.pan(0, 100, 800); // drag down: the aim goes away from the viewer
    expect(r.goal.z).toBeLessThan(z0);
    let n = 0;
    while (r.step(1 / 60, false) && n < 400) n++;
    expect(n).toBeLessThan(120); // under two seconds
    expect(r.cur.x).toBe(r.goal.x);
    expect(r.step(1 / 60, false)).toBe(false);
    expect(r.step(1 / 60, true)).toBe(false);
  });

  it('frames a rectangle so that it fits, closer for a small one; the Dot fills the view when focused', () => {
    const r = new OrbitRig();
    r.frame({ x0: -300, x1: 300, z0: -250, z1: 150 }, 100, 1.4, { pol: 0.7, az: 0 });
    const far = r.goal.dist;
    r.frame({ x0: -40, x1: 40, z0: -40, z1: 40 }, 10, 1.4, { pol: 0.7, az: 0 });
    expect(r.goal.dist).toBeLessThan(far / 3);
    r.focusDot(1.4);
    expect(r.goal.x).toBeCloseTo(0, 0);
    expect(r.goal.dist).toBeLessThan(450);
    expect(nearestTurn(0, 6.2)).toBeCloseTo(Math.PI * 2);
  });
});

describe('Workbench selection', () => {
  it('selects, toggles, keeps only what still exists, and tells its listeners once per change', () => {
    const s = new Selection();
    let calls = 0;
    s.subscribe(() => calls++);
    s.only('a');
    s.only('a');
    expect(calls).toBe(1);
    s.toggle('b');
    s.toggle('dot');
    expect([...s.get()].sort()).toEqual(['a', 'b', 'dot']);
    expect(s.objects().sort()).toEqual(['a', 'b']);
    expect(s.single()).toBeNull();
    s.keep((id) => id !== 'a');
    expect(s.has('a')).toBe(false);
    s.toggle('b');
    expect(s.single()).toBe('dot');
    s.clear();
    expect(s.get().size).toBe(0);
  });

  it('carries commands and the kind being dragged out of the palette', () => {
    const b = new WorkbenchBus();
    const got: string[] = [];
    const off = b.on((c) => got.push(c.type));
    let drags = 0;
    b.onDragKind(() => drags++);
    b.send({ type: 'focus-dot' });
    b.setDragKind('nfc.tag');
    b.setDragKind('nfc.tag');
    b.setDragKind(null);
    off();
    b.send({ type: 'frame-all' });
    expect(got).toEqual(['focus-dot']);
    expect(drags).toBe(2);
  });
});
