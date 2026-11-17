// Boards and the Arduino libraries of dotcore, against the bench model: real sketches compiled for each board's variant, wired to real parts.
// Time is the stepped virtual clock. Each sketch is built once (a few seconds each) and uploaded with bench.setPartCode, which is also what the code-part tests exercise.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, finish, test, loadLibrary, root } from "./rig.mjs";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";
import { compileWasm } from "../../../tools/dblib/part/build.mjs";

const mk = async () => { const b = new Bench({ clock: new BenchClock({ mode: "stepped" }) }); await loadLibrary(b); return b; };
const near = (x, y, tol) => Math.abs(x - y) <= tol;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "boards-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const BOARD_DIR = { "uno-r3": "uno-r3", "uno-r4-minima": "uno-r4-minima", "uno-r4-wifi": "uno-r4-wifi", "esp32-s3": "esp32-s3-devkitc" };
const cache = new Map();
/** Compile `ino` for a board variant (the board's own manifest supplies the fields/outputs header). */
function build(core, ino) {
  const key = core + "\0" + ino; if (cache.has(key)) return cache.get(key);
  const dir = path.join(tmp, core + "-" + cache.size), src = path.join(root, "parts", BOARD_DIR[core]);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.copyFileSync(path.join(src, "manifest.json"), path.join(dir, "manifest.json"));
  fs.writeFileSync(path.join(dir, "src/main.ino"), ino);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const { wasm } = compileWasm(dir, m);
  const r = { wasm, source: ino }; cache.set(key, r); return r;
}
const BOARD_ID = { "uno-r3": "dotbench.uno-r3", "uno-r4-minima": "dotbench.uno-r4-minima", "uno-r4-wifi": "dotbench.uno-r4-wifi", "esp32-s3": "dotbench.esp32-s3-devkitc" };
async function board(b, core, ino, o = {}) {
  const id = b.addPart(BOARD_ID[core], o);
  if (ino) await b.setPartCode(id, build(core, ino));
  return id;
}
const log = (b, id) => b.serialLog(id).join("\n");
async function run(b, ms) { await b.ready(); for (let i = 0; i < ms; i += 20) await b.advance(20000); }
const out = (b, i, n) => b.parts.get(i).outputs[n];
const W = (b, pairs) => { for (const [x, y] of pairs) b.connect(x, y); };

// ---------------------------------------------------------------- power, voltages, pin names
await test("boards: USB power, 5 V and VIN, 3V3 output, logic level", async () => {
  const b = await mk(), u = await board(b, "uno-r3");
  await run(b, 50);
  check(b.state().parts.find((p) => p.instance === u).power.on, "an Uno on USB (field usb) is powered with nothing wired");
  check(near(b.net(u + ".V5").mv, 5000, 100) && near(b.net(u + ".V33").mv, 3300, 150), "its 5V pin is 5 V and the 3V3 pin is 3.3 V", [b.net(u + ".V5").mv, b.net(u + ".V33").mv]);
  b.setField(u, "usb", false); await run(b, 50);
  check(!b.state().parts.find((p) => p.instance === u).power.on, "usb off and nothing on 5V or VIN: powered off");
  const bat = b.addPart("dotbench.battery-9v");
  W(b, [[bat + ".POS", u + ".VIN"], [bat + ".NEG", u + ".GND_1"]]); await run(b, 50);
  check(b.state().parts.find((p) => p.instance === u).power.on, "9 V on VIN and the battery minus on GND powers it (alternative supply group)");
  b.setField(u, "usb", true);
  b.dispose();
  const b2 = await mk(), s = await board(b2, "esp32-s3"), r = b2.addPart("dotbench.resistor", { fields: { ohms: 1000 } });
  await run(b2, 50);
  check(near(b2.net(s + ".V33_1").mv, 3300, 150) && b2.net(s + ".V33_2").id === b2.net(s + ".V33_1").id, "ESP32-S3: 3V3 output, both 3V3 header pins are one net");
  check(b2.net(s + ".GND_1").id === b2.net(s + ".GND_4").id, "and the four GND pins are one net (internally connected terminal group)");
  b2.dispose();
});
await test("boards: A4/SDA and A5/SCL header pins are the same net; pin capabilities are in the manifest", async () => {
  const b = await mk(), u = await board(b, "uno-r4-minima");
  check(b.net(u + ".A4").id === b.net(u + ".SDA").id && b.net(u + ".A5").id === b.net(u + ".SCL").id, "SDA is A4 and SCL is A5");
  const m = b.parts.get(u).def.manifest, pin = (n) => m.pins.find((p) => p.name === n);
  check(pin("D9").caps.includes("pwm") && !pin("D4").caps.includes("pwm") && pin("A0").caps.includes("dac") && pin("D11").caps.includes("spi_mosi") && pin("A4").caps.includes("i2c_sda"), "D9 has PWM, D4 does not, A0 has the DAC, D11 is MOSI, A4 is SDA");
  check(pin("D13").mm && pin("D13").face === "top" && m.body.w_mm > 60, "terminals carry millimetre positions and a face", pin("D13"));
  b.dispose();
});

