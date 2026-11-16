// Card emulation (the Dot plays a card, a bench reader object reads it) and background scanning, through kode_nfc_*.
import { apiDriver, assert, bootNfc, bootReady, runner, until } from "./bench.mjs";

const t = runner();
const a = await bootReady("nfc_api", "nfc_api ready");
const cmd = apiDriver(a);
const nfc = a.nfc;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clear = () => nfc.objects().forEach((o) => o.remove());
const seenSessions = async (r, n) => { await until(a, () => r.seen().sessions >= n, 8000, "reader session " + n); return r.seen(); };

await t.check("E1. text profile: the reader sees an NXP-style 7-byte UID, ATQA 0x0044, SAK 0 and reads the NDEF text from the Type-2 image", async () => {
  assert.equal(await cmd("profile card1 text hello emu"), "PROFILE ok");
  assert.equal(await cmd("emu card1"), "EMU ok");
  const r = nfc.reader({ near: true });
  const s = await seenSessions(r, 1);
  assert.match(s.uid, /^04(:[0-9A-F]{2}){6}$/);
  assert.equal(s.atqa, 0x44);
  assert.equal(s.sak, 0);
  assert.deepEqual(s.records, [{ type: "text", lang: "en", text: "hello emu" }]);
  assert.ok(s.pages.length >= 16, "the reader read the capability container and message pages: " + s.pages.length);
});

await t.check("E2. uri profile reads back as a link", async () => {
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  assert.equal(await cmd("profile web uri https://kode.diy/emu"), "PROFILE ok");
  assert.equal(await cmd("emu web"), "EMU ok");
  const r = nfc.reader({ near: true });
  const s = await seenSessions(r, 1);
  assert.equal(s.records[0].type, "uri");
  assert.equal(s.records[0].uri, "https://kode.diy/emu");
  r.remove();
});

await t.check("E3. uid profile clones the given UID verbatim (4 bytes: SAK 0x08 Classic-style)", async () => {
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  assert.equal(await cmd("profile u uid 04:A2:3B:91"), "PROFILE ok");
  assert.equal(await cmd("emu u"), "EMU ok");
  const r = nfc.reader({ near: true });
  const s = await seenSessions(r, 1);
  assert.equal(s.uid, "04:A2:3B:91");
  assert.equal(s.sak, 0x08);
});

await t.check("E4. while emulating, read_id / read / scan_start are refused with the SDK's message; stop is idempotent", async () => {
  const busy = "NFC is emulating a card; kode_nfc_emulate_stop() ends it";
  assert.equal(await cmd("id 300"), "ID fail: " + busy);
  assert.equal(await cmd("read text 300"), "READ fail: " + busy);
  assert.equal(await cmd("scanstart"), "SCANSTART fail: " + busy);
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  await until(a, () => nfc.state().emulating === false, 3000, "emulation stopped");
});

await t.check("E5. after the stop the reader no longer meets the card, and the Dot reads a real tag again", async () => {
  clear();
  const r = nfc.reader({ near: true });
  await sleep(400);
  assert.equal(r.seen().sessions, 0);
  nfc.tag({ text: "back to reading", near: true });
  assert.equal(await cmd("read text 2000"), 'READ ok "back to reading"');
  clear();
});

await t.check("E6. a reader brought near after the start, and a restart with a replaced profile", async () => {
  assert.equal(await cmd("profile one text first"), "PROFILE ok");
  assert.equal(await cmd("emu one"), "EMU ok");
  const r = nfc.reader();
  await sleep(300);
  assert.equal(r.seen().sessions, 0, "not near yet");
  r.near();
  assert.equal((await seenSessions(r, 1)).records[0].text, "first");
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  assert.equal(await cmd("profile one text second"), "PROFILE ok", "same name replaces the profile");
  assert.equal(await cmd("emu one"), "EMU ok");
  r.away(); r.near();
  assert.equal((await seenSessions(r, 1)).records[0].text, "second");
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  clear();
});

await t.check("E7. a reader that is away sees nothing; two readers both see the card", async () => {
  assert.equal(await cmd("emu one"), "EMU ok");
  const far = nfc.reader();
  const n1 = nfc.reader({ near: true });
  await seenSessions(n1, 1);
  assert.equal(far.seen().sessions, 0);
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
  clear();
});

await t.check("E8. unhappy: unknown profile, bad UID, bad type, ninth profile", async () => {
  assert.equal(await cmd("emu nosuch"), "EMU fail: no emulation profile 'nosuch'; add one with kode_nfc_add_profile()");
  assert.equal(await cmd("profile bad uid xyz"), "PROFILE fail: a UID is 4, 7 or 10 bytes of hex, such as 04:A2:3B:91");
  const out = [];
  for (let i = 0; i < 9; i++) out.push(await cmd("profile p" + i + " text x"));
  assert.ok(out.includes("PROFILE fail: all 8 emulation profiles are in use"), out.join(" | "));
  assert.equal(out[0], "PROFILE ok");
});

await t.check("E9. scan vs emulate are mutually exclusive; scan_stop is idempotent", async () => {
  assert.equal(await cmd("scanstart"), "SCANSTART ok");
  assert.equal(await cmd("emu one"), "EMU fail: NFC is reading; kode_nfc_scan_stop() ends it");
  assert.equal(await cmd("scanstop"), "SCANSTOP ok");
  assert.equal(await cmd("scanstop"), "SCANSTOP ok");
  assert.equal(await cmd("emu one"), "EMU ok");
  assert.equal(await cmd("emustop"), "EMUSTOP ok");
});

await t.check("S1. scanning raises nfc_tag events for a tag in the field, about once a second, and stops on scan_stop", async () => {
  clear();
  const tag = nfc.tag({ uid: "04:11:22:33:44:55:66", text: "scan me", near: true });
  assert.equal(await cmd("scanstart"), "SCANSTART ok");
  await until(a, () => (a.logText().match(/EVENT nfc_tag/g) || []).length >= 2, 8000, "two nfc_tag events");
  assert.match(a.logText(), /EVENT nfc_tag source=Ultralight \/ NTAG \(Type-2\) text=04:11:22:33:44:55:66/);
  assert.equal(await cmd("scanstop"), "SCANSTOP ok");
  await sleep(300);
  const n = (a.logText().match(/EVENT nfc_tag/g) || []).length;
  await sleep(1500);
  assert.equal((a.logText().match(/EVENT nfc_tag/g) || []).length, n, "no events after scan_stop");
  tag.remove();
});

await t.check("S2. scanning with nothing near raises no event; a tag arriving later does", async () => {
  const before = (a.logText().match(/EVENT nfc_tag/g) || []).length;
  assert.equal(await cmd("scanstart"), "SCANSTART ok");
  await sleep(1500);
  assert.equal((a.logText().match(/EVENT nfc_tag/g) || []).length, before);
  nfc.tag({ uid: "04:99:88:77:66:55:44", text: "late", near: true });
  await until(a, () => (a.logText().match(/EVENT nfc_tag/g) || []).length > before, 8000, "event for the late tag");
  assert.equal(await cmd("scanstop"), "SCANSTOP ok");
  clear();
});

a.shutdown();
process.exit(t.done("emulation"));
