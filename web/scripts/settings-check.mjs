// What is kept between visits, through the real page in headless Chrome.
//   npm run build && node scripts/settings-check.mjs
//
// kodeOS's own settings: on a fresh browser profile the time zone, the brightness and the vibration strength are
// changed by touch in kodeOS, then the page is reloaded after 2 s, closed right after a change, stopped and started,
// restarted, crashed 1.5 s after a change, and hidden and crashed: every time the settings must be what they were.
// The lock screen's "Choose your time zone" must not come back once a zone is chosen.
// They are read back with kodeOS's own console command `config` (key, value, stored=yes|no).
//
// The page's own preferences: language, theme, view, zoom, collapsed panel, side tab, model choice, dismissed hint.
//
// Screenshots: screenshots/settings-*.png. Exit code 1 on any failure.
import { join } from 'node:path';
import { launch, root, sleep, startServer, until, BASE } from './ux-lib.mjs';

const shots = join(root, 'screenshots');
const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const ctx = await browser.createBrowserContext(); // a fresh profile; it lives until the end, like a browser between visits
const problems = [];
let page;

/** A visit: a new tab on the same profile, kodeOS up on its lock screen. */
async function visit() {
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    if (localStorage.getItem('dotbench.view') === null) localStorage.setItem('dotbench.view', '"2d"'); // first visit only: this check drives the 2D view
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await ready();
}
async function ready() {
  await page.waitForFunction(() => window.__dotbench?.device().program?.get()?.kind === 'os' && window.__dotbench.device().status.get() === 'running', { timeout: 120000 });
  // the lock screen is drawn and kodeOS has read its settings
  await until(async () => /kaos\.boot zone:/.test(await sinceBoot()), 30000, 200);
  await sleep(2500);
}
const D = (fn, ...a) => page.evaluate(fn, ...a);
const logLines = () => D(() => window.__dotbench.device().log.get().map((l) => l.text));
/** The log from the last "zone:" boot line on (the log is the page's: it starts empty on every visit, and continues over a restart). */
const sinceBoot = async () => {
  const all = await logLines();
  let i = all.length - 1;
  while (i > 0 && !/kaos\.boot zone:/.test(all[i])) i--;
  return all.slice(Math.max(0, i)).join('\n');
};
/** kodeOS's settings as its console reports them: { key: { value, stored } }. */
async function config() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const n0 = await D(() => window.__dotbench.device().log.get().length);
    await D(() => window.__dotbench.device().sendConsole('config'));
    await until(async () => (await D((n) => window.__dotbench.device().log.get().slice(n).some((l) => /key="charge_ma"/.test(l.text)), n0)), 5000, 100);
    const lines = await D((n) => window.__dotbench.device().log.get().slice(n).map((l) => l.text), n0);
    const out = {};
    for (const l of lines) {
      const m = /config key="([^"]+)" value=(?:"([^"]*)"|(\S+)) stored=(yes|no)/.exec(l);
      if (m) out[m[1]] = { value: m[2] ?? m[3], stored: m[4] === 'yes' };
    }
    if (out.zone && out.bright && out.haptic_ui) return out;
    await sleep(500);
  }
  throw new Error('kodeOS did not answer `config`');
}
const brief = (c) => `zone ${c.zone.value}${c.zone.stored ? '' : ' (not stored)'}, brightness ${c.bright.value}${c.bright.stored ? '' : ' (not stored)'}, vibration ${c.haptic_ui.value}${c.haptic_ui.stored ? '' : ' (not stored)'}`;
const same = (a, b) => ['zone', 'bright', 'haptic_ui'].every((k) => a[k].value === b[k].value && a[k].stored === b[k].stored);