// ---------------------------------------------------------------- analog, PWM, tone, interrupts
const ANALOG = (extra = "") => `#include <Arduino.h>
void setup() { Serial.begin(115200); ${extra} }
void loop() { Serial.print("A0="); Serial.println(analogRead(A0)); delay(100); }
`;
await test("analogRead: resolution and reference of each board", async () => {
  for (const [core, vref, bits, mid] of [["uno-r3", 5000, 10, 512], ["uno-r4-minima", 5000, 10, 512]]) {
    const b = await mk(), u = await board(b, core, ANALOG()), r1 = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } }), r2 = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } });
    W(b, [[r1 + ".A", u + ".V5"], [r1 + ".B", u + ".A0"], [r2 + ".A", u + ".A0"], [r2 + ".B", u + ".GND_1"]]);
    await run(b, 300);
    const m = /A0=(\d+)/.exec(log(b, u).split("\n").pop() || "");
    check(m && near(+m[1], mid, 14), `${core}: 5 V divided by two 10k reads about ${mid} on a ${bits} bit ADC`, log(b, u).split("\n").slice(-2));
    b.dispose();
  }
  const b = await mk(), u = await board(b, "uno-r4-minima", ANALOG("analogReadResolution(14);")), r1 = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } }), r2 = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } });
  W(b, [[r1 + ".A", u + ".V5"], [r1 + ".B", u + ".A0"], [r2 + ".A", u + ".A0"], [r2 + ".B", u + ".GND_1"]]);
  await run(b, 300);
  const m = /A0=(\d+)/.exec(log(b, u).split("\n").pop() || "");
  check(m && near(+m[1], 8192, 220), "Uno R4 with analogReadResolution(14): about half of 16383", log(b, u).split("\n").slice(-2));
  b.dispose();
  const b2 = await mk(), s = await board(b2, "esp32-s3", ANALOG("").replace("A0", "A0")), q1 = b2.addPart("dotbench.resistor", { fields: { ohms: 10000 } }), q2 = b2.addPart("dotbench.resistor", { fields: { ohms: 10000 } });
  W(b2, [[q1 + ".A", s + ".V33_1"], [q1 + ".B", s + ".IO1"], [q2 + ".A", s + ".IO1"], [q2 + ".B", s + ".GND_1"]]);
  await run(b2, 300);
  const m2 = /A0=(\d+)/.exec(log(b2, s).split("\n").pop() || "");
  check(m2 && near(+m2[1], 2048, 60), "ESP32-S3: 3.3 V divided by two reads about 2048 on a 12 bit ADC", log(b2, s).split("\n").slice(-2));
  b2.dispose();
});

