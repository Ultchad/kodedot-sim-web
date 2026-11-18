import { describe, expect, it } from 'vitest';
import type { PartManifest } from '../parts/service';
import { TestBench, ledBench, manifest, moduleBench, servoBench } from './fixtures';
import { billOfMaterials, buildProject, classOf, faradsText, ohmsText, pinText, type Project } from './nets';

const table = (p: Project): Record<string, string[]> => Object.fromEntries(p.nets.map((n) => [n.name, n.members.map((m) => pinText(m.part, m.pin))]));
const refs = (p: Project): Record<string, string> => Object.fromEntries([...p.parts, ...p.joiners].map((x) => [x.ref, x.kind.replace('dotbench.', '')]));

describe('nets of the LED example (legs in a breadboard, wires to the Dot)', () => {
  const p = buildProject(ledBench().input());
  it('gives the three nets their names', () => {
    expect(table(p)).toEqual({
      GND: ['U1.GND', 'D1.K'],
      EXP1: ['U1.EXP1', 'R1.A'],
      N1: ['R1.B', 'D1.A'],
    });
    expect(p.nets.map((n) => n.kind)).toEqual(['ground', 'signal', 'signal']);
  });
  it('numbers the parts and keeps the breadboard out of the drawing', () => {
    expect(refs(p)).toEqual({ U1: 'kode.dot', R1: 'resistor', D1: 'led-red', BB1: 'breadboard-half' });
    expect(p.parts.map((x) => x.ref)).toEqual(['U1', 'R1', 'D1']);
    expect(p.joiners.map((x) => x.ref)).toEqual(['BB1']);
    expect(p.parts.find((x) => x.ref === 'R1')!.value).toBe('220 Ω');
    expect(p.wires).toBe(2);
  });
  it('labels only the Dot pins that are wired', () => {
    const dot = p.parts[0];
    expect(dot.pins.filter((x) => x.net).map((x) => x.label)).toEqual(['EXP1 (IO8)', 'GND']);
    expect(dot.pins.find((x) => x.name === 'EXP1')!.number).toBe(3);
  });
  it('adds a button between EXP2 and the ground column', () => {
    const q = buildProject(ledBench(true).input());
    expect(table(q)).toEqual({
      GND: ['U1.GND', 'SW1.B', 'D1.K'],
      EXP1: ['U1.EXP1', 'R1.A'],
      EXP2: ['U1.EXP2', 'SW1.A'],
      N1: ['R1.B', 'D1.A'],
    });
    const sw = q.parts.find((x) => x.ref === 'SW1')!;
    expect(sw.momentary).toBe(true);
    expect(sw.poles).toEqual([{ com: ['A'], throws: [['B']] }]);
  });
  it('does not join what only stands near: a part off the holes is on no net', () => {
    const t = ledBench();
    const led = t.store.getState().objects.find((o) => o.kind === 'dotbench.led-red')!;
    t.store.move(led.id, { x: 300, z: 120 });
    expect(table(buildProject(t.input()))).toEqual({ EXP1: ['U1.EXP1', 'R1.A'] });
  });
});

describe('nets of an Uno driving a servo', () => {
  const p = buildProject(servoBench().input());
  it('names ground, supply and the signal after the board pins', () => {
    expect(table(p)).toEqual({ GND: ['U1.GND_1', 'M1.GND'], '5V': ['U1.V5', 'M1.V5'], D9: ['U1.D9', 'M1.SIG'] });
    expect(Object.fromEntries(p.nets.map((n) => [n.name, n.kind]))).toEqual({ GND: 'ground', '5V': 'supply', D9: 'signal' });
  });
  it('leaves the unwired Dot out and marks the board as carrying a sketch', () => {
    expect(refs(p)).toEqual({ U1: 'uno-r3', M1: 'servo' });
    expect(p.parts[0].core).toBe('uno-r3');
    // the board's other two ground pins are the same net, but nothing meets them
    expect(p.parts[0].pins.filter((x) => x.net?.name === 'GND').map((x) => [x.name, x.touched])).toEqual([['GND_T', false], ['GND_1', true], ['GND_2', false]]);
  });
  it('keeps two grounds that do not meet apart', () => {
    const t = servoBench();
    const led = t.add('led-red', { x: 300, z: 100 });
    t.wire('device.GND', `${led}.K`);
    t.wire('device.EXP3', `${led}.A`);
    const q = buildProject(t.input());
    expect(Object.keys(table(q)).sort()).toEqual(['5V', 'D9', 'EXP3', 'GND', 'GND_2']);
    expect(table(q).GND).toEqual(['U1.GND', 'D1.K']);
    expect(table(q).GND_2).toEqual(['U2.GND_1', 'M1.GND']);
  });
});

