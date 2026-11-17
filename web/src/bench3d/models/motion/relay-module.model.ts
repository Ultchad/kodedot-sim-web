/**
 * Single-channel 5 V relay module: the blue sugar-cube relay (19 x 15.5 x 15.3 mm, the usual T73 outline) on a small
 * board with its three-way screw terminal (COM, NO, NC), the control header (VCC, GND, IN), the optocoupler, the driver
 * transistor and flyback diode, a power LED and a state LED, and the high/low trigger jumper.
 * Board size, header and screw-terminal positions are the manifest's (parts/relay-module).
 *
 * Live state: `outputs.energized` lights the red LED; `outputs.closed` (COM joined to NO) throws the arm of the contact
 * diagram on the relay's lid from NC to NO and lights the contact it lands on; `fields.active` ('low' | 'high') is the
 * trigger jumper, which slides to the side it names; `power.on` lights the green LED.
 */
import manifest from '../../../../../parts/relay-module/manifest.json';
import {
  INK, PAL, Shape, defineModel, footprintOf, lamp, part, partState, pcb, pinHeader, print, screwTerminal, setLamp, silkBox, terminalsFromManifest, text, topQuad,
  PITCH, type PartState,
} from '../../index';
import { approach, asManifest, chip, dip, jumperCap, pinAt, smdDiode, smdLedBody, sot23, visualAt } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w_mm: W, d_mm: D } = M.body;
const BOARD_Y = 1.3, TOP = BOARD_Y + 1.6; // through-hole joints under the board
const [VCC, IN, COM, NC] = [pinAt(M, 'VCC'), pinAt(M, 'IN'), pinAt(M, 'COM'), pinAt(M, 'NC')];
const NO = pinAt(M, 'NO');
// the relay: beside the terminal block, as on the real module
// (set back and to the right so that it does not hide the state LED, which the manifest puts behind it, from the front)
const RELAY = { x: 3.5, z: -4.5, w: 19, d: 15.5, h: 15.3 };
const LID = TOP + RELAY.h;
// the contact diagram on the lid: COM's pivot and the two fixed contacts, in the order of the screws beside it
const PIVOT: [number, number] = [RELAY.x + 1.7, RELAY.z + 1.0];
const THROW = { dx: 5.6, dz: 2.9 };
const SWING = Math.atan2(THROW.dz, THROW.dx);
const LED = visualAt(M, 'led');
const PWR: [number, number] = [LED[0], LED[1] + 3.3];
const JUMPER = { x: -14.4, z: 9.2 };
const RED = 0xff3b30, GREEN = 0x35d06a, AMBER = 0xffac00;

