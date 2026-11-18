/**
 * The project as a PDF, and the bench back out of one. This module (with the PDF library) is fetched only when
 * someone exports a project or opens a PDF.
 *
 * Library: @cantoo/pdf-lib, the maintained fork of pdf-lib. Pure JavaScript (no eval, no worker, no network: fine
 * under the site's CSP), the standard 14 fonts need no font file, and it writes and reads embedded files, which is what
 * makes the PDF open again as a bench. The bench travels twice: as an attached file (`bench.kodedot.json`, the same
 * data "Save to a file" writes) and, without the compiled sketches, in the document's XMP metadata.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, StandardFonts, closePath, decodePDFRawStream, fill, fillAndStroke, lineTo, moveTo, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setLineCap, setLineJoin, setLineWidth, setStrokingColor, stroke, type PDFFont, type PDFImage, type PDFPage, type RGB } from '@cantoo/pdf-lib';
import type { Locale, TFn } from '../i18n/core';
import { billOfMaterials, pinText, type Project, type ProjectPart } from './nets';
import { SHEET, drawSchematic, type Font, type Ink, type Op } from './schematic';

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
const M = 48;
const INK: Record<Ink, RGB> = {
  ink: rgb(0.098, 0.098, 0.098),
  soft: rgb(0.36, 0.34, 0.32),
  faint: rgb(0.8, 0.78, 0.75),
  net: rgb(0.0, 0.42, 0.62),
  supply: rgb(0.74, 0.15, 0.2),
  paper: rgb(1, 1, 1),
};
const AMBER = rgb(1, 0.675, 0);
const CREAM = rgb(0.955, 0.94, 0.915);

// ---- text the standard fonts can write ---------------------------------------------------------------------------
interface Fonts {
  sans: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  symbol: PDFFont;
  sets: Map<PDFFont, Set<number>>;
}
const SWAP: Record<string, string> = { 'Ω': 'Ω', 'μ': 'µ', '‑': '-', ' ': ' ', '\t': '  ', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≠': '!=' };
interface Run {
  font: PDFFont;
  text: string;
}
/** Splits a text into runs each font can encode: Greek letters come from Symbol, what no font has becomes "?". */
function runsOf(f: Fonts, font: PDFFont, text: string): Run[] {
  const out: Run[] = [];
  const main = f.sets.get(font)!, sym = f.sets.get(f.symbol)!;
  const push = (ft: PDFFont, ch: string) => {
    const last = out[out.length - 1];
    if (last && last.font === ft) last.text += ch;
    else out.push({ font: ft, text: ch });
  };
  for (const raw of text) {
    for (const ch of SWAP[raw] ?? raw) {
      const cp = ch.codePointAt(0)!;
      if (cp < 32 || cp === 127) continue;
      // the micro sign too comes from Symbol: some viewers' stand-in for Helvetica has no glyph for it
      if (cp === 0xb5 && sym.has(cp)) push(f.symbol, ch);
      else if (main.has(cp)) push(font, ch);
      else if (sym.has(cp)) push(f.symbol, ch);
      else if (cp === 0x2126 && sym.has(0x3a9)) push(f.symbol, 'Ω');
      else push(font, '?');
    }
  }
  return out;
}
const widthOfRuns = (runs: Run[], size: number): number => runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

