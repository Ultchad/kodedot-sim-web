/**
 * The project as a PDF, and the bench back out of one. This module (with the PDF library) is fetched only when
 * someone exports a project or opens a PDF.
 *
 * Library: @cantoo/pdf-lib, the maintained fork of pdf-lib. Pure JavaScript (no eval, no worker, no network: fine
 * under the site's CSP), and it writes and reads embedded files, which is what makes the PDF open again as a bench.
 * The text is set in the site's own fonts (project/fonts.ts), embedded here as composite TrueType fonts. The bench travels twice: as an attached file (`bench.kodedot.json`, the same
 * data "Save to a file" writes) and, without the compiled sketches, in the document's XMP metadata.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, beginText, clip, closePath, decodePDFRawStream, endPath, endText, fill, fillAndStroke, lineTo, moveText, moveTo, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setFontAndSize, setLineCap, setLineJoin, setLineWidth, setStrokingColor, showText, stroke, type PDFImage, type PDFPage, type PDFRef, type RGB } from '@cantoo/pdf-lib';
import type { Locale, TFn } from '../i18n/core';
import { face, fit, textWidth, wrap, type FontId, type Typeface } from './fonts';
import { billOfMaterials, pinText, type NetKind, type Project, type ProjectPart } from './nets';
import { SHEET, drawSchematic, type Ink, type Op } from './schematic';

export const SITE = 'kodedot.murilogp.dev';
export const ATTACHMENT = 'bench.kodedot.json';
const XMP_NS = `https://${SITE}/ns/project/1.0/`;
/** The bench is copied into the metadata only while it is small. */
const XMP_MAX = 400_000;

