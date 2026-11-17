// SPDX-License-Identifier: GPL-3.0-or-later
// Asset build of the in-browser compiler. NEVER committed: it assembles, from the pinned npm package (@yowasp/clang) and this repo's dotcore,
// a folder the page build copies (e.g. into web/public/cc/). Nothing here touches web/.
//
//   node runtime/cc/build/build-assets.mjs [--out build/cc-assets] [--work build/cc-work] [--chunk-bytes 20000000]
//        [--boards esp32,uno-r3,...] [--no-stl] [--sizes] [--yowasp <dir of an extracted @yowasp/clang package>]
//
// Output (all names carry a content hash, so they can be served immutable; manifest.json is the only mutable file):
//   manifest.json                 files {name: {size, sha256}}, boards (data for the page), wasm chunks, versions
//   cc-worker.<h>.js              the Worker: runtime + engine in ONE script (blob: Worker, no relative imports)
//   llvm.core.<h>.<n>.wasm        the 75 MB LLVM module in chunks of at most --chunk-bytes; llvm.core2/3/4 small modules
//   sysroot-inc / sysroot-lib / sysroot-core .pack.gz   wasi-libc + libc++ headers, link libraries, core + ArduinoCore-API headers
//   board-<id>.<h>.pack           per board: variant header, libdotcore.a, light PCH, part manifest, picture, NOTICE
//   pch-stl-<id>.<h>.pack         per board: the STL precompiled header (fetched only when a sketch needs it)
//   NOTICE.txt, licenses/*        the licence texts that must accompany the toolchain
//   build-report.json             durations and sizes (raw, and with --sizes gzip and brotli)
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto";
import { createRequire } from "node:module"; import { fileURLToPath, pathToFileURL } from "node:url"; import zlib from "node:zlib";
import { packFiles } from "../engine/pack.js";
import { compileCpp, runTool, getFile, cc1Args, PCH_LIGHT, PCH_STL_EXTRA, pchPath, pchHeader } from "../engine/driver.js";
import { BOARDS, SUPPORTED, UNSUPPORTED, FAMILY_NOTES } from "../boards.mjs";
import { CORES, CORE_DIR } from "../../../tools/dblib/part/build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../..");
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf("--" + n); return i < 0 ? d : argv[i + 1]; }, flag = (n) => argv.includes("--" + n);
const OUT = path.resolve(opt("out", path.join(ROOT, "build/cc-assets"))), WORK = path.resolve(opt("work", path.join(ROOT, "build/cc-work")));
const CHUNK = Number(opt("chunk-bytes", 20_000_000)), API = process.env.DOTBENCH_ARDUINO_API || "/home/claude/src/third/ArduinoCore-API";
const want = (opt("boards", "") || Object.keys(BOARDS).join(",")).split(",").filter(Boolean);
const TC = JSON.parse(fs.readFileSync(path.join(HERE, "../toolchain.json"), "utf8"));
const t0 = performance.now(), laps = {}, lap = (m, k) => { const s = ((performance.now() - t0) / 1000); if (k) laps[k] = +s.toFixed(1); console.log(`[${s.toFixed(1)}s] ${m}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------- 1. the toolchain package (own folders, never next to our scripts)
const DL = path.join(WORK, "dl"), PKG = path.join(WORK, "pkg"), RES = path.join(WORK, "res");
let YW = opt("yowasp", "");
if (!YW) {
  YW = path.join(PKG, "package/gen");
  if (!fs.existsSync(path.join(YW, "bundle.js"))) {
    fs.mkdirSync(DL, { recursive: true }); fs.rmSync(PKG, { recursive: true, force: true }); fs.mkdirSync(PKG, { recursive: true });
    const spec = `${TC.npm}@${TC.version}`;
    execFileSync("npm", ["pack", spec, "--pack-destination", DL, "--silent"], { stdio: "inherit" });
    const tgz = path.join(DL, fs.readdirSync(DL).find((f) => f.endsWith(".tgz")));
    const integrity = "sha512-" + createHash("sha512").update(fs.readFileSync(tgz)).digest("base64");
    if (integrity !== TC.integrity) throw new Error(`${spec}: integrity ${integrity} does not match runtime/cc/toolchain.json`);
    execFileSync("tar", ["xzf", tgz, "-C", PKG]);
  }
} else YW = path.join(path.resolve(YW), "gen");
lap("toolchain package ready", "fetch");
fs.rmSync(RES, { recursive: true, force: true }); fs.mkdirSync(RES, { recursive: true });
execFileSync("tar", ["xf", path.join(YW, "llvm-resources.tar"), "-C", RES]);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, "licenses"), { recursive: true });

// ---------------------------------------------------------------- tree helpers
const readTree = (dir, filter = () => true) => { const m = new Map(); const w = (d, pre) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p, pre + e.name + "/"); else if (filter(p)) m.set(pre + e.name, fs.readFileSync(p)); } }; w(dir, ""); return m; };
const toTree = (map) => { const t = {}; for (const [p, v] of map) { const s = p.split("/"); let d = t; for (const x of s.slice(0, -1)) d = d[x] ??= {}; d[s.at(-1)] = v; } return t; };
const orig = await import(pathToFileURL(path.join(YW, "bundle.js")).href);

// ---------------------------------------------------------------- 2. sysroot headers (trimmed) and link libraries
const KEEP_TOP = /^(__(?!clang_)\w+\.h|float\.h|inttypes\.h|iso646\.h|limits\.h|stdalign\.h|stdarg\.h|stdatomic\.h|stdbool\.h|stdckdint\.h|stdcountof\.h|stddef\.h|stdint\.h|stdnoreturn\.h|tgmath\.h|unwind\.h|varargs\.h|wasm_simd128\.h|builtins\.h|module\.modulemap)$/;
const inc = new Map();
for (const [p, d] of readTree(path.join(RES, "include"))) {
  const top = p.split("/")[0], keep = p.includes("/") ? (top === "c++" && !p.startsWith("c++/v1/__cxx03/")) || top === "wasm32-wasip1" : KEEP_TOP.test(p);
  if (keep) inc.set("usr/include/" + p, d);
}
const lib = new Map();
for (const f of ["libc.a", "libc++.a", "libc++abi.a", "crt1-reactor.o"]) lib.set("usr/lib/wasm32-wasip1/" + f, fs.readFileSync(path.join(RES, "lib/wasm32-wasip1", f)));
lib.set("usr/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a", fs.readFileSync(path.join(RES, "lib/wasm32-unknown-wasip1/libclang_rt.builtins.a")));
// core headers (board independent) and the ArduinoCore-API headers; only the variant's pins_arduino.h differs per board
const common = new Map();
for (const [p, d] of readTree(CORE_DIR, (q) => /\.h$/.test(q) && !q.includes(path.sep + "variants" + path.sep))) common.set("dotcore/common/include/" + p, d);
for (const [p, d] of readTree(path.join(API, "api"), (q) => /\.(h|hpp)$/.test(q))) common.set("dotcore/common/apiroot/api/" + p, d);
lap(`headers: ${inc.size} sysroot, ${common.size} core/API`, "headers");

// ---------------------------------------------------------------- 3. per board: precompiled core, PCH tiers, pack
const files = {}, encodings = {};      // served name -> stored bytes; name -> "gzip" when the stored bytes are gzip (the Worker inflates them with DecompressionStream)
// .pack files would be served as application/octet-stream, which Vercel's CDN does not compress: gzip them ourselves so the wire size never depends on CDN rules.
// --gzip-wasm does the same for the LLVM module (default: left raw, as .wasm, which the CDN compresses with brotli)
const gz = (b) => zlib.gzipSync(b, { level: 9 });
const addFile = (base, ext, bytes, enc = null) => { if (enc === "gzip") bytes = gz(bytes); const h = sha(bytes).slice(0, 10), name = `${base}.${h}${ext}${enc === "gzip" ? ".gz" : ""}`; files[name] = bytes; if (enc) encodings[name] = enc; return name; };
const boards = {};
const apiSrcs = ["Print", "Stream", "String", "IPAddress", "Common"].map((n) => [n + ".cpp", fs.readFileSync(path.join(API, "api", n + ".cpp"))]);
const macro = (txt, n) => { const m = new RegExp(`#define\\s+${n}\\b\\s*(\\(?[^\\n/]*)`).exec(txt); return m ? m[1].trim() : null; };
for (const id of want) {
  const spec = BOARDS[id]; if (!spec || !CORES[id]) throw new Error(`unknown board ${id}`);
  const partDir = path.join(ROOT, "parts", spec.partDir), manifest = JSON.parse(fs.readFileSync(path.join(partDir, "manifest.json"), "utf8"));
  const pins = fs.readFileSync(path.join(CORE_DIR, "variants", id, "pins_arduino.h"));
  const defines = ["ARDUINO=10819", ...CORES[id].map((d) => d.replace(/^-D/, "")), "HOST"];
  const bd = { id, defines };
  const tree = toTree(new Map([...common, [`dotcore/${id}/variant/pins_arduino.h`, pins]]));
  tree.dotcore.src = { "dotcore.cpp": fs.readFileSync(path.join(CORE_DIR, "dotcore.cpp")), "wasi_shim.cpp": fs.readFileSync(path.join(HERE, "../core/wasi_shim.cpp")), ...Object.fromEntries(apiSrcs) };
  const objs = [], tb = performance.now();
  for (const n of Object.keys(tree.dotcore.src)) {
    const out = `/dotcore/${id}/obj/${n.replace(".cpp", ".o")}`;
    const r = await compileCpp(orig.runLLVM, tree, { bd, board: id, src: "/dotcore/src/" + n, out, incs: ["/dotcore/common/apiroot/api"] });
    if (!r.ok) { console.error(r.stderr); throw new Error(`core does not compile: ${id}/${n}`); }
    objs.push([out, r.obj]);
  }
  const objTree = { dotcore: { [id]: { obj: Object.fromEntries(objs.map(([o, d]) => [path.basename(o), d])) } } };
  const ar = await runTool(orig.runLLVM, ["ar", "rcs", `/dotcore/${id}/lib/libdotcore.a`, ...objs.map(([o]) => o)], objTree);
  if (!ar.ok) throw new Error("ar failed " + ar.stderr);
  const libdotcore = getFile(ar.files, `/dotcore/${id}/lib/libdotcore.a`);
  const pch = {};
  for (const tier of flag("no-stl") ? ["light"] : ["light", "stl"]) {
    const text = PCH_LIGHT + (tier === "stl" ? PCH_STL_EXTRA : "");
    tree.dotcore[id].pch = { [`${tier}.h`]: text };
    const r = await runTool(orig.runLLVM, cc1Args({ bd, board: id, src: pchHeader(id, tier), out: pchPath(id, tier), emitPch: true }), tree);
    if (!r.ok) throw new Error(`pch ${id}/${tier}: ${r.stderr}`);
    pch[tier] = { header: text, bytes: getFile(r.files, pchPath(id, tier)) };
  }
  const notice = fs.readFileSync(path.join(HERE, "../licenses/PART-NOTICE.txt"));
  const boardPack = new Map([[`dotcore/${id}/variant/pins_arduino.h`, pins], [`dotcore/${id}/lib/libdotcore.a`, libdotcore], [`dotcore/${id}/pch/light.h`, pch.light.header], [`dotcore/${id}/pch/light.pch`, pch.light.bytes],
    ["meta/manifest.json", JSON.stringify(manifest)], ["meta/NOTICE", notice]]);
  if (manifest.picture?.file) boardPack.set("meta/" + manifest.picture.file, fs.readFileSync(path.join(partDir, manifest.picture.file)));
  const stlPack = pch.stl ? new Map([[`dotcore/${id}/pch/stl.h`, pch.stl.header], [`dotcore/${id}/pch/stl.pch`, pch.stl.bytes]]) : new Map();
  // what the page can show: derived from the variant header, never retyped
  const h = pins.toString("utf8"), pinMap = {};
  for (const st of h.matchAll(/static const uint8_t\s+([^;]+);/g)) for (const x of st[1].matchAll(/(\w+)\s*=\s*(\d+)/g)) pinMap[x[1]] = +x[2];
  const num = (n) => { const v = macro(h, n); return v !== null && /^\d+$/.test(v) ? +v : null; };
  const capabilities = { adcBits: num("DP_ADC_BITS"), adcVrefMv: num("DP_ADC_VREF_MV"), adcResolutionSettable: !!macro(h, "DP_ADC_SETTABLE"), pwmBits: num("DP_PWM_BITS"), eepromBytes: num("DP_EEPROM_SIZE"), logicMv: num("DP_LOGIC_MV"),
    serial1: !!macro(h, "DP_HAS_SERIAL1"), wifiStub: !!macro(h, "DP_HAS_WIFI"), ledMatrix: !!macro(h, "DP_HAS_MATRIX"), espApi: !!macro(h, "DP_ESP_API"), dac: /DP_IS_DAC/.test(h) || !!macro(h, "DP_DAC") };
  const sketch = path.join(partDir, "src/main.ino");
  boards[id] = {
    name: macro(h, "DP_BOARD_NAME")?.replace(/^"|"$/g, "") ?? id, core: id, partId: manifest.id, family: spec.family, defines,
    pack: addFile("board-" + id, ".pack", packFiles(boardPack), "gzip"), pchStl: pch.stl ? addFile("pch-stl-" + id, ".pack", packFiles(stlPack), "gzip") : null,
    defaultSketch: { name: "main.ino", text: fs.readFileSync(sketch, "utf8") }, pins: pinMap, capabilities,
    limits: { memoryKb: manifest.behaviour.memory_kb ?? 1024, stackKb: manifest.behaviour.stack_kb ?? 64 },
    supported: SUPPORTED, unsupported: UNSUPPORTED, notes: FAMILY_NOTES[spec.family] ?? [],
  };
  lap(`${id}: core ${libdotcore.length} B, light PCH ${pch.light.bytes.length} B${pch.stl ? `, STL PCH ${pch.stl.bytes.length} B` : ""} (${Math.round(performance.now() - tb)} ms)`, "board-" + id);
}
const sysroot = { inc: addFile("sysroot-inc", ".pack", packFiles(inc), "gzip"), lib: addFile("sysroot-lib", ".pack", packFiles(lib), "gzip"), core: addFile("sysroot-core", ".pack", packFiles(common), "gzip") };

// ---------------------------------------------------------------- 4. LLVM modules: the big one in chunks
const big = fs.readFileSync(path.join(YW, "llvm.core.wasm")), chunks = [], bigHash = sha(big).slice(0, 10);
const GZW = flag("gzip-wasm");
for (let i = 0, n = 0; i < big.length; i += CHUNK, n++) { let b = big.subarray(i, i + CHUNK); if (GZW) b = gz(b); const name = `llvm.core.${bigHash}.${n}.wasm${GZW ? ".gz" : ""}`; files[name] = b; if (GZW) encodings[name] = "gzip"; chunks.push(name); }
const others = fs.readdirSync(YW).filter((f) => /^llvm\.core\d+\.wasm$/.test(f)).map((f) => ({ module: f, file: addFile(f.replace(".wasm", ""), ".wasm", fs.readFileSync(path.join(YW, f))) }));
lap(`wasm: ${big.length} B in ${chunks.length} chunks of at most ${CHUNK} B`, "wasm");

// ---------------------------------------------------------------- 5. the Worker (one script: patched yowasp runtime + engine + shared modules)
let js = fs.readFileSync(path.join(YW, "bundle.js"), "utf8");
const a = js.indexOf("var modules = async (fetch3) => ({"), b = js.indexOf("var totalSize =");
if (a < 0 || b < 0) throw new Error("yowasp bundle.js layout changed: cannot patch (the toolchain is pinned; update the patch together with toolchain.json)");
js = js.slice(0, a) + "var modules = async (fetch3) => globalThis.__CC_ASSETS__.modules(fetch3);\nvar filesystem = async (fetch3) => globalThis.__CC_ASSETS__.filesystem(fetch3);\n" + js.slice(b);
js = js.replace(/var totalSize = \d+;/, "var totalSize = 1;");
if (js.includes('new URL("./llvm.core.wasm"') || js.includes('llvm-resources.tar"')) throw new Error("runtime patch incomplete");
fs.mkdirSync(path.join(WORK, "entry"), { recursive: true });
fs.writeFileSync(path.join(WORK, "entry/clang-runtime.js"), js);
fs.writeFileSync(path.join(WORK, "entry/worker-entry.js"), `import * as rt from "./clang-runtime.js";\nimport { startWorker } from ${JSON.stringify(path.join(HERE, "../engine/worker-main.js"))};\nstartWorker(rt);\n`);
const req = [createRequire(path.join(ROOT, "web/package.json")), createRequire(import.meta.url)];
let rolldown = null; for (const r of [...req, ...(process.env.ROLLDOWN ? [createRequire(process.env.ROLLDOWN + "/")] : [])]) { try { rolldown = r(process.env.ROLLDOWN ? path.resolve(process.env.ROLLDOWN) : "rolldown"); break; } catch { try { rolldown = r("rolldown"); break; } catch {} } }
if (!rolldown) throw new Error("rolldown not found (it comes with vite 8 in web/node_modules; or set ROLLDOWN=<path to the rolldown package>)");
const bundled = path.join(WORK, "entry/cc-worker.bundle.js");
await rolldown.build({ input: path.join(WORK, "entry/worker-entry.js"), external: [/^node:/], output: { file: bundled, format: "esm", minify: true }, logLevel: "warn" });
const worker = addFile("cc-worker", ".js", fs.readFileSync(bundled));
lap("worker bundled", "worker");

// ---------------------------------------------------------------- 6. licences, NOTICE, manifest
const LIC = path.join(HERE, "../licenses");
for (const f of fs.readdirSync(LIC)) if (f.endsWith(".txt") && f !== "PART-NOTICE.txt") files["licenses/" + f] = fs.readFileSync(path.join(LIC, f));
files["NOTICE.txt"] = fs.readFileSync(path.join(LIC, "NOTICE.txt"));
const manifestFiles = Object.fromEntries(Object.entries(files).map(([n, d]) => [n, { size: d.length, sha256: sha(d), ...(encodings[n] ? { encoding: encodings[n] } : {}) }]));
const version = sha(Object.keys(manifestFiles).sort().map((n) => n + manifestFiles[n].sha256).join("\n")).slice(0, 12);
const manifest = { format: 1, version, toolchain: { package: TC.npm, version: TC.version }, chunkBytes: CHUNK, worker, notice: "NOTICE.txt",
  wasm: { core: { module: "llvm.core.wasm", chunks }, others }, sysroot, boards, files: manifestFiles };
for (const [n, d] of Object.entries(files)) { const p = path.join(OUT, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d); }
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
lap("written", "total");

// ---------------------------------------------------------------- 7. report
const report = { durationsSec: laps, version, chunkBytes: CHUNK, files: {} };
let raw = 0; for (const [n, d] of Object.entries(files)) { report.files[n] = { raw: d.length }; raw += d.length; }
report.totalRaw = raw;
if (flag("sizes")) {
  let gz = 0, br = 0;
  for (const [n, d] of Object.entries(files)) {
    if (/^licenses|NOTICE/.test(n)) continue;
    const g = zlib.gzipSync(d, { level: 9 }).length, q = zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: d.length } }).length;
    report.files[n].gzip = g; report.files[n].brotli9 = q; gz += g; br += q; console.log(n.padEnd(46), String(d.length).padStart(10), String(g).padStart(10), String(q).padStart(10));
  }
  report.totalGzip = gz; report.totalBrotli9 = br;
}
fs.writeFileSync(path.join(OUT, "build-report.json"), JSON.stringify(report, null, 1));
console.log(`total ${raw} B in ${Object.keys(files).length} files, version ${version}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
