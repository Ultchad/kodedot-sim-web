// SPDX-License-Identifier: GPL-3.0-or-later
// The in-browser sketch compiler (runs in a Worker, or in a Node worker_threads Worker). Platform neutral: the host supplies `loadAssets`.
// sketch text -> ino2cpp -> clang -cc1 (in wasm) -> wasm-ld (in wasm) against the precompiled libdotcore.a -> a plain wasm32 module ABI 1 accepts.
import { inoToCpp } from "./ino2cpp.js";
import { fieldsHeader } from "./part-glue.js";
import { compileCpp, runTool, linkArgs, getFile, pchPath, BOARDS } from "./cc-driver.js";

/** Parse clang diagnostics ("file:line:col: severity: message") into objects; lines from our generated code are flagged. */
export function parseDiagnostics(text) {
  const out = [], re = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;
  for (const line of text.split("\n")) {
    const m = re.exec(line);
    if (m) out.push({ file: m[1], line: +m[2], col: +m[3], severity: m[4] === "fatal error" ? "error" : m[4], message: m[5] });
  }
  return out;
}

export class SketchCompiler {
  /** @param {{runLLVM: Function}} rt  @param {{memKb?:number, stackKb?:number}} defaults */
  constructor(rt, { usePch = true } = {}) { this.rt = rt; this.usePch = usePch; }

  /**
   * @param {{ino: string, manifest: object, file?: string, extraSources?: Record<string,string>}} req
   * @returns {Promise<{ok:boolean, wasm?:Uint8Array, diagnostics:object[], stderr:string, ms:{cc:number, ld:number, total:number}}>}
   */
  async compile({ ino, manifest, file = "main.ino", extraSources = {}, board = null }) {
    const t0 = performance.now(), b = manifest.behaviour ?? {};
    const cpp = inoToCpp(ino, file);
    // extraSources: path (relative to /src, e.g. "MyLib/MyLib.cpp", "util.h") -> text. .h files go on the include path, .c/.cpp/.cc get compiled and linked.
    const src = {};
    for (const [p, text] of Object.entries(extraSources)) { const parts = p.split("/"); let d = src; for (const x of parts.slice(0, -1)) d = d[x] ??= {}; d[parts.at(-1)] = text; }
    const files = { "sketch.cpp": cpp, gen: { "dotbench_fields.h": fieldsHeader(manifest) }, src };
    const incDirs = new Set(["/gen", "/src"]);
    for (const p of Object.keys(extraSources)) { const parts = p.split("/"); incDirs.add("/src" + (parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "")); }
    const incs = [...incDirs];
    let stderr = "", diagnostics = [];
    const jobs = [{ src: "/sketch.cpp", out: "/sketch.o", lang: "c++", name: "main.ino" }];
    let k = 0;
    for (const p of Object.keys(extraSources)) { const m = /\.(cpp|cc|cxx|c)$/.exec(p); if (m) jobs.push({ src: "/src/" + p, out: `/obj${k++}.o`, lang: m[1] === "c" ? "c" : "c++", name: p }); }
    const objs = {};
    for (const j of jobs) {
      const cc = await compileCpp(this.rt.runLLVM, files, { src: j.src, out: j.out, lang: j.lang, incs, pch: this.usePch && j.lang === "c++" ? pchPath(board ?? "esp32") : null, board: board ?? "esp32" });
      stderr += cc.stderr; diagnostics.push(...parseDiagnostics(cc.stderr));
      if (!cc.ok) { const t1 = performance.now(); return { ok: false, diagnostics, stderr, ms: { cc: t1 - t0, ld: 0, total: t1 - t0 } }; }
      objs[j.out.slice(1)] = cc.obj;
    }
    const t1 = performance.now();
    const ld = await runTool(this.rt.runLLVM, linkArgs({ objs: Object.keys(objs).map((o) => "/" + o), memKb: b.memory_kb ?? 1024, stackKb: b.stack_kb ?? 64, board: board ?? "esp32" }), objs);
    const t2 = performance.now();
    stderr += ld.stderr;
    if (!ld.ok) return { ok: false, diagnostics: [...diagnostics, ...linkDiagnostics(ld.stderr)], stderr, ms: { cc: t1 - t0, ld: t2 - t1, total: t2 - t0 } };
    const wasm = getFile(ld.files, "/out.wasm");
    return { ok: true, wasm, diagnostics, stderr, ms: { cc: t1 - t0, ld: t2 - t1, total: t2 - t0 } };
  }
}

/** wasm-ld: "wasm-ld: error: undefined symbol: xTaskCreate" and "... referenced by sketch.o:(...)" */
export function linkDiagnostics(text) {
  const out = [];
  for (const line of text.split("\n")) { const m = /^wasm-ld: (error|warning): (.*)$/.exec(line); if (m) out.push({ file: "(link)", line: 0, col: 0, severity: m[1], message: m[2] }); }
  return out;
}