describe('a module on the header', () => {
  it('joins every module pin to its header position', () => {
    const p = buildProject(moduleBench().input());
    const t = table(p);
    expect(refs(p)).toEqual({ U1: 'kode.dot', U2: 'kode-robotics', M1: 'dc-motor' });
    expect(t.EXP1).toEqual(['U1.EXP1', 'U2.SCL']);
    expect(t.EXP4).toEqual(['U1.EXP4', 'U2.SERVO']);
    expect(t['5V'].slice(0, 2)).toEqual(['U1.5V', 'U2.V5']);
    expect(t.GND[0]).toBe('U1.GND');
    expect(t.N1).toEqual(['U2.MOTA_1', 'M1.M1']);
    expect(t.N2).toEqual(['U2.MOTA_2', 'M1.M2']);
    expect(p.nets.filter((n) => /^EXP/.test(n.name))).toHaveLength(14);
  });
  it('turned, position p meets 15 - p', () => {
    const t = table(buildProject(moduleBench('turned').input()));
    expect(t.EXP14).toEqual(['U1.EXP14', 'U2.SCL']);
    expect(t['5V'].slice(0, 2)).toEqual(['U1.5V', 'U2.V5']);
  });
  it('a breadboard module only joins: an LED across its holes is wired to the Dot', () => {
    const t = new TestBench();
    const maker = t.add('kode-maker', { x: 0, z: -90 });
    t.store.setMount(maker, 'upright');
    const led = t.add('led-red', { x: 150, z: 0 });
    t.wire(`${maker}.S1`, `${led}.A`);
    t.wire(`${maker}.GL_1`, `${led}.K`);
    const p = buildProject(t.input());
    expect(p.joiners.map((x) => x.kind)).toEqual(['dotbench.kode-maker']);
    const got = table(p);
    expect(got.GND).toEqual(['U1.GND', 'D1.K']);
    expect(Object.values(got).some((m) => m.length === 2 && m[1] === 'D1.A' && /^U1\.EXP\d+$/.test(m[0]))).toBe(true);
  });
});

