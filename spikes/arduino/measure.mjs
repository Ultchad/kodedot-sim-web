// Latency / cost numbers for the Atomics.wait Worker design.
import { Bench } from './host/bench.mjs';
const W = (n) => new URL(`./build/${n}.wasm`, import.meta.url).pathname;
const rss = () => process.memoryUsage().rss / 1048576;
{
  const b = new Bench('stepped'); const r0 = rss(); const t0 = performance.now();
  const c = b.spawn('i2c', W('i2c_slave')); await b.blocked(c);
  console.log(`spawn -> setup() done and parked: ${(performance.now() - t0).toFixed(1)} ms (first worker, includes Node worker start)`);
  const N = 2000, t1 = performance.now();
  for (let i = 0; i < N; i++) await b.i2c(c, 0x42, [i & 3], 4);
  const dt = performance.now() - t1;
  console.log(`I2C write_read round trip via mailbox: ${(dt / N * 1000).toFixed(0)} us each (${N} transactions, ${dt.toFixed(0)} ms)`);
  b.stop();
}
{
  const b = new Bench('stepped'); const r0 = rss(); const t0 = performance.now();
  const cs = []; for (let i = 0; i < 8; i++) cs.push(b.spawn('blink' + i, W('blink')));
  await Promise.all(cs.map(c => b.blocked(c)));
  console.log(`8 workers up and parked: ${(performance.now() - t0).toFixed(0)} ms, RSS +${(rss() - r0).toFixed(0)} MB (Node, includes one V8 isolate per worker)`);
  await b.stepUntil(10_000_000n);
  console.log(`8 blinkers, 10 virtual s stepped: ${b.comps.map(c => b.drain(c).length).join(',')} events each`);
  b.stop();
}
