// Developer measurement (not a test): CPU cost of idle, playing and recording, as % of one core. Used for docs/STATUS-audio.md.
import { bootAudio, sleep } from "./bench.mjs";
const a = await bootAudio("audio_api");
const m = async (f) => { const c0 = process.cpuUsage(), t0 = Date.now(); await f(); const c = process.cpuUsage(c0); return ((c.user + c.system) / 1000) / (Date.now() - t0) * 100; };
await sleep(1000);
const idle = await m(() => sleep(5000));
const play = await m(() => a.cmd("tone", "1000;5000"));
const rec = await m(() => a.cmd("recsamples", "5000"));
console.log(`CPU idle ${idle.toFixed(1)} % playing ${play.toFixed(1)} % recording ${rec.toFixed(1)} % of one core`);
a.shutdown(); process.exit(0);
