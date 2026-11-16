// The UNMODIFIED SDK example examples/rfid_read, end to end: the top button asks AO_Rfid (kode_sys_rfid_read) for a
// 2 s read window; the answer is logged. Real AO_Rfid, real kdrv_rfid_lf.c, real EM4100 decoder, over bench objects.
import { bootRfid, check, done, sleep, pkgPath } from "./bench.mjs";
import { BTN } from "../harness.mjs";

const a = await bootRfid("rfid_read");
await a.waitFor(() => a.logText().includes("up; the top button reads a tag"), 20000, "example up");
const press = async () => { a.button(BTN.TOP, true); await sleep(80); a.button(BTN.TOP, false); };
const logs = () => a.logText();
const countOf = (re) => (logs().match(re) || []).length;

// 1. nothing on the antenna: the window runs its 2 s and answers "no tag"
let t0 = Date.now();
await press();
await a.waitFor(() => /no tag in 2000 ms/.test(logs()), 15000, "no tag");
const dt = Date.now() - t0;
check(dt >= 1900 && dt < 9000, "no card: the 2 s window ends with 'no tag in 2000 ms'", dt + " ms");
a.rfid.poll();
check(/reading for up to 2000 ms, hold a tag on the antenna/.test(logs()), "the example said it was reading");
check(a.events.some((e) => e.type === "carrier" && e.on) && a.events.some((e) => e.type === "carrier" && !e.on), "the field came up for the window and went down after it");
const c = a.rfid.carrier();
check(!c.on && c.pullHigh && !c.boost, "front end at rest after the window (carrier off, RFID_PULL released, no boost)", c);

// 2. a card on the antenna: decoded at once, bit rate reported
const card = a.rfid.createCard({ name: "Fob", id: "01:02:03:04:05" });
a.rfid.bringNear(card.key);
t0 = Date.now();
await press();
await a.waitFor(() => /tag 0102030405, read at RF\/64/.test(logs()), 15000, "tag read");
a.rfid.poll();
check(Date.now() - t0 < 1900, "card present: answered well before the window ends", Date.now() - t0 + " ms");
check(a.events.some((e) => e.type === "card-read" && e.id === "01:02:03:04:05"), "glue event card-read for the object");

// 3. a different card
a.rfid.takeAway(card.key);
const card2 = a.rfid.createCard({ name: "Fob 2", id: "DE:AD:BE:EF:01" });
a.rfid.bringNear(card2.key);
await press();
await a.waitFor(() => /tag DEADBEEF01, read at RF\/64/.test(logs()), 15000, "second tag");
check(true, "a second, different card reads as its own ID");

// 4. a RF/32 card
a.rfid.takeAway(card2.key);
const card3 = a.rfid.createCard({ name: "RF32", id: "12:34:56:78:9A", rf: 32 });
a.rfid.bringNear(card3.key);
await press();
await a.waitFor(() => /tag 123456789A, read at RF\/32/.test(logs()), 15000, "rf32 tag");
check(true, "an RF/32 card reads, reported as RF/32");

// 5. card taken away: back to 'no tag'
a.rfid.takeAway(card3.key);
const before = countOf(/no tag in 2000 ms/g);
await press();
await a.waitFor(() => countOf(/no tag in 2000 ms/g) > before, 15000, "no tag again");
check(true, "card taken away: 'no tag' again");
const stubs = (a.logText() + "\n" + a.logs.join("\n")).split("\n").filter((l) => /not implemented/.test(l));
check(!stubs.some((l) => /rfid|pwm|parlio|pcnt|adc|ldo|gpio_/i.test(l)), "no 'dotbench: ... not implemented' stub fired for an RFID, PWM or peripheral function", stubs.slice(0, 5));
done(a, "example_rfid_read");
