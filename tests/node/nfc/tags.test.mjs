// Type-2 tags through the public kode_nfc_* API (the tiny app tests/node/nfc/apps/nfc_api runs one call per command).
// Everything above the seam is the real SDK; the strings asserted here are what the SDK actually answers
// (several differ from docs/bench-spec.md, which is noted in docs/STATUS-nfc.md).
import { apiDriver, assert, bootNfc, bootReady, runner, sleep, until } from "./bench.mjs";

const t = runner();
const a = await bootReady("nfc_api", "nfc_api ready");
const cmd = apiDriver(a);
const nfc = a.nfc;
const clear = () => nfc.objects().forEach((o) => o.remove());
const timed = async (line) => { const t0 = Date.now(); const r = await cmd(line); return [r, Date.now() - t0]; };

await t.check("1. read a text tag; the nfc_tag event carries the model and the UID", async () => {
  const tag = nfc.tag({ uid: "04:A2:3B:91:5C:6D:80", text: "hello", near: true });
  assert.equal(await cmd("read text 1000"), 'READ ok "hello"');
  await until(a, () => /app EVENT nfc_tag source=Ultralight \/ NTAG \(Type-2\) text=04:A2:3B:91:5C:6D:80/.test(a.logText()), 3000, "nfc_tag event");
  assert.equal(await cmd("id 1000"), "ID ok 04:A2:3B:91:5C:6D:80 | Ultralight / NTAG (Type-2)");
  const info = tag.info();
  assert.ok(info.reads >= 2, "the device read the tag: " + info.reads);
  assert.equal(info.writes, 0);
});

await t.check("2. read a link tag; asking for text instead fails; the other way round too", async () => {
  clear();
  const tag = nfc.tag({ uri: "https://kode.diy", near: true });
  assert.equal(await cmd("read uri 1000"), 'READ ok "https://kode.diy"');
  assert.equal(await cmd("read text 1000"), "READ fail: the tag holds a link, not text");
  tag.update({ text: "plain" });
  assert.equal(await cmd("read uri 1000"), "READ fail: the tag holds text, not a link");
  assert.equal(await cmd("read URI 1000").then((r) => r.startsWith("READ fail")), true, "type names are any case; text is not a link");
  assert.equal(await cmd("read TEXT 1000"), 'READ ok "plain"');
});

await t.check("2b. every URI prefix the tag can use is expanded on read", async () => {
  clear();
  const tag = nfc.tag({ uri: "https://www.kode.diy/a", near: true });
  for (const uri of ["https://www.kode.diy/a", "http://www.x.org", "http://x.org/p?q=1", "mailto:dev@kode.diy", "tel:+5511999990000", "urn:nfc:ext:a:b", "ftp://files.example/x"]) {
    tag.update({ uri });
    assert.equal(await cmd("read uri 1000"), `READ ok "${uri}"`);
  }
});

await t.check("3. no tag: read_id blocks for its time and fails; ms = 0 fails at once", async () => {
  clear();
  const [r, dt] = await timed("id 500");
  assert.equal(r, "ID fail: no NFC tag in 500 ms");
  assert.ok(dt >= 450 && dt < 4000, "blocked about 500 ms: " + dt);
  const [r0, dt0] = await timed("id 0");
  assert.equal(r0, "ID fail: no NFC tag in 0 ms");
  assert.ok(dt0 < 1500, "ms = 0 returns at once: " + dt0);
  assert.equal(await cmd("read text 0"), "READ fail: no NFC tag in 0 ms");
  assert.equal(await cmd("write text 0 x"), "WRITE fail: no NFC tag in 0 ms");
  assert.equal(a.nfc.state().field, false, "the field is down again after the windows");
});

await t.check("4. a tag arrives during the wait and is read by the call in progress", async () => {
  clear();
  const p = cmd("read text 3000");
  await sleep(400);
  const t0 = Date.now();
  nfc.tag({ text: "just in time", near: true });
  assert.equal(await p, 'READ ok "just in time"');
  assert.ok(Date.now() - t0 < 2000, "answered soon after the tag arrived");
});

