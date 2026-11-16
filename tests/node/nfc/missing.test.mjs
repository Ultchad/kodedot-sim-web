// No chip fitted, and the bench surviving a device restart (the "nfc" persistent region).
import { BTN, apiDriver, assert, bootReady, runner, sleep, until } from "./bench.mjs";

const t = runner();
const a = await bootReady("nfc_api", "nfc_api ready");
const cmd = apiDriver(a);
const nfc = a.nfc;

let saved;
await t.check("R1. objects (and their content) survive a restart of the device", async () => {
  const tag = nfc.tag({ uid: "04:12:34:56:78:9A:BC", text: "kept", near: true });
  const card = nfc.card({ type: "iso-dep", text: "card kept" });
  assert.equal(await cmd("read text 1000"), 'READ ok "kept"');
  saved = a.snapshot();
  assert.ok(saved.get("nfc"), "the nfc region is in the snapshot");
  void tag; void card;
});

await t.check("R2. no chip fitted: the flag is kept across restarts and reaches the driver at the next boot", async () => {
  nfc.setChipFitted(false);
  saved = a.snapshot();
  a.shutdown();
});

const b = await bootReady("nfc_api", "nfc_api ready", { persist: saved });
const cmd2 = apiDriver(b);

await t.check("R3. after the restart: the bench objects are all still there", () => {
  const os = b.nfc.objects();
  assert.equal(os.length, 2);
  assert.ok(os.some((o) => o.content().text === "kept"));
  assert.ok(os.some((o) => o.content().text === "card kept"));
  assert.equal(b.nfc.state().chipFitted, false);
});

await t.check("R4. no reader fitted: kaos.nfc reports it, every API call fails with the SDK's message", async () => {
  assert.match(b.logText(), /kaos\.nfc no NFC reader on this board; the field stays down/);
  assert.doesNotMatch(b.logText(), /kaos\.nfc up; reader 0x31/);
  const msg = "NFC is busy, or no reader is fitted";
  assert.equal(await cmd2("id 500"), "ID fail: " + msg);
  assert.equal(await cmd2("read text 500"), "READ fail: " + msg);
  assert.equal(await cmd2("write text 500 x"), "WRITE fail: " + msg);
  // kode_nfc_scan_start only raises a flag in the SDK (it does not touch the chip), so it reports success; no event ever follows.
  assert.equal(await cmd2("scanstart"), "SCANSTART ok");
  assert.equal(await cmd2("scanstop"), "SCANSTOP ok");
  assert.equal(await cmd2("profile x text y"), "PROFILE ok", "profiles are only stored");
  assert.equal(await cmd2("emu x"), "EMU fail: no NFC reader is fitted, or it would not present the card");
});

await t.check("R5. refitting the chip and restarting brings NFC back, with the same tag", async () => {
  b.nfc.setChipFitted(true);
  const snap = b.snapshot();
  b.shutdown();
  const c = await bootReady("nfc_api", "nfc_api ready", { persist: snap });
  const cmd3 = apiDriver(c);
  assert.match(c.logText(), /kaos\.nfc up; reader 0x31/);
  assert.equal(await cmd3("read text 2000"), 'READ ok "kept"');
  c.nfc.reset();
  assert.equal(c.nfc.objects().length, 0);
  c.shutdown();
});

await t.check("R6. the unmodified nfc_read example on a board without the chip says so and keeps running", async () => {
  const d = await bootReady("nfc_read", "nfc_read up;", { persist: saved });
  for (let i = 0; i < 4 && !/nfc_read .*no reader/.test(d.logText()); i++) {   // a press can be lost on a loaded machine
    await d.press(BTN.TOP);
    await sleep(1500); d.poll(); d.drain();
  }
  await until(d, () => /nfc_read .*no reader/.test(d.logText()), 15000, "nfc_read's no-reader log");
  d.shutdown();
});

await sleep(0);
process.exit(t.done("missing"));
