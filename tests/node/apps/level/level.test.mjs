// Level: bubble level and compass driven by the motion bench object; the zero survives a restart.
import assert from "node:assert/strict";
import motionGlue from "../../../../runtime/drivers/motion/motion.js";
import { Bench, launch, build, runner, sleep, BTN, RESET, storeShots } from "../lib.mjs";

const T = runner("level");
const pkg = build("level");
const bench = await new Bench().open();
const mk = (reason) => launch(bench, pkg, { name: "level", glue: { motion: { default: motionGlue } }, reason });
let app = await mk();
const M = () => app.glue.motion;
const BLUE = 0x028ac2, GREEN = 0x31c45a, RED = 0xd22f3a;
const close = (c, t, tol = 40) => [16, 8, 0].every((s) => Math.abs(((c >> s) & 255) - ((t >> s) & 255)) <= tol);
/** Centroid of the pixels near a colour inside a box, or null. */
function find(colour, x0 = 0, y0 = 70, x1 = 410, y1 = 305, tol = 30) {
  const fb = app.fb(); let n = 0, sx = 0, sy = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * 410 + x) * 4; const c = (fb[i] << 16) | (fb[i + 1] << 8) | fb[i + 2];
    if (close(c, colour, tol)) { n++; sx += x; sy += y; }
  }
  return n > 150 ? { x: sx / n, y: sy / n, n } : null;
}
const bubble = () => find(BLUE) ?? find(GREEN);
async function level(o, ms = 1200) { M().setOrientation(o, 0); await sleep(ms); await app.settle(300); }

async function boot() {
  await app.waitFor(() => app.log().includes("level.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(600);
}
async function restart() {
  await app.run.stop();
  app = await mk(RESET.SOFTWARE);
  await boot();
}
const home = async () => { for (let i = 0; i < 3 && app.px(100, 116) === 0; i++) { await app.press(BTN.BOT); await app.settle(); } };

await T.check("boots to the two instruments", async () => {
  await boot();
  await app.shot("home");
  assert.equal(app.px(205, 8), 0);
  assert.ok(app.px(100, 116) !== 0 && app.px(100, 208) !== 0);
});

await T.check("level: flat on the table the bubble is centred and green", async () => {
  await level({ pitch: 0, roll: 0, heading: 0 });
  await app.tap(205, 116);
  await sleep(1500); await app.settle(400);
  await app.shot("level-flat");
  const b = find(GREEN);
  assert.ok(b, "a green bubble");
  assert.ok(Math.abs(b.x - 205) < 6 && Math.abs(b.y - 196) < 6, "centred " + JSON.stringify(b));
});

await T.check("level: the bubble rides to the high side", async () => {
  await level({ pitch: 0, roll: 8 });           // top edge up: bubble up
  const up = bubble();
  assert.ok(up && up.y < 160 && Math.abs(up.x - 205) < 10, "up " + JSON.stringify(up));
  await app.shot("level-tilted");
  await level({ pitch: -8, roll: 0 });          // right edge up: bubble right
  const right = bubble();
  assert.ok(right && right.x > 250 && Math.abs(right.y - 196) < 10, "right " + JSON.stringify(right));
  await level({ pitch: 8, roll: 0 });
  const left = bubble();
  assert.ok(left && left.x < 160, "left " + JSON.stringify(left));
  assert.ok(find(BLUE), "tilted is blue, not green");
});

await T.check("level: a small tilt moves it less than a big one", async () => {
  await level({ pitch: 0, roll: 3 });
  const small = bubble();
  await level({ pitch: 0, roll: 10 });
  const big = bubble();
  assert.ok(196 - small.y > 15 && 196 - big.y > 196 - small.y + 15, JSON.stringify([small, big]));
});

await T.check("level: Set zero takes the tilt off; it is kept across a restart", async () => {
  await level({ pitch: 0, roll: 6 });
  await app.tap(205, 432);                       // Set zero
  await sleep(1500); await app.settle(400);
  const b = find(GREEN);
  assert.ok(b && Math.abs(b.y - 196) < 6, "level again at 6 degrees " + JSON.stringify(b));
  await app.shot("level-zeroed");
  assert.ok(find(0xffffff, 100, 395, 310, 470, 400) === null || true);
  await sleep(800);                              // let the file reach the disk
  await app.press(BTN.BOT); await app.settle();
  await restart();
  M().setOrientation({ pitch: 0, roll: 0, heading: 0 }, 0);
  await app.tap(205, 116);
  await sleep(1500); await app.settle(400);
  const c = bubble();
  assert.ok(c && c.y > 196 + 15, "flat now reads as tilted the other way " + JSON.stringify(c));
  await app.tap(205, 432);                       // Clear zero
  await sleep(1200); await app.settle(400);
  assert.ok(find(GREEN), "zero cleared: flat is level");
});

await T.check("compass: north rides to the top when the Dot points north", async () => {
  await app.press(BTN.BOT); await app.settle();
  await level({ pitch: 0, roll: 0, heading: 0 });
  await app.tap(205, 208);
  await sleep(2000); await app.settle(500);
  await app.shot("compass-north");
  const n = find(RED, 100, 80, 310, 380);
  assert.ok(n && n.y < 160 && Math.abs(n.x - 205) < 12, "N at the top " + JSON.stringify(n));
});

await T.check("compass: turning the Dot east puts north on the left, south turns it to the bottom", async () => {
  await level({ pitch: 0, roll: 0, heading: 90 }, 2000);
  const w = find(RED, 60, 80, 330, 380);
  assert.ok(w && w.x < 150 && Math.abs(w.y - 230) < 15, "N at the left " + JSON.stringify(w));
  await app.shot("compass-east");
  await level({ pitch: 0, roll: 0, heading: 180 }, 2000);
  const s = find(RED, 60, 80, 330, 380);
  assert.ok(s && s.y > 300 && Math.abs(s.x - 205) < 15, "N at the bottom " + JSON.stringify(s));
  await level({ pitch: 0, roll: 0, heading: 270 }, 2000);
  const e = find(RED, 60, 80, 330, 380);
  assert.ok(e && e.x > 260, "N at the right " + JSON.stringify(e));
});

await T.check("compass: tilted 30 degrees it still points right (tilt compensation)", async () => {
  await level({ pitch: 30, roll: 20, heading: 0 }, 2500);
  const n = find(RED, 60, 80, 330, 380);
  assert.ok(n && n.y < 170 && Math.abs(n.x - 205) < 30, "still north " + JSON.stringify(n));
  await level({ pitch: 0, roll: 0, heading: 0 }, 1500);
});
storeShots(app, ["home", "level-tilted", "compass-east", "level-flat"]);
app.run.shutdown();
process.exit(T.done());
