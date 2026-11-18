/**
 * The typefaces of the project PDF: the site's own (Outfit for headings, DM Sans for text, DM Mono for code, pin names
 * and net labels), from project/fontdata.ts. Pure: measuring needs no PDF library, so the schematic can be laid out
 * with real widths.
 */
import { FONT_DATA, type FontData, type FontId } from './fontdata';

export type { FontId } from './fontdata';

/** What the fonts lack, written with what they have. */
const SWAP: Record<string, string> = {
  'Ω': 'Ω',
  'μ': 'µ',
  '‑': '-',
  '−': '-',
  '→': '->',
  '←': '<-',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '\t': '  ',
};

export class Typeface {
  readonly data: FontData;
  private gid = new Map<number, number>();
  private missing: number;
  constructor(readonly id: FontId) {
    this.data = FONT_DATA[id];
    for (const [cp, g] of this.data.cmap) this.gid.set(cp, g);
    this.missing = this.gid.get(0x3f) ?? 0;
  }
  /** Glyph ids of a text; a character no font has becomes "?", control characters are dropped. */
  glyphs(text: string): number[] {
    const out: number[] = [];
    for (const raw of text) {
      for (const ch of SWAP[raw] ?? raw) {
        const cp = ch.codePointAt(0)!;
        if (cp < 32 || cp === 127) continue;
        out.push(this.gid.get(cp) ?? this.missing);
      }
    }
    return out;
  }
  width(text: string, size: number): number {
    let w = 0;
    for (const g of this.glyphs(text)) w += this.data.adv[g];
    return (w * size) / this.data.upm;
  }
  /** Height of the capitals at a size. */
  cap(size: number): number {
    return (this.data.cap * size) / this.data.upm;
  }
}

const faces = new Map<FontId, Typeface>();
export function face(id: FontId): Typeface {
  let f = faces.get(id);
  if (!f) faces.set(id, (f = new Typeface(id)));
  return f;
}
export const textWidth = (text: string, size: number, font: FontId = 'text'): number => face(font).width(text, size);

/** A text cut to a width, with an ellipsis when something had to go. */
export function fit(text: string, size: number, max: number, font: FontId = 'text'): string {
  if (textWidth(text, size, font) <= max) return text;
  let n = text.length;
  while (n > 1 && textWidth(`${text.slice(0, n).trimEnd()}…`, size, font) > max) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}
/** Breaks a text into lines no wider than `max`; a word longer than a line is cut. */
export function wrap(text: string, size: number, max: number, font: FontId = 'text'): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (textWidth(w, size, font) > max && w.length > 1) {
      let n = w.length - 1;
      while (n > 1 && textWidth(w.slice(0, n), size, font) > max) n--;
      if (line) lines.push(line);
      line = '';
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size, font) > max && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
