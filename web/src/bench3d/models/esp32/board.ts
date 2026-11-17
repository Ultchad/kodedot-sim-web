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
 * Both manifests' bodies are the bare boards (the DevKitC's plus 0.7 mm for the micro-USB socket's lip), so the
 * modules lie flush with the board end and the S3's USB-C sockets flush with the other.
 *
 * Nothing is on these models that is not on the boards. The DevKitC V4 has ONE LED, the red power LED: the
 * manifest's `led` output (GPIO2) has no LED on that board and is not shown. Neither board has serial LEDs or a
 * fault light, so `tx`, `rx` and `crashed` are not shown either. Print is functional only: pin and port names, the
 * board's and the module's designation and revision; where the real parts carry a maker's name or logo it is blank.
 */
import {
  FONT, FONT_MONO, INK, PAL, Shape, controlFromManifest, defineModel, footprintOf, fromManifestMm, glowing, halo, markControl, microUsb, part, partState, pcb, print, qfn,
  setLamp, silkBox, terminalsFromManifest, text, topQuad, usbC, type BuildCtx, type ControlManifest, type ManifestBody, type ManifestPin, type PartModel, type PartState,
  type PrintDef, type Terminal, type V3,
} from '../../index';
import { MLCC, RES, chip, ledChip, legRow, lensOf, radioModule, rgbLed, smdButton, smdPlunger, sod123, sot223, sot23, type RadioModuleOut } from './kit';

/** What the builder reads of a part's manifest.json. */
export interface Esp32Manifest {
  id: string;
  name: { en: string };
  body: ManifestBody;
  picture: { width: number };
  pins: ManifestPin[];
  visuals?: { id: string; x: number; y: number; color?: string }[];
  controls?: { field: string; mode: string }[];
}
export type Esp32Board = 'classic' | 's3';

const LEG = 6; // header legs below the housing: into a breadboard
const UNDER = 2.5; // the header housing the board rides on
const THICK = 1.6;
const TOP = UNDER + THICK;
const RED = 0xff3a2e, WHITE = 0xffffff;

