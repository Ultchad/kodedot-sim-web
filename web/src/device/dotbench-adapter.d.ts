declare module '*/web-adapter/dotbench-device.js' {
  export const SCREEN_WIDTH: number;
  export const SCREEN_HEIGHT: number;
  export const DotbenchDevice: new (opts?: {
    pollMs?: number;
    autoRestart?: boolean;
    maxLogLines?: number;
    resolveTarget?: (name: string) => Promise<ArrayBuffer | null>;
  }) => import('./adapter-types').AdapterDevice;
}
