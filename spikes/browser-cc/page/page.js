// The page side of the spike: a compiler Worker (blob URL, as the CSP demands), the real part runtime, one entry point `window.CC` for the test driver.
import { PartTester, runScenario } from "/adapter/part-tester.js";
import { readDotpart } from "/adapter/dotpart.js";
import { configureWorker } from "/adapter/bench-wasm.js";
import { writeStoredZip } from "/cc/zip-stored.js";

configureWorker({ source: await (await fetch("/adapter/part-worker.js")).text() });   // the part Worker as a blob (strict CSP)

const log = (s) => { document.getElementById("out").textContent += "\n" + s; };
let worker = null, workerSrc = null, nid = 0; const pending = new Map();

window.CC = {
  /** Start the compiler Worker from a blob URL and load the toolchain. Returns {ms:{...}, stats:{fetched, fromCache, ms}} */
  async start({ origin = location.origin } = {}) {
    workerSrc ??= await (await fetch("/cc/cc-worker.bundle.js")).text();      // kept in memory: in production the page bundle carries it
    const src = workerSrc;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    worker = new Worker(url, { type: "module" });
    const t0 = performance.now();
    const ready = new Promise((res, rej) => {
      worker.onmessage = (e) => { const m = e.data; if (m.type === "ready") res(m); else if (m.type === "error" && m.id === undefined) rej(new Error(m.message)); else if (m.id !== undefined) pending.get(m.id)?.(m); };
      worker.onerror = (e) => rej(new Error("worker error: " + (e.message || e.filename + ":" + e.lineno)));
    });
    worker.postMessage({ type: "init", base: origin + "/cc/" });
    const r = await ready; r.wall = performance.now() - t0; return r;
  },
  stop() { worker?.terminate(); worker = null; },
  compile(ino, manifest, board = null) { return new Promise((res) => { const id = ++nid; pending.set(id, res); worker.postMessage({ type: "compile", id, ino, manifest, board }); }); },
  config(o) { return new Promise((res) => { const id = ++nid; pending.set(id, res); worker.postMessage({ type: "config", id, ...o }); }); },
  async compileLite(ino, manifest, board = null) { const r = await this.compile(ino, manifest, board); r.wasmBytes = r.wasm?.length; delete r.wasm; return r; },
  /** compiled wasm + the part's own manifest/picture/sources -> .dotpart bytes -> the real importer */
  async toPart(name, ino, manifest, wasm, picture) {
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", wasm))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const m2 = JSON.parse(JSON.stringify(manifest)); delete m2.$schema; m2.behaviour.wasm_sha256 = sha;
    const te = new TextEncoder();
    const files = [["manifest.json", te.encode(JSON.stringify(m2, null, 2) + "\n")], [manifest.picture.file, te.encode(picture)], [manifest.behaviour.entry, wasm], ["src/main.ino", te.encode(ino)]];
    const bytes = writeStoredZip(files);
    return { bytes, def: await readDotpart(bytes, { builtin: true }) };
  },
  async runScenarios(def, tests) {
    const out = [];
    for (const t of tests) {
      const tester = await PartTester.create(def), steps = [];
      try { await runScenario(tester, t, steps); out.push({ name: t.name, ok: true, steps: steps.length, console: tester.console().slice(-300) }); }
      catch (e) { out.push({ name: t.name, ok: false, steps: steps.length, error: e.message, log: steps }); }
      finally { tester.dispose(); }
    }
    return out;
  },
  /** the whole path for one example part, inside the page: sketch -> compile in the Worker -> .dotpart -> importer -> scenarios. Returns plain JSON. */
  async build(name, tests, inoOverride) {
    const base = `/example/${name}/`, manifest = JSON.parse(await (await fetch(base + "manifest.json")).text());
    const ino = inoOverride ?? await (await fetch(base + "src/main.ino")).text(), picture = await (await fetch(base + manifest.picture.file)).text();
    const r = await this.compile(ino, manifest);
    if (!r.ok) return { ok: false, stderr: r.stderr, ms: r.ms, diagnostics: r.diagnostics };
    const p = await this.toPart(name, ino, manifest, r.wasm, picture);
    if (!p.def.ok) return { ok: false, importer: p.def.errors, ms: r.ms };
    const scen = await this.runScenarios(p.def, tests);
    return { ok: true, ms: r.ms, wasm: r.wasm.length, pkg: p.bytes.length, scenarios: scen, stderr: r.stderr };
  },
  async fetchText(u) { return (await fetch(u)).text(); },
  async memory() { return performance.measureUserAgentSpecificMemory ? (await performance.measureUserAgentSpecificMemory()).bytes : null; },
  log,
};
window.READY = true; log("ready; crossOriginIsolated=" + crossOriginIsolated);
