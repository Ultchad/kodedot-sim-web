/**
 * The wired parts of the bench: the page's side of the parts engine (runtime/web-adapter/bench.js, docs/STATUS-parts.md
 * "Page wiring"). The bench store stays the truth (each part is an object of area 'part': kind = the part's id in
 * the library, id = its instance name in the engine, fields, place); this service makes the engine equal to it, the
 * same way the bench runtime does for the wireless objects, and hands the engine's live state to the table and the panel.
 * The engine is fetched the first time a part is on the bench or the library is opened.
 */
import type { BenchObject, FieldValue } from '../bench/model';
import type { BenchStore, MountSide } from '../bench/store';
import { fromB64, kvAll, kvDel, kvGet, kvSet, toB64 } from './idb';
import { findPlug, hostOf, legsOf, localTerms, mountMatrix, type Host, type LocalTerm, type MountGeo, type Plug } from './geometry';
import type { PartState } from '../bench3d/contract';
import type { KodeDevice } from '../device/types';
import { dotToTable, obstacles, registerSize, settle, type DotPose, type Placed, type Pos, type Rot } from '../workbench/layout';

export type Text3 = { en: string; 'pt-BR'?: string; es?: string };
export interface PartField {
  name: string;
  type: 'number' | 'integer' | 'boolean' | 'enum' | string;
  label?: Text3;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: FieldValue;
  values?: { value: FieldValue; label?: Text3 }[];
}
/** A control of a part (manifest `controls[]`): the field it works, how, and for a board's button what it does and where it is. */
export interface PartControl {
  field: string;
  mode: string;
  label?: Text3;
  /** Where the control is on the part, millimetres from the body's top-left corner (the frame of `pins[].mm`). */
  mm?: { x: number; y: number };
  /** `restart`: the sketch restarts when the field goes true. `pull_low`: `pin` is held at 0 V while it is true. */
  action?: 'restart' | 'pull_low';
  pin?: string;
  estimate?: boolean;
}
export interface PartManifest {
  id: string;
  name: Text3;
  category: string;
  body: { w_mm: number; d_mm: number; h_mm: number };
  pins: { name: string; kind: string; mm?: { x: number; y: number; z?: number }; face?: 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'; label?: Text3 }[];
  fields?: PartField[];
  controls?: PartControl[];
  picture?: { file: string; width: number; height: number };
  behaviour: { type: string; core?: string; sources?: string[]; elements?: { type: string; [key: string]: unknown }[] };
  mount?: MountGeo & { via?: string; orientations?: MountSide[]; pins?: { pin: string; gpio: number }[]; rails?: { pin: string; rail: string }[] };
  groups?: { pins: string[] }[];
}
export interface LibraryEntry {
  id: string;
  file: string;
  name: Text3;
  category: string;
  kind: string;
  keywords?: Record<string, string[]>;
  description?: Text3;
  body?: { w_mm: number; d_mm: number; h_mm: number };
  pins?: number;
  /** Imported by the visitor (not from the site's library). */
  user?: boolean;
}
export interface Hazard {
  class: string;
  text?: string;
  part?: string;
  instance?: string;
  net?: number;
}
export interface EngineState {
  version: number;
  rails: { V33: boolean; V5: boolean };
  attached: boolean;
  parts: (PartState & { instance: string; id: string; crashed?: boolean; failed?: string[] })[];
  wires: { id: string; from: string; to: string; color?: string; short?: boolean }[];
  hazards: Hazard[];
}
interface Engine {
  loadPart(bytes: Uint8Array): Promise<{ ok: boolean; errors: { message: string }[]; manifest: PartManifest; picture: { mime: string; bytes: Uint8Array } | null }>;
  addPart(id: string, o: { instance: string; fields?: Record<string, FieldValue>; label?: string }): string;
  removePart(instance: string): boolean;
  setField(instance: string, name: string, value: FieldValue): void;
  repairPart(instance: string): void;
  connect(a: string, b: string, o?: { color?: string; id?: string }): string;
  disconnect(id: string): boolean;
  mountPart(instance: string, side: MountSide): string;
  unmountPart(instance: string): boolean;
  setUsbPower(on: boolean): void;
  getPartCode(instance: string): { source: string; wasm: Uint8Array | null; name: string; custom: boolean };
  setPartCode(instance: string, code: { source?: string; wasm: Uint8Array; name?: string }): Promise<{ sha256: string; bytes: number }>;
  clearPartCode(instance: string): Promise<void>;
  serialLog(instance: string): string[];
  serialIn(instance: string, text: string): void;
  restartPart(instance: string): Promise<void> | void;
  serialise(name?: string): { parts: { instance: string; code?: { source: string; wasm_b64: string; name: string }; storage_b64?: string }[] };
  attach(target: unknown): unknown;
  detach(): void;
  state(): EngineState;
  on(type: string, cb: (e: unknown) => void): () => void;
}

const BASE = `${import.meta.env.BASE_URL}parts/`;
const EMPTY: EngineState = { version: 0, rails: { V33: false, V5: false }, attached: false, parts: [], wires: [], hazards: [] };

export class PartsService {
  private engine: Engine | null = null;
  private starting: Promise<Engine> | null = null;
  private library: LibraryEntry[] | null = null;
  private libraryP: Promise<LibraryEntry[]> | null = null;
  private manifests = new Map<string, PartManifest>();
  private pictures = new Map<string, string>();
  private loading = new Map<string, Promise<PartManifest | null>>();
  private applied = new Map<string, string>();
  private appliedWires = new Map<string, string>();
  private appliedMount: string | null = null;
  private plugMap = new Map<string, Plug>();
  private plugKey: unknown = null;
  /** Wires the engine refused (a terminal that does not exist), by wire id. */
  readonly refused = new Map<string, string>();
  private snapshot: EngineState = EMPTY;
  private byInstance = new Map<string, EngineState['parts'][number]>();
  private listeners = new Set<() => void>();
  private version = 0;
  private consoleTimer: ReturnType<typeof setTimeout> | null = null;
  private device: KodeDevice | null = null;
  private syncing = false;
  private again = false;
  /** What went wrong fetching or starting, for the panel. */
  error: string | null = null;

