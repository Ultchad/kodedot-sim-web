/**
 * What the three Arduino Uno boards share: the board built from the manifest's data (the stepped `outline` polygon,
 * the mounting holes in `refs`, the socket strips where the pins are), the silkscreen legends beside the sockets, the
 * four indicator LEDs with their live state (L where the manifest's `visuals.led` is), the reset button as a control
 * (where the manifest's `controls` has it), and the builders the kit does not have
 * (chip passives by the dozen, small-outline packages, socketed DIP, HC-49 crystal, SMD electrolytic, a lean QFP,
 * JST-SH, 1.27 mm header, DC jack).
 *
 * Everything here works in "board millimetres": the manifest's frame (x to the right, y down the picture = towards
 * the viewer) with its origin moved to the top-left corner of the BOARD, which lies `geo.x0` to the right of the
 * manifest's body (the body leaves room for the connectors that overhang the left edge). `geo.frame` moves that frame
 * onto the model's, so a model builds its whole body inside `s.with(geo.frame, ...)` and draws its silkscreen after
 * `g.translate(-W / 2, -D / 2)` on a quad the size of the board: one set of numbers for the body and the print.
 *
 * Where the parts stand is not in the manifests: each model takes it from the maker's published design files (the
 * Uno R3 board file UNO-TH_Rev3e.brd; the R4 Minima and R4 WiFi PCB documents, bills of materials and mechanical
 * layers), turned into board millimetres. A part's angle is the design file's: degrees counter-clockwise seen from
 * above. The legends follow the maker's pictures of the boards; the maker's name and logo are left out.
 */
import {
  FONT_MONO, INK, Matrix4, PAL, PITCH, Shape, circleLoop, controlFromManifest, flatLamp, glowing, halo, markControl, part, pinHeader, place, roundedRectLoop, setLamp, tactButton, text,
  topQuad,
  type AnimEnv, type ControlManifest, type Finish, type ManifestBody, type ManifestPin, type Object3D, type PartState, type Pt, type Quad, type V3,
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
  /** The board's outline, in the body's millimetres. */
  outline: { x: number; y: number }[];
  /** Non-electrical reference points: the mounting holes are the ones of kind `hole`. */
  refs: { name: string; kind: string; diameter_mm?: number; mm: { x: number; y: number } }[];
  picture?: { width: number };
  /** Where the 2D picture shows an effect; `mm` is the same place on the part (the on-board LED is `led`). */
  visuals?: (NonNullable<ControlManifest['visuals']>[number] & { id: string; x?: number; y?: number; mm?: { x: number; y: number } })[];
  /** What the pointer works: the reset button, with its place on the part in `mm`. */
  controls?: { field: string; mode: string; mm?: { x: number; y: number }; action?: string }[];
  fields?: ControlManifest['fields'];
}

/** Underside of the board: its through-hole pins poke out below, it rests on them. */
export const BOARD_Y = 1.3;
export const THICK = 1.6;
/** Top face of the board. */
export const TOP = BOARD_Y + THICK;
const DEG = Math.PI / 180;

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
  /** The manifest's outline and holes, in board millimetres. */
  outline: Pt[];
  holes: { x: number; y: number; d: number }[];
  /** Board millimetres -> model frame. */
  frame: Matrix4;
  /** A manifest pin's x in board millimetres. */
  pinX(name: string): number;
  /**
   * Where the manifest has a visual (the on-board LED is `led`), in board millimetres: its `mm`, or for a manifest
   * without it the place of the effect in the picture. Throws when the manifest has no such visual.
   */
  visual(id: string): Pt;
  /** Where the manifest has the control of a field (the reset button), in board millimetres. Throws when it has none. */
  control(field: string): Pt;
  /** A point given in board millimetres and a height, in the model frame (for lamps, screens and quads). */
  at(x: number, y: number, h: number): V3;
  /** A print or screen quad lying at height `h`, centred on a point given in board millimetres and turned `deg` counter-clockwise. */
  quad(x: number, y: number, h: number, hw: number, hd: number, deg?: number): Quad;
}

