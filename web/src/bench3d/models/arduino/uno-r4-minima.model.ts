/**
 * Arduino Uno R4 Minima. Footprint, outline, mounting holes, socket positions and terminals come from
 * parts/uno-r4-minima/manifest.json; the rest is the board as its maker's design files have it (the PCB document and
 * the bill of materials of ABX00080: every fitted part at its place and angle, the lands of the parts left off the
 * board bare): USB-C and the barrel jack on the left edge, the Renesas RA4M1 (LQFP-64, 10 x 10 mm) in the middle, the
 * buck converter with its inductor and its row of capacitors by the jack, the two input diodes, the SWD port (2 x 5
 * at 1.27 mm) and the ICSP header on the right, the reset button in the corner, and the four LEDs: ON, L (pin 13), TX
 * and RX. A sparse blue board, as the real one is.
 *
 * Legends: as on the maker's picture of the board, in the kit's type, with the grid of fine lines the board carries on
 * its left third. The maker's name, logo, the marks taken from it and the web address are left out; "UNO R4 MINIMA"
 * is the plain designation the board carries.
 */
import manifestJson from '../../../../../parts/uno-r4-minima/manifest.json';
import { FONT_MONO, INK, Shape, defineModel, footprintOf, partState, pinHeader, print, terminalsFromManifest, text, usbC, type Finish, type PartState } from '../../index';
import {
  C0402, C0603, C0805, L0603, LED0603, R0402, SOD123, SOT143, TOP, animateUno, chips, dcJack, dots, drawCaption, drawPinLabels, emptyLands, eraseHoles, flatDiode, inductor, leadless,
  ledBodies, ledLamps, legend, miniHeader, pads, plate, qfpLean, resetButton, resetCap, smallOutline, trafficOutputs, unoBoard, unoGeo, type UnoLeds, type UnoManifest,
} from './uno';

const manifest = manifestJson as unknown as UnoManifest;
const geo = unoGeo(manifest);
const { W, D } = geo;

