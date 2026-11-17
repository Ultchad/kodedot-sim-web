// SPDX-License-Identifier: GPL-3.0-or-later
// Boards that run sketches: Arduino Uno R3, Uno R4 Minima, Uno R4 WiFi, ESP32-S3 DevKitC-1 (the existing ESP32 pattern: a wasm part, the sketch
// compiled against ArduinoCore-API + dotcore for that board's variant). NONE of them emulates the chip: no AVR, no Renesas, no Xtensa core,
// no bootloader, no peripheral registers, no timing of instructions. The pins, voltages and Arduino API are real; the CPU is not.
import { writePart, L, P, pinDots } from "./lib.mjs";

const HI5 = 5500, HI3 = 3600;
const KW = (en, pt, es) => ({ en, "pt-BR": pt, es });

// ---- Uno family header layout, millimetres from the top-left, USB end on the left, top view (Arduino R3 mechanical drawing, 0.1 inch pitch, the 0.16 inch gap between D7 and D8)
const UNO_W = 68.58, UNO_D = 53.34, TOP_Y = 2.54, BOT_Y = 50.8;
// The body box includes the connector overhang: the USB-B (R3) sticks out about 6.4 mm past the board's left edge, the DC jack about as much; the R4 USB-C less (the box keeps the larger allowance). All x below are measured from the box's left edge = the board's left edge minus OVER.
let OVER = 6.4; const CONTACT_Z = 11.4;   // CONTACT_Z: height of a female header socket's mouth above the table (1.6 mm board + 8.5 mm socket + ~1.3 mm of mouth), where a wire or a shield pin meets the header
// stepped board outline and the four 3.2 mm mounting holes, mm from the board's left edge and top edge (the modeller's measurement of the Uno R3 drawing)
const UNO_OUTLINE = [[0, 0], [64.516, 0], [66.04, 1.524], [66.04, 12.954], [68.58, 15.494], [68.58, 48.26], [66.04, 50.8], [66.04, 53.34], [0, 53.34]], UNO_HOLES = [[13.97, 50.8], [15.24, 2.54], [66.04, 17.78], [66.04, 45.72]];
// 1 mm corner radii of the R3 board (the three outer corners that are not chamfered), as short polyline arcs; the R4 keeps the plain outline.
function roundCorners(pts, corners, r) {
  const out = [];
  pts.forEach((c, i) => {
    if (!corners.some(([x, y]) => x === c[0] && y === c[1])) { out.push(c); return; }
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length], u = (q) => { const dx = q[0] - c[0], dy = q[1] - c[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
    const ua = u(a), ub = u(b), cx = c[0] + r * (ua[0] + ub[0]), cy = c[1] + r * (ua[1] + ub[1]), a0 = Math.atan2(c[1] + r * ua[1] - cy, c[0] + r * ua[0] - cx), a1 = Math.atan2(c[1] + r * ub[1] - cy, c[0] + r * ub[0] - cx);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    for (let k = 0; k <= 4; k++) { const t = a0 + d * k / 4; out.push([Math.round((cx + r * Math.cos(t)) * 1000) / 1000, Math.round((cy + r * Math.sin(t)) * 1000) / 1000]); }
  });
  return out;
}
const unoOutline = (core) => core === "uno-r3" ? roundCorners(UNO_OUTLINE, [[0, 0], [0, 53.34], [66.04, 53.34]], 1) : UNO_OUTLINE;
// A push button on a board: a momentary boolean field the page presses, the control that places it (millimetres and picture region) and what it does
// (restart: the sketch restarts, as a reset or EN button; pull_low: it ties a pin to ground, as BOOT does on GPIO0). Positions are estimated.
const BTN_NAME = { reset: L("Reset", "Reiniciar", "Reiniciar"), en: L("EN (reset)", "EN (reiniciar)", "EN (reiniciar)"), boot: L("BOOT (GPIO0)", "BOOT (GPIO0)", "BOOT (GPIO0)") };
const button = (name, mm, scale, action, extra = {}) => ({
  field: { name, type: "boolean", label: BTN_NAME[name], default: false },
  control: { field: name, region: { x: Math.round((mm.x - 3) * scale * 10) / 10, y: Math.round((mm.y - 3) * scale * 10) / 10, w: 6 * scale, h: 6 * scale }, mode: "momentary", label: BTN_NAME[name], mm, action, estimate: true, ...extra },
});
const buttonSvg = (mm, px, label) => `<rect x="${px(mm.x - 1.5)}" y="${px(mm.y - 1.5)}" width="${px(3)}" height="${px(3)}" rx="1" fill="#b0302a" stroke="#4a1210" stroke-width="2"/><text x="${px(mm.x)}" y="${px(mm.y + 4.6)}" text-anchor="middle" font-family="monospace" font-size="8" fill="#ccc">${label}</text>`;
const inch = (i) => Math.round(i * 25.4 * 100) / 100;
const X = (i) => Math.round((OVER + i * 25.4) * 100) / 100;   // x of a header position given in inches from the board's left edge (Arduino Uno R3 drawing: D0 and A5 at 2.5 in = 63.5 mm)
function unoPins(v) {
  const r4 = v !== "uno-r3", wifi = v === "uno-r4-wifi", lim = HI5;
  const pins = [], dcaps = { 0: ["uart_rx"], 1: ["uart_tx"], 2: ["interrupt"], 3: ["pwm", "interrupt"], 5: ["pwm"], 6: ["pwm"], 9: ["pwm"], 10: ["pwm", "spi_ss"], 11: ["pwm", "spi_mosi"], 12: ["spi_miso"], 13: ["spi_sck"] };
  // digital header: left to right SCL SDA AREF GND 13 12 11 10 9 8 | 7 6 5 4 3 2 1 0
  const top = [["SCL", null], ["SDA", null], ["AREF", null], ["GND_T", null], ...[13, 12, 11, 10, 9, 8].map((n) => ["D" + n, n]), ...[7, 6, 5, 4, 3, 2, 1, 0].map((n) => ["D" + n, n])];
  const xs = [0.74, 0.84, 0.94, 1.04, 1.14, 1.24, 1.34, 1.44, 1.54, 1.64, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5];   // SCL .. D8 then D7 .. D0: 0.1 in pitch with the 0.16 in gap between D8 and D7 (D0 at 2.5 in)
  top.forEach(([name, n], i) => {
    const x = X(xs[i]);
    if (n !== null) pins.push(P(name, "io", x, TOP_Y, { gpio: n, face: "top", abs_max_mv: lim, caps: ["digital", ...(dcaps[n] ?? []), ...(r4 && !(dcaps[n] ?? []).includes("interrupt") ? ["interrupt"] : [])], label: { en: name.replace("D", "") + (n === 13 ? " (L)" : "") } }));
    else if (name === "GND_T") pins.push(P(name, "ground", x, TOP_Y, { face: "top", label: { en: "GND" } }));
    else if (name === "AREF") pins.push(P(name, "io", x, TOP_Y, { face: "top", abs_max_mv: lim, caps: ["analog"], label: { en: "AREF" } }));
    else pins.push(P(name, "io", x, TOP_Y, { face: "top", abs_max_mv: lim, caps: [name === "SDA" ? "i2c_sda" : "i2c_scl"], label: { en: name } }));
  });
  // power header: NC IOREF RESET 3V3 5V GND GND VIN, then A0..A5
  const px = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8];   // power header, VIN at 1.8 in, one empty position, then A0 at 2.0 in .. A5 at 2.5 in
  pins.push(P("NC", "nc", X(px[0]), BOT_Y, { face: "top", label: { en: "NC" } }));
  pins.push(P("IOREF", "power_out", X(px[1]), BOT_Y, { face: "top", out_mv: 5000, out_ohms: 50, label: { en: "IOREF" } }));
  pins.push(P("RESET", "io", X(px[2]), BOT_Y, { face: "top", abs_max_mv: lim, label: { en: "RESET" } }));
  pins.push(P("V33", "power_out", X(px[3]), BOT_Y, { face: "top", out_mv: 3300, out_ohms: 10, label: { en: "3V3" } }));
  pins.push(P("V5", "power_in", X(px[4]), BOT_Y, { face: "top", min_mv: 4500, max_mv: 5500, typ_ma: wifi ? 120 : 50, supply_group: "pwr", internal: { mv: 5000, ohms: 0.5, field: "usb" }, label: { en: "5V" } }));
  pins.push(P("GND_1", "ground", X(px[5]), BOT_Y, { face: "top", label: { en: "GND" } }));
  pins.push(P("GND_2", "ground", X(px[6]), BOT_Y, { face: "top", label: { en: "GND" } }));
  pins.push(P("VIN", "power_in", X(px[7]), BOT_Y, { face: "top", min_mv: 6500, max_mv: r4 ? 24000 : 20000, typ_ma: wifi ? 120 : 50, supply_group: "pwr", label: { en: "VIN" } }));
  for (let i = 0; i < 6; i++) pins.push(P("A" + i, "io", X(2.0 + 0.1 * i), BOT_Y, { gpio: 14 + i, face: "top", abs_max_mv: lim, caps: ["analog", "digital", ...(i === 4 ? ["i2c_sda"] : []), ...(i === 5 ? ["i2c_scl"] : []), ...(r4 && i === 0 ? ["dac"] : [])], label: { en: "A" + i } }));
  for (const p of pins) p.mm.z = CONTACT_Z;
  return pins;
}
const unoGroups = () => [{ pins: ["A4", "SDA"] }, { pins: ["A5", "SCL"] }, { pins: ["GND_T", "GND_1", "GND_2"] }];

