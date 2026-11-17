#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// The committed, prebuilt parts library: parts/prebuilt/ = every <id>.dotpart + library.json + SOURCES.json.
//
// Why: the code parts (the five boards and the three ESP32 examples) are compiled with Emscripten, which exists only on the
// maker's machine. A clean clone (Vercel) has no emsdk, so the page build copies this folder instead of compiling. It is small
// (about 320 KB, 39 parts) and the build is deterministic (two clean builds with separate caches are byte-identical), so the
// diff of a regeneration only shows parts that really changed.
//
//   node tools/parts-prebuilt.mjs regen            rebuild the library with Emscripten into parts/prebuilt and record the source hashes
//   node tools/parts-prebuilt.mjs check [--rebuild]  exit 1 when the committed library is stale or damaged (--rebuild also compiles
//                                                  again with Emscripten and demands byte-identical files; needs the toolchain)
//   node tools/parts-prebuilt.mjs hashes           print the source hash of every part
//
// SOURCES.json records, per part folder, a sha-256 over everything the package is made from: the folder (manifest, sketch, picture,
// tests; not build outputs), and the build inputs shared by all parts (tools/dblib/part/*.mjs, runtime/web-adapter/dotpart*.js and
// zip.js, parts/build-library.mjs); for a code part also runtime/parts/core and the vendored ArduinoCore-API. `check` recomputes
// them: any difference is "stale" and means `regen` has not been run (and committed) after the change.
// The Emscripten version is recorded for information only; it is not part of the comparison (a clean machine has none).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const PARTS = path.join(ROOT, "parts");
export const PREBUILT = path.join(PARTS, "prebuilt");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const SKIP_DIRS = new Set(["build", "dist", "prebuilt", "node_modules", ".git"]);

function walk(dir, rel = "", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".DS_Store") continue;
    const p = path.join(dir, e.name), r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, r, out); }
    else if (e.isFile() && !e.name.endsWith(".dotpart")) out.push([r, p]);
  }
  return out;
}
const hashFiles = (label, entries) => {
  const h = createHash("sha256");
  for (const [name, p] of entries) h.update(`${label}${name}\0${sha(fs.readFileSync(p))}\n`);
  return h.digest("hex");
};
const under = (base, dir) => walk(path.join(ROOT, dir)).map(([r, p]) => [`${dir}/${r}`, p]);

/** Every input shared by all parts: the packaging code. */
function sharedEntries() {
  const e = [];
  for (const [r, p] of walk(path.join(ROOT, "tools/dblib/part"))) e.push([`tools/dblib/part/${r}`, p]);
  for (const f of ["dotpart.js", "dotpart-schema.js", "zip.js"]) e.push([`runtime/web-adapter/${f}`, path.join(ROOT, "runtime/web-adapter", f)]);
  e.push(["parts/build-library.mjs", path.join(PARTS, "build-library.mjs")]);
  return e;
}
/** Extra inputs of a code part: the dotcore sources and ArduinoCore-API. */
function codeEntries() {
  return [...under(ROOT, "runtime/parts/core"), ...under(ROOT, "third_party/ArduinoCore-API")];
}

/** The part folders the library is built from (same rule as parts/build-library.mjs). */
export function partFolders() {
  return fs.readdirSync(PARTS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && fs.existsSync(path.join(PARTS, e.name, "manifest.json")))
    .map((e) => e.name).sort();
}

/** {sharedHash, parts: {folder: {id, kind, hash}}} computed from the working tree. */
export function computeHashes() {
  const shared = sharedEntries(), sharedHash = hashFiles("shared:", shared), code = codeEntries(), codeHash = hashFiles("code:", code);
  const parts = {};
  for (const f of partFolders()) {
    const m = JSON.parse(fs.readFileSync(path.join(PARTS, f, "manifest.json"), "utf8"));
    const own = hashFiles("part:", walk(path.join(PARTS, f)));
    const isCode = m.behaviour?.type === "wasm";
    parts[f] = { id: m.id, kind: m.behaviour?.type ?? null, hash: sha(`${own}\n${sharedHash}\n${isCode ? codeHash : "-"}`) };
  }
  return { sharedHash, codeHash, parts };
}

