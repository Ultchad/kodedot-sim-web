import { AREAS, getArea, type AreaId, type BenchObject, type FieldValue, type KindDef } from './model';
import { getKind } from './kinds';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BenchState {
  objects: readonly BenchObject[];
}

export const BENCH_STORAGE_KEY = 'dotbench.bench.v1';
const AREA_IDS = new Set<string>(AREAS.map((a) => a.id));

let counter = 0;
function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `o_${Date.now().toString(36)}_${(counter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampField(def: KindDef | undefined, key: string, value: FieldValue): FieldValue {
  const f = def?.fields.find((x) => x.key === key);
  if (!f) return value;
  if (f.type === 'range' || f.type === 'number') {
    let n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    if (f.min !== undefined) n = Math.max(f.min, n);
    if (f.max !== undefined) n = Math.min(f.max, n);
    return n;
  }
  if (f.type === 'toggle') return Boolean(value);
  return value;
}

function validate(raw: unknown): BenchObject[] {
  if (!raw || typeof raw !== 'object') return [];
  const objs = (raw as { objects?: unknown }).objects;
  if (!Array.isArray(objs)) return [];
  const out: BenchObject[] = [];
  const seen = new Set<string>();
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    const { id, area, kind, name, fields, near } = o as Record<string, unknown>;
    if (typeof id !== 'string' || seen.has(id) || typeof kind !== 'string' || typeof name !== 'string') continue;
    if (typeof area !== 'string' || !AREA_IDS.has(area)) continue;
    if (!fields || typeof fields !== 'object') continue;
    const clean: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
    }
    seen.add(id);
    out.push({ id, area: area as AreaId, kind, name, fields: clean, near: near === true });
  }
  return out;
}

/** Bench objects: CRUD + slots, persisted to localStorage (every storage access is guarded). */
export class BenchStore {
  private state: BenchState;
  private listeners = new Set<() => void>();

  constructor(
    private storage: StorageLike | null = null,
    private kindOf: (key: string) => KindDef | undefined = getKind,
  ) {
    let objects: BenchObject[] = [];
    try {
      const raw = storage?.getItem(BENCH_STORAGE_KEY);
      if (raw) objects = validate(JSON.parse(raw));
    } catch {
      objects = [];
    }
    this.state = { objects };
  }

  getState = (): BenchState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get(id: string): BenchObject | undefined {
    return this.state.objects.find((o) => o.id === id);
  }

  /** The first object of an area that is near (for areas where only one can be: motion). */
  activeIn(area: AreaId): BenchObject | null {
    return this.state.objects.find((o) => o.area === area && o.near) ?? null;
  }
  nearIn(area: AreaId): BenchObject[] {
    return this.state.objects.filter((o) => o.area === area && o.near);
  }
  /** How many objects of a kind exist (UI uses it to number default names). */
  countOf(kindKey: string): number {
    return this.state.objects.filter((o) => o.kind === kindKey).length;
  }
  /** Adds an object. It starts near the Dot (if its kind has a near/away control and the area has room), so one click gives a result. */
  add(kindKey: string, name?: string): BenchObject | null {
    const def = this.kindOf(kindKey);
    if (!def) return null;
    if (def.single && this.countOf(kindKey) > 0) return null;
    const n = this.countOf(kindKey) + 1;
    const exclusive = getArea(def.area)?.exclusive;
    const near = def.presence !== 'none' && !(exclusive && this.activeIn(def.area));
    const obj: BenchObject = { id: newId(), area: def.area, kind: kindKey, name: name?.trim() || `${def.key} ${n}`, fields: { ...def.defaults, ...(def.unique?.(n) ?? {}) }, near };
    this.commit({ objects: [...this.state.objects, obj] }, true);
    return obj;
  }
  rename(id: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.update(id, (o) => ({ ...o, name: clean }));
  }
  setField(id: string, key: string, value: FieldValue): void {
    const cur = this.get(id);
    if (!cur) return;
    const v = clampField(this.kindOf(cur.kind), key, value);
    if (cur.fields[key] === v) return;
    this.update(id, (o) => ({ ...o, fields: { ...o.fields, [key]: v } }));
  }
  setFields(id: string, values: Record<string, FieldValue>): void {
    const cur = this.get(id);
    if (!cur) return;
    const def = this.kindOf(cur.kind);
    const next = { ...cur.fields };
    let changed = false;
    for (const [k, v] of Object.entries(values)) {
      const c = clampField(def, k, v);
      if (next[k] !== c) {
        next[k] = c;
        changed = true;
      }
    }
    if (changed) this.update(id, (o) => ({ ...o, fields: next }));
  }
  duplicate(id: string, suffix = 'copy'): BenchObject | null {
    const src = this.get(id);
    if (!src) return null;
    const def = this.kindOf(src.kind);
    if (def?.single) return null;
    const n = this.countOf(src.kind) + 1;
    const copy: BenchObject = { ...src, id: newId(), name: `${src.name} (${suffix})`, fields: { ...src.fields, ...(def?.unique?.(n) ?? {}) }, near: false };
    const idx = this.state.objects.findIndex((o) => o.id === id);
    const objects = [...this.state.objects];
    objects.splice(idx + 1, 0, copy);
    this.commit({ objects }, true);
    return copy;
  }
  remove(id: string): void {
    if (!this.get(id)) return;
    this.commit({ objects: this.state.objects.filter((o) => o.id !== id) }, true);
  }
  /** Near / in range / pointing at the Dot / plugged in. In an exclusive area (motion) the others leave. */
  setNear(id: string, near: boolean): void {
    const cur = this.get(id);
    if (!cur || cur.near === near) return;
    const exclusive = getArea(cur.area)?.exclusive;
    this.commit(
      { objects: this.state.objects.map((o) => (o.id === id ? { ...o, near } : near && exclusive && o.area === cur.area ? { ...o, near: false } : o)) },
      true,
    );
  }
  bringNear(id: string): void {
    this.setNear(id, true);
  }
  /** By object id or by area id. */
  takeAway(idOrArea: string): void {
    if (AREA_IDS.has(idOrArea)) {
      const objs = this.nearIn(idOrArea as AreaId);
      if (objs.length) this.commit({ objects: this.state.objects.map((o) => (o.area === idOrArea ? { ...o, near: false } : o)) }, true);
      return;
    }
    this.setNear(idOrArea, false);
  }
  private update(id: string, fn: (o: BenchObject) => BenchObject): void {
    this.commit({ objects: this.state.objects.map((o) => (o.id === id ? fn(o) : o)) }, true);
  }

  private commit(next: BenchState, persist: boolean): void {
    this.state = next;
    if (persist) this.save();
    for (const l of [...this.listeners]) l();
  }

  private save(): void {
    try {
      this.storage?.setItem(BENCH_STORAGE_KEY, JSON.stringify({ v: 2, objects: this.state.objects }));
    } catch {
      /* quota or disabled storage: keep working in memory */
    }
  }
}
