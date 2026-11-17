// Node demo: compile a sketch in a worker_threads Worker running the browser toolchain, hand the result to the real part runtime, run the part's scenarios.
// Usage: node demo-node.mjs [part-folder ...]    (default: the three ESP32 example parts)
import fs from "node:fs"; import path from "node:path"; import { Worker } from "node:worker_threads"; import { fileURLToPath, pathToFileURL } from "node:url";
import { writeStoredZip } from "./lib/zip-stored.js";
import { readDotpart } from "../../runtime/web-adapter/dotpart.js";
import { PartTester, runScenario } from "../../runtime/web-adapter/part-tester.js";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const SITE = path.join(HERE, "build/site/cc/");
const parts = process.argv.slice(2).length ? process.argv.slice(2) : ["esp32-blink-echo", "esp32-i2c-slave", "esp32-button-led"].map((n) => path.join(ROOT, "parts", n));

const tInit = performance.now();
const worker = new Worker(path.join(SITE, "cc-worker.js"));
const pending = new Map(); let readyResolve;
const ready = new Promise((r) => (readyResolve = r));
worker.on("message", (m) => { if (m.type === "ready") readyResolve(m); else if (m.id !== undefined) pending.get(m.id)?.(m); else if (m.type === "error") { console.error(m.message); process.exit(2); } });
worker.on("error", (e) => { console.error("worker error", e); process.exit(2); });
worker.postMessage({ type: "init", base: pathToFileURL(SITE).href, assetBase: SITE });
const rd = await ready;
console.log(`toolchain ready in ${Math.round(performance.now() - tInit)} ms (assets ${Math.round(rd.ms.assets)}, import ${Math.round(rd.ms.import)}, first run ${Math.round(rd.ms.firstRun)})`);
let nid = 0;
const compile = (ino, manifest) => new Promise((res) => { const id = ++nid; pending.set(id, res); worker.postMessage({ type: "compile", id, ino, manifest }); });

let allOk = true;
for (const dir of parts) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const ino = fs.readFileSync(path.join(dir, "src/main.ino"), "utf8");
  const r = await compile(ino, manifest);
  console.log(`\n== ${manifest.id}: compile ${r.ok ? "ok" : "FAILED"}  cc ${Math.round(r.ms.cc)} ms + link ${Math.round(r.ms.ld)} ms = ${Math.round(r.ms.total)} ms` + (r.wasm ? `, wasm ${r.wasm.length} B` : ""));
  if (!r.ok) { console.log(r.stderr); allOk = false; continue; }
  if (r.stderr.trim()) console.log(r.stderr.trim());
  // wasm -> .dotpart exactly as `part build` packs it (sha256 into the manifest), then through the real importer
  const sha = (await import("node:crypto")).createHash("sha256").update(r.wasm).digest("hex");
  const m2 = JSON.parse(JSON.stringify(manifest)); delete m2.$schema; m2.behaviour.wasm_sha256 = sha;
  const files = [["manifest.json", Buffer.from(JSON.stringify(m2, null, 2) + "\n")]];
  if (manifest.picture?.file) files.push([manifest.picture.file, fs.readFileSync(path.join(dir, manifest.picture.file))]);
  files.push([manifest.behaviour.entry, r.wasm], ["src/main.ino", Buffer.from(ino)]);
  const def = await readDotpart(writeStoredZip(files), { builtin: true });
  if (!def.ok) { console.log("importer rejected the browser-built part:", JSON.stringify(def.errors)); allOk = false; continue; }
  console.log("importer: accepted");
  const td = path.join(dir, "tests");
  for (const f of fs.readdirSync(td).filter((x) => x.endsWith(".test.json")).sort()) {
    const t = JSON.parse(fs.readFileSync(path.join(td, f), "utf8"));
    const tester = await PartTester.create(def); const log = [];
    try { await runScenario(tester, t, log); console.log(`  scenario "${t.name ?? f}": ${log.length} steps passed`); }
    catch (e) { allOk = false; for (const l of log) console.log("   " + l); console.log("  FAIL " + e.message); }
    finally { tester.dispose(); }
  }
}
// a recompile of the first sketch (warm)
{ const dir = parts[0], manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), ino = fs.readFileSync(path.join(dir, "src/main.ino"), "utf8");
  const r = await compile(ino + "\n// edit\n", manifest); console.log(`\nrecompile (warm): ${Math.round(r.ms.total)} ms (cc ${Math.round(r.ms.cc)} + link ${Math.round(r.ms.ld)})`); }
console.log(allOk ? "\nBROWSER-BUILT PARTS: ALL PASSED" : "\nFAILED");
process.exit(allOk ? 0 : 1);
