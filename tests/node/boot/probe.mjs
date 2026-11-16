// Developer probe: boot a system, run actions, save PNGs, print the log.   PROBE_ACTIONS="wait:4000,swipe,tap:200:300,shot:/tmp/a.png,btn:bottom:1,btn:bottom:0,log"
import { makeSystem, tmpDir, sleep, shot, swipeLeft, tap, waitFor } from "./lib.mjs";
const dir = process.env.PROBE_DIR || tmpDir();
const sys = makeSystem(dir);
await sys.start();
await waitFor(() => sys.logText().includes("kgui first frame"), 90000, "first frame", sys);
for (const a of (process.env.PROBE_ACTIONS || "wait:3000,shot:/tmp/p0.png").split(",")) {
  const [k, ...v] = a.split(":");
  if (k === "wait") await sleep(+v[0]);
  else if (k === "swipe") await swipeLeft(sys);
  else if (k === "tap") await tap(sys, +v[0], +v[1], +(v[2] ?? 120));
  else if (k === "shot") shot(sys, v[0]);
  else if (k === "btn") sys.button(v[0], v[1] === "1");
  else if (k === "list") console.log(JSON.stringify(sys.list()));
  else if (k === "log") console.log(sys.logText().split("\n").slice(-(+v[0] || 40)).join("\n"));
  else if (k === "prog") console.log(JSON.stringify(sys.program), sys.status);
}
console.log("dir", dir);
sys.stop(); process.exit(0);
