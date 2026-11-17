import { AREAS, getArea, type AreaId, type BenchObject, type FieldValue, type KindDef } from './model';
import { getKind } from './kinds';
import { DOT_RECT, SD_ID, applyDotPose, dropSpot, freeSpot, hasBody, isDotPose, isNear, obstacles, overlaps, placeMissing, rectOf, settle, spotFor, zoneOf, type DotPose, type Placed, type Pos, type Rot } from '../workbench/layout';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Things on the table that are not bench objects (the microSD card belongs to the Dot): only their place is kept here. */
export type Fixtures = Readonly<Record<string, { pos: Pos; rot: Rot }>>;

/** A jumper wire between two terminals ("<part instance>.<pin>" or "device.<name>"). */
export interface Wire {
  id: string;
  from: string;
  to: string;
  color: string;
}
/** A board's own sketch as the visitor edited it. */
export interface Sketch {
  files: { name: string; text: string }[];
}
export type MountSide = 'upright' | 'turned';

interface Snap {
  objects: readonly BenchObject[];
  fixtures: Fixtures;
  wires: readonly Wire[];
  /** Kode modules sitting on the Dot's header, by part instance. */
  mounts: Readonly<Record<string, MountSide>>;
  /** Sketches by board instance. */
  code: Readonly<Record<string, Sketch>>;
  /** How the Dot is put down on the table (lying, standing, on its side). */
  dotPose: DotPose;
}

export interface BenchState extends Snap {
  /** How many edits can be undone / redone. */
  undo: number;
  redo: number;
}

/** Jumper colours offered (red, black, yellow, green, blue, orange, white, purple). */
export const WIRE_COLORS = ['#d9412b', '#26282c', '#e9b824', '#2f9e5b', '#2f6fdb', '#e8792a', '#eceae4', '#8a52c7'] as const;

const HISTORY_MAX = 100;
const COALESCE_MS = 900;

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

const asPos = (v: unknown): Pos | undefined => {
  const p = v as { x?: unknown; z?: unknown } | null;
  return p && typeof p === 'object' && typeof p.x === 'number' && typeof p.z === 'number' && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : undefined;
};
const asRot = (v: unknown): Rot => (v === 1 || v === 2 || v === 3 ? v : 0);

const isTerm = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,15}\.[A-Za-z0-9_+\-]{1,24}$/.test(v);
export const termOwner = (term: string): string => term.slice(0, term.indexOf('.'));

function validateRest(raw: unknown, objects: readonly BenchObject[]): Pick<Snap, 'wires' | 'mounts' | 'code'> {
  const r = (raw ?? {}) as { wires?: unknown; mounts?: unknown; code?: unknown };
  const ids = new Set(objects.filter((o) => o.area === 'part').map((o) => o.id));
  const owned = (t: string) => termOwner(t) === 'device' || ids.has(termOwner(t));
  const wires: Wire[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.wires)) {
    for (const w of r.wires as Record<string, unknown>[]) {
      if (!w || typeof w.id !== 'string' || seen.has(w.id) || !isTerm(w.from) || !isTerm(w.to) || w.from === w.to || !owned(w.from) || !owned(w.to)) continue;
      seen.add(w.id);
      wires.push({ id: w.id, from: w.from, to: w.to, color: typeof w.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : WIRE_COLORS[0] });
    }
  }
  const mounts: Record<string, MountSide> = {};
  if (r.mounts && typeof r.mounts === 'object') {
    for (const [k, v] of Object.entries(r.mounts as Record<string, unknown>)) {
      if (ids.has(k) && (v === 'upright' || v === 'turned') && !Object.keys(mounts).length) mounts[k] = v;
    }
  }
  const code: Record<string, Sketch> = {};
  if (r.code && typeof r.code === 'object') {
    for (const [k, v] of Object.entries(r.code as Record<string, { files?: unknown }>)) {
      if (!ids.has(k) || !v || !Array.isArray(v.files)) continue;
      const files = (v.files as { name?: unknown; text?: unknown }[]).filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string').map((f) => ({ name: f.name as string, text: f.text as string }));
      if (files.length) code[k] = { files };
    }
  }
  return { wires, mounts, code };
}

