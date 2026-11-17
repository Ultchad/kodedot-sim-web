// The guide, through the real page in headless Chrome.
//   npm run build && node scripts/guide-check.mjs [--no-shots] [--only desk,tablet,phone,land,links,live]
//
// What it proves (exit code 1 on any failure):
//   - one labelled control opens the guide on every layout (top bar; phone: on the panel's edge, in landscape in the stage's corner);
//   - a link with #guide/<section> opens that section directly, an unknown section opens the first one;
//   - focus goes into the guide, Tab stays in it, Escape closes it and focus returns to what opened it;
//   - what is typed in the guide does not reach the Dot's buttons or the table's shortcuts;
//   - every section shows its title and its content in English, Portuguese and Spanish, nothing runs off the dialog;
//   - the "How?" links of the page open the right sections;
//   - the Dot keeps running under the guide (its program and its frames go on), and closing returns to the same place.
// Screenshots: screenshots/guide/<viewport>-<theme>-<section>.png, looked at by a person before a release.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const SECTIONS = ['start', 'using-the-dot', 'apps', 'bench', 'workbench', 'sketches', 'your-own-app', 'your-own-parts', 'what-is-simulated', 'help'];
const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);
const noShots = argv.includes('--no-shots');
const shots = join(root, 'screenshots', 'guide');
mkdirSync(shots, { recursive: true });

const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const base = (hash = '') => `http://localhost:${PORT}/?debug&mode=device${hash}`;

const dialog = '[data-testid=guide-dialog]';
const sectionOf = (page) => page.$eval(dialog, (e) => e.dataset.section).catch(() => null);
const headingOf = (page) => page.$eval('[data-testid=guide-heading]', (e) => e.textContent).catch(() => null);
const focusIn = (page) => page.evaluate((sel) => !!document.activeElement?.closest(sel), dialog);
const waitOpen = (page) => page.waitForSelector(dialog, { timeout: 15000 });
const waitClosed = (page) => until(async () => !(await page.$(dialog)), 5000, 50);

/** Nothing of the dialog is cut off or wider than the viewport, and the text column does not scroll sideways. */
const fits = (page) =>
  page.evaluate((sel) => {
    const d = document.querySelector(sel);
    const r = d.getBoundingClientRect();
    const sc = document.querySelector('[data-testid=guide-scroll]');
    const wide = [...sc.querySelectorAll('.guide-prose > *')].filter((e) => e.getBoundingClientRect().right > sc.getBoundingClientRect().right + 1).map((e) => e.tagName + ':' + (e.className || ''));
    return { inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, sideways: sc.scrollWidth - sc.clientWidth, wide };
  }, dialog);

async function shoot(page, vp, theme, section) {
  if (noShots) return;
  await sleep(250);
  await page.screenshot({ path: join(shots, `${vp.id}-${theme}-${section}.png`) });
}

/** Walks every section through the guide's own navigation and looks at each. */
async function walk(page, vp, theme, lang, shotSections) {
  const bad = [];
  for (const id of SECTIONS) {
    if (vp.phone) await page.select('[data-testid=guide-select]', id);
    else await page.$eval(`[data-testid=guide-nav-${id}]`, (e) => e.click());
    await until(async () => (await sectionOf(page)) === id, 5000, 50);
    const info = await page.evaluate(() => {
      const art = document.querySelector('[data-testid=guide-section]');
      return { hash: location.hash, heading: document.querySelector('[data-testid=guide-heading]')?.textContent ?? '', chars: art?.textContent.length ?? 0, raw: /\{\w+\}|\*\*|\]\(/.test(art?.textContent ?? '') };
    });
    const f = await fits(page);
    if (info.hash !== `#guide/${id}` || !info.heading || info.chars < 200 || info.raw || !f.inside || f.sideways > 1 || f.wide.length) bad.push(`${id}: ${JSON.stringify({ ...info, ...f })}`);
    if (shotSections.includes(id)) await shoot(page, vp, theme, lang === 'en' ? id : `${id}-${lang}`);
  }
  return bad;
}

const VP = {
  desk: { id: '1440x900', w: 1440, h: 900 },
  tablet: { id: '820x1180', w: 820, h: 1180, touch: true, tablet: true },
  phone: { id: '390x844', w: 390, h: 844, touch: true, phone: true },
  land: { id: '844x390', w: 844, h: 390, touch: true, phone: true },
};

