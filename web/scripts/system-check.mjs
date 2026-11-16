// Apps inside kodeOS, through the real page in headless Chrome.
//   npm run build && node scripts/system-check.mjs [extra.dotbench]
// A fresh browser profile boots kodeOS with the factory apps; an app is opened by touch in kodeOS's own list; holding
// the bottom button returns to kodeOS; a package installed from the page appears and opens; a reload keeps
// everything; removing it and a factory reset work. Screenshots go to screenshots/system-*.png. Exit code 1 on failure.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, sleep, startServer, until, BASE } from './ux-lib.mjs';

const extra = process.argv[2] ?? join(root, '..', 'build', 'apps', 'audio', 'audio.dotbench');
const shots = join(root, 'screenshots');
const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const ctx = await browser.createBrowserContext(); // a fresh profile: empty IndexedDB and localStorage
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('dotbench.lang', '"en"');
  localStorage.setItem('dotbench.view', '"2d"');
  localStorage.setItem('dotbench.zoom2d', '"fit"');
});

const program = () => page.evaluate(() => window.__dotbench.device().program.get());
const appNames = () => page.evaluate(() => window.__dotbench.device().apps.get().map((a) => a.name));
const logText = () => page.evaluate(() => window.__dotbench.device().log.get().map((l) => l.text).join('\n'));
const statusApp = () => page.$eval('[data-testid=status-app]', (e) => e.textContent).catch(() => null);
const menuRunning = () => page.$eval('[data-testid=apps-menu-running]', (e) => e.textContent);
const colours = () =>
  page.evaluate(() => {
    const d = window.__dotbench.painter.canvas.getContext('2d').getImageData(0, 0, 410, 502).data;
    const set = new Set();
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      set.add(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16));
      if (d[i] | d[i + 1] | d[i + 2]) lit++;
    }
    return { colours: set.size, lit: lit / (d.length / 28) };
  });
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
const swipeLeft = async () => {
  const [x0, y0] = await at(360, 300);
  const [x1] = await at(40, 300);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0);
    await sleep(40);
  }
  await page.mouse.up();
};
const isOs = async () => (await program())?.kind === 'os';
const kodeosUp = (ms = 120000) => until(async () => (await isOs()) && (await page.evaluate(() => window.__dotbench.device().status.get())) === 'running' && (await colours()).colours > 20, ms, 200);
const openManager = async () => {
  if (!(await page.$('[data-testid=apps-manager]'))) await page.click('[data-testid=apps-menu]');
  await page.waitForSelector('[data-testid=apps-manager]');
};
const closeManager = async () => {
  if (await page.$('[data-testid=apps-popover]')) await page.keyboard.press('Escape');
  await sleep(200);
};
const dismissNotice = () => page.$eval('[data-testid=notice] button', (e) => e.click()).catch(() => {});
const ROW = [140, 250, 362];
const gotoList = async () => {
  await swipeLeft(); // lock screen -> launcher
  await sleep(5000);
  await tap(200, 140); // the "All" group
  await sleep(2500);
};

