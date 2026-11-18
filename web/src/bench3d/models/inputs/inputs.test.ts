import { Box3, type Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { controlOf, controlsIn, instantiate, makeCtx, nextValue, part, partState, turnDeg, turnValueAt, type PartModel, type PartState } from '../../index';
import antenna from './antenna.model';
import button from './push-button.model';
import buzzer from './buzzer.model';
import hdc from './hdc1080.model';
import pot from './potentiometer.model';
import slide from './slide-switch.model';
import latching from './latching-button.model';
import tact12 from './tact-12mm.model';
import tact6 from './tact-6mm.model';
import toggle from './toggle-switch.model';

const copy = (m: PartModel<PartState>) => instantiate(m.build(makeCtx()));
const settle = (m: PartModel<PartState>, obj: ReturnType<typeof copy>, st: PartState) => {
  for (let i = 0; i < 200 && m.animate!(st, obj, { time: i * 0.016, dt: 0.016 }); i++);
};

describe('inputs family: controls', () => {
  it('marks one control per manifest control, and the mark survives instantiate()', () => {
    for (const [m, name, field, mode] of [[button, 'cap', 'pressed', 'momentary'], [slide, 'lever', 'position', 'toggle'], [pot, 'knob', 'position', 'rotate'],
      [tact6, 'cap', 'pressed', 'momentary'], [tact12, 'cap', 'pressed', 'momentary'], [latching, 'cap', 'latched', 'toggle'], [toggle, 'lever', 'position', 'toggle']] as const) {
      const obj = copy(m);
      const found = controlsIn(obj);
      expect(found.map((c) => [c.node.name, c.mark.field, c.mark.mode]), m.id).toEqual([[name, field, mode]]);
      // a ray-cast hits a mesh inside the control: the mark is found from it
      expect(controlOf(found[0].node.children[0])?.node.name).toBe(name);
      expect(controlOf(obj)).toBeUndefined();
    }
    for (const m of [buzzer, hdc, antenna]) expect(controlsIn(copy(m)), m.id).toEqual([]);
  });

  it('the cap goes down while pressed and comes back', () => {
    const obj = copy(button), cap = part(obj, 'cap')!;
    const up = cap.position.y;
    settle(button, obj, partState({ fields: { pressed: true } }));
    expect(up - cap.position.y).toBeGreaterThan(0.5);
    settle(button, obj, partState({ fields: { pressed: false } }));
    expect(cap.position.y).toBeCloseTo(up);
    expect(up + 1.9).toBeCloseTo(button.footprintMm.h); // released, its top is the part's height
  });

  it('the tactile buttons go down while pressed, come back, and stand as high as the part when released', () => {
    for (const m of [button, tact6, tact12]) {
      const obj = copy(m), cap = part(obj, 'cap')!;
      const up = cap.position.y;
      settle(m, obj, partState({ fields: { pressed: true } }));
      expect(up - cap.position.y, m.id).toBeGreaterThan(0.5);
      settle(m, obj, partState({ fields: { pressed: false } }));
      expect(cap.position.y, m.id).toBeCloseTo(up);
      obj.updateMatrixWorld(true);
      expect(new Box3().setFromObject(cap).max.y, m.id).toBeCloseTo(m.footprintMm.h, 1);
    }
  });

  it('the 4-pin tactile buttons have a leg on each terminal, in two rows across the body', () => {
    for (const [m, dz] of [[tact6, 7.62], [tact12, 12.7]] as const) {
      const t = Object.fromEntries(m.terminals!.map((x) => [x.id, x.pos]));
      expect(Object.keys(t).sort(), m.id).toEqual(['A1', 'A2', 'B1', 'B2']);
      // the pairs that are one piece of metal face each other across the body; a press joins the two columns
      expect(t.A1[0], m.id).toBeCloseTo(t.A2[0]);
      expect(t.B1[0], m.id).toBeCloseTo(t.B2[0]);
      expect(t.B1[0] - t.A1[0], m.id).toBeCloseTo(5.08);
      expect(t.A2[2] - t.A1[2], m.id).toBeCloseTo(dz);
      expect(t.B2[2] - t.B1[2], m.id).toBeCloseTo(dz);
    }
  });

  it('the 12 mm cap takes the colour of its field, per copy', () => {
    const a = copy(tact12), b = copy(tact12);
    const hex = (o: typeof a) => ((part(o, 'cap')!.children[0] as Mesh).material as MeshStandardMaterial).color.getHex();
    tact12.animate!(partState({ fields: { cap: 'blue' } }), a, { time: 0, dt: 0.016 });
    tact12.animate!(partState({ fields: { cap: 'yellow' } }), b, { time: 0, dt: 0.016 });
    expect(hex(a)).not.toBe(hex(b));
    tact12.animate!(partState({ fields: { cap: 'yellow' } }), a, { time: 0, dt: 0.016 });
    expect(hex(a)).toBe(hex(b));
    tact12.animate!(partState({ fields: {} }), a, { time: 0, dt: 0.016 }); // no field yet: the manifest's default
    tact12.animate!(partState({ fields: { cap: 'red' } }), b, { time: 0, dt: 0.016 });
    expect(hex(a)).toBe(hex(b));
  });

  it('the latching button stays down while latched and a click steps it', () => {
    const obj = copy(latching), cap = part(obj, 'cap')!;
    const up = cap.position.y;
    settle(latching, obj, partState({ fields: { latched: true } }));
    expect(up - cap.position.y).toBeCloseTo(2);
    // nothing changes: it stays where it is, and the model asks for no more frames
    expect(latching.animate!(partState({ fields: { latched: true } }), obj, { time: 9, dt: 0.016 })).toBeFalsy();
    expect(up - cap.position.y).toBeCloseTo(2);
    settle(latching, obj, partState({ fields: { latched: false } }));
    expect(cap.position.y).toBeCloseTo(up);
    const mark = controlsIn(obj)[0].mark;
    expect(nextValue(mark, false)).toBe(true);
    expect(nextValue(mark, true)).toBe(false);
  });

  it('the toggle lever leans away from the pin COM is connected to', () => {
    const obj = copy(toggle), lever = part(obj, 'lever')!;
    const x = (id: string) => toggle.terminals!.find((t) => t.id === id)!.pos[0];
    // a positive turn about Z carries the lever's tip towards -X
    settle(toggle, obj, partState({ fields: { position: 'a' } }));
    expect(Math.sign(-lever.rotation.z)).toBe(-Math.sign(x('A') - x('COM')));
    settle(toggle, obj, partState({ fields: { position: 'b' } }));
    expect(Math.sign(-lever.rotation.z)).toBe(-Math.sign(x('B') - x('COM')));
    const mark = controlsIn(obj)[0].mark;
    expect(nextValue(mark, 'a')).toBe('b');
    expect(nextValue(mark, 'b')).toBe('a');
  });

  it('the lever stands at the end of the pin COM is connected to', () => {
    const obj = copy(slide), lever = part(obj, 'lever')!;
    const x = (id: string) => slide.terminals!.find((t) => t.id === id)!.pos[0];
    settle(slide, obj, partState({ fields: { position: 'a' } }));
    expect(Math.sign(lever.position.x)).toBe(Math.sign(x('A') - x('COM')));
    settle(slide, obj, partState({ fields: { position: 'b' } }));
    expect(Math.sign(lever.position.x)).toBe(Math.sign(x('B') - x('COM')));
    const mark = controlsIn(obj)[0].mark;
    expect(nextValue(mark, 'a')).toBe('b');
    expect(nextValue(mark, 'b')).toBe('a');
  });

  it('the knob turns clockwise with the value, and a pointer angle maps back to the value', () => {
    const obj = copy(pot), knob = part(obj, 'knob')!;
    const mark = controlsIn(obj)[0].mark, t = mark.turn!;
    for (const v of [0, 0.25, 0.5, 1]) {
      pot.animate!(partState({ fields: { position: v } }), obj, { time: 0, dt: 0.016 });
      const deg = turnDeg(t, v);
      expect(knob.rotation.y).toBeCloseTo((-deg * Math.PI) / 180);
      // the pointer's direction in the model frame: -Z at 0 degrees, towards +X as it turns clockwise
      const a = (deg * Math.PI) / 180;
      expect(turnValueAt(mark, Math.sin(a), -Math.cos(a))).toBeCloseTo(v);
    }
    expect(turnDeg(t, 0)).toBe(-135);
    expect(turnDeg(t, 1)).toBe(135);
    // in the dead arc towards the terminals the value sticks to the nearer end
    expect(turnValueAt(mark, -0.1, 1)).toBe(t.min);
    expect(turnValueAt(mark, 0.1, 1)).toBe(t.max);
  });
});

describe('inputs family: live state', () => {
  it('the buzzer shows rings only while it sounds', () => {
    const obj = copy(buzzer);
    const shown = () => ['wave0', 'wave1', 'wave2'].filter((n) => part(obj, n)!.visible).length;
    expect(buzzer.animate!(partState({ outputs: { hz: 0 } }), obj, { time: 0.4, dt: 0.016 })).toBeFalsy();
    expect(shown()).toBe(0);
    expect(buzzer.animate!(partState({ outputs: { hz: 880 } }), obj, { time: 0.4, dt: 0.016 })).toBe(true);
    expect(shown()).toBeGreaterThan(0);
    buzzer.animate!(partState({ outputs: { hz: 0 } }), obj, { time: 0.5, dt: 0.016 });
    expect(shown()).toBe(0);
  });

  it('pins and legs are where the manifest puts the terminals', () => {
    for (const m of [button, slide, pot, buzzer, hdc, antenna, tact6, tact12, latching, toggle]) {
      expect(m.plugMm, m.id).toBeGreaterThan(0);
      for (const t of m.terminals!) expect(t.dir, `${m.id} ${t.id}`).toEqual([0, -1, 0]);
    }
  });
});