type G = CanvasRenderingContext2D;
interface Spot {
  x: number;
  z: number;
}
/** A switch of the board: where its plunger is, and the names a manifest may give the field it drives. */
interface Switch extends Spot {
  name: string;
  fields: readonly string[];
}
interface Built {
  s: Shape;
  pwr: Shape;
  pwrAt: Spot;
  /** The board LED, on the boards that have one. */
  led?: Shape;
  ledAt?: Spot;
  switches: Switch[];
  prints: PrintDef[];
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
 * The marking of a module's shield, as the laser leaves it: dull grey on the metal, read with the antenna up (so
 * along the board's width here). The module's designation only: the maker's mark and the approval marks that share
 * the real shield are left out.
 */
function canMarking(mod: RadioModuleOut, name: string): PrintDef {
  return {
    name: 'can',
    quad: topQuad(mod.canX, mod.canZ, mod.canTop + 0.015, mod.canHalfLen, mod.canHalfWid),
    ppm: 22,
    draw(g) {
      // turn the drawing: its top looks at the antenna (-X), its lines run along Z
      g.rotate(-Math.PI / 2);
      g.fillStyle = 'rgba(52, 54, 60, 0.82)';
      text(g, name, 0, -mod.canHalfLen + 4.2, 1.3, { weight: 700, font: FONT });
    },
  };
}

// ------------------------------------------------------------------------------------------------------ boards
function buildClassic(ctx: BuildCtx, m: Esp32Manifest, rows: Row[], split: (sw: Switch) => boolean): Built {
  const { w_mm: w, d_mm: d } = m.body;
  const X = (mm: number) => mm - w / 2, Z = (mm: number) => mm - d / 2;
  const s = new Shape();
  // the manifest's body is the board itself: the micro-USB socket's lip takes the last 0.7 mm of it
  const left = -w / 2, right = w / 2 - 0.7;
  pcb(s, { w: right - left, d, x: (left + right) / 2, y: UNDER, thick: THICK, r: 1.2, finish: BOARD });
  for (const r of rows) legRow(s, points(r), { under: UNDER, top: TOP, plug: LEG, seg: ctx.seg(8) });
  const mod = radioModule(s, { x: -w / 2 + 0.15, z: 0, y: TOP, sidePads: 14, endPads: 10, teeth: 5 });

  // USB to UART bridge and its parts
  qfn(s, { x: X(36.2), z: Z(9.2), y: TOP, size: 5, perSide: 7 });
  chip(s, { x: X(28.4), z: Z(7), y: TOP });
  chip(s, { x: X(28.4), z: Z(9), y: TOP, body: MLCC });
  chip(s, { x: X(28.4), z: Z(11), y: TOP });
  chip(s, { x: X(31.4), z: Z(7.2), y: TOP, body: MLCC, turn: 1 });
  chip(s, { x: X(31.4), z: Z(10.6), y: TOP, body: MLCC, turn: 1 });
  chip(s, { x: X(44.4), z: Z(8.4), y: TOP });
  chip(s, { x: X(44.4), z: Z(10.4), y: TOP });
  // the two transistors of the auto-program circuit
  sot23(s, { x: X(41.4), z: Z(6.1), y: TOP, turn: 1 });
  sot23(s, { x: X(41.4), z: Z(10.5), y: TOP, turn: 1 });
  // 5 V to 3.3 V, its capacitors, the diode from the socket
  sot223(s, { x: X(32.2), z: Z(19.2), y: TOP });
  chip(s, { x: X(37.6), z: Z(17.9), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(37.6), z: Z(20.6), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(40.8), z: Z(19.3), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC, turn: 1 });
  sod123(s, { x: X(43.3), z: Z(13.97), y: TOP });
  chip(s, { x: X(27.6), z: Z(14.4), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(27.6), z: Z(18.6), y: TOP, turn: 1 });

  // BOOT by the row that carries IO0, EN by the row that carries EN, either side of the socket
  const switches: Switch[] = [
    { name: 'boot', fields: ['boot', 'BOOT'], x: X(50.5), z: Z(6.2) },
    { name: 'en', fields: ['en', 'EN', 'reset'], x: X(50.5), z: Z(21.74) },
  ];
  for (const sw of switches) smdButton(s, { x: sw.x, z: sw.z, y: TOP, seg: ctx.seg(10), noPlunger: split(sw) });
  // the one LED of this board: power
  const pwrAt = { x: X(46.2), z: Z(18.7) };
  const pwr = ledChip(s, { ...pwrAt, y: TOP, len: 1.8, wid: 1.0, lens: lensOf(RED) });
  chip(s, { x: X(43.4), z: Z(18.7), y: TOP });
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
        [X(35.6), Z(19.2), X(36.2), Z(19.2), X(36.2), Z(16.4), X(39.4), Z(16.4), X(40.2), Z(17.2)],
        [X(45.2), Z(13.97), X(48.4), Z(13.97)],
        [X(26.2), Z(16.6), X(27), Z(16.6), X(28), Z(16.6)],
        [X(26.2), Z(21), X(28.2), Z(21), X(28.8), Z(21.6), X(28.8), Z(22.6)],
      ]);
      g.fillStyle = INK.silk;
      for (const r of rows) for (const p of r.pins) pinLabel(g, p.label, p.x, r.z - Math.sign(r.z) * 2.2, 1.2);
      text(g, 'ESP32-DevKitC', X(33.6), Z(13.95), 1.45, { weight: 700, font: FONT, spacing: 0.03 });
      text(g, 'V4', X(40.1), Z(14), 1.05, mono);
      text(g, 'BOOT', X(47), Z(6.2), 0.95, { ...mono, align: 'right' });
      text(g, 'EN', X(47), Z(21.74), 1.05, { ...mono, align: 'right' });
      text(g, 'PWR', pwrAt.x, pwrAt.z - 1.6, 0.9, mono);
      corners(g, X(36.2), Z(9.2), 3.05);
      dot(g, X(32.9), Z(12.5));
      silkBox(g, X(32.2) - 3.6, Z(19.2) - 2.05, 7.2, 4.1, 0.2, 0.16);
      for (const sw of switches) silkBox(g, sw.x - 3.1, sw.z - 1.8, 6.2, 3.6, 0.3, 0.16);
      // the module's outline
      g.fillRect(X(26.15), Z(5.2), 0.14, 17.5);
    },
  };
  return { s, pwr, pwrAt, switches, prints: [silk, canMarking(mod, 'ESP32-WROOM-32E')] };
}