await t.check("5. a tag removed mid-write: the write fails after its time, the tag keeps a half-written message", async () => {
  clear();
  const tag = nfc.tag({ text: "original text here", near: true });
  const before = tag.memory();
  tag.dropAfter(2);          // the capability-container read and the first block go through, the second block finds nothing
  const [r, dt] = await timed("write text 1200 a brand new message that is longer than the old one");
  assert.equal(r, "WRITE fail: no NFC tag in 1200 ms");   // the SDK treats a lost tag as an empty window and keeps looking
  assert.ok(dt >= 1100, "kept looking for the tag for its whole time: " + dt);
  const info = tag.info();
  assert.equal(info.near, false);
  assert.equal(info.writes, 1, "one block was written before the tag left");
  const after = tag.memory();
  const diff = after.reduce((n, b, i) => n + (b !== before[i] ? 1 : 0), 0);
  assert.ok(diff >= 1 && diff <= 4, "exactly the first block changed (" + diff + " bytes)");
  const newLen = nfc.ndef.encode([{ type: "text", text: "a brand new message that is longer than the old one" }]).length;
  assert.equal(after[17], newLen, "the first block carries the NEW TLV length, over the OLD message: a corrupt half-written tag");
  assert.ok(a.events.some((e) => e.type === "dropped" && e.id === tag.id) || (a.poll(), a.events.some((e) => e.type === "dropped")), "the page was told it left");
});

await t.check("5b. removed and brought back within the call's time: the write is retried and completes", async () => {
  clear();
  const tag = nfc.tag({ text: "original", near: true });
  tag.dropAfter(1);
  const p = cmd("write text 4000 second attempt wins");
  await until(a, () => !tag.info().near, 3000, "the tag to leave");
  await sleep(300);
  tag.near();
  assert.equal(await p, "WRITE ok");
  assert.equal(tag.content().text, "second attempt wins");
});

await t.check("6. write too long for the tag: refused before anything is written", async () => {
  clear();
  const tag = nfc.tag({ memory: "ultralight", text: "x", near: true });     // 48 bytes of NDEF area
  const before = tag.memory();
  assert.equal(await cmd("write text 1000 " + "a".repeat(60)), "WRITE fail: the data does not fit on the tag");
  assert.deepEqual(tag.memory(), before, "not a byte changed");
  assert.equal(tag.info().writes, 0);
  assert.equal(await cmd("write text 1000 " + "b".repeat(36)), "WRITE ok");           // 3 bytes of TLV + 4 of record header + 3 of text header + 36 = 46 of 48
  assert.equal(tag.content().text, "b".repeat(36));
});

await t.check("7. locked tags: read-only capability container, and lock bits the chip enforces", async () => {
  clear();
  const tag = nfc.tag({ text: "ro", locked: true, lockMode: "cc", near: true });
  assert.equal(await cmd("write text 1000 new"), "WRITE fail: this card cannot be written (Ultralight / NTAG (Type-2))");
  assert.equal(tag.info().writes, 0);
  assert.equal(await cmd("read text 1000"), 'READ ok "ro"', "a locked tag still reads");
  tag.setLocked(true, "chip");     // the CC says read/write, the chip's lock bits NAK
  assert.equal(await cmd("write text 1000 new"), "WRITE fail: the tag could not be written");
  assert.equal(tag.content().text, "ro");
  tag.setLocked(false);
  assert.equal(await cmd("write text 1000 now writable"), "WRITE ok");
  assert.equal(tag.content().text, "now writable");
});

await t.check("8. unformatted (blank) tag: reads and writes fail, no 'not implemented'", async () => {
  clear();
  nfc.tag({ formatted: false, near: true });
  assert.equal(await cmd("read text 1000"), "READ fail: the tag holds no text or link");
  assert.equal(await cmd("write text 1000 hi"), "WRITE fail: the tag could not be written");
  assert.equal(await cmd("id 1000"), "ID ok 04:11:22:33:44:55:66 | Ultralight / NTAG (Type-2)");
});

await t.check("9. an NDEF message with no text or link record reads as 'holds no text or link'", async () => {
  clear();
  nfc.tag({ records: [{ type: "mime", mime: "text/vcard", data: "BEGIN:VCARD" }], near: true });
  assert.equal(await cmd("read text 1000"), "READ fail: the tag holds no text or link");
  clear();
  nfc.tag({ records: [{ type: "mime", mime: "x/y", data: "1" }, { type: "text", text: "second record", lang: "pt" }], near: true });
  assert.equal(await cmd("read text 1000"), 'READ ok "second record"', "the first text or link record is the one read");
});

