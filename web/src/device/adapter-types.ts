/**
 * The part of runtime/web-adapter's `DotbenchDevice` that the page uses, as a structural type so that
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

export interface AdapterDevice {
  on(type: 'status', cb: (s: AdapterStatusDetail) => void): () => void;
  on(type: 'log', cb: (l: AdapterLogLine) => void): () => void;
  on(type: 'outputs', cb: (o: AdapterOutputs) => void): () => void;
  on(type: string, cb: (d: unknown) => void): () => void;
  readonly status: AdapterStatus;
  readonly statusDetail: AdapterStatusDetail;
  readonly appName: string | null;
  readonly workerCount: number;
  readonly wasmMemoryBytes: number;
  load(bytes: ArrayBuffer | Uint8Array): Promise<void>;
  start(opts?: { reason?: number }): Promise<void>;
  stop(): void;
  restart(opts?: { reason?: number }): Promise<void>;
  dispose(): void;
  copyFrame(out: Uint8ClampedArray, lastSeq?: number): number;
  readonly frameSeq: number;
  button(id: number | string, pressed: boolean): void;
  touch(x: number, y: number, down: boolean): void;
  releaseAll(): void;
  outputs(): AdapterOutputs;
  readonly lines: readonly AdapterLogLine[];
  sendConsole(line: string): void;
  time(): number;
  area(name: string): unknown;
  readonly areaNames: string[];
  exportPersist(): Map<string, Uint8Array>;
  importPersist(map: Map<string, Uint8Array>): void;
  /** Not in the adapter yet: whole-device export/import (feature-detected). */
  exportDevice?: () => Promise<Uint8Array | ArrayBuffer | Blob> | Uint8Array | ArrayBuffer | Blob;
  importDevice?: (data: Uint8Array) => Promise<void> | void;
}
