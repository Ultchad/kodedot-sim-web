/**
 * What the three Arduino Uno boards share: the Uno outline and its four holes, the socket strips built where the
 * part's manifest puts the pins, the silkscreen pin labels, the indicator LEDs and their live state, and a few
 * builders the kit does not have (socketed DIP, HC-49 crystal, SMD electrolytic, SOT packages, a lean QFP, JST-SH,
 * 1.27 mm header, chip passives).
 *
 * Everything here works in "board millimetres": the manifest's frame (x to the right, y down the picture = towards
 * the viewer) with its origin moved to the top-left corner of the BOARD, which lies `geo.x0` to the right of the
 * manifest's body (the body leaves room for the connectors that overhang the left edge). `geo.frame` moves that frame
 * onto the model's, so a model builds its whole body inside `s.with(geo.frame, ...)` and draws its silkscreen after
 * `g.translate(-W / 2, -D / 2)` on a quad the size of the board: one set of numbers for the body and the print.
 *
 * Dimensions: the Uno R3 mechanical drawing (outline 2.7 x 2.1 in with the 0.1 in step and chamfers on the right,
 * holes of 3.2 mm at (0.55, 0.1), (0.6, 2.0), (2.6, 0.3), (2.6, 1.4) in from the lower left corner; USB-B overhangs
 * the left edge by 0.25 in, the barrel jack by 0.075 in), and the usual package drawings (DIP-28 narrow, HC-49S, SOT-223, SOT-23, LQFP-64, JST SM04B-SRSS).
 */
import type { MeshStandardMaterial } from 'three';
import {
  FONT_MONO, INK, Matrix4, PAL, PITCH, circleLoop, drawScreen, lamp, part, pinHeader, place, roundedRectLoop, screen, setLamp, text, topQuad,
  type AnimEnv, type Finish, type ManifestBody, type ManifestPin, type Object3D, type PartState, type Pt, type Quad, type Shape, type V3,
} from '../../index';

// ------------------------------------------------------------------------------------------------- the manifest
export interface UnoPin extends ManifestPin {
  kind?: string;
  caps?: string[];
}
/** What the models read of a board manifest (parts/uno-r3, uno-r4-minima, uno-r4-wifi). */
export interface UnoManifest {
  id: string;
  name: Record<string, string>;
  body: ManifestBody;
  pins: UnoPin[];
  picture: { width: number };
  visuals?: { id: string; x: number; y: number }[];
}

/** Width of the Uno board itself (2.7 in): the manifest's body is wider by the room it leaves for the connectors that overhang the left edge. */
export const PCB_W = 68.58;
/** Underside of the board: its through-hole pins poke out below, it rests on them. */
export const BOARD_Y = 1.3;
export const THICK = 1.6;
/** Top face of the board. */
export const TOP = BOARD_Y + THICK;

export interface HeaderRow {
  pins: UnoPin[];
  /** Board millimetres: the row's y, the x of its first and last pin, and the height of the socket mouths (the pins' `mm.z`). */
  y: number;
  x0: number;
  x1: number;
  mouth: number;
}
export interface UnoGeo {
  /** The board: `W` x `D` millimetres, its left edge `x0` from the left of the manifest's body. */
  W: number;
  D: number;
  x0: number;
  /** The socket strips, straight from the manifest's pins: one per run of pins 2.54 mm apart. */
  rows: HeaderRow[];
  outline: Pt[];
  /** Centres of the four mounting holes. */
  holes: Pt[];
  /** Where the manifest's picture shows the pin 13 LED. */
  led: Pt;
  /** Board millimetres -> model frame. */
  frame: Matrix4;
  /** A manifest pin's x in board millimetres. */
  pinX(name: string): number;
  /** The board's right edge at a given y. */
  edgeX(y: number): number;
  /** A point given in board millimetres and a height, in the model frame (for lamps, screens and quads). */
  at(x: number, y: number, h: number): V3;
  /** A print or screen quad lying at height `h`, centred on a point given in board millimetres. */
  quad(x: number, y: number, h: number, hw: number, hd: number): Quad;
}

