/**
 * The circuit as schematic sheets, in the net-label style: every part is its symbol with its reference and value, and
 * every connected pin ends in a short stub with the name of its net (or the ground or supply symbol), so no wire has
 * to cross the sheet. Pure: it makes drawing operations in points (origin top-left, Y down); project/pdf.ts paints them.
 */
import type { Project, ProjectPart, ProjectPin } from './nets';

export type Ink = 'ink' | 'soft' | 'faint' | 'net' | 'supply' | 'paper';
export type Font = 'sans' | 'bold' | 'mono';
export type Op =
  | { t: 'line'; pts: number[]; w?: number; ink?: Ink; fill?: Ink; close?: boolean }
  | { t: 'circle'; x: number; y: number; r: number; w?: number; ink?: Ink; fill?: Ink }
  | { t: 'text'; x: number; y: number; text: string; size: number; font?: Font; align?: 'left' | 'center' | 'right'; ink?: Ink };

export interface Placed {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Sheet {
  ops: Op[];
  /** Where each symbol stands (for the tests: nothing overlaps, nothing leaves the frame). */
  placed: Placed[];
}
export interface SheetText {
  title: string;
  date: string;
  /** "Schematic". */
  heading: string;
  /** "Sheet {n} of {m}" with both numbers filled in. */
  sheet(n: number, m: number): string;
  /** A part's name in the page language. */
  name(part: ProjectPart): string;
  /** Shown when nothing is wired. */
  empty: string;
}

/** A4 landscape, points. */
export const SHEET = { w: 841.89, h: 595.28 };
const FRAME = 20;
const STRIP = 24;
const AREA = { x0: FRAME + 10, y0: FRAME + 12, x1: SHEET.w - FRAME - 10, y1: SHEET.h - FRAME - STRIP - 10 };
const GAP = 12;
const SMALL_W = 196;
const BLOCK_W = 252;
const BODY_W = 112;
const PITCH = 14;
const MAX_ROWS = 30;
const STUB = 12;
const LABEL = 7;

/** A fair guess of a text's width (Helvetica), for boxes and for cutting long names. */
export const widthOf = (text: string, size: number, font: Font = 'sans'): number => text.length * size * (font === 'mono' ? 0.6 : font === 'bold' ? 0.58 : 0.52);
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

class Pen {
  ops: Op[] = [];
  line(pts: number[], w = 0.9, ink: Ink = 'ink'): void {
    this.ops.push({ t: 'line', pts, w, ink });
  }
  shape(pts: number[], fill: Ink | undefined, w = 0.9, ink: Ink = 'ink'): void {
    this.ops.push({ t: 'line', pts, w, ink, fill, close: true });
  }
  circle(x: number, y: number, r: number, fill?: Ink, w = 0.9): void {
    this.ops.push({ t: 'circle', x, y, r, w, fill, ink: 'ink' });
  }
  text(x: number, y: number, text: string, size: number, o: { font?: Font; align?: 'left' | 'center' | 'right'; ink?: Ink } = {}): void {
    if (text) this.ops.push({ t: 'text', x, y, text, size, ...o });
  }
}

// ---- where a pin's stub ends: the net's name, or the ground or supply symbol ----------------------------------------
function netEnd(g: Pen, x: number, y: number, dir: -1 | 1, pin: ProjectPin | undefined): void {
  const net = pin?.net;
  if (!net) {
    // not connected
    g.line([x - 2, y - 2, x + 2, y + 2], 0.7, 'soft');
    g.line([x - 2, y + 2, x + 2, y - 2], 0.7, 'soft');
    return;
  }
  const align = dir > 0 ? 'left' : 'right';
  const name = cut(net.name, 16);
  if (net.kind === 'ground') {
    const sx = x + dir * 5;
    g.line([x, y, sx, y, sx, y + 2.5]);
    g.line([sx - 4, y + 2.5, sx + 4, y + 2.5], 1.1);
    g.line([sx - 2.6, y + 4.3, sx + 2.6, y + 4.3], 1.1);
    g.line([sx - 1.1, y + 6.1, sx + 1.1, y + 6.1], 1.1);
    g.text(x + dir * 11.5, y + 2.5, name, LABEL, { align, font: 'bold' });
  } else if (net.kind === 'supply') {
    const sx = x + dir * 5;
    g.line([x, y, sx, y, sx, y - 4.4], 0.9, 'supply');
    g.line([sx - 3.6, y - 4.4, sx + 3.6, y - 4.4], 1.3, 'supply');
    g.text(x + dir * 11.5, y + 2.5, name, LABEL, { align, font: 'bold', ink: 'supply' });
  } else {
    // a small flag, as net labels are drawn
    const tip = x + dir * 3.2;
    g.line([x, y, tip, y - 2.6], 0.7, 'net');
    g.line([x, y, tip, y + 2.6], 0.7, 'net');
    g.text(x + dir * 5.5, y + 2.5, name, LABEL, { align, font: 'bold', ink: 'net' });
  }
}
/** The small name of a pin, above its stub. */
function pinName(g: Pen, xEnd: number, y: number, dir: -1 | 1, text: string): void {
  // from the pin's end toward the symbol (`dir` is the way the pin points)
  g.text(xEnd - dir * 2.5, y - 2.2, cut(text, 5), 5.4, { align: dir > 0 ? 'right' : 'left', ink: 'soft' });
}

// ---- the small symbols --------------------------------------------------------------------------------------------
interface Drawn {
  w: number;
  h: number;
  draw(g: Pen, x: number, y: number): void;
}
const REACH = 30; // from the middle of a small symbol to the end of its pins

function caption(g: Pen, cx: number, yRef: number, yCap: number, part: ProjectPart, text: SheetText): void {
  g.text(cx, yRef, part.ref, 8.5, { font: 'bold', align: 'center' });
  g.text(cx, yCap, captionOf(part, text), 6.8, { align: 'center', ink: 'soft' });
}
/** What stands under a symbol: its value when the value says it all (a resistor), else its name and value. */
export function captionOf(part: ProjectPart, text: SheetText): string {
  const pure = part.cls === 'resistor' || part.cls === 'capacitor' || part.cls === 'capacitor-pol';
  return cut(pure && part.value ? part.value : nameAndValue(part, text), 50);
}
/** "LED with resistor, 330 Ω"; a name that already says the value ("Potentiometer 10 kΩ") stands alone. */
function nameAndValue(part: ProjectPart, text: SheetText): string {
  const name = text.name(part);
  const squeeze = (s: string) => s.replace(/[\s,.]/g, '').toLowerCase();
  return part.value && !squeeze(name).includes(squeeze(part.value)) ? `${name}, ${part.value}` : name;
}

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 14): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}
function diodeBody(g: Pen, cx: number, y: number, s: number, light: boolean): void {
  g.shape([cx - s, y - s, cx - s, y + s, cx + s, y], 'paper');
  g.line([cx + s, y - s, cx + s, y + s], 1.1);
  if (light) {
    for (const k of [0, 1]) {
      const ax = cx - 1 + k * 4.5, ay = y - s - 2;
      g.line([ax, ay, ax + 4, ay - 4], 0.7);
      g.shape([ax + 4.4, ay - 4.4, ax + 1.9, ay - 3.6, ax + 3.6, ay - 1.9], 'ink', 0.4);
    }
  }
}

