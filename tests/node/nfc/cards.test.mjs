// Cards through the public kode_nfc_* API: ISO-DEP (Type-4) cards, Mifare Classic cards (the SDK's own Crypto1 software
// layer talks to the bench's card model over raw NFC-A frames) and cards the SDK cannot use.
import { apiDriver, assert, bootNfc, bootReady, runner, until } from "./bench.mjs";

const t = runner();
const a = await bootReady("nfc_api", "nfc_api ready");
const cmd = apiDriver(a);
const nfc = a.nfc;
const clear = () => nfc.objects().forEach((o) => o.remove());

// ---- Type 4 (ISO-DEP) -------------------------------------------------------------------------------------------
await t.check("T4. an ISO-DEP card: identified, text and link read through the NDEF application", async () => {
  const card = nfc.card({ type: "iso-dep", uid: "04:AA:BB:CC:DD:EE:FF", text: "from a type 4 card", near: true });
  assert.equal(await cmd("id 1000"), "ID ok 04:AA:BB:CC:DD:EE:FF | Type-4 (ISO-DEP / DESFire)");
  assert.equal(await cmd("read text 1000"), 'READ ok "from a type 4 card"');
  card.update({ uri: "https://kode.diy/t4" });
  assert.equal(await cmd("read uri 1000"), 'READ ok "https://kode.diy/t4"');
  assert.ok(card.info().reads >= 6, "SELECT app, SELECT CC, READ CC, SELECT file, READ NLEN, READ message: " + card.info().reads);
});

await t.check("T4. write and read back; the length field is zeroed first and written last (3 UPDATE BINARY)", async () => {
  clear();
  const card = nfc.card({ type: "iso-dep", text: "old", near: true });
  assert.equal(await cmd("write text 1000 new content"), "WRITE ok");
  assert.equal(card.info().writes, 3);
  assert.equal(card.content().text, "new content");
  assert.equal(await cmd("read text 1000"), 'READ ok "new content"');
  assert.equal(await cmd("write uri 1000 https://example.com/x"), "WRITE ok");
  assert.equal(card.content().uri, "https://example.com/x");
});

await t.check("T4. file too small: refused, nothing written; read-only card (write access denied); no NDEF application", async () => {
  clear();
  const small = nfc.card({ type: "iso-dep", fileSize: 40, text: "x", near: true });
  const before = small.memory();
  assert.equal(await cmd("write text 1000 " + "a".repeat(60)), "WRITE fail: the data does not fit on the tag");
  assert.deepEqual(small.memory(), before);
  clear();
  const ro = nfc.card({ type: "iso-dep", text: "locked card", locked: true, near: true });
  assert.equal(await cmd("write text 1000 nope"), "WRITE fail: the tag could not be written");
  assert.equal(ro.content().text, "locked card");
  assert.equal(await cmd("read text 1000"), 'READ ok "locked card"');
  clear();
  nfc.card({ type: "iso-dep", text: "x", noApp: true, near: true });
  assert.equal(await cmd("read text 1000"), "READ fail: the tag holds no text or link");
  clear();
  nfc.card({ type: "iso-dep", near: true });
  assert.equal(await cmd("read text 1000"), "READ fail: the tag holds no text or link", "an empty file");
});

await t.check("T4. card removed in the middle of the APDU exchange: the read keeps waiting, then times out", async () => {
  clear();
  const card = nfc.card({ type: "iso-dep", text: "x", near: true });
  card.dropAfter(3);
  assert.equal(await cmd("read text 600"), "READ fail: no NFC tag in 600 ms");
  assert.equal(card.info().near, false);
});

// ---- Mifare Classic ---------------------------------------------------------------------------------------------
await t.check("M1. Mifare Classic 1K formatted for NDEF with keys kodeOS knows: identified, read, written, read back", async () => {
  clear();
  const card = nfc.card({ type: "mifare1k", uid: "DE:AD:BE:EF", text: "classic hello", near: true });
  assert.equal(await cmd("id 1000"), "ID ok DE:AD:BE:EF | Mifare Classic 1K");
  assert.equal(await cmd("read text 3000"), 'READ ok "classic hello"');
  const mem0 = card.memory();
  assert.equal(await cmd("write text 3000 rewritten over crypto1"), "WRITE ok");
  assert.equal(card.content().text, "rewritten over crypto1");
  assert.equal(await cmd("read text 3000"), 'READ ok "rewritten over crypto1"');
  const mem1 = card.memory();
  for (const blk of [0, 1, 2, 3, 7, 11, 15, 63]) {
    assert.deepEqual(mem1.subarray(blk * 16, blk * 16 + 16), mem0.subarray(blk * 16, blk * 16 + 16), "block " + blk + " (manufacturer data, MAD, trailers) untouched");
  }
  { const i = card.info(); assert.ok(i.writes >= 1 && i.reads >= 3, "writes " + i.writes + " reads " + i.reads); }
});