export function unoGeo(m: UnoManifest): UnoGeo {
  const x0 = Math.min(...m.outline.map((p) => p.x));
  const outline: Pt[] = m.outline.map((p) => [p.x - x0, p.y]);
  const W = Math.max(...outline.map((p) => p[0])), D = Math.max(...outline.map((p) => p[1]));
  const tops = m.pins.filter((p) => p.mm && (p.face ?? 'top') === 'top').sort((a, b) => a.mm!.y - b.mm!.y || a.mm!.x - b.mm!.x);
  const rows: HeaderRow[] = [];
  for (const p of tops) {
    const r = rows[rows.length - 1], x = p.mm!.x - x0;
    if (r && Math.abs(r.y - p.mm!.y) < 0.01 && x - r.x1 < PITCH * 1.05) {
      r.pins.push(p);
      r.x1 = x;
    } else rows.push({ pins: [p], y: p.mm!.y, x0: x, x1: x, mouth: p.mm!.z ?? m.body.h_mm });
  }
  const bx = x0 - m.body.w_mm / 2, bz = -m.body.d_mm / 2;
  return {
    W, D, x0, rows, outline,
    holes: m.refs.filter((r) => r.kind === 'hole').map((r) => ({ x: r.mm.x - x0, y: r.mm.y, d: r.diameter_mm ?? 3.2 })),
    frame: new Matrix4().makeTranslation(bx, 0, bz),
    pinX: (name) => (m.pins.find((p) => p.name === name)?.mm?.x ?? 0) - x0,
    visual: (id) => {
      const v = m.visuals?.find((q) => q.id === id);
      if (v?.mm) return [v.mm.x - x0, v.mm.y];
      const k = (m.picture?.width ?? 0) / m.body.w_mm;
      if (!v || v.x === undefined || v.y === undefined || !k) throw new Error(`${m.id}: the manifest does not say where the visual "${id}" is`);
      return [v.x / k - x0, v.y / k];
    },
    control: (field) => {
      const c = m.controls?.find((q) => q.field === field);
      if (!c?.mm) throw new Error(`${m.id}: the manifest does not say where the control of "${field}" is`);
      return [c.mm.x - x0, c.mm.y];
    },
    at: (x, y, h) => [x + bx, h, y + bz],
    quad: (x, y, h, hw, hd, deg = 0) => {
      const c = Math.cos(deg * DEG), sn = Math.sin(deg * DEG);
      return deg ? { c: [x + bx, h, y + bz], u: [hw * c, 0, -hw * sn], v: [-hd * sn, 0, -hd * c] } : topQuad(x + bx, y + bz, h, hw, hd);
    },
  };
}

// ------------------------------------------------------------------------------------------- board and sockets
/**
 * The board, cut to the manifest's outline and drilled where the manifest's holes are (plain holes: the real ones are
 * not plated), and the socket strips built where the manifest's pins are: place, count and mouth height. Call inside
 * `s.with(geo.frame, ...)`.
 */
export function unoBoard(s: Shape, g: UnoGeo, finish: Finish, seg: (n: number) => number): void {
  s.prism(finish[0], finish[1], g.outline, BOARD_Y, TOP, 0.12, { cap: true, ao: 0.9, holes: g.holes.map((h) => circleLoop(h.x, h.y, h.d / 2, seg(16))) });
  for (const r of g.rows) pinHeader(s, { x: (r.x0 + r.x1) / 2, z: r.y, y: TOP, n: r.pins.length, female: true, length: r.mouth - TOP });
}

// ------------------------------------------------------------------------------------------------------ legends
export interface SilkStyle {
  /** The solder mask's colour: what shows through a legend printed as a filled box. */
  mask: string;
  /** What is printed beside a pin, by pin name, where the board differs from the manifest's label; `null`: nothing. */
  names?: Record<string, string | null>;
  /** The white bar on the board's back edge behind a ground socket (the R4 boards have it). */
  backBar?: boolean;
}
const BIG = 2.05, SMALL = 1.22;
/** What the silkscreen says beside a pin: the manifest's label, "~" on PWM pins. */
export function pinLabel(p: UnoPin, st: SilkStyle): string | null {
  const own = st.names?.[p.name];
  if (own !== undefined) return own;
  if (p.kind === 'nc') return null;
  const l = (p.label?.en ?? p.name).replace(/\s*\(.*\)$/, '');
  return p.caps?.includes('pwm') ? `~${l}` : l;
}
/** A small arrow along the board's depth, from y0 to its head at y1. */
function arrow(c: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  const d = Math.sign(y1 - y0) * 0.38;
  c.fillRect(x - 0.1, Math.min(y0, y1 - d), 0.2, Math.abs(y1 - d - y0));
  c.beginPath();
  c.moveTo(x, y1);
  c.lineTo(x - 0.38, y1 - d);
  c.lineTo(x + 0.38, y1 - d);
  c.closePath();
  c.fill();
}
const up = (c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, align: CanvasTextAlign): void => text(c, s, x, y, size, { weight: 700, font: FONT_MONO, angle: -Math.PI / 2, align });
/** A legend printed as a filled box with the mask showing through the letters. `turned`: the words read up the board. */
export function inverse(c: CanvasRenderingContext2D, words: string, x0: number, y0: number, x1: number, y1: number, mask: string, size = SMALL, turned = false): void {
  c.fillStyle = INK.silk;
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.fillStyle = mask;
  text(c, words, (x0 + x1) / 2, (y0 + y1) / 2 + (turned ? 0 : 0.06), size, { weight: 700, font: FONT_MONO, angle: turned ? -Math.PI / 2 : 0 });
  c.fillStyle = INK.silk;
}
/**
 * The legends beside every socket strip, reading up the board as on the real ones: numbers and analog names large,
 * the rest small, the serial pair with its arrows, every ground in a filled box (two neighbours share one) with a bar
 * on the board's edge behind it. Canvas in board millimetres.
 */
