import { describe, expect, it } from 'vitest';
import { BACK_FEATURES_ESTIMATE, SIDE_FEATURES_ESTIMATE, backProfile, bodyDims, loopArea, loopBounds } from '../lib/bodyModel';
import { ATLAS_MM, uvBack, uvFront, uvWall, wallAlong } from './atlas';
import { buildBodyMesh, outlineStations } from './bodyMesh';
import { backOpenings, frontOpenings, frontParts, offsetLoop, wallOpenings } from './features';
import { MeshBuilder, openEdgeList, type MeshData } from './meshBuilder';
import { buildButton, buildDpadArm, buildGlass, buildLed, buildPad, buildScreen, buildScrew, buildWindow, dpadTop } from './parts';
import { footprint } from './stage';

const d = bodyDims();

function check(m: MeshData) {
  const nv = m.positions.length / 3;
  expect(m.normals.length).toBe(nv * 3);
  expect(m.uvs.length).toBe(nv * 2);
  expect(m.colors.length).toBe(nv * 3);
  for (let i = 0; i < nv; i++) {
    expect(Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2])).toBeCloseTo(1, 4);
    for (let k = 0; k < 3; k++) expect(Number.isFinite(m.positions[i * 3 + k])).toBe(true);
  }
  for (const i of m.indices) expect(i).toBeLessThan(nv);
}

/** Share of triangles whose geometric normal agrees with their vertex normals. */
function agreeing(m: MeshData): number {
  let ok = 0;
  const P = (i: number, k: number) => m.positions[i * 3 + k];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const u = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)];
    const w = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)];
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    let s = 0;
    for (const v of [a, b, c]) s += g[0] * m.normals[v * 3] + g[1] * m.normals[v * 3 + 1] + g[2] * m.normals[v * 3 + 2];
    if (s > 0) ok++;
  }
  return ok / (m.indices.length / 3);
}

describe('mesh builder', () => {
  it('triangulates a polygon with a hole and keeps collinear boundary vertices', () => {
    const mb = new MeshBuilder();
    const outer = [[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]].map(([x, y]) => mb.vertex([x, y, 0], [0, 0, 1])); // (2,0) is collinear
    const hole = [[1, 1], [1, 3], [3, 3], [3, 1]].map(([x, y]) => mb.vertex([x, y, 0], [0, 0, 1]));
    mb.polygon(outer, [hole], (p) => [p[0], p[1]], [0, 0, 1]);
    const m = mb.build();
    let area = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const ax = m.positions[a * 3], ay = m.positions[a * 3 + 1];
      area += ((m.positions[b * 3] - ax) * (m.positions[c * 3 + 1] - ay) - (m.positions[c * 3] - ax) * (m.positions[b * 3 + 1] - ay)) / 2;
    }
    expect(area).toBeCloseTo(16 - 4, 9); // all triangles counter-clockwise, hole left open
    expect(new Set(m.indices).size).toBe(9); // every vertex is used, the collinear one too
  });
  it('lathe makes a closed cone with outward normals', () => {
    const mb = new MeshBuilder();
    mb.lathe([[2, 0], [0, 3]], 24);
    const m = mb.build();
    check(m);
    expect(agreeing(m)).toBe(1);
  });
});

