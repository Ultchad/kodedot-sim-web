// Step 2: build the shippable bundle in build/site/cc from the downloaded @yowasp/clang and the repo's dotcore.
//   llvm.core*.wasm        copied as is (the only 75 MB file)
//   clang-runtime.js       yowasp's bundle.js with its resource loading replaced by a hook (see patch below)
//   inc.pack               trimmed headers: clang builtin + wasi-libc + libc++ (usr/include), dotcore + ArduinoCore-API (dotcore/include)
//   lib.pack               link-time files: libc.a libc++.a libc++abi.a builtins crt1-reactor.o (usr/lib) and our precompiled libdotcore.a (dotcore/lib)
// Usage: node 02-prepare.mjs
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { packFiles } from "./lib/pack.js";
import { compileCpp, runTool, getFile } from "./lib/cc-driver.js";
import { loadTree, flatten } from "./lib/tree.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const YW = path.join(HERE, "build/yowasp/package/gen"), RES = path.join(HERE, "build/res"), OUT = path.join(HERE, "build/site/cc");
const CORE = path.join(ROOT, "runtime/parts/core"), API = process.env.DOTBENCH_ARDUINO_API || "/home/claude/src/third/ArduinoCore-API";
const t0 = performance.now(), lap = (m) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}`);

fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(RES, { recursive: true, force: true }); fs.mkdirSync(RES, { recursive: true });
execFileSync("tar", ["xf", path.join(YW, "llvm-resources.tar"), "-C", RES]);

// ---- 1. headers (trimmed). Allow-list of clang's own top-level headers; all of libc++ except the C++03 copy; wasi-libc headers. ----
const KEEP_TOP = /^(__(?!clang_)\w+\.h|float\.h|inttypes\.h|iso646\.h|limits\.h|stdalign\.h|stdarg\.h|stdatomic\.h|stdbool\.h|stdckdint\.h|stdcountof\.h|stddef\.h|stdint\.h|stdnoreturn\.h|tgmath\.h|unwind\.h|varargs\.h|wasm_simd128\.h|builtins\.h|module\.modulemap)$/;
const inc = new Map(), incFull = flatten(loadTree(path.join(RES, "include")));
let dropped = 0;
for (const [p, d] of incFull) {
  const top = p.split("/")[0], keep = p.includes("/") ? ((top === "c++" && !p.startsWith("c++/v1/__cxx03/")) || top === "wasm32-wasip1") : KEEP_TOP.test(p);
  if (keep) inc.set("usr/include/" + p, d); else dropped += d.length;
}
const dotInc = new Map();
for (const f of fs.readdirSync(CORE)) if (/\.(h|hpp)$/.test(f)) dotInc.set("dotcore/include/" + f, fs.readFileSync(path.join(CORE, f)));
for (const [p, d] of flatten(loadTree(path.join(API, "api"), (q, e) => e.isDirectory() || /\.(h|hpp)$/.test(q)))) dotInc.set("dotcore/include/api/" + p, d);
lap(`headers: kept ${inc.size} sysroot files, dropped ${(dropped / 1e6).toFixed(1)} MB, ${dotInc.size} dotcore/API headers`);

// ---- 2. precompile the core (everything that does not depend on the sketch) with the SAME clang and flags the browser uses ----
const orig = await import(path.join(YW, "bundle.js"));
const coreTree = {}; for (const [p, d] of dotInc) { const parts = p.split("/"); let t = coreTree; for (const s of parts.slice(0, -1)) t = t[s] ??= {}; t[parts.at(-1)] = d; }
coreTree.dotcore.src = { "dotcore.cpp": fs.readFileSync(path.join(CORE, "dotcore.cpp")) };
for (const f of ["wasi_shim.cpp", "libc_extras.cpp"]) coreTree.dotcore.src[f] = fs.readFileSync(path.join(HERE, "core", f));      // browser flavour only, see the file
for (const n of ["Print", "Stream", "String", "IPAddress", "Common"]) coreTree.dotcore.src[n + ".cpp"] = fs.readFileSync(path.join(API, "api", n + ".cpp"));
const objs = [];
for (const n of Object.keys(coreTree.dotcore.src)) {
  const out = "/dotcore/obj/" + n.replace(".cpp", ".o"), t = performance.now();
  const r = await compileCpp(orig.runLLVM, coreTree, { src: "/dotcore/src/" + n, out, incs: ["/dotcore/include/api"] });
  if (!r.ok) { console.error(r.stderr); throw new Error("core does not compile: " + n); }
  if (r.stderr.trim()) console.log(r.stderr.trim());
  objs.push([out, r.obj]); lap(`core ${n}: ${r.obj.length} B in ${Math.round(performance.now() - t)} ms`);
}
const objTree = { dotcore: { obj: Object.fromEntries(objs.map(([o, d]) => [path.basename(o), d])) } };
const ar = await runTool(orig.runLLVM, ["ar", "rcs", "/dotcore/lib/libdotcore.a", ...objs.map(([o]) => o)], objTree);
if (!ar.ok) throw new Error("ar failed " + ar.stderr);
const libdotcore = getFile(ar.files, "/dotcore/lib/libdotcore.a"); lap(`libdotcore.a ${libdotcore.length} B`);

// ---- 3. link-time files ----
const L = new Map([["dotcore/lib/libdotcore.a", libdotcore]]);
for (const f of ["libc.a", "libc++.a", "libc++abi.a", "crt1-reactor.o"]) L.set("usr/lib/wasm32-wasip1/" + f, fs.readFileSync(path.join(RES, "lib/wasm32-wasip1", f)));
L.set("usr/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a", fs.readFileSync(path.join(RES, "lib/wasm32-unknown-wasip1/libclang_rt.builtins.a")));
fs.writeFileSync(path.join(OUT, "inc.pack"), packFiles(new Map([...inc, ...dotInc])));
fs.writeFileSync(path.join(OUT, "lib.pack"), packFiles(L));

// ---- 4. the wasm modules and the patched runtime ----
for (const f of fs.readdirSync(YW).filter((x) => x.endsWith(".wasm"))) fs.copyFileSync(path.join(YW, f), path.join(OUT, f));
let js = fs.readFileSync(path.join(YW, "bundle.js"), "utf8");
// PATCH: replace the two resource loaders (hard-coded `new URL(..., import.meta.url)`, one 30 MB tar) with hooks the worker provides in globalThis.__CC_ASSETS__
const a = js.indexOf("var modules = async (fetch3) => ({"), b = js.indexOf("var totalSize =");
if (a < 0 || b < 0) throw new Error("bundle.js layout changed: cannot patch");
js = js.slice(0, a) + `var modules = async (fetch3) => globalThis.__CC_ASSETS__.modules(fetch3);\nvar filesystem = async (fetch3) => globalThis.__CC_ASSETS__.filesystem(fetch3);\n` + js.slice(b);
js = js.replace(/var totalSize = \d+;/, "var totalSize = 1;");
if (js.includes('new URL("./llvm.core.wasm"') || js.includes("llvm-resources.tar\"")) throw new Error("patch incomplete");
fs.writeFileSync(path.join(OUT, "clang-runtime.js"), js);
for (const f of ["cc-driver.js", "pack.js", "compiler.js", "assets.js", "cc-worker.js", "zip-stored.js"]) fs.copyFileSync(path.join(HERE, "lib", f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, "tools/dblib/part/ino2cpp.mjs"), path.join(OUT, "ino2cpp.js"));     // the very file `part build` uses
fs.copyFileSync(path.join(HERE, "lib/part-glue.mjs"), path.join(OUT, "part-glue.js"));
// ---- 5. one self-contained worker script (a blob: Worker cannot resolve relative imports, and every import would be another request) ----
const { createRequire } = await import("node:module");
const rolldown = createRequire(import.meta.url)(process.env.ROLLDOWN || "/home/claude/dotbench/web/node_modules/rolldown");
await rolldown.build({ input: path.join(OUT, "cc-worker.js"), external: [/^node:/], output: { file: path.join(OUT, "cc-worker.bundle.js"), format: "esm", minify: false }, logLevel: "warn" });
for (const f of ["cc-driver.js", "pack.js", "compiler.js", "assets.js", "cc-worker.js", "ino2cpp.js", "part-glue.js", "clang-runtime.js"]) fs.rmSync(path.join(OUT, f));   // now inside the bundle
lap("done");
for (const f of fs.readdirSync(OUT)) console.log(String(fs.statSync(path.join(OUT, f)).size).padStart(10), f);
