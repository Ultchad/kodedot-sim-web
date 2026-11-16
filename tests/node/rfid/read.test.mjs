// kode_rfid_read_id() scenarios through the rfid_api test app: no card, card present, late card, card removed
// mid-read (scripted), two cards in a row, collision, rewritten tags, RF variants.
import { bootRfid, check, done, sleep } from "./bench.mjs";

const a = await bootRfid("rfid_api");
const R = a.rfid;
const read = (ms) => a.fn("read", ms);
const timed = async (p) => { const t0 = Date.now(); const r = await p; return [r, Date.now() - t0]; };

// --- no card: the documented failure, after the whole wait
let [r, dt] = await timed(read(1000));
check(r === "read ok=0 err=no RFID tag in 1000 ms", "no card: 'no RFID tag in 1000 ms'", r);
check(dt >= 950 && dt < 6000, "no card: the call took about the time asked", dt + " ms");
// kode_rfid_read_id(0) "looks for none": it must not touch the field
const ev0 = a.events.length;
[r, dt] = await timed(read(0));
check(/^read ok=0 err=no RFID tag in 0 ms$/.test(r) && dt < 800, "ms=0 fails at once without waiting", [r, dt]);
check(!a.events.slice(ev0).some((e) => e.type === "carrier" && e.on), "ms=0 never raises the field");

// --- card present
const A = R.createCard({ name: "Fob A", id: "01:02:03:04:05" });
R.bringNear(A.key);
[r, dt] = await timed(read(2000));
check(r === "read ok=1 id=01:02:03:04:05 name=EM4100", "card present: the ID and the name EM4100", r);
check(dt < 1500, "card present: decoded within the first windows", dt + " ms");
check(a.events.some((e) => e.type === "card-read" && e.key === A.key && e.id === "01:02:03:04:05" && e.rf === 64), "glue event card-read (RF/64)");
let c = R.carrier();
check(!c.on && c.pullHigh, "field down and receiver at rest after the read", c);

// --- card removed after it was read: the next read finds nothing
R.takeAway(A.key);
r = await read(800);
check(r === "read ok=0 err=no RFID tag in 800 ms", "card taken away: no tag", r);

// --- late card: placed 600 ms into a 4 s read, the read returns as soon as it is on the antenna
const pending = timed(read(4000));
await sleep(600);
R.bringNear(A.key);
[r, dt] = await pending;
check(r === "read ok=1 id=01:02:03:04:05 name=EM4100" && dt >= 550 && dt < 3500, "a card brought in during the wait is read, and the call returns early", [r, dt]);

// --- two different cards in a row
R.takeAway(A.key);
const B = R.createCard({ name: "Fob B", id: "DE:AD:BE:EF:01" });
R.bringNear(B.key);
r = await read(2000);
check(r === "read ok=1 id=DE:AD:BE:EF:01 name=EM4100", "second card B reads as B, not A", r);
R.takeAway(B.key);
R.bringNear(A.key);
r = await read(2000);
check(r === "read ok=1 id=01:02:03:04:05 name=EM4100", "and A again after B left", r);
R.takeAway(A.key);

// --- card edited on the bench (update) changes what is read
R.update(B.key, { id: "00:00:00:00:01" });
R.bringNear(B.key);
r = await read(2000);
check(r === "read ok=1 id=00:00:00:00:01 name=EM4100", "update(card, {id}) is what the next read decodes", r);
R.takeAway(B.key);

// --- card removed mid-read (scripted: it leaves after 1200 modulated samples, less than one frame's 2600)
const C = R.createCard({ name: "Fob C", id: "12:34:56:78:9A", leaveAfterSamples: 1200 });
R.bringNear(C.key);
const mark = a.events.length;
[r, dt] = await timed(read(1500));
check(r === "read ok=0 err=no RFID tag in 1500 ms", "card removed before one frame was seen: the read times out", r);
check(a.events.slice(mark).some((e) => e.type === "object-left" && e.key === C.key), "the card left mid-read (glue event object-left)");
check(R.isNear(C.key) === false, "and it is no longer on the antenna");
// a card that leaves after a whole frame + margin has already been read by then
R.update(C.key, { leaveAfterSamples: 9000 });
R.bringNear(C.key);
r = await read(2000);
check(r === "read ok=1 id=12:34:56:78:9A name=EM4100", "a card that stays long enough is read (leaving later does not matter)", r);
R.takeAway(C.key);
// the front end recovers: next card reads fine
R.bringNear(A.key);
r = await read(2000);
check(r === "read ok=1 id=01:02:03:04:05 name=EM4100", "after an aborted read the next read is clean", r);
R.takeAway(A.key);

// --- other bit rates
const D = R.createCard({ name: "RF/32", id: "AB:CD:EF:01:23", rf: 32 });
R.bringNear(D.key);
r = await read(2000);
check(r === "read ok=1 id=AB:CD:EF:01:23 name=EM4100", "an RF/32 card reads", r);
R.update(D.key, { rf: 16 });
r = await read(2000);
check(/^read ok=(1 id=AB:CD:EF:01:23 name=EM4100|0 err=no RFID tag in 2000 ms)$/.test(r), "an RF/16 card is read or honestly not (decoder limit at 5 samples per half-bit)", r);
R.takeAway(D.key);

// --- collision: two cards on the antenna at once
R.bringNear(A.key); R.bringNear(B.key);
r = await read(1500);
check(r === "read ok=0 err=no RFID tag in 1500 ms", "two cards at once collide: no valid frame, no ID", r);
R.takeAway(A.key); R.takeAway(B.key);

// --- a T5577 already programmed as EM4100 reads as that ID; a blank one reads nothing
const T = R.createTag({ name: "Prog", id: "55:44:33:22:11" });
R.bringNear(T.key);
r = await read(2000);
check(r === "read ok=1 id=55:44:33:22:11 name=EM4100", "a T5577 holding an EM4100 frame reads as that ID", r);
R.takeAway(T.key);
const Z = R.createTag({ name: "Blank" });
R.bringNear(Z.key);
r = await read(1200);
check(r === "read ok=0 err=no RFID tag in 1200 ms", "a factory-blank T5577 reads as no tag", r);
R.takeAway(Z.key);

// --- a door reader's field on the antenna is not a tag
const D2 = R.createReader({});
R.bringNear(D2.key);
r = await read(1000);
check(r === "read ok=0 err=no RFID tag in 1000 ms", "a reader field alone is not a card", r);

done(a, "read");
