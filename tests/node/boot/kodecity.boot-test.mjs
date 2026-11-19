// KodeCity (kodediy/kode-app-kodecity, a software-rendered 3D city) inside kodeOS: it is in the factory list, launches by touch,
// draws frames for several seconds (the picture is not black, changes while the D-pad is pressed, and its frame counter keeps
// running at a playable rate), and the bottom-button hold returns to kodeOS.
//   screenshots: BOOT_SHOTS=dir (default docs/boot-shots): kodecity-1.png (first frame), -2.png (after driving), -3.png (turned)
import assert from "node:assert/strict";
import path from "node:path";
import { makeSystem, tmpDir, sleep, shot, swipeLeft, tap, waitFor, root, fullFactoryJson } from "./lib.mjs";

const shots = process.env.BOOT_SHOTS || path.join(root, "docs/boot-shots");
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};

const sys = makeSystem(tmpDir(), { factory: fullFactoryJson });
const log = () => sys.logText();
const lit = () => { const f = sys.frame(); let n = 0; for (let i = 0; i < f.data.length; i += 4) if (f.data[i] | f.data[i + 1] | f.data[i + 2]) n++; return n / (f.data.length / 4); };
const sum = () => { const f = sys.frame(); let h = 0; for (let i = 0; i < f.data.length; i += 4) h = (h * 31 + f.data[i] + 3 * f.data[i + 1] + 7 * f.data[i + 2]) | 0; return h; };
const pause = async (id, ms) => { sys.button(id, true); await sleep(ms); sys.button(id, false); };

// KodeCity is second in the "All" list (after Kody Kart): the rows are at y 125, 237, 350 before any swipe
await check("KodeCity is in the factory list and launches from kodeOS by touch", async () => {
  await sys.start();
  await waitFor(() => /kgui first frame/.test(log()) && sys.program?.kind === "os", 120000, "kodeOS first frame", sys);
  await waitFor(() => /'buttons_led' copied to/.test(log()), 60000, "AppMgr finished its copies", sys);
  const l = sys.list();
  assert.equal(l[1].project, "kodecity");
  assert.equal(l[1].name, "KodeCity");
  await sleep(5500);
  await swipeLeft(sys); await sleep(5000);
  await tap(sys, 200, 72); await sleep(2500);       // "All"
  await tap(sys, 200, 237);                           // row 2
  await waitFor(() => sys.program?.kind === "app", 60000, "KodeCity starts", sys);
  assert.equal(sys.program.name, "KodeCity");
});

await check("it draws frames for several seconds at a playable rate, and driving changes the picture", async () => {
  await waitFor(() => lit() > 0.05, 60000, "KodeCity draws its first screen", sys);
  await sleep(1500);
  shot(sys, path.join(shots, "kodecity-1.png"));
  // the title screen: top button starts the game (kodecity_main / game.c)
  await pause("top", 150);
  await sleep(4000);
  const a = sum();
  const s0 = sys.frameSeq, t0 = Date.now();
  await pause("up", 3000);
  const b = sum();
  shot(sys, path.join(shots, "kodecity-2.png"));
  await pause("right", 1500);
  shot(sys, path.join(shots, "kodecity-3.png"));
  const c = sum();
  await sleep(2000);
  // CPU the whole simulator (every worker) burns over 10 s of play, as a share of one core
  await pause("up", 0);
  const c0 = process.cpuUsage(), w0 = Date.now();
  sys.button("up", true); await sleep(10000); sys.button("up", false);
  const cu = process.cpuUsage(c0), cpu = (cu.user + cu.system) / 1000 / (Date.now() - w0);
  console.log(`     CPU over 10 s of driving: ${(cpu * 100).toFixed(0)} % of one core`);
  const logEnd = log();
  const dt = (Date.now() - t0) / 1000, fps = (sys.frameSeq - s0) / dt;
  // the game's own readouts (its console variables): frames the game renders a second, and its work per frame
  const asked = async (name) => { sys.clearLog(); sys.sendConsole(`variable name="${name}"`); let v = NaN; await waitFor(() => { const m = log().match(new RegExp(`variable="${name}" value=([0-9.]+)`)); if (m) v = Number(m[1]); return m; }, 5000, "variable " + name, sys); return v; };
  const gameFps = await asked("fps"), frameMs = await asked("frame_ms");
  console.log(`     haptic "ran dry" lines in the log: ${(logEnd.match(/ran dry/g) || []).length}`);
  console.log(`     presented to the glass: ${sys.frameSeq - s0} frames in ${dt.toFixed(1)} s = ${fps.toFixed(1)} fps; the game renders ${gameFps} fps, ${frameMs} ms of work per frame`);
  assert.ok(lit() > 0.2, "the city is on the glass: " + lit());
  assert.notEqual(a, b, "the picture moved after the D-pad up");
  assert.notEqual(b, c, "the picture changed again after the D-pad right");
  assert.ok(fps >= 15, "frames keep coming to the glass: " + fps.toFixed(1) + " fps");
  assert.ok(gameFps >= 15, "the game renders at a playable rate: " + gameFps + " fps");
  const mine = logEnd.slice(logEnd.indexOf("kode kodecity"));
  assert.ok(!/not implemented|PPA|refused|compose/i.test(mine), "the pixel accelerator path ran clean:\n" + mine.slice(-1500));
});

await check("the bottom-button hold goes back to kodeOS", async () => {
  const t0 = Date.now();
  sys.button("bottom", true);
  await waitFor(() => sys.program?.kind === "os", 30000, "back in kodeOS", sys);
  sys.button("bottom", false);
  console.log(`     back in kodeOS ${Date.now() - t0} ms after the press`);
});

sys.dispose?.();
process.exit(failed ? 1 : 0);
