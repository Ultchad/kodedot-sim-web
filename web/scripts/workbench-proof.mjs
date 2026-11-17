// The Workbench, proved by mouse in the real page (headless Chrome, fresh profile, kodeOS running):
//   npm run build && node scripts/workbench-proof.mjs [--only a,b,...] [--no-shots]
// (a) breadboard + LED + resistor wired to a header pin and GND, the GPIO app of kodeOS drives the pin, the LED follows.
// (b) an Uno: its editor, blink compiled in the browser and uploaded, the LED blinks; a syntax error is reported on its line.
// (c) a servo driven from the board's sketch moves.
// (d) an LED without a resistor burns; repair restores it.
// (e) the Robotics module mounted on the Dot drives a motor (the header pins are driven through the engine's test hook).
// (f) the bench saved to a file, the page reloaded: everything is back; the file opens again.
// (g) Make your own: a .dotpart imported, listed, placed, kept; the starter zip, the AI prompt, the manual.
// (h) Bluetooth and USB: a sensor, a phone and a computer with bodies; the phone scans; the computer's terminal answers.
// (p) frame time with 60 mixed parts and 40 wires.
// The page sometimes freezes when an app starts (the firmware's BLE queue, not the bench): the run then starts again.
import { openBench, sleep, until } from './proof-lib.mjs';

const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').filter((x) => /^[a-hp]$/.test(x));
const want = (s) => !only.length || only.includes(s);
const noShots = process.argv.includes('--no-shots');
const ROW = [128, 240, 353, 465];
const numbers = {};

