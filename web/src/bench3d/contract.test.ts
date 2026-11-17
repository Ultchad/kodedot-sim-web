import { describe, expect, it } from 'vitest';
import { footprintOf, fromManifestMm, inspectModel, makeCtx, terminalsFromManifest, toManifestMm } from './contract';
import { MODELS } from './registry';
import { SIZES, modelIdOf } from '../workbench/layout';
import { Shape } from './shape';
import { PAL } from './materials';
import { electrolytic, gear, heatsink, pcb, pinHeader, qfp, screwTerminal, soic, usbC } from './parts';

describe('Bench3D models', () => {
  it('finds the models by file name', () => {
    expect(MODELS.size).toBeGreaterThanOrEqual(2);
    expect(MODELS.has('nfc.tag')).toBe(true);
    expect(MODELS.has('wifi.router')).toBe(true);
  });

  // every model, including the ones other people add: inside its footprint, inside its budget, sane terminals
  for (const [id, model] of MODELS) {
    it(`${id} keeps the contract`, () => {
      const report = inspectModel(model);
      expect(report.problems, `${id}: ${report.triangles} triangles`).toEqual([]);
      // a lower level of detail builds too, and is not heavier
      const low = inspectModel(model, model.build(makeCtx(0.5)));
      expect(low.triangles).toBeLessThanOrEqual(report.triangles);
      // the example states animate without throwing (no canvas in node: screens are skipped by the kit)
      const obj = model.build(makeCtx());
      for (const st of Object.values(model.states ?? {})) model.animate?.(st, obj, { time: 1.23, dt: 0.016 });
    });
  }
});

describe('Bench3D and the Workbench', () => {
  it('every kind with a place on the table has a model of exactly its footprint', () => {
    for (const [kind, size] of Object.entries(SIZES)) {
      const m = MODELS.get(modelIdOf(kind));
      expect(m, kind).toBeTruthy();
      expect(m!.footprintMm, kind).toEqual(size);
    }
  });
});

describe('Bench3D and the parts manifest', () => {
  it('maps manifest millimetres (origin top-left, y down the picture) onto the model frame and back', () => {
    const body = { w_mm: 68.58, d_mm: 53.34, h_mm: 15 };
    const t = terminalsFromManifest({ body, pins: [{ name: 'SCL', mm: { x: 21.34, y: 2.54 }, face: 'top' }, { name: 'A', mm: { x: 1, y: 53.34 }, face: 'front' }, { name: 'B', mm: { x: 3, y: 4, z: 2 }, face: 'bottom' }, { name: 'nowhere' }] });
    expect(t.map((x) => x.id)).toEqual(['SCL', 'A', 'B']);
    expect(t[0].pos[0]).toBeCloseTo(21.34 - 34.29);
    expect(t[0].pos[1]).toBe(15); // a top pin sits at the body's height
    expect(t[0].pos[2]).toBeCloseTo(2.54 - 26.67); // the back of the picture is away from the viewer
    expect(t[0].dir).toEqual([0, 1, 0]);
    expect(t[1].pos[2]).toBeCloseTo(26.67);
    expect(t[1].dir).toEqual([0, 0, 1]); // the front face looks at the viewer
    expect(t[2].pos[1]).toBe(2);
    expect(t[2].dir).toEqual([0, -1, 0]);
    const back = toManifestMm(body, fromManifestMm(body, { x: 21.34, y: 2.54 }, 'top'));
    expect([back.x, back.y, back.z].map((v) => Math.round(v * 1000) / 1000)).toEqual([21.34, 2.54, 15]);
    expect(footprintOf(body)).toEqual({ w: 68.58, d: 53.34, h: 15 });
  });
});

describe('Bench3D kit', () => {
  it('merges parts into one geometry per family, with normals and colours', () => {
    const s = new Shape();
    const top = pcb(s, { w: 40, d: 30, holes: [{ x: -16, z: -11, d: 3.2 }, { x: 16, z: 11, d: 3.2 }] });
    expect(top).toBeCloseTo(1.6);
    const pins = pinHeader(s, { x: 0, z: -11, y: top, n: 8 });
    expect(pins).toHaveLength(8);
    expect(pins[0][0]).toBeCloseTo(-3.5 * 2.54);
    expect(pins[0][1]).toBeCloseTo(top + 8.5);
    const sockets = pinHeader(s, { x: 0, z: 11, y: top, n: 6, rows: 2, female: true, turn: 1 });
    expect(sockets).toHaveLength(12);
    soic(s, { x: -8, z: 0, y: top, pins: 8 });
    qfp(s, { x: 8, z: 0, y: top, size: 7, perSide: 8 });
    electrolytic(s, { x: 15, z: -6, y: top });
    const wires = screwTerminal(s, { x: -12, z: 9, y: top, n: 2 });
    expect(wires).toHaveLength(2);
    heatsink(s, { x: 0, z: 0, y: top + 2, w: 9, d: 9, h: 6, fins: 5 });
    gear(s, { x: 14, z: 6, y0: top, y1: top + 2, r: 4, teeth: 12, bore: 2 });
    const mouth = usbC(s, { x: 0, z: 15, y: top });
    expect(mouth[2]).toBeCloseTo(15);
    const built = s.build();
    expect(Object.keys(built).sort()).toEqual(['gloss', 'matte', 'metal', 'pcb', 'soft']);
    for (const g of Object.values(built)) {
      const p = g!.getAttribute('position'), n = g!.getAttribute('normal'), c = g!.getAttribute('color');
      expect(n.count).toBe(p.count);
      expect(c.count).toBe(p.count);
      for (let i = 0; i < n.count; i += 37) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 2);
    }
    expect(s.triangles()).toBeGreaterThan(500);
    expect(s.triangles()).toBeLessThan(7000);
  });

  it('a prism with a hole is closed where it should be', () => {
    const s = new Shape();
    s.prism(...PAL.pcbGreen, [[-5, -5], [5, -5], [5, 5], [-5, 5]], 0, 2, 0, { cap: true, holes: [[[-1, -1], [1, -1], [1, 1], [-1, 1]]] });
    const g = s.build().pcb!;
    // top and underside with the hole (8 triangles each), outer walls (8), hole walls (8)
    expect(g.index!.count / 3).toBe(32);
  });
});
