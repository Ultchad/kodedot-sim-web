// Quick smoke of the built page: kodeOS boots to its lock screen in the 2D and the 3D view, without page errors.
//   npm run build && node scripts/smoke.mjs [out-dir]
// Writes smoke-2d.png and smoke-3d.png (default: screenshots/). Exit code 1 on any failure.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const out = process.argv[2] ?? join(root, 'screenshots');
mkdirSync(out, { recursive: true });
const server = await startServer();
const browser = await launch();
let failed = false;
const say = (ok, text) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
};
try {
  for (const view of ['2d', '3d']) {
    const { ctx, page, problems } = await openPage(browser, { id: '1280x720', w: 1280, h: 720 }, { view });
    const ms = await waitRunning(page, 60000);
    const app = await page.evaluate(() => window.__dotbench.device().appName.get?.() ?? window.__dotbench.device().appName);
    say(ms >= 0, `${view}: running "${app}" after ${ms} ms`);
    say(/kodeos/i.test(String(app)), `${view}: the program is kodeOS (${app})`);
    // the lock screen draws a clock: wait until the picture has settled on something with many colours
    const settled = await until(
      () =>
        page.evaluate(() => {
          const c = window.__dotbench.painter.canvas;
          const d = c.getContext('2d').getImageData(0, 0, 410, 502).data;
          const set = new Set();
          for (let i = 0; i < d.length; i += 4 * 7) set.add(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16));
          return set.size > 20;
        }),
      30000,
    );
    say(settled >= 0, `${view}: the screen shows a picture`);
    if (view === '3d') {
      const drawn = await until(() => page.evaluate(() => (window.__dotbench3d?.rendered() ?? 0) > 2 && window.__dotbench3d.info().model !== 'pending'), 30000);
      const info = await page.evaluate(() => window.__dotbench3d?.info());
      say(drawn >= 0, `3d: drawn, model "${info?.model}", ${info?.triangles} triangles, ${info?.calls} draw calls`);
    }
    await sleep(1200);
    await page.screenshot({ path: join(out, `smoke-${view}.png`) });
    say(problems.length === 0, `${view}: no page errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
