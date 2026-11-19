// The hold-to-go-home bar, checked in the real page (headless Chrome, fresh profile):
//   npm run build && UX_PORT=4412 node scripts/hold-check.mjs [--no-shots]
// In an open app (Light) it holds the bottom button (the keyboard's B, and the input layer the mouse and touch use):
//   - a short press shows nothing; a release at half removes the bar and the app stays open;
//   - a full hold: the bar shows after ~200 ms, fills, is "done" only when the device has left the app, and the app closes;
//   - in kodeOS holding the button shows nothing;
//   - screenshots of the bar half-way in the 3D device view, the 2D view and the Workbench, in light and dark
//     (the page's clock is stopped at the half-way point so that the picture does not depend on how slow the screenshot is).
// Screenshots: web/screenshots/hold/.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const noShots = process.argv.includes('--no-shots');
const shots = join(root, 'screenshots', 'hold');
mkdirSync(shots, { recursive: true });
const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

async function open(opts) {
  const o = await openPage(browser, { id: 'desk', w: 1440, h: 900 }, { prefs: { 'dotbench.welcome': 'seen', 'dotbench.panel.console': false, 'dotbench.panel.bench': false }, ...opts });
  const D = (fn, ...a) => o.page.evaluate(fn, ...a);
  await waitRunning(o.page, 90000);
  await o.page.click('[data-testid=welcome-dismiss]').catch(() => {});
  return { ...o, D };
}
const barOf = (D) => D(() => { const e = document.querySelector('[data-testid=hold-bar]'); return e ? { phase: e.dataset.phase, value: Number(e.getAttribute('aria-valuenow')) } : null; });
async function openApp({ D }, project = 'light') {
  await until(() => D((p) => !!window.__dotbench.device().apps.get().find((a) => a.project === p), project), 90000);
  await D((p) => window.__dotbench.device().launch(window.__dotbench.device().apps.get().find((a) => a.project === p).id), project);
  await until(() => D(() => window.__dotbench.device().program.get()?.kind === 'app' && window.__dotbench.device().status.get() === 'running'), 60000);
  await sleep(2500);
}
// Run inside the page: press B, stop the bar's clock at 1.5 s, let go (the app stays open, the bar stays on screen).
const HALF = () => new Promise((resolve) => {
  const hh = window.__dotbench.homeHold;
  window.__origNow = hh.now;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  const t0 = performance.now();
  setTimeout(() => {
    const t = performance.now();
    hh.now = () => t;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'b', bubbles: true }));
    resolve(Math.round(t - t0));
  }, 1500);
});
const kind = (D) => D(() => window.__dotbench.device().program.get()?.kind);
/** A screenshot of the page and of the Dot's screen (clipped), with a second go when software GL misses a deadline. */
async function shot(page, D, name, region) {
  for (let i = 0; ; i++) {
    try {
      await page.screenshot({ path: join(shots, `${name}.png`) });
      if (region) {
        const [a, b] = await D(() => [window.__dotbench3d.project('glass:0,0'), window.__dotbench3d.project('glass:410,502')]).catch(() => [null, null]);
        if (a && b) {
          const pad = 24;
          const x = Math.max(0, Math.min(a.x, b.x) - pad), y = Math.max(0, Math.min(a.y, b.y) - pad);
          await page.screenshot({ path: join(shots, `${name}-screen.png`), clip: { x, y, width: Math.abs(b.x - a.x) + 2 * pad, height: Math.abs(b.y - a.y) + 2 * pad } });
        }
      }
      return;
    } catch (e) {
      if (i >= 1) throw e;
      await sleep(2500);
    }
  }
}

