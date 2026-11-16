// Files: browse /storage and /sdcard, preview text and bytes, rename, delete, the card pulled and put back.
import assert from "node:assert/strict";
import storageGlue from "../../../../runtime/drivers/storage/storage.js";
import sdGlue from "../../../../runtime/drivers/sd/sd.js";
import { Bench, launch, build, runner, sleep, BTN, RESET, storeShots } from "../lib.mjs";

const T = runner("files");
const pkg = build("files");
const bench = await new Bench().open();
const mk = (reason) => launch(bench, pkg, { name: "files", glue: { fs: { default: storageGlue }, sd: { default: sdGlue } }, reason });
let app = await mk();
const fs = () => app.glue.fs;
const sd = () => app.glue.sd;
const ROW = [116, 208, 300, 392];
const enc = (s) => new TextEncoder().encode(s);

async function boot() {
  await app.waitFor(() => app.log().includes("files.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(600);
}
const rowsOn = () => ROW.filter((y) => app.px(100, y) !== 0).length;
const differs = (a) => app.fb().some((v, i) => v !== a[i]);
/** Tap and require the glass to change (the tap was taken). */
async function go(x, y, settle = 900) {
  const before = app.fb().slice();
  await app.tap(x, y);
  await app.waitFor(() => differs(before), 6000, "the page to change after tapping " + x + "," + y);
  await app.settle(settle);
}
const back = async () => { await app.press(BTN.BOT); await app.settle(500); };

await T.check("boots to the two volumes", async () => {
  await boot();
  await app.settle(1500);
  await app.shot("home");
  assert.equal(app.px(205, 8), 0);
  assert.equal(rowsOn(), 2);
});

await T.check("seed some files from the bench", async () => {
  fs().mkdir("/storage/docs");
  fs().write("/storage/readme.txt", enc("Hello from the Kode Dot.\nThis file is plain text.\nThree lines in all."));
  fs().write("/storage/tmp.txt", enc("scratch"));
  fs().write("/storage/blob.bin", Uint8Array.from({ length: 400 }, (_, i) => (i * 7 + 3) & 255));
  fs().write("/storage/docs/todo.txt", enc("1. flash it\n2. ship it"));
  fs().write("/storage/empty.txt", enc(""));
});

await T.check("Internal storage lists folders first, then files by name, with sizes", async () => {
  await go(205, ROW[0], 1500);
  await app.shot("folder");
  assert.equal(rowsOn(), 4, "docs, blob.bin, empty.txt, readme.txt and more below");
  assert.ok(app.stats().colours > 20);
});

await T.check("a folder opens, and BOT goes back to its parent", async () => {
  await go(205, ROW[0], 1500);              // docs
  await app.shot("subfolder");
  assert.equal(rowsOn(), 1);
  await back();
  assert.ok(rowsOn() >= 3, "parent again");
});

await T.check("a text file previews as text", async () => {
  await go(205, ROW[3]);                    // readme.txt: docs, blob.bin, empty.txt, readme.txt
  await app.shot("file");
  await go(205, 218);                       // Preview
  await app.shot("preview-text");
  assert.ok(app.stats().lit > 0.03);
  await back(); await back();
});

await T.check("a binary file previews as bytes, and Next moves on", async () => {
  await go(205, ROW[1]);                    // blob.bin
  await go(205, 218);
  await app.shot("preview-hex");
  await app.press(BTN.DOWN);                // the pad goes to the Next row
  await app.settle(800);
  await app.shot("preview-hex-end");
  await app.press(BTN.TOP);                 // Next: bytes 192 to 384
  await app.settle(1500);
  await app.shot("preview-hex-next");
  await back(); await back();
});

await T.check("an empty file says so", async () => {
  await go(205, ROW[2]);
  await go(205, 218);
  await app.shot("preview-empty");
  assert.ok(app.stats().lit > 0.01);
  await back(); await back();
});

const names = () => fs().list("/storage").map((f) => f.name).sort();
const wipe = async () => { for (let i = 0; i < 14; i++) { await app.tap(333, 316); await sleep(120); } };
const typeKeys = async (keys) => { for (const [x, y] of keys) { await app.tap(x, y); await sleep(120); } };

await T.check("Rename retypes the name and the file is renamed", async () => {
  await go(205, ROW[2]);                    // empty.txt: docs, blob.bin, empty.txt, readme.txt, tmp.txt
  await go(205, 310);                       // Rename
  await app.shot("rename");
  await wipe();
  await typeKeys([[103, 155], [55, 155]]);  // b a
  await app.settle(400);
  await app.shot("rename-typed");
  await app.tap(205, 432);                  // Rename
  await app.waitFor(() => names().includes("ba"), 8000, "the file to be renamed");
  assert.equal(names().includes("empty.txt"), false);
  await app.settle(1500);
  await app.shot("after-rename");
  assert.ok(app.px(100, ROW[0]) !== 0, "back on the folder, listed again");
});

await T.check("a name that is taken is refused, with words, and nothing changes", async () => {
  const had = names();
  await go(205, ROW[1]);                    // ba: docs, ba, blob.bin ...
  await go(205, 310);                       // Rename
  await wipe();
  await typeKeys([[205, 155], [55, 263], [155, 155], [255, 263]]);   // d o c s
  await app.settle(400);
  await app.shot("rename-docs");
  await app.tap(205, 432);
  await app.settle(1800);
  await app.shot("rename-refused");
  assert.deepEqual(names(), had, "the rename did not happen");
  await back();                             // the message
  await back();                             // the file's page: back to the folder
});

await T.check("Delete asks first; BOT cancels; confirming removes the file", async () => {
  const had = names();
  await go(205, ROW[3]);                    // readme.txt
  await go(205, 402);                       // Delete
  await app.shot("delete-ask");
  await back();
  assert.deepEqual(names(), had, "cancelled: nothing removed");
  await go(205, 402);
  await app.tap(205, 432);                  // Delete
  await app.waitFor(() => names().length === had.length - 1, 8000, "the file to be gone");
  assert.equal(names().includes("readme.txt"), false);
  await app.settle(1500);
  await app.shot("after-delete");
});

await T.check("the card: none in the slot says so; put back it lists its files", async () => {
  await back(); await back();
  sd().eject();
  await go(205, ROW[1]);
  await app.shot("sd-none");
  await app.press(BTN.BOT); await app.settle(500);
  sd().insert();
  sd().mount();
  fs().write("/sdcard/photo.bin", Uint8Array.from({ length: 50 }, (_, i) => i));
  await app.tap(205, ROW[1]); await app.settle(1500);
  await app.shot("sd-files");
  assert.ok(app.px(100, ROW[0]) !== 0, "a row for the file on the card");
});

storeShots(app, ["home", "folder", "file", "preview-hex"]);
app.run.shutdown();
process.exit(T.done());
