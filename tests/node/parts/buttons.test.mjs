// Circuit tests of the buttons and switches: a 9 V battery, a 470 ohm resistor and a red LED through each button on the stepped clock.
// Off, pressed on, released off; the 4-pin tactile buttons' leg pairs; the latching button keeps its state, also through a saved layout;
// a layout saved with the old 6 x 6 mm two-terminal push button still loads and works.
import { check, finish, test, loadLibrary } from "./rig.mjs";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";

const mk = async () => { const b = new Bench({ clock: new BenchClock({ mode: "stepped" }) }); await loadLibrary(b); return b; };
const ms = (b, n) => b.advance(n * 1000);
const out = (b, i, n) => b.parts.get(i).outputs[n];
/** battery + -> resistor -> LED -> `into`; `from` -> battery -. Returns the instances. */
function loop(b, id, into, from) {
  const bat = b.addPart("dotbench.battery-9v"), r = b.addPart("dotbench.resistor", { fields: { ohms: 470 } }), led = b.addPart("dotbench.led-red"), sw = b.addPart(id);
  b.connect(bat + ".POS", r + ".A"); b.connect(r + ".B", led + ".A"); b.connect(led + ".K", `${sw}.${into}`); b.connect(`${sw}.${from}`, bat + ".NEG");
  return { bat, r, led, sw };
}
const lit = (b, led) => out(b, led, "brightness") > 0.5 && out(b, led, "current_ma") > 10;
const dark = (b, led) => out(b, led, "brightness") === 0 && out(b, led, "current_ma") === 0;

for (const [id, a, c] of [["dotbench.push-button", "A", "B"], ["dotbench.tact-6mm", "A1", "B1"], ["dotbench.tact-6mm", "A2", "B2"], ["dotbench.tact-6mm", "A1", "B2"], ["dotbench.tact-12mm", "A1", "B1"], ["dotbench.tact-12mm", "A2", "B1"]]) {
  await test(`${id} ${a}-${c}: off, pressed on, released off`, async () => {
    const b = await mk(), hz = []; b.on("hazard", (h) => hz.push(h.class));
    const { led, sw } = loop(b, id, a, c);
    await ms(b, 20);
    check(dark(b, led), `${id} ${a}-${c}: not pressed, the LED is dark`, out(b, led, "current_ma"));
    b.setField(sw, "pressed", true); await ms(b, 20);
    check(lit(b, led) && Math.abs(out(b, led, "current_ma") - (9000 - 1900) / 482) < 0.8, `${id} ${a}-${c}: pressed, the LED is lit at about 14.7 mA`, out(b, led, "current_ma"));
    b.setField(sw, "pressed", false); await ms(b, 20);
    check(dark(b, led), `${id} ${a}-${c}: released, dark again`);
    const p = b.press(sw, "pressed", 150); await ms(b, 60);
    const during = lit(b, led); await ms(b, 200); await p;
    check(during && dark(b, led), `${id} ${a}-${c}: press() (what the pointer does) lights it for the hold only`);
    check(!hz.length, `${id} ${a}-${c}: 9 V is no hazard for the button`, hz);
    b.dispose();
  });
}

for (const id of ["dotbench.tact-6mm", "dotbench.tact-12mm"]) {
  await test(`${id}: legs joined in pairs`, async () => {
    const b = await mk(), sw = b.addPart(id), n = (p) => b.netId(`${sw}.${p}`);
    check(n("A1") === n("A2") && n("B1") === n("B2") && n("A1") !== n("B1"), `${id}: A1-A2 are one net, B1-B2 another, not pressed`);
    b.setField(sw, "pressed", true); await ms(b, 20);
    check(new Set(["A1", "A2", "B1", "B2"].map(n)).size === 1, `${id}: pressed, the four legs are one net`);
    b.setField(sw, "pressed", false); await ms(b, 20);
    check(n("A1") === n("A2") && n("B1") === n("B2") && n("A1") !== n("B1"), `${id}: released, two pairs again`);
    b.dispose();
    // across the pair that is always joined the LED is on without a press: the classic wrong way round
    const b2 = await mk(), { led } = loop(b2, id, "A1", "A2"); await ms(b2, 20);
    check(lit(b2, led), `${id}: wired across A1-A2 the LED is always on (the pair is one piece of metal)`);
    b2.dispose();
  });
}

await test("tact-6mm over a breadboard's centre channel", async () => {
  const b = await mk(), bb = b.addPart("dotbench.breadboard-half"), sw = b.addPart("dotbench.tact-6mm"), n = (t) => b.netId(t);
  // what plugging does: A1 in e10, A2 in f10, B1 in e12, B2 in f12
  for (const [p, h] of [["A1", "e10"], ["A2", "f10"], ["B1", "e12"], ["B2", "f12"]]) b.connect(`${sw}.${p}`, `${bb}.${h}`);
  check(n(bb + ".a10") === n(bb + ".j10") && n(bb + ".a12") === n(bb + ".j12") && n(bb + ".a10") !== n(bb + ".a12"), "it bridges the channel in each of its two columns, and the columns stay apart");
  b.setField(sw, "pressed", true); await ms(b, 20);
  check(n(bb + ".a10") === n(bb + ".j12"), "pressed: column 10 and column 12 are joined");
  b.dispose();
});

