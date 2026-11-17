#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// dotbench part new | check | build | test | inspect   (called by tools/dotbench; runs on plain Node 20+, no packages)
import fs from "node:fs";
import path from "node:path";
import { ROOT, compileWasm, checkWasm, packageFiles, zipPackage } from "./build.mjs";
import { validateManifest, readDotpart, describeDotpart, checkSvg } from "../../../runtime/web-adapter/dotpart.js";
import { PartTester, runScenario } from "../../../runtime/web-adapter/part-tester.js";

const TEMPLATE = path.join(ROOT, "templates/component-starter");
const dec = new TextDecoder();
const usage = `usage: dotbench part <command>
  new <dir> [--id com.you.name] [--declarative]   copy the starter into <dir> (a code part; --declarative: the no-code LM75 example)
  check <dir|file.dotpart>                        manifest, picture, references, translations (errors exit 1)
  build <dir> [-o out.dotpart] [--builtin]        compile the sketch (code parts) and write <id>-<version>.dotpart
  test <dir|file.dotpart>                         build, then run tests/*.test.json headless in virtual time
  inspect <file.dotpart> [--json]                 what the import dialog shows
Environment: DOTBENCH_EMSDK (Emscripten SDK), DOTBENCH_ARDUINO_API (ArduinoCore-API checkout), DOTBENCH_CACHE (compiled-core cache).`;

function die(msg, code = 1) { console.error(msg); process.exit(code); }
function parseArgs(argv) { const pos = [], opt = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const k = a.slice(2); if (["id", "o"].includes(k)) opt[k] = argv[++i]; else opt[k] = true; } else if (a === "-o") opt.o = argv[++i]; else pos.push(a); } return { pos, opt }; }
const fmt = (list, kind) => list.map((x) => `  ${kind} ${x.path || "/"}: ${x.message}`).join("\n");

function readFolder(dir) {
  const mp = path.join(dir, "manifest.json");
  if (!fs.existsSync(mp)) die(`${dir} has no manifest.json`);
  let m;
  try { m = JSON.parse(fs.readFileSync(mp, "utf8")); } catch (e) { die(`manifest.json is not valid JSON: ${e.message}`); }
  const files = new Map();
  const add = (rel) => { const p = path.join(dir, rel); if (fs.existsSync(p) && fs.statSync(p).isFile()) files.set(rel, new Uint8Array(fs.readFileSync(p))); };
  if (m.picture?.file) add(m.picture.file);
  for (const s of m.behaviour?.sources ?? []) add(s);
  if (m.behaviour?.type === "wasm" && m.behaviour.entry) files.set(m.behaviour.entry, new Uint8Array(0));   // produced by `build`
  return { m, files };
}

function checkFolder(dir) {
  const { m, files } = readFolder(dir);
  const { errors, warnings } = validateManifest(m, files);
  const pic = m.picture?.file && files.get(m.picture.file);
  if (pic && m.picture.file.endsWith(".svg")) for (const why of checkSvg(dec.decode(pic))) errors.push({ path: "/picture/file", message: "picture " + why });
  if (pic && pic.length > (1 << 20)) errors.push({ path: "/picture/file", message: "picture is over 1 MB" });
  if (m.behaviour?.type === "wasm") {
    for (const s of m.behaviour.sources ?? []) if (!files.has(s)) errors.push({ path: "/behaviour/sources", message: `${s} does not exist` });
    if (!(m.behaviour.sources ?? []).length) warnings.push({ path: "/behaviour/sources", message: "no sources listed: the build would have nothing to compile" });
  }
  const td = path.join(dir, "tests");
  if (fs.existsSync(td)) for (const f of fs.readdirSync(td).filter((x) => x.endsWith(".test.json"))) { try { const t = JSON.parse(fs.readFileSync(path.join(td, f), "utf8")); if (!Array.isArray(t.steps)) errors.push({ path: "tests/" + f, message: "no steps array" }); } catch (e) { errors.push({ path: "tests/" + f, message: "not valid JSON: " + e.message }); } }
  else warnings.push({ path: "tests", message: "no tests/ folder: add a tests/*.test.json so changes can be checked" });
  return { m, errors, warnings };
}

async function buildFolder(dir, opt, quiet = false) {
  const { m, errors, warnings } = checkFolder(dir);
  if (errors.length) die(`${dir}: manifest has errors:\n${fmt(errors, "error")}`);
  let wasm = null;
  if (m.behaviour.type === "wasm") {
    if (!quiet) console.log("compiling " + (m.behaviour.sources ?? []).join(", "));
    try { ({ wasm } = compileWasm(dir, m, (s) => !quiet && console.log(s))); } catch (e) { die(String(e.message || e)); }
    const bad = await checkWasm(wasm);
    if (bad.length) die("the compiled module breaks the part ABI (a library may need something dotcore does not provide):\n" + bad.map((x) => "  " + x).join("\n"));
  }
  const bytes = zipPackage(packageFiles(dir, m, wasm));
  const out = opt.o ?? path.join(dir, `${m.id}-${m.version}.dotpart`);
  fs.writeFileSync(out, bytes);
  const def = await readDotpart(bytes);
  if (!def.ok) die("the package does not pass the importer:\n" + fmt(def.errors, "error"));
  if (!quiet) { console.log(`wrote ${out} (${bytes.length} bytes${wasm ? `, wasm ${wasm.length}` : ""})`); if (warnings.length) console.log(fmt(warnings, "warning")); }
  return { out, def, warnings };
}

