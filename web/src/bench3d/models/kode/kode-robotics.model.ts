/**
 * Kode Robotics module (KDROB001 rev 1.0): a dual H-bridge carrier for the Dot's expansion header.
 *
 * Sources: parts/kode-robotics/manifest.json (footprint 55 x 50 x 14 mm, an ESTIMATE; every terminal), the written
 * spec research/06-official-modules-spec.md section 3 (what is on the board: U501 AT8833CQ in a 16-pin QFN, two
 * 2-way motor terminals, the 4-pin stepper header, J402 servo pins, J403 I2C sockets, J404 sensor sockets, the 2x10
 * right-angle J401) and the maker's store picture for the look (black board with eared corners, amber silkscreen,
 * black terminal blocks with bright screws, tinned header pins). Packages at their datasheet sizes: QFN-16 4 x 4 mm,
 * 3.81 mm terminal blocks, 2.54 mm headers, 1206 sense resistors.
 *
 * Every socket, pin and screw stands on its manifest terminal. J401 is the real 2x10 right-angle header, centred on
 * the manifest's mount pins with its pins pointing at the viewer (+Z, into the Dot's top wall): see shared.ts.
 * The indicator LEDs (RUN, FLT and one per bridge output) are the simulator's own: the real board has none.
 * No maker's logo or wordmark: the print is the plain designation.
 */
import manifest from '../../../../../parts/kode-robotics/manifest.json';
import {
  FONT_HEAD, FONT_MONO, INK, PAL, Shape, defineModel, footprintOf, glowing, part, partState, pinHeader, print, setLamp, silkBox, terminalsFromManifest, text, topQuad,
  type PartState,
} from '../../index';
import { asManifest, chipPassive, earOutline, mountBlock, outlineBoard, pinPoints, rightAngleHeader, screwTerminal381, socketStrip, stripBetween, type KodeMount } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const at = pinPoints(M);
const { w: W, d: D } = footprintOf(M.body);
const mount = mountBlock(M);

const BOARD_Y = 1.3; // the board rests on the solder joints of its through-hole parts
const TOP = BOARD_Y + 1.6;
/** Face of J401's plastic: the manifest's mount rows lie on the bare pins in front of it. */
const J401_Z = mount.z0 - 1.3;
const J401_LEN = D / 2 - 0.2 - J401_Z;
const OUTLINE = earOutline({ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: J401_Z + 1.5, ear: 3.2, inset: { far: 0.4, near: 1.5, side: 1.5 } });

const AMBER = 0xffac00, BLUE = 0x3aa0ff, GREEN = 0x35d06a, RED = 0xff3526;
/** The four bridge outputs: the manifest's output name, the screw it drives, its lamp. */
const OUTS = [
  { out: 'aout1', pin: 'MOTA_1', lamp: 'led-a1', label: 'A1', colour: AMBER },
  { out: 'aout2', pin: 'MOTA_2', lamp: 'led-a2', label: 'A2', colour: AMBER },
  { out: 'bout1', pin: 'MOTB_1', lamp: 'led-b1', label: 'B1', colour: BLUE },
  { out: 'bout2', pin: 'MOTB_2', lamp: 'led-b2', label: 'B2', colour: BLUE },
] as const;
const LED_Z = at.STP_1[2] + 4.4;
const U501 = { x: 3.2, z: -1.2 };
const RUN = { x: -9.4, z: 7.2 }, FLT = { x: -9.4, z: 10.4 };

