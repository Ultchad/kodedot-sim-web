// SPDX-License-Identifier: GPL-3.0-or-later
// The in-browser sketch compiler (runs in a Worker, or in a Node worker_threads Worker). Platform neutral: the host supplies `loadAssets`.
// sketch text -> ino2cpp -> clang -cc1 (in wasm) -> wasm-ld (in wasm) against the precompiled libdotcore.a -> a plain wasm32 module ABI 1 accepts.
import { inoToCpp } from "./ino2cpp.js";
import { fieldsHeader } from "./part-glue.js";
import { compileCpp, runTool, linkArgs, getFile } from "./cc-driver.js";

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
  constructor(rt) { this.rt = rt; this.timings = {}; }

  /**
   * @param {{ino: string, manifest: object, file?: string, extraSources?: Record<string,string>}} req
   * @returns {Promise<{ok:boolean, wasm?:Uint8Array, diagnostics:object[], stderr:string, ms:{cc:number, ld:number, total:number}}>}
   */
  async compile({ ino, manifest, file = "main.ino", extraSources = {} }) {
    const t0 = performance.now(), b = manifest.behaviour ?? {};
    const cpp = inoToCpp(ino, file);
    const files = { "sketch.cpp": cpp, gen: { "dotbench_fields.h": fieldsHeader(manifest) }, src: { ...extraSources } };
    const cc = await compileCpp(this.rt.runLLVM, files, { src: "/sketch.cpp", out: "/sketch.o", incs: ["/gen", "/src"] });
    const t1 = performance.now();
    const diagnostics = parseDiagnostics(cc.stderr);
    if (!cc.ok) return { ok: false, diagnostics, stderr: cc.stderr, ms: { cc: t1 - t0, ld: 0, total: t1 - t0 } };
    const ld = await runTool(this.rt.runLLVM, linkArgs({ objs: ["/sketch.o"], memKb: b.memory_kb ?? 1024, stackKb: b.stack_kb ?? 64 }), { "sketch.o": cc.obj });
    const t2 = performance.now();
    const stderr = cc.stderr + ld.stderr;
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
