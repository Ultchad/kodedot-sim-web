import { BUILD_PACKAGE } from './buildPackage';
import type { GuideKey } from './content';
import type { SectionId } from './route';

/**
 * The guide's shape, once, for every language: which texts, lists, figures and data tables each section shows, in
 * order. The words are in content.<lang>.ts; the data tables render the product's own data (see each block).
 */
export type FigureId = 'dot' | 'controls' | 'range' | 'led' | 'package';

/** A numbered step: its text, and for some the commands to run. */
export type Step = GuideKey | { k: GuideKey; code: readonly string[] };

export type Block =
  | { t: 'p'; k: GuideKey }
  | { t: 'h'; k: GuideKey }
  | { t: 'steps'; k: readonly Step[] }
  | { t: 'list'; k: readonly GuideKey[] }
  /** A quiet aside under what it belongs to. */
  | { t: 'note'; k: GuideKey }
  /** Commands to copy: the same in every language. `{ext}` and the addresses are filled in. */
  | { t: 'code'; lines: readonly string[] }
  | { t: 'fig'; fig: FigureId; cap: GuideKey }
  /** The keys of the Dot's buttons (lib/keys.ts). */
  | { t: 'keys' }
  /** The software the Dot comes with and its sources (guide/apps.ts). */
  | { t: 'apps' }
  /** The boards that run sketches (the compiler's data). */
  | { t: 'boards' }
  /** What a sketch can and cannot use (the compiler's data). */
  | { t: 'support' }
  /** Works, partly, not simulated: one row per hardware area (guide/capabilities.ts). */
  | { t: 'capabilities' };

