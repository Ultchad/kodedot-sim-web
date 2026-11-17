// Renders ONE Bench3D model on the model stand (src/bench3d/harness), without the rest of the page.
//   node scripts/model-shot.mjs --model <id> [--state <name|json>] [--detail 0.5] [--out <dir>] [--size 900x700]
//   node scripts/model-shot.mjs --all            every model, one after the other
//   node scripts/model-shot.mjs --list           the ids
// Writes web/screenshots/models/<id>/{front,back,side,low,top}.png (top = drawing with terminals and a millimetre
// scale) and state-<name>.png for each example state of the model, prints the triangle count against the budget and
// what the contract check found. Exit code 1 when a model breaks the contract.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startStand(port = Number(process.env.STAND_PORT ?? 4396)) {
  const server = await createServer({
    configFile: false,
    root: join(root, 'src', 'bench3d', 'harness'),
    publicDir: join(root, 'public'),
    server: { port, strictPort: true, hmr: false, fs: { allow: [join(root, '..')] } }, // the repository: models may import parts/<id>/manifest.json
    logLevel: 'error',
  });
  await server.listen();
  return { base: `http://localhost:${port}`, close: () => server.close() };
}

export const launch = () =>
  puppeteer.launch({
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });

/** Opens the stand on a model and waits until it has drawn with the page's fonts. */
export async function openModel(browser, base, id, o = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: o.w ?? 900, height: o.h ?? 700, deviceScaleFactor: o.dpr ?? 1 });
  const params = new URLSearchParams({ model: id, view: o.view ?? 'front' });
  if (o.state) params.set('state', o.state);
  if (o.detail) params.set('detail', String(o.detail));
  if (o.bare) params.set('bare', '1');
  if (o.t !== undefined) params.set('t', String(o.t));
  await page.goto(`${base}/?${params}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__model, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(350);
  return { page, errors };
}

async function shootModel(browser, base, id, o) {
  const dir = o.out ?? join(root, 'screenshots', 'models', id);
  mkdirSync(dir, { recursive: true });
  const { page, errors } = await openModel(browser, base, id, { state: o.state, detail: o.detail, w: o.w, h: o.h });
  const report = await page.evaluate(() => window.__model.report());
  for (const view of await page.evaluate(() => window.__model.views())) {
    await page.evaluate((v) => window.__model.setView(v), view);
    await sleep(250);
    writeFileSync(join(dir, `${view}.png`), await page.screenshot({ type: 'png' }));
  }
  await page.evaluate(() => window.__model.setView('front'));
  for (const name of report.states ?? []) {
    await page.evaluate((s) => window.__model.setState(s), name);
    await sleep(450);
    writeFileSync(join(dir, `state-${name}.png`), await page.screenshot({ type: 'png' }));
  }
  const ms = await page.evaluate(() => window.__model.bench(20));
  await page.close();
  const problems = [...(report.problems ?? []), ...errors.map((e) => `page error: ${e}`)];
  const ok = problems.length === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}  ${report.triangles} triangles (budget ${report.budget}), ${report.drawCalls} meshes, ${report.terminals ?? 0} terminals, ${ms.toFixed(1)} ms/frame here  ->  ${dir}`);
  for (const p of problems) console.log(`     ${p}`);
  return ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [w, h] = (arg('--size') ?? '900x700').split('x').map(Number);
  const stand = await startStand();
  const browser = await launch();
  let ok = true;
  try {
    const probe = await browser.newPage();
    await probe.goto(`${stand.base}/?bare=1`, { waitUntil: 'domcontentloaded' });
    await probe.waitForFunction(() => !!window.__model, { timeout: 60000 });
    const ids = await probe.evaluate(() => window.__model.ids());
    await probe.close();
    if (args.includes('--list')) console.log(ids.join('\n'));
    else {
      const wanted = args.includes('--all') ? ids : [arg('--model')];
      if (!wanted[0]) {
        console.error('usage: node scripts/model-shot.mjs --model <id> [--state <name|json>] | --all | --list');
        ok = false;
      } else if (!args.includes('--all') && !ids.includes(wanted[0])) {
        console.error(`no model "${wanted[0]}". Models: ${ids.join(', ')}`);
        ok = false;
      } else for (const id of wanted) ok = (await shootModel(browser, stand.base, id, { state: arg('--state'), detail: arg('--detail'), out: arg('--out'), w, h })) && ok;
    }
  } finally {
    await browser.close();
    await stand.close();
  }
  process.exit(ok ? 0 : 1);
}
