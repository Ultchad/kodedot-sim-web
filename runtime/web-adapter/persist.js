// dotbench persistence, host side: mirrors the firmware's persistent regions to durable storage.
// Platform-neutral (browser, Node, worker); the backends are separate files (persist-idb.js for IndexedDB,
// persist-node.js for a directory). C side: runtime/persist/persist.c, runtime/bridge/dotbench_persist.h.
//
// Model. The firmware registers named regions (fixed-size buffers in wasm memory). The host keeps a SPARSE IMAGE
// of every durable region (Map chunkIndex -> 4 KiB Uint8Array; all-zero chunks are not stored) and
//   - restoreInto(M): before main(), writes the image into the fresh memory;
//   - flush(M): harvests the chunks the firmware marked dirty (cheap, periodic) and commits the delta to the backend;
//   - finalize(M): after the threads are stopped, compares every chunk with the image (catches writers that did
//     not mark dirty bits, and the legacy regions without bits) and commits the delta.
// Regions flagged RETAIN ("keep") live in the image for restarts but are never sent to the backend, and are dropped at power-on.
//
// Format versioning: backend meta carries {format, regions:{name:{size,chunk,flags}}}. A different `format`, or a
// region whose size differs from the one the firmware registers now, is ignored (reported through onEvent), never thrown.

export const PERSIST_FORMAT = 1;
export const CHUNK = 4096;
export const FLAG_RETAIN = 1;
const LEGACY_FLAGS = { keep: FLAG_RETAIN };   // regions registered with the older kweb_persist_register() only

const cstr = (u8, p, n) => { let e = p; while (e < p + n && u8[e]) e++; return new TextDecoder().decode(u8.slice(p, e)); };