export function unoGeo(m: UnoManifest): UnoGeo {
  const W = PCB_W, D = m.body.d_mm, x0 = m.body.w_mm - PCB_W;
  const tops = m.pins.filter((p) => p.mm && (p.face ?? 'top') === 'top').sort((a, b) => a.mm!.y - b.mm!.y || a.mm!.x - b.mm!.x);
  const rows: HeaderRow[] = [];
  for (const p of tops) {
    const r = rows[rows.length - 1], x = p.mm!.x - x0;
    if (r && Math.abs(r.y - p.mm!.y) < 0.01 && x - r.x1 < PITCH * 1.05) {
      r.pins.push(p);
      r.x1 = x;
    } else rows.push({ pins: [p], y: p.mm!.y, x0: x, x1: x, mouth: p.mm!.z ?? m.body.h_mm });
  }
  // The outline of the drawing: the right edge steps in by 0.1 in above and below the middle part, with 45 degree
  // chamfers (y is measured down from the digital row's edge here; the drawing measures up from the other one).
  const step = W - PITCH, cham = 0.06 * 25.4;
  const outline: Pt[] = [[0, 0], [step - cham, 0], [step, cham], [step, 12.954], [W, 15.494], [W, D - 5.08], [step, D - PITCH], [step, D], [0, D]];
  const led = m.visuals?.find((v) => v.id === 'led');
  const k = m.picture.width / m.body.w_mm;
  const bx = x0 - m.body.w_mm / 2;
  return {
    W, D, x0, rows, outline,
    holes: [[13.97, D - 2.54], [15.24, 2.54], [step, 17.78], [step, D - 7.62]],
    led: led ? [led.x / k - x0, led.y / k] : [30.96, 8],
    frame: new Matrix4().makeTranslation(bx, 0, -D / 2),
    pinX: (name) => (m.pins.find((p) => p.name === name)?.mm?.x ?? 0) - x0,
    edgeX: (y) => (y > D - PITCH ? step : y > D - 5.08 ? W - (y - (D - 5.08)) : y < 12.954 ? step : y < 15.494 ? step + (y - 12.954) : W),
    at: (x, y, h) => [x + bx, h, y - D / 2],
    quad: (x, y, h, hw, hd) => topQuad(x + bx, y - D / 2, h, hw, hd),
  };
}

// ------------------------------------------------------------------------------------------- board and sockets
/** The board with its holes, and the socket strips built where the manifest's pins are: place, count and mouth height. Call inside `s.with(geo.frame, ...)`. */
export function unoBoard(s: Shape, g: UnoGeo, finish: Finish, seg: (n: number) => number): void {
  s.prism(finish[0], finish[1], g.outline, BOARD_Y, TOP, 0.12, { cap: true, ao: 0.9, holes: g.holes.map(([x, z]) => circleLoop(x, z, 1.6, seg(16))) });
  for (const r of g.rows) pinHeader(s, { x: (r.x0 + r.x1) / 2, z: r.y, y: TOP, n: r.pins.length, female: true, length: r.mouth - TOP });
}

/** What the silkscreen says beside a pin: the manifest's label, "~" on PWM pins, TX and RX on the serial pair. */
export function pinLabel(p: UnoPin): string {
  let l = (p.label?.en ?? p.name).replace(/\s*\(.*\)$/, '');
  if (p.caps?.includes('pwm')) l = `~${l}`;
  if (p.caps?.includes('uart_tx')) l = `TX>${l}`;
  if (p.caps?.includes('uart_rx')) l = `RX<${l}`;
  return l;
}
/** The pin labels beside every socket strip, reading across the row as on the real boards. Canvas in board millimetres. */
export function drawPinLabels(c: CanvasRenderingContext2D, g: UnoGeo, size = 1.4): void {
  c.fillStyle = INK.silk;
  for (const r of g.rows) {
    const back = r.y < g.D / 2;
    for (const p of r.pins) text(c, pinLabel(p), p.mm!.x - g.x0, back ? r.y + 1.82 : r.y - 1.82, size, { weight: 700, font: FONT_MONO, angle: -Math.PI / 2, align: back ? 'right' : 'left' });
  }
}
/** A caption over a group of pins: a rule with end ticks and the words. `side` 1 = below the rule (towards +y). */
export function drawCaption(c: CanvasRenderingContext2D, words: string, x0: number, x1: number, y: number, side: 1 | -1, size = 1.25): void {
  c.strokeStyle = INK.silk;
  c.fillStyle = INK.silk;
  c.lineWidth = 0.18;
  c.lineCap = 'butt';
  c.beginPath();
  c.moveTo(x0, y - side * 0.5);
  c.lineTo(x0, y);
  c.lineTo(x1, y);
  c.lineTo(x1, y - side * 0.5);
  c.stroke();
  text(c, words, (x0 + x1) / 2, y + side * 1.05, size, { weight: 700, spacing: 0.12 });
}
/** The rows on one side of the board: the back (digital) or the front (power and analog). */
export const rowsOf = (g: UnoGeo, back: boolean): HeaderRow[] => g.rows.filter((r) => r.y < g.D / 2 === back);

