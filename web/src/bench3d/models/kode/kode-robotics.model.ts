/**
 * Kode Robotics module (KDROB001 rev 1.0): a dual H-bridge carrier for the Dot's expansion header.
 *
 * Sources: parts/kode-robotics/manifest.json (footprint 58 x 60 x 14 mm with the header's pins, an ESTIMATE; every
 * terminal; the connector's seat) and the maker's store picture (ref-4, never copied) for everything seen: the black
 * board with eared corners and gold-ringed holes; on the far edge, left to right, the "motor B" terminal block, the
 * four straight "stepper" pins and the "motor A" block (black blocks, big bright screws); the three "servo" pins and
 * the I2C sockets down the left edge, the sensor sockets down the right, each contact named in gold beside it; the
 * small QFN driver with its passives in the middle; the 2x10 right-angle header with bright pins on the near edge.
 * The print is the functional legends the picture shows and the board's own name and revision. The maker's name mark
 * and web address, which the real board prints beside the header, are left out (the kit's rule: no real marks).
 * Package sizes are the usual ones (QFN-16 4 x 4 mm, 2.54 mm headers, 1206 sense resistors); the terminal blocks
 * take their pitch from the manifest's terminals.
 *
 * Every socket, pin and screw stands on its manifest terminal, the header on the connector's seat.
 *
 * LIVE STATE WITHOUT INVENTED PARTS. The real board has no lamps, so none are drawn. Two things are the simulator's
 * own way of speaking, as a burning LED's glare is: a driven bridge output warms the head of its own screw (a faint
 * amber, by the output's level: it marks the live terminal, nothing more), and a fault (the engine's flag, or nFAULT
 * pulled low while its pull-up rail is fed) makes the driver chip glow red hot on a scorched patch of board.
 */
import manifest from '../../../../../parts/kode-robotics/manifest.json';
import { FONT, INK, PAL, PITCH, Shape, defineModel, footprintOf, glowing, part, partState, print, setLamp, terminalsFromManifest, text, topQuad, type PartState, type Pt } from '../../index';
import { asManifest, chipPassive, connectorOf, earOutline, outlineBoard, pinPoints, pinStrip, rightAngleHeader, screwBlock, socketStrip, stripBetween } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const at = pinPoints(M);
const { w: W, d: D } = footprintOf(M.body);
const con = connectorOf(M);

const TOP = con.seat[1] - PITCH; // the header's two rows stand 1.27 and 3.81 mm above the board
const BOARD_Y = Math.max(0, TOP - 1.6);
const EDGE = con.seat[2]; // the near edge of the board: J401's plastic ends here, its pins go on
const OUTLINE = earOutline({ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: EDGE + 0.6, ear: 5, inset: { far: 0.9, near: 1.2, side: 1.3 }, blend: 5 });

