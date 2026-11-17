/**
 * 28BYJ-48 geared stepper with its ULN2003 driver board, one part as the manifest has it (parts/stepper-28byj48): the
 * board on the left with the control header where the manifest puts it, the motor on the right with its shaft up, the
 * five-wire lead plugged into the board's white socket.
 *
 * Motor, after the 28BYJ-48 drawing: can 28 mm across and 19 mm high, front plate with two ears (holes 35 mm apart),
 * the blue lead cover on its side, a 9 mm boss 8 mm off centre and the 5 mm shaft with two flats, 10 mm above the can.
 * THE MANIFEST'S BOX IS THE BARE CAN (19 mm high, 32 mm deep): the whole motor, with its shaft up and its ears, is
 * 29 mm high and 42 mm across. It is built at its real proportions and fitted into the box by `FIT` (0.66 today); when
 * the manifest's body grows to the real envelope, `FIT` becomes 1 by itself. The board is at real size.
 * A small pointer pressed on the flats shows the rotation.
 *
 * Live state: `outputs.position` (half steps, 4096 a turn) or `outputs.angle` turns the shaft, eased between updates;
 * the four LEDs A..D show the coils (the levels of IN1..IN4 while the board is powered); `outputs.stalled` (the rotor
 * skips) makes the pointer shake and the motor's face glow red.
 */
import manifest from '../../../../../parts/stepper-28byj48/manifest.json';
import {
  INK, Matrix4, PAL, PITCH, Shape, circleLoop, convexHull, defineModel, footprintOf, glowing, lamp, ledDome, part, partState, pcb, pinHeader, print, roundPolygon,
  setLamp, silkBox, terminalsFromManifest, text, topQuad, type PartState, type Pt, type V3,
} from '../../index';
import { DEG, WIRE, asManifest, chip, dip, follow, pinAt, shroudedHeader, stepperDegrees, visualAt, wire } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w_mm: W, d_mm: D, h_mm: H } = M.body;
const pin = (name: string) => pinAt(M, name);
/** Half steps per turn of the output shaft: the unit of the part's `position`. */
const UNITS = M.behaviour?.elements?.find((e) => e.type === 'stepper_unipolar')?.steps_per_rev ?? 4096;

// ---- the motor, in its own millimetres (origin: the can's axis on the table; lead cover towards -x, shaft towards +x)
const CAN = { r: 14, h: 19 }, EARS = 17.5, BOSS = { x: 8, r: 4.5, h: 1.5 }, SHAFT = { r: 2.5, len: 8.5, flats: 1.5 };
const MOTOR_H = CAN.h + BOSS.h + SHAFT.len, MOTOR_D = 2 * EARS + 7;
const FIT = Math.min(1, H / MOTOR_H, D / MOTOR_D);
/** The can's axis: where the part's picture has the motor (its `shaft` visual sits 1 mm beside the drawn can's centre). */
const CX = visualAt(M, 'shaft')[0] - 1, CZ = 0;
const at = (x: number, y: number, z: number): V3 => [CX + x * FIT, y * FIT, CZ + z * FIT];
// ---- the board
const IN = ['IN1', 'IN2', 'IN3', 'IN4'];
const [IN1, IN4, V5, GND] = [pin('IN1'), pin('IN4'), pin('V5'), pin('GND')];
const BOARD = { x0: -W / 2 + 0.4, x1: -0.6, d: D - 0.8, y: 1.3 };
const LEDS = IN.map((_, i): [number, number] => [-25 + i * 4.2, 6.4]);
const SOCKET = { x: -5.4, z: 6.6 };
const LEAD = [WIRE.blue, WIRE.pink, WIRE.yellow, WIRE.orange, WIRE.red];
const LED_NAMES = ['led0', 'led1', 'led2', 'led3'];
const RED = 0xff3b30;