// --------------------------------------------------------------------------------------------- copper under the mask
/** A track under the solder mask: a lighter line with 45 degree bends. */
export function track(c: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], w = 0.28): void {
  c.strokeStyle = 'rgba(255,255,255,0.085)';
  c.lineWidth = w;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.stroke();
}
export function vias(c: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  for (const [x, y] of pts) {
    c.fillStyle = 'rgba(255,255,255,0.13)';
    c.beginPath();
    c.arc(x, y, 0.42, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.arc(x, y, 0.17, 0, Math.PI * 2);
    c.fill();
  }
}
/** Tinned pads (footprints left empty, test points, the lands of a part). */
export function pads(c: CanvasRenderingContext2D, list: readonly (readonly [number, number, number, number])[], colour = '#c3c6cb'): void {
  c.fillStyle = colour;
  for (const [x, y, w, h] of list) {
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.22);
    c.fill();
  }
}
/** The solder joints of a row of through-hole pins seen from above: a tinned ring round each. */
export function joints(c: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], r = 0.85): void {
  c.fillStyle = '#b9bcc2';
  for (const [x, y] of pts) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
}

// ------------------------------------------------------------------------------------------------- small builders
const rect = (cx: number, cz: number, w: number, d: number): Pt[] => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
/** A plain block of 10 triangles (leads, pads, tiny bodies): for the many small things a board carries. */
export function slab(s: Shape, f: Finish, cx: number, cz: number, w: number, d: number, y0: number, y1: number, ao = 1): void {
  s.prism(f[0], f[1], rect(cx, cz, w, d), y0, y1, 0, { ao });
}
/** Turns a prism so that what was its top looks at +Z (as the kit's connectors do). */
const FRONT = new Matrix4().makeRotationX(Math.PI / 2);

/** The boards' solder mask: the R3's teal, the R4s' deeper one. */
export const TEAL_R3: Finish = ['pcb', '#08a2a6'];
export const TEAL_R4: Finish = ['pcb', '#06919a'];
export const TAN: Finish = ['matte', '#b08d5e']; // MLCC
export const RES: Finish = ['matte', '#1f1f22']; // thick film resistor
const SOCKET: Finish = ['matte', '#19191b'];
const LEG: Finish = ['metal', '#a4a7ad'];
const SHELL_MARK: Finish = ['metal', '#8b8e95'];
const CREAM: Finish = ['matte', '#e6dfcc'];

/** A two-terminal chip part (0603 by default) lying along X before `turn`: body and two tinned ends. */
export function chip(s: Shape, x: number, z: number, turn = 0, o: { l?: number; w?: number; h?: number; body?: Finish } = {}): void {
  const l = o.l ?? 1.6, w = o.w ?? 0.8, h = o.h ?? 0.5;
  const end = Math.min(0.45, l * 0.24);
  s.with(place(x, TOP, z, turn), () => {
    slab(s, o.body ?? TAN, 0, 0, l - end * 1.6, w, 0.02, h);
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * (l / 2 - end / 2), 0, end, w + 0.04, 0, h + 0.02);
  });
}
/** A resistor network (four in one black body with eight tinned ends). */
export function resistorArray(s: Shape, x: number, z: number, turn = 0): void {
  s.with(place(x, TOP, z, turn), () => {
    slab(s, RES, 0, 0, 3.2, 1.3, 0.02, 0.55);
    for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) slab(s, PAL.tin, (i - 1.5) * 0.8, sz * 0.7, 0.45, 0.45, 0, 0.57);
  });
}

