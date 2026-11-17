import type { TKey, Vars } from '../i18n/core';

/** One line of "what the Dot did with this object", kept as a key so it follows the page language. */
export interface LiveEntry {
  at: number;
  key: TKey;
  vars?: Vars;
  tone: 'info' | 'ok' | 'bad';
  /** How many times in a row the same line happened (a held remote button repeats). */
  count: number;
}

export interface LiveState {
  entries: readonly LiveEntry[];
  /** What the object shows besides the log: counters, the last thing seen, connection state. Replaced as a whole. */
  data: Readonly<Record<string, unknown>>;
}

const EMPTY: LiveState = { entries: [], data: {} };
const MAX = 8;

/**
 * Feedback from the Dot, per bench object id (and per area under `area:<id>`): not persisted, wiped when the object goes.
 * Snapshots are immutable and stable between changes so React can bind with useSyncExternalStore.
 */
export class LiveStore {
  private map = new Map<string, LiveState>();
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(private now: () => number = () => Date.now()) {}

  get = (id: string): LiveState => this.map.get(id) ?? EMPTY;
  getVersion = (): number => this.version;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  push(id: string, e: { key: TKey; vars?: Vars; tone?: LiveEntry['tone'] }): void {
    const cur = this.get(id);
    const last = cur.entries[cur.entries.length - 1];
    const same = last && last.key === e.key && JSON.stringify(last.vars) === JSON.stringify(e.vars);
    const entry: LiveEntry = { at: this.now(), key: e.key, vars: e.vars, tone: e.tone ?? 'info', count: same ? last.count + 1 : 1 };
    const entries = same ? [...cur.entries.slice(0, -1), entry] : [...cur.entries, entry].slice(-MAX);
    this.set(id, { entries });
  }

  /** Merge into `data`. */
  setData(id: string, data: Record<string, unknown>): void {
    const cur = this.get(id);
    if (Object.entries(data).every(([k, v]) => JSON.stringify(cur.data[k]) === JSON.stringify(v))) return;
    this.set(id, { data: { ...cur.data, ...data } });
  }

  clear(id: string): void {
    if (this.map.delete(id)) this.bump();
  }
  clearAll(): void {
    if (!this.map.size) return;
    this.map.clear();
    this.bump();
  }
  /** Drops the entries and data of every id that is not in `keep` (objects that were removed). */
  prune(keep: ReadonlySet<string>): void {
    let changed = false;
    for (const id of [...this.map.keys()]) {
      if (!id.startsWith('area:') && !keep.has(id)) {
        this.map.delete(id);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  private set(id: string, patch: Partial<LiveState>): void {
    const cur = this.get(id);
    this.map.set(id, { entries: patch.entries ?? cur.entries, data: patch.data ?? cur.data });
    this.bump();
  }
  private bump(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }
}