export default defineModel<PartState>({
  id: M.id,
  title: M.name.en,
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    const top = pcb(s, { w: W, d: D, y: BOARD_Y, r: 1.6, finish: PAL.pcbBlue, holes: [{ x: -W / 2 + 3, z: D / 2 - 3, d: 3 }, { x: W / 2 - 3, z: D / 2 - 3, d: 3 }] });
    // control header (pins up) and the load terminals, where the manifest puts them
    pinHeader(s, { x: VCC[0], z: (VCC[2] + IN[2]) / 2, y: top, n: 3, turn: 1 });
    screwTerminal(s, { x: COM[0] - 3.8, z: (COM[2] + NC[2]) / 2, y: top, n: 3, turn: 3, finish: PAL.plasticGreen });
    // the relay
    s.box(...PAL.plasticBlack, RELAY.x, RELAY.z, RELAY.w - 0.5, RELAY.d - 0.5, top, top + 1.2, 0.7, 0, { ao: 0.9 });
    s.box('gloss', '#1c66cc', RELAY.x, RELAY.z, RELAY.w, RELAY.d, top + 0.7, LID, 0.9, 0.75, { cap: true, ao: 0.86 });
    s.disc('gloss', '#1c66cc', RELAY.x - RELAY.w / 2 + 2.2, RELAY.z - RELAY.d / 2 + 2.2, 0.75, LID, LID + 0.3, 0.15, ctx.seg(10), { ao: 1 }); // the vent nib
    s.disc(...PAL.tin, PIVOT[0], PIVOT[1], 0.62, LID, LID + 0.1, 0.05, ctx.seg(12), { ao: 1 });
    // optocoupler, driver transistor, flyback diode, the LEDs with their resistors
    dip(s, { x: -15.2, z: 3.4, y: top, pins: 4, turn: 1 });
    sot23(s, { x: -9.0, z: 0.4, y: top });
    smdDiode(s, { x: -9.3, z: 4.6, y: top, l: 3.6, w: 1.7, h: 1.3 });
    smdLedBody(s, { x: LED[0], z: LED[1], y: top });
    smdLedBody(s, { x: PWR[0], z: PWR[1], y: top });
    chip(s, { x: LED[0] + 3.4, z: LED[1], y: top });
    chip(s, { x: PWR[0] + 3.4, z: PWR[1], y: top });
    chip(s, { x: -20.4, z: 3.6, y: top, turn: 1 });
    chip(s, { x: -3.6, z: 5.6, y: top, body: PAL.ceramic });
    // the trigger jumper's three pins
    pinHeader(s, { x: JUMPER.x, z: JUMPER.z, y: top, n: 3 });
    const root = s.toObject();

    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, top + 0.02, W / 2, D / 2),
        ppm: 12,
        draw(g) {
          g.fillStyle = INK.silk;
          // the header's legend, read from the board's left edge inwards
          for (const [label, z] of [['VCC', VCC[2]], ['GND', (VCC[2] + IN[2]) / 2], ['IN', IN[2]]] as const) text(g, label, VCC[0] + 2.1, z, 1.35, { weight: 700, align: 'left' });
          for (const [label, t] of [['COM', COM], ['NO', NO], ['NC', NC]] as const) text(g, label, t[0] - 9.05, t[2], 1.15, { weight: 700, angle: -Math.PI / 2 });
          text(g, 'ON', LED[0] - 2.6, LED[1], 1.1, { weight: 700 });
          text(g, 'PWR', PWR[0] - 2.9, PWR[1], 1.1, { weight: 700 });
          text(g, 'U1', -19.6, 6.4, 1.0);
          text(g, 'Q1', -9.0, -1.5, 1.0);
          text(g, 'D1', -9.3, 6.5, 1.0);
          text(g, 'L', JUMPER.x - PITCH, JUMPER.z + 2.5, 1.3, { weight: 800 });
          text(g, 'H', JUMPER.x + PITCH, JUMPER.z + 2.5, 1.3, { weight: 800 });
          text(g, 'TRIG', JUMPER.x, JUMPER.z + 2.5, 0.95, { weight: 600 });
          silkBox(g, RELAY.x - RELAY.w / 2 - 0.4, RELAY.z - RELAY.d / 2 - 0.4, RELAY.w + 0.8, RELAY.d + 0.8, 0.6, 0.2);
          text(g, '1 CH RELAY  5 V', 6.5, 8.4, 1.6, { weight: 800, spacing: 0.25 });
          text(g, 'opto-isolated · rev B', 6.5, 11.0, 1.0, { weight: 600 });
          // an invented maker's mark: three bars
          g.fillStyle = INK.amber;
          for (let i = 0; i < 3; i++) g.fillRect(-6.4 + i * 0.95, 7.5 + (2 - i) * 0.5, 0.6, 2.0 - (2 - i) * 0.5);
        },
      }),
      print({
        name: 'lid',
        quad: topQuad(RELAY.x, RELAY.z, LID + 0.02, RELAY.w / 2, RELAY.d / 2),
        ppm: 16,
        draw(g) {
          g.fillStyle = '#f4f6fb';
          text(g, 'JQC-3F', -8.2, -4.9, 2.05, { weight: 800, align: 'left', spacing: 0.1 });
          text(g, '05 VDC', -8.2, -2.2, 1.6, { weight: 700, align: 'left' });
          text(g, '10A 250VAC', -8.2, 1.3, 1.2, { weight: 600, align: 'left' });
          text(g, '10A 30VDC', -8.2, 3.2, 1.2, { weight: 600, align: 'left' });
          // the contact diagram: COM's pivot, the two fixed contacts, their names
          const px = PIVOT[0] - RELAY.x, pz = PIVOT[1] - RELAY.z;
          g.strokeStyle = 'rgba(244,246,251,0.85)';
          g.lineWidth = 0.22;
          for (const sz of [-1, 1]) {
            g.beginPath();
            g.arc(px + THROW.dx, pz + sz * THROW.dz, 0.95, 0, Math.PI * 2);
            g.stroke();
          }
          g.beginPath();
          g.moveTo(px - 1.6, pz);
          g.lineTo(px - 0.7, pz);
          g.stroke();
          text(g, 'NO', px + THROW.dx - 0.2, pz - THROW.dz - 2.0, 1.15, { weight: 700 });
          text(g, 'NC', px + THROW.dx - 0.2, pz + THROW.dz + 2.1, 1.15, { weight: 700 });
          text(g, 'COM', px - 0.2, pz + 1.9, 1.0, { weight: 700 });
        },
      }),
      lamp('led', [LED[0], top + 0.55, LED[1]], [0.72, 0.3, 0.5]),
      lamp('pwr', [PWR[0], top + 0.55, PWR[1]], [0.72, 0.3, 0.5]),
      // the fixed contacts light up when the arm rests on them
      lamp('no', [PIVOT[0] + THROW.dx, LID + 0.06, PIVOT[1] - THROW.dz], [0.62, 0.16, 0.62]),
      lamp('nc', [PIVOT[0] + THROW.dx, LID + 0.06, PIVOT[1] + THROW.dz], [0.62, 0.16, 0.62]),
    );

    // the moving contact: a bar from COM's pivot, built pointing along +X
    const a = new Shape();
    const reach = Math.hypot(THROW.dx, THROW.dz) - 0.55;
    a.box('matte', '#f4f6fb', reach / 2, 0, reach, 0.62, 0, 0.16, 0.3, 0.05, { ao: 1 });
    const arm = a.toObject('arm');
    arm.position.set(PIVOT[0], LID + 0.05, PIVOT[1]);
    arm.rotation.y = -SWING; // at rest on NC
    // the trigger jumper's cap, built on the two left pins (L)
    const j = new Shape();
    jumperCap(j, { x: 0, z: 0, y: 0, finish: PAL.plasticAmber });
    const cap = j.toObject('jumper');
    cap.position.set(JUMPER.x - PITCH / 2, top + 2.5, JUMPER.z);
    root.add(arm, cap);
    return root;
  },
  animate(st, obj, env) {
    const u = obj.userData;
    const on = st.power.on;
    setLamp(obj, 'pwr', GREEN, on ? 1 : 0);
    setLamp(obj, 'led', RED, on && st.outputs.energized ? 1 : 0);
    // the contact: -1 on NC, +1 on NO; the throw takes a few frames so the click can be seen
    const want = st.outputs.closed ? 1 : -1;
    const at = approach(typeof u.arm === 'number' ? u.arm : want, want, env.dt * 26);
    u.arm = at;
    part(obj, 'arm')!.rotation.y = at * SWING;
    setLamp(obj, 'no', AMBER, at > 0.92 ? 1 : 0);
    setLamp(obj, 'nc', 0xdfe6f5, at < -0.92 ? 0.45 : 0);
    // the jumper: 0 on L (active low, the default), 1 on H
    const side = st.fields.active === 'high' ? 1 : 0;
    const jump = approach(typeof u.jump === 'number' ? u.jump : side, side, env.dt * 6);
    u.jump = jump;
    part(obj, 'jumper')!.position.x = JUMPER.x - PITCH / 2 + jump * PITCH;
    return at !== want || jump !== side;
  },
  states: {
    unpowered: partState({ power: { on: false, reason: 'VCC' }, fields: { active: 'low' }, outputs: { energized: false, closed: false } }),
    idle: partState({ fields: { active: 'low' }, outputs: { energized: false, closed: false } }),
    closed: partState({ fields: { active: 'low' }, outputs: { energized: true, closed: true } }),
    'active-high': partState({ fields: { active: 'high' }, outputs: { energized: true, closed: true } }),
  },
});
