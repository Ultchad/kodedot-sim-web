/**
 * What the Bench panel calls to export the project as a PDF and to open one again. Imported on demand (with
 * project/pdf.ts and the PDF library), so none of it is in the page until someone asks.
 */
import type { BenchStore } from '../bench/store';
import type { Locale, TFn } from '../i18n/core';
import type { PartsService } from '../parts/service';
import type { WorkbenchBus } from '../workbench/state';
import { buildProject } from './nets';
import { makeProjectPdf, nameOf, type ProjectSketch } from './pdf';

export { ProjectPdfError, isPdf, readProjectPdf } from './pdf';

export interface BenchFileContent {
  format: 'kodedot-bench';
  version: 1;
  bench: ReturnType<BenchStore['exportData']>;
  extras: Awaited<ReturnType<PartsService['exportExtras']>>;
}
/** The bench as "Save to a file" writes it. */
export async function benchFileContent(bench: BenchStore, parts: PartsService): Promise<BenchFileContent> {
  return { format: 'kodedot-bench', version: 1, bench: bench.exportData(), extras: await parts.exportExtras() };
}

/** A file name from a title: letters and digits of any language, the rest as dashes. */
export function fileNameOf(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return `${base || 'project'}.pdf`;
}

const jpegOf = (canvas: HTMLCanvasElement): Promise<Uint8Array | null> =>
  new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) resolve(null);
          else void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), () => resolve(null));
        },
        'image/jpeg',
        0.9,
      );
    } catch {
      resolve(null);
    }
  });

export interface ExportContext {
  bench: BenchStore;
  parts: PartsService;
  bus: WorkbenchBus;
  t: TFn;
  locale: Locale;
  title: string;
}
export async function exportProjectPdf(ctx: ExportContext): Promise<{ bytes: Uint8Array; file: string }> {
  const { bench, parts, bus, t, locale } = ctx;
  const st = bench.getState();
  const objects = st.objects.filter((o) => o.area === 'part');
  // every part's manifest is needed to know its pins; they are loaded already for the parts on the table
  await Promise.all([...new Set(objects.map((o) => o.kind))].map((k) => parts.ensurePart(k)));
  const project = buildProject({ objects, wires: st.wires, mounts: st.mounts, manifest: (k) => parts.manifest(k), plugs: parts.plugs() });
  const sketches: ProjectSketch[] = [];
  for (const part of project.parts) {
    if (!part.core) continue;
    const own = st.code[part.id]?.files;
    const running = own?.length ? null : parts.sketchOf(part.id);
    const files = own?.length ? own.map((f) => ({ name: f.name, text: f.text })) : running?.source ? [{ name: 'sketch.ino', text: running.source }] : [];
    if (files.length) sketches.push({ board: `${part.ref} ${nameOf(part, locale)}`, files });
  }
  const shot = bus.capture?.(2000) ?? null;
  const picture = shot ? await jpegOf(shot) : null;
  const file = await benchFileContent(bench, parts);
  const title = ctx.title.trim() || t('benchfile.export.default', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date()) });
  const bytes = await makeProjectPdf({ title, date: new Date(), locale, t, project, sketches, picture, benchFile: JSON.stringify(file), benchOnly: JSON.stringify(file.bench) });
  return { bytes, file: fileNameOf(title) };
}
