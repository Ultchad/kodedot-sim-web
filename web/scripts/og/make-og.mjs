// Makes the link-preview picture.
//   npm run build && node scripts/og/make-og.mjs
// 1. screenshots/og-device.png: the 3D device (the bundled Kode model) with kodeOS's lock screen on its display,
//    three-quarter view, on the page colour #C2BAB3, 1200 x 1260 px (600 x 630 at 2x);
// 2. public/og.png: scripts/og/og.html with that picture, 1200 x 630.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, openPage, root, sleep, startServer, until, waitRunning } from '../ux-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const server = await startServer();
const browser = await launch();
try {
  const { page, problems } = await openPage(browser, { id: 'og', w: 1200, h: 630 }, { view: '3d', dpr: 2, prefs: { 'dotbench.welcomed': true } });
  if ((await waitRunning(page, 60000)) < 0) throw new Error('kodeOS did not start');
  await page.waitForFunction(() => window.__dotbench3d && window.__dotbench3d.info().model !== 'pending', { timeout: 30000 });
  const model = await page.evaluate(() => window.__dotbench3d.info().model);
  if (model !== 'kode') throw new Error(`the bundled Kode model is not on show (${model})`);
  // the lock screen: wait for the clock and the wallpaper (many colours), then let the first animation settle
  await until(() => page.evaluate(() => {
    const d = window.__dotbench.painter.canvas.getContext('2d').getImageData(0, 0, 410, 502).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 28) set.add(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16));
    return set.size > 20;
  }), 30000);
  await sleep(2500);
  // the stage alone, full frame, on the page colour (through the CSSOM: the page's CSP forbids injected style sheets)
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=device-3d]');
    const set = (k, v) => el.style.setProperty(k, v, 'important');
    set('position', 'fixed'); set('inset', '0'); set('z-index', '2147483647'); set('background', '#C2BAB3'); set('width', '100vw'); set('height', '100vh');
  });
  await sleep(400);
  await page.evaluate(() => {
    window.__dotbench3d.setPoseDebug({ pitch: -4, roll: 30, heading: -2 });
    window.__dotbench3d.setViewDebug({ elevationDeg: 7, zoom: 0.9, offsetY: 0.02 });
  });
  await sleep(1500);
  const file = join(root, 'screenshots', 'og-device.png');
  writeFileSync(file, await page.screenshot({ type: 'png', clip: { x: 300, y: 0, width: 600, height: 630 } }));
  console.log(`written ${file} (model: ${model}${problems.length ? `; page problems: ${problems.join(' | ')}` : ''})`);

  const card = await browser.newPage();
  await card.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await card.goto(pathToFileURL(join(here, 'og.html')).href, { waitUntil: 'load' });
  await card.evaluate(() => document.fonts.ready);
  await sleep(300);
  const og = join(root, 'public', 'og.png');
  writeFileSync(og, await card.screenshot({ type: 'png' }));
  console.log(`written ${og}`);
} finally {
  await browser.close();
  server.kill();
}
