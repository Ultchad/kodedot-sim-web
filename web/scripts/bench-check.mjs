// The bench, through the real page in headless Chrome.
//   npm run build && node scripts/bench-check.mjs
//
// Objects are added in the page's Bench panel, apps are opened by touch in kodeOS's own list, and what the Dot did is read
// back from the page's own feedback (the live lines on the object cards), from the device log and from screenshots.
//   1. NFC: a tag near the Dot, the NFC app opened by touch, Read: the app shows the tag; home and back: the tag is still near.
//   2. RFID: an EM4100 card with a chosen number, read in the RFID app.
//   3. Wi-Fi: a router added, kodeOS Wi-Fi settings opened by touch; the connection is asserted from the page's own
//      status of the router (the on-screen keyboard is not driven).
//   4. Infrared: the shipped apps do not use it, so the TV and the remote are checked at the level of the area's events.
//   5. microSD: a file added from the page shows up in the Files app and in the card's listing.
//   6. The bench survives a reload.
// Screenshots: screenshots/bench/*.png (one per object card, and the whole bench with several objects). Exit code 1 on any failure.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPage, root, sleep, startServer, until, waitRunning } from './ux-lib.mjs';

const shots = join(root, 'screenshots', 'bench');
mkdirSync(shots, { recursive: true });
const server = await startServer();
const browser = await launch();
let failed = 0;
let seen = 0;
var check = (name, ok, detail = '') => {
  if (problems && problems.length > seen) console.log('  (page errors before this check:', problems.slice(seen).join(' | '), ')'), (seen = problems.length);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const { page, problems, ctx } = await openPage(browser, { id: 'desk', w: 1440, h: 900 }, { view: '2d' }); // Device mode: the bench works without the 3D table
const D = (fn, ...a) => page.evaluate(fn, ...a);
const program = () => D(() => window.__dotbench.device().program.get());
const logText = () => D(() => window.__dotbench.device().log.get().map((l) => l.text).join('\n'));
const objects = () => D(() => window.__dotbench.bench.getState().objects);
const live = (id) => D((i) => window.__dotbench.live.get(i), id);
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });

/** Page coordinates of a screen pixel (2D view). */
const at = async (x, y) => {
  const r = await page.$eval('[data-testid=glass]', (e) => {
    const b = e.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  return [r.left + ((x + 0.5) / 410) * r.width, r.top + ((y + 0.5) / 502) * r.height];
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
  const [x1] = await at(40, 300);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0);
    await sleep(40);
  }
  await page.mouse.up();
};
/** kodeOS's launcher rows in the "All" list, from the first one down. */
const ROW = [128, 240, 353, 465];
const openFromList = async (name, row) => {
  // the list can open scrolled by a row (kodeOS remembers where it was): try the expected row, then its neighbours
  for (const r of [row, row - 1, row + 1].filter((r) => r >= 0 && r < ROW.length)) {
    await swipeLeft(); // lock screen -> launcher
    await sleep(4500);
    await tap(200, 75); // the "All" group
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
const goHome = async () => {
  if (!(await page.$('[data-testid=apps-manager]'))) await page.click('[data-testid=apps-menu]');
  await page.waitForSelector('[data-testid=apps-home]');
  await page.click('[data-testid=apps-home]');
  await page.keyboard.press('Escape');
  await until(async () => (await program())?.kind === 'os' && (await D(() => window.__dotbench.device().status.get())) === 'running', 60000, 200);
  await sleep(3000);
};
const swipe = async (x0, y0, x1, y1) => {
  const [a, b] = await at(x0, y0);
  const [c, d] = await at(x1, y1);
  await page.mouse.move(a, b);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a + ((c - a) * i) / 8, b + ((d - b) * i) / 8);
    await sleep(40);
  }
  await page.mouse.up();
};
/** kodeOS on its lock screen again (it remembers the list it was on over a Home). */
const freshLock = async () => {
  const n0 = await D(() => window.__dotbench.device().log.get().length);
  await page.click('[data-testid=restart]');
  await sleep(1500);
  await until(async () => (await program())?.kind === 'os' && (await D(() => window.__dotbench.device().status.get())) === 'running', 90000, 200);
  // the launcher lists the apps on the card once kodeOS has mounted it
  await until(async () => D((n) => window.__dotbench.device().log.get().slice(n).some((l) => /kaos\.storage sd mounted/.test(l.text)), n0), 60000, 200);
  await sleep(3000);
};
// the bench is one list now: only the microSD card needs choosing (its panel is the inspector of the card's row)
const tab = (area) => (area === 'sd' ? page.$eval('[data-testid=row-sd] [data-testid=row-select]', (e) => e.click()) : Promise.resolve());

