/**
 * The part of runtime/web-adapter's `DotbenchSystem` that the page uses, as a structural type so that
 * tests can pass a fake. The real class is imported lazily from ../generated/web-adapter (copied by
 * scripts/sync-adapter.mjs; never edit that copy).
 */
export type AdapterStatus = 'idle' | 'booting' | 'running' | 'crashed' | 'restart-requested';
export interface AdapterStatusDetail {
  status: AdapterStatus;
  reason?: string;
  target?: string;
}
export interface AdapterLogLine {
  id: number;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error' | 'input';
  text: string;
  channel: number;
}
export interface AdapterOutputs {
  led: { r: number; g: number; b: number };
  haptic: number;
  backlight: number;
  panelOn: boolean;
}

export interface Program {
  id: string;
  name: string;
  kind: 'os' | 'app';
}
export interface InstalledApp {
  /** the package's id (also what `launch` and `remove` take) */
  id: string;
  project: string;
  name: string;
  version: string;
  category: string;
  /** size of the app's entry in the Dot's apps region (not of the package) */
  size: number;
  /** false: listed by kodeOS but its package is not on this Dot, so it cannot be opened */
  hasBundle: boolean;
}

/** `DotbenchSystem` (runtime/web-adapter/dotbench-system.js): kodeOS plus its installed apps, one object for the page. */
export interface AdapterSystem {
  on(type: 'status', cb: (s: AdapterStatusDetail) => void): () => void;
  on(type: 'program', cb: (p: Program) => void): () => void;
  on(type: 'apps', cb: (list: unknown) => void): () => void;
  on(type: 'log', cb: (l: AdapterLogLine) => void): () => void;
  on(type: 'outputs', cb: (o: AdapterOutputs) => void): () => void;
  on(type: string, cb: (d: never) => void): () => void;
  readonly status: AdapterStatus;
  readonly program: Program | null;
  readonly workerCount: number;
  readonly wasmMemoryBytes: number;
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
  powerOnReset(): Promise<void>;
  home(): Promise<void>;
  launch(id: string, opts?: { sticky?: boolean }): Promise<void>;
  install(bytes: Uint8Array): Promise<{ id: string; project: string }>;
  list(): (InstalledApp & { offset?: number; seq?: number })[];
  remove(id: string): Promise<boolean>;
  factoryReset(): Promise<void>;
  copyFrame(out: Uint8ClampedArray, lastSeq?: number): number;
  button(id: number | string, pressed: boolean): void;
  touch(x: number, y: number, down: boolean): void;
  releaseAll(): void;
  outputs(): AdapterOutputs;
  sendConsole(line: string): void;
  time(): number;
  area(name: string): unknown;
  exportDeviceFile(extra?: object): Uint8Array;
  flushPersist(): Promise<unknown>;
  /** the one-program device underneath; the page uses it only to import a device file */
  readonly device: { importDeviceFile(bytes: Uint8Array): Promise<unknown> };
}
