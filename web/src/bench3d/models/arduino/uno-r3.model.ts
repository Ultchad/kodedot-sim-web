/**
 * Arduino Uno R3. Footprint, socket positions and terminals come from parts/uno-r3/manifest.json; the rest is the
 * board as it is: USB-B and the barrel jack on the left edge, the ATmega328P (DIP-28) in its socket with pin 1 towards
 * the analog pins, the ATmega16U2 beside the USB socket with its 16 MHz HC-49 crystal and its own ICSP header, the
 * 5 V regulator (SOT-223) and the two 47 uF cans, the reset button in the corner, the ICSP header on the right, and
 * the four LEDs: ON, L (pin 13), TX and RX.
 *
 * Dimensions: the Uno R3 mechanical drawing (see uno.ts) and the package drawings. Two things follow the manifest
 * instead of the drawing, because its body is the bare board (68.58 x 53.34 mm): the USB-B socket and the jack are
 * flush with the left edge (on the real board they overhang it by 6.4 mm and 1.8 mm), and the jack sits 1.2 mm
 * further from the corner hole. No maker's logo or wordmark: the designation only.
 */
import manifestJson from '../../../../../parts/uno-r3/manifest.json';
import {
  FONT_HEAD, FONT_MONO, INK, PAL, Shape, defineModel, footprintOf, partState, pinHeader, print, qfn, silkBox, tactButton, text, topQuad, usbB,
  type PartState,
} from '../../index';
import {
  RES, TEAL_R3, TOP, animateUno, chip, crystalHC49, dcJack, dipSocketed, drawCaption, drawPinLabels, joints, ledBodies, ledLamps, pads, resistorArray, rowsOf, smdCan, so, sot223, sot23,
  track, unoBoard, unoGeo, unoTerminals, usbBShellMarks, vias, type UnoLeds, type UnoManifest,
} from './uno';

const manifest = manifestJson as unknown as UnoManifest;
const geo = unoGeo(manifest);
const { W, D } = geo;

