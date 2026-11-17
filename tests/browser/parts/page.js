// The page side of the parts test: exactly the wiring docs/STATUS-parts.md ("Page wiring") tells a front end to do.
import { DotbenchDevice } from "/adapter/dotbench-device.js";
import { Bench } from "/adapter/bench.js";
import { configureWorker } from "/adapter/bench-wasm.js";

// Under a strict CSP (worker-src blob:) the part Worker must be a blob made from the module's source.
configureWorker({ source: await (await fetch("/adapter/part-worker.js")).text() });

let dev = null, bench = null;
window.P = {
  get dev() { return dev; }, get bench() { return bench; },
  async setup(app, partIds) {
    dev?.stop(); bench?.dispose();
    dev = new DotbenchDevice({ autoRestart: true });
    bench = new Bench();
    bench.attach(dev);
    for (const id of partIds) { const r = await bench.loadPart(new Uint8Array(await (await fetch("/parts/" + id + ".dotpart")).arrayBuffer())); if (!r.ok) throw new Error(id + ": " + JSON.stringify(r.errors)); }
    await dev.load(await (await fetch("/pkg/" + app + ".dotbench")).arrayBuffer());
    return true;
  },
  async start() { await dev.start(); },
  text: () => (dev ? dev.lines.map((l) => l.text).join("\n") : ""),
  warnings: [],
};
window.PREADY = true;