function isZero(u8, off, len) {
  // aligned 32-bit scan where possible
  if (((u8.byteOffset + off) & 3) === 0 && (len & 3) === 0) {
    const w = new Uint32Array(u8.buffer, u8.byteOffset + off, len >> 2);
    for (let i = 0; i < w.length; i++) if (w[i] !== 0) return false;
    return true;
  }
  for (let i = 0; i < len; i++) if (u8[off + i] !== 0) return false;
  return true;
}
function equalBytes(a, aoff, b, len) {
  if (((a.byteOffset + aoff) & 3) === 0 && ((b.byteOffset) & 3) === 0 && (len & 3) === 0) {
    const x = new Uint32Array(a.buffer, a.byteOffset + aoff, len >> 2), y = new Uint32Array(b.buffer, b.byteOffset, len >> 2);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  for (let i = 0; i < len; i++) if (a[aoff + i] !== b[i]) return false;
  return true;
}

/** Regions of a running module: [{name, ptr, size, flags, idx (dbp index or -1), bits (ptr of dirty bitmap or 0)}].
 *  The dbp table first, then regions only the older kweb_persist_register() knows ("keep"). */
export function readRegionTable(M) {
  const out = [], seen = new Set();
  if (typeof M._dbpx_count === "function") {
    for (let i = 0; i < M._dbpx_count(); i++) {
      const ptr = M._dbpx_ptr(i);
      out.push({ name: cstr(M.HEAPU8, M._dbpx_name(i), 16), ptr, size: M._dbpx_size(i), flags: M._dbpx_flags(i), idx: i, bits: M._dbpx_bits(i) });
      seen.add(ptr);
    }
  }
  for (let i = 0; i < M._kweb_persist_count(); i++) {
    const ptr = M._kweb_persist_ptr(i);
    if (seen.has(ptr)) continue;
    const name = cstr(M.HEAPU8, M._kweb_persist_name(i), 16);
    out.push({ name, ptr, size: M._kweb_persist_size(i), flags: LEGACY_FLAGS[name] ?? 0, idx: -1, bits: 0 });
  }
  return out;
}

/** The sparse image of a device's regions. */
export class DeviceImage {
  constructor() { this.regions = new Map(); }   // name -> {size, flags, chunks: Map<idx, Uint8Array>}
  region(name, size, flags = 0) {
    let r = this.regions.get(name);
    if (!r || r.size !== size) { r = { size, flags, chunks: new Map() }; this.regions.set(name, r); }
    r.flags = flags;
    return r;
  }
  clear() { this.regions.clear(); }
  /** name -> full-size Uint8Array (zero filled where nothing is stored). */
  toMap() {
    const m = new Map();
    for (const [name, r] of this.regions) {
      const u = new Uint8Array(r.size);
      for (const [i, c] of r.chunks) u.set(c, i * CHUNK);
      m.set(name, u);
    }
    return m;
  }
  /** Replace from full buffers; flags default per LEGACY_FLAGS. */
  static fromMap(map) {
    const img = new DeviceImage();
    for (const [name, bytes] of map) {
      const r = img.region(name, bytes.length, LEGACY_FLAGS[name] ?? 0);
      for (let o = 0; o < bytes.length; o += CHUNK) {
        const n = Math.min(CHUNK, bytes.length - o);
        if (!isZero(bytes, o, n)) r.chunks.set(o / CHUNK, bytes.slice(o, o + n));
      }
    }
    return img;
  }
  bytesStored() { let n = 0; for (const r of this.regions.values()) n += r.chunks.size * CHUNK; return n; }
}

// ------------------------------------------------------------------ device file (export/import of a whole device)
const FILE_MAGIC = "DBDEV001";
/** One file for the whole simulated device: 8-byte magic, u32 json length, JSON header, then the stored chunks. */
export function packDeviceFile(image, extra = {}) {
  const regions = [], parts = [];
  for (const [name, r] of image.regions) {
    const idxs = [...r.chunks.keys()].sort((a, b) => a - b);
    regions.push({ name, size: r.size, flags: r.flags, chunk: CHUNK, chunks: idxs });
    for (const i of idxs) parts.push(r.chunks.get(i));
  }
  const head = new TextEncoder().encode(JSON.stringify({ format: PERSIST_FORMAT, createdAt: Date.now(), regions, ...extra }));
  const total = 12 + head.length + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(FILE_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, head.length, true);
  out.set(head, 12);
  let o = 12 + head.length;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function unpackDeviceFile(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== FILE_MAGIC) throw new Error("not a dotbench device file");
  const hl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hl)));
  if (head.format !== PERSIST_FORMAT) throw new Error("device file format " + head.format + " is not supported (this build reads " + PERSIST_FORMAT + ")");
  const img = new DeviceImage();
  let o = 12 + hl;
  for (const r of head.regions) {
    const reg = img.region(r.name, r.size, r.flags ?? 0);
    for (const i of r.chunks) {
      const n = Math.min(CHUNK, r.size - i * CHUNK);
      if (o + n > bytes.length) throw new Error("device file is truncated");
      reg.chunks.set(i, bytes.slice(o, o + n)); o += n;
    }
  }
  return { image: img, header: head };
}

// ------------------------------------------------------------------ backends
/** In-memory backend: nothing durable. Same contract as the IndexedDB and Node backends. */
export class MemoryBackend {
  constructor() { this.meta = null; this.chunks = new Map(); this.commits = 0; }
  async load() {
    if (!this.meta) return null;
    const regions = {};
    for (const [name, m] of Object.entries(this.meta.regions)) regions[name] = { ...m, chunks: new Map(this.chunks.get(name) ?? []) };
    return { format: this.meta.format, regions };
  }
  async commit({ meta, puts }) {
    for (const [name, idx, bytes] of puts) {
      let c = this.chunks.get(name); if (!c) this.chunks.set(name, c = new Map());
      if (bytes) c.set(idx, bytes.slice()); else c.delete(idx);
    }
    for (const name of [...this.chunks.keys()]) if (!meta.regions[name]) this.chunks.delete(name);
    this.meta = meta; this.commits++;
  }
  async erase() { this.meta = null; this.chunks.clear(); }
}

// ------------------------------------------------------------------ manager
/**
 * @param {object} [o]
 * @param {{load(), commit(delta), erase()}|null} [o.backend]  durable storage; null = memory only
 * @param {number} [o.debounceMs=800] quiet time after the last firmware write before a flush starts
 * @param {number} [o.maxDelayMs=5000] longest a dirty region waits while writes keep coming
 * @param {(type: string, data?: any) => void} [o.onEvent]  "loaded" {bytes}, "incompatible", "region-ignored" {name}, "flushed" {chunks, bytes}, "error" {error}
 */