function buildS3(ctx: BuildCtx, m: Esp32Manifest, rows: Row[], split: (sw: Switch) => boolean): Built {
  const { w_mm: w, d_mm: d } = m.body;
  const X = (mm: number) => mm - w / 2, Z = (mm: number) => mm - d / 2;
  const s = new Shape();
  pcb(s, { w, d, y: UNDER, thick: THICK, r: 1.0, finish: BOARD });
  for (const r of rows) legRow(s, points(r), { under: UNDER, top: TOP, plug: LEG, seg: ctx.seg(8) });
  const mod = radioModule(s, { x: -w / 2 + 0.1, z: 0, y: TOP, sidePads: 14, endPads: 12, teeth: 6 });

  // 5 V to 3.3 V
  sot223(s, { x: X(31.4), z: Z(7), y: TOP });
  chip(s, { x: X(36.8), z: Z(5.4), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  chip(s, { x: X(36.8), z: Z(7.9), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC });
  // USB to UART bridge
  qfn(s, { x: X(38.6), z: Z(17.6), y: TOP, size: 5, perSide: 7 });
  chip(s, { x: X(34.4), z: Z(15.9), y: TOP });
  chip(s, { x: X(34.4), z: Z(17.6), y: TOP, body: MLCC });
  chip(s, { x: X(34.4), z: Z(19.3), y: TOP });
  chip(s, { x: X(28.9), z: Z(16.8), y: TOP });
  chip(s, { x: X(28.9), z: Z(19.2), y: TOP, body: MLCC });
  chip(s, { x: X(31.6), z: Z(18), y: TOP, len: 2.0, wid: 1.25, h: 0.85, body: MLCC, turn: 1 });
  chip(s, { x: X(42.8), z: Z(18.4), y: TOP, turn: 1, body: MLCC });
  chip(s, { x: X(45), z: Z(18.6), y: TOP, turn: 1 });
  // auto-program transistors and their resistors
  sot23(s, { x: X(40.6), z: Z(5.9), y: TOP });
  sot23(s, { x: X(44.4), z: Z(5.9), y: TOP });
  for (let i = 0; i < 3; i++) chip(s, { x: X(39.8 + i * 2.4), z: Z(8.9), y: TOP, body: i === 1 ? MLCC : RES });
  chip(s, { x: X(27.5), z: Z(14.2), y: TOP, turn: 1, body: MLCC });
  // protection between the sockets
  chip(s, { x: X(57.4), z: Z(12.7), y: TOP, len: 1.3, wid: 0.7, h: 0.45 });
  chip(s, { x: X(59.6), z: Z(12.7), y: TOP, len: 1.3, wid: 0.7, h: 0.45 });

  // BOOT, the RGB LED and RST stand in one line before the sockets (BOOT and the UART socket on the 3V3 row's side)
  const at = ledPlace(m);
  const switches: Switch[] = [
    { name: 'rst', fields: ['rst', 'RST', 'reset', 'en'], x: at.x, z: Z(5.6) },
    { name: 'boot', fields: ['boot', 'BOOT'], x: at.x, z: Z(19.8) },
  ];
  for (const sw of switches) smdButton(s, { x: sw.x, z: sw.z, y: TOP, seg: ctx.seg(10), noPlunger: split(sw) });
  const led = rgbLed(s, { x: at.x, z: at.z, y: TOP, seg: ctx.seg(14) });
  const pwrAt = { x: X(45), z: Z(15.4) };
  const pwr = ledChip(s, { ...pwrAt, y: TOP, len: 1.8, wid: 1.0, lens: lensOf(RED) });
  // side by side with 1.3 mm between them: the last pins' names stay readable beside the shells
  for (const side of [-1, 1]) usbC(s, { x: w / 2 - 0.1, z: side * 5.1, y: TOP, turn: 3 });

  const silk: PrintDef = {
    name: 'silk',
    quad: topQuad(0, 0, TOP + 0.02, w / 2, d / 2),
    ppm: 15,
    draw(g) {
      traces(g, [
        [X(26.2), Z(11.2), X(27.8), Z(11.2), X(29), Z(12.4), X(29), Z(14.6)],
        [X(26.2), Z(15.6), X(30.6), Z(15.6), X(31.4), Z(14.8), X(33), Z(14.8)],
        [X(26.2), Z(21), X(32.4), Z(21), X(33), Z(20.4)],
        [X(35), Z(7), X(35.4), Z(7), X(35.4), Z(10.2), X(37.8), Z(10.2), X(38.4), Z(10.8)],
        [X(41.2), Z(16.4), X(42), Z(16.4), X(42), Z(14.6), X(42.8), Z(13.8)],
        [X(41.2), Z(20.4), X(42), Z(21.2), X(46.2), Z(21.2)],
        [X(46), Z(5.9), X(46.4), Z(5.9)],
        [X(45.4), Z(8.9), X(45.8), Z(9.3), X(45.8), Z(10.6)],
        [X(53), Z(19.8), X(53.2), Z(19.8), X(53.2), Z(15.4)],
        [X(53), Z(5.6), X(53.2), Z(5.6), X(53.2), Z(10)],
      ]);
      g.fillStyle = INK.silk;
      for (const r of rows) for (const p of r.pins) pinLabel(g, p.label, p.x, r.z - Math.sign(r.z) * 1.52, 1.05);
      text(g, 'ESP32-S3-DevKitC-1', X(34.4), Z(12.5), 1.2, { weight: 700, font: FONT, spacing: 0.03 });
      text(g, 'v1.1', X(43), Z(12.55), 0.9, mono);
      text(g, 'RST', at.x, Z(8.5), 1.0, mono);
      text(g, 'BOOT', at.x, Z(16.9), 1.0, mono);
      text(g, 'RGB', at.x - 3.5, at.z - 0.3, 0.9, mono);
      text(g, 'USB', X(54.2), -5.1, 1.0, { ...mono, angle: -Math.PI / 2 });
      text(g, 'UART', X(54.2), 5.1, 1.0, { ...mono, angle: -Math.PI / 2 });
      text(g, '3V3', X(43.8), Z(15.4), 0.85, { ...mono, align: 'right' });
      corners(g, X(38.6), Z(17.6), 3.05);
      dot(g, X(35.3), Z(20.9));
      silkBox(g, X(31.4) - 3.6, Z(7) - 2.05, 7.2, 4.1, 0.2, 0.16);
      for (const sw of switches) silkBox(g, sw.x - 3.1, sw.z - 1.95, 6.2, 3.9, 0.3, 0.16);
      silkBox(g, at.x - 1.95, at.z - 1.95, 3.9, 3.9, 0.3, 0.16);
      g.fillRect(X(26.2), -d / 2 + 3.6, 0.14, d - 7.2);
    },
  };
  return { s, pwr, pwrAt, led, ledAt: at, switches, prints: [silk, canMarking(mod, 'ESP32-S3-WROOM-1')] };
}

// ------------------------------------------------------------------------------------------------------- model
const num = (v: unknown): number => (typeof v === 'number' ? v : v === true ? 1 : 0);
/** The solder mask of both boards: matte black. */
const BOARD = PAL.pcbBlack;
/** How far a plunger goes down when its switch is held. */
const TRAVEL = 0.3;

/**
 * The model of one ESP32 board manifest. Live state, from the part's entry of the bench state:
 *  - power LED (both boards): `power.on`;
 *  - the S3's addressable LED: `outputs.rgb_r/g/b` (0..255) in their own colour, and white at `outputs.led` (0..1,
 *    or the manifest's `led` visual with an older engine) when the three are zero: LED_BUILTIN written as a pin;
 *  - BOOT and EN/RST: when the manifest declares a control for the switch's field, its plunger is a control of the
 *    kit (`markControl`) and goes down while the field is held. Today's manifests declare none: the caps are static.
 * See the note at the top for what is not shown, and why.
 */
export function esp32Model(raw: unknown, board: Esp32Board): PartModel<PartState> {
  const m = raw as Esp32Manifest;
  const terminals = terminalsFromManifest(m);
  const rows = rowsOf(terminals);
  const rgb = board === 's3';
  // a switch is a control only if the manifest gives it a field to drive
  const fieldOf = (sw: Switch): string | undefined => sw.fields.find((f) => m.controls?.some((c) => c.field === f));
  const held: [string, string][] = [];
  return defineModel<PartState>({
    id: m.id,
    title: m.name.en,
    footprintMm: footprintOf(m.body),
    plugMm: LEG,
    terminals,
    build(ctx) {
      const b = (rgb ? buildS3 : buildClassic)(ctx, m, rows, (sw) => fieldOf(sw) !== undefined);
      const root = b.s.toObject();
      for (const p of b.prints) root.add(print(p));
      root.add(glowing('pwr', b.pwr), halo('pwr-glow', [b.pwrAt.x, TOP + 0.04, b.pwrAt.z], 3.4));
      if (b.led && b.ledAt) root.add(glowing('led', b.led), halo('led-glow', [b.ledAt.x, TOP + 0.04, b.ledAt.z], 7.5));
      held.length = 0;
      for (const sw of b.switches) {
        const field = fieldOf(sw);
        if (!field) continue;
        const cap = new Shape();
        smdPlunger(cap, { x: sw.x, z: sw.z, y: TOP, seg: ctx.seg(10) });
        root.add(markControl(cap.toObject(sw.name), controlFromManifest(m as ControlManifest, field)));
        held.push([sw.name, field]);
      }
      return root;
    },
    animate(st, obj) {
      const on = st.power.on;
      setLamp(obj, 'pwr', RED, on ? 1 : 0);
      setLamp(obj, 'pwr-glow', RED, on ? 0.45 : 0);
      for (let i = 0; i < held.length; i++) {
        const cap = part(obj, held[i][0]);
        if (cap) cap.position.y = st.fields[held[i][1]] === true ? -TRAVEL : 0;
      }
      if (!rgb) return;
      const o = st.outputs;
      let colour = WHITE, level = on ? Math.min(1, Math.max(0, num(o.led ?? st.visuals.led))) : 0;
      const r = num(o.rgb_r), g = num(o.rgb_g), b = num(o.rgb_b), top = Math.max(r, g, b);
      if (on && top > 0) {
        // its hue at full strength, and the level apart (the eye is not linear: a value of 40 is far from dark)
        const k = 255 / top;
        colour = (Math.min(255, Math.round(r * k)) << 16) | (Math.min(255, Math.round(g * k)) << 8) | Math.min(255, Math.round(b * k));
        level = Math.sqrt(Math.min(1, top / 255));
      }
      setLamp(obj, 'led', colour, level * 1.5);
      setLamp(obj, 'led-glow', colour, level);
    },
    states: rgb
      ? {
          teal: partState({ outputs: { rgb_r: 0, rgb_g: 150, rgb_b: 130, led: 0 }, visuals: { led: 1 } }),
          red: partState({ outputs: { rgb_r: 255, rgb_g: 20, rgb_b: 0, led: 0 }, visuals: { led: 1 } }),
          dim: partState({ outputs: { rgb_r: 10, rgb_g: 10, rgb_b: 40, led: 0 }, visuals: { led: 1 } }),
          white: partState({ outputs: { rgb_r: 0, rgb_g: 0, rgb_b: 0, led: 1 }, visuals: { led: 1 } }),
          idle: partState({ outputs: { led: 0 }, visuals: { led: 0 } }),
          unpowered: partState({ power: { on: false, reason: 'no supply' }, outputs: { rgb_r: 0, rgb_g: 150, rgb_b: 130 }, visuals: { led: 1 } }),
        }
      : {
          powered: partState({ outputs: { led: 1 }, visuals: { led: 1 } }),
          unpowered: partState({ power: { on: false, reason: 'no supply' }, outputs: { led: 1 }, visuals: { led: 1 } }),
        },
  });
}
