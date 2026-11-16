// RFID: read an EM4100 card, save, list, emulate to a door reader, write to a T5577, delete, restart.
import assert from "node:assert/strict";
import rfidGlue from "../../../../runtime/drivers/rfid/rfid.js";
import { Bench, launch, build, runner, sleep, BTN, RESET, storeShots } from "../lib.mjs";

const T = runner("rfid_kit");
const pkg = build("rfid_kit");
const bench = await new Bench().open();
const mk = (reason) => launch(bench, pkg, { name: "rfid_kit", glue: { rfid: { default: rfidGlue } }, reason });
let app = await mk();
const R = () => app.glue.rfid;
const ROW = [116, 208, 300];
const BTN_Y = 432;
const changed = async (what, ms = 20000) => { const b = app.fb().slice(); await app.waitFor(() => app.fb().some((v, i) => v !== b[i]), ms, what); await app.settle(700); };

async function boot() {
  await app.waitFor(() => app.log().includes("rfid.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(600);
}
async function restart() {
  await app.run.stop();
  app = await mk(RESET.SOFTWARE);
  await boot();
}
const readTag = async (id, shot) => {
  await app.tap(205, ROW[0]);
  await app.settle();
  const c = R().createCard({ name: "Fob " + id, id });
  const b = app.fb().slice();
  R().bringNear(c.key);
  await app.waitFor(() => app.fb().some((v, i) => v !== b[i]), 20000, "the result");
  await app.settle(700);
  if (shot) await app.shot(shot);
  R().takeAway(c.key);
  return c;
};
const saveIt = async (shot) => {
  await app.tap(205, BTN_Y); await app.settle();
  if (shot) await app.shot(shot + "-name");
  await app.tap(205, BTN_Y); await app.settle(700);
  if (shot) await app.shot(shot);
  await app.tap(205, BTN_Y); await app.settle();
};

await T.check("boots to Read and Saved", async () => {
  await boot();
  await app.shot("home");
  assert.equal(app.px(205, 8), 0);
  assert.ok(app.px(100, ROW[0]) !== 0 && app.px(100, ROW[1]) !== 0);
});

await T.check("Saved is empty at first and says what to do", async () => {
  await app.tap(205, ROW[1]); await app.settle();
  await app.shot("saved-empty");
  assert.ok(app.px(205, BTN_Y) !== 0);
  await app.press(BTN.BOT); await app.settle();
});

await T.check("Read waits, then shows the EM4100 ID", async () => {
  await app.tap(205, ROW[0]); await app.settle();
  await app.shot("read-waiting");
  const c = R().createCard({ name: "Fob", id: "01:02:03:04:05" });
  const b = app.fb().slice();
  R().bringNear(c.key);
  await app.waitFor(() => app.fb().some((v, i) => v !== b[i]), 20000, "result");
  await app.settle(700);
  await app.shot("read-found");
  R().takeAway(c.key);
});

await T.check("Save asks for a name and keeps it", async () => {
  await saveIt("saved-ok");
  assert.ok(app.px(100, ROW[0]) !== 0, "back on the first page");
});

await T.check("two more tags are read and saved", async () => {
  await readTag("DE:AD:BE:EF:01"); await saveIt();
  await readTag("77:66:55:44:33"); await saveIt();
  await app.tap(205, ROW[1]); await app.settle();
  await app.shot("saved");
  assert.ok(app.px(100, 116) !== 0 && app.px(100, 208) !== 0 && app.px(100, 300) !== 0 && app.px(100, 392) === 0);
  await app.press(BTN.BOT); await app.settle();
});

await T.check("No tag: the window ends with a clear answer", async () => {
  await app.tap(205, ROW[0]); await app.settle();
  await sleep(12000);
  await app.settle(700);
  await app.shot("read-no-tag");
  assert.ok(app.stats().lit > 0.02 && app.px(205, BTN_Y) !== 0);
  await app.press(BTN.BOT); await app.settle();
});

await T.check("Emulate plays the saved ID to a door reader", async () => {
  await app.tap(205, ROW[1]); await app.settle();
  await app.tap(205, ROW[0]); await app.settle();
  await app.shot("item");
  const door = R().createReader({ name: "Door", expectedId: "01:02:03:04:05" });
  R().bringNear(door.key);
  await app.tap(205, 206);               // Emulate
  await app.settle(800);
  await app.shot("emulating");
  await app.waitFor(() => R().get(door.key).seen.visible, 15000, "the door reader to see it");
  const s = R().get(door.key).seen;
  assert.equal(s.id, "01:02:03:04:05");
  assert.ok(s.match);
  await app.tap(205, BTN_Y);             // Stop
  await app.settle();
  await app.waitFor(() => !R().emulation().active, 8000, "emulation to end");
  assert.ok(app.px(100, 206) !== 0, "back on the tag's page");
  R().remove(door.key);
});

await T.check("Write to tag copies the ID onto a blank T5577", async () => {
  await app.tap(205, 298); await app.settle();
  await app.shot("write-ready");
  const t = R().createTag({ name: "Blank" });
  R().bringNear(t.key);
  await app.tap(205, BTN_Y);
  await app.waitFor(() => R().get(t.key).id === "01:02:03:04:05", 20000, "the tag to take the ID");
  await app.settle(800);
  await app.shot("write-ok");
  assert.equal(R().get(t.key).id, "01:02:03:04:05");
  await app.tap(205, BTN_Y); await app.settle();
  R().remove(t.key);
});

await T.check("Write to something that is not a T5577 says so", async () => {
  await app.tap(205, 298); await app.settle();
  const c = R().createTag({ name: "Locked", writeProtected: true });
  R().bringNear(c.key);
  await app.tap(205, BTN_Y);
  await sleep(10000);
  await app.settle(700);
  await app.shot("write-failed");
  R().remove(c.key);
  await app.press(BTN.BOT); await app.settle();
});

await T.check("Saved tags survive a restart", async () => {
  await app.press(BTN.BOT); await app.settle();
  await app.press(BTN.BOT); await app.settle();
  await restart();
  await app.tap(205, ROW[1]); await app.settle();
  assert.ok(app.px(100, 116) !== 0 && app.px(100, 208) !== 0 && app.px(100, 300) !== 0, "three rows after the restart");
});

await T.check("Delete asks first; BOT cancels; confirming removes the tag", async () => {
  await app.tap(205, ROW[1]); await app.settle();
  await app.tap(205, 390); await app.settle();
  await app.shot("delete-ask");
  await app.press(BTN.BOT); await app.settle();
  await app.press(BTN.BOT); await app.settle();
  assert.ok(app.px(100, 300) !== 0, "cancelled: still three");
  await app.tap(205, ROW[1]); await app.settle();
  await app.tap(205, 390); await app.settle();
  await app.tap(205, BTN_Y); await app.settle(700);
  assert.ok(app.px(100, 208) !== 0 && app.px(100, 300) === 0, "two rows");
  for (let i = 0; i < 2; i++) {
    await app.tap(205, ROW[0]); await app.settle();
    await app.tap(205, 390); await app.settle();
    await app.tap(205, BTN_Y); await app.settle(700);
  }
  assert.equal(app.px(100, 208), 0);
  assert.ok(app.px(205, BTN_Y) !== 0, "the empty state's button");
});

storeShots(app, ["home", "read-found", "saved", "emulating"]);
app.run.shutdown();
process.exit(T.done());