function twoPin(part: ProjectPart, text: SheetText): Drawn {
  const [a, b] = part.pins;
  return {
    w: SMALL_W,
    h: 62,
    draw(g, x, y) {
      const cx = x + SMALL_W / 2, y0 = y + 30;
      const L = cx - REACH, R = cx + REACH;
      let refY = y + 13;
      switch (part.cls) {
        case 'resistor': {
          const pts = [L, y0, cx - 14, y0];
          for (let i = 0; i < 6; i++) pts.push(cx - 14 + (i + 0.5) * (28 / 6), y0 + (i % 2 ? 4.2 : -4.2));
          pts.push(cx + 14, y0, R, y0);
          g.line(pts);
          break;
        }
        case 'capacitor':
          g.line([L, y0, cx - 2.4, y0]);
          g.line([cx + 2.4, y0, R, y0]);
          g.line([cx - 2.4, y0 - 7, cx - 2.4, y0 + 7], 1.3);
          g.line([cx + 2.4, y0 - 7, cx + 2.4, y0 + 7], 1.3);
          break;
        case 'capacitor-pol':
          g.line([L, y0, cx - 2.4, y0]);
          g.line([cx + 2.2, y0, R, y0]);
          g.line([cx - 2.4, y0 - 7, cx - 2.4, y0 + 7], 1.3);
          g.line(arcPts(cx + 13, y0, 10.8, Math.PI - 0.72, Math.PI + 0.72, 10), 1.3);
          g.text(cx - 8, y0 - 4.5, '+', 7, { align: 'center' });
          break;
        case 'diode':
        case 'led':
          g.line([L, y0, R, y0]);
          diodeBody(g, cx, y0, 6, part.cls === 'led');
          if (part.cls === 'led') refY = y + 10;
          break;
        case 'buzzer':
          g.line([L, y0, cx - 6, y0, cx - 6, y0 - 2]);
          g.line([R, y0, cx + 6, y0, cx + 6, y0 - 2]);
          g.shape([...arcPts(cx, y0 - 2, 10, Math.PI, 2 * Math.PI, 16)], 'paper');
          g.text(cx - 13, y0 - 5, '+', 6.5, { align: 'center' });
          refY = y + 10;
          break;
        case 'motor':
          g.line([L, y0, cx - 9, y0]);
          g.line([cx + 9, y0, R, y0]);
          g.circle(cx, y0, 9, 'paper');
          g.text(cx, y0 + 3, 'M', 8.5, { font: 'bold', align: 'center' });
          refY = y + 12;
          break;
        default: // a cell: the long plate is the positive one
          g.line([L, y0, cx - 2.4, y0]);
          g.line([cx + 2.4, y0, R, y0]);
          g.line([cx - 2.4, y0 - 8, cx - 2.4, y0 + 8], 1);
          g.line([cx + 2.4, y0 - 4, cx + 2.4, y0 + 4], 2.2);
          g.text(cx - 8, y0 - 5, '+', 7, { align: 'center' });
      }
      pinName(g, L, y0, -1, a.label);
      pinName(g, R, y0, 1, b.label);
      netEnd(g, L, y0, -1, a);
      netEnd(g, R, y0, 1, b);
      caption(g, cx, refY, y0 + 21, part, text);
    },
  };
}

