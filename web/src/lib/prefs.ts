/** localStorage helpers that never throw (private mode, quota, disabled storage). */
export function loadPref<T>(key: string, fallback: T, storage: Pick<Storage, 'getItem'> | null = safeLocal()): T {
  try {
    const raw = storage?.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown, storage: Pick<Storage, 'setItem'> | null = safeLocal()): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function safeLocal(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
