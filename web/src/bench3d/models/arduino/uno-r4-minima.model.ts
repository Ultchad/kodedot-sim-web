/**
 * Arduino Uno R4 Minima. Footprint, socket positions and terminals come from parts/uno-r4-minima/manifest.json. The
 * board: USB-C and the barrel jack on the left edge, the Renesas RA4M1 (LQFP-64, 10 x 10 mm) turned 45 degrees in the
 * middle, the buck converter with its inductor by the jack, the SWD port (2 x 5 at 1.27 mm) and the ICSP header on
 * the right, the reset button in the corner, and the four LEDs: ON, L (pin 13), TX and RX. A sparse board, as the
 * real one is.
 *
 * Dimensions: the Uno mechanical drawing (see uno.ts; the USB-C socket overhangs the left edge by 1.3 mm, the jack by
 * 1.9 mm) and the package drawings. Print: the board's legends and the plain designations only.
 */
import manifestJson from '../../../../../parts/uno-r4-minima/manifest.json';
import {
  FONT_HEAD, FONT_MONO, INK, PAL, Shape, defineModel, footprintOf, partState, pinHeader, print, qfn, silkBox, tactButton, terminalsFromManifest, text, usbC,
  type PartState,
} from '../../index';
import {
  RES, TEAL_R4, TOP, animateUno, chip, dcJack, drawCaption, drawPinLabels, inductor, joints, ledBodies, ledLamps, miniHeader, pads, qfpLean, rowsOf, sot23, track, trafficOutputs, unoBoard,
  unoGeo, vias, type UnoLeds, type UnoManifest,
} from './uno';

const manifest = manifestJson as unknown as UnoManifest;
const geo = unoGeo(manifest);
const { W, D } = geo;