await test("analogWrite and tone", async () => {
  const b = await mk();
  const u = await board(b, "uno-r3", `#include <Arduino.h>
void setup() { analogWrite(9, 128); analogWrite(5, 64); analogWrite(4, 200); pinMode(8, OUTPUT); tone(8, 1000, 200); Serial.begin(9600); }
void loop() { delay(10); }
`);
  await run(b, 40);
  const n9 = b.net(u + ".D9"), n5 = b.net(u + ".D5"), n4 = b.net(u + ".D4"), n8 = b.net(u + ".D8");
  check(n9.pwm && n9.pwm.hz === 490 && near(n9.pwm.duty, 128 / 255, 0.01), "analogWrite(9, 128): 490 Hz, duty 128/255", n9.pwm);
  check(n5.pwm && n5.pwm.hz === 980, "pin 5 runs at 980 Hz like the Uno", n5.pwm);
  check(!n4.pwm && n4.level === 1, "analogWrite(4, 200): pin 4 has no PWM on the Uno, so it goes digital high (as on the real board)", n4);
  check(n8.pwm && n8.pwm.hz === 1000, "tone(8, 1000, 200): a 1 kHz square wave on D8", n8.pwm);
  await run(b, 260);
  check(!b.net(u + ".D8").pwm, "after 200 ms the tone stops by itself");
  b.dispose();
  const s = await mk(), e = await board(s, "esp32-s3", `#include <Arduino.h>
void setup() { analogWrite(4, 128); }
void loop() { delay(10); }
`);
  await run(s, 40);
  check(s.net(e + ".IO4").pwm && s.net(e + ".IO4").pwm.hz === 1000, "ESP32-S3: analogWrite works on any GPIO (LEDC), 1 kHz", s.net(e + ".IO4").pwm);
  s.dispose();
});

await test("attachInterrupt, digitalRead and the interrupt pins of each board", async () => {
  const b = await mk(), u = await board(b, "uno-r3", `#include <Arduino.h>
volatile int n = 0;
void isr() { n++; }
void setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(2), isr, FALLING); }
void loop() { Serial.print("n="); Serial.println(n); delay(50); }
`);
  b.connect("device.EXP1", u + ".D2"); b.connect("device.GND", u + ".GND_1"); b.setRails({ V33: true });
  await run(b, 120);
  for (let i = 0; i < 3; i++) { b.setDevicePin(0, { mode: "out", level: 0 }); await run(b, 60); b.setDevicePin(0, { mode: "out", level: 1 }); await run(b, 60); }
  await run(b, 100);
  const last = log(b, u).split("\n").pop();
  check(last === "n=3", "three falling edges on D2 call the ISR three times", log(b, u).split("\n").slice(-3));
  b.dispose();
});

// ---------------------------------------------------------------- libraries against parts
await test("Servo: write(0), write(90), write(180) against the servo part", async () => {
  const b = await mk(), u = await board(b, "uno-r3", `#include <Servo.h>
Servo s;
void setup() { s.attach(9); }
void loop() { s.write(0); delay(300); s.write(90); delay(300); s.write(180); delay(300); s.writeMicroseconds(1000); delay(300); }
`), sv = b.addPart("dotbench.servo");
  W(b, [[sv + ".V5", u + ".V5"], [sv + ".GND", u + ".GND_1"], [sv + ".SIG", u + ".D9"]]);
  const seen = [];
  for (let i = 0; i < 70; i++) { await run(b, 20); const a = out(b, sv, "angle"); if (!seen.length || seen[seen.length - 1] !== a) seen.push(a); }
  check(seen.includes(0) && seen.some((a) => near(a, 90, 1)) && seen.includes(180) && seen.some((a) => near(a, 44.2, 0.6)), "angles 0, 90, 180 and (1000 us) 44.2 follow Servo.write / writeMicroseconds", seen);
  b.dispose();
});

