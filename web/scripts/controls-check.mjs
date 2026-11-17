// The buttons of the boards on the Workbench, checked in the real page (headless Chrome, fresh profile):
//   npm run build && UX_PORT=4397 node scripts/controls-check.mjs [--only buttons|modules]
// (UX_PORT: a port of your own, so that the page served is this checkout's build.)
// An Uno R3 and an ESP32-S3 are taken from the library. Reset is held with the mouse on the model and then on the
// part's card: the field is true while held, the sketch starts again (the serial log is empty, then begins with the
// sketch's first line). BOOT held on the model pulls IO0 to 0 V, let go it floats again; EN restarts the S3.
// The Robotics and Maker modules are put on the table for a picture. Screenshots: screenshots/workbench2/controls-*.png.
import { openBench, sleep, until } from './proof-lib.mjs';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const b = await openBench();
const { page, D } = b;
/** Client position of the top of a board's button: the model's own hit area for that field. */
const buttonAt = (id, field) =>
  D((i, f) => {
    const it = window.__dotbenchWb.world.bodies.items.get(i);
    it.dyn.updateMatrixWorld(true);
    const node = it.controls.find((n) => n.userData.control.field === f);
    const e = node?.getObjectByName('hit')?.matrixWorld.elements;
    return e ? window.__dotbenchWb.table(e[12], e[14], e[13] + 0.4) : null;
  }, id, field);
const field = (id, f) => D((i, k) => window.__dotbench.bench.get(i)?.fields[k] ?? null, id, f);
const serial = (id) => D((i) => window.__dotbench.parts.serial(i), id);
const capY = (id, f) =>
  D((i, k) => {
    const it = window.__dotbenchWb.world.bodies.items.get(i);
    return it.controls.find((n) => n.userData.control.field === k).position.y;
  }, id, f);
/** Waits until the board has printed at least `n` lines. */
const printed = (id, n, ms = 30000) => until(async () => (await serial(id)).length >= n, ms, 150);
/** Holds the mouse on a point, runs `during`, lets go. */
async function hold(p, during) {
  await page.mouse.move(p.x - 2, p.y - 1);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  try {
    return await during();
  } finally {
    await page.mouse.up();
  }
}

try {
  await b.ready();
  if (only !== 'modules') await buttons();
  if (only !== 'buttons') await modules();
  b.check('No page errors', b.problems.length === 0, b.problems.slice(0, 3).join(' ; '));
} catch (e) {
  b.failed++;
  console.log(`FAIL  the script stopped: ${e?.message ?? e}`);
  await b.shot('controls-stopped').catch(() => {});
} finally {
  await b.close();
}
console.log(b.failed ? `${b.failed} failed` : 'all passed');
process.exit(b.failed ? 1 : 0);

