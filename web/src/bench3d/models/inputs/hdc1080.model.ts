/**
 * HDC1080 breakout: a small I2C temperature and humidity board of the usual purple kind (GY-213V / CJMCU-1080 layout,
 * drawn at the 20 x 12 mm of parts/hdc1080/manifest.json): the sensor in its 3 x 3 x 0.75 mm 6-pad DFN, two 0603
 * pull-ups above SDA and SCL, a 0603 decoupling capacitor between VCC and GND, a power LED with its resistor, two
 * 2.2 mm mounting holes, and a four-pin 2.54 mm header whose pins are the manifest's terminals, named in silkscreen.
 * The manifest's height (3 mm) leaves no room for a header's plastic under the board, so the board lies on the
 * seating plane and the pins are soldered straight through it.
 * Live state: the power LED (`pwr`) is lit while the part is powered (the sensor itself shows nothing).
 */
import manifestJson from '../../../../../parts/hdc1080/manifest.json';
import {
  INK, PAL, Shape, circleLoop, defineModel, footprintOf, lamp, pad, partState, pcb, pinLabels, print, setLamp, silkBox, terminalsFromManifest, text, topQuad,
  type Finish, type PartState,
} from '../../index';
import { asManifest, chip2 } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D } = footprintOf(manifest.body);
const LEGS = 6; // the long side of a header pin
const PURPLE: Finish = ['pcb', '#56308f']; // candidate for PAL (pcbPurple)
const ADDRESS = Number(manifest.behaviour?.elements?.find((e) => e.type === 'i2c_slave')?.address ?? 0x40);
const NAME = manifest.name.en.split(' ')[0];

