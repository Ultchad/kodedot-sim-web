// Raw symbol trains through the whole stack: a non-NEC train from a Remote is heard by kode_ir_receive_raw, replayed with kode_ir_send_raw,
// and the TV sees the same timings; AGC stretch, carrier band, 256-symbol limits, NEC sent as raw, hold-to-repeat of a raw button,
// capture files and their replay.
import { bootIr, check, done, sleep, needRadio } from "./bench.mjs";

const a = await bootIr("ir_api");
needRadio(a, "raw");
const tv = a.ir.tv({ name: "TV" });
const rem = a.ir.remote({ name: "Remote" });
// A capture ends at the idle gap: its last symbol has no space, so kode_ir_receive_raw's list ends with a 0 (kode_ir_capture drops it the same way).
const parseRaw = () => a.rawResult();
const close = (x, y, tol) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= tol);
/** Start a console receive, wait until the receiver listens, run `act` (what the world does), and return what the app logged. */
async function whileListening(cmd, arg, act) {
  const res = a.fn(cmd, arg, 10000);
  await sleep(120); await a.waitArmed(); await sleep(60);
  const r = await act();
  return { r, s: await res };
}

// A Sony-like frame (12 bit SIRC: 2400 start, 600 marks, 600/1200 spaces), 25 durations ending on a mark: nothing like NEC.
const sirc = [2400, 600];
for (const b of [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]) sirc.push(b ? 1200 : 600, 600);
sirc.pop();
check(sirc.length === 25, "test train built (25 durations, ends on a mark)", sirc.length);
rem.addButton("Sony", { raw: sirc, carrier: 40000 });

// ---- 1. learn: the Dot hears the train as it was sent
let { r, s } = await whileListening("rxraw", 6000, () => rem.press("Sony"));
check(r.ok, "the Remote's raw train was heard (40 kHz is inside the receiver's band)", r);
let rx = parseRaw();
check(rx && rx.carrier === 38000, "kode_ir_receive_raw reports the receiver's 38 kHz", s);
check(rx && rx.count === 26 && rx.endsZero && close(rx.us, sirc, 0), "the durations are exactly what was sent (no AGC stretch by default), then the 0 of the idle gap", s);

// ---- 2. replay: kode_ir_send_raw(the learned durations), the TV sees the same timings
s = await a.txRaw(rx.all, 40000);
check(/^txraw ok=1 n=26$/.test(s), "kode_ir_send_raw accepted the learned train", s);
await a.waitFor(() => tv.raw(), 3000, "TV raw");
let raw = tv.raw();
check(raw.carrier === 40000 && close(raw.durations, sirc, 0), "the TV saw the same timings at the same carrier", raw);
check(!tv.state().power && tv.log().at(-1).type === "raw", "a non-NEC train changes nothing on the TV; it is kept as a raw train", tv.log().at(-1));
await sleep(300);

// ---- 3. the receiver's AGC: marks come back longer, spaces shorter; the replay then differs by exactly that, within the stretch
a.ir.configure({ agcUs: 80 });
({ s } = await whileListening("rxraw", 6000, () => rem.press("Sony")));
const rx2 = parseRaw();
const expect = sirc.map((v, i) => (i % 2 === 0 ? v + 80 : Math.max(1, v - 80)));
check(rx2 && close(rx2.us, expect, 0), "with agcUs 80 the capture has marks +80 us and spaces -80 us", s);
await sleep(300);
await a.txRaw(rx2.all, 38000);
await a.waitFor(() => tv.raw().durations.join() === rx2.us.join(), 3000, "replayed stretched");
check(close(tv.raw().durations, sirc, 80), "the TV sees the replay within the stretch (80 us) of the original", tv.raw().durations.join());
a.ir.configure({ agcUs: 0 });
await sleep(300);

// ---- 4. NEC heard raw is the real NEC timing; replayed as raw it is a NEC frame again
const nec = a.glue.necEncode(0xfb04, 0x0008);
({ s } = await whileListening("rxraw", 6000, () => rem.press("Power")));
rx = parseRaw();
check(rx && rx.count === 68 && close(rx.us, nec, 0), "a NEC frame heard raw: 67 durations (+ the idle 0), leader 9000/4500, bits 560/560|1690, stop mark", s.slice(0, 80));
await sleep(300);
await a.txRaw(rx.all, 38000);
await a.waitFor(() => tv.state().power, 3000, "TV on from raw");
check(tv.log().at(-1).type === "nec" && tv.log().at(-1).action === "power", "that NEC frame sent through kode_ir_send_raw switches the TV on (the TV decodes raw NEC)", tv.log().at(-1));
await sleep(300);

