// The UNMODIFIED SDK example examples/nfc_read, end to end: boot, present a tag, read it with the buttons, take it
// away, present another. Everything above kdrv_st25r3916 is the real SDK (AO_Nfc, kode_sys_nfc, knfc_tag/ndef/mfc).
import { BTN, assert, bootReady, runner, sleep, until } from "./bench.mjs";

const t = runner();
const a = await bootReady("nfc_read", "nfc_read up;");
const log = () => a.logText();
const lines = () => log().split("\n");
const count = (re) => lines().filter((l) => re.test(l)).length;

await t.check("boot: AO_Nfc finds the reader, no 'not implemented' for anything it calls", () => {
  assert.match(log(), /kaos\.nfc up; reader 0x31, field down until somebody asks/);
  assert.doesNotMatch(log() + a.logs.join("\n"), /not implemented/);
  assert.deepEqual(a.nfc.state().field, false, "the field stays down until somebody asks");
});

await t.check("top button: identify a Type-2 tag (UID, ATQA, SAK)", async () => {
  const tag = a.nfc.tag({ uid: "04:A2:3B:91:5C:6D:80", text: "hello", lang: "en" });
  tag.near();
  await a.press(BTN.TOP);
  await until(a, () => /nfc_read tag: Type-2, UID 04A23B915C6D80, ATQA 0x0044 SAK 0x00/.test(log()), 8000, "identify answer");
  assert.match(log(), /identify: field up for 3000 ms, present a tag/);
  await until(a, () => !a.nfc.state().field, 3000, "the field to drop after the answer");
});

await t.check("bottom button: read the text NDEF message", async () => {
  await a.press(BTN.BOT);
  await until(a, () => /ndef: "hello" \(5 bytes\)/.test(log()), 8000, "ndef text");
});

await t.check("the device's events reached the page: field on/off, activated, read", async () => {
  a.poll();
  const types = a.events.map((e) => e.type);
  for (const want of ["created", "near", "field", "activated", "read"]) assert.ok(types.includes(want), "event " + want + " in " + types);
  assert.ok(a.events.some((e) => e.type === "field" && e.on === true));
  assert.ok(a.events.some((e) => e.type === "field" && e.on === false));
});

await t.check("take the tag away: the read finds nothing within its 3000 ms window", async () => {
  a.nfc.objects()[0].away();
  const before = count(/nothing there: no tag came within 3000 ms/);
  const t0 = Date.now();
  await a.press(BTN.BOT);
  await until(a, () => count(/nothing there: no tag came within 3000 ms/) === before + 1, 10000, "the empty window");
  const dt = Date.now() - t0;
  assert.ok(dt >= 2800 && dt < 6000, "the window ran its 3000 ms (took " + dt + " ms)");
  assert.equal(a.nfc.state().field, false);
});

await t.check("present another tag (a link): the next read shows it", async () => {
  a.nfc.objects()[0].remove();
  a.nfc.tag({ uid: "04:77:66:55:44:33:22", uri: "https://kode.diy", near: true });
  await a.press(BTN.BOT);
  await until(a, () => /ndef: "https:\/\/kode\.diy" \(16 bytes\)/.test(log()), 8000, "ndef uri");
  assert.match(log(), /tag: Type-2, UID 04776655443322/);
});

await t.check("a tag removed while the window is open, then presented, is read when it arrives", async () => {
  a.nfc.objects().forEach((o) => o.remove());
  await a.press(BTN.BOT);
  await sleep(700);
  a.nfc.tag({ uid: "04:01:02:03:04:05:06", text: "late arrival", near: true });
  await until(a, () => /ndef: "late arrival" \(12 bytes\)/.test(log()), 6000, "late tag");
});

await t.check("blank tag: opens but carries no message (the example says how to fix it)", async () => {
  a.nfc.objects().forEach((o) => o.remove());
  a.nfc.tag({ formatted: false, near: true });
  await a.press(BTN.BOT);
  await until(a, () => /the tag opened but carries no message/.test(log()), 8000, "no message");
});

await t.check("Mifare Classic with a key kodeOS knows is read; one with an unknown key is refused", async () => {
  a.nfc.objects().forEach((o) => o.remove());
  a.nfc.card({ type: "mifare1k", uid: "DE:AD:BE:EF", text: "classic hello", near: true });
  await a.press(BTN.BOT);
  await until(a, () => /tag: Mifare Classic, UID DEADBEEF/.test(log()) && /ndef: "classic hello"/.test(log()), 12000, "mifare read");
  a.nfc.objects().forEach((o) => o.remove());
  a.nfc.card({ type: "mifare1k", uid: "DE:AD:BE:EF", text: "secret", keys: { a: "A1B2C3D4E5F6", b: "112233445566" }, near: true });
  await a.press(BTN.BOT);
  await until(a, () => /refused - a Mifare Classic opens only with a key kodeOS knows/.test(log()), 15000, "mifare refused");
});

await t.check("a tag that disappears mid-read: 'stopped answering'", async () => {
  a.nfc.objects().forEach((o) => o.remove());
  a.nfc.tag({ text: "tear me", near: true }).dropAfter(1);   // the capability-container read passes, the next exchange finds it gone
  await a.press(BTN.BOT);
  await until(a, () => /the tag stopped answering - hold it still/.test(log()), 8000, "lost tag");
});

await t.check("the device shuts down cleanly with the bench still populated", () => { a.shutdown(); });
process.exit(t.done("nfc_read"));