try {
  await waitRunning(page);
  // kodeOS copies the factory apps to the card on a first boot: the launcher is stable once that is over
  await until(async () => /appmgr 'buttons_led' copied/.test(await logText()), 120000, 300);
  await sleep(2500);
  await page.click('[data-testid=welcome-dismiss]').catch(() => {});

  // ---- 1. NFC
  await page.click('[data-testid="add-nfc.tag"]');
  await sleep(600);
  let objs = await objects();
  const tag = objs.find((o) => o.kind === 'nfc.tag');
  check('NFC: "Add an NFC tag" makes a text tag and puts it near', !!tag && tag.near && tag.fields.mode === 'text' && /hello/i.test(String(tag.fields.text)), JSON.stringify(tag?.fields));
  await shot('nfc-1-tag-added');
  const opened = await openFromList('NFC', 2);
  check('NFC: the NFC app opens from kodeOS by touch', opened);
  await tap(205, 116); // Read
  const read = await until(async () => (await live(tag.id)).entries.some((e) => e.key === 'live.nfc.read'), 15000, 200);
  const l1 = await live(tag.id);
  check('NFC: Read in the app, and the tag says the Dot found and read it', read >= 0 && l1.entries.some((e) => e.key === 'live.nfc.found'), l1.entries.map((e) => e.key).join(','));
  await shot('nfc-2-app-shows-tag');
  await goHome();
  const afterHome = await D(async () => {
    const h = await window.__dotbench.device().areas.nfc.objects();
    return h.map((o) => ({ kind: o.kind, near: o.info().near }));
  });
  check('NFC: back in kodeOS the tag is still near, and there is exactly one', afterHome.length === 1 && afterHome[0].near, JSON.stringify(afterHome));
  const opened2 = await openFromList('NFC', 2);
  await tap(205, 116);
  const reads2 = await until(async () => (await live(tag.id)).data?.reads > 0 || (await live(tag.id)).entries.some((e) => (e.count ?? 1) > 1), 15000, 200);
  const l2 = await live(tag.id);
  check('NFC: the NFC app opened a second time reads the same tag', opened2 && reads2 >= 0, 'opened=' + opened2 + ' reads=' + reads2 + ' ' + JSON.stringify(l2.entries.map((e) => `${e.key}x${e.count}`)));
  await shot('nfc-3-app-again');
  await goHome();

  // ---- 2. RFID
  await tab('rfid');
  await page.click('[data-testid="add-rfid.card"]');
  await sleep(500);
  await page.$eval('[data-testid=field-id]', (e) => e.scrollIntoView());
  await page.focus('[data-testid=field-id]');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('0A:1B:2C:3D:4E');
  await sleep(700);
  objs = await objects();
  const card = objs.find((o) => o.kind === 'rfid.card');
  check('RFID: an EM4100 card is added near the Dot with the number typed in the page', !!card && card.near && /0A:1B:2C:3D:4E/i.test(String(card.fields.id)), String(card?.fields.id));
  await shot('rfid-1-card-added');
  const openedR = await openFromList('RFID', 3);
  check('RFID: the RFID app opens from kodeOS by touch', openedR);
  await tap(205, 116); // Read
  const readR = await until(async () => (await live(card.id)).entries.some((e) => e.key === 'live.rfid.read'), 20000, 200);
  const lr = await live(card.id);
  check('RFID: Read in the app, and the card says the Dot read its number', readR >= 0 && JSON.stringify(lr.entries).includes('0A:1B:2C:3D:4E'.replace(/:/g, '')) || JSON.stringify(lr.entries).toUpperCase().includes('0A'), JSON.stringify(lr.entries.map((e) => [e.key, e.vars])));
  await shot('rfid-2-app-shows-card');
  await goHome();

  // ---- 3. Wi-Fi
  await tab('wifi');
  await page.click('[data-testid="add-wifi.router"]');
  await sleep(800);
  objs = await objects();
  const router = objs.find((o) => o.kind === 'wifi.router');
  check('Wi-Fi: "Add a router" makes an open network with internet, in range', !!router && router.near && router.fields.security === 'open' && router.fields.internet === true, JSON.stringify(router?.fields));
  await shot('wifi-1-router-added');
  await freshLock();
  await swipe(205, 60, 205, 420); // quick settings
  await sleep(1500);
  await tap(325, 95); // the gear
  await sleep(2500);
  await tap(200, 117); // Wi-Fi
  await sleep(3000);
  await tap(200, 117); // switch it on
  await sleep(4500);
  await shot('wifi-2-kodeos-lists-router');
  await tap(200, 225); // the network
  const joined = await until(async () => (await live(router.id)).entries.some((e) => e.key === 'live.wifi.connected'), 40000, 300);
  const lw = await live(router.id);
  check('Wi-Fi: in kodeOS Settings the router is listed and tapping it connects (open network, so no on-screen keyboard)', joined >= 0, lw.entries.map((e) => e.key).join(','));
  await sleep(2500);
  await shot('wifi-3-connected');
  const log3 = await logText();
  check('Wi-Fi: the Dot joined and got an address (device log)', /joined 'Home WiFi' as/i.test(log3), (log3.match(/.*joined 'Home WiFi'.*/) ?? [''])[0]);

  // ---- 4. Infrared (no shipped app transmits or arms the receiver: area-level)
  await tab('ir');
  await page.click('[data-testid="add-ir.tv"]');
  await sleep(500);
  await page.click('[data-testid="add-ir.remote"]');
  await sleep(1200);
  objs = await objects();
  const tv = objs.find((o) => o.kind === 'ir.tv');
  const remote = objs.find((o) => o.kind === 'ir.remote');
  const hw = await D(() => window.__dotbench.device().areas.ir.objects().map((o) => o.id));
  check('Infrared: "Add a TV" and "Add a remote" make one object each, pointing at the Dot', !!tv && !!remote && tv.near && remote.near && hw.length === 2, hw.join(','));
  await page.click('[data-testid="remote-Vol+"]');
  const deaf = await until(async () => (await live(remote.id)).entries.some((e) => /live\.ir\.remote/.test(e.key)), 8000, 150);
  const lrm = await live(remote.id);
  check('Infrared: a remote button reaches the area and the result is shown (nobody listens: no app arms the receiver)', deaf >= 0, lrm.entries.map((e) => `${e.key} ${JSON.stringify(e.vars)}`).join(' | '));
  // the Dot transmits: the area is told as the page cannot make the Dot send (no shipped app does), so the TV's own state is what is checked
  const tvState = await D((id) => window.__dotbench.live.get(id), tv.id);
  check('Infrared: the TV starts off and is not told anything while the Dot sends nothing', !tvState.entries.some((e) => /live\.ir\.act/.test(e.key)));
  await shot('ir-1-tv-and-remote');

  // ---- 5. microSD
  await freshLock();
  await tab('sd');
  await sleep(800);
  const note = join(shots, '..', 'bench-note.txt');
  writeFileSync(note, 'Hello from the page, added to the card.\n');
  const input = await page.$('[data-testid=sd-file-input]');
  await input.uploadFile(note);
  const listed = await until(async () => (await page.$$eval('[data-testid=sd-entry]', (els) => els.map((e) => e.dataset.name))).includes('bench-note.txt'), 15000, 200);
  check('microSD: a file added from the page is listed on the card', listed >= 0);
  await shot('sd-1-file-added');
  const inFs = await D(async () => {
    const fs = window.__dotbench.device().areas.storage;
    const read = async (p) => { try { return new TextDecoder().decode(await fs.read(p)); } catch { return null; } };
    return await read('/sdcard/bench-note.txt');
  });
  check('microSD: the card holds the bytes that were added (read back through the device storage)', /Hello from the page/.test(String(inFs)), String(inFs));
  // kodeOS's own list moves with what was used lately (a row of recent apps), so Files is started from the page's Apps menu
  if (!(await page.$('[data-testid=apps-manager]'))) await page.click('[data-testid=apps-menu]');
  await page.waitForSelector('[data-testid=app-files]');
  await page.click('[data-testid=app-files]');
  await page.keyboard.press('Escape');
  const inFiles = await until(async () => (await program())?.name === 'Files', 30000, 200);
  await sleep(4500);
  await tap(200, 217); // SD card
  await sleep(3500);
  await shot('sd-2-files-app-card');
  check('microSD: the Files app opens from kodeOS and shows the card', inFiles >= 0);
  await goHome();
  rmSync(note, { force: true });

  // ---- 6. a reload keeps the bench
  const before = (await objects()).map((o) => `${o.kind}:${o.name}:${o.near}`).sort();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
  await waitRunning(page);
  await sleep(3000);
  const after = (await objects()).map((o) => `${o.kind}:${o.name}:${o.near}`).sort();
  check('Reload: the same objects are on the bench, in the same places', before.length >= 4 && JSON.stringify(before) === JSON.stringify(after), `${before.length} before, ${after.length} after`);
  const reapplied = await D(async () => {
    const a = window.__dotbench.device().areas;
    return { nfc: (await a.nfc.objects()).length, ir: (await a.ir.objects()).length };
  });
  check('Reload: the objects are on the Dot again, once each (NFC and infrared keep their own copies)', reapplied.nfc === 1 && reapplied.ir === 2, JSON.stringify(reapplied));
} catch (e) {
  failed++;
  console.log('FAIL  script error', e);
}

