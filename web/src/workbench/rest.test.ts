/**
 * Nothing under the table, ever: every library part standing alone, and the Dot with each of the five Kode modules in
 * every orientation its manifest allows, placed the way the Workbench places them (rest.ts), with every vertex of the
 * model at or above the table plane (0.1 mm tolerance).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../bench3d/contract';
import { MODELS } from '../bench3d/registry';
import { mountMatrix, type GeoManifest, type MountGeo } from '../parts/geometry';
import { DOT, DOT_POSES, dotCentreHeight, dotToTable, type DotPose } from './layout';
import { LYING, dotCorners, hullCorners, lowestY, poseFrame, restTilt, restingQuat, standLift, transformed, vertexCloud } from './rest';

const TOL = 0.1;
const PARTS = resolve(__dirname, '../../../parts');
type Manifest = GeoManifest & { mount?: MountGeo & { orientations?: ('upright' | 'turned')[] } };
const manifests: Manifest[] = readdirSync(PARTS)
  .filter((d) => existsSync(resolve(PARTS, d, 'manifest.json')))
  .map((d) => JSON.parse(readFileSync(resolve(PARTS, d, 'manifest.json'), 'utf8')) as Manifest);
const MODULES = ['dotbench.kode-maker', 'dotbench.kode-robotics', 'dotbench.kode-camera-shape', 'dotbench.kode-mesh-shape', 'dotbench.kode-hacking-shape'];
const CORNERS = dotCorners(DOT.hw, DOT.hd, DOT.h / 2, -DOT.h / 2);

const cloudOf = (id: string) => vertexCloud(MODELS.get(id)!.build(makeCtx()));
const minY = (pts: Float32Array) => {
  let low = Infinity;
  for (let i = 1; i < pts.length; i += 3) low = Math.min(low, pts[i]);
  return low;
};

/** The Dot with a module, as world.ts poses it with no hand on it: the attitude, how high its centre is, and the tilt. */
function assembly(m: Manifest, side: 'upright' | 'turned', pose: DotPose = 'lying') {
  const mat = mountMatrix(m.body, m.mount, side)!;
  const cloud = transformed(cloudOf(m.id), mat); // every vertex of the module, in the Dot's frame
  const hull = transformed(hullCorners(cloudOf(m.id)), mat); // what the scene keeps of it
  const frame = poseFrame(pose);
  const rest = restTilt([CORNERS, hull], frame.up, frame.along);
  const quat = restingQuat(frame, null, 0, rest, new Quaternion());
  const y = -Math.min(lowestY(CORNERS, quat), lowestY(hull, quat));
  const world = (pts: Float32Array) => {
    const out = new Float32Array(pts.length);
    const v = new Vector3();
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(quat);
      out[i] = v.x;
      out[i + 1] = v.y + y;
      out[i + 2] = v.z;
    }
    return out;
  };
  return { rest, y, module: world(cloud), dot: world(CORNERS), cloud };
}

