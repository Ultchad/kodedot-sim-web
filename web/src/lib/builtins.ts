/** Built-in demo apps: public/apps/index.json, written by scripts/prepare-apps.mjs from the firmware build. */
export interface BuiltinApp {
  id: string;
  file: string;
  name: string;
  description: Record<string, string>;
  size: number;
  version: string;
  sdkCommit: string;
}

export const BUILTIN_PREFIX = 'builtin:';
/** The system. Started automatically when the page opens. */
export const DEFAULT_BUILTIN_ID = 'kodeos';

export const builtinKey = (id: string) => BUILTIN_PREFIX + id;
export const isBuiltinKey = (key: string | null): key is string => !!key && key.startsWith(BUILTIN_PREFIX);

export function describeBuiltin(app: BuiltinApp, locale: string): string {
  return app.description[locale] ?? app.description.en ?? '';
}

export function parseBuiltins(json: unknown): BuiltinApp[] {
  const apps = (json as { apps?: unknown })?.apps;
  if (!Array.isArray(apps)) return [];
  return apps.filter((a): a is BuiltinApp => !!a && typeof a.id === 'string' && typeof a.file === 'string' && typeof a.name === 'string' && typeof a.description === 'object');
}

export async function loadBuiltins(fetchFn: typeof fetch = fetch): Promise<BuiltinApp[]> {
  try {
    const r = await fetchFn('/apps/index.json');
    if (!r.ok) return [];
    return parseBuiltins(await r.json());
  } catch {
    return [];
  }
}

export async function fetchBuiltinBytes(app: BuiltinApp, fetchFn: typeof fetch = fetch): Promise<ArrayBuffer> {
  const r = await fetchFn(`/apps/${app.file}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${app.file}`);
  return r.arrayBuffer();
}

/**
 * Which app to start when the page opens. The system (kodeOS) is home: it starts every time it is bundled.
 * The exception is the user's own app, which keeps starting while they are working on it.
 */
export function pickStartApp(remembered: string | null, builtins: BuiltinApp[], userIds: string[]): string | null {
  const home = builtins.find((b) => b.id === DEFAULT_BUILTIN_ID);
  if (remembered) {
    if (isBuiltinKey(remembered)) {
      if (!home && builtins.some((b) => builtinKey(b.id) === remembered)) return remembered;
    } else if (userIds.includes(remembered)) return remembered;
  }
  const start = home ?? builtins[0];
  return start ? builtinKey(start.id) : null;
}