const poseOf = (raw: unknown): DotPose => {
  const p = (raw as { dotPose?: unknown } | null)?.dotPose;
  return isDotPose(p) ? p : 'lying';
};

function validateFixtures(raw: unknown, objects: readonly BenchObject[]): Fixtures {
  const f = (raw as { fixtures?: Record<string, { pos?: unknown; rot?: unknown }> } | null)?.fixtures;
  const sd = f && typeof f === 'object' ? f[SD_ID] : undefined;
  const rot = asRot(sd?.rot);
  const pos = asPos(sd?.pos) ?? spotFor(SD_ID, false, rot, obstacles(objects as readonly Placed[], ''));
  return { [SD_ID]: { pos, rot } };
}

function validate(raw: unknown): BenchObject[] {
  if (!raw || typeof raw !== 'object') return [];
  const objs = (raw as { objects?: unknown }).objects;
  if (!Array.isArray(objs)) return [];
  const out: (Omit<BenchObject, 'pos' | 'rot'> & { pos?: Pos; rot?: Rot })[] = [];
  const seen = new Set<string>();
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    const { id, area, kind, name, fields, near, pos, rot } = o as Record<string, unknown>;
    if (typeof id !== 'string' || seen.has(id) || typeof kind !== 'string' || typeof name !== 'string') continue;
    if (typeof area !== 'string' || !(AREA_IDS.has(area) || area === 'part')) continue;
    if (!fields || typeof fields !== 'object') continue;
    const clean: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
    }
    seen.add(id);
    out.push({ id, area: area as AreaId, kind, name, fields: clean, near: near === true, pos: asPos(pos), rot: asRot(rot) });
  }
  // a bench saved before the table existed: near things go near the Dot, the rest is parked
  return placeMissing(out);
}

/** Bench objects: CRUD + slots, persisted to localStorage (every storage access is guarded). */
export class BenchStore {
  private state: BenchState;
  private listeners = new Set<() => void>();
  private past: Snap[] = [];
  private future: Snap[] = [];
  private lastMark: { tag: string; at: number } | null = null;

