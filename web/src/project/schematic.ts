/**
 * The circuit as schematic sheets. Every part is its symbol with its reference and value; the sheet reads from left to
 * right: the Dot and the boards stand on the left, what they drive on the right, in the order of the pins that drive
 * it. Parts in series share a row and are joined by a real wire; every other connected pin ends in the name of its net
 * (a tag, or the ground or supply symbol), so no long wire crosses the sheet. A small circuit is drawn large.
 * Pure: it makes drawing operations in points (origin top-left, Y down); project/pdf.ts paints them.
 */
import { fit, textWidth, type FontId } from './fonts';
import type { Project, ProjectNet, ProjectPart, ProjectPin } from './nets';

export type Ink = 'ink' | 'soft' | 'faint' | 'line' | 'net' | 'netFill' | 'supply' | 'paper' | 'cream' | 'card' | 'amber';
export type Op =
  | { t: 'line'; pts: number[]; w?: number; ink?: Ink; fill?: Ink; close?: boolean }
  | { t: 'circle'; x: number; y: number; r: number; w?: number; ink?: Ink; fill?: Ink }
  | { t: 'text'; x: number; y: number; text: string; size: number; font?: FontId; align?: 'left' | 'center' | 'right'; ink?: Ink };

export interface Placed {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Sheet {
  ops: Op[];
  /** Where each symbol stands, its labels included (for the tests: nothing overlaps, nothing leaves the frame). */
  placed: Placed[];
  /** How much larger than its natural size the drawing is. */
  scale: number;
}
export interface SheetText {
  title: string;
  date: string;
  /** "Schematic". */
  heading: string;
  /** Captions of the title block. */
  labels: { project: string; date: string; sheet: string; rev: string };
  /** A part's name in the page language. */
  name(part: ProjectPart): string;
  /** Shown when nothing is on the table. */
  empty: string;
}

/** A4 landscape, points. */
export const SHEET = { w: 841.89, h: 595.28 };
const EDGE = 22; // paper edge to the outer frame line
const BAND = 11; // the band of zone markers between the two frame lines
const INNER = { x0: EDGE + BAND, y0: EDGE + BAND, x1: SHEET.w - EDGE - BAND, y1: SHEET.h - EDGE - BAND };
const TB = { w: 304, h: 62 };
const PAD = 16;
/** Where symbols may stand: inside the frame, above the title block. */
const AREA = { x0: INNER.x0 + PAD, y0: INNER.y0 + PAD, x1: INNER.x1 - PAD, y1: INNER.y1 - TB.h - PAD };

const PITCH = 14;
const STUB = 14;
const MAX_ROWS = 28;
const LABEL = 6.4;
const cutTo = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

class Pen {
  ops: Op[] = [];
  /** While set, everything is mirrored about this x (a polarised symbol drawn the other way round). */
  mirror: number | null = null;
  private mx(x: number): number {
    return this.mirror === null ? x : 2 * this.mirror - x;
  }
  line(pts: number[], w = 1, ink: Ink = 'ink'): void {
    this.ops.push({ t: 'line', pts: pts.map((v, i) => (i % 2 ? v : this.mx(v))), w, ink });
  }
  shape(pts: number[], fill: Ink | undefined, w = 1, ink: Ink = 'ink'): void {
    this.ops.push({ t: 'line', pts: pts.map((v, i) => (i % 2 ? v : this.mx(v))), w, ink, fill, close: true });
  }
  circle(x: number, y: number, r: number, fill?: Ink, w = 1, ink: Ink = 'ink'): void {
    this.ops.push({ t: 'circle', x: this.mx(x), y, r, w, fill, ink });
  }
  text(x: number, y: number, text: string, size: number, o: { font?: FontId; align?: 'left' | 'center' | 'right'; ink?: Ink } = {}): void {
    if (!text) return;
    const align = this.mirror === null || !o.align || o.align === 'center' ? o.align : o.align === 'left' ? 'right' : 'left';
    this.ops.push({ t: 'text', x: this.mx(x), y, text, size, ...o, align });
  }
}
/** A rectangle with round corners, as points. */
function roundRect(x: number, y: number, w: number, h: number, r: number): number[] {
  const pts: number[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (Math.PI / 2) * (i / 5);
      pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

// ---- where a pin's lead ends: the net's tag, or the ground or supply symbol ----------------------------------------
const netName = (net: ProjectNet): string => cutTo(net.name, 18);
/** How far a pin's ending reaches past the pin's end. */
function endExtent(pin: ProjectPin): number {
  const net = pin.net;
  if (!net) return 4;
  const tw = textWidth(netName(net), LABEL, 'label');
  return net.kind === 'signal' ? 4 + 4.5 + tw + 5 : 13 + tw;
}
function netEnd(g: Pen, x: number, y: number, dir: -1 | 1, pin: ProjectPin): void {
  const net = pin.net;
  if (!net) {
    // not connected
    g.line([x - 2, y - 2, x + 2, y + 2], 0.7, 'soft');
    g.line([x - 2, y + 2, x + 2, y - 2], 0.7, 'soft');
    return;
  }
  const align = dir > 0 ? 'left' : 'right';
  const name = netName(net);
  if (net.kind === 'ground') {
    const sx = x + dir * 6;
    g.line([x, y, sx, y, sx, y + 2.6]);
    g.line([sx - 4.2, y + 2.6, sx + 4.2, y + 2.6], 1.1);
    g.line([sx - 2.7, y + 4.5, sx + 2.7, y + 4.5], 1.1);
    g.line([sx - 1.2, y + 6.4, sx + 1.2, y + 6.4], 1.1);
    g.text(x + dir * 13, y + 2.3, name, LABEL, { align, font: 'label' });
  } else if (net.kind === 'supply') {
    const sx = x + dir * 6;
    g.line([x, y, sx, y, sx, y - 4.6], 1, 'supply');
    g.line([sx - 3.8, y - 4.6, sx + 3.8, y - 4.6], 1.4, 'supply');
    g.text(x + dir * 13, y + 2.3, name, LABEL, { align, font: 'label', ink: 'supply' });
  } else {
    // a tag pointing at the pin, as global labels are drawn
    const tw = textWidth(name, LABEL, 'label');
    const a = x + dir * 4, b = a + dir * 4.5, c = b + dir * (tw + 5);
    g.line([x, y, a, y], 1, 'net');
    g.shape([a, y, b, y - 4.7, c, y - 4.7, c, y + 4.7, b, y + 4.7], 'netFill', 0.7, 'net');
    g.text(b + dir * 1.6, y + 2.3, name, LABEL, { align, font: 'label', ink: 'net' });
  }
}
/** The small name of a pin, above its lead, from the pin's end toward the symbol. */
function pinName(g: Pen, xEnd: number, y: number, dir: -1 | 1, text: string): void {
  g.text(xEnd - dir * 2, y - 2.4, cutTo(text, 5), 5, { font: 'mono', align: dir > 0 ? 'right' : 'left', ink: 'soft' });
}

// ---- symbols ------------------------------------------------------------------------------------------------------
interface Port {
  pin: ProjectPin;
  side: -1 | 1;
  /** From the element's left pin end and its axis. */
  dx: number;
  dy: number;
}
interface El {
  part: ProjectPart;
  /** Pin end to pin end. */
  w: number;
  /** Room above and below the axis. */
  up: number;
  down: number;
  /** How wide the texts above and below the symbol are. */
  textW: number;
  ports: Port[];
  /** One pin in, one pin out: can stand in a row with others, joined by wires. */
  inline: boolean;
  draw(g: Pen, x: number, y: number): void;
}
const SMALL = 60;
const REF = 9;
const CAP = 6.6;

/** What stands under a symbol: its value when the value says it all (a resistor), else its name and value. */
export function captionOf(part: ProjectPart, text: SheetText): string {
  const pure = part.cls === 'resistor' || part.cls === 'capacitor' || part.cls === 'capacitor-pol';
  return pure && part.value ? part.value : nameAndValue(part, text);
}
/** "LED with resistor, 330 Ω"; a name that already says the value ("Potentiometer 10 kΩ") stands alone. */
function nameAndValue(part: ProjectPart, text: SheetText): string {
  const name = text.name(part);
  const squeeze = (s: string) => s.replace(/[\s,.]/g, '').toLowerCase();
  return part.value && !squeeze(name).includes(squeeze(part.value)) ? `${name}, ${part.value}` : name;
}
function titles(g: Pen, cx: number, yRef: number, yCap: number, part: ProjectPart, text: SheetText): void {
  g.text(cx, yRef, part.ref, REF, { font: 'display', align: 'center' });
  g.text(cx, yCap, fit(captionOf(part, text), CAP, 150), CAP, { align: 'center', ink: 'soft' });
}
const titlesWidth = (part: ProjectPart, text: SheetText): number => Math.max(textWidth(part.ref, REF, 'display'), Math.min(150, textWidth(captionOf(part, text), CAP)));

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
  g.line([cx + s, y - s, cx + s, y + s], 1.2);
  if (light) {
    for (const k of [0, 1]) {
      const ax = cx - 1 + k * 4.5, ay = y - s - 2;
      g.line([ax, ay, ax + 4, ay - 4], 0.7);
      g.shape([ax + 4.4, ay - 4.4, ax + 1.9, ay - 3.6, ax + 3.6, ay - 1.9], 'ink', 0.4);
    }
  }
}
const zigzag = (L: number, R: number, cx: number, y: number): number[] => {
  const pts = [L, y, cx - 14, y];
  for (let i = 0; i < 6; i++) pts.push(cx - 14 + (i + 0.5) * (28 / 6), y + (i % 2 ? 4.4 : -4.4));
  pts.push(cx + 14, y, R, y);
  return pts;
};

/** A two-pin symbol lying on its axis; `first` is the pin drawn on the left. */
function twoPin(part: ProjectPart, text: SheetText, first: ProjectPin): El {
  const [p0, p1] = part.pins;
  const flipped = first !== p0;
  const tall = part.cls === 'led' || part.cls === 'buzzer';
  return {
    part,
    w: SMALL,
    up: tall ? 27 : 24,
    down: 24,
    textW: titlesWidth(part, text),
    inline: true,
    ports: [
      { pin: flipped ? p1 : p0, side: -1, dx: 0, dy: 0 },
      { pin: flipped ? p0 : p1, side: 1, dx: SMALL, dy: 0 },
    ],
    draw(g, x, y) {
      const L = x, R = x + SMALL, cx = x + SMALL / 2;
      g.mirror = flipped ? cx : null;
      switch (part.cls) {
        case 'resistor':
          g.line(zigzag(L, R, cx, y));
          break;
        case 'capacitor':
          g.line([L, y, cx - 2.4, y]);
          g.line([cx + 2.4, y, R, y]);
          g.line([cx - 2.4, y - 7, cx - 2.4, y + 7], 1.4);
          g.line([cx + 2.4, y - 7, cx + 2.4, y + 7], 1.4);
          break;
        case 'capacitor-pol':
          g.line([L, y, cx - 2.4, y]);
          g.line([cx + 2.2, y, R, y]);
          g.line([cx - 2.4, y - 7, cx - 2.4, y + 7], 1.4);
          g.line(arcPts(cx + 13, y, 10.8, Math.PI - 0.72, Math.PI + 0.72, 10), 1.4);
          g.text(cx - 8, y - 4.5, '+', 7, { align: 'center', font: 'label' });
          break;
        case 'diode':
        case 'led':
          g.line([L, y, R, y]);
          diodeBody(g, cx, y, 6, part.cls === 'led');
          break;
        case 'buzzer':
          g.line([L, y, cx - 6, y, cx - 6, y - 2]);
          g.line([R, y, cx + 6, y, cx + 6, y - 2]);
          g.shape([...arcPts(cx, y - 2, 10, Math.PI, 2 * Math.PI, 16)], 'paper');
          g.text(cx - 14, y - 5, '+', 6.5, { align: 'center', font: 'label' });
          break;
        case 'motor':
          g.line([L, y, cx - 9, y]);
          g.line([cx + 9, y, R, y]);
          g.circle(cx, y, 9, 'paper');
          break;
        default: // a cell: the long plate is the positive one
          g.line([L, y, cx - 2.4, y]);
          g.line([cx + 2.4, y, R, y]);
          g.line([cx - 2.4, y - 8, cx - 2.4, y + 8], 1.1);
          g.line([cx + 2.4, y - 4, cx + 2.4, y + 4], 2.4);
          g.text(cx - 8, y - 5, '+', 7, { align: 'center', font: 'label' });
      }
      g.mirror = null;
      if (part.cls === 'motor') g.text(cx, y + 3.1, 'M', 9, { font: 'display', align: 'center' });
      pinName(g, L, y, -1, this.ports[0].pin.label);
      pinName(g, R, y, 1, this.ports[1].pin.label);
      titles(g, cx, y - (tall ? 19 : 14), y + 19, part, text);
    },
  };
}

/** A switch from its contact sets. One pole with one pin a side stands in a row like a two-pin part. */
function switchSymbol(part: ProjectPart, text: SheetText, first?: ProjectPin): El | null {
  const poles = part.poles ?? [];
  const pin = (n: string) => part.pins.find((p) => p.name === n);
  if (!poles.length) return null;
  for (const p of poles) {
    const lists = [p.com, ...p.throws];
    if (p.throws.length > 2 || lists.some((l) => l.length > 2 || l.some((n) => !pin(n)))) return null;
    if (p.throws.length === 2 && lists.some((l) => l.length > 1)) return null;
  }
  const simple = poles.length === 1 && poles[0].throws.length === 1 && poles[0].com.length === 1 && poles[0].throws[0].length === 1;
  const swap = simple && !!first && first.name !== poles[0].com[0];
  const step = 32;
  const ports: Port[] = [];
  // where each list of pins meets the symbol: one pin on the contact's line, two a little above and below it
  const rows = (names: string[], yc: number, side: -1 | 1) => names.slice(0, 2).map((n, i) => ({ pin: pin(n)!, side, dx: side < 0 ? 0 : SMALL, dy: names.length === 1 ? yc : yc + (i ? 7 : -7) }));
  poles.forEach((pole, i) => {
    const yi = i * step;
    const two = pole.throws.length === 2;
    ports.push(...rows(swap ? pole.throws[0] : pole.com, yi, -1));
    (swap ? [pole.com] : pole.throws).forEach((th, j) => ports.push(...rows(th, two ? yi + (j ? 7 : -7) : yi, 1)));
  });
  const last = (poles.length - 1) * step;
  return {
    part,
    w: SMALL,
    up: 27,
    down: last + 26,
    textW: titlesWidth(part, text),
    inline: simple,
    ports,
    draw(g, x, y) {
      const L = x, R = x + SMALL, cx = x + SMALL / 2;
      const fan = (list: Port[], xContact: number, yc: number, xEnd: number, dir: -1 | 1) => {
        if (list.length === 1) g.line([xContact, yc, xEnd, yc]);
        else {
          const xj = xContact + dir * 7;
          g.line([xContact, yc, xj, yc]);
          g.line([xj, yc - 7, xj, yc + 7]);
          g.circle(xj, yc, 1.1, 'ink', 0);
          for (const p of list) g.line([xj, y + p.dy, xEnd, y + p.dy]);
        }
        for (const p of list) pinName(g, xEnd, y + p.dy, dir, p.pin.label);
      };
      let at = 0;
      poles.forEach((pole, i) => {
        const yi = y + i * step;
        const two = pole.throws.length === 2;
        const nCom = Math.min(2, pole.com.length);
        fan(ports.slice(at, at + (swap ? 1 : nCom)), cx - 9, yi, L, -1);
        at += swap ? 1 : nCom;
        (swap ? [pole.com] : pole.throws).forEach((th, j) => {
          const n = Math.min(2, th.length);
          fan(ports.slice(at, at + n), cx + 9, two ? yi + (j ? 7 : -7) : yi, R, 1);
          at += n;
        });
        if (!two && part.momentary) {
          // a push button: the bar drops onto both contacts
          g.line([cx - 11, yi - 5, cx + 11, yi - 5], 1.2);
          g.line([cx, yi - 5, cx, yi - 10.5]);
          g.line([cx - 4, yi - 10.5, cx + 4, yi - 10.5], 1.2);
        } else g.line([cx - 9, yi, cx + 8.2, yi - (two ? 6.4 : 6)], 1.2);
        g.circle(cx - 9, yi, 1.6, 'paper');
        for (let j = 0; j < pole.throws.length; j++) g.circle(cx + 9, two ? yi + (j ? 7 : -7) : yi, 1.6, 'paper');
      });
      titles(g, cx, y - 18, y + last + 21, part, text);
    },
  };
}

function potentiometer(part: ProjectPart, text: SheetText): El {
  const [top, wiper, bottom] = part.pins;
  return {
    part,
    w: SMALL,
    up: 24,
    down: 40,
    textW: titlesWidth(part, text),
    inline: false,
    ports: [
      { pin: top, side: -1, dx: 0, dy: 0 },
      { pin: bottom, side: 1, dx: SMALL, dy: 0 },
      { pin: wiper, side: 1, dx: SMALL, dy: 16 },
    ],
    draw(g, x, y) {
      const L = x, R = x + SMALL, cx = x + SMALL / 2;
      g.line(zigzag(L, R, cx, y));
      g.line([cx, y + 6.5, cx, y + 16, R, y + 16]);
      g.shape([cx, y + 4.6, cx - 2.6, y + 9.4, cx + 2.6, y + 9.4], 'ink', 0.4);
      pinName(g, L, y, -1, top.label);
      pinName(g, R, y, 1, bottom.label);
      pinName(g, R, y + 16, 1, wiper.label);
      titles(g, cx, y - 14, y + 35, part, text);
    },
  };
}

function rgbLed(part: ProjectPart, text: SheetText): El | null {
  const d = part.diodes ?? [];
  const pin = (n: string) => part.pins.find((p) => p.name === n);
  if (d.length < 2 || d.length > 4 || d.some((e) => !pin(e.anode) || !pin(e.cathode))) return null;
  const commonCathode = d.every((e) => e.cathode === d[0].cathode);
  const commonAnode = d.every((e) => e.anode === d[0].anode);
  if (!commonCathode && !commonAnode) return null;
  const step = 16;
  const last = (d.length - 1) * step;
  const sy = d.length % 2 ? last / 2 : last / 2 + step / 2;
  const shared = pin(commonCathode ? d[0].cathode : d[0].anode)!;
  const own = d.map((e) => pin(commonCathode ? e.anode : e.cathode)!);
  return {
    part,
    w: SMALL,
    up: 29,
    down: last + 25,
    textW: titlesWidth(part, text),
    inline: false,
    ports: [...own.map((p, i) => ({ pin: p, side: (commonCathode ? -1 : 1) as -1 | 1, dx: commonCathode ? 0 : SMALL, dy: i * step })), { pin: shared, side: (commonCathode ? 1 : -1) as -1 | 1, dx: commonCathode ? SMALL : 0, dy: sy }],
    draw(g, x, y) {
      const L = x, R = x + SMALL, cx = x + SMALL / 2;
      // the shared pin's side has one lead; the other side has one per colour
      const busX = commonCathode ? cx + 11 : cx - 11;
      d.forEach((_, i) => {
        const yi = y + i * step;
        g.line([commonCathode ? L : busX, yi, commonCathode ? busX : R, yi]);
        diodeBody(g, cx, yi, 4.6, i === 0);
        pinName(g, commonCathode ? L : R, yi, commonCathode ? -1 : 1, own[i].label);
      });
      g.line([busX, y, busX, y + last]);
      g.line([busX, y + sy, commonCathode ? R : L, y + sy]);
      g.circle(busX, y + sy, 1.1, 'ink', 0);
      pinName(g, commonCathode ? R : L, y + sy, commonCathode ? 1 : -1, shared.label);
      titles(g, cx, y - 20, y + last + 20, part, text);
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
    g.text(cx, cy + 3.1, 'M', 9, { font: 'display', align: 'center' });
    // the horn
    g.line([cx + 6.4, cy - 6.4, cx + 13, cy - 13], 1.5);
    g.circle(cx + 13, cy - 13, 1.5, 'ink', 0);
  } else if (cls === 'relay') {
    // the coil, and the contact it moves
    g.shape([cx - 12, cy - 6, cx - 2, cy - 6, cx - 2, cy + 6, cx - 12, cy + 6], 'paper');
    g.line([cx - 12, cy + 6, cx - 2, cy - 6], 0.7);
    g.line([cx - 2, cy, cx + 3, cy], 0.6, 'soft');
    g.line([cx + 4, cy + 5, cx + 12.5, cy - 3], 1.2);
    g.circle(cx + 4, cy + 5, 1.4, 'paper');
    g.circle(cx + 13, cy - 6, 1.4, 'paper');
    g.circle(cx + 13, cy + 5, 1.4, 'paper');
  }
}
const NAME = 6.3;
function blocks(part: ProjectPart, text: SheetText): El[] {
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
  const withIcon = part.cls === 'servo' || part.cls === 'relay';
  const out: El[] = [];
  for (let k = 0; k < count; k++) {
    const l = left.slice(k * MAX_ROWS, (k + 1) * MAX_ROWS), r = right.slice(k * MAX_ROWS, (k + 1) * MAX_ROWS);
    const rows = Math.max(l.length, r.length, withIcon ? 3 : 2);
    const bodyH = rows * PITCH + 8;
    const title = part.ref + (count > 1 ? ` (${k + 1}/${count})` : '');
    const sub = fit(nameAndValue(part, text), CAP + 0.4, 150);
    const wName = (list: ProjectPin[]) => Math.max(0, ...list.map((p) => textWidth(cutTo(p.label, 18), NAME, 'mono')));
    const titleW = textWidth(title, REF + 1, 'display') + 6 + textWidth(sub, CAP + 0.4);
    const bw = Math.ceil(Math.max(84, wName(l) + wName(r) + (withIcon ? 52 : 22), Math.min(titleW, 190)));
    const dyOf = (i: number) => 4 + PITCH / 2 + i * PITCH;
    out.push({
      part,
      w: bw + 2 * STUB,
      up: 17,
      down: bodyH + 4,
      textW: titleW,
      inline: false,
      ports: [...l.map((p, i) => ({ pin: p, side: -1 as const, dx: 0, dy: dyOf(i) })), ...r.map((p, i) => ({ pin: p, side: 1 as const, dx: bw + 2 * STUB, dy: dyOf(i) }))],
      draw(g, x, y) {
        const bx = x + STUB;
        g.text(bx, y - 5.5, title, REF + 1, { font: 'display' });
        g.text(bx + textWidth(title, REF + 1, 'display') + 6, y - 5.5, sub, CAP + 0.4, { ink: 'soft' });
        g.shape(roundRect(bx, y, bw, bodyH, 3.5), 'card', 1.1);
        if (withIcon) icon(g, part.cls, bx + bw / 2 + (part.cls === 'servo' ? 6 : 0), y + bodyH / 2);
        const side = (list: ProjectPin[], dir: -1 | 1) => {
          list.forEach((p, i) => {
            const yy = y + dyOf(i);
            const edge = dir < 0 ? bx : bx + bw;
            g.text(edge - dir * 5, yy + 2.2, cutTo(p.label, 18), NAME, { font: 'mono', align: dir < 0 ? 'left' : 'right' });
            g.line([edge, yy, edge + dir * STUB, yy]);
            if (p.number !== undefined) g.text(edge + dir * STUB * 0.5, yy - 2.6, String(p.number), 4.6, { font: 'mono', align: 'center', ink: 'soft' });
          });
        };
        side(l, -1);
        side(r, 1);
      },
    });
  }
  return out;
}

const isController = (p: ProjectPart): boolean => p.cls === 'dot' || p.cls === 'board' || p.cls === 'module';
const TWO_PIN = new Set(['resistor', 'capacitor', 'capacitor-pol', 'diode', 'led', 'buzzer', 'motor', 'cell']);

/** Which way a net wants to be: supplies and driven signals on the left, ground on the right. */
function leftness(pin: ProjectPin): number {
  const net = pin.net;
  if (!net) return 3;
  if (net.kind === 'supply') return 0;
  if (net.kind === 'ground') return 5;
  return net.members.some((m) => isController(m.part)) ? 1 : 2;
}

function elementsOf(part: ProjectPart, text: SheetText, first?: ProjectPin): El[] {
  if (TWO_PIN.has(part.cls) && part.pins.length === 2) return [twoPin(part, text, first ?? part.pins[0])];
  if (part.cls === 'switch') {
    const s = switchSymbol(part, text, first);
    if (s) return [s];
  }
  if (part.cls === 'potentiometer' && part.pins.length === 3) return [potentiometer(part, text)];
  if (part.cls === 'rgb-led') {
    const s = rgbLed(part, text);
    if (s) return [s];
  }
  return blocks(part, text);
}

// ---- rows: parts in series, joined by wires -------------------------------------------------------------------------
interface Row {
  els: El[];
  /** Left pin end of each element, from the row's own left pin line. */
  xs: number[];
  /** The net of the wire after each element (to the next one). */
  links: (ProjectNet | null)[];
  leftExt: number;
  rightExt: number;
  up: number;
  down: number;
  /** Where the row belongs among the others. */
  key: number;
}
const LINK = 34;

/** A net that is nothing but the joint of two pins of row parts: drawn as a wire between them. */
function linkNet(pin: ProjectPin): ProjectNet | null {
  const net = pin.net;
  return net && net.kind === 'signal' && net.members.length === 2 && /^N\d+$/.test(net.name) ? net : null;
}

function buildRows(parts: ProjectPart[], controllers: ProjectPart[], text: SheetText): Row[] {
  // the two ends of each part that can stand in a row
  const ends = new Map<ProjectPart, [ProjectPin, ProjectPin]>();
  for (const p of parts) {
    const probe = elementsOf(p, text);
    if (probe.length === 1 && probe[0].inline) ends.set(p, [probe[0].ports[0].pin, probe[0].ports[1].pin]);
  }
  const peer = (part: ProjectPart, pin: ProjectPin): { part: ProjectPart; pin: ProjectPin } | null => {
    const net = linkNet(pin);
    const other = net?.members.find((m) => m.pin !== pin);
    if (!net || !other || other.part === part || !ends.has(other.part) || !ends.get(other.part)!.includes(other.pin)) return null;
    return other;
  };
  const used = new Set<ProjectPart>();
  const chains: { part: ProjectPart; first: ProjectPin }[][] = [];
  const walk = (start: ProjectPart, into: ProjectPin) => {
    // from `start`, entered through `into`, as far as the wires go
    const chain: { part: ProjectPart; first: ProjectPin }[] = [];
    let part = start, first = into;
    for (;;) {
      used.add(part);
      chain.push({ part, first });
      const [a, b] = ends.get(part)!;
      const out = first === a ? b : a;
      const next = peer(part, out);
      if (!next || used.has(next.part)) break;
      part = next.part;
      first = next.pin;
    }
    return chain;
  };
  for (const p of parts) {
    if (used.has(p) || !ends.has(p)) continue;
    const [a, b] = ends.get(p)!;
    const pa = peer(p, a), pb = peer(p, b);
    if (pa && pb) continue; // in the middle of a row: reached from its end
    chains.push(walk(p, pa ? b : pb ? a : leftness(a) <= leftness(b) ? a : b));
  }
  for (const p of parts) if (!used.has(p) && ends.has(p)) chains.push(walk(p, ends.get(p)![0])); // a ring of parts
  // a row reads from its source: turned round when its far end is the more source-like one
  for (const c of chains) {
    if (c.length < 2) continue;
    const head = c[0].first;
    const tailEnds = ends.get(c[c.length - 1].part)!;
    const tail = tailEnds[0] === c[c.length - 1].first ? tailEnds[1] : tailEnds[0];
    if (leftness(tail) < leftness(head)) {
      c.reverse();
      for (const x of c) {
        const [a, b] = ends.get(x.part)!;
        x.first = x.first === a ? b : a;
      }
    }
  }
  const order = new Map<ProjectPin, number>();
  controllers.forEach((c, i) => c.pins.forEach((p, j) => order.set(p, i * 1000 + j)));
  const keyOf = (els: El[]): number => {
    let best = Infinity;
    for (const el of els) {
      for (const port of el.ports) {
        const net = port.pin.net;
        if (!net) continue;
        const k = Math.min(Infinity, ...net.members.filter((m) => order.has(m.pin)).map((m) => order.get(m.pin)!));
        // what a controller's signal pin drives comes first, in the order of those pins; then what hangs on supplies only
        const rank = net.kind === 'signal' ? k : Number.isFinite(k) ? 1e6 + k : Infinity;
        if (rank < best) best = rank;
      }
    }
    return Number.isFinite(best) ? best : els.some((e) => e.ports.some((p) => p.pin.net)) ? 5e6 : 9e6;
  };
  const rows: Row[] = [];
  const add = (els: El[], links: (ProjectNet | null)[]) => {
    const xs: number[] = [];
    let x = 0;
    els.forEach((el, i) => {
      xs.push(x);
      if (i < els.length - 1) {
        const name = links[i] ? textWidth(links[i]!.name, 5.4, 'label') + 10 : 0;
        const texts = (el.textW + els[i + 1].textW) / 2 - (el.w + els[i + 1].w) / 2 + 8;
        x += el.w + Math.max(LINK, name, texts);
      }
    });
    const linked = (el: El, port: Port, i: number) => (port.side < 0 ? i > 0 : i < els.length - 1) && el.inline;
    const ext = (side: -1 | 1) => Math.max(0, ...els.flatMap((el, i) => el.ports.filter((p) => p.side === side && !linked(el, p, i)).map((p) => endExtent(p.pin) - (side < 0 ? xs[i] + p.dx : xs[els.length - 1] + els[els.length - 1].w - xs[i] - p.dx))));
    // texts wider than the symbol reach out too
    const over = (el: El) => Math.max(0, (el.textW - el.w) / 2);
    rows.push({ els, xs, links, leftExt: Math.max(ext(-1), over(els[0]) - 0), rightExt: Math.max(ext(1), over(els[els.length - 1])), up: Math.max(...els.map((e) => e.up)), down: Math.max(...els.map((e) => e.down)), key: keyOf(els) });
  };
  for (const c of chains) {
    const els = c.map((x) => elementsOf(x.part, text, x.first)[0]);
    add(els, els.map((el, i) => (i < els.length - 1 ? linkNet(el.ports[1].pin) : null)));
  }
  for (const p of parts) if (!ends.has(p)) for (const el of elementsOf(p, text)) add([el], [null]);
  // stable: rows with the same key keep the order of the parts list
  return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.key - b.r.key || a.i - b.i).map((x) => x.r);
}

// ---- the sheets ---------------------------------------------------------------------------------------------------
interface Column {
  rows: Row[];
  w: number;
  h: number;
  left: number;
}
const ROW_GAP = 12;
const COL_GAP = 40;

function columnsOf(rows: Row[], maxH: number, gap: number): Column[] {
  const cols: Column[] = [];
  let cur: Row[] = [], h = 0;
  const close = () => {
    if (!cur.length) return;
    const left = Math.max(...cur.map((r) => r.leftExt));
    const w = left + Math.max(...cur.map((r) => r.xs[r.xs.length - 1] + r.els[r.els.length - 1].w + r.rightExt));
    cols.push({ rows: cur, w, h, left });
    cur = [];
    h = 0;
  };
  for (const r of rows) {
    const rh = r.up + r.down;
    if (cur.length && h + gap + rh > maxH) close();
    h += (cur.length ? gap : 0) + rh;
    cur.push(r);
  }
  close();
  return cols;
}

interface Laid {
  sheets: { g: Pen; placed: Placed[] }[];
  fits: boolean;
}
function arrange(project: Project, text: SheetText, W: number, H: number): Laid {
  const controllers = project.parts.filter(isController);
  const others = project.parts.filter((p) => !isController(p));
  const ctlRows = buildRows(controllers, [], text).sort((a, b) => project.parts.indexOf(a.els[0].part) - project.parts.indexOf(b.els[0].part));
  const cols = [...columnsOf(ctlRows, H, 22), ...columnsOf(buildRows(others, controllers, text), H, ROW_GAP)];
  let fits = cols.every((c) => c.w <= W + 0.5 && c.h <= H + 0.5);
  // columns side by side until a sheet is full
  const groups: Column[][] = [];
  let width = 0;
  for (const c of cols) {
    const last = groups[groups.length - 1];
    if (last && width + COL_GAP + c.w <= W + 0.5) {
      last.push(c);
      width += COL_GAP + c.w;
    } else {
      groups.push([c]);
      width = c.w;
    }
  }
  if (!groups.length) groups.push([]);
  const sheets = groups.map((group) => {
    const g = new Pen();
    const placed: Placed[] = [];
    const totalW = group.reduce((s, c) => s + c.w, 0) + COL_GAP * Math.max(0, group.length - 1);
    const totalH = Math.max(0, ...group.map((c) => c.h));
    let x = Math.max(0, (W - totalW) / 2);
    const top = Math.max(0, (H - totalH) / 2);
    for (const c of group) {
      let y = top + (totalH - c.h) / 2;
      const gap = c.rows.length > 1 ? (c.h - c.rows.reduce((s, r) => s + r.up + r.down, 0)) / (c.rows.length - 1) : 0;
      for (const r of c.rows) {
        const axis = y + r.up;
        const x0 = x + c.left;
        r.els.forEach((el, i) => {
          const ex = x0 + r.xs[i];
          el.draw(g, ex, axis);
          for (const port of el.ports) {
            const linked = el.inline && (port.side < 0 ? i > 0 : i < r.els.length - 1);
            if (!linked) netEnd(g, ex + port.dx, axis + port.dy, port.side, port.pin);
          }
          if (i < r.els.length - 1) {
            // the wire to the next part in the row, with the net's name over it
            const a = ex + el.w, b = x0 + r.xs[i + 1];
            g.line([a, axis, b, axis]);
            const net = r.links[i];
            if (net) g.text((a + b) / 2, axis - 2.6, net.name, 5.4, { font: 'label', align: 'center', ink: 'net' });
          }
          const lx = Math.max(0, ...el.ports.filter((p) => p.side < 0 && !(el.inline && i > 0)).map((p) => endExtent(p.pin)), (el.textW - el.w) / 2);
          const rx = Math.max(0, ...el.ports.filter((p) => p.side > 0 && !(el.inline && i < r.els.length - 1)).map((p) => endExtent(p.pin)), (el.textW - el.w) / 2);
          placed.push({ ref: el.part.ref, x: ex - lx, y: axis - el.up, w: el.w + lx + rx, h: el.up + el.down });
        });
        y += r.up + r.down + gap;
      }
      x += c.w + COL_GAP;
    }
    return { g, placed };
  });
  if (groups.length === 1 && width > W + 0.5) fits = false;
  return { sheets, fits };
}

function frame(g: Pen, text: SheetText, n: number, m: number): void {
  const o = { x0: EDGE, y0: EDGE, x1: SHEET.w - EDGE, y1: SHEET.h - EDGE };
  g.shape([o.x0, o.y0, o.x1, o.y0, o.x1, o.y1, o.x0, o.y1], undefined, 0.6, 'line');
  g.shape([INNER.x0, INNER.y0, INNER.x1, INNER.y0, INNER.x1, INNER.y1, INNER.x0, INNER.y1], undefined, 1.1);
  // zone markers: 1 to 6 across, A to D down
  const cols = 6, rows = 4;
  for (let i = 0; i < cols; i++) {
    const xa = INNER.x0 + ((INNER.x1 - INNER.x0) * i) / cols, xb = INNER.x0 + ((INNER.x1 - INNER.x0) * (i + 1)) / cols;
    if (i) for (const [ya, yb] of [[o.y0, INNER.y0], [INNER.y1, o.y1]]) g.line([xa, ya, xa, yb], 0.6, 'line');
    for (const y of [o.y0 + BAND / 2 + 2.4, INNER.y1 + BAND / 2 + 2.4]) g.text((xa + xb) / 2, y, String(i + 1), 6.2, { font: 'mono', align: 'center', ink: 'soft' });
  }
  for (let i = 0; i < rows; i++) {
    const ya = INNER.y0 + ((INNER.y1 - INNER.y0) * i) / rows, yb = INNER.y0 + ((INNER.y1 - INNER.y0) * (i + 1)) / rows;
    if (i) for (const [xa, xb] of [[o.x0, INNER.x0], [INNER.x1, o.x1]]) g.line([xa, ya, xb, ya], 0.6, 'line');
    for (const x of [o.x0 + BAND / 2, INNER.x1 + BAND / 2]) g.text(x, (ya + yb) / 2 + 2.4, 'ABCD'[i], 6.2, { font: 'mono', align: 'center', ink: 'soft' });
  }
  // the title block
  const x0 = INNER.x1 - TB.w, y0 = INNER.y1 - TB.h, x1 = INNER.x1, y1 = INNER.y1;
  g.shape([x0, y0, x1, y0, x1, y1, x0, y1], 'cream', 1.1);
  const mid = y0 + 36;
  g.line([x0, mid, x1, mid], 0.7);
  const cell = (x: number, y: number, label: string, value: string, size: number, font: FontId, max: number) => {
    g.text(x + 8, y + 9.5, label.toUpperCase(), 4.8, { font: 'strong', ink: 'soft' });
    g.text(x + 8, y + 9.5 + size + 2.5, fit(value, size, max - 16, font), size, { font });
  };
  // maker's mark, then the project
  const brandW = 92;
  g.line([x0 + brandW, y0, x0 + brandW, mid], 0.7);
  g.circle(x0 + 14, y0 + 18, 4, 'amber', 0);
  g.text(x0 + 23, y0 + 16.5, 'KodeDot Sim', 9, { font: 'display' });
  g.text(x0 + 23, y0 + 26, text.heading, 6.4, { ink: 'soft' });
  cell(x0 + brandW, y0, text.labels.project, text.title, 11, 'display', TB.w - brandW);
  const cw = [136, 62, TB.w - 198];
  let cx = x0;
  const cells: [string, string][] = [[text.labels.date, text.date], [text.labels.rev, 'A'], [text.labels.sheet, `${n} / ${m}`]];
  cells.forEach(([label, value], i) => {
    if (i) g.line([cx, mid, cx, y1], 0.7);
    cell(cx, mid - 1.5, label, value, 7.6, 'text', cw[i]);
    cx += cw[i];
  });
}

/** A small circuit is drawn larger, as large as still fits one sheet; a crowded one a little smaller before it takes two. */
const SCALES = [2.4, 2.2, 2, 1.8, 1.6, 1.45, 1.3, 1.15, 1, 0.9, 0.8];

export function drawSchematic(project: Project, text: SheetText): Sheet[] {
  const W = AREA.x1 - AREA.x0, H = AREA.y1 - AREA.y0;
  // the largest size at which everything is on one sheet; when even the smallest takes two, natural size on several
  let k = 1;
  let laid: Laid | null = null;
  for (const s of SCALES) {
    const tried = arrange(project, text, W / s, H / s);
    if (tried.fits && tried.sheets.length === 1) {
      k = s;
      laid = tried;
      break;
    }
  }
  if (!laid) {
    const natural = arrange(project, text, W, H);
    [k, laid] = natural.fits ? [1, natural] : [0.8, arrange(project, text, W / 0.8, H / 0.8)];
  }
  if (!project.parts.length) laid.sheets[0].g.text(W / k / 2, H / k / 2, text.empty, 11 / k, { align: 'center', ink: 'soft' });
  const scaled = (op: Op): Op =>
    op.t === 'line'
      ? { ...op, pts: op.pts.map((v, i) => (i % 2 ? AREA.y0 : AREA.x0) + v * k), w: (op.w ?? 1) * Math.sqrt(k) }
      : op.t === 'circle'
        ? { ...op, x: AREA.x0 + op.x * k, y: AREA.y0 + op.y * k, r: op.r * k, w: (op.w ?? 1) * Math.sqrt(k) }
        : { ...op, x: AREA.x0 + op.x * k, y: AREA.y0 + op.y * k, size: op.size * k };
  return laid.sheets.map((s, i) => {
    const g = new Pen();
    frame(g, text, i + 1, laid.sheets.length);
    return { ops: [...s.g.ops.map(scaled), ...g.ops], placed: s.placed.map((p) => ({ ref: p.ref, x: AREA.x0 + p.x * k, y: AREA.y0 + p.y * k, w: p.w * k, h: p.h * k })), scale: k };
  });
}
export const SCHEMATIC_AREA = AREA;
