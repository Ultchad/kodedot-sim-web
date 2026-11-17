// SPDX-License-Identifier: GPL-3.0-or-later
// The compiler Worker. Browser: created from a blob: URL (the site's CSP says worker-src blob:), imports its siblings by absolute URL.
// Node: worker_threads. Protocol: {type:"init", base, runtime} -> {type:"ready", stats, ms}; {type:"compile", id, ino, manifest, ...} -> {type:"result", id, ...}
const wt = typeof process !== "undefined" && process.versions?.node && typeof WorkerGlobalScope === "undefined" ? await import("node:worker_threads") : null;
const post = (m, tr) => (wt ? wt.parentPort.postMessage(m, tr) : self.postMessage(m, tr));
const onMessage = (cb) => (wt ? wt.parentPort.on("message", cb) : (self.onmessage = (e) => cb(e.data)));
let compiler = null, base = null;
const sib = (n) => (wt ? new URL(n, base).href : new URL(n, base).href);

onMessage(async (m) => {
  try {
    if (m.type === "init") {
      base = m.base; const t0 = performance.now();
      const { installAssets } = await import(sib("assets.js"));
      const stats = await installAssets({ base: m.assetBase ?? base });         // sets globalThis.__CC_ASSETS__
      const t1 = performance.now();
      const rt = await import(sib("clang-runtime.js"));
      const { SketchCompiler } = await import(sib("compiler.js"));
      compiler = new SketchCompiler(rt);
      // warm-up: the first run pays module instantiation and resource unpacking; a no-op run forces the lazy resource load now
      const t2 = performance.now();
      await rt.runLLVM(["clang", "--version"], {}, { stdout: () => {}, stderr: () => {}, fetchProgress: () => {} });
      const t3 = performance.now();
      post({ type: "ready", stats, ms: { assets: t1 - t0, import: t2 - t1, firstRun: t3 - t2, total: t3 - t0 } });
    } else if (m.type === "compile") {
      const r = await compiler.compile(m);
      post({ type: "result", id: m.id, ...r }, r.wasm ? [r.wasm.buffer] : []);
    }
  } catch (e) { post({ type: "error", id: m.id, message: String(e?.stack || e) }); }
});