export default defineModel<PartState>({
  id: M.id,
  title: M.name.en,
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    // ================================================================ the driver board
    const bx = (BOARD.x0 + BOARD.x1) / 2, bw = BOARD.x1 - BOARD.x0;
    const top = pcb(s, {
      w: bw, d: BOARD.d, x: bx, y: BOARD.y, r: 1.2, finish: PAL.pcbGreen,
      holes: [[BOARD.x0 + 2.6, -BOARD.d / 2 + 2.6], [BOARD.x0 + 2.6, BOARD.d / 2 - 2.6], [BOARD.x1 - 2.6, BOARD.d / 2 - 2.6]].map(([x, z]) => ({ x, z, d: 2.8 })),
    });
    pinHeader(s, { x: (IN1[0] + IN4[0]) / 2, z: IN1[2], y: top, n: 4 });
    pinHeader(s, { x: (V5[0] + GND[0]) / 2, z: V5[2], y: top, n: 2 });
    const chipTop = dip(s, { x: -16.2, z: -3.6, y: top, pins: 16, socket: true });
    for (const [x, z] of LEDS) chip(s, { x, z: z + 3.6, y: top, turn: 1 });
    chip(s, { x: -4.2, z: -4.6, y: top, turn: 1, body: PAL.ceramic });
    // the motor's socket with the lead's plug in it
    const plug = shroudedHeader(s, { x: SOCKET.x, z: SOCKET.z, y: top, n: 5, turn: 1, plug: true });
    // ================================================================ the motor
    const seg = ctx.seg(30);
    s.with(new Matrix4().makeTranslation(CX, 0, CZ).multiply(new Matrix4().makeScale(FIT, FIT, FIT)), () => {
      s.lathe('metal', '#dfe1e5', 0, 0, [[CAN.r - 0.7, 0], [CAN.r, 0.7], [CAN.r, CAN.h - 0.75]], seg);
      s.band('metal', '#9fa2a8', 0, 0, CAN.r, 2.0, 2.5, 0, Math.PI * 2, seg); // the seam of the back cover
      // the front plate, and its two ears: tabs that widen into the plate
      s.disc('metal', '#dfe1e5', 0, 0, CAN.r, CAN.h - 0.8, CAN.h, 0.25, seg, { ao: 1 });
      const root = Math.sqrt(CAN.r * CAN.r - 36);
      for (const sz of [-1, 1]) {
        s.prism('metal', '#dfe1e5', convexHull([...circleLoop(0, sz * EARS, 3.6, 12), [-6, sz * root], [6, sz * root], [-4, sz * (root - 2)], [4, sz * (root - 2)]]), CAN.h - 0.8, CAN.h, 0.25, {
          cap: true, ao: 1, holes: [circleLoop(0, sz * EARS, 2.1, 12)],
        });
      }
      s.disc('metal', '#dfe1e5', BOSS.x, 0, BOSS.r, CAN.h, CAN.h + BOSS.h, 0.35, ctx.seg(20), { ao: 0.9 });
      // the blue cover where the lead leaves
      s.box(...PAL.plasticBlue, -13.6, 0, 7.8, 14.6, 0.4, 16.6, 1.4, 0.9, { cap: true, ao: 0.9 });
      s.box(...PAL.plasticBlue, -15.6, 0, 3.4, 9.6, 4.5, 13.2, 0.8, 0.5, { cap: true, ao: 0.95 });
    });
    // the five leads, from the plug over to the cover
    plug.forEach((p, i) => {
      const end = at(-17.1, 8.6, (i - 2) * 1.55);
      wire(s, LEAD[i], [[p[0], p[1] - 0.6, p[2]], [p[0], p[1] + 2.2, p[2]], [end[0] - 2.6, p[1] + 1.6, end[2]], [end[0] - 2.6, end[1], end[2]], [end[0] + 0.6, end[1], end[2]]], { d: 1.05, bend: 1.9 });
    });
    const root = s.toObject();

    const face = at(0, CAN.h, 0);
    root.add(
      print({
        name: 'silk',
        quad: topQuad(bx, 0, top + 0.02, bw / 2, BOARD.d / 2),
        ppm: 12,
        draw(g) {
          g.translate(-bx, 0);
          g.fillStyle = INK.silk;
          IN.forEach((name, i) => text(g, name, IN1[0] + i * PITCH, IN1[2] + 2.3, 0.85, { weight: 700 }));
          text(g, '5V', V5[0], V5[2] + 2.3, 0.85, { weight: 700 });
          text(g, 'GND', GND[0] + 0.2, GND[2] + 2.3, 0.85, { weight: 700 });
          silkBox(g, V5[0] - 1.5, V5[2] - 1.5, GND[0] - V5[0] + 3, 3, 0.3, 0.16);
          LEDS.forEach(([x, z], i) => text(g, 'ABCD'[i], x, z - 2.9, 1.25, { weight: 800 }));
          text(g, 'ULN2003', -17.5, 12.6, 1.5, { weight: 800, spacing: 0.15 });
          text(g, 'STEPPER DRIVER', -17.5, 14.3, 0.85, { weight: 600, spacing: 0.1 });
          text(g, 'U1', -27.9, -3.6, 0.9);
          text(g, 'MOTOR', SOCKET.x - 4.4, SOCKET.z, 0.85, { weight: 700, angle: -Math.PI / 2 });
        },
      }),
      print({
        name: 'chip',
        quad: topQuad(-16.2, -3.6, chipTop + 0.02, 9.6, 3.1),
        ppm: 18,
        draw(g) {
          g.fillStyle = '#b9b9b4';
          text(g, 'ULN2003A', 0.6, -0.7, 1.9, { weight: 600, spacing: 0.2 });
          text(g, '7 × 500 mA   2431', 0.6, 1.6, 1.0, { weight: 500, spacing: 0.1 });
        },
      }),
      print({
        name: 'face',
        quad: topQuad(face[0], face[2], face[1] + 0.02, CAN.r * FIT, CAN.r * FIT),
        ppm: 16,
        draw(g) {
          g.scale(FIT, FIT);
          g.fillStyle = 'rgba(40,42,48,0.78)';
          text(g, '28BYJ-48', -4.6, -6.6, 2.3, { weight: 700, angle: Math.PI / 2 });
          text(g, '5 V DC  1:64', -7.6, -6.6, 1.5, { weight: 600, angle: Math.PI / 2 });
        },
      }),
      ...LED_NAMES.map((name, i) => glowing(name, ledDome({ x: LEDS[i][0], z: LEDS[i][1], y: top, d: 3, resin: PAL.resinRed, seg: ctx.seg(10) }))),
    );

    // ---- what turns: the shaft with its two flats and the pointer pressed on it, about the boss's axis
    const r = new Shape();
    r.with(new Matrix4().makeScale(FIT, FIT, FIT), () => {
      const y0 = CAN.h + BOSS.h, y1 = y0 + SHAFT.len;
      r.disc('metal', '#e2e4e8', 0, 0, SHAFT.r, y0 - 0.4, y0 + 2.6, 0, ctx.seg(16), { ao: 1 });
      r.prism('metal', '#e2e4e8', circleLoop(0, 0, SHAFT.r, ctx.seg(20)).map(([x, z]) => [Math.max(-SHAFT.flats, Math.min(SHAFT.flats, x)), z] as Pt), y0 + 2.6, y1, 0.3, { ao: 1 });
      // the pointer: towards -z (up the part's picture) at 0 degrees
      r.prism(...PAL.plasticAmber, circleLoop(0, 0, 4.3, ctx.seg(18)), y0 + 3.4, y0 + 6.2, 0.5, { cap: true, ao: 0.95 });
      r.prism(...PAL.plasticAmber, roundPolygon([[2.2, -2.6], [-2.2, -2.6], [-1.1, -9.6], [0, -10.9], [1.1, -9.6]], [0.3, 0.3, 0.4, 0.4, 0.4], 3), y0 + 3.7, y0 + 5.3, 0.3, { cap: true, ao: 1 });
      r.prism(...PAL.plasticWhite, roundPolygon([[1.3, -8.2], [-1.3, -8.2], [-1.12, -9.6], [0, -10.95], [1.12, -9.6]], [0.2, 0.2, 0.3, 0.3, 0.3], 3), y0 + 3.72, y0 + 5.36, 0.3, { ao: 1 });
    });
    const rotor = r.toObject('shaft');
    rotor.position.set(...at(BOSS.x, 0, 0));
    // the stall warning: the motor's face glows red (hidden until the rotor skips)
    const warn = lamp('stall', [face[0], face[1] + 0.1, face[2]], [(CAN.r - 0.8) * FIT, 0.35, (CAN.r - 0.8) * FIT]);
    warn.visible = false;
    root.add(rotor, warn);
    return root;
  },
  animate(st, obj, env) {
    const on = st.power.on;
    const stalled = st.outputs.stalled === true;
    for (let i = 0; i < IN.length; i++) setLamp(obj, LED_NAMES[i], RED, on && st.pins[IN[i]]?.level ? 1 : 0);
    const target = stepperDegrees(st, UNITS);
    const cur = follow(obj.userData, 'deg', target, env.dt);
    part(obj, 'shaft')!.rotation.y = -(cur + (stalled ? Math.sin(env.time * 230) * 4 : 0)) * DEG;
    part(obj, 'stall')!.visible = stalled;
    setLamp(obj, 'stall', RED, stalled ? 0.75 + 0.25 * Math.sin(env.time * 14) : 0);
    return stalled || cur !== target;
  },
  states: {
    unpowered: partState({ power: { on: false, reason: 'V5' }, outputs: { position: 0, angle: 0, stalled: false } }),
    'phase-a': partState({ outputs: { position: 0, angle: 0, stalled: false }, pins: coils(1, 0, 0, 0) }),
    'quarter-turn': partState({ outputs: { position: 1024, angle: 90, stalled: false }, pins: coils(1, 1, 0, 0) }),
    reverse: partState({ outputs: { position: -1536, angle: 225, stalled: false }, pins: coils(0, 0, 1, 1) }),
    stalled: partState({ outputs: { position: 2731, angle: 240, stalled: true }, pins: coils(0, 1, 1, 0) }),
  },
});

/** The four inputs as the engine reports them, for the example states. */
function coils(...levels: number[]): PartState['pins'] {
  return Object.fromEntries(IN.map((name, i) => [name, { mv: levels[i] ? 5000 : 0, level: levels[i], floating: false }]));
}