/** Rows a list of pins takes beside one contact: one pin on the contact's line, two a little above and below it. */
function fan(g: Pen, pins: ProjectPin[], xContact: number, yc: number, xEnd: number, dir: -1 | 1): void {
  if (pins.length === 1) {
    g.line([xContact, yc, xEnd, yc]);
    pinName(g, xEnd, yc, dir, pins[0].label);
    netEnd(g, xEnd, yc, dir, pins[0]);
    return;
  }
  const xj = xContact + dir * 7;
  g.line([xContact, yc, xj, yc]);
  g.line([xj, yc - 7, xj, yc + 7]);
  g.circle(xj, yc, 1, 'ink', 0);
  pins.slice(0, 2).forEach((p, i) => {
    const yy = yc + (i ? 7 : -7);
    g.line([xj, yy, xEnd, yy]);
    pinName(g, xEnd, yy, dir, p.label);
    netEnd(g, xEnd, yy, dir, p);
  });
}

function switchSymbol(part: ProjectPart, text: SheetText): Drawn | null {
  const poles = part.poles ?? [];
  const pin = (n: string) => part.pins.find((p) => p.name === n);
  if (!poles.length) return null;
  for (const p of poles) {
    const lists = [p.com, ...p.throws];
    if (p.throws.length > 2 || lists.some((l) => l.length > 2 || l.some((n) => !pin(n)))) return null;
    if (p.throws.length === 2 && lists.some((l) => l.length > 1)) return null;
  }
  const step = 32;
  return {
    w: SMALL_W,
    h: 34 + (poles.length - 1) * step + 32,
    draw(g, x, y) {
      const cx = x + SMALL_W / 2, y0 = y + 34;
      const L = cx - REACH, R = cx + REACH;
      poles.forEach((pole, i) => {
        const yi = y0 + i * step;
        const two = pole.throws.length === 2;
        fan(g, pole.com.map((n) => pin(n)!), cx - 9, yi, L, -1);
        pole.throws.forEach((th, j) => fan(g, th.map((n) => pin(n)!), cx + 9, two ? yi + (j ? 7 : -7) : yi, R, 1));
        if (!two && part.momentary) {
          // a push button: the bar drops onto both contacts
          g.line([cx - 11, yi - 5, cx + 11, yi - 5], 1.1);
          g.line([cx, yi - 5, cx, yi - 10.5]);
          g.line([cx - 4, yi - 10.5, cx + 4, yi - 10.5], 1.1);
        } else g.line([cx - 9, yi, cx + 8.2, yi - (two ? 6.4 : 6)], 1.1);
        g.circle(cx - 9, yi, 1.5, 'paper');
        for (let j = 0; j < pole.throws.length; j++) g.circle(cx + 9, two ? yi + (j ? 7 : -7) : yi, 1.5, 'paper');
      });
      caption(g, cx, y + 13, y0 + (poles.length - 1) * step + 24, part, text);
    },
  };
}

