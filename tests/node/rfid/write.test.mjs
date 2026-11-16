// kode_rfid_write() scenarios: the SDK's real clone routine drives the carrier gaps (start gap, bit gaps, three
// blocks), the bench decodes them into T5577 blocks, and the SDK's own read-back verifies.
import { bootRfid, check, done, sleep } from "./bench.mjs";

const a = await bootRfid("rfid_api");
const R = a.rfid, g = a.glue;
const wr = (id, ms = 3000) => a.fn("write", `${id};${ms}`);
const read = (ms) => a.fn("read", ms);
const NOTAKEN = "write ok=0 err=the tag did not take the ID (is it a T5577?)";

// --- blank T5577, write, read back
const T = R.createTag({ name: "Blank" });
R.bringNear(T.key);
check(R.get(T.key).id === null && R.get(T.key).blocks[0] === 0x000880e0, "the tag starts factory-blank (config 000880E0, reads as nothing)");
let mark = a.events.length;
let r = await wr("01:02:03:04:05");
check(r === "write ok=1", "write to a blank T5577 succeeds (the SDK read it back)", r);
const t = R.get(T.key);
const want = g.blocksForId("01:02:03:04:05");
check(t.blocks[0] === 0x00148040 && t.blocks[1] === want[1] && t.blocks[2] === want[2], "the SDK programmed config 00148040 then the two frame halves, equal to the bench's own encoder", t.blocks.map((x) => x.toString(16)));
check(t.id === "01:02:03:04:05", "the tag now reads back as that EM4100 ID", t.id);
const ev = a.events.slice(mark);
const blocks = ev.filter((e) => e.type === "block-written").map((e) => e.block);
check(JSON.stringify(blocks) === "[0,1,2]", "events: blocks 0, 1, 2 programmed in order", blocks);
check(ev.some((e) => e.type === "tag-written" && e.key === T.key && e.id === "01:02:03:04:05"), "event tag-written with the new ID");
check(ev.some((e) => e.type === "boost" && e.on) && ev.some((e) => e.type === "boost" && !e.on), "VO4 boost was raised for the write and released after");
check(ev.some((e) => e.type === "carrier" && e.on) && !R.carrier().on, "field up for the write, down after");
r = await read(2000);
check(r === "read ok=1 id=01:02:03:04:05 name=EM4100", "a later read sees the written ID", r);

// --- overwrite (rewritable), with the other ID syntaxes
for (const [txt, id] of [["aa-bb-cc-dd-ee", "AA:BB:CC:DD:EE"], ["12 34 56 78 9a", "12:34:56:78:9A"], ["0A0B0C0D0E", "0A:0B:0C:0D:0E"], ["FF:FF:FF:FF:FF", "FF:FF:FF:FF:FF"]]) {
  r = await wr(txt);
  check(r === "write ok=1" && R.get(T.key).id === id, `rewrite with '${txt}' -> ${id}`, [r, R.get(T.key).id]);
  check(JSON.stringify(R.get(T.key).blocks.slice(0, 3)) === JSON.stringify(g.blocksForId(id).slice(0, 3)), `  blocks match the independent frame encoder for ${id}`);
}
r = await read(2000);
check(r === "read ok=1 id=FF:FF:FF:FF:FF name=EM4100", "read back after the last rewrite", r);

// --- bad IDs never reach the field
mark = a.events.length;
r = await wr("01:02:03");
check(r === "write ok=0 err=an EM4100 ID is 5 bytes ('01:02:03')", "bad ID: 'an EM4100 ID is 5 bytes ('01:02:03')'", r);
r = await wr("zz:zz:zz:zz:zz");
check(/^write ok=0 err=an EM4100 ID is 5 bytes/.test(r), "non-hex ID refused", r);
check(!a.events.slice(mark).some((e) => e.type === "carrier" && e.on), "a bad ID never raises the field");
R.takeAway(T.key);

// --- nothing on the antenna
mark = a.events.length;
r = await wr("01:02:03:04:05");
check(r === NOTAKEN, "write with no tag present fails: 'the tag did not take the ID (is it a T5577?)'", r);
check(a.events.slice(mark).some((e) => e.type === "write-rejected" && e.reason === "no tag in the field"), "the bench saw the downlink with no tag to take it (event write-rejected)");
check(JSON.stringify(R.get(T.key).blocks.slice(0, 3)) === JSON.stringify(g.blocksForId("FF:FF:FF:FF:FF").slice(0, 3)), "the tag that was away is untouched");

