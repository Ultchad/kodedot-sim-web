// The UNMODIFIED SDK example examples/ir_remote, end to end: the top button learns a key (kode_sys_ir_capture, then kode_sys_ir_last),
// the bottom button sends it back (kode_sys_ir_send_nec). Real AO_Ir, real knec.c, over the Remote and TV bench objects.
import { bootIr, check, done, sleep } from "./bench.mjs";
import { BTN } from "../harness.mjs";

const a = await bootIr("ir_remote");
await a.waitFor(() => a.logText().includes("up; the top button learns a remote key"), 20000, "example up");
const logs = () => a.logText();
const press = async (id) => { a.button(id, true); await sleep(80); a.button(id, false); };
const tv = a.ir.tv({ name: "TV" });
const rem = a.ir.remote({ name: "Remote" });
check(!tv.state().power && tv.state().volume === 20, "a new TV is off, volume 20", tv.state());

// 1. bottom button before anything was learned
await press(BTN.BOT);
await a.waitFor(() => /nothing learned yet/.test(logs()), 10000, "nothing learned");
check(a.ir.state().sends === 0, "nothing learned: nothing was sent");

// 2. learn Power from the Remote
await press(BTN.TOP);
await a.waitFor(() => /listening for 10 s/.test(logs()), 10000, "listening");
await a.waitArmed();   // the first request of a boot brings the C5 link up (AO_Radio), then AO_Ir arms the receiver
let r = await rem.press("Power");
check(r.ok, "the Remote's Power frame reached the Dot", r);
await a.waitFor(() => /learned NEC addr=0xFB04 cmd=0x0008/.test(logs()), 10000, "learned");
check(true, "the example learned NEC addr=0xFB04 cmd=0x0008 (the SDK's own decoder read the Remote's frame)");
const ev = a.events.filter((e) => e.type === "remote");
check(ev.length === 1 && ev[0].reason.startsWith("heard"), "remote event reported the frame as heard", ev);

// 3. send it back: the TV decodes the Dot's frame and powers on
await sleep(200);
await press(BTN.BOT);
await a.waitFor(() => /sending NEC addr=0xFB04 cmd=0x0008/.test(logs()), 10000, "sending");
await a.waitFor(() => tv.state().power, 5000, "TV on");
const tx = await a.waitEvent((e) => e.type === "tx");
check(tx.nec && tx.nec.addr === 0xfb04 && tx.nec.cmd === 8 && tx.carrier === 38000 && tx.heardBy.join() === tv.id, "tx event: NEC 0xFB04/0x0008 at 38 kHz heard by the TV", tx);
check(tx.n === 34, "the frame is 34 symbols (leader, 32 bits, stop)", tx.n);
const e1 = tv.log().at(-1);
check(e1.type === "nec" && e1.addr === 0xfb04 && e1.cmd === 8 && e1.action === "power" && e1.applied, "TV log: NEC power applied", e1);
check(tv.state().power === true, "TV is on");

// 4. learn Vol+ and send it: volume 21
await press(BTN.TOP);
await a.waitFor(() => (logs().match(/listening for 10 s/g) || []).length === 2, 10000, "listening again");
await sleep(150);   // AO_Ir's own deaf window after its send has closed
r = await rem.press("Vol+");
check(r.ok, "Vol+ frame reached the Dot", r);
await a.waitFor(() => /learned NEC addr=0xFB04 cmd=0x0002/.test(logs()), 10000, "learned vol+");
await sleep(200);
await press(BTN.BOT);
await a.waitFor(() => tv.state().volume === 21, 5000, "volume 21");
check(tv.state().volume === 21, "the learned Vol+ raised the TV volume to 21");

// 5. a key of another remote (wrong address): the example learns it, the TV ignores it
const other = a.ir.remote({ name: "Other", address: 0x1234, buttons: { Go: 0x08 } });
await press(BTN.TOP);
await a.waitFor(() => (logs().match(/listening for 10 s/g) || []).length === 3, 10000, "listening 3");
await sleep(150);
await other.press("Go");
await a.waitFor(() => /learned NEC addr=0x1234 cmd=0x0008/.test(logs()), 10000, "learned other");
await sleep(200);
const before = tv.state().power;
await press(BTN.BOT);
await a.waitFor(() => tv.log().some((e) => e.type === "ignored" && /wrong address 0x1234/.test(e.why)), 5000, "ignored");
check(tv.state().power === before, "a frame with another address does not change the TV");

// 6. an unaimed remote is not heard, and a held key's repeat decodes as 'not NEC' (the example says so)
rem.aim(false);
await press(BTN.TOP);
await a.waitFor(() => (logs().match(/listening for 10 s/g) || []).length === 4, 10000, "listening 4");
r = await rem.press("Power");
check(!r.ok && /not pointed/.test(r.reason), "an unaimed Remote is not heard", r);
rem.aim(true);
await sleep(100);
r = await rem.hold("Power", 330);
check(r.frames.length >= 3, "hold sent the first frame and repeat frames", r.frames.length);
await a.waitFor(() => /learned NEC addr=0xFB04 cmd=0x0008/.test(logs().split("listening for 10 s").at(-1)), 10000, "learned after hold");
check(true, "the first frame of a hold was learned");

// 7. nobody there: the learning window ends with AO_Ir's own KODE_TIMEOUT, exactly (kode_sys_ir_capture, no blocking wrapper in between)
await sleep(200);
await press(BTN.TOP);
const t0 = Date.now();
await a.waitFor(() => /nothing heard in 10 s/.test(logs()), 20000, "learning window timeout");
const dt = Date.now() - t0;
check(dt >= 9500 && dt < 14000, "silence: the 10 s learning window ends with 'nothing heard in 10 s' (KODE_TIMEOUT)", dt + " ms");

check(a.stubLines().filter((l) => /ir_|knec|rmt|radio/i.test(l)).length === 0, "no 'dotbench: ... not implemented' stub fired for an IR function", a.stubLines().slice(0, 5));
done(a, "example_ir_remote");
