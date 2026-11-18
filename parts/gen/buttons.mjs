// SPDX-License-Identifier: GPL-3.0-or-later
// Buttons and switches beyond the first two (push-button, slide-switch): the 4-pin tactile buttons (6 x 6 and 12 x 12 mm),
// the latching (push on, push off) button and the miniature toggle switch.
//
// Legs and the breadboard (the holes are 2.54 mm apart, the centre channel is 7.62 mm between rows e and f):
//   tactile 6 x 6    real leg pitch 6.5 mm across the body x 4.5 mm along a side. Pushed into a breadboard the legs spring to
//                    7.62 x 5.08 mm: across the channel (e and f), two columns apart. That is the only way it fits, as with the real one.
//   tactile 12 x 12  real 12.5 x 5.0 mm -> 12.7 x 5.08 mm: rows d and g over the channel, two columns apart.
//   latching 8.5     real two rows of three, about 2.5 mm apart in the row and 5 mm between the rows (ESTIMATE, no drawing at hand).
//                    Here 2.54 mm in the row and 7.62 mm between the rows (the legs bent outwards), so that it straddles the channel
//                    and its two poles stay two separate circuits. On 5.08 mm it could only sit on one side and each column would
//                    short pole 1 to pole 2.
//   toggle (MTS-102) real lugs 4.7 mm apart -> 5.08 mm, in one row.
// The body box (w, d) is the envelope with the legs, which stand outside the moulding of the tactile buttons.
// Internal connections: the two legs of a tactile button that face each other across the body are one piece of metal (pins A1-A2 and
// B1-B2, the datasheet's 1-2 and 3-4): `groups`. The press joins A to B: one `switch` element. Contacts are ideal joins in this engine
// (the real ones are 50 to 100 milliohm, nothing against an LED's resistor): no contact resistance is solved.
import { L, P, writePart } from "./lib.mjs";

