import { AREAS, type AreaId, type BenchObject, type FieldValue, type KindDef } from './model';
import { getKind } from './kinds';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BenchState {
  objects: readonly BenchObject[];
  /** Per area: id of the object that is near / connected / in use. Not persisted. */
  slots: Readonly<Partial<Record<AreaId, string>>>;
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
    const { id, area, kind, name, fields } = o as Record<string, unknown>;
    if (typeof id !== 'string' || seen.has(id) || typeof kind !== 'string' || typeof name !== 'string') continue;
    if (typeof area !== 'string' || !AREA_IDS.has(area)) continue;
    if (!fields || typeof fields !== 'object') continue;
    const clean: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
    }
    seen.add(id);
    out.push({ id, area: area as AreaId, kind, name, fields: clean });
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
    this.state = { objects, slots: {} };
  }

  getState = (): BenchState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get(id: string): BenchObject | undefined {
    return this.state.objects.find((o) => o.id === id);
  }

  activeIn(area: AreaId): BenchObject | null {
    const id = this.state.slots[area];
    return (id && this.get(id)) || null;
  }

  /** How many objects of a kind exist (UI uses it to number default names). */
  countOf(kindKey: string): number {
    return this.state.objects.filter((o) => o.kind === kindKey).length;
  }

  add(kindKey: string, name?: string): BenchObject | null {
    const def = this.kindOf(kindKey);
    if (!def) return null;
    const n = this.state.objects.filter((o) => o.kind === kindKey).length + 1;
    const obj: BenchObject = { id: newId(), area: def.area, kind: kindKey, name: name?.trim() || `${def.key} ${n}`, fields: { ...def.defaults } };
    this.commit({ ...this.state, objects: [...this.state.objects, obj] }, true);
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

  duplicate(id: string): BenchObject | null {
    const src = this.get(id);
    if (!src) return null;
    const copy: BenchObject = { ...src, id: newId(), name: `${src.name} (cópia)`, fields: { ...src.fields } };
    const idx = this.state.objects.findIndex((o) => o.id === id);
    const objects = [...this.state.objects];
    objects.splice(idx + 1, 0, copy);
    this.commit({ ...this.state, objects }, true);
    return copy;
  }

  remove(id: string): void {
    const cur = this.get(id);
    if (!cur) return;
    const slots = { ...this.state.slots };
    if (slots[cur.area] === id) delete slots[cur.area];
    this.commit({ objects: this.state.objects.filter((o) => o.id !== id), slots }, true);
  }

  /** "Aproximar": puts the object in its area's slot, replacing whatever was there. */
  bringNear(id: string): void {
    const cur = this.get(id);
    if (!cur || this.state.slots[cur.area] === id) return;
    this.commit({ ...this.state, slots: { ...this.state.slots, [cur.area]: id } }, false);
  }

  /** "Afastar": by object id or by area id. */
  takeAway(idOrArea: string): void {
    const slots = { ...this.state.slots };
    const area = (AREA_IDS.has(idOrArea) ? idOrArea : this.get(idOrArea)?.area) as AreaId | undefined;
    if (!area || !slots[area]) return;
    if (!AREA_IDS.has(idOrArea) && slots[area] !== idOrArea) return;
    delete slots[area];
    this.commit({ ...this.state, slots }, false);
  }

  private update(id: string, fn: (o: BenchObject) => BenchObject): void {
    this.commit({ ...this.state, objects: this.state.objects.map((o) => (o.id === id ? fn(o) : o)) }, true);
  }

  private commit(next: BenchState, persist: boolean): void {
    this.state = next;
    if (persist) this.save();
    for (const l of [...this.listeners]) l();
  }

  private save(): void {
    try {
      this.storage?.setItem(BENCH_STORAGE_KEY, JSON.stringify({ v: 1, objects: this.state.objects }));
    } catch {
      /* quota or disabled storage: keep working in memory */
    }
  }
}
