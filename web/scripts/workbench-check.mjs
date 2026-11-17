// The Workbench, checked in the real page (headless Chrome, fresh profile, kodeOS running):
//   npm run build && node scripts/workbench-check.mjs [--no-shots] [--no-perf] [--only-shots]
// - the mode boots with kodeOS, the Dot's screen is live and takes touch in the scene (kodeOS is unlocked and the NFC
//   app opened by touch on the 3D screen);
// - an NFC tag dragged with the mouse from far to near is read by the app, dragged away it is gone, the switch moves it;
// - keyboard: nudge, turn, delete, undo; a remote's button pressed in 3D sends; the microSD card and the charger dock;
//   the tilt ball tilts the Dot; positions survive a reload; switching modes does not restart the program;
// - frame time with 1, 20 and 60 objects (SwiftShader here: a floor, not what a GPU does);
// - screenshots into web/screenshots/workbench/.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const args = new Set(process.argv.slice(2));
const shots = join(root, 'screenshots', 'workbench');
mkdirSync(shots, { recursive: true });
const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

let { page, problems, ctx } = await openPage(browser, { id: 'desk', w: 1440, h: 900 }, { mode: 'workbench' });
const D = (fn, ...a) => page.evaluate(fn, ...a);
const program = () => D(() => window.__dotbench.device().program.get());
const status = () => D(() => window.__dotbench.device().status.get());
const logText = () => D(() => window.__dotbench.device().log.get().map((l) => l.text).join('\n'));
const objects = () => D(() => window.__dotbench.bench.getState().objects);
const live = (id) => D((i) => window.__dotbench.live.get(i), id);
/** A screenshot; software GL on a busy machine can miss the browser's own deadline once, so it gets a second go. */
const shot = async (name) => {
  for (let i = 0; ; i++) {
    try {
      return await page.screenshot({ path: join(shots, `${name}.png`) });
    } catch (e) {
      if (i >= 1) throw e;
      await sleep(3000);
    }
  }
};
const wbReady = () => until(() => D(() => !!window.__dotbenchWb && window.__dotbench3d?.info().model !== 'pending' && window.__dotbench3d.rendered() > 2), 40000);
const settled = () => until(() => D(() => window.__dotbenchWb.settled()), 6000, 80);

/** Page coordinates of a screen pixel of the Dot, wherever the Dot is in the scene. */
const at = async (x, y) => {
  const p = await D((s) => window.__dotbench3d.project(s), `glass:${x},${y}`);
  return [p.x, p.y];
};
const tap = async (x, y, hold = 120) => {
  const [px, py] = await at(x, y);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await sleep(hold);
  await page.mouse.up();
};
const swipeLeft = async () => {
  const [x0, y0] = await at(360, 300);
  const [x1, y1] = await at(40, 300);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
    await sleep(40);
  }
  await page.mouse.up();
};
const ROW = [128, 240, 353, 465];
const goHome = async () => {
  if (!(await page.$('[data-testid=apps-manager]'))) await page.click('[data-testid=apps-menu]');
  await page.waitForSelector('[data-testid=apps-home]');
  await page.click('[data-testid=apps-home]');
  await page.keyboard.press('Escape');
  await until(async () => (await program())?.kind === 'os' && (await status()) === 'running', 60000, 200);
  await sleep(3000);
};
const openFromList = async (name, row) => {
  for (const r of [row, row - 1, row + 1].filter((r) => r >= 0 && r < ROW.length)) {
    await swipeLeft(); // lock screen -> launcher, by touch on the 3D screen
    await sleep(4500);
    await tap(200, 75);
    await sleep(2500);
    await tap(200, ROW[r]);
    if ((await until(async () => (await program())?.kind === 'app', 8000, 200)) < 0) continue;
    if ((await program()).name === name) {
      await sleep(3500);
      return true;
    }
    await goHome();
  }
  return false;
};
/** Drags with the mouse from one client point to another, in steps (the page follows the pointer on the window). */
const drag = async (from, to, steps = 14, hold = false) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(30);
  }
  if (!hold) await page.mouse.up();
};
const bodyAt = (id, part) => D((i, p) => window.__dotbenchWb.body(i, p), id, part);
const tableAt = (x, z) => D((a, b) => window.__dotbenchWb.table(a, b), x, z);
const obj = async (id) => (await objects()).find((o) => o.id === id);
const picture = () =>
  D(() => {
    const d = window.__dotbench.painter.canvas.getContext('2d').getImageData(0, 0, 410, 502).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4 * 17) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
    return h;
  });