try {
  // ---- every layout, both themes: the entry control, opening, the sections (the stand-in device: no firmware needed for this)
  for (const key of ['desk', 'tablet', 'phone', 'land']) {
    if (!want(key)) continue;
    const vp = VP[key];
    for (const theme of ['light', 'dark']) {
      const { page, ctx, problems } = await openPage(browser, vp, { theme, mock: true, view: '2d', base: base() });
      await page.click('[data-testid=welcome-dismiss]').catch(() => {});
      const entry = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[data-testid=guide-open]')].filter((e) => e.getClientRects().length);
        const e = els[0];
        if (!e) return null;
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { count: els.length, text: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, reachable: !!top && (top === e || e.contains(top)) };
      });
      check(`${vp.id} ${theme}: one visible, labelled "Guide" control that can be pressed`, !!entry && entry.count === 1 && entry.text === 'Guide' && entry.inView && entry.reachable && entry.h >= (vp.touch ? 44 : 36), JSON.stringify(entry));
      if (!noShots) await page.screenshot({ path: join(shots, `${vp.id}-${theme}-closed.png`) });
      await page.click('[data-testid=guide-open]');
      await waitOpen(page);
      await sleep(300);
      check(`${vp.id} ${theme}: it opens on the first section, with focus on its title`, (await sectionOf(page)) === 'start' && (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'guide-heading' && (await page.evaluate(() => location.hash)) === '#guide/start');
      const bad = await walk(page, vp, theme, 'en', theme === 'light' ? SECTIONS : ['start', 'workbench', 'what-is-simulated']);
      check(`${vp.id} ${theme}: all ten sections show, linked by their own address, inside the dialog`, bad.length === 0, bad.join(' | '));
      await page.keyboard.press('Escape');
      const closed = await waitClosed(page);
      const back = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset.testid, inert: document.getElementById('root').hasAttribute('inert') }));
      check(`${vp.id} ${theme}: Escape closes it, the address is clean, focus is back on the control`, closed >= 0 && back.hash === '' && back.focus === 'guide-open' && !back.inert, JSON.stringify(back));
      check(`${vp.id} ${theme}: no page errors`, problems.length === 0, problems.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }

  // ---- links, keyboard, languages, the How? links (desktop, stand-in device)
  if (want('links')) {
    const vp = VP.desk;
    {
      const { page, ctx } = await openPage(browser, vp, { mock: true, view: '2d', base: base('#guide/your-own-app') });
      await waitOpen(page);
      await sleep(300);
      check('a pasted link #guide/your-own-app opens the guide on that section', (await sectionOf(page)) === 'your-own-app' && /app/i.test((await headingOf(page)) ?? ''), `${await sectionOf(page)} / ${await headingOf(page)}`);
      const cmds = await page.$$eval('.guide-code', (els) => els.map((e) => e.textContent).join('\n'));
      check('the build steps name the repository, the set-up script and the build command', /git clone https:\/\/github\.com\/murilogpapa\/kodedot-sim/.test(cmds) && /tools\/setup\.sh/.test(cmds) && /source \.dotbench-env/.test(cmds) && /tools\/dotbench sdk/.test(cmds) && /tools\/dotbench build /.test(cmds), cmds.replace(/\n/g, ' ; '));
      await page.click('[data-testid=guide-close]');
      await waitClosed(page);
      const after = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset.testid }));
      check('closing a guide that was opened by a link leaves a clean address and focus on the Guide control', after.hash === '' && after.focus === 'guide-open', JSON.stringify(after));
      // Back and Forward
      await page.click('[data-testid=guide-open]');
      await waitOpen(page);
      await page.$eval('[data-testid=guide-nav-bench]', (e) => e.click());
      await page.goBack();
      const closedByBack = await waitClosed(page);
      check('the browser\'s Back closes the guide (sections do not pile up in the history)', closedByBack >= 0 && (await page.evaluate(() => location.hash)) === '');
      await page.goForward();
      await waitOpen(page);
      check('Forward opens it again where it was', (await sectionOf(page)) === 'bench');
      await ctx.close();
    }
    {
      const { page, ctx } = await openPage(browser, vp, { mock: true, view: '2d', base: base('#guide/no-such-section') });
      await waitOpen(page);
      check('a link to a section that does not exist opens the first section', (await sectionOf(page)) === 'start');
      // Tab never leaves the dialog
      let inside = true;
      for (let i = 0; i < 40 && inside; i++) {
        await page.keyboard.press('Tab');
        inside = await focusIn(page);
      }
      for (let i = 0; i < 6 && inside; i++) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
        inside = await focusIn(page);
      }
      check('Tab and Shift+Tab stay inside the guide', inside);
      // keys typed in the guide do not press the Dot's buttons
      const pressed = await page.evaluate(async () => {
        const seen = [];
        const input = window.__dotbench.input;
        const orig = input.press.bind(input);
        input.press = (id, src) => (seen.push(id), orig(id, src));
        document.querySelector('[data-testid=guide-heading]').focus();
        for (const key of ['b', 't', 'ArrowUp', 'Delete', 'w']) {
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
          document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
        }
        input.press = orig;
        return seen;
      });
      check('B, T and the arrows typed in the guide do not press the Dot\'s buttons', pressed.length === 0, pressed.join(','));
      await page.keyboard.press('Escape');
      await waitClosed(page);
      const live = await page.evaluate(async () => {
        const seen = [];
        const input = window.__dotbench.input;
        const orig = input.press.bind(input);
        input.press = (id, src) => (seen.push(id), orig(id, src));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'b', bubbles: true }));
        input.press = orig;
        return seen;
      });
      check('with the guide closed, B presses the bottom button again', live.join(',') === 'bottom', live.join(','));
      await ctx.close();
    }
    for (const lang of ['pt-BR', 'es']) {
      const { page, ctx, problems } = await openPage(browser, vp, { mock: true, view: '2d', lang, base: base('#guide/start') });
      await waitOpen(page);
      await sleep(300);
      const label = await page.$eval('[data-testid=guide-open]', (e) => e.textContent.trim());
      const titles = await page.$$eval('[data-testid=guide-nav] a', (els) => els.map((e) => e.textContent.replace(/^\d+/, '').trim()));
      const bad = await walk(page, vp, 'light', lang, ['start', 'your-own-app', 'what-is-simulated']);
      const english = ['What this is', 'Using the Dot', 'The bench', 'The workbench', 'Writing sketches', 'Problems and questions'];
      check(`${lang}: the control, the section list and every section are in that language`, label !== 'Guide' && titles.length === 10 && !titles.some((x) => english.includes(x)) && bad.length === 0, `${label} | ${titles.join(', ')} | ${bad.join(' | ')}`);
      check(`${lang}: no page errors`, problems.length === 0, problems.slice(0, 3).join(' | '));
      await ctx.close();
    }
    {
      // the How? links of the page
      const { page, ctx } = await openPage(browser, vp, { mock: false, view: '2d', base: base() });
      const tryHow = async (name, open, how, expect) => {
        await open();
        await page.waitForSelector(how, { timeout: 15000 });
        await page.$eval(how, (e) => e.click());
        await waitOpen(page);
        const got = await sectionOf(page);
        await page.keyboard.press('Escape');
        await waitClosed(page);
        check(`How? ${name} opens "${expect}"`, got === expect, String(got));
      };
      await tryHow('beside "Install" in Apps', () => page.click('[data-testid=apps-menu]'), '[data-testid=apps-popover] [data-testid=guide-how-your-own-app]', 'your-own-app');
      check('closing it returns to the Apps menu, still open', !!(await page.$('[data-testid=apps-popover]')) && (await page.evaluate(() => document.activeElement?.dataset.testid)) === 'guide-how-your-own-app');
      await page.keyboard.press('Escape');
      await tryHow('in the Bench panel', () => page.$eval('[data-testid=left-tab-bench]', (e) => e.click()), '[data-testid=left-panel] [data-testid=guide-how-bench]', 'bench');
      await tryHow('in the Components panel', () => page.$eval('[data-testid=left-tab-components]', (e) => e.click()), '[data-testid=left-panel] [data-testid=guide-how-workbench]', 'workbench');
      await tryHow('in the Make panel', () => page.$eval('[data-testid=left-tab-make]', (e) => e.click()), '[data-testid=left-panel] [data-testid=guide-how-your-own-parts]', 'your-own-parts');
      await ctx.close();
    }
  }

  // ---- the real Dot keeps running under the guide
  if (want('live')) {
    const { page, ctx, problems } = await openPage(browser, VP.desk, { view: '2d', base: base() });
    const up = await waitRunning(page, 150000);
    check('kodeOS is running', up >= 0);
    const D = (fn, ...a) => page.evaluate(fn, ...a);
    const frame = () => D(() => window.__dotbench.device().getFrame().seq);
    const program = () => D(() => window.__dotbench.device().program.get()?.name);
    const before = { program: await program(), seq: await frame() };
    await page.click('[data-testid=guide-open]');
    await waitOpen(page);
    // something on the Dot's screen moves on its own: the console command redraws it
    await D(() => window.__dotbench.device().sendConsole('gui_info'));
    await sleep(4000);
    const during = { program: await program(), status: await D(() => window.__dotbench.device().status.get()), seq: await frame(), log: await D(() => window.__dotbench.device().log.get().length) };
    await sleep(1500);
    const log2 = await D(() => window.__dotbench.device().log.get().length);
    check('with the guide open the Dot is still running the same program and still answers', during.status === 'running' && during.program === before.program && log2 >= during.log && during.log > 0, JSON.stringify({ before, during, log2 }));
    await shoot(page, VP.desk, 'light', 'over-the-running-dot');
    await page.keyboard.press('Escape');
    await waitClosed(page);
    check('closing returns to the page as it was: same program, no reload', (await program()) === before.program && (await D(() => performance.getEntriesByType('navigation').length)) === 1);
    check('no page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) {
  failed++;
  console.log('FAIL  the check itself stopped:', e.stack ?? e.message);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