await t.check("M2. Mifare Classic 4K and Mini are told apart by SAK, and read the same way", async () => {
  clear();
  nfc.card({ type: "mifare4k", uid: "11:22:33:44", text: "4k card", near: true });
  assert.equal(await cmd("id 1000"), "ID ok 11:22:33:44 | Mifare Classic 4K");
  assert.equal(await cmd("read text 3000"), 'READ ok "4k card"');
  clear();
  nfc.card({ type: "mifaremini", uid: "55:66:77:88", text: "mini card", near: true });
  assert.equal(await cmd("id 1000"), "ID ok 55:66:77:88 | Mifare Mini");
  assert.equal(await cmd("read text 3000"), 'READ ok "mini card"');
});

await t.check("M3. a card whose keys kodeOS does not know cannot be read or written", async () => {
  clear();
  const card = nfc.card({ type: "mifare1k", text: "secret", keys: { a: "A1B2C3D4E5F6", b: "0102030405AB" }, near: true });
  const before = card.memory();
  assert.equal(await cmd("read text 3000"), "READ fail: this card's data cannot be read (Mifare Classic)");
  assert.equal(await cmd("write text 3000 hack"), "WRITE fail: this card cannot be written (Mifare Classic)");
  assert.deepEqual(card.memory(), before);
  assert.equal(await cmd("id 1000"), "ID ok DE:AD:BE:EF | Mifare Classic 1K", "it still identifies");
});

await t.check("M4. a factory-blank card (default keys, no MAD): reads as 'no text or link', takes a write at sector 1", async () => {
  clear();
  const card = nfc.card({ type: "mifare1k", blank: true, near: true });
  assert.equal(await cmd("read text 3000"), "READ fail: the tag holds no text or link");
  assert.equal(await cmd("write text 3000 first message"), "WRITE ok");
  assert.equal(await cmd("read text 3000"), 'READ ok "first message"');
  assert.equal(card.content().text, "first message");
});

await t.check("M5. a read-only card (the card NAKs writes): the write fails, content is unchanged", async () => {
  clear();
  const card = nfc.card({ type: "mifare1k", text: "frozen", locked: true, near: true });
  assert.equal(await cmd("write text 3000 thaw"), "WRITE fail: the tag could not be written");
  assert.equal(card.content().text, "frozen");
  assert.equal(await cmd("read text 3000"), 'READ ok "frozen"');
});

await t.check("M6. message too long for the two NDEF sectors: refused before anything is written", async () => {
  clear();
  const card = nfc.card({ type: "mifare1k", text: "short", near: true });
  const before = card.memory();
  assert.equal(await cmd("write text 3000 " + "w".repeat(94)), "WRITE fail: the data does not fit on the tag");
  assert.deepEqual(card.memory(), before);
});

await t.check("M7. Mifare card removed during authentication: the call finds no card within its time", async () => {
  clear();
  const card = nfc.card({ type: "mifare1k", text: "gone", near: true });
  card.dropAfter(4);     // reselect + auth frames pass, then the card is gone
  assert.equal(await cmd("read text 800"), "READ fail: no NFC tag in 800 ms");
});

// ---- cards the SDK cannot use -----------------------------------------------------------------------------------
await t.check("U1. unsupported card (NFC-DEP / unknown SAK): identified as NFC-A; reading and writing are refused", async () => {
  clear();
  nfc.card({ type: "unsupported", uid: "08:11:22:33", near: true });
  assert.equal(await cmd("id 1000"), "ID ok 08:11:22:33 | NFC-A");
  assert.equal(await cmd("read text 1000"), "READ fail: this card's data cannot be read (NFC-A)");
  assert.equal(await cmd("write text 1000 x"), "WRITE fail: this card cannot be written (NFC-A)");
});

await t.check("U2. nothing 'not implemented' was called, the field is down", () => {
  assert.equal(nfc.state().field, false);
  assert.doesNotMatch(a.logText() + a.logs.join("\n"), /not implemented/);
});

a.shutdown();
process.exit(t.done("cards"));
