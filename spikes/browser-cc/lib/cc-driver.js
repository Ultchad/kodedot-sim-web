// SPDX-License-Identifier: GPL-3.0-or-later
// The compile and link command lines of the browser build, platform neutral (Node and Web Worker).
// `runLLVM` is yowasp's runLLVM (original package in Node, the patched runtime in the browser). We call clang's `-cc1` and `wasm-ld` directly:
// the `clang++` driver wrapper of @yowasp/clang first runs `clang -###` (a whole extra instantiation of the 75 MB module) just to print these.
// Virtual file system layout:  /usr (sysroot: wasi-libc, libc++, clang builtin headers)  /dotcore (our headers and libdotcore.a)  /sketch.cpp  /gen  /src
export const TARGET = "wasm32-unknown-wasip1";
// A board = a dotcore flavour: its own pin map header, its own libdotcore.a and precompiled header, its own macros (library selection happens on these).
// esp32 = the same macros as `part build` (tools/dblib/part/build.mjs FLAGS). Everything else (libc, libc++, ArduinoCore-API objects) is shared.
export const BOARDS = {
  esp32: { name: "ESP32 DevKit", defines: ["ARDUINO=10819", "ARDUINO_ARCH_ESP32", "ESP32", "HOST"] },
  uno: { name: "Arduino Uno flavour (wasm32: 32-bit int, no AVR registers)", defines: ["ARDUINO=10819", "ARDUINO_AVR_UNO", "HOST"] },
};

// The precompiled header of everything every sketch includes (Arduino.h, Wire.h, SPI.h, Preferences.h, dotbench.h): made by 02-prepare.mjs with
// these very flags, ships in inc.pack. Saves most of the per-compile time (measured in RESULTS.md).
export const PCH_HEADER = "#include <Arduino.h>\n#include <Wire.h>\n#include <SPI.h>\n#include <Preferences.h>\n#include <dotbench.h>\n";
export const pchPath = (board) => `/dotcore/${board}/pch/all.pch`;
export function cc1Args({ src, out, mainName = src, incs = [], lang = "c++", opt = "-Os", pch = null, emitPch = false, board = "esp32" }) {
  const a = ["clang++", "-cc1", "-triple", TARGET, opt, "-emit-obj", "-disable-free", "-main-file-name", mainName,
    "-mrelocation-model", "static", "-mframe-pointer=none", "-ffp-contract=on", "-fno-rounding-math", "-mconstructor-aliases",
    "-target-cpu", "generic", "-fvisibility=hidden", "-fdebug-compilation-dir=/", "-ffunction-sections", "-fdata-sections", "-resource-dir", "/usr"];
  for (const i of [`/dotcore/${board}/include`, ...incs]) a.push("-I", i);
  for (const d of BOARDS[board].defines) a.push("-D", d);
  a.push("-isysroot", "/usr", "-internal-isystem", "/usr/include/wasm32-wasip1/c++/v1", "-internal-isystem", "/usr/include/c++/v1",
    "-internal-isystem", "/usr/include", "-internal-isystem", "/usr/include/wasm32-wasip1", "-Wno-main", "-fdeprecated-macro", "-ferror-limit", "19",
    "-fno-rtti", "-fgnuc-version=4.2.1", "-vectorize-loops", "-vectorize-slp");
  if (lang === "c++") a.push("-std=gnu++17"); else a.push("-std=gnu11");
  if (emitPch) { a[a.indexOf("-emit-obj")] = "-emit-pch"; lang = "c++-header"; }
  if (pch) a.push("-include-pch", pch);
  a.push("-o", out, "-x", lang, src);
  return a;
}

export function linkArgs({ objs, out = "/out.wasm", memKb = 1024, stackKb = 64, board = "esp32", extraLibs = [`/dotcore/${board}/lib/libdotcore.a`] }) {
  const mem = Math.ceil((memKb * 1024) / 65536) * 65536;
  return ["wasm-ld", "-m", "wasm32", "-L/usr/lib/wasm32-unknown-wasip1", "-L/usr/lib/wasm32-wasip1", "/usr/lib/wasm32-wasip1/crt1-reactor.o",
    "--entry", "_initialize", "--no-entry", "--export=dp_start", "--gc-sections", "--stack-first", "-z", `stack-size=${stackKb * 1024}`,
    `--initial-memory=${mem}`, `--max-memory=${mem}`, ...objs, ...extraLibs, "-lc++", "-lc++abi", "-lc", "/usr/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a", "-o", out];
}

const td = new TextDecoder();
const asBytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
export const getFile = (tree, p) => { let d = tree; for (const s of p.split("/").filter(Boolean)) { d = d?.[s]; if (d === undefined) return undefined; } return d; };

/** Run one LLVM tool. Returns {ok, stderr, files}. Never throws for a tool failure (exit code != 0). */
export async function runTool(runLLVM, args, files, options = {}) {
  let err = "";
  const stderr = (b) => { if (b) err += td.decode(b); };
  try {
    const out = await runLLVM(args, files, { stdout: stderr, stderr, fetchProgress: options.fetchProgress ?? (() => {}) });
    return { ok: true, stderr: err, files: out };
  } catch (e) {
    if (e?.code === undefined) throw e;
    return { ok: false, stderr: err, code: e.code, files: e.files };
  }
}

export async function compileCpp(runLLVM, files, opts) {
  const r = await runTool(runLLVM, cc1Args(opts), files);
  const obj = r.ok ? asBytes(getFile(r.files, opts.out)) : null;
  return { ok: r.ok, stderr: r.stderr, obj };
}
