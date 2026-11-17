// SPDX-License-Identifier: GPL-3.0-or-later
// The first built-in parts were written by hand (their manifest.json is the source). This adds what the page needs for a 3D model and for search
// without regenerating them: body size, terminal positions in millimetres (2.54 mm pitch where the real part has it), faces, and keywords in three languages.
// Idempotent: `node parts/gen/gen-parts.mjs` runs it. Convention: docs/STATUS-parts.md "Geometry".
import fs from "node:fs";
import path from "node:path";
import { PARTS } from "./lib.mjs";

const K = (en, pt, es) => ({ en, "pt-BR": pt, es });
const row = (names, x0, y, pitch, face = "bottom") => Object.fromEntries(names.map((n, i) => [n, { x: Math.round((x0 + pitch * i) * 100) / 100, y, face }]));
const FILL = { led: "#5a1410", buzzer: "#222", "esp32-blink-echo": "#1b2a3a", hdc1080: "#14473a", potentiometer: "#2a63b8", "push-button": "#444", "rgb-led": "#35305a", servo: "#2a63b8", "slide-switch": "#555" };
const TITLE = { led: "LED", buzzer: "BUZZER", hdc1080: "HDC1080", potentiometer: "POT", "push-button": "BTN", "rgb-led": "RGB", servo: "SERVO", "slide-switch": "SW" };
/** picture = the top view of the body at one scale; every pin dot sits at mm x scale (checked for every part by tests/node/parts/geometry.test.mjs) */
function picture(dir, s, m) {
  const [w, d] = s.body, k = Math.max(8, Math.min(30, Math.round(150 / Math.max(w, d)))), W = Math.round(w * k), H = Math.round(d * k), px = (v) => Math.round(v * k * 10) / 10;
  for (const p of m.pins) p.pos = { x: px(p.mm.x), y: px(p.mm.y) };
  m.picture = { file: "picture.svg", width: W, height: H };
  const r = Math.max(2, Math.min(7, k * 0.45)), motif = dir === "led" || dir === "rgb-led" || dir === "buzzer" ? `<circle cx="${W / 2}" cy="${H / 2}" r="${Math.min(W, H) * 0.38}" fill="${FILL[dir]}" stroke="#ffffff55" stroke-width="2"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${Math.min(10, k)}" fill="${motif ? "#1d2a38" : FILL[dir]}" stroke="#0e1822" stroke-width="2"/>${motif}\n<g font-family="monospace" font-size="${Math.max(7, Math.min(11, k * 0.8))}" fill="#e8eef5">${TITLE[dir] ? `<text x="${W / 2}" y="${H * 0.42}" text-anchor="middle">${TITLE[dir]}</text>` : ""}${m.pins.map((p) => `<circle cx="${p.pos.x}" cy="${p.pos.y}" r="${r}" fill="#c9a227" stroke="#7a6416" stroke-width="1.5"/>`).join("")}</g>\n</svg>\n`;
  fs.writeFileSync(path.join(PARTS, dir, "picture.svg"), svg);
}
const SPEC = {
  led: { body: [5.8, 5.8, 9], pins: { A: { x: 1.63, y: 2.9, face: "bottom" }, K: { x: 4.17, y: 2.9, face: "bottom" } }, kw: K(["led", "light", "indicator", "diode"], ["led", "luz", "indicador", "diodo"], ["led", "luz", "indicador", "diodo"]) },
  buzzer: { body: [12, 12, 9.5], pins: { P: { x: 2.2, y: 6, face: "bottom" }, N: { x: 9.8, y: 6, face: "bottom" } }, kw: K(["buzzer", "beep", "sound", "piezo", "speaker"], ["buzzer", "campainha", "som", "piezo", "alto-falante"], ["zumbador", "buzzer", "sonido", "piezo", "altavoz"]) },
  "esp32-blink-echo": { body: [55, 28, 13], pins: row(["V33", "GND", "TX", "RX", "SDA", "SCL", "IO4", "IO5", "IO13", "IO14", "IO18", "IO19", "IO23", "IO25", "IO34", "IO35"], 5, 26.7, 2.54), kw: K(["esp32", "microcontroller", "board", "wifi", "uart", "3.3v"], ["esp32", "microcontrolador", "placa", "wifi", "uart", "3,3v"], ["esp32", "microcontrolador", "placa", "wifi", "uart", "3,3v"]) },
  hdc1080: { body: [20, 12, 6], pins: row(["VCC", "GND", "SDA", "SCL"], 6.19, 10.5, 2.54), kw: K(["hdc1080", "temperature", "humidity", "i2c", "sensor"], ["hdc1080", "temperatura", "umidade", "i2c", "sensor"], ["hdc1080", "temperatura", "humedad", "i2c", "sensor"]) },
  potentiometer: { body: [14.5, 11, 16], pins: row(["T", "W", "B"], 2.19, 10, 5.08), kw: K(["potentiometer", "knob", "analog", "resistor", "dial"], ["potenciômetro", "botão giratório", "analógico", "resistor"], ["potenciómetro", "perilla", "analógico", "resistencia"]) },
  "push-button": { body: [6, 6, 5], pins: { A: { x: 0.46, y: 3, face: "bottom" }, B: { x: 5.54, y: 3, face: "bottom" } }, kw: K(["button", "switch", "push", "input"], ["botão", "chave", "pressionar", "entrada"], ["botón", "pulsador", "interruptor", "entrada"]) },
  "rgb-led": { body: [8.6, 5.8, 13], pins: row(["R", "COM", "G", "B"], 0.5, 2.9, 2.54), kw: K(["rgb", "led", "color", "light"], ["rgb", "led", "cor", "luz"], ["rgb", "led", "color", "luz"]) },
  servo: { body: [32.3, 12.2, 31.8], pins: { GND: { x: 0, y: 3.66, face: "left", z: 4 }, V5: { x: 0, y: 6.2, face: "left", z: 4 }, SIG: { x: 0, y: 8.74, face: "left", z: 4 } }, kw: K(["servo", "sg90", "motor", "angle", "pwm", "arduino servo"], ["servo", "sg90", "motor", "ângulo", "pwm"], ["servo", "sg90", "motor", "ángulo", "pwm"]) },
  "slide-switch": { body: [8.6, 3.6, 8.5], pins: row(["A", "COM", "B"], 1.76, 1.8, 2.54), kw: K(["switch", "slide", "toggle", "input"], ["chave", "deslizante", "interruptor", "entrada"], ["interruptor", "deslizante", "entrada"]) },
};
SPEC["esp32-button-led"] = { ...SPEC["esp32-blink-echo"] }; SPEC["esp32-i2c-slave"] = { ...SPEC["esp32-blink-echo"] };