// the header row is where the manifest puts it; everything else is laid out from the board's edges
const ROW_Z = terminals[0].pos[2];
const PITCH_X = terminals[1].pos[0] - terminals[0].pos[0];
const pin = (id: string): number => terminals.find((t) => t.id === id)?.pos[0] ?? 0;
const U1 = { x: 0, z: -D / 2 + 3.1, size: 3 };
const HOLES = [-1, 1].map((sx) => ({ x: sx * (W / 2 - 2.4), z: -D / 2 + 2.6, d: 2.2 }));
const PARTS_Z = 0.5; // the row of passives between the sensor and the header
const LED = { x: W / 2 - 4.5, z: PARTS_Z - 0.3 }, R3 = { x: W / 2 - 2.0, z: PARTS_Z - 0.3 };
const GREEN = 0x3fe06c;

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    const top = pcb(s, { w: W, d: D, y: 0, r: 1.2, finish: PURPLE, holes: HOLES.map((h) => ({ ...h, plated: false })) });
    for (const h of HOLES) s.prism(...PAL.gold, circleLoop(h.x, h.z, h.d / 2 + 0.75, ctx.seg(18)), top, top + 0.04, 0, { holes: [circleLoop(h.x, h.z, h.d / 2, 14)], ao: 1 });
    // header: a pad (square for pin 1), the pin through it, a solder fillet
    terminals.forEach((t, i) => {
      const [x, , z] = t.pos;
      if (i === 0) s.box(...PAL.gold, x, z, 1.8, 1.8, top, top + 0.04, 0.15, 0, { ao: 1 });
      else pad(s, x, z, top, 1.8, 0.9, PAL.gold);
      s.lathe(...PAL.tin, x, z, [[0.78, top + 0.04], [0.56, top + 0.3], [0.44, top + 0.52], [0, top + 0.52]], ctx.seg(8));
      s.box(...PAL.gold, x, z, 0.64, 0.64, -LEGS, top + 0.85, 0.06, 0.16, { cap: true, ao: 0.95 });
    });
    // the sensor: a DFN with three pads down each side and its pin 1 dot
    s.box(...PAL.epoxyBlack, U1.x, U1.z, U1.size, U1.size, top + 0.03, top + 0.75, 0.15, 0.08, { ao: 0.95 });
    s.disc('matte', '#3a3a3f', U1.x - 0.95, U1.z + 0.95, 0.22, top + 0.75, top + 0.765, 0, 8, { ao: 1 });
    for (const sx of [-1, 1]) for (let i = -1; i <= 1; i++) s.box(...PAL.tin, U1.x + sx * (U1.size / 2 + 0.06), U1.z + i * 0.95, 0.3, 0.42, top, top + 0.3, 0, 0, { ao: 1 });
    // decoupling between VCC and GND, a pull-up above SDA and one above SCL, the power LED's base and its resistor
    chip2(s, { x: (pin('VCC') + pin('GND')) / 2, z: PARTS_Z, y: top, body: PAL.ceramic, h: 0.8 });
    for (const id of ['SDA', 'SCL']) chip2(s, { x: pin(id), z: PARTS_Z + 0.3, y: top, turn: 1, stripe: '#b9b9be' });
    chip2(s, { x: R3.x, z: R3.z, y: top, stripe: '#b9b9be' });
    chip2(s, { x: LED.x, z: LED.z, y: top, body: PAL.plasticCream, h: 0.35 });
    const root = s.toObject();
    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, top + 0.02, W / 2, D / 2),
        ppm: 28,
        draw(g) {
          // copper under the solder mask: the header to the passives, the passives to the sensor
          g.strokeStyle = g.fillStyle = 'rgba(255,255,255,0.13)';
          g.lineWidth = 0.24;
          g.lineJoin = g.lineCap = 'round';
          const line = (...p: number[]) => {
            g.beginPath();
            g.moveTo(p[0], p[1]);
            for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
            g.stroke();
          };
          const via = (x: number, z: number) => {
            g.beginPath();
            g.arc(x, z, 0.3, 0, Math.PI * 2);
            g.fill();
          };
          const ux = U1.size / 2 + 0.2, vcc = pin('VCC'), gnd = pin('GND'), sda = pin('SDA'), scl = pin('SCL');
          line(vcc, ROW_Z - 1, vcc, U1.z + 0.95, U1.x - ux, U1.z + 0.95);
          line(gnd, ROW_Z - 1, gnd, U1.z, U1.x - ux, U1.z);
          const mid = (sda + scl) / 2;
          line(sda, ROW_Z - 1, sda, PARTS_Z + 1.9, mid, PARTS_Z + 1.9, mid, U1.z + 2.1, scl + 0.6, U1.z + 2.1, scl + 0.6, U1.z + 0.95, U1.x + ux, U1.z + 0.95);
          line(scl, ROW_Z - 1, scl, PARTS_Z + 1.9, scl + 1.3, PARTS_Z + 1.9, scl + 1.3, U1.z, U1.x + ux, U1.z);
          for (const x of [sda, scl]) {
            line(x, PARTS_Z - 0.5, x, PARTS_Z - 0.95);
            via(x, PARTS_Z - 0.95);
          }
          line(LED.x + 0.8, LED.z, R3.x - 0.8, R3.z);
          line(LED.x - 0.8, LED.z, LED.x - 1.3, LED.z);
          via(LED.x - 1.3, LED.z);
          line(R3.x + 0.8, R3.z, R3.x + 1.25, R3.z, R3.x + 1.25, R3.z + 1.2);
          via(R3.x + 1.25, R3.z + 1.2);

          // silkscreen: the pin names over the header, outlines, references, what the board is and where it answers
          pinLabels(g, terminals.map((t) => t.id), terminals[0].pos[0], ROW_Z - 1.75, PITCH_X, 0.86);
          silkBox(g, U1.x - U1.size / 2 - 0.55, U1.z - U1.size / 2 - 0.3, U1.size + 1.1, U1.size + 0.6, 0.3, 0.14);
          g.fillStyle = INK.silk;
          g.beginPath();
          g.arc(U1.x - U1.size / 2 - 0.85, U1.z + U1.size / 2 + 0.1, 0.16, 0, Math.PI * 2);
          g.fill();
          text(g, 'U1', U1.x - U1.size / 2 - 1.35, U1.z - 0.9, 0.66, { weight: 600 });
          text(g, 'C1', (vcc + gnd) / 2, PARTS_Z - 0.95, 0.62, { weight: 600 });
          text(g, 'D1', LED.x, LED.z - 0.95, 0.62, { weight: 600 });
          text(g, 'R3', R3.x, R3.z - 0.95, 0.62, { weight: 600 });
          text(g, 'PWR', LED.x, LED.z + 1.0, 0.7, { weight: 700 });
          const right = (LED.x + R3.x) / 2 + 0.2;
          text(g, NAME, right, D / 2 - 2.75, 1.08, { weight: 800, spacing: 0.04 });
          text(g, 'TEMP + RH', right, D / 2 - 1.3, 0.72, { weight: 600, spacing: 0.06 });
          const left = -W / 2 + 2.4;
          text(g, 'I2C', left, 0.2, 0.95, { weight: 800 });
          text(g, `0x${ADDRESS.toString(16).toUpperCase()}`, left, 1.55, 0.95, { weight: 700 });
          // the mark of a made-up maker: a drop in a ring
          g.strokeStyle = INK.silk;
          g.lineWidth = 0.16;
          g.beginPath();
          g.arc(left, D / 2 - 1.75, 0.95, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.moveTo(left, D / 2 - 2.35);
          g.quadraticCurveTo(left + 0.75, D / 2 - 1.45, left, D / 2 - 1.25);
          g.quadraticCurveTo(left - 0.75, D / 2 - 1.45, left, D / 2 - 2.35);
          g.fill();
        },
      }),
      lamp('pwr', [LED.x, top + 0.42, LED.z], [0.42, 0.2, 0.3]),
    );
    return root;
  },
  animate(st, obj) {
    setLamp(obj, 'pwr', GREEN, st.power.on ? 1 : 0);
  },
  states: {
    powered: partState({ fields: { temperature: 23.5, humidity: 45 } }),
    unpowered: partState({ fields: { temperature: 23.5, humidity: 45 }, power: { on: false, reason: 'no supply' } }),
  },
});
