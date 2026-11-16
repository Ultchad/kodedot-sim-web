// The registry of program bundles (the .dotbench packages of installed apps), kept in the adapter's persistence so a page reload keeps them.
// It is a HOST-ONLY persistent region ("dbsys": the firmware does not register it, the PersistManager mirrors it like any other region, in the
// same IndexedDB transaction as the apps region, so a directory entry and its bundle never disagree on disk).
//
// Layout (sparse, 64 MiB virtual; only the chunks in use are stored):
//   0x0000  u32 length n, then n bytes of JSON index {v:1, seeded:bool, bundles:{id:{off,len,project,name,version}}}   (16 KiB reserved)
//   0x4000  bundle data, 4 KiB aligned, first fit
export const BUNDLES_REGION = "dbsys";
export const BUNDLES_SIZE = 64 * 1024 * 1024;
const INDEX_BYTES = 0x4000, ALIGN = 4096;
const up = (n) => Math.ceil(n / ALIGN) * ALIGN;

export class BundleStore {
  /** @param {import("./persist.js").PersistManager} pm */
  constructor(pm) { this.pm = pm; }

  _read() {
    const head = this.pm.regionRead(BUNDLES_REGION, 0, 4);
    const n = new DataView(head.buffer, head.byteOffset).getUint32(0, true);
    if (!n || n > INDEX_BYTES - 4) return { v: 1, seeded: false, bundles: {} };
    try { return JSON.parse(new TextDecoder().decode(this.pm.regionRead(BUNDLES_REGION, 4, n))); } catch { return { v: 1, seeded: false, bundles: {} }; }
  }
  _write(idx) {
    const j = new TextEncoder().encode(JSON.stringify(idx));
    if (j.length > INDEX_BYTES - 4) throw new Error("bundle index is full");
    const b = new Uint8Array(4 + j.length);
    new DataView(b.buffer).setUint32(0, j.length, true); b.set(j, 4);
    this.pm.regionWrite(BUNDLES_REGION, 0, new Uint8Array(INDEX_BYTES), BUNDLES_SIZE);   // clear, so a shorter index leaves no tail
    this.pm.regionWrite(BUNDLES_REGION, 0, b, BUNDLES_SIZE);
  }

  get seeded() { return !!this._read().seeded; }
  markSeeded(v = true) { const i = this._read(); i.seeded = v; this._write(i); }
  ids() { return Object.keys(this._read().bundles); }
  info(id) { const b = this._read().bundles[id]; return b ? { id, ...b } : null; }
  has(id) { return !!this._read().bundles[id]; }
  get(id) { const b = this._read().bundles[id]; return b ? this.pm.regionRead(BUNDLES_REGION, b.off, b.len) : null; }

  /** Store (or replace) a bundle under `id` with a few fields of metadata. */
  put(id, bytes, meta = {}) {
    const idx = this._read();
    if (idx.bundles[id]) delete idx.bundles[id];
    const used = Object.values(idx.bundles).map((b) => [b.off, b.off + up(b.len)]).sort((a, b) => a[0] - b[0]);
    let off = INDEX_BYTES;
    for (const [s, e] of used) { if (s - off >= up(bytes.length)) break; off = Math.max(off, e); }
    if (off + bytes.length > BUNDLES_SIZE) throw new Error("the bundle store is full");
    this.pm.regionWrite(BUNDLES_REGION, off, bytes, BUNDLES_SIZE);
    idx.bundles[id] = { off, len: bytes.length, ...meta };
    this._write(idx);
  }
  delete(id) {
    const idx = this._read(), b = idx.bundles[id];
    if (!b) return false;
    delete idx.bundles[id];
    this.pm.regionWrite(BUNDLES_REGION, b.off, new Uint8Array(up(b.len)), BUNDLES_SIZE);   // zero chunks are dropped from the durable store
    this._write(idx);
    return true;
  }
}