async function cmdNew(pos, opt) {
  const dir = pos[0]; if (!dir) die(usage);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) die(`${dir} exists and is not empty`);
  fs.mkdirSync(dir, { recursive: true });
  const skip = new Set(["build", "node_modules"]);
  const copy = (a, b) => { for (const e of fs.readdirSync(a, { withFileTypes: true })) { if (skip.has(e.name)) continue; const x = path.join(a, e.name), y = path.join(b, e.name); if (e.isDirectory()) { fs.mkdirSync(y, { recursive: true }); copy(x, y); } else fs.copyFileSync(x, y); } };
  copy(TEMPLATE, dir);
  const mp = path.join(dir, "manifest.json"), m = JSON.parse(fs.readFileSync(mp, "utf8"));
  const slug = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-part";
  m.id = opt.id ?? `com.example.${slug}`;
  if (opt.declarative) {
    const ex = JSON.parse(fs.readFileSync(path.join(dir, "examples/lm75-declarative.manifest.json"), "utf8"));
    ex.id = m.id; ex.picture = m.picture;
    fs.copyFileSync(path.join(dir, "examples/picture-lm75.svg"), path.join(dir, ex.picture.file ?? "picture.svg"));
    fs.writeFileSync(mp, JSON.stringify(ex, null, 2) + "\n");
    fs.rmSync(path.join(dir, "src"), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, "tests/sensor.test.json"), JSON.stringify({ name: "LM75-style sensor (no code)", steps: [
      { comment: "register 0 holds the temperature (default 25 C), 1/256 degree per count", i2c: { addr: 72, write: [0], read: 2, expect: [25, 0] } },
      { set_field: { temperature: -10.25 } },
      { i2c: { addr: 72, write: [0], read: 2, expect: [245, 192] } },
      { comment: "nothing answers at another address", i2c: { addr: 73, write: [0], read: 2, expect_nack: true } } ] }, null, 2) + "\n");
  } else fs.writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");
  console.log(`created ${dir} (id ${m.id}). Next: cd ${dir} && dotbench part check . && dotbench part test .`);
}

async function cmdCheck(pos) {
  const target = pos[0] ?? "."; let errors, warnings, name;
  if (target.endsWith(".dotpart")) {
    const def = await readDotpart(new Uint8Array(fs.readFileSync(target)));
    errors = def.errors; warnings = def.warnings; name = def.manifest.id;
  } else ({ errors, warnings, m: { id: name } } = checkFolder(target));
  if (warnings.length) console.log(fmt(warnings, "warning"));
  if (errors.length) { console.log(fmt(errors, "error")); console.log(`${name}: ${errors.length} error(s)`); process.exit(1); }
  console.log(`${name}: ok${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
}

async function cmdTest(pos, opt) {
  const target = pos[0] ?? ".";
  let def, dir;
  if (target.endsWith(".dotpart")) { def = await readDotpart(new Uint8Array(fs.readFileSync(target))); dir = path.dirname(path.resolve(target)); }
  else { dir = target; ({ def } = await buildFolder(dir, {}, true)); }
  if (!def.ok) die(fmt(def.errors, "error"));
  const td = path.join(dir, "tests");
  const files = fs.existsSync(td) ? fs.readdirSync(td).filter((f) => f.endsWith(".test.json")).sort() : [];
  if (!files.length) die(`no tests in ${td}`);
  let steps = 0, failed = 0;
  for (const f of files) {
    const t = JSON.parse(fs.readFileSync(path.join(td, f), "utf8"));
    console.log(`== ${t.name ?? f}`);
    const tester = await PartTester.create(def);
    const log = [];
    try { await runScenario(tester, t, log); steps += log.length; for (const l of log) console.log("  " + l); }
    catch (e) { failed++; for (const l of log) console.log("  " + l); console.error("  FAIL " + e.message); }
    finally { tester.dispose(); }
  }
  if (failed) { console.error(`${failed} scenario(s) failed`); process.exit(1); }
  console.log(`all ${steps} steps passed in ${files.length} scenario(s)`);
  process.exit(0);          // a wasm part's Worker is gone by now, but do not wait for stray handles
}

async function cmdInspect(pos, opt) {
  if (!pos[0]) die(usage);
  const def = await readDotpart(new Uint8Array(fs.readFileSync(pos[0])));
  const d = describeDotpart(def);
  if (opt.json) { console.log(JSON.stringify(d, null, 2)); return; }
  console.log(`${d.names.en}  (${d.id} ${d.version})  by ${d.author?.name ?? "?"}  licence ${d.license}  ${d.size} bytes  sha256 ${d.sha256.slice(0, 16)}...`);
  console.log(`runs: ${d.runs.kind === "code" ? `your code in a sandbox (wasm ${d.runs.wasmBytes} bytes, ${d.runs.memoryKb} KB memory${d.runs.sources ? ", sources included" : ""})` : `${d.runs.elements} declarative element(s), no code`}`);
  console.log("pins: " + d.pins.map((p) => `${p.name}(${p.kind})`).join(" "));
  console.log(`buses: ${d.buses.join(", ") || "none"}   wireless: ${d.wireless.map((w) => w.medium).join(", ") || "none"}   fields: ${d.fields}`);
  console.log("cannot: " + d.cannot.join("; "));
  for (const e of d.errors) console.log("error " + e.path + ": " + e.message);
  for (const e of d.warnings) console.log("warning " + e.path + ": " + e.message);
}

const [cmd, ...rest] = process.argv.slice(2), { pos, opt } = parseArgs(rest);
const table = { new: cmdNew, check: cmdCheck, build: async (p, o) => { await buildFolder(p[0] ?? ".", o); process.exit(0); }, test: cmdTest, inspect: cmdInspect };
if (!table[cmd]) { console.log(usage); process.exit(cmd ? 2 : 0); }
try { await table[cmd](pos, opt); } catch (e) { console.error(String(e.stack || e)); process.exit(1); }
