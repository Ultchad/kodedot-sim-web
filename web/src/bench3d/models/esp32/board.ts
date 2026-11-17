/**
 * The shared builder of the ESP32 dev boards. One function makes the model of a manifest; the model files of this
 * folder only name their manifest and the board it is.
 *
 * Two boards, at real size:
 *  - `classic`: ESP32-DevKitC V4 (54.4 x 27.9 mm board, ESP32-WROOM-32E module 18 x 25.5 x 3.1 mm, micro-USB,
 *    CP2102 bridge in QFN-28, AMS1117 regulator in SOT-223, EN and BOOT switches either side of the USB socket).
 *  - `s3`: ESP32-S3-DevKitC-1 v1.1 (62.7 x 25.4 mm board, ESP32-S3-WROOM-1 module 18 x 25.5 x 3.1 mm, two USB-C
 *    sockets "USB" and "UART", CP2102N bridge, BOOT and RST switches with the addressable RGB LED between them).
 * Sources: the DevKitC V4 and S3-DevKitC-1 user guides (dimension drawings, component maps) and the WROOM-32E and
 * S3-WROOM-1 datasheets (module outline, pad pitch 1.27 mm, antenna keep-out). 2.54 mm headers, 2.5 mm housing,
 * 6 mm legs, 1.6 mm board.
 *
 * Footprint and terminals are the manifest's. The boards plug in: the header housing stands on the seating plane
 * y = 0 and the legs reach `plugMm` below it. The module's antenna end overhangs the board at -X; the USB end is +X
 * (the end of the 5V and GND pins in both manifests).
 */
import {
  FONT, FONT_MONO, INK, PAL, Shape, defineModel, drawScreen, footprintOf, fromManifestMm, glowing, microUsb, partState, pcb, print, screen, setLamp, silkBox,
  terminalsFromManifest, text,
  topQuad, usbC, type BuildCtx, type ManifestBody, type ManifestPin, type PartModel, type PartState, type PrintDef, type Terminal, type V3,
} from '../../index';
import { MLCC, RES, chip, ledChip, legRow, lensOf, qfnLean, radioModule, rgbLed, smdButton, sod123, sot223, sot23, type RadioModuleOut } from './kit';

/** What the builder reads of a part's manifest.json. */
export interface Esp32Manifest {
  id: string;
  name: { en: string };
  body: ManifestBody;
  picture: { width: number };
  pins: ManifestPin[];
  visuals?: { id: string; x: number; y: number; color?: string }[];
}
export type Esp32Board = 'classic' | 's3';

const LEG = 6; // header legs below the housing: into a breadboard
const UNDER = 2.5; // the header housing the board rides on
const THICK = 1.6;
const TOP = UNDER + THICK;
const RED = 0xff3a2e;

type G = CanvasRenderingContext2D;
interface Built {
  s: Shape;
  pwr: Shape;
  led: Shape;
  /** Where the board LED is, and how far its light spills on the board. */
  spill: { x: number; z: number; r: number };
  prints: PrintDef[];
}

