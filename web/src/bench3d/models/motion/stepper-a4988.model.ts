/**
 * NEMA 17 stepper with its A4988 driver carrier, one part as the manifest has it (parts/stepper-a4988): the carrier in
 * the front left corner, the motor filling the right of the footprint with its shaft up, four leads between them.
 *
 * Motor: a NEMA 17 at real size (42.3 mm square, 40 mm long, 31 mm hole pattern, 22 mm pilot boss, 5 mm shaft with a
 * flat reaching 24 mm above the body: the manifest's 64 mm). Black end caps with cut corners, the lamination stack
 * between them. A pointer clamped on the shaft shows the rotation against the ticks printed round the boss.
 * Carrier: the usual 20.3 x 15.2 mm A4988 board, its two rows of pins where the manifest puts them (pins up, for
 * jumper wires), the stick-on heatsink over the chip, the current-limit trimmer.
 *
 * Live state: `outputs.position` (1/16 steps) or `outputs.angle` turns the shaft, eased between updates;
 * `outputs.stalled` (skipping steps) makes the pointer shake and lights a red ring round the boss.
 */
import manifest from '../../../../../parts/stepper-a4988/manifest.json';
import {
  INK, PAL, PITCH, Shape, circleLoop, defineModel, footprintOf, frontQuad, heatsink, lamp, part, partState, pcb, pinHeader, print, roundPolygon, roundedRectLoop, setLamp,
  shaft, terminalsFromManifest, text, topQuad, type Finish, type PartState, type Pt, type V3,
} from '../../index';
import { BOARD_RED, DEG, TAU, WIRE, asManifest, brick, chip, crimpHousing, follow, pinAt, stepperDegrees, wire } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w_mm: W, d_mm: D, h_mm: H } = M.body;
const pin = (name: string) => pinAt(M, name);
/** 1/16 steps per turn: the unit of the part's `position`. */
const UNITS = (M.behaviour?.elements?.find((e) => e.type === 'stepper_step_dir')?.steps_per_rev ?? 200) * 16;

// ---- the motor: against the right edge of the footprint, as deep as the footprint
const FRAME = Math.min(42.3, D);
const MX = W / 2 - FRAME / 2, MZ = 0;
const SHAFT = 24; // above the body, boss included
const BODY = Math.min(40, H - SHAFT), CAP = Math.min(9.6, BODY / 3), BOSS = 2, SHAFT_TOP = BODY + SHAFT;
const BLACK: Finish = ['matte', '#18181a'];
// ---- the carrier: its two rows are the manifest's
const [EN, DIR, VMOT] = [pin('EN'), pin('DIR'), pin('VMOT')];
const ROW_A = ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR'];
const ROW_B = ['VMOT', 'GND', 'VDD', '2B', '2A', '1A', '1B', 'GND']; // the first three are the manifest's; the motor's four leads take the next four
const BOARD = { x: (EN[0] + DIR[0]) / 2, z: (EN[2] + VMOT[2]) / 2, w: 20.3, d: Math.abs(VMOT[2] - EN[2]) + 4.7, y: 1.3 };
const COILS = [3, 4, 5, 6].map((i): V3 => [VMOT[0] + i * PITCH, 0, VMOT[2]]);
const LEADS = [WIRE.blue, WIRE.red, WIRE.green, WIRE.black];
const RED = 0xff3b30;

