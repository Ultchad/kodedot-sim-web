/**
 * Arduino Uno R4 WiFi. Footprint, socket positions and terminals come from parts/uno-r4-wifi/manifest.json. The board:
 * USB-C and the barrel jack on the left edge, the ESP32-S3-MINI-1 radio module (15.4 x 20.5 mm, its antenna towards
 * the USB corner), the Renesas RA4M1 (LQFP-64), the 12 x 8 LED matrix on the right half, the I2C port (JST-SH,
 * "Qwiic") on the right edge, the ESP header and the VRTC / OFF pins, the buck converter by the jack, the ICSP header,
 * the reset button and the four LEDs: ON, L (pin 13), TX and RX.
 *
 * The matrix shows the part's outputs matrix0..2 (96 pixels, bit 31 of matrix0 is the top-left LED, row by row): the
 * LED bodies are part of the static body, their light is a `screen` laid over them.
 *
 * Dimensions: the Uno mechanical drawing (see uno.ts) and the package drawings; the matrix pitch (2.1 mm) is read off
 * photographs; the USB-C socket overhangs the left edge by 1.3 mm, the jack by 1.9 mm. Print: the board's legends and
 * the plain designations only.
 */
import manifestJson from '../../../../../parts/uno-r4-wifi/manifest.json';
import {
  FONT_HEAD, FONT_MONO, INK, PAL, Shape, defineModel, drawScreen, footprintOf, moduleCan, partState, pinHeader, print, qfn, screen, silkBox, tactButton, terminalsFromManifest, text, usbC,
  type PartState,
} from '../../index';
import {
  RES, TEAL_R4, TOP, animateUno, chip, dcJack, drawCaption, drawPinLabels, inductor, joints, jstSh4, ledBodies, ledLamps, makeGlow, pads, qfpLean, rowsOf, slab, sot23, track,
  trafficOutputs, unoBoard, unoGeo, vias, type UnoLeds, type UnoManifest,
} from './uno';

const manifest = manifestJson as unknown as UnoManifest;
const geo = unoGeo(manifest);
const { W, D } = geo;

// board millimetres (the manifest's frame)
const USB = { x: -1.3, y: 15.24 }, JACK = { x: -1.9, y: 45.72 };
const RADIO = { x: 23.05, y: 17.3, w: 15.4, d: 20.5, can: 15.2 }; // lying: its length along x, the antenna at the left end
const MCU = { x: 27, y: 33.8, size: 10 };
const ICSP = { x: 64.9, y: 25.4 }, QWIIC = { y: 10.8 }, ESP = { x: 5.2, y: 27.6 }, VRTC = { x: 18.9, y: 46.6 };
const LEDS: UnoLeds = { l: geo.led, tx: [35.4, 10.8], rx: [35.4, 13.2], on: [59.5, 13.6] };
/** The LED matrix: 12 x 8 at 2.1 mm, and the margin the light may spill into. */
const MX = { x0: 36.0, y0: 18.4, pitch: 2.1, cols: 12, rows: 8, margin: 1.0 };
const mxX = (c: number) => MX.x0 + (c + 0.5) * MX.pitch, mxY = (r: number) => MX.y0 + (r + 0.5) * MX.pitch;
const RED = 0xff2412;
/** The heart of the board's default sketch (the frame of the Arduino LED matrix examples). */
const HEART = { matrix0: 0x3184a444, matrix1: 0x44042081, matrix2: 0x100a0040 };