describe('body shell', () => {
  const body = buildBodyMesh(d);
  it('has sane attributes and a modest triangle count', () => {
    check(body);
    const tris = body.indices.length / 3;
    expect(tris).toBeGreaterThan(3000);
    expect(tris).toBeLessThan(20000);
  });
  it('is watertight: the only open edges are the hidden bottoms of the pockets that hold an insert', () => {
    const prof = backProfile(d);
    const inPocket = ([x, y, z]: number[]) => {
      const front = Math.abs(z - (d.zf - 0.9)) < 0.01; // under the glass and the light guide
      const win = Math.abs(x - (d.hw - 0.8)) < 0.01; // behind the side window
      const back = z - prof.z(y) > 0.4 && z - prof.z(y) < 1.3; // under the pads and the screw
      return front || win || back;
    };
    const stray = openEdgeList(body).filter((p) => !inPocket(p));
    expect(stray).toEqual([]);
  });
  it('every triangle faces the way its normals point', () => {
    expect(agreeing(body)).toBe(1);
  });
  it('stays inside the bounding box of the data and touches it', () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < body.positions.length; i += 3) {
      x0 = Math.min(x0, body.positions[i]); x1 = Math.max(x1, body.positions[i]);
      y0 = Math.min(y0, body.positions[i + 1]); y1 = Math.max(y1, body.positions[i + 1]);
      z0 = Math.min(z0, body.positions[i + 2]); z1 = Math.max(z1, body.positions[i + 2]);
    }
    expect(x0).toBeCloseTo(-d.hw, 5); expect(x1).toBeCloseTo(d.hw, 5);
    expect(y0).toBeCloseTo(-d.hh, 5); expect(y1).toBeCloseTo(d.hh, 5);
    expect(z0).toBeCloseTo(d.zb, 5); expect(z1).toBeCloseTo(d.zf, 5);
  });
  it('tapers: the back edge is further forward at the bottom than in the middle, and a little at the top', () => {
    const prof = backProfile(d);
    expect(prof.z(-d.hh + d.rearFillet)).toBeGreaterThan(d.zb + 3);
    expect(prof.z(d.hh - d.rearFillet)).toBeGreaterThan(d.zb + 1);
    expect(prof.z(0)).toBe(d.zb);
  });
  it('UVs stay on the sheet and the islands do not overlap', () => {
    for (const v of body.uvs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const f = [uvFront(d, -d.hw, -d.hh), uvFront(d, d.hw, d.hh)];
    const b = [uvBack(d, d.hw, -d.hh), uvBack(d, -d.hw, d.hh)];
    expect(f[1][0]).toBeLessThan(b[0][0]); // front island ends before the back island starts
    expect(f[1][1]).toBeLessThan(uvWall(0, 0, d.zb)[1]); // wall rows are above both
    expect(uvWall(0, wallAlong(d, 0, d.hh - d.cornerR) + 7, 0)[0]).toBeLessThan(uvWall(1, 0, 0)[0]);
    expect(uvWall(1, 0, d.zf)[1]).toBeLessThan(uvWall(2, 0, d.zb)[1]);
    // 1 mm is the same UV distance on every island
    expect(uvFront(d, 1, 0)[0] - uvFront(d, 0, 0)[0]).toBeCloseTo(1 / ATLAS_MM, 9);
    expect(uvWall(2, 0, 1)[1] - uvWall(2, 0, 0)[1]).toBeCloseTo(1 / ATLAS_MM, 9);
    expect(uvBack(d, 0, 1)[1] - uvBack(d, 0, 0)[1]).toBeCloseTo(1 / ATLAS_MM, 9);
  });
  it('outline stations go once round, counter-clockwise, on the outline', () => {
    const st = outlineStations(d, backProfile(d).breaks);
    expect(loopArea(st.map((s) => [s.x, s.y]))).toBeGreaterThan(0);
    for (const s of st) {
      expect(Math.hypot(s.nx, s.ny)).toBeCloseTo(1, 9);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(d.hw + 1e-9);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(d.hh + 1e-9);
    }
    expect(st.filter((s) => s.sideStart).length).toBe(4);
  });
});

describe('features', () => {
  it('front openings are clear of the fillet and of each other', () => {
    const f = frontOpenings(d);
    const boxes = Object.values(f).map((r) => loopBounds(r.loop)).concat(loopBounds(d.lanyard.loop));
    const lim = { x: d.hw - d.frontFillet, y: d.hh - d.frontFillet };
    for (const b of boxes) {
      expect(b.x0).toBeGreaterThan(-lim.x);
      expect(b.x1).toBeLessThan(lim.x);
      expect(b.y0).toBeGreaterThan(-lim.y);
      expect(b.y1).toBeLessThan(lim.y);
    }
    for (const r of Object.values(f)) expect(loopArea(r.loop)).toBeGreaterThan(0);
  });
  it('wall features sit on the flat part of their wall', () => {
    const w = wallOpenings(d);
    const zMax = d.zf - d.frontFilletDepth;
    const zMin = d.zb + 3.75 + d.rearFillet + 0.5;
    for (const r of [w.windowRecess, ...w.grille, w.slot, ...w.connector]) {
      const b = loopBounds(r.loop);
      expect(b.y1).toBeLessThan(zMax);
      expect(b.y0).toBeGreaterThan(zMin);
    }
    expect(w.grille.length).toBe(16);
    expect(w.connector.length).toBe(20);
    expect(SIDE_FEATURES_ESTIMATE.window.h).toBeGreaterThan(SIDE_FEATURES_ESTIMATE.window.w);
  });
  it('back: five pads in a row inside the pill, the first (silver) towards +X; the debossed panel is plain', () => {
    const b = backOpenings();
    expect(b.pads.length).toBe(5);
    for (let i = 1; i < 5; i++) expect(b.pads[i][0]).toBeLessThan(b.pads[i - 1][0]);
    const pill = loopBounds(b.pogo.loop);
    for (const [x, y] of b.pads) {
      expect(x - BACK_FEATURES_ESTIMATE.pogo.padD / 2).toBeGreaterThan(pill.x0);
      expect(x + BACK_FEATURES_ESTIMATE.pogo.padD / 2).toBeLessThan(pill.x1);
      expect(y).toBeCloseTo(BACK_FEATURES_ESTIMATE.pogo.y, 9);
    }
    expect(b.deboss.inner).toBeUndefined(); // nothing is drawn in it
  });
  it('offsetLoop grows and shrinks a loop', () => {
    const p = frontParts(d).bezel;
    expect(loopArea(offsetLoop(p, 0.5))).toBeGreaterThan(loopArea(p));
    expect(loopArea(offsetLoop(p, -0.5))).toBeLessThan(loopArea(p));
  });
});

