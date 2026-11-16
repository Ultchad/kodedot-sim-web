#!/usr/bin/env node
// Throwaway `dotbench part test`: build a part folder (manifest.json + src/*.ino) and run tests/*.test.json against it.
// usage: node run_scenario.mjs ../../templates/component-starter
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { Bench } from './host/bench.mjs';
const dir = path.resolve(process.argv[2]), here = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const gen = path.join(here, 'build/gen'); fs.mkdirSync(gen, { recursive: true });
fs.writeFileSync(path.join(gen, 'dotbench_fields.h'), execFileSync('node', [path.join(here, 'genfields.mjs'), path.join(dir, 'manifest.json')]));
const wasm = path.join(here, 'build', manifest.id + '.wasm');
execFileSync(path.join(here, 'build.sh'), [path.join(dir, 'src/main.ino'), wasm], { env: { ...process.env, EXTRA_INC: gen }, stdio: ['ignore', 'inherit', 'inherit'] });
const numFields = (manifest.fields ?? []).filter(f => ['number', 'integer', 'boolean', 'enum'].includes(f.type));
const fieldIdx = Object.fromEntries(numFields.map((f, i) => [f.name, i]));
const outIdx = Object.fromEntries((manifest.outputs ?? []).map((o, i) => [o.name, i]));
const b = new Bench('stepped'); const c = b.spawn(manifest.id, wasm);
for (const f of numFields) b.setField(c, fieldIdx[f.name], typeof f.default === 'boolean' ? +f.default : f.default);
let serial = '', outputs = {}, n = 0;
const pump = () => { const ev = b.drain(c); serial += b.serialText(ev); for (const o of b.outputs(ev)) outputs[o.idx] = o.v; };
for (const file of fs.readdirSync(path.join(dir, 'tests')).filter(f => f.endsWith('.test.json'))) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tests', file), 'utf8'));
  console.log(`== ${t.name}`);
  for (const s of t.steps) {
    n++;
    if (s.advance_ms !== undefined) { await b.stepUntil(b.now() + BigInt(s.advance_ms) * 1000n); pump(); }
    else if (s.set_field) for (const [k, v] of Object.entries(s.set_field)) b.setField(c, fieldIdx[k], v);
    else if (s.expect_serial !== undefined) { pump(); assert.ok(serial.includes(s.expect_serial), `serial lacks "${s.expect_serial}"; got ${JSON.stringify(serial)}`); }
    else if (s.i2c) {
      await b.blocked(c);
      const r = await b.i2c(c, s.i2c.addr, s.i2c.write ?? [], s.i2c.read ?? 0); pump();
      if (s.i2c.expect_nack) assert.equal(r.ack, false, 'expected NACK'); else assert.ok(r.ack, 'expected ACK');
      if (s.i2c.expect) assert.deepEqual(r.data, s.i2c.expect);
    } else if (s.expect_output) { pump(); assert.equal(outputs[outIdx[s.expect_output.name]], s.expect_output.value); }
    console.log(`  ok step ${n}: ${s.comment ?? JSON.stringify(s).slice(0, 90)}`);
  }
}
console.log('all scenario steps passed'); b.stop();