export function drawPinLabels(c: CanvasRenderingContext2D, g: UnoGeo, st: SilkStyle): void {
  c.fillStyle = INK.silk;
  for (const r of g.rows) {
    const back = r.y < g.D / 2;
    const edge = back ? r.y + PITCH / 2 + 0.5 : r.y - PITCH / 2 - 0.5; // where a legend starts, just off the strip
    for (let i = 0; i < r.pins.length; i++) {
      const p = r.pins[i], x = p.mm!.x - g.x0;
      if (p.kind === 'ground') {
        let j = i;
        while (j + 1 < r.pins.length && r.pins[j + 1].kind === 'ground') j++;
        const x1 = r.pins[j].mm!.x - g.x0;
        if (j > i) inverse(c, 'GND', x - 1.25, edge - 2.9, x1 + 1.25, edge + 0.1, st.mask, 1.3);
        else inverse(c, 'GND', x - 1.2, back ? edge - 0.1 : edge - 4.1, x + 1.2, back ? edge + 4.1 : edge + 0.1, st.mask, SMALL, true);
        if (!back || st.backBar) c.fillRect(x - 1.25, back ? 0 : g.D - 0.55, x1 - x + 2.5, 0.55);
        i = j;
        continue;
      }
      const l = pinLabel(p, st);
      if (!l) continue;
      const big = /^~?\d+$|^A\d$/.test(l);
      up(c, l, x, edge, big ? BIG : SMALL, back ? 'right' : 'left');
      const tx = p.caps?.includes('uart_tx'), rx = p.caps?.includes('uart_rx');
      if (tx || rx) {
        // the serial pair: its name and an arrow, out of the board on TX and into it on RX
        const away = back ? 1 : -1, a = edge + away * (l.length * BIG * 0.6 + 0.3), b = a + away * 1.0;
        arrow(c, x, tx ? b : a, tx ? a : b);
        up(c, tx ? 'TX' : 'RX', x, b + away * 0.2, SMALL, back ? 'right' : 'left');
      }
    }
  }
}
/**
 * The name of a group of sockets: a rule along them and the words in a filled box hanging from it (`hang` 1: below
 * the rule, -1: above it).
 */
export function drawCaption(c: CanvasRenderingContext2D, words: string, box: readonly [number, number], rule: readonly [number, number], y: number, hang: 1 | -1, mask: string): void {
  c.fillStyle = INK.silk;
  c.fillRect(rule[0], y - 0.1, rule[1] - rule[0], 0.2);
  inverse(c, words, box[0], hang > 0 ? y : y - 1.65, box[1], hang > 0 ? y + 1.65 : y, mask, 1.32);
}
/** A designation in a ruled box (the board's model name, as the boards print it): filled with the mask's letters, or ruled with white ones. */
export function plate(c: CanvasRenderingContext2D, words: string, x0: number, y0: number, x1: number, y1: number, mask: string, filled: boolean, size: number): void {
  c.fillStyle = INK.silk;
  c.strokeStyle = INK.silk;
  c.lineWidth = 0.22;
  if (filled) c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.strokeRect(x0, y0, x1 - x0, y1 - y0);
  c.fillStyle = filled ? mask : INK.silk;
  text(c, words, (x0 + x1) / 2, (y0 + y1) / 2 + size * 0.04, size, { weight: 700, font: FONT_MONO, spacing: size * 0.06 });
  c.fillStyle = INK.silk;
}
/** A short legend (an LED's name, a connector's). `turned`: it reads up the board. */
export function legend(c: CanvasRenderingContext2D, words: string, x: number, y: number, size = 1.3, turned = false): void {
  c.fillStyle = INK.silk;
  text(c, words, x, y, size, { weight: 700, font: FONT_MONO, angle: turned ? -Math.PI / 2 : 0 });
}

