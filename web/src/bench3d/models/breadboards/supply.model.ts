/**
 * Supply 3.3 V / 5 V: a small regulated supply module on a 22.86 x 15.24 mm board (9 x 6 pitches, the manifest's
 * body). The manifest gives two top terminals side by side in the middle (+ and -) and one field, the output: off,
 * 3.3 V or 5 V. The module built round that (it is our own design, no real product): USB-C power in on the left
 * edge, a three-way slide switch along the front (OFF / 3V3 / 5V), a two-way socket for the output where the
 * terminals are, a linear regulator in SOT-223 with its two tantalum capacitors, a power LED.
 * Live state: the knob stands at the chosen output, the LED is lit when there is one. Hazard: above the manifest's
 * `max_ma` the regulator glows red-hot and the LED flickers red.
 */
import manifest from '../../../../../parts/supply/manifest.json';
import {
  INK, PAL, Shape, defineModel, footprintOf, glowing, lamp, part, partState, pcb, pinHeader, print, setLamp, silkBox, terminalsFromManifest, text, topQuad, usbC,
  type PartState,
} from '../../index';
import { asPart, chip, slideKnob, slideSwitch, slideTravel, sot223 } from './builders';

const M = asPart(manifest);
const terminals = terminalsFromManifest(M);
const POS = terminals.find((t) => t.id === 'POS')!.pos, NEG = terminals.find((t) => t.id === 'NEG')!.pos;
const MAX_MA = manifest.behaviour.elements[0].max_ma;
const FIELD = manifest.fields[0];
/** The switch positions in the order of the field's values: off, 3.3 V, 5 V. */
const STOPS = FIELD.values.map((v) => v.value);
const W = M.body.w_mm, D = M.body.d_mm;
const BOARD = 1.3 + 1.6; // top face of the board: it stands on its solder joints
const SW = { x: 2.2, z: D / 2 - 2.05, w: 10.6 };
const REG = { x: 6.7, z: -3.9 };
const LED = { x: -8.3, z: D / 2 - 1.3 };
const GREEN = 0x35d06a, RED = 0xff3b30, HOT = 0xff4a16;
const TRAVEL = slideTravel(SW.w); // how far the knob moves between two stops

export default defineModel<PartState>({
  id: M.id,
  title: 'Supply 3.3 V / 5 V',
  footprintMm: footprintOf(M.body),
  terminals,
  build() {
    const s = new Shape();
    const top = pcb(s, { w: W, d: D, y: BOARD - 1.6, r: 1.2, finish: PAL.pcbBlue });
    // the output socket stands exactly where the two terminals are, its mouths at their height
    pinHeader(s, { x: (POS[0] + NEG[0]) / 2, z: (POS[2] + NEG[2]) / 2, y: top, n: 2, female: true, length: POS[1] - top });
    usbC(s, { x: -W / 2, z: 0, y: top, turn: 1 });
    slideSwitch(s, { x: SW.x, z: SW.z, y: top, w: SW.w });
    // the regulator's leads (its body glows, so it is a part of its own), input and output capacitors, LED resistor
    const reg = new Shape();
    sot223(s, { x: REG.x, z: REG.z, y: top, into: reg });
    chip(s, { x: -0.7, z: -5.5, y: top, l: 3.5, w: 2.8, h: 1.9, finish: PAL.plasticAmber, bar: true });
    chip(s, { x: 9.3, z: 1.9, y: top, l: 3.5, w: 2.8, h: 1.9, finish: PAL.plasticAmber, bar: true, turn: 1 });
    chip(s, { x: -5.4, z: LED.z, y: top });
    chip(s, { x: 2.15, z: -5.5, y: top, finish: PAL.ceramic, turn: 1 });
    s.box(...PAL.plasticWhite, LED.x, LED.z, 1.6, 0.8, top, top + 0.3, 0.08, 0, { ao: 1 });
    const root = s.toObject();
    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, top + 0.02, W / 2, D / 2),
        ppm: 24,
        draw(g) {
          g.fillStyle = INK.silk;
          // the output: polarity over each socket, the stops of the switch behind it
          text(g, '+', POS[0], POS[2] - 2.35, 2.1, { weight: 700 });
          text(g, '−', NEG[0], NEG[2] - 2.35, 2.1, { weight: 700 });
          silkBox(g, POS[0] - 1.6, POS[2] - 1.6, NEG[0] - POS[0] + 3.2, 3.2, 0.3, 0.16);
          ['OFF', '3V3', '5V'].forEach((l, i) => text(g, l, SW.x + (i - 1) * TRAVEL, SW.z - 2.95, 1.1, { weight: 700 }));
          // what it is, and the maker's made-up mark
          text(g, 'PSU', -8.4, -6.15, 1.9, { weight: 800, spacing: 0.2 });
          text(g, '1 A', -4.9, -6.1, 1.0, { weight: 700 });
          text(g, 'PWR', LED.x, LED.z - 1.25, 0.85, { weight: 700 });
          text(g, 'U1', REG.x + 3.6, REG.z - 2.9, 0.85, { weight: 600 });
          text(g, 'C1', -0.7, -3.55, 0.85, { weight: 600 });
          text(g, 'C2', 9.3, 4.45, 0.85, { weight: 600 });
          silkBox(g, REG.x - 3.55, REG.z - 2.05, 7.1, 4.1, 0.25, 0.14);
          g.strokeStyle = INK.amber;
          g.lineWidth = 0.22;
          g.beginPath();
          g.arc(9.9, 6.2, 0.75, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = INK.amber;
          g.beginPath();
          g.arc(9.9, 6.2, 0.3, 0, Math.PI * 2);
          g.fill();
        },
      }),
      slideKnob({ x: SW.x, z: SW.z, y: top, finish: PAL.plasticWhite }).toObject('knob'),
      glowing('reg', reg),
      lamp('pwr', [LED.x, top + 0.45, LED.z], [0.62, 0.36, 0.42]),
    );
    return root;
  },
  animate(st, obj, env) {
    const mv = Number(st.fields.mv ?? FIELD.default);
    const on = st.power.on !== false && mv > 0;
    // the knob at the stop of the chosen output (the nearest one, should the field hold another value)
    let stop = 0;
    for (let i = 1; i < STOPS.length; i++) if (Math.abs(STOPS[i] - mv) < Math.abs(STOPS[stop] - mv)) stop = i;
    part(obj, 'knob')!.position.x = (stop - (STOPS.length - 1) / 2) * TRAVEL;
    const ma = Math.abs(Number(st.outputs.current_ma ?? 0));
    if (on && ma > MAX_MA) {
      const over = Math.min(1, (ma - MAX_MA) / MAX_MA);
      setLamp(obj, 'reg', HOT, 0.55 + over * 0.45 + 0.25 * Math.sin(env.time * 14));
      setLamp(obj, 'pwr', RED, Math.floor(env.time * 9) % 2 === 0 ? 1.4 : 0.15);
      return true;
    }
    setLamp(obj, 'reg', HOT, 0);
    setLamp(obj, 'pwr', GREEN, on ? 1 : 0);
  },
  states: {
    'on-5v': partState({ fields: { mv: 5000 }, outputs: { current_ma: 120 } }),
    'on-3v3': partState({ fields: { mv: 3300 }, outputs: { current_ma: 40 } }),
    off: partState({ fields: { mv: 0 }, outputs: { current_ma: 0 } }),
    overload: partState({ fields: { mv: 5000 }, outputs: { current_ma: 1600 } }),
  },
});
