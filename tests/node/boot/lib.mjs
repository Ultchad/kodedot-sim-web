// Shared helpers of the boot tests: a DotbenchSystem on a directory, packages from the build dir, screenshots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DotbenchSystem } from "../../../runtime/web-adapter/dotbench-system.js";
import { NodeDirBackend } from "../../../runtime/web-adapter/persist-node.js";
import { encodePng } from "../kodeos/png.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = path.dirname(new URL(import.meta.url).pathname);
export const root = path.resolve(here, "../../..");
export const buildDir = () => process.env.DOTBENCH_BUILD || path.join(root, "build");
export const pkgFile = (name) => path.join(buildDir(), "apps", name, name + ".dotbench");
export const pkgBytes = (name) => new Uint8Array(fs.readFileSync(pkgFile(name)));
export const tmpDir = (p = "dbboot-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const FACTORY = ["kody_kart", "display_lvgl", "buttons_led"];
export const factoryJson = { format: 1, apps: FACTORY.map((n) => n + ".dotbench") };

/** A system on `dir` (the persistence directory): the same device across "page reloads" when the dir is reused. */
export function makeSystem(dir, { factory = factoryJson } = {}) {
  const sys = new DotbenchSystem({
    os: pkgBytes("kodeos"),
    persist: new NodeDirBackend(dir),
    factory: { apps: factory.apps, fetch: async (n) => pkgBytes(n.replace(/\.dotbench$/, "")) },
    pollMs: 20,
  });
  sys.logText = () => sys.lines.map((l) => l.text).join("\n");
  sys.events = [];
  sys.on("program", (p) => sys.events.push(p));
  return sys;
}

export async function waitFor(pred, ms, what, sys) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* not yet */ }
    if (ok) return true;
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what + (sys ? "\n--- log ---\n" + sys.logText().slice(-3000) : ""));
    await sleep(25);
  }
}

export function shot(sys, file) {
  const f = sys.frame();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(f.data, f.width, f.height));
}
export const swipeLeft = async (sys) => { for (let x = 360; x >= 40; x -= 40) { sys.touch(x, 300, true); await sleep(40); } sys.touch(40, 300, false); };
export const tap = async (sys, x, y, hold = 120) => { sys.touch(x, y, true); await sleep(hold); sys.touch(x, y, false); };

/** A copy of a .dotbench with another app identity (same code): for install/delete tests. */
export function renamePackage(src, name, display, version) {
  const out = path.join(tmpDir("dbpkg-"), name + ".dotbench");
  execFileSync("python3", ["-I", "-c", `
import sys, zipfile, json
src, out, name, display, version = sys.argv[1:6]
zi = zipfile.ZipFile(src); zo = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
for i in zi.infolist():
    d = zi.read(i.filename)
    if i.filename == "appdata/app.json":
        j = json.loads(d); j.update(name=name, display_name=display, version=version); d = json.dumps(j).encode()
    zo.writestr(i.filename, d)
zo.close()`, src, out, name, display, version]);
  return new Uint8Array(fs.readFileSync(out));
}