/** Rubs the print out over the mounting holes: the print is one flat sheet, the board under it is drilled. Call last. */
export function eraseHoles(c: CanvasRenderingContext2D, g: UnoGeo): void {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (const h of g.holes) {
    c.beginPath();
    c.arc(h.x, h.y, h.d / 2 + 0.3, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// ------------------------------------------------------------------------------------------- bare metal on the board
/** Tinned or gilded lands with nothing soldered on them: [x, y, w, h], drawn on the silkscreen print. */
export function pads(c: CanvasRenderingContext2D, list: readonly (readonly [number, number, number, number])[], colour = '#c3c6cb'): void {
  c.fillStyle = colour;
  for (const [x, y, w, h] of list) {
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.22);
    c.fill();
  }
}
/** Round lands: test points, fiducials, the solder joints of through-hole lugs seen from above. `drill` leaves a hole in each. */
export function dots(c: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], r: number, colour = '#b9bcc2', drill = 0): void {
  for (const [x, y] of pts) {
    c.fillStyle = colour;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    if (drill) {
      c.fillStyle = '#17181a';
      c.beginPath();
      c.arc(x, y, drill, 0, Math.PI * 2);
      c.fill();
    }
  }
}
/** The two lands of a chip part that was left off the board, [x, y, degrees], `l` apart. */
export function emptyLands(c: CanvasRenderingContext2D, list: readonly At[], l: number, w: number): void {
  c.fillStyle = '#c3c6cb';
  for (const [x, y, deg = 0] of list) {
    c.save();
    c.translate(x, y);
    c.rotate(-deg * DEG);
    for (const sx of [-1, 1]) c.fillRect(sx * l * 0.34 - l * 0.16, -w / 2, l * 0.32, w);
    c.restore();
  }
}

// ------------------------------------------------------------------------------------------------- small builders
/** Where a part stands: board millimetres and the design file's angle (degrees counter-clockwise seen from above). */
export type At = readonly [x: number, y: number, deg?: number];
const frame = (x: number, y: number, deg = 0): Matrix4 => new Matrix4().makeTranslation(x, TOP, y).multiply(new Matrix4().makeRotationY(deg * DEG));
const rect = (cx: number, cz: number, w: number, d: number): Pt[] => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
/** A plain block of 10 triangles (leads, pads, tiny bodies): for the many small things a board carries. */
export function slab(s: Shape, f: Finish, cx: number, cz: number, w: number, d: number, y0: number, y1: number, ao = 1): void {
  s.prism(f[0], f[1], rect(cx, cz, w, d), y0, y1, 0, { ao });
}
/** Turns a prism so that what was its top looks at +Z (as the kit's connectors do). */
const FRONT = new Matrix4().makeRotationX(Math.PI / 2);

const SOCKET: Finish = ['matte', '#1c1c1f'];
const LEG: Finish = ['metal', '#b4b7bd'];
const CREAM: Finish = ['matte', '#e8e2d2'];
const CHIP_LED: Finish = ['matte', '#ebe6d6'];

/** A two-terminal chip part: its length along the row of its two ends, its width, its height and what it is made of. */
export interface ChipSize {
  l: number;
  w: number;
  h: number;
  body: Finish;
  end?: Finish;
  /** One block with its ends as flat marks (14 triangles instead of 30): the default for the smallest, and for parts that come by the hundred. */
  lean?: boolean;
}
const TAN: Finish = ['matte', '#b9966a']; // ceramic capacitor
const FILM: Finish = ['matte', '#222225']; // thick film resistor
const FERRITE: Finish = ['matte', '#55565b'];
export const C0402: ChipSize = { l: 1.0, w: 0.5, h: 0.5, body: TAN };
export const R0402: ChipSize = { l: 1.0, w: 0.5, h: 0.35, body: FILM };
export const C0603: ChipSize = { l: 1.6, w: 0.8, h: 0.8, body: TAN };
export const R0603: ChipSize = { l: 1.6, w: 0.8, h: 0.45, body: FILM };
export const L0603: ChipSize = { l: 1.6, w: 0.8, h: 0.8, body: FERRITE };
export const C0805: ChipSize = { l: 2.0, w: 1.25, h: 1.25, body: TAN };
export const L0805: ChipSize = { l: 2.0, w: 1.25, h: 0.85, body: FERRITE };
/** A chip diode in a 1206 case. */
export const D1206: ChipSize = { l: 3.2, w: 1.6, h: 1.1, body: PAL.epoxyBlack };
/** A resettable fuse in an 1812 case: dark body, gilded ends. */
export const F1812: ChipSize = { l: 4.5, w: 3.2, h: 0.9, body: ['matte', '#33342b'], end: ['metal', '#c9a851'] };
export const LED0603: ChipSize = { l: 1.6, w: 0.8, h: 0.6, body: CHIP_LED };
export const LED0805: ChipSize = { l: 2.0, w: 1.25, h: 0.7, body: CHIP_LED };

/** Chip parts of one size, each lying along X before its angle: body and two metal ends (the smallest as flat marks). */
export function chips(s: Shape, size: ChipSize, list: readonly At[]): void {
  const end = Math.min(0.5, size.l * 0.24), metal = size.end ?? PAL.tin;
  for (const [x, y, deg] of list) {
    s.with(frame(x, y, deg), () => {
      if (size.lean ?? size.l < 1.2) {
        slab(s, size.body, 0, 0, size.l, size.w, 0, size.h);
        for (const sx of [-1, 1]) s.rect(metal[0], metal[1], sx * (size.l / 2 - end / 2), 0, end, size.w, size.h + 0.012);
      } else {
        slab(s, size.body, 0, 0, size.l - end * 1.6, size.w, 0.02, size.h);
        for (const sx of [-1, 1]) slab(s, metal, sx * (size.l / 2 - end / 2), 0, end, size.w + 0.04, 0, size.h + 0.02);
      }
    });
  }
}
/** A resistor network (four in one black body with eight tinned ends), its row of four along X before its angle. */
export function resistorArrays(s: Shape, list: readonly At[]): void {
  for (const [x, y, deg] of list) {
    s.with(frame(x, y, deg), () => {
      slab(s, FILM, 0, 0, 3.2, 1.3, 0.02, 0.55);
      for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) slab(s, PAL.tin, (i - 1.5) * 0.8, sz * 0.7, 0.45, 0.45, 0, 0.57);
    });
  }
}
/**
 * A small-outline package with gull-wing leads on two sides (SOT-23, SOT-143, SC-70, MSOP): body `w` along the rows
 * of leads and `d` across, `far` leads on the side away from the viewer and `near` on the other, before its angle.
 */
