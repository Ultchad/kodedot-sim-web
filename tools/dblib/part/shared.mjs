// SPDX-License-Identifier: GPL-3.0-or-later
// The pure half of `dotbench part build`: what is the same whether the sketch is compiled by Emscripten on a developer's machine or by the
// in-browser compiler (runtime/cc). No node: imports, so the browser bundle can import this file. build.mjs and runtime/cc both use it:
//   sketchToCpp (ino2cpp.mjs)   .ino files -> one C++ file with prototypes and #line
//   fieldsHeader                manifest -> the generated FIELD_ / OUTPUT_ index header
//   packageEntries              the files of the .dotpart, in order, with the binary's hash written into the manifest
export { inoToCpp, sketchToCpp } from "./ino2cpp.mjs";
export { writeZipWith } from "./zipcore.mjs";

/** generated header: FIELD_<NAME> and OUTPUT_<NAME> indexes, in manifest order. */
export function fieldsHeader(m) {
  const nums = (m.fields ?? []).filter((f) => ["number", "integer", "boolean", "enum"].includes(f.type));
  const id = (s) => s.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  let o = "// GENERATED from manifest.json by `dotbench part build`. Do not edit.\n#pragma once\n";
  o += nums.length ? "enum { " + nums.map((f, i) => `FIELD_${id(f.name)} = ${i}`).join(", ") + " };\n" : "";
  o += (m.outputs ?? []).length ? "enum { " + m.outputs.map((f, i) => `OUTPUT_${id(f.name)} = ${i}`).join(", ") + " };\n" : "";
  return o;
}

/**
 * The files of the package: [name, bytes][]. `read(name)` returns a file of the part's folder (or the browser's board bundle) or null.
 * The manifest is rewritten: no $schema, and behaviour.wasm_sha256 set from `wasmSha256`.
 * @param {object} m manifest  @param {Uint8Array|null} wasm  @param {string|null} wasmSha256  @param {(name: string) => Uint8Array|null} read
 */
export function packageEntries(m, wasm, wasmSha256, read) {
  const files = [], seen = new Set(), enc = new TextEncoder();
  const add = (name, bytes) => { if (!seen.has(name)) { seen.add(name); files.push([name, bytes]); } };
  const manifest = JSON.parse(JSON.stringify(m)); delete manifest.$schema;
  if (wasm) manifest.behaviour.wasm_sha256 = wasmSha256;
  add("manifest.json", enc.encode(JSON.stringify(manifest, null, 2) + "\n"));
  if (m.picture?.file) { const p = read(m.picture.file); if (!p) throw new Error(`picture ${m.picture.file} not found`); add(m.picture.file, p); }
  if (wasm) add(m.behaviour.entry, wasm);
  if (m.behaviour.type === "wasm") for (const s of m.behaviour.sources ?? []) { const p = read(s); if (p) add(s, p); }
  for (const n of ["LICENSE", "LICENSE.txt", "LICENSE.md", "NOTICE"]) { const p = read(n); if (p) add(n, p); }
  return files;
}
