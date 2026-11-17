#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Writes the generated built-in parts (manifest.json, picture.svg, tests) into parts/<dir>/. usage: node parts/gen/gen-parts.mjs
import { passive } from "./passive.mjs";
const all = [...passive()];
console.log(`generated ${all.length} parts: ${all.map((m) => m.id.replace("dotbench.", "")).join(", ")}`);
