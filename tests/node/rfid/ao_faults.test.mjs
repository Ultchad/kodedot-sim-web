// The Active Object API (kode_sys_rfid_read / _write / _emulate_start / _emulate_stop answered by RFID_OP_RSP_SIG and
// RFID_EMU_RSP_SIG), the busy rule, and the front-end faults. KODE_OK 0, KODE_ERROR 1, KODE_TIMEOUT 2, KODE_DENIED 3.
import { bootRfid, check, done, sleep } from "./bench.mjs";

const a = await bootRfid("rfid_api");
const R = a.rfid;
const ask = async (name, arg, re, ms) => a.fn(name, arg, ms);
const op = async (name, arg, ms = 12000) => {   // an ask is taken ("RES ask kind=.. taken=0") and answered later ("RES op ..."/"RES emursp ...")
  const before = a.res().length;
  a.type("function name=\"" + name + "\"" + (arg === undefined ? "" : " arg=" + (typeof arg === "string" ? JSON.stringify(arg) : arg)));
  const t0 = Date.now();
  for (;;) {
    const lines = a.res().slice(before).map((l) => l.slice(l.indexOf("RES ") + 4));
    const taken = lines.find((l) => l.startsWith("ask "));
    const rsp = lines.find((l) => l.startsWith("op ") || l.startsWith("emursp "));
    if (taken && rsp) return { taken, rsp };
    if (Date.now() - t0 > ms) throw new Error("no answer: " + JSON.stringify(lines));
    await sleep(25);
  }
};

// --- kode_sys_rfid_read: timeout, then card
let x = await op("aread", 600);
check(x.taken === "ask kind=1 taken=0" && x.rsp === "op write=0 rc=2 id=00:00:00:00:00 rf=0", "kode_sys_rfid_read, no card: the ask is taken, the answer is KODE_TIMEOUT", x);
const A = R.createCard({ id: "01:02:03:04:05" });
R.bringNear(A.key);
x = await op("aread", 2000);
check(x.rsp === "op write=0 rc=0 id=01:02:03:04:05 rf=64", "kode_sys_rfid_read, card: KODE_OK with the ID and RF/64", x);
R.takeAway(A.key);

// --- kode_sys_rfid_write
const T = R.createTag({});
R.bringNear(T.key);
x = await op("awrite", "01:02:03:04:05");
check(x.rsp === "op write=1 rc=0 id=01:02:03:04:05 rf=0" && R.get(T.key).id === "01:02:03:04:05", "kode_sys_rfid_write on a T5577: KODE_OK, the answer carries the written ID; the tag reads back", x);
R.takeAway(T.key);
x = await op("awrite", "AA:BB:CC:DD:EE");
check(x.rsp === "op write=1 rc=2 id=AA:BB:CC:DD:EE rf=0", "kode_sys_rfid_write with no tag: KODE_TIMEOUT (the read-back did not match)", x);

// --- kode_sys_rfid_emulate_start / is_emulating / emulate_stop
const D = R.createReader({ expectedId: "01:02:03:04:05" });
R.bringNear(D.key);
x = await op("aemu", "01:02:03:04:05");
check(x.rsp === "emursp stop=0 rc=0 emulating=1", "kode_sys_rfid_emulate_start: KODE_OK, is_emulating true", x);
await sleep(200);
check(R.get(D.key).seen.visible && R.get(D.key).seen.id === "01:02:03:04:05", "the door reader reads the AO-started tag");
x = await op("aemu", "DE:AD:BE:EF:01");
check(x.rsp === "emursp stop=0 rc=3 emulating=1" && R.emulation().id === "01:02:03:04:05", "a second AO start while one plays is KODE_DENIED and changes nothing (only kode.h's start replaces a tag: it stops first)", x);
x = await op("aemustop");
check(x.rsp === "emursp stop=1 rc=0 emulating=0", "kode_sys_rfid_emulate_stop: KODE_OK, nothing emulated", x);
x = await op("aemustop");
check(x.rsp === "emursp stop=1 rc=3 emulating=0", "stop with nothing playing: KODE_DENIED (the AO API is strict; kode.h's stop is lenient)", x);