async function run(b) {
  const { page, D, check } = b;
  const shot = (n) => (noShots ? null : b.shot(n));
  const select = (id) => D((i) => window.__dotbench.select.only(i), id);
  const outputs = async (id) => (await b.part(id))?.outputs ?? {};
  await b.ready();

  if (want('a')) {
    const board = await b.place('dotbench.breadboard-half');
    const led = await b.place('dotbench.led-red');
    const res = await b.place('dotbench.resistor');
    // 220 ohm in the inspector, so that 3.3 V lights the LED well
    await D((i) => window.__dotbench.select.only(i), res);
    await page.waitForSelector('[data-testid=pfield-ohms]');
    await page.$eval('[data-testid=pfield-ohms]', (e) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '220');
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // by mouse: the LED and the resistor go into the board's holes (resistor column 6 to 10, LED anode column 10, cathode 11)
    await D(() => window.__dotbenchWb.frameAll());
    await sleep(600);
    await b.plug(res, 'A', `${board}.d6`);
    await b.plug(led, 'A', `${board}.c10`);
    const plugs = await D(() => [...window.__dotbench.parts.plugs()].map(([id, p]) => [id, p.host, p.pairs.map((x) => x.join('>')).join(' ')]));
    check('(a) the LED and the resistor dropped on the breadboard stand in its holes', plugs.length === 2 && plugs.every((p) => p[1] === board), JSON.stringify(plugs));
    const nets = async () => {
      const st = await b.engine();
      const pin = (i, p) => st.parts.find((x) => x.instance === i)?.pins[p]?.net;
      return { resB: pin(res, 'B'), ledA: pin(led, 'A'), ledK: pin(led, 'K'), resA: pin(res, 'A') };
    };
    await until(async () => (await nets()).resB !== undefined && (await nets()).resB === (await nets()).ledA, 5000, 100);
    let n = await nets();
    check('(a) legs in the same strip are one net in the engine (resistor B and LED anode), others are not', n.resB === n.ledA && n.ledK !== n.ledA && n.resA !== n.resB, JSON.stringify(n));

    // wires by mouse: header pin EXP1 to the resistor's strip, the LED's cathode strip to GND
    const hole = await b.termAt(`${board}.a6`);
    await b.look((hole.x + 11) / 2, (hole.z - 38) / 2, 210, 0.62);
    const tip1 = await b.wire('device.EXP1', `${board}.a6`, 2);
    const tip2 = await b.wire(`${board}.a11`, 'device.GND', 1);
    await b.wireTool(false);
    const wires = await b.wires();
    check('(a) two wires drawn terminal to terminal (names shown on hover), in the chosen colours', wires.length === 2 && wires[0].from === 'device.EXP1' && wires[0].to === `${board}.a6` && wires[1].to === 'device.GND' && wires[0].color !== wires[1].color && tip1.startsWith('a6') && tip2 === 'GND', `${JSON.stringify(wires)} tips: ${tip1} | ${tip2}`);
    const ew = (await b.engine()).wires.filter((w) => !w.id.startsWith('plug_'));
    check('(a) the engine has the same two wires', ew.length === 2, JSON.stringify(ew));
    await shot('a1-wired');

    // the GPIO app of kodeOS (opened from the installed apps) drives pin 1 high, then low
    await page.click('[data-testid=apps-menu]');
    await page.waitForSelector('[data-testid=app-gpio_kit]');
    await page.click('[data-testid=app-gpio_kit]');
    await page.keyboard.press('Escape');
    const opened = await until(async () => (await b.program())?.kind === 'app' && (await b.status()) === 'running', 60000, 200);
    check('(a) the GPIO app is running on the Dot', opened >= 0, JSON.stringify(await b.program()));
    await sleep(4000);
    await D(() => window.__dotbenchWb.frameAll());
    await sleep(500);
    const lit = async () => (await b.part(led))?.outputs?.brightness ?? 0;
    const before = await lit();
    await b.tap(200, ROW[0]); // Pins
    await sleep(1800);
    await b.tap(200, ROW[0]); // Pin 1
    await sleep(1800);
    await b.tap(200, ROW[1]); // Output
    await sleep(1800);
    await b.tap(295, 430); // High
    const on = await until(async () => (await lit()) > 0.2, 8000, 150);
    const hi = await lit();
    const st = await b.part(led);
    check('(a) pin 1 driven high in the GPIO app lights the LED', before < 0.01 && on >= 0 && hi > 0.2, `brightness ${before} -> ${hi}, ${st?.outputs?.current_ma} mA`);
    await shot('a2-led-on');
    await b.tap(115, 430); // Low
    const off = await until(async () => (await lit()) < 0.01, 8000, 150);
    check('(a) driven low, the LED goes out', off >= 0, `brightness ${await lit()}`);
  }

  // ---- (b) the Uno and its code
  let uno = null;
  if (want('b') || want('c') || want('f')) {
    uno = await b.place('dotbench.uno-r3');
    await select(uno);
    await page.waitForSelector('[data-testid=part-code]');
    await page.click('[data-testid=part-code]');
    await page.waitForSelector('[data-testid=code-area] >>> .cm-content', { timeout: 20000 });
    const first = await page.$eval('[data-testid=code-area] >>> .cm-content', (e) => e.textContent.length);
    check('(b) the Uno\'s Code opens an editor with the sketch the board runs', first > 40, `${first} characters`);
    await page.select('[data-testid=code-examples]', 'blink');
    await sleep(300);
    const status0 = await page.$eval('[data-testid=code-status]', (e) => e.textContent).catch(() => '');
    const t0 = Date.now();
    await page.click('[data-testid=code-upload]');
    let sawDownload = 0;
    const done = await until(async () => {
      const ph = await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase);
      if (ph === 'download') sawDownload++;
      return ph === 'done' || ph === 'failed' || ph === 'error';
    }, 420000, 200);
    numbers.firstCompileMs = Date.now() - t0;
    const ph = await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase);
    check('(b) blink compiled in the browser and uploaded (the compiler was fetched with its progress shown)', done >= 0 && ph === 'done' && sawDownload > 0, `${ph}, first compile ${numbers.firstCompileMs} ms, download seen ${sawDownload} times, before: "${status0}", after: "${await page.$eval('[data-testid=code-status]', (e) => e.textContent)}"`);
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      seen.add(Math.round((await outputs(uno)).led ?? -1));
      await sleep(70);
    }
    const log = await page.$eval('[data-testid=code-serial-log]', (e) => e.textContent);
    check('(b) the board\'s LED blinks and the serial monitor shows its lines', seen.has(0) && seen.has(1) && /on/.test(log) && /off/.test(log), `led values ${[...seen].join(',')}; serial: ${log.slice(-40).replace(/\n/g, ' | ')}`);
    check('(b) the uploaded sketch is the board\'s own now', await D((i) => window.__dotbench.parts.sketchOf(i)?.custom === true, uno));
    await shot('b1-editor-uploaded');

    // a deliberate syntax error on a known line
    await page.click('[data-testid=code-area] >>> .cm-content');
    await page.keyboard.down('Control');
    await page.keyboard.press('End');
    await page.keyboard.up('Control');
    await page.keyboard.type('\nint broken = ;');
    const lines = await page.$eval('[data-testid=code-area] >>> .cm-content', (e) => e.querySelectorAll('.cm-line').length);
    const t1 = Date.now();
    await page.click('[data-testid=code-upload]');
    await until(async () => ['failed', 'done', 'error'].includes(await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase)), 120000, 150);
    numbers.secondCompileMs = Date.now() - t1;
    const probs = await page.$$eval('[data-testid=code-problem]', (e) => e.map((x) => ({ line: Number(x.dataset.line), file: x.dataset.file, sev: x.dataset.severity, text: x.textContent.slice(0, 80) })));
    const inline = await page.$$eval('[data-testid=code-area] >>> .cm-lintRange-error', (e) => e.length);
    check('(b) a syntax error is reported on its line, in the list and in the text; nothing is uploaded', (await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase)) === 'failed' && probs.some((p) => p.sev === 'error' && p.line === lines && p.file === 'main.ino') && inline > 0, `line ${lines}: ${JSON.stringify(probs.slice(0, 2))}, inline marks ${inline}, ${numbers.secondCompileMs} ms`);
    await shot('b2-syntax-error');
    await page.keyboard.press('Delete'); // the editor has the keyboard: the board is not deleted by a stray key
    check('(b) keys pressed while the editor is open do not act on the table', (await b.objects()).some((o) => o.id === uno));
    await page.click('[data-testid=code-close]');
  }

  // ---- (c) a servo on the Uno
  if (want('c')) {
    const servo = await b.place('dotbench.servo');
    await b.beside(servo, uno, 80, 0);
    await b.lookAt(uno, servo);
    await b.wire(`${uno}.D9`, `${servo}.SIG`, 5);
    await b.wire(`${uno}.V5`, `${servo}.V5`, 0);
    await b.wire(`${uno}.GND_1`, `${servo}.GND`, 1);
    await b.wireTool(false);
    const w = (await b.wires()).filter((x) => x.to.startsWith(`${servo}.`));
    check('(c) the servo is wired to the Uno by mouse (signal, 5 V, ground)', w.length === 3, JSON.stringify(w.map((x) => `${x.from}>${x.to}`)));
    await select(uno);
    await page.click('[data-testid=part-code]');
    await page.waitForSelector('[data-testid=code-area] >>> .cm-content');
    await page.select('[data-testid=code-examples]', 'servo');
    await sleep(300);
    await page.click('[data-testid=code-upload]');
    await until(async () => ['failed', 'done', 'error'].includes(await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase)), 180000, 150);
    const ph = await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase);
    await page.click('[data-testid=code-close]');
    const angles = new Set();
    for (let i = 0; i < 40; i++) {
      angles.add(Math.round((await outputs(servo)).angle ?? -1));
      await sleep(80);
    }
    const a = [...angles].sort((x, y) => x - y);
    check('(c) the sweep sketch uploaded; the servo\'s angle moves', ph === 'done' && a.length >= 5 && a[a.length - 1] - a[0] >= 30, `${ph}; angles seen ${a[0]}..${a[a.length - 1]} (${a.length} values)`);
    await D(() => window.__dotbenchWb.frameAll());
    await shot('c-servo');
  }

  // ---- (d) an LED with no resistor
  if (want('d')) {
    const bat = await b.place('dotbench.battery-9v');
    const led = await b.place('dotbench.led-green');
    await b.beside(led, bat, 45, 0);
    await b.lookAt(bat, led);
    await b.wire(`${bat}.POS`, `${led}.A`, 0);
    await b.wire(`${bat}.NEG`, `${led}.K`, 1);
    await b.wireTool(false);
    const burnt = await until(async () => (await outputs(led)).burnt === true, 8000, 100);
    await select(led);
    await page.waitForSelector('[data-testid=part-hazards]', { timeout: 5000 }).catch(() => {});
    const hazard = await page.$eval('[data-testid=part-hazards]', (e) => e.textContent).catch(() => '');
    check('(d) an LED straight across 9 V burns, and the inspector says so', burnt >= 0 && hazard.length > 0, `burnt ${(await outputs(led)).burnt}; "${hazard.slice(0, 90)}"`);
    await shot('d1-burnt');
    // the wire to the battery's plus is taken away by mouse (click it, Delete), then the LED is replaced
    const wid = (await b.wires()).find((x) => x.from === `${bat}.POS`).id;
    const mid = await D((i) => window.__dotbenchWb.wire(i), wid);
    await page.mouse.click(mid.x, mid.y);
    const picked = await D((i) => window.__dotbench.select.has(i), wid);
    await page.keyboard.press('Delete');
    await sleep(300);
    const gone = !(await b.wires()).some((x) => x.id === wid);
    check('(d) a wire is selected by a click on it and removed with Delete', picked && gone, `picked ${picked}, gone ${gone}`);
    await select(led);
    await page.click('[data-testid=part-repair]');
    const fixed = await until(async () => (await outputs(led)).burnt === false, 5000, 100);
    check('(d) repair restores the LED', fixed >= 0, JSON.stringify(await outputs(led)));
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
  }

  // ---- (e) the Robotics module on the Dot's header
  if (want('e')) {
    const mod = await b.place('dotbench.kode-robotics');
    const motor = await b.place('dotbench.dc-motor');
    await select(mod);
    await page.waitForSelector('[data-testid=part-mount-upright]');
    await page.click('[data-testid=part-mount-upright]');
    const mounted = await until(async () => (await b.part(mod))?.mount?.orientation === 'upright', 5000, 100);
    const where = await D((i) => {
      const it = window.__dotbenchWb.world.bodies.items.get(i);
      const e = it.matrix.elements;
      return { x: e[12], y: e[13], z: e[14] };
    }, mod);
    check('(e) the Robotics module mounts on the Dot\'s header and sits past its top edge', mounted >= 0 && Math.abs(where.x) < 12 && where.z < -38 && where.z > -90, JSON.stringify(where));
    await b.beside(motor, mod, 70, -10);
    await b.lookAt(mod, motor, 0.5);
    await b.wire(`${mod}.MOTA_1`, `${motor}.M1`, 0);
    await b.wire(`${mod}.MOTA_2`, `${motor}.M2`, 1);
    await b.wireTool(false);
    // no installed app drives these three pins together: the header is driven through the engine's test hook
    await D(() => {
      const p = window.__dotbench.parts;
      p.drivePin(8, { mode: 'out', level: 1 }); // nSLEEP (GPIO19)
      p.drivePin(9, { mode: 'out', level: 1 }); // AIN1 (GPIO20)
      p.drivePin(7, { mode: 'out', level: 0 }); // AIN2 (GPIO21)
    });
    const turns = await until(async () => Math.abs((await outputs(motor)).speed ?? 0) > 0.2, 6000, 100);
    const fwd = (await outputs(motor)).speed;
    await D(() => {
      const p = window.__dotbench.parts;
      p.drivePin(9, { mode: 'out', level: 0 });
      p.drivePin(7, { mode: 'out', level: 1 });
    });
    await until(async () => ((await outputs(motor)).speed ?? 0) * fwd < -0.01, 6000, 100);
    const back = (await outputs(motor)).speed;
    check('(e) the motor on the module\'s output turns, and the other way when the inputs swap (engine test hook)', turns >= 0 && fwd * back < 0, `speed ${fwd} then ${back}`);
    await D(() => window.__dotbenchWb.focus('dot', 0.5, 0.75, 70));
    await shot('e-module-mounted');
    // turned over, then taken off
    await select(mod);
    await page.click('[data-testid=part-unmount]');
    await page.waitForSelector('[data-testid=part-mount-turned]');
    await page.click('[data-testid=part-mount-turned]');
    const turned = await until(async () => (await b.part(mod))?.mount?.orientation === 'turned', 5000, 100);
    check('(e) the module also mounts turned over', turned >= 0);
    await shot('e2-module-turned');
    await page.click('[data-testid=part-unmount]');
    await page.waitForSelector('[data-testid=part-mount-upright]');
    await page.click('[data-testid=part-mount-upright]');
  }

  // ---- (f) save, reload, everything back
  if (want('f')) {
    const snap = async () => {
      const st = await D(() => {
        const s = window.__dotbench.bench.getState();
        const e = window.__dotbench.parts.state();
        return {
          objects: s.objects.map((o) => [o.id, o.kind, Math.round(o.pos.x * 10), Math.round(o.pos.z * 10), o.rot]),
          wires: s.wires.map((w) => [w.id, w.from, w.to, w.color]),
          mounts: s.mounts,
          code: Object.keys(s.code),
          engineParts: e.parts.map((p) => p.instance).sort(),
          engineWires: e.wires.length,
          plugs: [...window.__dotbench.parts.plugs().keys()].sort(),
          mounted: e.parts.filter((p) => p.mount).map((p) => p.instance),
        };
      });
      st.custom = uno ? await D((i) => window.__dotbench.parts.sketchOf(i)?.custom === true, uno) : null;
      return st;
    };
    const before = await snap();
    // the file, as the Save button writes it
    await page.$eval('[data-testid=left-tab-bench]', (e) => e.click());
    await page.waitForSelector('[data-testid=bench-save]');
    const file = await D(async () => {
      const real = URL.createObjectURL;
      let blob = null;
      URL.createObjectURL = (x) => ((blob = x), real.call(URL, x));
      document.querySelector('[data-testid=bench-save]').click();
      for (let i = 0; i < 50 && !blob; i++) await new Promise((r) => setTimeout(r, 100));
      URL.createObjectURL = real;
      return blob ? await blob.text() : null;
    });
    check('(f) Save writes one file with the table, the wires, the code and the compiled sketches', !!file && JSON.parse(file).format === 'kodedot-bench' && JSON.parse(file).bench.wires.length === before.wires.length && (!uno || Object.keys(JSON.parse(file).extras.code).includes(uno)), file ? `${file.length} bytes` : 'no file');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await b.ready().catch(() => {});
    await until(async () => (await snap().catch(() => ({ engineParts: [] }))).engineParts.length === before.engineParts.length, 40000, 300);
    await until(async () => (await snap()).engineWires === before.engineWires && (await snap()).custom === before.custom, 15000, 300);
    const after = await snap();
    check('(f) after a reload everything is back: places, wires, legs in holes, the module on the Dot, the uploaded sketch', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after) === JSON.stringify(before) ? `${after.objects.length} parts, ${after.wires.length} wires, ${after.engineWires} engine links, plugs ${after.plugs.join()}, mounted ${after.mounted.join()}, custom sketch ${after.custom}` : `before ${JSON.stringify(before)}\n   after ${JSON.stringify(after)}`);
    if (uno) {
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        seen.add(JSON.stringify((await b.engine()).parts.map((x) => x.outputs)));
        await sleep(80);
      }
      check('(f) the board runs its uploaded sketch again without compiling', seen.size > 1, `${seen.size} different output states`);
    }
    // the table emptied, then the file opened again
    await D(() => {
      const s = window.__dotbench.bench;
      s.removeMany(s.getState().objects.map((o) => o.id));
    });
    await sleep(500);
    await page.$eval('[data-testid=left-tab-bench]', (e) => e.click());
    await page.waitForSelector('[data-testid=bench-file-input]');
    const input = await page.$('[data-testid=bench-file-input]');
    const { writeFileSync } = await import('node:fs');
    writeFileSync('/tmp/bench.kodedot.json', file ?? '{}');
    await input.uploadFile('/tmp/bench.kodedot.json');
    await until(async () => (await snap()).engineParts.length === before.engineParts.length && (await snap()).engineWires === before.engineWires, 30000, 300);
    const again = await snap();
    const differs = Object.keys(before).filter((k) => k !== 'custom' && JSON.stringify(again[k]) !== JSON.stringify(before[k]));
    check('(f) the saved file opens into the same bench', !differs.length, differs.length ? differs.map((k) => `${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(again[k])}`).join('; ').slice(0, 700) : `${again.objects.length} parts, ${again.wires.length} wires`);
    await page.$eval('[data-testid=left-tab-components]', (e) => e.click());
    await D(() => window.__dotbenchWb.frameAll());
    await shot('f-after-reload');
  }
  // ---- (g) own parts and the Make your own tab
  if (want('g')) {
    await page.$eval('[data-testid=left-tab-make]', (e) => e.click());
    await page.waitForSelector('[data-testid=make-panel]');
    const lib = JSON.parse((await import('node:fs')).readFileSync(new URL('../public/parts/library.json', import.meta.url), 'utf8'));
    const entry = lib.parts.find((x) => x.id === 'dotbench.hdc1080') ?? lib.parts[0];
    const file = new URL(`../public/parts/${entry.file}`, import.meta.url).pathname;
    await (await page.$('[data-testid=make-file]')).uploadFile(file);
    const ok = await until(() => page.$eval('[data-testid=make-message]', (e) => e.dataset.ok === 'true'), 20000, 200);
    const mine = await page.$$eval('[data-testid=make-part]', (e) => e.map((x) => x.dataset.id));
    check('(g) a .dotpart file chosen in Make your own is imported and listed', ok >= 0 && mine.includes(entry.id), mine.join());
    await page.click('[data-testid=make-place]');
    const placed = await until(async () => (await b.objects()).some((o) => o.kind === entry.id) && (await b.engine()).parts.some((x) => x.id === entry.id), 15000, 200);
    check('(g) the imported part goes on the table and into the engine', placed >= 0);
    const bad = new URL('../package.json', import.meta.url).pathname;
    await (await page.$('[data-testid=make-file]')).uploadFile(bad);
    const refused = await until(() => page.$eval('[data-testid=make-message]', (e) => e.dataset.ok === 'false'), 10000, 200);
    check('(g) a file that is not a part is refused with the reasons', refused >= 0, (await page.$eval('[data-testid=make-message]', (e) => e.textContent)).slice(0, 120));
    const zip = await D(async () => {
      const a = document.querySelector('[data-testid=make-starter]');
      const r = await fetch(a.href);
      const u = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, bytes: u.length, magic: String.fromCharCode(u[0], u[1]) };
    });
    check('(g) the starter folder downloads as a zip', zip.status === 200 && zip.magic === 'PK' && zip.bytes > 20000, JSON.stringify(zip));
    const prompt = await until(() => page.$eval('[data-testid=make-prompt-text]', (e) => e.value.length > 2000), 10000, 200);
    await page.click('[data-testid=make-copy]');
    await sleep(300);
    const copied = await page.$eval('[data-testid=make-copy]', (e) => e.textContent);
    await page.click('[data-testid=make-manual-toggle]');
    const manual = await page.$eval('[data-testid=make-manual]', (e) => e.textContent.length).catch(() => 0);
    check('(g) the AI prompt is there with a copy button, and the manual opens', prompt >= 0 && /Copied|Copiado/.test(copied) && manual > 2000, `copy button: "${copied.trim()}", manual ${manual} characters`);
    await shot('g-make-your-own');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await b.ready().catch(() => {});
    await page.$eval('[data-testid=left-tab-make]', (e) => e.click());
    const kept = await until(() => page.$$eval('[data-testid=make-part]', (e, id) => e.some((x) => x.dataset.id === id), entry.id), 20000, 300);
    const back = await until(async () => (await b.engine()).parts.some((x) => x.id === entry.id), 20000, 300);
    check('(g) after a reload the imported part is still in the list and on the table', kept >= 0 && back >= 0);
    await page.click('[data-testid=make-remove]');
    await sleep(400);
    check('(g) an imported part can be removed from the list', (await page.$$('[data-testid=make-part]')).length === 0);
    await page.$eval('[data-testid=left-tab-components]', (e) => e.click());
  }

  // ---- (h) Bluetooth and USB things on the bench
  if (want('h')) {
    // a table of its own: the wired parts of the sections before are put away
    await D(() => {
      const s = window.__dotbench.bench;
      s.removeMany(s.getState().objects.filter((o) => o.area === 'part').map((o) => o.id));
    });
    await page.$eval('[data-testid=left-tab-bench]', (e) => e.click());
    await page.waitForSelector('[data-testid="add-ble.sensor"]');
    const idOf = async (kind) => D((k) => window.__dotbench.bench.getState().objects.find((o) => o.kind === k)?.id ?? null, kind);
    for (const k of ['ble.sensor', 'ble.phone', 'usb.computer']) await page.$eval(`[data-testid="add-${k}"]`, (e) => e.click());
    await sleep(800);
    const ids = { sensor: await idOf('ble.sensor'), phone: await idOf('ble.phone'), pc: await idOf('usb.computer') };
    const bodies = await D((x) => Object.values(x).every((i) => window.__dotbenchWb.world.bodies.items.has(i)), ids);
    const soon = await page.$('[data-testid=soon-list]');
    check('(h) a Bluetooth sensor, a phone and a computer are on the table with bodies; nothing is "coming soon" any more', !!ids.sensor && !!ids.phone && !!ids.pc && bodies && !soon, JSON.stringify(ids));
    // the phone in range scans for the Dot
    await D((i) => window.__dotbench.bench.setNear(i, true), ids.phone);
    await D((i) => window.__dotbench.select.only(i), ids.phone);
    await page.waitForSelector('[data-testid=phone-scan]');
    const inRange = await D((i) => window.__dotbench.bench.get(i).near, ids.phone);
    await until(() => D((i) => !!window.__dotbench.runtime.handle(i), ids.phone), 40000, 300); // the Dot's Bluetooth is up
    await until(() => page.$eval('[data-testid=phone-scan]', (e) => !e.disabled), 8000, 200);
    await page.click('[data-testid=phone-scan]');
    await until(() => page.$eval('[data-testid=phone-message]', (e) => e.textContent.length > 3 && !/…/.test(e.textContent)), 12000, 200);
    const scan = await page.$eval('[data-testid=phone-message]', (e) => e.textContent);
    check('(h) the phone, brought in range, scans and says what it found', inRange && scan.length > 3, `in range ${inRange}: ${scan}`);
    // the computer: plugged, its terminal answers
    await D((i) => window.__dotbench.bench.setNear(i, true), ids.pc);
    await D((i) => window.__dotbench.select.only(i), ids.pc);
    await page.waitForSelector('[data-testid=usb-type]');
    const plugged = await until(() => page.$eval('[data-testid=usb-type]', (e) => !e.disabled), 15000, 200);
    await page.type('[data-testid=usb-type]', 'ping');
    await page.keyboard.press('Enter');
    const pong = await until(() => page.$eval('[data-testid=usb-terminal]', (e) => /pong/i.test(e.textContent)), 15000, 200);
    check('(h) the computer plugs into the Dot\'s USB-C port and its terminal answers "ping"', plugged >= 0 && pong >= 0, (await page.$eval('[data-testid=usb-terminal]', (e) => e.textContent)).slice(-120).replace(/\s+/g, ' '));
    // one connector: the charger plugged on its USB cable takes the computer's cable out
    await page.$eval('[data-testid="add-power.charger"]', (e) => e.click()).catch(() => {});
    await sleep(500);
    const ch = await idOf('power.charger');
    await D((i) => window.__dotbench.bench.setNear(i, true), ch);
    await sleep(500);
    const one = await D((a, c) => [window.__dotbench.bench.get(a).near, window.__dotbench.bench.get(c).near], ch, ids.pc);
    check('(h) the charger and the computer share the one port: plugging one unplugs the other', one[0] === true && one[1] === false, JSON.stringify(one));
    await D((i) => window.__dotbench.bench.setNear(i, true), ids.pc);
    await D(() => window.__dotbenchWb.frameAll());
    await sleep(1500);
    await shot('h-bluetooth-usb');
    await page.$eval('[data-testid=left-tab-components]', (e) => e.click());
  }

  // ---- frame time with 60 mixed parts and 40 wires (a table of its own, put there by the page's own store)
  if (want('p') || !only.length) {
    await D(() => {
      const s = window.__dotbench.bench;
      s.removeMany(s.getState().objects.map((o) => o.id));
    });
    const mix = ['dotbench.led-red', 'dotbench.resistor', 'dotbench.push-button', 'dotbench.uno-r3', 'dotbench.servo', 'dotbench.led-green', 'dotbench.potentiometer', 'dotbench.breadboard-half', 'dotbench.dc-motor', 'dotbench.capacitor-electrolytic'];
    const made = await D(async (kinds) => {
      const p = window.__dotbench.parts, s = window.__dotbench.bench;
      const ids = [];
      for (let i = 0; i < 60; i++) {
        const o = await p.place(kinds[i % kinds.length], `part ${i}`, { x: -295 + (i % 10) * 64, z: -250 + Math.floor(i / 10) * 74 });
        if (o) ids.push([o.id, o.kind]);
      }
      // 40 wires between pins of neighbours
      let n = 0;
      for (let i = 0; i + 1 < ids.length && n < 40; i++) {
        const a = p.manifest(ids[i][1]).pins, c = p.manifest(ids[i + 1][1]).pins;
        if (s.addWire(`${ids[i][0]}.${a[0].name}`, `${ids[i + 1][0]}.${c[c.length - 1].name}`, ['#d9412b', '#2f6fdb', '#e9b824', '#2f9e5b'][n % 4])) n++;
      }
      return { parts: ids.length, wires: s.getState().wires.length };
    }, mix);
    await until(async () => (await b.engine()).parts.length === made.parts, 60000, 300);
    await sleep(2500);
    await D(() => window.__dotbenchWb.setView({ x: 0, z: -45, az: 0, pol: 0.72, dist: 1250 }));
    await sleep(1000);
    const perf = await D(() => {
      window.__dotbench3d.bench(3);
      const ms = window.__dotbench3d.bench(12);
      const i = window.__dotbench3d.info();
      return { ms, calls: i.calls, triangles: i.rendered, wires: window.__dotbenchWb.wireStats() };
    });
    numbers.frame60parts40wires = perf;
    check('frame time with 60 mixed parts and 40 wires is measured', made.parts === 60 && made.wires === 40 && perf.wires.wires === 40, JSON.stringify(perf));
    await shot('p-60-parts-40-wires');
  }
  if (b.problems.length) console.log(`page problems: ${b.problems.slice(0, 5).join(' | ').slice(0, 600)}`);
}

let failed = 1;
for (let attempt = 1; attempt <= 3; attempt++) {
  const b = await openBench();
  let hung = false;
  try {
    await run(b);
  } catch (e) {
    hung = /timed out|Target closed|detached/i.test(String(e));
    if (!hung || attempt === 3) {
      b.failed++;
      console.log('FAIL  the check itself threw:', e);
    } else console.log(`-- the page stopped answering (${String(e).slice(0, 90)}); starting again, attempt ${attempt + 1}`);
  } finally {
    await Promise.race([b.close(), sleep(15000)]);
  }
  failed = b.failed;
  if (!hung) break;
}
console.log(`numbers: ${JSON.stringify(numbers)}`);
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
