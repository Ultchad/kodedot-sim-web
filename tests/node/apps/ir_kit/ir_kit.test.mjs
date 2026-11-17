// IR Remote: learn from a bench Remote (NEC and raw), save into named remotes, send back to a bench TV (tap, hold), rename, delete, restart.
import assert from "node:assert/strict";
import * as radioGlue from "../../../../runtime/drivers/radio/radio.js";
import * as irGlue from "../../../../runtime/drivers/ir/ir.js";
import { Bench, launch, build, runner, sleep, BTN, RESET, storeShots, typeText } from "../lib.mjs";

const T = runner("ir_kit");
const pkg = build("ir_kit");
const bench = await new Bench().open();
const GLUE = { radio: radioGlue, ir: irGlue };
let app = await launch(bench, pkg, { name: "ir_kit", glue: GLUE });
const ir = () => app.glue.ir;
const ROW = [116, 208, 300, 392];
const BTN_Y = 432, LEFT_X = 114, RIGHT_X = 296;

async function boot() {
  app.glue.radio.fastTiming?.();
  await app.waitFor(() => app.log().includes("ir.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(600);
}
async function restart() {
  await app.run.stop();
  app = await launch(bench, pkg, { name: "ir_kit", glue: GLUE, reason: RESET.SOFTWARE });
  await boot();
}
const logs = () => app.log();
const count = (re) => (logs().match(re) || []).length;
/** Start a learning window (the caller taps first) and wait until AO_Ir listens. */
const armed = () => app.waitFor(() => ir().state().armed, 20000, "the receiver to be armed");
const pageChanged = async (act, ms = 15000) => {
  const before = app.fb().slice();
  await act();
  await app.waitFor(() => app.fb().some((v, i) => v !== before[i]), ms, "the page to change");
  await app.settle(600);
};
const lit = (x, y) => app.px(x, y) !== 0;

await boot();
const tv = ir().tv({ name: "TV" });
const rem = ir().remote({ name: "Remote" });

await T.check("boots to Learn and Remotes; Remotes is empty and says what to do", async () => {
  await app.shot("home");
  assert.ok(app.stats().colours > 20);
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]));
  await app.tap(205, ROW[1]);
  await app.settle();
  await app.shot("remotes-empty");
  assert.ok(app.stats().lit > 0.02 && lit(205, BTN_Y));
  await app.press(BTN.BOT); await app.settle();
});

await T.check("Learn waits, then decodes the Remote's Power as NEC 0xFB04 / 0x0008", async () => {
  await app.tap(205, ROW[0]);
  await app.settle();
  await app.shot("learn-wait");
  await armed();
  const r = await rem.press("Power");
  assert.ok(r.ok, JSON.stringify(r));
  await app.waitFor(() => /heard NEC addr=0xFB04 cmd=0x0008/.test(logs()), 15000, "decoded");
  await app.settle(700);
  await app.shot("learn-nec");
  assert.ok(lit(LEFT_X, BTN_Y) && lit(RIGHT_X, BTN_Y), "Test and Save");
});

await T.check("Test sends the learned frame: the TV turns on, then Test again turns it off", async () => {
  const sends = ir().state().sends;
  await app.tap(LEFT_X, BTN_Y);
  await app.waitFor(() => tv.state().power === true, 8000, "TV on");
  assert.ok(ir().state().sends > sends);
  await sleep(300);
  await app.tap(LEFT_X, BTN_Y);
  await app.waitFor(() => tv.state().power === false, 8000, "TV off");
});

await T.check("Save asks for the remote's name, then the button's, and says Saved", async () => {
  await app.tap(RIGHT_X, BTN_Y);
  await app.settle();
  await app.shot("name-remote");
  await typeText(app, "tv", 8);
  await app.shot("name-remote-typed");
  await app.tap(205, BTN_Y);               // Next
  await app.settle(700);
  await app.shot("name-button");
  await typeText(app, "power", 8);
  await app.tap(205, BTN_Y);               // Save
  await app.settle(700);
  await app.shot("saved");
  assert.ok(lit(LEFT_X, BTN_Y) && lit(RIGHT_X, BTN_Y));
});