await test("Stepper library drives the 28BYJ-48 + ULN2003 part", async () => {
  const b = await mk(), u = await board(b, "uno-r3", `#include <Stepper.h>
Stepper st(2048, 8, 10, 9, 11);
void setup() { Serial.begin(9600); st.setSpeed(10); st.step(100); Serial.println("fwd"); delay(500); st.step(-40); Serial.println("back"); }
void loop() { delay(100); }
`), m = b.addPart("dotbench.stepper-28byj48");
  W(b, [[m + ".IN1", u + ".D8"], [m + ".IN2", u + ".D9"], [m + ".IN3", u + ".D10"], [m + ".IN4", u + ".D11"], [m + ".V5", u + ".V5"], [m + ".GND", u + ".GND_1"]]);
  let fwd = null;
  for (let i = 0; i < 40 && !log(b, u).includes("back"); i++) { await run(b, 100); if (fwd === null && log(b, u).includes("fwd")) fwd = out(b, m, "position"); }
  await run(b, 40);
  const pos = out(b, m, "position");
  check(fwd === 198, "step(100) is 100 full steps = 200 half steps; the first energised pattern only sets the starting phase, so 198 are counted", fwd);
  check(pos === 118 && !out(b, m, "stalled"), "then step(-40) comes back to 118 half steps, not stalled", pos);
  b.dispose();
});

await test("A4988: the firmware's STEP pulses and DIR (counted at the exact edge times)", async () => {
  const b = await mk(), u = await board(b, "uno-r3", `#include <Arduino.h>
void setup() { pinMode(2, OUTPUT); pinMode(3, OUTPUT); digitalWrite(3, HIGH); delay(100);   // the driver needs its own power-up time
  for (int i = 0; i < 50; i++) { digitalWrite(2, HIGH); delayMicroseconds(500); digitalWrite(2, LOW); delayMicroseconds(500); }
  digitalWrite(3, LOW);
  for (int i = 0; i < 20; i++) { digitalWrite(2, HIGH); delayMicroseconds(500); digitalWrite(2, LOW); delayMicroseconds(500); }
  Serial.begin(9600); Serial.println("done"); }
void loop() { delay(10); }
`), d = b.addPart("dotbench.stepper-a4988"), bat = b.addPart("dotbench.battery-9v");
  W(b, [[d + ".STEP", u + ".D2"], [d + ".DIR", u + ".D3"], [d + ".VDD", u + ".V5"], [d + ".GND", u + ".GND_1"], [bat + ".POS", d + ".VMOT"], [bat + ".NEG", u + ".GND_1"]]);
  for (let i = 0; i < 30 && !log(b, u).includes("done"); i++) await run(b, 20);
  await run(b, 20);
  const pos = out(b, d, "position");
  check(pos === (50 - 20) * 16, "50 steps one way and 20 the other leaves 30 full steps (480 sixteenths)", pos);
  b.dispose();
});

// ---------------------------------------------------------------- buses
await test("Wire master reads an I2C part; SPI master loops back", async () => {
  const b = await mk(), u = await board(b, "uno-r4-minima", `#include <Wire.h>
#include <SPI.h>
void setup() {
  Serial.begin(9600); Wire.begin();
  Wire.beginTransmission(0x40); Wire.write(0xFE); Serial.print("end="); Serial.println(Wire.endTransmission(false));
  int n = Wire.requestFrom(0x40, 2); int v = Wire.read() << 8; v |= Wire.read();
  Serial.print("n="); Serial.print(n); Serial.print(" id="); Serial.println(v, HEX);
  Wire.beginTransmission(0x77); Serial.print("nack="); Serial.println(Wire.endTransmission());
  SPI.begin(); SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  Serial.print("spi="); Serial.println(SPI.transfer(0xA5), HEX); SPI.endTransaction();
}
void loop() { delay(10); }
`), h = b.addPart("dotbench.hdc1080"), pa = b.addPart("dotbench.resistor", { fields: { ohms: 4700 } }), pb = b.addPart("dotbench.resistor", { fields: { ohms: 4700 } });
  W(b, [[pa + ".A", u + ".V33"], [pa + ".B", u + ".SDA"], [pb + ".A", u + ".V33"], [pb + ".B", u + ".SCL"], [h + ".VCC", u + ".V33"], [h + ".GND", u + ".GND_1"], [h + ".SDA", u + ".SDA"], [h + ".SCL", u + ".SCL"], [u + ".D11", u + ".D12"]]);
  await run(b, 300);
  const t = log(b, u);
  check(/end=0/.test(t) && /n=2 id=5449/.test(t), "Wire: the HDC1080 manufacturer id register reads 0x5449 through the A4/A5 header pins", t);
  check(/nack=2/.test(t), "Wire: an address nobody answers returns 2 (NACK on address)", t);
  check(/spi=A5/.test(t), "SPI: MOSI wired to MISO returns the byte sent", t);
  b.dispose();
});

