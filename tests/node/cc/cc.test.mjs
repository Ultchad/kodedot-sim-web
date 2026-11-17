// SPDX-License-Identifier: GPL-3.0-or-later
// Node tests of the in-browser compile service: the real client (runtime/cc/index.js) driving the real Worker bundle (worker_threads), then the
// real part runtime (importer, PartTester) running what was built. Needs the asset build: `node runtime/cc/build/build-assets.mjs`.
// usage: node tests/node/cc/cc.test.mjs [assets-dir]      (default build/cc-assets, or $DOTBENCH_CC_ASSETS)
import fs from "node:fs"; import { createHash } from "node:crypto"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createCompiler } from "../../../runtime/cc/index.js";
import { readDotpart } from "../../../runtime/web-adapter/dotpart.js";
import { PartTester, runScenario } from "../../../runtime/web-adapter/part-tester.js";
import { sketchToCpp, inoToCpp } from "../../../tools/dblib/part/shared.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ASSETS = path.resolve(process.argv[2] || process.env.DOTBENCH_CC_ASSETS || path.join(ROOT, "build/cc-assets")) + "/";
if (!fs.existsSync(ASSETS + "manifest.json")) { console.error(`no assets in ${ASSETS}; run: node runtime/cc/build/build-assets.mjs`); process.exit(2); }
const B = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "budgets.json"), "utf8"));
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); } };
const cc = createCompiler({ assetsBaseUrl: ASSETS });
const info = await cc.info();

async function runPart(r, ms = 300) {
  const def = await readDotpart(r.partDef.dotpart, { builtin: true });
  if (!def.ok) return { importer: def.errors.map((e) => e.message).join("; ") };
  const t = await PartTester.create(def);
  try { await t.advance(ms); await new Promise((x) => setTimeout(x, 300)); const st = t.bench.state().parts[0]; return { console: t.console(), crashed: !!st.crashed }; } finally { t.dispose(); }
}
const bad = (r) => r.diagnostics.map((d) => `${d.file}:${d.line}:${d.column} ${d.message}`).join(" | ");

console.log("== manifest and budgets");
const files = Object.entries(info && JSON.parse(fs.readFileSync(ASSETS + "manifest.json", "utf8")).files);
const raw = files.reduce((n, [, f]) => n + f.size, 0);
ok(`bundle raw size ${raw} <= ${B.bundleRawBytes}`, raw <= B.bundleRawBytes);
ok("every wasm chunk <= chunk limit", files.filter(([n]) => /^llvm\.core\.\w+\.\d+\.wasm$/.test(n)).every(([, f]) => f.size <= B.maxChunkBytes));
ok(`worker script ${files.find(([n]) => n.startsWith("cc-worker"))[1].size} B <= ${B.workerBytes}`, files.find(([n]) => n.startsWith("cc-worker"))[1].size <= B.workerBytes);
for (const [id, b] of Object.entries(info.boards)) ok(`${id}: pack ${b.bytes.board} B, STL PCH ${b.bytes.stlPch} B within budget`, b.bytes.board <= B.boardPackBytes && b.bytes.stlPch <= B.stlPackBytes);
ok("licence texts and NOTICE ship", ["NOTICE.txt", "licenses/LLVM-LICENSE.txt", "licenses/wasi-libc-LICENSE.txt", "licenses/libcxx-LICENSE.txt", "licenses/ArduinoCore-API-LICENSE.txt"].every((n) => fs.existsSync(ASSETS + n)));
ok("manifest lists 5 boards with data the page can show", Object.keys(info.boards).length === 5 && Object.values(info.boards).every((b) => b.defaultSketch.text && b.supported.length && b.unsupported.length && b.pins.LED_BUILTIN !== undefined && b.capabilities.adcBits));
ok("sha-256 of every file matches the manifest", files.every(([n, f]) => createHash("sha256").update(fs.readFileSync(ASSETS + n)).digest("hex") === f.sha256));
console.log("== toolchain start");
let t = performance.now(); const rd = await cc.ready({ board: "esp32" }); const readyMs = performance.now() - t;
ok(`ready() ${Math.round(readyMs)} ms <= ${B.readyMs}`, readyMs <= B.readyMs);

console.log("== shared ino-to-cpp");
const one = "int x;\nvoid setup(){ f(); }\nvoid loop(){}\nvoid f(){}\n";
ok("one file: sketchToCpp output is exactly inoToCpp (the offline tool's output)", sketchToCpp([["main.ino", one]]).cpp === inoToCpp(one, "main.ino"));