// --- busy: a task read holds the front end, an AO ask is refused (DENIED) while it runs; both then work
const startedRead = a.cmd('function name="read" arg=3000', /^read /, 15000);
await a.waitEvent((e) => e.type === "carrier" && e.on, 5000, a.events.length - 1);
await sleep(300);
x = await op("aread", 500);
check(x.rsp === "op write=0 rc=3 id=00:00:00:00:00 rf=0", "request while a read is in flight: KODE_DENIED (busy)", x);
check((await startedRead) === "read ok=0 err=no RFID tag in 3000 ms", "the first read is unaffected and ends at its own deadline");
x = await op("aread", 500);
check(x.rsp.startsWith("op write=0 rc=2"), "afterwards the front end takes requests again", x);

// --- task API while an AO ask holds the front end: the call does not succeed; the AO's busy refusal reaches the caller only as the generic read/write failure
{
  const held = op("aread", 3000, 15000);
  await sleep(300);
  const t1 = Date.now();
  const rb = await a.fn("read", 1000, 15000);
  check(rb === "read ok=0 err=no RFID tag in 1000 ms" && Date.now() - t1 >= 900, "kode_rfid_read_id while an AO read holds the front end waits its time, then fails as a timeout (busy is not distinguishable)", [rb, Date.now() - t1]);
  const rw = await a.fn("write", "01:02:03:04:05;500", 15000);
  check(rw === "write ok=0 err=the tag did not take the ID (is it a T5577?)", "kode_rfid_write likewise fails (generic write failure)", rw);
  const h = await held;
  check(h.rsp.startsWith("op write=0 rc=2"), "the AO read that held it ends normally", h);
}

// --- faults
R.setFault({ adcDead: true });
let t0 = Date.now();
let r = await a.fn("read", 500, 20000);
check(r === "read ok=0 err=no RFID tag in 500 ms", "ADC delivers nothing: a read still ends as 'no tag' (a missing front end cannot be told from an empty field)", r);
check(Date.now() - t0 < 15000, "and ends in bounded time", Date.now() - t0 + " ms");
R.bringNear(A.key);
r = await a.fn("read", 500, 20000);
check(r === "read ok=0 err=no RFID tag in 500 ms", "even with a card present", r);
R.setFault({});
r = await a.fn("read", 2000);
check(r === "read ok=1 id=01:02:03:04:05 name=EM4100", "fault cleared: the card reads", r);
R.takeAway(A.key);
R.setFault({ noCarrier: true });
const mark = a.events.length;
r = await a.fn("read", 1000);
check(r === "read ok=0 err=no RFID tag in 1000 ms", "carrier cannot start: AO_Rfid folds every failed window into KODE_TIMEOUT, so a read says 'no tag'", r);
check(/the carrier would not start/.test(a.logText()), "but the driver logged 'the carrier would not start'");
R.poll();
check(!a.events.slice(mark).some((e) => e.type === "carrier" && e.on), "and no carrier ever came up");
R.bringNear(T.key);
r = await a.fn("write", "11:22:33:44:55;2000");
check(r === "write ok=0 err=the tag did not take the ID (is it a T5577?)" && R.get(T.key).id !== "11:22:33:44:55", "a write cannot reach the tag either", r);
x = await op("aread", 500);
check(!R.carrier().on && x.rsp.startsWith("op write=0 rc=2"), "the AO API answers KODE_TIMEOUT and the field stays down", x);
R.takeAway(T.key);
R.setFault({});
r = await a.fn("read", 800);
check(r === "read ok=0 err=no RFID tag in 800 ms" && R.carrier().pullHigh, "fault cleared: normal again, receiver back at rest", r);
done(a, "ao_faults");
