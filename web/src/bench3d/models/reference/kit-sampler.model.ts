/**
 * Every builder of parts.ts on one invented board: the kit's sampler. It is here to be looked at (run the shot script
 * on `ref.kit-sampler`) and copied from; it is not a part of any library.
 */
import {
  INK, PAL, PITCH, Shape, barrelJack, defineModel, electrolytic, gear, glowing, heatsink, lamp, ledDome, ledLeads, microUsb, moduleCan, pcb, pinHeader, pinLabels, print,
  qfn, qfp, screwTerminal, setLamp, shaft, silkBox, soic, tactButton, text, topQuad, usbB, usbC, axialLeads, pad, part, type Terminal,
} from '../../index';

const W = 100, D = 70;
const LABELS = ['5V', 'GND', 'D2', 'D3', 'D4', 'D5', 'A0', 'A1', 'SDA', 'SCL'];

// the terminals come from what the builders return: computed once, with the body
const terminals: Terminal[] = [];
function body(seg: (n: number) => number) {
  const s = new Shape();
  // through-hole pins poke 2.8 mm out of the underside: the board rests on them, 1.3 mm above the table
  const top = pcb(s, { w: W, d: D, y: 1.3, r: 3, finish: PAL.pcbBlue, holes: [{ x: -46, z: -31, d: 3.2 }, { x: 46, z: -31, d: 3.2 }, { x: -46, z: 31, d: 3.2 }, { x: 46, z: 31, d: 3.2 }] });
  const pins = pinHeader(s, { x: -18, z: -29, y: top, n: 10 });
  const sockets = pinHeader(s, { x: 24, z: -29, y: top, n: 6, female: true });
  soic(s, { x: -30, z: -12, y: top, pins: 8 });
  qfp(s, { x: -12, z: -10, y: top, size: 10, perSide: 11 });
  qfn(s, { x: 4, z: -12, y: top, size: 5, perSide: 8 });
  moduleCan(s, { x: 30, z: -8, y: top, w: 18, d: 25.5, canD: 17.5 });
  const c = usbC(s, { x: -30, z: D / 2 + 0.4, y: top });
  microUsb(s, { x: -14, z: D / 2 + 0.4, y: top });
  usbB(s, { x: W / 2 + 1, z: 8, y: top, turn: 3 });
  barrelJack(s, { x: -W / 2 - 1, z: 14, y: top, turn: 1 });
  tactButton(s, { x: 2, z: 6, y: top, cap: PAL.plasticRed });
  electrolytic(s, { x: -32, z: 6, y: top });
  electrolytic(s, { x: -22, z: 6, y: top, d: 5, h: 7, sleeve: ['gloss', '#2b2b2f'] });
  const wires = screwTerminal(s, { x: 8, z: 29, y: top, n: 3 });
  heatsink(s, { x: 16, z: 8, y: top + 1, w: 10, d: 10, h: 8, fins: 6 });
  shaft(s, { x: 38, z: 24, y0: top, y1: top + 9, d: 3, flat: 0.5 });
  gear(s, { x: 38, z: 24, y0: top + 3.2, y1: top + 5.4, r: 6, teeth: 16, bore: 3, finish: PAL.plasticAmber });
  // an axial resistor lying over the board, a row of empty pads, an LED's leads
  s.rod(...PAL.ceramic, [-14, top + 1.7, 20], [-7.6, top + 1.7, 20], 1.15, seg(12));
  axialLeads(s, { x0: -14, x1: -7.6, z: 20, y: top + 1.7, span: 4 * PITCH, board: top });
  for (let i = 0; i < 4; i++) pad(s, -34 + i * PITCH, 22, top);
  const [a, k] = ledLeads(s, { x: -22, z: 28, y: top + 3, board: top });
  if (!terminals.length) {
    pins.forEach((p, i) => terminals.push({ id: LABELS[i], pos: p, kind: 'pin' }));
    sockets.forEach((p, i) => terminals.push({ id: `J2.${i + 1}`, pos: p, kind: 'socket' }));
    wires.forEach((p, i) => terminals.push({ id: `T${i + 1}`, pos: p, dir: [0, 0, 1], kind: 'screw' }));
    terminals.push({ id: 'USB', pos: c, dir: [0, 0, 1], kind: 'socket' }, { id: 'LED.A', pos: a, kind: 'pad' }, { id: 'LED.K', pos: k, kind: 'pad' });
  }
  return { s, top };
}
body((n) => n); // fills `terminals`

export default defineModel<{ led: number; power: boolean }>({
  id: 'ref.kit-sampler',
  title: 'Kit sampler (every builder)',
  footprintMm: { w: 104, d: 72, h: 16 },
  budget: 16000, // a dozen kinds of parts on one board, on purpose
  build(ctx) {
    const { s, top } = body(ctx.seg);
    const root = s.toObject();
    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, top + 0.02, W / 2, D / 2),
        ppm: 9,
        draw(g) {
          pinLabels(g, LABELS, -18 - 4.5 * PITCH, -24.8, PITCH, 1.25, { vertical: true, align: 'right' });
          g.fillStyle = INK.silk;
          text(g, 'KIT SAMPLER', 8, 16.5, 2.6, { weight: 800, spacing: 0.4 });
          text(g, 'rev A  ·  bench3d', 8, 20.2, 1.5, { weight: 600 });
          text(g, 'U1', -30, -17.3, 1.3);
          text(g, 'U2', -12, -18, 1.3);
          text(g, 'U3', 4, -17, 1.3);
          text(g, 'C1', -32, 12, 1.3);
          text(g, 'R1', -10.8, 23.3, 1.3);
          text(g, 'SW1', 2, 11.8, 1.3);
          silkBox(g, -33.2, -15.3, 6.4, 6.6);
          silkBox(g, 21, -21, 18, 26, 0.6);
          // a meander antenna printed on the radio module, and the mark of this made-up maker
          g.strokeStyle = INK.gold;
          g.lineWidth = 0.35;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            g.moveTo(22.5 + i * 2.6, -19.8);
            g.lineTo(22.5 + i * 2.6, -17);
            g.lineTo(23.8 + i * 2.6, -17);
            g.lineTo(23.8 + i * 2.6, -19.8);
          }
          g.stroke();
          g.fillStyle = INK.amber;
          g.beginPath();
          g.arc(-4, 17.4, 1.5, 0, Math.PI * 2);
          g.fill();
        },
      }),
      lamp('pwr', [14, top + 0.5, 20], [1.0, 0.45, 0.6]),
      glowing('led', ledDome({ x: -22, z: 28, y: top + 3, d: 3, resin: PAL.resinGreen, seg: ctx.seg(14) })),
    );
    return root;
  },
  terminals,
  animate(st, obj) {
    setLamp(obj, 'pwr', 0x35d06a, st.power ? 1 : 0);
    setLamp(obj, 'led', 0x39e05a, st.led);
    part(obj, 'led'); // (a moving part would be turned or shifted here)
  },
  states: { off: { led: 0, power: false }, on: { led: 1, power: true } },
});