class Painter {
  constructor(
    readonly page: PDFPage,
    readonly f: Fonts,
  ) {}
  get h(): number {
    return this.page.getHeight();
  }
  font(name: Font | undefined): PDFFont {
    return name === 'bold' ? this.f.bold : name === 'mono' ? this.f.mono : this.f.sans;
  }
  width(text: string, size: number, font?: Font): number {
    return widthOfRuns(runsOf(this.f, this.font(font), text), size);
  }
  /** Text with its baseline at y (from the top of the page). */
  text(x: number, y: number, text: string, size: number, o: { font?: Font; align?: 'left' | 'center' | 'right'; color?: RGB } = {}): number {
    const runs = runsOf(this.f, this.font(o.font), text);
    const w = widthOfRuns(runs, size);
    let cx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    for (const r of runs) {
      this.page.drawText(r.text, { x: cx, y: this.h - y, size, font: r.font, color: o.color ?? INK.ink });
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
    return w;
  }
  path(pts: number[], o: { w?: number; color?: RGB; fill?: RGB; close?: boolean }): void {
    if (pts.length < 4) return;
    const ops = [pushGraphicsState(), setLineCap(1), setLineJoin(1), setLineWidth(o.w ?? 1), setStrokingColor(o.color ?? INK.ink)];
    if (o.fill) ops.push(setFillingColor(o.fill));
    ops.push(moveTo(pts[0], this.h - pts[1]));
    for (let i = 2; i < pts.length; i += 2) ops.push(lineTo(pts[i], this.h - pts[i + 1]));
    if (o.close) ops.push(closePath());
    ops.push(o.fill ? ((o.w ?? 1) > 0 ? fillAndStroke() : fill()) : stroke(), popGraphicsState());
    this.page.pushOperators(...ops);
  }
  rect(x: number, y: number, w: number, h: number, o: { w?: number; color?: RGB; fill?: RGB }): void {
    this.path([x, y, x + w, y, x + w, y + h, x, y + h], { ...o, close: true });
  }
  circle(x: number, y: number, r: number, o: { w?: number; color?: RGB; fill?: RGB }): void {
    const pts: number[] = [];
    const n = r < 3 ? 12 : 28;
    for (let i = 0; i < n; i++) pts.push(x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n));
    this.path(pts, { ...o, close: true });
  }
  ops(ops: Op[]): void {
    for (const op of ops) {
      if (op.t === 'line') this.path(op.pts, { w: op.w, color: INK[op.ink ?? 'ink'], fill: op.fill ? INK[op.fill] : undefined, close: op.close });
      else if (op.t === 'circle') this.circle(op.x, op.y, op.r, { w: op.w, color: INK[op.ink ?? 'ink'], fill: op.fill ? INK[op.fill] : undefined });
      else this.text(op.x, op.y, op.text, op.size, { font: op.font, align: op.align, color: INK[op.ink ?? 'ink'] });
    }
  }
  /** Breaks a text into lines no wider than `max`; a word longer than a line is cut. */
  wrap(text: string, size: number, max: number, font?: Font): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (this.width(w, size, font) > max) {
        let n = w.length - 1;
        while (n > 1 && this.width(w.slice(0, n), size, font) > max) n--;
        if (line) lines.push(line);
        line = '';
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = line ? `${line} ${w}` : w;
      if (this.width(next, size, font) > max && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
}

// ---- the document -------------------------------------------------------------------------------------------------
class Book {
  readonly portrait: Painter[] = [];
  constructor(
    readonly doc: PDFDocument,
    readonly f: Fonts,
    readonly input: ProjectPdfInput,
  ) {}
  page(): Painter {
    const p = new Painter(this.doc.addPage([A4.w, A4.h]), this.f);
    this.portrait.push(p);
    return p;
  }
  /** A page with a section heading; returns the painter and where the content starts. */
  section(title: string, more = false): { p: Painter; y: number } {
    const p = this.page();
    p.rect(M, M, 26, 4, { w: 0, fill: AMBER });
    p.text(M, M + 28, title, 18, { font: 'bold' });
    if (more) p.text(M + p.width(title, 18, 'bold') + 8, M + 28, this.input.t('project.pdf.continued'), 9, { color: INK.soft });
    return { p, y: M + 52 };
  }
  footers(): void {
    const all = this.doc.getPages();
    for (const p of this.portrait) {
      const y = A4.h - 30;
      p.path([M, y - 12, A4.w - M, y - 12], { w: 0.5, color: INK.faint });
      p.text(M, y, clip(p, this.input.title, 8, 190), 8, { color: INK.soft });
      p.text(A4.w / 2, y, `${this.input.t('project.pdf.made')}  ·  ${SITE}`, 8, { align: 'center', color: INK.soft });
      p.text(A4.w - M, y, `${all.indexOf(p.page) + 1} / ${all.length}`, 8, { align: 'right', color: INK.soft });
    }
  }
}
function clip(p: Painter, text: string, size: number, max: number, font?: Font): string {
  if (p.width(text, size, font) <= max) return text;
  let n = text.length;
  while (n > 1 && p.width(`${text.slice(0, n)}…`, size, font) > max) n--;
  return `${text.slice(0, n)}…`;
}
const BOTTOM = A4.h - 60;

function cover(b: Book, image: PDFImage | null): void {
  const { t, title, date, locale, project } = b.input;
  const p = b.page();
  p.rect(M, M, 60, 6, { w: 0, fill: AMBER });
  p.text(M, M + 30, t('project.pdf.kicker').toUpperCase(), 9.5, { font: 'bold', color: INK.soft });
  let y = M + 64;
  for (const line of p.wrap(title, 30, A4.w - 2 * M, 'bold').slice(0, 3)) {
    p.text(M, y, line, 30, { font: 'bold' });
    y += 35;
  }
  p.text(M, y - 10, new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date), 11, { color: INK.soft });
  y += 12;
  const boxW = A4.w - 2 * M;
  if (image) {
    const k = Math.min(boxW / image.width, 360 / image.height);
    const w = image.width * k, h = image.height * k;
    const x = M + (boxW - w) / 2;
    p.page.drawImage(image, { x, y: p.h - y - h, width: w, height: h });
    p.rect(x, y, w, h, { w: 0.6, color: INK.faint });
    y += h + 22;
  }
  const sketches = b.input.sketches.length;
  const facts = [
    t('project.pdf.count.parts', { count: project.parts.length + project.joiners.length }),
    t('project.pdf.count.nets', { count: project.nets.length }),
    t('project.pdf.count.wires', { count: project.wires }),
    ...(sketches ? [t('project.pdf.count.sketches', { count: sketches })] : []),
  ];
  p.text(M, y, facts.join('   ·   '), 10.5, { font: 'bold' });
  y += 24;
  // what is inside, then how to get the bench back
  const inside = [t('project.pdf.schematic'), t('project.pdf.nets'), t('project.pdf.bom'), ...(sketches ? [t('project.pdf.code')] : [])];
  p.text(M, y, `${t('project.pdf.inside')}: ${inside.join(', ')}.`, 10, { color: INK.soft });
  y += 26;
  const lines = p.wrap(t('project.pdf.rebuild', { site: SITE, open: t('benchfile.open'), bench: t('nav.bench') }), 10, boxW - 32);
  const h = 34 + lines.length * 14;
  p.rect(M, y, boxW, h, { w: 0, fill: CREAM });
  p.rect(M, y, 4, h, { w: 0, fill: AMBER });
  p.text(M + 18, y + 19, t('project.pdf.rebuild.h'), 11, { font: 'bold' });
  lines.forEach((l, i) => p.text(M + 18, y + 36 + i * 14, l, 10));
}

function schematicPages(b: Book): void {
  const { t, title, date, locale, project } = b.input;
  const sheets = drawSchematic(project, {
    title,
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date),
    heading: t('project.pdf.schematic'),
    sheet: (n, m) => t('project.pdf.sheet', { n, m }),
    name: (part) => nameOf(part, locale),
    empty: t('project.pdf.empty'),
  });
  for (const s of sheets) new Painter(b.doc.addPage([SHEET.w, SHEET.h]), b.f).ops(s.ops);
}
export const nameOf = (part: ProjectPart, locale: Locale): string => (part.names as Record<string, string | undefined>)[locale] ?? part.names.en;