/**
 * A DIP chip in its socket, rows along X, pin 1 end towards +X (as the ATmega328P sits on an Uno R3). Returns the
 * height of the chip's top above the board (for the marking print).
 */
export function dipSocketed(s: Shape, o: { x: number; z: number; pins: number }): number {
  const n = o.pins / 2, len = n * PITCH, row = 3.81;
  const y0 = 4.6, y1 = 7.9;
  s.with(place(o.x, TOP, o.z), () => {
    // the socket: two rails with the contacts, three bars between them
    for (const sz of [-1, 1]) s.box(...SOCKET, 0, sz * row, len + 0.5, 2.6, 0, 4.1, 0.35, 0.25, { ao: 0.85 });
    for (const bx of [-len / 2 + 0.75, 0, len / 2 - 0.75]) s.box(...SOCKET, bx, 0, 1.5, 5.2, 0, 2.7, 0.2, 0.2, { ao: 0.9 });
    // the chip
    s.box(...PAL.epoxyBlack, 0, 0, len - 0.4, 6.9, y0, y1, 0.3, 0.4, { cap: true, ao: 0.95 });
    for (const sz of [-1, 1]) for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * PITCH;
      slab(s, LEG, px, sz * 3.72, 1.25, 0.75, y0 + 1.25, y0 + 1.55); // shoulder out of the body
      slab(s, LEG, px, sz * 3.95, 1.25, 0.3, 3.9, y0 + 1.5, 0.85); // blade down into the contact
    }
  });
  return y1;
}

/** An HC-49S crystal lying along X before `turn`. */
export function crystalHC49(s: Shape, x: number, z: number, turn: number, seg: (n: number) => number): void {
  s.with(place(x, TOP, z, turn), () => {
    s.prism(...PAL.tin, roundedRectLoop(0, 0, 11.4, 4.9, 2.45, seg(6)), 0, 0.5, 0.12, { ao: 0.9 });
    s.prism(...PAL.steel, roundedRectLoop(0, 0, 10.5, 4.0, 2.0, seg(6)), 0.5, 3.6, 0.5, { ao: 0.92 });
  });
}

/** An SMD aluminium electrolytic: the can on its black base, the black mark of the negative side towards -X before `turn`. */
export function smdCan(s: Shape, x: number, z: number, turn: number, seg: (n: number) => number, o: { d?: number; h?: number } = {}): void {
  const d = o.d ?? 5, r = d / 2, h = o.h ?? 5.6, hb = d / 2 + 0.2, c = 1.0;
  s.with(place(x, TOP, z, turn), () => {
    // the base: a square with the two corners of the positive side cut
    s.prism(...PAL.plasticBlack, [[-hb, -hb], [hb - c, -hb], [hb, -hb + c], [hb, hb - c], [hb - c, hb], [-hb, hb]], 0, 0.9, 0.12, { ao: 0.9 });
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * (hb + 0.3), 0, 0.9, 1.0, 0, 0.3);
    s.lathe(...PAL.aluminium, 0, 0, [[r, 0.9], [r, 1.5], [r - 0.16, 1.75], [r, 2.0], [r, h - 0.4], [r - 0.4, h]], seg(20));
    s.disc(...PAL.aluminium, 0, 0, r - 0.4, h - 0.15, h, 0, seg(20), { ao: 1 });
    const mark: Pt[] = [];
    const n = seg(8);
    for (let i = 0; i <= n; i++) {
      const a = Math.PI - 1.0 + (2.0 * i) / n;
      mark.push([(r - 0.45) * Math.cos(a), (r - 0.45) * Math.sin(a)]);
    }
    s.prism('matte', '#161618', mark, h, h + 0.02, 0, { ao: 1 });
  });
}