// board millimetres (the manifest's frame)
const USB = { x: -1.3, y: 15.24 }, JACK = { x: -1.9, y: 45.72 };
const MCU = { x: 38.6, y: 28.6, size: 10, angle: Math.PI / 4 };
const ICSP = { x: 64.9, y: 25.4 }, SWD = { x: 55.2, y: 22.4 };
const LEDS: UnoLeds = { l: geo.led, tx: [geo.led[0], geo.led[1] + 5.2], rx: [geo.led[0], geo.led[1] + 7.6], on: [59.5, 13.6] };

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  terminals: terminalsFromManifest(manifest),
  build(ctx) {
    const s = new Shape();
    let chipTop = 0;
    s.with(geo.frame, () => {
      unoBoard(s, geo, TEAL_R4, ctx.seg);
      usbC(s, { x: USB.x, z: USB.y, y: TOP, turn: 1 });
      dcJack(s, JACK.x, JACK.y, 1, ctx.seg);
      tactButton(s, { x: 5.8, z: 4.4, y: TOP, size: 4.4, plunger: 0.9, cap: PAL.plasticWhite });
      chipTop = qfpLean(s, { x: MCU.x, z: MCU.y, size: MCU.size, perSide: 16, h: 1.45, angle: MCU.angle });
      pinHeader(s, { x: ICSP.x, z: ICSP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      miniHeader(s, SWD.x, SWD.y, 0);
      // the buck converter by the jack
      inductor(s, 19.4, 36.8);
      qfn(s, { x: 25.0, z: 36.8, y: TOP, size: 3, perSide: 4 });
      chip(s, 18.6, 42.6, 0, { l: 4.3, w: 2.6, h: 2.1, body: PAL.epoxyBlack });
      chip(s, 25.2, 41.6, 0, { l: 3.2, w: 1.6, h: 1.2 });
      chip(s, 19.2, 32.4, 0, { l: 3.2, w: 1.6, h: 1.2 });
      sot23(s, 28.2, 32.4, 0, true); // 3.3 V regulator
      sot23(s, 11.0, 15.2, 1, true); // USB protection
      for (const [x, y, t] of [[30.0, 21.0, 0], [47.2, 21.0, 0], [30.2, 36.4, 1], [45.6, 30.4, 0], [24.4, 32.4, 0], [28.6, 40.4, 1], [13.6, 22.8, 0], [51.0, 26.6, 0]] as const) chip(s, x, y, t);
      for (const [x, y, t] of [[10.4, 10.2, 0], [10.4, 20.2, 0], [56.4, 13.6, 0], [34.2, 13.2, 0], [34.2, 15.6, 0], [34.2, 8.0, 0], [58.8, 28.0, 0], [15.0, 28.6, 1]] as const) chip(s, x, y, t, { body: RES });
      ledBodies(s, LEDS);
    });
    const root = s.toObject();
    const k = Math.SQRT1_2;
    root.add(
      print({
        name: 'silk',
        quad: geo.quad(W / 2, D / 2, TOP + 0.02, W / 2, D / 2),
        ppm: 12,
        draw(c) {
          c.translate(-W / 2, -D / 2);
          // copper under the mask: the fan-out of the MCU towards both rows of sockets
          const d7 = geo.pinX('D7'), d8 = geo.pinX('D8'), a0 = geo.pinX('A0');
          for (let i = 0; i < 7; i++) track(c, [[41.5 + i * 0.9, 24.2 - i * 0.9], [44.4 + i * 1.1, 21.3 - i * 0.9], [d7 + i * 2.54, 17 - i * 0.5], [d7 + i * 2.54, 9]], 0.22);
          for (let i = 0; i < 5; i++) track(c, [[36.0 - i * 0.9, 24.0 - i * 0.9], [36.0 - i * 0.9, 17 - i * 0.4], [d8 - i * 2.54, 12 - i * 0.2], [d8 - i * 2.54, 9]], 0.22);
          for (let i = 0; i < 6; i++) track(c, [[42.6 + i * 0.9, 32.2 + i * 0.9], [42.6 + i * 0.9, 38 + i * 0.5], [a0 + i * 2.54, 43 + i * 0.1], [a0 + i * 2.54, 45]], 0.22);
          track(c, [[7.6, 15.2], [9.4, 15.2]], 0.5);
          track(c, [[12.6, 15.2], [22, 15.2], [31.4, 24.6]], 0.3);
          track(c, [[12.6, 14.4], [22.4, 14.4], [31.8, 23.8]], 0.3);
          track(c, [[12.6, 45.7], [15.8, 42.6]], 0.7);
          track(c, [[21.6, 36.8], [23.2, 36.8]], 0.7);
          track(c, [[26.8, 36.8], [28.2, 36.8], [28.2, 34]], 0.5);
          track(c, [[58.6, 22.4], [61, 22.4], [62.4, 23.8]], 0.25);
          vias(c, [[33.4, 17.6], [44.6, 17.4], [50.4, 30.6], [33.2, 39.6], [22, 28.4], [26.4, 24.2], [12.4, 33.4], [56.2, 30.4], [47, 12.6], [22.4, 21.4], [17.6, 25.2], [52.6, 17]]);
          // footprints the Minima leaves empty: the two crystals, the battery header
          pads(c, [[26.2, 27.4, 1.1, 1.5], [28.6, 27.4, 1.1, 1.5], [26.2, 30.0, 0.9, 1.1], [28.6, 30.0, 0.9, 1.1], [52.4, 29.4, 1.1, 1.4], [54.4, 29.4, 1.1, 1.4]]);
          joints(c, [[6.4, 50.75]], 1.4);
          drawPinLabels(c, geo);
          const digital = rowsOf(geo, true), front = rowsOf(geo, false);
          const d = digital[digital.length - 1];
          drawCaption(c, 'DIGITAL (PWM ~)', d.x0 - 1, d.x1 + 1, 8.5, 1);
          if (front[0]) drawCaption(c, 'POWER', front[0].x0 - 1, front[0].x1 + 1, 44.35, -1);
          if (front[1]) drawCaption(c, 'ANALOG IN', front[1].x0 - 1, front[1].x1 + 1, 44.35, -1);
          c.fillStyle = INK.silk;
          text(c, 'UNO R4', 54, 35.2, 5.6, { weight: 700, font: FONT_HEAD, spacing: 0.2 });
          text(c, 'MINIMA', 54.2, 39.9, 2.3, { weight: 700, font: FONT_HEAD, spacing: 1.15 });
          text(c, 'L', LEDS.l[0] - 2.0, LEDS.l[1], 1.3, { weight: 700 });
          text(c, 'TX', LEDS.tx[0] - 2.5, LEDS.tx[1], 1.3, { weight: 700 });
          text(c, 'RX', LEDS.rx[0] - 2.5, LEDS.rx[1], 1.3, { weight: 700 });
          text(c, 'ON', LEDS.on[0] + 2.6, LEDS.on[1], 1.3, { weight: 700 });
          text(c, 'RESET', 5.8, 7.9, 1.15, { weight: 700 });
          text(c, 'ICSP', ICSP.x - 0.2, ICSP.y + 5.4, 1.15, { weight: 700 });
          text(c, 'SWD', SWD.x, SWD.y - 2.6, 1.15, { weight: 700 });
          text(c, '1', ICSP.x - 3.5, ICSP.y - 2.6, 1.1, { weight: 700 });
          silkBox(c, ICSP.x - 2.9, ICSP.y - 4.2, 5.8, 8.4, 0.3);
          silkBox(c, SWD.x - 3.7, SWD.y - 1.8, 7.4, 3.6, 0.3, 0.15);
          silkBox(c, 17.0, 34.4, 4.8, 4.8, 0.4, 0.15);
          // the corner mark of the MCU's pin 1
          c.beginPath();
          c.arc(MCU.x, MCU.y + 8.9, 0.35, 0, Math.PI * 2);
          c.fill();
        },
      }),
      print({
        name: 'chip',
        quad: { c: geo.at(MCU.x, MCU.y, TOP + chipTop + 0.02), u: [4.4 * k, 0, -4.4 * k], v: [-3.2 * k, 0, -3.2 * k] },
        ppm: 14,
        draw(c) {
          c.fillStyle = '#a9a8a2';
          text(c, 'R7FA4M1', 0, -0.95, 1.55, { weight: 600, font: FONT_MONO, spacing: 0.05 });
          text(c, 'AB3CFM', 0, 0.95, 1.55, { weight: 600, font: FONT_MONO, spacing: 0.05 });
        },
      }),
      ...ledLamps(geo, LEDS),
    );
    return root;
  },
  animate: animateUno,
  states: {
    blink: partState({ outputs: { led: 1, tx: 0, rx: 0, crashed: false } }),
    idle: partState({ outputs: { led: 0, tx: 0, rx: 0, crashed: false } }),
    serial: partState({ outputs: trafficOutputs() }),
    off: partState({ power: { on: false, reason: 'no supply' }, outputs: { led: 0, tx: 0, rx: 0, crashed: false } }),
    crashed: partState({ crashed: true, outputs: { led: 0, tx: 0, rx: 0, crashed: true } }),
  },
});