export function smallOutline(s: Shape, at: At, o: { w: number; d: number; h: number; far: number; near: number; pitch: number }): void {
  s.with(frame(at[0], at[1], at[2]), () => {
    s.box(...PAL.epoxyBlack, 0, 0, o.w, o.d, 0.06, o.h, 0.12, 0.15, { ao: 0.95 });
    for (const [n, side] of [[o.far, -1], [o.near, 1]] as const) for (let i = 0; i < n; i++) slab(s, PAL.tin, (i - (n - 1) / 2) * o.pitch, side * (o.d / 2 + 0.4), Math.min(0.42, o.pitch * 0.52), 0.9, 0, o.h * 0.45, 0.9);
  });
}
export const SOT23 = { w: 2.9, d: 1.3, h: 1.0, far: 1, near: 2, pitch: 1.9 };
export const SOT23_5 = { w: 2.9, d: 1.6, h: 1.1, far: 2, near: 3, pitch: 0.95 };
export const SOT143 = { w: 2.9, d: 1.3, h: 1.0, far: 2, near: 2, pitch: 1.9 };
export const SC70_6 = { w: 2.0, d: 1.25, h: 0.95, far: 3, near: 3, pitch: 0.65 };
export const MSOP8 = { w: 3.0, d: 3.0, h: 1.0, far: 4, near: 4, pitch: 0.65 };
/** A leadless package (DFN, SON): a flat black body `w` x `d`, with `n` lands showing as tinned marks along each of its `w` sides. */
export function leadless(s: Shape, at: At, w: number, d: number, n: number, pitch: number, h = 0.9): void {
  s.with(frame(at[0], at[1], at[2]), () => {
    s.box(...PAL.epoxyBlack, 0, 0, w, d, 0.03, h, 0.12, 0.1, { ao: 0.95 });
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) s.rect(...PAL.tin, (i - (n - 1) / 2) * pitch, side * (d / 2 + 0.07), pitch * 0.5, 0.24, 0.03);
  });
}
/** A power diode in a flat-lead case (SOD-123FL, SMB): the body, its two leads and the band of the cathode end (towards -X before its angle). */
export function flatDiode(s: Shape, at: At, o: { l: number; w: number; h: number }): void {
  s.with(frame(at[0], at[1], at[2]), () => {
    s.box(...PAL.epoxyBlack, 0, 0, o.l, o.w, 0.05, o.h, 0.15, 0.2, { ao: 0.95 });
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * (o.l / 2 + 0.3), 0, 0.75, o.w * 0.6, 0, o.h * 0.4, 0.9);
    s.rect('matte', '#8f9196', -o.l / 2 + o.l * 0.17, 0, o.l * 0.1, o.w - 0.25, o.h + 0.012);
  });
}
export const SOD123 = { l: 2.7, w: 1.7, h: 1.05 };
export const SMB = { l: 4.4, w: 3.6, h: 2.3 };

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
/** A ceramic resonator in a chip case with a metal lid, along X before its angle. */
export function resonator(s: Shape, at: At): void {
  s.with(frame(at[0], at[1], at[2]), () => {
    slab(s, CREAM, 0, 0, 3.2, 1.3, 0, 0.45);
    slab(s, PAL.tin, 0, 0, 2.7, 1.15, 0.45, 0.9);
  });
}

