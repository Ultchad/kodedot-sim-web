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