/** SOT-223 regulator: tab towards -Z, three leads towards +Z before `turn`. */
export function sot223(s: Shape, x: number, z: number, turn = 0): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, 6.5, 3.5, 0.08, 1.7, 0.25, 0.3, { ao: 0.95 });
    slab(s, PAL.tin, 0, -2.55, 3.0, 1.9, 0, 0.8, 0.9);
    for (const i of [-1, 0, 1]) slab(s, PAL.tin, i * 2.3, 2.55, 0.75, 1.9, 0, 0.8, 0.9);
  });
}
/** SOT-23 (3 leads) or SOT-23-5. */
export function sot23(s: Shape, x: number, z: number, turn = 0, five = false): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, 2.9, 1.5, 0.06, 1.1, 0.15, 0.2, { ao: 0.95 });
    for (const px of five ? [-0.95, 0, 0.95] : [-0.95, 0.95]) slab(s, PAL.tin, px, 1.15, 0.42, 0.9, 0, 0.5, 0.9);
    for (const px of five ? [-0.95, 0.95] : [0]) slab(s, PAL.tin, px, -1.15, 0.42, 0.9, 0, 0.5, 0.9);
  });
}
/** A small-outline chip with leads on two sides (SOIC, MSOP, TSSOP), rows along X before `turn`: 10 triangles a lead. */
export function so(s: Shape, x: number, z: number, turn: number, o: { pins: number; pitch?: number; bodyW?: number; h?: number }): void {
  const n = o.pins / 2, pitch = o.pitch ?? 0.65, bw = o.bodyW ?? 3, h = o.h ?? 1.0;
  const len = n * pitch + 0.4;
  s.with(place(x, TOP, z, turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, len, bw, 0.06, h, 0.15, 0.2, { ao: 0.95 });
    s.disc('matte', '#3a3a3f', -len / 2 + 0.55, bw / 2 - 0.55, 0.25, h, h + 0.02, 0, 8, { ao: 1 });
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) slab(s, PAL.tin, (i - (n - 1) / 2) * pitch, side * (bw / 2 + 0.45), pitch * 0.5, 0.95, 0, 0.5, 0.9);
  });
}
/** A quad flat pack at any angle, its leads as plain blocks: an LQFP-64 costs 700 triangles instead of 2,500. */
export function qfpLean(s: Shape, o: { x: number; z: number; size: number; perSide: number; pitch?: number; h?: number; angle?: number }): number {
  const pitch = o.pitch ?? 0.5, h = o.h ?? 1.5;
  s.with(new Matrix4().makeTranslation(o.x, TOP, o.z).multiply(new Matrix4().makeRotationY(o.angle ?? 0)), () => {
    s.box(...PAL.epoxyBlack, 0, 0, o.size, o.size, 0.1, h, 0.45, 0.3, { cap: true, ao: 0.95 });
    s.disc('matte', '#37373c', -o.size / 2 + 1.2, o.size / 2 - 1.2, 0.45, h, h + 0.02, 0, 10, { ao: 1 });
    for (let q = 0; q < 4; q++) {
      s.with(new Matrix4().makeRotationY((q * Math.PI) / 2), () => {
        for (let i = 0; i < o.perSide; i++) slab(s, PAL.tin, (i - (o.perSide - 1) / 2) * pitch, o.size / 2 + 0.48, pitch * 0.46, 1.0, 0, 0.55, 0.9);
      });
    }
  });
  return h;
}
/** A shielded power inductor. */
export function inductor(s: Shape, x: number, z: number, size = 4, h = 2.1): void {
  s.with(place(x, TOP, z), () => {
    s.box('matte', '#2b2b2f', 0, 0, size, size, 0.05, h, 0.7, 0.35, { ao: 0.92 });
    s.box('matte', '#3d3d42', 0, 0, size - 1.3, size - 1.3, h, h + 0.02, 0.9, 0, { ao: 1 }); // the ferrite cap seen through the moulding
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * (size / 2 - 0.1), 0, 0.6, size * 0.6, 0, 0.5);
  });
}
/**
 * A DC barrel jack as it stands on these boards (9 x 11 mm face, 14.2 deep, 5.5 mm barrel): a front flange, and behind
 * it the round barrel housing on a lower block. (x, z) is the middle of its mouth, which faces +Z before `turn`.
 */
