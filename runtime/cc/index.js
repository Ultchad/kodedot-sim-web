// SPDX-License-Identifier: GPL-3.0-or-later
// The in-browser Arduino compile service. Framework free, no server: clang and wasm-ld run as WebAssembly in a Web Worker.
//
//   const cc = createCompiler({ assetsBaseUrl: "/cc/", onProgress: (e) => ... });
//   const info = await cc.info();                      // boards, sizes, what is cached: cheap (one small file), downloads no toolchain
//   const r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){} void loop(){}" } });
//   r = { ok, wasm, partDef, diagnostics, timings, log, board, cancelled? }     see docs/STATUS-cc.md
//
// Lazy: nothing but the manifest is fetched until ready() or the first compile. Work is queued one at a time. Files are cached persistently
// (Cache API; no service worker, the site CSP forbids one) so the next visit, even offline, needs no network.

/** @typedef {{phase:"download", file:string, loaded:number, total:number, overallLoaded:number, overallTotal:number, cached:boolean}|{phase:"step", step:string}|{phase:"worker", state:string}} CcProgress */

const isNode = typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined" && typeof WorkerGlobalScope === "undefined";

export function createCompiler({ assetsBaseUrl, onProgress = () => {}, cacheName = "dotbench-cc", maxCached = 8 } = {}) {
  if (!assetsBaseUrl) throw new Error("createCompiler needs assetsBaseUrl (the folder the asset build produced, e.g. \"/cc/\")");
  const base = isNode ? (assetsBaseUrl.endsWith("/") ? assetsBaseUrl : assetsBaseUrl + "/") : new URL(assetsBaseUrl.endsWith("/") ? assetsBaseUrl : assetsBaseUrl + "/", globalThis.location?.href).href;
  let manifest = null, manifestFromCache = false, worker = null, workerReady = null, nextId = 1, disposed = false;
  const jobs = [], results = new Map();   // jobs: queued {id, run, cancel}; results: small LRU of finished compiles
  let running = null;

  // ---------------------------------------------------------------- manifest (the only file fetched by info())
  async function loadManifest() {
    if (manifest) return manifest;
    if (isNode) { manifest = JSON.parse(await (await import("node:fs/promises")).readFile(base + "manifest.json", "utf8")); return manifest; }
    const url = new URL("manifest.json", base).href, cache = typeof caches !== "undefined" ? await caches.open(cacheName) : null;
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text(); manifest = JSON.parse(text); await cache?.put(url, new Response(text, { headers: { "content-type": "application/json" } }));
    } catch (e) {
      const hit = await cache?.match(url);
      if (!hit) throw new Error(`the compiler's files cannot be loaded (${url}: ${e.message}) and nothing is cached yet`);
      manifest = JSON.parse(await hit.text()); manifestFromCache = true;
    }
    return manifest;
  }

  // ---------------------------------------------------------------- the Worker
  async function makeWorker() {
    const m = await loadManifest(), file = m.worker;
    if (isNode) {
      const wt = await import("node:worker_threads"), w = new wt.Worker(base + file);
      return { post: (msg, tr) => w.postMessage(msg, tr), on: (cb) => { w.on("message", cb); w.on("error", (e) => cb({ type: "fatal", message: String(e?.stack || e) })); w.on("exit", (c) => cb({ type: "fatal", message: "worker exited (" + c + ")" })); }, kill: () => w.terminate() };
    }
    // the worker script comes through the cache like every other file, then runs from a blob: URL (CSP: worker-src blob:)
    const url = new URL(file, base).href, cache = typeof caches !== "undefined" ? await caches.open(cacheName) : null;
    let res = await cache?.match(url);
    if (!res) { res = await fetch(url); if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`); await cache?.put(url, res.clone()); }
    const blob = new Blob([await res.arrayBuffer()], { type: "text/javascript" }), blobUrl = URL.createObjectURL(blob), w = new Worker(blobUrl, { type: "module", name: "dotbench-cc" });
    return { post: (msg, tr) => w.postMessage(msg, tr), on: (cb) => { w.onmessage = (e) => cb(e.data); w.onerror = (e) => cb({ type: "fatal", message: e.message || "worker error" }); }, kill: () => { w.terminate(); URL.revokeObjectURL(blobUrl); } };
  }

  const waiters = new Map();   // job id -> {resolve, reject}
  async function ensureWorker() {
    if (worker) return workerReady;
    const m = await loadManifest();
    onProgress({ phase: "worker", state: "starting" });
    const w = await makeWorker(); worker = w;
    w.on((msg) => {
      if (w.dead) return;       // a worker we killed (cancel): its last words (exit event) must not touch the next worker's requests
      if (msg.type === "progress") { onProgress(msg); return; }
      if (msg.type === "fatal") { for (const [id, p] of waiters) { waiters.delete(id); p.reject(new Error(msg.message)); } if (worker === w) { worker = null; workerReady = null; } return; }
      if (msg.type === "manifest") { waiters.get("init")?.resolve(msg); waiters.delete("init"); return; }
      const p = waiters.get(msg.id); if (!p) return;
      waiters.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message)); else p.resolve(msg);
    });
    workerReady = new Promise((resolve, reject) => { waiters.set("init", { resolve, reject }); w.post({ type: "init", base, cacheName, manifest: m }); });
    workerReady.catch(() => {});
    await workerReady;
    return workerReady;
  }
  const ask = (msg, transfer) => new Promise((resolve, reject) => { const id = nextId++; waiters.set(id, { resolve, reject }); worker.post({ ...msg, id }, transfer); });

  // ---------------------------------------------------------------- queue
  function pump() {
    if (running || !jobs.length || disposed) return;
    const j = jobs.shift(); running = j;
    j.run().catch(() => {}).finally(() => { running = null; pump(); });
  }
  function enqueue(run, onCancel) {
    let cancel;
    const p = new Promise((resolve, reject) => {
      const job = { run: () => run().then(resolve, reject), cancel: () => onCancel(resolve) };
      cancel = () => {
        const i = jobs.indexOf(job);
        if (i >= 0) { jobs.splice(i, 1); onCancel(resolve); return; }       // still queued: just drop it
        if (running === job) { killWorker(); job.cancel(); }                  // running: the wasm run cannot be interrupted, so the Worker goes (a new one starts on demand)
      };
      jobs.push(job); pump();
    });
    p.cancel = cancel; return p;
  }
  function killWorker() { const w = worker; if (w) w.dead = true; worker = null; workerReady = null; for (const [id, p] of waiters) { waiters.delete(id); p.reject(new Error("cancelled")); } w?.kill(); }

  const cancelledResult = (board) => ({ ok: false, cancelled: true, diagnostics: [], timings: {}, log: "", board });
  const key = (req) => JSON.stringify([manifest?.version, req.board, req.files, req.options ?? {}]);

  const api = {
    /** boards (name, pins, capabilities, default sketch, limits), version, sizes and what is already cached. Fetches only the manifest. */
    async info() {
      const m = await loadManifest();
      const boards = {};
      for (const [id, b] of Object.entries(m.boards)) boards[id] = { id, name: b.name, core: b.core, partId: b.partId, defaultSketch: b.defaultSketch, pins: b.pins, capabilities: b.capabilities, supported: b.supported, unsupported: b.unsupported, limits: b.limits, bytes: { board: m.files[b.pack].size, stlPch: m.files[b.pchStl].size } };
      const toolchain = [...m.wasm.core.chunks, ...m.wasm.others.map((o) => o.file), m.sysroot.inc, m.sysroot.lib, m.sysroot.core, m.worker];
      const names = [...toolchain, ...Object.values(m.boards).flatMap((b) => [b.pack, b.pchStl])];
      let cached = new Set();
      if (!isNode && typeof caches !== "undefined") { const c = await caches.open(cacheName); for (const n of names) if (await c.match(new URL(n, base).href)) cached.add(n); } else cached = new Set(names);
      const size = (list) => list.reduce((n, f) => n + m.files[f].size, 0), missing = (list) => size(list.filter((f) => !cached.has(f)));
      return { version: m.version, toolchain: m.toolchain, manifestFromCache, boards, notice: m.notice,
        download: { toolchainBytes: size(toolchain), toolchainMissingBytes: missing(toolchain), perBoard: Object.fromEntries(Object.entries(m.boards).map(([id, b]) => [id, { bytes: size([b.pack]), missingBytes: missing([b.pack]), stlBytes: size([b.pchStl]), stlMissingBytes: missing([b.pchStl]) }])) },
        ready: toolchain.every((f) => cached.has(f)) };
    },
    /** Download (or read from the cache) and start the toolchain, and optionally one board. Resolves when a compile can start at once. */
    ready({ board = null, stl = false } = {}) {
      if (disposed) return Promise.reject(new Error("disposed"));
      if (!isNode) globalThis.navigator?.storage?.persist?.().catch?.(() => {});
      return enqueue(async () => { await ensureWorker(); const r = await ask({ type: "prepare", board, stl }); await ask({ type: "prune" }).catch(() => {}); return { ms: r.ms, ...r.stats }; }, (resolve) => resolve({ cancelled: true }));
    },
    /**
     * @param {{board: string, files: Record<string,string>, options?: {pch?: "auto"|"light"|"stl"|"none", opt?: string, memoryKb?: number, stackKb?: number, main?: string, manifest?: object}}} req
     * @returns {Promise<{ok: boolean, wasm?: Uint8Array, partDef?: object, diagnostics: object[], timings: object, log: string, board: string, cancelled?: boolean}> & {cancel: () => void}}
     */
    compile(req) {
      if (disposed) return Promise.reject(new Error("disposed"));
      const queuedAt = performance.now();
      const k = manifest ? key(req) : null;
      if (k && results.has(k)) { const r = results.get(k); results.delete(k); results.set(k, r); return Object.assign(Promise.resolve({ ...r, timings: { ...r.timings, cached: true, totalMs: 0 } }), { cancel() {} }); }
      return enqueue(async () => {
        await ensureWorker();
        const startedAt = performance.now();
        const msg = await ask({ type: "compile", board: req.board, files: req.files, options: req.options });
        const { type, id, ...r } = msg; r.timings = { ...r.timings, queueMs: Math.round(startedAt - queuedAt), wallMs: Math.round(performance.now() - startedAt) };
        if (r.ok) { results.set(key(req), r); while (results.size > maxCached) results.delete(results.keys().next().value); }
        return r;
      }, (resolve) => resolve(cancelledResult(req.board)));
    },
    /** Cancel everything queued and the running compile (the Worker is replaced; downloaded files stay cached). */
    cancel() { for (const j of jobs.splice(0)) j.cancel(); if (running) { const j = running; killWorker(); j.cancel(); } },
    /** Delete every cached file (the next use downloads again). */
    async clearCache() { if (typeof caches !== "undefined" && !isNode) await caches.delete(cacheName); results.clear(); },
    dispose() { disposed = true; api.cancel(); killWorker(); },
  };
  return api;
}
