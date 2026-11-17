// A contact sheet of every Bench3D model: web/screenshots/models/_gallery.png (and _gallery.html beside it).
//   node scripts/model-gallery.mjs [--filter <text in the id>] [--cols 4]
// Each tile is the model stand's front view with the model's id, size and triangle count.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openModel, root, startStand } from './model-shot.mjs';

const args = process.argv.slice(2);
const arg = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const cols = Number(arg('--cols', 4));
const filter = arg('--filter', '');
const out = join(root, 'screenshots', 'models');
mkdirSync(out, { recursive: true });

const stand = await startStand();
const browser = await launch();
let bad = 0;
try {
  const probe = await browser.newPage();
  await probe.goto(`${stand.base}/?bare=1`, { waitUntil: 'domcontentloaded' });
  await probe.waitForFunction(() => !!window.__model, { timeout: 60000 });
  const ids = (await probe.evaluate(() => window.__model.ids())).filter((id) => id.includes(filter)).sort();
  await probe.close();
  const tiles = [];
  for (const id of ids) {
    const { page } = await openModel(browser, stand.base, id, { w: 420, h: 330, bare: true });
    const r = await page.evaluate(() => window.__model.report());
    const png = await page.screenshot({ type: 'png' });
    await page.close();
    if (r.problems.length) bad++;
    tiles.push({ id, title: r.title, tri: r.triangles, budget: r.budget, f: r.footprintMm, problems: r.problems, img: `data:image/png;base64,${Buffer.from(png).toString('base64')}` });
    console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${id}`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Bench3D models</title>
<style>body{margin:0;padding:18px;background:#c2bab3;font:600 13px system-ui,sans-serif;color:#191919}
.grid{display:grid;grid-template-columns:repeat(${cols},420px);gap:14px}
figure{margin:0;background:#ded7cd;border-radius:22px;overflow:hidden}
img{display:block;width:420px;height:330px}
figcaption{padding:9px 14px 12px;display:flex;flex-direction:column;gap:2px}
b{font-size:16px} .m{font-weight:500;color:#4a4742} .bad{color:#a3232f}</style>
<div class="grid">${tiles
    .map((t) => `<figure><img src="${t.img}"><figcaption><b>${t.title}</b><span class="m">${t.id} · ${t.f.w} x ${t.f.d} x ${t.f.h} mm · ${t.tri} / ${t.budget} triangles</span>${t.problems.map((p) => `<span class="bad">${p}</span>`).join('')}</figcaption></figure>`)
    .join('')}</div>`;
  writeFileSync(join(out, '_gallery.html'), html);
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: cols * 434 + 22, height: 600 });
  await sheet.setContent(html, { waitUntil: 'load' });
  writeFileSync(join(out, '_gallery.png'), await sheet.screenshot({ type: 'png', fullPage: true }));
  console.log(`${tiles.length} models -> ${join(out, '_gallery.png')}`);
} finally {
  await browser.close();
  await stand.close();
}
process.exit(bad ? 1 : 0);