try {
  // ---------------------------------------------------------------- behaviour (light, 3D device view)
  const a = await open({ theme: 'light', view: '3d' });
  const { page, D } = a;
  await openApp(a);
  const kb = page.keyboard;

  // The page is slow under software GL (one round trip to it takes a quarter of a second), so a press is made, timed and
  // observed inside the page: the keyboard's B as events, every animation frame recorded.
  await D(() => {
    window.__rec = [];
    const d = window.__dotbench.device();
    const tick = () => {
      const e = document.querySelector('[data-testid=hold-bar]');
      window.__rec.push({ t: performance.now(), phase: e?.dataset.phase ?? null, value: e ? Number(e.getAttribute('aria-valuenow')) : null, status: d.status.get(), program: d.program.get()?.kind ?? null });
      requestAnimationFrame(tick);
    };
    tick();
    window.__press = async (holdMs, settleMs = 900) => {
      const from = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      await new Promise((r) => setTimeout(r, holdMs));
      const released = performance.now();
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'b', bubbles: true }));
      await new Promise((r) => setTimeout(r, settleMs));
      return { from, released, rec: window.__rec.filter((r) => r.t >= from).map((r) => ({ ...r, t: Math.round(r.t - from) })) };
    };
  });
  // a loaded machine can delay the release timer: only a press that really lasted under 200 ms counts
  let short = null;
  for (let i = 0; i < 6; i++) {
    short = await D(() => window.__press(10));
    if (short.released - short.from < 190) break;
    await sleep(500);
  }
  check('The press was short (' + Math.round(short.released - short.from) + ' ms)', short.released - short.from < 190);
  check('A short press shows no bar', short.rec.every((r) => r.phase === null), JSON.stringify(short.rec.find((r) => r.phase)));
  check('...and the app stays open', short.rec.at(-1).program === 'app' && short.rec.at(-1).status === 'running');

  const half = await D(() => window.__press(1600));
  const shown = half.rec.filter((r) => r.phase);
  const firstShown = shown[0]?.t;
  check('Held: the bar appears after about 200 ms, not at once', firstShown >= 180 && firstShown <= 400, `${firstShown} ms`);
  const at = (ms) => half.rec.filter((r) => r.t <= ms).at(-1);
  check('Held 1.6 s: the bar is about half full', at(1590)?.phase === 'holding' && at(1590).value >= 35 && at(1590).value <= 65, JSON.stringify(at(1590)));
  const lastShown = shown.at(-1).t;
  check('Released at half: the bar is gone within 300 ms', lastShown <= 1600 + 300 && half.rec.at(-1).phase === null, `last seen ${lastShown} ms`);
  check('...and the app stays open', half.rec.at(-1).program === 'app' && half.rec.at(-1).status === 'running');

  // screenshots with the clock stopped half-way
  if (!noShots) {
    const frozen = async (name, region = true) => {
      await D(HALF);
      await sleep(400);
      await shot(page, D, name, region);
      await D(() => { window.__dotbench.homeHold.now = window.__origNow; });
      await sleep(700);
    };
    await frozen('3d-light');
    await page.click('[data-testid=view-2d]');
    await sleep(700);
    await frozen('2d-light', false);
    await page.click('[data-testid=mode-workbench]');
    await sleep(2500);
    await page.click('[data-testid=wb-focus-dot]');
    await sleep(2000);
    await frozen('workbench-light');
    await page.click('[data-testid=mode-device]');
    await sleep(500);
  }
  await ctx_close(a);

  // dark theme pictures
  if (!noShots) {
    const d = await open({ theme: 'dark', view: '3d' });
    await openApp(d);
    const frozen = async (name, region = true) => {
      await d.D(HALF);
      await sleep(400);
      await shot(d.page, d.D, name, region);
      await d.D(() => { window.__dotbench.homeHold.now = window.__origNow; });
      await sleep(700);
    };
    await frozen('3d-dark');
    await d.page.click('[data-testid=view-2d]');
    await sleep(700);
    await frozen('2d-dark', false);
    await d.page.click('[data-testid=mode-workbench]');
    await sleep(2500);
    await d.page.click('[data-testid=wb-focus-dot]');
    await sleep(2000);
    await frozen('workbench-dark');
    await ctx_close(d);
  }

  // ---------------------------------------------------------------- the full hold, with the clock running (pt-BR to see the label too)
  const f = await open({ theme: 'light', view: '3d', lang: 'pt-BR' });
  await openApp(f);
  await f.D(() => {
    const rec = (window.__holdLog = []);
    const t0 = performance.now();
    const d = window.__dotbench.device();
    const tick = () => {
      const e = document.querySelector('[data-testid=hold-bar]');
      rec.push({ t: Math.round(performance.now() - t0), phase: e?.dataset.phase ?? null, value: e ? Number(e.getAttribute('aria-valuenow')) : null, status: d.status.get(), program: d.program.get()?.kind ?? null });
      requestAnimationFrame(tick);
    };
    tick();
  });
  const label = await f.D(() => 'x'); void label;
  await f.page.keyboard.down('b');
  const pressedAt = Date.now();
  const gone = await until(async () => (await kind(f.D)) === 'os', 20000, 50);
  const tookMs = Date.now() - pressedAt;
  await f.page.keyboard.up('b');
  check('Held B in the app: the app closes and kodeOS comes up', gone >= 0, `${tookMs} ms`);
  const log = await f.D(() => window.__holdLog);
  const first = log.find((r) => r.phase);
  const done = log.filter((r) => r.phase === 'done');
  const pressRow = log.findIndex((r) => r.phase);
  check('The bar appeared and filled up to done', !!first && done.length > 0 && log.some((r) => r.phase === 'holding' && r.value >= 90), `first ${first?.t} ms, values ${[...new Set(log.filter((r) => r.phase).map((r) => r.value))].join(',')}`);
  check('Never "done" while the app was still running', done.every((r) => r.status !== 'running'), JSON.stringify(done.find((r) => r.status === 'running') ?? ''));
  check('It did not reach full by the clock alone: 100 only with "done"', log.every((r) => r.phase === 'done' || r.value === null || r.value < 100), '');
  check('The bar is gone once kodeOS is up', (await barOf(f.D)) === null);
  void pressRow;
  const lbl = await f.D(() => document.querySelector('[data-testid=hold-bar]')?.getAttribute('aria-label') ?? null);
  void lbl;

  // ---------------------------------------------------------------- in kodeOS the hold shows nothing
  await f.page.keyboard.down('b');
  let osSeen = null;
  for (let i = 0; i < 30; i++) { await sleep(100); osSeen = (await barOf(f.D)) ?? osSeen; }
  await f.page.keyboard.up('b');
  check('In kodeOS a held bottom button shows no bar', !osSeen, JSON.stringify(osSeen));
  check('No page errors', f.problems.length === 0 && a.problems.length === 0, [...a.problems, ...f.problems].slice(0, 3).join(' ; '));
  await ctx_close(f);
} catch (e) {
  failed++;
  console.log(`FAIL  the script stopped: ${e?.stack ?? e}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

async function ctx_close(o) {
  await o.ctx.close().catch(() => {});
}
