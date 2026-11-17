// SPDX-License-Identifier: GPL-3.0-or-later
// The sketch compiler proper (runs inside the Worker; platform neutral, so Node tests drive the very same code):
//   files -> sketchToCpp (shared with `dotbench part build`) -> clang -cc1 per source -> wasm-ld against the board's precompiled libdotcore.a
//   -> a plain wasm32 ABI 1 module -> packageEntries + zip (shared with `part build`) = partDef
import { sketchToCpp, fieldsHeader, packageEntries, writeZipWith } from "../../../tools/dblib/part/shared.mjs";
import { compileCpp, runTool, linkArgs, getFile, pchPath } from "./driver.js";
import { parseCompilerOutput, parseLinkerOutput, addHints } from "./diagnostics.js";
import { crc32 } from "./crc32.js";

/** C++ headers cheap enough for the light PCH tier; every other header without a dot (<vector>, <string>, <memory>, ...) selects the STL tier. */
const LIGHT_STD = /^(c(assert|ctype|errno|float|inttypes|limits|locale|math|setjmp|signal|stdarg|stddef|stdint|stdio|stdlib|string|time|wchar|wctype)|new|utility|type_traits|initializer_list|limits|atomic|cstdint)$/;
const INCLUDE = /^\s*#\s*include\s*<([^>]+)>/gm;

/** "light" or "stl": which precompiled header a project wants. Scans every text file of the project (a user header may include <vector>). */
export function chooseTier(texts) {
  for (const t of texts) { INCLUDE.lastIndex = 0; let m; while ((m = INCLUDE.exec(t))) { const h = m[1]; if (!h.includes(".") && !h.includes("/") && !LIGHT_STD.test(h)) return "stl"; } }
  return "light";
}