describe('symbols, designators, values', () => {
  it('knows each library part', () => {
    const cls = (id: string) => classOf(manifest(id));
    expect(cls('resistor')).toBe('resistor');
    expect(cls('capacitor-ceramic')).toBe('capacitor');
    expect(cls('capacitor-electrolytic')).toBe('capacitor-pol');
    expect(cls('diode')).toBe('diode');
    expect(cls('led')).toBe('led');
    expect(cls('led-blue')).toBe('led');
    expect(cls('rgb-led')).toBe('rgb-led');
    expect(cls('push-button')).toBe('switch');
    expect(cls('slide-switch')).toBe('switch');
    expect(cls('potentiometer')).toBe('potentiometer');
    expect(cls('buzzer')).toBe('buzzer');
    expect(cls('dc-motor')).toBe('motor');
    expect(cls('servo')).toBe('servo');
    expect(cls('relay-module')).toBe('relay');
    expect(cls('battery-9v')).toBe('cell');
    expect(cls('uno-r3')).toBe('board');
    expect(cls('esp32-s3-devkitc')).toBe('board');
    expect(cls('kode-robotics')).toBe('module');
    expect(cls('kode-maker')).toBe('join');
    expect(cls('breadboard-full')).toBe('join');
    expect(cls('hdc1080')).toBe('block');
    expect(cls('l298n')).toBe('block');
    expect(cls('antenna')).toBe('block');
  });
  it('numbers each family on its own, in the order the parts came', () => {
    const t = new TestBench();
    for (const [i, d] of ['resistor', 'led-red', 'resistor', 'capacitor-ceramic', 'push-button', 'slide-switch', 'potentiometer', 'buzzer', 'dc-motor', 'servo', 'relay-module', 'battery-9v', 'uno-r3', 'hdc1080', 'capacitor-electrolytic', 'rgb-led', 'diode'].entries()) t.add(d, { x: 100 + i * 60, z: 100 });
    const p = buildProject(t.input());
    expect(refs(p)).toEqual({
      U1: 'uno-r3', U2: 'hdc1080', K1: 'relay-module', M1: 'servo', M2: 'dc-motor', BT1: 'battery-9v', SW1: 'push-button', SW2: 'slide-switch', RV1: 'potentiometer',
      R1: 'resistor', R2: 'resistor', C1: 'capacitor-ceramic', C2: 'capacitor-electrolytic', D1: 'diode', D2: 'led-red', D3: 'rgb-led', BZ1: 'buzzer',
    });
    expect(p.nets).toEqual([]);
    const value = (ref: string) => p.parts.find((x) => x.ref === ref)!.value;
    expect([value('R1'), value('C1'), value('C2'), value('RV1'), value('BT1'), value('D3')]).toEqual(['330 Ω', '100 nF', '100 µF', '10 kΩ', '9 V', '220 Ω']);
    const bom = billOfMaterials(p);
    expect(bom.find((l) => l.part.kind === 'dotbench.resistor')).toMatchObject({ refs: ['R1', 'R2'], qty: 2, value: '330 Ω' });
  });
  it('writes values the way they are read', () => {
    expect([ohmsText(220), ohmsText(4700), ohmsText(1e6), ohmsText(1500)]).toEqual(['220 Ω', '4.7 kΩ', '1 MΩ', '1.5 kΩ']);
    expect([faradsText(0.1), faradsText(100), faradsText(0.000022)]).toEqual(['100 nF', '100 µF', '22 pF']);
  });
  it('reads the contacts of buttons it has never seen (4 pins, change-over, two poles)', () => {
    const base = manifest('push-button');
    const make = (id: string, pins: string[], extra: Partial<PartManifest>): PartManifest => ({ ...base, id, pins: pins.map((name) => ({ name, kind: 'io' })), ...extra });
    const tact = make('x.tact', ['A1', 'A2', 'B1', 'B2'], { groups: [{ pins: ['A1', 'A2'] }, { pins: ['B1', 'B2'] }], behaviour: { type: 'declarative', elements: [{ type: 'switch', a: 'A1', b: 'B1' }] } });
    const latch = make('x.latch', ['NC1', 'COM1', 'NO1', 'NC2', 'COM2', 'NO2'], {
      fields: [{ name: 'latched', type: 'boolean', default: false }],
      controls: [{ field: 'latched', mode: 'toggle' }],
      behaviour: { type: 'declarative', elements: [{ type: 'switch', a: 'COM1', b: 'NC1' }, { type: 'switch', a: 'COM1', b: 'NO1' }, { type: 'switch', a: 'COM2', b: 'NC2' }, { type: 'switch', a: 'COM2', b: 'NO2' }] },
    });
    const t = new TestBench();
    t.extra.set('x.tact', tact).set('x.latch', latch);
    const a = t.add('x.tact', { x: 100, z: 0 }), b = t.add('x.latch', { x: 160, z: 0 });
    t.wire('device.EXP5', `${a}.A2`);
    t.wire('device.GND', `${a}.B1`);
    t.wire('device.EXP6', `${b}.COM1`);
    const p = buildProject(t.input());
    const [sw1, sw2] = p.parts.filter((x) => x.cls === 'switch');
    expect(sw1.poles).toEqual([{ com: ['A1', 'A2'], throws: [['B1', 'B2']] }]);
    expect(sw1.momentary).toBe(true);
    // both pins of a side are the same net; the checklist names the one that is wired
    expect(sw1.pins.map((x) => x.net?.name)).toEqual(['EXP5', 'EXP5', 'GND', 'GND']);
    expect(table(p).EXP5).toEqual(['U1.EXP5', 'SW1.A2']);
    expect(sw2.poles).toEqual([{ com: ['COM1'], throws: [['NC1'], ['NO1']] }, { com: ['COM2'], throws: [['NC2'], ['NO2']] }]);
    expect(sw2.momentary).toBe(false);
  });
});
