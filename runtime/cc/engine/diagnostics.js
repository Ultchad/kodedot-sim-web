// SPDX-License-Identifier: GPL-3.0-or-later
// Compiler and linker output -> structured diagnostics the editor can mark up:
//   {file, line, column, severity: "error"|"warning"|"note", message, source: "compiler"|"linker", notes?: [...], hint?, system?, generated?}
// Lines are the user's own: the sketch is compiled with #line directives, so clang already names main.ino:LINE; errors inside the generated
// prototypes ("(auto prototypes)") are moved to the line of the function they were made from; errors inside a system or core header are moved to
// the user's #include line that pulled it in (`system: true`, the real location in `origin`).

const DIAG = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note|remark): (.*)$/;
const FROM = /^(?:In file included from|\s+from) (.+?):(\d+)[:,]?\s*$/;
const SYSTEM = /^(\/usr\/|\/dotcore\/|\(auto prototypes\)$)/;

/** "/src/util.h" -> "util.h"; user files keep the name the page gave them */
const userName = (f) => (f.startsWith("/src/") ? f.slice(5) : f);

/**
 * @param {string} text clang's stderr  @param {{protoOrigins?: {file:string,line:number}[], userFiles?: Set<string>}} ctx
 */
export function parseCompilerOutput(text, ctx = {}) {
  const out = [], chain = []; let last = null;
  for (const line of text.split("\n")) {
    const f = FROM.exec(line);
    if (f) { chain.push({ file: userName(f[1]), line: +f[2] }); continue; }
    const m = DIAG.exec(line);
    if (!m) continue;
    const sev = m[4] === "fatal error" ? "error" : m[4] === "remark" ? "note" : m[4];
    let d = { file: userName(m[1]), line: +m[2], column: +m[3], severity: sev, message: m[5], source: "compiler" };
    if (sev === "note" && last) { (last.notes ??= []).push(placed(d, [], ctx)); continue; }
    d = placed(d, chain.splice(0), ctx);
    out.push(d); last = d;
  }
  return out;
}

function placed(d, chain, ctx) {
  if (d.file === "(auto prototypes)") {
    const o = ctx.protoOrigins?.[d.line - 1];
    d.generated = true; d.origin = `(auto prototypes):${d.line}:${d.column}`;
    if (o) { d.file = o.file; d.line = o.line; d.column = 1; d.message += " (in the prototype the IDE step generated for this function; fix its parameter or return types)"; }
    return d;
  }
  if (SYSTEM.test(d.file)) {
    const user = chain.filter((c) => !SYSTEM.test(c.file));
    d.system = true; d.origin = `${d.file}:${d.line}:${d.column}`;
    if (user.length) { d.file = user[0].file; d.line = user[0].line; d.column = 1; }
  }
  return d;
}

/** friendly rewrites for what users hit most (the original text stays in `message`) */
const HINTS = [
  [/'freertos\/[^']*' file not found|'FreeRTOS\.h' file not found|'esp_[a-z_]+\.h' file not found|'driver\/[^']*' file not found/, "ESP-IDF and FreeRTOS headers are not part of the bench's Arduino core. Use the Arduino API (pinMode, digitalWrite, analogRead, Wire, SPI, Serial, millis, delay)."],
  [/'(?:WiFi|WiFiClient|WiFiS3|HTTPClient|WebServer|BluetoothSerial|BLEDevice)\.h' file not found/, "This board has no radio in the bench: WiFi stubs exist only where the board's capability list says so. Networking and Bluetooth are not simulated."],
  [/'avr\/(?:io|interrupt|sleep|wdt|eeprom)\.h' file not found/, "AVR register headers do not exist here: the sketch is compiled to WebAssembly, not to an AVR chip. Use the Arduino API; EEPROM.h is available."],
  [/use of undeclared identifier '(?:PORT[A-Z]|DDR[A-Z]|PIN[A-Z]|TCCR\d\w*|OCR\d\w*|TIMSK\d?|ADCSRA|SREG|UCSR\d\w*)'/, "Direct chip registers (PORTB, DDRB, TCCR1A, ...) do not exist: the bench does not emulate the chip. Use pinMode/digitalWrite/analogWrite."],
  [/cannot use '(?:throw|try)' with exceptions disabled|cannot use 'throw' with exceptions disabled/, "C++ exceptions are off (like on most Arduino cores). Return an error code instead."],
  [/use of (?:dynamic_cast|typeid) requires -frtti/, "RTTI is off (like on most Arduino cores): no typeid or dynamic_cast."],
  [/initial memory too small, (\d+) bytes needed/, "The sketch's static data does not fit the part's memory (behaviour.memory_kb). Use smaller arrays or raise options.memoryKb."],
  [/undefined symbol: (.*)$/, "This function or variable is not defined by the sketch, a library you gave, or this board's core."],
  [/section too large|memory exhausted|out of memory/i, "The compiler ran out of memory in this tab. Close other tabs or simplify the sketch."],
];
export const hintFor = (msg) => { for (const [re, h] of HINTS) if (re.test(msg)) return h; return undefined; };
export function addHints(diags) { for (const d of diags) { if (d.severity !== "error") continue; const h = hintFor(d.message); if (h) d.hint = h; } return diags; }

/** wasm-ld: "wasm-ld: error: undefined symbol: foo" + ">>> referenced by main.ino.o:(setup())"; file is the sketch's first .ino, line 0 (the linker has no line) */
export function parseLinkerOutput(text, mainFile = "main.ino") {
  const out = []; let last = null;
  for (const line of text.split("\n")) {
    const m = /^wasm-ld: (error|warning): (.*)$/.exec(line);
    if (m) { last = { file: mainFile, line: 0, column: 0, severity: m[1], message: m[2], source: "linker" }; out.push(last); continue; }
    const r = /^>>> referenced by (.*)$/.exec(line.trim());
    if (r && last) last.message += ` (referenced by ${r[1].replace(/^sketch\.o:?/, "the sketch ")})`;
  }
  return out;
}
