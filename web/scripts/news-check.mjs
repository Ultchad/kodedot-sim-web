// The "What's new" card in a real page (headless Chrome over `vite preview` of dist/): when it shows, how it closes,
// and screenshots at the review sizes in web/screenshots/news/. Run `npm run build` first.
//   usage: UX_PORT=4471 node scripts/news-check.mjs [--extra-only]     --extra-only: just the "several missed" shots (a build with 2+ entries)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, PORT, launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const out = join(root, 'screenshots', 'news');
mkdirSync(out, { recursive: true });
const DESK = { id: '1440x900', w: 1440, h: 900 };
const PHONE = { id: '390x844', w: 390, h: 844, touch: true, phone: true };
const CARD = '[data-testid=whats-new]';
const RETURNING = { 'dotbench.welcomed': true, 'dotbench.news.seen': '2026-01-01' };
const seen = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dotbench.news.seen') ?? 'null'));
const shown = (page) => page.$(CARD).then((e) => !!e);
const appears = (page) => until(() => shown(page), 15000);
const EXTRA_ONLY = process.argv.includes('--extra-only');
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const server = await startServer();
const browser = await launch();
try {
  // ---- returning visitor: the card comes by itself, at both sizes and themes
  for (const vp of EXTRA_ONLY ? [] : [DESK, PHONE]) {
    for (const theme of ['light', 'dark']) {
      const { ctx, page, problems } = await openPage(browser, vp, { theme, prefs: RETURNING });
      const early = await shown(page); // the page is still loading here
      await waitRunning(page);
      check(!early && (await appears(page)) >= 0, `${vp.id} ${theme}: the card appears after the page settled`);
      await sleep(500);
      await page.screenshot({ path: join(out, `card-${vp.id}-${theme}.png`) });
      const box = await page.$eval(CARD, (e) => {
        const r = e.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, scrolls: e.querySelector('div.overflow-y-auto').scrollHeight > e.querySelector('div.overflow-y-auto').clientHeight + 1 };
      });
      check(box.l >= 0 && box.t >= 0 && box.r <= box.vw && box.b <= box.vh && !box.scrolls, `${vp.id} ${theme}: it fits the viewport without scrolling`);
      check(problems.length === 0, `${vp.id} ${theme}: no page errors ${problems.join(' | ')}`);
      if (vp === DESK && theme === 'light') {
        const a11y = await page.$eval(CARD, (e) => ({ role: e.getAttribute('role'), modal: e.getAttribute('aria-modal'), name: document.getElementById(e.getAttribute('aria-labelledby'))?.textContent, focused: document.activeElement === e }));
        check(a11y.role === 'dialog' && a11y.modal === 'false' && !!a11y.name && a11y.focused, `a labelled, non-modal dialog that takes focus (${JSON.stringify(a11y)})`);
        check((await page.evaluate(() => window.__dotbench.device().status.get())) === 'running', 'the Dot keeps running under it');
        check((await seen(page)) === '2026-01-01', 'not recorded as seen while it is only showing');
        await page.keyboard.press('Tab');
        check(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'whats-new-close'), 'Tab reaches its first control');
        await page.keyboard.press('Escape');
        await sleep(200);
        const id = await seen(page);
        check(!(await shown(page)) && typeof id === 'string' && id > '2026-01-01', `Escape closes it and records ${id}`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__dotbench);
        await waitRunning(page);
        await sleep(4000);
        check(!(await shown(page)), 'it does not come back on the next visit');
        // on demand, from Details
        await page.click('[data-testid=status-details-toggle]');
        await page.click('[data-testid=whats-new-open]');
        check((await appears(page)) >= 0 && !(await page.$('[data-testid=status-details]')), 'Details > "What\'s new" reopens it (and the popover closes)');
        await sleep(400);
        await page.screenshot({ path: join(out, 'card-reopened-1440x900-light.png') });
        await page.mouse.click(700, 450); // anywhere outside
        await sleep(200);
        check(!(await shown(page)), 'a press outside closes it');
        await page.click('[data-testid=status-details-toggle]');
        await page.click('[data-testid=whats-new-open]');
        await appears(page);
        await page.click('[data-testid=whats-new-dismiss]');
        await sleep(200);
        check(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'status-details-toggle'), 'closing hands focus back to the Details button');
      }
      if (vp === PHONE && theme === 'light') {
        await page.tap('[data-testid=whats-new-dismiss]');
        await sleep(200);
        check(!(await shown(page)) && (await seen(page)) > '2026-01-01', 'phone: "Got it" closes it and records it');
      }
      await ctx.close();
    }
  }

  // ---- other languages (the dark desktop card, in pt-BR and es)
  for (const lang of EXTRA_ONLY ? [] : ['pt-BR', 'es']) {
    const { ctx, page } = await openPage(browser, DESK, { lang, prefs: RETURNING });
    await waitRunning(page);
    check((await appears(page)) >= 0, `${lang}: the card appears`);
    await sleep(500);
    const card = await page.$(CARD);
    await card.screenshot({ path: join(out, `card-only-${lang}.png`) });
    await ctx.close();
  }

  // ---- first visit: the welcome, not this card
  if (!EXTRA_ONLY) {
    const { ctx, page } = await openPage(browser, DESK, {});
    await waitRunning(page);
    await sleep(4500);
    const id = await seen(page);
    check(!(await shown(page)) && !!(await page.$('[data-testid=welcome]')), 'first visit: the welcome shows, the card does not');
    check(typeof id === 'string', `first visit: the newest entry is already recorded (${id})`);
    await page.click('[data-testid=welcome-dismiss]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__dotbench);
    await waitRunning(page);
    await sleep(4500);
    check(!(await shown(page)), 'second visit of a new visitor: still no card');
    await ctx.close();
  }

  // ---- arrived through a #guide link: never over the guide; after the guide is closed it may come
  if (!EXTRA_ONLY) {
    const { ctx, page } = await openPage(browser, DESK, { prefs: RETURNING, base: `${BASE}#guide/bench` });
    await waitRunning(page);
    await sleep(4500);
    check(!(await shown(page)) && (await seen(page)) === '2026-01-01', 'guide link: no card over the guide, and it is not counted as seen');
    await page.screenshot({ path: join(out, 'guide-link-1440x900.png') });
    await page.keyboard.press('Escape'); // closes the guide
    check((await appears(page)) >= 0, 'guide link: the card comes once the guide is closed');
    await ctx.close();
  }

  // ---- several missed (only with 2+ entries in the build)
  if (EXTRA_ONLY) {
    for (const vp of [DESK, PHONE]) {
      const { ctx, page } = await openPage(browser, vp, { theme: vp === PHONE ? 'dark' : 'light', prefs: RETURNING });
      await waitRunning(page);
      await appears(page);
      await sleep(500);
      check(!!(await page.$('[data-testid=whats-new-earlier]')), `${vp.id}: the "also earlier" list shows`);
      await page.screenshot({ path: join(out, `card-missed-several-${vp.id}.png`) });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} check(s) FAILED` : `all checks passed (port ${PORT})`);
process.exit(failed ? 1 : 0);
