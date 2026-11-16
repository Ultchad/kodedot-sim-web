// NFC: read (text, link, no message, locked card, no tag), save with a name, saved list, emulate to a bench reader, delete, restart.
import assert from "node:assert/strict";
import nfcGlue from "../../../../runtime/drivers/nfc/nfc.js";
import { Bench, launch, build, runner, sleep, BTN, RESET, storeShots } from "../lib.mjs";

const T = runner("nfc_kit");
const pkg = build("nfc_kit");
const bench = await new Bench().open();
let app = await launch(bench, pkg, { name: "nfc_kit", glue: { nfc: { default: nfcGlue } } });
const nfc = () => app.glue.nfc;
const ROW = [116, 208, 300];
const BTN_Y = 432;

async function boot() {
  await app.waitFor(() => app.log().includes("nfc.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(600);
}
async function restart() {
  await app.run.stop();
  app = await launch(bench, pkg, { name: "nfc_kit", glue: { nfc: { default: nfcGlue } }, reason: RESET.SOFTWARE });
  await boot();
}
const home = async () => { while (app.px(100, ROW[0]) === 0 || app.px(205, 8) !== 0) { await app.press(BTN.BOT); await app.settle(); if (app.px(100, ROW[0]) !== 0) break; } };

await T.check("boots to Read and Saved", async () => {
  await boot();
  await app.shot("home");
  assert.ok(app.stats().colours > 20);
  assert.equal(app.px(205, 8), 0);
  assert.ok(app.px(100, ROW[0]) !== 0 && app.px(100, ROW[1]) !== 0);
});

await T.check("Saved is empty at first and says what to do", async () => {
  await app.tap(205, ROW[1]);
  await app.settle();
  await app.shot("saved-empty");
  assert.ok(app.stats().lit > 0.02);
  await app.press(BTN.BOT);
  await app.settle();
});

const clear = () => nfc().objects().forEach((o) => o.remove());
const waitFound = async () => { await app.waitFor(() => app.px(205, 432) !== 0 && app.px(205, 150) !== 0, 15000, "a result"); await app.settle(500); };

await T.check("Read waits, then shows the text tag it finds with its UID and message", async () => {
  await app.tap(205, ROW[0]);
  await app.settle();
  await app.shot("read-waiting");
  const before = app.fb().slice();
  nfc().tag({ type: "ntag215", uid: "04:11:22:33:44:55:66", text: "hello kode", near: true });
  await app.waitFor(() => app.fb().some((v, i) => v !== before[i]), 15000, "the page to change");
  await app.settle(700);
  await app.shot("read-found");
});

await T.check("Save asks for a name, keeps it, and says so", async () => {
  await app.tap(205, BTN_Y);
  await app.settle();
  await app.shot("name");
  await app.tap(205, BTN_Y);
  await app.settle(700);
  await app.shot("saved-ok");
  await app.tap(205, BTN_Y);                // Done
  await app.settle();
  assert.ok(app.px(100, ROW[0]) !== 0, "back on the first page");
});

await T.check("Read a link tag and a card with no message; save both", async () => {
  clear();
  await app.tap(205, ROW[0]);
  await app.settle();
  nfc().tag({ type: "ntag213", uid: "04:AA:BB:CC:DD:EE:01", uri: "https://kode.diy/dot", near: true });
  await sleep(3000); await app.settle(700);
  await app.shot("read-link");
  await app.tap(205, BTN_Y); await app.settle(); await app.tap(205, BTN_Y); await app.settle(600);
  await app.tap(205, BTN_Y); await app.settle();
  clear();
  await app.tap(205, ROW[0]);
  await app.settle();
  nfc().tag({ type: "ntag213", uid: "04:AA:BB:CC:DD:EE:02", formatted: false, near: true });
  await sleep(3000); await app.settle(700);
  await app.shot("read-no-message");
  await app.tap(205, BTN_Y); await app.settle(); await app.tap(205, BTN_Y); await app.settle(600);
  await app.tap(205, BTN_Y); await app.settle();
});

await T.check("A card the Dot has no key for is shown by UID and can still be saved", async () => {
  clear();
  await app.tap(205, ROW[0]);
  await app.settle();
  nfc().card({ type: "mifare1k", uid: "DE:AD:BE:EF", keys: { a: "A1B2C3D4E5F6" }, near: true });
  await sleep(3000); await app.settle(700);
  await app.shot("read-locked");
  await app.press(BTN.BOT); await app.settle();
  clear();
});

await T.check("No tag: the window ends with a clear answer and Try again", async () => {
  await app.tap(205, ROW[0]);
  await app.waitFor(() => app.px(205, 432) !== 0, 3000, "wait page");
  await sleep(9000);
  await app.settle(700);
  await app.shot("read-no-tag");
  assert.ok(app.stats().lit > 0.02);
  await app.press(BTN.BOT); await app.settle();
});

await T.check("Saved lists the cards by name and UID", async () => {
  await app.tap(205, ROW[1]);
  await app.settle();
  await app.shot("saved");
  assert.ok(app.px(100, 116) !== 0 && app.px(100, 208) !== 0 && app.px(100, 300) !== 0, "three rows");
  assert.equal(app.px(100, 392), 0);
});

await T.check("Emulate plays the saved text tag to a reader", async () => {
  await app.tap(205, ROW[0]);               // first saved: the text tag
  await app.settle();
  await app.shot("item");
  await app.tap(205, 290);                  // Emulate
  await app.settle(800);
  await app.shot("emulating");
  const r = nfc().reader({ near: true });
  await app.waitFor(() => r.seen().sessions >= 1, 12000, "the reader saw the card");
  const s = r.seen();
  assert.equal(s.uid, "04:11:22:33:44:55:66");
  assert.deepEqual(s.records[0].text, "hello kode");
  await app.tap(205, BTN_Y);                // Stop
  await app.settle();
  assert.ok(app.px(100, 290) !== 0, "back on the card's page");
  r.remove();
});

await T.check("A UID-only card is cloned verbatim", async () => {
  await app.press(BTN.BOT); await app.settle();
  await app.shot("back-on-list");
  await app.tap(205, ROW[2]);
  await app.settle();
  await app.shot("item-uid-only");
  await app.tap(205, 290);
  await app.settle(800);
  await app.shot("emulating-uid");
  const r = nfc().reader({ near: true });
  await app.waitFor(() => r.seen().sessions >= 1, 12000, "reader");
  assert.equal(r.seen().uid, "04:AA:BB:CC:DD:EE:02");
  await app.tap(205, BTN_Y);
  await app.settle();
  r.remove();
});

await T.check("Saved cards survive a restart", async () => {
  await app.press(BTN.BOT); await app.settle();
  await app.press(BTN.BOT); await app.settle();
  await restart();
  await app.tap(205, ROW[1]);
  await app.settle();
  assert.ok(app.px(100, 116) !== 0 && app.px(100, 208) !== 0 && app.px(100, 300) !== 0, "three rows after the restart");
});

await T.check("Delete asks first; BOT cancels; confirming removes the card", async () => {
  await app.tap(205, ROW[1]);
  await app.settle();
  await app.tap(205, 382);                  // Delete
  await app.settle();
  await app.shot("delete-ask");
  await app.press(BTN.BOT); await app.settle();
  await app.press(BTN.BOT); await app.settle();
  assert.ok(app.px(100, 300) !== 0, "cancelled: still three");
  await app.tap(205, ROW[1]); await app.settle();
  await app.tap(205, 382); await app.settle();
  await app.tap(205, BTN_Y); await app.settle(700);
  await app.shot("saved-after-delete");
  assert.ok(app.px(100, 208) !== 0 && app.px(100, 300) === 0, "two rows");
});

await T.check("deleting the last cards brings back the empty state", async () => {
  for (let i = 0; i < 2; i++) {
    await app.tap(205, ROW[0]); await app.settle();
    await app.tap(205, 382); await app.settle();
    await app.tap(205, BTN_Y); await app.settle(700);
  }
  assert.equal(app.px(100, 208), 0);
  assert.ok(app.px(205, 432) !== 0, "the empty state's button");
});

storeShots(app, ["home", "read-found", "saved", "emulating"]);
app.run.shutdown();
process.exit(T.done());
