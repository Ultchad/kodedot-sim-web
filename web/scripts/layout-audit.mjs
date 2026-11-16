// Automated layout audit of the built page. Run on its own (`node scripts/layout-audit.mjs [viewportId ...]`) or from
// headless-check.mjs, which calls runLayoutAudit() with its own browser and server.
//
// Matrix: the eight review viewports x light/dark x en/pt-BR/es. Every scene of ux-scenes.mjs is audited in
// light + English; the text-heavy scenes (the ones whose layout depends on string length) in every other combination.
// AUDIT=quick limits it to light + English and dark + Spanish.
//
// Rules, each failure names the rule, the viewport, the theme, the language, the scene and the offending selector:
//   page-scroll   the document scrolls horizontally or vertically (the page is a fixed shell)
//   clipped       an element is cut by an ancestor that clips (overflow hidden/clip) and offers no scrolling on that axis
//   cut-content   a box hides part of its own content (scrollHeight/Width larger than the box) without scrolling or ellipsis
//   double-scroll a scrolling region sits inside another region that scrolls on the same axis
//   offscreen     an interactive element lies outside the viewport and no scroll region can bring it back
//   covered       an interactive element is under another element (for example a fixed bar) that is not a floating layer
//   overlap       two interactive elements overlap
//   target-size   an interactive element is smaller than 24x24 CSS px (44x44 on touch viewports)
//   contrast      text below WCAG AA (4.5:1, or 3:1 for large text) against its effective background
import { LANGS, THEMES, VIEWPORTS, launch, openPage, sleep, startServer, waitRunning, BASE } from './ux-lib.mjs';
import { layoutOf, scenesFor } from './ux-scenes.mjs';

