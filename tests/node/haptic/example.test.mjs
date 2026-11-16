// The UNMODIFIED examples/haptic: the bottom button buzzes (400 ms at gain 80), the top ticks.
// Asserts on the log, the bridge level + sequence, and the start/stop events.
import assert from "node:assert/strict";
import { boot, pkgPath, BTN, OFF, sleep } from "../harness.mjs";
import { makeCheck, finish, loadGlue } from "./lib.mjs";

const a = await boot(pkgPath("haptic"));
const g = await loadGlue(a, "haptic");
const H = g.api;
const { check, st } = makeCheck();
const log = () => a.logText();
await a.waitFor(() => /haptic/.test(log()) && !/no AW86233/.test(log()), 15000, "boot");
const levels = [];
const pump = setInterval(() => { g.tick(); levels.push(H.level()); }, 10);
const press = async (b) => { a.button(b, true); await sleep(80); a.button(b, false); };

await check("chip is found (no 'no AW86233' warning) and idle at 0", () => {
  assert.doesNotMatch(log(), /no AW86233/);
  assert.equal(H.level(), 0);
  assert.equal(H.playing(), false);
});
await check("bottom button: a 400 ms buzz is logged, the bridge level goes up then back to 0", async () => {
  const seq0 = a.u32(OFF.hapticSeq ?? 0x5c);
  await press(BTN.BOT);
  await a.waitFor(() => /buzz over: \d+ samples/.test(log()), 8000, "buzz over line");
  assert.match(log(), /buzz: asked for 400 ms at gain 80/);
  assert.ok(levels.some((l) => l > 0.9), "level reached full drive");
  assert.equal(H.level(), 0, "level back to 0");
  assert.ok(a.u32(0x5c) > seq0, "haptic_seq advanced");
});
await check("start/stop events carry what the driver programmed", () => {
  const start = g.emitted.find((e) => e.type === "start");
  const stop = g.emitted.find((e) => e.type === "stop");
  assert.ok(start && stop, "both events");
  assert.equal(start.data.gain, 204, "gain register = 80 % of 255");
  assert.equal(start.data.rateHz, 12000);
  assert.equal(start.data.playMode, 1, "RTP mode");
  assert.ok(Math.abs(stop.data.durationMs - 400) <= 40, "duration " + stop.data.durationMs);
  assert.equal(stop.data.samples, 4800, "400 ms at 12 kHz");
  assert.ok(stop.data.peak > 0.9);
  assert.equal(H.buzzes(), 1);
  assert.deepEqual({ ...H.last(), durationMs: Math.round(H.last().durationMs / 10) * 10 }.samples, 4800);
});
await check("the level stayed high for about the buzz length", () => {
  const n = levels.filter((l) => l > 0.5).length;
  assert.ok(n * 10 >= 250 && n * 10 <= 700, "high for " + n * 10 + " ms");
});
await check("top button: a tick buzz also plays and is logged", async () => {
  const before = H.buzzes();
  await press(BTN.TOP);
  await a.waitFor(() => H.buzzes() > before, 5000, "second buzz");
  await a.waitFor(() => !H.playing(), 5000, "tick over");
});
await check("subscription API: on('start') receives events; unsubscribe stops them", async () => {
  let n = 0;
  const off = H.on("start", () => n++);
  await press(BTN.BOT);
  await a.waitFor(() => n === 1, 5000, "start callback");
  off();
  await a.waitFor(() => !H.playing(), 5000, "buzz over");
  await press(BTN.BOT);
  await a.waitFor(() => H.playing(), 5000, "second buzz started");
  assert.equal(n, 1);
});
clearInterval(pump);
a.shutdown();
finish("haptic example", st);