/** The lens of a chip LED, alone in its Shape so that one copy can light it; its tinned ends are part of the body. */
function ledLens(x: number, z: number): Shape {
  const s = new Shape();
  s.box('gloss', '#6f6c66', x, z, 1.3, 1.1, TOP + 0.02, TOP + 0.78, 0.2, 0.2, { ao: 1 });
  return s;
}
function ledEnds(s: Shape, x: number, z: number): void {
  for (const sx of [-1, 1]) s.box(...PAL.tin, x + sx * 0.82, z, 0.42, 1.05, TOP, TOP + 0.62, 0, 0.08, { ao: 0.95 });
}

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Robotics module',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    const s = new Shape();
    outlineBoard(s, { loop: OUTLINE.loop, y: BOARD_Y, holes: OUTLINE.ears.map(([x, z]) => ({ x, z, d: 3.2 })) });

    // motor terminals: two 2-way blocks side by side, wires in from the far edge
    screwTerminal381(s, { x: (at.MOTA_1[0] + at.MOTA_2[0]) / 2, z: at.MOTA_1[2] - 0.9, y: TOP, n: 2, pitch: at.MOTA_2[0] - at.MOTA_1[0] });
    screwTerminal381(s, { x: (at.MOTB_1[0] + at.MOTB_2[0]) / 2, z: at.MOTB_1[2] - 0.9, y: TOP, n: 2, pitch: at.MOTB_2[0] - at.MOTB_1[0] });
    // stepper and servo: bare pins; I2C and sensors: sockets
    pinHeader(s, { ...stripBetween(at.STP_1, at.STP_4), y: TOP, n: 4, length: 5.4 });
    pinHeader(s, { ...stripBetween(at.J402_GND, at.J402_SIG), y: TOP, n: 3, length: 5.4 });
    socketStrip(s, { ...stripBetween(at.J403_GND, at.J403_V33), y: TOP, n: 5 });
    socketStrip(s, { ...stripBetween(at.J404_V33, at.J404_GND), y: TOP, n: 6 });
    const tip = rightAngleHeader(s, { x: mount.x, y: TOP, z: J401_Z, n: 10, length: J401_LEN });

    // U501's pads (its body glows on a fault, so it is a part of its own), and what stands round it
    for (let q = 0; q < 4; q++) for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 0.65, e = 2.02;
      const [px, pz] = q === 0 ? [o, e] : q === 1 ? [e, o] : q === 2 ? [o, -e] : [-e, o];
      s.box(...PAL.tin, U501.x + px, U501.z + pz, q % 2 ? 0.24 : 0.32, q % 2 ? 0.32 : 0.24, TOP, TOP + 0.3, 0, 0, { ao: 1 });
    }
    chipPassive(s, { x: U501.x - 5.6, z: U501.z - 4.6, y: TOP, l: 3.2, w: 1.6 }); // R504, motor A current sense
    chipPassive(s, { x: U501.x + 5.6, z: U501.z - 4.6, y: TOP, l: 3.2, w: 1.6 }); // R503, motor B current sense
    chipPassive(s, { x: U501.x, z: U501.z + 5.4, y: TOP, l: 3.2, w: 1.6, h: 1.1, body: PAL.ceramic }); // bulk capacitor on 5 V
    chipPassive(s, { x: U501.x - 4.6, z: U501.z + 0.4, y: TOP, turn: 1, body: PAL.ceramic });
    chipPassive(s, { x: U501.x + 4.6, z: U501.z + 0.4, y: TOP, turn: 1, body: PAL.ceramic });
    chipPassive(s, { x: U501.x + 7.4, z: U501.z + 2.2, y: TOP, turn: 1 }); // 10 k on nFAULT
    chipPassive(s, { x: U501.x + 9.6, z: U501.z + 2.2, y: TOP, turn: 1 }); // 10 k on nSLEEP
    chipPassive(s, { x: -15.2, z: -9.4, y: TOP }); // 2.2 k on SDA
    chipPassive(s, { x: -11.6, z: -9.4, y: TOP }); // 2.2 k on SCL
    for (const o of OUTS) ledEnds(s, at[o.pin][0], LED_Z);
    ledEnds(s, RUN.x, RUN.z);
    ledEnds(s, FLT.x, FLT.z);

    const root = s.toObject();
    const chip = new Shape();
    chip.box(...PAL.epoxyBlack, U501.x, U501.z, 4, 4, TOP + 0.03, TOP + 0.85, 0.2, 0.12, { ao: 0.95 });
    chip.disc('matte', '#3a3a3f', U501.x - 1.35, U501.z + 1.35, 0.3, TOP + 0.85, TOP + 0.87, 0, ctx.seg(10), { ao: 1 });
    // the heat round the driver when it faults: hidden until then
    const heat = new Shape();
    heat.disc('glass', '#ff3a1a', U501.x, U501.z, 6.4, TOP + 0.03, TOP + 0.07, 0, ctx.seg(22), { ao: 1 });
    const hot = glowing('heat', heat);
    hot.visible = false;
    root.add(
      hot,
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 16,
        draw(g) {
          const label = (t: string, x: number, z: number, align: CanvasTextAlign = 'left', size = 1.2) => text(g, t, x, z, size, { font: FONT_MONO, weight: 700, align });
          g.fillStyle = INK.amber;
          // the three side connectors, each contact named as the manifest names it
          label('GND', at.J402_GND[0] + 2.1, at.J402_GND[2]);
          label('5V', at.J402_V5[0] + 2.1, at.J402_V5[2]);
          label('SERVO 11', at.J402_SIG[0] + 2.1, at.J402_SIG[2]);
          label('GND', at.J403_GND[0] + 2.1, at.J403_GND[2]);
          label('GPIO10', at.J403_GPIO10[0] + 2.1, at.J403_GPIO10[2]);
          label('SDA 9', at.J403_SDA[0] + 2.1, at.J403_SDA[2]);
          label('SCL 8', at.J403_SCL[0] + 2.1, at.J403_SCL[2]);
          label('3V3', at.J403_V33[0] + 2.1, at.J403_V33[2]);
          label('3V3', at.J404_V33[0] - 2.1, at.J404_V33[2], 'right');
          label('GPIO15', at.J404_15[0] - 2.1, at.J404_15[2], 'right');
          label('GPIO16', at.J404_16[0] - 2.1, at.J404_16[2], 'right');
          label('GPIO17', at.J404_17[0] - 2.1, at.J404_17[2], 'right');
          label('GPIO18', at.J404_18[0] - 2.1, at.J404_18[2], 'right');
          label('GND', at.J404_GND[0] - 2.1, at.J404_GND[2], 'right');
          // the motor side
          text(g, 'motor A', at.MOTA_1[0] - 3.2, at.MOTA_1[2] - 0.4, 1.7, { font: FONT_HEAD, weight: 700, align: 'right' });
          text(g, 'motor B', at.MOTB_2[0] + 3.2, at.MOTB_2[2] - 0.4, 1.7, { font: FONT_HEAD, weight: 700, align: 'left' });
          text(g, 'stepper', at.STP_4[0] + 2.2, at.STP_4[2] + 0.1, 1.45, { font: FONT_HEAD, weight: 700, align: 'left' });
          for (const o of OUTS) label(o.label, at[o.pin][0], LED_Z + 1.9, 'center', 1.05);
          label('RUN', RUN.x + 1.9, RUN.z, 'left', 1.05);
          label('FLT', FLT.x + 1.9, FLT.z, 'left', 1.05);
          label('U501', U501.x + 2.9, U501.z - 2.3, 'left', 0.9);
          label('J401', mount.x + 13.6, J401_Z - 1.3, 'left', 0.9);
          silkBox(g, U501.x - 2.55, U501.z - 2.55, 5.1, 5.1, 0.3, 0.14, INK.amber);
          // the plain designation, where the maker prints its mark
          text(g, 'ROBOTICS', U501.x + 3.4, 8.3, 2.3, { font: FONT_HEAD, weight: 700, spacing: 0.5 });
          text(g, 'KDROB001  rev 1.0', U501.x + 3.4, 10.8, 1.1, { font: FONT_MONO, weight: 700 });
        },
      }),
      glowing('u501', chip),
      glowing('led-run', ledLens(RUN.x, RUN.z)),
      glowing('led-flt', ledLens(FLT.x, FLT.z)),
      ...OUTS.map((o) => glowing(o.lamp, ledLens(at[o.pin][0], LED_Z))),
    );
    root.userData.kodeMount = { pos: tip, dir: [0, 0, 1], via: M.mount?.via ?? 'direct' } satisfies KodeMount;
    return root;
  },
  terminals,
  animate(st, obj, env) {
    const p = st.pins, o = st.outputs;
    const on = st.power.on;
    // the driver sleeps (outputs high impedance) until nSLEEP is high
    const awake = on && (p.NSLEEP ? p.NSLEEP.mv > 1500 : true);
    // a fault: the engine says so, or nFAULT is pulled low while its 3.3 V pull-up is fed
    const railUp = p.V33 ? p.V33.mv > 2500 : true;
    const fault = on && (o.fault === true || o.overcurrent === true || st.crashed === true || (p.NFAULT !== undefined && railUp && !p.NFAULT.floating && p.NFAULT.mv < 600));
    setLamp(obj, 'led-run', awake ? GREEN : AMBER, awake ? 1 : on ? 0.35 : 0);
    for (let i = 0; i < OUTS.length; i++) setLamp(obj, OUTS[i].lamp, OUTS[i].colour, awake && !fault ? Number(o[OUTS[i].out] ?? 0) : 0);
    part(obj, 'heat')!.visible = fault;
    if (fault) {
      // unmistakable: the fault lamp hammers, the driver glows and the board round it is red hot
      const beat = Math.floor(env.time * 6) % 2 === 0;
      setLamp(obj, 'led-flt', RED, beat ? 1.4 : 0.15);
      setLamp(obj, 'u501', 0xe01800, 0.45 + 0.2 * Math.sin(env.time * 9));
      setLamp(obj, 'heat', 0xff2a10, 0.75 + 0.25 * Math.sin(env.time * 9));
      return true;
    }
    setLamp(obj, 'led-flt', RED, 0);
    setLamp(obj, 'u501', 0, 0);
  },
  states: {
    off: partState({ power: { on: false, reason: 'no 5 V' } }),
    asleep: partState({ outputs: { aout1: 0, aout2: 0, bout1: 0, bout2: 0 }, pins: { NSLEEP: { mv: 0, level: 0, floating: false }, NFAULT: { mv: 3300, level: 1, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
    driving: partState({ outputs: { aout1: 1, aout2: 0, bout1: 0, bout2: 0.6 }, pins: { NSLEEP: { mv: 3300, level: 1, floating: false }, NFAULT: { mv: 3300, level: 1, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
    fault: partState({ outputs: { aout1: 1, aout2: 0, bout1: 0, bout2: 0 }, pins: { NSLEEP: { mv: 3300, level: 1, floating: false }, NFAULT: { mv: 40, level: 0, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
  },
});