await T.check("Done opens the remote with its button as a pill; a tap sends it", async () => {
  await app.tap(LEFT_X, BTN_Y);            // Done
  await app.settle(700);
  assert.ok(lit(100, ROW[0]), "the Power pill");
  await app.shot("remote");
  tv.clearLog?.();
  await app.tap(205, ROW[0]);
  await app.waitFor(() => tv.state().power === true, 8000, "TV on from the saved button");
  const e = tv.log().at(-1);
  assert.ok(e.type === "nec" && e.addr === 0xfb04 && e.cmd === 8 && e.action === "power", JSON.stringify(e));
  await app.shot("remote-sent");
});

await T.check("Holding a button repeats it", async () => {
  await sleep(900);
  const sends = ir().state().sends;
  app.run.touch(205, ROW[0], true);
  await sleep(1400);
  app.run.touch(205, ROW[0], false);
  await sleep(600);
  const n = ir().state().sends - sends;
  assert.ok(n >= 3, "a held button sent " + n + " frames");
});

await T.check("Add button learns Vol+ into the same remote with the default name", async () => {
  await app.settle();
  await app.tap(205, ROW[1]);              // Add button
  await app.settle();
  await armed();
  await sleep(400);
  await rem.press("Vol+");
  await app.waitFor(() => /heard NEC addr=0xFB04 cmd=0x0002/.test(logs()), 15000, "Vol+ decoded");
  await app.settle(700);
  await app.tap(RIGHT_X, BTN_Y);           // Save: no remote question, straight to the name
  await app.settle(700);
  await app.shot("name-button-default");
  await app.tap(205, BTN_Y);
  await app.settle(700);
  await app.tap(LEFT_X, BTN_Y);            // Done: back on the remote
  await app.settle(700);
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]), "two buttons");
  await app.shot("remote-two");
  const before = tv.state().volume;
  await app.tap(205, ROW[1]);
  await app.waitFor(() => tv.state().volume === before + 1, 8000, "volume up");
});

await T.check("A raw signal is learned as 'raw signal, N pulses', saved and replayed exactly", async () => {
  const sony = [2400, 600, 1200, 600, 600, 600, 1200, 600, 600, 600, 600, 600, 1200, 600, 600, 600, 1200, 600, 600, 600, 600, 600, 1200, 600, 600];
  await app.tap(205, ROW[2]);              // Add button
  await app.settle();
  await armed();
  await sleep(400);
  const r = await rem.sendRaw(sony, 38000);
  assert.ok(r.ok, JSON.stringify(r));
  await app.waitFor(() => /heard raw signal, 13 pulses/.test(logs()), 15000, "raw heard");
  await app.settle(700);
  await app.shot("learn-raw");
  await app.tap(RIGHT_X, BTN_Y); await app.settle(700);
  await typeText(app, "sony", 8);
  await app.tap(205, BTN_Y); await app.settle(700);
  await app.tap(LEFT_X, BTN_Y); await app.settle(700);
  await app.shot("remote-three");
  tv.clearLog?.();
  await app.tap(205, ROW[2]);
  await app.waitFor(() => tv.raw()?.durations?.length >= 25, 8000, "the raw frame reached the TV");
  const got = tv.raw().durations;
  const mine = got.slice(0, 25);
  assert.equal(mine.length, 25);
  const worst = Math.max(...mine.map((v, i) => Math.abs(v - sony[i])));
  assert.ok(worst <= 120, "replayed durations within 120 us of the learned ones, worst " + worst);
});

await T.check("Nothing heard: the window ends by itself and says so, with Try again", async () => {
  await app.tap(205, ROW[3]);              // Add button
  await app.settle();
  const t0 = Date.now();
  await app.waitFor(() => /nothing learned/.test(logs()), 20000, "the window to close");
  await app.settle(700);
  assert.ok(Date.now() - t0 > 6000, "it waited");
  await app.shot("learn-none");
  assert.ok(lit(205, BTN_Y));
  await app.press(BTN.BOT); await app.settle(700);
});

await T.check("Learn from the first page with a remote saved asks which remote, and can make a new one", async () => {
  await app.press(BTN.BOT); await app.settle(); await app.press(BTN.BOT); await app.settle();
  await app.tap(205, ROW[0]);
  await app.settle(); await armed(); await sleep(400);
  await rem.press("Ch+");
  await app.waitFor(() => /heard NEC addr=0xFB04 cmd=0x0004/.test(logs()), 15000, "Ch+ decoded");
  await app.settle(700);
  await app.tap(RIGHT_X, BTN_Y);
  await app.settle(700);
  await app.shot("pick");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]), "the remote and New remote");
  await app.tap(205, ROW[1]);              // New remote
  await app.settle(700);
  await typeText(app, "box", 8);
  await app.tap(205, BTN_Y); await app.settle(700);
  await typeText(app, "ch", 8);
  await app.tap(205, BTN_Y); await app.settle(700);
  await app.tap(LEFT_X, BTN_Y); await app.settle(900);   // Done: on the new remote
  await app.shot("remote-box");
  await app.press(BTN.BOT); await app.settle(); await app.shot("remotes");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]), "two remotes");
});