/** Runs inside the page. Returns [{ rule, sel, detail }]. */
function auditInPage({ touch }) {
  const out = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const EPS = 1.5;
  const MIN = touch ? 44 : 24;
  const seen = new Set();
  const report = (rule, el, detail) => {
    const key = `${rule}|${sel(el)}|${detail.replace(/[\d.]+/g, '#')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ rule, sel: sel(el), detail });
  };
  function sel(el) {
    if (!el || el === document.documentElement) return 'html';
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      const tid = n.getAttribute('data-testid');
      let s = n.tagName.toLowerCase();
      if (tid) s += `[data-testid=${tid}]`;
      else if (n.id) s += `#${n.id}`;
      else if (n.getAttribute('data-button')) s += `[data-button=${n.getAttribute('data-button')}]`;
      else if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
      parts.unshift(s);
      if (tid || n.id) break;
    }
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return parts.join(' > ') + (text ? ` "${text}"` : '');
  }
  const styleOf = (el) => getComputedStyle(el);
  const isSrOnly = (el) => !!el.closest('.sr-only, .skip-link:not(:focus)');
  const hiddenByAttr = (el) => !!el.closest('[inert], [hidden]');
  function visible(el) {
    if (hiddenByAttr(el) || isSrOnly(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = styleOf(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  }
  const scrollsY = (el, cs = styleOf(el)) => (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight - el.clientHeight > 1;
  const scrollsX = (el, cs = styleOf(el)) => (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth - el.clientWidth > 1;
  const canScrollY = (cs) => cs.overflowY === 'auto' || cs.overflowY === 'scroll';
  const canScrollX = (cs) => cs.overflowX === 'auto' || cs.overflowX === 'scroll';
  const clipsX = (cs) => cs.overflowX === 'hidden' || cs.overflowX === 'clip';
  const clipsY = (cs) => cs.overflowY === 'hidden' || cs.overflowY === 'clip';
  // the device picture is art inside a window (the glass, the pan view): not page content
  const inDeviceArt = (el) => !!el.closest('[data-testid=device-2d-body], [data-testid=device-3d]');
  const inLayer = (el) => el.closest('[data-layer]');

  // ---- page-scroll
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1) report('page-scroll', de, `horizontal: scrollWidth ${Math.max(de.scrollWidth, document.body.scrollWidth)} > ${vw}`);
  if (de.scrollHeight > vh + 1) report('page-scroll', de, `vertical: scrollHeight ${de.scrollHeight} > ${vh}`);
  if (window.scrollX !== 0 || window.scrollY !== 0 || de.scrollTop !== 0 || document.body.scrollTop !== 0) report('page-scroll', de, `the page is scrolled (${window.scrollX}, ${window.scrollY}, ${de.scrollTop})`);

  const all = [...document.body.querySelectorAll('*')].filter((el) => !(el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg'));
  const vis = all.filter(visible);

  // ---- clipped: an element cut by a clipping ancestor with no scrolling on that axis
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]):not([type=file]), select, textarea, [role=tab], [role=menuitem], [role=separator][tabindex], [role=slider]';
  const contentEls = vis.filter((el) => !inDeviceArt(el) && (hasOwnText(el) || el.matches(INTERACTIVE) || ['IMG', 'CANVAS', 'svg'].includes(el.tagName)));
  for (const el of contentEls) {
    const r = el.getBoundingClientRect();
    let checkX = true;
    let checkY = true;
    let truncating = styleOf(el).textOverflow === 'ellipsis';
    for (let a = el.parentElement; a && (checkX || checkY); a = a.parentElement) {
      const cs = styleOf(a);
      if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') truncating = true;
      const b = a === document.body ? { left: 0, top: 0, right: vw, bottom: vh } : a.getBoundingClientRect();
      if (checkX) {
        if (canScrollX(cs)) checkX = false;
        else if (clipsX(cs) || a === document.body) {
          if (!truncating && (r.left < b.left - EPS || r.right > b.right + EPS)) {
            report('clipped', el, `cut horizontally by ${sel(a)}: ${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(b.left)}..${Math.round(b.right)}`);
            checkX = false;
          }
        }
      }
      if (checkY) {
        if (canScrollY(cs)) checkY = false;
        else if (clipsY(cs) || a === document.body) {
          if (r.top < b.top - EPS || r.bottom > b.bottom + EPS) {
            report('clipped', el, `cut vertically by ${sel(a)}: ${Math.round(r.top)}..${Math.round(r.bottom)} outside ${Math.round(b.top)}..${Math.round(b.bottom)}`);
            checkY = false;
          }
        }
      }
      if (a === document.body) break;
    }
  }

  // ---- cut-content and double-scroll
  for (const el of vis) {
    if (inDeviceArt(el) || el.tagName === 'svg' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') continue;
    const cs = styleOf(el);
    if (cs.display === 'inline') continue;
    const truncates = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
    if (clipsY(cs) && !truncates && el.scrollHeight - el.clientHeight > 2 && el.clientHeight > 0) report('cut-content', el, `content ${el.scrollHeight}px tall in a ${el.clientHeight}px box that does not scroll`);
    if (clipsX(cs) && !truncates && el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0) report('cut-content', el, `content ${el.scrollWidth}px wide in a ${el.clientWidth}px box that does not scroll`);
    if (scrollsY(el, cs)) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (scrollsY(a)) {
          report('double-scroll', el, `scrolls vertically inside ${sel(a)}, which also scrolls`);
          break;
        }
      }
    }
  }

  // ---- interactive elements
  const interactive = vis.filter((el) => el.matches(INTERACTIVE) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  /** The part of an element that scroll regions leave visible; null when it is scrolled out of view (reachable by scrolling). */
  function visibleRect(el) {
    let r = el.getBoundingClientRect();
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = styleOf(a);
      if (canScrollX(cs) || canScrollY(cs)) {
        const b = a.getBoundingClientRect();
        if (canScrollX(cs)) {
          box.left = Math.max(box.left, b.left);
          box.right = Math.min(box.right, b.right);
        }
        if (canScrollY(cs)) {
          box.top = Math.max(box.top, b.top);
          box.bottom = Math.min(box.bottom, b.bottom);
        }
        if (box.right - box.left < 1 || box.bottom - box.top < 1) return null;
      }
    }
    return box;
  }
  const related = (a, b) => a.contains(b) || b.contains(a) || (a.closest('label') && a.closest('label') === b.closest('label'));
  const targets = [];
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    const box = visibleRect(el);
    if (!box) continue; // scrolled out of a scroll region: reachable
    const partly = box.right - box.left < r.width - 1 || box.bottom - box.top < r.height - 1;
    // offscreen
    if (r.right < -EPS || r.bottom < -EPS || r.left > vw + EPS || r.top > vh + EPS || r.left < -EPS || r.top < -EPS || r.right > vw + EPS || r.bottom > vh + EPS) {
      if (!partly) report('offscreen', el, `box ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} outside the ${vw}x${vh} viewport`);
    }
    // target size (inline text links are exempt, as in WCAG 2.5.8)
    const inlineLink = el.tagName === 'A' && styleOf(el).display === 'inline';
    if (!inlineLink && !partly && (r.width < MIN - 0.5 || r.height < MIN - 0.5)) report('target-size', el, `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}, needs ${MIN}x${MIN}`);
    const pe = styleOf(el).pointerEvents;
    if (pe === 'none') continue; // hit-tested by its container (the D-pad arms)
    // covered
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    if (cx >= 0 && cy >= 0 && cx <= vw && cy <= vh) {
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !(top.closest('label') && top.closest('label').contains(el))) {
        const layer = inLayer(top);
        if (!(layer && !layer.contains(el))) report('covered', el, `covered at its centre by ${sel(top)}`);
        else continue; // under a floating layer by design: not a pointer target right now
      }
    }
    targets.push({ el, box });
  }
  // overlap
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if (related(a.el, b.el)) continue;
      if (inLayer(a.el) !== inLayer(b.el)) continue; // a floating layer sits above the page on purpose
      const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (w > 2 && h > 2) report('overlap', a.el, `overlaps ${sel(b.el)} by ${Math.round(w)}x${Math.round(h)} px`);
    }
  }

  // ---- contrast
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  function rgba(color) {
    if (cache.has(color)) return cache.get(color);
    ctx.clearRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    const v = a === 0 ? [0, 0, 0, 0] : [d[0], d[1], d[2], a];
    cache.set(color, v);
    return v;
  }
  const over = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a)];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  for (const el of vis) {
    if (!hasOwnText(el) || inDeviceArt(el) || el.closest(':disabled, [aria-disabled=true]')) continue;
    if (!visibleRect(el)) continue;
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
    let bg = [255, 255, 255];
    let opacity = 1;
    let image = false;
    for (const n of chain) {
      const cs = styleOf(n);
      opacity *= Number(cs.opacity);
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) {
        bg = over([c[0], c[1], c[2], c[3] * (n === el ? 1 : 1)], bg);
        image = false;
      }
      if (cs.backgroundImage !== 'none') image = true;
    }
    if (image) continue; // text over a picture or gradient: cannot be judged from colours
    const cs = styleOf(el);
    const fgc = rgba(cs.color);
    const fg = over([fgc[0], fgc[1], fgc[2], fgc[3] * opacity], bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need - 0.01) report('contrast', el, `${ratio.toFixed(2)}:1, needs ${need}:1 (text ${cs.color} at ${size}px)`);
  }
  return out;
}

