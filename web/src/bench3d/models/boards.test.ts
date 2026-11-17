/**
 * The boards and the two bare Kode modules against their manifests (parts batch 5): the on-board LED lights where
 * `visuals.led.mm` is, each control of the manifest is a marked, pressable part of the model standing where
 * `controls[].mm` is (or, for the one board whose given place is taken, where its drawing has it), a ray on a
 * button finds that button's field and nothing else does, and the Robotics blocks stay inside what the manifest
 * allows.
 */
import { Box3, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import blinkManifest from '../../../../parts/esp32-blink-echo/manifest.json';
import buttonLedManifest from '../../../../parts/esp32-button-led/manifest.json';
import i2cManifest from '../../../../parts/esp32-i2c-slave/manifest.json';
import s3Manifest from '../../../../parts/esp32-s3-devkitc/manifest.json';
import ledManifest from '../../../../parts/led/manifest.json';
import roboticsManifest from '../../../../parts/kode-robotics/manifest.json';
import r3Manifest from '../../../../parts/uno-r3/manifest.json';
import minimaManifest from '../../../../parts/uno-r4-minima/manifest.json';
import wifiManifest from '../../../../parts/uno-r4-wifi/manifest.json';
import { controlOf, controlsIn, fromManifestMm, inspectModel, instantiate, makeCtx, overhangOf, part, partState, type ManifestBody, type Object3D, type PartModel, type PartState } from '../index';
import r3 from './arduino/uno-r3.model';
import minima from './arduino/uno-r4-minima.model';
import wifi from './arduino/uno-r4-wifi.model';
import { unoGeo, type UnoManifest } from './arduino/uno';
import { ledPlace, switchesOf, type Esp32Manifest } from './esp32/board';
import blink from './esp32/esp32-blink-echo.model';
import buttonLed from './esp32/esp32-button-led.model';
import i2c from './esp32/esp32-i2c-slave.model';
import s3 from './esp32/esp32-s3-devkitc.model';
import robotics from './kode/kode-robotics.model';
import led from './passives/led.model';

interface BoardManifest {
  id: string;
  body: ManifestBody;
  picture: { width: number };
  fields?: { name: string; type: string }[];
  controls?: { field: string; mode: string; mm?: { x: number; y: number }; action?: string; pin?: string; estimate?: boolean }[];
  visuals?: { id: string; x: number; y: number; mm?: { x: number; y: number } }[];
}
const asBoard = (m: unknown): BoardManifest => m as BoardManifest;
const copy = (m: PartModel<PartState>): Object3D => {
  const obj = instantiate(m.build(makeCtx()));
  obj.updateMatrixWorld(true);
  return obj;
};
/** The middle of a node's own geometry, in the model frame (x, z). */
const middle = (n: Object3D): [number, number] => {
  n.updateMatrixWorld(true);
  const c = new Box3().setFromObject(n).getCenter(new Vector3());
  return [c.x, c.z];
};
/** What the Workbench does with a pointer: a ray straight down on (x, z) against the copy's controls; the field of the control it finds. */
function fieldUnder(obj: Object3D, x: number, z: number): string | null {
  const ray = new Raycaster(new Vector3(x, 80, z), new Vector3(0, -1, 0));
  const hits = ray.intersectObjects(controlsIn(obj).map((c) => c.node), true);
  return hits.length ? (controlOf(hits[0].object)?.mark.field ?? null) : null;
}

const UNOS = [[r3, r3Manifest], [minima, minimaManifest], [wifi, wifiManifest]] as const;
const CLASSIC = [[blink, blinkManifest], [buttonLed, buttonLedManifest], [i2c, i2cManifest]] as const;

describe('Uno boards: LED and reset from the manifest', () => {
  for (const [model, raw] of UNOS) {
    const m = asBoard(raw);
    const obj = copy(model);

    it(`${m.id}: L lights where visuals.led.mm is`, () => {
      const v = m.visuals!.find((q) => q.id === 'led')!;
      expect(v.mm, 'batch 5 gives the LED its place in millimetres').toBeTruthy();
      const want = fromManifestMm(m.body, v.mm!);
      for (const name of ['l', 'halo:l']) {
        const [x, z] = middle(part(obj, name)!);
        expect(x, name).toBeCloseTo(want[0], 2);
        expect(z, name).toBeCloseTo(want[2], 2);
      }
      // the board frame is the body less its overhang: the value the model works with
      const geo = unoGeo(raw as unknown as UnoManifest);
      expect(geo.visual('led')[0]).toBeCloseTo(v.mm!.x - geo.x0, 6);
      expect(geo.visual('led')[1]).toBeCloseTo(v.mm!.y, 6);
    });

    it(`${m.id}: the reset button is the manifest's control, where controls[].mm is`, () => {
      const c = m.controls!.find((q) => q.field === 'reset')!;
      const found = controlsIn(obj);
      expect(found.map((k) => [k.node.name, k.mark.field, k.mark.mode, k.mark.values])).toEqual([['reset', 'reset', 'momentary', [false, true]]]);
      const want = fromManifestMm(m.body, c.mm!);
      expect(found[0].node.position.x).toBeCloseTo(want[0], 6);
      expect(found[0].node.position.z).toBeCloseTo(want[2], 6);
      // the plunger, the cover round it and nothing beside the switch answer the pointer
      expect(fieldUnder(obj, want[0], want[2])).toBe('reset');
      expect(fieldUnder(obj, want[0] + 2.6, want[2] - 2.6)).toBe('reset');
      expect(fieldUnder(obj, want[0] + 4.2, want[2])).toBeNull();
      expect(fieldUnder(obj, 0, 0)).toBeNull();
      // the hit area is not drawn
      expect(found[0].node.getObjectByName('hit')!.visible).toBe(false);
    });

    it(`${m.id}: a press shows: the plunger goes down and the glow comes on, and both go back`, () => {
      const cap = part(obj, 'reset')!, glow = part(obj, 'press:reset')!;
      const up = cap.position.y;
      model.animate!(partState({ fields: { reset: true } }), obj, { time: 0, dt: 0.016 });
      expect(up - cap.position.y).toBeGreaterThanOrEqual(0.4);
      expect(glow.visible).toBe(true);
      model.animate!(partState({ fields: { reset: false } }), obj, { time: 0.1, dt: 0.016 });
      expect(cap.position.y).toBeCloseTo(up);
      expect(glow.visible).toBe(false);
    });
  }

  it('reads an older manifest (no mm) from the picture, and says so when the manifest has no place at all', () => {
    const raw = structuredClone(r3Manifest) as unknown as UnoManifest;
    const k = raw.picture!.width / raw.body.w_mm;
    delete raw.visuals![0].mm;
    const geo = unoGeo(raw);
    expect(geo.visual('led')[0]).toBeCloseTo(raw.visuals![0].x! / k - geo.x0, 6);
    delete raw.controls![0].mm;
    expect(() => unoGeo(raw).control('reset')).toThrow(/reset/);
  });
});

describe('ESP32 boards: EN and BOOT from the manifest', () => {
  for (const [model, raw] of CLASSIC) {
    const m = asBoard(raw);
    it(`${m.id}: both switches stand where controls[].mm is and each answers with its own field`, () => {
      const obj = copy(model);
      const sw = switchesOf(raw, 'classic');
      expect(sw.map((s) => [s.field, s.from]).sort()).toEqual([['boot', 'manifest'], ['en', 'manifest']]);
      expect(controlsIn(obj).map((c) => c.mark.field).sort()).toEqual(m.controls!.map((c) => c.field).sort());
      for (const c of m.controls!) {
        const want = fromManifestMm(m.body, c.mm!);
        const node = controlsIn(obj).find((k) => k.mark.field === c.field)!;
        expect(node.mark.mode).toBe('momentary');
        const [x, z] = middle(node.node);
        expect(x, c.field).toBeCloseTo(want[0], 2);
        expect(z, c.field).toBeCloseTo(want[2], 2);
        expect(fieldUnder(obj, want[0], want[2])).toBe(c.field);
        expect(fieldUnder(obj, want[0] + 1.8, want[2] + 1.3)).toBe(c.field); // a corner of the switch's cover
      }
      expect(fieldUnder(obj, 0, 0)).toBeNull();
    });
  }

  it('ESP32-S3: the given places are inside the USB-C sockets, so the switches keep the drawing\'s places; the fields are the manifest\'s', () => {
    const m = asBoard(s3Manifest);
    const obj = copy(s3);
    const sw = switchesOf(s3Manifest, 's3');
    expect(sw.map((s) => [s.name, s.field, s.from])).toEqual([['rst', 'en', 'drawing'], ['boot', 'boot', 'drawing']]);
    for (const s of sw) {
      const c = m.controls!.find((q) => q.field === s.field)!;
      const given = fromManifestMm(m.body, c.mm!);
      // the reason, in numbers: a 4.2 mm switch at the given place reaches into the socket that starts 7.4 mm from the end
      expect(given[0] + 2.1).toBeGreaterThan(m.body.w_mm / 2 - 7.4);
      expect(Math.abs(given[2])).toBeGreaterThan(5.1 - 4.47);
      expect(fieldUnder(obj, s.x, s.z)).toBe(s.field);
      const [x, z] = middle(controlsIn(obj).find((k) => k.mark.field === s.field)!.node);
      expect([x, z].map((v) => Math.round(v * 100) / 100)).toEqual([s.x, s.z].map((v) => Math.round(v * 100) / 100));
    }
    // the day the manifest gives a place the board has room at, the switch stands there
    const fixed = structuredClone(s3Manifest) as unknown as Esp32Manifest;
    fixed.controls!.find((c) => c.field === 'en')!.mm = { x: 50, y: 5.6 };
    const moved = switchesOf(fixed, 's3').find((s) => s.field === 'en')!;
    expect(moved.from).toBe('manifest');
    expect([moved.x, moved.z]).toEqual([50 - m.body.w_mm / 2, 5.6 - m.body.d_mm / 2]);
  });

  it('a press shows on each switch, and only on the one that is held', () => {
    for (const [model, fields] of [[s3, ['en', 'boot']], [blink, ['en', 'boot']]] as const) {
      const obj = copy(model);
      const nodes = controlsIn(obj);
      for (const f of fields) {
        model.animate!(partState({ fields: { [f]: true } }), obj, { time: 0, dt: 0.016 });
        for (const n of nodes) {
          const held = n.mark.field === f;
          expect(n.node.position.y, `${model.id} ${f} ${n.node.name}`).toBeCloseTo(held ? -0.45 : 0);
          expect(part(obj, `press:${n.node.name}`)!.visible).toBe(held);
        }
      }
      model.animate!(partState({}), obj, { time: 0.1, dt: 0.016 });
      for (const n of nodes) expect(n.node.position.y).toBe(0);
    }
  });

  it('the board LED is where the manifest shows it: its mm when it has one, else its place in the picture', () => {
    const m = s3Manifest as unknown as Esp32Manifest;
    const v = m.visuals!.find((q) => q.id === 'led')!;
    const k = m.picture.width / m.body.w_mm;
    expect(ledPlace(m).x).toBeCloseTo(v.x / k - m.body.w_mm / 2, 6);
    const [x, z] = middle(part(copy(s3), 'led-glow')!);
    expect(x).toBeCloseTo(ledPlace(m).x, 2);
    expect(z).toBeCloseTo(ledPlace(m).z, 2);
    const withMm = structuredClone(s3Manifest) as unknown as Esp32Manifest;
    withMm.visuals!.find((q) => q.id === 'led')!.mm = { x: 40, y: 10 };
    expect(ledPlace(withMm)).toMatchObject({ x: 40 - m.body.w_mm / 2, z: 10 - m.body.d_mm / 2 });
  });
});

describe('Kode Robotics: the blocks on the batch 5 pins', () => {
  const m = roboticsManifest as unknown as { body: ManifestBody; pins: { name: string; mm?: { x: number; y: number; z?: number }; face?: 'top' }[] };
  it('every screw is on its terminal', () => {
    const obj = copy(robotics);
    for (const [pin, name] of [['MOTA_1', 'screw-a1'], ['MOTA_2', 'screw-a2'], ['MOTB_1', 'screw-b1'], ['MOTB_2', 'screw-b2']] as const) {
      const p = m.pins.find((q) => q.name === pin)!;
      const want = fromManifestMm(m.body, p.mm!, 'top');
      const [x, z] = middle(part(obj, name)!);
      expect(x, pin).toBeCloseTo(want[0], 2);
      expect(z, pin).toBeCloseTo(want[2], 2);
    }
  });
  it('the model reaches the far edge of the footprint and no further than the manifest allows', () => {
    const r = inspectModel(robotics as unknown as PartModel);
    expect(r.problems).toEqual([]);
    const allowed = -m.body.d_mm / 2 - (overhangOf(m.body).back ?? 0);
    expect(robotics.overhangMm).toEqual(overhangOf(m.body));
    expect(r.box.min[2]).toBeGreaterThanOrEqual(allowed - 0.25);
    expect(r.box.min[2]).toBeLessThan(allowed + 0.25); // the blocks stand at the edge, as far out as they may
  });
});

describe('LED with resistor (legacy part)', () => {
  it('the model reads the two things the fixed part still publishes: the field of its built-in resistor and the brightness', () => {
    const m = ledManifest as unknown as { fields: { name: string }[]; outputs: { name: string }[]; behaviour: { elements: { type: string; series_ohms?: { field: string }; output?: string }[] } };
    const diode = m.behaviour.elements.find((e) => e.type === 'diode')!;
    expect(diode.series_ohms).toEqual({ field: 'ohms' });
    expect(diode.output).toBe('brightness');
    expect(m.fields.map((f) => f.name)).toContain('ohms');
    expect(Object.keys(led.states!)).toContain('on');
    for (const st of Object.values(led.states!)) expect(Object.keys(st.fields)).toEqual(['ohms']);
  });
});
