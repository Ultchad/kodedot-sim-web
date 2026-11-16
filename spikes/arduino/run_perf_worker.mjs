// Same perf.wasm in the Atomics.wait Worker (realtime clock) for comparison with asyncify/probe.mjs
import { Bench } from './host/bench.mjs';
const b = new Bench('realtime'); const c = b.spawn('perf', new URL('./build/perf.wasm', import.meta.url).pathname);
await new Promise(r => setTimeout(r, 3000));
console.log('worker    :', b.serialText(b.drain(c)).trim().split('\n').pop()); b.stop();
