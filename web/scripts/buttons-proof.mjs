// Proof of the buttons on the Workbench, in headless Chrome against `vite preview` of dist/ (build first):
//   UX_PORT=4467 node scripts/buttons-proof.mjs
// 1. the library cards of the buttons and switches, light and dark  -> screenshots/buttons/library-<theme>[-<lang>].png
// 2. the 6 x 6 mm tactile button plugged over a breadboard's centre channel, a 9 V battery, a resistor and an LED wired
//    through it; the pointer held on its plunger lights the LED     -> screenshots/buttons/tact-6mm-pressed.png
// 3. the latching button: one click latches it, the next releases it
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, sleep, until } from './proof-lib.mjs';
import { root } from './ux-lib.mjs';

const out = join(root, 'screenshots', 'buttons');
mkdirSync(out, { recursive: true });
const IDS = ['dotbench.push-button', 'dotbench.tact-6mm', 'dotbench.tact-12mm', 'dotbench.latching-button', 'dotbench.toggle-switch', 'dotbench.slide-switch'];

let failed = 0;
for (const [theme, lang] of [['light', 'en'], ['dark', 'en'], ['light', 'pt-BR'], ['light', 'es']]) {
  const b = await openBench({ prefs: { 'dotbench.theme': theme, 'dotbench.lang': lang } });
  try {
    await b.ready();
    const boxes = [];
    await b.D(() => document.fonts.ready.then(() => true));
    await sleep(300);
    for (const id of IDS) {
      const el = await b.page.$(`[data-testid="part-${id}"]`);
      b.check(`${theme}: the library lists ${id}`, !!el);
      if (!el) continue;
      await el.evaluate((x) => x.scrollIntoView({ block: 'center' }));
      const pic = (await until(() => el.$eval('img', (i) => i.complete && i.naturalWidth > 0 && /parts-thumbs/.test(i.src)), 5000, 100)) >= 0;
      b.check(`${theme}: ${id} shows its picture`, pic);
      const lines = await el.$eval('span', (x) => Math.round(x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight)));
      if (id !== 'dotbench.slide-switch') b.check(`${theme} ${lang}: the name of ${id} takes at most two lines on its card`, lines <= 2, `${lines} lines`);
      boxes.push(el);
    }
    await boxes[1].evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await sleep(400);
    const r = await Promise.all(boxes.map((e) => e.boundingBox()));
    const x0 = Math.min(...r.map((q) => q.x)) - 12, y0 = Math.max(0, Math.min(...r.map((q) => q.y)) - 12), x1 = Math.max(...r.map((q) => q.x + q.width)) + 12, y1 = Math.min(900, Math.max(...r.map((q) => q.y + q.height)) + 12);
    await b.page.screenshot({ path: join(out, `library-${theme}${lang === 'en' ? '' : '-' + lang}.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });

    if (theme === 'light' && lang === 'en') {
      const bb = await b.place('dotbench.breadboard-half'), btn = await b.place('dotbench.tact-6mm'), led = await b.place('dotbench.led-red'), res = await b.place('dotbench.resistor'), bat = await b.place('dotbench.battery-9v');
      // the plunger is a control (a press on it never drags), so the button is taken by the front of its base
      const bp0 = await b.D((i) => window.__dotbench.bench.get(i).pos, btn);
      await b.look(bp0.x, bp0.z, 110, 0.6);
      const l = await b.termAt(`${btn}.A1`), h = await b.termAt(`${bb}.e10`);
      const from = await b.D((p) => window.__dotbenchWb.table(p.x, p.z + 3, 5), bp0);
      const grab = await b.D((p) => window.__dotbenchWb.tableAt(p.x, p.y), from);
      const to = await b.D((p) => window.__dotbenchWb.table(p.x, p.z), { x: grab.x + h.x - l.x + 0.6, z: grab.z + h.z - l.z - 0.5 });
      await b.page.mouse.move(from.x, from.y);
      await b.page.mouse.down();
      for (let i = 1; i <= 10; i++) { await b.page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10); await sleep(30); }
      await sleep(80);
      await b.page.mouse.up();
      await b.settled();
      b.check('taking the button by its base moves it and presses nothing', (await b.part(btn))?.fields.pressed === false && Math.hypot((await b.D((i) => window.__dotbench.bench.get(i).pos, btn)).x - bp0.x, (await b.D((i) => window.__dotbench.bench.get(i).pos, btn)).z - bp0.z) > 3);
      const netOf = async (inst, pin) => { const st = await b.part(inst); return st?.pins[pin]?.net ?? st?.groups.find((g) => g.pin === pin)?.net ?? -1; };
      const nA = await netOf(btn, 'A1'), nB = await netOf(btn, 'B1');
      const cols = await Promise.all(['a10', 'f10', 'a12', 'f12'].map((h) => netOf(bb, h)));
      b.check('the 6 x 6 button stands over the centre channel: column 10 (both halves) is its A pair, column 12 its B pair', nA >= 0 && nA !== nB && cols[0] === nA && cols[1] === nA && cols[2] === nB && cols[3] === nB, JSON.stringify({ nA, nB, cols }));
      await b.beside(bat, bb, -85, 0);
      await b.plug(led, 'A', `${bb}.h14`);
      await b.plug(res, 'A', `${bb}.c4`);
      b.check('the LED and the resistor stand in their holes', (await netOf(led, 'A')) === (await netOf(bb, 'f14')) && (await netOf(led, 'K')) === (await netOf(bb, 'f15')) && (await netOf(res, 'A')) === (await netOf(bb, 'a4')) && (await netOf(res, 'B')) === (await netOf(bb, 'a8')));
      await b.lookAt(bb, bat, 0.5);
      await b.wire(`${bat}.POS`, `${bb}.a4`, 0);
      await b.wire(`${bb}.a8`, `${bb}.j14`, 0);   // the resistor's far end (c8) to the LED's anode column
      await b.wire(`${bb}.j15`, `${bb}.j12`, 2);  // the LED's cathode column to the button's B column
      await b.wire(`${bat}.NEG`, `${bb}.a10`, 1); // the button's A column to minus
      await b.wireTool(false);
      b.check('four wires drawn', (await b.wires()).length === 4, JSON.stringify(await b.wires()));
      const bp = await b.D((i) => window.__dotbench.bench.get(i).pos, btn);
      await b.look(bp.x + 4, bp.z + 4, 120, 0.6);
      b.check('not pressed: the LED is dark', ((await b.part(led))?.outputs.brightness ?? 1) === 0);
      await b.page.screenshot({ path: join(out, 'tact-6mm-released.png') });
      const at = await b.D((p) => window.__dotbenchWb.table(p.x, p.z, 13), bp); // the plunger's top: the button stands in the board's holes, 8.5 mm up
      await b.page.mouse.move(at.x, at.y);
      await b.page.mouse.down();
      const on = (await until(async () => ((await b.part(led))?.outputs.brightness ?? 0) > 0.5, 5000, 100)) >= 0;
      b.check('pointer held on the plunger: the field is pressed and the LED is lit', on && (await b.part(btn))?.fields.pressed === true, JSON.stringify({ led: (await b.part(led))?.outputs, btn: (await b.part(btn))?.fields, pins: (await b.part(led))?.pins }));
      await sleep(500);
      await b.page.screenshot({ path: join(out, 'tact-6mm-pressed.png') });
      await b.page.mouse.up();
      await sleep(300);
      b.check('pointer up: released and dark', (await b.part(btn))?.fields.pressed === false && (await b.part(led))?.outputs.brightness === 0);
      const moved = await b.D((i) => window.__dotbench.bench.get(i).pos, btn);
      b.check('the press did not move the button', Math.abs(moved.x - bp.x) < 0.01 && Math.abs(moved.z - bp.z) < 0.01);

      // the latching button: a click toggles
      const lat = await b.place('dotbench.latching-button');
      const lp = await b.D((i) => window.__dotbench.bench.get(i).pos, lat);
      await b.look(lp.x, lp.z, 90, 0.55);
      const click = async () => { const p = await b.D((i) => window.__dotbenchWb.body(i), lat); await b.page.mouse.click(p.x, p.y); await sleep(400); };
      await click();
      b.check('latching: one click, it is latched and stays', (await b.part(lat))?.fields.latched === true);
      await b.page.screenshot({ path: join(out, 'latching-latched.png') });
      await click();
      b.check('latching: a second click releases it', (await b.part(lat))?.fields.latched === false);
    }
    b.check(`${theme}: no page errors`, b.problems.length === 0, b.problems.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FAIL  ' + (e.stack ?? e));
    failed++;
  } finally {
    failed += b.failed;
    await b.browser.close();
    b.server.kill();
  }
}
console.log(failed ? `buttons proof: ${failed} FAILED` : 'buttons proof: PASSED');
process.exit(failed ? 1 : 0);