  constructor(
    private storage: StorageLike | null = null,
    private kindOf: (key: string) => KindDef | undefined = getKind,
  ) {
    let objects: BenchObject[] = [];
    let parsed: unknown = null;
    try {
      const raw = storage?.getItem(BENCH_STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    // the table's numbers (the Dot's footprint, every range) are for the way the Dot is put down: set before anything is placed
    const pose = poseOf(parsed);
    applyDotPose(pose);
    try {
      if (parsed) objects = validate(parsed);
    } catch {
      objects = [];
    }
    this.state = { objects, fixtures: validateFixtures(parsed, objects), ...validateRest(parsed, objects), dotPose: pose, undo: 0, redo: 0 };
  }
  private snap(): Snap {
    const { objects, fixtures, wires, mounts, code, dotPose } = this.state;
    return { objects, fixtures, wires, mounts, code, dotPose };
  }
  private same(s: Snap | undefined): boolean {
    const t = this.state;
    return !!s && s.objects === t.objects && s.fixtures === t.fixtures && s.wires === t.wires && s.mounts === t.mounts && s.code === t.code && s.dotPose === t.dotPose;
  }

  // ---- the whole bench as one file -----------------------------------------------------------------------------
  /** Everything the page itself keeps (the parts engine's own blob travels beside it, see parts/service.ts). */
  exportData(): Snap & { v: number } {
    return { v: 3, ...this.snap() };
  }
  /** Replaces the bench by a saved one; undoable. Returns false when the data is not a bench. */
  importData(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { objects?: unknown }).objects)) return false;
    this.checkpoint();
    const pose = poseOf(raw);
    applyDotPose(pose);
    const objects = validate(raw);
    this.commit({ objects, fixtures: validateFixtures(raw, objects), ...validateRest(raw, objects), dotPose: pose }, true);
    return true;
  }

  // ---- how the Dot is put down ----------------------------------------------------------------------------------
  /**
   * Puts the Dot down another way (lying, standing, on its side). Things on the table stay where they are, unless the
   * Dot now lies on them (they move aside); whether each is in range is measured again from where the Dot's coils, beam
   * and port now are. The card in the slot stays in the slot: it is in the Dot.
   */
  setDotPose(pose: DotPose): void {
    if (pose === this.state.dotPose) return;
    const sd = this.state.fixtures[SD_ID];
    const cardIn = !!sd && isNear(SD_ID, sd.pos, sd.rot);
    applyDotPose(pose);
    const placed: Placed[] = [];
    const objects = this.state.objects.map((o) => {
      if (!hasBody(o.kind)) return o;
      let pos = o.pos;
      // a module on the header goes with the Dot (parts/service.ts puts it where the header now is)
      if (!this.state.mounts[o.id] && overlaps(rectOf(o.kind, pos, o.rot), DOT_RECT)) pos = settle(o.kind, pos, o.rot, obstacles(placed, ''), true) ?? freeSpot(o.kind, pos, o.rot, obstacles(placed, ''));
      placed.push({ id: o.id, kind: o.kind, pos, rot: o.rot });
      const near = zoneOf(o.kind) ? isNear(o.kind, pos, o.rot) : o.near;
      return pos === o.pos && near === o.near ? o : { ...o, pos, near };
    });
    let fixtures = this.state.fixtures;
    if (sd) {
      const obs = obstacles(placed, '');
      const pos = cardIn ? spotFor(SD_ID, true, sd.rot, obs, sd.pos) : overlaps(rectOf(SD_ID, sd.pos, sd.rot), DOT_RECT) ? spotFor(SD_ID, false, sd.rot, obs, sd.pos) : sd.pos;
      if (pos !== sd.pos) fixtures = { ...fixtures, [SD_ID]: { ...sd, pos } };
    }
    this.commit({ dotPose: pose, objects, fixtures }, true);
  }

  // ---- wires, modules on the header, sketches ------------------------------------------------------------------
  addWire(from: string, to: string, color: string = WIRE_COLORS[0]): Wire | null {
    if (!isTerm(from) || !isTerm(to) || from === to) return null;
    if (this.state.wires.some((w) => (w.from === from && w.to === to) || (w.from === to && w.to === from))) return null;
    let n = this.state.wires.length + 1;
    const used = new Set(this.state.wires.map((w) => w.id));
    while (used.has(`w${n}`)) n++;
    const wire: Wire = { id: `w${n}`, from, to, color };
    this.commit({ wires: [...this.state.wires, wire] }, true);
    return wire;
  }
  removeWires(ids: readonly string[]): void {
    const gone = new Set(ids);
    if (!this.state.wires.some((w) => gone.has(w.id))) return;
    this.commit({ wires: this.state.wires.filter((w) => !gone.has(w.id)) }, true);
  }
  setWireColor(id: string, color: string): void {
    if (!this.state.wires.some((w) => w.id === id && w.color !== color)) return;
    this.commit({ wires: this.state.wires.map((w) => (w.id === id ? { ...w, color } : w)) }, true);
  }
  /** One module at a time sits on the Dot. */
  setMount(id: string, side: MountSide | null): void {
    const cur = this.state.mounts[id];
    if ((cur ?? null) === side) return;
    this.commit({ mounts: side ? { [id]: side } : {} }, true);
  }
  setCode(id: string, sketch: Sketch | null): void {
    const code = { ...this.state.code };
    if (sketch) code[id] = sketch;
    else delete code[id];
    this.commit({ code }, true);
  }

  // ---- undo / redo of bench edits ------------------------------------------------------------------------------
  /**
   * Call before an edit the visitor makes (not for what the Dot reports): the state as it is now can be come back to.
   * Edits with the same tag within a moment of each other count as one (a drag, a held arrow key, typing in a field).
   */
  checkpoint(tag = ''): void {
    const now = Date.now();
    if (tag && this.lastMark && this.lastMark.tag === tag && now - this.lastMark.at < COALESCE_MS) {
      this.lastMark.at = now;
      return;
    }
    this.lastMark = { tag, at: now };
    if (this.same(this.past[this.past.length - 1])) return;
    this.past.push(this.snap());
    if (this.past.length > HISTORY_MAX) this.past.shift();
    this.future = [];
    this.commit({}, false);
  }
  undo(): boolean {
    // a checkpoint taken for an edit that then changed nothing is not a step
    while (this.past.length && this.same(this.past[this.past.length - 1])) this.past.pop();
    const prev = this.past.pop();
    if (!prev) {
      this.commit({}, false);
      return false;
    }
    this.future.push(this.snap());
    this.lastMark = null;
    this.commit(prev, true);
    return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snap());
    this.lastMark = null;
    this.commit(next, true);
    return true;
  }

  // ---- places on the table -------------------------------------------------------------------------------------
  private obstaclesFor(skip: ReadonlySet<string> | string) {
    const all: Placed[] = this.state.objects.map((o) => ({ id: o.id, kind: o.kind, pos: o.pos, rot: o.rot }));
    for (const [id, f] of Object.entries(this.state.fixtures)) all.push({ id, kind: id, pos: f.pos, rot: f.rot });
    return obstacles(all, skip);
  }
  /** Puts an object somewhere on the table. For a kind with a range, being inside it IS being near. */
  move(id: string, pos: Pos): void {
    this.moveMany([{ id, pos }]);
  }
  moveMany(moves: readonly { id: string; pos: Pos }[]): void {
    const by = new Map(moves.map((m) => [m.id, m.pos]));
    let changed = false;
    let fixtures = this.state.fixtures;
    const moved = this.state.objects.map((o) => {
      const p = by.get(o.id);
      if (!p || (p.x === o.pos.x && p.z === o.pos.z)) return o;
      changed = true;
      return { ...o, pos: { x: p.x, z: p.z }, near: zoneOf(o.kind) ? isNear(o.kind, p, o.rot) : o.near };
    });
    for (const [fid, f] of Object.entries(fixtures)) {
      const p = by.get(fid);
      if (!p || (p.x === f.pos.x && p.z === f.pos.z)) continue;
      changed = true;
      fixtures = { ...fixtures, [fid]: { ...f, pos: { x: p.x, z: p.z } } };
    }
    if (!changed) return;
    const objects = moved;
    this.commit({ objects, fixtures }, true);
  }
  /** A quarter turn (clockwise seen from above) for each id that has room to turn where it stands, or right beside. */
  rotate(ids: readonly string[], turns = 1): void {
    let objects = this.state.objects;
    let fixtures = this.state.fixtures;
    for (const id of ids) {
      const o = objects.find((x) => x.id === id);
      const f = fixtures[id];
      const kind = o?.kind ?? (f ? id : null);
      const cur = o ?? f;
      if (!kind || !cur || !hasBody(kind)) continue;
      const rot = ((cur.rot + turns + 4) % 4) as Rot;
      const all: Placed[] = objects.map((x) => ({ id: x.id, kind: x.kind, pos: x.pos, rot: x.rot }));
      for (const [fid, fx] of Object.entries(fixtures)) all.push({ id: fid, kind: fid, pos: fx.pos, rot: fx.rot });
      const pos = settle(kind, cur.pos, rot, obstacles(all, id), false);
      if (!pos) continue;
      if (o) objects = objects.map((x) => (x.id === id ? { ...x, rot, pos, near: zoneOf(kind) ? isNear(kind, pos, rot) : x.near } : x));
      else fixtures = { ...fixtures, [id]: { pos, rot } };
    }
    if (objects !== this.state.objects || fixtures !== this.state.fixtures) this.commit({ objects, fixtures }, true);
  }
  /** Where a fixture would go for near/away (the microSD card by its slot, or parked). */
  fixtureSpot(id: string, near: boolean): Pos {
    const f = this.state.fixtures[id];
    return spotFor(id, near, f?.rot ?? 0, this.obstaclesFor(id), f?.pos);
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
  add(kindKey: string, name?: string, at?: Pos): BenchObject | null {
    const def = this.kindOf(kindKey);
    if (!def) return null;
    if (def.single && this.countOf(kindKey) > 0) return null;
    const n = this.countOf(kindKey) + 1;
    const exclusive = getArea(def.area)?.exclusive;
    let near = def.presence !== 'none' && !(exclusive && this.activeIn(def.area));
    let pos: Pos = { x: 0, z: 0 };
    if (hasBody(kindKey)) {
      const obs = this.obstaclesFor('');
      if (at) {
        // dropped on the table: it stays where it was put (or right beside), and that place says whether it is near
        pos = settle(kindKey, at, 0, obs) ?? freeSpot(kindKey, at, 0, obs);
        if (zoneOf(kindKey)) near = isNear(kindKey, pos, 0);
      } else pos = dropSpot(kindKey, near, obs);
    }
    const obj: BenchObject = { id: newId(), area: def.area, kind: kindKey, name: name?.trim() || `${def.key} ${n}`, fields: { ...def.defaults, ...(def.unique?.(n) ?? {}) }, near, pos, rot: 0 };
    this.commit({ objects: [...this.state.objects, obj] }, true);
    return obj;
  }
  /**
   * Puts a wired part on the table (its kind is the part's id in the library; the parts engine gets it from here).
   * Its id is short and plain (p1, p2 ...): it is also the part's instance name in the engine and in wires.
   */
  addPart(partId: string, name: string, fields: Record<string, FieldValue> = {}, at?: Pos): BenchObject {
    let n = 1;
    while (this.get(`p${n}`)) n++;
    let pos: Pos = at ?? { x: 0, z: 0 };
    if (hasBody(partId)) {
      const obs = this.obstaclesFor('');
      pos = at ? (settle(partId, at, 0, obs) ?? freeSpot(partId, at, 0, obs)) : freeSpot(partId, { x: 120, z: 90 }, 0, obs);
    }
    const obj: BenchObject = { id: `p${n}`, area: 'part', kind: partId, name, fields: { ...fields }, near: false, pos, rot: 0 };
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
    if (src.area === 'part') return this.addPart(src.kind, src.name, src.fields, { x: src.pos.x + 10, z: src.pos.z + 10 });
    const n = this.countOf(src.kind) + 1;
    let pos = src.pos;
    if (hasBody(src.kind)) {
      const obs = this.obstaclesFor('');
      const away = (p: Pos) => !zoneOf(src.kind) || !isNear(src.kind, p, src.rot);
      pos = away(src.pos) ? freeSpot(src.kind, { x: src.pos.x + 15, z: src.pos.z + 15 }, src.rot, obs, away) : spotFor(src.kind, false, src.rot, obs, src.pos);
    }
    const copy: BenchObject = { ...src, id: newId(), name: `${src.name} (${suffix})`, fields: { ...src.fields, ...(def?.unique?.(n) ?? {}) }, near: false, pos };
    const idx = this.state.objects.findIndex((o) => o.id === id);
    const objects = [...this.state.objects];
    objects.splice(idx + 1, 0, copy);
    this.commit({ objects }, true);
    return copy;
  }
  remove(id: string): void {
    this.removeMany([id]);
  }
  removeMany(ids: readonly string[]): void {
    const gone = new Set(ids);
    if (!this.state.objects.some((o) => gone.has(o.id))) return;
    const mounts = Object.fromEntries(Object.entries(this.state.mounts).filter(([k]) => !gone.has(k)));
    const code = Object.fromEntries(Object.entries(this.state.code).filter(([k]) => !gone.has(k)));
    this.commit(
      {
        objects: this.state.objects.filter((o) => !gone.has(o.id)),
        wires: this.state.wires.filter((w) => !gone.has(termOwner(w.from)) && !gone.has(termOwner(w.to))),
        mounts: Object.keys(mounts).length === Object.keys(this.state.mounts).length ? this.state.mounts : mounts,
        code: Object.keys(code).length === Object.keys(this.state.code).length ? this.state.code : code,
      },
      true,
    );
  }
  /** Near / in range / pointing at the Dot / plugged in. In an exclusive area (motion) the others leave. */
  setNear(id: string, near: boolean): void {
    const cur = this.get(id);
    if (!cur || cur.near === near) return;
    const exclusive = getArea(cur.area)?.exclusive;
    // the switch moves the object: into its range, or just out of it
    let pos = cur.pos;
    if (hasBody(cur.kind) && zoneOf(cur.kind) && isNear(cur.kind, cur.pos, cur.rot) !== near) pos = spotFor(cur.kind, near, cur.rot, this.obstaclesFor(id), cur.pos);
    // a range with no room left: the object stays where there is room, and that place says what it is
    const now = hasBody(cur.kind) && zoneOf(cur.kind) ? isNear(cur.kind, pos, cur.rot) : near;
    this.commit(
      { objects: this.state.objects.map((o) => (o.id === id ? { ...o, near: now, pos } : now && exclusive && o.area === cur.area ? { ...o, near: false } : o)) },
      true,
    );
  }
  bringNear(id: string): void {
    this.setNear(id, true);
  }
  /** By object id or by area id. */
  takeAway(idOrArea: string): void {
    if (AREA_IDS.has(idOrArea)) {
      for (const o of this.nearIn(idOrArea as AreaId)) this.setNear(o.id, false);
      return;
    }
    this.setNear(idOrArea, false);
  }
  private update(id: string, fn: (o: BenchObject) => BenchObject): void {
    this.commit({ objects: this.state.objects.map((o) => (o.id === id ? fn(o) : o)) }, true);
  }

  /** The Dot has one USB-C port: of the computer and the charger (on its USB cable), the one plugged last stays. */
  private onePort(objects: readonly BenchObject[]): readonly BenchObject[] {
    const usb = (o: BenchObject) => o.near && (o.kind === 'usb.computer' || (o.kind === 'power.charger' && (o.fields.cable ?? 'usb') === 'usb'));
    const now = objects.filter(usb);
    if (now.length < 2) return objects;
    const was = new Set(this.state.objects.filter(usb).map((o) => o.id));
    const loser = now.find((o) => was.has(o.id)) ?? now[0];
    const obs = obstacles(objects.filter((o) => o.id !== loser.id) as readonly Placed[], '');
    return objects.map((o) => (o.id === loser.id ? { ...o, near: false, pos: spotFor(o.kind, false, o.rot, obs, o.pos) } : o));
  }

  private commit(next: Partial<Snap>, persist: boolean): void {
    // an undo, a redo or an opened file may put the Dot down another way: the table's numbers follow before anything is measured
    applyDotPose(next.dotPose ?? this.state.dotPose);
    if (next.objects && next.objects !== this.state.objects) next = { ...next, objects: this.onePort(next.objects) };
    this.state = { ...this.snap(), ...next, undo: this.past.length, redo: this.future.length };
    if (persist) this.save();
    for (const l of [...this.listeners]) l();
  }

  private save(): void {
    try {
      this.storage?.setItem(BENCH_STORAGE_KEY, JSON.stringify(this.exportData()));
    } catch {
      /* quota or disabled storage: keep working in memory */
    }
  }
}