const AMBER = 0xffac00;
/** The four bridge outputs: the manifest's output name, the screw it drives, the part that shows it live. */
const OUTS = [
  { out: 'aout1', pin: 'MOTA_1', screw: 'screw-a1' },
  { out: 'aout2', pin: 'MOTA_2', screw: 'screw-a2' },
  { out: 'bout1', pin: 'MOTB_1', screw: 'screw-b1' },
  { out: 'bout2', pin: 'MOTB_2', screw: 'screw-b2' },
] as const;
const MOT_PITCH = Math.abs(at.MOTA_2[0] - at.MOTA_1[0]);
const BLOCK = { h: MOT_PITCH * 1.85, r: MOT_PITCH * 0.31, d: MOT_PITCH * 1.5 }; // as `screwBlock` makes them
const U501 = { x: 0.6, z: (at.STP_1[2] + EDGE) / 2 - 5 };
/** The passives round the driver, as the picture places them: the two sense resistors above it, small parts beside and below. */
const PASSIVES: { x: number; z: number; turn?: number; l?: number; w?: number; pale?: boolean }[] = [
  { x: -1.7, z: -6.6, turn: 1, l: 3.2, w: 1.6, pale: true },
  { x: 2.9, z: -5.4, turn: 1, l: 3.2, w: 1.6, pale: true },
  { x: -5.6, z: -2.4 },
  { x: 5.4, z: 1.2 },
  { x: -4.6, z: 3.6, turn: 1 },
  { x: -2.6, z: 4.6, turn: 1 },
  { x: -3.6, z: 6.8 },
];
/** The gold legend beside each side contact, as printed on the real board. */
const LEGEND: Record<string, string> = {
  J402_GND: 'GND', J402_V5: '5V', J402_SIG: 'GPIO11',
  J403_GND: 'GND', J403_GPIO10: 'GPIO10', J403_SDA: 'SDA(GPIO9)', J403_SCL: 'SCL (GPIO8)', J403_V33: '3V3',
  J404_GND: 'GND', J404_18: 'GPIO18', J404_17: 'GPIO17', J404_16: 'GPIO16', J404_15: 'GPIO15', J404_V33: '3V3',
};
const ring = (x: number, z: number, r: number, n: number): Pt[] => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * Math.PI * 2), z + r * Math.sin((i / n) * Math.PI * 2)] as Pt);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Robotics module',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    const s = new Shape();
    outlineBoard(s, { loop: OUTLINE.loop, y: BOARD_Y, holes: OUTLINE.ears.map(([x, z]) => ({ x, z, d: 3.2 })) });

    // the far edge: motor B block, stepper pins, motor A block
    for (const [a, b] of [['MOTB_1', 'MOTB_2'], ['MOTA_1', 'MOTA_2']] as const) screwBlock(s, { x: (at[a][0] + at[b][0]) / 2, z: at[a][2], y: TOP, n: 2, pitch: MOT_PITCH, seg: ctx.seg(16) });
    for (const o of OUTS) s.box('matte', '#3c3d42', at[o.pin][0], at[o.pin][2], BLOCK.r * 1.7, 0.5, TOP + BLOCK.h + 0.14, TOP + BLOCK.h + 0.17, 0, 0, { ao: 1 });
    pinStrip(s, { ...stripBetween(at.STP_1, at.STP_4), y: TOP, n: 4, length: 6 });
    // the left edge: servo pins, then the I2C sockets; the right edge: the sensor sockets
    pinStrip(s, { ...stripBetween(at.J402_GND, at.J402_SIG), y: TOP, n: 3, length: 6 });
    socketStrip(s, { ...stripBetween(at.J403_GND, at.J403_V33), y: TOP, n: 5 });
    socketStrip(s, { ...stripBetween(at.J404_GND, at.J404_V33), y: TOP, n: 6 });
    rightAngleHeader(s, { x: con.seat[0], y: TOP, z: EDGE, n: 10, length: con.length, tail: TOP - BOARD_Y - 0.05 });

    // the driver's pads (its body is a part of its own: it glows on a fault) and its passives
    for (let q = 0; q < 4; q++) for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 0.65, e = 2.02;
      const [px, pz] = q === 0 ? [o, e] : q === 1 ? [e, o] : q === 2 ? [o, -e] : [-e, o];
      s.box(...PAL.tin, U501.x + px, U501.z + pz, q % 2 ? 0.24 : 0.32, q % 2 ? 0.32 : 0.24, TOP, TOP + 0.3, 0, 0, { ao: 1 });
    }
    for (const p of PASSIVES) chipPassive(s, { x: U501.x + p.x, z: U501.z + p.z, y: TOP, turn: p.turn, l: p.l, w: p.w, body: p.pale ? ['matte', '#cfd0d2'] : PAL.ceramic });
    // three fiducials: a bare gold dot in a gold ring
    for (const [x, z] of [[-W / 2 + 8.6, EDGE - 2.6], [W / 2 - 8.6, EDGE - 2.6], [at.J404_GND[0] - 0.4, at.J404_GND[2] - 5]]) {
      s.disc(...PAL.gold, x, z, 0.55, TOP, TOP + 0.04, 0, ctx.seg(10), { ao: 1 });
      s.prism(...PAL.gold, ring(x, z, 1.0, ctx.seg(14)), TOP, TOP + 0.03, 0, { ao: 1, holes: [ring(x, z, 0.82, ctx.seg(14))] });
    }

    const root = s.toObject();
    const chip = new Shape();
    chip.box('matte', '#303034', U501.x, U501.z, 4, 4, TOP + 0.03, TOP + 0.85, 0.2, 0.12, { ao: 0.95 });
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
          g.fillStyle = g.strokeStyle = INK.amber;
          g.lineWidth = 0.2;
          const label = (t: string, x: number, z: number, align: CanvasTextAlign = 'left', size = 1.7) => text(g, t, x, z, size, { font: FONT, weight: 700, align });
          // the side connectors: each contact's name beside it, and the corner brackets of their outlines
          for (const [name, t] of Object.entries(LEGEND)) {
            const left = at[name][0] < 0;
            label(t, at[name][0] + (left ? 2.2 : -2.2), at[name][2] + 0.05, left ? 'left' : 'right');
          }
          label('servo', at.J402_GND[0] - 1.3, at.J402_GND[2] - 3, 'left', 1.6);
          for (const [a, b] of [['J402_GND', 'J403_V33'], ['J404_GND', 'J404_V33']] as const) {
            const x = at[a][0], sx = x < 0 ? 1 : -1, z0 = at[a][2] - 1.6, z1 = at[b][2] + 1.6;
            g.beginPath();
            g.moveTo(x - sx * 1.6, z1 - 2.2);
            g.lineTo(x - sx * 1.6, z1);
            g.lineTo(x + sx * 1.6, z1);
            g.moveTo(x + sx * 1.6, z0 + 2);
            g.lineTo(x + sx * 1.6, z0);
            g.stroke();
          }
          // the far edge: each connector's name under it, with the bracket that ties it to its part
          const below = at.MOTB_1[2] + BLOCK.d / 2;
          const named = (t: string, x0: number, x1: number, z: number, size: number) => {
            text(g, t, (x0 + x1) / 2, z + 2.3, size, { font: FONT, weight: 700 });
            g.beginPath();
            g.moveTo(x0, z - 1.2);
            g.lineTo(x0, z + 0.5);
            g.lineTo(x0 + 1.6, z + 0.5);
            g.moveTo(x1, z - 1.2);
            g.lineTo(x1, z + 0.5);
            g.lineTo(x1 - 1.6, z + 0.5);
            g.stroke();
          };
          named('motor B', at.MOTB_1[0] - MOT_PITCH / 2 - 0.3, at.MOTB_2[0] + MOT_PITCH / 2 + 0.3, below, 2.3);
          named('motor A', at.MOTA_1[0] - MOT_PITCH / 2 - 0.3, at.MOTA_2[0] + MOT_PITCH / 2 + 0.3, below, 2.3);
          named('stepper', at.STP_1[0] - 1.9, at.STP_4[0] + 1.9, at.STP_1[2] + 1.9, 2.05);
          // the outline of every passive
          g.lineWidth = 0.16;
          for (const p of PASSIVES) {
            const l = (p.l ?? 2) + 0.9, w = (p.w ?? 1.25) + 0.7;
            g.strokeRect(U501.x + p.x - (p.turn ? w : l) / 2, U501.z + p.z - (p.turn ? l : w) / 2, p.turn ? w : l, p.turn ? l : w);
          }
          // beside the header: the board's own name and revision, as the real board prints them
          text(g, 'robotics rev1.0', con.seat[0] - 3.4, EDGE - 2 * PITCH - 5.6, 1.75, { font: FONT, weight: 700, align: 'left' });
        },
      }),
      glowing('u501', chip),
      ...OUTS.map((o) => {
        const screw = new Shape();
        screw.disc(...PAL.tin, at[o.pin][0], at[o.pin][2], BLOCK.r, TOP + BLOCK.h - 0.3, TOP + BLOCK.h + 0.14, 0.14, ctx.seg(16), { ao: 1 });
        return glowing(o.screw, screw);
      }),
    );
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
    // a driven output warms its own screw: faint, by its level
    for (let i = 0; i < OUTS.length; i++) {
      const level = awake && !fault ? Number(o[OUTS[i].out] ?? 0) : 0;
      setLamp(obj, OUTS[i].screw, AMBER, level > 0.02 ? 0.12 + 0.4 * level : 0);
    }
    part(obj, 'heat')!.visible = fault;
    if (fault) {
      setLamp(obj, 'u501', 0xe01800, 0.5 + 0.22 * Math.sin(env.time * 9));
      setLamp(obj, 'heat', 0xff2a10, 0.75 + 0.25 * Math.sin(env.time * 9));
      return true;
    }
    setLamp(obj, 'u501', 0, 0);
  },
  states: {
    off: partState({ power: { on: false, reason: 'no 5 V' } }),
    asleep: partState({ outputs: { aout1: 0, aout2: 0, bout1: 0, bout2: 0 }, pins: { NSLEEP: { mv: 0, level: 0, floating: false }, NFAULT: { mv: 3300, level: 1, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
    driving: partState({ outputs: { aout1: 1, aout2: 0, bout1: 0, bout2: 0.6 }, pins: { NSLEEP: { mv: 3300, level: 1, floating: false }, NFAULT: { mv: 3300, level: 1, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
    fault: partState({ outputs: { aout1: 1, aout2: 0, bout1: 0, bout2: 0 }, pins: { NSLEEP: { mv: 3300, level: 1, floating: false }, NFAULT: { mv: 40, level: 0, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
  },
});