/**
 * Guards the guard: breaks the live page in one known way per rule and expects the audit to name each one.
 * Returns the rules that were NOT caught (empty = the audit can see every kind of defect).
 */
export async function auditSelfTest(page, touch) {
  const before = (await page.evaluate(auditInPage, { touch })).length;
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid=top-bar]');
    const add = (html) => host.insertAdjacentHTML('beforeend', html);
    // clipped + cut-content: a tall block inside a short clipping box
    add('<div id="st-clip" style="position:fixed;left:40px;top:120px;width:120px;height:20px;overflow:hidden;z-index:999"><p id="st-clip-p" style="margin:0;height:60px;line-height:60px">selftest clipped</p></div>');
    // target-size: a tiny button
    add('<button id="st-small" style="position:fixed;left:200px;top:120px;width:12px;height:12px;padding:0;z-index:999" aria-label="selftest small"></button>');
    // overlap: two buttons on the same spot
    add('<button id="st-o1" style="position:fixed;left:240px;top:120px;width:60px;height:60px;z-index:999">a</button><button id="st-o2" style="position:fixed;left:270px;top:130px;width:60px;height:60px;z-index:999">b</button>');
    // covered: a button under a plain (non-layer) bar
    add('<button id="st-cov" style="position:fixed;left:360px;top:120px;width:60px;height:60px;z-index:998">c</button><div id="st-bar" style="position:fixed;left:350px;top:110px;width:90px;height:90px;background:#888;z-index:999"></div>');
    // offscreen: a button past the right edge
    add('<button id="st-off" style="position:fixed;left:calc(100vw + 40px);top:120px;width:60px;height:60px">d</button>');
    // contrast: grey on grey
    add('<p id="st-con" style="position:fixed;left:40px;top:200px;margin:0;background:#777;color:#888;z-index:999">selftest contrast</p>');
    // double-scroll: a scroller inside a scroller
    add('<div id="st-s1" style="position:fixed;left:200px;top:200px;width:100px;height:60px;overflow-y:auto;z-index:999"><div style="height:200px"><div id="st-s2" style="height:40px;overflow-y:auto"><div style="height:120px">x</div></div></div></div>');
    // page-scroll: an element in normal flow wider than the page
    document.body.insertAdjacentHTML('beforeend', '<div id="st-wide" style="position:absolute;left:0;top:0;width:calc(100vw + 300px);height:1px"></div>');
  });
  const found = await page.evaluate(auditInPage, { touch });
  await page.evaluate(() => document.querySelectorAll('[id^=st-]').forEach((e) => e.remove()));
  const after = (await page.evaluate(auditInPage, { touch })).length;
  const expected = { clipped: 'st-clip', 'cut-content': 'st-clip', 'target-size': 'st-small', overlap: 'st-o', covered: 'st-cov', offscreen: 'st-off', contrast: 'st-con', 'double-scroll': 'st-s2', 'page-scroll': 'html' };
  const missed = Object.entries(expected).filter(([rule, id]) => !found.some((f) => f.rule === rule && (f.sel.includes(id) || f.detail.includes(id)))).map(([rule]) => rule);
  if (after !== before) missed.push(`cleanup (${before} findings before, ${after} after)`);
  return missed;
}

