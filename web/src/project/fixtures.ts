/** Benches for the project tests: built with the real store and the real manifests under parts/ (Node only). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FieldValue } from '../bench/model';
import { BenchStore } from '../bench/store';
import { localTerms } from '../parts/geometry';
import type { PartManifest } from '../parts/service';
import type { ProjectInput } from './nets';

const cache = new Map<string, PartManifest>();
/** A manifest by its folder under parts/ ("led-red") or by its id ("dotbench.led-red"). */
export function manifest(id: string): PartManifest {
  const dir = id.replace(/^dotbench\./, '');
  let m = cache.get(dir);
  if (!m) {
    m = JSON.parse(readFileSync(resolve(__dirname, '../../../parts', dir, 'manifest.json'), 'utf8')) as PartManifest;
    cache.set(dir, m);
  }
  return m;
}

export class TestBench {
  readonly store = new BenchStore(null);
  /** Extra manifests (parts that are not in parts/), by id. */
  readonly extra = new Map<string, PartManifest>();
  manifestOf = (kind: string): PartManifest | undefined => this.extra.get(kind) ?? manifest(kind);
  add(dir: string, at: { x: number; z: number }, fields: Record<string, FieldValue> = {}): string {
    const m = this.extra.get(dir) ?? manifest(dir);
    const all: Record<string, FieldValue> = {};
    for (const f of m.fields ?? []) all[f.name] = f.default;
    const o = this.store.addPart(m.id, m.name.en, { ...all, ...fields }, at);
    this.store.move(o.id, at);
    return o.id;
  }
  /** Stands a legged part on a board: its leg `leg` in the hole `hole`. */
  plug(dir: string, leg: string, board: string, hole: string, fields: Record<string, FieldValue> = {}): string {
    const b = this.store.get(board)!;
    const h = localTerms(this.manifestOf(b.kind)!).find((t) => t.name === hole)!;
    const l = localTerms(this.extra.get(dir) ?? manifest(dir)).find((t) => t.name === leg)!;
    return this.add(dir, { x: b.pos.x + h.x - l.x, z: b.pos.z + h.z - l.z }, fields);
  }
  wire(from: string, to: string): void {
    if (!this.store.addWire(from, to)) throw new Error(`wire ${from} - ${to} refused`);
  }
  input(): ProjectInput {
    const st = this.store.getState();
    return { objects: st.objects, wires: st.wires, mounts: st.mounts, manifest: this.manifestOf };
  }
}

/** The guide's worked example: EXP1 through a 220 ohm resistor and a red LED to GND, on a half breadboard. */
export function ledBench(withButton = false): TestBench {
  const t = new TestBench();
  const bb = t.add('breadboard-half', { x: 120, z: 0 });
  t.plug('resistor', 'A', bb, 'a3', { ohms: 220 });
  t.plug('led-red', 'A', bb, 'b7');
  t.wire('device.EXP1', `${bb}.e3`);
  t.wire(`${bb}.e8`, 'device.GND');
  if (withButton) {
    t.plug('push-button', 'A', bb, 'c12');
    t.wire('device.EXP2', `${bb}.e12`);
    t.wire(`${bb}.e14`, `${bb}.d8`);
  }
  return t;
}

export const SERVO_SKETCH = `// Servo: a servo on pin 9 sweeps from one side to the other and back.
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(9);
}

void loop() {
  for (int a = 0; a <= 180; a += 2) {
    servo.write(a);
    delay(15);
  }
  for (int a = 180; a >= 0; a -= 2) {
    servo.write(a);
    delay(15);
  }
}
`;
/** An Uno driving a servo from pin 9, with its sketch. */
export function servoBench(): TestBench {
  const t = new TestBench();
  const uno = t.add('uno-r3', { x: 120, z: 0 });
  const servo = t.add('servo', { x: 240, z: 0 });
  t.wire(`${uno}.D9`, `${servo}.SIG`);
  t.wire(`${uno}.V5`, `${servo}.V5`);
  t.wire(`${uno}.GND_1`, `${servo}.GND`);
  t.store.setCode(uno, { files: [{ name: 'sketch.ino', text: SERVO_SKETCH }] });
  return t;
}

/** The Robotics module on the Dot's header, a DC motor on its first driver. */
export function moduleBench(side: 'upright' | 'turned' = 'upright'): TestBench {
  const t = new TestBench();
  const mod = t.add('kode-robotics', { x: 0, z: -80 });
  t.store.setMount(mod, side);
  const motor = t.add('dc-motor', { x: 120, z: 0 });
  t.wire(`${mod}.MOTA_1`, `${motor}.M1`);
  t.wire(`${mod}.MOTA_2`, `${motor}.M2`);
  return t;
}

/**
 * A busier bench: the Dot with the Robotics module on its header and a motor on it, talking to an Uno that lights three
 * LEDs through resistors on a breadboard, reads a push button, a slide switch and a potentiometer, and drives a servo.
 */
export function busyBench(): TestBench {
  const t = new TestBench();
  const mod = t.add('kode-robotics', { x: 0, z: -80 });
  t.store.setMount(mod, 'upright');
  const motor = t.add('dc-motor', { x: -120, z: -60 });
  t.wire(`${mod}.MOTA_1`, `${motor}.M1`);
  t.wire(`${mod}.MOTA_2`, `${motor}.M2`);
  const uno = t.add('uno-r3', { x: 130, z: -90 });
  const bb = t.add('breadboard-half', { x: 130, z: 20 });
  const leds = ['led-red', 'led-yellow', 'led-green'];
  ['D3', 'D5', 'D6'].forEach((pin, i) => {
    const c = 2 + i * 8;
    t.plug('resistor', 'A', bb, `a${c}`, { ohms: 220 });
    t.plug(leds[i], 'A', bb, `b${c + 4}`);
    t.wire(`${uno}.${pin}`, `${bb}.e${c}`);
  });
  // the cathode columns are chained to the Uno's ground
  t.wire(`${bb}.e7`, `${uno}.GND_1`);
  t.wire(`${bb}.d15`, `${bb}.d7`);
  t.wire(`${bb}.d23`, `${bb}.d15`);
  t.plug('push-button', 'A', bb, 'c26');
  t.wire(`${uno}.D2`, `${bb}.e26`);
  t.wire(`${bb}.e28`, `${bb}.c23`);
  const sw = t.add('slide-switch', { x: 260, z: 60 });
  t.wire(`${uno}.D4`, `${sw}.COM`);
  t.wire(`${sw}.A`, `${uno}.V5`);
  t.wire(`${sw}.B`, `${bb}.c7`);
  const servo = t.add('servo', { x: 270, z: -90 });
  t.wire(`${uno}.D9`, `${servo}.SIG`);
  t.wire(`${uno}.V5`, `${servo}.V5`);
  t.wire(`${uno}.GND_2`, `${servo}.GND`);
  const pot = t.add('potentiometer', { x: 300, z: 20 });
  t.wire(`${uno}.A0`, `${pot}.W`);
  t.wire(`${pot}.T`, `${uno}.V5`);
  t.wire(`${pot}.B`, `${bb}.a7`);
  t.wire('device.EXP3', `${uno}.D0`);
  t.wire('device.EXP4', `${uno}.D1`);
  t.wire('device.GND', `${uno}.GND_T`);
  t.store.setCode(uno, { files: [{ name: 'sketch.ino', text: SERVO_SKETCH }, { name: 'pins.h', text: '#pragma once\nconst int LED_RED = 3;\nconst int LED_YELLOW = 5;\nconst int LED_GREEN = 6;\nconst int BUTTON = 2;\n' }] });
  return t;
}
