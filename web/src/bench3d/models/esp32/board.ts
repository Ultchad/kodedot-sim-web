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
 * y = 0 and the legs reach `plugMm` below it. The antenna end is -X (the 3V3 end of both manifests), the USB end +X.
 * The S3's module overhangs the board end; the DevKitC V4's lies flush with it, as on the board.
 *
 * NOT on the real boards, added so the bench can show what the manifests publish: two small TX and RX LEDs by the
 * USB bridge (they flash when the `tx` and `rx` byte counters move), and the power LED blinking hard with a red
 * glow when the sketch has crashed. Print is plain designation text only: no maker's mark, no invented codes.
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
const RED = 0xff3a2e, AMBER = 0xffac00, WHITE = 0xffffff;
/** How long a serial LED stays lit after its counter moved (a stretched pulse, as indicator drivers do). */
const FLASH = 0.14;

type G = CanvasRenderingContext2D;
interface Spot {
  x: number;
  z: number;
}
interface Built {
  s: Shape;
  pwr: Shape;
  led: Shape;
  tx: Shape;
  rx: Shape;
  /** The patch of board the LEDs throw their light on: its centre and half size, the two LEDs in it, the reach of the board LED's light. */
  spill: { x: number; z: number; half: number; led: Spot; pwr: Spot; reach: number };
  prints: PrintDef[];
}
interface Row {
  z: number;
  pins: { x: number; label: string }[];
}

