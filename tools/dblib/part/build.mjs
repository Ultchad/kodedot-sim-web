// SPDX-License-Identifier: GPL-3.0-or-later
// Building a part: manifest.json + src/ -> behaviour.wasm (ArduinoCore-API + dotcore + the sketch, Emscripten standalone wasm) -> .dotpart
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sketchToCpp, fieldsHeader, packageEntries } from "./shared.mjs";
import { writeZip } from "./zipwrite.mjs";
import { checkWasmModule, ABI1_EXPORTS } from "../../../runtime/web-adapter/dotpart.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CORE_DIR = path.join(ROOT, "runtime/parts/core");
const sh = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);

export function env() {
  const emsdk = process.env.DOTBENCH_EMSDK || "/home/claude/tools/emsdk";
  const api = process.env.DOTBENCH_ARDUINO_API || "/home/claude/src/third/ArduinoCore-API";
  const cache = process.env.DOTBENCH_CACHE || path.join(os.homedir(), ".cache", "dotbench");
  return { emsdk, api, cache };
}
/** Run a shell command with em++ reachable. Returns {code, out}. */
function run(cmd, cwd) {
  const { emsdk } = env();
  const pre = spawnSync("bash", ["-c", "command -v em++ >/dev/null"]).status === 0 ? "" : `. ${sh(path.join(emsdk, "emsdk_env.sh"))} >/dev/null 2>&1 || exit 97; `;
  const r = spawnSync("bash", ["-c", pre + cmd], { cwd, encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
export const CORES = { "esp32": ["-DARDUINO_ARCH_ESP32", "-DESP32"], "esp32-s3": ["-DARDUINO_ARCH_ESP32", "-DESP32", "-DARDUINO_ESP32S3_DEV"],
  "uno-r3": ["-DARDUINO_AVR_UNO"], "uno-r4-minima": ["-DARDUINO_MINIMA", "-DARDUINO_ARCH_RENESAS_UNO"], "uno-r4-wifi": ["-DARDUINO_UNOR4_WIFI", "-DARDUINO_ARCH_RENESAS_UNO"] };
const coreOf = (m) => { const c = m?.behaviour?.core ?? "esp32"; if (!CORES[c]) throw new Error(`behaviour.core "${c}" is not a dotcore variant (${Object.keys(CORES).join(", ")})`); return c; };
const FLAGS = (api, core, extra = []) => ["-Os", "-std=gnu++17", "-fno-exceptions", "-fno-rtti", "-ffunction-sections", "-fdata-sections", "-I", path.join(CORE_DIR, "variants", core), "-I", CORE_DIR, "-I", api,
  "-DARDUINO=10819", ...CORES[core], "-DHOST", "-Wno-main", ...extra].map(sh).join(" ");

export { fieldsHeader };   // moved to shared.mjs (the browser compile service uses it too)

/** The core archive, built once per (core sources, API sources, emcc) and cached. */
export function ensureCore(log = () => {}, core = "esp32") {
  const { api, cache } = env();
  const srcs = [path.join(CORE_DIR, "dotcore.cpp"), ...["Print", "Stream", "String", "IPAddress", "Common"].map((n) => path.join(api, "api", n + ".cpp"))];
  for (const s of srcs) if (!fs.existsSync(s)) throw new Error(`missing ${s}; set DOTBENCH_ARDUINO_API to a checkout of arduino/ArduinoCore-API`);
  const h = createHash("sha256");
  for (const f of [...fs.readdirSync(CORE_DIR).sort().map((n) => path.join(CORE_DIR, n)).filter((p) => fs.statSync(p).isFile()), ...fs.readdirSync(path.join(CORE_DIR, "variants", core)).sort().map((n) => path.join(CORE_DIR, "variants", core, n)), ...srcs, ...fs.readdirSync(path.join(api, "api")).sort().filter((n) => n.endsWith(".h")).map((n) => path.join(api, "api", n))]) h.update(fs.readFileSync(f));
  const ver = run("em++ --version | head -1", process.cwd());
  if (ver.code !== 0) throw new Error("Emscripten (em++) not found. Set DOTBENCH_EMSDK to your emsdk folder.\n" + ver.out);
  h.update(ver.out);
  h.update(core);
  const dir = path.join(cache, "dotcore-" + core + "-" + h.digest("hex").slice(0, 16)), lib = path.join(dir, "libdotcore.a");
  if (fs.existsSync(lib)) return lib;
  log("building dotcore (once, cached in " + dir + ")");
  fs.mkdirSync(dir, { recursive: true });
  const objs = [];
  for (const s of srcs) {
    const o = path.join(dir, path.basename(s, ".cpp") + ".o");
    const r = run(`em++ ${FLAGS(api, core)} -c ${sh(s)} -o ${sh(o)}`, dir);
    if (r.code !== 0) throw new Error("dotcore does not compile:\n" + r.out);
    objs.push(o);
  }
  const r = run(`emar rcs ${sh(lib)} ${objs.map(sh).join(" ")}`, dir);
  if (r.code !== 0) throw new Error("emar failed:\n" + r.out);
  return lib;
}

const uleb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
/** Drop the exports that are not part of ABI 1 (Emscripten adds stack helpers); the functions stay, only the export entries go. */
export function stripExports(wasm, keep = ABI1_EXPORTS) {
  const b = Buffer.from(wasm); let p = 8; const out = [b.subarray(0, 8)];
  const rd = () => { let r = 0, sh = 0, x; do { x = b[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80); return r >>> 0; };
  while (p < b.length) {
    const id = b[p++], size = rd(), start = p, end = p + size;
    if (id !== 7) { out.push(b.subarray(start - 1 - uleb(size).length, end)); p = end; continue; }
    const n = rd(), entries = [];
    for (let i = 0; i < n; i++) { const e0 = p, len = rd(), name = b.subarray(p, p + len).toString("utf8"); p += len; p++; rd(); entries.push({ name, raw: b.subarray(e0, p) }); }
    const kept = entries.filter((e) => keep.has(e.name)), body = Buffer.concat([Buffer.from(uleb(kept.length)), ...kept.map((e) => e.raw)]);
    out.push(Buffer.from([7, ...uleb(body.length)]), body); p = end;
  }
  return new Uint8Array(Buffer.concat(out));
}

/** Compile the folder's sketch to a wasm. Returns {wasm: Uint8Array, log: string}. */
export function compileWasm(dir, m, log = () => {}) {
  dir = path.resolve(dir);
  const { api } = env(), b = m.behaviour, outDir = path.join(dir, "build");
  fs.mkdirSync(path.join(outDir, "gen"), { recursive: true }); fs.mkdirSync(path.join(outDir, "obj"), { recursive: true });
  const core = coreOf(m), lib = ensureCore(log, core);
  fs.writeFileSync(path.join(outDir, "gen", "dotbench_fields.h"), fieldsHeader(m));
  const sources = b.sources ?? ["src/main.ino"], ino = [], objs = [], incs = new Set([path.join(outDir, "gen")]);
  for (const s of sources) {
    const p = path.join(dir, s);
    if (!fs.existsSync(p)) throw new Error(`behaviour.sources lists ${s}, which does not exist`);
    incs.add(path.dirname(p));
    if (s.endsWith(".ino")) ino.push(p);
  }
  // libraries/<Name>/(src/)*.cpp
  const libsDir = path.join(dir, "libraries"), libSources = [];
  if (fs.existsSync(libsDir)) for (const n of fs.readdirSync(libsDir)) {
    const root = path.join(libsDir, n); if (!fs.statSync(root).isDirectory()) continue;
    const inc = fs.existsSync(path.join(root, "src")) ? path.join(root, "src") : root;
    incs.add(inc);
    for (const f of fs.readdirSync(inc)) if (/\.(cpp|c|cc)$/.test(f)) libSources.push(path.join(inc, f));
  }
  const incFlags = [...incs].flatMap((i) => ["-I", i]);
  const compileOne = (src, name, lang) => {
    const o = path.join(outDir, "obj", name + ".o");
    const r = run(`em++ ${FLAGS(api, core, incFlags)} ${lang ? "-x " + lang : ""} -c ${sh(src)} -o ${sh(o)}`, dir);
    if (r.code !== 0) throw new Error(`compile error in ${path.relative(dir, src)}:\n${r.out}`);
    if (r.out.trim()) log(r.out.trim());
    objs.push(o);
  };
  if (ino.length) {
    // the IDE concatenates the sketch files; the first listed one comes first, and every file keeps its own name and line numbers (#line)
    const out = path.join(outDir, "sketch.cpp");
    fs.writeFileSync(out, sketchToCpp(ino.map((p) => [path.relative(dir, p), fs.readFileSync(p, "utf8")])).cpp);
    compileOne(out, "sketch", "c++");
  }
  for (const s of sources) if (/\.(cpp|cc|c)$/.test(s)) compileOne(path.join(dir, s), "src_" + s.replace(/[^A-Za-z0-9]/g, "_"), s.endsWith(".c") ? "c" : "c++");
  for (const s of libSources) compileOne(s, "lib_" + path.relative(libsDir, s).replace(/[^A-Za-z0-9]/g, "_"), s.endsWith(".c") ? "c" : "c++");
  if (!objs.length) throw new Error("no source to compile (behaviour.sources is empty)");
  const wasmPath = path.join(outDir, "behaviour.wasm"), mem = Math.ceil(((b.memory_kb ?? 1024) * 1024) / 65536) * 65536;
  const r = run(`em++ -Os ${objs.map(sh).join(" ")} ${sh(lib)} -o ${sh(wasmPath)} -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=${mem} -sSTACK_SIZE=${(b.stack_kb ?? 64) * 1024} -sERROR_ON_UNDEFINED_SYMBOLS=1 -Wl,--gc-sections -Wl,--export=dp_start`, dir);
  if (r.code !== 0) throw new Error("link error:\n" + r.out);
  const wasm = stripExports(fs.readFileSync(wasmPath));
  fs.writeFileSync(wasmPath, wasm);
  return { wasm, log: r.out };
}

/** The allow-list check the importer will apply, with a readable message. */
export async function checkWasm(wasm) {
  const mod = await WebAssembly.compile(wasm);
  return checkWasmModule(mod);
}

/** Files of the folder that go into the package: [name, bytes][] (the list itself is shared.mjs packageEntries) */
export function packageFiles(dir, m, wasm) {
  return packageEntries(m, wasm, wasm ? createHash("sha256").update(wasm).digest("hex") : null, (name) => readIf(path.join(dir, name)));
}
export function zipPackage(files) { return writeZip(files); }
