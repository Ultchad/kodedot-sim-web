/**
 * The common red L298N dual H-bridge module (43 x 43 mm): the L298N in its Multiwatt15 package standing against a
 * black finned heatsink, the two motor screw terminals on the sides, the three-way supply terminal, the control header
 * IN1..IN4 / ENA / ENB, the 78M05 regulator, the two electrolytics, the eight flyback diodes
 * and the power LED. Board size and every terminal position are the manifest's (parts/l298n); the package after the
 * L298 datasheet (body 19.6 x 5 x 10.7 mm, tab to 17.5 mm above the body's foot), the heatsink 23 x 16 mm.
 *
 * Live state: `power.on` lights the red power LED; the manifest's four glows `led_in1..led_in4` (the level or PWM duty
 * of IN1..IN4) light four yellow input LEDs where the part's picture has them. Nothing moves on this board.
 * The ENA / ENB jumpers are shown parked on their 5 V pins, so that the two pins the wiring uses stay free.
 */
import manifest from '../../../../../parts/l298n/manifest.json';
import {
  INK, PAL, PITCH, Shape, circleLoop, defineModel, electrolytic, footprintOf, frontQuad, partState, pcb, pinHeader, print, screwTerminal, setLamp, silkBox,
  terminalsFromManifest, text, topQuad, type PartState, type Pt,
} from '../../index';
import { asManifest, brick, chip, dpak, finnedHeatsink, jumperCap, num, pinAt, smdDiode, smdLedBody, smdLedLens, towardsZ, visualAt } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w_mm: W, d_mm: D, h_mm: H } = M.body;
const BOARD_Y = 1.3, TOP = BOARD_Y + 1.6;
const pin = (name: string) => pinAt(M, name);
const [IN1, ENB, OUT1, OUT2, OUT3, OUT4, VS, V5] = ['IN1', 'ENB', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'VS', 'V5'].map(pin);
const ENA = pin('ENA');
const HEADER = ['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB'];
const IN_LEDS = ['led_in1', 'led_in2', 'led_in3', 'led_in4'] as const;
const LED_AT = IN_LEDS.map((id) => visualAt(M, id));
const PWR: [number, number] = [-9.6, 13.5];
// the L298N stands with its tab against the heatsink's plate
const SINK = { x: 0, z0: -D / 2 + 0.6, z1: -5, w: 23 };
const CHIP = { w: 19.6, t: 5, foot: TOP + 4.2, body: 10.7, tab: 17.6 };
const REG = { x: -17.2, z: 10.3 };
const YELLOW = 0xffcc00, RED = 0xff3b30;

