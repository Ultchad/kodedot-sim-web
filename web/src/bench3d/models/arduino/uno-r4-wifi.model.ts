/**
 * Arduino Uno R4 WiFi. Footprint, outline, mounting holes, socket positions and terminals come from
 * parts/uno-r4-wifi/manifest.json; the rest is the board as its maker's design files have it (the PCB document and the
 * bill of materials of ABX00087: every fitted part at its place and angle, the lands of the parts left off the board
 * bare): USB-C and the barrel jack on the left edge, the ESP32-S3-MINI-1 radio module (15.4 x 20.5 mm, its antenna
 * towards the left edge), the Renesas RA4M1 (LQFP-64) top right, the 12 x 8 matrix of red chip LEDs set at 45 degrees
 * with its row of series resistors, the I2C port (JST-SH) on the right edge, the ESP header, the OFF / GND / VRTC pins
 * in line with the power sockets, the buck converter with its inductor, the 3.3 V regulator (SOT-223), the level
 * shifter, the resettable fuse, the ICSP header, the reset button and the four LEDs: ON, L (pin 13), TX and RX. A dark
 * blue board.
 *
 * The matrix shows the part's outputs matrix0..2 (96 pixels, bit 31 of matrix0 is the top-left LED, row by row): the
 * LED bodies are part of the static body, their light is a `screen` laid over them.
 *
 * Legends: as on the maker's picture of the board, in the kit's type. The maker's name and logo, and the module
 * maker's on the shield can, are left out; "UNO R4 WIFI" and the module's type are the plain designations they carry.
 */
import type { MeshStandardMaterial } from 'three';
import manifestJson from '../../../../../parts/uno-r4-wifi/manifest.json';
import {
  FONT_MONO, Shape, defineModel, drawScreen, footprintOf, moduleCan, partState, pinHeader, print, screen, terminalsFromManifest, text, usbC,
  type Finish, type Object3D, type PartState,
} from '../../index';
import {
  C0402, C0603, C0805, F1812, L0603, LED0603, R0402, SC70_6, SOD123, SOT143, SOT23, TOP, animateUno, chips, dcJack, dots, drawCaption, drawPinLabels, emptyLands, eraseHoles, flatDiode,
  inductor, inverse, jstSh4, leadless, ledBodies, ledLamps, legend, plate, qfpLean, resetButton, resetCap, resetPress, smallOutline, sot223, trafficOutputs, unoBoard, unoGeo, type ChipSize, type UnoLeds,
  type UnoManifest,
} from './uno';

const manifest = manifestJson as unknown as UnoManifest;
const geo = unoGeo(manifest);
const { W, D } = geo;

/** The R4 WiFi's solder mask. */
const MASK: Finish = ['pcb', '#182a4a'];
// board millimetres (the manifest's frame); the connectors' mouths overhang the left edge (the jack as far as the manifest's body lets it)
const USB = { x: -0.65, y: 15.47 }, JACK = { x: Math.max(-2.04, -geo.x0), y: 45.54 };
const RADIO = { x: 10.575, y: 31.845, w: 15.4, d: 20.65, can: 14.2 }; // lying: its length along x, the antenna at the left end
const MCU = { x: 52.75, y: 17.49, size: 10 };
const ICSP = { x: 64.9, y: 25.4 }, QWIIC = { x: 68.2, y: 38.99 }, ESP = { x: 18.8, y: 11.38 }, JOFF = { x: 20.32, y: 50.8 };
/** The reset button: where the manifest has the control (an estimate there; the PCB document has it at 6.35, 3.94). */
const RESET = geo.control('reset');
/** The transistor that stands right of the word RESET (the word ends before it). */
const Q_RESET = { x: 12.52, y: 9.27 };
/** L (pin 13) lights where the manifest's `visuals.led` is; TX, RX and ON as the PCB document has them. */
const LEDS: UnoLeds = { l: geo.visual('led'), tx: [26.42, 16.76], rx: [26.42, 19.05], on: [64.9, 13.79, 315], size: LED0603, onReach: 1.6 };
/** The LED matrix: 12 x 8 at 2.1 mm, each LED turned 45 degrees; `margin` is how far the light may spill. */
const MX = { x0: 34.41 - 1.05, y0: 26.81 - 1.05, pitch: 2.1, cols: 12, rows: 8, margin: 1.0 };
const mxX = (c: number) => MX.x0 + (c + 0.5) * MX.pitch, mxY = (r: number) => MX.y0 + (r + 0.5) * MX.pitch;
const MX_LED: ChipSize = { ...LED0603, h: 0.55, body: ['matte', '#cbc4a2'], lean: true };
const RED = 0xff2412;
/** The heart of the board's default sketch (the frame of the LED matrix examples). */
const HEART = { matrix0: 0x3184a444, matrix1: 0x44042081, matrix2: 0x100a0040 };