function potentiometer(part: ProjectPart, text: SheetText): Drawn {
  const [top, wiper, bottom] = part.pins;
  return {
    w: SMALL_W,
    h: 78,
    draw(g, x, y) {
      const cx = x + SMALL_W / 2, y0 = y + 30;
      const L = cx - REACH, R = cx + REACH;
      const pts = [L, y0, cx - 14, y0];
      for (let i = 0; i < 6; i++) pts.push(cx - 14 + (i + 0.5) * (28 / 6), y0 + (i % 2 ? 4.2 : -4.2));
      pts.push(cx + 14, y0, R, y0);
      g.line(pts);
      g.line([cx, y0 + 6.5, cx, y0 + 16, R, y0 + 16]);
      g.shape([cx, y0 + 4.6, cx - 2.6, y0 + 9.4, cx + 2.6, y0 + 9.4], 'ink', 0.4);
      pinName(g, L, y0, -1, top.label);
      pinName(g, R, y0, 1, bottom.label);
      pinName(g, R, y0 + 16, 1, wiper.label);
      netEnd(g, L, y0, -1, top);
      netEnd(g, R, y0, 1, bottom);
      netEnd(g, R, y0 + 16, 1, wiper);
      caption(g, cx, y + 13, y0 + 37, part, text);
    },
  };
}

