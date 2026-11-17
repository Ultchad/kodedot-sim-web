/**
 * Arduino Uno R3. Footprint, outline, mounting holes, socket positions and terminals come from
 * parts/uno-r3/manifest.json; the rest is the board as its maker's board file has it (UNO-TH_Rev3e.brd, every part at
 * its place and angle): USB-B and the barrel jack on the left edge, the ATmega328P (DIP-28) in its socket with pin 1
 * towards the analog pins, the ATmega16U2 (QFN-32) with its 16 MHz HC-49 crystal, its own ICSP header and the four
 * empty lands of JP2, the 5 V regulator (SOT-223), the two 47 uF cans, the input diode, the resettable fuse, the
 * comparator and the 3.3 V regulator, the 328P's resonator, four resistor networks, the reset button (where the
 * manifest's control is), the ICSP header on the right, and the four LEDs: ON, L (pin 13, where the manifest's
 * `visuals.led` is), TX and RX.
 *
 * Legends: as on the maker's picture of the board, in the kit's type. The maker's name, logo and web address are
 * left out; "UNO R3" is the plain designation the board carries.
 */
import manifestJson from '../../../../../parts/uno-r3/manifest.json';
import { FONT_MONO, Shape, defineModel, footprintOf, partState, pinHeader, print, qfn, terminalsFromManifest, text, usbB, type Finish, type PartState } from '../../index';
import {
  C0603, D1206, F1812, L0805, LED0805, MSOP8, R0603, SMB, SOT23, SOT23_5, TOP, animateUno, chips, crystalHC49, dcJack, dipSocketed, dots, drawCaption, drawPinLabels, eraseHoles, flatDiode,
  ledBodies, ledLamps, legend, pads, plate, resetButton, resetCap, resetPress, resistorArrays, resonator, smallOutline, smdCan, sot223, trafficOutputs, unoBoard, unoGeo, type UnoLeds,
  type UnoManifest,
} from './uno';

const manifest = manifestJson as unknown as UnoManifest;
const geo = unoGeo(manifest);
const { W, D } = geo;