async function buttons() {
  // ---- Arduino Uno R3: reset
  const uno = await b.place('dotbench.uno-r3');
  await D((i) => window.__dotbenchWb.focus(i, 0.35, 0.55, 8), uno);
  await sleep(600);
  await printed(uno, 3);
  const before = await serial(uno);
  b.check('Uno R3: the sketch runs and prints', before.length >= 3 && /blinking/.test(before[0]), JSON.stringify(before.slice(0, 3)));
  const pos = await D((i) => ({ ...window.__dotbench.bench.get(i).pos }), uno);
  const up = await capY(uno, 'reset');
  let p = await buttonAt(uno, 'reset');
  b.check('Uno R3: the model has a hit area for the reset control', !!p, JSON.stringify(p));
  await hold(p, async () => {
    await until(async () => (await field(uno, 'reset')) === true, 3000, 50);
    b.check('Reset held on the model: the field is true in the bench and in the engine', (await field(uno, 'reset')) === true && (await b.part(uno))?.fields.reset === true);
    const cleared = await until(async () => (await serial(uno)).length < before.length, 8000, 50);
    b.check('Reset held on the model: the sketch starts again (the serial log begins anew)', cleared >= 0, `${before.length} lines before, ${(await serial(uno)).length} now`);
    await sleep(350);
    b.check('Reset held on the model: the plunger is down', up - (await capY(uno, 'reset')) > 0.4, `${(up - (await capY(uno, 'reset'))).toFixed(2)} mm`);
    b.check('Reset held on the model: the card shows the button held', (await page.$eval('[data-testid=pbutton-reset]', (e) => e.getAttribute('aria-pressed'))) === 'true');
    await b.shot('controls-uno-reset');
  });
  await until(async () => (await field(uno, 'reset')) === false, 3000, 50);
  b.check('Reset let go: the field is false, the plunger is up, the board did not move', (await field(uno, 'reset')) === false && Math.abs((await capY(uno, 'reset')) - up) < 0.01 && JSON.stringify(await D((i) => window.__dotbench.bench.get(i).pos, uno)) === JSON.stringify(pos));
  await printed(uno, 2);
  const again = await serial(uno);
  b.check('After the reset the monitor shows the sketch from its first line', /blinking/.test(again[0]) && again.length >= 2, JSON.stringify(again.slice(0, 2)));

  // the same button in the part's card
  await printed(uno, 3);
  const n = (await serial(uno)).length;
  const box = await (await page.$('[data-testid=pbutton-reset]')).boundingBox();
  await hold({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, async () => {
    await until(async () => (await field(uno, 'reset')) === true, 3000, 50);
    const cleared = await until(async () => (await serial(uno)).length < n, 8000, 50);
    b.check('Reset held in the card: the field is true and the sketch starts again', (await field(uno, 'reset')) === true && cleared >= 0, `${n} lines before, ${(await serial(uno)).length} now`);
    await sleep(300);
    b.check('Reset held in the card: the plunger on the model is down', up - (await capY(uno, 'reset')) > 0.4);
  });
  await until(async () => (await field(uno, 'reset')) === false, 3000, 50);
  b.check('Reset let go in the card: the field is false', (await field(uno, 'reset')) === false);
  b.check('The card shows Reset as a button, not as a switch', (await page.$('[data-testid=pfield-reset]')) === null);

  // ---- ESP32-S3: BOOT and EN
  const s3 = await b.place('dotbench.esp32-s3-devkitc');
  await D((i) => window.__dotbenchWb.focus(i, 0.35, 0.5, 6), s3);
  await sleep(600);
  await printed(s3, 2);
  const io0 = async () => (await b.part(s3))?.pins.IO0;
  const free = await io0();
  p = await buttonAt(s3, 'boot');
  await hold(p, async () => {
    await until(async () => (await field(s3, 'boot')) === true, 3000, 50);
    await until(async () => (await io0())?.floating === false, 4000, 80);
    const held = await io0();
    b.check('BOOT held on the model: IO0 is at 0 V', (await field(s3, 'boot')) === true && held.floating === false && held.mv < 300, `before ${JSON.stringify(free)}, held ${JSON.stringify(held)}`);
    b.check('BOOT held: the sketch keeps running (BOOT is not a reset)', (await serial(s3)).length >= 2);
    await sleep(300);
    await b.shot('controls-s3-boot');
  });
  await until(async () => (await io0())?.floating === true, 4000, 80);
  b.check('BOOT let go: IO0 is free again', (await field(s3, 'boot')) === false && (await io0()).floating === true, JSON.stringify(await io0()));
  await printed(s3, 3);
  const m = (await serial(s3)).length;
  p = await buttonAt(s3, 'en');
  await hold(p, async () => {
    const cleared = await until(async () => (await serial(s3)).length < m, 8000, 50);
    b.check('EN held on the model: the S3 starts its sketch again', (await field(s3, 'en')) === true && cleared >= 0, `${m} lines before, ${(await serial(s3)).length} now`);
  });
  await printed(s3, 1);
  b.check('After EN the monitor shows the sketch from its first line', /blinking/.test((await serial(s3))[0] ?? ''), JSON.stringify((await serial(s3)).slice(0, 2)));
  const labels = await page.$$eval('[data-testid=part-buttons] button', (e) => e.map((x) => x.textContent));
  b.check('The S3\'s card has its two buttons', labels.length === 2, labels.join(' | '));
}

/** The two bare modules on the table, seen as the maker's store photo shows them: for the picture beside it. */
async function modules() {
  const mak = await b.place('dotbench.kode-maker');
  const rob = await b.place('dotbench.kode-robotics');
  const at = await D((a, c) => [window.__dotbench.bench.get(a).pos, window.__dotbench.bench.get(c).pos], mak, rob);
  b.check('Both modules stand on the table with their bodies', !!(await b.part(mak)) && !!(await b.part(rob)), JSON.stringify(at));
  await page.mouse.click(700, 140); // nothing selected: no ring round a module in the picture
  await b.look((at[0].x + at[1].x) / 2, (at[0].z + at[1].z) / 2 + 8, Math.max(230, Math.hypot(at[0].x - at[1].x, at[0].z - at[1].z) * 2.6), 0.5, 0.42);
  await sleep(800);
  await b.shot('controls-modules');
}
