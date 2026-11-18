/**
 * What changed on the site, newest first: the data behind the "What's new" card (WhatsNew.tsx).
 *
 * To announce an update: add one entry at the TOP of NOTES with a new id. The id is the publication date
 * (YYYY-MM-DD, plus a suffix such as "-b" for a second one on the same day); ids are compared as text, so a later
 * date is a newer entry. Give it a short title and 3 to 6 short points in the three languages (the types refuse an
 * entry that lacks a language; news.test.ts checks the counts). `guide` is optional: a section of the guide the card
 * links to. Returning visitors see the card once, the first time they open the site after the entry is published.
 *
 * The kodeOS updater does not edit this file: tools/news-add.mjs appends a line to auto.json, and the entry's texts
 * are made here from that line (autoEntry).
 */
import type { Locale } from '../i18n/core';
import type { SectionId } from '../guide/route';
import auto from './auto.json';

export type Localised<T> = Record<Locale, T>;

export interface NewsEntry {
  /** Date based, unique, compared as text: "2026-11-18", "2026-11-18-b", "2026-12-03-kodeos-0.1.3". */
  id: string;
  title: Localised<string>;
  /** 3 to 6 short points (the automatic kodeOS entries have 2). */
  points: Localised<string[]>;
  /** A section of the guide that tells more (#guide/<section>). */
  guide?: SectionId;
}

/** A line of auto.json, written by tools/news-add.mjs when the updater moves to a new kodeOS release. */
export interface AutoNote {
  id: string;
  kind: 'kodeos';
  /** The release tag, "v0.1.3". */
  version: string;
}

/** The id of the newest hand-written entry: change it to the day the update is published. */
export const LATEST_NOTE_ID = '2026-11-18';

/** Hand-written entries, newest first. */
export const NOTES: NewsEntry[] = [
  {
    // PLACEHOLDER: the coordinator finalises these texts (and LATEST_NOTE_ID) when the update is published.
    id: LATEST_NOTE_ID,
    title: {
      en: 'Part pictures, new buttons and PDF export',
      'pt-BR': 'Fotos das peças, botões novos e exportar em PDF',
      es: 'Fotos de las piezas, botones nuevos y exportar a PDF',
    },
    points: {
      en: [
        'The parts library now shows a picture of each part.',
        'The Dot runs kodeOS 0.1.2, and follows new releases by itself.',
        'New button parts to wire on the workbench.',
        'Export your project as a PDF.',
      ],
      'pt-BR': [
        'A biblioteca de peças agora mostra uma foto de cada peça.',
        'O Dot roda o kodeOS 0.1.2 e acompanha as novas versões sozinho.',
        'Novos botões para ligar na bancada.',
        'Exporte seu projeto em PDF.',
      ],
      es: [
        'La biblioteca de piezas ahora muestra una foto de cada pieza.',
        'El Dot ejecuta kodeOS 0.1.2 y sigue las nuevas versiones por sí solo.',
        'Nuevos botones para conectar en la mesa de trabajo.',
        'Exporta tu proyecto en PDF.',
      ],
    },
    guide: 'workbench',
  },
];

/** The texts of an automatic entry. Short on purpose: the release itself is Kode's news, not ours. */
export function autoEntry(n: AutoNote): NewsEntry {
  const v = n.version;
  return {
    id: n.id,
    title: {
      en: `kodeOS updated to ${v}`,
      'pt-BR': `kodeOS atualizado para ${v}`,
      es: `kodeOS actualizado a ${v}`,
    },
    points: {
      en: [`The Dot now runs kodeOS ${v}, built from Kode's public release.`, 'Your apps and settings on the Dot were kept.'],
      'pt-BR': [`O Dot agora roda o kodeOS ${v}, compilado a partir da versão pública da Kode.`, 'Seus apps e ajustes no Dot foram mantidos.'],
      es: [`El Dot ahora ejecuta kodeOS ${v}, compilado a partir de la versión pública de Kode.`, 'Tus apps y ajustes en el Dot se mantienen.'],
    },
  };
}

const isAutoNote = (x: unknown): x is AutoNote => {
  const n = x as Partial<AutoNote> | null;
  return !!n && typeof n === 'object' && typeof n.id === 'string' && /^\d{4}-\d{2}-\d{2}/.test(n.id) && n.kind === 'kodeos' && typeof n.version === 'string' && /^v\d+\.\d+\.\d+$/.test(n.version);
};

/** Hand-written and automatic entries as one list, newest first. A malformed automatic line is left out, never fatal. */
export function mergeChangelog(notes: readonly NewsEntry[], autoNotes: readonly unknown[]): NewsEntry[] {
  const seen = new Set<string>();
  return [...notes, ...autoNotes.filter(isAutoNote).map(autoEntry)]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export const CHANGELOG: NewsEntry[] = mergeChangelog(NOTES, Array.isArray(auto) ? (auto as unknown[]) : []);