describe('nothing under the table', () => {
  it('has a model for every Kode module and knows the library', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(39);
    for (const id of MODULES) expect(MODELS.has(id), id).toBe(true);
  });

  for (const m of manifests) {
    const model = MODELS.get(m.id);
    it(`${m.id} alone stands on the table`, () => {
      // a part without a model of its own gets a flat board made from its manifest (parts/fallbackModel.ts): from y = 0 up
      if (!model) return;
      const cloud = vertexCloud(model.build(makeCtx()));
      const low = minY(cloud) + standLift(model.plugMm);
      expect(low, `lowest vertex ${low.toFixed(3)} mm`).toBeGreaterThanOrEqual(-TOL);
      // and it stands on it: nothing hovers
      expect(low, `lowest vertex ${low.toFixed(3)} mm`).toBeLessThan(1.5);
    });
  }

  for (const pose of DOT_POSES) {
    it(`the Dot alone, ${pose}, rests on the table`, () => {
      const q = restingQuat(poseFrame(pose), null, 0, 0, new Quaternion());
      expect(-lowestY(CORNERS, q)).toBeCloseTo(dotCentreHeight(pose), 4);
      // the same rotation the table's numbers are made from: the top edge's middle is where layout.ts says
      const top = new Vector3(0, DOT.hd, 0).applyQuaternion(q), want = dotToTable(pose, 0, DOT.hd, 0);
      expect(top.x).toBeCloseTo(want.x, 4);
      expect(top.y + dotCentreHeight(pose)).toBeCloseTo(want.y, 4);
      expect(top.z).toBeCloseTo(want.z, 4);
    });
  }

  for (const pose of DOT_POSES) for (const id of MODULES) {
    const m = manifests.find((x) => x.id === id)!;
    for (const side of m.mount?.orientations ?? ['upright']) {
      it(`the Dot ${pose} with ${id} mounted ${side} rests on the table`, () => {
        const a = assembly(m, side, pose);
        const low = Math.min(minY(a.module), minY(a.dot));
        expect(minY(a.module), `module lowest ${minY(a.module).toFixed(3)} mm`).toBeGreaterThanOrEqual(-TOL);
        expect(minY(a.dot), `Dot lowest ${minY(a.dot).toFixed(3)} mm`).toBeGreaterThanOrEqual(-TOL);
        expect(low).toBeLessThan(TOL); // it touches: the assembly is not hovering
        // the Dot itself always has a point on the table (its back, or its bottom edge when the module props it up)
        expect(minY(a.dot)).toBeLessThan(TOL);
        if (a.rest > 1e-4) {
          // propped up: the module touches too, away from the Dot's bottom edge, so the stack lies on two lines
          expect(minY(a.module)).toBeLessThan(TOL);
          expect(a.rest).toBeLessThan(0.5);
        }
        // and however the hand tips it and turns it, the lowest point of the whole assembly is what is put on the table
        const frame = poseFrame(pose);
        for (const [pitch, roll, heading] of [[40, 0, 0], [-30, 55, 120], [75, -75, 250]]) {
          const tilt = new Quaternion().setFromEuler(new Euler((pitch * Math.PI) / 180, (roll * Math.PI) / 180, 0, 'YXZ'));
          const q = restingQuat(frame, tilt, heading, a.rest, new Quaternion());
          const hull = transformed(hullCorners(cloudOf(m.id)), mountMatrix(m.body, m.mount, side)!);
          const y = -Math.min(lowestY(CORNERS, q), lowestY(hull, q));
          expect(lowestY(a.cloud, q) + y, `tipped ${pitch}, ${roll}, turned ${heading}`).toBeGreaterThanOrEqual(-TOL);
        }
      });
    }
  }

  it('the hull kept by the scene is as low as the whole model, however the Dot is tipped', () => {
    const m = manifests.find((x) => x.id === 'dotbench.kode-mesh-shape')!;
    const mat = mountMatrix(m.body, m.mount, 'upright')!;
    const cloud = transformed(cloudOf(m.id), mat), hull = transformed(hullCorners(cloudOf(m.id)), mat);
    expect(hull.length).toBeLessThan(cloud.length / 4);
    for (const [ax, ang] of [[new Vector3(1, 0, 0), 0.7], [new Vector3(0, 1, 0), -1.1], [new Vector3(0.4, 0.5, 0.76).normalize(), 2.3]] as const) {
      const q = LYING.clone().multiply(new Quaternion().setFromAxisAngle(ax, ang));
      expect(lowestY(hull, q)).toBeCloseTo(lowestY(cloud, q), 4);
    }
  });
});

describe('how a module sits on the Dot', () => {
  const up = (id: string, side: 'upright' | 'turned') => {
    const m = manifests.find((x) => x.id === id)!;
    const mat = mountMatrix(m.body, m.mount, side)!;
    return [mat[4], mat[5], mat[6]]; // where the model's +Y (up from its own table side) points in the Dot's frame
  };
  it('flat modules: upright has the component side on the screen side, turned on the back', () => {
    for (const id of MODULES.slice(0, 3)) {
      expect(up(id, 'upright'), id).toEqual([0, 0, 1]);
      expect(up(id, 'turned'), id).toEqual([0, 0, -1]);
    }
  });
  it('flat modules lie past the Dot\'s top edge, in its plane, clear of the table when upright', () => {
    for (const id of MODULES.slice(0, 3)) {
      const a = assembly(manifests.find((x) => x.id === id)!, 'upright');
      expect(a.rest, id).toBe(0);
      expect(a.y, id).toBeCloseTo(DOT.h / 2);
      // in the Dot's frame the board is beyond the top wall (a little of the pins is in the header) and inside the Dot's thickness
      let y0 = Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < a.cloud.length; i += 3) {
        y0 = Math.min(y0, a.cloud[i + 1]);
        z0 = Math.min(z0, a.cloud[i + 2]);
        z1 = Math.max(z1, a.cloud[i + 2]);
      }
      expect(y0, id).toBeGreaterThan(DOT.hd - 9);
      expect(z0, id).toBeGreaterThan(-DOT.h / 2);
      expect(z1, id).toBeLessThan(DOT.h / 2 + 0.5);
    }
  });
  it('the cased radio modules stand with their antennas along the Dot, tongue on its back, and prop its top end up', () => {
    for (const id of MODULES.slice(3)) {
      expect(up(id, 'upright'), id).toEqual([0, 1, 0]);
      const a = assembly(manifests.find((x) => x.id === id)!, 'upright');
      expect(a.rest, id).toBeGreaterThan(0.1); // the tongue is under the Dot's upper half: the top edge is lifted
      expect(a.rest, id).toBeLessThan(0.45);
    }
  });
  it('a part with legs stands on them', () => {
    expect(standLift(undefined)).toBe(0);
    expect(standLift(6)).toBe(6);
  });
});