/** Makes a `screen(..., { lit: false })` shine in one colour wherever it is drawn: the light of the matrix sits on the LEDs. */
function makeGlow(mesh: Object3D, colour: number, intensity: number): void {
  const m = (mesh as unknown as { material: MeshStandardMaterial }).material;
  m.emissive.setHex(colour);
  m.emissiveIntensity = intensity;
  // its own light only: the room's light on the drawing would wash the colour out
  m.roughness = 1;
  m.envMapIntensity = 0.12;
}
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
      g.beginPath();
      if (pass === 2) {
        // the lit die between the LED's two ends, turned as the LED is
        g.moveTo(cx - 0.62 * k, cy);
        g.lineTo(cx, cy - 0.62 * k);
        g.lineTo(cx + 0.62 * k, cy);
        g.lineTo(cx, cy + 0.62 * k);
      } else g.arc(cx, cy, (pass === 0 ? 1.45 : 0.9) * k, 0, Math.PI * 2);
      g.fill();
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
    s.with(geo.frame, () => {
      unoBoard(s, geo, MASK, ctx.seg);
      usbC(s, { x: USB.x, z: USB.y, y: TOP, turn: 1 });
      dcJack(s, JACK.x, JACK.y, 1, ctx.seg);
      resetButton(s, RESET);
      canTop = moduleCan(s, { x: RADIO.x, z: RADIO.y, y: TOP, w: RADIO.w, d: RADIO.d, canD: RADIO.can, turn: 3 });
      chipTop = qfpLean(s, { x: MCU.x, z: MCU.y, size: MCU.size, perSide: 16, h: 1.45 });
      pinHeader(s, { x: ICSP.x, z: ICSP.y, y: TOP, n: 3, rows: 2, turn: 1 });
      pinHeader(s, { x: ESP.x, z: ESP.y, y: TOP, n: 3, rows: 2 });
      pinHeader(s, { x: JOFF.x, z: JOFF.y, y: TOP, n: 3 });
      jstSh4(s, QWIIC.x, QWIIC.y, 3);
      // the matrix: 96 chip LEDs
      const leds: [number, number, number][] = [];
      for (let r = 0; r < MX.rows; r++) for (let c = 0; c < MX.cols; c++) leds.push([mxX(c), mxY(r), 45]);
      chips(s, MX_LED, leds);
      // power: the buck converter and its inductor, the 3.3 V regulator, the two diodes, the fuse
      inductor(s, 29.51, 36.09);
      leadless(s, [26.83, 31.24, 0], 4, 3, 6, 0.5);
      sot223(s, 26.32, 43.13, 2);
      flatDiode(s, [26.4, 22.86, 90], SOD123);
      flatDiode(s, [15.39, 45.03, 270], SOD123);
      chips(s, F1812, [[9.12, 20.74, 90]]);
      // logic: the level shifter between the two processors, the USB switches and protection, three transistors
      leadless(s, [18.7, 20.06, 0], 4, 2, 10, 0.4, 0.75);
      smallOutline(s, [9.12, 15.47, 180], SOT143);
      smallOutline(s, [12.52, 14.07, 180], SC70_6);
      smallOutline(s, [12.52, 16.87, 180], SC70_6);
      for (const at of [[Q_RESET.x, Q_RESET.y, 0], [63.27, 33.31, 180], [66.67, 33.31, 180]] as const) smallOutline(s, at, SOT23);
      chips(s, C0805, [[1.85, 9.19], [30.64, 26.19], [30.64, 28.14], [30.66, 30.09], [30.66, 32.04], [23.2, 36.09, 90], [25.22, 36.09, 90], [31.02, 40.98, 90], [17.59, 42.93, 90]]);
      chips(s, C0603, [[44.35, 15.39], [60.95, 17.46], [44.25, 23.46]]);
      chips(s, L0603, [[45.99, 11.91], [59.51, 11.91]]);
      chips(s, C0402, [
        [46.26, 10.71], [59.23, 10.71], [12.52, 12.07], [44.65, 14.03], [44.65, 16.56], [18.15, 16.76, 90], [19.25, 16.76, 90], [11.92, 19.11, 90], [15.8, 20.06, 90], [27.33, 28.04, 90], [28.43, 28.04, 90],
        [25.6, 33.74], [19.19, 43.35, 90],
      ]);
      chips(s, R0402, [
        [13.47, 6.1, 90], [26.4, 9.04], [4.55, 9.49], [26.42, 10.03], [9.12, 10.48], [64.38, 11.4, 90], [44.11, 11.44, 90], [9.12, 11.68], [26.42, 12.32], [9.12, 12.87], [26.42, 15.62], [15.95, 16.76, 90],
        [17.05, 16.76, 90], [20.35, 16.76, 90], [21.45, 16.76, 90], [44.65, 17.66], [24.29, 17.91], [26.42, 17.91], [13.12, 19.11, 90], [44.65, 19.86], [21.6, 20.06, 90], [44.65, 20.96], [60.65, 20.96],
        [3.62, 21.57], [11.92, 21.87, 90], [13.12, 21.88, 90], [16.82, 22.37], [6.02, 22.67], [27.95, 26.11], [59.92, 27.23, 45], [22.93, 28.04, 90], [25.13, 28.04, 90], [26.23, 28.04, 90], [60.01, 28.56, 45],
        [60.01, 29.96, 45], [22.93, 30.34, 90], [24.03, 30.34, 90], [62.67, 30.51, 90], [63.87, 30.51, 90], [66.07, 30.51, 90], [67.27, 30.51, 90], [60.01, 31.36, 45], [22.93, 32.54, 90], [60.01, 32.76, 45],
        [60.01, 34.16, 45], [60.01, 35.56, 45], [60.01, 36.96, 45], [60.01, 38.36, 45], [60.01, 39.76, 45], [60.01, 41.16, 45],
      ]);
      ledBodies(s, LEDS);
    });
    const root = s.toObject();
    const mask = MASK[1];
    const matrix = screen('matrix', geo.quad(MX.x0 + (MX.cols * MX.pitch) / 2, MX.y0 + (MX.rows * MX.pitch) / 2, TOP + 0.62, (MX.cols * MX.pitch) / 2 + MX.margin, (MX.rows * MX.pitch) / 2 + MX.margin), 12, { lit: false });
    makeGlow(matrix, RED, 1.2);
    root.add(
      print({
        name: 'silk',
        quad: geo.quad(W / 2, D / 2, TOP + 0.02, W / 2, D / 2),
        ppm: 14,
        draw(c) {
          c.translate(-W / 2, -D / 2);
          // bare metal: the lands of the parts left off the board, the gilded test points, fiducials, the jack's lug
          emptyLands(c, [[12.37, 6.1, 90], [22.93, 26.11, 90], [24.03, 26.11, 90], [20.07, 6.1, 90], [22.61, 6.1, 90], [6.02, 21.57], [60.65, 22.06], [24.03, 28.04, 90], [24.03, 32.54, 90]], 1.0, 0.5);
          dots(c, [
            [63.5, 42.84], [9.12, 17.37], [16.26, 7.37], [12.86, 23.34], [15.4, 23.34], [14.12, 23.34], [16.66, 23.34], [11.59, 23.34], [3.62, 22.67], [16.26, 6.1], [14.12, 22.07], [15.4, 22.07], [7.35, 11.6],
            [7.35, 12.87], [14.12, 40.56], [20.83, 23.34], [19.2, 23.34], [15.4, 40.56], [17.94, 23.34], [13.94, 46.67], [44.65, 18.76], [60.65, 19.92], [62.15, 19.92], [64.97, 35.24], [64.97, 30.51],
            [60.65, 23.16], [62.27, 36.51], [62.27, 35.24], [22.93, 33.94], [25.93, 26.1], [16.66, 40.56], [17.94, 40.56],
          ], 0.4, '#c9a851');
          dots(c, [[2, 51.34], [56.35, 15.92]], 0.5, '#c9a851');
          dots(c, [[8.69, 50.04]], 1.9);
          drawPinLabels(c, geo, { mask, backBar: true, names: { V33: '3.3V' } });
          const d0 = geo.pinX('D0'), a0 = geo.pinX('A0'), a5 = geo.pinX('A5'), vin = geo.pinX('VIN');
          drawCaption(c, 'DIGITAL (PWM~)', [42.8, 59.4], [28.1, d0 + 1.2], 8.45, 1, mask);
          drawCaption(c, 'POWER', [vin - 4.9, vin + 1.4], [34.75, vin + 1.4], 43.8, 1, mask);
          drawCaption(c, 'ANALOG IN', [a0 - 1.2, a0 + 9.6], [a0 - 1.2, a5 + 1.2], 43.8, 1, mask);
          plate(c, 'UNO', 30.45, 18.3, 36.5, 21, mask, false, 2.1);
          plate(c, 'R4', 36.5, 18.3, 40.6, 21, mask, true, 2.1);
          plate(c, 'WIFI', 30.45, 21.35, 37.7, 23.8, mask, false, 2.1);
          legend(c, 'L', LEDS.l[0] - 2.1, LEDS.l[1], 1.45);
          legend(c, 'TX', LEDS.tx[0] - 2.6, LEDS.tx[1], 1.45);
          legend(c, 'RX', LEDS.rx[0] - 2.6, LEDS.rx[1], 1.45);
          legend(c, 'ON', LEDS.on[0] - 1.9, LEDS.on[1] + 1.7, 1.35);
          legend(c, 'RESET', Math.min(RESET[0] - 0.15, Q_RESET.x - 4.1), RESET[1] + 4.16, 1.6);
          legend(c, 'ICSP', ICSP.x, ICSP.y - 4.85, 1.35);
          // the three pins in line with the power sockets: battery switch-off, ground, the clock's backup supply
          legend(c, 'OFF', JOFF.x - 2.54, 47.75, 1.22, true);
          legend(c, 'VRTC', JOFF.x + 2.54, 47.3, 1.22, true);
          inverse(c, 'GND', JOFF.x - 1.2, 45.4, JOFF.x + 1.2, 49.0, mask, 1.22, true);
          c.fillRect(JOFF.x - 1.25, D - 0.55, 2.5, 0.55);
          c.fillRect(ESP.x - 3.8, ESP.y + 1.9, 2.5, 1.5); // the mark of the ESP header's first pin
          c.fillRect(W - 1.2, ICSP.y + 1.2, 1.2, 2.2); // and of the ICSP header's, on the board's edge
          eraseHoles(c, geo);
        },
      }),
      // the radio module's own board: its antenna, copper under the black mask at its left end
      print({
        name: 'antenna',
        quad: geo.quad(RADIO.x - RADIO.d / 2 + 2.5, RADIO.y, TOP + 0.82, 2.35, RADIO.w / 2 - 0.3),
        ppm: 14,
        draw(c) {
          c.strokeStyle = '#3a3c41';
          c.lineWidth = 0.5;
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
        quad: geo.quad(RADIO.x + RADIO.d / 2 - 0.6 - RADIO.can / 2, RADIO.y, canTop + 0.02, RADIO.can / 2 - 0.4, RADIO.w / 2 - 1.1),
        ppm: 12,
        draw(c) {
          // the module's type, reading up the board as on the can
          c.fillStyle = '#5b5d63';
          text(c, 'ESP32-S3-MINI-1', -1.2, 0, 1.25, { weight: 700, font: FONT_MONO, angle: -Math.PI / 2 });
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
      matrix,
      resetCap(geo, manifest, ['matte', '#eeebe3'], ctx.seg),
      resetPress(geo, manifest),
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
    reset: partState({ fields: { reset: true }, outputs: { matrix0: 0, matrix1: 0, matrix2: 0, led: 0, tx: 0, rx: 0, crashed: false } }),
    off: partState({ power: { on: false, reason: 'no supply' }, outputs: { ...HEART, led: 0, tx: 0, rx: 0, crashed: false } }),
    crashed: partState({ crashed: true, outputs: { ...HEART, led: 0, tx: 0, rx: 0, crashed: true } }),
  },
});