/** A table that runs over as many pages as it needs. `cols`: x of each column and its width; cells wrap. */
function table(b: Book, title: string, head: string[], cols: { x: number; w: number; font?: Font; bold?: boolean }[], rows: string[][], o: { tick?: boolean; note?: string } = {}): void {
  let { p, y } = b.section(title);
  const size = 9.5, lead = 13;
  if (o.note) {
    for (const l of p.wrap(o.note, 9.5, A4.w - 2 * M)) {
      p.text(M, y, l, 9.5, { color: INK.soft });
      y += 13;
    }
    y += 8;
  }
  const header = () => {
    head.forEach((h, i) => p.text(cols[i].x, y, h.toUpperCase(), 7.5, { font: 'bold', color: INK.soft }));
    y += 7;
    p.path([M, y, A4.w - M, y], { w: 0.9 });
    y += 4;
  };
  header();
  if (!rows.length) p.text(M, y + 14, b.input.t('project.pdf.none'), 10, { color: INK.soft });
  for (const row of rows) {
    const cells = row.map((c, i) => p.wrap(c, size, cols[i].w, cols[i].bold ? 'bold' : cols[i].font));
    const h = Math.max(1, ...cells.map((c) => c.length)) * lead + 7;
    if (y + h > BOTTOM) {
      ({ p, y } = b.section(title, true));
      header();
    }
    if (o.tick) p.rect(M + 1, y + 4.5, 8.5, 8.5, { w: 0.8, color: INK.soft });
    cells.forEach((c, i) => c.forEach((l, k) => p.text(cols[i].x, y + 12.5 + k * lead, l, size, { font: cols[i].bold ? 'bold' : cols[i].font })));
    y += h;
    p.path([M, y, A4.w - M, y], { w: 0.4, color: INK.faint });
  }
}

