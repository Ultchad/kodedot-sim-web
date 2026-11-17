// Pieces of `part build` that are pure functions, copied here so the browser can use them (build.mjs imports node:child_process at top level).
// Production: move them into a shared module that both build.mjs and the page import.
/** generated header: FIELD_<NAME> and OUTPUT_<NAME> indexes, in manifest order. (copy of tools/dblib/part/build.mjs fieldsHeader) */
export function fieldsHeader(m) {
  const nums = (m.fields ?? []).filter((f) => ["number", "integer", "boolean", "enum"].includes(f.type));
  const id = (s) => s.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  let o = "// GENERATED from manifest.json by `dotbench part build`. Do not edit.\n#pragma once\n";
  o += nums.length ? "enum { " + nums.map((f, i) => `FIELD_${id(f.name)} = ${i}`).join(", ") + " };\n" : "";
  o += (m.outputs ?? []).length ? "enum { " + m.outputs.map((f, i) => `OUTPUT_${id(f.name)} = ${i}`).join(", ") + " };\n" : "";
  return o;
}
