import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { translate, type Locale, type TFn } from '../i18n/core';
import { TestBench, ledBench, moduleBench, servoBench } from './fixtures';
import { buildProject } from './nets';
import { ATTACHMENT, ProjectPdfError, isPdf, makeProjectPdf, nameOf, readProjectPdf, type ProjectPdfInput } from './pdf';
import { SCHEMATIC_AREA, SHEET, drawSchematic, type SheetText } from './schematic';

/** Set PROJECT_PDF_OUT to a folder to keep the PDFs these tests make (to look at them). */
const OUT = process.env.PROJECT_PDF_OUT;
const keep = (name: string, bytes: Uint8Array) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
};
const DATE = new Date('2026-11-17T15:00:00Z');

function inputOf(t: TestBench, title: string, locale: Locale = 'en'): ProjectPdfInput {
  const tf: TFn = (key, vars) => translate(locale, key, vars);
  const project = buildProject(t.input());
  const bench = t.store.exportData();
  // what "Save to a file" writes: the bench, and beside it the compiled sketches and imported parts
  const extras = { code: Object.fromEntries(Object.keys(bench.code).map((k) => [k, { kind: t.store.get(k)!.kind, source: bench.code[k].files[0].text, wasm_b64: 'AGFzbQEAAAA=' }])), userParts: [] };
  return {
    title,
    date: DATE,
    locale,
    t: tf,
    project,
    sketches: project.parts.filter((p) => bench.code[p.id]).map((p) => ({ board: `${p.ref} ${nameOf(p, locale)}`, files: bench.code[p.id].files })),
    picture: null,
    benchFile: JSON.stringify({ format: 'kodedot-bench', version: 1, bench, extras }),
    benchOnly: JSON.stringify(bench),
  };
}
const sheetText: SheetText = { title: 'T', date: 'd', heading: 'Schematic', sheet: (n, m) => `Sheet ${n} of ${m}`, name: (p) => p.names.en, empty: 'empty' };

/** One of every part of the library, each with something on one pin, so every symbol is drawn with labels. */
function everything(): TestBench {
  const t = new TestBench();
  const dirs = ['uno-r3', 'esp32-s3-devkitc', 'hdc1080', 'l298n', 'relay-module', 'servo', 'dc-motor', 'battery-9v', 'push-button', 'slide-switch', 'potentiometer', 'resistor', 'capacitor-ceramic', 'capacitor-electrolytic', 'diode', 'led', 'led-green', 'rgb-led', 'buzzer', 'stepper-28byj48', 'antenna', 'supply'];
  const id: Record<string, string> = {};
  dirs.forEach((d, i) => (id[d] = t.add(d, { x: 120 + (i % 8) * 90, z: -150 + Math.floor(i / 8) * 90 })));
  const w = (a: string, b: string) => t.wire(a, b);
  const uno = id['uno-r3'];
  w(`${uno}.GND_1`, 'device.GND');
  w(`${uno}.V5`, `${id.servo}.V5`);
  w(`${uno}.GND_2`, `${id.servo}.GND`);
  w(`${uno}.D9`, `${id.servo}.SIG`);
  w(`${uno}.D2`, `${id['push-button']}.A`);
  w(`${id['push-button']}.B`, 'device.GND');
  w(`${uno}.A0`, `${id.potentiometer}.W`);
  w(`${uno}.V5`, `${id.potentiometer}.T`);
  w(`${uno}.GND_T`, `${id.potentiometer}.B`);
  w(`${uno}.D3`, `${id.resistor}.A`);
  w(`${id.resistor}.B`, `${id['led-green']}.A`);
  w(`${id['led-green']}.K`, 'device.GND');
  w(`${uno}.D5`, `${id['rgb-led']}.R`);
  w(`${uno}.D6`, `${id['rgb-led']}.G`);
  w(`${id['rgb-led']}.COM`, 'device.GND');
  w(`${uno}.D8`, `${id.buzzer}.P`);
  w(`${id.buzzer}.N`, 'device.GND');
  w(`${uno}.D7`, `${id['relay-module']}.IN`);
  w(`${uno}.V5`, `${id['relay-module']}.VCC`);
  w(`${id['relay-module']}.COM`, `${id['battery-9v']}.POS`);
  w(`${id['relay-module']}.NO`, `${id['dc-motor']}.M1`);
  w(`${id['dc-motor']}.M2`, `${id['battery-9v']}.NEG`);
  w(`${id['dc-motor']}.M1`, `${id.diode}.K`);
  w(`${id['dc-motor']}.M2`, `${id.diode}.A`);
  w(`${uno}.V5`, `${id['capacitor-electrolytic']}.POS`);
  w(`${id['capacitor-electrolytic']}.NEG`, 'device.GND');
  w(`${uno}.AREF`, `${id['capacitor-ceramic']}.A`);
  w(`${uno}.D4`, `${id['slide-switch']}.COM`);
  w(`${id['slide-switch']}.A`, `${uno}.V5`);
  w(`${id['slide-switch']}.B`, 'device.GND');
  w('device.EXP1', `${id.hdc1080}.SCL`);
  w('device.EXP2', `${id.hdc1080}.SDA`);
  w('device.V33', `${id.hdc1080}.VCC`);
  w('device.GND', `${id.hdc1080}.GND`);
  w('device.EXP3', `${uno}.D0`);
  w('device.EXP4', `${uno}.D1`);
  w(`${uno}.D10`, `${id.l298n}.IN1`);
  w(`${uno}.D11`, `${id.l298n}.IN2`);
  w(`${id['esp32-s3-devkitc']}.IO4`, `${id.led}.A`);
  w(`${id['esp32-s3-devkitc']}.GND_1`, `${id.led}.K`);
  w(`${uno}.D12`, `${id['stepper-28byj48']}.IN1`);
  w(`${id.supply}.POS`, `${id.l298n}.VS`);
  w(`${id.supply}.NEG`, `${id.l298n}.GND`);
  t.store.setCode(uno, { files: [{ name: 'sketch.ino', text: `// every part\nvoid setup() {\n\tpinMode(9, OUTPUT); // 330 Ω, 10 µF, façade → ok ✓\n}\nvoid loop() { ${'analogWrite(9, 128); '.repeat(9)} }\n${'// filler line\n'.repeat(90)}` }] });
  return t;
}

