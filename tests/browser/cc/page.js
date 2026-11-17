// The page side of the cc browser test: exactly the wiring docs/STATUS-cc.md ("Page wiring") tells a front end to do.
import { createCompiler } from "/cc-client.js";
import { DotbenchDevice } from "/adapter/dotbench-device.js";
import { Bench } from "/adapter/bench.js";
import { configureWorker } from "/adapter/bench-wasm.js";
configureWorker({ source: await (await fetch("/adapter/part-worker.js")).text() });   // parts run in blob Workers under the CSP

const progress = [];
let dev = null, bench = null;
window.P = {
  progress,
  cc: null,
  newCompiler() { this.cc?.dispose(); progress.length = 0; this.cc = createCompiler({ assetsBaseUrl: "/cc/", onProgress: (e) => progress.push(e) }); return this.cc; },
  get dev() { return dev; }, get bench() { return bench; },
  async setup(app, partIds) {
    dev?.stop(); bench?.dispose();
    dev = new DotbenchDevice({ autoRestart: true }); bench = new Bench(); bench.attach(dev);
    for (const id of partIds) { const r = await bench.loadPart(new Uint8Array(await (await fetch("/parts/" + id + ".dotpart")).arrayBuffer())); if (!r.ok) throw new Error(id + ": " + JSON.stringify(r.errors)); }
    await dev.load(await (await fetch("/pkg/" + app + ".dotbench")).arrayBuffer());
  },
  async start() { await dev.start(); },
  text: () => (dev ? dev.lines.map((l) => l.text).join("\n") : ""),
  /** plain-JSON view of a compile result (a Uint8Array does not cross puppeteer's evaluate) */
  async build(board, files, options) { const r = await this.cc.compile({ board, files, options }); return { ok: r.ok, bytes: r.wasm?.length, diagnostics: r.diagnostics, timings: r.timings, cancelled: !!r.cancelled, pch: r.timings?.pch }; },
  /** compile and upload to a running board part */
  async upload(instance, board, files) {
    const r = await this.cc.compile({ board, files });
    if (!r.ok) return { ok: false, diagnostics: r.diagnostics };
    const res = await bench.setPartCode(instance, { source: files["main.ino"], wasm: r.wasm, name: "sketch" });
    return { ok: true, sha256: res.sha256, bytes: res.bytes, timings: r.timings };
  },
};
window.PREADY = true;