/** The Minima's solder mask. */
const MASK: Finish = ['pcb', '#1b5587'];
// board millimetres (the manifest's frame); the connectors' mouths overhang the left edge (the jack as far as the manifest's body lets it)
const USB = { x: -0.65, y: 15.47 }, JACK = { x: Math.max(-2.04, -geo.x0), y: 45.54 };
const MCU = { x: 43.5, y: 21.84, size: 10 };
const ICSP = { x: 64.9, y: 25.4 }, SWD = { x: 61.63, y: 12.64 };
const RESET = { x: 6.35, y: 3.94 };
const LEDS: UnoLeds = { l: [27.94, 11.18], tx: [27.94, 16.76], rx: [27.94, 19.05], on: [58.42, 16.76], size: LED0603 };
/** The grid printed on the left third: lines 3 mm apart, [place, from, to]. */
const GRID_X: [number, number, number][] = [[2.75, 0, D], [5.75, 0, 7], [5.75, 9.2, D], [8.75, 0, 7], [8.75, 9.2, D], [11.75, 0, D], [14.75, 4.75, D], [17.75, 11.8, D], [20.75, 13.1, D], [23.75, 25.3, D]];
const GRID_Y: [number, number, number][] = [
  [2.8, 0, 13.1], [5.8, 0, 16.6], [8.8, 0, 3], [8.8, 9.7, 16.6], [11.8, 5.75, 22.9], [14.8, 5.75, 22.9], [17.8, 5.75, 22.9], [20.8, 0, 22.9], [23.8, 0, 26.4], [26.8, 0, 25],
  [29.8, 0, 25], [32.8, 0, 25], [35.8, 0, 25], [38.8, 0, 25], [41.8, 11.9, 26.4], [44.8, 13.1, 25], [47.8, 0, 25], [50.8, 0, 25],
];

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  terminals: terminalsFromManifest(manifest),
  build(ctx) {
    const s = new Shape();
    let chipTop = 0;
    s.with(geo.frame, () => {
      unoBoard(s, geo, MASK, ctx.seg);
      usbC(s, { x: USB.x, z: USB.y, y: TOP, turn: 1 });
      dcJack(s, JACK.x, JACK.y, 1, ctx.seg);
      resetButton(s, RESET.x, RESET.y);
      chipTop = qfpLean(s, { x: MCU.x, z: MCU.y, size: MCU.size, perSide: 16, h: 1.45 });
      pinHeader(s, { x: ICSP.x, z: ICSP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      miniHeader(s, SWD.x, SWD.y, 1);
      // the buck converter by the jack, the two input diodes above it, the USB port's protection
      inductor(s, 4.84, 36.24);
      leadless(s, [9.74, 33.56, 90], 4, 3, 6, 0.5);
      flatDiode(s, [9.74, 24.69, 180], SOD123);
      flatDiode(s, [9.74, 27.39, 180], SOD123);
      smallOutline(s, [9.74, 14.97, 0], SOT143);
      chips(s, C0805, [[4.18, 22.36], [4.69, 29.63], [4.69, 31.75], [12.83, 37.38, 90], [14.78, 37.38, 90], [8.94, 37.39, 90], [10.89, 37.39, 90]]);
      chips(s, C0603, [[45.54, 13.22, 90], [35.22, 18.26], [35.22, 25.04]]);
      chips(s, L0603, [[52.23, 19.59], [52.23, 20.89]]);
      chips(s, C0402, [[39.94, 13.67, 90], [46.94, 13.67, 90], [51.93, 18.39], [51.93, 22.09], [35.64, 26.34], [7.24, 32.33, 90], [12.94, 34.06], [12.94, 35.16]]);
      chips(s, R0402, [
        [13.44, 6.17, 90], [30.42, 11.18], [7.51, 11.45, 90], [38.44, 12.17], [37.94, 13.67, 90], [38.94, 13.67, 90], [58.42, 15.27], [30.41, 16.76], [7.51, 17.95, 90], [30.42, 19.06], [54.13, 20.24, 90],
        [35.64, 22.77], [35.64, 23.77], [4.56, 24.06], [51.93, 25.34], [51.93, 26.34], [10.64, 29.66], [12.94, 29.66], [10.64, 30.76], [12.94, 31.86], [12.94, 32.96], [14.87, 34.68, 90],
      ]);
      ledBodies(s, LEDS);
    });
    const root = s.toObject();
    const mask = MASK[1];
    root.add(
      print({
        name: 'silk',
        quad: geo.quad(W / 2, D / 2, TOP + 0.02, W / 2, D / 2),
        ppm: 14,
        draw(c) {
          c.translate(-W / 2, -D / 2);
          c.fillStyle = INK.silk;
          for (const [x, y0, y1] of GRID_X) c.fillRect(x - 0.11, y0, 0.22, y1 - y0);
          for (const [y, x0, x1] of GRID_Y) c.fillRect(x0, y - 0.11, x1 - x0, 0.22);
          // bare metal: the lands of the parts left off the board (the crystal, its two capacitors, two pull-ups and a few more), test points, fiducials, the jack's lug
          pads(c, [[41.54, 10.94, 1.4, 1.15], [43.74, 10.94, 1.4, 1.15], [41.54, 12.64, 1.4, 1.15], [43.74, 12.64, 1.4, 1.15]]);
          emptyLands(c, [[12.44, 6.17, 90], [41.74, 14.11], [43.64, 14.11], [14.87, 29.66], [14.87, 30.76], [8.44, 30.76], [12.94, 30.76]], 1.0, 0.5);
          emptyLands(c, [[18.8, 9.08, 90], [21.34, 9.08, 90]], 1.6, 0.8);
          dots(c, [[6.6, 27.39], [14.87, 32.66], [7.04, 29.66]], 0.4);
          dots(c, [[2, 51.34], [60.5, 19.34]], 0.5);
          dots(c, [[8.69, 50.04]], 1.9);
          drawPinLabels(c, geo, { mask, backBar: true, names: { NC: 'BOOT', V33: '3.3V' } });
          const a0 = geo.pinX('A0'), a5 = geo.pinX('A5'), vin = geo.pinX('VIN');
          drawCaption(c, 'DIGITAL - PWM~', [43, 59.4], [28.1, 59.4], 8.7, 1, mask);
          drawCaption(c, 'POWER', [vin - 4.9, vin + 1.3], [34.7, vin + 1.3], 44, 1, mask);
          drawCaption(c, 'ANALOG IN', [a0 - 1.1, a0 + 9.5], [a0 - 1.1, a5 + 1.4], 44, 1, mask);
          plate(c, 'UNO', 45.25, 31.5, 54, 35.4, mask, true, 3);
          plate(c, 'R4', 54, 31.5, 60.25, 35.4, mask, false, 3);
          plate(c, 'MINIMA', 45.25, 35.4, 60.25, 39.5, mask, false, 3);
          legend(c, 'L', LEDS.l[0] - 2.2, LEDS.l[1], 1.45);
          legend(c, 'TX', LEDS.tx[0] - 2.7, LEDS.tx[1], 1.45);
          legend(c, 'RX', LEDS.rx[0] - 2.7, LEDS.rx[1], 1.45);
          legend(c, 'ON', LEDS.on[0] - 2.8, LEDS.on[1], 1.45);
          legend(c, 'RESET', 6.2, 8.05, 1.7);
          legend(c, 'ICSP', ICSP.x + 0.3, ICSP.y - 4.75, 1.35);
          legend(c, 'SWD', SWD.x - 2.2, SWD.y, 1.1, true);
          c.fillRect(W - 1.2, ICSP.y + 1.0, 1.2, 2.4); // the mark of the ICSP header's first pin, on the board's edge
          eraseHoles(c, geo);
        },
      }),
      print({
        name: 'chip',
        quad: geo.quad(MCU.x, MCU.y, TOP + chipTop + 0.02, 4.4, 3.2),
        ppm: 14,
        draw(c) {
          c.fillStyle = '#9d9c97';
          text(c, 'R7FA4M1', 0, -0.95, 1.55, { weight: 600, font: FONT_MONO, spacing: 0.05 });
          text(c, 'AB3CFM', 0, 0.95, 1.55, { weight: 600, font: FONT_MONO, spacing: 0.05 });
        },
      }),
      resetCap(geo, RESET.x, RESET.y, ['matte', '#eeebe3'], ctx.seg),
      ...ledLamps(geo, LEDS),
    );
    return root;
  },
  animate: animateUno,
  states: {
    blink: partState({ outputs: { led: 1, tx: 0, rx: 0, crashed: false } }),
    idle: partState({ outputs: { led: 0, tx: 0, rx: 0, crashed: false } }),
    serial: partState({ outputs: trafficOutputs() }),
    reset: partState({ fields: { reset: true }, outputs: { led: 0, tx: 0, rx: 0, crashed: false } }),
    off: partState({ power: { on: false, reason: 'no supply' }, outputs: { led: 0, tx: 0, rx: 0, crashed: false } }),
    crashed: partState({ crashed: true, outputs: { led: 0, tx: 0, rx: 0, crashed: true } }),
  },
});