// ---- 5. limits: 256 symbols out and in, nothing more
const long = []; for (let i = 0; i < 512; i++) long.push(i % 2 ? 500 : 400);
await a.txRaw(long, 38000);
await a.waitFor(() => a.events.filter((e) => e.type === "tx").at(-1).n === 256, 3000, "256 symbol tx");
check(a.events.filter((e) => e.type === "tx").at(-1).n === 256, "a 512-duration raw send is 256 symbols on the link, the most the driver carries");
await sleep(500);
({ s } = await whileListening("rxraw", 6000, () => {   // straight into the link: 300 symbols
  const p = a.M._malloc(300 * 4), h = new Uint16Array(a.M.HEAPU8.buffer, p, 600);
  for (let i = 0; i < 600; i++) h[i] = 400 + (i % 50);
  const code = a.M._ir_rx_inject(p, 300, 38000);
  a.M._free(p);
  return code;
}));
rx = parseRaw();
check(rx && rx.count === 512 && rx.all[0] === 400 && rx.all[510] === 400 + (510 % 50), "a 300-symbol train is truncated to the first 256 symbols (512 durations), never wrapped", s.slice(0, 60));
await sleep(300);

// ---- 6. the carrier: the receiver only hears around 38 kHz, the TV is more tolerant
rem.addButton("Far", { raw: sirc, carrier: 56000 });
const before = a.ir.state().dropped.carrier;
r = await rem.press("Far");
check(!r.ok && r.code === -3, "a 56 kHz remote is not heard by the Dot's receiver", r);
check(a.ir.state().dropped.carrier === before + 1, "(counted as a carrier drop)");
await a.txRaw(sirc, 56000);
await a.waitFor(() => tv.raw().carrier === 56000, 3000, "56 kHz seen by TV");
check(true, "the Dot can transmit at 56 kHz and the TV hears it at that carrier");
await sleep(300);

// ---- 7. hold-to-repeat of a raw button re-sends the same train
rem.update({ repeatMs: 120 });
const held = await rem.hold("Sony", 400);
check(held.frames.length >= 3 && held.frames.every((f, i) => i === 0 || f.repeat), "a held raw button repeats its train every repeatMs", held.frames.length);
rem.update({ repeatMs: 108 });
await sleep(300);

// ---- 8. capture to a file and replay: NEC is stored as NEC, anything else as raw; replay is 100 ms apart
tv.update({ power: true, volume: 20 }); tv.clearLog();
s = await a.fn("capstart", "flash/ir.txt");
check(s === "capstart ok=1", "kode_ir_capture_start", s);
await sleep(200); await a.waitArmed();
s = await a.fn("recv", 300);
check(/^recv ok=0 err=/.test(s) && !/signal in/.test(s), "while capturing, kode_ir_receive fails at once (it does not wait its 300 ms)", s);
await rem.press("Power"); await sleep(250);
await rem.press("Vol+"); await sleep(250);
await rem.press("Sony"); await sleep(250);
s = await a.fn("capstop", undefined, 10000);
check(s === "capstop ok=1", "kode_ir_capture_stop wrote the file", s);
s = await a.fn("cat", "flash/ir.txt");
check(s.startsWith("cat # kode ir capture v1||nec 0xFB04 0x0008|") && /nec 0xFB04 0x0002/.test(s) && /raw 38000/.test(s), "the file holds the two NEC signals as NEC and the Sony train as raw", s.slice(0, 200));
await sleep(300);
tv.clearLog();
s = await a.fn("sendfile", "flash/ir.txt", 15000);
check(s === "sendfile ok=1", "kode_ir_send_file", s);
await a.waitFor(() => tv.log().length >= 3, 3000, "3 frames from file");
const lg = tv.log();
check(lg[0].action === "power" && lg[1].action === "vol+" && lg[2].type === "raw", "the TV saw power, volume up and the raw train, in order", lg.map((e) => e.type + ":" + (e.action || "")));
check(lg[1].at - lg[0].at >= 100 && lg[2].at - lg[1].at >= 100, "signals of a file are at least 100 ms apart", [lg[1].at - lg[0].at, lg[2].at - lg[1].at]);

check(a.stubLines().filter((l) => /ir_|knec|rmt|radio/i.test(l)).length === 0, "no stub fired for an IR function", a.stubLines().slice(0, 4));
done(a, "raw");