export default defineModel<PartState>({
  id: M.id,
  title: M.name.en,
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    // ================================================================ the carrier
    const top = pcb(s, { w: BOARD.w, d: BOARD.d, x: BOARD.x, z: BOARD.z, y: BOARD.y, r: 0.6, finish: BOARD_RED });
    pinHeader(s, { x: BOARD.x, z: EN[2], y: top, n: 8 });
    pinHeader(s, { x: BOARD.x, z: VMOT[2], y: top, n: 8 });
    // the chip under its heatsink, the trimmer, sense resistors and decoupling
    s.box(...PAL.epoxyBlack, BOARD.x, BOARD.z, 5, 5, top, top + 0.9, 0.2, 0.1, { ao: 1 });
    heatsink(s, { x: BOARD.x, z: BOARD.z, y: top + 0.9, w: 8.6, d: 7.2, h: 5.4, fins: 6, finish: PAL.aluminium });
    const tx = BOARD.x + 7.4;
    s.box(...PAL.tin, tx, BOARD.z, 3.2, 3.2, top, top + 1.0, 0.3, 0.15, { ao: 1 });
    s.disc('metal', '#c9a24a', tx, BOARD.z, 1.25, top + 1.0, top + 1.45, 0.15, ctx.seg(12), { ao: 1 });
    brick(s, ['matte', '#3c3d42'], tx, BOARD.z, 1.9, 0.4, top + 1.45, top + 1.48);
    brick(s, ['matte', '#3c3d42'], tx, BOARD.z, 0.4, 1.9, top + 1.45, top + 1.48);
    for (const sz of [-1, 1]) chip(s, { x: BOARD.x - 7.2, z: BOARD.z + sz * 1.7, y: top, l: 3.2, w: 1.6, h: 0.6 });
    chip(s, { x: BOARD.x - 5.2, z: BOARD.z, y: top, turn: 1, body: PAL.ceramic });
    // ================================================================ the motor
    const half = FRAME / 2, cut = 4.4;
    const cap = roundPolygon(
      [[half, -half + cut], [half, half - cut], [half - cut, half], [-half + cut, half], [-half, half - cut], [-half, -half + cut], [-half + cut, -half], [half - cut, -half]].map(([x, z]) => [MX + x, MZ + z] as Pt),
      [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
      4,
    );
    const bolt = 15.5; // half the 31 mm hole pattern
    const holes = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => circleLoop(MX + sx * bolt, MZ + sz * bolt, 1.5, 10));
    s.prism(...BLACK, cap, 0, CAP, 0, { ao: 0.8 });
    s.prism('metal', '#b2b5bb', roundedRectLoop(MX, MZ, FRAME - 0.3, FRAME - 0.3, 3.2, 4), CAP, BODY - CAP, 0, { ao: 0.9 });
    // two laminations picked out: the stack is not one block
    for (let y = CAP + 3; y < BODY - CAP - 1; y += 3.6) s.prism('metal', '#6f7279', roundedRectLoop(MX, MZ, FRAME - 0.2, FRAME - 0.2, 3.2, 4), y, y + 0.22, 0, { ao: 1 });
    s.prism(...BLACK, cap, BODY - CAP, BODY, 0.7, { ao: 0.95, holes });
    // the tapped mounting holes: dark bottoms
    for (const h of holes) s.prism('matte', '#09090a', h, BODY - 3, BODY - 2.6, 0, { ao: 1 });
    for (const h of holes) s.prism('metal', '#55575d', h.map(([x, z], i) => [x + Math.cos((i / h.length) * TAU) * 0.7, z + Math.sin((i / h.length) * TAU) * 0.7] as Pt), BODY, BODY + 0.03, 0, { ao: 1, holes: [h] });
    // pilot boss, the bearing in it
    s.disc(...BLACK, MX, MZ, 11, BODY, BODY + BOSS, 0.5, ctx.seg(36), { ao: 0.9 });
    s.prism(...PAL.steel, circleLoop(MX, MZ, 5.6, ctx.seg(22)), BODY + BOSS, BODY + BOSS + 0.05, 0, { ao: 1, holes: [circleLoop(MX, MZ, 3.3, ctx.seg(16))] });
    s.disc('matte', '#0b0b0c', MX, MZ, 3.3, BODY + BOSS, BODY + BOSS + 0.03, 0, ctx.seg(16), { ao: 1 });
    // the lead socket in the rear cap, on the side that faces the carrier
    const sx = MX - half, sz = BOARD.z - 0.5;
    s.box(...PAL.plasticWhite, sx - 0.3, sz, 2.2, 9, 0.9, 5.7, 0.4, 0.3, { cap: true, ao: 0.95 });
    brick(s, ['matte', '#101012'], sx - 1.42, sz, 0.06, 7.6, 1.9, 4.7);
    // ================================================================ the four leads: a crimp housing on the coil pins, over to the socket
    const outs = crimpHousing(s, { x: (COILS[0][0] + COILS[3][0]) / 2, z: VMOT[2], y: top + 2.5, n: 4, h: 13 });
    outs.forEach((o, i) => {
      // nested, so that they do not cross: the way nearest the motor goes to the socket's front pin
      const z = sz + (i - 1.5) * 2, arch = o[1] + 2.4 + (3 - i) * 0.5;
      wire(s, LEADS[i], [[o[0], o[1] - 0.5, o[2]], [o[0], arch, o[2]], [sx - 1.5, arch, z], [sx - 1.5, 3.3, z], [sx + 0.2, 3.3, z]], { d: 1.25, bend: 2.4 });
    });
    const root = s.toObject();

    root.add(
      print({
        name: 'carrier',
        quad: topQuad(BOARD.x, BOARD.z, top + 0.02, BOARD.w / 2, BOARD.d / 2),
        ppm: 20,
        draw(g) {
          g.fillStyle = INK.silk;
          ROW_A.forEach((name, i) => text(g, name, EN[0] - BOARD.x + i * PITCH, EN[2] - BOARD.z - 1.82, 0.68, { weight: 700 }));
          ROW_B.forEach((name, i) => text(g, name, VMOT[0] - BOARD.x + i * PITCH, VMOT[2] - BOARD.z + 1.82, 0.68, { weight: 700 }));
          text(g, 'A4988', -7.3, -3.4, 0.9, { weight: 800 });
          text(g, 'Vref', 7.4, 2.5, 0.75, { weight: 700 });
        },
      }),
      print({
        name: 'face',
        quad: topQuad(MX, MZ, BODY + 0.02, half, half),
        ppm: 10,
        draw(g) {
          // a dial round the boss: the pointer reads against it
          g.strokeStyle = 'rgba(236,232,223,0.85)';
          g.lineCap = 'round';
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TAU, long = i % 6 === 0;
            g.lineWidth = long ? 0.45 : 0.22;
            g.beginPath();
            g.moveTo(Math.sin(a) * 12.4, -Math.cos(a) * 12.4);
            g.lineTo(Math.sin(a) * (long ? 14.6 : 13.5), -Math.cos(a) * (long ? 14.6 : 13.5));
            g.stroke();
          }
          g.fillStyle = INK.amber;
          g.beginPath();
          g.moveTo(0, -15.2);
          g.lineTo(-1.1, -17.4);
          g.lineTo(1.1, -17.4);
          g.closePath();
          g.fill();
        },
      }),
      print({
        name: 'plate',
        quad: frontQuad(MX, BODY / 2, MZ + half - 0.13, 13, 7),
        ppm: 12,
        draw(g) {
          g.fillStyle = '#d9dbdf';
          g.beginPath();
          g.roundRect(-13, -7, 26, 14, 0.8);
          g.fill();
          g.fillStyle = INK.silkDark;
          text(g, 'NEMA 17', -11.6, -3.9, 3.0, { weight: 800, align: 'left', spacing: 0.2 });
          text(g, '1.8°  ·  200 steps / rev', -11.6, 0.1, 1.55, { weight: 600, align: 'left' });
          text(g, '2 phase  ·  bipolar', -11.6, 2.7, 1.55, { weight: 600, align: 'left' });
          text(g, `42 × 42 × ${BODY}`, -11.6, 5.2, 1.3, { weight: 500, align: 'left' });
        },
      }),
    );

    // ---- what turns: the shaft and the pointer clamped on it, about the motor's axis
    const r = new Shape();
    shaft(r, { x: 0, z: 0, y0: BODY + BOSS - 0.6, y1: SHAFT_TOP - 0.05, d: 5, flat: 0.5, finish: ['metal', '#cdd0d5'] });
    const clampY = BODY + BOSS + 7;
    r.prism(...PAL.plasticAmber, circleLoop(0, 0, 5.2, ctx.seg(22)), clampY, clampY + 5, 0.6, { cap: true, ao: 0.95 });
    // the pointer: towards -Z (up the part's picture) at 0 degrees
    r.prism(...PAL.plasticAmber, roundPolygon([[2.6, -3.2], [-2.6, -3.2], [-1.25, -15.4], [0, -17.2], [1.25, -15.4]], [0.3, 0.3, 0.5, 0.5, 0.5], 3), clampY + 0.4, clampY + 2.4, 0.35, { cap: true, ao: 1 });
    r.prism(...PAL.plasticWhite, roundPolygon([[1.45, -13.6], [-1.45, -13.6], [-1.27, -15.4], [0, -17.25], [1.27, -15.4]], [0.2, 0.2, 0.4, 0.4, 0.4], 3), clampY + 0.42, clampY + 2.46, 0.35, { ao: 1 });
    // the clamp's grub screw, opposite the pointer
    r.rod(...PAL.steel, [0, clampY + 2.5, 4.9], [0, clampY + 2.5, 5.5], 1.0, ctx.seg(8));
    const rotor = r.toObject('shaft');
    rotor.position.set(MX, 0, MZ);
    // the stall warning: a red ring glowing round the boss (hidden until the motor skips)
    const warn = lamp('stall', [MX, BODY + 0.25, MZ], [14.6, 0.45, 14.6]);
    warn.visible = false;
    root.add(rotor, warn);
    return root;
  },
  animate(st, obj, env) {
    const stalled = st.outputs.stalled === true;
    const target = stepperDegrees(st, UNITS);
    const cur = follow(obj.userData, 'deg', target, env.dt);
    // a rotor that skips buzzes in place
    part(obj, 'shaft')!.rotation.y = -(cur + (stalled ? Math.sin(env.time * 230) * 3.2 : 0)) * DEG;
    part(obj, 'stall')!.visible = stalled;
    setLamp(obj, 'stall', RED, stalled ? 0.75 + 0.25 * Math.sin(env.time * 14) : 0);
    return stalled || cur !== target;
  },
  states: {
    rest: partState({ outputs: { position: 0, angle: 0, stalled: false, microstep: 1 } }),
    'eighth-turn': partState({ outputs: { position: 400, angle: 45, stalled: false, microstep: 1 } }),
    'half-turn': partState({ outputs: { position: 1600, angle: 180, stalled: false, microstep: 16 } }),
    reverse: partState({ outputs: { position: -1000, angle: 247.5, stalled: false, microstep: 16 } }),
    stalled: partState({ outputs: { position: 2130, angle: 239.6, stalled: true, microstep: 1 } }),
  },
});
