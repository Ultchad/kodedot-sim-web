// The public IR API (kode.h) over the bench objects: NEC both ways, repeats, the ir_received event, silence, bad arguments,
// no echo of the Dot's own sends. Real kode_ir_*, AO_Ir and knec.c; the TV decodes with its own (independent) decoder.
import { bootIr, check, done, sleep, needRadio } from "./bench.mjs";

const a = await bootIr("ir_api");
needRadio(a, "api_nec");
const tv = a.ir.tv({ name: "TV" });
const rem = a.ir.remote({ name: "Remote" });
// Silence: kode_ir_receive fails. The SDK's blocking wrapper waits only ONE tick (1 ms) past AO_Ir's own deadline, so on this runtime's
// pthread tick about half of the silent calls give up first and report "the infrared receiver did not answer" instead of
// "no infrared signal in N ms" (STATUS-ir.md, known issue 1). Both are a failed receive with nothing heard; the exact AO-level
// answer (KODE_TIMEOUT) is asserted in example_ir_remote.test.mjs.
const silent = (s, ms) => new RegExp(`^recv ok=0 err=(no infrared signal in ${ms} ms|the infrared receiver did not answer)$`).test(s);

// ---- Dot sends, TV receives and decodes
let s = await a.fn("send", "nec;0xFB04;0x08");
check(s === "send ok=1", "kode_ir_send('nec', 0xFB04, 8) succeeds", s);
await a.waitFor(() => tv.state().power, 3000, "TV on");
let e = tv.log().at(-1);
check(e.type === "nec" && e.addr === 0xfb04 && e.cmd === 0x0008 && e.action === "power", "the TV decoded NEC address 0xFB04 command 0x0008 and toggled power", e);
const tx = a.events.filter((x) => x.type === "tx").at(-1);
check(tx.n === 34 && tx.carrier === 38000, "the Dot transmitted 34 symbols at 38 kHz", tx);
check(tx.durUs > 90000 && tx.durUs < 96000, "frame time is about 93 ms (leader, 32 bits, stop mark and the closing 32.8 ms gap)", tx.durUs);

await sleep(250);
s = await a.fn("send", "NEC;0xFB04;0x02");   // any case
await a.waitFor(() => tv.state().volume === 21, 3000, "vol+");
check(tv.state().volume === 21, "'NEC' in capitals works and Vol+ raised the volume", tv.state());
await sleep(250);
await a.fn("send", "nec;0xFB04;0x03");
await a.waitFor(() => tv.state().volume === 20, 3000, "vol-");
check(tv.state().volume === 20, "Vol- lowered it");
await sleep(250);
await a.fn("send", "nec;0x1234;0x08");
await a.waitFor(() => tv.log().some((x) => x.type === "ignored"), 3000, "ignored");
check(/wrong address 0x1234/.test(tv.log().at(-1).why) && tv.state().power, "a frame for another address is ignored and logged; the TV state is unchanged", tv.log().at(-1));
await sleep(250);
await a.fn("send", "nec;0xFB04;0x7F");
await a.waitFor(() => tv.log().length >= 5, 3000, "no action");
check(tv.log().at(-1).type === "nec" && /no action/.test(tv.log().at(-1).why), "a command with no action is logged as such", tv.log().at(-1));
await sleep(250);

// ---- bad arguments, exactly as the SDK reports them
s = await a.fn("send", "sony;1;2");
check(s === "send ok=0 err=protocol 'sony' not supported", "unsupported protocol is refused by the SDK", s);
s = await a.fn("send", "nec;65536;1");
check(/ok=0 err=address 65536 is out of range/.test(s), "address above 65535 is refused", s);
s = await a.fn("send", "nec;1;65536");
check(/ok=0 err=command 65536 is out of range/.test(s), "command above 65535 is refused", s);
const sendsBefore = a.ir.state().sends;
check(sendsBefore === 5, "only the five good sends reached the link", sendsBefore);

// ---- Remote sends, the Dot receives
const recv = a.fn("recv", 5000);
await a.waitArmed(); await sleep(150);
let r = await rem.press("Power");
check(r.ok, "Remote.press('Power') was heard", r);
s = await recv;
check(s === "recv ok=1 proto=NEC addr=0xFB04 cmd=0x0008", "kode_ir_receive decoded NEC 0xFB04 / 8", s);
a.ir.poll();
let ev = null;
await a.waitFor(() => /RES event source=NEC value=8 text=0xFB04/.test(a.logText()), 3000, "event");
check(true, "the ir_received event carried source NEC, value 8, text 0xFB04");
s = await a.fn("last");
check(s === "last ok=1 proto=NEC addr=0xFB04 cmd=0x0008", "kode_ir_last() returns the same code", s);

// classic helper: address 0x04 / command 0x08 become the words 0xFB04 / 0xF708
const classic = a.ir.remote({ name: "Classic", classic: true, address: 0x04, buttons: { Power: 0x08 } });
const recv2 = a.fn("recv", 5000);
await a.waitArmed(); await sleep(150);
await classic.press("Power");
s = await recv2;
check(s === "recv ok=1 proto=NEC addr=0xFB04 cmd=0xF708", "a classic remote (addr 0x04, cmd 0x08) arrives as the words 0xFB04 / 0xF708", s);
classic.remove();

// ---- silence
let t0 = Date.now();
s = await a.fn("recv", 500);
check(silent(s, 500) && Date.now() - t0 >= 450, "silence: the receive fails after its 500 ms and nothing is reported heard", s);

// ---- repeats: a held key is NEC once, then 'unknown'
const first = a.fn("recv", 5000);
await a.waitArmed(); await sleep(150);
rem.down("Vol+");
s = await first;
check(s === "recv ok=1 proto=NEC addr=0xFB04 cmd=0x0002", "the first frame of a held key is NEC", s);
s = await a.fn("recv", 2000);
check(/^recv ok=1 proto=unknown addr=0x0000 cmd=0x0000$/.test(s), "the next frame, a repeat, reads as protocol 'unknown'", s);
await sleep(250);
const held = rem.up();
check(held.frames.length >= 3 && held.frames.slice(1).every((f) => f.repeat), "the Remote repeated (108 ms apart) while held", held.frames.map((f) => f.code));
// repeats stopped: silence follows
await sleep(300);
s = await a.fn("recv", 400);
check(silent(s, 400), "after release the repeats stop", s);

// ---- the Dot's own sends are not an input
await a.fn("send", "nec;0xFB04;0x08");
s = await a.fn("recv", 600);
check(silent(s, 600), "no echo of the Dot's own send is delivered (default)", s);
check(a.ir.state().echoes === 0, "the link delivered no echo", a.ir.state());
await sleep(300);
a.ir.configure({ echo: true });
await a.fn("send", "nec;0xFB04;0x08");
s = await a.fn("recv", 900);
check(silent(s, 900), "with echo on, the echo comes back but AO_Ir's deaf window drops it", s);
check(a.ir.state().echoes === 1, "(the echo did reach the receiver)", a.ir.state());
a.ir.configure({ echo: false });

check(a.stubLines().filter((l) => /ir_|knec|rmt|radio/i.test(l)).length === 0, "no stub fired for an IR function", a.stubLines().slice(0, 4));
done(a, "api_nec");