/** An SMD aluminium electrolytic: the can on its black base, the black mark of the negative side towards -X before `turn`. Returns the height of its top above the board. */
export function smdCan(s: Shape, x: number, z: number, turn: number, seg: (n: number) => number, o: { d?: number; h?: number } = {}): number {
  const d = o.d ?? 6.3, r = d / 2, h = o.h ?? 5.4, hb = d / 2 + 0.15, c = 1.2;
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
  return h + 0.02;
}

/** SOT-223 regulator: tab towards -Z, three leads towards +Z before `turn`. */
export function sot223(s: Shape, x: number, z: number, turn = 0): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...PAL.epoxyBlack, 0, 0, 6.5, 3.5, 0.08, 1.7, 0.25, 0.3, { ao: 0.95 });
    slab(s, PAL.tin, 0, -2.55, 3.0, 1.9, 0, 0.8, 0.9);
    for (const i of [-1, 0, 1]) slab(s, PAL.tin, i * 2.3, 2.55, 0.75, 1.9, 0, 0.8, 0.9);
  });
}
/** A quad flat pack, its leads as plain blocks: an LQFP-64 costs 700 triangles instead of 2,500. Returns its height. */
export function qfpLean(s: Shape, o: { x: number; z: number; size: number; perSide: number; pitch?: number; h?: number }): number {
  const pitch = o.pitch ?? 0.5, h = o.h ?? 1.5;
  s.with(place(o.x, TOP, o.z), () => {
    s.box(...PAL.epoxyBlack, 0, 0, o.size, o.size, 0.1, h, 0.45, 0.3, { cap: true, ao: 0.95 });
    for (let q = 0; q < 4; q++) {
      s.with(new Matrix4().makeRotationY((q * Math.PI) / 2), () => {
        for (let i = 0; i < o.perSide; i++) slab(s, PAL.tin, (i - (o.perSide - 1) / 2) * pitch, o.size / 2 + 0.48, pitch * 0.46, 1.0, 0, 0.55, 0.9);
      });
    }
  });
  return h;
}
/** A shielded power inductor: a grey moulded block between two tinned ends (towards -X and +X). */
export function inductor(s: Shape, x: number, z: number, size = 4.5, h = 1.8): void {
  s.with(place(x, TOP, z), () => {
    s.box('matte', '#8c9097', 0, 0, size, size, 0.05, h, 0.7, 0.35, { ao: 0.9 });
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * (size / 2 + 0.1), 0, 0.5, size * 0.55, 0, 0.9);
  });
}
/**
 * A DC barrel jack as it stands on these boards (9 x 11 mm face, 13.5 deep, 5.5 mm barrel): a front flange, and behind
 * it the round barrel housing on a lower block. (x, z) is the middle of its mouth, which faces +Z before `turn`.
 */
