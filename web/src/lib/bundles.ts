/**
 * Tiny IndexedDB wrapper for .dotbench bundles (no library). Metadata and bytes
 * live in separate stores so listing never loads the blobs.
 * The IDBFactory is injected so tests can pass a fake.
 */
export interface BundleMeta {
  id: string;
  name: string;
  size: number;
  addedAt: number;
}

const DB_VERSION = 1;
const META = 'meta';
const BLOB = 'blob';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class BundleStore {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(
    private factory: IDBFactory,
    private dbName = 'dotbench',
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const r = this.factory.open(this.dbName, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(BLOB)) db.createObjectStore(BLOB);
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('Cannot open IndexedDB'));
        r.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      this.dbp.catch(() => (this.dbp = null));
    }
    return this.dbp;
  }

  async add(name: string, data: ArrayBuffer, now = Date.now()): Promise<BundleMeta> {
    const db = await this.open();
    const meta: BundleMeta = { id: newId(), name, size: data.byteLength, addedAt: now };
    const tx = db.transaction([META, BLOB], 'readwrite');
    tx.objectStore(META).put(meta);
    tx.objectStore(BLOB).put(data, meta.id);
    await txDone(tx);
    return meta;
  }

  /** Newest first. */
  async list(): Promise<BundleMeta[]> {
    const db = await this.open();
    const all = await req(db.transaction(META).objectStore(META).getAll() as IDBRequest<BundleMeta[]>);
    return all.sort((a, b) => b.addedAt - a.addedAt);
  }

  async get(id: string): Promise<{ meta: BundleMeta; data: ArrayBuffer } | null> {
    const db = await this.open();
    const tx = db.transaction([META, BLOB]);
    const [meta, data] = await Promise.all([
      req(tx.objectStore(META).get(id) as IDBRequest<BundleMeta | undefined>),
      req(tx.objectStore(BLOB).get(id) as IDBRequest<ArrayBuffer | undefined>),
    ]);
    return meta && data ? { meta, data } : null;
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([META, BLOB], 'readwrite');
    tx.objectStore(META).delete(id);
    tx.objectStore(BLOB).delete(id);
    await txDone(tx);
  }

  async close(): Promise<void> {
    if (!this.dbp) return;
    (await this.dbp).close();
    this.dbp = null;
  }
}
