// What the Workbench proof scripts share: the page with kodeOS running, the table's debug hook, and a mouse.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

// as ux-lib's launch, with a shorter protocol timeout: a page that stops answering is noticed in a minute, not three
const launch = () => puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 70000, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });

export { sleep, until };
export const shots = join(root, 'screenshots', 'workbench2');
mkdirSync(shots, { recursive: true });

export async function openBench(opts = {}) {
  const server = await startServer();
  const browser = await launch();
  const { page, problems, ctx } = await openPage(browser, { id: 'desk', w: 1440, h: 900 }, { mode: 'workbench', prefs: { 'dotbench.left': 'components', 'dotbench.panel.console': false, 'dotbench.welcome': 'seen', ...(opts.prefs ?? {}) } });
  const D = (fn, ...a) => page.evaluate(fn, ...a);
  const b = {
    page, problems, ctx, browser, server, D,
    failed: 0,
    check(name, ok, detail = '') {
      if (!ok) b.failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
      return ok;
    },
    engine: () => D(() => window.__dotbench.parts.state()),
    part: (id) => D((i) => window.__dotbench.parts.stateOf(i) ?? null, id),
    objects: () => D(() => window.__dotbench.bench.getState().objects.filter((o) => o.area === 'part')),
    wires: () => D(() => window.__dotbench.bench.getState().wires),
    wbReady: () => until(() => D(() => !!window.__dotbenchWb && window.__dotbench3d?.info().model !== 'pending' && window.__dotbench3d.rendered() > 2), 40000),
    settled: () => until(() => D(() => window.__dotbenchWb.settled()), 6000, 80),
    async ready() {
      await waitRunning(page, 90000);
      await b.wbReady();
      await page.click('[data-testid=welcome-dismiss]').catch(() => {});
      await until(() => page.$('[data-testid="part-dotbench.led"]').then((e) => !!e), 20000);
    },
    /** Takes a part from the library panel (a click); returns its instance id. */
    async place(id) {
      const before = new Set((await b.objects()).map((o) => o.id));
      await page.$eval(`[data-testid="part-${id}"]`, (e) => e.click());
      let inst = null;
      await until(async () => {
        inst = (await b.objects()).find((o) => !before.has(o.id))?.id ?? null;
        return !!inst && !!(await b.part(inst)) && (await D((i) => window.__dotbenchWb.world.bodies.items.has(i), inst));
      }, 25000, 150);
      await b.settled();
      return inst;
    },
    /** Drags a body with the mouse so that its centre ends at a table point (mm). */
    async dragTo(id, x, z) {
      const from = await D((i) => window.__dotbenchWb.body(i), id);
      const o = await D((i) => window.__dotbench.bench.get(i).pos, id);
      const grab = await D((p) => window.__dotbenchWb.tableAt(p.x, p.y), from);
      const to = await D((p) => window.__dotbenchWb.table(p.x, p.z), { x: grab.x + x - o.x, z: grab.z + z - o.z });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
        await sleep(30);
      }
      await sleep(80);
      await page.mouse.up();
      await b.settled();
    },
    /** Drags a body by mouse to stand beside another (offset in mm from that one's centre), the whole table in view. */
    async beside(id, anchor, dx, dz) {
      await D(() => window.__dotbenchWb.frameAll());
      await sleep(500);
      const a = await D((i) => window.__dotbench.bench.get(i).pos, anchor);
      await b.dragTo(id, a.x + dx, a.z + dz);
      return D((i) => window.__dotbench.bench.get(i).pos, id);
    },
    /** Looks at two things together, close. */
    async lookAt(idA, idB, pol = 0.45) {
      const p = await D((a, c) => [window.__dotbench.bench.get(a).pos, window.__dotbench.bench.get(c).pos], idA, idB);
      await b.look((p[0].x + p[1].x) / 2, (p[0].z + p[1].z) / 2, Math.max(180, Math.hypot(p[0].x - p[1].x, p[0].z - p[1].z) * 1.7), pol);
    },
    /** Where a terminal is on the table (mm). */
    termAt: (term) => D((t) => {
      const w = window.__dotbenchWb.world.wires;
      w.refresh();
      const s = w.spot(t);
      return s ? { x: s.pos.x, y: s.pos.y, z: s.pos.z } : null;
    }, term),
    /** Drags a legged part so that one of its legs stands over a hole of a board. */
    async plug(id, leg, hole) {
      const l = await b.termAt(`${id}.${leg}`), h = await b.termAt(hole);
      const o = await D((i) => window.__dotbench.bench.get(i).pos, id);
      await b.dragTo(id, o.x + h.x - l.x + 0.6, o.z + h.z - l.z - 0.5); // a little off: the holes pull it in
    },
    /** Looks at a region of the table from above, close enough for 2.54 mm terminals. */
    async look(x, z, dist = 150, pol = 0.5, az = 0) {
      await D((v) => window.__dotbenchWb.setView(v), { x, z, dist, pol, az });
      await sleep(350);
    },
    async wireTool(on, color) {
      const is = await page.$eval('[data-testid=wb-wire]', (e) => e.getAttribute('aria-pressed') === 'true');
      if (is !== on) await page.click('[data-testid=wb-wire]');
      if (on && color !== undefined) await page.click(`[data-testid=wire-pick-${color}]`);
    },
    /** Clicks one terminal, then another, with the wire tool. Returns the tooltip seen on the second. */
    async wire(a, c, color) {
      await b.wireTool(true, color);
      let tip = '';
      for (const t of [a, c]) {
        const p = await D((x) => window.__dotbenchWb.term(x), t);
        await page.mouse.move(p.x - 3, p.y - 2);
        await page.mouse.move(p.x, p.y);
        await sleep(120);
        tip = await page.$eval('[data-testid=wb-term-tip]', (e) => (e.classList.contains('hidden') ? '' : e.textContent));
        await page.mouse.down();
        await sleep(40);
        await page.mouse.up();
        await sleep(150);
      }
      return tip;
    },
    /** Page coordinates of a pixel of the Dot's screen, wherever the Dot is. */
    async glass(x, y) {
      const p = await D((s) => window.__dotbench3d.project(s), `glass:${x},${y}`);
      return [p.x, p.y];
    },
    async tap(x, y, hold = 120) {
      const [px, py] = await b.glass(x, y);
      await page.mouse.move(px, py);
      await page.mouse.down();
      await sleep(hold);
      await page.mouse.up();
    },
    program: () => D(() => window.__dotbench.device().program.get()),
    status: () => D(() => window.__dotbench.device().status.get()),
    async shot(name) {
      await sleep(400);
      for (let i = 0; i < 3; i++) {
        try {
          await page.screenshot({ path: join(shots, `${name}.png`) });
          return;
        } catch {
          await sleep(1500);
        }
      }
    },
    async close() {
      await ctx.close().catch(() => {});
      await browser.close();
      server.kill();
    },
  };
  return b;
}