export default defineModel<PartState>({
  id: M.id,
  title: M.name.en,
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    const hole = W / 2 - 2.9;
    const top = pcb(s, { w: W, d: D, y: BOARD_Y, r: 2, finish: PAL.pcbRed, holes: [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: sx * hole, z: sz * hole, d: 3.2 })) });
    // ---- connectors, where the manifest has them
    pinHeader(s, { x: (IN1[0] + ENB[0]) / 2, z: IN1[2], y: top, n: HEADER.length });
    screwTerminal(s, { x: OUT1[0] + 3.8, z: (OUT1[2] + OUT2[2]) / 2, y: top, n: 2, turn: 1 });
    screwTerminal(s, { x: OUT3[0] - 3.8, z: (OUT3[2] + OUT4[2]) / 2, y: top, n: 2, turn: 3 });
    screwTerminal(s, { x: (VS[0] + V5[0]) / 2, z: VS[2] + 0.6, y: top, n: 3 }); // its screws are the terminals
    // the 5 V pins behind ENA and ENB, with the two enable jumpers parked on them (turned away from the header)
    pinHeader(s, { x: (ENA[0] + ENB[0]) / 2, z: ENA[2] - PITCH, y: top, n: 2 });
    for (const t of [ENA, ENB]) jumperCap(s, { x: t[0], z: t[2] - 1.5 * PITCH, y: top + 2.5, turn: 1 });
    // ---- heatsink and the L298N
    finnedHeatsink(s, { x: SINK.x, z: (SINK.z0 + SINK.z1) / 2, y: top + 1.2, w: SINK.w, d: SINK.z1 - SINK.z0, h: H - top - 1.2, fins: 8 });
    const tabTop = CHIP.foot + CHIP.tab, bodyTop = CHIP.foot + CHIP.body;
    s.with(towardsZ(0, 0, SINK.z1), () => {
      // local x is X, local z is DOWN (-Y), local y comes towards the viewer
      const tab: Pt[] = [[-CHIP.w / 2, -bodyTop + 1], [-CHIP.w / 2, -tabTop + 2], [-CHIP.w / 2 + 2, -tabTop], [CHIP.w / 2 - 2, -tabTop], [CHIP.w / 2, -tabTop + 2], [CHIP.w / 2, -bodyTop + 1]];
      s.prism(...PAL.tin, tab, 0, 1.6, 0.15, { ao: 1, holes: [circleLoop(0, -(bodyTop + 3.7), 1.85, ctx.seg(12))] });
      s.box(...PAL.epoxyBlack, 0, -(CHIP.foot + CHIP.body / 2), CHIP.w, CHIP.body, 0, CHIP.t, 0.5, 0.4, { ao: 1 });
      // the screw that clamps the tab to the heatsink
      s.disc(...PAL.steel, 0, -(bodyTop + 3.7), 2.7, 1.6, 3.1, 0.6, ctx.seg(14), { ao: 1 });
      brick(s, ['matte', '#3c3d42'], 0, -(bodyTop + 3.7), 3.4, 0.6, 3.1, 3.13);
    });
    // its fifteen leads: every other one steps forward to the front row
    for (let i = 0; i < 15; i++) {
      const x = (i - 7) * 1.27, front = i % 2 === 0;
      const z = SINK.z1 + (front ? CHIP.t + 1.6 : 2.4);
      if (front) brick(s, PAL.tin, x, SINK.z1 + CHIP.t / 2 + 2.1, 0.6, CHIP.t - 1.4, CHIP.foot - 0.9, CHIP.foot - 0.5, 0, true);
      brick(s, PAL.tin, x, z, 0.6, 0.4, top, CHIP.foot - (front ? 0.5 : 0));
    }
    // ---- supply: the two electrolytics and the 78M05
    for (const sx of [-1, 1]) electrolytic(s, { x: sx * 15.4, z: 1.4, y: top, d: 8, h: 11.5, turn: sx > 0 ? 3 : 1 });
    dpak(s, { x: REG.x, z: REG.z, y: top });
    // ---- the eight flyback diodes in a row before the chip
    for (let i = 0; i < 8; i++) smdDiode(s, { x: (i - 3.5) * 2.75, z: 4.9, y: top, turn: 1, l: 3.9, w: 2.2, h: 1.9 });
    // ---- LEDs and their resistors
    for (const [x, z] of LED_AT) {
      smdLedBody(s, { x, z, y: top, turn: 1 });
      chip(s, { x, z: z + 2.4, y: top, turn: 1, l: 1.6, w: 0.85, h: 0.45 });
    }
    smdLedBody(s, { x: PWR[0], z: PWR[1], y: top });
    chip(s, { x: PWR[0] + 3.2, z: PWR[1], y: top });
    const root = s.toObject();

    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, top + 0.02, W / 2, D / 2),
        ppm: 12,
        draw(g) {
          g.fillStyle = INK.silk;
          HEADER.forEach((name, i) => text(g, name, IN1[0] + i * PITCH, IN1[2] + 2.05, 0.82, { weight: 700 }));
          // beside each screw, in the gap between the terminal blocks and the heatsink
          for (const [label, t] of [['OUT1', OUT1], ['OUT2', OUT2]] as const) text(g, label, t[0] + 8.75, t[2], 0.95, { weight: 700, angle: -Math.PI / 2 });
          for (const [label, t] of [['OUT3', OUT3], ['OUT4', OUT4]] as const) text(g, label, t[0] - 8.75, t[2], 0.95, { weight: 700, angle: Math.PI / 2 });
          text(g, '+12V', VS[0], VS[2] + 5.7, 1.05, { weight: 800 });
          text(g, 'GND', pin('GND')[0] - 0.2, VS[2] + 5.7, 1.05, { weight: 800 });
          text(g, '+5V', V5[0] - 1.5, VS[2] + 5.7, 1.05, { weight: 800, align: 'right' });
          LED_AT.forEach(([x, z], i) => text(g, String(i + 1), x, z - 1.7, 0.95, { weight: 700 }));
          text(g, 'PWR', PWR[0] - 2.9, PWR[1], 0.95, { weight: 700 });
          text(g, 'U2', REG.x + 4.6, REG.z - 1, 0.95);
          text(g, 'C1', -15.4, 6.4, 0.95);
          text(g, 'C2', 15.4, 6.4, 0.95);
          text(g, 'D1–D8', 0, 8.0, 0.85);
          silkBox(g, -CHIP.w / 2 - 0.5, SINK.z1 - 0.4, CHIP.w + 1, CHIP.t + 3.2, 0.5, 0.2);
          text(g, 'MOTOR A', -17.4, -3.45, 0.85, { weight: 700 });
          text(g, 'MOTOR B', 17.4, -3.45, 0.85, { weight: 700 });
        },
      }),
      print({
        name: 'chip',
        quad: frontQuad(0, CHIP.foot + CHIP.body / 2, SINK.z1 + CHIP.t + 0.02, CHIP.w / 2, CHIP.body / 2),
        ppm: 16,
        draw(g) {
          g.fillStyle = '#c9c9c4';
          text(g, 'L298N', 0.6, -1.4, 3.3, { weight: 700, spacing: 0.25 });
          text(g, 'MW15  2431', 0.6, 2.5, 1.5, { weight: 600, spacing: 0.15 });
          // an invented mark: two chevrons
          g.strokeStyle = '#c9c9c4';
          g.lineWidth = 0.4;
          g.lineJoin = 'round';
          for (const dx of [0, 1.3]) {
            g.beginPath();
            g.moveTo(-8.4 + dx, -2.6);
            g.lineTo(-7.3 + dx, -1.4);
            g.lineTo(-8.4 + dx, -0.2);
            g.stroke();
          }
        },
      }),
      smdLedLens('pwr', { x: PWR[0], z: PWR[1], y: top }),
      ...IN_LEDS.map((id, i) => smdLedLens(id, { x: LED_AT[i][0], z: LED_AT[i][1], y: top, turn: 1 })),
    );
    return root;
  },
  animate(st, obj) {
    const on = st.power.on;
    setLamp(obj, 'pwr', RED, on ? 1 : 0);
    for (let i = 0; i < IN_LEDS.length; i++) {
      const id = IN_LEDS[i];
      setLamp(obj, id, YELLOW, on ? num(st.visuals[id], st.pins[HEADER[i]]?.level ?? 0) : 0);
    }
  },
  states: {
    off: partState({ power: { on: false, reason: 'VS' } }),
    idle: partState({ visuals: { led_in1: 0, led_in2: 0, led_in3: 0, led_in4: 0 }, outputs: { out1: 0, out2: 0, out3: 0, out4: 0 } }),
    forward: partState({ visuals: { led_in1: 1, led_in2: 0, led_in3: 1, led_in4: 0 }, outputs: { out1: 1, out2: 0, out3: 1, out4: 0 } }),
    'pwm-reverse': partState({ visuals: { led_in1: 0, led_in2: 0.45, led_in3: 0, led_in4: 1 }, outputs: { out1: 0, out2: 0.45, out3: 0, out4: 1 } }),
  },
});
