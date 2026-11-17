/** A few keyed values in IndexedDB (compiled sketches, imported parts): too big for localStorage. Every call is safe without IndexedDB. */
const DB = 'dotbench.bench';
const STORES = ['code', 'userparts'] as const;
export type KvStore = (typeof STORES)[number];

let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}
function run<T>(store: KvStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = fn(db.transaction(store, mode).objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}
export const kvGet = <T>(store: KvStore, key: string): Promise<T | undefined> => run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const kvSet = (store: KvStore, key: string, value: unknown): Promise<unknown> => run(store, 'readwrite', (s) => s.put(value, key));
export const kvDel = (store: KvStore, key: string): Promise<unknown> => run(store, 'readwrite', (s) => s.delete(key));
export async function kvAll<T>(store: KvStore): Promise<[string, T][]> {
  const keys = (await run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())) ?? [];
  const vals = (await run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? [];
  return keys.map((k, i) => [String(k), vals[i]]);
}

export const toB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b: string): Uint8Array => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