export class PersistManager {
  constructor(o = {}) {
    this.backend = o.backend ?? null;
    this.debounceMs = o.debounceMs ?? 800;
    this.maxDelayMs = o.maxDelayMs ?? 5000;
    this.onEvent = o.onEvent ?? (() => {});
    this.image = new DeviceImage();
    this.durable = new Map();          // region name -> {size, flags} as last committed (meta)
    this._pending = new Map();         // "name:idx" -> [name, idx, bytes|null]
    this._pendingMeta = false;
    this._M = null; this._table = null;
    this._lastGen = 0; this._dirtySince = 0; this._lastDirtyAt = 0;
    this._flushing = Promise.resolve();
    this.flushes = 0; this.lastError = null; this.loaded = false; this.incompatible = false;
  }

  /** Read the backend into the image. Call once, before the first boot. */
  async open() {
    this.incompatible = false;
    if (!this.backend) { this.loaded = true; return { bytes: 0 }; }
    let stored = null;
    try { stored = await this.backend.load(); } catch (e) { this._error(e); }
    if (stored && stored.format !== PERSIST_FORMAT) {
      this.incompatible = true;
      this.onEvent("incompatible", { found: stored.format, supported: PERSIST_FORMAT });
      stored = null;
    }
    if (stored) {
      for (const [name, r] of Object.entries(stored.regions)) {
        const reg = this.image.region(name, r.size, r.flags ?? 0);
        for (const [i, c] of r.chunks) reg.chunks.set(i, c);
        this.durable.set(name, { size: r.size, flags: r.flags ?? 0 });
      }
    }
    this.loaded = true;
    const bytes = this.image.bytesStored();
    this.onEvent("loaded", { bytes });
    return { bytes };
  }

  /** Write the image into a freshly instantiated module's regions (call before main()). */
  restoreInto(M) {
    const table = readRegionTable(M);
    for (const t of table) {
      const r = this.image.regions.get(t.name);
      if (!r) continue;
      if (r.size !== t.size) { this.onEvent("region-ignored", { name: t.name, stored: r.size, now: t.size }); this.image.regions.delete(t.name); continue; }
      for (const [i, c] of r.chunks) M.HEAPU8.set(c, t.ptr + i * CHUNK);
    }
  }

  /** Start watching a running module (dirty bitmaps, generation counter). Does not touch the image. */
  attach(M) {
    this._M = M; this._table = readRegionTable(M);
    this._lastGen = M._dbpx_gen ? M._dbpx_gen() : 0;
    for (const t of this._table) this.image.region(t.name, t.size, t.flags);   // makes the region known (sets flags); keeps content if same size
  }

  /** Power-on: RAM-like regions ("keep") start empty. */
  dropRetained() {
    for (const [name, r] of this.image.regions) if (r.flags & FLAG_RETAIN) r.chunks.clear();
  }

  /** Cheap: call from the adapter's poll. Starts a flush when the firmware wrote something and it has been quiet. */
  tick(now = Date.now()) {
    const M = this._M; if (!M || !M._dbpx_gen) return;
    const g = M._dbpx_gen();
    if (g !== this._lastGen) { this._lastGen = g; if (!this._dirtySince) this._dirtySince = now; this._lastDirtyAt = now; }
    if (this._dirtySince && (now - this._lastDirtyAt >= this.debounceMs || now - this._dirtySince >= this.maxDelayMs)) {
      this._dirtySince = 0;
      this.flush();
    }
  }

  _put(name, idx, bytes) { this._pending.set(name + ":" + idx, [name, idx, bytes]); }