describe('the schematic sheets', () => {
  const cases: [string, () => TestBench][] = [['led', () => ledBench(true)], ['servo', servoBench], ['module', moduleBench], ['everything', everything]];
  for (const [name, make] of cases) {
    it(`${name}: every symbol is inside the frame and none overlaps another`, () => {
      const project = buildProject(make().input());
      const sheets = drawSchematic(project, sheetText);
      const all = sheets.flatMap((s) => s.placed);
      expect(new Set(all.map((p) => p.ref))).toEqual(new Set(project.parts.map((p) => p.ref)));
      for (const s of sheets) {
        for (const a of s.placed) {
          expect(a.x).toBeGreaterThanOrEqual(SCHEMATIC_AREA.x0);
          expect(a.x + a.w).toBeLessThanOrEqual(SCHEMATIC_AREA.x1 + 0.5);
          expect(a.y).toBeGreaterThanOrEqual(SCHEMATIC_AREA.y0);
          expect(a.y + a.h, `${a.ref} ends above the title block`).toBeLessThanOrEqual(SCHEMATIC_AREA.y1 + 0.5);
          for (const b of s.placed) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.ref} overlaps ${b.ref}`).toBe(true);
        }
        // nothing is drawn outside the sheet
        for (const op of s.ops) {
          const xs = op.t === 'line' ? op.pts.filter((_, i) => i % 2 === 0) : [op.x];
          const ys = op.t === 'line' ? op.pts.filter((_, i) => i % 2 === 1) : [op.y];
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(20);
          expect(Math.max(...xs)).toBeLessThanOrEqual(SHEET.w - 20);
          expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
          expect(Math.max(...ys)).toBeLessThanOrEqual(SHEET.h - 20);
        }
      }
    });
  }
  it('writes each connected pin\'s net beside it, and each part\'s reference', () => {
    const project = buildProject(ledBench().input());
    const [sheet] = drawSchematic(project, sheetText);
    const texts = sheet.ops.filter((o) => o.t === 'text').map((o) => (o as { text: string }).text);
    for (const want of ['U1', 'R1', 'D1', '220 Ω', 'EXP1', 'N1', 'GND', 'EXP1 (IO8)', 'Sheet 1 of 1']) expect(texts, want).toContain(want);
    expect(texts.filter((x) => x === 'N1')).toHaveLength(2);
    // the breadboard is not a symbol, and unwired Dot pins are left out
    expect(texts).not.toContain('BB1');
    expect(texts).not.toContain('EXP2 (IO9)');
  });
  it('starts another sheet when the first is full', () => {
    const t = new TestBench();
    for (let i = 0; i < 40; i++) t.add('resistor', { x: 100 + (i % 10) * 30, z: Math.floor(i / 10) * 30 });
    const sheets = drawSchematic(buildProject(t.input()), sheetText);
    expect(sheets.length).toBeGreaterThan(1);
    expect(sheets.flatMap((s) => s.placed)).toHaveLength(40);
    expect(sheets[1].ops.some((o) => o.t === 'text' && o.text === `Sheet 2 of ${sheets.length}`)).toBe(true);
  });
});

describe('the project PDF', () => {
  it('carries the bench: PDF bytes -> the same bench file, deep-equal', async () => {
    for (const [name, t, locale] of [['led', ledBench(true), 'en'], ['servo', servoBench(), 'pt-BR'], ['module', moduleBench(), 'es'], ['everything', everything(), 'pt-BR']] as const) {
      const input = inputOf(t, name === 'servo' ? 'Servo com Arduino Uno: varredura' : `Project ${name}`, locale);
      const bytes = await makeProjectPdf(input);
      keep(`${name}.pdf`, bytes);
      expect(isPdf(bytes)).toBe(true);
      const got = await readProjectPdf(bytes);
      expect(got.from).toBe('attachment');
      expect(got.title).toBe(input.title);
      expect(got.data).toEqual(JSON.parse(input.benchFile));
      // and the bench store takes it back whole
      const back = new TestBench();
      expect(back.store.importData(got.data.bench)).toBe(true);
      expect(back.store.exportData()).toEqual(t.store.exportData());
    }
  });
  it('has a cover, the schematic, the two tables and the code, in that order', async () => {
    const doc = await PDFDocument.load(await makeProjectPdf(inputOf(servoBench(), 'Servo')));
    const sizes = doc.getPages().map((p) => (p.getWidth() > p.getHeight() ? 'landscape' : 'portrait'));
    expect(sizes).toEqual(['portrait', 'landscape', 'portrait', 'portrait', 'portrait']);
    expect(doc.getTitle()).toBe('Servo');
    expect(doc.getAttachments().map((a) => a.name)).toEqual([ATTACHMENT]);
    // no code section without a sketch
    const led = await PDFDocument.load(await makeProjectPdf(inputOf(ledBench(), 'LED')));
    expect(led.getPageCount()).toBe(4);
  });
  it('falls back to the copy in the metadata when the attachment is gone', async () => {
    const t = servoBench();
    const doc = await PDFDocument.load(await makeProjectPdf(inputOf(t, 'Servo')));
    doc.catalog.delete(PDFName.of('Names'));
    const got = await readProjectPdf(await doc.save());
    expect(got.from).toBe('metadata');
    expect(got.data.bench).toEqual(JSON.parse(JSON.stringify(t.store.exportData())));
    expect(got.data.extras).toBeUndefined();
  });
  it('refuses a PDF with no bench in it, and a file that is not a PDF', async () => {
    const plain = await PDFDocument.create();
    plain.addPage().drawText('just a page');
    await plain.attach(new TextEncoder().encode('{"hello":1}'), 'other.json', { mimeType: 'application/json' });
    const bytes = await plain.save();
    await expect(readProjectPdf(bytes)).rejects.toMatchObject({ reason: 'none' });
    await expect(readProjectPdf(bytes)).rejects.toBeInstanceOf(ProjectPdfError);
    await expect(readProjectPdf(new TextEncoder().encode('%PDF-1.7\nnot really'))).rejects.toMatchObject({ reason: expect.stringMatching(/none|unreadable/) });
    await expect(readProjectPdf(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ reason: 'unreadable' });
    expect(isPdf(new TextEncoder().encode('{"format":"kodedot-bench"}'))).toBe(false);
  });
  it('writes text the standard fonts lack without failing (ohm sign, arrows, emoji)', async () => {
    const t = ledBench();
    const input = inputOf(t, 'Ω µ ção ñ → 😀 title');
    input.sketches = [{ board: 'U9 Board', files: [{ name: 'a.ino', text: '// ≤ ✓ 日本\tx\r\nint a = 1;' }] }];
    const bytes = await makeProjectPdf(input);
    expect((await readProjectPdf(bytes)).title).toBe('Ω µ ção ñ → 😀 title');
  });
});
