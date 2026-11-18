// The project export, checked in the real page (headless Chrome, fresh profiles, kodeOS running):
//   npm run build && UX_PORT=4397 node scripts/project-pdf-check.mjs [--no-compile]
// Two benches are built (the guide's LED example on a breadboard wired to the Dot; an Uno driving a servo, with its
// sketch compiled in the page), exported as PDFs with the panel's button (by keyboard), checked with poppler and qpdf,
// then the table is emptied and the PDF is opened again: the bench must be the same, wires, legs in holes and sketch.
// A PDF without the attachment opens from its spare copy, a foreign PDF is refused, and a phone exports from its sheet.
// Every page of each PDF is rendered to web/screenshots/project-pdf/ to be looked at.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, sleep, until } from './proof-lib.mjs';
import { openPage, root, waitRunning } from './ux-lib.mjs';
import { openSheet } from './ux-scenes.mjs';

const compile = !process.argv.includes('--no-compile');
const out = join(root, 'screenshots', 'project-pdf');
const tmp = '/tmp/project-pdf-check';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  return ok;
};
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};

/** Everything that must come back: the bench as saved, what the engine holds, the legs in holes, the sketches. */
const snap = (D) =>
  D(() => {
    const d = window.__dotbench;
    const st = d.bench.getState();
    const e = d.parts.state();
    return {
      bench: JSON.parse(JSON.stringify(d.bench.exportData())),
      engineParts: e.parts.map((p) => `${p.instance}:${p.id}:${JSON.stringify(p.fields)}`).sort(),
      engineWires: e.wires.map((w) => `${w.from}>${w.to}`).sort(),
      plugs: [...d.parts.plugs()].map(([id, p]) => `${id}@${p.host}:${p.pairs.map((x) => x.join('=')).join(',')}`).sort(),
      sketches: st.objects.filter((o) => o.area === 'part' && d.parts.coreOf(o.kind)).map((o) => [o.id, d.parts.sketchOf(o.id)?.custom ?? null, d.parts.sketchOf(o.id)?.source ?? null]),
    };
  });
const same = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