/** Page coordinates of a screen pixel (2D view). */
const at = async (x, y) => {
  const r = await page.$eval('[data-testid=glass]', (e) => {
    const b = e.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  return [r.left + ((x + 0.5) / 410) * r.width, r.top + ((y + 0.5) / 502) * r.height];
};
const tap = async (x, y, hold = 120) => {
  const [px, py] = await at(x, y);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await sleep(hold);
  await page.mouse.up();
};
const swipe = async (x0, y0, x1, y1) => {
  const [ax, ay] = await at(x0, y0);
  const [bx, by] = await at(x1, y1);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8);
    await sleep(40);
  }
  await page.mouse.up();
};
/** A slow drag that ends at rest: the list scrolls by exactly the distance dragged, with no fling. */
const drag = async (x0, y0, x1, y1) => {
  const [ax, ay] = await at(x0, y0);
  const [bx, by] = await at(x1, y1);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(ax + ((bx - ax) * i) / 16, ay + ((by - ay) * i) / 16);
    await sleep(30);
  }
  await sleep(300);
  await page.mouse.up();
};
/** Does one thing by touch and waits until kodeOS says it stored the setting. */
async function change(what, re, act) {
  const n0 = (await logLines()).length;
  await act();
  const ok = await until(async () => (await logLines()).slice(n0).some((l) => re.test(l)), 8000, 50);
  if (ok < 0) {
    await page.screenshot({ path: join(shots, 'settings-failure.png') });
    throw new Error(`${what}: kodeOS did not report the change (see settings-failure.png)`);
  }
}
// kodeOS by touch, from the lock screen
const openQuick = async () => {
  await swipe(205, 60, 205, 420); // pull the quick settings down
  await sleep(2500);
};
const openSettings = async () => {
  await openQuick();
  await tap(325, 95); // the gear
  await sleep(3000);
};
const openTime = async () => {
  await openSettings();
  await tap(200, 420); // the fourth row: Time
  await sleep(2500);
};
const nextZone = () => change('time zone', /kaos\.zone zone: .*\(stored\)/, () => tap(200, 115)); // the first row of Time: each tap takes the next zone
const zoneFromLock = async () => {
  await openTime();
  await nextZone();
};
const vibrationFromLock = async () => {
  await openSettings();
  await drag(205, 450, 205, 34); // four rows down the list: Sleep after, Turn off after, Kody's scene, Vibration
  await sleep(1200);
  await change('vibration', /kgui haptic_ui: .*\(stored\)/, () => tap(200, 420));
};
const brightnessFromLock = async (toX) => {
  await openQuick();
  await change('brightness', /kaos\.display brightness \d+% \(stored\)/, () => swipe(380, 318, toX, 318)); // drag the brightness bar
};
/** Amber pixels where the lock screen shows "Choose your time zone" (a date stands there once a zone is chosen). */
const nagPixels = () =>
  D(() => {
    const d = window.__dotbench.painter.canvas.getContext('2d').getImageData(60, 105, 290, 85).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 140 && d[i + 1] < 200 && d[i + 2] < 60) n++;
    return n;
  });
const screenshot = (name) => page.screenshot({ path: join(shots, `settings-${name}.png`) });
const crash = async () => {
  const c = await page.createCDPSession();
  c.send('Page.crash').catch(() => {});
  await sleep(800);
  await page.close().catch(() => {});
};

