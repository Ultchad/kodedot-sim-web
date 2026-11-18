/**
 * When the "What's new" card shows. No React here: the rules are plain functions over the changelog and two
 * preferences, so they can be tested without a page.
 *
 *   dotbench.welcomed    (state/host.tsx) true once the visitor dismissed the first-visit welcome: "has been here before"
 *   dotbench.news.seen   the id of the newest entry this visitor has been shown
 */
import { useSyncExternalStore } from 'react';
import { loadPref, safeLocal, savePref } from '../lib/prefs';
import { CHANGELOG, type NewsEntry } from './changelog';

export const SEEN_KEY = 'dotbench.news.seen';
export const WELCOMED_KEY = 'dotbench.welcomed';
/** How many titles of older entries the card lists under the newest one. */
export const EARLIER_MAX = 3;

export interface NewsPlan {
  /** The entry to show by itself, or null. */
  show: NewsEntry | null;
  /** Other entries the visitor missed, newest first, at most EARLIER_MAX. */
  earlier: NewsEntry[];
  /** An id to record as seen right away (a first-time visitor: the welcome is their introduction, not this card). */
  markSeen: string | null;
}

/** `entries` newest first. `seen`: the stored id, or null when there is none. */
export function planNews(entries: readonly NewsEntry[], visitor: { welcomed: boolean; seen: string | null }): NewsPlan {
  const newest = entries[0];
  if (!newest) return { show: null, earlier: [], markSeen: null };
  if (!visitor.welcomed) return { show: null, earlier: [], markSeen: visitor.seen === newest.id ? null : newest.id };
  // here before this card existed: the newest entry alone, the older ones are not "missed"
  if (visitor.seen === null) return { show: newest, earlier: [], markSeen: null };
  const seen = visitor.seen;
  const missed = entries.filter((e) => e.id > seen);
  if (!missed.length) return { show: null, earlier: [], markSeen: null };
  return { show: missed[0], earlier: missed.slice(1, 1 + EARLIER_MAX), markSeen: null };
}

/** The card waits for a settled page and never covers the guide (a visitor who arrived through a #guide link reads it first). */
export function mayAppear(page: { settled: boolean; guideOpen: boolean; layersOpen?: number }): boolean {
  return page.settled && !page.guideOpen && !(page.layersOpen && page.layersOpen > 0);
}

export interface NewsView {
  entry: NewsEntry;
  earlier: NewsEntry[];
  /** True when the visitor asked for it ("What's new"); false when it is waiting to show by itself. */
  manual: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

export class NewsStore {
  private view: NewsView | null = null;
  private listeners = new Set<() => void>();
  private readonly entries: readonly NewsEntry[];
  private readonly storage: Store;

  constructor(storage: Store, entries: readonly NewsEntry[]) {
    this.entries = entries;
    this.storage = storage;
    const seen = loadPref<unknown>(SEEN_KEY, null, storage);
    const plan = planNews(entries, { welcomed: loadPref<unknown>(WELCOMED_KEY, false, storage) === true, seen: typeof seen === 'string' ? seen : null });
    if (plan.markSeen) savePref(SEEN_KEY, plan.markSeen, storage);
    if (plan.show) this.view = { entry: plan.show, earlier: plan.earlier, manual: false };
  }

  /** What the card holds now, or null. */
  get = (): NewsView | null => this.view;
  /** True when there is something to read at all (the "What's new" entry point hides without it). */
  get hasNotes(): boolean {
    return this.entries.length > 0;
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** The visitor asked: the newest entry and the titles of the ones before it. */
  open(): void {
    const [entry, ...rest] = this.entries;
    if (!entry) return;
    this.set({ entry, earlier: rest.slice(0, EARLIER_MAX), manual: true });
  }

  /** Closed in any way: the newest entry is recorded, so the card stays away until a newer one exists. */
  dismiss(): void {
    const newest = this.entries[0];
    if (newest) savePref(SEEN_KEY, newest.id, this.storage);
    this.set(null);
  }

  private set(v: NewsView | null): void {
    this.view = v;
    this.listeners.forEach((l) => l());
  }
}

/** The page's own: made when the module loads, before the welcome can be dismissed. */
export const news = new NewsStore(safeLocal(), CHANGELOG);

export function useNews(): NewsView | null {
  return useSyncExternalStore(news.subscribe, news.get, news.get);
}
