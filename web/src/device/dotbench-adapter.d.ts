declare module '*/web-adapter/dotbench-system.js' {
  export const DotbenchSystem: new (opts: {
    os: ArrayBuffer | Uint8Array;
    persist?: unknown;
    factory?: { apps: string[]; fetch: (name: string) => Promise<ArrayBuffer | Uint8Array> } | null;
    pollMs?: number;
  }) => import('./adapter-types').AdapterSystem;
}
declare module '*/web-adapter/persist-idb.js' {
  export const IdbBackend: new (opts?: { name?: string }) => unknown;
}

// the parts engine (runtime/web-adapter/bench*.js): typed where it is used (parts/service.ts)
declare module '*/generated/web-adapter/bench.js' {
  export const Bench: new () => unknown;
  export const DEVICE_TERMINALS: { term: string; name: string; kind: string; pin: number }[];
}
declare module '*/generated/web-adapter/bench-wasm.js' {
  export function configureWorker(o: { source?: string; url?: string }): void;
}