const boots = async () => ((await logText()).match(/khal\.id this board/g) ?? []).length;

try {
  if (args.has('--only-shots')) await ctx.close();
  else {
  // ---- 1. the mode boots with kodeOS running, the Dot on the table
  await waitRunning(page, 90000);
  check('Workbench: the page opens in it and the scene is drawn', (await wbReady()) >= 0 && (await page.$eval('[data-testid=stage-3d]', (e) => e.dataset.mode)) === 'workbench');
  check('Workbench: kodeOS is the running program', (await program())?.kind === 'os' && (await status()) === 'running', JSON.stringify(await program()));
  await until(async () => /appmgr 'buttons_led' copied/.test(await logText()), 120000, 300);
  await sleep(2500);
  await page.click('[data-testid=welcome-dismiss]').catch(() => {});
  const tex0 = await D(() => window.__dotbench3d.textureVersion());
  await sleep(2500);
  check('Workbench: the Dot\'s screen in the scene is live (its texture keeps being refreshed)', (await D(() => window.__dotbench3d.textureVersion())) > tex0);
  const pose = await D(() => window.__dotbench3d.scene().getObjectByName('screen').getWorldDirection(new (window.__dotbench3d.scene().position.constructor)()).toArray());
  check('Workbench: the Dot lies face up on the table', pose[1] > 0.98, `screen normal ${pose.map((v) => v.toFixed(2))}`);
  if (!args.has('--no-shots')) await shot('desktop-empty');

  // ---- 2. touch on the 3D screen: unlock kodeOS
  await page.click('[data-testid=wb-focus-dot]');
  await sleep(1500);
  const before = await picture();
  await swipeLeft();
  await sleep(4500);
  check('Workbench: a swipe on the Dot\'s screen in the scene unlocks kodeOS (the picture changes to the launcher)', (await picture()) !== before);
  // kodeOS on its lock screen again for the next steps
  await page.click('[data-testid=restart]').catch(() => {});
  await sleep(1500);
  await until(async () => (await program())?.kind === 'os' && (await status()) === 'running', 90000, 200);
  await until(async () => /kaos\.storage sd mounted/.test((await logText()).split('\n').slice(-80).join('\n')), 60000, 200);
  await sleep(3500);

  // ---- 3. an NFC tag: the switch moves it, dragging it in and out is near and away
  await page.click('[data-testid="add-nfc.tag"]');
  await sleep(700);
  let tag = (await objects()).find((o) => o.kind === 'nfc.tag');
  check('NFC tag: added from the palette, it stands near the Dot and is selected', !!tag && tag.near && (await D((i) => window.__dotbench.select.has(i), tag.id)), JSON.stringify(tag?.pos));
  await page.click('[data-testid=row-object] [data-testid=row-near]');
  await settled();
  tag = await obj(tag.id);
  const farPos = tag.pos;
  check('NFC tag: the switch takes it out of range (it moves on the table)', !tag.near && Math.hypot(tag.pos.x, tag.pos.z + 14) > 46 + 15, JSON.stringify(tag.pos));
  const opened = await openFromList('NFC', 2);
  check('NFC app: opened from kodeOS by touch on the screen in the scene', opened);
  await page.click('[data-testid=wb-frame-all]');
  await sleep(1400);
  // drag it with the mouse from where it is to beside the Dot
  await drag(await bodyAt(tag.id), await tableAt(-43, -14), 16, true);
  if (!args.has('--no-shots')) await shot('range-while-dragging');
  await page.mouse.up();
  await sleep(500);
  tag = await obj(tag.id);
  check('NFC tag: dragged with the mouse from far to near, it is near (the switch follows)', tag.near && (await page.$eval('[data-testid=row-object]', (e) => e.dataset.near)) === 'true', JSON.stringify(tag.pos));
  check('NFC tag: it does not overlap the Dot and sits on the grid', Math.abs(tag.pos.x) >= 23.3 + 15 && tag.pos.x % 5 === 0 && tag.pos.z % 5 === 0, JSON.stringify(tag.pos));
  await page.click('[data-testid=wb-focus-dot]');
  await sleep(1400);
  await tap(205, 116); // Read
  const read = await until(async () => (await live(tag.id)).entries.some((e) => e.key === 'live.nfc.read'), 15000, 200);
  check('NFC app: Read now reads the tag that was dragged near', read >= 0, (await live(tag.id)).entries.map((e) => e.key).join(','));
  if (!args.has('--no-shots')) await shot('nfc-read-in-workbench');
  await page.click('[data-testid=wb-frame-all]');
  await sleep(1400);
  await drag(await bodyAt(tag.id), await tableAt(farPos.x, farPos.z), 16);
  await sleep(600);
  tag = await obj(tag.id);
  const gone = await D((i) => window.__dotbench.runtime.handle(i)?.info()?.near, tag.id);
  check('NFC tag: dragged away, it is away for the bench and gone for the Dot', !tag.near && gone === false, `near in the Dot's NFC area: ${gone}`);

  // ---- 4. switching modes does not restart the program (the NFC app keeps running) or lose the bench
  const b0 = await boots();
  const benchBefore = JSON.stringify(await objects());
  await page.click('[data-testid=mode-device]');
  await sleep(1500);
  const inDevice = (await page.$eval('[data-testid=stage-3d]', (e) => e.dataset.mode)) === 'device';
  await page.click('[data-testid=mode-workbench]');
  await sleep(1500);
  const p = await program();
  check('Mode switch: Device and back, the NFC app is still the running program, nothing rebooted, the bench is the same', inDevice && p?.kind === 'app' && p.name === 'NFC' && (await boots()) === b0 && JSON.stringify(await objects()) === benchBefore && (await status()) === 'running', `${JSON.stringify(p)}, boots ${b0} -> ${await boots()}`);
  await goHome();

  // ---- 5. keyboard: every drag has its keys; undo and redo
  await page.click('[data-testid=row-object] [data-testid=row-select]');
  await page.evaluate(() => document.activeElement?.blur());
  const k0 = (await obj(tag.id)).pos;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  let k = await obj(tag.id);
  check('Keyboard: arrows nudge the selected thing one grid step', k.pos.x === k0.x + 5 && k.pos.z === k0.z + 5, JSON.stringify(k.pos));
  await page.keyboard.press('r');
  check('Keyboard: R turns it a quarter', (await obj(tag.id)).rot === 1);
  await page.keyboard.press('n');
  await settled();
  check('Keyboard: N brings it near', (await obj(tag.id)).near === true);
  await page.keyboard.press('Delete');
  check('Keyboard: Delete removes it', !(await obj(tag.id)));
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  k = await obj(tag.id);
  check('Undo (Ctrl+Z): it is back where it was, near', !!k && k.near, JSON.stringify(k?.pos));
  await page.click('[data-testid=wb-undo]');
  await page.click('[data-testid=wb-undo]');
  await page.click('[data-testid=wb-redo]');
  k = await obj(tag.id);
  check('Undo and redo buttons walk the edits', !!k && k.rot === 1, JSON.stringify({ rot: k?.rot, near: k?.near }));

  // ---- 6. the remote: a button pressed in the scene sends
  await page.click('[data-testid="add-ir.remote"]');
  await settled();
  await sleep(400);
  await page.click('[data-testid=wb-frame-all]');
  await sleep(1400);
  const remote = (await objects()).find((o) => o.kind === 'ir.remote');
  const vol = await bodyAt(remote.id, 'Vol+');
  await page.mouse.move(vol.x, vol.y);
  await page.mouse.down();
  await sleep(250);
  const held = await D(() => window.__dotbenchWb.world.bodies.pressed);
  await page.mouse.up();
  const sent = await until(async () => (await live(remote.id)).entries.some((e) => e.key.startsWith('live.ir.remote')), 6000, 150);
  check('IR remote: pressing its Vol+ button in the scene sends (the bench hears what the Dot did with it)', sent >= 0 && held?.[1] === 'Vol+', (await live(remote.id)).entries.map((e) => `${e.key}:${e.vars?.button}`).join(','));

  // ---- 7. the microSD card: dragged out of the slot it is ejected, the switch puts it back
  const sdIn = () => D(() => window.__dotbench.device().areas.sd?.state().inserted);
  check('microSD: kodeOS boots with the card in the slot, and the scene shows it there', (await sdIn()) === true && (await until(() => D(() => window.__dotbenchWb.cardInserted() === true && window.__dotbenchWb.world.bodies.items.get('fx:sd').dock > 0.95), 5000)) >= 0);
  await drag(await bodyAt('fx:sd'), await tableAt(-110, 70), 16);
  await sleep(900);
  check('microSD: dragged out of the slot with the mouse, the card is ejected', (await sdIn()) === false, JSON.stringify(await D(() => window.__dotbench.bench.getState().fixtures['fx:sd'].pos)));
  await page.$eval('[data-testid=row-sd] [data-testid=row-near]', (e) => e.click());
  await sleep(1500);
  const sdBack = await D(() => ({ dock: window.__dotbenchWb.world.bodies.items.get('fx:sd').dock, seen: window.__dotbenchWb.cardInserted(), pos: window.__dotbench.bench.getState().fixtures['fx:sd'].pos }));
  check('microSD: its switch puts it back in the slot (the card flies in)', (await sdIn()) === true && sdBack.dock > 0.9, JSON.stringify(sdBack));

  // ---- 8. the charger plugs into the Dot; the tilt ball tilts it
  await page.click('[data-testid="add-power.charger"]');
  await sleep(1200);
  const cable = () => D(() => window.__dotbench.device().areas.power?.cable());
  const c1 = await cable();
  await page.click('[data-testid=inspector] [data-testid=toggle-near]');
  await sleep(1200);
  check('Charger: added, its cable is in the Dot; taken away with the switch, it is unplugged', c1 !== 'none' && (await cable()) === 'none', `${c1} -> ${await cable()}`);
  await page.click('[data-testid=row-dot] [data-testid=row-select]');
  await sleep(400);
  const h = await D(() => window.__dotbenchWb.handle());
  await drag(h, { x: h.x + 40, y: h.y - 60 }, 10);
  await sleep(500);
  const motion = (await objects()).find((o) => o.kind === 'motion.pose' && o.near);
  check('Tilt: dragging the amber ball tilts the Dot (pitch up, roll right) and the motion object follows', !!motion && motion.fields.pitch > 15 && motion.fields.roll > 8, JSON.stringify(motion?.fields));
  if (!args.has('--no-shots')) await shot('dot-tilted');
  await page.click('[data-testid=lay-flat]');
  await sleep(600);

  // ---- a palette tile dropped on the table lands where it was dropped (a real drop event with the tile's data)
  const dropAt = await tableAt(180, 110);
  await D((pt) => {
    const el = document.querySelector('[data-testid=webgl-canvas]');
    const dt = new DataTransfer();
    dt.setData('application/x-dotbench-kind', 'rfid.tag');
    for (const type of ['dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, dataTransfer: dt }));
  }, dropAt);
  await sleep(500);
  const fob = (await objects()).find((o) => o.kind === 'rfid.tag');
  check('Palette: a tile dropped on the table puts the object there (away from the Dot: out of range) and selects it', !!fob && Math.abs(fob.pos.x - 180) <= 5 && Math.abs(fob.pos.z - 110) <= 5 && !fob.near && (await D((i) => window.__dotbench.select.has(i), fob?.id)), JSON.stringify(fob?.pos));

  // ---- 9. a reload keeps the table
  const saved = JSON.stringify((await objects()).map((o) => [o.id, o.pos, o.rot, o.near]));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
  await waitRunning(page, 90000);
  await wbReady();
  check('Reload: every object is where it was, turned as it was, near or away as it was', JSON.stringify((await objects()).map((o) => [o.id, o.pos, o.rot, o.near])) === saved && (await page.$eval('[data-testid=stage-3d]', (e) => e.dataset.mode)) === 'workbench');
  const tagNow = await obj(tag.id);
  const applied = await until(() => D((i) => window.__dotbench.runtime.handle(i)?.info()?.near, tag.id).then((v) => v === tagNow.near), 20000, 300);
  check('Reload: the bench is applied again to the new kodeOS', applied >= 0);

  const real = problems.filter((x) => !/ExitStatus/.test(x));
  check('no page errors', real.length === 0, real.join(' | '));
  await ctx.close();
  }

  // ---- 10. frame time with 1, 20 and 60 objects (the whole table in view, 1280 x 720 window)
  if (!args.has('--no-perf')) {
    ({ page, problems, ctx } = await openPage(browser, { id: 'perf', w: 1280, h: 720 }, { mode: 'workbench' }));
    await waitRunning(page, 90000);
    await wbReady();
    const MIX = ['nfc.tag', 'nfc.card', 'rfid.tag', 'rfid.card', 'nfc.reader', 'wifi.router', 'ir.remote', 'rfid.reader', 'ir.tv'];
    const measure = async (n) => {
      await D(
        (count, mix) => {
          const b = window.__dotbench.bench;
          for (let i = b.getState().objects.length; i < count; i++) {
            const kind = mix[i % mix.length];
            // spread over the mat, so nothing has to search for room
            const o = b.add(kind, `${kind} ${i}`, { x: -290 + (i % 10) * 64, z: -240 + Math.floor(i / 10) * 72 });
            if (!o) throw new Error(`could not add ${kind}`);
          }
        },
        n,
        MIX,
      );
      await sleep(1200);
      await D(() => window.__dotbenchWb.setView({ x: 0, z: -45, az: 0, pol: 0.72, dist: 1250 }));
      await sleep(800);
      return D(() => {
        window.__dotbench3d.bench(3);
        const ms = window.__dotbench3d.bench(12);
        const i = window.__dotbench3d.info();
        return { ms, calls: i.calls, triangles: i.rendered };
      });
    };
    for (const n of [1, 20, 60]) {
      const r = await measure(n);
      console.log(`PERF  ${String(n).padStart(2)} objects: ${r.ms.toFixed(0)} ms per frame, ${r.calls} draw calls, ${r.triangles} triangles (SwiftShader, software GL: a floor)`);
      if (n === 60 && !args.has('--no-shots')) await shot('perf-60-objects');
      if (n === 60) check('60 objects: the draw calls stay bounded by the kinds, not the count (instancing)', r.calls < 190, `${r.calls} calls`);
    }
    // nothing is drawn while nothing changes
    await D(() => window.__dotbench.device().stop?.());
    await sleep(1500);
    const f0 = await D(() => window.__dotbench3d.rendered());
    await sleep(1500);
    check('Render on demand: with the Dot stopped and nothing moving, no frame is drawn', (await D(() => window.__dotbench3d.rendered())) - f0 <= 1, `${(await D(() => window.__dotbench3d.rendered())) - f0} frames in 1.5 s`);
    await ctx.close();
  }

  // ---- 11. screenshots: every object close up from two angles, a full table, three screen sizes
  if (!args.has('--no-shots')) {
    ({ page, problems, ctx } = await openPage(browser, { id: 'shots', w: 1440, h: 900 }, { mode: 'workbench', prefs: { 'dotbench.panel.console': false, 'dotbench.welcome': false } }));
    await waitRunning(page, 90000);
    await wbReady();
    await page.click('[data-testid=welcome-dismiss]').catch(() => {});
    const KINDS = ['nfc.tag', 'nfc.card', 'nfc.reader', 'rfid.card', 'rfid.tag', 'rfid.reader', 'wifi.router', 'ir.tv', 'ir.remote', 'power.charger', 'power.battery'];
    await D((ks) => {
      const b = window.__dotbench.bench;
      ks.forEach((k, i) => {
        const o = b.add(k, k);
        if (o && i % 3 === 2) b.setNear(o.id, false);
      });
      // something on the screens and lamps: the TV on, a second tag away
      const tv = b.getState().objects.find((o) => o.kind === 'ir.tv');
      b.setFields(tv.id, { power: true, channel: 3, volume: 35 });
      b.add('nfc.tag', 'nfc.tag 2', { x: 210, z: 120 });
    }, KINDS);
    await sleep(1500);
    await D(() => window.__dotbenchWb.frameAll());
    await sleep(2500);
    await shot('table-dozen-desktop');
    await D(() => window.__dotbenchWb.setView({ az: -0.6, pol: 1.0 }));
    await sleep(1500);
    await shot('table-dozen-low-angle');
    await D(() => window.__dotbench.ui.setTheme('dark'));
    await sleep(1200);
    await shot('table-dozen-dark');
    await D(() => window.__dotbench.ui.setTheme('light'));
    await sleep(600);
    await D(() => window.__dotbenchWb.frameAll());
    for (const kind of ['nfc.tag', 'rfid.tag', 'wifi.router', 'ir.tv', 'power.charger']) {
      await D((k) => window.__dotbenchWb.showRange(k), kind);
      await sleep(900);
      await shot(`range-${kind.split('.')[0]}`);
    }
    await D(() => window.__dotbenchWb.showRange(null));
    const ids = await D(() => [...window.__dotbench.bench.getState().objects.map((o) => [o.id, o.kind]), ['fx:sd', 'sd.card'], ['dot', 'dot']]);
    for (const [id, kind] of ids) {
      if (kind === 'motion.pose') continue;
      if (id === 'fx:sd') {
        await D(() => window.__dotbench.device().areas.sd?.eject());
        await sleep(1600);
      }
      for (const [name, az, pol] of [['a', 0.45, 0.9], ['b', -2.3, 1.15]]) {
        await D((i, a, p) => window.__dotbenchWb.focus(i, a, p), id, az, pol);
        await sleep(900);
        await (await page.$('[data-testid=stage]')).screenshot({ path: join(shots, `object-${kind}-${name}.png`) });
      }
    }
    await ctx.close();
    for (const vp of [{ id: 'tablet', w: 820, h: 1180, touch: true, tablet: true }, { id: 'phone', w: 390, h: 844, touch: true, phone: true }]) {
      ({ page, problems, ctx } = await openPage(browser, vp, { mode: 'workbench' }));
      await waitRunning(page, 90000);
      await wbReady();
      await D(() => {
        const b = window.__dotbench.bench;
        ['nfc.tag', 'rfid.tag', 'wifi.router', 'ir.tv', 'ir.remote', 'power.charger'].forEach((k) => b.add(k, k));
      });
      await sleep(1200);
      await D(() => window.__dotbenchWb.frameAll());
      await sleep(2500);
      await shot(`table-${vp.id}`);
      if (vp.phone) await page.click('[data-testid=tab-bench]').catch(() => {});
      else await page.click('[data-testid=drawer-bench]').catch(() => {});
      await sleep(900);
      await shot(`table-${vp.id}-panel`);
      await ctx.close();
    }
  }
} catch (e) {
  failed++;
  console.log('FAIL  the check itself threw:', e);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