function netsPage(b: Book): void {
  const { t, project } = b.input;
  const rows = project.nets.map((n) => ['', n.name, n.members.map((m) => pinText(m.part, m.pin)).join(',  '), String(n.members.length)]);
  table(
    b,
    t('project.pdf.nets'),
    ['', t('project.pdf.col.net'), t('project.pdf.col.joins'), t('project.pdf.col.pins')],
    [
      { x: M, w: 14 },
      { x: M + 20, w: 96, bold: true },
      { x: M + 126, w: A4.w - 2 * M - 126 - 44 },
      { x: A4.w - M - 30, w: 30 },
    ],
    rows,
    { tick: true, note: t('project.pdf.nets.note') },
  );
}
function bomPage(b: Book): void {
  const { t, project, locale } = b.input;
  const rows = billOfMaterials(project).map((l) => [l.refs.join(', '), nameOf(l.part, locale), l.value, String(l.qty)]);
  if (project.wires) rows.push(['', t('project.pdf.jumpers'), '', String(project.wires)]);
  table(
    b,
    t('project.pdf.bom'),
    [t('project.pdf.col.ref'), t('project.pdf.col.part'), t('project.pdf.col.value'), t('project.pdf.col.qty')],
    [
      { x: M, w: 110, bold: true },
      { x: M + 122, w: 230 },
      { x: M + 364, w: 84 },
      { x: A4.w - M - 30, w: 30 },
    ],
    rows,
  );
}

function codePages(b: Book): void {
  const { t } = b.input;
  if (!b.input.sketches.length) return;
  const size = 8, lead = 10.4;
  const x0 = M + 26;
  let { p, y } = b.section(t('project.pdf.code'));
  const max = Math.floor((A4.w - M - x0) / p.f.mono.widthOfTextAtSize('m', size));
  const room = (need: number) => {
    if (y + need <= BOTTOM) return;
    ({ p, y } = b.section(t('project.pdf.code'), true));
  };
  for (const s of b.input.sketches) {
    for (const file of s.files) {
      room(60);
      p.rect(M, y, A4.w - 2 * M, 22, { w: 0, fill: CREAM });
      p.text(M + 10, y + 14.5, file.name, 10, { font: 'bold' });
      p.text(A4.w - M - 10, y + 14.5, s.board, 9, { align: 'right', color: INK.soft });
      y += 34;
      const lines = file.text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
      lines.forEach((raw, i) => {
        const line = raw.replace(/\t/g, '  ');
        const parts: string[] = [];
        for (let k = 0; k < Math.max(1, line.length); k += max) parts.push(line.slice(k, k + max));
        parts.forEach((part, k) => {
          room(lead);
          if (k === 0) p.text(x0 - 8, y, String(i + 1), 6.5, { font: 'mono', align: 'right', color: INK.soft });
          p.text(x0, y, part, size, { font: 'mono' });
          y += lead;
        });
      });
      y += 16;
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
  const f: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    symbol: await doc.embedFont(StandardFonts.Symbol),
    sets: new Map(),
  };
  for (const font of [f.sans, f.bold, f.mono, f.symbol]) f.sets.set(font, new Set(font.getCharacterSet()));
  let image: PDFImage | null = null;
  if (input.picture) {
    try {
      image = await doc.embedJpg(input.picture);
    } catch {
      image = null; // the cover goes without its picture
    }
  }
  const b = new Book(doc, f, input);
  cover(b, image);
  schematicPages(b);
  netsPage(b);
  bomPage(b);
  codePages(b);
  b.footers();

  doc.setTitle(input.title);
  doc.setSubject(input.t('project.pdf.subject'));
  doc.setCreator('KodeDot Sim');
  doc.setProducer(`KodeDot Sim (${SITE})`);
  doc.setKeywords(['KodeDot Sim', 'Kode Dot', 'schematic']);
  doc.setCreationDate(input.date);
  doc.setModificationDate(input.date);
  doc.setLanguage(input.locale);
  await doc.attach(new TextEncoder().encode(input.benchFile), ATTACHMENT, {
    mimeType: 'application/json',
    description: input.t('project.pdf.attachment'),
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
