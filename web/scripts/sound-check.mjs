// The Dot's speaker through the real page in headless Chrome: after a first click the page's AudioContext runs, KodeCity's
// game sound reaches the worklet (the sink level moves), going home closes the old program's context, and the Sound button
// in the status bar mutes it (kept across a reload).
//   npm run build && UX_PORT=4413 node scripts/sound-check.mjs
import { launch, sleep, startServer, until, BASE } from './ux-lib.mjs';

const server = await startServer();
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const page = await (await browser.createBrowserContext()).newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument(() => {
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dotbench.lang', '"en"');
    localStorage.setItem('dotbench.view', '"2d"');
  }
  // count the page's AudioContexts and remember them, to see the old ones closed
  const AC = window.AudioContext;
  window.__acs = [];
  window.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      window.__acs.push(this);
    }
  };
});
const D = (f, ...a) => page.evaluate(f, ...a);
const program = () => D(() => window.__dotbench.device().program.get());
const audio = () =>
  D(() => {
    const a = window.__dotbench.device().areas.audio;
    if (!a) return null;
    const s = a.stats();
    return { state: a.output.state, sink: a.level().source, peak: a.level().peak, frames: s.output.frames, open: s.codec.open, muted: a.muted };
  });
const contexts = () => D(() => window.__acs.map((c) => c.state));

try {
  await page.goto(BASE + '?debug', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dotbench, { timeout: 30000 });
  await until(async () => (await program())?.kind === 'os', 120000, 200);
  await until(async () => (await D(() => window.__dotbench.device().apps.get().length)) >= 14, 60000, 300);
  await sleep(6000);
  const pre = await audio();
  check('kodeOS has the speaker attached', !!pre && ['running', 'blocked'].includes(pre.state), JSON.stringify(pre));
  await page.mouse.click(640, 30); // the first gesture: the browser lets the page play sound
  await sleep(500);
  check('after a click the speaker runs', (await audio())?.state === 'running', JSON.stringify(await audio()));

  await page.click('[data-testid=apps-menu]');
  await page.waitForSelector('[data-testid=app-kodecity]');
  await page.click('[data-testid=app-kodecity]');
  await until(async () => (await program())?.name === 'KodeCity', 90000, 200);
  await page.keyboard.press('Escape');
  await sleep(8000);
  await page.keyboard.down('t');
  await sleep(150);
  await page.keyboard.up('t');
  await page.keyboard.down('ArrowUp');
  let best = 0;
  let a0 = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const a = await audio();
    a0 ??= a;
    best = Math.max(best, a?.sink === 'sink' ? a.peak : 0);
  }
  await page.keyboard.up('ArrowUp');
  const a1 = await audio();
  check('KodeCity runs with the speaker attached and running', a1?.state === 'running', JSON.stringify(a1));
  check('the game sound reaches the speaker (sink level)', best > 0.005, `peak ${best.toFixed(4)}, frames ${a1?.frames}`);
  const cs = await contexts();
  check('only the running program has an open AudioContext', cs.filter((s) => s !== 'closed').length === 1, cs.join(','));

  await page.click('[data-testid=sound-toggle]');
  await sleep(1500);
  let loud = 0;
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    const a = await audio();
    loud = Math.max(loud, a?.peak ?? 0);
  }
  const m = await audio();
  check('the Sound button mutes it', m?.muted === true && loud < 0.002, `muted ${m?.muted}, peak ${loud.toFixed(4)}`);
  check('the button shows off', (await page.$eval('[data-testid=sound-toggle]', (e) => e.dataset.muted)) === '1');

  await page.keyboard.down('b');
  await until(async () => (await program())?.kind === 'os', 30000, 100);
  await page.keyboard.up('b');
  await sleep(4000);
  const back = await audio();
  check('back in kodeOS the speaker is attached again and still muted', back?.muted === true, JSON.stringify(back));
  const cs2 = await contexts();
  check('the game\'s AudioContext was closed', cs2.filter((s) => s !== 'closed').length === 1, cs2.join(','));

  await page.click('[data-testid=sound-toggle]');
  check('the Sound button turns it back on', (await audio())?.muted === false);
  check('no console errors or page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill?.();
}
console.log(failed ? `${failed} FAILED` : 'all PASS');
process.exit(failed ? 1 : 0);