export function dcJack(s: Shape, x: number, z: number, turn: number, seg: (n: number) => number): void {
  const m = place(x, TOP, z, turn);
  s.with(m, () => {
    s.box(...PAL.plasticBlack, 0, -8.5, 9, 10, 0, 6.4, 0.5, 0.4, { ao: 0.88 });
    s.rod(...PAL.plasticBlack, [0, 6.2, -13.3], [0, 6.2, -3.2], 4.35, seg(18));
    s.box(...PAL.plasticBlack, 0, -1.75, 9, 3.5, 0, 11, 0.6, 0.5, { ao: 0.88 });
    slab(s, PAL.tin, 0, -13.6, 3.0, 0.25, 0, 3.6, 0.9); // the rear lug
  });
  s.with(m.clone().multiply(new Matrix4().makeTranslation(0, 6.2, 0)).multiply(FRONT), () => {
    s.prism('matte', '#070708', circleLoop(0, 0, 3.15, seg(20)), 0, 0.03, 0, { ao: 1 });
    s.prism(...PAL.tin, circleLoop(0, 0, 1.0, seg(12)), 0.03, 0.06, 0, { ao: 1 });
  });
}
/** JST-SH four-way side-entry socket (the I2C port): (x, z) is the middle of its mouth, which faces +Z before `turn`. */
export function jstSh4(s: Shape, x: number, z: number, turn: number): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...CREAM, 0, -2.13, 6.0, 4.25, 0, 2.95, 0.3, 0.25, { ao: 0.9 });
    s.with(new Matrix4().makeTranslation(0, 1.55, 0).multiply(FRONT), () => {
      s.prism('matte', '#0c0c0d', roundedRectLoop(0, 0, 4.7, 1.6, 0.2, 2), 0, 0.03, 0, { ao: 1 });
      for (let i = 0; i < 4; i++) s.prism(...PAL.gold, rect((i - 1.5) * 1.0, 0.15, 0.3, 0.9), 0.03, 0.05, 0, { ao: 1 });
    });
    for (const sx of [-1, 1]) slab(s, PAL.tin, sx * 3.35, -2.9, 0.8, 1.9, 0, 1.0, 0.9);
    for (let i = 0; i < 4; i++) slab(s, PAL.tin, (i - 1.5) * 1.0, -4.65, 0.3, 0.9, 0, 0.3, 0.9);
  });
}
/** A 1.27 mm 2 x n pin header (the SWD port), row along X before `turn`. */
export function miniHeader(s: Shape, x: number, z: number, turn: number, n = 5): void {
  s.with(place(x, TOP, z, turn), () => {
    s.box(...PAL.plasticBlack, 0, 0, n * 1.27 + 0.2, 2.9, 0, 1.5, 0.2, 0.2, { ao: 0.9 });
    for (const r of [-0.635, 0.635]) for (let i = 0; i < n; i++) slab(s, PAL.gold, (i - (n - 1) / 2) * 1.27, r, 0.4, 0.4, 1.5, 4.3);
  });
}

// -------------------------------------------------------------------------------------------------- reset button
const BUTTON_TOP = 3.45; // the kit's tactile switch: base and metal cover
/** The field of the boards' reset button, and the name of its plunger in the model. */
export const RESET_FIELD = 'reset';
/**
 * The reset button's body: the kit's 6 mm tactile switch with nothing in its cover's hole, standing where the
 * manifest has the control of `reset` (`g.control`). Its plunger is `resetCap`.
 */
export function resetButton(s: Shape, at: Pt): void {
  tactButton(s, { x: at[0], z: at[1], y: TOP, size: 6, plunger: 0.02, cap: ['matte', '#0d0d0e'] });
}
/**
 * The button's plunger: the named child `reset`, marked as the control the manifest declares for the field `reset`
 * (momentary: the Workbench holds the field true while the pointer is down, the engine restarts the sketch when it
 * goes true; `animateUno` shows it pressed). Add it under the model's root.
 */
export function resetCap(g: UnoGeo, m: UnoManifest, finish: Finish, seg: (n: number) => number): Object3D {
  const [x, y] = g.control(RESET_FIELD);
  const cap = new Shape();
  cap.disc(finish[0], finish[1], 0, 0, 1.6, -0.3, 0.75, 0.22, seg(18), { ao: 0.9 });
  const node = markControl(cap.toObject(RESET_FIELD), controlFromManifest(m, RESET_FIELD));
  node.position.set(...g.at(x, y, TOP + BUTTON_TOP));
  node.userData.restY = node.position.y;
  return node;
}
/**
 * The light of a press: a soft glow over the switch, round its plunger, while it is held, so that a press reads from
 * the Workbench's camera (the plunger itself moves half a millimetre). The simulator's own way of speaking, not a
 * part of the board. It stays inside the footprint. Add it under the model's root, beside `resetCap`.
 */
export function resetPress(g: UnoGeo, m: UnoManifest): Object3D {
  const [x, y] = g.control(RESET_FIELD);
  const p = g.at(x, y, TOP + BUTTON_TOP + 0.04);
  return halo(PRESS, p, Math.min(4.8, m.body.w_mm / 2 - Math.abs(p[0]), m.body.d_mm / 2 - Math.abs(p[2])));
}
const PRESS = 'press:reset';
/** How far the plunger goes down while the button is held. */
const TRAVEL = 0.5;

