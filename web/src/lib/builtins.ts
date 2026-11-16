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
/** Started automatically on the first visit. */
export const DEFAULT_BUILTIN_ID = 'display_lvgl';

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

/** Which app to start when the page opens: the remembered one if it still exists, else the default demo. */
export function pickStartApp(remembered: string | null, builtins: BuiltinApp[], userIds: string[]): string | null {
  if (remembered) {
    if (isBuiltinKey(remembered) ? builtins.some((b) => builtinKey(b.id) === remembered) : userIds.includes(remembered)) return remembered;
  }
  const def = builtins.find((b) => b.id === DEFAULT_BUILTIN_ID) ?? builtins[0];
  return def ? builtinKey(def.id) : null;
}