function rgbLed(part: ProjectPart, text: SheetText): Drawn | null {
  const d = part.diodes ?? [];
  const pin = (n: string) => part.pins.find((p) => p.name === n);
  if (d.length < 2 || d.length > 4 || d.some((e) => !pin(e.anode) || !pin(e.cathode))) return null;
  const commonCathode = d.every((e) => e.cathode === d[0].cathode);
  const commonAnode = d.every((e) => e.anode === d[0].anode);
  if (!commonCathode && !commonAnode) return null;
  const step = 16;
  return {
    w: SMALL_W,
    h: 30 + (d.length - 1) * step + 32,
    draw(g, x, y) {
      const cx = x + SMALL_W / 2, y0 = y + 32;
      const L = cx - REACH, R = cx + REACH;
      const mid = y0 + ((d.length - 1) * step) / 2;
      // the shared pin's side has one stub; the other side has one per colour
      const busX = commonCathode ? cx + 11 : cx - 11;
      d.forEach((e, i) => {
        const yi = y0 + i * step;
        g.line([commonCathode ? L : busX, yi, commonCathode ? busX : R, yi]);
        diodeBody(g, cx, yi, 4.6, i === 0);
        const own = pin(commonCathode ? e.anode : e.cathode)!;
        pinName(g, commonCathode ? L : R, yi, commonCathode ? -1 : 1, own.label);
        netEnd(g, commonCathode ? L : R, yi, commonCathode ? -1 : 1, own);
      });
      g.line([busX, y0, busX, y0 + (d.length - 1) * step]);
      const shared = pin(commonCathode ? d[0].cathode : d[0].anode)!;
      const sy = d.length % 2 ? mid : mid + step / 2;
      g.line([busX, sy, commonCathode ? R : L, sy]);
      g.circle(busX, sy, 1, 'ink', 0);
      pinName(g, commonCathode ? R : L, sy, commonCathode ? 1 : -1, shared.label);
      netEnd(g, commonCathode ? R : L, sy, commonCathode ? 1 : -1, shared);
      caption(g, cx, y + 10, y0 + (d.length - 1) * step + 22, part, text);
    },
  };
}