// the frame being drawn (no closure in `animate`: the words are handed over here)
let w0 = 0, w1 = 0, w2 = 0;
function drawMatrix(g: CanvasRenderingContext2D, w: number): void {
  const k = w / (MX.cols * MX.pitch + 2 * MX.margin);
  for (let pass = 0; pass < 3; pass++) {
    g.fillStyle = pass === 0 ? 'rgba(255,30,14,0.3)' : pass === 1 ? 'rgba(255,34,16,0.66)' : '#d0240e';
    for (let i = 0; i < MX.cols * MX.rows; i++) {
      const word = i < 32 ? w0 : i < 64 ? w1 : w2;
      if (!((word >>> (31 - (i & 31))) & 1)) continue;
      const cx = (MX.margin + ((i % MX.cols) + 0.5) * MX.pitch) * k, cy = (MX.margin + (Math.floor(i / MX.cols) + 0.5) * MX.pitch) * k;
      if (pass === 2) g.fillRect(cx - 0.68 * k, cy - 0.42 * k, 1.36 * k, 0.84 * k);
      else {
        g.beginPath();
        g.arc(cx, cy, (pass === 0 ? 1.45 : 0.9) * k, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
interface Shown {
  mx0?: number;
  mx1?: number;
  mx2?: number;
  mxKey?: number;
}

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  terminals: terminalsFromManifest(manifest),
  build(ctx) {
    const s = new Shape();
    let chipTop = 0, canTop = 0;
    const qx = geo.edgeX(QWIIC.y) - 0.06;
    s.with(geo.frame, () => {
      unoBoard(s, geo, TEAL_R4, ctx.seg);
      usbC(s, { x: USB.x, z: USB.y, y: TOP, turn: 1 });
      dcJack(s, JACK.x, JACK.y, 1, ctx.seg);
      tactButton(s, { x: 5.6, z: 4.4, y: TOP, size: 4.4, plunger: 0.9, cap: PAL.plasticWhite });
      canTop = moduleCan(s, { x: RADIO.x, z: RADIO.y, y: TOP, w: RADIO.w, d: RADIO.d, canD: RADIO.can, turn: 3 });
      chipTop = qfpLean(s, { x: MCU.x, z: MCU.y, size: MCU.size, perSide: 16, h: 1.45 });
      pinHeader(s, { x: ICSP.x, z: ICSP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      pinHeader(s, { x: ESP.x, z: ESP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      pinHeader(s, { x: VRTC.x, z: VRTC.y, y: TOP, n: 3 });
      jstSh4(s, qx, QWIIC.y, 3);
      // the matrix: 96 chip LEDs
      for (let r = 0; r < MX.rows; r++) for (let c = 0; c < MX.cols; c++) slab(s, ['matte', '#c9c4b6'], mxX(c), mxY(r), 1.3, 0.8, TOP, TOP + 0.5);
      // the buck converter by the jack
      inductor(s, 17.4, 36.6);
      qfn(s, { x: 16.6, z: 30.6, y: TOP, size: 3, perSide: 4 });
      chip(s, 17.6, 42.0, 0, { l: 4.3, w: 2.6, h: 2.1, body: PAL.epoxyBlack });
      chip(s, 11.6, 34.6, 1, { l: 3.2, w: 1.6, h: 1.2 });
      sot23(s, 11.4, 26.4, 1, true); // level shifter
      sot23(s, 11.0, 15.2, 1, true); // USB protection
      sot23(s, 36.2, 40.6, 0, true); // 3.3 V regulator
      for (const [x, y, t] of [[15.0, 26.4, 0], [18.4, 26.4, 0], [21.8, 26.4, 0], [30.6, 26.4, 0], [34.6, 30.0, 1], [34.6, 33.4, 1], [24.0, 41.7, 0], [28.6, 41.7, 0], [12.2, 30.8, 1], [40.4, 40.8, 0]] as const) chip(s, x, y, t);
      for (const [x, y, t] of [[10.4, 10.2, 0], [10.4, 20.2, 0], [56.4, 13.6, 0], [34.4, 8.0, 0], [40.2, 10.8, 0], [40.2, 13.2, 0], [60.6, 31.8, 0], [34.6, 36.6, 1]] as const) chip(s, x, y, t, { body: RES });
      ledBodies(s, LEDS);
    });
    const root = s.toObject();
    const matrix = screen('matrix', geo.quad(MX.x0 + (MX.cols * MX.pitch) / 2, MX.y0 + (MX.rows * MX.pitch) / 2, TOP + 0.56, (MX.cols * MX.pitch) / 2 + MX.margin, (MX.rows * MX.pitch) / 2 + MX.margin), 12, { lit: false });
    makeGlow(matrix, RED, 1.2);
    root.add(
      print({
        name: 'silk',
        quad: geo.quad(W / 2, D / 2, TOP + 0.02, W / 2, D / 2),
        ppm: 12,
        draw(c) {
          c.translate(-W / 2, -D / 2);
          // copper under the mask
          const rst = geo.pinX('RESET');
          for (let i = 0; i < 6; i++) track(c, [[33.2, 30.4 + i * 0.5], [34.2 + i * 0.3, 29.4 + i * 0.5], [35.4 + i * 0.3, 21 + i * 2.1]], 0.2);
          for (let i = 0; i < 6; i++) track(c, [[23.4 + i * 0.5, 39.6], [23.4 + i * 0.5, 42.6], [rst + i * 2.54, 44.4 - (5 - i) * 0.2], [rst + i * 2.54, 45.2]], 0.22);
          track(c, [[7.6, 15.2], [9.4, 15.2]], 0.5);
          track(c, [[12.6, 15.6], [13.4, 16.4], [13.4, 24.6], [14.4, 25.6]], 0.3);
          track(c, [[12.6, 45.7], [15.2, 43.2]], 0.7);
          track(c, [[17.4, 34.4], [17.4, 32.4]], 0.7);
          track(c, [[qx - 4.4, 10.8], [58, 10.8], [56, 12.8]], 0.25);
          track(c, [[qx - 4.4, 11.8], [58.6, 11.8], [57.4, 13]], 0.25);
          vias(c, [[36.4, 16.9], [49, 13.6], [45.2, 10.4], [52.6, 15.6], [8.6, 34.6], [21.6, 44.4], [13.4, 39.6], [44.6, 41.4], [56.4, 40.6], [63.4, 33.6], [8.4, 22.4], [33.9, 26.6]]);
          // the lands of the matrix LEDs
          const land: [number, number, number, number][] = [];
          for (let r = 0; r < MX.rows; r++) for (let col = 0; col < MX.cols; col++) land.push([mxX(col) - 0.72, mxY(r), 0.42, 0.9], [mxX(col) + 0.72, mxY(r), 0.42, 0.9]);
          pads(c, land, '#b7babf');
          joints(c, [[6.4, 50.75]], 1.4);
          drawPinLabels(c, geo);
          const digital = rowsOf(geo, true), front = rowsOf(geo, false);
          const d = digital[digital.length - 1];
          drawCaption(c, 'DIGITAL (PWM ~)', d.x0 - 1, Math.min(d.x1 + 1, qx - 4.9), 8.5, 1);
          if (front[0]) drawCaption(c, 'POWER', front[0].x0 - 1, front[0].x1 + 1, 44.35, -1);
          if (front[1]) drawCaption(c, 'ANALOG IN', front[1].x0 - 1, front[1].x1 + 1, 44.35, -1);
          c.fillStyle = INK.silk;
          text(c, 'UNO R4 WiFi', 49.4, 39.0, 3.7, { weight: 700, font: FONT_HEAD, spacing: 0.18 });
          text(c, 'L', LEDS.l[0] - 2.0, LEDS.l[1], 1.2, { weight: 700 });
          text(c, 'TX', LEDS.tx[0] + 2.4, LEDS.tx[1], 1.2, { weight: 700 });
          text(c, 'RX', LEDS.rx[0] + 2.4, LEDS.rx[1], 1.2, { weight: 700 });
          text(c, 'ON', LEDS.on[0], LEDS.on[1] + 1.9, 1.2, { weight: 700 });
          text(c, 'RESET', 5.6, 7.9, 1.15, { weight: 700 });
          text(c, 'ICSP', ICSP.x - 0.2, ICSP.y + 5.4, 1.15, { weight: 700 });
          text(c, 'I2C', qx - 2.2, QWIIC.y + 4.1, 1.0, { weight: 700 });
          text(c, 'ESP', ESP.x, ESP.y + 5.2, 1.1, { weight: 700 });
          text(c, 'OFF GND VRTC', VRTC.x, VRTC.y - 2.2, 0.95, { weight: 700 });
          text(c, '1', ICSP.x - 3.5, ICSP.y - 2.6, 1.1, { weight: 700 });
          silkBox(c, ICSP.x - 2.9, ICSP.y - 4.2, 5.8, 8.4, 0.3);
          silkBox(c, ESP.x - 2.9, ESP.y - 4.2, 5.8, 8.4, 0.3);
          silkBox(c, MX.x0 - 0.5, MX.y0 - 0.5, MX.cols * MX.pitch + 1, MX.rows * MX.pitch + 1, 0.6, 0.15);
          silkBox(c, 15.0, 34.2, 4.8, 4.8, 0.4, 0.15);
          silkBox(c, RADIO.x - RADIO.d / 2 - 0.4, RADIO.y - RADIO.w / 2 - 0.4, RADIO.d + 0.8, RADIO.w + 0.8, 0.4, 0.15);
          c.beginPath();
          c.arc(MCU.x - 6.6, MCU.y + 6.6, 0.35, 0, Math.PI * 2);
          c.fill();
        },
      }),
      // the radio module's own board: the antenna printed in copper at its left end
      print({
        name: 'antenna',
        quad: geo.quad(RADIO.x - RADIO.d / 2 + 2.45, RADIO.y, TOP + 0.82, 2.35, RADIO.w / 2 - 0.3),
        ppm: 14,
        draw(c) {
          c.strokeStyle = INK.gold;
          c.lineWidth = 0.42;
          c.lineJoin = 'miter';
          c.beginPath();
          c.moveTo(1.7, 6.6);
          c.lineTo(1.7, 5.2);
          for (let i = 0; i < 6; i++) {
            const y = 5.2 - i * 1.9;
            c.lineTo(-1.6, y);
            c.lineTo(-1.6, y - 0.95);
            c.lineTo(1.0, y - 0.95);
            c.lineTo(1.0, y - 1.9);
          }
          c.stroke();
        },
      }),
      print({
        name: 'can',
        quad: geo.quad(RADIO.x + 2.05, RADIO.y, canTop + 0.02, RADIO.can / 2 - 0.4, RADIO.w / 2 - 1.1),
        ppm: 12,
        draw(c) {
          c.fillStyle = '#54565c';
          text(c, 'ESP32-S3-MINI-1', 0, -0.9, 1.3, { weight: 700, font: FONT_MONO });
          text(c, 'N8', 0, 1.2, 1.1, { weight: 600, font: FONT_MONO });
        },
      }),
      print({
        name: 'chip',
        quad: geo.quad(MCU.x, MCU.y, TOP + chipTop + 0.02, 4.4, 3.2),
        ppm: 14,
        draw(c) {
          c.fillStyle = '#a9a8a2';
          text(c, 'R7FA4M1', 0, -0.95, 1.55, { weight: 600, font: FONT_MONO, spacing: 0.05 });
          text(c, 'AB3CFM', 0, 0.95, 1.55, { weight: 600, font: FONT_MONO, spacing: 0.05 });
        },
      }),
      matrix,
      ...ledLamps(geo, LEDS),
    );
    return root;
  },
  animate(st, obj, env) {
    const again = animateUno(st, obj, env);
    const on = st.power.on;
    const a = on ? Number(st.outputs.matrix0) >>> 0 : 0, b = on ? Number(st.outputs.matrix1) >>> 0 : 0, c = on ? Number(st.outputs.matrix2) >>> 0 : 0;
    const shown = obj.userData as Shown;
    if (shown.mx0 !== a || shown.mx1 !== b || shown.mx2 !== c) {
      shown.mx0 = a;
      shown.mx1 = b;
      shown.mx2 = c;
      shown.mxKey = (shown.mxKey ?? 0) + 1;
    }
    w0 = a;
    w1 = b;
    w2 = c;
    drawScreen(obj, 'matrix', shown.mxKey ?? 0, drawMatrix);
    return again;
  },
  states: {
    heart: partState({ outputs: { ...HEART, led: 1, tx: 0, rx: 0, crashed: false } }),
    idle: partState({ outputs: { matrix0: 0, matrix1: 0, matrix2: 0, led: 0, tx: 0, rx: 0, crashed: false } }),
    full: partState({ outputs: trafficOutputs({ matrix0: 0xffffffff, matrix1: 0xffffffff, matrix2: 0xffffffff }) }),
    off: partState({ power: { on: false, reason: 'no supply' }, outputs: { ...HEART, led: 0, tx: 0, rx: 0, crashed: false } }),
    crashed: partState({ crashed: true, outputs: { ...HEART, led: 0, tx: 0, rx: 0, crashed: true } }),
  },
});
