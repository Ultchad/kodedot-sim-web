// SPDX-License-Identifier: GPL-3.0-or-later
// The first built-in parts were written by hand (their manifest.json is the source). This adds what the page needs for a 3D model and for search
// without regenerating them: body size, terminal positions in millimetres (2.54 mm pitch where the real part has it), faces, and keywords in three languages.
// Idempotent: `node parts/gen/gen-parts.mjs` runs it. Convention: docs/STATUS-parts.md "Geometry".
import fs from "node:fs";
import path from "node:path";
import { PARTS } from "./lib.mjs";

const K = (en, pt, es) => ({ en, "pt-BR": pt, es });
const row = (names, x0, y, pitch, face = "bottom") => Object.fromEntries(names.map((n, i) => [n, { x: Math.round((x0 + pitch * i) * 100) / 100, y, face }]));
const SPEC = {
  led: { body: [5.8, 5.8, 9], pins: { A: { x: 1.63, y: 2.9, face: "bottom" }, K: { x: 4.17, y: 2.9, face: "bottom" } }, kw: K(["led", "light", "indicator", "diode"], ["led", "luz", "indicador", "diodo"], ["led", "luz", "indicador", "diodo"]) },
  buzzer: { body: [12, 12, 9.5], pins: { P: { x: 2.2, y: 6, face: "bottom" }, N: { x: 9.8, y: 6, face: "bottom" } }, kw: K(["buzzer", "beep", "sound", "piezo", "speaker"], ["buzzer", "campainha", "som", "piezo", "alto-falante"], ["zumbador", "buzzer", "sonido", "piezo", "altavoz"]) },
  "esp32-blink-echo": { body: [55, 28, 13], pins: row(["V33", "GND", "TX", "RX", "SDA", "SCL", "IO4", "IO5", "IO13", "IO14", "IO18", "IO19", "IO23", "IO25", "IO34", "IO35"], 5, 26.7, 2.54), kw: K(["esp32", "microcontroller", "board", "wifi", "uart", "3.3v"], ["esp32", "microcontrolador", "placa", "wifi", "uart", "3,3v"], ["esp32", "microcontrolador", "placa", "wifi", "uart", "3,3v"]) },
  hdc1080: { body: [20, 12, 3], pins: row(["VCC", "GND", "SDA", "SCL"], 5.08, 10.5, 2.54), kw: K(["hdc1080", "temperature", "humidity", "i2c", "sensor"], ["hdc1080", "temperatura", "umidade", "i2c", "sensor"], ["hdc1080", "temperatura", "humedad", "i2c", "sensor"]) },
  potentiometer: { body: [14.5, 11, 16], pins: row(["T", "W", "B"], 2.25, 10, 5), kw: K(["potentiometer", "knob", "analog", "resistor", "dial"], ["potenciômetro", "botão giratório", "analógico", "resistor"], ["potenciómetro", "perilla", "analógico", "resistencia"]) },
  "push-button": { body: [6, 6, 5], pins: { A: { x: 0.75, y: 3, face: "bottom" }, B: { x: 5.25, y: 3, face: "bottom" } }, kw: K(["button", "switch", "push", "input"], ["botão", "chave", "pressionar", "entrada"], ["botón", "pulsador", "interruptor", "entrada"]) },
  "rgb-led": { body: [8.6, 5.8, 9], pins: row(["R", "COM", "G", "B"], 0.5, 2.9, 2.54), kw: K(["rgb", "led", "color", "light"], ["rgb", "led", "cor", "luz"], ["rgb", "led", "color", "luz"]) },
  servo: { body: [22.5, 12.2, 22.7], pins: { GND: { x: 0, y: 3.66, face: "left" }, V5: { x: 0, y: 6.2, face: "left" }, SIG: { x: 0, y: 8.74, face: "left" } }, kw: K(["servo", "sg90", "motor", "angle", "pwm", "arduino servo"], ["servo", "sg90", "motor", "ângulo", "pwm"], ["servo", "sg90", "motor", "ángulo", "pwm"]) },
  "slide-switch": { body: [8.6, 3.6, 8.5], pins: row(["A", "COM", "B"], 1.35, 1.8, 2.5), kw: K(["switch", "slide", "toggle", "input"], ["chave", "deslizante", "interruptor", "entrada"], ["interruptor", "deslizante", "entrada"]) },
};
SPEC["esp32-button-led"] = { ...SPEC["esp32-blink-echo"] }; SPEC["esp32-i2c-slave"] = { ...SPEC["esp32-blink-echo"] };

export function legacy() {
  const done = [];
  for (const [dir, s] of Object.entries(SPEC)) {
    const f = path.join(PARTS, dir, "manifest.json"); if (!fs.existsSync(f)) continue;
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    m.body = { w_mm: s.body[0], d_mm: s.body[1], h_mm: s.body[2] };
    for (const p of m.pins) { const g = s.pins[p.name]; if (g) { p.mm = { x: g.x, y: g.y }; p.face = g.face; } }
    m.keywords = s.kw;
    if (dir.startsWith("esp32")) m.behaviour.core ??= "esp32";
    fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n"); done.push(dir);
  }
  return done;
}
