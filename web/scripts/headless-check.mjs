// Headless Chrome verification of the built page. Usage: npm run build && node scripts/headless-check.mjs
// Starts `vite preview`, drives the page with puppeteer-core, writes screenshots to web/screenshots/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 4173;
const BASE = `http://localhost:${PORT}/?debug`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('preview server did not start');
}

const consoleProblems = [];
function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleProblems.push(`[${tag}] console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => consoleProblems.push(`[${tag}] requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) consoleProblems.push(`[${tag}] http ${r.status()}: ${r.url()}`);
  });
}

const logText = (page) => page.evaluate(() => window.__dotbench.device().log.get().map((l) => l.text).join('\n'));
const ledColor = (page) => page.$eval('[data-testid=led]', (e) => e.dataset.color);
const lastTouch = async (page) => {
  const t = await logText(page);
  const m = [...t.matchAll(/touch down at \((\d+), (\d+)\)/g)].pop();
  return m ? { x: +m[1], y: +m[2] } : null;
};
async function glassRect(page) {
  return page.$eval('[data-testid=glass]', (e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}
const sig = (page, clip) => page.screenshot({ clip, encoding: 'base64' });

// Find horizontal overflow offenders (elements whose content is wider than the box and not scrollable/ellipsized).
async function overflowOffenders(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw) out.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('[inert]') || el.closest('[aria-hidden=true]')) continue;
      if (el.closest('[data-testid=sheet]') && el.closest('[data-testid=sheet]').dataset.open === 'false') continue;
      const clipped = el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.clientWidth > 0 && !(el instanceof SVGElement) && cs.overflowX !== 'visible';
      const textSpill = cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && el.children.length === 0 && !(el instanceof SVGElement) && cs.display !== 'inline';
      if (clipped || textSpill) out.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? '[' + el.dataset.testid + ']' : ''} "${(el.textContent || '').trim().slice(0, 30)}" scroll ${el.scrollWidth} > client ${el.clientWidth}`);
    }
    return out;
  });
}

let browser;
try {
  await waitServer();
  browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });

  // ================= A. desktop 1440x900, dark, 3D (default) =================
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(() => localStorage.getItem('dotbench.lang') ?? localStorage.setItem('dotbench.lang', '"en"'));
    const resp = await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=webgl-canvas]', { timeout: 15000 }).catch(() => {});
    await sleep(1500);

    const h = resp.headers();
    check('COOP header on served build', h['cross-origin-opener-policy'] === 'same-origin', h['cross-origin-opener-policy']);
    check('COEP header on served build', h['cross-origin-embedder-policy'] === 'require-corp', h['cross-origin-embedder-policy']);
    check('crossOriginIsolated is true', await page.evaluate(() => crossOriginIsolated === true));
    check('status bar shows isolated=yes', (await page.$eval('[data-testid=status-isolated]', (e) => e.dataset.value)) === 'true');
    check('3D is the default view and a WebGL context exists', await page.evaluate(() => {
      const c = document.querySelector('[data-testid=webgl-canvas]');
      const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
      return !!gl && !gl.isContextLost();
    }));

    // screen texture updates
    const v0 = await page.evaluate(() => window.__dotbench3d.textureVersion());
    const f0 = await page.evaluate(() => window.__dotbench3d.rendered());
    const g0 = await page.evaluate(() => window.__dotbench3d.project('glass:205,251'));
    const clip = { x: Math.max(0, g0.x - 120), y: Math.max(0, g0.y - 150), width: 240, height: 300 };
    const sA = await sig(page, clip);
    await sleep(900);
    const sB = await sig(page, clip);
    const v1 = await page.evaluate(() => window.__dotbench3d.textureVersion());
    const f1 = await page.evaluate(() => window.__dotbench3d.rendered());
    check('3D screen texture updates over time', v1 > v0 + 5, `texture.version ${v0} -> ${v1}`);
    check('3D scene re-renders as frames arrive', f1 > f0 + 5, `gl frames ${f0} -> ${f1}`);
    check('3D canvas pixels change over time', sA !== sB);
    const fps = Number(await page.$eval('[data-testid=status-fps]', (e) => e.textContent));
    check('status bar fps > 0', fps > 0, `fps=${fps}`);

    await page.screenshot({ path: join(shots, '3d-dark-1440x900.png') });

    // click on the top button mesh -> LED
    const led0 = await ledColor(page);
    const top = await page.evaluate(() => window.__dotbench3d.project('top'));
    await page.mouse.click(top.x, top.y);
    await sleep(250);
    const led1 = await ledColor(page);
    check('3D: click on the top button mesh changes the LED', led1 !== led0, `${led0} -> ${led1}`);
    await page.mouse.click(top.x, top.y);
    await sleep(250);
    const led2 = await ledColor(page);
    check('3D: second click cycles the LED colour again', led2 !== led1, `${led1} -> ${led2}`);
    // keyboard T
    await page.keyboard.press('t');
    await sleep(250);
    const led3 = await ledColor(page);
    check('keyboard T changes the LED', led3 !== led2, `${led2} -> ${led3}`);
    // bottom mesh -> haptic
    const bot = await page.evaluate(() => window.__dotbench3d.project('bottom'));
    await page.mouse.click(bot.x, bot.y);
    check('3D: bottom button mesh press reaches the device', /button bottom pressed/.test(await logText(page)));

    // d-pad
    const dl = await page.evaluate(() => window.__dotbench3d.project('dpad:left'));
    await page.mouse.click(dl.x, dl.y);
    check('3D: d-pad left mesh press reaches the device', /button left pressed/.test(await logText(page)));

    // glass clicks: touch coordinates within 2px
    for (const [sx, sy] of [[100, 200], [330, 420], [60, 60]]) {
      const p = await page.evaluate(([x, y]) => window.__dotbench3d.project(`glass:${x},${y}`), [sx, sy]);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(80);
      const t = await lastTouch(page);
      await page.mouse.up();
      check(`3D: glass click at screen (${sx},${sy}) maps within 2px`, t && Math.abs(t.x - sx) <= 2 && Math.abs(t.y - sy) <= 2, JSON.stringify(t));
    }
    // glass drag does not orbit
    const poseBefore = await page.evaluate(() => window.__dotbench3d.pose());
    const gp = await page.evaluate(() => window.__dotbench3d.project('glass:205,251'));
    await page.mouse.move(gp.x, gp.y);
    await page.mouse.down();
    await page.mouse.move(gp.x + 80, gp.y + 40, { steps: 6 });
    await page.mouse.up();
    const poseAfter = await page.evaluate(() => window.__dotbench3d.pose());
    check('3D: dragging on the glass does not orbit', Math.abs(poseAfter.roll - poseBefore.roll) < 0.5 && Math.abs(poseAfter.pitch - poseBefore.pitch) < 0.5);

    // Movimento object: add, shake
    await page.click('[data-testid="add-motion.pose"]');
    await sleep(200);
    await page.click('[data-testid=action-shake]');
    await sleep(200);
    check('Movimento: shake button reaches the device', /motion: shake/.test(await logText(page)));
    await page.$eval('[data-testid=field-roll]', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '40');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    const mockPose = await page.evaluate(() => 1);
    void mockPose;
    // orbit with background drag (tilt link off => local only)
    await page.mouse.move(420, 450);
    await page.mouse.down();
    await page.mouse.move(420 + 220, 450, { steps: 12 });
    await page.mouse.up();
    await sleep(700);
    const orb = await page.evaluate(() => window.__dotbench3d.pose());
    check('3D: dragging the background rotates the model', Math.abs(orb.roll) > 40, `roll=${orb.roll.toFixed(1)}`);
    await page.screenshot({ path: join(shots, '3d-orbited-side.png') });

    // tilt link: orbit drives the sliders
    await page.click('[data-testid=recenter]');
    await sleep(600);
    await page.click('[data-testid=tilt-link]');
    await sleep(200);
    await page.mouse.move(420, 450);
    await page.mouse.down();
    await page.mouse.move(420 + 100, 450 - 60, { steps: 10 });
    await page.mouse.up();
    await sleep(500);
    const rollField = Number(await page.$eval('[data-testid=field-roll]', (e) => e.value));
    const pitchField = Number(await page.$eval('[data-testid=field-pitch]', (e) => e.value));
    check('tilt link: orbit drag moves the Movimento sliders', Math.abs(rollField) > 20 && Math.abs(pitchField) > 10, `roll=${rollField} pitch=${pitchField}`);
    await page.$eval('[data-testid=field-heading]', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '90');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);
    const hp = await page.evaluate(() => window.__dotbench3d.pose());
    check('tilt link: sliders move the model', Math.abs(hp.heading - 90) < 2, `heading=${hp.heading.toFixed(1)}`);
    await page.click('[data-testid=tilt-link]');

    // bundles: upload, notices, wasm placeholder
    writeFileSync('/tmp/demo.dotbench', Buffer.from('not a real bundle'));
    await page.click('[data-testid=apps-menu]');
    const input = await page.$('[data-testid=file-input]');
    await input.uploadFile('/tmp/demo.dotbench');
    await sleep(600);
    const listed = await page.$$eval('[data-testid=bundle-list] li', (l) => l.map((x) => x.textContent));
    check('bundle is stored in IndexedDB and listed with size/date', listed.length === 1 && /demo\.dotbench/.test(listed[0]) && /B/.test(listed[0]), JSON.stringify(listed));
    const n1 = await page.$eval('[data-testid=notice]', (e) => e.textContent).catch(() => '');
    check('mock + real bundle shows a clear notice', /does not run \.dotbench/.test(n1), n1);
    await page.click('[data-testid=mock-toggle]');
    await sleep(300);
    await page.click('[data-testid=apps-menu]').catch(() => {});
    await page.evaluate(() => document.querySelector('[data-testid=bundle-list] li button')?.click());
    await sleep(400);
    const n2 = await page.$eval('[data-testid=notice]', (e) => e.textContent).catch(() => '');
    check('wasm placeholder + real bundle shows "not wired" message, no crash', /not wired yet/.test(n2), n2);
    await page.click('[data-testid=restart]');
    await sleep(200);
    check('Restart on the placeholder is handled', /not wired yet/.test(await page.$eval('[data-testid=notice]', (e) => e.textContent)));
    await page.click('[data-testid=mock-toggle]');
    await sleep(1200);
    check('mock back on: device runs again', (await page.$eval('[data-testid=status-state]', (e) => e.dataset.status)) === 'running');

    // language switch
    const navBefore = await page.$eval('[data-testid=left-tab-bench]', (e) => e.textContent);
    await page.select('[data-testid=lang-select]', 'pt-BR');
    await sleep(200);
    const navPt = await page.$eval('[data-testid=left-tab-bench]', (e) => e.textContent);
    check('language switch to pt-BR changes visible text and <html lang>', navBefore === 'Bench' && navPt === 'Bancada' && (await page.evaluate(() => document.documentElement.lang)) === 'pt-BR', `${navBefore} -> ${navPt}`);
    await page.select('[data-testid=lang-select]', 'es');
    await sleep(200);
    check('language switch to es', (await page.$eval('[data-testid=left-tab-components]', (e) => e.textContent)) === 'Componentes' && (await page.$eval('[data-testid=restart]', (e) => e.textContent)) === 'Reiniciar');
    check('Components section has two honest placeholders', await (async () => {
      await page.click('[data-testid=left-tab-components]');
      return (await page.$$('[data-testid=components-panel] li')).length === 2;
    })());
    await page.select('[data-testid=lang-select]', 'en');
    await page.click('[data-testid=left-tab-bench]');

    // 2D mode
    await page.click('[data-testid=view-2d]');
    await sleep(600);
    const c0 = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=screen-canvas]');
      return c.getContext('2d').getImageData(0, 0, 410, 502).data.reduce((a, v, i) => (i % 97 === 0 ? (a * 31 + v) >>> 0 : a), 7);
    });
    await sleep(700);
    const c1 = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=screen-canvas]');
      return c.getContext('2d').getImageData(0, 0, 410, 502).data.reduce((a, v, i) => (i % 97 === 0 ? (a * 31 + v) >>> 0 : a), 7);
    });
    check('2D: screen canvas is painting (pixels change over time)', c0 !== c1);
    const dims = await page.$eval('[data-testid=screen-canvas]', (c) => [c.width, c.height]);
    check('2D: canvas is exactly 410x502 logical px', dims[0] === 410 && dims[1] === 502, dims.join('x'));
    const r = await glassRect(page);
    check('2D at 1x: glass is 410x502 CSS px (pixel-exact)', Math.abs(r.width - 410) < 0.5 && Math.abs(r.height - 502) < 0.5, `${r.width}x${r.height}`);
    for (const [sx, sy] of [[60, 60], [200, 250], [350, 440]]) {
      const rr = await glassRect(page);
      await page.mouse.move(rr.left + ((sx + 0.5) / 410) * rr.width, rr.top + ((sy + 0.5) / 502) * rr.height);
      await page.mouse.down();
      await sleep(60);
      const t = await lastTouch(page);
      await page.mouse.up();
      check(`2D: glass click at (${sx},${sy}) maps within 2px`, t && Math.abs(t.x - sx) <= 2 && Math.abs(t.y - sy) <= 2, JSON.stringify(t));
    }
    const l2a = await ledColor(page);
    const tb = await page.$eval('[data-button=top]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(tb.x, tb.y);
    await sleep(200);
    check('2D: clicking the top button changes the LED', (await ledColor(page)) !== l2a);
    await page.mouse.move(tb.x, tb.y);
    await page.mouse.down();
    check('2D: held button shows pressed state', (await page.$eval('[data-button=top]', (e) => e.dataset.pressed)) === 'true');
    await page.mouse.up();
    await ctx.close();
  }

  // ================= B. desktop 1280x720 light, 2D screenshot =================
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    watch(page, 'laptop');
    await page.setViewport({ width: 1280, height: 720 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('dotbench.theme', '"light"');
      localStorage.setItem('dotbench.view', '"2d"');
      localStorage.setItem('dotbench.zoom2d', '"fit"');
      localStorage.setItem('dotbench.lang', '"en"');
    });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(500);
    await page.click('[data-testid="add-motion.pose"]');
    await page.click('[data-testid=action-shake]');
    await page.keyboard.press('t');
    await sleep(600);
    check('laptop 1280x720: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(shots, '2d-light-1280x720.png') });
    await ctx.close();
  }

  // ================= C. phone portrait 390x844 @3x touch =================
  for (const lang of ['en', 'es', 'pt-BR']) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    watch(page, `phone-${lang}`);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument((l) => localStorage.setItem('dotbench.lang', JSON.stringify(l)), lang);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(800);
    if (lang === 'en') {
      check('phone portrait: layout detected, 2D render path by default', (await page.$eval('[data-testid=phone-root]', (e) => e.dataset.layout)) === 'phone-portrait' && !!(await page.$('[data-testid=device-2d]')));
      check('phone portrait: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth));
      const body = await page.$eval('[data-testid=device-2d-body]', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, t: r.top, h: r.height }; });
      check('phone portrait: device front fills the width edge to edge', body.w >= 388 && body.l >= -0.5, JSON.stringify(body));
      check('phone portrait: device is inside the viewport vertically', body.t >= 0 && body.t + body.h <= 844 - 40, JSON.stringify(body));
      const btns = await page.$$eval('[data-button]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.button, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
      check('phone portrait: six buttons present', btns.length === 6, btns.map((b) => b.id).join(','));
      check('phone portrait: every button hit box >= 44 CSS px', btns.every((b) => b.w >= 43.9 && b.h >= 43.9), btns.map((b) => `${b.id}:${b.w.toFixed(0)}x${b.h.toFixed(0)}`).join(' '));
      check('phone portrait: every button inside the viewport (safe area)', btns.every((b) => b.l >= 0 && b.t >= 0 && b.r <= 390 && b.b <= 844));
      const ta = await page.$eval('[data-testid=glass]', (e) => getComputedStyle(e).touchAction);
      check('glass has touch-action: none', ta === 'none', ta);
      check('body has overscroll-behavior: none', (await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY)) === 'none');
      check('viewport meta has viewport-fit=cover and no user zoom', await page.evaluate(() => { const c = document.querySelector('meta[name=viewport]').content; return /viewport-fit=cover/.test(c) && /user-scalable=no/.test(c); }));

      // touch on the glass
      const gr = await glassRect(page);
      const at = (sx, sy) => [gr.left + ((sx + 0.5) / 410) * gr.width, gr.top + ((sy + 0.5) / 502) * gr.height];
      const [tx, ty] = at(120, 300);
      const th = await page.touchscreen.touchStart(tx, ty);
      await sleep(80);
      const t = await lastTouch(page);
      check('phone: synthetic touch on the glass maps within 2px', t && Math.abs(t.x - 120) <= 2 && Math.abs(t.y - 300) <= 2, JSON.stringify(t));
      // drag across the device: no scroll or zoom
      const s0 = await page.evaluate(() => ({ y: scrollY, x: scrollX, z: visualViewport.scale, st: document.scrollingElement.scrollTop }));
      for (let i = 1; i <= 8; i++) await th.move(tx, ty + i * 25), await sleep(16);
      await th.end();
      const s1 = await page.evaluate(() => ({ y: scrollY, x: scrollX, z: visualViewport.scale, st: document.scrollingElement.scrollTop }));
      check('phone: touch-drag over the device does not scroll or zoom the page', JSON.stringify(s0) === JSON.stringify(s1), `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
      const [ux, uy] = at(120, 460);
      void ux; void uy;
      const lastLine = (await logText(page)).split('\n').filter((x) => /touch up/.test(x)).pop();
      check('phone: touch release reaches the device', !!lastLine, lastLine);

      // second finger is ignored
      const a = await page.touchscreen.touchStart(...at(50, 50));
      const b2 = await page.touchscreen.touchStart(...at(300, 400));
      await sleep(80);
      const downs = (await logText(page)).match(/touch down/g)?.length ?? 0;
      await a.end();
      await b2.end();
      check('phone: only the first pointer drives touch', downs === 2, `touch-down lines total=${downs} (1 earlier + 1 now)`);

      // button touch and hold
      const bt = await page.$eval('[data-button=top]', (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      const l0 = await page.evaluate(() => window.__dotbench.device().led.get());
      const bh = await page.touchscreen.touchStart(...bt);
      await sleep(100);
      const pressed = await page.$eval('[data-button=top]', (e) => e.dataset.pressed);
      await bh.end();
      const l1 = await page.evaluate(() => window.__dotbench.device().led.get());
      check('phone: touching a button presses it (feedback + device)', pressed === 'true' && JSON.stringify(l0) !== JSON.stringify(l1));
      // hidden page releases buttons
      const bh2 = await page.touchscreen.touchStart(...bt);
      await sleep(60);
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(60);
      check('phone: page hidden releases held buttons', (await page.evaluate(() => window.__dotbench.input.pressed.get().size)) === 0);
      await bh2.end().catch(() => {});
      await page.evaluate(() => delete document.visibilityState);

      await page.screenshot({ path: join(shots, 'phone-portrait.png') });
    }

    // bottom sheet
    const handle = await page.$('[data-testid=sheet-handle]');
    const hb = await handle.boundingBox();
    if (lang === 'en') check('phone: sheet handle is a >= 44px target outside the device art', hb.height >= 44 && hb.width >= 44, `${hb.width}x${hb.height}`);
    await handle.tap();
    await sleep(400);
    const open1 = await page.$eval('[data-testid=sheet]', (e) => e.dataset.open);
    if (lang === 'en') check('phone: bottom sheet opens', open1 === 'true');
    for (const tab of ['bench', 'components', 'console', 'apps', 'settings']) {
      await page.tap(`[data-testid=tab-${tab}]`);
      await sleep(150);
      const off = await overflowOffenders(page);
      check(`phone 390px [${lang}] tab ${tab}: nothing overflows`, off.length === 0, off.slice(0, 4).join(' | '));
    }
    await page.tap('[data-testid=tab-bench]');
    if (lang === 'en') await page.screenshot({ path: join(shots, 'phone-sheet-open.png') });
    await page.tap('[data-testid=sheet-close]');
    await sleep(400);
    if (lang === 'en') check('phone: bottom sheet closes', (await page.$eval('[data-testid=sheet]', (e) => e.dataset.open)) === 'false');
    await ctx.close();
  }

  // ================= D. phone landscape 844x390 =================
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    watch(page, 'phone-landscape');
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => localStorage.setItem('dotbench.lang', '"en"'));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(800);
    check('landscape: layout detected', (await page.$eval('[data-testid=phone-root]', (e) => e.dataset.layout)) === 'phone-landscape');
    check('landscape: no scroll in either direction', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    const body = await page.$eval('[data-testid=device-2d-body]', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, t: r.top, h: r.height }; });
    check('landscape: device centred at full height', body.h >= 385 && Math.abs(body.l + body.w / 2 - 422) < 2, JSON.stringify(body));
    const btns = await page.$$eval('[data-button]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.button, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    check('landscape: every button hit box >= 44 CSS px and inside the viewport', btns.length === 6 && btns.every((b) => b.w >= 43.9 && b.h >= 43.9 && b.l >= 0 && b.t >= 0 && b.r <= 844 && b.b <= 390), btns.map((b) => `${b.id}:${b.w.toFixed(0)}x${b.h.toFixed(0)}`).join(' '));
    const gr = await glassRect(page);
    await page.touchscreen.touchStart(gr.left + (101 / 410) * gr.width, gr.top + (201 / 502) * gr.height).then((h) => h.end());
    const t = await lastTouch(page);
    check('landscape: touch on the glass maps within 2px', t && Math.abs(t.x - 100) <= 2 && Math.abs(t.y - 200) <= 2, JSON.stringify(t));
    await page.screenshot({ path: join(shots, 'phone-landscape.png') });
    await page.tap('[data-testid=sheet-handle]');
    await sleep(400);
    const sb = await page.$eval('[data-testid=sheet]', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, h: r.height, open: e.dataset.open }; });
    check('landscape: sheet opens as a side panel', sb.open === 'true' && sb.h >= 388 && sb.l > 300, JSON.stringify(sb));
    await page.screenshot({ path: join(shots, 'phone-landscape-sheet.png') });
    await page.tap('[data-testid=sheet-close]');
    await sleep(400);
    check('landscape: sheet closes', (await page.$eval('[data-testid=sheet]', (e) => e.dataset.open)) === 'false');
    await ctx.close();
  }

  // ================= E. tablet drawers =================
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    watch(page, 'tablet');
    await page.setViewport({ width: 820, height: 1180 });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('dotbench.lang', '"en"'); localStorage.setItem('dotbench.view', '"2d"'); });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(400);
    await page.click('[data-testid=drawer-bench]');
    await page.click('[data-testid=drawer-console]');
    await sleep(200);
    check('tablet: bench and console drawers open', !!(await page.$('[data-testid=drawer-bench-panel]')) && !!(await page.$('[data-testid=drawer-console-panel]')));
    await page.screenshot({ path: join(shots, 'tablet-drawers.png') });
    await ctx.close();
  }

  check('no console errors, page errors, failed requests or HTTP errors in any phase', consoleProblems.length === 0, consoleProblems.slice(0, 5).join(' || '));
} catch (e) {
  console.error('headless check crashed:', e);
  check('script ran to completion', false, String(e));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
