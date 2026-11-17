// Feature matrix: what C++/Arduino features compile, link and run in the browser flavour (run in Node through the same Worker bundle).
// Usage: node features.mjs        (prints a table; build/results-features.json)
import fs from "node:fs"; import path from "node:path"; import { Worker } from "node:worker_threads"; import { fileURLToPath, pathToFileURL } from "node:url";
import { writeStoredZip } from "./lib/zip-stored.js";
import { readDotpart } from "../../runtime/web-adapter/dotpart.js";
import { PartTester } from "../../runtime/web-adapter/part-tester.js";
import crypto from "node:crypto";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../.."), SITE = path.join(HERE, "build/site/cc/");
const worker = new Worker(path.join(SITE, "cc-worker.bundle.js"));
const pending = new Map(); let rr; const ready = new Promise((r) => (rr = r)); let nid = 0;
worker.on("message", (m) => { if (m.type === "ready") rr(m); else if (m.id !== undefined) pending.get(m.id)?.(m); else if (m.type === "error") console.error(m.message); });
worker.postMessage({ type: "init", base: pathToFileURL(SITE).href, assetBase: SITE }); await ready;
const compile = (req) => new Promise((res) => { const id = ++nid; pending.set(id, res); worker.postMessage({ type: "compile", id, ...req }); });
const base = JSON.parse(fs.readFileSync(path.join(ROOT, "parts/esp32-blink-echo/manifest.json"), "utf8"));
const picture = fs.readFileSync(path.join(ROOT, "parts/esp32-blink-echo/picture.svg"));