// ---- blocks: the Dot, boards, modules, and anything without a symbol of its own -------------------------------------
const POWER = new Set(['ground', 'power_in', 'power_out']);
function shownPins(part: ProjectPart): ProjectPin[] {
  if (part.pins.length <= 8) return part.pins;
  // of the pins a part joins inside itself (three GND pins), the ones something meets; the first when none is
  const met = new Set(part.pins.filter((p) => p.net && p.touched).map((p) => p.net));
  const seen = new Set<unknown>();
  return part.pins.filter((p) => {
    if (!p.net) return false;
    if (p.touched) return true;
    if (met.has(p.net) || seen.has(p.net)) return false;
    seen.add(p.net);
    return true;
  });
}
function icon(g: Pen, cls: string, cx: number, cy: number): void {
  if (cls === 'servo') {
    g.circle(cx, cy, 9, 'paper');
    g.text(cx, cy + 3, 'M', 8.5, { font: 'bold', align: 'center' });
    // the horn
    g.line([cx + 6.4, cy - 6.4, cx + 13, cy - 13], 1.4);
    g.circle(cx + 13, cy - 13, 1.4, 'ink', 0);
  } else if (cls === 'relay') {
    // the coil, and the contact it moves
    g.shape([cx - 12, cy - 6, cx - 2, cy - 6, cx - 2, cy + 6, cx - 12, cy + 6], 'paper');
    g.line([cx - 12, cy + 6, cx - 2, cy - 6], 0.7);
    g.line([cx - 2, cy, cx + 3, cy], 0.6, 'soft');
    g.line([cx + 4, cy + 5, cx + 12.5, cy - 3], 1.1);
    g.circle(cx + 4, cy + 5, 1.3, 'paper');
    g.circle(cx + 13, cy - 6, 1.3, 'paper');
    g.circle(cx + 13, cy + 5, 1.3, 'paper');
  }
}
function blocks(part: ProjectPart, text: SheetText): Drawn[] {
  const pins = shownPins(part);
  const faces = part.cls === 'relay';
  let left = pins.filter((p) => POWER.has(p.kind));
  let right = pins.filter((p) => !POWER.has(p.kind));
  if (faces) {
    // a relay reads coil side to contact side
    const contact = (p: ProjectPin) => /^(COM|NO|NC)\d*$/i.test(p.name);
    left = pins.filter((p) => !contact(p));
    right = pins.filter(contact);
  }
  // supplies above grounds, as schematics have them (and a ground symbol never hangs into a supply's)
  const groundLast = (list: ProjectPin[]) => [...list.filter((p) => p.net?.kind !== 'ground'), ...list.filter((p) => p.net?.kind === 'ground')];
  left = groundLast(left);
  if (!faces) right = groundLast(right);
  // a side with too many rows spills onto the other, then onto further blocks
  while (right.length > MAX_ROWS && left.length < MAX_ROWS) left.push(right.pop()!);
  while (left.length > MAX_ROWS && right.length < MAX_ROWS) right.push(left.pop()!);
  const count = Math.max(1, Math.ceil(Math.max(left.length, right.length) / MAX_ROWS));
  const out: Drawn[] = [];
  for (let k = 0; k < count; k++) {
    const l = left.slice(k * MAX_ROWS, (k + 1) * MAX_ROWS), r = right.slice(k * MAX_ROWS, (k + 1) * MAX_ROWS);
    const rows = Math.max(l.length, r.length, part.cls === 'servo' || part.cls === 'relay' ? 3 : 2);
    const bodyH = rows * PITCH + 8;
    out.push({
      w: BLOCK_W,
      h: 16 + bodyH + 8,
      draw(g, x, y) {
        const bx = x + (BLOCK_W - BODY_W) / 2, by = y + 16;
        const title = part.ref + (count > 1 ? ` (${k + 1}/${count})` : '');
        g.text(bx, by - 4.5, title, 8.5, { font: 'bold' });
        g.text(bx + widthOf(title, 8.5, 'bold') + 5, by - 4.5, cut(nameAndValue(part, text), 34), 6.8, { ink: 'soft' });
        g.shape([bx, by, bx + BODY_W, by, bx + BODY_W, by + bodyH, bx, by + bodyH], 'paper', 1.1);
        if (part.cls === 'servo' || part.cls === 'relay') icon(g, part.cls, bx + BODY_W / 2 + (part.cls === 'servo' ? 8 : 0), by + bodyH / 2);
        const side = (list: ProjectPin[], dir: -1 | 1) => {
          list.forEach((p, i) => {
            const yy = by + 4 + PITCH / 2 + i * PITCH;
            const edge = dir < 0 ? bx : bx + BODY_W;
            g.text(edge - dir * 4, yy + 2.3, cut(p.label, 16), 6.5, { align: dir < 0 ? 'left' : 'right' });
            g.line([edge, yy, edge + dir * STUB, yy]);
            if (p.number !== undefined) g.text(edge + dir * STUB * 0.5, yy - 1.8, String(p.number), 4.8, { align: 'center', ink: 'soft' });
            netEnd(g, edge + dir * STUB, yy, dir, p);
          });
        };
        side(l, -1);
        side(r, 1);
      },
    });
  }
  return out;
}

function symbolsOf(part: ProjectPart, text: SheetText): Drawn[] {
  switch (part.cls) {
    case 'resistor':
    case 'capacitor':
    case 'capacitor-pol':
    case 'diode':
    case 'led':
    case 'buzzer':
    case 'motor':
    case 'cell':
      return part.pins.length === 2 ? [twoPin(part, text)] : blocks(part, text);
    case 'switch': {
      const s = switchSymbol(part, text);
      return s ? [s] : blocks(part, text);
    }
    case 'potentiometer':
      return part.pins.length === 3 ? [potentiometer(part, text)] : blocks(part, text);
    case 'rgb-led': {
      const s = rgbLed(part, text);
      return s ? [s] : blocks(part, text);
    }
    default:
      return blocks(part, text);
  }
}