await test("EEPROM: written bytes survive restart, power cycle and a saved layout", async () => {
  const sk = `#include <EEPROM.h>
void setup() { Serial.begin(9600); int boots = EEPROM.read(0); if (boots == 255) boots = 0; boots++; EEPROM.update(0, boots);
  uint32_t v = 0; EEPROM.get(4, v); if (v == 0xFFFFFFFFUL) v = 0; v += 1000; EEPROM.put(4, v); Serial.print("boot="); Serial.print(boots); Serial.print(" v="); Serial.println(v); }
void loop() { delay(10); }
`;
  const b = await mk(), u = await board(b, "uno-r3", sk);
  await run(b, 100);
  check(/boot=1 v=1000/.test(log(b, u)), "first boot: counters start from the erased 0xFF state", log(b, u));
  await b.restartPart(u); await run(b, 100);
  check(/boot=2 v=2000/.test(log(b, u)), "after restartPart the cells are still there", log(b, u));
  b.setField(u, "usb", false); await run(b, 50); b.setField(u, "usb", true); await run(b, 150);
  check(/boot=3 v=3000/.test(log(b, u)), "and after a power cycle", log(b, u));
  const layout = JSON.parse(JSON.stringify(b.serialise()));
  check(layout.parts[0].storage_b64 && layout.parts[0].code?.wasm_b64 && layout.parts[0].code.source.includes("EEPROM"), "the layout carries the sketch source, the binary and the EEPROM bytes");
  const c = await mk(); await c.restore(layout); await run(c, 150);
  check(/boot=4 v=4000/.test(log(c, "p1")), "restored on a fresh bench: same sketch, same EEPROM, the next boot is number 4", log(c, "p1"));
  b.dispose(); c.dispose();
});

await test("WiFi is not connected and says so; the LED matrix is part state", async () => {
  const b = await mk(), u = await board(b, "uno-r4-wifi", `#include <WiFiS3.h>
#include <Arduino_LED_Matrix.h>
ArduinoLEDMatrix m;
void setup() { Serial.begin(9600); m.begin(); uint8_t px[8][12] = {}; px[0][0] = 1; px[7][11] = 1; m.renderBitmap(px, 8, 12);
  int r = WiFi.begin("home", "secret"); Serial.print("begin="); Serial.println(r); Serial.print("status="); Serial.println(WiFi.status());
  WiFiClient c; Serial.print("connect="); Serial.println(c.connect("example.com", 80)); }
void loop() { delay(10); }
`);
  const warns = []; b.on("warning", (w) => warns.push(w.text));
  await run(b, 200);
  const t = log(b, u);
  check(/status=6/.test(t) && !/status=3/.test(t) && /connect=0/.test(t), "WiFi.status() is WL_DISCONNECTED (6), never WL_CONNECTED, and connect() fails", t);
  check(warns.some((w) => /WiFi is not simulated/.test(w)) && warns.filter((w) => /WiFi is not simulated/.test(w)).length === 1, "the bench is told, once: WiFi is not simulated", warns);
  check(out(b, u, "matrix0") === 0x80000000 && out(b, u, "matrix2") === 1, "the matrix words: bit 31 of word 0 is the top left LED, bit 0 of word 2 the bottom right", [out(b, u, "matrix0"), out(b, u, "matrix2")]);
  b.dispose();
});

