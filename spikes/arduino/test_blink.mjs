import { Bench } from './host/bench.mjs';
import { K } from './host/layout.mjs';
import assert from 'node:assert/strict';
const WASM = new URL('./build/blink.wasm', import.meta.url).pathname;

// ---- 1) stepped (deterministic) virtual time: 6 virtual seconds, run as fast as possible ----
{
  const b = new Bench('stepped'); const c = b.spawn('blink', WASM);
  const wall0 = performance.now();
  await b.stepUntil(6_000_000n);
  const wall = performance.now() - wall0;
  const ev = b.drain(c);
  const writes = ev.filter(e => e.kind === K.PIN_WRITE && e.a === 2);
  console.log('stepped: events', ev.map(e => `${e.kind === K.PIN_MODE ? 'MODE' : 'WRITE'}(pin${e.a},${e.b})@${e.t}us`).join(' '));
  assert.ok(ev.some(e => e.kind === K.PIN_MODE && e.a === 2 && e.b === 1), 'pinMode(2, OUTPUT) seen');
  assert.deepEqual(writes.map(e => e.b), [1, 0, 1, 0, 1, 0, 1].slice(0, writes.length));
  assert.ok(writes.length >= 6);
  for (let i = 1; i < writes.length; i++) assert.equal(writes[i].t - writes[i - 1].t, 1_000_000n, 'period exactly 1 s virtual');
  assert.equal(writes[0].t, 0n);
  console.log(`stepped OK: ${writes.length} edges, every interval exactly 1000000 us; 6 virtual s ran in ${wall.toFixed(0)} ms wall`);
  b.stop();
}

// ---- 2) realtime clock: same wasm, no stepping, measure what a real tab would see ----
{
  const b = new Bench('realtime'); const c = b.spawn('blink', WASM);
  await new Promise(r => setTimeout(r, 6200));
  const writes = b.drain(c).filter(e => e.kind === K.PIN_WRITE && e.a === 2);
  const iv = []; for (let i = 1; i < writes.length; i++) iv.push(Number(writes[i].t - writes[i - 1].t));
  const err = iv.map(x => x - 1_000_000);
  console.log(`realtime: ${writes.length} edges, intervals(us)=${iv.join(',')}`);
  console.log(`realtime: interval error us min=${Math.min(...err)} max=${Math.max(...err)}`);
  assert.ok(writes.length >= 5);
  for (const e of err) assert.ok(Math.abs(e) < 5000, `interval within 5 ms of 1 s (got ${e} us)`);
  console.log('realtime OK (all intervals within 5 ms of 1 s)');
  b.stop();
}