  constructor(private bench: BenchStore) {
    bench.subscribe(() => void this.sync());
    // sizes of the parts already on the bench, so they keep their places before the engine is up
    if (this.partObjects().length) void this.sync();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = (): number => this.version;
  private bump(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** The library index (what can be put on the table). */
  async loadLibrary(): Promise<LibraryEntry[]> {
    this.libraryP ??= fetch(`${BASE}library.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`library.json: ${r.status}`);
        return r.json() as Promise<{ parts: LibraryEntry[] }>;
      })
      .then((j) => {
        this.library = j.parts;
        for (const p of j.parts) if (p.body) registerSize(p.id, { w: p.body.w_mm, d: p.body.d_mm, h: p.body.h_mm });
        this.bump();
        return j.parts;
      })
      .catch((e) => {
        this.error = String((e as Error).message ?? e);
        this.libraryP = null;
        this.bump();
        return [];
      });
    return this.libraryP;
  }
  entries(): readonly LibraryEntry[] {
    return this.library ?? [];
  }
  manifest(id: string): PartManifest | undefined {
    return this.manifests.get(id);
  }
  /** The part's own picture (its top view) as an object URL, when its package is loaded. */
  picture(id: string): string | undefined {
    return this.pictures.get(id);
  }
  state(): EngineState {
    return this.snapshot;
  }
  /** The live state of one part on the table (the engine's own entry), or undefined before the engine knows it. */
  stateOf(instance: string): (PartState & { crashed?: boolean; failed?: string[] }) | undefined {
    return this.byInstance.get(instance);
  }
  hazardsOf(instance: string): Hazard[] {
    return this.snapshot.hazards.filter((h) => h.instance === instance || h.part === instance);
  }

  private async start(): Promise<Engine> {
    this.starting ??= (async () => {
      const [{ Bench }, wasm, source] = await Promise.all([
        import('../generated/web-adapter/bench.js') as Promise<{ Bench: new () => Engine }>,
        import('../generated/web-adapter/bench-wasm.js') as Promise<{ configureWorker(o: { source: string }): void }>,
        fetch(`${BASE}part-worker.js`).then((r) => r.text()),
      ]);
      wasm.configureWorker({ source });
      const e = new Bench();
      e.on('change', () => this.read());
      e.on('hazard', () => this.read());
      // serial lines arrive in bursts: the panel hears of them a few times a second
      e.on('console', () => {
        this.consoleTimer ??= setTimeout(() => {
          this.consoleTimer = null;
          this.bump();
        }, 150);
      });
      this.engine = e;
      void this.attach();
      return e;
    })();
    return this.starting;
  }
  private read(): void {
    if (!this.engine) return;
    this.snapshot = this.engine.state();
    this.byInstance = new Map(this.snapshot.parts.map((p) => [p.instance, p]));
    this.bump();
  }

  /** The Dot the parts are wired to (the engine re-attaches itself at every boot of that Dot). */
  setDevice(device: KodeDevice): void {
    this.device = device;
    void this.attach();
  }
  private async attach(): Promise<void> {
    const d = this.device as (KodeDevice & { system?: () => Promise<unknown> }) | null;
    if (!this.engine) return;
    this.engine.detach();
    if (!d?.system) return;
    try {
      this.engine.attach(await d.system());
      this.read();
    } catch {
      /* the Dot cannot run here: the parts still work among themselves */
    }
  }

  /** Fetches a part's package and gives it to the engine. */
  ensurePart(id: string): Promise<PartManifest | null> {
    const have = this.manifests.get(id);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(id);
    if (!p) {
      p = (async () => {
        await this.loadLibrary();
        await this.loadUserParts();
        if (this.manifests.has(id)) return this.manifests.get(id)!;
        const entry = (this.library ?? []).find((x) => x.id === id);
        if (!entry || entry.user) return null;
        const engine = await this.start();
        const bytes = new Uint8Array(await (await fetch(`${BASE}${entry.file}`)).arrayBuffer());
        const def = await engine.loadPart(bytes);
        if (!def.ok) {
          this.error = `${id}: ${def.errors.map((x) => x.message).join('; ')}`;
          return null;
        }
        this.manifests.set(id, def.manifest);
        registerSize(id, { w: def.manifest.body.w_mm, d: def.manifest.body.d_mm, h: def.manifest.body.h_mm });
        if (def.picture) this.pictures.set(id, URL.createObjectURL(new Blob([def.picture.bytes as BlobPart], { type: def.picture.mime || 'image/svg+xml' })));
        this.bump();
        return def.manifest;
      })().catch((e) => {
        this.error = String((e as Error).message ?? e);
        this.bump();
        return null;
      });
      this.loading.set(id, p);
    }
    return p;
  }

  private partObjects(): BenchObject[] {
    return this.bench.getState().objects.filter((o) => o.area === 'part');
  }

  /** Makes the engine's parts equal to the bench's: adds, removes, field changes. */
  async sync(): Promise<void> {
    if (this.syncing) {
      this.again = true; // the bench changed while the engine was being brought up to date: go round once more
      return;
    }
    this.syncing = true;
    try {
      const objs = this.partObjects();
      if (!objs.length && !this.engine) return;
      await Promise.all([...new Set(objs.map((o) => o.kind))].map((k) => this.ensurePart(k)));
      const engine = this.engine;
      if (!engine) return;
      const now = this.partObjects();
      const ids = new Set(now.map((o) => o.id));
      for (const id of [...this.applied.keys()]) {
        if (ids.has(id)) continue;
        engine.removePart(id);
        this.applied.delete(id);
        if (this.appliedMount?.startsWith(`${id}:`)) this.appliedMount = null;
      }
      for (const o of now) {
        if (!this.manifests.has(o.kind)) continue;
        const sig = `${o.kind}|${JSON.stringify(o.fields)}`;
        let was = this.applied.get(o.id);
        if (was !== undefined && !was.startsWith(`${o.kind}|`)) {
          engine.removePart(o.id); // the same name, another part (a bench file was opened)
          this.applied.delete(o.id);
          was = undefined;
        }
        if (was === undefined) {
          engine.addPart(o.kind, { instance: o.id, fields: o.fields, label: o.name });
          void this.restoreCode(o.id, o.kind);
        }
        else if (was !== sig) for (const [k, v] of Object.entries(o.fields)) engine.setField(o.id, k, v);
        this.applied.set(o.id, sig);
      }
      this.syncLinks(engine);
      this.read();
    } finally {
      this.syncing = false;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    }
  }

  // ---- wires, legs in holes, the module on the header ------------------------------------------------------------
  private hosts(skip?: string): Host[] {
    const out: Host[] = [];
    for (const o of this.partObjects()) {
      if (o.id === skip) continue;
      const m = this.manifests.get(o.kind);
      const h = m && !this.bench.getState().mounts[o.id] ? hostOf(o.id, m, o.pos, o.rot as Rot) : null;
      if (h) out.push(h);
    }
    return out;
  }
  /** Which parts stand with their legs in which holes, by instance (derived from where things are). */
  plugs(): ReadonlyMap<string, Plug> {
    const st = this.bench.getState();
    const key = `${this.manifests.size}`;
    if (this.plugKey !== st.objects || this.plugSize !== key || this.plugMounts !== st.mounts) {
      this.plugKey = st.objects;
      this.plugSize = key;
      this.plugMounts = st.mounts;
      this.plugMap = new Map();
      const hosts = this.hosts();
      if (hosts.length) {
        for (const o of this.partObjects()) {
          const m = this.manifests.get(o.kind);
          const legs = m ? legsOf(m) : [];
          const plug = legs.length ? findPlug(legs, o.pos, o.rot as Rot, hosts, 0.3) : null;
          if (plug) this.plugMap.set(o.id, plug);
        }
      }
    }
    return this.plugMap;
  }
  private plugMounts: unknown = null;
  private plugSize = '';
  /** Where a part would stand if it were let go at `pos`: in the holes under its legs, or null when there are none. */
  plugAt(id: string, pos: Pos, rot: Rot): Plug | null {
    const o = this.bench.get(id);
    const m = o && this.manifests.get(o.kind);
    const legs = m ? legsOf(m) : [];
    if (!legs.length) return null;
    const plug = findPlug(legs, pos, rot, this.hosts(id), 2.2);
    if (!plug) return null;
    // two parts cannot stand in the same holes
    const taken = new Set<string>();
    for (const [other, p] of this.plugs()) if (other !== id && p.host === plug.host) for (const [, hole] of p.pairs) taken.add(hole);
    return plug.pairs.some(([, hole]) => taken.has(hole)) ? null : plug;
  }
  /** The parts standing on a board (they travel with it). */
  ridersOf(host: string): string[] {
    const out: string[] = [];
    for (const [id, p] of this.plugs()) if (p.host === host) out.push(id);
    return out;
  }
  liftOf(instance: string): number {
    return this.plugs().get(instance)?.lift ?? 0;
  }
  terms(kind: string): LocalTerm[] {
    const m = this.manifests.get(kind);
    return m ? localTerms(m) : [];
  }
  /** Model frame to the Dot's own frame for a module on the header (geometry.ts), or null. */
  mountOf(instance: string): number[] | null {
    const side = this.bench.getState().mounts[instance];
    const o = side ? this.bench.get(instance) : undefined;
    const m = o && this.manifests.get(o.kind);
    return m && side ? mountMatrix(m.body, m.mount, side) : null;
  }
  /** Mount a module on the Dot's header (or take it off with null). */
  mount(instance: string, side: MountSide | null): void {
    const o = this.bench.get(instance);
    const m = o && this.manifests.get(o.kind);
    if (!o || !m) return;
    this.bench.checkpoint();
    this.bench.setMount(instance, side);
    const all: Placed[] = this.bench.getState().objects.map((x) => ({ id: x.id, kind: x.kind, pos: x.pos, rot: x.rot }));
    const mat = side ? mountMatrix(m.body, m.mount, side) : null;
    // on the table the module's place is where its model's origin is, the Dot put down the way it is
    const pos = mat ? this.mountSpot(mat) : settle(o.kind, o.pos, o.rot as Rot, obstacles(all, instance), true);
    if (pos) this.bench.move(instance, pos);
  }
  private mountSpot(mat: number[]): { x: number; z: number } {
    const p = dotToTable(this.bench.getState().dotPose, mat[12], mat[13], mat[14]);
    return { x: p.x, z: p.z };
  }
  /** Puts the Dot down another way (lying, standing, on its side); the module on its header goes with it. One undo step. */
  setDotPose(pose: DotPose): void {
    if (pose === this.bench.getState().dotPose) return;
    this.bench.checkpoint();
    this.bench.setDotPose(pose);
    for (const id of Object.keys(this.bench.getState().mounts)) {
      const mat = this.mountOf(id);
      if (mat) this.bench.move(id, this.mountSpot(mat));
    }
  }

  private syncLinks(engine: Engine): void {
    const st = this.bench.getState();
    // the module on the header
    const want = Object.entries(st.mounts).find(([id]) => this.applied.has(id));
    const wantKey = want ? `${want[0]}:${want[1]}` : null;
    if (wantKey !== this.appliedMount) {
      if (this.appliedMount) {
        try {
          engine.unmountPart(this.appliedMount.split(':')[0]);
        } catch {
          /* the part is gone already */
        }
      }
      this.appliedMount = null;
      if (want) {
        try {
          engine.mountPart(want[0], want[1]);
          engine.setUsbPower(true);
          this.appliedMount = wantKey;
        } catch (e) {
          this.error = String((e as Error).message ?? e);
        }
      }
    }
    // jumper wires, and a wire for each leg standing in a hole
    const links = new Map<string, { from: string; to: string; color?: string }>();
    for (const w of st.wires) links.set(w.id, w);
    for (const [id, p] of this.plugs()) for (const [leg, hole] of p.pairs) links.set(`plug_${id}_${leg}`, { from: `${id}.${leg}`, to: `${p.host}.${hole}` });
    for (const [id] of [...this.appliedWires]) {
      const l = links.get(id);
      if (l && this.appliedWires.get(id) === `${l.from}|${l.to}|${l.color ?? ''}`) continue;
      engine.disconnect(id);
      this.appliedWires.delete(id);
    }
    for (const [id, l] of links) {
      if (this.appliedWires.has(id)) continue;
      if (!this.applied.has(l.from.split('.')[0]) && !l.from.startsWith('device.')) continue;
      if (!this.applied.has(l.to.split('.')[0]) && !l.to.startsWith('device.')) continue;
      try {
        engine.connect(l.from, l.to, { color: l.color, id });
        this.appliedWires.set(id, `${l.from}|${l.to}|${l.color ?? ''}`);
        this.refused.delete(id);
      } catch (e) {
        this.refused.set(id, String((e as Error).message ?? e));
      }
    }
  }

  // ---- a board's own sketch ---------------------------------------------------------------------------------------
  /** The compiler's board id for a part that carries a sketch, or null for any other part. */
  coreOf(kind: string): string | null {
    const b = this.manifests.get(kind)?.behaviour;
    return b?.type === 'wasm' && b.core ? b.core : null;
  }
  /** The sketch the board runs now (the package's own until something is uploaded). */
  sketchOf(instance: string): { source: string; custom: boolean } | null {
    try {
      const c = this.engine?.getPartCode(instance);
      return c ? { source: c.source, custom: c.custom } : null;
    } catch {
      return null;
    }
  }
  /** "Upload": the board gets the new binary and restarts alone; the binary is kept for the next visit. */
  async upload(instance: string, source: string, wasm: Uint8Array): Promise<void> {
    if (!this.engine) throw new Error('the parts engine is not running');
    await this.engine.setPartCode(instance, { source, wasm, name: 'sketch' });
    await kvSet('code', instance, { kind: this.bench.get(instance)?.kind, source, wasm });
    this.read();
  }
  async resetCode(instance: string): Promise<void> {
    await this.engine?.clearPartCode(instance);
    await kvDel('code', instance);
    this.read();
  }
  private async restoreCode(instance: string, kind: string): Promise<void> {
    if (!this.coreOf(kind)) return;
    const saved = await kvGet<{ kind: string; source: string; wasm: Uint8Array }>('code', instance);
    if (!saved || saved.kind !== kind || !this.bench.getState().code[instance] || !this.applied.has(instance)) return;
    try {
      await this.engine?.setPartCode(instance, { source: saved.source, wasm: saved.wasm, name: 'sketch' });
      this.read();
    } catch {
      /* a binary from another version of the engine: the package's sketch stays */
    }
  }
  serial(instance: string): string[] {
    try {
      return this.engine?.serialLog(instance) ?? [];
    } catch {
      return [];
    }
  }
  serialIn(instance: string, text: string): void {
    try {
      this.engine?.serialIn(instance, text);
    } catch {
      /* the board is off */
    }
  }
  /** Test hook: what the Dot does with one header position (0..13), without an app doing it. */
  drivePin(index: number, st: { mode: 'z' | 'in' | 'out' | 'pwm'; level?: number }): void {
    (this.engine as unknown as { setDevicePin(i: number, s: object): void } | null)?.setDevicePin(index, st);
    this.read();
  }
  restart(instance: string): void {
    void this.engine?.restartPart(instance);
  }

  // ---- the whole bench as one file ---------------------------------------------------------------------------------
  /** Compiled sketches and imported parts, to travel with the bench's own data. */
  async exportExtras(): Promise<{ code: Record<string, { kind: string; source: string; wasm_b64: string }>; userParts: { name: string; b64: string }[] }> {
    const code: Record<string, { kind: string; source: string; wasm_b64: string }> = {};
    for (const [k, v] of await kvAll<{ kind: string; source: string; wasm: Uint8Array }>('code')) {
      if (this.bench.getState().code[k] && this.bench.get(k)?.kind === v.kind) code[k] = { kind: v.kind, source: v.source, wasm_b64: toB64(v.wasm) };
    }
    const userParts = (await kvAll<{ name: string; bytes: Uint8Array }>('userparts')).map(([, v]) => ({ name: v.name, b64: toB64(v.bytes) }));
    return { code, userParts };
  }
  async importExtras(x: { code?: Record<string, { kind: string; source: string; wasm_b64: string }>; userParts?: { name: string; b64: string }[] } | undefined): Promise<void> {
    for (const p of x?.userParts ?? []) await this.importPart(fromB64(p.b64), p.name);
    for (const [k, v] of Object.entries(x?.code ?? {})) await kvSet('code', k, { kind: v.kind, source: v.source, wasm: fromB64(v.wasm_b64) });
  }

  // ---- the visitor's own parts (.dotpart files) ----------------------------------------------------------------------
  private user = new Map<string, { name: string; file: string }>();
  userParts(): { id: string; name: string; file: string }[] {
    return [...this.user].map(([id, v]) => ({ id, ...v }));
  }
  /** Reads a .dotpart file: on success the part is in the library (and kept for the next visit). */
  async importPart(bytes: Uint8Array, file: string): Promise<{ ok: boolean; id?: string; errors: string[] }> {
    try {
      const engine = await this.start();
      await this.loadLibrary();
      const def = await engine.loadPart(bytes);
      if (!def.ok) return { ok: false, errors: def.errors.map((e) => e.message) };
      const m = def.manifest;
      this.manifests.set(m.id, m);
      registerSize(m.id, { w: m.body.w_mm, d: m.body.d_mm, h: m.body.h_mm });
      if (def.picture) this.pictures.set(m.id, URL.createObjectURL(new Blob([def.picture.bytes as BlobPart], { type: def.picture.mime || 'image/svg+xml' })));
      this.user.set(m.id, { name: m.name.en, file });
      const entry: LibraryEntry = { id: m.id, file, name: m.name, category: m.category, kind: m.behaviour.type, body: m.body, pins: m.pins.length, user: true };
      this.library = [...(this.library ?? []).filter((p) => p.id !== m.id), entry];
      await kvSet('userparts', m.id, { name: file, bytes });
      this.bump();
      void this.sync();
      return { ok: true, id: m.id, errors: [] };
    } catch (e) {
      return { ok: false, errors: [String((e as Error).message ?? e)] };
    }
  }
  async removeUserPart(id: string): Promise<void> {
    this.user.delete(id);
    this.library = (this.library ?? []).filter((p) => p.id !== id);
    await kvDel('userparts', id);
    this.bump();
  }
  private userLoaded: Promise<void> | null = null;
  /** The parts imported on earlier visits come back into the library. */
  loadUserParts(): Promise<void> {
    this.userLoaded ??= (async () => {
      for (const [, v] of await kvAll<{ name: string; bytes: Uint8Array }>('userparts')) await this.importPart(v.bytes, v.name);
    })();
    return this.userLoaded;
  }

  /** Adds a part from the library to the table, with its default fields. */
  async place(id: string, name: string, at?: { x: number; z: number }): Promise<BenchObject | null> {
    const m = await this.ensurePart(id);
    if (!m) return null;
    const fields: Record<string, FieldValue> = {};
    for (const f of m.fields ?? []) fields[f.name] = f.default;
    this.bench.checkpoint();
    return this.bench.addPart(id, name, fields, at);
  }
  repair(instance: string): void {
    this.engine?.repairPart(instance);
    this.read();
  }
}

export const text3 = (t: Text3 | undefined, locale: string, fallback = ''): string => (t ? ((t as Record<string, string | undefined>)[locale] ?? t.en ?? fallback) : fallback);