await test("latching button: push on, push off, through a saved layout", async () => {
  const b = await mk(), { led, sw } = loop(b, "dotbench.latching-button", "COM1", "NO1");
  const click = async () => { b.setField(sw, "latched", !b.parts.get(sw).fields.latched); await ms(b, 20); };     // a toggle control: one click steps the field
  await ms(b, 20);
  check(dark(b, led), "latching: at rest COM1-NO1 is open, the LED is dark");
  await click(); check(lit(b, led), "latching: first press, lit");
  await ms(b, 3000); check(lit(b, led), "latching: 3 s after the finger left it is still lit");
  const json = JSON.parse(JSON.stringify(b.serialise("latched")));
  const b2 = await mk(), res = await b2.restore(json); await ms(b2, 20);
  check(res.missing.length === 0 && res.dropped.length === 0 && b2.parts.get(sw).fields.latched === true && lit(b2, led), "latching: saved and loaded, it is still down and the LED still lit", res);
  b2.setField(sw, "latched", false); await ms(b2, 20);
  check(dark(b2, led), "latching: second press in the loaded bench, dark");
  await click(); check(dark(b, led), "latching: second press, dark");
  await ms(b, 3000); check(dark(b, led), "latching: and it stays dark");
  // the other throw and the other pole
  const b3 = await mk(), x = loop(b3, "dotbench.latching-button", "COM2", "NC2"); await ms(b3, 20);
  check(lit(b3, x.led), "latching: COM2-NC2 conducts at rest");
  b3.setField(x.sw, "latched", true); await ms(b3, 20);
  check(dark(b3, x.led) && b3.netId(x.sw + ".COM1") === b3.netId(x.sw + ".NO1") && b3.netId(x.sw + ".COM1") !== b3.netId(x.sw + ".COM2"), "latching: latched opens NC2; pole 1 changed over too and is not joined to pole 2");
  [b, b2, b3].forEach((q) => q.dispose());
});

await test("toggle switch: stays where it is put", async () => {
  const b = await mk(), { led, sw } = loop(b, "dotbench.toggle-switch", "COM", "B"); await ms(b, 20);
  check(dark(b, led), "toggle: position a, COM-B open");
  b.setField(sw, "position", "b"); await ms(b, 2000);
  check(lit(b, led), "toggle: position b, lit and it stays");
  const b2 = await mk(); await b2.restore(JSON.parse(JSON.stringify(b.serialise("t")))); await ms(b2, 20);
  check(lit(b2, led), "toggle: position kept through a saved layout");
  [b, b2].forEach((q) => q.dispose());
});

await test("a layout saved with the old push button still loads", async () => {
  // as serialise() wrote it before this change: id dotbench.push-button 1.0.0, terminals A and B, field pressed
  const at = { x: 0, y: 0, rot: 0 };
  const layout = { format: "dotbench-layout", version: 1, name: "old", device: { rails: { V33: "app", V5: "app" }, header: "kode-dot-j3" },
    parts: [{ instance: "p1", part: { id: "dotbench.battery-9v", version: "1.0.0" }, label: "", pos: at, fields: {} }, { instance: "p2", part: { id: "dotbench.resistor", version: "1.0.0" }, label: "", pos: at, fields: { ohms: 470 } },
      { instance: "p3", part: { id: "dotbench.led-red", version: "1.0.0" }, label: "", pos: at, fields: {} }, { instance: "p4", part: { id: "dotbench.push-button", version: "1.0.0" }, label: "Button", pos: { x: 30, y: 40, rot: 90 }, fields: { pressed: false } }],
    wires: [{ id: "w1", from: "p1.POS", to: "p2.A" }, { id: "w2", from: "p2.B", to: "p3.A" }, { id: "w3", from: "p3.K", to: "p4.A" }, { id: "w4", from: "p4.B", to: "p1.NEG" }] };
  const b = await mk(), res = await b.restore(layout); await ms(b, 20);
  check(res.missing.length === 0 && res.dropped.length === 0 && res.notes.length === 0, "old layout: nothing missing, no wire dropped, no note", res);
  check(dark(b, "p3"), "old layout: dark"); b.setField("p4", "pressed", true); await ms(b, 20); check(lit(b, "p3"), "old layout: the button still lights the LED");
  const m = b.defs.get("dotbench.push-button").manifest, x = m.pins.map((p) => p.mm.x - m.body.w_mm / 2), y = m.pins.map((p) => p.mm.y - m.body.d_mm / 2);
  check(Math.abs(x[0] + 2.54) < 0.01 && Math.abs(x[1] - 2.54) < 0.01 && y.every((v) => Math.abs(v) < 0.01), "old layout: its legs are where they were about the part's centre (the same breadboard holes)", { x, y });
  b.dispose();
});
process.exit(finish("buttons"));