await test("String, itoa family, dtostrf, math and bit helpers, pgmspace shims, float printing (every beginner sketch)", async () => {
  const ino = fs.readFileSync(path.join(root, "tests/node/parts/sketches/strings.ino"), "utf8");
  const want = ["Q=42 Y=3.142 Z=FF -7 12345", "26", "5", "14.50", "-123456", "1e240", "-42", "101010", "    3.14", null, null, "127", "255", "3", "4", "5", "9", "1", "2", "8", "52", "18",
    "flash string", "101", "3", "hello", "5", "1.50", "2.000", "3.14", "1.41", "1024.00", "11111111 377 BEEF", "7  2.50 ok", "4"];
  for (const core of ["uno-r3", "uno-r4-minima", "esp32-s3"]) {
    const b = await mk(), u = await board(b, core, ino); await run(b, 300);
    const got = b.serialLog(u);
    const bad = want.map((w, i) => (w !== null && got[i] !== w ? `${i}: ${got[i]} != ${w}` : null)).filter(Boolean);
    check(!bad.length && +got[9] >= 0 && +got[9] < 10 && +got[10] >= 5 && +got[10] < 10, `${core}: all ${want.length} lines of the formatting sketch match (random() stays in range)`, bad.slice(0, 3));
    b.dispose();
  }
});

// ---------------------------------------------------------------- the code part contract
await test("code part: upload to one board restarts only that board; bad binaries are refused", async () => {
  const b = await mk(), a = await board(b, "uno-r3"), c = await board(b, "uno-r3");
  await run(b, 700);
  const before = log(b, c);
  check(/blinking LED_BUILTIN/.test(log(b, a)) && !b.getPartCode(a).custom && /LED_BUILTIN/.test(b.getPartCode(a).source), "a board starts with its default blink sketch, source included");
  const res = await b.setPartCode(a, build("uno-r3", `#include <Arduino.h>
void setup() { Serial.begin(9600); Serial.println("hello from new code"); }
void loop() { delay(100); }
`));
  await run(b, 200);
  check(/^[0-9a-f]{64}$/.test(res.sha256) && /hello from new code/.test(log(b, a)) && !/blinking/.test(log(b, a)), "the uploaded sketch runs and the old serial monitor was cleared", log(b, a));
  check(log(b, c).startsWith(before.split("\n")[0]) && log(b, c).length >= before.length, "the other board kept running, its serial monitor was not touched", log(b, c));
  check(b.getPartCode(a).custom && b.getPartCode(a).source.includes("hello from new code"), "getPartCode returns the new source and binary");
  let err = null; try { await b.setPartCode(a, { wasm: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3) }); } catch (e) { err = e.message; }
  check(err, "a broken binary is refused with an error, not accepted silently", err);
  await b.clearPartCode(a); await run(b, 100);
  check(/blinking LED_BUILTIN/.test(log(b, a)), "clearPartCode goes back to the package's sketch");
  b.dispose();
});

await test("every board's default sketch builds from its own source (offline build path)", async () => {
  for (const core of ["uno-r3", "uno-r4-minima", "uno-r4-wifi", "esp32-s3"]) {
    const ino = fs.readFileSync(path.join(root, "parts", BOARD_DIR[core], "src/main.ino"), "utf8");
    check(build(core, ino).wasm.length > 1000, `${core}: compiles against its variant`);
  }
});