export function dcJack(s: Shape, x: number, z: number, turn: number, seg: (n: number) => number): void {
  const m = place(x, TOP, z, turn);
  s.with(m, () => {
    s.box(...PAL.plasticBlack, 0, -8.85, 9, 10.7, 0, 6.4, 0.5, 0.4, { ao: 0.88 });
    s.rod(...PAL.plasticBlack, [0, 6.2, -14.0], [0, 6.2, -3.2], 4.35, seg(18));
    s.box(...PAL.plasticBlack, 0, -1.75, 9, 3.5, 0, 11, 0.6, 0.5, { ao: 0.88 });
    slab(s, PAL.tin, 0, -14.25, 3.0, 0.25, 0, 3.6, 0.9); // the rear lug
  });
  s.with(m.clone().multiply(new Matrix4().makeTranslation(0, 6.2, 0)).multiply(FRONT), () => {
    s.prism('matte', '#070708', circleLoop(0, 0, 3.15, seg(20)), 0, 0.03, 0, { ao: 1 });
    s.prism(...PAL.tin, circleLoop(0, 0, 1.0, seg(12)), 0.03, 0.06, 0, { ao: 1 });
  });
}
/** What is stamped into the top of a USB-B shell (the kit's `usbB`, same place and turn): the seam and two spring tabs. */
export function usbBShellMarks(s: Shape, x: number, z: number, turn: number): void {
  s.with(place(x, TOP, z, turn), () => {
    slab(s, SHELL_MARK, 0, -8.6, 0.16, 14.2, 11, 11.02);
    for (const sx of [-1, 1]) {
      slab(s, SHELL_MARK, sx * 3.1, -4.4, 1.7, 3.4, 11, 11.02);
      slab(s, PAL.tin, sx * 3.1, -4.75, 1.2, 2.5, 11.02, 11.04);
    }
    slab(s, SHELL_MARK, 0, -15.2, 10.6, 0.16, 11, 11.02);
  });
}
/** JST-SH four-way side-entry socket (the I2C "Qwiic" port): (x, z) is the middle of its mouth, which faces +Z before `turn`. */
export function jstSh4(s: Shape, x: number, z: number, turn: number): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...CREAM, 0, -2.13, 6.0, 4.25, 0, 2.95, 0.3, 0.25, { ao: 0.9 });
    s.with(new Matrix4().makeTranslation(0, 1.55, 0).multiply(FRONT), () => {
      s.prism('matte', '#0c0c0d', roundedRectLoop(0, 0, 4.7, 1.6, 0.2, 2), 0, 0.03, 0, { ao: 1 });
      for (let i = 0; i < 4; i++) s.prism(...PAL.gold, rect((i - 1.5) * 1.0, 0.15, 0.3, 0.9), 0.03, 0.05, 0, { ao: 1 });
    });
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * 3.35, -2.9, 0.8, 1.9, 0, 1.0, 0.9);
  });
}
/** A 1.27 mm 2 x n pin header (the SWD port), row along X before `turn`. */
export function miniHeader(s: Shape, x: number, z: number, turn: number, n = 5): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...PAL.plasticBlack, 0, 0, n * 1.27 + 0.2, 2.9, 0, 1.5, 0.2, 0.2, { ao: 0.9 });
    for (const r of [-0.635, 0.635]) for (let i = 0; i < n; i++) slab(s, PAL.gold, (i - (n - 1) / 2) * 1.27, r, 0.4, 0.4, 1.5, 4.3);
  });
}

