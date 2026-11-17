// SPDX-License-Identifier: GPL-3.0-or-later
// Passive and basic parts: resistor, capacitors, diode, LEDs, 9 V battery, bench supply, breadboards.
import { L, P, writePart, pinDots } from "./lib.mjs";

export function passive() {
  const out = [];
  // ---------------------------------------------------------------- resistor
  { const pins = [P("A", "io", 1.27, 1.6, { face: "bottom", abs_max_mv: 60000 }), P("B", "io", 11.43, 1.6, { face: "bottom", abs_max_mv: 60000 })];
    out.push(writePart({ id: "dotbench.resistor", dir: "resistor", w: 12.7, d: 3.2, h: 3.2, category: "passive", tags: ["resistor", "passive"],
      name: L("Resistor", "Resistor", "Resistencia"),
      desc: L("A resistor of any value between its two leads (0.1 ohm to 10 Mohm), 0.25 W. It loads the nets it joins, so a resistor between a GPIO and an LED really sets the LED current. Above 0.25 W the bench shows an overpower hazard (it does not burn).",
        "Um resistor de qualquer valor entre seus dois terminais (0,1 ohm a 10 Mohm), 0,25 W. Ele carrega as redes que liga: um resistor entre um GPIO e um LED define de verdade a corrente do LED. Acima de 0,25 W a bancada mostra um aviso de potência (ele não queima).",
        "Una resistencia de cualquier valor entre sus dos terminales (0,1 ohm a 10 Mohm), 0,25 W. Carga las redes que une: una resistencia entre un GPIO y un LED fija de verdad la corriente del LED. Por encima de 0,25 W el banco muestra un aviso de potencia (no se quema)."),
      keywords: { en: ["resistor", "resistance", "ohm", "pull-up", "pull-down", "current limit"], "pt-BR": ["resistor", "resistência", "ohm", "limitador de corrente", "pull-up"], es: ["resistencia", "resistor", "ohmio", "limitador de corriente", "pull-up"] },
      pins, fields: [{ name: "ohms", type: "number", label: L("Resistance", "Resistência", "Resistencia"), min: 0.1, max: 10000000, step: 1, unit: "Ω", default: 330, ui: "input" }],
      outputs: [{ name: "current_ma", type: "number", unit: "mA", label: L("Current", "Corrente", "Corriente") }, { name: "overpower", type: "boolean", label: L("Overpower (above 0.25 W)", "Excesso de potência (acima de 0,25 W)", "Exceso de potencia (por encima de 0,25 W)") }],
      visuals: [{ id: "value", effect: "text", x: 63, y: 20, color: "#1d2a38", source: { field: "ohms" } }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "resistor", a: "A", b: "B", ohms: { field: "ohms" }, rated_mw: 250, current_output: "current_ma", overpower_output: "overpower" }] },
      svg: ({ px }) => `<path d="M12.7 16 H114.3" stroke="#aeb7c2" stroke-width="3"/><rect x="26" y="4" width="75" height="24" rx="10" fill="#d9b779" stroke="#8a6d33" stroke-width="2"/><rect x="38" y="4" width="7" height="24" fill="#8a4b14"/><rect x="52" y="4" width="7" height="24" fill="#111"/><rect x="66" y="4" width="7" height="24" fill="#8a4b14"/><rect x="84" y="4" width="6" height="24" fill="#c9a227"/>${pinDots(pins, px, 3)}`,
      tests: { "resistor.test.json": { name: "a resistor between two driven pins", steps: [
        { comment: "nothing drives it: no current", expect_output: { name: "current_ma", value: 0 } },
        { set_pin: { pin: "A", level: 1 } }, { set_pin: { pin: "B", level: 0 } },
        { comment: "3.3 V across 118 + 330 + 118 ohm is about 5.8 mA", expect_output: { name: "current_ma", min: 5.5, max: 6.1 } },
        { set_field: { ohms: 1000 } }, { comment: "1k: about 2.4 mA", expect_output: { name: "current_ma", min: 2.2, max: 2.7 } },
        { set_field: { ohms: 100000 } }, { expect_pin: { pin: "B", level: 0 } },
        { set_pin: { pin: "B", level: null } }, { pullup: "B" }, { comment: "B has only the 45k pull-up of the header: no current to speak of", expect_output: { name: "current_ma", max: 0.02 } },
      ] } } })); }
  // ---------------------------------------------------------------- ceramic capacitor
  { const pins = [P("A", "io", 1.27, 1.5, { face: "bottom", abs_max_mv: 50000 }), P("B", "io", 6.35, 1.5, { face: "bottom", abs_max_mv: 50000 })];
    out.push(writePart({ id: "dotbench.capacitor-ceramic", dir: "capacitor-ceramic", w: 7.62, d: 3, h: 7, scale: 12, category: "passive", tags: ["capacitor", "ceramic", "passive"],
      name: L("Ceramic capacitor", "Capacitor cerâmico", "Condensador cerámico"),
      desc: L("A non-polarised ceramic capacitor, 1 pF to 100 uF, 50 V. The bench steps it in virtual time (backward Euler), so it charges and discharges through the resistance around it: an RC filter, a debounce, a smoothing cap. Ideal capacitor plus a small series resistance; no leakage, no inductance.",
        "Um capacitor cerâmico sem polaridade, de 1 pF a 100 uF, 50 V. A bancada o integra no tempo virtual (Euler implícito), então ele carrega e descarrega pela resistência ao redor: filtro RC, debounce, desacoplamento. Capacitor ideal com uma pequena resistência em série; sem fuga, sem indutância.",
        "Un condensador cerámico sin polaridad, de 1 pF a 100 uF, 50 V. El banco lo integra en tiempo virtual (Euler implícito), así que carga y descarga por la resistencia que lo rodea: filtro RC, antirrebote, desacoplo. Condensador ideal con una pequeña resistencia en serie; sin fuga, sin inductancia."),
      keywords: { en: ["capacitor", "ceramic", "filter", "decoupling", "rc", "farad"], "pt-BR": ["capacitor", "cerâmico", "filtro", "desacoplamento", "rc", "farad"], es: ["condensador", "capacitor", "cerámico", "filtro", "desacoplo", "rc", "faradio"] },
      pins, fields: [{ name: "uf", type: "number", label: L("Capacitance", "Capacitância", "Capacidad"), min: 0.000001, max: 100, step: 0.000001, unit: "µF", default: 0.1, ui: "input" }],
      outputs: [{ name: "volts_mv", type: "number", unit: "mV", label: L("Voltage A to B", "Tensão A para B", "Tensión A a B") }],
      visuals: [{ id: "value", effect: "text", x: 38, y: 24, color: "#1d2a38", source: { field: "uf" } }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "capacitor", a: "A", b: "B", farads: { field: "uf", scale: 1e-6 }, esr_ohms: 0.05, max_mv: 50000, voltage_output: "volts_mv" }] },
      svg: ({ px }) => `<path d="M12.7 25 V40 M63.5 25 V40" stroke="#aeb7c2" stroke-width="3"/><path d="M10 25 C10 4 66 4 66 25 Z" fill="#c8761a" stroke="#7a420c" stroke-width="2"/>${pinDots(pins, px, 3)}`,
      tests: { "capacitor.test.json": { name: "RC charge and discharge in virtual time", steps: [
        { set_field: { uf: 100 } }, { comment: "A high, B low: 3.3 V through 118 + 118 ohm into 100 uF, tau = 23.6 ms", set_pin: { pin: "A", level: 1 } }, { set_pin: { pin: "B", level: 0 } },
        { advance_ms: 5 }, { comment: "after 5 ms: 3.3 V * (1 - e^-0.21) = 0.63 V", expect_output: { name: "volts_mv", min: 450, max: 800 } },
        { advance_ms: 20 }, { comment: "about one tau: 2.1 V", expect_output: { name: "volts_mv", min: 1850, max: 2300 } },
        { advance_ms: 250 }, { comment: "ten taus: full", expect_output: { name: "volts_mv", min: 3200, max: 3300 } },
        { comment: "release A: the charge stays (no leak)", set_pin: { pin: "A", level: null } }, { advance_ms: 200 }, { expect_output: { name: "volts_mv", min: 3100 } },
        { set_pin: { pin: "A", level: 0 } }, { advance_ms: 250 }, { comment: "both ends low: discharged", expect_output: { name: "volts_mv", min: -50, max: 50 } },
      ] } } })); }
  // ---------------------------------------------------------------- electrolytic capacitor
  { const pins = [P("POS", "io", 2.0, 3.25, { face: "bottom", abs_max_mv: 60000, label: L("+") }), P("NEG", "io", 4.54, 3.25, { face: "bottom", abs_max_mv: 60000, label: L("-") })];
    out.push(writePart({ id: "dotbench.capacitor-electrolytic", dir: "capacitor-electrolytic", w: 6.5, d: 6.5, h: 11.4, category: "passive", tags: ["capacitor", "electrolytic", "polarised", "passive"],
      name: L("Electrolytic capacitor", "Capacitor eletrolítico", "Condensador electrolítico"),
      desc: L("A polarised electrolytic capacitor, 1 uF to 10000 uF, 25 V. Same virtual-time model as the ceramic one. Hazards like the real part: more than 1 V backwards for 40 ms and it bursts (open circuit, polarity hazard, until you replace it); over 25 V it fails too. The plus lead is the long one.",
        "Um capacitor eletrolítico polarizado, de 1 uF a 10000 uF, 25 V. Mesmo modelo no tempo virtual do cerâmico. Riscos como no real: mais de 1 V ao contrário por 40 ms e ele estoura (circuito aberto, aviso de polaridade, até você trocar a peça); acima de 25 V também falha. O terminal positivo é o mais longo.",
        "Un condensador electrolítico polarizado, de 1 uF a 10000 uF, 25 V. Mismo modelo en tiempo virtual que el cerámico. Riesgos como el real: más de 1 V al revés durante 40 ms y revienta (circuito abierto, aviso de polaridad, hasta cambiar la pieza); por encima de 25 V también falla. El terminal positivo es el largo."),
      keywords: { en: ["capacitor", "electrolytic", "polarized", "polarity", "smoothing", "farad"], "pt-BR": ["capacitor", "eletrolítico", "polarizado", "polaridade", "filtro", "farad"], es: ["condensador", "capacitor", "electrolítico", "polarizado", "polaridad", "faradio"] },
      pins, fields: [{ name: "uf", type: "number", label: L("Capacitance", "Capacitância", "Capacidad"), min: 1, max: 10000, step: 1, unit: "µF", default: 100, ui: "input" }],
      outputs: [{ name: "volts_mv", type: "number", unit: "mV", label: L("Voltage + to -", "Tensão + para -", "Tensión + a -") }, { name: "reversed", type: "boolean", label: L("Backwards", "Ao contrário", "Al revés") }, { name: "burst", type: "boolean", label: L("Burst", "Estourado", "Reventado") }],
      visuals: [{ id: "value", effect: "text", x: 33, y: 30, color: "#e8eef5", source: { field: "uf" } }, { id: "burst", effect: "opacity", x: 33, y: 33, r: 30, color: "#000000", source: { output: "burst" } }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "capacitor", a: "POS", b: "NEG", farads: { field: "uf", scale: 1e-6 }, esr_ohms: 0.3, polarity: { plus: "POS", reverse_mv: 1000 }, max_mv: 25000, voltage_output: "volts_mv", reversed_output: "reversed", failed_output: "burst" }] },
      svg: ({ px }) => `<circle cx="32.5" cy="32.5" r="30" fill="#1b3a6b" stroke="#0c1c36" stroke-width="2"/><path d="M46 12 A30 30 0 0 1 46 53 L56 49 A30 30 0 0 0 56 16 Z" fill="#c9d3df"/><text x="14" y="38" font-size="18" fill="#e8eef5" font-family="monospace">+</text><circle id="burst" cx="32.5" cy="32.5" r="30" fill="#000" opacity="0"/>${pinDots(pins, px, 3)}`,
      tests: { "capacitor.test.json": { name: "electrolytic: charges the right way, bursts backwards", steps: [
        { set_field: { uf: 100 } }, { set_pin: { pin: "POS", level: 1 } }, { set_pin: { pin: "NEG", level: 0 } }, { advance_ms: 300 },
        { comment: "plus high: charged, no hazard", expect_output: { name: "volts_mv", min: 3100 } }, { expect_output: { name: "burst", value: false } },
        { comment: "swap the polarity: discharge, then reverse", set_pin: { pin: "POS", level: 0 } }, { set_pin: { pin: "NEG", level: 1 } }, { advance_ms: 40 },
        { expect_output: { name: "reversed", value: true } }, { advance_ms: 120 },
        { comment: "backwards for more than 40 ms: bursts", expect_output: { name: "burst", value: true } },
      ] } } })); }
  // ---------------------------------------------------------------- diode
  { const pins = [P("A", "io", 1.27, 1.6, { face: "bottom", abs_max_mv: 60000 }), P("K", "io", 11.43, 1.6, { face: "bottom", abs_max_mv: 60000 })];
    out.push(writePart({ id: "dotbench.diode", dir: "diode", w: 12.7, d: 3.2, h: 3.2, category: "passive", tags: ["diode", "rectifier", "1n4007", "passive"],
      name: L("Diode (1N4007)", "Diodo (1N4007)", "Diodo (1N4007)"),
      desc: L("A silicon rectifier diode: conducts from anode (A) to cathode (K, the banded end) above 0.75 V and blocks the other way. Piecewise linear model (0.75 V knee, 0.3 ohm); rated 1 A, over it an overcurrent hazard. No reverse breakdown, no recovery time.",
        "Um diodo retificador de silício: conduz do anodo (A) ao catodo (K, a ponta com faixa) acima de 0,75 V e bloqueia no sentido contrário. Modelo linear por partes (joelho de 0,75 V, 0,3 ohm); 1 A nominal, acima disso aparece um aviso de sobrecorrente. Sem ruptura reversa, sem tempo de recuperação.",
        "Un diodo rectificador de silicio: conduce del ánodo (A) al cátodo (K, el extremo con banda) por encima de 0,75 V y bloquea al revés. Modelo lineal por tramos (rodilla de 0,75 V, 0,3 ohm); 1 A nominal, por encima aparece un aviso de sobrecorriente. Sin ruptura inversa, sin tiempo de recuperación."),
      keywords: { en: ["diode", "rectifier", "1n4007", "1n4148", "flyback", "protection"], "pt-BR": ["diodo", "retificador", "1n4007", "1n4148", "proteção", "flyback"], es: ["diodo", "rectificador", "1n4007", "1n4148", "protección", "flyback"] },
      pins, outputs: [{ name: "current_ma", type: "number", unit: "mA", label: L("Current", "Corrente", "Corriente") }, { name: "overcurrent", type: "boolean", label: L("Overcurrent", "Sobrecorrente", "Sobrecorriente") }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "diode", anode: "A", cathode: "K", vf_mv: 750, rs_ohms: 0.3, max_ma: 1000, burn_ms: 1000000, current_output: "current_ma", overcurrent_output: "overcurrent" }] },
      svg: ({ px }) => `<path d="M12.7 16 H114.3" stroke="#aeb7c2" stroke-width="3"/><rect x="26" y="4" width="75" height="24" rx="4" fill="#222" stroke="#000" stroke-width="2"/><rect x="86" y="4" width="9" height="24" fill="#d8dde3"/>${pinDots(pins, px, 3)}`,
      tests: { "diode.test.json": { name: "diode conducts forward only", steps: [
        { set_pin: { pin: "A", level: 1 } }, { set_pin: { pin: "K", level: 0 } }, { comment: "(3.3 - 0.75) V over 236 ohm: about 10.8 mA", expect_output: { name: "current_ma", min: 10, max: 11.6 } },
        { set_pin: { pin: "A", level: 0 } }, { set_pin: { pin: "K", level: 1 } }, { comment: "reversed: blocked", expect_output: { name: "current_ma", value: 0 } },
        { set_pin: { pin: "K", level: 0 } }, { expect_output: { name: "current_ma", value: 0 } },
      ] } } })); }
  // ---------------------------------------------------------------- LEDs
  const colours = [
    ["red", "#ff3b30", 1900, L("Red", "Vermelho", "Rojo"), ["red", "vermelho", "rojo"]],
    ["green", "#34c759", 2100, L("Green", "Verde", "Verde"), ["green", "verde", "verde"]],
    ["yellow", "#ffcc00", 2050, L("Yellow", "Amarelo", "Amarillo"), ["yellow", "amarelo", "amarillo"]],
    ["blue", "#2f7bff", 3000, L("Blue", "Azul", "Azul"), ["blue", "azul", "azul"]],
    ["white", "#f4f7ff", 3000, L("White", "Branco", "Blanco"), ["white", "branco", "blanco"]],
  ];
  for (const [c, hex, vf, nm, kw] of colours) {
    const pins = [P("A", "io", 1.62, 2.9, { face: "bottom", abs_max_mv: 60000, label: L("A") }), P("K", "io", 4.16, 2.9, { face: "bottom", abs_max_mv: 60000, label: L("K") })];
    out.push(writePart({ id: `dotbench.led-${c}`, dir: `led-${c}`, w: 5.8, d: 5.8, h: 8.6, scale: 20, category: "actuator", tags: ["led", c, "output"],
      name: L(`LED ${nm.en.toLowerCase()} 5 mm`, `LED ${nm["pt-BR"].toLowerCase()} 5 mm`, `LED ${nm.es.toLowerCase()} 5 mm`),
      desc: L(`A ${nm.en.toLowerCase()} 5 mm LED (forward voltage ${(vf / 1000).toFixed(2)} V) with no resistor inside: put one in series. It loads the net, glows by its current (10 mA is full brightness) and reports overcurrent: above 26 mA for 60 ms it burns out (open circuit and a "burnt" flag) until you replace it. The long lead is the anode (A).`,
        `Um LED ${nm["pt-BR"].toLowerCase()} de 5 mm (tensão direta ${(vf / 1000).toFixed(2)} V) sem resistor dentro: ligue um em série. Ele carrega a rede, brilha pela corrente (10 mA é brilho total) e avisa de sobrecorrente: acima de 26 mA por 60 ms ele queima (circuito aberto e a marca "queimado") até você trocar a peça. O terminal longo é o anodo (A).`,
        `Un LED ${nm.es.toLowerCase()} de 5 mm (tensión directa ${(vf / 1000).toFixed(2)} V) sin resistencia dentro: pon una en serie. Carga la red, brilla según su corriente (10 mA es brillo máximo) y avisa de sobrecorriente: por encima de 26 mA durante 60 ms se quema (circuito abierto y marca "quemado") hasta cambiar la pieza. El terminal largo es el ánodo (A).`),
      keywords: { en: ["led", "light", "lamp", kw[0], "diode"], "pt-BR": ["led", "luz", "lâmpada", kw[1], "diodo"], es: ["led", "luz", "lámpara", kw[2], "diodo"] },
      pins, outputs: [{ name: "brightness", type: "number", min: 0, max: 1, label: L("Brightness", "Brilho", "Brillo") }, { name: "current_ma", type: "number", unit: "mA", label: L("Current", "Corrente", "Corriente") },
        { name: "overcurrent", type: "boolean", label: L("Overcurrent", "Sobrecorrente", "Sobrecorriente") }, { name: "burnt", type: "boolean", label: L("Burnt out", "Queimado", "Quemado") }],
      visuals: [{ id: "glow", effect: "glow", x: 58, y: 40, r: 40, color: hex, source: { output: "brightness" } }, { id: "burnt", effect: "opacity", x: 58, y: 58, r: 56, color: "#000000", source: { output: "burnt" } }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "diode", anode: "A", cathode: "K", vf_mv: vf, rs_ohms: 10, max_ma: 25, burn_ms: 60, full_ma: 10, output: "brightness", current_output: "current_ma", overcurrent_output: "overcurrent", burnt_output: "burnt" }] },
      svg: ({ px }) => `<circle cx="58" cy="58" r="56" fill="${hex}" fill-opacity="0.35" stroke="${hex}" stroke-width="4"/><path d="M26 56 a32 32 0 0 1 64 0" fill="none" stroke="#fff" stroke-width="4" opacity="0.5"/><circle id="burnt" cx="58" cy="58" r="56" fill="#000" opacity="0"/>${pinDots(pins, px, 6)}`,
      tests: { "led.test.json": { name: `${c} LED current, brightness and burning`, steps: [
        { comment: "dark with nothing wired", expect_output: { name: "brightness", value: 0 } },
        { set_pin: { pin: "A", level: 1 } }, { set_pin: { pin: "K", level: 0 } },
        ...(vf < 3200 ? [{ comment: "3.3 V across 236 ohm and the LED knee leaves a few mA", expect_output: { name: "current_ma", min: 1, max: 12 } }, { expect_output: { name: "overcurrent", value: false } }]
          : [{ comment: "a blue/white LED needs about 3 V: 3.3 V barely lights it", expect_output: { name: "current_ma", min: 0.5, max: 2 } }]),
        { set_pin: { pin: "A", level: 0 } }, { set_pin: { pin: "K", level: 1 } }, { comment: "reversed: dark", expect_output: { name: "brightness", value: 0 } },
      ] } } }));
  }
  // ---------------------------------------------------------------- 9 V battery
  { const pins = [P("POS", "io", 7, 8.75, { face: "top", abs_max_mv: 60000, label: L("+") }), P("NEG", "io", 19.7, 8.75, { face: "top", abs_max_mv: 60000, label: L("-") })];
    out.push(writePart({ id: "dotbench.battery-9v", dir: "battery-9v", w: 26.5, d: 17.5, h: 48.5, category: "power", tags: ["battery", "9v", "power", "source"],
      name: L("9 V battery", "Bateria de 9 V", "Batería de 9 V"),
      desc: L("A 9 V (PP3) battery: a floating voltage source, the voltage is a field, 2 ohm internal resistance. Its minus pin is the 0 V of any circuit it makes on its own. Above 500 mA the bench shows an overload hazard; a wire from plus to minus is a short. The charge does not run down.",
        "Uma bateria de 9 V (PP3): uma fonte de tensão flutuante, a tensão é um campo, resistência interna de 2 ohm. O pino negativo é o 0 V de qualquer circuito que ela forme sozinha. Acima de 500 mA a bancada mostra aviso de sobrecarga; um fio do positivo ao negativo é um curto. A carga não acaba.",
        "Una batería de 9 V (PP3): una fuente de tensión flotante, la tensión es un campo, resistencia interna de 2 ohm. Su pin negativo es el 0 V de cualquier circuito que forme por sí sola. Por encima de 500 mA el banco muestra aviso de sobrecarga; un cable del positivo al negativo es un cortocircuito. La carga no se agota."),
      keywords: { en: ["battery", "9v", "pp3", "power", "supply", "cell"], "pt-BR": ["bateria", "pilha", "9v", "fonte", "alimentação"], es: ["batería", "pila", "9v", "fuente", "alimentación"] },
      pins, fields: [{ name: "volts", type: "number", label: L("Voltage", "Tensão", "Tensión"), min: 0, max: 12, step: 0.1, unit: "V", default: 9, ui: "input" }],
      outputs: [{ name: "current_ma", type: "number", unit: "mA", label: L("Current", "Corrente", "Corriente") }, { name: "overload", type: "boolean", label: L("Overload (above 500 mA or shorted)", "Sobrecarga (acima de 500 mA ou em curto)", "Sobrecarga (por encima de 500 mA o en corto)") }],
      visuals: [{ id: "value", effect: "text", x: 132, y: 88, color: "#1d2a38", source: { field: "volts" } }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "cell", pos: "POS", neg: "NEG", mv: { field: "volts", scale: 1000 }, ohms: 2, max_ma: 500, current_output: "current_ma", overload_output: "overload" }] },
      svg: () => `<rect x="4" y="4" width="257" height="167" rx="12" fill="#1d1d1f" stroke="#000" stroke-width="2"/><rect x="4" y="60" width="257" height="80" fill="#2e7d32"/><text x="132" y="112" text-anchor="middle" font-family="monospace" font-size="34" fill="#fff">9V</text><circle cx="70" cy="87.5" r="18" fill="#c9a227" stroke="#7a6416" stroke-width="3"/><circle cx="197" cy="87.5" r="22" fill="#c9a227" stroke="#7a6416" stroke-width="3"/><text x="70" y="94" text-anchor="middle" font-size="22" fill="#000">+</text><text x="197" y="94" text-anchor="middle" font-size="26" fill="#000">-</text>`,
      tests: { "battery.test.json": { name: "9 V between plus and minus", steps: [
        { set_pin: { pin: "NEG", level: 0 } }, { comment: "plus floats at 9 V above minus (the Dot drives minus to 0 V)", expect_pin: { pin: "POS", mv_min: 8900, mv_max: 9100 } },
        { set_field: { volts: 6 } }, { expect_pin: { pin: "POS", mv_min: 5900, mv_max: 6100 } },
        { set_pin: { pin: "NEG", level: null } }, { comment: "alone, minus is the reference: 0 V and plus 6 V", expect_pin: { pin: "POS", mv_min: 5900, mv_max: 6100 } },
      ] } } })); }
  // ---------------------------------------------------------------- bench supply
  { const pins = [P("POS", "io", 10.16, 7.62, { face: "top", abs_max_mv: 60000, label: L("+") }), P("NEG", "io", 12.7, 7.62, { face: "top", abs_max_mv: 60000, label: L("-") })];
    out.push(writePart({ id: "dotbench.supply", dir: "supply", w: 22.86, d: 15.24, h: 12, category: "power", tags: ["supply", "power", "5v", "3v3", "regulator"],
      name: L("Supply 3.3 V / 5 V", "Fonte 3,3 V / 5 V", "Fuente 3,3 V / 5 V"),
      desc: L("A small regulated supply module: choose off, 3.3 V or 5 V. A floating source with 0.2 ohm output resistance; the minus pin is the 0 V of the circuit it feeds. Above 1 A the bench shows an overload hazard. Use it to power a board, a servo or a motor driver without the Kode Dot.",
        "Um módulo de fonte regulada pequeno: escolha desligada, 3,3 V ou 5 V. Fonte flutuante com 0,2 ohm de resistência de saída; o pino negativo é o 0 V do circuito que ela alimenta. Acima de 1 A a bancada mostra aviso de sobrecarga. Use para alimentar uma placa, um servo ou um driver de motor sem o Kode Dot.",
        "Un pequeño módulo de fuente regulada: elige apagada, 3,3 V o 5 V. Fuente flotante con 0,2 ohm de resistencia de salida; el pin negativo es el 0 V del circuito que alimenta. Por encima de 1 A el banco muestra aviso de sobrecarga. Úsala para alimentar una placa, un servo o un driver de motor sin el Kode Dot."),
      keywords: { en: ["supply", "power", "regulator", "5v", "3.3v", "psu"], "pt-BR": ["fonte", "alimentação", "regulador", "5v", "3,3v"], es: ["fuente", "alimentación", "regulador", "5v", "3,3v"] },
      pins, fields: [{ name: "mv", type: "enum", label: L("Output", "Saída", "Salida"), default: 5000, values: [{ value: 0, label: L("Off", "Desligada", "Apagada") }, { value: 3300, label: L("3.3 V") }, { value: 5000, label: L("5 V") }] }],
      outputs: [{ name: "current_ma", type: "number", unit: "mA", label: L("Current", "Corrente", "Corriente") }, { name: "overload", type: "boolean", label: L("Overload (above 1 A or shorted)", "Sobrecarga (acima de 1 A ou em curto)", "Sobrecarga (por encima de 1 A o en corto)") }],
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "cell", pos: "POS", neg: "NEG", mv: { field: "mv" }, ohms: 0.2, max_ma: 1000, current_output: "current_ma", overload_output: "overload" }] },
      svg: ({ px }) => `<rect x="4" y="4" width="221" height="144" rx="8" fill="#1c5d99" stroke="#0b2c4d" stroke-width="2"/><text x="40" y="60" font-family="monospace" font-size="26" fill="#fff">PSU</text><text x="102" y="48" font-size="22" fill="#ffd60a">+</text><text x="127" y="48" font-size="22" fill="#e8eef5">-</text>${pinDots(pins, px, 6)}`,
      tests: { "supply.test.json": { name: "supply voltages", steps: [
        { set_pin: { pin: "NEG", level: 0 } }, { expect_pin: { pin: "POS", mv_min: 4900, mv_max: 5100 } },
        { set_field: { mv: 3300 } }, { expect_pin: { pin: "POS", mv_min: 3200, mv_max: 3400 } },
        { set_field: { mv: 0 } }, { expect_pin: { pin: "POS", mv_max: 100 } },
      ] } } })); }
  // ---------------------------------------------------------------- breadboards
  for (const [kind, cols, nm, w, tie] of [["half", 30, L("Breadboard, half size", "Protoboard meia", "Protoboard media"), 82.5, 400], ["full", 63, L("Breadboard, full size", "Protoboard completa", "Protoboard completa"), 165, 830]]) {
    const pitch = 2.54, d = 55, h = 8.5, x0 = (w - (cols - 1) * pitch) / 2, railN = kind === "half" ? 25 : 50;
    const railLen = (railN - 1) * pitch + (Math.ceil(railN / 5) - 1) * pitch, xr = (w - railLen) / 2, rails = { T1: 3.8, T2: 6.34, B1: d - 6.34, B2: d - 3.8 };
    const rowY = { a: 27.5 - 3.81 - 4 * pitch, b: 27.5 - 3.81 - 3 * pitch, c: 27.5 - 3.81 - 2 * pitch, d: 27.5 - 3.81 - pitch, e: 27.5 - 3.81, f: 27.5 + 3.81, g: 27.5 + 3.81 + pitch, h: 27.5 + 3.81 + 2 * pitch, i: 27.5 + 3.81 + 3 * pitch, j: 27.5 + 3.81 + 4 * pitch };
    const pins = [], groups = [];
    for (let c = 1; c <= cols; c++) {
      for (const r of "abcdefghij") pins.push(P(r + c, "io", x0 + (c - 1) * pitch, rowY[r], { face: "top", abs_max_mv: 60000, label: null }));
      groups.push({ pins: ["a", "b", "c", "d", "e"].map((r) => r + c) }, { pins: ["f", "g", "h", "i", "j"].map((r) => r + c) });
    }
    for (const [rail, y] of Object.entries(rails)) {
      const names = [];
      for (let k = 0; k < railN; k++) { const nmk = `${rail}_${k + 1}`; names.push(nmk); pins.push(P(nmk, "io", xr + k * pitch + Math.floor(k / 5) * pitch, y, { face: "top", abs_max_mv: 60000, label: null })); }
      groups.push({ pins: names });
    }
    out.push(writePart({ id: `dotbench.breadboard-${kind}`, dir: `breadboard-${kind}`, w, d, h, zFace: { top: 8.5 }, overhang: { left: 1.2, right: 1.2, back: 1.2, front: 1.2 }, category: "prototyping", tags: ["breadboard", "protoboard", kind],
      name: nm,
      desc: L(`A solderless ${kind}-size breadboard with its real connections: ${cols} columns of two strips of five holes (a to e, f to j; the centre channel splits them) and four continuous power rails of ${railN} holes (${tie} tie points). Plug parts into it and add wires; every hole of a strip is one net. Terminals: a1..j${cols}, rails T1_n and T2_n (top), B1_n and B2_n (bottom). The body is the moulding without its dovetail tabs (about 1.2 mm each side, not modelled); the rails are coloured red then blue from the top on both pairs.`,
        `Uma protoboard ${kind === "half" ? "meia" : "completa"} sem solda com as ligações reais: ${cols} colunas de duas tiras de cinco furos (a a e, f a j; o canal central as separa) e quatro trilhos de alimentação contínuos de ${railN} furos (${tie} pontos). Encaixe as peças e ligue fios; todos os furos de uma tira formam uma rede. Terminais: a1..j${cols}, trilhos T1_n e T2_n (em cima), B1_n e B2_n (embaixo). O corpo é o molde sem as abas de encaixe (cerca de 1,2 mm de cada lado, não modeladas); os trilhos são vermelho e depois azul, de cima para baixo, nos dois pares.`,
        `Una protoboard ${kind === "half" ? "media" : "completa"} sin soldadura con las conexiones reales: ${cols} columnas de dos tiras de cinco agujeros (a a e, f a j; el canal central las separa) y cuatro rieles de alimentación continuos de ${railN} agujeros (${tie} puntos). Encaja las piezas y conecta cables; todos los agujeros de una tira forman una red. Terminales: a1..j${cols}, rieles T1_n y T2_n (arriba), B1_n y B2_n (abajo). El cuerpo es el moldeado sin las pestañas de encaje (unos 1,2 mm por lado, no modeladas); los rieles son rojo y luego azul, de arriba abajo, en los dos pares.`),
      keywords: { en: ["breadboard", "protoboard", "prototype", "rail", "strip", "solderless"], "pt-BR": ["protoboard", "placa de ensaio", "prototipagem", "trilho", "sem solda"], es: ["protoboard", "placa de pruebas", "prototipo", "riel", "sin soldadura"] },
      pins, groups, behaviour: { type: "declarative", engine: 1, elements: [{ type: "bridge", a: "a1", b: "e1" }] },
      svg: ({ px, W, H }) => {
        let holes = ""; for (const p of pins) holes += `M${px(p.mm.x) - 4} ${px(p.mm.y) - 4}h8v8h-8z`;
        return `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="10" fill="#e9e6df" stroke="#a9a496" stroke-width="3"/><rect x="12" y="${px(27.5) - 8}" width="${W - 24}" height="16" fill="#d3cfc4"/><path d="M${px(1)} ${px(rails.T1 - 2.2)}H${W - px(1)}M${px(1)} ${px(rails.B1 - 2.2)}H${W - px(1)}" stroke="#d33" stroke-width="3"/><path d="M${px(1)} ${px(rails.T2 + 2.2)}H${W - px(1)}M${px(1)} ${px(rails.B2 + 2.2)}H${W - px(1)}" stroke="#36c" stroke-width="3"/><path d="${holes}" fill="#2b2b2b"/>`;
      },
      tests: { "breadboard.test.json": { name: "terminal strips are one net, the channel splits them", steps: [
        { set_pin: { pin: "a1", level: 1 } }, { comment: "same strip: a1 and e1 are joined", expect_pin: { pin: "e1", level: 1 } },
        { comment: "the other half of column 1 is a different net", expect_pin: { pin: "f1", level: 0 } },
        { set_pin: { pin: "a1", level: null } }, { set_pin: { pin: "j1", level: 1 } }, { expect_pin: { pin: "f1", level: 1 } }, { expect_pin: { pin: "e1", level: 0 } },
      ] } } }));
  }
  return out;
}