/** The R3's solder mask. */
const MASK: Finish = ['pcb', '#007f85'];
// board millimetres (the manifest's frame); the connectors' mouths overhang the left edge
const USB = { x: -6.34, y: 15.24 }, JACK = { x: -1.8, y: 45.54 };
const DIP = { x: 46.355, y: 36.957 };
const ICSP = { x: 64.897, y: 25.4 }, ICSP2 = { x: 18.288, y: 7.112 };
const U3 = { x: 19.939, y: 18.669 }, XTAL = { x: 18.923, y: 27.178 };
/** The reset button: where the manifest has the control (an estimate there; the board file has it at 6.35, 3.94). */
const RESET = geo.control('reset');
const CANS = [18.415, 25.527], CAN_Y = 44.196;
/** L (pin 13) lights where the manifest's `visuals.led` is; TX, RX and ON as the board file has them. */
const LEDS: UnoLeds = { l: geo.visual('led'), tx: [27.94, 16.764], rx: [27.94, 19.05], on: [58.42, 16.764], size: LED0805 };

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  terminals: terminalsFromManifest(manifest),
  build(ctx) {
    const s = new Shape();
    let chipTop = 0, canTop = 0;
    s.with(geo.frame, () => {
      unoBoard(s, geo, MASK, ctx.seg);
      usbB(s, { x: USB.x, z: USB.y, y: TOP, turn: 1 });
      dcJack(s, JACK.x, JACK.y, 1, ctx.seg);
      resetButton(s, RESET);
      chipTop = dipSocketed(s, { x: DIP.x, z: DIP.y, pins: 28 });
      pinHeader(s, { x: ICSP.x, z: ICSP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      pinHeader(s, { x: ICSP2.x, z: ICSP2.y, y: TOP, n: 3, rows: 2 });
      qfn(s, { x: U3.x, z: U3.y, y: TOP, size: 5, perSide: 8 }); // ATmega16U2
      crystalHC49(s, XTAL.x, XTAL.y, 0, ctx.seg);
      chips(s, F1812, [[4.064, 26.797, 90]]); // the resettable fuse
      sot223(s, 7.747, 35.941, 3); // 5 V regulator, its tab towards the edge
      for (const x of CANS) canTop = smdCan(s, x, CAN_Y, 3, ctx.seg);
      flatDiode(s, [21.59, 50.546, 180], SMB); // the input diode
      smallOutline(s, [8.128, 26.797, 270], SOT23); // the USB / VIN switch
      smallOutline(s, [19.05, 33.02, 90], MSOP8); // the comparator
      smallOutline(s, [21.971, 38.1, 270], SOT23_5); // 3.3 V regulator
      resonator(s, [41.275, 28.448]); // the 328P's 16 MHz
      resistorArrays(s, [[27.94, 29.464, 90], [27.94, 13.97, 90], [12.827, 16.51, 90], [58.42, 19.558, 90]]);
      chips(s, C0603, [[12.065, 23.495], [27.94, 8.89], [27.94, 21.844], [18.415, 37.973, 90], [27.94, 23.495], [45.72, 30.48], [12.7, 11.43], [25.527, 37.973, 90], [16.002, 23.749], [22.225, 23.749], [12.7, 13.97], [12.7, 19.685]]);
      chips(s, R0603, [[19.05, 23.749], [41.275, 30.607]]);
      chips(s, L0805, [[7.62, 8.255]]);
      chips(s, D1206, [[59.436, 25.4, 90], [13.081, 7.112, 90]]);
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
          // bare metal: JP2's four empty lands, the reset-enable link, two fiducials, the lugs of the USB shell and of the jack
          dots(c, [[18.288, 10.922], [20.828, 10.922], [18.288, 13.462], [20.828, 13.462]], 0.84, '#c3c6cb', 0.47);
          pads(c, [[27.178, 26.035, 1.17, 1.6], [28.702, 26.035, 1.17, 1.6]]);
          dots(c, [[53.84, 36.599], [3.73, 49.93]], 0.5);
          dots(c, [[3.81, 9.24], [3.81, 21.24]], 1.7);
          dots(c, [[8.687, 50.038]], 1.9);
          drawPinLabels(c, geo, { mask, names: { SCL: null, SDA: null, V33: '3.3V', VIN: 'Vin' } });
          const d0 = geo.pinX('D0'), a0 = geo.pinX('A0'), a5 = geo.pinX('A5'), vin = geo.pinX('VIN');
          drawCaption(c, 'DIGITAL - PWM~', [29.2, 45.2], [27.4, d0 + 0.8], 9.9, -1, mask);
          drawCaption(c, 'POWER', [vin - 4.6, vin + 1.1], [34, vin + 1.1], 44.1, 1, mask);
          drawCaption(c, 'ANALOG IN', [a0 - 1.4, a0 + 8.6], [a0 - 1.4, a5 + 0.8], 44.1, 1, mask);
          plate(c, 'UNO', 32, 22.8, 38.9, 26.2, mask, true, 2.5);
          plate(c, 'R3', 38.9, 22.8, 45.4, 26.2, mask, false, 2.5);
          legend(c, 'L', LEDS.l[0] - 2.2, LEDS.l[1], 1.35);
          legend(c, 'TX', LEDS.tx[0] - 2.6, LEDS.tx[1], 1.35);
          legend(c, 'RX', LEDS.rx[0] - 2.6, LEDS.rx[1], 1.35);
          legend(c, 'ON', LEDS.on[0] + 2.7, LEDS.on[1], 1.35);
          legend(c, 'RESET', RESET[0] - 5.5, RESET[1], 1.0, true);
          legend(c, 'ICSP', ICSP.x + 1.0, ICSP.y - 4.75, 1.0);
          legend(c, 'JP2', 16.1, 12.19, 0.9, true);
          legend(c, 'RESET EN', 25.5, 27.2, 0.8, true);
          eraseHoles(c, geo);
        },
      }),
      print({
        name: 'chip',
        quad: { c: geo.at(DIP.x, DIP.y, TOP + chipTop + 0.02), u: [17.6, 0, 0], v: [0, 0, -3.45] },
        ppm: 12,
        draw(c) {
          // the moulded notch and the pin 1 dimple at the +X end, the two ejector marks; the marking reads from the far side, as on the board
          c.fillStyle = '#0b0b0c';
          c.beginPath();
          c.arc(17.6, 0, 1.05, Math.PI / 2, (Math.PI * 3) / 2);
          c.fill();
          c.beginPath();
          c.arc(15.4, -2.2, 0.5, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#131315';
          for (const x of [-10.4, 10.4]) {
            c.beginPath();
            c.arc(x, 0, 1.5, 0, Math.PI * 2);
            c.fill();
          }
          c.fillStyle = '#b4b2ab';
          text(c, 'ATMEGA328P-PU', 0, 0, 2.05, { weight: 600, font: FONT_MONO, angle: Math.PI, spacing: 0.12 });
        },
      }),
      print({
        name: 'cans',
        quad: geo.quad((CANS[0] + CANS[1]) / 2, CAN_Y, TOP + canTop + 0.01, (CANS[1] - CANS[0]) / 2 + 2.6, 2.6),
        ppm: 12,
        draw(c) {
          // the rating printed on each can, reading up the board
          c.fillStyle = '#2a2a2e';
          for (const x of CANS) {
            c.save();
            c.translate(x - (CANS[0] + CANS[1]) / 2, 0);
            c.rotate(-Math.PI / 2);
            text(c, '47', -0.3, -0.2, 1.7, { weight: 600, font: FONT_MONO });
            text(c, '25V', -0.3, 1.5, 1.5, { weight: 600, font: FONT_MONO });
            c.restore();
          }
        },
      }),
      resetCap(geo, manifest, ['matte', '#d6d0c0'], ctx.seg),
      resetPress(geo, manifest),
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
