/**
 * The wired parts of the bench: the page's side of the parts engine (runtime/web-adapter/bench.js, docs/STATUS-parts.md
 * "Page wiring"). The bench store stays the truth (each part is an object of area 'part': kind = the part's id in
 * the library, id = its instance name in the engine, fields, place); this service makes the engine equal to it, the
 * same way the bench runtime does for the wireless objects, and hands the engine's live state to the table and the panel.
 * The engine is fetched the first time a part is on the bench or the library is opened.
 */
import type { BenchObject, FieldValue } from '../bench/model';
import type { BenchStore } from '../bench/store';
import type { PartState } from '../bench3d/contract';
import type { KodeDevice } from '../device/types';
import { registerSize } from '../workbench/layout';

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
export interface PartManifest {
  id: string;
  name: Text3;
  category: string;
  body: { w_mm: number; d_mm: number; h_mm: number };
  pins: { name: string; kind: string; mm?: { x: number; y: number; z?: number }; face?: 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'; label?: Text3 }[];
  fields?: PartField[];
  controls?: { field: string; mode: string }[];
  picture?: { file: string; width: number; height: number };
  behaviour: { type: string };
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
  private snapshot: EngineState = EMPTY;
  private byInstance = new Map<string, EngineState['parts'][number]>();
  private listeners = new Set<() => void>();
  private version = 0;
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
        const lib = await this.loadLibrary();
        const entry = lib.find((x) => x.id === id);
        if (!entry) return null;
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
      }
      for (const o of now) {
        if (!this.manifests.has(o.kind)) continue;
        const sig = JSON.stringify(o.fields);
        const was = this.applied.get(o.id);
        if (was === undefined) engine.addPart(o.kind, { instance: o.id, fields: o.fields, label: o.name });
        else if (was !== sig) for (const [k, v] of Object.entries(o.fields)) engine.setField(o.id, k, v);
        this.applied.set(o.id, sig);
      }
      this.read();
    } finally {
      this.syncing = false;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    }
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