// ---- the three classic ESP32 boards model the ESP32-DevKitC V4 (ESP32-WROOM-32): 2 x 19 pins, rows 25.4 mm apart, board 54.4 x 27.94 mm. Laid out with the 3V3 end
// (antenna) on the left and the USB end on the right: J2 (3V3 ... 5V) is the front row (y = 26.67), J3 (GND ... CLK) the back row (y = 1.27). x from 3.4 mm.
// Old names survive as aliases: GND (= GND_1), TX (= IO17, UART2 TX), RX (= IO16), SDA (= IO21), SCL (= IO22); the real UART0 pins are TXD0 (GPIO1) and RXD0 (GPIO3).
const ESP_W = 54.4, ESP_D = 27.94, ESP_X0 = 3.4, ESP_SCALE = 9;
const ESP_J2 = ["V33", "EN", "IO36", "IO39", "IO34", "IO35", "IO32", "IO33", "IO25", "IO26", "IO27", "IO14", "IO12", "GND_1", "IO13", "IO9", "IO10", "IO11", "V5"];
const ESP_J3 = ["GND_2", "IO23", "IO22", "TXD0", "RXD0", "IO21", "GND_3", "IO19", "IO18", "IO5", "IO17", "IO16", "IO4", "IO0", "IO2", "IO15", "IO8", "IO7", "IO6"];
const ESP_ALIAS = { GND_1: ["GND"], IO17: ["TX"], IO16: ["RX"], IO21: ["SDA"], IO22: ["SCL"] }, ESP_FLASH = { IO6: "CLK", IO7: "SD0", IO8: "SD1", IO9: "SD2", IO10: "SD3", IO11: "CMD" }, ESP_GPIO = { TXD0: 1, RXD0: 3 };
function esp32Classic(m) {
  const mk = (n, x, y) => {
    const at = { x: Math.round(x * 100) / 100, y, z: 0 }, o = { mm: at, pos: { x: Math.round(x * ESP_SCALE * 10) / 10, y: Math.round(y * ESP_SCALE * 10) / 10 }, face: "bottom" };
    if (n === "V33") return { name: n, kind: "power_in", label: { en: "3V3" }, min_mv: 3000, max_mv: 3600, typ_ma: 60, supply_group: "pwr", ...o };
    if (n === "V5") return { name: n, kind: "power_in", label: { en: "5V" }, min_mv: 4500, max_mv: 5500, typ_ma: 60, supply_group: "pwr", ...o };
    if (n.startsWith("GND")) return { name: n, kind: "ground", label: { en: "GND" }, ...(ESP_ALIAS[n] ? { aliases: ESP_ALIAS[n] } : {}), ...o };
    if (n === "EN") return { name: n, kind: "io", label: { en: "EN" }, abs_max_mv: 3600, ...o };
    if (ESP_FLASH[n]) return { name: n, kind: "nc", label: { en: ESP_FLASH[n] + " (flash)" }, ...o };
    const g = ESP_GPIO[n] ?? +n.slice(2);
    return { name: n, kind: [34, 35].includes(g) ? "analog" : "io", gpio: g, label: { en: ESP_GPIO[n] ? n : String(g) }, abs_max_mv: 3600, ...(ESP_ALIAS[n] ? { aliases: ESP_ALIAS[n] } : {}), ...o };
  };
  m.pins = [...ESP_J2.map((n, i) => mk(n, ESP_X0 + 2.54 * i, 26.67)), ...ESP_J3.map((n, i) => mk(n, ESP_X0 + 2.54 * i, 1.27))];
  m.groups = [{ pins: ["GND_1", "GND_2", "GND_3"] }];
  m.body = { w_mm: ESP_W, d_mm: ESP_D, h_mm: 13 };
  m.picture = { file: "picture.svg", width: Math.round(ESP_W * ESP_SCALE), height: Math.round(ESP_D * ESP_SCALE) };
  const k = ESP_SCALE, led = { x: 48, y: 14 }, count = { x: 24, y: 17 };
  m.visuals = m.visuals.map((v) => v.id === "led" ? { ...v, x: Math.round(led.x * k), y: Math.round(led.y * k) } : { ...v, x: Math.round(count.x * k), y: Math.round(count.y * k), w: 110, h: 20 });
  m.outputs = [...m.outputs.filter((o) => !["led", "tx", "rx", "crashed"].includes(o.name)), ...LIFE_OUT];
  const W = m.picture.width, H = m.picture.height, px = (v) => Math.round(v * k * 10) / 10;
  fs.writeFileSync(path.join(PARTS, m.id.replace("dotbench.", ""), "picture.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="6" fill="#1b3a57" stroke="#0e2336" stroke-width="3"/>
<rect x="${px(2)}" y="${px(6)}" width="${px(18)}" height="${px(15)}" rx="2" fill="#222" stroke="#666" stroke-width="2"/><text x="${px(11)}" y="${px(14.5)}" font-family="monospace" font-size="10" fill="#ddd" text-anchor="middle">ESP32</text>
<rect x="${px(ESP_W - 6)}" y="${px(10)}" width="${px(6)}" height="${px(8)}" fill="#c0c4c8" stroke="#555" stroke-width="2"/>
<circle cx="${px(led.x)}" cy="${px(led.y)}" r="${px(0.9)}" fill="#14281d" stroke="#3ddc84" stroke-width="2"/><text x="${px(led.x)}" y="${px(led.y + 3.4)}" font-family="monospace" font-size="8" fill="#9aa6b2" text-anchor="middle">LED 2</text>
${m.pins.filter((p) => p.kind !== "nc").map((p) => `<circle cx="${p.pos.x}" cy="${p.pos.y}" r="${px(0.5)}" fill="#c9a227" stroke="#7a6416" stroke-width="1.5"/>`).join("")}
</svg>
`);
}
const LIFE_OUT = [{ name: "led", type: "number", label: { en: "User LED (0 to 1)", "pt-BR": "LED do usuário (0 a 1)", es: "LED del usuario (0 a 1)" } }, { name: "tx", type: "number", label: { en: "Serial bytes sent", "pt-BR": "Bytes seriais enviados", es: "Bytes seriales enviados" } },
  { name: "rx", type: "number", label: { en: "Serial bytes received", "pt-BR": "Bytes seriais recebidos", es: "Bytes seriales recibidos" } }, { name: "crashed", type: "boolean", label: { en: "Stopped (crashed)", "pt-BR": "Parada (travou)", es: "Detenida (falló)" } }];

export function legacy() {
  const done = [];
  for (const [dir, s] of Object.entries(SPEC)) {
    const f = path.join(PARTS, dir, "manifest.json"); if (!fs.existsSync(f)) continue;
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    m.body = { w_mm: s.body[0], d_mm: s.body[1], h_mm: s.body[2] };
    if (dir.startsWith("esp32")) esp32Classic(m);
    else for (const p of m.pins) { const g = s.pins[p.name]; if (g) { p.mm = { x: g.x, y: g.y, z: g.z ?? 0 }; p.face = g.face; } }
    m.keywords = s.kw;
    if (!dir.startsWith("esp32")) picture(dir, s, m);
    if (dir.startsWith("esp32")) m.behaviour.core ??= "esp32";
    fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); done.push(dir);
  }
  return done;
}
