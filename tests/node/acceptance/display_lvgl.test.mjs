// Acceptance test 2: examples/display_lvgl runs unmodified; the shared framebuffer becomes non-uniform
// and a touch, or a top-button press, changes the counter ("count N" in the log) and the picture.
import assert from "node:assert/strict";
import { boot, pkgPath, BTN, OFF, sleep } from "../harness.mjs";

const a = await boot(pkgPath("display_lvgl"));
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); }
  catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};
const colours = (fb) => { const s = new Set(); for (let i = 0; i < fb.length; i += 4) s.add((fb[i] | (fb[i + 1] << 8) | (fb[i + 2] << 16)) >>> 0); return s.size; };
const counts = () => [...a.logText().matchAll(/display_lvgl count (\d+)/g)].map((m) => Number(m[1]));
let fb0;

await check("boots: LVGL up and the panel lit", async () => {
  await a.waitFor(() => a.logText().includes("display_lvgl panel up at 100%, LVGL running"), 15000, "LVGL up");
  await a.waitFor(() => a.frameSeq() > 0, 10000, "first frame on the glass");
  assert.equal(a.u32(OFF.panelOn), 1);
  assert.equal(a.u32(OFF.backlight), 100);
  assert.equal(a.u32(OFF.fbW), 410);
  assert.equal(a.u32(OFF.fbH), 502);
});

await check("framebuffer is non-uniform", async () => {
  await sleep(500);
  fb0 = a.framebuffer();
  assert.ok(colours(fb0) > 2, "distinct colours: " + colours(fb0));
});

await check("touch changes the counter and the picture", async () => {
  const n0 = counts().length;
  a.touch(205, 251, true);
  await sleep(250);
  a.touch(205, 251, false);
  await a.waitFor(() => counts().length > n0, 8000, "'count N' after a touch");
  await sleep(600);
  assert.ok(!Buffer.from(fb0).equals(Buffer.from(a.framebuffer())), "framebuffer unchanged by the touch");
});

await check("top button press changes the counter", async () => {
  const c = counts();
  const last = c.length ? c[c.length - 1] : 0;
  a.button(BTN.TOP, true);
  await sleep(150);
  a.button(BTN.TOP, false);
  await a.waitFor(() => { const x = counts(); return x.length && x[x.length - 1] > last; }, 8000, "'count N' after the top button");
});

console.log(failed ? "display_lvgl: FAILED" : "display_lvgl: PASSED");
process.exit(failed ? 1 : 0);
