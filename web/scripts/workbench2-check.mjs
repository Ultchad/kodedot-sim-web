// The wired parts on the Workbench, checked in the real page (headless Chrome, fresh profile, kodeOS running):
//   npm run build && node scripts/workbench2-check.mjs
// Parts are taken from the library panel, live in the parts engine, show their state, are worked in 3D, edited in the
// inspector, removed, undone, and come back after a reload. (Wires, code and the rest of phase 2 are not in yet.)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const shots = join(root, 'screenshots', 'workbench2');
mkdirSync(shots, { recursive: true });
const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const { page, problems, ctx } = await openPage(browser, { id: 'desk', w: 1440, h: 900 }, { mode: 'workbench', prefs: { 'dotbench.left': 'components', 'dotbench.panel.console': false, 'dotbench.welcome': false } });
const D = (fn, ...a) => page.evaluate(fn, ...a);
const engine = () => D(() => window.__dotbench.parts.state().parts.map((p) => ({ instance: p.instance, id: p.id, fields: p.fields, outputs: p.outputs, on: p.power.on })));
const objects = () => D(() => window.__dotbench.bench.getState().objects.filter((o) => o.area === 'part'));
const wbReady = () => until(() => D(() => !!window.__dotbenchWb && window.__dotbench3d?.info().model !== 'pending' && window.__dotbench3d.rendered() > 2), 40000);
const place = async (id) => {
  await page.$eval(`[data-testid="part-${id}"]`, (e) => e.click());
  return until(async () => (await engine()).some((p) => p.id === id) && (await D((i) => [...window.__dotbenchWb.world.bodies.items.values()].some((b) => b.kind === i), id)), 20000, 150);
};
try {
  await waitRunning(page, 90000);
  await wbReady();
  await page.click('[data-testid=welcome-dismiss]').catch(() => {});
  check('Library: the Components tab lists the parts of the library', (await until(() => page.$('[data-testid="part-dotbench.led"]').then((e) => !!e), 20000)) >= 0, `${await page.$$eval('[data-testid^="part-dotbench."]', (e) => e.length)} parts`);
  await page.type('[data-testid=parts-search]', 'resist');
  await sleep(300);
  const found = await page.$$eval('[data-testid^="part-dotbench."]', (e) => e.map((x) => x.dataset.testid));
  check('Library: search narrows the list', found.includes('part-dotbench.resistor') && found.length < 8, found.join(','));
  await page.$eval('[data-testid=parts-search]', (e) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(e, '');
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);

  for (const id of ['dotbench.breadboard-half', 'dotbench.led', 'dotbench.resistor', 'dotbench.push-button', 'dotbench.uno-r3']) check(`Place: ${id} is on the table (a body) and in the parts engine`, (await place(id)) >= 0);
  let objs = await objects();
  const clear = objs.every((a) => objs.every((b) => a === b || Math.abs(a.pos.x - b.pos.x) > 1 || Math.abs(a.pos.z - b.pos.z) > 1));
  check('Place: five parts, each with its own place, ids p1 to p5', objs.length === 5 && clear && objs.map((o) => o.id).join() === 'p1,p2,p3,p4,p5', JSON.stringify(objs.map((o) => [o.id, o.pos])));
  await D(() => window.__dotbenchWb.frameAll());
  await sleep(2500);
  await page.screenshot({ path: join(shots, 'parts-on-the-table.png') });

  // the inspector: a field edited there reaches the engine
  const res = objs.find((o) => o.kind === 'dotbench.resistor');
  await D((i) => window.__dotbench.select.only(i), res.id);
  await page.waitForSelector('[data-testid=pfield-ohms]');
  await page.$eval('[data-testid=pfield-ohms]', (e) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(e, '1000');
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('Inspector: the resistor set to 1000 ohm is 1000 ohm in the engine', (await until(async () => (await engine()).find((p) => p.instance === res.id)?.fields.ohms === 1000, 5000, 100)) >= 0);
  check('Inspector: it lists the pins with what they carry', (await page.$$eval('[data-testid=part-pins] li', (e) => e.length)) === 2);

  // a control worked in 3D: the push button's cap, held with the mouse
  const btn = objs.find((o) => o.kind === 'dotbench.push-button');
  await D((i) => window.__dotbenchWb.focus(i, 0, 0.3, 12), btn.id);
  await sleep(1200);
  const cap = await D((i) => {
    const it = window.__dotbenchWb.world.bodies.items.get(i);
    const node = it.controls[0];
    const v = node.getWorldPosition(new (window.__dotbench3d.scene().position.constructor)());
    return window.__dotbenchWb.table(v.x, v.z, v.y + 1);
  }, btn.id);
  await page.mouse.move(cap.x, cap.y);
  await page.mouse.down();
  await sleep(500);
  const held = (await engine()).find((p) => p.instance === btn.id)?.fields.pressed;
  await page.mouse.up();
  await sleep(400);
  const released = (await engine()).find((p) => p.instance === btn.id)?.fields.pressed;
  check('Control in 3D: holding the push button\'s cap with the mouse presses it, letting go releases it', held === true && released === false, `${held} -> ${released}`);

  // delete, undo
  await page.keyboard.press('Delete');
  check('Delete: the selected part leaves the table and the engine', (await until(async () => !(await engine()).some((p) => p.instance === btn.id), 5000, 100)) >= 0);
  await page.click('[data-testid=wb-undo]');
  check('Undo: it is back, in the engine too', (await until(async () => (await engine()).some((p) => p.instance === btn.id), 8000, 100)) >= 0);

  // a reload keeps the parts
  const before = JSON.stringify((await objects()).map((o) => [o.id, o.kind, o.pos, o.fields]));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
  await waitRunning(page, 90000);
  await wbReady();
  const back = await until(async () => (await engine()).length === 5 && (await D(() => window.__dotbenchWb.world.bodies.items.size)) >= 6, 30000, 200);
  check('Reload: the same parts, in the same places, with their fields, in the engine again with bodies', back >= 0 && JSON.stringify((await objects()).map((o) => [o.id, o.kind, o.pos, o.fields])) === before);
  const real = problems.filter((x) => !/ExitStatus/.test(x));
  check('no page errors', real.length === 0, real.join(' | '));
} catch (e) {
  failed++;
  console.log('FAIL  the check itself threw:', e);
} finally {
  await ctx.close().catch(() => {});
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
