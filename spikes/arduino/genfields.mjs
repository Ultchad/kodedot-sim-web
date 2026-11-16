#!/usr/bin/env node
// Throwaway version of what `dotbench part build` does: manifest.json -> dotbench_fields.h
// usage: node genfields.mjs manifest.json > dotbench_fields.h
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const up = (s) => s.toUpperCase();
const nums = (m.fields ?? []).filter(f => ['number', 'integer', 'boolean', 'enum'].includes(f.type));
let o = '// GENERATED from manifest.json. Do not edit.\n#pragma once\n';
o += 'enum { ' + nums.map((f, i) => `FIELD_${up(f.name)} = ${i}`).join(', ') + ' };\n';
o += 'enum { ' + (m.outputs ?? []).map((f, i) => `OUTPUT_${up(f.name)} = ${i}`).join(', ') + ' };\n';
process.stdout.write(o);
