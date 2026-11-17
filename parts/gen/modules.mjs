// SPDX-License-Identifier: GPL-3.0-or-later
// Official Kode modules that plug onto the Dot's J3 header: Maker (breadboard carrier), Robotics (AT8833CQ dual H-bridge, servo, I2C, sensor header)
// and, as SHAPE ONLY entries, Camera, Mesh and the hacking module. Pin tables are data: parts/gen/data/modules.json (source: research/06-official-modules-spec.md).
// Sizes and terminal positions are ESTIMATES from pictures unless the doc gives them (body.estimate = true); only the 2.54 mm pitch is exact.
import fs from "node:fs";
import path from "node:path";
import { PARTS, writePart, L, P, pinDots } from "./lib.mjs";

const T = JSON.parse(fs.readFileSync(path.join(PARTS, "gen/data/modules.json"), "utf8"));
const HI = 3600, ODD = 2.54;
const KW = (en, pt, es) => ({ en, "pt-BR": pt, es });
const rails3 = (x, y) => [P("V5", "io", x, y, { face: "bottom", abs_max_mv: 60000, label: { en: "5V" } }), P("V33", "io", x + ODD, y, { face: "bottom", abs_max_mv: 60000, label: { en: "3V3" } }), P("GND", "io", x + 2 * ODD, y, { face: "bottom", abs_max_mv: 60000, label: { en: "GND" } })];
const railMap = [{ pin: "V5", rail: "V5" }, { pin: "V33", rail: "V33" }, { pin: "GND", rail: "GND" }];
const NOTE_EST = L("Size and terminal positions are estimates from pictures (header pitch 2.54 mm is exact).", "Tamanho e posições dos terminais são estimativas a partir de fotos (o passo de 2,54 mm do cabeçalho é exato).", "El tamaño y las posiciones de los terminales son estimaciones a partir de fotos (el paso de 2,54 mm del cabezal es exacto).");
// ---- the physical 2x10 connector. Header pin m of the Dot (1,20 = 5 V; 2,19 = 3.3 V; 10,11 = GND; 3..9 and 12..18 = positions 1..14) meets, on a right-angle J401
// module, the module pin 20 - m (m odd) or 22 - m (m even) [mirrored, derived from the published tables]; through the interposer pin n = header pin n.
// Module pin j sits in column ceil(j/2) (1 at the left, seen from the component side with the connector at the bottom edge); odd pins in one row, even in the other.
const J3 = [8, 9, 10, 11, 12, 13, 14, 21, 19, 20, 17, 18, 15, 16];
const hdr = (m) => (m === 1 || m === 20 ? { rail: "V5" } : m === 2 || m === 19 ? { rail: "V33" } : m === 10 || m === 11 ? { rail: "GND" } : { gpio: J3[m < 10 ? m - 3 : m - 5] });
const PIN_LEN = 8, ROW_Z = [2.87, 5.41]; // flat modules: pin protrusion past the board edge; the two rows of a right-angle header above the 1.6 mm board (estimates)
const TONGUE = 14, PIN_Y = 24.5, BLOCK_BOTTOM = 26, PIN_SHOW = 7; // standing modules (Mesh, hacking; measured from the owner's photos): tongue thickness, pin rows' middle, block underside height, pin length showing below it
/** all 20 pins of the connector. place(col, row) -> {x, y, z}; mk.gpio(gpio, j), mk.rail(rail, nth, j) -> name; mk.pin(name, sig, j, at, ref) -> pin. Returns {pins, mountPins, rails}. */
function conn20(kind, des, place, mk) {
  const seen = {}, pins = [], mountPins = [], rails = [];
  for (let m = 1; m <= 20; m++) {
    const sig = hdr(m), j = kind === "straight" ? m : (m % 2 ? 20 - m : 22 - m), at = place(Math.ceil(j / 2), j % 2 ? 0 : 1), ref = `${des}.${j}`;
    const name = sig.rail ? mk.rail(sig.rail, (seen[sig.rail] = (seen[sig.rail] ?? 0) + 1), j) : mk.gpio(sig.gpio, j);
    const pin = mk.pin(name, sig, j, at, ref); pin.mm.z = at.z; pin.ref = ref; pins.push(pin);
    if (sig.rail) rails.push({ pin: name, rail: sig.rail }); else mountPins.push({ pin: name, gpio: sig.gpio, ...(mk.source?.(sig.gpio) ? { source: mk.source(sig.gpio) } : {}) });
  }
  return { pins, mountPins, rails };
}
const flatPlace = (W, Dbd) => { const x0 = (W - 9 * ODD) / 2; return (c, r) => ({ x: x0 + ODD * (c - 1), y: Dbd + PIN_LEN / 2, z: ROW_Z[r] }); };
const flatMount = (W, Dbd, pins, rails) => ({ via: "direct", orientations: ["upright", "turned"], pins, rails,
  connector: { seat_mm: { x: W / 2, y: Dbd, z: 4.14 }, pin_dir: "+y", pin_length_mm: PIN_LEN, odd_row: "low_z", source: "assumed" },
  placement: { anchor_dot_mm: { x: 0, y: 38.5, z: 0 }, upright: { x: "-X", y: "-Y", z: "-Z" }, turned: { x: "+X", y: "-Y", z: "+Z" }, source: "assumed" } });
