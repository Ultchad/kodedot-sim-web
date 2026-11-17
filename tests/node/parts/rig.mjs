// Shared rig of the parts tests: a real kodeOS-SDK app on a DotbenchDevice, a Bench attached to its J3 link, the built-in parts loaded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DotbenchDevice } from "../../../runtime/web-adapter/dotbench-device.js";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";
import { readDotpart } from "../../../runtime/web-adapter/dotpart.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pkgFile = (name) => path.join(process.env.DOTBENCH_BUILD || path.join(root, "build"), "apps", name, name + ".dotbench");
let failures = 0, count = 0;
export function check(cond, what, detail) {
  count++;
  if (cond) console.log("ok   - " + what);
  else { failures++; console.log("FAIL - " + what + (detail !== undefined ? "  [" + (typeof detail === "string" ? detail : JSON.stringify(detail)) + "]" : "")); }
}
export const finish = (name) => { console.log(`${name}: ${failures ? `FAILED (${failures} of ${count})` : `PASSED (${count} checks)`}`); return failures ? 1 : 0; };
export async function test(name, fn) { try { await fn(); } catch (e) { failures++; count++; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); } }

/** Register every built-in part (parts/dist/*.dotpart) in a bench. */
export async function loadLibrary(bench) {
  const dist = path.join(root, "parts/dist"), lib = JSON.parse(fs.readFileSync(path.join(dist, "library.json"), "utf8"));
  for (const p of lib.parts) { const def = await bench.loadPart(new Uint8Array(fs.readFileSync(path.join(dist, p.file)))); if (!def.ok) throw new Error(`${p.id}: ${JSON.stringify(def.errors)}`); }
  return lib;
}
/** Load a .dotpart file or a folder's build output into a bench: returns the part id. */
export async function loadFile(bench, file) { const def = await bench.loadPart(new Uint8Array(fs.readFileSync(file))); if (!def.ok) throw new Error(JSON.stringify(def.errors)); return def.manifest.id; }

/** A device running `app` (a package under build/apps) with a bench attached before the first boot. */
export async function rig(app, o = {}) {
  const dev = new DotbenchDevice({ autoRestart: o.autoRestart ?? true });
  const bench = new Bench({ clock: new BenchClock() });
  bench.attach(dev);
  await loadLibrary(bench);
  await dev.load(new Uint8Array(fs.readFileSync(pkgFile(app))));
  const r = {
    dev, bench,
    text: () => dev.lines.map((l) => l.text).join("\n"),
    mark: () => dev.lines.length,
    /** Wait for a log line matching re after mark `from`. */
    async waitLog(re, ms = 20000, from = 0) {
      const t0 = Date.now(), rx = re instanceof RegExp ? re : new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      for (;;) {
        const hit = dev.lines.slice(from).map((l) => l.text).find((t) => rx.test(t));
        if (hit) return rx.exec(hit);
        if (Date.now() - t0 > ms) throw new Error(`no log line ${rx} in ${ms} ms\n--- log ---\n${dev.lines.slice(-30).map((l) => l.text).join("\n")}`);
        await sleep(20);
      }
    },
    async until(pred, ms = 10000, what = "condition") { const t0 = Date.now(); for (;;) { if (pred()) return; if (Date.now() - t0 > ms) throw new Error("timeout: " + what); await sleep(20); } },
    async start() { await dev.start(); },
    close() { bench.dispose(); dev.stop(); dev.dispose?.(); },
  };
  return r;
}
