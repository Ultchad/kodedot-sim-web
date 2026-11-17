import { BOARDS, FAMILY_NOTES, SUPPORTED, UNSUPPORTED } from '../generated/cc/boards.mjs';
import type { Locale } from '../i18n/core';
import { SKETCH_TEXTS } from './sketchData.i18n';

/**
 * What a sketch can and cannot use, read from the compiler's own data (runtime/cc/boards.mjs): the guide renders
 * these lists, it does not retype them. The data is English. A translation is used only while it was written for
 * the very sentence the compiler states today (its fingerprint is stored beside it); when the compiler's sentence
 * changes, the page shows the compiler's English until the translation is redone, and sketchData.test.ts says so.
 */
export interface SketchItem {
  id: string;
  /** The compiler's own sentence. */
  source: string;
}

export const SKETCH_SUPPORTED: readonly SketchItem[] = SUPPORTED.map((x) => ({ id: x.id, source: x.text }));
export const SKETCH_UNSUPPORTED: readonly SketchItem[] = UNSUPPORTED.map((x) => ({ id: x.id, source: x.text }));
export const SKETCH_FAMILIES: readonly { family: string; boards: string[]; notes: SketchItem[] }[] = [...new Set(Object.values(BOARDS).map((b) => b.family))].map((family) => ({
  family,
  boards: Object.keys(BOARDS).filter((id) => BOARDS[id].family === family),
  notes: (FAMILY_NOTES[family] ?? []).map((x) => ({ id: x.id, source: x.text })),
}));
export const SKETCH_BOARD_IDS: readonly string[] = Object.keys(BOARDS);

/** The boards by the names printed on them. A board the compiler gains must be named here (the test checks). */
export const BOARD_NAMES: Record<string, string> = {
  esp32: 'ESP32 DevKitC',
  'esp32-s3': 'ESP32-S3 DevKitC-1',
  'uno-r3': 'Arduino Uno R3',
  'uno-r4-minima': 'Arduino Uno R4 Minima',
  'uno-r4-wifi': 'Arduino Uno R4 WiFi',
};

/** FNV-1a, 32 bits, as 8 hex digits: enough to notice that a sentence changed. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The sentence to show for an item: the translation when it is current, the compiler's own English otherwise. */
export function sketchText(item: SketchItem, locale: Locale): string {
  if (locale === 'en') return item.source;
  const tr = SKETCH_TEXTS[locale]?.[item.id];
  return tr && tr.of === fingerprint(item.source) ? tr.text : item.source;
}
