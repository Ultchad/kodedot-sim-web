/**
 * Kode Robotics module (KDROB001 rev 1.0): a dual H-bridge carrier for the Dot's expansion header.
 *
 * Sources: parts/kode-robotics/manifest.json (the footprint: a 45 x 40.5 mm board plus the header's pins; the four
 * mounting holes; every terminal; the connector's seat: measured from the picture by the parts engineer, an
 * ESTIMATE) and the maker's store picture (ref-4, never copied) for everything seen: the black rounded-square board
 * with a gold-ringed hole in each corner; on the far edge, left to right, the "motor B" terminal block, the four
 * straight "stepper" pins and the "motor A" block (black blocks, big bright slotted screws, 3.81 mm apart); the three
 * "servo" pins and the I2C sockets down the left edge, the sensor sockets down the right, each contact named in gold
 * beside it; the small QFN driver in the middle with its two sense resistors above it, a small part on either side
 * and four below; the 2x10 right-angle header with bright pins on the near edge.
 * The print is the functional legends the picture shows and the board's own name and revision. The maker's logo, name
 * mark and web address, which the real board prints above the header, are left out (the kit's rule: no real marks).
 * Package sizes are the usual ones (QFN-16 4 x 4 mm, 2.54 mm headers, 1206 sense resistors, 0603 and 0402 parts).
 *
 * WHAT COMES FROM WHERE. The board, its holes, every socket, pin and screw and the header stand where the manifest
 * says, and take their heights and pitches from its terminals; nothing of that is typed here. What the manifest does
 * not hold is laid out as the picture shows it, relative to those: the driver by the board's own proportions, the
 * passives round the driver, each legend beside the contact it names.
 *
 * LIVE STATE WITHOUT INVENTED PARTS. The real board has no lamps, so none are drawn. Two things are the simulator's
 * own way of speaking, as a burning LED's glare is: a driven bridge output warms the head of its own screw (a faint
 * amber, by the output's level: it marks the live terminal, nothing more), and a fault (the engine's flag, or nFAULT
 * pulled low while its pull-up rail is fed) makes the driver chip glow red hot, with its heat on the board round it.
 */
import manifest from '../../../../../parts/kode-robotics/manifest.json';
import { PAL, PITCH, Shape, defineModel, footprintOf, glowing, halo, partState, print, setLamp, terminalsFromManifest, topQuad, type PartState, type Pt } from '../../index';
import { RING, SILK, asManifest, chipPassive, connectorOf, moduleBoard, outlineBoard, pinPoints, pinStrip, rightAngleHeader, screwBlock, socketStrip, silkText, stripBetween, tailRows } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const at = pinPoints(M);
const { w: W, d: D } = footprintOf(M.body);
const con = connectorOf(M);
const B = moduleBoard(M);
const TOP = B.top; // the top face of the board
const EDGE = B.near; // its near edge: J401's plastic ends here, its pins go on

const AMBER = 0xffac00;
/** The four bridge outputs: the manifest's output name, the screw it drives, the part that shows it live. */
const OUTS = [
  { out: 'aout1', pin: 'MOTA_1', screw: 'screw-a1' },
  { out: 'aout2', pin: 'MOTA_2', screw: 'screw-a2' },
  { out: 'bout1', pin: 'MOTB_1', screw: 'screw-b1' },
  { out: 'bout2', pin: 'MOTB_2', screw: 'screw-b2' },
] as const;
/** The terminal blocks: pitch and height (the screw heads are the terminals) from the manifest. */
const MOT_PITCH = Math.abs(at.MOTA_2[0] - at.MOTA_1[0]);
const BLOCK = { h: at.MOTA_1[1] - TOP, d: MOT_PITCH * 1.5, r: MOT_PITCH * 0.33 };
/** A straight pin's length above its 2.5 mm plastic, and a socket's height: up to their terminals. */
const PIN_LEN = at.STP_1[1] - TOP - 2.5;
const SOCKET_H = at.J403_GND[1] - TOP;
/** The driver: in the middle of the board's width, four tenths of the way down it (the picture). */
const U501 = { x: (B.x0 + B.x1) / 2, z: B.far + 0.393 * (B.near - B.far) };
/**
 * The passives round the driver, in millimetres from its centre, as the picture places them: the two sense resistors
 * side by side above it (dark bodies, wide bright ends), one small part on either side, one just below and three in
 * a row below that.
 */