await T.check("Remotes and buttons survive a restart and still send", async () => {
  await app.press(BTN.BOT); await app.settle();
  await restart();
  const tv2 = ir().get(tv.id);
  assert.ok(tv2, "the bench TV survived too");
  await app.tap(205, ROW[1]); await app.settle();
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]), "two remotes after the restart");
  await app.tap(205, ROW[0]); await app.settle(700);
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]), "three buttons");
  const p = tv2.state().power;
  await app.tap(205, ROW[0]);
  await app.waitFor(() => tv2.state().power !== p, 15000, "Power toggled after the restart");
});

const padTo = async (n) => { for (let i = 0; i < n; i++) await app.press(BTN.DOWN, 120); await app.settle(500); };

await T.check("Edit remote lists its buttons; a button can be renamed", async () => {
  await padTo(5);
  await app.press(BTN.TOP); await app.settle(700);          // Edit remote
  await app.shot("edit");
  await app.tap(205, ROW[2]); await app.settle(700);          // Button 1
  await app.shot("button");
  await app.tap(205, 290); await app.settle(700);             // Rename
  await typeText(app, "vol", 8);
  await app.shot("rename-button");
  await app.tap(205, BTN_Y); await app.settle(700);
  await app.shot("button-renamed");
});

await T.check("Delete asks first; BOT cancels; confirming removes the button", async () => {
  await app.tap(205, 382); await app.settle(700);
  await app.shot("delete-ask");
  await app.press(BTN.BOT); await app.settle(700);
  await app.press(BTN.BOT); await app.settle(700);
  await app.press(BTN.BOT); await app.settle(700);          // back on the remote: still three buttons
  assert.ok(lit(100, ROW[2]), "cancelled: Sony still there");
  await padTo(5); await app.press(BTN.TOP); await app.settle(700);
  await app.tap(205, ROW[3]); await app.settle(700);        // Sony
  await app.tap(205, 382); await app.settle(700);
  await app.tap(205, BTN_Y); await app.settle(900);         // Delete
  await app.shot("edit-after-delete");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]) && lit(100, ROW[3]), "Rename, Power, Vol, Delete remote");
});

await T.check("Rename the remote; the new name is on its page", async () => {
  await app.tap(205, ROW[0]); await app.settle(700);
  await typeText(app, "lounge", 8);
  await app.tap(205, BTN_Y); await app.settle(900);
  await app.shot("remote-renamed");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]), "Power, Vol, Add button");
  await app.press(BTN.BOT); await app.settle(700);
  await app.shot("remotes-renamed");
});

await T.check("Delete remote asks, then removes it with its buttons; the rest survives a restart", async () => {
  await app.tap(205, ROW[0]); await app.settle(700);
  await padTo(4); await app.press(BTN.TOP); await app.settle(700);   // Edit remote
  await padTo(4);                                                    // Delete remote is the last row: Rename, Power, Vol, Delete
  await app.press(BTN.TOP); await app.settle(700);
  await app.shot("delete-remote-ask");
  await app.tap(205, BTN_Y); await app.settle(900);
  assert.ok(lit(100, ROW[0]) && !lit(100, ROW[1]), "one remote left");
  await restart();
  const tv2 = ir().get(tv.id);
  await app.tap(205, ROW[1]); await app.settle(700);
  await app.tap(205, ROW[0]); await app.settle(700);
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]) && !lit(100, ROW[3]), "Box: Ch, Add button, Edit remote");
  tv2.update({ power: true });
  const ch = tv2.state().channel;
  await app.tap(205, ROW[0]);
  await app.waitFor(() => tv2.state().channel === ch + 1, 15000, "channel up from the saved Ch button");
});

storeShots(app, ["home", "learn-nec", "remote-two", "edit"]);
app.run.shutdown();
process.exit(T.done());