try {
  // ---- a fresh Dot
  await visit();
  const fresh = await config();
  check('fresh profile: kodeOS has no stored zone, brightness or vibration yet', !fresh.zone.stored && fresh.zone.value === 'UTC0' && !fresh.bright.stored && !fresh.haptic_ui.stored, brief(fresh));
  check('fresh profile: the lock screen asks to choose a time zone', (await nagPixels()) > 800, `${await nagPixels()} amber px`);
  await screenshot('1-fresh-lock-screen');

  // ---- change three settings by touch (each from the lock screen, where every path is the same every time)
  await brightnessFromLock(190);
  await tap(325, 95); // the gear, in the quick settings that are open
  await sleep(3000);
  await tap(200, 420); // Time
  await sleep(2500);
  await nextZone();
  await nextZone();
  await screenshot('2-time-zone-chosen');
  const two = await config();
  check('by touch in kodeOS: time zone and brightness changed and stored', two.zone.stored && two.zone.value !== 'UTC0' && two.bright.stored && Number(two.bright.value) < 80, brief(two));
  await sleep(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  check('reload after 2 s: both are kept', same(await config(), two), brief(await config()));
  await vibrationFromLock();
  const set = await config();
  check('by touch in kodeOS: vibration changed and stored as well', set.haptic_ui.stored && set.haptic_ui.value !== fresh.haptic_ui.value && set.zone.value === two.zone.value && set.bright.value === two.bright.value, brief(set));

  // ---- 1. a short moment, then reload
  await sleep(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  let now = await config();
  check('reload after 2 s: all three settings are kept', same(now, set), brief(now));
  check('reload: the lock screen no longer asks for a time zone', (await nagPixels()) < 50, `${await nagPixels()} amber px`);
  check('reload: the page shows the stored brightness', Math.abs((await D(() => window.__dotbench.device().backlight.get())) - Number(set.bright.value)) <= 2, `backlight ${await D(() => window.__dotbench.device().backlight.get())}%`);
  await screenshot('3-after-reload-lock-screen');

  // ---- 2. close the tab right after a change
  await zoneFromLock();
  const closing = (await logLines()).filter((l) => /kaos\.zone zone:/.test(l)).pop().replace(/^.*zone: (.*) \(stored\).*$/, '$1');
  await page.close({ runBeforeUnload: true }); // at once: the zone was stored by kodeOS a few milliseconds ago
  await sleep(300);
  await visit();
  now = await config();
  check('tab closed right after a change: the change is kept', now.zone.value === closing && now.zone.stored, `${now.zone.value} (chosen: ${closing})`);
  check('tab closed: the other settings are untouched', now.bright.value === set.bright.value && now.haptic_ui.value === set.haptic_ui.value, brief(now));

  // ---- 3. Stop right after a change, then Start
  await vibrationFromLock();
  const vib = (await logLines()).filter((l) => /kgui haptic_ui:/.test(l)).pop().replace(/^.*haptic_ui: (\S+) \(stored\).*$/, '$1');
  await page.click('[data-testid=stop]');
  await page.waitForSelector('[data-testid=device-idle]', { timeout: 10000 });
  await page.click('[data-testid=idle-start]');
  await ready();
  now = await config();
  check('Stop right after a change, then Start: the change is kept', now.haptic_ui.value === vib && now.haptic_ui.stored && now.zone.value === closing, brief(now));

  // ---- 4. Restart right after a change
  await zoneFromLock();
  const z4 = (await logLines()).filter((l) => /kaos\.zone zone:/.test(l)).pop().replace(/^.*zone: (.*) \(stored\).*$/, '$1');
  await page.click('[data-testid=restart]');
  await sleep(1500);
  await ready();
  now = await config();
  check('Restart right after a change: the change is kept', now.zone.value === z4 && now.zone.stored, `${now.zone.value} (chosen: ${z4})`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  now = await config();
  check('and it is still there after a reload', now.zone.value === z4 && now.haptic_ui.value === vib && now.bright.value === set.bright.value, brief(now));

  // ---- 5. the tab crashes 1.5 s after a change (no page-hide, no unload: only what was saved by then survives)
  await zoneFromLock();
  const z5 = (await logLines()).filter((l) => /kaos\.zone zone:/.test(l)).pop().replace(/^.*zone: (.*) \(stored\).*$/, '$1');
  await sleep(1500);
  await crash();
  await visit();
  now = await config();
  check('tab crashed 1.5 s after a change: the change is kept (saved soon after the touch)', now.zone.value === z5 && now.zone.stored, `${now.zone.value} (chosen: ${z5})`);

  // ---- 6. the page goes to the background (phone: another app), then is killed
  await brightnessFromLock(260);
  const b6 = (await logLines()).filter((l) => /kaos\.display brightness/.test(l)).pop().replace(/^.*brightness (\d+)%.*$/, '$1');
  await D(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(300);
  await crash();
  await visit();
  now = await config();
  check('page hidden right after a change, then killed: the change is kept', now.bright.value === b6 && now.bright.stored && now.zone.value === z5, brief(now));
  check('after all of it the lock screen still does not ask for a time zone', (await nagPixels()) < 50, `${await nagPixels()} amber px`);
  await screenshot('4-final-lock-screen');

  // ---- the page's own preferences
  await page.click('[data-testid=settings-menu]');
  await page.select('[data-testid=lang-select]', 'pt-BR');
  await page.click('[data-testid=theme-dark]');
  await page.keyboard.press('Escape');
  await page.click('[data-testid=zoom-2]');
  await page.click('[data-testid=drawer-console]'); // collapse the console card
  await page.click('[data-testid=left-tab-components]');
  await page.click('[data-testid=welcome-dismiss]').catch(() => {});
  await page.click('[data-testid=device-menu]');
  await page.click('[data-testid=model-option-simple]');
  await page.keyboard.press('Escape');
  await sleep(500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  const prefs = await D(() => ({
    lang: document.documentElement.lang,
    theme: document.documentElement.dataset.theme,
    view2d: document.querySelector('[data-testid=view-2d]')?.getAttribute('aria-pressed'),
    zoom2: document.querySelector('[data-testid=zoom-2]')?.getAttribute('aria-pressed'),
    consoleOpen: document.querySelector('[data-testid=drawer-console-panel]')?.dataset.open,
    benchOpen: document.querySelector('[data-testid=drawer-bench-panel]')?.dataset.open,
    leftTab: document.querySelector('[data-testid=left-tab-components]')?.getAttribute('aria-selected'),
    welcome: !!document.querySelector('[data-testid=welcome]'),
    model: window.__dotbench.model.getState().builtin,
  }));
  check('page preferences are kept over a reload: language, theme, 2D view and zoom, collapsed console, side tab, model, dismissed hint', prefs.lang === 'pt-BR' && prefs.theme === 'dark' && prefs.view2d === 'true' && prefs.zoom2 === 'true' && prefs.consoleOpen === 'false' && prefs.benchOpen === 'true' && prefs.leftTab === 'true' && !prefs.welcome && prefs.model === 'simple', JSON.stringify(prefs));
  await screenshot('5-page-preferences-kept');
  check('no page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) {
  check('the run completed', false, String(e?.stack ?? e));
  await page?.screenshot({ path: join(shots, 'settings-failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall settings checks passed');
process.exit(failed ? 1 : 0);