// the light an LED throws on the board round it: drawn per copy, only when its level changes
let spillRgb = '255,255,255', spillLevel = 0;
function drawSpill(g: CanvasRenderingContext2D, w: number, h: number): void {
  if (spillLevel <= 0) return;
  const r = Math.min(w, h) / 2;
  const grad = g.createRadialGradient(w / 2, h / 2, r * 0.08, w / 2, h / 2, r);
  grad.addColorStop(0, `rgba(${spillRgb},${0.95 * spillLevel})`);
  grad.addColorStop(0.3, `rgba(${spillRgb},${0.48 * spillLevel})`);
  grad.addColorStop(0.65, `rgba(${spillRgb},${0.16 * spillLevel})`);
  grad.addColorStop(1, `rgba(${spillRgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}
interface Row {
  z: number;
  pins: { x: number; label: string }[];
}

/** The header rows of a manifest: its pins grouped by their distance down the picture, left to right. */
function rowsOf(terminals: readonly Terminal[]): Row[] {
  const rows: Row[] = [];
  for (const t of terminals) {
    let r = rows.find((q) => Math.abs(q.z - t.pos[2]) < 0.01);
    if (!r) rows.push((r = { z: t.pos[2], pins: [] }));
    r.pins.push({ x: t.pos[0], label: t.label ?? t.id });
  }
  for (const r of rows) r.pins.sort((a, b) => a.x - b.x);
  return rows;
}
const points = (r: Row): V3[] => r.pins.map((p) => [p.x, 0, r.z]);

/** Where the manifest's picture shows the board LED, in the model frame. */
function ledPlace(m: Esp32Manifest): { x: number; z: number; colour: number } {
  const v = m.visuals?.find((q) => q.id === 'led');
  if (!v) return { x: m.body.w_mm / 2 - 8, z: 0, colour: 0x3ddc84 };
  const k = m.picture.width / m.body.w_mm;
  const p = fromManifestMm(m.body, { x: v.x / k, y: v.y / k, z: 0 });
  return { x: p[0], z: p[2], colour: /^#[0-9a-f]{6}$/i.test(v.color ?? '') ? parseInt(v.color!.slice(1), 16) : 0x3ddc84 };
}

// ------------------------------------------------------------------------------------------------------ print
/** A pin's name beside its solder joint, reading along the row, squeezed to stay inside its 2.54 mm. */
function pinLabel(g: G, label: string, x: number, z: number, size: number): void {
  const wide = label.length * 0.6 * size;
  g.save();
  g.translate(x, z);
  g.scale(Math.min(1, 2.05 / wide), 1);
  text(g, label, 0, 0, size, { weight: 700, font: FONT_MONO });
  g.restore();
}
/** Copper under the solder mask: a board is never a flat colour. Polylines as [x, z, x, z ...]. */
function traces(g: G, lines: readonly (readonly number[])[]): void {
  g.strokeStyle = 'rgba(150, 164, 182, 0.13)';
  g.fillStyle = 'rgba(170, 180, 196, 0.2)';
  g.lineWidth = 0.24;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const l of lines) {
    g.beginPath();
    g.moveTo(l[0], l[1]);
    for (let i = 2; i < l.length; i += 2) g.lineTo(l[i], l[i + 1]);
    g.stroke();
    // a via where the trace dives to the other side
    g.beginPath();
    g.arc(l[l.length - 2], l[l.length - 1], 0.34, 0, Math.PI * 2);
    g.fill();
  }
}
/** A dot of silkscreen: pin 1, polarity. */
function dot(g: G, x: number, z: number, r = 0.28): void {
  g.beginPath();
  g.arc(x, z, r, 0, Math.PI * 2);
  g.fill();
}
/** Corner ticks round a square chip. */
function corners(g: G, x: number, z: number, half: number, len = 0.9): void {
  g.lineWidth = 0.16;
  g.strokeStyle = INK.silk;
  g.beginPath();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.moveTo(x + sx * (half - len), z + sz * half);
    g.lineTo(x + sx * half, z + sz * half);
    g.lineTo(x + sx * half, z + sz * (half - len));
  }
  g.stroke();
}

/**
 * The marking of a module's shield, as the laser leaves it: dull grey on the tin, read with the antenna up (so along
 * the board's width here). Plain designation text and a code square; no maker's mark.
 */
function canMarking(mod: RadioModuleOut, lines: { name: string; sub: string; small: string[] }): PrintDef {
  return {
    name: 'can',
    quad: topQuad(mod.canX, mod.canZ, mod.canTop + 0.015, mod.canHalfLen, mod.canHalfWid),
    ppm: 22,
    draw(g) {
      // turn the drawing: its top looks at the antenna (-X), its lines run along Z
      g.rotate(-Math.PI / 2);
      const hw = mod.canHalfWid, hl = mod.canHalfLen;
      const etch = 'rgba(58, 60, 66, 0.86)';
      g.strokeStyle = 'rgba(58, 60, 66, 0.34)';
      g.lineWidth = 0.14;
      g.beginPath();
      g.roundRect(-hw + 0.9, -hl + 0.9, 2 * hw - 1.8, 2 * hl - 1.8, 0.7);
      g.stroke();
      g.fillStyle = etch;
      text(g, lines.name, 0, -hl + 3.4, 1.3, { weight: 700, font: FONT });
      g.fillRect(-hw + 1.9, -hl + 4.85, 2 * hw - 3.8, 0.12);
      text(g, lines.sub, 0, -hl + 6.25, 1.05, { weight: 600, font: FONT_MONO });
      // the code square: a fixed pattern (no random numbers in a model)
      const n = 12, cell = 0.36, cx = -hw + 2.0, cy = hl - 2.0 - n * cell;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const on = i === 0 || j === n - 1 || (i === n - 1 && j % 2 === 0) || (j === 0 && i % 2 === 0) || (i * 7 + j * 13 + ((i * j) % 5) * 3) % 5 < 2;
        if (on) g.fillRect(cx + i * cell, cy + j * cell, cell + 0.02, cell + 0.02);
      }
      lines.small.forEach((l, i) => text(g, l, cx + n * cell + 0.9, cy + 0.5 + i * 1.28, 0.9, { weight: 500, font: FONT_MONO, align: 'left' }));
    },
  };
}

// ------------------------------------------------------------------------------------------------------ boards
function buildClassic(ctx: BuildCtx, m: Esp32Manifest, rows: Row[]): Built {
  const { w_mm: w, d_mm: d } = m.body;
  const X = (mm: number) => mm - w / 2, Z = (mm: number) => mm - d / 2;
  const s = new Shape();
  const first = Math.min(...rows.map((r) => r.pins[0].x));
  const left = first - 3.0, right = w / 2 - 0.75;
  pcb(s, { w: right - left, d, x: (left + right) / 2, y: UNDER, thick: THICK, r: 1.1, finish: PAL.pcbBlack });
  // the manifest names one row; a real board stands on two, so the far row is built too (no terminals, no labels)
  const legs = { under: UNDER, top: TOP, plug: LEG, seg: ctx.seg(8) };
  for (const r of rows) {
    legRow(s, points(r), legs);
    if (!rows.some((q) => Math.abs(q.z + r.z) < 0.01)) legRow(s, points(r).map(([x, y, z]) => [x, y, -z] as V3), legs);
  }
  const mod = radioModule(s, { x: -w / 2 + 0.25, z: 0, y: TOP, sidePads: 14, endPads: 10, teeth: 5 });

  // USB to UART bridge and its parts
  qfnLean(s, { x: X(34), z: Z(8.4), y: TOP, size: 5, perSide: 7, seg: ctx.seg(8) });
  chip(s, { x: X(29.2), z: Z(6.4), y: TOP });
  chip(s, { x: X(29.2), z: Z(8.4), y: TOP, body: MLCC });
  chip(s, { x: X(29.2), z: Z(10.4), y: TOP });
  chip(s, { x: X(38.7), z: Z(6.7), y: TOP, body: MLCC, turn: 1 });
  chip(s, { x: X(38.7), z: Z(9.9), y: TOP, body: MLCC, turn: 1 });
  // the two transistors of the auto-program circuit
  sot23(s, { x: X(42.2), z: Z(5.5), y: TOP, turn: 1 });
  sot23(s, { x: X(42.2), z: Z(10.1), y: TOP, turn: 1 });
  // 5 V to 3.3 V
  sot223(s, { x: X(32.6), z: Z(20), y: TOP });
  chip(s, { x: X(38.4), z: Z(18.5), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(38.4), z: Z(21.3), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  // a tantalum on the 3.3 V rail: amber body, the stripe marks its positive end
  s.box(...PAL.tin, X(42.4), Z(19.9), 1.3, 3.5, TOP, TOP + 0.7, 0, 0.08, { ao: 0.9 });
  s.box('matte', '#cf9d36', X(42.4), Z(19.9), 1.7, 3.1, TOP + 0.05, TOP + 1.6, 0.15, 0.2, { ao: 0.9 });
  s.box('matte', '#7a4a1c', X(42.4), Z(18.75), 1.6, 0.5, TOP + 1.6, TOP + 1.62, 0, 0, { ao: 1 });
  sod123(s, { x: X(44.6), z: Z(14), y: TOP });
  chip(s, { x: X(27.6), z: Z(14), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(27.6), z: Z(19), y: TOP, turn: 1 });
  chip(s, { x: X(44.9), z: Z(10.6), y: TOP });
  chip(s, { x: X(27.6), z: Z(10.6), y: TOP, turn: 1 });
  chip(s, { x: X(36.4), z: Z(4.2), y: TOP, body: MLCC });
  chip(s, { x: X(31), z: Z(4.2), y: TOP });

  smdButton(s, { x: X(49.3), z: Z(4.4), y: TOP, seg: ctx.seg(10) });
  smdButton(s, { x: X(49.3), z: Z(23.6), y: TOP, seg: ctx.seg(10) });
  const at = ledPlace(m);
  const led = ledChip(s, { x: at.x, z: at.z, y: TOP, lens: lensOf(at.colour) });
  const pwr = ledChip(s, { x: at.x, z: -at.z, y: TOP, lens: lensOf(RED) });
  chip(s, { x: at.x - 3.0, z: at.z, y: TOP });
  chip(s, { x: at.x - 3.0, z: -at.z, y: TOP });
  microUsb(s, { x: w / 2 - 0.1, z: 0, y: TOP, turn: 3 });
  // the socket's solder lugs
  for (const sz of [-1, 1]) s.box(...PAL.tin, w / 2 - 3.2, sz * 4.2, 1.9, 1.3, TOP, TOP + 1.0, 0.15, 0.12, { ao: 0.9 });

  const silk: PrintDef = {
    name: 'silk',
    quad: topQuad(0, 0, TOP + 0.02, w / 2, d / 2),
    ppm: 16,
    draw(g) {
      traces(g, [
        [X(26.4), Z(7.2), X(27.8), Z(7.2), X(28.6), Z(8.0), X(31), Z(8.0)],
        [X(26.4), Z(9.7), X(28.2), Z(9.7), X(30), Z(11.5), X(31.2), Z(11.5), X(31.2), Z(12.6)],
        [X(26.4), Z(11.0), X(27.4), Z(11.0), X(28.9), Z(12.5), X(28.9), Z(16.8)],
        [X(37), Z(8.4), X(40), Z(8.4), X(40.7), Z(7.7)],
        [X(36.5), Z(11.4), X(36.5), Z(12.2), X(39.3), Z(12.2), X(40.4), Z(11.1)],
        [X(43.6), Z(5.5), X(45.6), Z(5.5), X(46.5), Z(4.6)],
        [X(43.6), Z(10.1), X(45.4), Z(10.1), X(46.4), Z(11.1), X(46.4), Z(12.6)],
        [X(36.2), Z(20), X(37.2), Z(20), X(37.2), Z(16.2), X(40.2), Z(16.2), X(41.2), Z(17.2)],
        [X(46.6), Z(14), X(49.2), Z(14)],
        [X(39.6), Z(21.3), X(40.4), Z(22.1), X(40.4), Z(23.3), X(45.2), Z(23.3)],
        [X(26.4), Z(17.3), X(27.2), Z(17.3), X(28.6), Z(15.9), X(30.2), Z(15.9)],
        [X(26.4), Z(20.2), X(28.4), Z(20.2), X(29), Z(20.8), X(29), Z(22.4)],
      ]);
      g.fillStyle = INK.silk;
      for (const r of rows) for (const p of r.pins) pinLabel(g, p.label, p.x, r.z - Math.sign(r.z) * 2.2, 1.25);
      text(g, 'ESP32-DevKitC', X(34.6), Z(13.7), 1.5, { weight: 700, font: FONT, spacing: 0.03 });
      text(g, 'V4', X(41.3), Z(13.75), 1.1, { weight: 700, font: FONT_MONO });
      text(g, 'EN', X(45.8), Z(4.4), 1.1, { weight: 700, font: FONT_MONO, align: 'right' });
      text(g, 'BOOT', X(45.8), Z(23.1), 1.0, { weight: 700, font: FONT_MONO, align: 'right' });
      text(g, 'IO2', at.x, at.z + 1.75, 0.95, { weight: 700, font: FONT_MONO });
      text(g, 'PWR', at.x, -at.z - 1.75, 0.95, { weight: 700, font: FONT_MONO });
      text(g, 'U2', X(38.6), Z(12), 0.85, { weight: 600, font: FONT_MONO });
      text(g, 'U3', X(37.2), Z(23.2), 0.85, { weight: 600, font: FONT_MONO });
      text(g, 'D1', X(44.6), Z(12.5), 0.85, { weight: 600, font: FONT_MONO });
      text(g, 'C6', X(42.4), Z(22.5), 0.85, { weight: 600, font: FONT_MONO });
      corners(g, X(34), Z(8.4), 3.05);
      dot(g, X(30.6), Z(11.6));
      silkBox(g, X(32.6) - 3.6, Z(20) - 2.05, 7.2, 4.1, 0.2, 0.16);
      silkBox(g, X(49.3) - 3.1, Z(4.4) - 1.95, 6.2, 3.9, 0.3, 0.16);
      silkBox(g, X(49.3) - 3.1, Z(23.6) - 1.95, 6.2, 3.9, 0.3, 0.16);
      // the keep-out line of the antenna, and the tantalum's plus
      g.fillRect(X(26.3), -d / 2 + 3.4, 0.14, d - 6.8);
      text(g, '+', X(42.4), Z(17.3), 1.1, { weight: 700, font: FONT_MONO });
    },
  };
  return { s, pwr, led, spill: { x: at.x, z: at.z, r: 5.5 }, prints: [silk, canMarking(mod, { name: 'ESP32-WROOM-32E', sub: 'N4 · 2.4 GHz', small: ['Wi-Fi b/g/n', 'BT 4.2 + LE', 'LOT 2246 B'] })] };
}

function buildS3(ctx: BuildCtx, m: Esp32Manifest, rows: Row[]): Built {
  const { w_mm: w, d_mm: d } = m.body;
  const X = (mm: number) => mm - w / 2, Z = (mm: number) => mm - d / 2;
  const s = new Shape();
  const first = Math.min(...rows.map((r) => r.pins[0].x));
  const left = first - 4.6, right = w / 2 - 0.9;
  pcb(s, { w: right - left, d, x: (left + right) / 2, y: UNDER, thick: THICK, r: 1.0, finish: PAL.pcbBlack });
  for (const r of rows) legRow(s, points(r), { under: UNDER, top: TOP, plug: LEG, seg: ctx.seg(8) });
  const mod = radioModule(s, { x: -w / 2 + 0.25, z: 0, y: TOP, sidePads: 14, endPads: 12, teeth: 6 });

  // 5 V to 3.3 V
  sot223(s, { x: X(31.8), z: Z(6.6), y: TOP });
  chip(s, { x: X(37.6), z: Z(4.9), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(37.6), z: Z(7.4), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(27.5), z: Z(5.2), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(27.5), z: Z(8.6), y: TOP, turn: 1 });
  // USB to UART bridge
  qfnLean(s, { x: X(43), z: Z(17.3), y: TOP, size: 5, perSide: 7, seg: ctx.seg(8) });
  chip(s, { x: X(38.9), z: Z(15.6), y: TOP });
  chip(s, { x: X(38.9), z: Z(17.3), y: TOP, body: MLCC });
  chip(s, { x: X(38.9), z: Z(19), y: TOP });
  chip(s, { x: X(47.4), z: Z(16.1), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(47.4), z: Z(19), y: TOP, turn: 1, body: MLCC });
  // auto-program transistors and their resistors
  sot23(s, { x: X(43.4), z: Z(5.5), y: TOP });
  sot23(s, { x: X(47.8), z: Z(5.5), y: TOP });
  for (let i = 0; i < 4; i++) chip(s, { x: X(41.2 + i * 2.4), z: Z(8.5), y: TOP, body: i === 1 ? MLCC : RES });
  chip(s, { x: X(27.5), z: Z(14.2), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(35.4), z: Z(19.6), y: TOP, turn: 1, body: MLCC });
  // debounce capacitors by the switches, protection between the sockets
  chip(s, { x: X(50.5), z: Z(7.4), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(50.5), z: Z(18), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(63.6), z: Z(12.7), y: TOP, len: 1.3, wid: 0.7, h: 0.45 });
  chip(s, { x: X(65.8), z: Z(12.7), y: TOP, len: 1.3, wid: 0.7, h: 0.45 });

  smdButton(s, { x: X(54.2), z: Z(5.8), y: TOP, seg: ctx.seg(10) });
  smdButton(s, { x: X(54.2), z: Z(19.6), y: TOP, seg: ctx.seg(10) });
  const at = ledPlace(m);
  const led = rgbLed(s, { x: at.x, z: at.z, y: TOP, seg: ctx.seg(14) });
  const pwr = ledChip(s, { x: X(29.4), z: Z(19.6), y: TOP, lens: lensOf(RED) });
  chip(s, { x: X(32.4), z: Z(19.6), y: TOP });
  usbC(s, { x: w / 2 - 0.1, z: Z(6.95), y: TOP, turn: 3 });
  usbC(s, { x: w / 2 - 0.1, z: Z(18.45), y: TOP, turn: 3 });

  const silk: PrintDef = {
    name: 'silk',
    quad: topQuad(0, 0, TOP + 0.02, w / 2, d / 2),
    ppm: 14,
    draw(g) {
      traces(g, [
        [X(26.4), Z(6.2), X(27), Z(6.2), X(27.9), Z(7.1), X(28.2), Z(7.1)],
        [X(26.4), Z(11), X(28), Z(11), X(29.4), Z(12.4), X(29.4), Z(14)],
        [X(26.4), Z(12.6), X(27.6), Z(12.6), X(29), Z(14), X(29), Z(17.4)],
        [X(26.4), Z(16.6), X(30.6), Z(16.6), X(31.6), Z(15.6), X(37.6), Z(15.6)],
        [X(26.4), Z(18), X(27.4), Z(18)],
        [X(35.4), Z(6.6), X(36.2), Z(6.6), X(36.2), Z(9.9), X(39.4), Z(9.9), X(40.2), Z(10.7)],
        [X(40.4), Z(17.3), X(40), Z(17.3), X(39.4), Z(14.2), X(45.2), Z(14.2), X(46.2), Z(13.2), X(49.6), Z(13.2)],
        [X(45.6), Z(18.6), X(46.2), Z(18.6), X(46.2), Z(21.2), X(50.6), Z(21.2)],
        [X(49.4), Z(5.5), X(50.4), Z(5.5), X(51.2), Z(4.7)],
        [X(49), Z(8.5), X(50.2), Z(8.5), X(51), Z(9.3), X(51), Z(10.6)],
        [X(56.6), Z(19.6), X(57.4), Z(19.6), X(57.4), Z(15.2)],
        [X(56.6), Z(5.8), X(57.4), Z(5.8), X(57.4), Z(9.8)],
        [X(34.2), Z(19.6), X(34.6), Z(19.6), X(34.6), Z(21.4), X(37), Z(21.4)],
      ]);
      g.fillStyle = INK.silk;
      for (const r of rows) for (const p of r.pins) pinLabel(g, p.label, p.x, r.z - Math.sign(r.z) * 1.52, 1.05);
      text(g, 'ESP32-S3-DevKitC-1', X(38.3), Z(12.3), 1.5, { weight: 700, font: FONT, spacing: 0.03 });
      text(g, 'v1.1', X(48), Z(12.35), 1.0, { weight: 700, font: FONT_MONO });
      text(g, 'RST', X(54.2), Z(8.7), 1.05, { weight: 700, font: FONT_MONO });
      text(g, 'BOOT', X(54.2), Z(16.7), 1.05, { weight: 700, font: FONT_MONO });
      text(g, 'RGB', at.x - 3.5, at.z, 0.95, { weight: 700, font: FONT_MONO });
      text(g, 'UART', X(59.5), Z(6.6), 1.0, { weight: 700, font: FONT_MONO, angle: -Math.PI / 2 });
      text(g, 'USB', X(59.5), Z(18.8), 1.0, { weight: 700, font: FONT_MONO, angle: -Math.PI / 2 });
      text(g, '3V3', X(29.4), Z(21.2), 0.9, { weight: 700, font: FONT_MONO });
      text(g, 'U2', X(43), Z(21), 0.85, { weight: 600, font: FONT_MONO });
      corners(g, X(43), Z(17.3), 3.05);
      dot(g, X(39.7), Z(20.6));
      silkBox(g, X(31.8) - 3.6, Z(6.6) - 2.05, 7.2, 4.1, 0.2, 0.16);
      silkBox(g, X(54.2) - 3.1, Z(5.8) - 1.95, 6.2, 3.9, 0.3, 0.16);
      silkBox(g, X(54.2) - 3.1, Z(19.6) - 1.95, 6.2, 3.9, 0.3, 0.16);
      silkBox(g, at.x - 1.95, at.z - 1.95, 3.9, 3.9, 0.3, 0.16);
      g.fillRect(X(26.3), -d / 2 + 3.2, 0.14, d - 6.4);
    },
  };
  return { s, pwr, led, spill: { x: at.x, z: at.z, r: 7 }, prints: [silk, canMarking(mod, { name: 'ESP32-S3-WROOM-1', sub: 'N16R8 · 2.4 GHz', small: ['Wi-Fi b/g/n', 'Bluetooth 5 LE', 'LOT 2246 B'] })] };
}

// ------------------------------------------------------------------------------------------------------- model
/**
 * The model of one ESP32 board manifest. Live state: the power LED follows `power.on`; the board LED (GPIO2 of the
 * classic board, the RGB LED on GPIO48 of the S3) follows the manifest's `led` visual, 0 to 1, in the colour the
 * manifest gives it, and throws its light on the board round it. These manifests declare no hazard outputs, and
 * the boards have no serial activity LEDs.
 */
export function esp32Model(raw: unknown, board: Esp32Board): PartModel<PartState> {
  const m = raw as Esp32Manifest;
  const terminals = terminalsFromManifest(m);
  const rows = rowsOf(terminals);
  const colour = ledPlace(m).colour;
  const rgb = `${colour >> 16},${(colour >> 8) & 255},${colour & 255}`;
  return defineModel<PartState>({
    id: m.id,
    title: m.name.en,
    footprintMm: footprintOf(m.body),
    plugMm: LEG,
    terminals,
    build(ctx) {
      const b = board === 's3' ? buildS3(ctx, m, rows) : buildClassic(ctx, m, rows);
      const root = b.s.toObject();
      for (const p of b.prints) root.add(print(p));
      root.add(glowing('pwr', b.pwr), glowing('led', b.led), screen('spill', topQuad(b.spill.x, b.spill.z, TOP + 0.04, b.spill.r, b.spill.r), 6, { lit: false }));
      return root;
    },
    animate(st, obj) {
      const on = st.power.on;
      setLamp(obj, 'pwr', RED, on ? 1 : 0);
      const level = on ? Math.min(1, Math.max(0, Number(st.visuals.led ?? 0))) : 0;
      setLamp(obj, 'led', colour, level * 1.5);
      spillRgb = rgb;
      spillLevel = level;
      drawScreen(obj, 'spill', Math.round(level * 24), drawSpill);
    },
    states: {
      running: partState({ visuals: { led: 1 } }),
      idle: partState({ visuals: { led: 0 } }),
      dim: partState({ visuals: { led: 0.25 } }),
      unpowered: partState({ power: { on: false, reason: 'no supply' }, visuals: { led: 1 } }),
    },
  });
}
