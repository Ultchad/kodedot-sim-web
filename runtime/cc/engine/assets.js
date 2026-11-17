// SPDX-License-Identifier: GPL-3.0-or-later
// Getting the toolchain into the Worker: manifest -> files (network, or the persistent Cache API, or a directory under Node) -> the three things the
// patched yowasp runtime asks for: compiled wasm modules, a file tree, and later per-board packs. Everything is lazy and counted in bytes.
//   * every file is named by content hash, so a cached copy is never stale; files the new manifest does not list are deleted from the cache
//   * the 75 MB LLVM module arrives as chunks (manifest.wasm.chunks); they are streamed, in order, into WebAssembly.compileStreaming
//   * a network copy is checked against the manifest's sha-256 before it is trusted (a corrupt or truncated download fails loudly, not in clang)
import { unpack, toTree } from "./pack.js";

const isNode = typeof process !== "undefined" && !!process.versions?.node && typeof WorkerGlobalScope === "undefined";
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export class Assets {
  /** @param {{base: string, cacheName?: string, onProgress?: (e: object) => void}} o  base: URL of the asset folder (browser) or a directory path ending in / (Node) */
  constructor({ base, cacheName = "dotbench-cc", onProgress = () => {} }) {
    this.base = base; this.cacheName = cacheName; this.emit = onProgress; this.manifest = null; this.cache = null;
    this.fsTree = { usr: {}, dotcore: { common: {} } }; this.boards = new Map(); this.modules = null; this.loaded = { fromCache: 0, fromNetwork: 0 };
    this.prog = { loaded: 0, total: 0 };
  }

  /** @param {object} [given] the manifest the main thread already fetched (saves a request) */
  async open(given) {
    if (given) { this.manifest = given; this.manifestFromCache = true; if (!isNode && typeof caches !== "undefined") this.cache = await caches.open(this.cacheName); return given; }
    if (!isNode && typeof caches !== "undefined") this.cache = await caches.open(this.cacheName);
    const t = performance.now(); let text, fromCache = false;
    if (isNode) text = await (await import("node:fs/promises")).readFile(this.base + "manifest.json", "utf8");
    else {
      const url = new URL("manifest.json", this.base).href;
      try { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); text = await r.text(); await this.cache?.put(url, new Response(text, { headers: { "content-type": "application/json" } })); }
      catch (e) { const hit = await this.cache?.match(url); if (!hit) throw new Error(`cannot load ${url}: ${e.message}`); text = await hit.text(); fromCache = true; }
    }
    this.manifest = JSON.parse(text); this.manifestMs = Math.round(performance.now() - t); this.manifestFromCache = fromCache;
    return this.manifest;
  }

  /** which of the files are in the cache right now (for "download 17 MB" versus "ready") */
  async cachedNames(names) {
    if (isNode) return new Set(names);
    const out = new Set();
    if (this.cache) for (const n of names) if (await this.cache.match(new URL(n, this.base).href)) out.add(n);
    return out;
  }

  fileInfo(name) { const f = this.manifest.files[name]; if (!f) throw new Error(`manifest has no file ${name}`); return f; }

  /** a Response for one file: from the cache, or the network (with progress, sha check and a cache write behind it) */
  async response(name, { verify = true } = {}) {
    const info = { ...this.fileInfo(name), name }, url = isNode ? null : new URL(name, this.base).href;
    if (isNode) {
      const bytes = await (await import("node:fs/promises")).readFile(this.base + name);
      this.#count(name, bytes.length, info, true);
      const out = info.encoding === "gzip" ? (await import("node:zlib")).gunzipSync(bytes) : bytes;
      return new Response(out, { headers: { "content-type": name.includes(".wasm") ? "application/wasm" : "application/octet-stream" } });
    }
    const hit = await this.cache?.match(url);
    if (hit) { this.loaded.fromCache += info.size; this.#count(name, info.size, info, true); return this.#decode(hit, info); }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    let body = r.body;
    if (this.cache) { const [a, b] = body.tee(); body = a; this.cache.put(url, new Response(b, { headers: { "content-type": r.headers.get("content-type") ?? "application/octet-stream" } })).catch(() => {}); }
    let seen = 0; const pieces = [], self = this;
    const counted = body.pipeThrough(new TransformStream({
      transform(chunk, ctl) { seen += chunk.length; if (verify) pieces.push(chunk); self.#bump(name, seen, info); ctl.enqueue(chunk); },
      async flush(ctl) {
        if (!verify) return;
        const all = new Uint8Array(seen); let o = 0; for (const p of pieces) { all.set(p, o); o += p.length; } pieces.length = 0;
        if (seen !== info.size) { await self.cache?.delete(url); ctl.error(new Error(`${name}: got ${seen} bytes, expected ${info.size}`)); return; }
        if (hex(await crypto.subtle.digest("SHA-256", all)) !== info.sha256) { await self.cache?.delete(url); ctl.error(new Error(`${name}: checksum mismatch`)); }
      },
    }));
    this.loaded.fromNetwork += info.size;
    return this.#decode(new Response(counted, { headers: { "content-type": r.headers.get("content-type") ?? "application/octet-stream" } }), info);
  }
  /** files the build stored gzipped (the cache keeps the stored bytes, so the check and the progress count what travelled) */
  #decode(res, info) {
    if (info.encoding !== "gzip") return res;
    return new Response(res.body.pipeThrough(new DecompressionStream("gzip")), { headers: { "content-type": info.name?.includes(".wasm") ? "application/wasm" : "application/octet-stream" } });
  }

  #seen = new Map();
  #count(name, n, info, cached) { this.#bump(name, n, info, cached); }
  #bump(name, n, info, cached = false) {
    const prev = this.#seen.get(name) ?? 0; this.#seen.set(name, n);
    this.prog.loaded += n - prev;
    this.emit({ phase: "download", file: name, loaded: n, total: info.size, overallLoaded: this.prog.loaded, overallTotal: this.prog.total, cached });
  }
  /** announce a set of files about to be loaded, so overall progress has a total */
  expect(names) { for (const n of names) if (!this.#seen.has(n)) this.prog.total += this.fileInfo(n).size; }

  async bytes(name) { return new Uint8Array(await (await this.response(name)).arrayBuffer()); }

  /** the LLVM wasm modules (the big one in chunks, streamed into the compiler) */
  async loadToolchain() {
    if (this.modules) return;
    const m = this.manifest, mods = {};
    const chunkNames = m.wasm.core.chunks, small = m.wasm.others;
    this.expect([...chunkNames, ...small.map((s) => s.file), m.sysroot.inc, m.sysroot.lib, m.sysroot.core]);
    const t0 = performance.now();
    const compileCore = async () => {
      const resps = chunkNames.map((n) => this.response(n));      // all requests start now; the stream consumes them in order
      const { readable, writable } = new TransformStream();
      const pump = (async () => {
        const w = writable.getWriter();
        try { for (const rp of resps) { const rd = (await rp).body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; await w.write(value); } } await w.close(); }
        catch (e) { await w.abort(e); throw e; }
      })();
      pump.catch(() => {});
      const resp = new Response(readable, { headers: { "content-type": "application/wasm" } });
      const mod = typeof WebAssembly.compileStreaming === "function" ? await WebAssembly.compileStreaming(resp) : await WebAssembly.compile(await resp.arrayBuffer());
      await pump;
      return mod;
    };
    const [core, ...rest] = await Promise.all([compileCore(), ...small.map(async (s) => [s.module, await WebAssembly.compile(await this.bytes(s.file))])]);
    mods[m.wasm.core.module] = core; for (const [k, v] of rest) mods[k] = v;
    this.modules = mods; this.moduleMs = Math.round(performance.now() - t0);
    // sysroot headers and libraries, and the board-independent core headers
    for (const n of [m.sysroot.inc, m.sysroot.lib]) toTree(unpack(await this.bytes(n)), this.fsTree);
    toTree(unpack(await this.bytes(m.sysroot.core)), this.fsTree);
    globalThis.__CC_ASSETS__ = { modules: async () => this.modules, filesystem: async () => this.fsTree };
  }

  /** a board: its pack (variant header, libdotcore.a, light PCH, the part manifest and picture); the STL PCH is a second file, fetched on demand */
  async loadBoard(id, { stl = false } = {}) {
    const bd = this.manifest.boards[id]; if (!bd) throw new Error(`unknown board "${id}" (known: ${Object.keys(this.manifest.boards).join(", ")})`);
    let b = this.boards.get(id);
    if (!b) {
      this.expect([bd.pack]);
      const map = unpack(await this.bytes(bd.pack)), meta = new Map(), vfs = new Map();
      for (const [p, d] of map) (p.startsWith("meta/") ? meta : vfs).set(p, d);
      toTree(vfs, this.fsTree);
      b = { id, defines: bd.defines, manifest: JSON.parse(new TextDecoder().decode(meta.get("meta/manifest.json"))), assets: new Map([...meta].map(([p, d]) => [p.slice(5), d])), stl: false };
      this.boards.set(id, b);
    }
    if (stl && !b.stl) { this.expect([bd.pchStl]); toTree(unpack(await this.bytes(bd.pchStl)), this.fsTree); b.stl = true; }
    return b;
  }

  /** delete cached files the current manifest no longer lists (old toolchain versions) */
  async prune() {
    if (!this.cache) return 0;
    const keep = new Set(Object.keys(this.manifest.files).map((n) => new URL(n, this.base).href)); keep.add(new URL("manifest.json", this.base).href);
    let n = 0; for (const k of await this.cache.keys()) if (!keep.has(k.url)) { await this.cache.delete(k); n++; }
    return n;
  }
}
