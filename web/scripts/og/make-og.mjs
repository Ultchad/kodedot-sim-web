// Makes the link-preview picture (public/og.png, 1200 x 630).
//   npm run build && UX_PORT=4399 node scripts/og/make-og.mjs [--card-only]
// 1. scripts/og/og-scene.mjs stages the workbench (the Dot running kodeOS, a breadboard with an LED, an Arduino Uno
//    driving a servo) and writes screenshots/og-scene.png;
// 2. scripts/og/og.html lays the card out over that picture.
// When the picture changes, bump the ?v= number of og:image and twitter:image in index.html: chat apps cache by address.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..');
if (!process.argv.includes('--card-only')) {
  const r = spawnSync(process.execPath, [join(here, 'og-scene.mjs')], { stdio: 'inherit', cwd: web });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(here, 'og.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 400));
  const out = join(web, 'public', 'og.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log(`written ${out}`);
} finally {
  await browser.close();
}
