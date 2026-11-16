// Unit tests of the EM4100 frame encoder/decoder and ID formats (glue helpers and the bench's C encoder),
// against fixed vectors and against each other. No device is needed for the JS part; the C encoder is read from
// a booted module.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { check, done, bootRfid } from "./bench.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const g = await import(pathToFileURL(path.join(here, "../../../runtime/drivers/rfid/rfid.js")).href);
const hex64 = (v) => v.toString(16).toUpperCase().padStart(16, "0");

// Vectors derived by hand from the EM4100 layout (9 header ones, ten rows of 4 data bits + even row parity, four even
// column parities, stop 0) and, for the first ones, spot-checked bit by bit; the same frames are cross-checked against
// the SDK's own krfid_em4100_frame() through what it programs onto a T5577 (write.test.mjs).
const VECTORS = [
  ["00:00:00:00:00", "FF80000000000000"],
  ["FF:FF:FF:FF:FF", "FFFBDEF7BDEF7BC0"],
  ["01:02:03:04:05", "FF8060280C048142"],
  ["DE:AD:BE:EF:01", "FFEFB4DDFBDF0062"],
  ["06:00:12:AB:CD", "FF818000CB4BE36A"],
  ["80:00:00:00:01", "FFC4000000000072"],
  ["0F:00:00:00:00", "FF83C0000000001E"],
];
for (const [id, f] of VECTORS) check(hex64(g.encodeFrame(id)) === f, `encodeFrame(${id}) = ${f}`, hex64(g.encodeFrame(id)));

// structure of any frame: header, parities, stop
let structOk = true;
for (let n = 0; n < 300; n++) {
  const id = Uint8Array.from({ length: 5 }, () => Math.floor(Math.random() * 256));
  const bits = g.frameBits(id);
  if (bits.length !== 64 || !bits.slice(0, 9).every((b) => b === 1) || bits[63] !== 0) structOk = false;
  for (let r = 0; r < 10; r++) { const row = bits.slice(9 + 5 * r, 14 + 5 * r); if ((row[0] ^ row[1] ^ row[2] ^ row[3]) !== row[4]) structOk = false; }
  for (let c = 0; c < 4; c++) { let p = 0; for (let r = 0; r < 10; r++) p ^= bits[9 + 5 * r + c]; if (p !== bits[59 + c]) structOk = false; }
  if (Buffer.compare(Buffer.from(g.decodeFrame(bits)), Buffer.from(id)) !== 0) structOk = false;
}
check(structOk, "300 random IDs: 64 bits, 9 header ones, even row and column parity, stop 0, decode round-trips");

// decode errors
const good = g.frameBits("01:02:03:04:05");
const flip = (i) => good.map((b, k) => (k === i ? b ^ 1 : b));
const throws = (bits) => { try { g.decodeFrame(bits); return null; } catch (e) { return e.message; } };
check(/header/.test(throws(flip(3))), "a flipped header bit is rejected");
check(/row parity/.test(throws(flip(12))), "a flipped data bit trips the row parity");
check(/column parity/.test(throws(flip(59))), "a flipped column parity bit is rejected");
check(/stop/.test(throws(flip(63))), "a set stop bit is rejected");
check(throws(good.slice(0, 63)) !== null, "63 bits are not a frame");

// formats
check(g.formatId("01:02:03:04:05") === "01:02:03:04:05", "hex format");
check(g.formatId([1, 2, 3, 4, 5], "plain") === "0102030405", "plain format");
check(g.formatId("01:02:03:04:05", "dec10") === "0033752069", "decimal of the 32-bit number: 0x02030405 = 33752069", g.formatId("01:02:03:04:05", "dec10"));
check(g.formatId("01:02:03:04:05", "version") === 1 && g.formatId("01:02:03:04:05", "number") === 33752069, "version/customer byte and number");
check(g.formatId("FF:00:12:34:56", "facility-card") === "018,13398", "facility,card format (byte 2, low 16 bits)", g.formatId("FF:00:12:34:56", "facility-card"));
check(g.formatId("0A:00:00:00:00", "dec10") === "0000000000", "dec10 pads");
for (const s of ["01:02:03:04:05", "01-02-03-04-05", "01 02 03 04 05", "0102030405", "0x0102030405", "01:02:03:04:5", " 01:02:03:04:05 "])
  check(g.formatId(g.parseId(s)) === "01:02:03:04:05", `parseId('${s}')`);
check(g.formatId(g.parseId({ version: 1, number: 33752069 })) === "01:02:03:04:05", "parseId({version, number})");
for (const bad of ["01:02:03", "0102030405ff", "zz:02:03:04:05", "", "01:02:03:04:05:06", [1, 2, 3, 4, 300]])
  check((() => { try { g.parseId(bad); return false; } catch { return true; } })(), `parseId rejects ${JSON.stringify(bad)}`);

// T5577 helpers
const blocks = g.blocksForId("01:02:03:04:05");
check(blocks[0] === 0x00148040 && blocks[1] === 0xff806028 && blocks[2] === 0x0c048142, "blocksForId = config 00148040 + the two frame halves");
check(g.formatId(g.idFromBlocks(blocks)) === "01:02:03:04:05", "idFromBlocks reads them back");
check(g.idFromBlocks([g.T5577_BLANK_CONFIG, 0, 0, 0, 0, 0, 0, 0]) === null, "a factory-blank T5577 carries no EM4100 ID");
check(g.idFromBlocks([0x00004060, blocks[1], blocks[2], 0, 0, 0, 0, 0]) === null, "an FSK-configured T5577 is not read as EM4100");

// the bench's own C encoder (independent of the SDK's) against the JS one
const a = await bootRfid("rfid_api");
const M = a.M, ip = M._malloc(8), op = M._malloc(8);
let cOk = true;
const ids = VECTORS.map(([id]) => g.parseId(id));
for (let n = 0; n < 200; n++) ids.push(Uint8Array.from({ length: 5 }, () => Math.floor(Math.random() * 256)));
for (const id of ids) {
  M.HEAPU8.set(id, ip);
  M._rfid_frame(ip, op);
  const w = new Uint32Array(M.HEAPU8.buffer.slice(op, op + 8));
  if ((BigInt(w[0]) << 32n | BigInt(w[1])) !== g.encodeFrame(id)) cOk = false;
}
check(cOk, `the C encoder agrees with the JS one on ${ids.length} IDs (7 vectors + 200 random)`);
done(a, "em4100");