const blinkIno = (v) => `// Default sketch of ${v.title}: blink the on-board LED (D13 / LED_BUILTIN) and print a line per toggle on the serial monitor.
// This board does not emulate its chip: the sketch is compiled to WebAssembly against ArduinoCore-API + dotcore for "${v.core}".
#include <dotbench.h>
#include "dotbench_fields.h"        // FIELD_BLINK_MS${v.matrix ? ", OUTPUT_MATRIX0.." : ""} (generated from manifest.json)
${v.matrix ? '#include <Arduino_LED_Matrix.h>\nArduinoLEDMatrix matrix;\nstatic const uint32_t HEART[3] = { 0x3184a444, 0x44042081, 0x100a0040 };\n' : ""}
static uint32_t last = 0; static bool on = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
${v.matrix ? "  matrix.begin();\n" : ""}  Serial.println("${v.title}: blinking LED_BUILTIN");
}

void loop() {
  uint32_t half = (uint32_t)dotbenchField(FIELD_BLINK_MS);
  if (millis() - last >= half) {
    last = millis(); on = !on;
${v.rgb ? "    neopixelWrite(LED_BUILTIN, on ? 0 : 0, on ? 40 : 0, on ? 90 : 0);   // a teal pulse on the on-board RGB LED\n" : "    digitalWrite(LED_BUILTIN, on ? HIGH : LOW);\n"}${v.matrix ? "    if (on) matrix.loadFrame(HEART); else matrix.clear();\n" : ""}    Serial.println(on ? "LED on" : "LED off");
  }
  delay(1);
}
`;

