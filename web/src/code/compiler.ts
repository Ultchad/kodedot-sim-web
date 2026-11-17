/**
 * The in-browser sketch compiler (runtime/cc, docs/STATUS-cc.md "Page wiring"): one for the page, made the first time a
 * code editor opens. Nothing but its small manifest is fetched until the first Compile.
 */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note' | string;
  message: string;
  hint?: string;
}
export interface CompileResult {
  ok: boolean;
  wasm?: Uint8Array;
  diagnostics: Diagnostic[];
  log: string;
  timings: Record<string, number | string | boolean>;
  cancelled?: boolean;
}
export interface CcInfo {
  ready: boolean;
  boards: Record<string, { name: string; defaultSketch?: { name: string; text: string } }>;
  download: { toolchainBytes: number; toolchainMissingBytes: number; perBoard: Record<string, { bytes: number; missingBytes: number }> };
}
export type CcProgress = { phase: 'download'; overallLoaded: number; overallTotal: number } | { phase: 'step'; step: string } | { phase: 'worker'; state: string };
interface Compiler {
  info(): Promise<CcInfo>;
  ready(o: { board: string }): Promise<unknown>;
  compile(req: { board: string; files: Record<string, string> }): Promise<CompileResult> & { cancel(): void };
}

const listeners = new Set<(p: CcProgress) => void>();
let cc: Promise<Compiler> | null = null;

export function onProgress(l: (p: CcProgress) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function compiler(): Promise<Compiler> {
  cc ??= import('../generated/cc/index.js').then(
    (m) => m.createCompiler({ assetsBaseUrl: `${import.meta.env.BASE_URL}cc/`, onProgress: (e) => listeners.forEach((l) => l(e as CcProgress)) }) as Compiler,
  );
  return cc;
}
/** What the first Compile will download for a board (bytes), 0 when it is all here already; null when the compiler's files are not on this site. */
export async function downloadSize(board: string): Promise<number | null> {
  try {
    const info = await (await compiler()).info();
    return info.download.toolchainMissingBytes + (info.download.perBoard[board]?.missingBytes ?? 0);
  } catch {
    return null;
  }
}