describe('parts', () => {
  it('all parts have sane attributes and outward faces', () => {
    const b = buildButton('top', d);
    for (const m of [buildGlass(d), buildScreen(d), buildLed(d), buildWindow(d), buildPad(0, d), buildScrew(d), b.body, b.inlay, buildDpadArm(d)]) {
      check(m);
      expect(agreeing(m)).toBeGreaterThan(0.999);
    }
  });
  it('screen quad: UV (0,0) bottom-left, (1,1) top-right, flat, centred on its own origin', () => {
    const s = buildScreen(d);
    for (let i = 0; i < s.positions.length / 3; i++) {
      const x = s.positions[i * 3], y = s.positions[i * 3 + 1];
      expect(s.positions[i * 3 + 2]).toBe(0);
      expect(s.uvs[i * 2]).toBeCloseTo(x / d.screen.w + 0.5, 6);
      expect(s.uvs[i * 2 + 1]).toBeCloseTo(y / d.screen.h + 0.5, 6);
    }
  });
  it('buttons stand proud; the red inlay is the small one', () => {
    const t = buildButton('top', d), b = buildButton('bottom', d);
    const maxR = (m: MeshData) => { let r = 0; for (let i = 0; i < m.positions.length; i += 3) r = Math.max(r, Math.hypot(m.positions[i], m.positions[i + 1])); return r; };
    const maxZ = (m: MeshData) => { let z = -Infinity; for (let i = 2; i < m.positions.length; i += 3) z = Math.max(z, m.positions[i]); return z; };
    expect(maxR(t.body)).toBeCloseTo(d.buttons.top.r, 6);
    expect(maxR(b.inlay)).toBeLessThan(maxR(t.inlay) * 0.7);
    expect(maxZ(t.body)).toBeCloseTo(t.height, 6);
    expect(t.height).toBeGreaterThan(0.8);
  });
  it('d-pad arm covers a quarter of the cross and four of them meet on the diagonals', () => {
    const a = buildDpadArm(d);
    let maxX = 0, top = 0;
    for (let i = 0; i < a.positions.length; i += 3) {
      const x = a.positions[i], y = a.positions[i + 1];
      expect(Math.abs(y)).toBeLessThanOrEqual(x + 1e-6); // inside the wedge between the diagonals
      maxX = Math.max(maxX, x);
      top = Math.max(top, a.positions[i + 2]);
    }
    expect(maxX).toBeCloseTo(d.dpad.half, 6);
    expect(top).toBeCloseTo(dpadTop(d.dpad.half, 0), 6);
    expect(dpadTop(0, 0)).toBeLessThan(dpadTop(d.dpad.half, 0)); // dished
  });
});

describe('ground shadow footprint', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  it('upright: as wide as the body, as deep as its depth', () => {
    const f = footprint(I, d);
    expect(f.a).toBeCloseTo(d.hw, 6);
    expect(f.b).toBeCloseTo(d.depth / 2, 6);
    expect(Math.abs(Math.sin(f.angle))).toBeCloseTo(0, 6);
    expect(f.lowest).toBeCloseTo(-d.hh, 6);
  });
  it('turned a quarter about the vertical: the long axis follows', () => {
    const c = 0, s = 1; // rotation about +Y by 90 degrees
    const f = footprint([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1], d);
    expect(f.a).toBeCloseTo(d.hw, 6);
    expect(Math.abs(Math.cos(f.angle))).toBeCloseTo(0, 6);
  });
});