// ------------------------------------------------------------------------------------------------ indicator LEDs
export interface UnoLeds {
  on: At;
  l: At;
  tx: At;
  rx: At;
  size: ChipSize;
  /** How far the ON LED's light reaches on the board (less than the default when it stands at the board's edge). */
  onReach?: number;
}
const LED_NAMES = ['on', 'l', 'tx', 'rx'] as const;
/** The bodies of the four chip LEDs (static). */
export function ledBodies(s: Shape, leds: UnoLeds): void {
  chips(s, leds.size, [leds.on, leds.l, leds.tx, leds.rx]);
}
/**
 * What lights up, to add under the model's root: the lit top of each LED (the kit's `flatLamp`: `on`, `l`, `tx`,
 * `rx`), the light each throws on the board round it (the kit's `halo`: `halo:<name>`) and the red pool of a crashed
 * sketch round L (`fault`: a `glowing` shell, hidden until the hazard).
 */
export function ledLamps(g: UnoGeo, leds: UnoLeds): Object3D[] {
  const out: Object3D[] = [];
  const { l, w, h } = leds.size;
  for (const k of LED_NAMES) {
    const [x, y, deg] = leds[k];
    out.push(flatLamp(k, g.quad(x, y, TOP + h + 0.03, l * 0.27, w * 0.4, deg)), halo(`halo:${k}`, g.at(x, y, TOP + 0.05), k === 'on' ? (leds.onReach ?? 3.2) : 3.2));
  }
  // the pool of a crash: three sheets of red light lying on the board round L, each smaller and denser, hidden until the hazard
  const pool = new Shape(), c = g.at(leds.l[0], leds.l[1], 0), reach = Math.min(9.5, leds.l[1] - 0.6);
  for (let i = 0; i < 3; i++) pool.disc('glass', '#ff3814', c[0], c[2], reach * (1 - i * 0.3), TOP + 0.03, TOP + 0.05 + i * 0.02, 0, 28, { ao: 1 });
  const fault = glowing('fault', pool);
  fault.visible = false;
  out.push(fault);
  return out;
}

const GREEN = 0x35e06a, AMBER = 0xffa51f, YELLOW = 0xffd033, FAULT = 0xff3814;
const level = (v: unknown): number => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : v ? 1 : 0);
/** How long TX or RX stays lit after its byte counter moved. */
const FLASH = 0.12;
const count = (v: unknown): number => (typeof v === 'number' && v === v ? v : 0);
interface Seen {
  unoTx?: number;
  unoRx?: number;
  unoTxUntil?: number;
  unoRxUntil?: number;
}
/**
 * The live state of a board on its four LEDs, from the outputs the boards publish. ON follows `power.on`. L follows
 * `outputs.led` (pin 13: its level, or its PWM duty). TX and RX light for a moment whenever `outputs.tx` /
 * `outputs.rx` (counters of serial bytes) have moved. A crashed sketch (`outputs.crashed`, or the part's `crashed`)
 * is the hazard: TX and RX dark and L glaring red, unsteady, in a pool of red light on the board that reads from
 * across the table. The reset button's plunger goes down, in a pool of light, while the field `reset` is held.
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
  let l = 0, tx = 0, rx = 0, pool = 0, again = false;
  const fault = on && (st.crashed === true || st.outputs.crashed === true);
  if (fault) {
    const flick = Math.floor(env.time * 9) % 2 === 0;
    l = flick ? 2.6 : 2.0;
    pool = flick ? 0.6 : 0.42;
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
  setLamp(obj, 'halo:on', GREEN, on ? 0.8 : 0);
  setLamp(obj, 'halo:l', AMBER, fault ? 0 : l * 0.85);
  setLamp(obj, 'halo:tx', YELLOW, tx * 0.85);
  setLamp(obj, 'halo:rx', YELLOW, rx * 0.85);
  const shell = part(obj, 'fault');
  if (shell) shell.visible = fault;
  setLamp(obj, 'fault', FAULT, pool);
  const held = st.fields[RESET_FIELD] === true;
  const cap = part(obj, RESET_FIELD);
  if (cap) cap.position.y = (cap.userData.restY as number) - (held ? TRAVEL : 0);
  setLamp(obj, PRESS, 0xfff1d0, held ? 0.75 : 0);
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