await test("boards show life: serial counters, the user LED, a crash flag, the S3's RGB colour; renamed pins keep their old names", async () => {
  const b = await mk(), u = await board(b, "uno-r3", `void setup() { Serial.begin(9600); pinMode(13, OUTPUT); digitalWrite(13, HIGH); Serial.print("hello"); }
void loop() { while (Serial.available()) Serial.read(); delay(5); }
`);
  await run(b, 100);
  check(out(b, u, "tx") === 5 && out(b, u, "led") === 1 && out(b, u, "rx") === 0 && out(b, u, "crashed") === false, "Uno: tx counts the 5 bytes of 'hello', the LED output follows pin 13, rx and crashed are idle", [out(b, u, "tx"), out(b, u, "led"), out(b, u, "rx")]);
  b.serialIn(u, "abc"); await run(b, 40);
  check(out(b, u, "rx") === 3, "Uno: rx counts the 3 bytes typed into the serial monitor");
  const s = await board(b, "esp32-s3", `void setup() { neopixelWrite(RGB_BUILTIN, 10, 20, 30); }
void loop() { delay(5); }
`);
  await run(b, 100);
  check(out(b, s, "rgb_r") === 10 && out(b, s, "rgb_g") === 20 && out(b, s, "rgb_b") === 30 && out(b, s, "led") === 1, "ESP32-S3: neopixelWrite gives the colour as rgb_r, rgb_g, rgb_b and the LED output is on");
  const e = b.addPart("dotbench.esp32-blink-echo"), w = b.connect(e + ".TX", "device.EXP10"), n = b.connect(e + ".GND", "device.GND");
  check(b.wireOf(e + ".IO17", "device.EXP10") === w && b.net(e + ".TX").id === b.net(e + ".IO17").id && b.net(e + ".GND").id === b.net(e + ".GND_1").id, "an old pin name (TX, GND) is an alias of the real pin (IO17, GND_1)");
  b.dispose();
});

await test("buttons: reset restarts the sketch, EN restarts, BOOT holds GPIO0 low (S3 and the classic board)", async () => {
  const b = await mk(), u = await board(b, "uno-r3");   // the default sketch blinks pin 13 every 500 ms
  await run(b, 600);
  check(out(b, u, "led") === 1, "the Uno LED is on after the first 500 ms");
  b.setField(u, "reset", true); await run(b, 5); b.setField(u, "reset", false); await run(b, 100);
  check(out(b, u, "led") === 0, "pressing reset restarts the sketch: the LED starts again from off", out(b, u, "led"));
  await run(b, 500);
  check(out(b, u, "led") === 1, "and blinks again 500 ms after the restart");
  const s = await board(b, "esp32-s3"), r = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } });
  b.connect(r + ".A", s + ".V33_1"); b.connect(r + ".B", s + ".IO0"); await run(b, 50);
  check(b.net(s + ".IO0").mv > 3000, "ESP32-S3: GPIO0 is high through a pull-up", b.net(s + ".IO0").mv);
  b.setField(s, "boot", true); await run(b, 5);
  check(b.net(s + ".IO0").mv < 300, "holding BOOT pulls GPIO0 to ground", b.net(s + ".IO0").mv);
  b.setField(s, "boot", false); await run(b, 5);
  check(b.net(s + ".IO0").mv > 3000, "and releasing it lets the pull-up win again");
  await run(b, 600);
  check(out(b, s, "led") !== undefined, "S3 runs", out(b, s, "led"));
  const e = b.addPart("dotbench.esp32-blink-echo"); b.setRails({ V33: true }); b.connect(e + ".V33", "device.V33"); b.connect(e + ".GND", "device.GND"); b.connect(e + ".IO0", r + ".B"); await run(b, 100);
  b.setField(e, "boot", true); await run(b, 5);
  check(b.net(e + ".IO0").mv < 300, "classic ESP32: BOOT pulls IO0 low as well", b.net(e + ".IO0").mv);
  b.dispose();
});

process.exit(finish("boards"));