const leg = (x, y, r = 5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#c9a227" stroke="#7a6416" stroke-width="1.5"/>`;
const BOOL = (name, en, pt, es) => ({ name, type: "boolean", label: L(en, pt, es), default: false });
const CAPS = [["black", "#2a2a2e", "Black", "Preta", "Negra"], ["red", "#d0343f", "Red", "Vermelha", "Roja"], ["blue", "#1f6fd0", "Blue", "Azul", "Azul"], ["yellow", "#f2c21a", "Yellow", "Amarela", "Amarilla"], ["green", "#23a05a", "Green", "Verde", "Verde"], ["white", "#f1eee8", "White", "Branca", "Blanca"]];

/** A 4-pin tactile button. `w` x `body` is the moulding, `span` the distance between the two leg rows, `cap` the plunger's radius in the picture. */
function tact({ id, dir, w, body, span, h, cap, name, desc, kw, fields = [], tags, extraTests = [] }) {
  const d = Math.round((span + 0.4) * 100) / 100, y0 = (d - span) / 2, y1 = d - y0, xa = w / 2 - 2.54, xb = w / 2 + 2.54, s = 20;
  const pin = (n, x, y, lab) => P(n, "io", x, y, { face: "bottom", abs_max_mv: 24000, label: L(lab) });
  const pins = [pin("A1", xa, y0, "A1 (1)"), pin("A2", xa, y1, "A2 (2)"), pin("B1", xb, y0, "B1 (3)"), pin("B2", xb, y1, "B2 (4)")];
  const cx = (w / 2) * s, cy = (d / 2) * s, r = cap * s;
  return writePart({ id, dir, w, d, h, scale: s, estimate: true, category: "input", tags, name, desc, keywords: kw, pins,
    groups: [{ pins: ["A1", "A2"] }, { pins: ["B1", "B2"] }],
    fields: [BOOL("pressed", "Pressed", "Pressionado", "Pulsado"), ...fields],
    controls: [{ field: "pressed", region: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, mode: "momentary" }],
    visuals: [{ id: "cap", effect: "fill", x: cx - r * 0.7, y: cy - r * 0.7, w: r * 1.4, h: r * 1.4, color: "#ffffff", source: { field: "pressed" } }],
    behaviour: { type: "declarative", engine: 1, elements: [{ type: "switch", a: "A1", b: "B1", closed: { field: "pressed" }, bounce_ms: 5 }] },
    svg: ({ px }) => `<rect x="1" y="${px((d - body) / 2)}" width="${px(w) - 2}" height="${px(body)}" rx="${px(0.5)}" fill="#2b2b30" stroke="#0e0e11" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#3d3d44" stroke="#111" stroke-width="2"/>${pins.map((p) => leg(px(p.mm.x), px(p.mm.y))).join("")}`,
    tests: { "button.test.json": { name: "the legs are joined in pairs, the press joins the pairs", steps: [
      { comment: "A1 held low by the tester, the other three pulled up", set_pin: { pin: "A1", level: 0 } }, { pullup: "A2" }, { pullup: "B1" }, { pullup: "B2" }, { advance_ms: 5 },
      { comment: "A2 is the same metal as A1: low without a press", expect_pin: { pin: "A2", level: 0 } },
      { comment: "the B pair is not connected to the A pair", expect_pin: { pin: "B1", level: 1 } }, { expect_pin: { pin: "B2", level: 1 } },
      { set_field: { pressed: true } }, { advance_ms: 20 },
      { comment: "pressed: both B legs follow A", expect_pin: { pin: "B1", level: 0 } }, { expect_pin: { pin: "B2", level: 0 } },
      { set_field: { pressed: false } }, { advance_ms: 20 },
      { expect_pin: { pin: "B1", level: 1 } }, { expect_pin: { pin: "B2", level: 1 } }, { expect_pin: { pin: "A2", level: 0 } },
      { comment: "a press() holds the contact for its time and lets go", press: { field: "pressed", ms: 100 } }, { expect_pin: { pin: "B2", level: 1 } },
      { comment: "B1 and B2 are one piece too: drive B1 low, B2 follows", set_pin: { pin: "A1", level: null } }, { set_pin: { pin: "B1", level: 0 } }, { pullup: "A1" }, { advance_ms: 5 },
      { expect_pin: { pin: "B2", level: 0 } }, { expect_pin: { pin: "A1", level: 1 } },
      ...extraTests,
    ] } } });
}

export function buttons() {
  const out = [];
  // ---------------------------------------------------------------- tactile 6 x 6 mm, 4 pins
  out.push(tact({ id: "dotbench.tact-6mm", dir: "tact-6mm", w: 6, body: 6, span: 7.62, h: 5, cap: 1.75, tags: ["button", "tactile", "switch", "input"],
    name: L("Button 6x6", "Botão 6x6", "Botón 6x6"),
    desc: L("The classic breadboard button: 6 x 6 mm, four legs. The two legs that face each other across the body are one piece of metal (A1 with A2, B1 with B2: pins 1-2 and 3-4 of the datasheet), so across the breadboard's centre channel it joins the two halves of each of its columns all the time; a press joins A to B, the two columns. Momentary, 5 ms of contact bounce. Press it on the table; set the Pressed field to keep it down. Legs at 7.62 x 5.08 mm (the real 6.5 x 4.5 mm legs spring to that in a breadboard). Rated 24 V, 50 mA; the contact is an ideal join.",
      "O botão clássico de protoboard: 6 x 6 mm, quatro pernas. As duas pernas que ficam frente a frente através do corpo são uma peça só de metal (A1 com A2, B1 com B2: pinos 1-2 e 3-4 do datasheet), então sobre o canal central da protoboard ele liga o tempo todo as duas metades de cada uma das suas colunas; apertar liga A com B, as duas colunas. Momentâneo, 5 ms de repique. Aperte na mesa; use o campo Pressionado para mantê-lo apertado. Pernas em 7,62 x 5,08 mm (as pernas reais de 6,5 x 4,5 mm abrem até aí na protoboard). 24 V, 50 mA; o contato é uma ligação ideal.",
      "El pulsador clásico de protoboard: 6 x 6 mm, cuatro patas. Las dos patas enfrentadas a través del cuerpo son una sola pieza de metal (A1 con A2, B1 con B2: pines 1-2 y 3-4 de la hoja de datos), así que sobre el canal central de la protoboard une todo el tiempo las dos mitades de cada una de sus columnas; al pulsar une A con B, las dos columnas. Momentáneo, 5 ms de rebote. Púlsalo en la mesa; usa el campo Pulsado para mantenerlo. Patas a 7,62 x 5,08 mm (las patas reales de 6,5 x 4,5 mm se abren hasta ahí en la protoboard). 24 V, 50 mA; el contacto es una unión ideal."),
    kw: { en: ["button", "tactile", "tact switch", "push", "4 pin", "6x6", "momentary", "input"], "pt-BR": ["botão", "táctil", "tátil", "chave táctil", "push button", "4 pinos", "6x6", "momentâneo", "entrada"], es: ["botón", "pulsador", "táctil", "4 pines", "6x6", "momentáneo", "entrada"] } }));
  // ---------------------------------------------------------------- tactile 12 x 12 mm with a round cap, 4 pins
  out.push(tact({ id: "dotbench.tact-12mm", dir: "tact-12mm", w: 12, body: 12, span: 12.7, h: 12, cap: 5.75, tags: ["button", "tactile", "switch", "input", "cap"],
    name: L("Button 12x12", "Botão 12x12", "Botón 12x12"),
    desc: L("The large tactile button with a round coloured cap: 12 x 12 mm, four legs joined in pairs like the 6 x 6 one (A1 with A2, B1 with B2; a press joins A to B). Choose the cap's colour. Momentary, 5 ms of contact bounce. Legs at 12.7 x 5.08 mm (real 12.5 x 5.0 mm): over a breadboard's centre channel they stand in rows d and g, two columns apart. Rated 24 V, 50 mA; the contact is an ideal join. The height with the cap is an estimate.",
      "O botão táctil grande com capa redonda colorida: 12 x 12 mm, quatro pernas ligadas em pares como no de 6 x 6 (A1 com A2, B1 com B2; apertar liga A com B). Escolha a cor da capa. Momentâneo, 5 ms de repique. Pernas em 12,7 x 5,08 mm (real 12,5 x 5,0 mm): sobre o canal central da protoboard ficam nas fileiras d e g, com duas colunas de distância. 24 V, 50 mA; o contato é uma ligação ideal. A altura com a capa é estimada.",
      "El pulsador táctil grande con tapa redonda de color: 12 x 12 mm, cuatro patas unidas por pares como el de 6 x 6 (A1 con A2, B1 con B2; al pulsar une A con B). Elige el color de la tapa. Momentáneo, 5 ms de rebote. Patas a 12,7 x 5,08 mm (real 12,5 x 5,0 mm): sobre el canal central de la protoboard quedan en las filas d y g, a dos columnas. 24 V, 50 mA; el contacto es una unión ideal. La altura con la tapa es estimada."),
    kw: { en: ["button", "tactile", "tact switch", "push", "4 pin", "12x12", "cap", "arcade", "momentary", "input"], "pt-BR": ["botão", "táctil", "tátil", "push button", "4 pinos", "12x12", "capa", "momentâneo", "entrada"], es: ["botón", "pulsador", "táctil", "4 pines", "12x12", "tapa", "momentáneo", "entrada"] },
    fields: [{ name: "cap", type: "enum", label: L("Cap colour", "Cor da capa", "Color de la tapa"), default: "red", values: CAPS.map(([value, , en, pt, es]) => ({ value, label: L(en, pt, es) })) }],
    extraTests: [{ comment: "the cap's colour is only a look", set_field: { cap: "blue" } }, { advance_ms: 5 }, { expect_pin: { pin: "B2", level: 0 } }, { expect_pin: { pin: "A1", level: 1 } }] }));
  // ---------------------------------------------------------------- latching push button, 6 pins (DPDT)
  { const w = 8.5, d = 8.5, s = 16, ys = [d / 2 - 3.81, d / 2 + 3.81], xs = [w / 2 - 2.54, w / 2, w / 2 + 2.54], pins = [];
    ys.forEach((y, r) => ["NC", "COM", "NO"].forEach((n, i) => pins.push(P(n + (r + 1), "io", xs[i], y, { face: "bottom", abs_max_mv: 30000, label: L(n + (r + 1)) }))));
    const sw = (com, to, on) => ({ type: "switch", a: com, b: to, closed: { field: "latched", op: "eq", value: on }, bounce_ms: 2 });
    out.push(writePart({ id: "dotbench.latching-button", dir: "latching-button", w, d, h: 14, scale: s, estimate: true, category: "input", tags: ["button", "latching", "self-locking", "switch", "dpdt", "input"],
      name: L("Latching button", "Botão trava", "Botón retención"),
      desc: L("The self-locking push button, 8.5 x 8.5 mm, six pins: press it once and the plunger stays down and the contact stays closed; press again and it comes back. Click it on the table. It is two switches moved by one plunger (DPDT), one per row of pins: released, COM is joined to NC; latched, COM is joined to NO. For a simple on/off use COM1 and NO1. Rows 7.62 mm apart so it sits over a breadboard's centre channel with one pole on each side. Rated 30 V, 0.3 A; contacts are ideal joins. ESTIMATES: the leg positions (real about 2.5 x 5 mm, bent out here) and which end pin is NO: check your part with a multimeter.",
        "O botão com trava (autotravante), 8,5 x 8,5 mm, seis pinos: aperte uma vez e o pino fica embaixo e o contato fica fechado; aperte de novo e ele volta. Clique nele na mesa. São duas chaves movidas pelo mesmo pino (DPDT), uma por fileira de pinos: solto, COM fica ligado ao NC; travado, COM fica ligado ao NO. Para um liga/desliga simples use COM1 e NO1. Fileiras a 7,62 mm para ficar sobre o canal central da protoboard com um polo de cada lado. 30 V, 0,3 A; os contatos são ligações ideais. ESTIMATIVAS: a posição das pernas (real cerca de 2,5 x 5 mm, aqui abertas) e qual pino da ponta é o NO: confira a sua peça com um multímetro.",
        "El pulsador con enclavamiento (autobloqueo), 8,5 x 8,5 mm, seis pines: púlsalo una vez y el émbolo se queda abajo y el contacto cerrado; púlsalo otra vez y vuelve. Haz clic en la mesa. Son dos interruptores movidos por el mismo émbolo (DPDT), uno por fila de pines: suelto, COM queda unido a NC; enclavado, COM queda unido a NO. Para un encendido simple usa COM1 y NO1. Filas a 7,62 mm para quedar sobre el canal central de la protoboard con un polo a cada lado. 30 V, 0,3 A; los contactos son uniones ideales. ESTIMACIONES: la posición de las patas (real unos 2,5 x 5 mm, aquí abiertas) y cuál pin del extremo es NO: comprueba tu pieza con un multímetro."),
      keywords: { en: ["button", "latching", "self-locking", "push on push off", "on off", "dpdt", "6 pin", "switch", "power switch", "input"], "pt-BR": ["botão", "trava", "com trava", "autotravante", "liga desliga", "push button", "dpdt", "6 pinos", "chave", "entrada"], es: ["botón", "pulsador", "enclavamiento", "autobloqueo", "encendido apagado", "dpdt", "6 pines", "interruptor", "entrada"] },
      pins, fields: [BOOL("latched", "Latched (down)", "Travado (embaixo)", "Enclavado (abajo)")],
      controls: [{ field: "latched", region: { x: (w / 2 - 2.6) * s, y: (d / 2 - 2.6) * s, w: 5.2 * s, h: 5.2 * s }, mode: "toggle" }],
      visuals: [{ id: "cap", effect: "fill", x: (w / 2 - 1.6) * s, y: (d / 2 - 1.6) * s, w: 3.2 * s, h: 3.2 * s, color: "#ffffff", source: { field: "latched" } }],
      behaviour: { type: "declarative", engine: 1, elements: [sw("COM1", "NC1", false), sw("COM1", "NO1", true), sw("COM2", "NC2", false), sw("COM2", "NO2", true)] },
      svg: ({ px }) => `<rect x="1" y="1" width="${px(w) - 2}" height="${px(d) - 2}" rx="${px(0.5)}" fill="#2b2b30" stroke="#0e0e11" stroke-width="2"/><rect x="${px(w / 2 - 2.6)}" y="${px(d / 2 - 2.6)}" width="${px(5.2)}" height="${px(5.2)}" rx="${px(0.6)}" fill="#1f6fd0" stroke="#0d3a73" stroke-width="2"/>${pins.map((p) => leg(px(p.mm.x), px(p.mm.y), 4)).join("")}`,
      tests: { "latching.test.json": { name: "push on, push off: two poles change over together and stay", steps: [
        { comment: "both commons held low by the tester, the four ends pulled up", set_pin: { pin: "COM1", level: 0 } }, { set_pin: { pin: "COM2", level: 0 } }, { pullup: "NC1" }, { pullup: "NO1" }, { pullup: "NC2" }, { pullup: "NO2" }, { advance_ms: 10 },
        { comment: "released: COM to NC on both poles", expect_pin: { pin: "NC1", level: 0 } }, { expect_pin: { pin: "NO1", level: 1 } }, { expect_pin: { pin: "NC2", level: 0 } }, { expect_pin: { pin: "NO2", level: 1 } },
        { comment: "first press: latched", set_field: { latched: true } }, { advance_ms: 10 },
        { expect_pin: { pin: "NO1", level: 0 } }, { expect_pin: { pin: "NC1", level: 1 } }, { expect_pin: { pin: "NO2", level: 0 } }, { expect_pin: { pin: "NC2", level: 1 } },
        { comment: "nobody touches it: it stays", advance_ms: 2000 }, { expect_pin: { pin: "NO1", level: 0 } }, { expect_pin: { pin: "NC1", level: 1 } },
        { comment: "second press: released", set_field: { latched: false } }, { advance_ms: 10 },
        { expect_pin: { pin: "NC1", level: 0 } }, { expect_pin: { pin: "NO1", level: 1 } }, { expect_pin: { pin: "NC2", level: 0 } }, { expect_pin: { pin: "NO2", level: 1 } },
        { comment: "the poles are separate: free COM2, pole 2 floats high while pole 1 still conducts", set_pin: { pin: "COM2", level: null } }, { pullup: "COM2" }, { advance_ms: 10 }, { expect_pin: { pin: "NC2", level: 1 } }, { expect_pin: { pin: "NC1", level: 0 } },
      ] } } })); }
  // ---------------------------------------------------------------- miniature toggle switch, SPDT, 3 pins
  { const w = 13.2, d = 7.9, s = 11, pins = ["A", "COM", "B"].map((n, i) => P(n, "io", w / 2 + (i - 1) * 5.08, d / 2, { face: "bottom", abs_max_mv: 60000 }));
    const sw = (to, v) => ({ type: "switch", a: "COM", b: to, closed: { field: "position", op: "eq", value: v }, bounce_ms: 2 });
    out.push(writePart({ id: "dotbench.toggle-switch", dir: "toggle-switch", w, d, h: 27, scale: s, estimate: true, category: "input", tags: ["switch", "toggle", "lever", "spdt", "input"],
      name: L("Toggle switch", "Chave alavanca", "Interruptor palanca"),
      desc: L("A miniature toggle switch with a metal lever, on-on, three pins: COM connects to A or to B and stays there. Click it to flip. As in the real switch the lever leans away from the pin it connects: lever towards B, COM is joined to A. Pins 5.08 mm apart (the real lugs are 4.7 mm). Contacts are ideal joins. The sizes are estimates.",
        "Uma chave alavanca miniatura com alavanca de metal, liga-liga, três pinos: COM liga em A ou em B e fica. Clique para virar. Como na chave real, a alavanca inclina para o lado oposto ao pino que ela liga: alavanca para o lado do B, COM ligado ao A. Pinos a 5,08 mm (os terminais reais ficam a 4,7 mm). Os contatos são ligações ideais. As medidas são estimadas.",
        "Un interruptor de palanca miniatura con palanca metálica, on-on, tres pines: COM conecta con A o con B y se queda. Haz clic para cambiarlo. Como en el real, la palanca se inclina al lado contrario del pin que conecta: palanca hacia B, COM unido a A. Pines a 5,08 mm (los terminales reales están a 4,7 mm). Los contactos son uniones ideales. Las medidas son estimadas."),
      keywords: { en: ["switch", "toggle", "lever", "spdt", "on off", "input"], "pt-BR": ["chave", "alavanca", "interruptor", "liga desliga", "spdt", "entrada"], es: ["interruptor", "palanca", "conmutador", "encendido apagado", "spdt", "entrada"] },
      pins, fields: [{ name: "position", type: "enum", label: L("Position", "Posição", "Posición"), default: "a", values: [{ value: "a", label: L("A") }, { value: "b", label: L("B") }] }],
      controls: [{ field: "position", region: { x: (w / 2 - 4) * s, y: 4, w: 8 * s, h: d * s - 8 }, mode: "toggle" }],
      visuals: [{ id: "lever", effect: "fill", x: (w / 2 - 1.5) * s, y: (d / 2 - 1.5) * s, w: 3 * s, h: 3 * s, color: "#e8eef5", source: { field: "position" } }],
      behaviour: { type: "declarative", engine: 1, elements: [sw("A", "a"), sw("B", "b")] },
      svg: ({ px }) => `<rect x="1" y="1" width="${px(w) - 2}" height="${px(d) - 2}" rx="${px(0.4)}" fill="#2a5db0" stroke="#12305f" stroke-width="2"/><circle cx="${px(w / 2)}" cy="${px(d / 2)}" r="${px(3)}" fill="#c8ccd2" stroke="#666" stroke-width="2"/><circle cx="${px(w / 2)}" cy="${px(d / 2)}" r="${px(1.4)}" fill="#eef1f4" stroke="#777" stroke-width="1.5"/>${pins.map((p) => leg(px(p.mm.x), px(p.mm.y), 4)).join("")}`,
      tests: { "toggle.test.json": { name: "toggle switch joins COM to A or B", steps: [
        { set_pin: { pin: "COM", level: 0 } }, { pullup: "A" }, { pullup: "B" }, { advance_ms: 10 },
        { comment: "position a: COM is joined to A", expect_pin: { pin: "A", level: 0 } }, { expect_pin: { pin: "B", level: 1 } },
        { set_field: { position: "b" } }, { advance_ms: 10 }, { expect_pin: { pin: "A", level: 1 } }, { expect_pin: { pin: "B", level: 0 } },
        { comment: "it stays", advance_ms: 1000 }, { expect_pin: { pin: "B", level: 0 } },
      ] } } })); }
  return out;
}
export const CAP_COLOURS = Object.fromEntries(CAPS.map(([v, hex]) => [v, hex]));
