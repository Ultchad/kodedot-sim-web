// Acceptance test 1: examples/buttons_led runs unmodified; its log line appears, the fake LED becomes
// green (0,32,0), and pressing the top button through the bridge turns it red (32,0,0). The example
// toggles on the press of KODE_SYS_BUTTON_TOP (not the release) with BL_LEVEL = 32.
import assert from "node:assert/strict";
import { boot, BTN, sleep } from "./harness.mjs";

const pkg = process.argv[2];
const a = await boot(pkg);
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); }
  catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};

await check("boots and logs 'up; the top button swaps the colour'", async () => {
  await a.waitFor(() => a.logText().includes("up; the top button swaps the colour"), 15000, "the boot log line");
  assert.match(a.logText(), /buttons_led .*up; the top button swaps the colour, the bottom one resets/);
});

await check("LED becomes green (0,32,0)", async () => {
  await a.waitFor(() => a.led().join() === "0,32,0", 5000, "LED green");
  assert.deepEqual(a.led(), [0, 32, 0]);
  assert.match(a.logText(), /buttons_led green/);
});

await check("top button press turns the LED red (32,0,0)", async () => {
  const seq = a.ledSeq();
  a.button(BTN.TOP, true);
  await a.waitFor(() => a.led().join() === "32,0,0", 5000, "LED red after the press");
  assert.deepEqual(a.led(), [32, 0, 0]);
  assert.ok(a.ledSeq() > seq, "led_seq advanced");
  assert.match(a.logText(), /buttons_led red/);
});

await check("releasing the top button changes nothing (toggle is on press)", async () => {
  a.button(BTN.TOP, false);
  await sleep(400);
  assert.deepEqual(a.led(), [32, 0, 0]);
});

await check("a second press toggles back to green", async () => {
  a.button(BTN.TOP, true);
  await a.waitFor(() => a.led().join() === "0,32,0", 5000, "LED green again");
  a.button(BTN.TOP, false);
  await sleep(200);
  assert.deepEqual(a.led(), [0, 32, 0]);
});

console.log(failed ? "buttons_led: FAILED" : "buttons_led: PASSED");
process.exit(failed ? 1 : 0);