export interface Section {
  id: SectionId;
  title: GuideKey;
  blocks: readonly Block[];
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'start',
    title: 'start.title',
    blocks: [
      { t: 'p', k: 'start.lead' },
      { t: 'p', k: 'start.around' },
      { t: 'p', k: 'start.local' },
      { t: 'fig', fig: 'dot', cap: 'start.fig' },
      { t: 'h', k: 'start.first' },
      { t: 'steps', k: ['start.s1', 'start.s2', 'start.s3', 'start.s4'] },
      { t: 'p', k: 'start.next' },
    ],
  },
  {
    id: 'using-the-dot',
    title: 'dot.title',
    blocks: [
      { t: 'h', k: 'dot.touch.h' },
      { t: 'p', k: 'dot.touch' },
      { t: 'fig', fig: 'controls', cap: 'dot.fig' },
      { t: 'keys' },
      { t: 'note', k: 'dot.keys.note' },
      { t: 'h', k: 'dot.home.h' },
      { t: 'p', k: 'dot.home' },
      { t: 'h', k: 'dot.view.h' },
      { t: 'list', k: ['dot.view.3d', 'dot.view.2d', 'dot.view.wb'] },
      { t: 'h', k: 'dot.power.h' },
      { t: 'list', k: ['dot.power.restart', 'dot.power.stop', 'dot.power.reset'] },
      { t: 'h', k: 'dot.data.h' },
      { t: 'p', k: 'dot.data' },
      { t: 'list', k: ['dot.data.export', 'dot.data.import', 'dot.data.bench'] },
      { t: 'note', k: 'dot.data.clear' },
    ],
  },
  {
    id: 'apps',
    title: 'apps.title',
    blocks: [{ t: 'p', k: 'apps.lead' }, { t: 'apps' }, { t: 'p', k: 'apps.more' }],
  },
  {
    id: 'bench',
    title: 'bench.title',
    blocks: [
      { t: 'p', k: 'bench.lead' },
      { t: 'p', k: 'bench.near' },
      { t: 'fig', fig: 'range', cap: 'bench.fig' },
      { t: 'h', k: 'bench.objects.h' },
      { t: 'list', k: ['bench.o.nfc', 'bench.o.rfid', 'bench.o.wifi', 'bench.o.ir', 'bench.o.sd', 'bench.o.power', 'bench.o.ble', 'bench.o.usb', 'bench.o.motion'] },
      { t: 'h', k: 'bench.nfc.h' },
      { t: 'steps', k: ['bench.nfc.1', 'bench.nfc.2', 'bench.nfc.3'] },
      { t: 'h', k: 'bench.wifi.h' },
      { t: 'steps', k: ['bench.wifi.1', 'bench.wifi.2', 'bench.wifi.3'] },
      { t: 'note', k: 'bench.wifi.note' },
      { t: 'h', k: 'bench.ir.h' },
      { t: 'steps', k: ['bench.ir.1', 'bench.ir.2', 'bench.ir.3'] },
      { t: 'h', k: 'bench.sd.h' },
      { t: 'steps', k: ['bench.sd.1', 'bench.sd.2', 'bench.sd.3'] },
    ],
  },
  {
    id: 'workbench',
    title: 'wb.title',
    blocks: [
      { t: 'p', k: 'wb.lead' },
      { t: 'h', k: 'wb.cam.h' },
      { t: 'p', k: 'wb.cam' },
      { t: 'h', k: 'wb.parts.h' },
      { t: 'p', k: 'wb.parts' },
      { t: 'h', k: 'wb.wires.h' },
      { t: 'p', k: 'wb.wires' },
      { t: 'p', k: 'wb.header' },
      { t: 'h', k: 'wb.bb.h' },
      { t: 'p', k: 'wb.bb' },
      { t: 'h', k: 'wb.module.h' },
      { t: 'p', k: 'wb.module' },
      { t: 'h', k: 'wb.reset.h' },
      { t: 'p', k: 'wb.reset' },
      { t: 'h', k: 'wb.file.h' },
      { t: 'p', k: 'wb.file' },
      { t: 'h', k: 'wb.ex1.h' },
      { t: 'steps', k: ['wb.ex1.1', 'wb.ex1.2', 'wb.ex1.3', 'wb.ex1.4', 'wb.ex1.5'] },
      { t: 'fig', fig: 'led', cap: 'wb.ex1.fig' },
      { t: 'note', k: 'wb.ex1.note' },
      { t: 'h', k: 'wb.ex2.h' },
      { t: 'steps', k: ['wb.ex2.1', 'wb.ex2.2', 'wb.ex2.3', 'wb.ex2.4', 'wb.ex2.5'] },
      { t: 'p', k: 'wb.ex2.more' },
    ],
  },
  {
    id: 'sketches',
    title: 'sk.title',
    blocks: [
      { t: 'p', k: 'sk.lead' },
      { t: 'h', k: 'sk.boards.h' },
      { t: 'p', k: 'sk.boards' },
      { t: 'boards' },
      { t: 'support' },
      { t: 'note', k: 'sk.data' },
      { t: 'h', k: 'sk.files.h' },
      { t: 'p', k: 'sk.files' },
      { t: 'note', k: 'sk.browsers' },
    ],
  },
  {
    id: 'your-own-app',
    title: 'app.title',
    blocks: [
      { t: 'p', k: 'app.what' },
      { t: 'fig', fig: 'package', cap: 'app.fig' },
      { t: 'p', k: 'app.same' },
      { t: 'h', k: 'app.install.h' },
      { t: 'p', k: 'app.install' },
      // how a package is made today: guide/buildPackage.ts, the one place to replace when there is another way
      ...BUILD_PACKAGE,
    ],
  },
  {
    id: 'your-own-parts',
    title: 'parts.title',
    blocks: [
      { t: 'p', k: 'parts.lead' },
      { t: 'h', k: 'parts.make.h' },
      { t: 'list', k: ['parts.make.import', 'parts.make.starter', 'parts.make.prompt', 'parts.make.manual'] },
      { t: 'h', k: 'parts.manifest.h' },
      { t: 'p', k: 'parts.manifest' },
      { t: 'h', k: 'parts.build.h' },
      {
        t: 'steps',
        k: [
          'parts.build.1',
          { k: 'parts.build.2', code: ['tools/dotbench part check my-part', 'tools/dotbench part test my-part'] },
          { k: 'parts.build.3', code: ['tools/dotbench part build my-part'] },
          'parts.build.4',
        ],
      },
      { t: 'note', k: 'parts.tool' },
      { t: 'p', k: 'parts.board' },
    ],
  },
  {
    id: 'what-is-simulated',
    title: 'sim.title',
    blocks: [{ t: 'p', k: 'sim.lead' }, { t: 'capabilities' }],
  },
  {
    id: 'help',
    title: 'help.title',
    blocks: [
      { t: 'h', k: 'help.froze.h' },
      { t: 'p', k: 'help.froze' },
      { t: 'h', k: 'help.crash.h' },
      { t: 'p', k: 'help.crash' },
      { t: 'h', k: 'help.browser.h' },
      { t: 'p', k: 'help.browser' },
      { t: 'p', k: 'help.embed' },
      { t: 'h', k: 'help.phone.h' },
      { t: 'p', k: 'help.phone' },
      { t: 'h', k: 'help.slow.h' },
      { t: 'p', k: 'help.slow' },
      { t: 'h', k: 'help.bug.h' },
      { t: 'p', k: 'help.bug' },
      { t: 'h', k: 'help.source.h' },
      { t: 'p', k: 'help.source' },
    ],
  },
];

export const sectionOf = (id: SectionId): Section => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