console.log("== every board, its default sketch");
for (const [id, b] of Object.entries(info.boards)) {
  const r = await cc.compile({ board: id, files: { "main.ino": b.defaultSketch.text } });
  ok(`${id}: compiles (${r.timings.totalMs} ms, wasm ${r.wasm?.length} B)`, r.ok, bad(r));
  if (!r.ok) continue;
  const x = await runPart(r, 600);
  ok(`${id}: importer accepts it and it runs, console ${JSON.stringify((x.console ?? "").slice(0, 50))}`, !x.importer && !x.crashed && (x.console ?? "").length > 0, x.importer);
  if (id === "esp32") { ok(`trivial compile ${r.timings.totalMs} ms <= ${B.trivialCompileMs}`, r.timings.totalMs <= B.trivialCompileMs); ok(`wasm ${r.wasm.length} B <= ${B.wasmBytesTrivial}`, r.wasm.length <= B.wasmBytesTrivial); }
}

console.log("== the three ESP32 examples pass their own scenarios");
for (const n of ["esp32-blink-echo", "esp32-i2c-slave", "esp32-button-led"]) {
  const dir = path.join(ROOT, "parts", n), m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const r = await cc.compile({ board: "esp32", files: { "main.ino": fs.readFileSync(path.join(dir, "src/main.ino"), "utf8") }, options: { manifest: m } });
  ok(`${n}: compiles`, r.ok, bad(r)); if (!r.ok) continue;
  const def = await readDotpart(r.partDef.dotpart, { builtin: true });
  ok(`${n}: importer accepts`, def.ok);
  for (const f of fs.readdirSync(path.join(dir, "tests")).filter((x) => x.endsWith(".test.json"))) {
    const sc = JSON.parse(fs.readFileSync(path.join(dir, "tests", f), "utf8")), tester = await PartTester.create(def), log = [];
    try { await runScenario(tester, sc, log); ok(`${n}: scenario ${sc.name ?? f} (${log.length} steps)`, true); } catch (e) { ok(`${n}: scenario ${sc.name ?? f}`, false, e.message); } finally { tester.dispose(); }
  }
}

console.log("== diagnostics");
let r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){\n  int x = ;\n}\nvoid loop(){}\n" } });
ok("syntax error: file, line and column of the user's code", !r.ok && r.diagnostics[0]?.file === "main.ino" && r.diagnostics[0].line === 2 && r.diagnostics[0].column === 11 && r.diagnostics[0].severity === "error", bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\n", "b.ino": "\n\nint g(){ return undefined_name; }\n" } });
ok("error in the second .ino is reported in b.ino line 3", !r.ok && r.diagnostics[0]?.file === "b.ino" && r.diagnostics[0].line === 3, bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\nvoid use(Missing m){ }\n" } });
ok("error inside a generated prototype maps to the function's line", !r.ok && r.diagnostics.some((d) => d.file === "main.ino" && d.line === 3 && /Missing/.test(d.message)), bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){ missing_fn(); }\nvoid loop(){}\n" } });
ok("compile error for an undeclared function, with line", !r.ok && r.diagnostics[0]?.line === 1);
r = await cc.compile({ board: "esp32", files: { "main.ino": "void helper();\nvoid setup(){ helper(); }\nvoid loop(){}\n" } });
ok("link error (undefined symbol) is a structured linker diagnostic", !r.ok && r.diagnostics.some((d) => d.source === "linker" && /undefined symbol: helper/.test(d.message)), bad(r));
r = await cc.compile({ board: "uno-r3", files: { "main.ino": "void setup(){ DDRB = 1; }\nvoid loop(){}\n" } });
ok("AVR register use gets a plain-language hint", !r.ok && !!r.diagnostics[0]?.hint, bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "#include <freertos/FreeRTOS.h>\nvoid setup(){}\nvoid loop(){}\n" } });
ok("FreeRTOS include: error on line 1 with a hint", !r.ok && r.diagnostics[0]?.line === 1 && !!r.diagnostics[0].hint, bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){ try { throw 1; } catch(int){} }\nvoid loop(){}\n" } });
ok("exceptions are refused with a hint", !r.ok && !!r.diagnostics[0]?.hint, bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "static unsigned char big[2000000];\nvoid setup(){ big[millis()%9]=1; Serial.println(big[3]); }\nvoid loop(){}\n" } });
ok("static data larger than the part's memory fails with a hint", !r.ok && r.diagnostics.some((d) => /initial memory too small/.test(d.message) && d.hint), bad(r));
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){ int unused; }\nvoid loop(){}\n" }, options: {} });
ok("a warning does not fail the build", r.ok);

