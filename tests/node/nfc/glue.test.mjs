// The JS glue's pure parts: NDEF encode/decode and the initial-memory builders (no device needed).
import assert from "node:assert/strict";
import { KIND, decodeMemory, decodeNdef, encodeNdef, findTlv, hex, mifareImage, parseHex, t2tImage, t4File, wrapTlv } from "../../../runtime/drivers/nfc/nfc.js";
import { runner } from "./bench.mjs";

const t = runner();

await t.check("G1. NDEF text and URI records round-trip, including URI prefix compression", () => {
  const recs = [{ type: "text", lang: "de", text: "Grüße" }, { type: "uri", uri: "https://www.example.com/a?b=1" }, { type: "uri", uri: "tel:+4930123" }];
  const msg = encodeNdef(recs);
  assert.deepEqual(decodeNdef(msg), recs);
  assert.ok(msg.length < 70, "the https://www. prefix is a one byte code");
});

await t.check("G2. a long record uses the long form; unknown records survive as 'unknown'", () => {
  const big = "x".repeat(300);
  assert.equal(decodeNdef(encodeNdef([{ type: "text", lang: "en", text: big }]))[0].text, big);
  const u = decodeNdef(Uint8Array.from([0xD4, 0x03, 0x02, 0x61, 0x62, 0x01, 0x02]));
  assert.equal(u[0].type, "unknown");
});

await t.check("G3. TLV wrapper: short and long length forms; findTlv skips NULL and unknown TLVs", () => {
  const m = encodeNdef([{ type: "text", lang: "en", text: "hi" }]);
  const w = wrapTlv(m);
  assert.equal(w[0], 0x03); assert.equal(w[1], m.length); assert.equal(w.at(-1), 0xFE);
  assert.deepEqual(Array.from(findTlv(w)), Array.from(m));
  assert.deepEqual(Array.from(findTlv(Uint8Array.from([0, 0, 0x01, 0x02, 0xAA, 0xBB, ...w]))), Array.from(m));
  const long = encodeNdef([{ type: "text", lang: "en", text: "y".repeat(400) }]);
  const lw = wrapTlv(long);
  assert.equal(lw[1], 0xFF);
  assert.equal(findTlv(lw).length, long.length);
  assert.equal(findTlv(Uint8Array.from([0xFE])), null);
});

await t.check("G4. Type-2 images: UID, BCC bytes, capability container, sizes, formatted:false", () => {
  const m = t2tImage({ uid: "04:A2:3B:91:5C:6D:80", memory: "ntag215", text: "hello" });
  assert.equal(m.length, 540);
  assert.deepEqual(Array.from(m.subarray(0, 3)), [0x04, 0xA2, 0x3B]);
  assert.equal(m[3], 0x88 ^ 0x04 ^ 0xA2 ^ 0x3B, "BCC0");
  assert.equal(m[12], 0xE1);
  assert.equal(m[14], 504 / 8, "CC size byte: the data area in 8 byte units");
  assert.equal(decodeMemory(KIND.T2T, m).text, "hello");
  const blank = t2tImage({ memory: "ntag213", formatted: false });
  assert.equal(decodeMemory(KIND.T2T, blank).formatted, false);
  assert.equal(t2tImage({ memory: "ultralight" }).length, 64);
});

await t.check("G5. Mifare images: layout, default NDEF keys vs blank vs custom keys", () => {
  const m = mifareImage({ text: "classic" });
  assert.equal(m.length, 1024);
  assert.equal(decodeMemory(KIND.MIFARE, m).text, "classic");
  const blank = mifareImage({ blank: true });
  assert.deepEqual(Array.from(blank.subarray(3 * 16, 3 * 16 + 6)), [255, 255, 255, 255, 255, 255]);
  assert.equal(decodeMemory(KIND.MIFARE, blank).records.length, 0);
  const custom = mifareImage({ text: "s", keys: { a: "A1B2C3D4E5F6", b: "0102030405AB" } });
  assert.equal(hex(custom.subarray(7 * 16, 7 * 16 + 6), ""), "A1B2C3D4E5F6");
});

await t.check("G6. Type-4 file: NLEN then message, padded to the file size", () => {
  const f = t4File({ text: "t4", fileSize: 64 });
  assert.equal(f.length, 64);
  const msg = encodeNdef([{ type: "text", lang: "en", text: "t4" }]);
  assert.equal((f[0] << 8) | f[1], msg.length);
  assert.deepEqual(Array.from(f.subarray(2, 2 + msg.length)), Array.from(msg));
  assert.equal(decodeMemory(KIND.T4T, f).text, "t4");
});

await t.check("G7. hex helpers", () => {
  assert.deepEqual(Array.from(parseHex("04:a2-3B 91")), [4, 0xA2, 0x3B, 0x91]);
  assert.deepEqual(Array.from(parseHex("04A23B91")), [4, 0xA2, 0x3B, 0x91], "contiguous pairs");
  assert.equal(hex(Uint8Array.from([1, 0xAB])), "01:AB");
  assert.equal(hex(Uint8Array.from([1, 0xAB]), ""), "01AB");
});

process.exit(t.done("glue"));
