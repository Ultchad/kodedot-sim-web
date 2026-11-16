// kode_rfid_emulate_start/stop and kode_sys_rfid_is_emulating against a door reader. The SDK builds the EM4100
// modulation and the PARLIO loop (real kdrv_rfid_lf.c); the bench captures the bit stream and decodes it as a door
// reader would, with its own decoder, if the reader's field is on and its clock fits.
import { bootRfid, check, done, sleep } from "./bench.mjs";

const a = await bootRfid("rfid_api");
const R = a.rfid;
const emu = (id) => a.fn("emu", id);
const stop = () => a.fn("emustop");
const seen = async (key, pred, ms = 3000) => {
  const t0 = Date.now();
  for (;;) { const s = R.get(key).seen; if (pred(s)) return s; if (Date.now() - t0 > ms) return R.get(key).seen; await sleep(25); }
};

// --- reader on the door, field on
const D = R.createReader({ name: "Door", expectedId: "01:02:03:04:05" });
R.bringNear(D.key);
check((await a.fn("isemu")) === "isemu 0", "nothing emulated at first");
let mark = a.events.length;
let r = await emu("01:02:03:04:05");
check(r === "emu ok=1 emulating=1", "emulate_start returns once the tag plays; is_emulating is true", r);
let s = await seen(D.key, (x) => x.visible);
check(s.visible && s.id === "01:02:03:04:05" && s.match && s.count === 1, "the door reader decodes the ID and it matches the expected one", s);
const em = R.emulation();
check(em.active && em.decodes && em.id === "01:02:03:04:05" && em.external && em.clockHz === 125000 && em.periodsPerBit === 64,
  "the PARLIO loop is clocked from the reader's 125 kHz field (external), 64 carrier periods per bit", em);
R.poll();
let ev = a.events.slice(mark);
check(ev.some((e) => e.type === "field-measured" && e.hz === 125000), "the device measured the reader's field: 125000 Hz (PCNT on RFID_CARRIER)");
check(ev.some((e) => e.type === "emulation" && e.active && e.id === "01:02:03:04:05" && e.external), "glue event emulation {active}");
check(ev.some((e) => e.type === "reader-saw" && e.key === D.key && e.visible && e.match), "glue event reader-saw {visible, match}");
check((await a.fn("isemu")) === "isemu 1", "is_emulating stays true");

// --- a tag already played is replaced; the reader sees the new ID and no match
mark = a.events.length;
r = await emu("DE:AD:BE:EF:01");
check(r === "emu ok=1 emulating=1", "start again with another ID replaces the tag", r);
s = await seen(D.key, (x) => x.visible && x.id === "DE:AD:BE:EF:01");
check(s.visible && s.id === "DE:AD:BE:EF:01" && s.match === false && s.count === 2, "the reader now sees DE:AD:BE:EF:01 and it does not match the expected ID", s);
check(R.emulation().id === "DE:AD:BE:EF:01", "the decoded loop carries the new ID");
R.update(D.key, { expectedId: "DE:AD:BE:EF:01" });
check(R.get(D.key).seen.match === true, "changing the reader's expected ID re-judges what it saw");
R.update(D.key, { expectedId: "01:02:03:04:05" });

// --- calls take turns: read and write refuse while a tag plays
r = await a.fn("read", 1000);
check(r === "read ok=0 err=RFID is emulating a tag; kode_rfid_emulate_stop() ends it", "read while emulating fails at once with the documented text", r);
r = await a.fn("write", "01:02:03:04:05;1000");
check(r === "write ok=0 err=RFID is emulating a tag; kode_rfid_emulate_stop() ends it", "write while emulating fails the same way", r);

// --- stop
mark = a.events.length;
r = await stop();
check(r === "emustop ok=1 emulating=0", "emulate_stop: nothing is emulated any more", r);
s = await seen(D.key, (x) => !x.visible);
check(!s.visible, "the reader no longer sees a tag", s);
check(!R.emulation().active, "the PARLIO loop is gone");
check(a.events.slice(mark).some((e) => e.type === "emulation" && !e.active), "glue event emulation {active: false}");
r = await stop();
check(r === "emustop ok=1 emulating=0", "stopping again, with none playing, is also ok (as documented)", r);
r = await a.fn("read", 800);
check(r === "read ok=0 err=no RFID tag in 800 ms", "after the stop a read works again (the front end is free)", r);

