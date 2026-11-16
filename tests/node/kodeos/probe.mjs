// Developer probe (not a test): boot the kodeOS package, print the log, save the framebuffer.
//   node tests/node/kodeos/probe.mjs [seconds] [out.png] [pkg]
import { boot, OFF, sleep } from "../harness.mjs";
import { savePng } from "./png.mjs";
import path from "node:path";

const secs = Number(process.argv[2] || 10);
const out = process.argv[3];
const pkg = process.argv[4] || path.join(process.env.DOTBENCH_BUILD || "build", "apps/kodeos/kodeos.dotbench");
const a = await boot(pkg);
let shown = 0;
// PROBE_ACTIONS="wait:3000,btn:4:1,wait:150,btn:4:0,wait:2000,shot:/tmp/a.png,touch:200:400:1,touch:200:100:0"
const t0 = Date.now();
const acts = (process.env.PROBE_ACTIONS || "").split(",").filter(Boolean);
(async () => {
  for (const act of acts) {
    const [k, ...v] = act.split(":");
    if (k === "wait") await sleep(Number(v[0]));
    else if (k === "btn") a.button(Number(v[0]), Number(v[1]));
    else if (k === "touch") a.touch(Number(v[0]), Number(v[1]), Number(v[2]));
    else if (k === "shot") savePng(v.join(":"), a.framebuffer(), a.u32(OFF.fbW), a.u32(OFF.fbH), a.u32(OFF.fbStride));
    console.log("[probe] " + act);
  }
})();
while (Date.now() - t0 < secs * 1000) {
  await sleep(250);
  const t = a.logText();
  if (t.length > shown) { process.stdout.write(t.slice(shown)); shown = t.length; }
  for (const l of a.logs.splice(0)) console.log(l);
}
console.log("-- threads running:", Object.keys(a.M.PThread.pthreads).length, "idle in pool:", a.M.PThread.unusedWorkers.length, "wasm mem MB:", a.M.HEAPU8.length >> 20, "workers (total):", a.workers(), "frameSeq:", a.frameSeq(), "panelOn:", a.u32(OFF.panelOn), "restart:", a.restartRequested());
if (out) { savePng(out, a.framebuffer(), a.u32(OFF.fbW), a.u32(OFF.fbH), a.u32(OFF.fbStride)); console.log("saved", out); }
a.shutdown();
process.exit(0);