  /** Harvest dirty chunks of the attached module into the image (and queue them for the backend). Sync. */
  harvest() {
    const M = this._M; if (!M) return 0;
    let n = 0;
    for (const t of this._table) {
      const r = this.image.region(t.name, t.size, t.flags);
      if (t.bits) {
        const words = (Math.ceil(t.size / CHUNK) + 31) >> 5;
        const bits = new Int32Array(M.HEAPU8.buffer, t.bits, words);
        for (let w = 0; w < words; w++) {
          if (Atomics.load(bits, w) === 0) continue;
          let v = Atomics.exchange(bits, w, 0) >>> 0;        // clear first, copy after (see persist.c)
          for (let b = 0; v; b++, v >>>= 1) if (v & 1) { n += this._takeChunk(t, r, w * 32 + b) ? 1 : 0; }
        }
      }
    }
    return n;
  }
  _takeChunk(t, r, idx) {
    const off = idx * CHUNK; if (off >= t.size) return false;
    const len = Math.min(CHUNK, t.size - off);
    const nowZero = isZero(M_u8(this._M), t.ptr + off, len);
    const had = r.chunks.get(idx);
    if (nowZero) { if (!had) return false; r.chunks.delete(idx); if (!(t.flags & FLAG_RETAIN)) this._put(t.name, idx, null); return true; }
    if (had && equalBytes(M_u8(this._M), t.ptr + off, had, len)) return false;
    const c = M_u8(this._M).slice(t.ptr + off, t.ptr + off + len);
    r.chunks.set(idx, c);
    if (!(t.flags & FLAG_RETAIN)) this._put(t.name, idx, c);
    return true;
  }

  /** Full compare of every chunk of the attached module against the image. Use after the threads are stopped. */
  scanAll() {
    const M = this._M; if (!M) return 0;
    let n = 0;
    for (const t of this._table) {
      const r = this.image.region(t.name, t.size, t.flags);
      const chunks = Math.ceil(t.size / CHUNK);
      for (let i = 0; i < chunks; i++) n += this._takeChunk(t, r, i) ? 1 : 0;
      if (t.bits) { const words = (chunks + 31) >> 5, bits = new Int32Array(M.HEAPU8.buffer, t.bits, words); for (let w = 0; w < words; w++) Atomics.store(bits, w, 0); }
    }
    return n;
  }

  _meta() {
    const regions = {};
    for (const [name, r] of this.image.regions) if (!(r.flags & FLAG_RETAIN)) regions[name] = { size: r.size, chunk: CHUNK, flags: r.flags };
    return { format: PERSIST_FORMAT, savedAt: Date.now(), regions };
  }
  _metaChanged(m) {
    const a = Object.keys(m.regions);
    if (a.length !== this.durable.size) return true;
    return a.some((k) => this.durable.get(k)?.size !== m.regions[k].size);
  }

  /** Harvest (dirty chunks only) and commit. Safe to call while the firmware runs. Resolves when the backend has it. */
  flush() { return this._queue(() => { this.harvest(); return this._commit(); }); }
  /** Stop-time flush: full compare, then commit. Call after the workers are terminated. */
  finalize() {
    // The full compare runs NOW, synchronously, against the module being stopped: by the time anything can
    // boot again the image already has its final bytes (a new boot restores from the image).
    this.scanAll(); this.detach();
    return this._queue(() => this._commit());
  }
  /** Whole-image commit, for importDevice. */
  commitAll() {
    return this._queue(() => {
      this._pending.clear();
      for (const [name, r] of this.image.regions) if (!(r.flags & FLAG_RETAIN)) for (const [i, c] of r.chunks) this._put(name, i, c);
      this._pendingMeta = true;
      return this._commit(true);
    });
  }
  _queue(fn) {
    const run = async () => { try { return await fn(); } catch (e) { this._error(e); } };
    this._flushing = this._flushing.then(run, run);
    return this._flushing;
  }
  async _commit(force = false) {
    if (!this.backend) { this._pending.clear(); return 0; }
    const meta = this._meta();
    if (!this._pending.size && !force && !this._metaChanged(meta)) return 0;
    const taken = [...this._pending.entries()];
    const puts = taken.map(([, v]) => v);
    // drop chunks of regions that vanished from the meta (size change) by letting the backend prune on meta
    await this.backend.commit({ meta, puts });
    // only what was committed: a synchronous finalize()/harvest() may have queued newer chunks meanwhile
    for (const [k, v] of taken) if (this._pending.get(k) === v) this._pending.delete(k);
    this.durable = new Map(Object.entries(meta.regions).map(([k, v]) => [k, { size: v.size, flags: v.flags }]));
    this.flushes++;
    this.onEvent("flushed", { chunks: puts.length, bytes: puts.reduce((a, p) => a + (p[2]?.length ?? 0), 0) });
    return puts.length;
  }
  _error(e) { this.lastError = e; this.onEvent("error", { error: e }); }