// ------------------------------------------------------------------------------------------------ indicator LEDs
export interface UnoLeds {
  on: Pt;
  l: Pt;
  tx: Pt;
  rx: Pt;
  /** 0: the LEDs lie along X; 1: along the board's depth. */
  turn?: number;
}
/** The white bodies of the four chip LEDs (static). */
export function ledBodies(s: Shape, leds: UnoLeds): void {
  for (const p of [leds.on, leds.l, leds.tx, leds.rx]) chip(s, p[0], p[1], leds.turn ?? 0, { l: 2.0, w: 1.25, h: 0.55, body: ['matte', '#e9e4d6'] });
}
/** Their lenses and the light they throw, to add under the model's root: lamps `on`, `l`, `tx`, `rx` and the two glow screens. */
export function ledLamps(g: UnoGeo, leds: UnoLeds): Object3D[] {
  const size: V3 = leds.turn ? [0.56, 0.45, 0.8] : [0.8, 0.45, 0.56];
  return [...(['on', 'l', 'tx', 'rx'] as const).map((k) => lamp(k, g.at(leds[k][0], leds[k][1], TOP + 0.5), size)), ...ledGlows(g, leds)];
}

const GREEN = 0x35e06a, AMBER = 0xffa51f, YELLOW = 0xffd033;
const level = (v: unknown): number => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : v ? 1 : 0);

/** Makes a `screen(..., { lit: false })` shine in one colour wherever it is drawn: light that sits on a surface (an LED matrix, the glow round a lit LED). */
export function makeGlow(mesh: Object3D, colour: number, intensity = 1.6): void {
  const m = (mesh as unknown as { material: MeshStandardMaterial }).material;
  m.emissive.setHex(colour);
  m.emissiveIntensity = intensity;
  // its own light only: the room's light on the drawing would wash the colour out
  m.roughness = 1;
  m.envMapIntensity = 0.12;
}

const HALO = 2.6, GLARE = 9, GLOW_PPM = 10;
const ACT = 0xffb02a, FAULT = 0xff3814;
interface GlowSpec {
  /** Canvas pixels of each LED in the screen, in the order the levels are handed over. */
  px: number[];
}
/**
 * The light a lit LED throws on the board round it, so the state reads from across the table: two screens to add
 * under the root, `glow:on` (green, the ON LED) and `glow:act` (amber: L, TX, RX). A level above 1 is a glare.
 */