/** compile, import as a part, run `ms` of virtual time headless, return the console text */
async function run(r, ms = 200, feed) {
  const m2 = JSON.parse(JSON.stringify(base)); delete m2.$schema; m2.behaviour.wasm_sha256 = crypto.createHash("sha256").update(r.wasm).digest("hex");
  const bytes = writeStoredZip([["manifest.json", Buffer.from(JSON.stringify(m2))], [base.picture.file, picture], [base.behaviour.entry, r.wasm]]);
  const def = await readDotpart(bytes, { builtin: true }); if (!def.ok) return { importer: def.errors.map((e) => e.message).join("; ") };
  const t = await PartTester.create(def);
  try { if (feed) await feed(t); await t.advance(ms); await new Promise((r) => setTimeout(r, 500)); const st = t.bench.state().parts[0]; return { console: t.console(), crashed: !!st.crashed, busy: !!st.busy }; } finally { t.dispose(); }
}
const CASES = [
  ["std::vector, std::string, std::map, lambda, std::function, <algorithm>", `#include <vector>\n#include <string>\n#include <map>\n#include <functional>\n#include <algorithm>\n#include <cmath>\nvoid setup(){ Serial.begin(115200); std::vector<int> v{5,3,9,1}; std::sort(v.begin(), v.end()); std::string s="v:"; for(int x: v) s+=std::to_string(x)+","; std::map<std::string,int> m; m["a"]=2; std::function<int(int)> f=[&](int k){return k*m["a"];}; Serial.println(s.c_str()); Serial.println(f(21)); Serial.println(std::sqrt(2.0)); }\nvoid loop(){ delay(1000); }\n`, { expect: /v:1,3,5,9,\r?\n42\r?\n1\.41/ }],
  ["Arduino String, Serial.printf, float print", `void setup(){ Serial.begin(115200); String a="abc"; a += String(12) + "x"; a.toUpperCase(); Serial.println(a); Serial.printf("%d %5.2f %s\\n", 7, 3.14159, "ok"); Serial.println(3.14159, 3); }\nvoid loop(){ delay(1000); }\n`, { expect: /ABC12X\r?\n7  3\.14 ok\r?\n3\.142/ }],
  ["printf / puts to stdout reach the part console (via the WASI shim)", `#include <stdio.h>\nvoid setup(){ printf("hello %d\\n", 42); puts("line two"); }\nvoid loop(){ delay(1000); }\n`, { expect: /hello 42\r?\nline two/ }],
  ["C++ exceptions (try/catch)", `void setup(){ try { throw 1; } catch(int){ } }\nvoid loop(){}\n`, { expectFail: /exceptions|try|throw/i }],
  ["RTTI (typeid, dynamic_cast)", `#include <typeinfo>\nstruct A{virtual ~A(){}}; struct B:A{};\nvoid setup(){ A* a=new B; B* b=dynamic_cast<B*>(a); (void)b; (void)typeid(*a); }\nvoid loop(){}\n`, { expectFail: /rtti|typeid|dynamic_cast/i }],
  ["std::thread", `#include <thread>\nvoid setup(){ Serial.begin(115200); Serial.println("before"); std::thread t([]{}); t.join(); Serial.println("after"); }\nvoid loop(){}\n`, { expect: /before/, expectCrash: true }],
  ["FreeRTOS (xTaskCreate)", `#include <freertos/FreeRTOS.h>\nvoid setup(){}\nvoid loop(){}\n`, { expectFail: /FreeRTOS/ }],
  ["WiFi.h (not in dotcore)", `#include <WiFi.h>\nvoid setup(){ WiFi.begin("a","b"); }\nvoid loop(){}\n`, { expectFail: /WiFi\.h/ }],
  ["Wire master + SPI + Preferences compile", `#include <Wire.h>\n#include <SPI.h>\n#include <Preferences.h>\nPreferences p;\nvoid setup(){ Wire.begin(21,22); Wire.beginTransmission(0x40); Wire.write(0); Wire.endTransmission(); SPI.begin(18,19,23,5); SPI.transfer(0xA5); p.begin("x"); Serial.begin(115200); Serial.println("peripherals ok"); }\nvoid loop(){ delay(100); }\n`, { expect: /peripherals ok/ }],
  ["interrupts (attachInterrupt)", `volatile int n=0; void IRAM_ATTR isr(){ n++; }\nvoid setup(){ Serial.begin(115200); pinMode(4, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(4), isr, FALLING); Serial.println("irq attached"); }\nvoid loop(){ delay(10); }\n`, { expect: /irq attached/ }],
  ["library as extra sources (Foo/src/Foo.h + Foo.cpp)", `#include <Foo.h>\nvoid setup(){ Serial.begin(115200); Serial.println(foo_twice(21)); }\nvoid loop(){ delay(1000); }\n`, { extra: { "Foo/src/Foo.h": "#pragma once\nint foo_twice(int);\n", "Foo/src/Foo.cpp": "#include <Foo.h>\nint foo_twice(int x){ return 2*x; }\n" }, expect: /^42/m }],
  ["static array larger than the part's memory (1 MB)", `static uint8_t big[2000000];\nvoid setup(){ Serial.begin(115200); big[millis()%100]=1; Serial.println(big[5]); }\nvoid loop(){}\n`, { expectFail: /memory/i }],
  ["malloc exhaustion returns NULL (no crash)", `#include <stdlib.h>\nvoid setup(){ Serial.begin(115200); volatile char* p = (volatile char*)malloc(4000000); if (p) p[0]=1; Serial.println(p ? "got" : "null"); }\nvoid loop(){ delay(1000); }\n`, { expect: /null/ }],
  ["new with -fno-exceptions when memory is gone", `void setup(){ Serial.begin(115200); Serial.println("before"); volatile char* p = new char[4000000]; p[0]=1; Serial.println("after"); }\nvoid loop(){ delay(1000); }\n`, { expect: /before/, expectCrash: true }],
  ["infinite recursion (stack overflow) traps", `static volatile int depth;\nint rec(int n){ volatile char b[256]; for(int i=0;i<256;i++) b[i]=n; depth=n; return rec(n+1)+b[n&255]; }\nvoid setup(){ Serial.begin(115200); Serial.println("go"); Serial.println(rec(0)); }\nvoid loop(){}\n`, { expect: /go/, expectCrash: true }],
  ["tight loop with no import call (busy)", `void setup(){ Serial.begin(115200); Serial.println("spin"); }\nvoid loop(){ volatile unsigned long x=0; for(;;) x++; }\n`, { expect: /spin/, skipRun: false }],
  ["32-bit int/long like ESP32, 64-bit long long; Print prints ovf above 4294967040.0 (real Arduino behaviour)", `void setup(){ Serial.begin(115200); int x = 2147483647; x++; unsigned long long y = 1ULL<<40; Serial.println(x); Serial.println((double)y); Serial.println(sizeof(int)); Serial.println(sizeof(long)); Serial.println(sizeof(double)); }\nvoid loop(){ delay(1000); }\n`, { expect: /-2147483648\r?\novf\r?\n4\r?\n4\r?\n8/ }],
  ["random(), randomSeed(), map(), constrain()", `void setup(){ Serial.begin(115200); randomSeed(5); long r = random(10,20); Serial.println(r>=10 && r<20 ? "rand ok" : "rand bad"); Serial.println(map(5,0,10,0,100)); Serial.println(constrain(15,0,10)); }\nvoid loop(){ delay(1000); }\n`, { expect: /rand ok\r?\n50\r?\n10/ }],
  ["PROGMEM / F() macro / avr pgm_read_byte (AVR-only API)", `#include <avr/pgmspace.h>\nvoid setup(){}\nvoid loop(){}\n`, { expectFail: /pgmspace/ }],
];
const out = [];
for (const [name, ino, o] of CASES) {
  const t = performance.now(); const r = await compile({ ino, manifest: base, extraSources: o.extra ?? {} });
  let verdict, detail = "";
  if (o.expectFail) {
    const first = (r.stderr.split("\n").find((l) => /error/.test(l)) ?? "").trim();
    verdict = !r.ok && o.expectFail.test(r.stderr) ? "rejected as expected" : "UNEXPECTED"; detail = first.slice(0, 160);
  } else if (!r.ok) { verdict = "FAILED TO BUILD"; detail = (r.stderr.split("\n").find((l) => /error/.test(l)) ?? r.stderr).slice(0, 200); }
  else {
    const x = await run(r, o.expect && /spin/.test(o.expect.source) ? 300 : 300);
    if (x.importer) { verdict = "IMPORTER REJECTED"; detail = x.importer; }
    else { const okc = o.expect ? o.expect.test(x.console) : true; verdict = okc && (!!o.expectCrash === !!x.crashed) ? "works" : "WRONG"; detail = JSON.stringify(x.console.slice(-140)) + (x.crashed ? " [part flagged crashed]" : "") + (x.busy ? " [busy]" : ""); }
  }
  console.log(`${verdict.padEnd(22)} ${name}  (${Math.round(performance.now() - t)} ms)\n${" ".repeat(23)}${detail}`);
  out.push({ name, verdict, detail, ms: Math.round(performance.now() - t) });
}
fs.writeFileSync(path.join(HERE, "build/results-features.json"), JSON.stringify(out, null, 1));
worker.terminate(); process.exit(out.some((x) => /UNEXPECTED|FAILED|WRONG|REJECTED/.test(x.verdict)) ? 1 : 0);