  // ---- raw region access (the host editing a region: the apps region's directory, the bundle store)
  /** Read `len` bytes of a region as stored (what the firmware's buffer holds). While a module is attached and has the region,
   *  the live memory is read; otherwise the host image (zeros where nothing is stored). Does not need the region to exist. */
  regionRead(name, off, len) {
    const t = this._M && this._table?.find((x) => x.name === name);
    if (t) return M_u8(this._M).slice(t.ptr + off, t.ptr + off + len);
    const r = this.image.regions.get(name), out = new Uint8Array(len);
    if (!r) return out;
    for (let c = Math.floor(off / CHUNK); c * CHUNK < off + len; c++) {
      const ch = r.chunks.get(c); if (!ch) continue;
      const from = Math.max(off, c * CHUNK), to = Math.min(off + len, c * CHUNK + ch.length);
      if (to > from) out.set(ch.subarray(from - c * CHUNK, to - c * CHUNK), from - off);
    }
    return out;
  }
  /** Write bytes into a region (host side). While a module is attached and has the region, its live memory is written (the next
   *  harvest/scan then agrees with the image: a stale copy can never overwrite the edit) and the touched chunks are taken into the
   *  image at once. Otherwise only the image changes. `size` creates a host-only region (one the firmware does not register) or
   *  sizes a region not yet known; the durable store gets the change with the next flush. */
  regionWrite(name, off, bytes, size = 0) {
    const t = this._M && this._table?.find((x) => x.name === name);
    if (t) {
      if (off + bytes.length > t.size) throw new Error("regionWrite past the end of " + name);
      M_u8(this._M).set(bytes, t.ptr + off);
      const r = this.image.region(t.name, t.size, t.flags);
      for (let c = Math.floor(off / CHUNK); c * CHUNK < off + bytes.length; c++) this._takeChunk(t, r, c);
      return;
    }
    let r = this.image.regions.get(name);
    if (!r) { if (!size) throw new Error("region " + name + " is unknown: give its size"); r = this.image.region(name, size, LEGACY_FLAGS[name] ?? 0); }
    if (off + bytes.length > r.size) throw new Error("regionWrite past the end of " + name);
    for (let c = Math.floor(off / CHUNK); c * CHUNK < off + bytes.length; c++) {
      const base = c * CHUNK, len = Math.min(CHUNK, r.size - base);
      const cur = r.chunks.get(c) ? r.chunks.get(c).slice() : new Uint8Array(len);
      const from = Math.max(off, base), to = Math.min(off + bytes.length, base + len);
      cur.set(bytes.subarray(from - off, to - off), from - base);
      if (isZero(cur, 0, len)) { if (r.chunks.delete(c) && !(r.flags & FLAG_RETAIN)) this._put(name, c, null); }
      else { r.chunks.set(c, cur); if (!(r.flags & FLAG_RETAIN)) this._put(name, c, cur); }
    }
  }
  /** Is anything stored for the region (host image)? Only meaningful while stopped. */
  regionUsed(name) { return (this.image.regions.get(name)?.chunks.size ?? 0) > 0; }

  /** Detach from the module (after finalize). */
  detach() { this._M = null; this._table = null; this._dirtySince = 0; }

  /** Erase the durable copy and forget the image: the next boot is a factory-fresh device. */
  async erase() {
    this.image.clear(); this._pending.clear(); this.durable.clear(); this._dirtySince = 0;
    await this._flushing.catch(() => {});
    if (this.backend) await this.backend.erase();
  }

  // ---- whole-device helpers
  exportMap() { return this.image.toMap(); }
  importMap(map) { this.image = DeviceImage.fromMap(map); this._pending.clear(); }
  exportDeviceFile(extra) { return packDeviceFile(this.image, extra); }
  importDeviceFile(bytes) { const { image } = unpackDeviceFile(bytes); this.image = image; this._pending.clear(); }
}
function M_u8(M) { return M.HEAPU8; }