/** validate and normalise the file map the page gives us: {"main.ino": "...", "util.h": "...", "libraries/Foo/src/Foo.cpp": "..."} */
export function normaliseFiles(files) {
  const out = new Map();
  for (const [raw, text] of Object.entries(files ?? {})) {
    const p = raw.replace(/^\.?\//, "");
    if (!p || p.includes("\\") || p.split("/").some((s) => s === ".." || s === "") ) throw new Error(`bad file name "${raw}"`);
    if (typeof text !== "string") throw new Error(`file "${raw}" must be text`);
    out.set(p, text);
  }
  if (![...out.keys()].some((p) => p.endsWith(".ino"))) throw new Error("the sketch needs a .ino file");
  return out;
}

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const extOf = (p) => (/\.(\w+)$/.exec(p)?.[1] ?? "").toLowerCase();

/** which files are compiled, and the include directories (all relative to /src) */
export function plan(files, mainName) {
  const ino = [...files.keys()].filter((p) => p.endsWith(".ino") && !p.startsWith("libraries/")).sort();
  const main = mainName && files.has(mainName) ? mainName : ino.includes("main.ino") ? "main.ino" : ino[0];
  const order = [main, ...ino.filter((p) => p !== main)];
  const incDirs = new Set(["/gen", "/src"]), sources = [];
  const libRoot = new Map();   // libraries/<Name> -> include dir (src/ if the library has one)
  for (const p of files.keys()) { const m = /^libraries\/([^/]+)\//.exec(p); if (m) { const r = "libraries/" + m[1]; libRoot.set(r, libRoot.get(r) || p.startsWith(r + "/src/")); } }
  for (const [r, hasSrc] of libRoot) incDirs.add("/src/" + r + (hasSrc ? "/src" : ""));
  for (const p of files.keys()) {
    const e = extOf(p);
    if (e === "ino") continue;
    const d = dirOf(p);
    if (!p.startsWith("libraries/")) incDirs.add("/src" + (d ? "/" + d : ""));
    if (["c", "cpp", "cc", "cxx"].includes(e)) {
      if (p.startsWith("libraries/")) { const r = p.split("/").slice(0, 2).join("/"), inc = r + (libRoot.get(r) ? "/src" : ""); if (d !== inc) continue; }   // like `part build`: only the library's own src/ (or root) folder, not recursive
      sources.push({ path: p, lang: e === "c" ? "c" : "c++" });
    }
  }
  return { order, main, sources, incDirs: [...incDirs] };
}

const treeSet = (tree, p, v) => { const s = p.split("/"); let d = tree; for (const x of s.slice(0, -1)) d = d[x] ??= {}; d[s.at(-1)] = v; };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async (bytes) => hex(await globalThis.crypto.subtle.digest("SHA-256", bytes));

/**
 * @param {{runLLVM: Function}} rt
 * @param {{id: string, defines: string[], manifest: object, picture?: Uint8Array}} board the loaded board (see assets.js)
 * @param {{files: Record<string,string>, options?: {pch?: "auto"|"light"|"stl"|"none", opt?: string, memoryKb?: number, stackKb?: number, main?: string, manifest?: object, tierAvailable?: (t: string)=>boolean}}} req
 */
export async function compileSketch(rt, board, req, hooks = {}) {
  const t0 = performance.now(), o = req.options ?? {}, bd = board, timings = {};
  const files = normaliseFiles(req.files), pl = plan(files, o.main);
  const manifest = JSON.parse(JSON.stringify(o.manifest ?? bd.manifest)), b = (manifest.behaviour ??= {});
  const { cpp, protoOrigins } = sketchToCpp(pl.order.map((p) => [p, files.get(p)]));
  const tree = { "sketch.cpp": cpp, gen: { "dotbench_fields.h": fieldsHeader(manifest) }, src: {} };
  for (const [p, t] of files) if (!p.endsWith(".ino")) treeSet(tree.src, p, t);
  const ctx = { protoOrigins };
  const tier = o.pch === "none" ? null : o.pch === "light" || o.pch === "stl" ? o.pch : chooseTier([...files.values()]);
  timings.pch = tier ?? "none";
  const log = []; let diagnostics = [];
  const fail = (diags, extra = {}) => { const t = performance.now(); timings.totalMs = Math.round(t - t0); return { ok: false, diagnostics: addHints(diags), log: log.join(""), timings, board: bd.id, ...extra }; };
  const ccT0 = performance.now(), objs = {};
  const jobs = [{ src: "/sketch.cpp", out: "/sketch.o", lang: "c++", name: pl.main }, ...pl.sources.map((s, i) => ({ src: "/src/" + s.path, out: `/obj${i}.o`, lang: s.lang, name: s.path }))];
  for (const j of jobs) {
    hooks.step?.("compile " + j.name);
    const r = await compileCpp(rt.runLLVM, tree, { bd, board: bd.id, src: j.src, out: j.out, mainName: j.name, lang: j.lang, incs: pl.incDirs, opt: o.opt ?? "-Os",
      pch: tier && j.lang === "c++" ? pchPath(bd.id, tier) : null });
    log.push(r.stderr); diagnostics.push(...parseCompilerOutput(r.stderr, ctx));
    if (!r.ok) {
      timings.ccMs = Math.round(performance.now() - ccT0);
      if (!diagnostics.some((d) => d.severity === "error")) diagnostics.push({ file: pl.main, line: 0, column: 0, severity: "error", message: r.stderr.trim().split("\n").pop() || "the compiler failed", source: "compiler" });
      return fail(diagnostics);
    }
    objs[j.out.slice(1)] = r.obj;
  }
  timings.ccMs = Math.round(performance.now() - ccT0);
  hooks.step?.("link");
  const ldT0 = performance.now();
  const ld = await runTool(rt.runLLVM, linkArgs({ objs: Object.keys(objs).map((x) => "/" + x), board: bd.id, memKb: o.memoryKb ?? b.memory_kb ?? 1024, stackKb: o.stackKb ?? b.stack_kb ?? 64 }), objs);
  timings.ldMs = Math.round(performance.now() - ldT0);
  log.push(ld.stderr);
  if (!ld.ok) return fail([...diagnostics, ...parseLinkerOutput(ld.stderr, pl.main)]);
  const wasm = getFile(ld.files, "/out.wasm");
  // package: the same entry list `part build` writes; the sketch files go in under src/ like a part folder
  const pkT0 = performance.now();
  b.sources = [...files.keys()].filter((p) => !p.startsWith("libraries/")).map((p) => "src/" + p);
  const sha256 = await sha256Hex(wasm);
  const read = (name) => (name.startsWith("src/") && files.has(name.slice(4)) ? new TextEncoder().encode(files.get(name.slice(4))) : bd.assets?.get(name) ?? null);
  const entries = packageEntries(manifest, wasm, sha256, read);
  const dotpart = writeZipWith(entries, { crc32 });
  timings.packageMs = Math.round(performance.now() - pkT0);
  timings.totalMs = Math.round(performance.now() - t0);
  return { ok: true, wasm, partDef: { manifest: JSON.parse(new TextDecoder().decode(entries[0][1])), sha256, files: entries, dotpart }, diagnostics: addHints(diagnostics), log: log.join(""), timings, board: bd.id };
}
