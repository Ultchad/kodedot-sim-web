// A sketch that never yields: the bench must notice (heartbeat frozen) and be able to kill it.
import { Bench } from './host/bench.mjs';
import { MB } from './host/layout.mjs';
const b = new Bench('realtime'); const c = b.spawn('busy', new URL('./build/busy.wasm', import.meta.url).pathname);
await new Promise(r => setTimeout(r, 300));
const h1 = Atomics.load(c.mb, MB.HEARTBEAT); await new Promise(r => setTimeout(r, 300)); const h2 = Atomics.load(c.mb, MB.HEARTBEAT);
console.log(`heartbeat ${h1} -> ${h2} (frozen: ${h1 === h2}); main thread stayed responsive`);
const t = performance.now(); const code = await c.worker.terminate();
console.log(`terminate() returned after ${(performance.now() - t).toFixed(1)} ms`);
