#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Writes the generated built-in parts (manifest.json, picture.svg, tests) into parts/<dir>/. usage: node parts/gen/gen-parts.mjs
import { passive } from "./passive.mjs";
import { actuators } from "./actuators.mjs";
import { boards } from "./boards.mjs";
import { legacy } from "./legacy.mjs";
const all = [...passive(), ...actuators(), ...boards()];
console.log(`generated ${all.length} parts: ${all.map((m) => m.id.replace("dotbench.", "")).join(", ")}`);
console.log(`added body, terminal millimetres and keywords to ${legacy().length} hand-written parts`);
