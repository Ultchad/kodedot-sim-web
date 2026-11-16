// Busy, off and unaimed cases, and the bench objects' lifecycle, over the real kode_ir_* / AO_Ir / knec.c and the fake kdrv_ir.
import { bootIr, check, done, sleep, needRadio } from "./bench.mjs";

const a = await bootIr("ir_api");
needRadio(a, "link");
const tv = a.ir.tv({ name: "TV" });
const rem = a.ir.remote({ name: "Remote" });
const sends = () => a.ir.state().sends;

// ---- objects come and go at run time
check(a.ir.objects().length === 2 && tv.id !== rem.id && /^tv\d+$/.test(tv.id) && /^remote\d+$/.test(rem.id), "a TV and a Remote were created (ids are kind + a running number)", a.ir.objects().map((o) => o.id));
const tv2 = a.ir.tv({ name: "Bedroom" });
check(tv2.id !== tv.id && a.ir.objects().length === 3, "a second TV can be added", tv2.id);
await a.fn("send", "nec;0xFB04;0x08");
await a.waitFor(() => tv.state().power && tv2.state().power, 3000, "both TVs on");
check(tv.state().power && tv2.state().power, "one transmission reaches every TV that is aimed at the Dot");
tv2.remove();
check(a.ir.get(tv2.id) === null && a.ir.objects().length === 2 && a.events.some((e) => e.type === "removed" && e.id === tv2.id), "a TV can be removed; 'removed' is emitted");
await sleep(250);

// ---- pointing at the Dot: no
tv.update({ power: false }); tv.clearLog(); tv.aim(false);
await a.fn("send", "nec;0xFB04;0x08");
await sleep(300);
check(!tv.state().power && tv.log().length === 0, "a TV not pointing at the Dot hears nothing and does not react", tv.log());
tv.aim(true);
rem.aim(false);
let r = await rem.press("Power");
check(!r.ok && /not pointed/.test(r.reason), "an unaimed Remote is not heard, and says why", r);
rem.aim(true);
await sleep(250);

// ---- the Dot's IR is off (link down): every call refused, nothing heard, nothing leaves
const s0 = sends();
a.ir.configure({ link: false });
let s = await a.fn("send", "nec;0xFB04;0x08");
check(/^send ok=0/.test(s), "with the IR block down kode_ir_send fails", s);
check(sends() === s0 && a.ir.state().sendRefused >= 1, "nothing left the Dot, the refusal is counted", a.ir.state());
r = await rem.press("Power");
check(!r.ok && r.frames[0].code === -1, "the Remote's frame is lost: the block is down", r);
a.ir.configure({ link: true });
await sleep(300);
r = await rem.press("Power");
check(r.ok || r.frames[0].code === 0, "link back up: a frame is either heard or (receiver not yet re-armed) reported as lost", r);
await a.waitArmed();
await sleep(300);

// ---- emitter dark: accepted, nothing leaves
tv.update({ power: false }); tv.clearLog();
a.ir.configure({ txDark: true });
s = await a.fn("send", "nec;0xFB04;0x08");
await sleep(300);
check(s === "send ok=1" && a.ir.state().txLost >= 1 && !tv.state().power, "a dead emitter: the send is accepted, the TV hears nothing, the loss is counted", [s, a.ir.state().txLost]);
a.ir.configure({ txDark: false });
await sleep(250);

// ---- receiver deaf / not fitted
a.ir.configure({ rxDeaf: true });
await a.waitArmed();
r = await rem.press("Power");
check(!r.ok && r.frames[0].code === -2, "a deaf receiver: the Remote's frame is dropped", r);
a.ir.configure({ rxDeaf: false });
await sleep(250);

// ---- receiver not armed (nobody is listening): the frame is lost, as on the board; a later arming hears the next one
a.ir.configure({ disarm: true });
r = await rem.press("Power");
check(!r.ok && r.frames[0].code === 0, "an unarmed receiver loses the frame", r);

// ---- a transmission in flight: a second one is refused by the driver (KODE_DENIED) and the app's retry/queue logic copes
tv.update({ power: true, volume: 20 }); tv.clearLog();
const long = []; for (let i = 0; i < 400; i++) long.push(i % 2 ? 700 : 600);   // about 260 ms
const first = a.txRaw(long.slice(0, 400), 38000);
await a.waitFor(() => a.ir.state().txBusy, 10000, "the long train on the air");
check(a.ir.state().txBusy, "while a long train is on the air the emitter reports busy", a.ir.state());
s = await a.fn("send", "nec;0xFB04;0x02");
await first;
await sleep(500);
const refused = a.ir.state().sendRefused;
console.log("# busy case: app answered", JSON.stringify(s), "refusals", refused, "tv log", JSON.stringify(tv.log().map((e) => e.type + ":" + (e.action || ""))));
check(refused >= 1, "the driver refused the second send while one was in flight (KODE_DENIED, counted)", refused);
check(s === "send ok=1" && tv.log().some((e) => e.type === "nec" && e.action === "vol+"), "AO_Ir retried it after the frame: it went out and the TV applied it", { s, log: tv.log() });
check(a.ir.state().txBusy === false, "the emitter is free again after the frame");

check(a.stubLines().filter((l) => /ir_|knec|rmt|radio/i.test(l)).length === 0, "no stub fired for an IR function", a.stubLines().slice(0, 4));
done(a, "link");
