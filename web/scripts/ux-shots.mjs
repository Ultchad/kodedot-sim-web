// UX review screenshots. Usage: npm run build && node scripts/ux-shots.mjs <prefix> [viewportId ...]
// Writes web/screenshots/ux/<prefix>-<viewport>-<theme>-<lang>-<scene>.png for every scene of scripts/ux-scenes.mjs.
import { join } from 'node:path';
import { LANGS, THEMES, VIEWPORTS, launch, openPage, root, shot, sleep, startServer, waitRunning } from './ux-lib.mjs';
import { scenesFor } from './ux-scenes.mjs';

const [prefix = 'after', ...only] = process.argv.slice(2);
const dir = join(root, 'screenshots/ux');
const server = await startServer();
const browser = await launch();
const failures = [];
try {
  for (const vp of VIEWPORTS) {
    if (only.length && !only.includes(vp.id)) continue;
    // light + English: every scene. dark + the longest language (es): every scene. pt-BR light: the text-heavy ones.
    const combos = [
      { theme: 'light', lang: 'en', pick: () => true },
      { theme: 'dark', lang: 'es', pick: () => true },
      { theme: 'light', lang: 'pt-BR', pick: (s) => s.textHeavy },
    ];
    if (process.env.UX_QUICK) combos.length = 1; // light + English only, while iterating
    void LANGS;
    void THEMES;
    for (const combo of combos) {
      const { ctx, page, problems } = await openPage(browser, vp, { theme: combo.theme, lang: combo.lang });
      await waitRunning(page);
      await sleep(600);
      for (const scene of scenesFor(vp)) {
        if (!combo.pick(scene) || (scene.newUi && prefix === 'before')) continue;
        try {
          await scene.enter(page, vp);
          await sleep(scene.settle ?? 350);
          await shot(page, dir, `${prefix}-${vp.id}-${combo.theme}-${combo.lang}-${scene.id}`);
        } catch (e) {
          failures.push(`${vp.id} ${combo.theme} ${combo.lang} ${scene.id}: ${e.message}`);
        }
        try {
          await scene.leave?.(page, vp);
        } catch (e) {
          failures.push(`${vp.id} ${combo.theme} ${combo.lang} ${scene.id} (leave): ${e.message}`);
        }
      }
      if (problems.length) failures.push(`${vp.id} ${combo.theme} ${combo.lang}: ${problems.slice(0, 3).join(' | ')}`);
      await ctx.close();
      console.log(`shots ${prefix} ${vp.id} ${combo.theme} ${combo.lang}`);
    }
  }
  // unsupported browser (not cross-origin isolated)
  for (const vp of VIEWPORTS.filter((v) => ['1440x900', '390x844'].includes(v.id) && (!only.length || only.includes(v.id)))) {
    const { ctx, page } = await openPage(browser, vp, { isolate: false, view: '2d', zoom: 'fit' });
    await page.waitForSelector('[data-testid=device-unsupported]', { timeout: 20000 }).catch(() => {});
    await sleep(500);
    await shot(page, dir, `${prefix}-${vp.id}-light-en-unsupported`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (failures.length) console.log(`\n${failures.length} scene problems:\n` + failures.join('\n'));