/** Clicks through the export form by keyboard and returns the PDF the page offers for download. */
async function exportByKeyboard(page, D, title) {
  await D(() => {
    const real = URL.createObjectURL;
    window.__pdfBlob = null;
    URL.createObjectURL = (x) => {
      if (x instanceof Blob && x.type === 'application/pdf') window.__pdfBlob = x;
      return real.call(URL, x);
    };
  });
  await page.focus('[data-testid=project-export]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=project-title]');
  const focused = await D(() => document.activeElement?.getAttribute('data-testid'));
  const offered = await page.$eval('[data-testid=project-title]', (e) => e.value);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await until(() => D(() => !!window.__pdfBlob), 60000, 150);
  const b64 = await D(async () => {
    const b = new Uint8Array(await window.__pdfBlob.arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const message = await page.$eval('[data-testid=bench-file-message]', (e) => e.textContent).catch(() => '');
  return { bytes: Buffer.from(b64, 'base64'), focused, offered, message };
}
async function openFile(page, path) {
  await page.$eval('[data-testid=left-tab-bench]', (e) => e.click()).catch(() => {});
  await page.waitForSelector('[data-testid=bench-file-input]');
  // the message of the file before this one is marked, so the new one is told from it
  await page.$eval('[data-testid=bench-file-message]', (e) => (e.dataset.old = '1')).catch(() => {});
  await (await page.$('[data-testid=bench-file-input]')).uploadFile(path);
  await until(() => page.$eval('[data-testid=bench-file-message]', (e) => !e.dataset.old && e.textContent.length > 0).catch(() => false), 30000, 150);
  return page.$eval('[data-testid=bench-file-message]', (e) => e.textContent);
}
function examine(name, bytes, want) {
  const pdf = join(tmp, `${name}.pdf`);
  writeFileSync(pdf, bytes);
  const list = run('pdfdetach', ['-list', pdf]);
  run('pdfdetach', ['-save', '1', '-o', join(tmp, `${name}.json`), pdf]);
  let inside = null;
  try {
    inside = JSON.parse(readFileSync(join(tmp, `${name}.json`), 'utf8'));
  } catch {
    /* no attachment */
  }
  const text = run('pdftotext', ['-layout', pdf, '-']);
  const info = run('pdfinfo', [pdf]);
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  const qpdf = run('qpdf', ['--check', pdf]);
  check(`${name}: a valid PDF (${bytes.length} bytes, ${pages} pages) with the bench attached`, bytes.subarray(0, 5).toString() === '%PDF-' && /bench\.kodedot\.json/.test(list) && /No syntax or stream encoding errors/.test(qpdf), qpdf.split('\n').filter((l) => /error|warn/i.test(l)).join(' | ').slice(0, 200));
  check(`${name}: the attachment is the bench as the page holds it`, !!inside && inside.format === 'kodedot-bench' && JSON.stringify(inside.bench) === JSON.stringify(want.bench), inside ? `${inside.bench.objects.length} things, ${inside.bench.wires.length} wires, compiled sketches: ${Object.keys(inside.extras?.code ?? {}).join(',') || 'none'}` : 'no JSON inside');
  run('pdftoppm', ['-r', '150', '-png', pdf, join(out, name)]);
  return { text, pages, inside, pdf };
}

const b = await openBench({ prefs: { 'dotbench.left': 'bench' } });
const { page, D } = b;
try {
  await waitRunning(page, 90000);
  await b.wbReady();
  await page.click('[data-testid=welcome-dismiss]').catch(() => {});

  // ---- 1. the guide's LED example: breadboard, 220 ohm, red LED, EXP1 and GND of the Dot
  const ids = await D(async () => {
    const d = window.__dotbench;
    const put = async (id, at) => (await d.parts.place(id, id.replace('dotbench.', ''), at)).id;
    const bb = await put('dotbench.breadboard-half', { x: 130, z: 10 });
    const r = await put('dotbench.resistor', { x: 130, z: 90 });
    const led = await put('dotbench.led-red', { x: 160, z: 90 });
    d.bench.setField(r, 'ohms', 220);
    const board = d.bench.get(bb);
    const stand = (id, leg, hole) => {
      const o = d.bench.get(id);
      const h = d.parts.terms(board.kind).find((t) => t.name === hole), l = d.parts.terms(o.kind).find((t) => t.name === leg);
      d.bench.move(id, { x: board.pos.x + h.x - l.x, z: board.pos.z + h.z - l.z });
    };
    stand(r, 'A', 'a3');
    stand(led, 'A', 'b7');
    d.bench.addWire('device.EXP1', `${bb}.e3`, '#e9b824');
    d.bench.addWire(`${bb}.e8`, 'device.GND', '#26282c');
    return { bb, r, led };
  });
  await until(async () => (await b.engine()).wires.length === 6, 20000, 150);
  let before = await snap(D);
  check('LED bench: three parts, two jumpers, four legs in holes, all in the parts engine', before.engineParts.length === 3 && before.engineWires.length === 6 && before.plugs.length === 2, `${before.plugs.join(' ')}`);
  await D(() => window.__dotbenchWb.frameAll());
  await b.settled();
  await sleep(1500);
  await b.shot('../project-pdf/led-bench');
  const led = await exportByKeyboard(page, D, 'LED on EXP1');
  check('LED bench: the export button opens its form by keyboard, the title field has the focus and a default with the date', led.focused === 'project-title' && /^My project, /.test(led.offered), `"${led.offered}"; message: ${led.message}`);
  const ledPdf = examine('led', led.bytes, before);
  check('LED bench: the PDF names the parts, the nets and the value', ['LED on EXP1', 'U1', 'R1', 'D1', '220', 'EXP1', 'N1', 'GND', 'U1.EXP1', 'R1.A', 'D1.K', 'BB1', 'Made with KodeDot Sim', 'kodedot.murilogp.dev', 'Contents'].every((w) => ledPdf.text.includes(w)), ['LED on EXP1', 'U1', 'R1', 'D1', '220', 'EXP1', 'N1', 'GND', 'U1.EXP1', 'R1.A', 'D1.K', 'BB1', 'Made with KodeDot Sim'].filter((w) => !ledPdf.text.includes(w)).join(',') || `${ledPdf.pages} pages`);
  check('LED bench: the cover carries a picture of the table', /image|jpeg/i.test(run('pdfimages', ['-list', ledPdf.pdf])), run('pdfimages', ['-list', ledPdf.pdf]).split('\n').slice(2, 3).join(''));

  const empty = async () => {
    await D(() => {
      const s = window.__dotbench.bench;
      s.removeMany(s.getState().objects.map((o) => o.id));
    });
    await until(async () => (await b.engine()).parts.length === 0, 15000, 150);
  };
  await empty();
  check('LED bench: the table is empty', (await b.objects()).length === 0 && (await b.wires()).length === 0);
  let msg = await openFile(page, ledPdf.pdf);
  await until(async () => (await b.engine()).wires.length === 6, 30000, 200);
  let after = await snap(D);
  check('LED bench: the PDF opened again is the same bench (places, fields, wires, legs in holes, engine)', !same(before, after).length, same(before, after).map((k) => `${k}: ${JSON.stringify(before[k]).slice(0, 200)} -> ${JSON.stringify(after[k]).slice(0, 200)}`).join('; ') || msg);
  check('LED bench: the old bench file still opens', true === (await (async () => {
    writeFileSync(join(tmp, 'led.kodedot.json'), JSON.stringify(ledPdf.inside));
    await empty();
    await openFile(page, join(tmp, 'led.kodedot.json'));
    await until(async () => (await b.engine()).wires.length === 6, 30000, 200);
    return !same(before, await snap(D)).length;
  })()));

  // ---- a PDF whose attachment was taken out opens from the copy in its metadata; a foreign PDF is refused
  const bare = join(tmp, 'led-no-attachment.pdf');
  run('qpdf', ['--remove-attachment=bench.kodedot.json', ledPdf.pdf, bare]);
  check('No attachment: qpdf removed it', !/bench\.kodedot\.json/.test(run('pdfdetach', ['-list', bare])), run('pdfdetach', ['-list', bare]).trim());
  await empty();
  msg = await openFile(page, bare);
  await until(async () => (await b.engine()).wires.length === 6, 30000, 200);
  after = await snap(D);
  check('No attachment: the bench comes back from the spare copy, and the page says so', JSON.stringify(after.bench) === JSON.stringify(before.bench) && /spare copy/.test(msg), msg);
  const foreign = join(tmp, 'foreign.pdf');
  {
    const p2 = await b.browser.newPage();
    await p2.setContent('<h1>Just a page</h1>');
    writeFileSync(foreign, await p2.pdf());
    await p2.close();
  }
  msg = await openFile(page, foreign);
  check('Foreign PDF: a clear message, the table untouched', /no bench inside/.test(msg) && JSON.stringify((await snap(D)).bench) === JSON.stringify(before.bench), msg);
  writeFileSync(join(tmp, 'broken.pdf'), '%PDF-1.7\nthis is not a real file');
  msg = await openFile(page, join(tmp, 'broken.pdf'));
  check('Broken PDF: refused with a message', /no bench inside|could not be read/.test(msg), msg);

  // ---- 2. an Uno driving a servo, with its sketch
  await empty();
  const two = await D(async () => {
    const d = window.__dotbench;
    const uno = (await d.parts.place('dotbench.uno-r3', 'Uno', { x: 130, z: 0 })).id;
    const servo = (await d.parts.place('dotbench.servo', 'Servo', { x: 250, z: 0 })).id;
    d.bench.addWire(`${uno}.D9`, `${servo}.SIG`, '#e8792a');
    d.bench.addWire(`${uno}.V5`, `${servo}.V5`, '#d9412b');
    d.bench.addWire(`${uno}.GND_1`, `${servo}.GND`, '#26282c');
    return { uno, servo };
  });
  await until(async () => (await b.engine()).wires.length === 3, 20000, 150);
  let uploaded = false;
  if (compile) {
    await page.$eval('[data-testid=left-tab-components]', (e) => e.click());
    await D((i) => window.__dotbench.select.only(i), two.uno);
    await page.waitForSelector('[data-testid=part-code]');
    await page.click('[data-testid=part-code]');
    await page.waitForSelector('[data-testid=code-area] >>> .cm-content', { timeout: 30000 });
    await page.select('[data-testid=code-examples]', 'servo');
    await sleep(300);
    await page.click('[data-testid=code-upload]');
    await until(async () => ['failed', 'done', 'error'].includes(await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase)), 480000, 250);
    uploaded = (await page.$eval('[data-testid=code-editor]', (e) => e.dataset.phase)) === 'done';
    await page.click('[data-testid=code-close]');
    check('Servo bench: the sweep sketch compiled in the page and uploaded to the Uno', uploaded);
  }
  await D(() => window.__dotbench.select.clear());
  await page.$eval('[data-testid=left-tab-bench]', (e) => e.click());
  await page.waitForSelector('[data-testid=project-export]');
  await D(() => window.__dotbenchWb.frameAll());
  await b.settled();
  await sleep(1500);
  before = await snap(D);
  await b.shot('../project-pdf/servo-bench');
  const servo = await exportByKeyboard(page, D, 'Uno + servo sweep');
  const servoPdf = examine('servo', servo.bytes, before);
  // without the compile step the board still runs the sketch of its package, and that one is printed
  const servoWords = ['Uno + servo sweep', 'U1', 'M1', 'D9', '5V', 'GND', 'U1.D9', 'M1.SIG', 'Arduino Uno R3', 'Code', uploaded ? 'servo.attach(9)' : 'void setup()'];
  check('Servo bench: the PDF names the board, the servo, the nets and prints the sketch', servoWords.every((w) => servoPdf.text.includes(w)), servoWords.filter((w) => !servoPdf.text.includes(w)).join(','));
  if (compile) check('Servo bench: the compiled sketch travels in the attachment', Object.keys(servoPdf.inside?.extras?.code ?? {}).includes(two.uno), `${Object.keys(servoPdf.inside?.extras?.code ?? {})}`);
  await empty();
  msg = await openFile(page, servoPdf.pdf);
  await until(async () => (await b.engine()).wires.length === 3, 30000, 200);
  if (uploaded) await until(async () => (await snap(D)).sketches[0]?.[1] === true, 20000, 250);
  after = await snap(D);
  check('Servo bench: the PDF opened again is the same bench (parts, wires, the sketch as the board\'s own)', !same(before, after).length, same(before, after).map((k) => `${k}: ${JSON.stringify(before[k]).slice(0, 160)} -> ${JSON.stringify(after[k]).slice(0, 160)}`).join('; ') || msg);
  if (uploaded) {
    const angles = new Set();
    for (let i = 0; i < 40; i++) {
      angles.add(Math.round((await b.part(two.servo))?.outputs?.angle ?? -1));
      await sleep(80);
    }
    check('Servo bench: after the import the Uno runs its sketch without compiling again (the servo sweeps)', angles.size >= 4, `angles ${[...angles].sort((x, y) => x - y).slice(0, 8).join(',')}`);
  }
  // ---- 3. a busier bench: the Dot with the Robotics module and a motor, an Uno with three LEDs, a button, a switch, a servo, a potentiometer
  await empty();
  await D(async () => {
    const d = window.__dotbench;
    const put = async (id, at, fields) => {
      const o = await d.parts.place(`dotbench.${id}`, id, at);
      if (fields) d.bench.setFields(o.id, fields);
      return o.id;
    };
    const mod = await put('kode-robotics', { x: -150, z: -80 });
    d.parts.mount(mod, 'upright');
    const motor = await put('dc-motor', { x: -110, z: 60 });
    const uno = await put('uno-r3', { x: 130, z: -70 });
    const bb = await put('breadboard-half', { x: 130, z: 40 });
    const board = d.bench.get(bb);
    const stand = async (id, leg, hole, fields) => {
      const pid = await put(id, { x: 300, z: 150 }, fields);
      const o = d.bench.get(pid);
      const h = d.parts.terms(board.kind).find((t) => t.name === hole), l = d.parts.terms(o.kind).find((t) => t.name === leg);
      d.bench.move(pid, { x: board.pos.x + h.x - l.x, z: board.pos.z + h.z - l.z });
      return pid;
    };
    const wire = (a, b2, c) => d.bench.addWire(a, b2, c);
    const leds = ['led-red', 'led-yellow', 'led-green'];
    for (const [i, pin] of ['D3', 'D5', 'D6'].entries()) {
      const c = 2 + i * 8;
      await stand('resistor', 'A', `a${c}`, { ohms: 220 });
      await stand(leds[i], 'A', `b${c + 4}`);
      wire(`${uno}.${pin}`, `${bb}.e${c}`, ['#d9412b', '#e9b824', '#2f9e5b'][i]);
    }
    wire(`${bb}.e7`, `${uno}.GND_1`, '#26282c');
    wire(`${bb}.d15`, `${bb}.d7`, '#26282c');
    wire(`${bb}.d23`, `${bb}.d15`, '#26282c');
    await stand('push-button', 'A', 'c26');
    wire(`${uno}.D2`, `${bb}.e26`, '#2f6fdb');
    wire(`${bb}.e28`, `${bb}.c23`, '#26282c');
    const sw = await put('slide-switch', { x: 250, z: 60 });
    wire(`${uno}.D4`, `${sw}.COM`, '#8a52c7');
    wire(`${sw}.A`, `${uno}.V5`, '#d9412b');
    wire(`${sw}.B`, `${bb}.c7`, '#26282c');
    const servo = await put('servo', { x: 270, z: -70 });
    wire(`${uno}.D9`, `${servo}.SIG`, '#e8792a');
    wire(`${uno}.V5`, `${servo}.V5`, '#d9412b');
    wire(`${uno}.GND_2`, `${servo}.GND`, '#26282c');
    const pot = await put('potentiometer', { x: 290, z: 20 });
    wire(`${uno}.A0`, `${pot}.W`, '#e9b824');
    wire(`${pot}.T`, `${uno}.V5`, '#d9412b');
    wire(`${pot}.B`, `${bb}.a7`, '#26282c');
    wire(`${mod}.MOTA_1`, `${motor}.M1`, '#d9412b');
    wire(`${mod}.MOTA_2`, `${motor}.M2`, '#26282c');
    wire('device.EXP3', `${uno}.D0`, '#2f9e5b');
    wire('device.EXP4', `${uno}.D1`, '#eceae4');
    wire('device.GND', `${uno}.GND_T`, '#26282c');
  });
  await until(async () => (await b.engine()).parts.length === 14 && (await b.engine()).wires.length >= 22 + 14, 30000, 200);
  await D(() => window.__dotbenchWb.frameAll());
  await b.settled();
  await sleep(2000);
  before = await snap(D);
  await b.shot('../project-pdf/busy-bench');
  const busy = await exportByKeyboard(page, D, 'Sorting station: Dot, Robotics module and an Uno');
  const busyPdf = examine('busy', busy.bytes, before);
  check('Busy bench: the PDF has the Dot, the module, the Uno and every part on one drawing', ['U1', 'U2', 'U3', 'Kode Robotics', 'R1', 'R2', 'R3', 'D1', 'D2', 'D3', 'SW1', 'SW2', 'RV1', 'M1', 'M2', 'BB1', 'EXP3', 'D9', 'A0'].every((w) => busyPdf.text.includes(w)), ['U1', 'U2', 'U3', 'Kode Robotics', 'R1', 'R2', 'R3', 'D1', 'D2', 'D3', 'SW1', 'SW2', 'RV1', 'M1', 'M2', 'BB1', 'EXP3', 'D9', 'A0'].filter((w) => !busyPdf.text.includes(w)).join(',') || `${busyPdf.pages} pages, ${before.plugs.length} parts in holes, mounted: ${Object.keys(before.bench.mounts)}`);
  await empty();
  msg = await openFile(page, busyPdf.pdf);
  await until(async () => (await b.engine()).parts.length === 14 && (await b.engine()).wires.length === before.engineWires.length, 40000, 250);
  after = await snap(D);
  check('Busy bench: the PDF opened again is the same bench (the module on the header, legs in holes, 22 wires)', !same(before, after).length, same(before, after).map((k) => `${k}: ${JSON.stringify(before[k]).slice(0, 160)} -> ${JSON.stringify(after[k]).slice(0, 160)}`).join('; ') || msg);

  check('No page errors (the strict CSP included)', b.problems.length === 0, b.problems.slice(0, 4).join(' | '));
  await page.close();

  // ---- 4. Portuguese, on a phone: export and import from the sheet
  const phone = await openPage(b.browser, { id: '390x844', w: 390, h: 844, touch: true, phone: true }, { mode: 'workbench', lang: 'pt-BR', prefs: { 'dotbench.welcome': 'seen', 'dotbench.left': 'bench' } });
  const P = (fn, ...a) => phone.page.evaluate(fn, ...a);
  await waitRunning(phone.page, 90000);
  await phone.page.click('[data-testid=welcome-dismiss]').catch(() => {});
  await P(async (file) => {
    const d = window.__dotbench;
    await d.parts.importExtras(file.extras);
    d.bench.importData(file.bench);
  }, ledPdf.inside);
  await until(() => P(() => window.__dotbench.parts.state().wires.length === 6), 30000, 200);
  await sleep(1500);
  await openSheet(phone.page, 'bench');
  await phone.page.$eval('[data-testid=left-tab-bench]', (e) => e.click()).catch(() => {});
  await phone.page.waitForSelector('[data-testid=project-export]', { timeout: 10000 });
  await phone.page.$eval('[data-testid=project-export]', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const box = await phone.page.$eval('[data-testid=project-export]', (e) => {
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height, in: r.left >= 0 && r.right <= innerWidth };
  });
  check('Phone: the export button is in the sheet, inside the screen, at least 40 px tall', box.in && box.h >= 40, JSON.stringify(box));
  const pbefore = await snap(P);
  const pt = await exportByKeyboard(phone.page, P, 'LED no EXP1 (celular)');
  await phone.page.screenshot({ path: join(out, 'phone-sheet.png') });
  const ptPdf = examine('phone-pt', pt.bytes, pbefore);
  check('Phone: the PDF is in Portuguese', ['Esquema', 'Conexões', 'Lista de peças', 'Como remontar', 'Feito com o KodeDot Sim', 'LED vermelho', 'Conteúdo'].every((w) => ptPdf.text.includes(w)), ['Esquema', 'Conexões', 'Lista de peças', 'Como remontar', 'Feito com o KodeDot Sim', 'LED vermelho', 'Conteúdo'].filter((w) => !ptPdf.text.includes(w)).join(','));
  await P(() => {
    const s = window.__dotbench.bench;
    s.removeMany(s.getState().objects.map((o) => o.id));
  });
  await until(() => P(() => window.__dotbench.parts.state().parts.length === 0), 15000, 150);
  await (await phone.page.$('[data-testid=bench-file-input]')).uploadFile(ptPdf.pdf);
  await until(() => P(() => window.__dotbench.parts.state().wires.length === 6), 30000, 200);
  const pafter = await snap(P);
  check('Phone: the PDF opened from the sheet rebuilds the bench', !same(pbefore, pafter).length, same(pbefore, pafter).join(','));
  check('Phone: no page errors', phone.problems.length === 0, phone.problems.slice(0, 4).join(' | '));
} catch (e) {
  check('the script ran to its end', false, String(e?.stack ?? e).slice(0, 900));
} finally {
  await b.browser.close().catch(() => {});
  b.server.kill?.();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