try {
  // ---- 1. fresh profile
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
  const up = await kodeosUp();
  check('a fresh profile boots kodeOS to its lock screen', up >= 0, `${Date.now() - t0} ms from navigation`);
  check('the page names what runs: kodeOS in the status bar and on the Apps button', (await statusApp()) === 'kodeOS' && (await menuRunning()) === 'kodeOS', `${await statusApp()} / ${await menuRunning()}`);
  await until(async () => (await appNames()).length === 3, 20000, 200);
  check('the factory apps are installed: Kody Kart, Display, Buttons + LED', (await appNames()).join('|') === 'Kody Kart|Display|Buttons + LED', (await appNames()).join('|'));
  const hint = await page.$eval('[data-testid=welcome]', (e) => e.textContent).catch(() => '');
  check('first run: the hint says how to unlock, open the app list, tap an app and come back', /unlock/.test(hint) && /app list/.test(hint) && /tap an app/.test(hint) && /bottom button/.test(hint) && /kodeOS/.test(hint), hint);
  await openManager();
  const rows = await page.$$eval('[data-testid=app-list] li', (els) => els.map((e) => e.dataset.app));
  check('the Apps menu is the app manager: running now, the installed apps, install, factory reset', rows.join('|') === 'kody_kart|display_lvgl|buttons_led' && (await page.$eval('[data-testid=apps-running]', (e) => e.textContent)) === 'kodeOS' && !!(await page.$('[data-testid=open-file]')) && !!(await page.$('[data-testid=factory-reset]')) && !(await page.$('[data-testid=apps-home]')), rows.join('|'));
  await sleep(400);
  await page.screenshot({ path: join(shots, 'system-1-app-manager.png') });
  await closeManager();
  await page.click('[data-testid=welcome-dismiss]').catch(() => {});

  // ---- 2. kodeOS's own list, by touch
  await sleep(1500);
  await gotoList();
  await page.screenshot({ path: join(shots, 'system-2-kodeos-app-list.png') });
  const list = await colours();
  check('kodeOS shows its app list after unlocking (screenshot system-2)', list.colours > 8, `${list.colours} colours`);
  await tap(200, ROW[0]);
  const started = await until(async () => (await program())?.kind === 'app', 60000, 200);
  const p = await program();
  check('tapping Kody Kart in kodeOS opens it: the page is told, without handling a restart', started >= 0 && p?.name === 'Kody Kart', JSON.stringify(p));
  await until(async () => /kart_ao .*demo race/.test(await logText()), 60000, 300);
  await sleep(2500);
  const title = await colours();
  check('Kody Kart shows its title screen', title.lit > 0.5 && title.colours > 8, `${(title.lit * 100).toFixed(0)}% lit, ${title.colours} colours`);
  check('status bar and Apps button now say Kody Kart', (await statusApp()) === 'Kody Kart' && (await menuRunning()) === 'Kody Kart', `${await statusApp()} / ${await menuRunning()}`);
  await page.screenshot({ path: join(shots, 'system-3-kody-kart.png') });
  await openManager();
  check('the app manager marks the running app and offers Home', (await page.$eval('[data-app=kody_kart] [aria-current]', (e) => e.getAttribute('aria-current'))) === 'true' && !!(await page.$('[data-testid=apps-home]')));
  await closeManager();

  // ---- 3. hold the bottom button
  const b = await page.$eval('[data-button=bottom]', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await sleep(400);
  await page.mouse.up();
  await sleep(1500);
  check('a short press of the bottom button stays in the app', (await program())?.kind === 'app');
  const h0 = Date.now();
  await page.mouse.down();
  const home = await until(isOs, 30000, 100);
  const held = Date.now() - h0;
  await page.mouse.up();
  // the app's own hold: 3000 ms of firmware time. In headless Chrome it has been measured at about 2.0 to 2.2 s of
  // wall time (the Node suite measures 3.0 s); that difference is the runtime's, so this only asks for a real hold.
  check('holding the bottom button returns to kodeOS (the app\'s own 3 s hold)', home >= 0 && held >= 1500, `back after ${held} ms of holding`);
  check('kodeOS knows it came back from an app', (await until(async () => /back from the user app|FROM_APP/.test(await logText()), 30000, 300)) >= 0);
  await kodeosUp(60000);
  await page.screenshot({ path: join(shots, 'system-4-back-in-kodeos.png') });

  // ---- 4. install from the page
  if (!existsSync(extra)) check(`a package to install exists (${extra})`, false);
  else {
    await openManager();
    const input = await page.$('[data-testid=file-input]');
    await input.uploadFile(extra);
    const inst = await until(async () => (await appNames()).length === 4 && (await program())?.kind === 'app', 120000, 300);
    const names = await appNames();
    const now = await program();
    check('installing a .dotbench from the page: it appears in the list and opens', inst >= 0 && now?.name === names[3], `${names.join('|')}; running ${JSON.stringify(now)}`);
    const notice = await page.$eval('[data-testid=notice]', (e) => e.textContent).catch(() => '');
    check('the page confirms where the app went', /is installed and open/.test(notice), notice);
    await dismissNotice();
    await openManager();
    await page.click('[data-testid=apps-home]');
    check('Home in the app manager returns to kodeOS', (await until(isOs, 30000, 100)) >= 0);
    await kodeosUp(60000);
    await sleep(3000); // back from an app, kodeOS shows its app list again by itself
    await page.screenshot({ path: join(shots, 'system-5-list-after-install.png') });

    // ---- 5. reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
    const again = await kodeosUp();
    await until(async () => (await appNames()).length === 4, 20000, 200);
    check('a reload keeps everything: kodeOS boots with the four apps', again >= 0 && (await appNames()).join('|') === names.join('|'), (await appNames()).join('|'));
    check('the first-run hint stays gone', !(await page.$('[data-testid=welcome]')));

    // ---- 6. open from the page, remove, factory reset
    await openManager();
    await page.click('[data-testid=app-buttons_led]');
    check('opening an app from the app manager starts it', (await until(async () => (await program())?.name === 'Buttons + LED', 60000, 200)) >= 0, JSON.stringify(await program()));
    await openManager();
    await page.click('[data-testid=apps-home]');
    await until(isOs, 30000, 100);
    await kodeosUp(60000);
    await openManager();
    const del = await page.$(`[data-testid=app-list] li:nth-child(4) [data-testid=app-remove]`);
    await del.click();
    await sleep(200);
    await del.click(); // asks first: the second press removes
    const gone = await until(async () => (await appNames()).length === 3, 60000, 300);
    check('removing the installed app (after a confirmation) takes it off the Dot', gone >= 0 && (await appNames()).join('|') === 'Kody Kart|Display|Buttons + LED', (await appNames()).join('|'));
    await kodeosUp(60000);
    await dismissNotice();
  }
  await openManager();
  const del2 = await page.$(`[data-app=display_lvgl] [data-testid=app-remove]`);
  await del2.click();
  await sleep(200);
  await del2.click();
  await until(async () => (await appNames()).length === 2, 60000, 300);
  await kodeosUp(60000);
  await dismissNotice();
  await openManager();
  await page.click('[data-testid=factory-reset]');
  const armed = await page.$eval('[data-testid=factory-reset]', (e) => e.textContent);
  await page.click('[data-testid=factory-reset]');
  const reset = await until(async () => (await appNames()).join('|') === 'Kody Kart|Display|Buttons + LED' && (await isOs()), 120000, 300);
  check('factory reset asks first, then the Dot starts like new with its factory apps', /Erase everything/.test(armed) && reset >= 0, `${armed}; ${(await appNames()).join('|')}`);
  await kodeosUp(60000);
  await closeManager();

  // ---- 7. the rest still works: stop/start, 3D
  await page.click('[data-testid=stop]');
  await page.waitForSelector('[data-testid=device-idle]', { timeout: 10000 });
  check('Stop switches the Dot off and says so, with one action', /The Dot is off/.test(await page.$eval('[data-testid=device-idle]', (e) => e.textContent)) && (await menuRunning()) === 'The Dot is off');
  await page.click('[data-testid=idle-start]');
  check('Start boots kodeOS again', (await kodeosUp()) >= 0);
  await page.click('[data-testid=view-3d]');
  const drawn = await until(() => page.evaluate(() => (window.__dotbench3d?.rendered() ?? 0) > 2 && window.__dotbench3d.info().model === 'kode'), 60000, 200);
  await sleep(1500);
  check('the 3D view shows the Dot running kodeOS', drawn >= 0);
  await page.screenshot({ path: join(shots, 'system-6-3d.png') });
  check('no page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) {
  check('the run completed', false, String(e?.stack ?? e));
  await page.screenshot({ path: join(shots, 'system-failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall system checks passed');
process.exit(failed ? 1 : 0);