export interface ProjectSketch {
  /** The board's reference and name: "U1 Arduino Uno R3". */
  board: string;
  files: { name: string; text: string }[];
}
export interface ProjectPdfInput {
  title: string;
  date: Date;
  locale: Locale;
  t: TFn;
  project: Project;
  sketches: ProjectSketch[];
  /** The table as it looks now (a JPEG), when there is a picture of it. */
  picture: Uint8Array | null;
  /** The bench file, exactly as "Save to a file" writes it. */
  benchFile: string;
  /** The bench alone (no compiled sketches, no imported parts), for the metadata copy. */
  benchOnly: string;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 46;
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
/** The site's palette (design doc, "Linguagem visual"), with the lighter creams paper needs. */
const C = {
  ink: hex('#191919'),
  soft: hex('#625B54'),
  faint: hex('#DCD5CB'),
  line: hex('#B5ACA0'),
  net: hex('#02699A'),
  netFill: hex('#E3F1F8'),
  supply: hex('#C9303D'),
  paper: hex('#FFFFFF'),
  cream: hex('#F3EFE8'),
  card: hex('#FBF9F5'),
  amber: hex('#FFAC00'),
  band: hex('#EAE4DA'),
  pill: hex('#DED7CD'),
};
const INK: Record<Ink, RGB> = { ink: C.ink, soft: C.soft, faint: C.faint, line: C.line, net: C.net, netFill: C.netFill, supply: C.supply, paper: C.paper, cream: C.cream, card: C.card, amber: C.amber };

// ---- the site's fonts, embedded -------------------------------------------------------------------------------------
type Fonts = Map<FontId, { ref: PDFRef; face: Typeface }>;
const hex4 = (n: number): string => n.toString(16).padStart(4, '0').toUpperCase();
function decode64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
/** One font as a PDF composite font (glyph ids as codes), with the table that gives text back to copy and search. */
function embedFont(doc: PDFDocument, id: FontId): { ref: PDFRef; face: Typeface } {
  const f = face(id);
  const d = f.data;
  const k = 1000 / d.upm;
  const ctx = doc.context;
  const ttf = decode64(d.ttf);
  const file = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const name = `KDSIMA+${d.name}`;
  const descriptor = ctx.register(
    ctx.obj({ Type: 'FontDescriptor', FontName: name, Flags: d.fixed ? 5 : 4, FontBBox: d.bbox.map((v) => Math.round(v * k)), ItalicAngle: 0, Ascent: Math.round(d.ascent * k), Descent: Math.round(d.descent * k), CapHeight: Math.round(d.cap * k), XHeight: Math.round(d.xHeight * k), StemV: Math.round(d.stem * k), FontFile2: file }),
  );
  const cid = ctx.register(
    ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: name, CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: descriptor, DW: 1000, W: [0, d.adv.map((a) => Math.round(a * k))], CIDToGIDMap: 'Identity' }),
  );
  const byGlyph = new Map<number, number>();
  for (const [cp, g] of d.cmap) if (!byGlyph.has(g)) byGlyph.set(g, cp);
  const pairs = [...byGlyph].sort((a, b) => a[0] - b[0]);
  const chunks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.map(([g, cp]) => `<${hex4(g)}> <${hex4(cp)}>`).join('\n')}\nendbfchar`);
  }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const toUnicode = ctx.register(ctx.flateStream(cmap));
  const ref = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUnicode }));
  return { ref, face: f };
}

interface TextOpts {
  font?: FontId;
  align?: 'left' | 'center' | 'right';
  color?: RGB;
}
class Painter {
  private names = new Map<FontId, PDFName>();
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
  ) {}
  get h(): number {
    return this.page.getHeight();
  }
  get w(): number {
    return this.page.getWidth();
  }
  /** Text with its baseline at y (from the top of the page). Returns its width. */
  text(x: number, y: number, text: string, size: number, o: TextOpts = {}): number {
    const id = o.font ?? 'text';
    const f = this.fonts.get(id)!;
    const glyphs = f.face.glyphs(text);
    if (!glyphs.length) return 0;
    let name = this.names.get(id);
    if (!name) this.names.set(id, (name = this.page.node.newFontDictionary(f.face.data.name, f.ref)));
    const w = f.face.width(text, size);
    const tx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    this.page.pushOperators(pushGraphicsState(), setFillingColor(o.color ?? C.ink), beginText(), setFontAndSize(name, size), moveText(tx, this.h - y), showText(PDFHexString.of(glyphs.map(hex4).join(''))), endText(), popGraphicsState());
    return w;
  }
  path(pts: number[], o: { w?: number; color?: RGB; fill?: RGB; close?: boolean }): void {
    if (pts.length < 4) return;
    const lw = o.w ?? 1;
    const ops = [pushGraphicsState(), setLineCap(1), setLineJoin(1), setLineWidth(lw), setStrokingColor(o.color ?? C.ink)];
    if (o.fill) ops.push(setFillingColor(o.fill));
    ops.push(moveTo(pts[0], this.h - pts[1]));
    for (let i = 2; i < pts.length; i += 2) ops.push(lineTo(pts[i], this.h - pts[i + 1]));
    if (o.close) ops.push(closePath());
    ops.push(o.fill ? (lw > 0 ? fillAndStroke() : fill()) : stroke(), popGraphicsState());
    this.page.pushOperators(...ops);
  }
  /** A rectangle; `r` rounds its corners (one number, or [top, bottom]). */
  rect(x: number, y: number, w: number, h: number, o: { w?: number; color?: RGB; fill?: RGB; r?: number | [number, number] } = {}): void {
    this.path(rounded(x, y, w, h, o.r ?? 0), { w: o.w ?? 0, color: o.color, fill: o.fill, close: true });
  }
  circle(x: number, y: number, r: number, o: { w?: number; color?: RGB; fill?: RGB }): void {
    const pts: number[] = [];
    const n = r < 3 ? 14 : 32;
    for (let i = 0; i < n; i++) pts.push(x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n));
    this.path(pts, { ...o, close: true });
  }
  /** A picture inside a rectangle with round corners. */
  image(image: PDFImage, x: number, y: number, w: number, h: number, r: number): void {
    const pts = rounded(x, y, w, h, r);
    const ops = [pushGraphicsState(), moveTo(pts[0], this.h - pts[1])];
    for (let i = 2; i < pts.length; i += 2) ops.push(lineTo(pts[i], this.h - pts[i + 1]));
    ops.push(closePath(), clip(), endPath());
    this.page.pushOperators(...ops);
    this.page.drawImage(image, { x, y: this.h - y - h, width: w, height: h });
    this.page.pushOperators(popGraphicsState());
  }
  ops(ops: Op[]): void {
    for (const op of ops) {
      if (op.t === 'line') this.path(op.pts, { w: op.w, color: INK[op.ink ?? 'ink'], fill: op.fill ? INK[op.fill] : undefined, close: op.close });
      else if (op.t === 'circle') this.circle(op.x, op.y, op.r, { w: op.w, color: INK[op.ink ?? 'ink'], fill: op.fill ? INK[op.fill] : undefined });
      else this.text(op.x, op.y, op.text, op.size, { font: op.font, align: op.align, color: INK[op.ink ?? 'ink'] });
    }
  }
}
function rounded(x: number, y: number, w: number, h: number, r: number | [number, number]): number[] {
  const [rt, rb] = typeof r === 'number' ? [r, r] : r;
  if (!rt && !rb) return [x, y, x + w, y, x + w, y + h, x, y + h];
  const pts: number[] = [];
  const corner = (cx: number, cy: number, rad: number, a0: number, px: number, py: number) => {
    if (!rad) {
      pts.push(px, py);
      return;
    }
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (Math.PI / 2) * (i / 8);
      pts.push(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
  };
  const t = Math.min(rt, w / 2, h / 2), b = Math.min(rb, w / 2, h / 2);
  corner(x + w - t, y + t, t, -Math.PI / 2, x + w, y);
  corner(x + w - b, y + h - b, b, 0, x + w, y + h);
  corner(x + b, y + h - b, b, Math.PI / 2, x, y + h);
  corner(x + t, y + t, t, Math.PI, x, y);
  return pts;
}

// ---- the document -------------------------------------------------------------------------------------------------
const TOP = 96; // where a page's content starts, under its running head
const BOTTOM = A4.h - 64;
const mark = (p: Painter, x: number, y: number, size = 9.5): number => {
  p.circle(x + size * 0.36, y - size * 0.34, size * 0.36, { w: 0, fill: C.amber });
  return size * 0.95 + p.text(x + size * 0.95, y, 'KodeDot Sim', size, { font: 'display' });
};

class Book {
  /** Portrait pages with the name of their section, for the running head and foot. */
  readonly pages: { p: Painter; section: string }[] = [];
  /** First page of each section, by its name (pages counted from the cover as 1). */
  readonly starts = new Map<string, number>();
  /** The schematic sheets (landscape). */
  readonly sheets: Painter[] = [];
  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly input: ProjectPdfInput,
  ) {}
  begin(section: string): void {
    if (!this.starts.has(section)) this.starts.set(section, this.doc.getPageCount() + 2);
  }
  /** A page of a section: its heading the first time, "(continued)" after; returns where the content starts. */
  section(title: string): { p: Painter; y: number } {
    const first = !this.starts.has(title);
    this.begin(title);
    const p = new Painter(this.doc.addPage([A4.w, A4.h]), this.fonts);
    this.pages.push({ p, section: title });
    p.rect(M, TOP - 22, 30, 4, { fill: C.amber, r: 2 });
    const w = p.text(M, TOP + 12, title, 23, { font: 'display' });
    if (!first) p.text(M + w + 8, TOP + 12, this.input.t('project.pdf.continued'), 9.5, { color: C.soft });
    return { p, y: TOP + 38 };
  }
  /** The running head and foot, the same on every page. */
  chrome(): void {
    const all = this.doc.getPages();
    const total = all.length;
    const foot = (p: Painter, n: number, section: string) => {
      const y = p.h - 30;
      p.text(M, y, section, 8, { color: C.soft });
      p.text(p.w / 2, y, SITE, 8, { align: 'center', color: C.soft });
      const tw = p.text(p.w - M, y, `${n} / ${total}`, 8, { font: 'strong', align: 'right' });
      p.text(p.w - M - tw - 5, y, this.input.t('project.pdf.page'), 8, { align: 'right', color: C.soft });
    };
    for (const { p, section } of this.pages) {
      const n = all.indexOf(p.page) + 1;
      if (n > 1) {
        mark(p, M, 44);
        p.text(A4.w - M, 44, fit(this.input.title, 8.5, 300), 8.5, { align: 'right', color: C.soft });
        p.path([M, 56, A4.w - M, 56], { w: 0.6, color: C.faint });
      }
      p.path([M, p.h - 44, p.w - M, p.h - 44], { w: 0.6, color: C.faint });
      foot(p, n, section);
    }
  }
}

function pill(p: Painter, x: number, y: number, value: string, label: string): number {
  const size = 9.6;
  const wv = textWidth(value, size + 1, 'display'), wl = textWidth(label, size, 'text');
  const w = 13 + wv + 5 + wl + 13;
  p.rect(x, y, w, 24, { fill: C.paper, r: 12 });
  p.text(x + 13, y + 16, value, size + 1, { font: 'display' });
  p.text(x + 13 + wv + 5, y + 15.8, label, size, { color: C.soft });
  return w;
}

function cover(b: Book, image: PDFImage | null, contents: { name: string; page: number }[]): void {
  const { t, title, date, locale, project } = b.input;
  const p = new Painter(b.doc.insertPage(0, [A4.w, A4.h]), b.fonts);
  b.pages.unshift({ p, section: t('project.pdf.kicker') });
  const boxW = A4.w - 2 * M;
  // the band: maker's mark, what this is, the title, the date, the counts
  const lines = wrap(title, 36, boxW, 'display').slice(0, 2);
  const size = lines.length > 1 ? 30 : 36;
  const titleLines = lines.length > 1 ? wrap(title, size, boxW, 'display').slice(0, 2) : lines;
  const bandH = 190 + titleLines.length * (size + 5) + (image ? 46 : 0);
  p.rect(0, 0, A4.w, bandH, { fill: C.band });
  mark(p, M, 52, 11);
  p.text(A4.w - M, 52, SITE, 9, { align: 'right', color: C.soft });
  const kicker = t('project.pdf.kicker').toUpperCase();
  const kw = textWidth(kicker, 8, 'strong') + 22;
  p.rect(M, 86, kw, 19, { fill: C.amber, r: 9.5 });
  p.text(M + 11, 99, kicker, 8, { font: 'strong' });
  let y = 108 + size;
  for (const line of titleLines) {
    p.text(M, y, fit(line, size, boxW, 'display'), size, { font: 'display' });
    y += size + 5;
  }
  y += 2;
  p.text(M, y, new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date), 11, { color: C.soft });
  y += 18;
  const sketches = b.input.sketches.length;
  const split = (key: 'project.pdf.count.parts' | 'project.pdf.count.nets' | 'project.pdf.count.wires' | 'project.pdf.count.sketches', count: number): [string, string] => {
    const s = t(key, { count });
    const m = /^(\S+)\s+(.*)$/.exec(s);
    return m ? [m[1], m[2]] : [String(count), s];
  };
  const facts: [string, string][] = [split('project.pdf.count.parts', project.parts.length + project.joiners.length), split('project.pdf.count.nets', project.nets.length), split('project.pdf.count.wires', project.wires), ...(sketches ? [split('project.pdf.count.sketches', sketches)] : [])];
  let px = M;
  for (const [value, label] of facts) px += pill(p, px, y, value, label) + 8;
  y += 24;
  // the picture stands half on the band
  y = bandH - (image ? 46 : 0) + (image ? 0 : 30);
  if (image) {
    const k = Math.min(boxW / image.width, 330 / image.height);
    const w = image.width * k, h = image.height * k;
    const x = M + (boxW - w) / 2;
    p.image(image, x, y, w, h, 14);
    p.path(rounded(x, y, w, h, 14), { w: 0.8, color: C.line, close: true });
    y += h + 30;
  }
  // what the project is built around
  const boards = project.parts.filter((x) => x.cls === 'dot' || x.cls === 'board' || x.cls === 'module').map((x) => nameOf(x, locale));
  if (boards.length) {
    const label = `${t('project.pdf.around')}  `;
    const lw = p.text(M, y, label, 10.5, { color: C.soft });
    p.text(M + lw, y, fit([...new Set(boards)].join('  ·  '), 10.5, boxW - lw, 'strong'), 10.5, { font: 'strong' });
    y += 30;
  }
  // contents on the left, how to get the bench back on the right
  const colL = 218, gap = 26, colR = boxW - colL - gap;
  p.text(M, y + 10, t('project.pdf.contents'), 13, { font: 'display' });
  let cy = y + 32;
  for (const c of contents) {
    const nw = p.text(M, cy, c.name, 10.5);
    const pw = p.text(M + colL, cy, String(c.page), 10.5, { font: 'strong', align: 'right' });
    for (let x = M + nw + 6; x < M + colL - pw - 6; x += 4) p.circle(x, cy - 1.4, 0.45, { w: 0, fill: C.line });
    cy += 19;
  }
  const text = wrap(t('project.pdf.rebuild', { site: SITE, open: t('benchfile.open'), bench: t('nav.bench') }), 9.6, colR - 34);
  const h = 40 + text.length * 13.6 + 8;
  const rx = M + colL + gap;
  p.rect(rx, y - 6, colR, h, { fill: C.cream, r: 10 });
  p.rect(rx, y - 6, 5, h, { fill: C.amber, r: 2.5 });
  p.text(rx + 20, y + 16, t('project.pdf.rebuild.h'), 12, { font: 'display' });
  text.forEach((l, i) => p.text(rx + 20, y + 35 + i * 13.6, l, 9.6));
}

function schematicPages(b: Book): void {
  const { t, title, date, locale, project } = b.input;
  b.begin(t('project.pdf.schematic'));
  const sheets = drawSchematic(project, {
    title,
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date),
    heading: t('project.pdf.schematic'),
    labels: { project: t('project.pdf.tb.project'), date: t('project.pdf.tb.date'), sheet: t('project.pdf.tb.sheet'), rev: t('project.pdf.tb.rev') },
    name: (part) => nameOf(part, locale),
    empty: t('project.pdf.empty'),
  });
  for (const s of sheets) {
    const p = new Painter(b.doc.addPage([SHEET.w, SHEET.h]), b.fonts);
    p.ops(s.ops);
    b.sheets.push(p);
  }
}
export const nameOf = (part: ProjectPart, locale: Locale): string => (part.names as Record<string, string | undefined>)[locale] ?? part.names.en;

interface Col {
  x: number;
  w: number;
  font?: FontId;
  size?: number;
  align?: 'right';
  color?: (row: number) => RGB;
}
/** A table that runs over as many pages as it needs: a dark header row, cream on every other row; cells wrap. */
function table(b: Book, title: string, head: string[], cols: Col[], rows: string[][], o: { tick?: boolean; note?: string } = {}): void {
  let { p, y } = b.section(title);
  const lead = 13.2;
  const x0 = M, x1 = A4.w - M;
  if (o.note) {
    for (const l of wrap(o.note, 10, x1 - x0)) {
      p.text(M, y, l, 10, { color: C.soft });
      y += 14.5;
    }
    y += 12;
  }
  const header = () => {
    p.rect(x0, y, x1 - x0, 24, { fill: C.ink, r: [7, 0] });
    head.forEach((h, i) => p.text(cols[i].align ? cols[i].x + cols[i].w : cols[i].x, y + 15.2, h.toUpperCase(), 7.2, { font: 'strong', color: C.paper, align: cols[i].align }));
    y += 24;
  };
  header();
  if (!rows.length) {
    p.rect(x0, y, x1 - x0, 34, { fill: C.cream, r: [0, 7] });
    p.text(M + 14, y + 21, b.input.t('project.pdf.none'), 10, { color: C.soft });
    return;
  }
  let stripe = 0;
  rows.forEach((row, n) => {
    const cells = row.map((c, i) => wrap(c, cols[i].size ?? 9.6, cols[i].w, cols[i].font));
    const h = Math.max(1, ...cells.map((c) => c.length)) * lead + 11;
    if (y + h > BOTTOM) {
      p.path([x0, y, x1, y], { w: 0.8, color: C.line });
      ({ p, y } = b.section(title));
      header();
      stripe = 0;
    }
    if (stripe++ % 2 === 1) p.rect(x0, y, x1 - x0, h, { fill: C.cream });
    if (o.tick) p.rect(x0 + 12, y + h / 2 - 5, 10, 10, { w: 0.9, color: C.soft, fill: C.paper, r: 2.2 });
    cells.forEach((c, i) => c.forEach((l, k) => p.text(cols[i].align ? cols[i].x + cols[i].w : cols[i].x, y + 16.4 + k * lead, l, cols[i].size ?? 9.6, { font: cols[i].font, align: cols[i].align, color: cols[i].color?.(n) })));
    y += h;
  });
  p.path([x0, y, x1, y], { w: 0.8, color: C.line });
}
const netColor = (kind: NetKind): RGB => (kind === 'supply' ? C.supply : kind === 'ground' ? C.ink : C.net);

function netsPage(b: Book): void {
  const { t, project } = b.input;
  const rows = project.nets.map((n) => ['', n.name, n.members.map((m) => pinText(m.part, m.pin)).join(',  '), String(n.members.length)]);
  const w = A4.w - 2 * M;
  table(
    b,
    t('project.pdf.nets'),
    ['', t('project.pdf.col.net'), t('project.pdf.col.joins'), t('project.pdf.col.pins')],
    [
      { x: M, w: 24 },
      { x: M + 36, w: 96, font: 'label', size: 9.4, color: (i) => netColor(project.nets[i].kind) },
      { x: M + 146, w: w - 146 - 60, font: 'mono', size: 9.2 },
      { x: M + w - 50, w: 36, align: 'right' },
    ],
    rows,
    { tick: true, note: t('project.pdf.nets.note') },
  );
}
function bomPage(b: Book): void {
  const { t, project, locale } = b.input;
  const rows = billOfMaterials(project).map((l) => [l.refs.join(', '), nameOf(l.part, locale), l.value || '–', String(l.qty)]);
  if (project.wires) rows.push(['–', t('project.pdf.jumpers'), '–', String(project.wires)]);
  const w = A4.w - 2 * M;
  table(
    b,
    t('project.pdf.bom'),
    [t('project.pdf.col.ref'), t('project.pdf.col.part'), t('project.pdf.col.value'), t('project.pdf.col.qty')],
    [
      { x: M + 14, w: 96, font: 'label', size: 9.4 },
      { x: M + 124, w: 210 },
      { x: M + 348, w: 90 },
      { x: M + w - 50, w: 36, align: 'right' },
    ],
    rows,
  );
}

function codePages(b: Book): void {
  const { t } = b.input;
  if (!b.input.sketches.length) return;
  const title = t('project.pdf.code');
  const size = 8.4, lead = 11.6;
  const gutter = 34;
  const x0 = M, x1 = A4.w - M;
  const max = Math.floor((x1 - x0 - gutter - 18) / textWidth('m', size, 'mono'));
  let { p, y } = b.section(title);
  for (const s of b.input.sketches) {
    for (const file of s.files) {
      // every printed line: its number (none for the rest of a wrapped line) and its text
      const lines: { n: number | null; text: string }[] = [];
      file.text
        .replace(/\r\n?/g, '\n')
        .replace(/\n+$/, '')
        .split('\n')
        .forEach((raw, i) => {
          const line = raw.replace(/\t/g, '  ');
          const indent = /^ */.exec(line)![0].length;
          let rest = line, first = true;
          do {
            const room = first ? max : max - Math.min(indent + 2, 24);
            let cutAt = rest.length <= room ? rest.length : rest.lastIndexOf(' ', room);
            if (cutAt < room * 0.5) cutAt = Math.min(rest.length, room);
            lines.push({ n: first ? i + 1 : null, text: first ? rest.slice(0, cutAt) : ' '.repeat(Math.min(indent + 2, 24)) + rest.slice(0, cutAt) });
            rest = rest.slice(cutAt).replace(/^ +/, '');
            first = false;
          } while (rest.length);
        });
      let at = 0;
      let opening = true;
      while (at < lines.length || opening) {
        const headH = 26;
        if (y + headH + 3 * lead + 16 > BOTTOM) ({ p, y } = b.section(title));
        const fits = Math.max(1, Math.floor((BOTTOM - y - headH - 16) / lead));
        const part = lines.slice(at, at + fits);
        const bodyH = part.length * lead + 16;
        // the file's name on a dark tab, the code on a light panel with its line numbers in a gutter
        p.rect(x0, y, x1 - x0, headH, { fill: C.ink, r: [8, 0] });
        p.text(x0 + 14, y + 16.6, file.name, 9.6, { font: 'label', color: C.paper });
        p.text(x1 - 14, y + 16.4, opening ? s.board : `${s.board}  ${t('project.pdf.continued')}`, 8.6, { align: 'right', color: C.pill });
        y += headH;
        p.rect(x0, y, x1 - x0, bodyH, { fill: C.card, r: [0, 8] });
        p.rect(x0, y, gutter, bodyH, { fill: C.cream, r: [0, 0] });
        p.path(rounded(x0, y - headH, x1 - x0, headH + bodyH, 8), { w: 0.7, color: C.line, close: true });
        part.forEach((l, i) => {
          const ly = y + 8 + (i + 1) * lead - 3;
          if (l.n !== null) p.text(x0 + gutter - 8, ly, String(l.n), 7, { font: 'mono', align: 'right', color: C.soft });
          else p.text(x0 + gutter - 8, ly, '»', 7, { font: 'mono', align: 'right', color: C.line });
          p.text(x0 + gutter + 10, ly, l.text, size, { font: 'mono' });
        });
        y += bodyH + 18;
        at += part.length;
        opening = false;
      }
    }
  }
}

const xmlEscape = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array {
  const s = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function xmp(title: string, date: Date, bench: string | null): string {
  const iso = date.toISOString();
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:kodedot="${XMP_NS}">`,
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>`,
    '<xmp:CreatorTool>KodeDot Sim</xmp:CreatorTool>',
    `<xmp:CreateDate>${iso}</xmp:CreateDate>`,
    '<pdf:Producer>KodeDot Sim</pdf:Producer>',
    ...(bench ? [`<kodedot:bench>${toBase64(new TextEncoder().encode(bench))}</kodedot:bench>`] : []),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

export async function makeProjectPdf(input: ProjectPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = new Map((['display', 'text', 'strong', 'mono', 'label'] as FontId[]).map((id) => [id, embedFont(doc, id)]));
  let image: PDFImage | null = null;
  if (input.picture) {
    try {
      image = await doc.embedJpg(input.picture);
    } catch {
      image = null; // the cover goes without its picture
    }
  }
  const { t } = input;
  const b = new Book(doc, fonts, input);
  schematicPages(b);
  netsPage(b);
  bomPage(b);
  codePages(b);
  const sections = [t('project.pdf.schematic'), t('project.pdf.nets'), t('project.pdf.bom'), ...(input.sketches.length ? [t('project.pdf.code')] : [])];
  cover(b, image, sections.map((name) => ({ name, page: b.starts.get(name) ?? 0 })));
  b.chrome();
  // the schematic sheets carry the same foot, small, under their frame
  const all = doc.getPages();
  for (const p of b.sheets) {
    const y = SHEET.h - 9;
    p.text(22, y, `KodeDot Sim  ·  ${SITE}`, 6.6, { color: C.soft });
    p.text(SHEET.w - 22, y, `${t('project.pdf.page')} ${all.indexOf(p.page) + 1} / ${all.length}`, 6.6, { align: 'right', color: C.soft });
  }

  doc.setTitle(input.title);
  doc.setSubject(t('project.pdf.subject'));
  doc.setCreator('KodeDot Sim');
  doc.setProducer(`KodeDot Sim (${SITE})`);
  doc.setKeywords(['KodeDot Sim', 'Kode Dot', 'schematic']);
  doc.setCreationDate(input.date);
  doc.setModificationDate(input.date);
  doc.setLanguage(input.locale);
  await doc.attach(new TextEncoder().encode(input.benchFile), ATTACHMENT, {
    mimeType: 'application/json',
    description: t('project.pdf.attachment'),
    creationDate: input.date,
    modificationDate: input.date,
  });
  const packet = xmp(input.title, input.date, input.benchOnly.length <= XMP_MAX ? input.benchOnly : null);
  const meta = doc.context.stream(new TextEncoder().encode(packet), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(meta));
  return doc.save();
}

// ---- the bench back out of a PDF ------------------------------------------------------------------------------------
export class ProjectPdfError extends Error {
  /** `none`: a PDF with no bench in it. `unreadable`: not a PDF this page can read. */
  constructor(readonly reason: 'none' | 'unreadable') {
    super(reason);
  }
}
export interface BenchFileData {
  format: string;
  version?: number;
  bench: unknown;
  extras?: unknown;
}
const streamBytes = (s: PDFStream): Uint8Array => (s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents());
const nameText = (n: unknown): string => (n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : '');

/** Every embedded file of a document: its name tree may be flat (as this page writes it) or nested (after another tool saved it). */
function embeddedFiles(doc: PDFDocument): { name: string; bytes: Uint8Array }[] {
  const out: { name: string; bytes: Uint8Array }[] = [];
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const root = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const walk = (node: PDFDict | undefined, depth: number) => {
    if (!node || depth > 8) return;
    const leaf = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (leaf) {
      for (let i = 0; i + 1 < leaf.size(); i += 2) {
        try {
          const spec = leaf.lookupMaybe(i + 1, PDFDict);
          const ef = spec?.lookupMaybe(PDFName.of('EF'), PDFDict);
          const stream = ef?.lookup(PDFName.of('F')) ?? ef?.lookup(PDFName.of('UF'));
          if (stream instanceof PDFStream) out.push({ name: nameText(spec?.lookup(PDFName.of('UF'))) || nameText(spec?.lookup(PDFName.of('F'))) || nameText(leaf.lookup(i)), bytes: streamBytes(stream) });
        } catch {
          /* one unreadable file does not hide the others */
        }
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookupMaybe(i, PDFDict), depth + 1);
  };
  walk(root, 0);
  return out;
}
function parseBench(text: string): BenchFileData | null {
  try {
    const data = JSON.parse(text) as BenchFileData;
    return data && data.format === 'kodedot-bench' && data.bench ? data : null;
  } catch {
    return null;
  }
}

/** The bench file inside a project PDF. Throws ProjectPdfError when there is none or the file cannot be read. */
export async function readProjectPdf(bytes: Uint8Array): Promise<{ data: BenchFileData; from: 'attachment' | 'metadata'; title: string | null }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    throw new ProjectPdfError('unreadable');
  }
  let title: string | null = null;
  try {
    title = doc.getTitle() ?? null;
  } catch {
    /* no title */
  }
  let files: { name: string; bytes: Uint8Array }[] = [];
  try {
    files = embeddedFiles(doc);
  } catch {
    files = [];
  }
  // the file with our name first, then any other attachment that is a bench
  files.sort((a, b) => Number(b.name === ATTACHMENT) - Number(a.name === ATTACHMENT));
  for (const file of files) {
    if (file.bytes.length > 64 * 1024 * 1024) continue;
    const data = parseBench(new TextDecoder().decode(file.bytes));
    if (data) return { data, from: 'attachment', title };
  }
  try {
    const meta = doc.catalog.lookup(PDFName.of('Metadata'));
    if (meta instanceof PDFStream) {
      const m = /<kodedot:bench>([A-Za-z0-9+/=\s]+)<\/kodedot:bench>/.exec(new TextDecoder().decode(streamBytes(meta)));
      const bench = m ? JSON.parse(new TextDecoder().decode(fromBase64(m[1]))) : null;
      if (bench && typeof bench === 'object') return { data: { format: 'kodedot-bench', version: 1, bench }, from: 'metadata', title };
    }
  } catch {
    /* no copy in the metadata */
  }
  throw new ProjectPdfError('none');
}

/** True for the first bytes of a PDF file. */
export const isPdf = (bytes: Uint8Array): boolean => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
