// SPDX-License-Identifier: GPL-3.0-or-later
// The compile and link command lines of the browser build, platform neutral (Node and Web Worker). `runLLVM` is yowasp's runLLVM.
// We call clang's `-cc1` and `wasm-ld` directly: the `clang++` driver wrapper of @yowasp/clang first runs `clang -###` (a whole extra
// instantiation of the 75 MB module) just to print these.
// Virtual file system:  /usr (sysroot: wasi-libc, libc++, clang builtin headers)   /dotcore/common/{include,apiroot} (core headers, ArduinoCore-API headers), /dotcore/<board>/{variant,lib,pch}   /sketch.cpp  /gen  /src
// The flags mirror tools/dblib/part/build.mjs FLAGS: same macros per core (CORES), same include order (variant, core headers, ArduinoCore-API root).
export const TARGET = "wasm32-unknown-wasip1";

/** The light PCH header lists what every sketch includes; the STL one adds the heavy libc++ headers. Built by the asset build with these very flags. */
export const PCH_LIGHT = "#include <Arduino.h>\n#include <Wire.h>\n#include <SPI.h>\n#include <Preferences.h>\n#include <dotbench.h>\n";
export const PCH_STL_EXTRA = "#include <vector>\n#include <string>\n#include <map>\n#include <functional>\n#include <algorithm>\n#include <cmath>\n";
export const pchPath = (board, tier) => `/dotcore/${board}/pch/${tier}.pch`;
export const pchHeader = (board, tier) => `/dotcore/${board}/pch/${tier}.h`;

/** @param {{defines: string[]}} bd board entry of the manifest */
export function cc1Args({ bd, board, src, out, mainName = src, incs = [], lang = "c++", opt = "-Os", pch = null, emitPch = false }) {
  const a = ["clang++", "-cc1", "-triple", TARGET, opt, "-emit-obj", "-disable-free", "-main-file-name", mainName,
    "-mrelocation-model", "static", "-mframe-pointer=none", "-ffp-contract=on", "-fno-rounding-math", "-mconstructor-aliases",
    "-target-cpu", "generic", "-fvisibility=hidden", "-fdebug-compilation-dir=/", "-ffunction-sections", "-fdata-sections", "-resource-dir", "/usr"];
  for (const i of [...incs, `/dotcore/${board}/variant`, "/dotcore/common/include", "/dotcore/common/apiroot"]) a.push("-I", i);
  for (const d of bd.defines) a.push("-D", d);
  a.push("-isysroot", "/usr", "-internal-isystem", "/usr/include/wasm32-wasip1/c++/v1", "-internal-isystem", "/usr/include/c++/v1",
    "-internal-isystem", "/usr/include", "-internal-isystem", "/usr/include/wasm32-wasip1", "-Wno-main", "-fdeprecated-macro", "-ferror-limit", "19",
    "-fno-rtti", "-fgnuc-version=4.2.1", "-vectorize-loops", "-vectorize-slp");
  if (lang === "c++") a.push("-std=gnu++17"); else a.push("-std=gnu11");
  if (emitPch) { a[a.indexOf("-emit-obj")] = "-emit-pch"; lang = "c++-header"; }
  if (pch) a.push("-include-pch", pch);
  a.push("-o", out, "-x", lang, src);
  return a;
}

export function linkArgs({ objs, out = "/out.wasm", board, memKb = 1024, stackKb = 64 }) {
  const mem = Math.ceil((memKb * 1024) / 65536) * 65536;
  return ["wasm-ld", "-m", "wasm32", "-L/usr/lib/wasm32-unknown-wasip1", "-L/usr/lib/wasm32-wasip1", "/usr/lib/wasm32-wasip1/crt1-reactor.o",
    "--entry", "_initialize", "--no-entry", "--export=dp_start", "--gc-sections", "--stack-first", "-z", `stack-size=${stackKb * 1024}`,
    `--initial-memory=${mem}`, `--max-memory=${mem}`, ...objs, `/dotcore/${board}/lib/libdotcore.a`, "-lc++", "-lc++abi", "-lc",
    "/usr/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a", "-o", out];
}

const td = new TextDecoder();
const asBytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
export const getFile = (tree, p) => { let d = tree; for (const s of p.split("/").filter(Boolean)) { d = d?.[s]; if (d === undefined) return undefined; } return d; };

/** Run one LLVM tool. Returns {ok, stderr, files}. Never throws for a tool failure (exit code != 0). */
export async function runTool(runLLVM, args, files) {
  let err = "";
  const stderr = (b) => { if (b) err += td.decode(b); };
  try {
    const out = await runLLVM(args, files, { stdout: stderr, stderr, fetchProgress: () => {} });
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