/**
 * Walks the matrix. `check(name, ok, detail)` receives one result per viewport x theme x language (so a failure names
 * its place); returns { audits, failures }.
 */
export async function runLayoutAudit(browser, { base = BASE, only = [], check = () => {}, quick = process.env.AUDIT === 'quick', concurrency = Number(process.env.AUDIT_JOBS ?? 2) } = {}) {
  let audits = 0;
  const failures = [];
  const wanted = (lang, theme) => !quick || (lang === 'en' && theme === 'light') || (lang === 'es' && theme === 'dark');

  async function auditViewport(vp) {
    const { ctx, page, problems } = await openPage(browser, vp, { base, view: '2d', zoom: 'fit' });
    try {
      await waitRunning(page);
      await sleep(500);
      if (vp.id === '1440x900' || vp.id === '390x844' || only.length === 1) {
        const missed = await auditSelfTest(page, !!vp.touch);
        check(`layout audit self-test ${vp.id}: every rule catches its planted defect`, missed.length === 0, missed.join(', '));
        if (missed.length) failures.push(`${vp.id} self-test missed: ${missed.join(', ')}`);
      }
      // 3D is the other engineer's canvas: one scene covers its toolbar; the pixel-exact zooms are covered by 1x
      const scenes = scenesFor(vp).filter((s) => !/^3d-|phone-3d|^2d-[23]x$/.test(s.id) || s.id === '3d-hints');
      for (const lang of LANGS) {
        if (!THEMES.some((t) => wanted(lang, t))) continue;
        await page.evaluate((l) => window.__dotbench.ui.setLocale(l), lang);
        await sleep(200);
        const bad = Object.fromEntries(THEMES.map((t) => [t, []]));
        for (const scene of scenes) {
          // geometry depends on the language, colours on the theme: English walks every scene, the others the text-heavy ones
          if (lang !== 'en' && !scene.textHeavy) continue;
          try {
            await scene.enter(page, vp);
            await sleep(Math.max(400, scene.settle ?? 0));
            for (const theme of THEMES) {
              if (!wanted(lang, theme)) continue;
              await page.evaluate((t) => window.__dotbench.ui.setTheme(t), theme);
              await sleep(120);
              const found = await page.evaluate(auditInPage, { touch: !!vp.touch });
              audits++;
              for (const f of found) bad[theme].push(`[${scene.id}] ${f.rule}: ${f.sel} :: ${f.detail}`);
            }
          } catch (e) {
            for (const t of THEMES) bad[t].push(`[${scene.id}] scene failed: ${e.message}`);
          }
          await (scene.leave ?? (async () => {}))(page, vp).catch((e) => bad[THEMES[0]].push(`[${scene.id}] leave failed: ${e.message}`));
        }
        for (const theme of THEMES) {
          if (!wanted(lang, theme)) continue;
          const where = `${vp.id} ${theme} ${lang} (${layoutOf(vp)})`;
          const list = bad[theme];
          check(`layout audit ${where}: no clipped, covered, overlapping, undersized or low-contrast elements`, list.length === 0, list.slice(0, 6).join(' || ') + (list.length > 6 ? ` || +${list.length - 6} more` : ''));
          for (const b of list) failures.push(`${where} ${b}`);
        }
      }
      if (problems.length) {
        check(`layout audit ${vp.id}: no console errors`, false, problems.slice(0, 3).join(' | '));
        failures.push(`${vp.id} console: ${problems[0]}`);
      }
    } finally {
      await ctx.close();
    }
  }

  const queue = VIEWPORTS.filter((vp) => !only.length || only.includes(vp.id));
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (let vp = queue.shift(); vp; vp = queue.shift()) {
      await auditViewport(vp).catch((e) => {
        check(`layout audit ${vp.id}: ran to completion`, false, String(e));
        failures.push(`${vp.id} crashed: ${e}`);
      });
    }
  });
  await Promise.all(workers);
  return { audits, failures };
}

// standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startServer();
  const browser = await launch();
  let failed = 0;
  let total = 0;
  try {
    const { audits, failures } = await runLayoutAudit(browser, {
      only: process.argv.slice(2),
      check: (name, ok, detail) => {
        total++;
        if (!ok) failed++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + detail}`);
      },
    });
    if (failures.length) console.log(`\nAll ${failures.length} findings:\n` + failures.join('\n'));
    console.log(`\n${audits} scene audits, ${total - failed}/${total} combinations clean`);
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
}