// board millimetres (the manifest's frame)
const USB = { y: 15.24 }, JACK = { y: 44.4 };
const DIP = { x: 45.5, y: 37.2 };
const ICSP = { x: 64.9, y: 25.4 }, ICSP2 = { x: 20.84, y: 9.94 };
const U2 = { x: 21, y: 17.6 }, XTAL = { x: 20.6, y: 26.2 };
const LEDS: UnoLeds = { l: geo.led, tx: [geo.led[0], geo.led[1] + 5.2], rx: [geo.led[0], geo.led[1] + 7.6], on: [59.5, 13.6] };

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  terminals: unoTerminals(manifest),
  build(ctx) {
    const s = new Shape();
    let chipTop = 0;
    s.with(geo.frame, () => {
      unoBoard(s, geo, TEAL_R3, ctx.seg);
      usbB(s, { x: 0.1, z: USB.y, y: TOP, turn: 1 });
      usbBShellMarks(s, 0.1, USB.y, 1);
      dcJack(s, 0.1, JACK.y, 1, ctx.seg);
      tactButton(s, { x: 6.2, z: 4.0, y: TOP, size: 4.8, plunger: 1.0, cap: ['matte', '#a63a2c'] });
      chipTop = dipSocketed(s, { x: DIP.x, z: DIP.y, pins: 28 });
      pinHeader(s, { x: ICSP.x, z: ICSP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      pinHeader(s, { x: ICSP2.x, z: ICSP2.y, y: TOP, n: 3, rows: 2 });
      qfn(s, { x: U2.x, z: U2.y, y: TOP, size: 5, perSide: 8 });
      crystalHC49(s, XTAL.x, XTAL.y, 0, ctx.seg);
      chip(s, 7.2, 25.6, 0, { l: 4.6, w: 3.2, h: 0.9, body: ['matte', '#8f8a3c'] }); // the polyfuse
      sot223(s, 7.6, 33.2); // 5 V regulator
      smdCan(s, 17.4, 34.0, 1, ctx.seg);
      smdCan(s, 23.6, 34.0, 1, ctx.seg);
      chip(s, 18.4, 41.6, 0, { l: 4.3, w: 2.6, h: 2.1, body: PAL.epoxyBlack }); // the input diode
      sot23(s, 23.4, 41.0); // the USB / VIN switch
      so(s, 30.2, 27.4, 0, { pins: 8 }); // the comparator
      sot23(s, 30.0, 22.2, 0, true); // 3.3 V regulator
      chip(s, 36.6, 30.3, 0, { l: 3.2, w: 1.3, h: 0.9, body: ['matte', '#d8d1bf'] }); // the 328P's resonator
      resistorArray(s, 31.3, 14.4, 1);
      resistorArray(s, 26.4, 17.6, 1);
      for (const [x, y, t] of [[26.2, 12.3, 1], [27.6, 23.6, 0], [17.4, 21.6, 0], [13.2, 30.6, 1], [11.4, 37.3, 0], [40.2, 29.0, 0], [45.0, 30.2, 0], [29.4, 31.2, 0]] as const) chip(s, x, y, t);
      for (const [x, y, t] of [[12.2, 28.6, 0], [21.0, 38.8, 0], [25.6, 38.6, 0], [56.4, 13.6, 0], [56.6, 30.2, 0], [60.2, 30.4, 0], [33.4, 22.6, 1]] as const) chip(s, x, y, t, { body: RES });
      ledBodies(s, LEDS);
    });
    const root = s.toObject();
    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 12,
        draw(c) {
          c.translate(-W / 2, -D / 2);
          // copper under the mask
          track(c, [[49.3, 32], [49.3, 30], [53.3, 26], [53.3, 9]]);
          track(c, [[51.8, 32], [51.8, 30.6], [55.9, 26.5], [55.9, 9]]);
          track(c, [[54.4, 32], [54.4, 31.2], [58.4, 27.2], [58.4, 16]]);
          track(c, [[41.7, 32], [41.7, 28], [39.1, 25.4], [39.1, 9]]);
          track(c, [[39.1, 32], [39.1, 29], [36.6, 26.5], [36.6, 17.5]]);
          track(c, [[44.2, 32], [44.2, 27], [41.7, 24.5], [41.7, 9]]);
          track(c, [[62, 32.2], [62, 30.6], [63.6, 29]]);
          track(c, [[23.6, 17.6], [25, 17.6]]);
          track(c, [[27.8, 17.6], [29.4, 17.6], [31.3, 15.7]]);
          track(c, [[21, 20.2], [21, 23.6]]);
          track(c, [[18.4, 17.6], [16.6, 17.6]], 0.4);
          track(c, [[9.6, 25.6], [12.6, 25.6], [13.4, 26.4]], 0.6);
          track(c, [[7.6, 36], [7.6, 38.6], [9, 40]], 0.6);
          track(c, [[10.9, 33.2], [14.4, 33.2]], 0.6);
          track(c, [[26.6, 34], [27.4, 34]], 0.6);
          track(c, [[33, 44.6], [33, 45.4], [30.5, 47.9]], 0.4);
          track(c, [[36.6, 14.4], [38.4, 16.2], [38.4, 24]]);
          vias(c, [[53.3, 26], [36.6, 17.5], [58.4, 16], [41.7, 24.5], [28.2, 20], [14.6, 22.4], [33.6, 26], [47, 12.2], [50.6, 13.4], [24.6, 30.6], [28.4, 37.6], [61.6, 18.6], [15.8, 38.6]]);
          pads(c, [[25.6, 44.6, 1.3, 1.5], [27.6, 44.6, 1.3, 1.5], [62.3, 10.6, 1.1, 1.3], [64, 10.6, 1.1, 1.3]]);
          joints(c, [[4.1, 9.2], [4.1, 21.3], [2.6, 44.4], [9, 40.8], [13.2, 44.4]], 1.5); // the shell and jack lugs
          drawPinLabels(c, geo);
          const digital = rowsOf(geo, true), front = rowsOf(geo, false);
          const d = digital[digital.length - 1];
          drawCaption(c, 'DIGITAL (PWM ~)', d.x0 - 1, d.x1 + 1, 8.5, 1);
          if (front[0]) drawCaption(c, 'POWER', front[0].x0 - 1, front[0].x1 + 1, 44.35, -1);
          if (front[1]) drawCaption(c, 'ANALOG IN', front[1].x0 - 1, front[1].x1 + 1, 44.35, -1);
          c.fillStyle = INK.silk;
          text(c, 'UNO R3', 49, 20.3, 6.4, { weight: 700, font: FONT_HEAD, spacing: 0.25 });
          text(c, 'ATmega328P  ·  16 MHz  ·  5 V', 49, 25.3, 1.45, { weight: 600 });
          text(c, 'L', LEDS.l[0] + 2.0, LEDS.l[1], 1.3, { weight: 700 });
          text(c, 'TX', LEDS.tx[0] + 2.4, LEDS.tx[1], 1.3, { weight: 700 });
          text(c, 'RX', LEDS.rx[0] + 2.4, LEDS.rx[1], 1.3, { weight: 700 });
          text(c, 'ON', LEDS.on[0] + 2.6, LEDS.on[1], 1.3, { weight: 700 });
          text(c, 'RESET', 6.2, 7.6, 1.15, { weight: 700 });
          text(c, 'ICSP', ICSP.x - 0.2, ICSP.y + 5.4, 1.15, { weight: 700 });
          text(c, 'ICSP2', ICSP2.x + 6.6, ICSP2.y, 1.15, { weight: 700 });
          text(c, '16.000', XTAL.x, XTAL.y + 3.5, 1.1, { weight: 600, font: FONT_MONO });
          text(c, '1', ICSP.x - 3.5, ICSP.y - 2.6, 1.1, { weight: 700 });
          silkBox(c, ICSP.x - 2.9, ICSP.y - 4.2, 5.8, 8.4, 0.3);
          silkBox(c, ICSP2.x - 4.2, ICSP2.y - 2.9, 8.4, 5.8, 0.3);
          silkBox(c, XTAL.x - 6.1, XTAL.y - 2.8, 12.2, 5.6, 2.8, 0.15);
          silkBox(c, DIP.x - 18.6, DIP.y - 5.5, 37.2, 11, 0.4, 0.15);
          // polarity of the two cans, the regulator's outline
          text(c, '+', 17.4, 37.9, 1.5, { weight: 700 });
          text(c, '+', 23.6, 37.9, 1.5, { weight: 700 });
          silkBox(c, 3.9, 31.0, 7.4, 4.4, 0.3, 0.15);
        },
      }),
      print({
        name: 'chip',
        quad: { c: geo.at(DIP.x, DIP.y, TOP + chipTop + 0.02), u: [17.6, 0, 0], v: [0, 0, -3.45] },
        ppm: 12,
        draw(c) {
          // the moulded notch and the pin 1 dimple at the +X end; the marking reads from the far side, as on the board
          c.fillStyle = '#0b0b0c';
          c.beginPath();
          c.arc(17.6, 0, 1.05, Math.PI / 2, (Math.PI * 3) / 2);
          c.fill();
          c.beginPath();
          c.arc(15.4, -2.2, 0.5, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#b4b2ab';
          text(c, 'ATMEGA328P-PU', -1.5, -0.75, 2.05, { weight: 600, font: FONT_MONO, angle: Math.PI, spacing: 0.12 });
          text(c, '2431', -10.6, 1.75, 1.45, { weight: 600, font: FONT_MONO, angle: Math.PI });
        },
      }),
      ...ledLamps(geo, LEDS),
    );
    return root;
  },
  animate: animateUno,
  states: {
    blink: partState({ visuals: { led: 1 } }),
    idle: partState({ visuals: { led: 0 } }),
    serial: partState({ visuals: { led: 1 }, outputs: { tx: 1, rx: 1 } }),
    off: partState({ power: { on: false, reason: 'no supply' } }),
    crashed: partState({ crashed: true }),
  },
});
