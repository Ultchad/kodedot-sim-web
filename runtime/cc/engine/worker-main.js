// SPDX-License-Identifier: GPL-3.0-or-later
// The compiler Worker's message loop. The asset build bundles this file, the patched yowasp runtime and the shared modules into ONE script
// (cc-worker.<hash>.js): a blob: Worker cannot resolve relative imports, and every import would be one more request that offline would lack.
// Browser: a blob: module Worker (the site CSP says worker-src blob:). Node: worker_threads. It needs no cross-origin isolation.
// Messages in:  {type:"init", base, cacheName}  {type:"prepare", id, board, stl}  {type:"compile", id, board, files, options}
// Messages out: {type:"progress", ...}  {type:"ready", info}  {type:"prepared", id}  {type:"result", id, ...}  {type:"error", id, message}
import { Assets } from "./assets.js";
import { compileSketch, chooseTier } from "./compile.js";

export async function startWorker(rt) {
  const wt = typeof process !== "undefined" && process.versions?.node && typeof WorkerGlobalScope === "undefined" ? await import("node:worker_threads") : null;
  const post = (m, tr) => (wt ? wt.parentPort.postMessage(m, tr) : self.postMessage(m, tr));
  const onMessage = (cb) => (wt ? wt.parentPort.on("message", cb) : (self.onmessage = (e) => cb(e.data)));
  let assets = null, warm = false, queue = Promise.resolve();

  const ensure = async ({ board, stl }) => {
    const t0 = performance.now();
    await assets.loadToolchain();
    let b = null;
    if (board) b = await assets.loadBoard(board, { stl });
    if (!warm) {      // the first run pays module instantiation and resource unpacking; do it now, inside "ready", not inside the first compile
      const t1 = performance.now();
      await rt.runLLVM(["clang", "--version"], {}, { stdout: () => {}, stderr: () => {}, fetchProgress: () => {} });
      warm = true; assets.warmMs = Math.round(performance.now() - t1);
    }
    return { board: b, ms: Math.round(performance.now() - t0) };
  };

  onMessage((m) => {
    // one job at a time: a message handler never overlaps another (wasm compile is synchronous inside the module anyway)
    queue = queue.then(async () => {
      try {
        if (m.type === "init") {
          assets = new Assets({ base: m.base, cacheName: m.cacheName, onProgress: (e) => post({ type: "progress", ...e }) });
          const manifest = await assets.open(m.manifest);
          post({ type: "manifest", manifest, fromCache: assets.manifestFromCache });
        } else if (m.type === "cached") {
          const names = m.names ?? Object.keys(assets.manifest.files);
          post({ type: "cached", id: m.id, names: [...await assets.cachedNames(names)] });
        } else if (m.type === "prepare") {
          const r = await ensure(m);
          post({ type: "prepared", id: m.id, ms: r.ms, stats: { fromCache: assets.loaded.fromCache, fromNetwork: assets.loaded.fromNetwork, moduleMs: assets.moduleMs, warmMs: assets.warmMs } });
        } else if (m.type === "compile") {
          const t0 = performance.now();
          const o = { ...(m.options ?? {}) }, hasStl = !!assets.manifest.boards[m.board]?.pchStl;
          let tier = o.pch === "none" ? "none" : o.pch === "light" || o.pch === "stl" ? o.pch : chooseTier(Object.values(m.files ?? {}).filter((v) => typeof v === "string"));
          if (tier === "stl" && !hasStl) tier = "light";      // an asset build made with --no-stl: slower, still correct
          o.pch = tier; m.options = o; const wantStl = tier === "stl";
          const { board, ms } = await ensure({ board: m.board, stl: wantStl });
          const loadMs = Math.round(performance.now() - t0);
          let r;
          try { r = await compileSketch(rt, board, { files: m.files, options: m.options }, { step: (s) => post({ type: "progress", phase: "step", step: s, id: m.id }) }); }
          catch (e) {
            const msg = String(e?.message ?? e);
            r = { ok: false, board: m.board, timings: {}, log: "", diagnostics: [{ file: "", line: 0, column: 0, severity: "error", source: "compiler", message: /out of memory|Out of memory|allocation/i.test(msg) ? "The compiler ran out of memory in this tab. Close other tabs or simplify the sketch." : "Compiler failure: " + msg }] };
            if (/bad file name|needs a \.ino|must be text/.test(msg)) r.diagnostics[0].message = msg;
          }
          r.timings.loadMs = loadMs;
          post({ type: "result", id: m.id, ...r }, r.wasm ? [r.wasm.buffer] : []);
        } else if (m.type === "prune") {
          post({ type: "pruned", id: m.id, removed: await assets.prune() });
        }
      } catch (e) { post({ type: "error", id: m.id, message: String(e?.stack || e) }); }
    });
  });
}