await t.check("10. text too long to return; a write over 95 bytes is refused, never cut", async () => {
  clear();
  const tag = nfc.tag({ memory: "ntag215", text: "q".repeat(100), near: true });
  assert.equal(await cmd("read text 1000"), "READ fail: the tag's text is too long");
  tag.update({ text: "z".repeat(95) });
  assert.equal(await cmd("read text 1000"), `READ ok "${"z".repeat(95)}"`, "95 bytes is the most it returns");
  const before = tag.memory();
  assert.equal(await cmd("write text 1000 " + "c".repeat(96)), "WRITE fail: 96 bytes is too long (95 at most)");
  assert.deepEqual(tag.memory(), before);
  assert.equal(await cmd("write text 1000 " + "d".repeat(95)), "WRITE ok");
  assert.equal(tag.content().text, "d".repeat(95));
});

await t.check("11. write and read back; a link over a text; the device's writes reach the page as events", async () => {
  clear();
  a.events.length = 0;
  const tag = nfc.tag({ text: "old", near: true });
  assert.equal(await cmd("write text 1000 Olá, Kode!"), "WRITE ok");
  assert.equal(await cmd("read text 1000"), 'READ ok "Olá, Kode!"');
  assert.equal(tag.content().text, "Olá, Kode!");
  assert.equal(tag.content().lang, "en");
  assert.equal(await cmd("write uri 1000 https://kode.diy/docs"), "WRITE ok");
  assert.equal(await cmd("read uri 1000"), 'READ ok "https://kode.diy/docs"');
  assert.equal(tag.content().uri, "https://kode.diy/docs");
  await until(a, () => a.events.filter((e) => e.type === "written").length >= 2, 3000, "written events");
  const w = a.events.filter((e) => e.type === "written");
  assert.equal(w[0].id, tag.id);
  assert.equal(w[0].content.text, "Olá, Kode!");
  assert.equal(w.at(-1).content.uri, "https://kode.diy/docs");
  assert.ok(w.at(-1).writes > 0);
  const raw = tag.memory();
  assert.deepEqual(Array.from(raw.subarray(0, 8)), [0x04, 0x11, 0x22, 0x88 ^ 0x04 ^ 0x11 ^ 0x22, 0x33, 0x44, 0x55, 0x66], "identity pages are not touched by writes");
});

await t.check("12. content changed from the bench while the tag is near: the next read sees it", async () => {
  clear();
  const tag = nfc.tag({ text: "first", near: true });
  assert.equal(await cmd("read text 1000"), 'READ ok "first"');
  tag.update({ text: "second" });
  assert.equal(await cmd("read text 1000"), 'READ ok "second"');
  tag.update({ uid: "04:99:88:77:66:55:44" });
  assert.equal(await cmd("id 1000"), "ID ok 04:99:88:77:66:55:44 | Ultralight / NTAG (Type-2)");
});

await t.check("13. a tag that never answers (muted) is never found; an absent tag neither", async () => {
  clear();
  const tag = nfc.tag({ text: "dead", near: true, mute: true });
  assert.equal(await cmd("id 400"), "ID fail: no NFC tag in 400 ms");
  tag.setMute(false);
  assert.equal(await cmd("id 400"), "ID ok 04:11:22:33:44:55:66 | Ultralight / NTAG (Type-2)");
  tag.away();
  assert.equal(await cmd("id 400"), "ID fail: no NFC tag in 400 ms");
});

await t.check("14. two tags near: the lower id is activated (the antenna sees one)", async () => {
  clear();
  nfc.tag({ uid: "04:00:00:00:00:00:01", text: "one", near: true });
  nfc.tag({ uid: "04:00:00:00:00:00:02", text: "two", near: true });
  assert.equal(await cmd("read text 1000"), 'READ ok "one"');
});

await t.check("15. tag memory sizes: ultralight, ntag213, ntag215, ntag216 read back and report the model", async () => {
  for (const memory of ["ultralight", "ntag213", "ntag215", "ntag216"]) {
    clear();
    nfc.tag({ memory, text: "size " + memory, near: true });
    assert.equal(await cmd("read text 1000"), `READ ok "size ${memory}"`);
  }
});

await t.check("16. nothing left behind: field down, no 'not implemented' log", () => {
  assert.equal(nfc.state().field, false);
  assert.doesNotMatch(a.logText() + a.logs.join("\n"), /not implemented/);
});

a.shutdown();
process.exit(t.done("tags"));
