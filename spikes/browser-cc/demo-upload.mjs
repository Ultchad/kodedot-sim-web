// "Compile and upload": a part already on the bench (wired, fields set) gets new firmware compiled in the browser toolchain; the instance restarts with it.
// Uses only the existing runtime API plus ONE internal assignment (part.def = newDef): the runtime has no public "replace firmware" call (work list item).
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { Worker } from "node:worker_threads"; import { fileURLToPath, pathToFileURL } from "node:url";
import { writeStoredZip } from "./lib/zip-stored.js";
import { readDotpart } from "../../runtime/web-adapter/dotpart.js";
import { Bench } from "../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../runtime/web-adapter/bench-clock.js";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../.."), SITE = path.join(HERE, "build/site/cc/");
const dir = path.join(ROOT, "parts/esp32-blink-echo"), manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), ino1 = fs.readFileSync(path.join(dir, "src/main.ino"), "utf8");
const picture = fs.readFileSync(path.join(dir, manifest.picture.file));
const worker = new Worker(path.join(SITE, "cc-worker.bundle.js")); const pending = new Map(); let rr; const ready = new Promise((r) => (rr = r)); let nid = 0;
worker.on("message", (m) => { if (m.type === "ready") rr(m); else if (m.id !== undefined) pending.get(m.id)?.(m); });
worker.postMessage({ type: "init", base: pathToFileURL(SITE).href, assetBase: SITE }); await ready;
const compile = (ino) => new Promise((res) => { const id = ++nid; pending.set(id, res); worker.postMessage({ type: "compile", id, ino, manifest }); });
const toDef = async (wasm, ino) => { const m2 = JSON.parse(JSON.stringify(manifest)); delete m2.$schema; m2.behaviour.wasm_sha256 = crypto.createHash("sha256").update(wasm).digest("hex");
  return readDotpart(writeStoredZip([["manifest.json", Buffer.from(JSON.stringify(m2))], [manifest.picture.file, picture], [manifest.behaviour.entry, wasm], ["src/main.ino", Buffer.from(ino)]]), { builtin: true }); };
let ok = true; const check = (n, c, x = "") => { if (!c) ok = false; console.log(`${c ? "ok  " : "FAIL"} - ${n} ${x}`); };

const bench = new Bench({ clock: new BenchClock({ mode: "stepped" }) });
const r1 = await compile(ino1); const def1 = await toDef(r1.wasm, ino1);
bench.registerPart(def1);
const inst = bench.addPart(manifest.id, { fields: { blink_ms: 250 } });
bench.connect("device.V33", inst + ".V33"); bench.connect("device.GND", inst + ".GND");
bench.setRails({ V33: true, V5: true }); await bench.ready?.();
await bench.advance(50_000);
const c1 = bench.state().parts[0].console.join("\n"); check("v1 runs on the bench", /echoing UART1/.test(c1), JSON.stringify(c1));
// edit the sketch, compile again (warm), upload
const ino2 = ino1.replace('Serial.println("echoing UART1: RX GPIO16, TX GPIO17, 115200 8N1");', 'Serial.println("v2 uploaded from the browser");');
const t = performance.now(); const r2 = await compile(ino2); const def2 = await toDef(r2.wasm, ino2);
bench.registerPart(def2); const part = bench.parts.get(inst); part.def = def2; await bench.restartPart(inst);
await bench.advance(50_000);
const st = bench.state().parts[0], c2 = st.console.join("\n");
check("after upload the instance runs v2, wires and fields kept", /v2 uploaded/.test(c2) && st.fields.blink_ms === 250 && bench.state().wires.length === 2, `${Math.round(performance.now() - t)} ms from edit to running; console ${JSON.stringify(c2)}`);
worker.terminate(); bench.dispose?.(); console.log(ok ? "UPLOAD DEMO PASSED" : "FAILED"); process.exit(ok ? 0 : 1);
