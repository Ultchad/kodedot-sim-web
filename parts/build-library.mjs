#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Build every part folder in this directory into dist/<id>.dotpart with `dotbench part build --builtin`, then write dist/library.json
// (the index the page loads). usage: node parts/build-library.mjs [--test]   (--test also runs each part's scenarios)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), cli = path.join(here, "../tools/dblib/part/cli.mjs"), dist = path.join(here, "dist");
fs.mkdirSync(dist, { recursive: true });
const index = [];
for (const d of fs.readdirSync(here, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "dist" && fs.existsSync(path.join(here, e.name, "manifest.json"))).map((e) => e.name).sort()) {
  const dir = path.join(here, d), m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), out = path.join(dist, m.id + ".dotpart");
  const run = (args) => { const r = spawnSync("node", [cli, ...args], { encoding: "utf8" }); if (r.status !== 0) { console.error(`${d}: ${args[0]} failed\n${r.stdout}${r.stderr}`); process.exit(1); } return r.stdout; };
  run(["build", dir, "--builtin", "-o", out]);
  if (process.argv.includes("--test")) console.log(run(["test", out === "" ? dir : dir, "--builtin"]).trim().split("\n").pop() + "  " + d);
  const bytes = fs.readFileSync(out);
  index.push({ id: m.id, version: m.version, file: path.basename(out), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), name: m.name, category: m.category, kind: m.behaviour.type, tags: m.tags ?? [], folder: d });
}
fs.writeFileSync(path.join(dist, "library.json"), JSON.stringify({ format: "dotbench-library", version: 1, parts: index }, null, 2) + "\n");
console.log(`built ${index.length} parts into ${path.relative(process.cwd(), dist)}`);
