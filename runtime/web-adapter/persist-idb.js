// IndexedDB backend for persist.js (browser). Database "dotbench" (version 1):
//   store "meta"   key "device"   -> {format, savedAt, regions:{name:{size,chunk,flags}}}
//   store "chunks" key [region, index] -> Uint8Array (4 KiB; all-zero chunks are not stored)
// One readwrite transaction per flush: meta and chunk puts commit together or not at all (a tab killed mid-flush
// leaves the previous state). The format number is PERSIST_FORMAT (persist.js); a different one is ignored, not
// migrated, and reported as the "incompatible" persist event.
// Quota: browsers give an origin tens of MB to GBs; this stores only non-zero chunks (a fresh device: ~100 KB,
// a full 2 MiB volume + 32 MiB card: up to 34 MiB). A QuotaExceededError rejects the commit; PersistManager
// reports it ("error" event, dev.persist.lastError) and keeps the data in memory, so the next flush retries.
import { CHUNK } from "./persist.js";

export class IdbBackend {
  /** @param {{name?: string, idb?: IDBFactory}} o */
  constructor(o = {}) { this.name = o.name ?? "dotbench"; this.idb = o.idb ?? globalThis.indexedDB; this._db = null; this.commits = 0; }

  _open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore("meta"); db.createObjectStore("chunks"); };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); this._db = null; };
        this._db = db; resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
  }
  static _wait(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  }
  static _req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }

  async load() {
    const db = await this._open();
    const tx = db.transaction(["meta", "chunks"], "readonly");
    const meta = await IdbBackend._req(tx.objectStore("meta").get("device"));
    if (!meta) return null;
    const regions = {};
    for (const [name, m] of Object.entries(meta.regions ?? {})) regions[name] = { ...m, chunks: new Map() };
    // cursor walk (a getAll of 34 MiB would double the memory)
    await new Promise((resolve, reject) => {
      const cur = tx.objectStore("chunks").openCursor();
      cur.onsuccess = () => {
        const c = cur.result; if (!c) return resolve();
        const [name, idx] = c.key;
        const r = regions[name];
        if (r && idx * CHUNK < r.size) r.chunks.set(idx, c.value instanceof Uint8Array ? c.value : new Uint8Array(c.value));
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    return { format: meta.format, regions };
  }

  async commit({ meta, puts }) {
    const db = await this._open();
    const tx = db.transaction(["meta", "chunks"], "readwrite");
    const done = IdbBackend._wait(tx);
    const st = tx.objectStore("chunks");
    for (const [name, idx, bytes] of puts) {
      if (!meta.regions[name]) continue;
      if (bytes) st.put(bytes, [name, idx]); else st.delete([name, idx]);
    }
    tx.objectStore("meta").put(meta, "device");
    await done;
    this.commits++;
  }

  async erase() {
    const db = await this._open();
    const tx = db.transaction(["meta", "chunks"], "readwrite");
    const done = IdbBackend._wait(tx);
    tx.objectStore("meta").clear(); tx.objectStore("chunks").clear();
    await done;
  }

  close() { this._db?.close(); this._db = null; }
}