// --- bad IDs
r = await emu("01:02:03");
check(r === "emu ok=0 err=an EM4100 ID is 5 bytes ('01:02:03')", "emulate a 3-byte ID: refused with the documented text", r);
check(!R.emulation().active, "and nothing plays");

// --- reader field OFF at start: the device finds no field and uses its own clock; the reader sees nothing until the field is on
R.update(D.key, { fieldOn: false });
mark = a.events.length;
r = await emu("01:02:03:04:05");
check(r === "emu ok=1 emulating=1", "emulation starts with no reader field", r);
const em2 = R.emulation();
check(em2.active && em2.decodes && !em2.external && em2.clockHz === 125000, "no field measured: the internal clock plays the tag", em2);
R.poll();
check(a.events.slice(mark).some((e) => e.type === "field-measured" && e.hz === 0), "event field-measured with 0 Hz");
await sleep(300);
check(!R.get(D.key).seen.visible, "the reader's field is off: it sees nothing");
R.update(D.key, { fieldOn: true });
s = await seen(D.key, (x) => x.visible);
check(s.visible && s.id === "01:02:03:04:05" && s.match, "the reader's field comes on: it reads the internally clocked tag", s);
await stop();

// --- reader away, then brought up
R.takeAway(D.key);
mark = a.events.length;
await emu("01:02:03:04:05");
await sleep(300);
check(R.emulation().active && !R.get(D.key).seen.visible, "reader not near: the tag plays, nobody reads it");
R.bringNear(D.key);
s = await seen(D.key, (x) => x.visible);
check(s.visible && s.match, "bringing the device to the reader makes it read the tag", s);
// the reader's detection delay is respected
await stop();
R.update(D.key, { delayMs: 400 });
const t0 = Date.now();
await emu("01:02:03:04:05");
s = await seen(D.key, (x) => x.visible, 3000);
const dt = Date.now() - t0;
check(s.visible && dt >= 350, "reader delayMs=400: it shows the ID only after its poll delay", dt + " ms");
await stop();
R.update(D.key, { delayMs: 50 });

// --- other reader frequencies
for (const [hz, ext, clk, ppb, label] of [[134200, true, 134200, 64, "134.2 kHz"], [62500, true, 62500, 32, "62.5 kHz"]]) {
  R.update(D.key, { fieldHz: hz });
  await emu("01:02:03:04:05");
  const e2 = R.emulation();
  s = await seen(D.key, (x) => x.visible);
  check(e2.external === ext && e2.clockHz === clk && e2.periodsPerBit === ppb && s.visible && s.id === "01:02:03:04:05",
    `${label} reader: external clock ${clk} Hz, ${ppb} periods per bit, the reader reads it`, [e2, s]);
  await stop();
}
R.update(D.key, { fieldHz: 100000 });
await emu("01:02:03:04:05");
await sleep(400);
check(R.emulation().active && !R.emulation().external && !R.get(D.key).seen.visible, "a 100 kHz reader is no class the device follows; its internal 125 kHz timing is 25% off: not read");
await stop();
R.update(D.key, { fieldHz: 125000 });

// --- decode of many IDs from the PARLIO stream
let all = true;
for (const id of ["00:00:00:00:01", "FF:FF:FF:FF:FF", "80:00:00:00:00", "5A:A5:5A:A5:5A", "12:34:56:78:9A"]) {
  await emu(id);
  const e3 = R.emulation();
  if (!(e3.decodes && e3.id === id)) all = false;
  s = await seen(D.key, (x) => x.visible && x.id === id);
  if (!(s.visible && s.id === id)) all = false;
}
check(all, "five more IDs round-trip device -> PARLIO bit stream -> door reader");
await stop();
check((await a.fn("isemu")) === "isemu 0", "finally nothing plays");
done(a, "emulate");