// ---- the sheets ---------------------------------------------------------------------------------------------------
function frame(g: Pen, text: SheetText, n: number, m: number): void {
  const x0 = FRAME, y0 = FRAME, x1 = SHEET.w - FRAME, y1 = SHEET.h - FRAME;
  g.shape([x0, y0, x1, y0, x1, y1, x0, y1], undefined, 1.2);
  const ty = y1 - STRIP;
  g.line([x0, ty, x1, ty], 1.2);
  // the title block: project, what the sheet is, the date, the sheet's number
  const cols = [x0, x0 + 150, x1 - 250, x1 - 120, x1];
  for (const c of cols.slice(1, -1)) g.line([c, ty, c, y1], 0.8);
  const base = ty + STRIP / 2 + 3;
  g.text(cols[0] + 10, base, text.heading.toUpperCase(), 8.5, { font: 'bold' });
  g.text(cols[1] + 10, base, cut(text.title, 74), 9.5, { font: 'bold' });
  g.text(cols[2] + 10, base, text.date, 8.5);
  g.text(cols[3] + 10, base, text.sheet(n, m), 8.5);
}

/** Puts the symbols in columns inside a box of `w` by `h` (its corner at 0,0): blocks first, each family in its own column width. */
function arrange(items: { ref: string; d: Drawn }[], w: number, h: number): { g: Pen; placed: Placed[] }[] {
  const sheets: { g: Pen; placed: Placed[] }[] = [];
  const open = () => {
    const s = { g: new Pen(), placed: [] as Placed[] };
    sheets.push(s);
    return s;
  };
  let cur = open();
  let x = 0, y = 0, colW = 0;
  for (const { ref, d } of items) {
    if (colW && (d.w !== colW || y + d.h > h)) {
      x += colW + GAP;
      y = 0;
      colW = 0;
    }
    if (x + d.w > w + 0.5) {
      cur = open();
      x = 0;
      y = 0;
    }
    colW = d.w;
    d.draw(cur.g, x, y);
    cur.placed.push({ ref, x, y, w: d.w, h: d.h });
    y += d.h + GAP;
  }
  return sheets;
}
const scaled = (op: Op, k: number, dx: number, dy: number): Op =>
  op.t === 'line'
    ? { ...op, pts: op.pts.map((v, i) => (i % 2 ? dy : dx) + v * k), w: (op.w ?? 0.9) * Math.sqrt(k) }
    : op.t === 'circle'
      ? { ...op, x: dx + op.x * k, y: dy + op.y * k, r: op.r * k, w: (op.w ?? 0.9) * Math.sqrt(k) }
      : { ...op, x: dx + op.x * k, y: dy + op.y * k, size: op.size * k };

/** A small circuit is drawn larger, as large as still fits one sheet. */
const SCALES = [1.7, 1.5, 1.3, 1.15, 1];

export function drawSchematic(project: Project, text: SheetText): Sheet[] {
  const items: { ref: string; d: Drawn }[] = [];
  for (const part of project.parts) for (const d of symbolsOf(part, text)) items.push({ ref: part.ref, d });
  const W = AREA.x1 - AREA.x0, H = AREA.y1 - AREA.y0;
  let k = 1;
  let sheets = arrange(items, W, H);
  for (const s of SCALES) {
    const tried = s === 1 ? sheets : arrange(items, W / s, H / s);
    if (tried.length === 1 || s === 1) {
      k = s;
      sheets = tried;
      break;
    }
  }
  if (!items.length) sheets[0].g.text(W / 2, H / 2 - 20, text.empty, 11, { align: 'center', ink: 'soft' });
  return sheets.map((s, i) => {
    const g = new Pen();
    frame(g, text, i + 1, sheets.length);
    return {
      ops: [...g.ops, ...s.g.ops.map((op) => scaled(op, k, AREA.x0, AREA.y0))],
      placed: s.placed.map((p) => ({ ref: p.ref, x: AREA.x0 + p.x * k, y: AREA.y0 + p.y * k, w: p.w * k, h: p.h * k })),
    };
  });
}
export const SCHEMATIC_AREA = AREA;
