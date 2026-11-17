// The workbench scene of the link-preview picture: the Dot on the table running kodeOS, a breadboard with an LED and a
// resistor wired to its header, an Arduino Uno driving a servo.
//   npm run build && UX_PORT=4399 node scripts/og/og-scene.mjs      -> screenshots/og-scene.png (the stage, 2x)
// Then scripts/og/make-og.mjs lays the card out around it.
import { join } from 'node:path';
import { openBench, sleep, until } from '../proof-lib.mjs';
import { root } from '../ux-lib.mjs';

const num = (n, d) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? d : Number(process.argv[i + 1]);
};
const b = await openBench();
const { page, D } = b;
try {
  await b.ready();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(800);
  const place = async (id, x, z) => {
    const o = await D((i, at) => window.__dotbench.parts.place(i, i.split('.')[1], at).then((p) => p?.id ?? null), id, { x, z });
    await until(() => D((i) => window.__dotbenchWb.world.bodies.items.has(i), o), 25000, 150);
    await b.settled();
    return o;
  };
  const wire = (from, to, color) => D((f, t, c) => window.__dotbench.bench.addWire(f, t, c)?.id ?? null, from, to, color);

  const board = await place('dotbench.breadboard-half', 62, -82);
  const uno = await place('dotbench.uno-r3', -72, -66);
  const servo = await place('dotbench.servo', -62, 32);
  const led = await place('dotbench.led-red', 150, 40);
  const res = await place('dotbench.resistor', 150, 70);
  await b.look(40, 0, 420, 0.6, 0);
  await b.plug(res, 'A', `${board}.d6`);
  await b.plug(led, 'A', `${board}.c10`);
  await wire('device.EXP1', `${board}.a6`, '#e3b21a');
  await wire('device.GND', `${board}.a11`, '#1d1d1d');
  await wire(`${uno}.D9`, `${servo}.SIG`, '#d9632b');
  await wire(`${uno}.V5`, `${servo}.V5`, '#d9412b');
  await wire(`${uno}.GND_1`, `${servo}.GND`, '#1d1d1d');
  await D(() => window.__dotbench.select.clear());
  await b.settled();
  // the lock screen of kodeOS has had time to draw by now
  await b.look(num('--x', -100), num('--z', -22), num('--dist', 455), num('--pol', 0.74), num('--az', -0.3));
  await sleep(2500);
  const box = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({ path: join(root, 'screenshots', 'og-scene.png'), clip: box });
  console.log('written screenshots/og-scene.png', JSON.stringify(box), b.problems.length ? `problems: ${b.problems.join(' | ')}` : '');
} finally {
  await b.browser.close();
  b.server.kill();
}