// outputs every board declares so a model can show life (after any output a sketch writes by index): serial byte counters (activity = the counter changed), the user LED, a crash flag
const LIFE = [{ name: "led", type: "number", label: L("User LED (0 to 1)", "LED do usuário (0 a 1)", "LED del usuario (0 a 1)") }, { name: "tx", type: "number", label: L("Serial bytes sent", "Bytes seriais enviados", "Bytes seriales enviados") },
  { name: "rx", type: "number", label: L("Serial bytes received", "Bytes seriais recebidos", "Bytes seriales recibidos") }, { name: "crashed", type: "boolean", label: L("Stopped (crashed)", "Parada (travou)", "Detenida (falló)") }];
const NOEMU = {
  en: "This part does NOT emulate the chip: there is no AVR/ARM/Xtensa core, no bootloader and no peripheral registers. Its sketch is compiled to WebAssembly against ArduinoCore-API + dotcore (the bench's Arduino core), so the pins, voltages, Arduino API and timing in milliseconds are real, instruction timing is not. Code that pokes registers (PORTB, DDRB, TCCR1A, direct HW access) does not compile.",
  "pt-BR": "Esta peça NÃO emula o chip: não há núcleo AVR/ARM/Xtensa, bootloader nem registradores de periféricos. O sketch é compilado para WebAssembly contra ArduinoCore-API + dotcore (o núcleo Arduino da bancada), então os pinos, tensões, API Arduino e tempo em milissegundos são reais, o tempo de instrução não é. Código que mexe em registradores (PORTB, DDRB, TCCR1A, acesso direto ao hardware) não compila.",
  es: "Esta pieza NO emula el chip: no hay núcleo AVR/ARM/Xtensa, bootloader ni registros de periféricos. El sketch se compila a WebAssembly contra ArduinoCore-API + dotcore (el núcleo Arduino del banco), así que los pines, tensiones, API Arduino y tiempo en milisegundos son reales, el tiempo de instrucción no. El código que toca registros (PORTB, DDRB, TCCR1A, acceso directo al hardware) no compila.",
};
const cat = (a, b) => ({ en: a.en + " " + b.en, "pt-BR": a["pt-BR"] + " " + b["pt-BR"], es: a.es + " " + b.es });