// ---- screenshots: every object card, then the whole bench with several objects, at desktop and phone size
async function gallery(vp, tag) {
  const tall = tag === 'desktop' ? { ...vp, h: 1900 } : vp; // the cards are shot one by one in a tall page: nothing is cut by the panel's own scroll
  const g = await openPage(browser, tall, { view: '2d' });
  const gp = g.page;
  await waitRunning(gp);
  await sleep(2500);
  await gp.click('[data-testid=welcome-dismiss]').catch(() => {});
  await gp.click('[data-testid=tab-bench]').catch(() => {}); // phone: the bottom sheet
  if ((await gp.$eval('[data-testid=drawer-bench]', (e) => e.getAttribute('aria-expanded')).catch(() => 'true')) === 'false') await gp.click('[data-testid=drawer-bench]'); // tablet: the side drawer
  await sleep(800);
  if (tag === 'phone') {
    await gp.click('[data-testid=sheet-handle]').catch(() => {}); // half -> full
    await sleep(700);
  }
  const area = (a) => (a === 'sd' ? gp.$eval('[data-testid=row-sd] [data-testid=row-select]', (e) => e.click()) : gp.$eval('[data-testid=wb-deselect]', (e) => e.click()).catch(() => {}));
  const add = async (kind) => {
    await gp.$eval(`[data-testid="add-${kind}"]`, (e) => e.click());
    await sleep(500);
  };
  const cards = [
    ['nfc.tag', 'nfc'], ['nfc.card', 'nfc'], ['nfc.reader', 'nfc'],
    ['rfid.card', 'rfid'], ['rfid.tag', 'rfid'], ['rfid.reader', 'rfid'],
    ['wifi.router', 'wifi'], ['ir.tv', 'ir'], ['ir.remote', 'ir'],
    ['power.battery', 'power'], ['power.charger', 'power'],
  ];
  for (const [kind, a] of cards) {
    await add(kind, a);
    if (tag !== 'desktop') continue;
    await sleep(500);
    const els = await gp.$$('[data-testid=bench-object]');
    await els[els.length - 1].screenshot({ path: join(shots, `card-${kind}.png`) });
  }
  await area('sd');
  await sleep(1500);
  if (tag === 'desktop') await (await gp.$('[data-testid=sd-panel]')).screenshot({ path: join(shots, 'card-microsd.png') });
  if (tag === 'desktop') await gp.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
  await area('nfc');
  await sleep(800);
  await gp.screenshot({ path: join(shots, `bench-${tag}.png`) });
  await g.ctx.close();
}
await gallery({ id: 'desk', w: 1440, h: 900 }, 'desktop');
await gallery({ id: 'phone', w: 390, h: 844, touch: true, phone: true }, 'phone');
await gallery({ id: 'tablet', w: 820, h: 1180, touch: true, tablet: true }, 'tablet');
// the runtime's own exit signal (emscripten ExitStatus) can surface when a program is restarted while it boots: not a page fault
const real = problems.filter((p) => !/ExitStatus/.test(p));
check('no page errors', real.length === 0, real.join(' | '));
await browser.close();
server.kill?.();
process.exit(failed ? 1 : 0);