/** Is an Emscripten toolchain reachable (em++ on PATH, or DOTBENCH_EMSDK / the default emsdk folder with emsdk_env.sh)? */
export function hasToolchain() {
  if (spawnSync("bash", ["-c", "command -v em++ >/dev/null"]).status === 0) return true;
  const emsdk = process.env.DOTBENCH_EMSDK || "/home/claude/tools/emsdk";
  return fs.existsSync(path.join(emsdk, "emsdk_env.sh"));
}
function emscriptenVersion() {
  const emsdk = process.env.DOTBENCH_EMSDK || "/home/claude/tools/emsdk";
  const pre = spawnSync("bash", ["-c", "command -v em++ >/dev/null"]).status === 0 ? "" : `. '${path.join(emsdk, "emsdk_env.sh")}' >/dev/null 2>&1 || exit 97; `;
  const r = spawnSync("bash", ["-c", pre + "em++ --version | head -1"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Compare the committed library with the working tree. Returns {ok, problems[], stale[], recorded}. */
export function checkPrebuilt(dir = PREBUILT) {
  const problems = [], stale = [];
  const srcFile = path.join(dir, "SOURCES.json"), libFile = path.join(dir, "library.json");
  if (!fs.existsSync(srcFile) || !fs.existsSync(libFile)) return { ok: false, problems: [`${path.relative(ROOT, dir)} has no SOURCES.json / library.json (run: node tools/parts-prebuilt.mjs regen)`], stale, recorded: null };
  const rec = JSON.parse(fs.readFileSync(srcFile, "utf8")), lib = JSON.parse(fs.readFileSync(libFile, "utf8")), now = computeHashes();
  const folders = new Set([...Object.keys(rec.parts), ...Object.keys(now.parts)]);
  for (const f of [...folders].sort()) {
    if (!rec.parts[f]) { stale.push(f); problems.push(`${f}: new part folder, not in the prebuilt library`); continue; }
    if (!now.parts[f]) { stale.push(f); problems.push(`${f}: in the prebuilt library but its folder is gone`); continue; }
    if (rec.parts[f].hash !== now.parts[f].hash) { stale.push(f); problems.push(`${f}: sources changed since the prebuilt library was made`); }
  }
  // the committed files themselves: present, and what SOURCES.json and library.json say they are
  const entries = new Map(lib.parts.map((p) => [p.folder, p]));
  for (const [f, r] of Object.entries(rec.parts)) {
    const e = entries.get(f), file = path.join(dir, r.file);
    if (!e) { problems.push(`${f}: missing from library.json`); continue; }
    if (!fs.existsSync(file)) { problems.push(`${f}: ${r.file} is missing`); continue; }
    const bytes = fs.readFileSync(file), h = sha(bytes);
    if (h !== r.sha256 || h !== e.sha256 || bytes.length !== e.bytes) problems.push(`${f}: ${r.file} does not match its recorded sha-256 (hand-edited or half-committed)`);
  }
  for (const f of entries.keys()) if (!rec.parts[f]) problems.push(`${f}: in library.json but not in SOURCES.json`);
  return { ok: problems.length === 0, problems, stale, recorded: rec };
}

function runLibraryBuild(out) {
  const r = spawnSync(process.execPath, [path.join(PARTS, "build-library.mjs"), "--out", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("parts/build-library.mjs failed");
}

export function regen() {
  if (!hasToolchain()) throw new Error("no Emscripten toolchain (em++ on PATH, or DOTBENCH_EMSDK=<emsdk folder>): regenerating needs it; a clean clone just uses the committed parts/prebuilt");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dotbench-prebuilt-"));
  try {
    runLibraryBuild(tmp);
    const now = computeHashes(), lib = JSON.parse(fs.readFileSync(path.join(tmp, "library.json"), "utf8")), parts = {};
    for (const p of lib.parts) parts[p.folder] = { id: p.id, file: p.file, kind: now.parts[p.folder].kind, hash: now.parts[p.folder].hash, sha256: p.sha256 };
    if (Object.keys(parts).length !== Object.keys(now.parts).length) throw new Error("library.json and the part folders disagree");
    fs.rmSync(PREBUILT, { recursive: true, force: true });
    fs.mkdirSync(PREBUILT, { recursive: true });
    for (const f of fs.readdirSync(tmp)) fs.copyFileSync(path.join(tmp, f), path.join(PREBUILT, f));
    fs.writeFileSync(path.join(PREBUILT, "SOURCES.json"), JSON.stringify({ format: 1, generator: "node tools/parts-prebuilt.mjs regen", emscripten: emscriptenVersion(), sharedHash: now.sharedHash, codeHash: now.codeHash, parts }, null, 1) + "\n");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const c = checkPrebuilt();
  if (!c.ok) throw new Error("the library just written does not pass its own check:\n" + c.problems.join("\n"));
  return Object.keys(c.recorded.parts).length;
}

/** `check --rebuild`: compile again and compare bytes with the committed files. */
export function rebuildMatches() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dotbench-rebuild-")), diff = [];
  try {
    runLibraryBuild(tmp);
    const a = fs.readdirSync(tmp).sort(), b = fs.readdirSync(PREBUILT).filter((f) => f !== "SOURCES.json").sort();
    for (const f of new Set([...a, ...b])) {
      const pa = path.join(tmp, f), pb = path.join(PREBUILT, f);
      if (!fs.existsSync(pa) || !fs.existsSync(pb) || !fs.readFileSync(pa).equals(fs.readFileSync(pb))) diff.push(f);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return diff;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cmd = process.argv[2];
  try {
    if (cmd === "regen") { console.log(`parts-prebuilt: ${regen()} parts -> parts/prebuilt (commit the folder)`); }
    else if (cmd === "check") {
      const c = checkPrebuilt();
      if (!c.ok) { console.error("parts-prebuilt: STALE or damaged:\n  " + c.problems.join("\n  ") + "\nRun on the maker's machine: node tools/parts-prebuilt.mjs regen   (and commit parts/prebuilt)"); process.exit(1); }
      if (process.argv.includes("--rebuild")) {
        const d = rebuildMatches();
        if (d.length) { console.error("parts-prebuilt: a fresh Emscripten build differs from the committed files: " + d.join(", ")); process.exit(1); }
        console.log("parts-prebuilt: a fresh build is byte-identical to the committed library");
      }
      console.log(`parts-prebuilt: up to date (${Object.keys(c.recorded.parts).length} parts; emscripten ${c.recorded.emscripten ?? "?"})`);
    } else if (cmd === "hashes") {
      const h = computeHashes();
      for (const [f, v] of Object.entries(h.parts)) console.log(v.hash.slice(0, 16), v.kind.padEnd(11), f);
    } else { console.error("usage: node tools/parts-prebuilt.mjs regen | check [--rebuild] | hashes"); process.exit(2); }
  } catch (e) { console.error("parts-prebuilt: " + e.message); process.exit(1); }
}
