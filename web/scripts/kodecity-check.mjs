// KodeCity through the real page in headless Chrome: open it from the Apps menu, press the D-pad (arrow keys), take two
// screenshots a few seconds apart, and read the frames per second the status bar reports.
//   npm run build && node scripts/kodecity-check.mjs        (screenshots: screenshots/kodecity-*.png; exit code 1 on failure)
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
const ctx = await browser.createBrowserContext();
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
const lit = () =>
  page.evaluate(() => {
    const d = window.__dotbench.painter.canvas.getContext('2d').getImageData(0, 0, 410, 502).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 28) if (d[i] | d[i + 1] | d[i + 2]) n++;
    return n / (d.length / 28);
  });
const fps = () => page.$eval('[data-testid=status-fps]', (e) => Number(e.dataset.fps)).catch(() => -1);
const press = async (key, ms) => {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
};

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
  await until(async () => (await program())?.kind === 'os' && (await lit()) > 0.05, 120000, 200);
  await until(async () => (await page.evaluate(() => window.__dotbench.device().apps.get().length)) === 14, 60000, 300);
  await sleep(6000); // AppMgr copies the apps to the card once; opening an app while it does is slower
  await page.click('[data-testid=apps-menu]');
  await page.waitForSelector('[data-testid=app-kodecity]');
  await page.click('[data-testid=app-kodecity]');
  const up = await until(async () => (await program())?.name === 'KodeCity', 90000, 200);
  check('KodeCity opens from the Apps menu', up >= 0, `${up} ms`);
  await page.keyboard.press('Escape');
  const drew = await until(async () => (await lit()) > 0.2, 60000, 200);
  check('the title screen is drawn', drew >= 0, `lit ${(await lit()).toFixed(2)}`);
  await sleep(2000);
  await page.screenshot({ path: join(shots, 'kodecity-1-title.png') });
  await press('t', 150); // the top button starts the game
  await sleep(5000);
  await page.mouse.move(5, 5);
  await page.keyboard.down('ArrowUp');
  await sleep(3500);
  const f1 = await fps();
  await page.screenshot({ path: join(shots, 'kodecity-2-driving-a.png') });
  await sleep(4000);
  const f2 = await fps();
  await page.keyboard.down('ArrowRight');
  await sleep(3000);
  await page.screenshot({ path: join(shots, 'kodecity-3-driving-b.png') });
  const f3 = await fps();
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowUp');
  const set = [f1, f2, f3];
  console.log(`status bar frames per second while driving: ${set.join(', ')}`);
  check('the page reports a playable frame rate', Math.min(...set) >= 15, set.join(', '));
  const g = await page.evaluate(() => {
    const d = window.__dotbench.painter.canvas.getContext('2d').getImageData(0, 0, 410, 502).data;
    const s = new Set();
    for (let i = 0; i < d.length; i += 4 * 11) s.add(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16));
    return s.size;
  });
  check('the city has many colours on the glass', g > 150, String(g));
  const t0 = Date.now();
  await page.keyboard.down('b');
  const home = await until(async () => (await program())?.kind === 'os', 30000, 100);
  await page.keyboard.up('b');
  check('holding the bottom button returns to kodeOS', home >= 0, `${Date.now() - t0} ms`);
  check('no console errors or page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill?.();
}
console.log(failed ? `${failed} FAILED` : 'all PASS');
process.exit(failed ? 1 : 0);
