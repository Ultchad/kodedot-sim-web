// Renders every library part's 3D model once into a small picture for its card in the library panel.
//   node scripts/part-thumbs.mjs [--only <text in the id>] [--size 128] [--keep-going]
// Uses the model stand (src/bench3d/harness) in its thumb=1 mode (no table, no shadow, transparent background, framed on
// the model's real geometry, three-quarter view from above, the stand's own studio light) through model-shot.mjs's
// helpers. One browser, one model after the other. Writes web/public/parts-thumbs/<part id>.webp (128 x 128, shown at
// 64 x 64 CSS px; lossy WebP with alpha) and index.json. The pictures are COMMITTED: the site's build never renders.
// A library part with no model but a picture.svg in its folder gets that picture copied as <id>.svg; any other part is
// listed under "fallback" and keeps the generic icon in the page. Parts the visitor imports (.dotpart) are never here.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openModel, root, startStand } from './model-shot.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const size = Number(arg('--size', 128));
const only = arg('--only', '');
const out = join(root, 'public', 'parts-thumbs');
const repo = join(root, '..');
const library = JSON.parse(readFileSync(join(repo, 'parts', 'prebuilt', 'library.json'), 'utf8')).parts;
mkdirSync(out, { recursive: true });
const indexFile = join(out, 'index.json');
const old = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { thumbs: {}, fallback: [] };

const stand = await startStand();
const browser = await launch();
const thumbs = only ? { ...old.thumbs } : {};
const fallback = [];
let failed = 0;
try {
  const probe = await browser.newPage();
  await probe.goto(`${stand.base}/?bare=1`, { waitUntil: 'domcontentloaded' });
  await probe.waitForFunction(() => !!window.__model, { timeout: 60000 });
  const models = new Set(await probe.evaluate(() => window.__model.ids()));
  await probe.close();
  for (const p of library) {
    if (only && !p.id.includes(only)) continue;
    delete thumbs[p.id];
    if (models.has(p.id)) {
      const { page, errors } = await openModel(browser, stand.base, p.id, { w: size * 4, h: size * 4, bare: true, thumb: true, t: 1 });
      await new Promise((r) => setTimeout(r, 400));
      const url = await page.evaluate((s) => window.__model.snap(s), size);
      await page.close();
      const png = Buffer.from(url.split(',')[1], 'base64');
      if (!url.startsWith('data:image/webp') || errors.length) {
        console.log(`FAIL ${p.id} ${errors.join('; ') || 'not webp'}`);
        failed++;
        continue;
      }
      writeFileSync(join(out, `${p.id}.webp`), png);
      thumbs[p.id] = `${p.id}.webp`;
      console.log(`ok   ${p.id}  ${png.length} B`);
      continue;
    }
    const svg = join(repo, 'parts', p.folder ?? p.id.replace(/^dotbench\./, ''), 'picture.svg');
    if (existsSync(svg)) {
      copyFileSync(svg, join(out, `${p.id}.svg`));
      thumbs[p.id] = `${p.id}.svg`;
      console.log(`svg  ${p.id}`);
    } else fallback.push(p.id);
  }
} finally {
  await browser.close();
  await stand.close();
}
const kept = only ? old.fallback.filter((id) => !library.some((p) => p.id === id && p.id.includes(only))) : [];
const index = { size, cssSize: size / 2, format: 'webp', thumbs: Object.fromEntries(Object.entries(thumbs).sort()), fallback: [...kept, ...fallback].sort() };
writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);
for (const f of readdirSync(out)) if (f !== 'index.json' && !Object.values(index.thumbs).includes(f)) rmSync(join(out, f)); // stale pictures
const bytes = readdirSync(out).reduce((n, f) => n + readFileSync(join(out, f)).length, 0);
console.log(`${Object.keys(index.thumbs).length} pictures, ${index.fallback.length} fallback, ${bytes} B in ${out}`);
process.exit(failed ? 1 : 0);