const holes = (W, D, hw, hd) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => ({ name: "hole" + (i + 1), kind: "hole", diameter_mm: 3.2, mm: { x: Math.round((W / 2 + a * hw / 2) * 100) / 100, y: Math.round((D / 2 + b * hd / 2) * 100) / 100, z: 0 } }));
const cat = (...xs) => ({ en: xs.map((x) => x.en).join(" "), "pt-BR": xs.map((x) => x["pt-BR"]).join(" "), es: xs.map((x) => x.es).join(" ") });

export function modules() {
  const out = [];
  // ---------------------------------------------------------------- Maker
  { const W = 58, D = 54, sock = T.maker.sockets, pins = [];   // board 58 x 54 mm, holes on 48.8 x 44.9 mm (measured from the store photo against the header, +-1.5 mm)
    sock.forEach((g, k) => pins.push(P("S" + (k + 1), "io", 11 + ODD * k, 4, { face: "top", abs_max_mv: HI, label: { en: `${k + 1}` } })));
    const groups = [], strips = [["V5_", "V5", 1.8, 17], ["GL_", "GND", 1.8, 31], ["GR_", "GND", 56.2, 17], ["V33_", "V33", 56.2, 31]];   // four 1x4 strips in single file, two per side
    for (const [pre, , x, y] of strips) { const names = []; for (let i = 1; i <= 4; i++) { const n = pre + i; names.push(n); pins.push(P(n, "io", x, y + ODD * (i - 1), { face: "top", abs_max_mv: 60000, label: { en: pre === "V5_" ? "5V" : pre === "V33_" ? "3V3" : "GND" } })); } groups.push({ pins: names }); }
    const bx = (W - 16 * ODD) / 2, rowY = [14, 16.54, 19.08, 21.62, 24.16, 29.24, 31.78, 34.32, 36.86, 39.4], rowN = "abcdefghij";
    for (let c = 1; c <= 17; c++) { const top = [], bot = []; for (let r = 0; r < 10; r++) { const n = rowN[r] + c; pins.push(P(n, "io", bx + ODD * (c - 1), rowY[r], { face: "top", abs_max_mv: 60000, label: null })); (r < 5 ? top : bot).push(n); } groups.push({ pins: top }, { pins: bot }); }
    // the physical J401 (2x10 right-angle at the bottom edge): every position is a terminal, wired on the board to its socket or strip
    const C = conn20("mirror", "J401", flatPlace(W, D), { gpio: (g, j) => "J401_" + j, rail: (r, k, j) => "J401_" + j, source: () => undefined,
      pin: (name, sig, j, at) => P(name, "io", at.x, at.y, { face: "bottom", abs_max_mv: sig.rail ? 60000 : HI, label: { en: `J401-${j}` } }) });
    pins.push(...C.pins);
    const stripOf = { V5: "V5_", V33: "V33_", GND: "GL_" };
    for (const e of C.rails) groups.find((g) => g.pins[0].startsWith(stripOf[e.rail])).pins.push(e.pin);
    { const gl = groups.find((g) => g.pins[0] === "GL_1"), gr = groups.findIndex((g) => g.pins[0] === "GR_1"); gl.pins.push(...groups[gr].pins); groups.splice(gr, 1); } // both GND strips are one net on the board
    sock.forEach((g, k) => groups.push({ pins: ["S" + (k + 1), C.mountPins.find((e) => e.gpio === g).pin] }));
    const mapPins = C.mountPins, railsAll = C.rails;
    out.push(writePart({ id: "dotbench.kode-maker", dir: "kode-maker", w: W, d: D + PIN_LEN, h: 14, zFace: { top: 10.1 }, scale: 8, estimate: true, category: "kode-module", tags: ["kode", "module", "maker", "breadboard", "prototype"],
      name: L("Kode Maker module", "Módulo Kode Maker", "Módulo Kode Maker"),
      desc: cat(L("The official Maker module (KDMKR001): a passive breadboard carrier that plugs onto the Dot's J3 (bench.mountPart, upright or turned). Fourteen sockets S1..S14 carry the 14 header GPIOs (sockets 9 to 14 are GPIO20, 19, 18, 17, 16, 15), four 5 V sockets, four 3.3 V sockets, two groups of four GND sockets and a 170 point mini breadboard (a1..j17, strips of five). Nothing is active: no regulator, no pull-ups (I2C needs 4.7 kohm outside), a 3.3 V protection diode per GPIO (a 5 V strip wired to a socket raises an overvoltage hazard). Turned, socket n meets the Dot's position 15 - n and no longer the same GPIO.",
        "O módulo Maker oficial (KDMKR001): uma base passiva de protoboard que encaixa no J3 do Dot (bench.mountPart, normal ou virado). Quatorze soquetes S1..S14 levam os 14 GPIOs do cabeçalho (os soquetes 9 a 14 são GPIO20, 19, 18, 17, 16, 15), quatro soquetes de 5 V, quatro de 3,3 V, dois grupos de quatro GND e uma mini protoboard de 170 pontos (a1..j17, trilhas de cinco). Nada é ativo: sem regulador, sem pull-ups (I2C precisa de 4,7 kohm por fora), um diodo de proteção de 3,3 V por GPIO (uma trilha de 5 V ligada a um soquete gera perigo de sobretensão). Virado, o soquete n encontra a posição 15 - n do Dot e não mais o mesmo GPIO.",
        "El módulo Maker oficial (KDMKR001): una base pasiva de protoboard que encaja en el J3 del Dot (bench.mountPart, normal o girado). Catorce zócalos S1..S14 llevan los 14 GPIO del cabezal (los zócalos 9 a 14 son GPIO20, 19, 18, 17, 16, 15), cuatro zócalos de 5 V, cuatro de 3,3 V, dos grupos de cuatro GND y una mini protoboard de 170 puntos (a1..j17, tiras de cinco). Nada es activo: sin regulador, sin pull-ups (I2C necesita 4,7 kohm por fuera), un diodo de protección de 3,3 V por GPIO (una tira de 5 V conectada a un zócalo genera peligro de sobretensión). Girado, el zócalo n encuentra la posición 15 - n del Dot y ya no el mismo GPIO."), NOTE_EST),
      keywords: KW(["maker", "kode", "module", "breadboard", "prototype", "sockets", "jumper"], ["maker", "kode", "módulo", "protoboard", "prototipagem", "soquetes", "jumper"], ["maker", "kode", "módulo", "protoboard", "prototipado", "zócalos", "puente"]),
      extra: { mount: flatMount(W, D, mapPins, railsAll), refs: holes(W, D, 48.8, 44.9) }, pins, groups,
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "bridge", a: "a1", b: "e1" }] },
      svg: ({ px, W: PW }) => `<rect x="2" y="2" width="${PW - 4}" height="${px(D) - 4}" rx="6" fill="#2f6b3a" stroke="#14301a" stroke-width="3"/><rect x="${px(bx - 2)}" y="${px(12)}" width="${px(16 * ODD + 4)}" height="${px(30)}" fill="#f2f2ee" stroke="#999" stroke-width="2"/><text x="${px(W / 2)}" y="${px(50)}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#fff">MAKER</text>${pinDots(pins.filter((p) => !/^[a-j]\d/.test(p.name) || true), px, 2.4)}`,
      tests: { "maker.test.json": { name: "sockets are plain terminals (the mount itself is tested on the bench)", steps: [{ set_pin: { pin: "S5", level: 1 } }, { expect_pin: { pin: "S5", level: 1 } }] } } })); }
  // ---------------------------------------------------------------- Robotics
  { const R = T.robotics, W = 45, D = 40.5,   // board 45 x 40.5 mm, holes on 35 x 31 mm, screw pitch 3.81 mm (measured from the store photo, +-1.5 mm)
     pins = [], groups = [], byGpio = Object.fromEntries(R.pins.map((e) => [e.gpio, e]));
    // J401 at the bottom edge: the 14 signals and the 6 rail pins at their real positions; the sensor, servo and I2C pins have female headers on the left and right edges
    const C = conn20("mirror", "J401", flatPlace(W, D), { gpio: (g) => byGpio[g].pin, rail: (r, k) => (k === 1 ? r : `${r}_2`), source: (g) => byGpio[g].source,
      pin: (name, sig, j, at, ref) => { const e = sig.gpio ? byGpio[sig.gpio] : null, o = { face: "bottom", label: { en: e ? e.pin : name } };
        if (e) return P(name, "io", at.x, at.y, { ...o, abs_max_mv: HI, ...(name === "SCL" || name === "SDA" ? { pullup_ohms: R.i2c_pullup_ohms, pull_rail: "V33" } : {}), ...(name === "NFAULT" ? { pullup_ohms: R.nfault_pullup.ohms, pull_rail: R.nfault_pullup.rail } : {}), ...(/^(AIN|BIN)/.test(name) ? { pulldown_ohms: 100000 } : {}) });
        if (name === "V5") return P(name, "power_in", at.x, at.y, { ...o, min_mv: 4500, max_mv: 5500, typ_ma: 100 });
        if (name.startsWith("GND")) return P(name, "ground", at.x, at.y, o);
        return P(name, "io", at.x, at.y, { ...o, abs_max_mv: name.startsWith("V5") ? 60000 : HI }); } });
    pins.push(...C.pins);
    // screw terminals and the stepper header along the top edge, left to right as on the board: motor B, stepper, motor A (the photo; the order of the pins inside each is assumed)
    const mo = { MOTB_1: 7.5, MOTB_2: 11.31, MOTA_1: 33.4, MOTA_2: 37.21 }; for (const [n, x] of Object.entries(mo)) pins.push(P(n, "io", x, 2, { face: "top", abs_max_mv: 7000, label: { en: n.replace("_", "") } }));
    Object.keys(R.stepper_header.map).forEach((n, k) => pins.push(P(n, "io", 18.69 + ODD * k, 2.5, { face: "top", abs_max_mv: 7000, label: { en: n } })));
    const j = (n, x, y, o = {}) => pins.push(P(n, "io", x, y, { face: "top", abs_max_mv: HI, ...o }));
    // female header strips: left edge, top to bottom as silkscreened GND 5V GPIO11 | GND GPIO10 SDA SCL 3V3; right edge GND GPIO18 GPIO17 GPIO16 GPIO15 3V3 (the photo)
    pins.push(P("J402_GND", "io", 3.5, 11.5, { face: "top", abs_max_mv: 60000 }), P("J402_V5", "io", 3.5, 14.04, { face: "top", abs_max_mv: 7000 }), P("J402_SIG", "io", 3.5, 16.58, { face: "top", abs_max_mv: HI }));
    pins.push(P("J403_GND", "io", 3.5, 19.12, { face: "top", abs_max_mv: 60000 })); j("J403_GPIO10", 3.5, 21.66); j("J403_SDA", 3.5, 24.2); j("J403_SCL", 3.5, 26.74); j("J403_V33", 3.5, 29.28);
    pins.push(P("J404_GND", "io", 41.5, 12, { face: "top", abs_max_mv: 60000 })); j("J404_18", 41.5, 14.54); j("J404_17", 41.5, 17.08); j("J404_16", 41.5, 19.62); j("J404_15", 41.5, 22.16); j("J404_V33", 41.5, 24.7);
    groups.push({ pins: ["GND", "GND_2", "J402_GND", "J403_GND", "J404_GND"] }, { pins: ["V5", "V5_2", "J402_V5"] }, { pins: ["V33", "V33_2", "J403_V33", "J404_V33"] }, { pins: ["SERVO", "J402_SIG"] }, { pins: ["SDA", "J403_SDA"] }, { pins: ["SCL", "J403_SCL"] }, { pins: ["GPIO10", "J403_GPIO10"] },
      { pins: ["S15", "J404_15"] }, { pins: ["S16", "J404_16"] }, { pins: ["S17", "J404_17"] }, { pins: ["S18", "J404_18"] });
    for (const [stp, m] of Object.entries(R.stepper_header.map)) groups.push({ pins: [stp, m] });
    // the part tester wires the first 14 io pins to the Dot: put the driver's inputs and outputs first so a scenario can drive and read them
    { const first = ["AIN1", "AIN2", "NSLEEP", "MOTA_1", "MOTA_2", "STP_2"]; pins.sort((a, b) => { const ia = first.indexOf(a.name), ib = first.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }); }
    const outName = (i) => ({ AIN1: "aout1", AIN2: "aout2", BIN1: "bout1", BIN2: "bout2" })[i];
    const elements = ["AIN1", "AIN2", "BIN1", "BIN2"].map((i) => ({ type: "half_bridge", in: i, out: R.driver.outputs[i], vs: "V5", en: "NSLEEP", drop_mv: R.driver.drop_mv, ohms: R.driver.ohms, output: outName(i) }));
    const assumed = L("ASSUMED (not published, marked in the mount table): the AT8833CQ is treated as a DRV8833 (AIN1 drives AOUT1 and so on, a 0.3 V drop and 0.4 ohm per leg), the order of the four pins of the stepper header, the rail of nFAULT's 10 kohm pull-up (3.3 V). NOT modelled: the 0.4 A current chop and the 2.2 to 3 A trip (nFAULT never asserts), servo timing limits, the module's own identification lines.",
      "ASSUMIDO (não publicado, marcado na tabela de montagem): o AT8833CQ é tratado como um DRV8833 (AIN1 aciona AOUT1 e assim por diante, queda de 0,3 V e 0,4 ohm por perna), a ordem dos quatro pinos do conector de passo, o trilho do pull-up de 10 kohm do nFAULT (3,3 V). NÃO modelado: o limite de 0,4 A e o desarme de 2,2 a 3 A (nFAULT nunca é acionado), limites de tempo do servo, as linhas de identificação do módulo.",
      "ASUMIDO (no publicado, marcado en la tabla de montaje): el AT8833CQ se trata como un DRV8833 (AIN1 maneja AOUT1 y así sucesivamente, caída de 0,3 V y 0,4 ohm por pierna), el orden de los cuatro pines del conector paso a paso, el riel del pull-up de 10 kohm de nFAULT (3,3 V). NO modelado: el límite de 0,4 A y el disparo de 2,2 a 3 A (nFAULT nunca se activa), límites de tiempo del servo, las líneas de identificación del módulo.");
    out.push(writePart({ id: "dotbench.kode-robotics", dir: "kode-robotics", w: W, d: D + PIN_LEN, h: 14, zFace: { top: 10.1 }, scale: 8, estimate: true, category: "kode-module", tags: ["kode", "module", "robotics", "motor", "servo", "stepper", "h-bridge", "at8833"],
      name: L("Kode Robotics module", "Módulo Kode Robotics", "Módulo Kode Robotics"),
      desc: cat(L("The official Robotics module (KDROB001): AT8833CQ dual H-bridge for two brushed motors (MOTA_1/2, MOTB_1/2, also the stepper header STP_1..4), a servo output (J402: GND, 5V, SIG on GPIO11), an I2C port (J403, GPIO8 SCL and GPIO9 SDA with 2.2 kohm pull-ups to 3.3 V) and a sensor header (J404, GPIO15 to 18). It mounts on J3, upright or turned. Upright map: AIN1 GPIO20, AIN2 GPIO21, BIN1 GPIO13, BIN2 GPIO14, nSLEEP GPIO19 (the driver is asleep, outputs high impedance, until it is high), nFAULT GPIO12. The motors and servo run from the Dot's 5 V rail, so it must be on. Drive IN1 or IN2 with PWM and hold the other level, like the real module.", "O módulo Robotics oficial (KDROB001): ponte H dupla AT8833CQ para dois motores DC (MOTA_1/2, MOTB_1/2, também o conector de passo STP_1..4), uma saída de servo (J402: GND, 5V, SIG no GPIO11), uma porta I2C (J403, GPIO8 SCL e GPIO9 SDA com pull-ups de 2,2 kohm a 3,3 V) e um conector de sensores (J404, GPIO15 a 18). Encaixa no J3, normal ou virado. Mapa normal: AIN1 GPIO20, AIN2 GPIO21, BIN1 GPIO13, BIN2 GPIO14, nSLEEP GPIO19 (o driver dorme, saídas em alta impedância, até ficar alto), nFAULT GPIO12. Os motores e o servo usam o trilho de 5 V do Dot, que precisa estar ligado. Acione IN1 ou IN2 com PWM e mantenha o outro nível, como o módulo real.", "El módulo Robotics oficial (KDROB001): puente H doble AT8833CQ para dos motores DC (MOTA_1/2, MOTB_1/2, también el conector paso a paso STP_1..4), una salida de servo (J402: GND, 5V, SIG en GPIO11), un puerto I2C (J403, GPIO8 SCL y GPIO9 SDA con pull-ups de 2,2 kohm a 3,3 V) y un conector de sensores (J404, GPIO15 a 18). Encaja en el J3, normal o girado. Mapa normal: AIN1 GPIO20, AIN2 GPIO21, BIN1 GPIO13, BIN2 GPIO14, nSLEEP GPIO19 (el driver duerme, salidas en alta impedancia, hasta que esté alto), nFAULT GPIO12. Los motores y el servo usan el riel de 5 V del Dot, que debe estar encendido. Maneja IN1 o IN2 con PWM y mantén el otro nivel, como el módulo real."), assumed, NOTE_EST),
      keywords: KW(["robotics", "kode", "module", "motor driver", "h-bridge", "servo", "stepper", "at8833", "i2c"], ["robótica", "kode", "módulo", "driver de motor", "ponte h", "servo", "passo", "at8833", "i2c"], ["robótica", "kode", "módulo", "driver de motor", "puente h", "servo", "paso a paso", "at8833", "i2c"]),
      extra: { logic_mv: 3000, mount: flatMount(W, D, C.mountPins, C.rails), refs: holes(W, D, 35, 31) },
      pins, groups, outputs: ["aout1", "aout2", "bout1", "bout2"].map((n) => ({ name: n, type: "number", min: 0, max: 1, label: L(n.toUpperCase()) })),
      behaviour: { type: "declarative", engine: 1, elements },
      svg: ({ px, W: PW }) => `<rect x="2" y="2" width="${PW - 4}" height="${px(D) - 4}" rx="6" fill="#1d4f91" stroke="#0b2548" stroke-width="3"/><rect x="${px(17.5)}" y="${px(16)}" width="${px(10)}" height="${px(10)}" fill="#1b1b1b"/><text x="${px(22.5)}" y="${px(22)}" text-anchor="middle" font-family="monospace" font-size="9" fill="#bbb">AT8833CQ</text><text x="${px(9.4)}" y="${px(10)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#fff">motor B</text><text x="${px(22.5)}" y="${px(10)}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#fff">stepper</text><text x="${px(35.3)}" y="${px(10)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#fff">motor A</text><text x="${px(22.5)}" y="${px(35)}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#fff">ROBOTICS</text>${pinDots(pins, px, 2.4)}`,
      tests: { "robotics.test.json": { name: "nSLEEP gates the bridge (module powered by the tester)", steps: [
        { comment: "driver asleep: AIN1 high does nothing", set_pin: { pin: "AIN1", level: 1 } }, { expect_pin: { pin: "MOTA_1", mv_max: 300 } },
        { set_pin: { pin: "NSLEEP", level: 1 } }, { comment: "awake: 5 V minus the assumed 0.3 V drop", expect_pin: { pin: "MOTA_1", mv_min: 4300, mv_max: 4800 } }, { expect_pin: { pin: "MOTA_2", mv_max: 300 } },
        { set_pin: { pin: "AIN1", level: 0 } }, { set_pin: { pin: "AIN2", level: 1 } }, { comment: "reverse", expect_pin: { pin: "MOTA_2", mv_min: 4300, mv_max: 4800 } }, { expect_pin: { pin: "MOTA_1", mv_max: 300 } },
        { expect_pin: { pin: "STP_2", mv_min: 4300, mv_max: 4800 } },
      ] } } })); }
  // ---------------------------------------------------------------- shape only: Camera, Mesh, hacking module
  // Camera: the bare board (46.6 x 45.5 mm, documented) with the J401 at the bottom edge, flat. Mesh and the hacking module: a moulded housing, a wide upper block on the Dot's top edge,
  // a tongue against its back, the pins pointing down, two whip antennas on SMA bases (ref-4..8 pictures, ESTIMATES scaled against the Dot's 46.65 x 77 mm and the 2.54 mm pitch).
  const shape = (id, key, g, name, what, kw) => {
    const tab = T[key].pins, byG = Object.fromEntries(tab.map(([n, gp]) => [gp, n])), stand = g.stand, w = g.w, d = g.d + (stand ? 0 : PIN_LEN), h = g.h, x0 = (w - 9 * ODD) / 2;
    const place = stand ? (c, r) => ({ x: x0 + ODD * (c - 1), y: PIN_Y + (r ? -1.27 : 1.27), z: BLOCK_BOTTOM - PIN_SHOW / 2 }) : flatPlace(w, g.d);
    const C = conn20(stand ? "straight" : "mirror", stand ? "KDINT" : "J401", place, { gpio: (gp) => byG[gp], rail: (r, k) => (k === 1 ? r : `${r}_2`),
      pin: (n, sig, j, at) => P(n, sig.rail ? "io" : "io", at.x, at.y, { face: "bottom", abs_max_mv: sig.rail ? 60000 : HI, label: { en: sig.rail ? n : `${n}` } }) });
    const pins = C.pins, groups = ["V5", "V33", "GND"].map((r) => ({ pins: [r, r + "_2"] }));
    const sh = L("SHAPE ONLY: it mounts on the header and passes the rails and the 14 signal terminals through, and does nothing else. " + what + " is not simulated: no behaviour, no chip, no bus device. The pin names follow the published pin map and the 20 pins sit in the real 2x10 connector.",
      "SÓ A FORMA: encaixa no cabeçalho e repassa os trilhos e os 14 terminais de sinal, e nada mais. " + what + " não é simulado: sem comportamento, sem chip, sem dispositivo de barramento. Os nomes dos pinos seguem o mapa publicado e os 20 pinos ficam no conector 2x10 real.",
      "SOLO LA FORMA: encaja en el cabezal y pasa los rieles y los 14 terminales de señal, y nada más. " + what + " no se simula: sin comportamiento, sin chip, sin dispositivo de bus. Los nombres de los pines siguen el mapa publicado y los 20 pines están en el conector 2x10 real.");
    const geo = stand ? L(`Housing measured from the owner's photos with a solved camera (${w} x ${g.d} x ${h} mm with the antennas; one L-shaped skin: block 18.2 mm high, 31 mm deep at the foot and 35 at the top, tongue 14 mm thick hanging 26 mm below it, flush with its back and ends; the side silhouette is profile): two whip antennas (about ${g.sma[0].len} and ${g.sma[1].len} mm) on SMA bases listed in refs (non-electrical).`, `Estimativa da caixa (${w} x ${g.d} mm, ${h} mm com as antenas, só fotos): bloco superior largo, aba atrás, duas antenas chicote (cerca de ${g.sma[0].len} e ${g.sma[1].len} mm) em bases SMA listadas em refs (não elétrico).`, `Estimación de la carcasa (${w} x ${g.d} mm, ${h} mm con las antenas, solo fotos): bloque superior ancho, lengüeta detrás, dos antenas látigo (unos ${g.sma[0].len} y ${g.sma[1].len} mm) en bases SMA listadas en refs (no eléctrico).`) : null;
    const mount = stand ? { via: "interposer", orientations: ["upright"], pins: C.mountPins, rails: C.rails,
      connector: { seat_mm: { x: w / 2, y: PIN_Y, z: BLOCK_BOTTOM }, pin_dir: "-z", pin_length_mm: PIN_SHOW, odd_row: "high_y", source: "assumed" },
      placement: { anchor_dot_mm: { x: 0, y: 38.5, z: 0.6 }, upright: { x: "+X", y: "+Z", z: "+Y" }, source: "assumed" } } : { ...flatMount(w, g.d, C.mountPins, C.rails), orientations: T[key].orientations ?? ["upright", "turned"] };
    out.push(writePart({ id: "dotbench." + id, dir: id, w, d, h, scale: 8, estimate: !!g.est, category: "kode-module", tags: ["kode", "module", "shape-only", ...kw.en.slice(0, 2)],
      name: L(name + " (shape only)", name + " (só a forma)", name + " (solo la forma)"), desc: stand ? cat(sh, geo, NOTE_EST) : sh, keywords: KW([...kw.en, "shape only"], [...kw["pt-BR"], "só a forma"], [...kw.es, "solo la forma"]),
      extra: { mount, ...(stand ? { profile: [[0, 0], [TONGUE, 0], [TONGUE, BLOCK_BOTTOM], [31, BLOCK_BOTTOM], [35, g.zTop], [0, g.zTop]].map(([y, z]) => ({ y, z })), refs: g.sma.map((a, i) => ({ name: "SMA" + (i + 1), kind: "antenna_sma", mm: { x: a.x, y: a.y, z: g.zTop }, length_mm: a.len, note: "measured from the owner photos with a solved camera" })) } : {}) }, pins, groups,
      behaviour: { type: "declarative", engine: 1, elements: [{ type: "resistor", a: "V33", b: "GND", ohms: 1000000000 }] },
      svg: ({ px, W: PW }) => stand
        ? `<rect x="2" y="2" width="${PW - 4}" height="${px(g.d) - 4}" rx="6" fill="${g.color}" stroke="#222" stroke-width="3"/><rect x="2" y="2" width="${PW - 4}" height="${px(TONGUE)}" fill="#0002"/>${g.sma.map((a) => `<circle cx="${px(a.x)}" cy="${px(a.y)}" r="${px(2.2)}" fill="#c9a227" stroke="#222" stroke-width="2"/>`).join("")}<text x="${px(w / 2)}" y="${px(g.d - 4)}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#555">${name} (shape only, top view)</text>${pinDots(pins, px, 1.6)}`
        : `<rect x="2" y="2" width="${PW - 4}" height="${px(g.d) - 4}" rx="6" fill="#2a2a2a" stroke="#111" stroke-width="3"/><text x="${px(w / 2)}" y="${px(g.d / 2)}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#ddd">${name}</text><text x="${px(w / 2)}" y="${px(g.d / 2 + 5)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#aaa">shape only</text>${pinDots(pins, px, 2.2)}`,
      tests: { "shape.test.json": { name: "a shape-only module has no behaviour: a pin keeps what the tester drives", steps: [{ set_pin: { pin: tab[1][0], level: 1 } }, { expect_pin: { pin: tab[1][0], level: 1 } }] } } }));
  };
  const hous = (color) => ({ stand: true, w: 47, d: 35, h: 95, zTop: 44.2, est: true, color, sma: [{ x: 12.4, y: 10.5, len: 30.5 }, { x: 34.9, y: 10.5, len: 50.5 }] });   // measured from the photos with a solved camera (owner approved the shape)
  shape("kode-camera-shape", "camera", { w: 46.6, d: 45.5, h: 12, est: true }, "Kode Camera module", "The OV5640 camera (SCCB, DVP frames)", KW(["camera", "ov5640", "kode", "module"], ["câmera", "ov5640", "kode", "módulo"], ["cámara", "ov5640", "kode", "módulo"]));
  shape("kode-mesh-shape", "mesh", hous("#e6e3dc"), "Kode Mesh module", "The LoRa radio (LR2021) and the GNSS receiver", KW(["mesh", "lora", "gnss", "kode", "module"], ["mesh", "lora", "gnss", "kode", "módulo"], ["mesh", "lora", "gnss", "kode", "módulo"]));
  shape("kode-hacking-shape", "fck", hous("#2b2b2b"), "Kode hacking module", "The CC1101, nRF54L15, ESP32-C5 and GNSS radios", KW(["hacking", "cc1101", "sub-ghz", "kode", "module"], ["hacking", "cc1101", "sub-ghz", "kode", "módulo"], ["hacking", "cc1101", "sub-ghz", "kode", "módulo"]));
  return out;
}