// --- a non-writable EM4100 card on the antenna
const C = R.createCard({ name: "Fob", id: "77:66:55:44:33" });
R.bringNear(C.key);
mark = a.events.length;
r = await wr("01:02:03:04:05");
check(r === NOTAKEN, "write to a read-only EM4100 card fails", r);
check(R.get(C.key).id === "77:66:55:44:33", "the card keeps its ID");
check(a.events.slice(mark).some((e) => e.type === "write-rejected"), "event write-rejected: nothing on the antenna can be programmed");
r = await read(1500);
check(r === "read ok=1 id=77:66:55:44:33 name=EM4100", "the card still reads as itself", r);
// ... writing the card's own ID "succeeds": the read-back matches (same on a real board)
r = await wr("77:66:55:44:33");
check(r === "write ok=1", "writing the very ID the card already shows reads back equal (as on hardware)", r);
R.takeAway(C.key);

// --- write-protected T5577
const P = R.createTag({ name: "Protected", writeProtected: true });
R.bringNear(P.key);
mark = a.events.length;
r = await wr("01:02:03:04:05");
check(r === NOTAKEN && R.get(P.key).id === null && R.get(P.key).blocks[0] === 0x000880e0, "write-protected T5577: write fails, tag unchanged", [r, R.get(P.key).blocks[0]]);
check(a.events.slice(mark).filter((e) => e.type === "write-rejected" && e.reason === "tag is write protected").length === 3, "three blocks were tried and refused");
R.update(P.key, { writeProtected: false });
r = await wr("01:02:03:04:05");
check(r === "write ok=1" && R.get(P.key).id === "01:02:03:04:05", "lifting the protection lets the same write through", r);
R.takeAway(P.key);

// --- locked config block of a tag configured for a mode the reader cannot read (FSK)
const L = R.createTag({ name: "Locked", blocks: [0x00004060, 0, 0, 0, 0, 0, 0, 0], locks: 0x01 });
R.bringNear(L.key);
mark = a.events.length;
r = await wr("01:02:03:04:05");
check(r === NOTAKEN, "locked config block: the config stays, the tag cannot be read back, write fails", r);
const lt = R.get(L.key);
check(lt.blocks[0] === 0x00004060 && lt.blocks[1] === g.blocksForId("01:02:03:04:05")[1], "blocks 1 and 2 were programmed, block 0 refused");
check(a.events.slice(mark).some((e) => e.type === "write-rejected" && e.reason === "block is locked"), "event write-rejected: block is locked");
R.takeAway(L.key);

// --- tag taken away mid-write (scripted: leaves after the first block)
const M = R.createTag({ name: "Leaves", leaveAfterBlocks: 1 });
R.bringNear(M.key);
mark = a.events.length;
r = await wr("01:02:03:04:05");
const mt = R.get(M.key);
check(r === NOTAKEN, "tag removed after block 0: the write fails", r);
check(a.events.slice(mark).some((e) => e.type === "object-left" && e.key === M.key), "event object-left");
check(mt.near === false && mt.blocks[0] === 0x00148040 && mt.blocks[1] === 0 && mt.id === null, "the tag was left half written: config yes, data no, reads as nothing", mt.blocks.map((x) => x.toString(16)));
// bring it back: a second try completes the job
R.bringNear(M.key);
r = await wr("01:02:03:04:05");
check(r === "write ok=1" && R.get(M.key).id === "01:02:03:04:05", "put back, the next write completes it", [r, R.get(M.key).id]);
R.takeAway(M.key);

// --- ms=0 writes nothing
mark = a.events.length;
R.bringNear(T.key);
r = await wr("01:02:03:04:05", 0);
check(/^write ok=0 err=/.test(r) && !a.events.slice(mark).some((e) => e.type === "block-written"), "ms=0: the field is held for no time, nothing is written", r);
R.takeAway(T.key);

// --- the SDK's frame equals the bench's for more IDs (cross-check of the encoder against the SDK through the tag)
const X = R.createTag({ name: "X" });
R.bringNear(X.key);
let allMatch = true;
for (const id of ["00:00:00:00:01", "FF:FF:FF:FF:FF", "DE:AD:BE:EF:01", "06:00:12:AB:CD"]) {
  const rr = await wr(id);
  const tb = R.get(X.key).blocks, wb = g.blocksForId(id);
  if (rr !== "write ok=1" || tb[1] !== wb[1] || tb[2] !== wb[2]) allMatch = false;
}
check(allMatch, "the SDK's krfid_em4100_frame (via the programmed blocks) equals the bench encoder for 4 more IDs");
done(a, "write");