// The light the LEDs throw on the board round them: one print per copy, drawn again only when a level changes.
// `animate` sets these, then `drawScreen` calls `drawSpill` if the key moved (nothing is allocated otherwise).
const lit = { colour: 0, level: 0, crash: 0, ax: 0, ay: 0, ar: 0, bx: 0, by: 0, br: 0 };
function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, colour: number, level: number): void {
  if (level <= 0) return;
  const rgb = `${colour >> 16},${(colour >> 8) & 255},${colour & 255}`;
  const grad = g.createRadialGradient(x, y, r * 0.08, x, y, r);
  grad.addColorStop(0, `rgba(${rgb},${0.95 * level})`);
  grad.addColorStop(0.3, `rgba(${rgb},${0.48 * level})`);
  grad.addColorStop(0.65, `rgba(${rgb},${0.16 * level})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}
function drawSpill(g: CanvasRenderingContext2D, w: number, h: number): void {
  glow(g, lit.ax * w, lit.ay * h, lit.ar * w, lit.colour, lit.level);
  glow(g, lit.bx * w, lit.by * h, lit.br * w, RED, lit.crash);
}

/** The header rows of a manifest: its pins grouped by their distance down the picture, left to right. */
function rowsOf(terminals: readonly Terminal[]): Row[] {
  const rows: Row[] = [];
  for (const t of terminals) {
    let r = rows.find((q) => Math.abs(q.z - t.pos[2]) < 0.01);
    if (!r) rows.push((r = { z: t.pos[2], pins: [] }));
    // the silkscreen has room for the name only: "SD2 (flash)" prints as SD2, as on the board
    r.pins.push({ x: t.pos[0], label: (t.label ?? t.id).split(' ')[0] });
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
/** A dot of silkscreen: pin 1. */
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
const mono = { weight: 700, font: FONT_MONO } as const;

/**
 * The marking of a module's shield, as the laser leaves it: dull grey on the tin, read with the antenna up (so along
 * the board's width here). The module's designation and what it is, in plain text: no mark, no code.
 */
function canMarking(mod: RadioModuleOut, name: string, lines: readonly string[]): PrintDef {
  return {
    name: 'can',
    quad: topQuad(mod.canX, mod.canZ, mod.canTop + 0.015, mod.canHalfLen, mod.canHalfWid),
    ppm: 22,
    draw(g) {
      // turn the drawing: its top looks at the antenna (-X), its lines run along Z
      g.rotate(-Math.PI / 2);
      g.fillStyle = 'rgba(58, 60, 66, 0.86)';
      text(g, name, 0, -mod.canHalfLen + 3.6, 1.3, { weight: 700, font: FONT });
      lines.forEach((l, i) => text(g, l, 0, -mod.canHalfLen + 6.9 + i * 1.6, 0.92, { weight: 500, font: FONT_MONO }));
    },
  };
}

// ------------------------------------------------------------------------------------------------------ boards
function buildClassic(ctx: BuildCtx, m: Esp32Manifest, rows: Row[]): Built {
  const { w_mm: w, d_mm: d } = m.body;
  const X = (mm: number) => mm - w / 2, Z = (mm: number) => mm - d / 2;
  const s = new Shape();
  // the manifest's body is the board itself: the micro-USB socket's lip takes the last 0.7 mm of it
  const left = -w / 2, right = w / 2 - 0.7;
  pcb(s, { w: right - left, d, x: (left + right) / 2, y: UNDER, thick: THICK, r: 1.2, finish: PAL.pcbBlack });
  for (const r of rows) legRow(s, points(r), { under: UNDER, top: TOP, plug: LEG, seg: ctx.seg(8) });
  const mod = radioModule(s, { x: -w / 2 + 0.15, z: 0, y: TOP, sidePads: 14, endPads: 10, teeth: 5 });

  // USB to UART bridge and its parts
  qfnLean(s, { x: X(36.2), z: Z(9.2), y: TOP, size: 5, perSide: 7, seg: ctx.seg(8) });
  chip(s, { x: X(28.4), z: Z(7), y: TOP });
  chip(s, { x: X(28.4), z: Z(9), y: TOP, body: MLCC });
  chip(s, { x: X(28.4), z: Z(11), y: TOP });
  chip(s, { x: X(31.4), z: Z(7.2), y: TOP, body: MLCC, turn: 1 });
  chip(s, { x: X(31.4), z: Z(10.6), y: TOP, body: MLCC, turn: 1 });
  // the two transistors of the auto-program circuit
  sot23(s, { x: X(41.4), z: Z(6.1), y: TOP, turn: 1 });
  sot23(s, { x: X(41.4), z: Z(10.5), y: TOP, turn: 1 });
  // 5 V to 3.3 V
  sot223(s, { x: X(32.2), z: Z(19.2), y: TOP });
  chip(s, { x: X(37.6), z: Z(17.9), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(37.6), z: Z(20.6), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  // a tantalum on the 3.3 V rail: amber body, the stripe marks its positive end
  s.box(...PAL.tin, X(40.6), Z(19.4), 1.3, 3.5, TOP, TOP + 0.7, 0, 0.08, { ao: 0.9 });
  s.box('matte', '#cf9d36', X(40.6), Z(19.4), 1.7, 3.1, TOP + 0.05, TOP + 1.6, 0.15, 0.2, { ao: 0.9 });
  s.box('matte', '#7a4a1c', X(40.6), Z(18.25), 1.6, 0.5, TOP + 1.6, TOP + 1.62, 0, 0, { ao: 1 });
  sod123(s, { x: X(43.3), z: Z(13.97), y: TOP });
  chip(s, { x: X(27.6), z: Z(14.4), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(27.6), z: Z(18.6), y: TOP, turn: 1 });
  chip(s, { x: X(43.9), z: Z(21.6), y: TOP, body: MLCC });

  // BOOT by the row that carries IO0, EN by the row that carries EN, either side of the socket
  smdButton(s, { x: X(50.5), z: Z(6.2), y: TOP, seg: ctx.seg(10) });
  smdButton(s, { x: X(50.5), z: Z(21.74), y: TOP, seg: ctx.seg(10) });
  const at = ledPlace(m);
  const led = ledChip(s, { x: at.x, z: at.z, y: TOP, len: 1.8, wid: 1.0, turn: 1, lens: lensOf(at.colour) });
  const pwrAt = { x: X(46.2), z: Z(18.7) };
  const pwr = ledChip(s, { ...pwrAt, y: TOP, len: 1.8, wid: 1.0, lens: lensOf(RED) });
  const tx = ledChip(s, { x: X(43.9), z: Z(9.1), y: TOP, len: 1.6, wid: 0.9, lens: lensOf(AMBER) });
  const rx = ledChip(s, { x: X(46.3), z: Z(9.1), y: TOP, len: 1.6, wid: 0.9, lens: lensOf(AMBER) });
  chip(s, { x: X(45.1), z: Z(11.2), y: TOP });
  microUsb(s, { x: w / 2 - 0.1, z: 0, y: TOP, turn: 3 });
  // the socket's solder lugs
  for (const sz of [-1, 1]) s.box(...PAL.tin, w / 2 - 3.3, sz * 4.25, 1.9, 1.3, TOP, TOP + 1.0, 0.15, 0.12, { ao: 0.9 });

  const silk: PrintDef = {
    name: 'silk',
    quad: topQuad(0, 0, TOP + 0.02, w / 2, d / 2),
    ppm: 16,
    draw(g) {
      traces(g, [
        [X(26.2), Z(7.8), X(27), Z(7.8), X(27.8), Z(8), X(27.4), Z(8)],
        [X(26.2), Z(12.2), X(29.4), Z(12.2), X(30.2), Z(13), X(30.2), Z(12.6)],
        [X(33.6), Z(9.2), X(32.6), Z(9.2), X(32.6), Z(12.4), X(29.6), Z(15.6), X(29.6), Z(16.4)],
        [X(38.8), Z(9.2), X(39.6), Z(9.2), X(39.6), Z(6.1), X(40.2), Z(6.1)],
        [X(36.2), Z(11.8), X(36.2), Z(12.4), X(39.4), Z(12.4), X(40.2), Z(11.6)],
        [X(42.8), Z(6.1), X(43.8), Z(6.1), X(44.8), Z(5.1), X(46.4), Z(5.1)],
        [X(42.8), Z(10.5), X(43.4), Z(11.2), X(44.2), Z(11.2)],
        [X(35.6), Z(19.2), X(36.2), Z(19.2), X(36.2), Z(16.4), X(39.4), Z(16.4), X(40.2), Z(17.2)],
        [X(45.2), Z(13.97), X(46.6), Z(13.97)],
        [X(41.6), Z(19.4), X(42.4), Z(19.4), X(43.2), Z(18.7), X(45.2), Z(18.7)],
        [X(26.2), Z(16.6), X(27), Z(16.6), X(28), Z(16.6)],
        [X(26.2), Z(21), X(28.2), Z(21), X(28.8), Z(21.6), X(28.8), Z(22.6)],
      ]);
      g.fillStyle = INK.silk;
      for (const r of rows) for (const p of r.pins) pinLabel(g, p.label, p.x, r.z - Math.sign(r.z) * 2.2, 1.2);
      text(g, 'ESP32-DevKitC', X(33.6), Z(13.95), 1.45, { weight: 700, font: FONT, spacing: 0.03 });
      text(g, 'V4', X(40.1), Z(14), 1.05, mono);
      text(g, 'BOOT', X(47), Z(5.9), 0.95, { ...mono, align: 'right' });
      text(g, 'EN', X(47), Z(21.74), 1.05, { ...mono, align: 'right' });
      text(g, 'IO2', at.x - 1.9, at.z + 1.75, 0.9, mono);
      text(g, 'PWR', pwrAt.x - 2.5, pwrAt.z, 0.9, mono);
      text(g, 'TX', X(43.9), Z(7.6), 0.9, mono);
      text(g, 'RX', X(46.3), Z(7.6), 0.9, mono);
      corners(g, X(36.2), Z(9.2), 3.05);
      dot(g, X(32.9), Z(12.5));
      silkBox(g, X(32.2) - 3.6, Z(19.2) - 2.05, 7.2, 4.1, 0.2, 0.16);
      silkBox(g, X(50.5) - 3.1, Z(6.2) - 1.8, 6.2, 3.6, 0.3, 0.16);
      silkBox(g, X(50.5) - 3.1, Z(21.74) - 1.8, 6.2, 3.6, 0.3, 0.16);
      // the module's outline, and the tantalum's plus
      g.fillRect(X(26.15), Z(5.2), 0.14, 17.5);
      text(g, '+', X(40.6), Z(16.9), 1.1, mono);
    },
  };
  // the patch of light stays on the board: its right edge stops short of the board's end
  const half = 7.2, cx = Math.min((at.x + pwrAt.x) / 2, right - half - 0.1);
  return {
    s, pwr, led, tx, rx,
    spill: { x: cx, z: (at.z + pwrAt.z) / 2, half, led: at, pwr: pwrAt, reach: 5.5 },
    prints: [silk, canMarking(mod, 'ESP32-WROOM-32E', ['Wi-Fi 802.11 b/g/n', 'Bluetooth 4.2 + LE', '4 MB flash'])],
  };
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
  sot223(s, { x: X(31.8), z: Z(7), y: TOP });
  chip(s, { x: X(37.6), z: Z(5.4), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(37.6), z: Z(7.9), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(27.5), z: Z(5.6), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(27.5), z: Z(9), y: TOP, turn: 1 });
  // USB to UART bridge
  qfnLean(s, { x: X(42.6), z: Z(17.6), y: TOP, size: 5, perSide: 7, seg: ctx.seg(8) });
  chip(s, { x: X(38.5), z: Z(15.9), y: TOP });
  chip(s, { x: X(38.5), z: Z(17.6), y: TOP, body: MLCC });
  chip(s, { x: X(38.5), z: Z(19.3), y: TOP });
  chip(s, { x: X(35.4), z: Z(19.2), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(29.2), z: Z(16.6), y: TOP });
  chip(s, { x: X(29.2), z: Z(19.2), y: TOP, body: MLCC });
  chip(s, { x: X(32.2), z: Z(17.9), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC, turn: 1 });
  // auto-program transistors and their resistors
  sot23(s, { x: X(43), z: Z(5.9), y: TOP });
  sot23(s, { x: X(47.2), z: Z(5.9), y: TOP });
  for (let i = 0; i < 4; i++) chip(s, { x: X(41 + i * 2.4), z: Z(8.9), y: TOP, body: i === 1 ? MLCC : RES });
  chip(s, { x: X(27.5), z: Z(14.2), y: TOP, turn: 1, body: MLCC });
  // debounce capacitors by the switches, protection between the sockets
  chip(s, { x: X(51.7), z: Z(7.2), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(51.9), z: Z(18.4), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(63.6), z: Z(12.7), y: TOP, len: 1.3, wid: 0.7, h: 0.45 });
  chip(s, { x: X(65.8), z: Z(12.7), y: TOP, len: 1.3, wid: 0.7, h: 0.45 });

  // BOOT, the RGB LED and RST stand in one line before the sockets (BOOT and the UART socket on the 3V3 row's side)
  const at = ledPlace(m);
  smdButton(s, { x: at.x, z: Z(5.6), y: TOP, seg: ctx.seg(10) });
  smdButton(s, { x: at.x, z: Z(19.8), y: TOP, seg: ctx.seg(10) });
  const led = rgbLed(s, { x: at.x, z: at.z, y: TOP, seg: ctx.seg(14) });
  const pwrAt = { x: X(49.5), z: Z(15.3) };
  const pwr = ledChip(s, { ...pwrAt, y: TOP, len: 1.8, wid: 1.0, lens: lensOf(RED) });
  const tx = ledChip(s, { x: X(49.6), z: Z(17.6), y: TOP, len: 1.6, wid: 0.9, lens: lensOf(AMBER) });
  const rx = ledChip(s, { x: X(49.6), z: Z(19.7), y: TOP, len: 1.6, wid: 0.9, lens: lensOf(AMBER) });
  usbC(s, { x: w / 2 - 0.1, z: Z(6.95), y: TOP, turn: 3 });
  usbC(s, { x: w / 2 - 0.1, z: Z(18.45), y: TOP, turn: 3 });

  const silk: PrintDef = {
    name: 'silk',
    quad: topQuad(0, 0, TOP + 0.02, w / 2, d / 2),
    ppm: 14,
    draw(g) {
      traces(g, [
        [X(26.4), Z(6.6), X(27), Z(6.6), X(27.9), Z(7.5), X(28.2), Z(7.5)],
        [X(26.4), Z(11.2), X(28), Z(11.2), X(29.4), Z(12.6), X(29.4), Z(14.4)],
        [X(26.4), Z(15.2), X(31), Z(15.2), X(31.8), Z(14.4), X(37.4), Z(14.4)],
        [X(26.4), Z(21), X(33.4), Z(21), X(34), Z(20.4)],
        [X(35.4), Z(7), X(36.2), Z(7), X(36.2), Z(10.3), X(39.4), Z(10.3), X(40.2), Z(11)],
        [X(45.2), Z(16.4), X(46), Z(16.4), X(46), Z(14.4), X(47), Z(13.4), X(47.6), Z(13.4)],
        [X(45.2), Z(18.8), X(46.2), Z(18.8), X(46.6), Z(21.2), X(51.6), Z(21.2)],
        [X(48.8), Z(5.9), X(49.8), Z(5.9), X(50.6), Z(5.1)],
        [X(49), Z(8.9), X(50), Z(8.9), X(50.6), Z(9.5), X(50.6), Z(10.8)],
        [X(59), Z(19.8), X(59.2), Z(19.8), X(59.2), Z(15.6)],
        [X(59), Z(5.6), X(59.2), Z(5.6), X(59.2), Z(9.6)],
      ]);
      g.fillStyle = INK.silk;
      for (const r of rows) for (const p of r.pins) pinLabel(g, p.label, p.x, r.z - Math.sign(r.z) * 1.52, 1.05);
      text(g, 'ESP32-S3-DevKitC-1', X(38.3), Z(12.5), 1.5, { weight: 700, font: FONT, spacing: 0.03 });
      text(g, 'v1.1', X(47.8), Z(12.55), 1.0, mono);
      text(g, 'RST', at.x, Z(8.5), 1.0, mono);
      text(g, 'BOOT', at.x, Z(16.9), 1.0, mono);
      text(g, 'RGB', at.x - 3.5, at.z - 0.3, 0.9, mono);
      text(g, 'USB', X(60.3), Z(6.9), 1.0, { ...mono, angle: -Math.PI / 2 });
      text(g, 'UART', X(60.3), Z(18.5), 1.0, { ...mono, angle: -Math.PI / 2 });
      text(g, '3V3', X(48.4), Z(15.3), 0.85, { ...mono, align: 'right' });
      text(g, 'TX', X(48.5), Z(17.6), 0.85, { ...mono, align: 'right' });
      text(g, 'RX', X(48.5), Z(19.7), 0.85, { ...mono, align: 'right' });
      corners(g, X(42.6), Z(17.6), 3.05);
      dot(g, X(39.3), Z(20.9));
      silkBox(g, X(31.8) - 3.6, Z(7) - 2.05, 7.2, 4.1, 0.2, 0.16);
      silkBox(g, at.x - 3.1, Z(5.6) - 1.95, 6.2, 3.9, 0.3, 0.16);
      silkBox(g, at.x - 3.1, Z(19.8) - 1.95, 6.2, 3.9, 0.3, 0.16);
      silkBox(g, at.x - 1.95, at.z - 1.95, 3.9, 3.9, 0.3, 0.16);
      g.fillRect(X(26.3), -d / 2 + 3.6, 0.14, d - 7.2);
    },
  };
  return {
    s, pwr, led, tx, rx,
    spill: { x: (at.x + pwrAt.x) / 2, z: (at.z + pwrAt.z) / 2, half: 9, led: at, pwr: pwrAt, reach: 7 },
    prints: [silk, canMarking(mod, 'ESP32-S3-WROOM-1', ['Wi-Fi 802.11 b/g/n', 'Bluetooth 5 (LE)', '8 MB flash'])],
  };
}

// ------------------------------------------------------------------------------------------------------- model
const num = (v: unknown): number => (typeof v === 'number' ? v : v === true ? 1 : 0);

/**
 * The model of one ESP32 board manifest. Live state, from the part's `outputs` (the manifest's `led` visual when an
 * older engine has no `led` output):
 *  - power LED: `power.on`; it blinks hard and throws a red glow when `crashed` (see the note at the top);
 *  - board LED: `led` 0..1 in the colour the manifest gives it; on the S3 the addressable LED shows `rgb_r/g/b`
 *    (0..255) in their own colour, and white for `led` when the three are zero (LED_BUILTIN written as a plain pin);
 *  - TX and RX: a short flash each time the `tx` or `rx` byte counter grows.
 * These manifests declare no burn or overcurrent outputs.
 */
export function esp32Model(raw: unknown, board: Esp32Board): PartModel<PartState> {
  const m = raw as Esp32Manifest;
  const terminals = terminalsFromManifest(m);
  const rows = rowsOf(terminals);
  const own = ledPlace(m).colour;
  const rgb = board === 's3';
  // what the copy on the stand needs to place the light, worked out with the body (the same for every copy)
  const spot = { ax: 0, ay: 0, ar: 0, bx: 0, by: 0, br: 0 };
  const running: Record<string, number> = rgb ? { rgb_r: 0, rgb_g: 150, rgb_b: 130, led: 0 } : { led: 1 };
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
      const sp = b.spill;
      spot.ax = 0.5 + (sp.led.x - sp.x) / (2 * sp.half);
      spot.ay = 0.5 + (sp.led.z - sp.z) / (2 * sp.half);
      spot.ar = sp.reach / (2 * sp.half);
      spot.bx = 0.5 + (sp.pwr.x - sp.x) / (2 * sp.half);
      spot.by = 0.5 + (sp.pwr.z - sp.z) / (2 * sp.half);
      spot.br = 6 / (2 * sp.half);
      root.add(glowing('pwr', b.pwr), glowing('led', b.led), glowing('tx', b.tx), glowing('rx', b.rx), screen('spill', topQuad(sp.x, sp.z, TOP + 0.04, sp.half, sp.half), 6, { lit: false }));
      return root;
    },
    animate(st, obj, env) {
      const o = st.outputs, u = obj.userData;
      const on = st.power.on;
      const crashed = on && (o.crashed === true || st.crashed === true);
      // serial: the counters only ever grow while a sketch runs; a copy first seen with bytes already sent flashes once
      const tx = num(o.tx), rx = num(o.rx);
      if (u.espTx === undefined) u.espTx = u.espRx = u.espTxEnd = u.espRxEnd = 0;
      if (tx > u.espTx) u.espTxEnd = env.time + FLASH;
      if (rx > u.espRx) u.espRxEnd = env.time + FLASH;
      u.espTx = tx;
      u.espRx = rx;
      const txOn = on && env.time < u.espTxEnd, rxOn = on && env.time < u.espRxEnd;
      setLamp(obj, 'tx', AMBER, txOn ? 1.2 : 0);
      setLamp(obj, 'rx', AMBER, rxOn ? 1.2 : 0);
      // the board LED
      let colour = own, level = on ? Math.min(1, Math.max(0, num(o.led ?? st.visuals.led))) : 0;
      if (rgb) {
        const r = num(o.rgb_r), g = num(o.rgb_g), b = num(o.rgb_b), top = Math.max(r, g, b);
        colour = WHITE;
        if (on && top > 0) {
          // its hue at full strength, and the level apart (the eye is not linear: a value of 40 is far from dark)
          const k = 255 / top;
          colour = (Math.min(255, Math.round(r * k)) << 16) | (Math.min(255, Math.round(g * k)) << 8) | Math.min(255, Math.round(b * k));
          level = Math.sqrt(Math.min(1, top / 255));
        }
      }
      setLamp(obj, 'led', colour, level * 1.5);
      // the power LED: steady, or beating when the sketch has stopped
      const beat = crashed && (env.time * 2.5) % 1 < 0.6;
      setLamp(obj, 'pwr', RED, !on ? 0 : crashed ? (beat ? 2.6 : 0) : 1);
      lit.colour = colour;
      lit.level = level;
      lit.crash = beat ? 1 : 0;
      lit.ax = spot.ax;
      lit.ay = spot.ay;
      lit.ar = spot.ar;
      lit.bx = spot.bx;
      lit.by = spot.by;
      lit.br = spot.br;
      drawScreen(obj, 'spill', (colour * 32 + Math.round(level * 24)) * 2 + lit.crash, drawSpill);
      return crashed || txOn || rxOn;
    },
    states: {
      running: partState({ outputs: { ...running, tx: 0, rx: 0 }, visuals: { led: 1 } }),
      serial: partState({ outputs: { ...running, tx: 96, rx: 14 }, visuals: { led: 1 } }),
      ...(rgb ? { white: partState({ outputs: { led: 1 }, visuals: { led: 1 } }) } : { dim: partState({ outputs: { led: 0.25 }, visuals: { led: 0.25 } }) }),
      idle: partState({ outputs: { led: 0 }, visuals: { led: 0 } }),
      crashed: partState({ outputs: { led: 0, crashed: true }, visuals: { led: 0 }, crashed: true }),
      unpowered: partState({ power: { on: false, reason: 'no supply' }, outputs: { ...running }, visuals: { led: 1 } }),
    },
  });
}