const PASSIVES: { x: number; z: number; turn?: number; l?: number; w?: number; sense?: boolean }[] = [
  { x: -1.95, z: -4.5, turn: 1, l: 3.2, w: 1.6, sense: true },
  { x: 1.8, z: -4.5, turn: 1, l: 3.2, w: 1.6, sense: true },
  { x: -4.2, z: -0.2 },
  { x: 4.2, z: -0.3 },
  { x: -0.65, z: 3.45, l: 1.2, w: 0.6 },
  { x: -1.9, z: 5.3, turn: 1, l: 1.2, w: 0.6 },
  { x: -0.6, z: 5.3, turn: 1, w: 0.9 },
  { x: 0.55, z: 5.3, turn: 1, l: 1.2, w: 0.6 },
];
const SIZE = { l: 1.6, w: 0.8 }; // a passive that gives no size: 0603
/** The gold legend beside each side contact, as printed on the real board. */
const LEGEND: Record<string, string> = {
  J402_GND: 'GND', J402_V5: '5V', J402_SIG: 'GPIO11',
  J403_GND: 'GND', J403_GPIO10: 'GPIO10', J403_SDA: 'SDA(GPIO9)', J403_SCL: 'SCL (GPIO8)', J403_V33: '3V3',
  J404_GND: 'GND', J404_18: 'GPIO18', J404_17: 'GPIO17', J404_16: 'GPIO16', J404_15: 'GPIO15', J404_V33: '3V3',
};
/** The three fiducials: one beyond each end of the header, one before the first contact of the sensor sockets. */
const FIDUCIALS: Pt[] = [
  [con.seat[0] - 5 * PITCH - 1.9, EDGE - 1.4],
  [con.seat[0] + 5 * PITCH + 1.9, EDGE - 1.4],
  [at.J404_GND[0], at.J404_GND[2] - PITCH / 2 - 1.9],
];
const ring = (x: number, z: number, r: number, n: number): Pt[] => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * Math.PI * 2), z + r * Math.sin((i / n) * Math.PI * 2)] as Pt);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Robotics module',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    const s = new Shape();
    outlineBoard(s, { loop: B.loop, y: B.under, thick: TOP - B.under, holes: B.holes });

    // the far edge: motor B block, stepper pins, motor A block
    for (const [a, b] of [['MOTB_1', 'MOTB_2'], ['MOTA_1', 'MOTA_2']] as const) screwBlock(s, { x: (at[a][0] + at[b][0]) / 2, z: at[a][2], y: TOP, n: 2, pitch: MOT_PITCH, h: BLOCK.h, d: BLOCK.d, seg: ctx.seg(16) });
    for (const o of OUTS) s.box('matte', '#3c3d42', at[o.pin][0], at[o.pin][2], BLOCK.r * 1.7, 0.45, TOP + BLOCK.h + 0.14, TOP + BLOCK.h + 0.17, 0, 0, { ao: 1 });
    pinStrip(s, { ...stripBetween(at.STP_1, at.STP_4), y: TOP, n: 4, length: PIN_LEN });
    // the left edge: servo pins, then the I2C sockets; the right edge: the sensor sockets
    pinStrip(s, { ...stripBetween(at.J402_GND, at.J402_SIG), y: TOP, n: 3, length: PIN_LEN });
    socketStrip(s, { ...stripBetween(at.J403_GND, at.J403_V33), y: TOP, n: 5, h: SOCKET_H });
    socketStrip(s, { ...stripBetween(at.J404_GND, at.J404_V33), y: TOP, n: 6, h: SOCKET_H });
    rightAngleHeader(s, { x: con.seat[0], y: TOP, z: EDGE, n: 10, length: con.length, tail: TOP - B.under - 0.05 });

    // the driver's pads (its body is a part of its own: it glows on a fault) and its passives
    for (let q = 0; q < 4; q++) for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 0.65, e = 2.02;
      const [px, pz] = q === 0 ? [o, e] : q === 1 ? [e, o] : q === 2 ? [o, -e] : [-e, o];
      s.box(...PAL.tin, U501.x + px, U501.z + pz, q % 2 ? 0.24 : 0.32, q % 2 ? 0.32 : 0.24, TOP, TOP + 0.3, 0, 0, { ao: 1 });
    }
    for (const p of PASSIVES) chipPassive(s, { x: U501.x + p.x, z: U501.z + p.z, y: TOP, turn: p.turn, l: p.l ?? SIZE.l, w: p.w ?? SIZE.w, h: p.sense ? 0.6 : 0.5, body: p.sense ? PAL.epoxyBlack : PAL.ceramic });
    // the fiducials: a bare dot in a ring
    for (const [x, z] of FIDUCIALS) {
      s.disc(...RING, x, z, 0.4, TOP, TOP + 0.04, 0, ctx.seg(10), { ao: 1 });
      s.prism(...RING, ring(x, z, 0.9, ctx.seg(14)), TOP, TOP + 0.03, 0, { ao: 1, holes: [ring(x, z, 0.76, ctx.seg(14))] });
    }

    const root = s.toObject();
    const chip = new Shape();
    chip.box('matte', '#45454a', U501.x, U501.z, 4, 4, TOP + 0.03, TOP + 0.85, 0.2, 0.12, { ao: 0.95 });
    root.add(
      // the heat a faulted driver throws on the board round it: the kit's halo, dark until then
      halo('heat', [U501.x, TOP + 0.06, U501.z], 10),
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 20,
        draw(g) {
          g.fillStyle = g.strokeStyle = SILK;
          g.lineWidth = 0.18;
          const label = (t: string, x: number, z: number, size: number, align: CanvasTextAlign = 'center', angle = 0) => silkText(g, t, x, z, size, { align, angle });
          // the side connectors: each contact's name beside it, on the board's side of the strip
          for (const [name, t] of Object.entries(LEGEND)) {
            const left = at[name][0] < U501.x;
            label(t, at[name][0] + (left ? 2.6 : -2.6), at[name][2] + 0.05, 1.4, left ? 'left' : 'right');
          }
          // "servo" runs up the board's edge, outside its three pins
          label('servo', (B.x0 + at.J402_GND[0] - PITCH / 2) / 2, (at.J402_GND[2] + at.J402_SIG[2]) / 2, 1.4, 'center', -Math.PI / 2);
          // the corner marks of the side connectors' outlines
          for (const [a, b] of [['J402_GND', 'J403_V33'], ['J404_GND', 'J404_V33']] as const) {
            const x = at[a][0], sx = x < U501.x ? 1 : -1, z0 = at[a][2] - 1.6, z1 = at[b][2] + 1.6;
            g.beginPath();
            g.moveTo(x - sx * 1.6, z1 - 1.8);
            g.lineTo(x - sx * 1.6, z1);
            g.lineTo(x + sx * 1.6, z1);
            g.moveTo(x + sx * 1.6, z0 + 1.6);
            g.lineTo(x + sx * 1.6, z0);
            g.stroke();
          }
          // the far edge: each connector's name under it, with the corner marks that tie it to its part
          const named = (t: string, x0: number, x1: number, face: number, size: number) => {
            label(t, (x0 + x1) / 2, face + 0.45 + 0.35 + size * 0.36, size);
            g.beginPath();
            g.moveTo(x0, face - 1);
            g.lineTo(x0, face + 0.45);
            g.lineTo(x0 + 1.4, face + 0.45);
            g.moveTo(x1, face - 1);
            g.lineTo(x1, face + 0.45);
            g.lineTo(x1 - 1.4, face + 0.45);
            g.stroke();
          };
          const face = at.MOTB_1[2] + BLOCK.d / 2;
          named('motor B', at.MOTB_1[0] - MOT_PITCH / 2 - 0.3, at.MOTB_2[0] + MOT_PITCH / 2 + 0.3, face, 2);
          named('motor A', at.MOTA_1[0] - MOT_PITCH / 2 - 0.3, at.MOTA_2[0] + MOT_PITCH / 2 + 0.3, face, 2);
          named('stepper', at.STP_1[0] - PITCH / 2 - 0.3, at.STP_4[0] + PITCH / 2 + 0.3, at.STP_1[2] + PITCH / 2, 1.9);
          // the outline of every passive
          g.lineWidth = 0.14;
          for (const p of PASSIVES) {
            const l = (p.l ?? SIZE.l) + 0.7, w = (p.w ?? SIZE.w) + 0.5;
            g.strokeRect(U501.x + p.x - (p.turn ? w : l) / 2, U501.z + p.z - (p.turn ? l : w) / 2, p.turn ? w : l, p.turn ? l : w);
          }
          // above the header, from the middle of the board to the right: the board's own name and revision
          const [, tails] = tailRows(EDGE);
          label('robotics rev1.0', con.seat[0], tails - 2.9, 1.72, 'left');
          // the end of the header's outline, right of its last pin
          const end = con.seat[0] + 5 * PITCH + 0.5;
          g.lineWidth = 0.18;
          g.beginPath();
          g.moveTo(end - 1.2, tails - 1.25);
          g.lineTo(end, tails - 1.25);
          g.lineTo(end, EDGE - PITCH - 0.2);
          g.stroke();
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
    if (fault) {
      setLamp(obj, 'u501', 0xe01800, 0.5 + 0.22 * Math.sin(env.time * 9));
      setLamp(obj, 'heat', 0xff3410, 0.8 + 0.2 * Math.sin(env.time * 9));
      return true;
    }
    setLamp(obj, 'u501', 0, 0);
    setLamp(obj, 'heat', 0, 0);
  },
  states: {
    off: partState({ power: { on: false, reason: 'no 5 V' } }),
    asleep: partState({ outputs: { aout1: 0, aout2: 0, bout1: 0, bout2: 0 }, pins: { NSLEEP: { mv: 0, level: 0, floating: false }, NFAULT: { mv: 3300, level: 1, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
    driving: partState({ outputs: { aout1: 1, aout2: 0, bout1: 0, bout2: 0.6 }, pins: { NSLEEP: { mv: 3300, level: 1, floating: false }, NFAULT: { mv: 3300, level: 1, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
    fault: partState({ outputs: { aout1: 1, aout2: 0, bout1: 0, bout2: 0 }, pins: { NSLEEP: { mv: 3300, level: 1, floating: false }, NFAULT: { mv: 40, level: 0, floating: false }, V33: { mv: 3300, level: 1, floating: false } } }),
  },
});