export function ledGlows(g: UnoGeo, leds: UnoLeds): Object3D[] {
  const make = (name: string, pts: Pt[], colour: number, margin: number): Object3D => {
    // the light falls on the board: the screen stops at its edges
    const x0 = Math.max(0, Math.min(...pts.map((p) => p[0])) - margin), x1 = Math.min(g.W - PITCH, Math.max(...pts.map((p) => p[0])) + margin);
    const y0 = Math.max(0, Math.min(...pts.map((p) => p[1])) - margin), y1 = Math.min(g.D, Math.max(...pts.map((p) => p[1])) + margin);
    const m = screen(name, g.quad((x0 + x1) / 2, (y0 + y1) / 2, TOP + 0.04, (x1 - x0) / 2, (y1 - y0) / 2), GLOW_PPM, { lit: false });
    makeGlow(m, colour, 1.25);
    const spec: GlowSpec = { px: pts.flatMap((p) => [(p[0] - x0) * GLOW_PPM, (p[1] - y0) * GLOW_PPM]) };
    m.userData.glow = spec;
    return m;
  };
  return [make('glow:on', [leds.on], GREEN, HALO), make('glow:act', [leds.l, leds.tx, leds.rx], ACT, GLARE)];
}
// what is being drawn (handed over here: no closure in `animate`)
let glowSpec: GlowSpec | undefined;
const glowLevel = [0, 0, 0];
function drawGlow(c: CanvasRenderingContext2D): void {
  if (!glowSpec) return;
  for (let i = 0; i < glowSpec.px.length / 2; i++) {
    const l = glowLevel[i];
    if (l <= 0) continue;
    const r = l > 1 ? (GLARE * l) / 2.6 : HALO;
    c.globalAlpha = Math.min(1, l);
    // a glare is laid on twice: denser, not whiter
    for (let ring = 0; ring < (l > 1 ? 8 : 4); ring++) {
      c.fillStyle = ring % 4 === 0 ? 'rgba(255,255,255,0.09)' : ring % 4 === 1 ? 'rgba(255,255,255,0.13)' : ring % 4 === 2 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.32)';
      c.beginPath();
      c.arc(glowSpec.px[i * 2], glowSpec.px[i * 2 + 1], r * (1 - (ring % 4) * 0.21) * GLOW_PPM, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}
function setGlow(obj: Object3D, name: string, a: number, b = 0, c = 0): void {
  glowSpec = part(obj, name)?.userData.glow as GlowSpec | undefined;
  glowLevel[0] = a;
  glowLevel[1] = b;
  glowLevel[2] = c;
  drawScreen(obj, name, Math.round(a * 15) + 64 * Math.round(b * 15) + 4096 * Math.round(c * 15), drawGlow);
}

/** How long TX or RX stays lit after its byte counter moved. */
const FLASH = 0.12;
const count = (v: unknown): number => (typeof v === 'number' && v === v ? v : 0);
interface Seen {
  unoTx?: number;
  unoRx?: number;
  unoTxUntil?: number;
  unoRxUntil?: number;
  unoFault?: boolean;
}
/**
 * The live state of a board on its four LEDs, from the outputs the boards publish. ON follows `power.on`. L follows
 * `outputs.led` (pin 13: its level, or its PWM duty). TX and RX light for a moment whenever `outputs.tx` /
 * `outputs.rx` (counters of serial bytes) have moved. A crashed sketch (`outputs.crashed`, or the part's `crashed`)
 * is the hazard: TX and RX dark and L glaring red, unsteady, in a pool of red light on the board that reads from
 * across the table.
 * Returns true while it needs frames.
 */
export function animateUno(st: PartState, obj: Object3D, env: AnimEnv): boolean {
  const on = st.power.on;
  const seen = obj.userData as Seen;
  const txN = count(st.outputs.tx), rxN = count(st.outputs.rx);
  if (seen.unoTx !== txN) {
    if (seen.unoTx !== undefined && on) seen.unoTxUntil = env.time + FLASH;
    seen.unoTx = txN;
  }
  if (seen.unoRx !== rxN) {
    if (seen.unoRx !== undefined && on) seen.unoRxUntil = env.time + FLASH;
    seen.unoRx = rxN;
  }
  let l = 0, tx = 0, rx = 0, again = false;
  const fault = on && (st.crashed === true || st.outputs.crashed === true);
  if (seen.unoFault !== fault) {
    seen.unoFault = fault;
    const m = (part(obj, 'glow:act') as unknown as { material?: MeshStandardMaterial } | undefined)?.material; // this copy's own
    if (m) {
      m.emissive.setHex(fault ? FAULT : ACT);
      m.emissiveIntensity = fault ? 1.5 : 1.25;
    }
  }
  if (fault) {
    l = Math.floor(env.time * 9) % 2 === 0 ? 2.6 : 2.0;
    again = true;
  } else if (on) {
    const v = st.outputs.led, pin = st.pins.D13;
    l = typeof v === 'number' ? level(v) : typeof st.visuals.led === 'number' ? level(st.visuals.led) : pin && !pin.floating ? level(pin.level) : 0;
    tx = env.time < (seen.unoTxUntil ?? -1) ? 1 : 0;
    rx = env.time < (seen.unoRxUntil ?? -1) ? 1 : 0;
    again = tx + rx > 0;
  }
  setLamp(obj, 'on', GREEN, on ? 1.4 : 0);
  setLamp(obj, 'l', fault ? FAULT : AMBER, l * 1.4);
  setLamp(obj, 'tx', YELLOW, tx * 1.4);
  setLamp(obj, 'rx', YELLOW, rx * 1.4);
  setGlow(obj, 'glow:on', on ? 1 : 0);
  setGlow(obj, 'glow:act', l, tx, rx);
  return again;
}

/**
 * Example outputs of a board with serial traffic, for a model's `states`: the byte counters keep counting, as the
 * engine's do while a sketch prints and is typed to, so the example goes through the same code as the real thing.
 */
export const trafficOutputs = (more: Record<string, number | boolean> = {}): PartState['outputs'] => ({
  led: 1,
  crashed: false,
  ...more,
  get tx() {
    return Math.floor(Date.now() / 50);
  },
  get rx() {
    return Math.floor(Date.now() / 50);
  },
});