const blinkTest = (extra = []) => ({ name: "default sketch blinks the on-board LED", steps: [
  { comment: "powered over USB (field usb is on): the first toggle comes after blink_ms (500 ms)", advance_ms: 400 }, { expect_visual: { id: "led", value: 0 } },
  { advance_ms: 150 }, { expect_visual: { id: "led", value: 1 } }, { expect_serial: "LED on" }, { advance_ms: 500 }, { expect_visual: { id: "led", value: 0 } },
  { set_field: { blink_ms: 100 } }, { advance_ms: 120 }, { expect_visual: { id: "led", value: 1 } }, ...extra ] });
const noPowerTest = { name: "no USB and nothing on 5V or VIN: the board is off", steps: [
  { set_field: { usb: false } }, { advance_ms: 700 }, { expect_visual: { id: "led", value: 0 } } ] };

export function boards() {
  const out = [];
  const UNO = [
    { id: "uno-r3", core: "uno-r3", title: "Arduino Uno R3", name: L("Arduino Uno R3", "Arduino Uno R3", "Arduino Uno R3"), tags: ["arduino", "uno", "atmega328p", "5v", "avr"],
      kw: KW(["arduino", "uno", "r3", "atmega328p", "avr", "microcontroller", "board", "5v"], ["arduino", "uno", "r3", "atmega328p", "microcontrolador", "placa", "5v"], ["arduino", "uno", "r3", "atmega328p", "microcontrolador", "placa", "5v"]),
      desc: L("Arduino Uno R3 (ATmega328P form factor): 5 V logic, D0-D13 with PWM on 3 5 6 9 10 11 (490 Hz, 980 Hz on 5 and 6), A0-A5 on a 10 bit ADC with a 5 V reference, I2C on A4 and A5 (also the SDA and SCL header pins), SPI on D10-D13, Serial on USB and on D0 and D1, interrupts on D2 and D3, EEPROM 1 KB. Power it with the usb field, 5 V on the 5V pin or 6.5 to 20 V on VIN (the regulator does not feed 5V and 3V3 from VIN in this model; 3V3 is a 50 mA output while the board is powered).",
        "Arduino Uno R3 (formato do ATmega328P): lógica de 5 V, D0-D13 com PWM em 3 5 6 9 10 11 (490 Hz, 980 Hz em 5 e 6), A0-A5 num ADC de 10 bits com referência de 5 V, I2C em A4 e A5 (também os pinos SDA e SCL do cabeçote), SPI em D10-D13, Serial no USB e em D0 e D1, interrupções em D2 e D3, EEPROM de 1 KB. Alimente com o campo usb, 5 V no pino 5V ou 6,5 a 20 V no VIN (o regulador não alimenta 5V e 3V3 a partir do VIN neste modelo; 3V3 é uma saída de 50 mA com a placa ligada).",
        "Arduino Uno R3 (formato del ATmega328P): lógica de 5 V, D0-D13 con PWM en 3 5 6 9 10 11 (490 Hz, 980 Hz en 5 y 6), A0-A5 en un ADC de 10 bits con referencia de 5 V, I2C en A4 y A5 (también los pines SDA y SCL del cabezal), SPI en D10-D13, Serial por USB y en D0 y D1, interrupciones en D2 y D3, EEPROM de 1 KB. Aliméntala con el campo usb, 5 V en el pin 5V o 6,5 a 20 V en VIN (el regulador no alimenta 5V y 3V3 desde VIN en este modelo; 3V3 es una salida de 50 mA con la placa encendida)."), },
    { id: "uno-r4-minima", core: "uno-r4-minima", title: "Arduino Uno R4 Minima", name: L("Arduino Uno R4 Minima", "Arduino Uno R4 Minima", "Arduino Uno R4 Minima"), tags: ["arduino", "uno", "r4", "minima", "renesas", "ra4m1", "5v"],
      kw: KW(["arduino", "uno", "r4", "minima", "ra4m1", "renesas", "microcontroller", "board", "5v", "dac"], ["arduino", "uno", "r4", "minima", "ra4m1", "renesas", "microcontrolador", "placa", "5v", "dac"], ["arduino", "uno", "r4", "minima", "ra4m1", "renesas", "microcontrolador", "placa", "5v", "dac"]),
      desc: L("Arduino Uno R4 Minima (Renesas RA4M1 form factor): 5 V logic, Uno R3 header with PWM on 3 5 6 9 10 11, A0-A5 on a 10 bit ADC that analogReadResolution() raises to 12 or 14 bits, a 12 bit DAC on A0, I2C on A4 and A5, SPI on D10-D13, Serial on USB (CDC) and Serial1 on D0 and D1, interrupts on all digital pins, EEPROM 8 KB. Power with the usb field, 5 V on 5V or 6 to 24 V on VIN.",
        "Arduino Uno R4 Minima (formato do Renesas RA4M1): lógica de 5 V, cabeçote do Uno R3 com PWM em 3 5 6 9 10 11, A0-A5 num ADC de 10 bits que analogReadResolution() eleva a 12 ou 14 bits, um DAC de 12 bits em A0, I2C em A4 e A5, SPI em D10-D13, Serial no USB (CDC) e Serial1 em D0 e D1, interrupções em todos os pinos digitais, EEPROM de 8 KB. Alimente com o campo usb, 5 V em 5V ou 6 a 24 V no VIN.",
        "Arduino Uno R4 Minima (formato del Renesas RA4M1): lógica de 5 V, cabezal del Uno R3 con PWM en 3 5 6 9 10 11, A0-A5 en un ADC de 10 bits que analogReadResolution() sube a 12 o 14 bits, un DAC de 12 bits en A0, I2C en A4 y A5, SPI en D10-D13, Serial por USB (CDC) y Serial1 en D0 y D1, interrupciones en todos los pines digitales, EEPROM de 8 KB. Aliméntala con el campo usb, 5 V en 5V o 6 a 24 V en VIN.") },
    { id: "uno-r4-wifi", core: "uno-r4-wifi", title: "Arduino Uno R4 WiFi", matrix: true, name: L("Arduino Uno R4 WiFi", "Arduino Uno R4 WiFi", "Arduino Uno R4 WiFi"), tags: ["arduino", "uno", "r4", "wifi", "renesas", "esp32-s3", "led-matrix", "5v"],
      kw: KW(["arduino", "uno", "r4", "wifi", "led matrix", "ra4m1", "esp32-s3", "microcontroller", "board", "5v"], ["arduino", "uno", "r4", "wifi", "matriz de led", "ra4m1", "esp32-s3", "microcontrolador", "placa", "5v"], ["arduino", "uno", "r4", "wifi", "matriz de led", "ra4m1", "esp32-s3", "microcontrolador", "placa", "5v"]),
      desc: L("Arduino Uno R4 WiFi: everything the R4 Minima has plus a 12 x 8 LED matrix (ArduinoLEDMatrix, loadFrame and renderBitmap; the 96 pixels are the three 32 bit part outputs matrix0, matrix1, matrix2, bit 31 of matrix0 is the top left LED, row by row, for the page to draw) and a WiFi radio that is NOT connected: WiFi.begin() leaves the board disconnected and says so in the part's console. Sequences and ArduinoGraphics text on the matrix are not implemented.",
        "Arduino Uno R4 WiFi: tudo do R4 Minima mais uma matriz de LED 12 x 8 (ArduinoLEDMatrix, loadFrame e renderBitmap; os 96 pixels são as três saídas de 32 bits matrix0, matrix1, matrix2, o bit 31 de matrix0 é o LED do canto superior esquerdo, linha a linha, para a página desenhar) e um rádio WiFi que NÃO conecta: WiFi.begin() deixa a placa desconectada e avisa no console da peça. Sequências e texto ArduinoGraphics na matriz não estão implementados.",
        "Arduino Uno R4 WiFi: todo lo del R4 Minima más una matriz de LED de 12 x 8 (ArduinoLEDMatrix, loadFrame y renderBitmap; los 96 píxeles son las tres salidas de 32 bits matrix0, matrix1, matrix2, el bit 31 de matrix0 es el LED superior izquierdo, fila a fila, para que la página lo dibuje) y una radio WiFi que NO conecta: WiFi.begin() deja la placa desconectada y lo avisa en la consola de la pieza. Las secuencias y el texto de ArduinoGraphics en la matriz no están implementados.") },
  ];
  for (const v of UNO) {
    OVER = v.core === "uno-r3" ? 6.4 : 2.04;   // USB-B sticks out 6.4 mm, the R4's barrel jack 2.04 mm (w_mm 70.62)
    const LED = { x: v.id === "uno-r4-wifi" ? 26.42 : 27.94, y: 11.18 }, RST = button("reset", { x: OVER + 10, y: 4.5 }, 8, "restart");
    const pins = unoPins(v.core);
    const outputs = [...(v.matrix ? [0, 1, 2].map((i) => ({ name: "matrix" + i, type: "number", label: L(`LED matrix word ${i}`, `Matriz de LED, palavra ${i}`, `Matriz de LED, palabra ${i}`) })) : []), ...LIFE];
    out.push(writePart({ id: "dotbench." + v.id, dir: v.id, w: UNO_W + OVER, d: UNO_D, h: 15, scale: 8, category: "mcu", tags: v.tags, keywords: v.kw, name: v.name, desc: cat(v.desc, NOEMU),
      extra: { logic_mv: 5000, ...(v.core === "uno-r3" ? { vih_pct: 60 } : {}), outline: unoOutline(v.core).map(([x, y]) => ({ x: Math.round((OVER + x) * 1000) / 1000, y })), refs: UNO_HOLES.map(([x, y], i) => ({ name: "hole" + (i + 1), kind: "hole", diameter_mm: 3.2, mm: { x: Math.round((OVER + x) * 100) / 100, y, z: 0 } })) }, pins, groups: unoGroups(),
      fields: [{ name: "usb", type: "boolean", label: L("Powered over USB", "Alimentada por USB", "Alimentada por USB"), default: true }, { name: "blink_ms", type: "integer", label: L("Blink half-period", "Meio período do pisca", "Medio período del parpadeo"), min: 20, max: 2000, step: 10, unit: "ms", default: 500, ui: "slider" }, RST.field], controls: [RST.control],
      ...(outputs ? { outputs } : {}),
      visuals: [{ id: "led", effect: "glow", x: Math.round((OVER + LED.x) * 8), y: Math.round(LED.y * 8), r: 7, color: "#f5c518", source: { gpio: 13 }, mm: { x: Math.round((OVER + LED.x) * 100) / 100, y: LED.y } }],
      behaviour: { type: "wasm", entry: "behaviour.wasm", abi: 1, core: v.core, memory_kb: 1024, stack_kb: 64, sources: ["src/main.ino"] },
      svg: ({ px }) => { const o = px(OVER), B = unoOutline(v.core).map(([x, y]) => `${(o + px(x)).toFixed(1)},${px(y).toFixed(1)}`).join(" ");
        return `<polygon points="${B}" fill="${v.core === "uno-r3" ? "#00878f" : "#0b6e7a"}" stroke="#034a52" stroke-width="3"/>`
        + `<rect x="0" y="${px(8)}" width="${px(OVER + 10)}" height="${px(12)}" fill="#c0c4c8" stroke="#555" stroke-width="2"/><text x="${px(OVER / 2 + 3)}" y="${px(14.5)}" text-anchor="middle" font-family="monospace" font-size="11" fill="#333">${v.core === "uno-r3" ? "USB-B" : "USB-C"}</text>`
        + `<rect x="0" y="${px(36)}" width="${px(OVER + 8)}" height="${px(10)}" fill="#222" stroke="#000" stroke-width="2"/><text x="${px(OVER / 2 + 2)}" y="${px(41.5)}" text-anchor="middle" font-family="monospace" font-size="10" fill="#aaa">DC</text>`
        + `<rect x="${px(OVER + 30)}" y="${px(18)}" width="${px(16)}" height="${px(16)}" fill="#1b1b1b"/><text x="${px(OVER + 38)}" y="${px(27.5)}" text-anchor="middle" font-family="monospace" font-size="11" fill="#bbb">${v.core === "uno-r3" ? "ATmega328P" : "RA4M1"}</text>`
        + (v.matrix ? `<rect x="${px(OVER + 44)}" y="${px(22)}" width="${px(21)}" height="${px(14)}" fill="#101010" stroke="#444" stroke-width="2"/>` : "")
        + `<text x="${px(OVER + 2)}" y="${px(30)}" font-family="sans-serif" font-size="15" font-weight="bold" fill="#fff">${v.title.replace("Arduino ", "")}</text><circle id="led" cx="${px(OVER + LED.x)}" cy="${px(LED.y)}" r="7" fill="#f5c518" opacity="0.25"/>` + buttonSvg({ x: OVER + 10, y: 4.5 }, px, "RST") + UNO_HOLES.map(([x, y]) => `<circle cx="${(o + px(x)).toFixed(1)}" cy="${px(y)}" r="${px(1.6)}" fill="#0a0a0a" stroke="#c9a227" stroke-width="1.5"/>`).join("") + pinDots(pins, px, 4); },
      files: { "src/main.ino": blinkIno(v) },
      tests: { "blink.test.json": blinkTest(v.matrix ? [{ comment: "the heart is on the matrix while the LED is on", expect_output: { name: "matrix0", value: 0x3184a444 } }, { expect_output: { name: "matrix2", value: 0x100a0040 } }] : []) } }));
  }
  // ---------------------------------------------------------------- ESP32-S3 DevKitC-1
  { const left = ["V33_1", "V33_2", "RST", 4, 5, 6, 7, 15, 16, 17, 18, 8, 3, 46, 9, 10, 11, 12, 13, 14, "V5", "GND_1"], right = ["GND_2", "TX", "RX", 1, 2, 42, 41, 40, 39, 38, 37, 36, 35, 0, 45, 48, 47, 21, 20, 19, "GND_3", "GND_4"];
    const boot = new Set([0, 3, 45, 46]), caps = (n) => ["digital", "pwm", "interrupt", ...(n >= 1 && n <= 20 ? ["analog"] : []), ...(n >= 1 && n <= 14 ? ["touch"] : []), ...(n === 8 ? ["i2c_sda"] : []), ...(n === 9 ? ["i2c_scl"] : []), ...(n === 10 ? ["spi_ss"] : []), ...(n === 11 ? ["spi_mosi"] : []), ...(n === 12 ? ["spi_sck"] : []), ...(n === 13 ? ["spi_miso"] : []), ...(n === 43 ? ["uart_tx"] : []), ...(n === 44 ? ["uart_rx"] : []), ...(boot.has(n) ? ["boot_strap"] : [])];
    const mk = (n, x, y) => {
      if (n === "V33_1" || n === "V33_2") return P(n, "power_out", x, y, { face: "bottom", out_mv: 3300, out_ohms: 4, label: { en: "3V3" } });
      if (n === "V5") return P(n, "power_in", x, y, { face: "bottom", min_mv: 4500, max_mv: 5500, typ_ma: 150, supply_group: "pwr", internal: { mv: 5000, ohms: 0.5, field: "usb" }, label: { en: "5V" } });
      if (String(n).startsWith("GND")) return P(n, "ground", x, y, { face: "bottom", label: { en: "GND" } });
      if (n === "RST") return P(n, "io", x, y, { face: "bottom", abs_max_mv: HI3, label: { en: "RST" } });
      const g = n === "TX" ? 43 : n === "RX" ? 44 : n;
      return P(n === "TX" || n === "RX" ? n : "IO" + n, "io", x, y, { gpio: g, face: "bottom", abs_max_mv: HI3, caps: caps(g), label: { en: n === "TX" || n === "RX" ? n : "IO" + n } });
    };
    // the picture is the top view with the 3V3 end (antenna) on the left and the USB end on the right: J1 (3V3 ... 5V, GND) is the front row (y = 24.13 mm), J3 (GND ... GND) the back row (y = 1.27 mm), 22.86 mm (0.9 in) apart
    const pins = [...left.map((n, i) => mk(n, 4.7 + 2.54 * i, 24.13)), ...right.map((n, i) => mk(n, 4.7 + 2.54 * i, 1.27))];
    const W = 62.74, D = 25.4;   // 62.74 x 25.40 mm are the two overall sizes in Espressif's PCB drawing PDF (PCB_ESP32-S3-DevKitC-1_V1_20210312CB); the drawing text does not say which is the length, so the length is UNVERIFIED (body.estimate)
    const ENB = button("en", { x: W - 5.5, y: 3.5 }, 10, "restart"), BOOTB = button("boot", { x: W - 5.5, y: D - 3.5 }, 10, "pull_low", { pin: "IO0" });   // the two buttons flank the USB sockets at the right end (estimated)
    out.push(writePart({ id: "dotbench.esp32-s3-devkitc", dir: "esp32-s3-devkitc", w: W, d: D, h: 14, scale: 10, estimate: true, category: "mcu", tags: ["esp32", "esp32-s3", "espressif", "devkitc", "3v3", "wifi", "ble"],
      keywords: KW(["esp32-s3", "esp32s3", "devkitc", "espressif", "xtensa", "microcontroller", "board", "3.3v", "wifi", "ble"], ["esp32-s3", "esp32s3", "devkitc", "espressif", "xtensa", "microcontrolador", "placa", "3,3v", "wifi", "ble"], ["esp32-s3", "esp32s3", "devkitc", "espressif", "xtensa", "microcontrolador", "placa", "3,3v", "wifi", "ble"]),
      name: L("ESP32-S3 DevKitC-1", "ESP32-S3 DevKitC-1", "ESP32-S3 DevKitC-1"),
      desc: cat(L("ESP32-S3-DevKitC-1: 3.3 V logic, two 22 pin headers at 0.9 inch (breadboard friendly, pins down), PWM (LEDC) on any GPIO, 12 bit ADC on GPIO1 to 20 (analogReadResolution up to 14 bits), touch on GPIO1 to 14, I2C on GPIO8 and 9, SPI on GPIO10 to 13, UART0 on GPIO43 and 44, on-board RGB LED on GPIO48 (shown as one LED), BOOT on GPIO0. Power with the usb field or 5 V on the 5V pin; 3V3 is a 3.3 V output while powered. GPIO19 and 20 are the USB pins and not modelled as such; GPIO35 to 37 are left free (no PSRAM modelled). WiFi and Bluetooth are not simulated.",
        "ESP32-S3-DevKitC-1: lógica de 3,3 V, dois cabeçotes de 22 pinos a 0,9 polegada (cabe na protoboard, pinos para baixo), PWM (LEDC) em qualquer GPIO, ADC de 12 bits nos GPIO1 a 20 (analogReadResolution até 14 bits), toque nos GPIO1 a 14, I2C nos GPIO8 e 9, SPI nos GPIO10 a 13, UART0 nos GPIO43 e 44, LED RGB da placa no GPIO48 (mostrado como um LED), BOOT no GPIO0. Alimente com o campo usb ou 5 V no pino 5V; 3V3 é uma saída de 3,3 V com a placa ligada. GPIO19 e 20 são os pinos USB e não são modelados como tal; GPIO35 a 37 ficam livres (sem PSRAM). WiFi e Bluetooth não são simulados.",
        "ESP32-S3-DevKitC-1: lógica de 3,3 V, dos cabezales de 22 pines a 0,9 pulgadas (apta para protoboard, pines hacia abajo), PWM (LEDC) en cualquier GPIO, ADC de 12 bits en GPIO1 a 20 (analogReadResolution hasta 14 bits), táctil en GPIO1 a 14, I2C en GPIO8 y 9, SPI en GPIO10 a 13, UART0 en GPIO43 y 44, LED RGB de la placa en GPIO48 (mostrado como un LED), BOOT en GPIO0. Aliméntala con el campo usb o 5 V en el pin 5V; 3V3 es una salida de 3,3 V con la placa encendida. GPIO19 y 20 son los pines USB y no se modelan como tal; GPIO35 a 37 quedan libres (sin PSRAM). WiFi y Bluetooth no se simulan."), NOEMU),
      extra: { logic_mv: 3300 }, pins, groups: [{ pins: ["V33_1", "V33_2"] }, { pins: ["GND_1", "GND_2", "GND_3", "GND_4"] }],
      fields: [{ name: "usb", type: "boolean", label: L("Powered over USB", "Alimentada por USB", "Alimentada por USB"), default: true }, { name: "blink_ms", type: "integer", label: L("Blink half-period", "Meio período do pisca", "Medio período del parpadeo"), min: 20, max: 2000, step: 10, unit: "ms", default: 500, ui: "slider" }, ENB.field, BOOTB.field], controls: [ENB.control, BOOTB.control],
      outputs: [...["r", "g", "b"].map((c) => ({ name: "rgb_" + c, type: "number", min: 0, max: 255, label: L("RGB LED " + c.toUpperCase() + " (0 to 255)", "LED RGB " + c.toUpperCase() + " (0 a 255)", "LED RGB " + c.toUpperCase() + " (0 a 255)") })), ...LIFE],
      visuals: [{ id: "led", effect: "glow", x: 500, y: 127, r: 8, color: "#ffffff", source: { gpio: 48 } }],
      behaviour: { type: "wasm", entry: "behaviour.wasm", abi: 1, core: "esp32-s3", memory_kb: 1024, stack_kb: 64, sources: ["src/main.ino"] },
      svg: ({ px }) => `<rect x="2" y="2" width="${px(W) - 4}" height="${px(D) - 4}" rx="4" fill="#1b1b1b" stroke="#000" stroke-width="3"/><rect x="${px(4)}" y="${px(6)}" width="${px(18)}" height="${px(13)}" fill="#8a8f98" stroke="#555" stroke-width="2"/><text x="${px(13)}" y="${px(13.5)}" text-anchor="middle" font-family="monospace" font-size="11" fill="#222">ESP32-S3</text><rect x="${px(W - 8)}" y="${px(8)}" width="${px(8)}" height="${px(9)}" fill="#c0c4c8" stroke="#555" stroke-width="2"/><circle id="led" cx="500" cy="127" r="8" fill="#ffffff" opacity="0.25"/>` + buttonSvg({ x: W - 5.5, y: 3.5 }, px, "EN") + buttonSvg({ x: W - 5.5, y: D - 3.5 }, px, "BOOT") + pinDots(pins, px, 4),
      files: { "src/main.ino": blinkIno({ title: "ESP32-S3 DevKitC-1", core: "esp32-s3", rgb: true }) },
      tests: { "blink.test.json": blinkTest() } })); }
  return out;
}
