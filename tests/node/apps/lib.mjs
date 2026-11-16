// Shared helpers for the starter-app tests: boot an app on a persistent bench, drive it by touch and buttons,
// and dump 410x502 screenshots (docs/apps-shots/<app>/ and, for the chosen ones, apps/<app>/appdata/screenshots/).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bench, RESET, pkgPath, sleep, buildApp, glueCtx, OFF } from "../persist/host.mjs";
import { savePng } from "../kodeos/png.mjs";

export { Bench, RESET, pkgPath, sleep, OFF, glueCtx };
const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../..");
export const BTN = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, TOP: 4, BOT: 5 };

/** Build apps/<name> (a no-op when nothing changed) and return the package path. */
export function build(name) {
  return buildApp(path.join(root, "apps", name));
}

/** Plain test runner: one "ok" line per check, non-zero exit when one fails. */
export function runner(label) {
  const r = { failed: false, n: 0 };
  r.check = async (name, fn) => {
    r.n++;
    try { await fn(); console.log("ok   - " + name); } catch (e) { r.failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); }
  };
  r.done = () => { console.log(label + (r.failed ? ": FAILED" : ": PASSED") + " (" + r.n + " checks)"); return r.failed ? 1 : 0; };
  return r;
}

const allShots = [];
const rgbaHash = (fb) => { let h = 2166136261; for (let i = 0; i < fb.length; i += 4) { h ^= fb[i] | (fb[i + 1] << 8) | (fb[i + 2] << 16); h = Math.imul(h, 16777619) >>> 0; } return h; };

/**
 * A running app: wraps a Bench boot with the touch/button/screenshot helpers.
 * opts.glue: { name: module } glue modules to attach (their api is on app.glue[name]); ticks run on every poll.
 */
export async function launch(bench, pkg, { name, glue = {}, reason = RESET.POWERON } = {}) {
  const run = await bench.boot(pkg, { reason });
  // The display fake counts flushes where the real link counts video frames, so AO_Display's health check takes a still
  // screen for a lost glass after a few seconds (docs/STATUS-apps.md). The host stands in for the 60 Hz counter.
  const dv = () => new DataView(run.M.HEAPU8.buffer, 0, run.M.HEAPU8.buffer.byteLength);
  const vsync = setInterval(() => { try { dv().setUint32(run.statePtr + OFF.frameSeq, (run.u32(OFF.frameSeq) + 1) >>> 0, true); } catch { /* gone */ } }, 30);
  const stop0 = run.stop;
  run.stop = async (o) => { clearInterval(vsync); return stop0(o); };
  const emitted = [];
  const ctx = glueCtx(run.M, emitted);
  const api = {};
  for (const [k, mod] of Object.entries(glue)) api[k] = mod.default(ctx);
  const app = {
    run, name, glue: api, emitted, shots: allShots,
    led: () => { const v = run.u32(OFF.ledRgb); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; },
    log: () => run.logText(),
    poll: () => ctx.ticks.forEach((t) => t()),
    async waitFor(pred, ms, what) {
      const t0 = Date.now();
      for (;;) {
        app.poll(); run.drain();
        if (pred()) return true;
        if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what + "\n--- log ---\n" + run.logText().slice(-3500));
        await sleep(20);
      }
    },
    /** Wait until the glass has been still for `quiet` ms. */
    async settle(quiet = 350, ms = 15000) {
      let last = rgbaHash(run.framebuffer()), t = Date.now();
      const t0 = Date.now();
      for (;;) {
        await sleep(60); app.poll();
        const h = rgbaHash(run.framebuffer());
        if (h !== last) { last = h; t = Date.now(); }
        if (Date.now() - t >= quiet) return;
        if (Date.now() - t0 > ms) throw new Error("the screen never settled");
      }
    },
    async tap(x, y, hold = 160) {
      run.touch(x, y, true); await sleep(hold); run.touch(x, y, false); await sleep(220);
    },
    /** Drag from (x0,y0) to (x1,y1) in a few steps. */
    async drag(x0, y0, x1, y1, steps = 8) {
      run.touch(x0, y0, true); await sleep(60);
      for (let i = 1; i <= steps; i++) { run.touch(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, true); await sleep(30); }
      run.touch(x1, y1, false); await sleep(150);
    },
    async press(btn, ms = 160) { run.button(btn, true); await sleep(ms); run.button(btn, false); await sleep(240); },
    async hold(btn, ms) { run.button(btn, true); await sleep(ms); run.button(btn, false); await sleep(200); },
    fb: () => run.framebuffer(),
    /** Number of distinct colours and the share of non-black pixels, to assert a screen is not empty. */
    stats() {
      const fb = run.framebuffer(); const s = new Set(); let lit = 0;
      for (let i = 0; i < fb.length; i += 4) { const v = fb[i] | (fb[i + 1] << 8) | (fb[i + 2] << 16); s.add(v); if (v) lit++; }
      return { colours: s.size, lit: lit / (fb.length / 4) };
    },
    /** Colour at a pixel, 0xRRGGBB. */
    px(x, y) { const fb = run.framebuffer(); const i = (y * 410 + x) * 4; return (fb[i] << 16) | (fb[i + 1] << 8) | fb[i + 2]; },
    /** Settle, then save the glass as docs/apps-shots/<app>/<label>.png. */
    async shot(label) {
      await app.settle();
      const fb = run.framebuffer();
      const dir = path.join(root, "docs/apps-shots", name);
      fs.mkdirSync(dir, { recursive: true });
      savePng(path.join(dir, label + ".png"), fb, 410, 502, 410 * 4);
      app.shots.push({ label, fb });
      return fb;
    },
    async restart() { await run.stop(); },
  };
  return app;
}

/** Copy chosen screenshots (labels, in order) to apps/<app>/appdata/screenshots/1.png.. for the store. */
export function storeShots(app, labels) {
  const dir = path.join(root, "apps", app.name, "appdata/screenshots");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  labels.forEach((l, i) => {
    const s = app.shots.find((x) => x.label === l);
    if (!s) throw new Error("no shot " + l);
    savePng(path.join(dir, `${i + 1}.png`), s.fb, 410, 502, 410 * 4);
  });
}