console.log("== String, Servo, Wire, EEPROM, STL, multi-file");
r = await cc.compile({ board: "esp32", files: { "main.ino": `#include <Servo.h>\n#include <Wire.h>\n#include <EEPROM.h>\nServo s;\nvoid setup(){ Serial.begin(115200); String a="abc"; a += String(12) + String(3.5f, 2); Serial.println(a); Serial.println(itoa(-45, (char*)(char[16]){0}, 10)); s.attach(4); s.write(90); Wire.begin(21,22); Wire.beginTransmission(0x40); Wire.write(0); Wire.endTransmission(); Serial.println("ok"); }\nvoid loop(){ delay(1000); }\n` } });
ok("String + Servo + Wire + EEPROM sketch builds", r.ok, bad(r));
if (r.ok) { const x = await runPart(r); ok(`it runs: ${JSON.stringify(x.console)}`, /abc123\.50\r?\n-45\r?\nok/.test(x.console) && !x.crashed); }
r = await cc.compile({ board: "esp32", files: { "main.ino": "#include <vector>\n#include <string>\n#include <map>\nvoid setup(){ Serial.begin(115200); std::vector<int> v{3,1,2}; std::map<std::string,int> m; m[\"a\"]=v[0]; Serial.println(m[\"a\"] + (int)v.size()); }\nvoid loop(){ delay(1000); }\n" } });
ok(`STL sketch selects the STL PCH tier (${r.timings.totalMs} ms <= ${B.stlCompileMs})`, r.ok && r.timings.pch === "stl" && r.timings.totalMs <= B.stlCompileMs, bad(r) + " " + r.timings.pch);
if (r.ok) { const x = await runPart(r); ok(`STL sketch runs: ${JSON.stringify(x.console)}`, /^6/.test(x.console)); }
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\n" } });
ok("a plain sketch uses the light tier", r.ok && r.timings.pch === "light");
r = await cc.compile({ board: "uno-r3", files: { "main.ino": "#include <util.h>\n#include <Foo.h>\nvoid setup(){ Serial.begin(9600); Serial.println(twice(21)); Serial.println(foo()); }\nvoid loop(){ delay(1000); }\n", "b.ino": "int fromB(){ return 5; }\n", "util.h": "#pragma once\nint twice(int);\n", "util.cpp": "#include \"util.h\"\nint twice(int x){ return 2*x; }\n", "libraries/Foo/src/Foo.h": "#pragma once\nint foo();\n", "libraries/Foo/src/Foo.cpp": "#include \"Foo.h\"\nint foo(){ return 7; }\n" } });
ok("multi-file sketch (two .ino, header, .cpp, library) builds", r.ok, bad(r));
if (r.ok) { const x = await runPart(r); ok(`multi-file runs: ${JSON.stringify(x.console)}`, /^42\r?\n7/.test(x.console)); ok("package carries the sketch files under src/", r.partDef.files.some(([n]) => n === "src/util.cpp") && r.partDef.files.some(([n]) => n === "NOTICE")); }

console.log("== queue and cancel");
const slow = cc.compile({ board: "esp32", files: { "main.ino": "#include <vector>\nvoid setup(){}\nvoid loop(){}\n// cancel-me\n" } });
const queued = cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\n// queued\n" } });
await new Promise((x) => setTimeout(x, 300)); queued.cancel(); slow.cancel();
const [rs, rq] = await Promise.all([slow, queued]);
ok("running and queued compiles resolve as cancelled", rs.cancelled === true && rq.cancelled === true && !rs.ok);
r = await cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\n// after cancel\n" } });
ok(`a compile after cancel works (worker restarted, ${r.timings.totalMs} ms, load ${r.timings.loadMs} ms)`, r.ok, bad(r));
const again = cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\n// after cancel\n" } });
ok("same request again is served from the result cache", (await again).timings.cached === true);
cc.cancel();

cc.dispose();
console.log(`\ncc: ${fail ? "FAILED" : "PASSED"} (${pass} checks passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
