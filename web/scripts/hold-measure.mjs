// Measures, against the running firmware (Node, no browser), how long the bottom button must be held to leave each factory app:
// press -> the firmware's own restart request (the device's 'restart-requested' status, raised when the program asks for the reset),
// and press -> the system's 'booting' status (what the page sees). Prints a table and checks it against web/src/lib/homeHold.ts.
//   usage: DOTBENCH_BUILD=<build dir with apps/<name>/<name>.dotbench> node scripts/hold-measure.mjs [app ...]
// The numbers are firmware time as the wall clock sees it; a loaded machine adds a few tens of ms.
import fs from 'node:fs';
import path from 'node:path';
import { makeSystem, tmpDir, sleep, waitFor, FULL_FACTORY, fullFactoryJson } from '../../tests/node/boot/lib.mjs';

const only = process.argv.slice(2);
const apps = only.length ? only : FULL_FACTORY;
const rows = [];
for (const name of apps) {
  const dir = tmpDir('hold-measure-');
  const sys = makeSystem(dir, { factory: fullFactoryJson });
  let restartAt = 0;
  let bootingAt = 0;
  sys.device.on('status', (s) => { if (s.status === 'restart-requested' && !restartAt) restartAt = performance.now(); });
  sys.on('status', (s) => { if (s.status === 'booting' && !bootingAt) bootingAt = performance.now(); });
  try {
    await sys.start();
    await waitFor(() => sys.program?.kind === 'os', 120000, 'kodeOS', sys);
    await sleep(3000);
    const app = sys.list().find((a) => a.project === name);
    if (!app) throw new Error('not installed: ' + name);
    await sys.launch(app.id);
    await waitFor(() => sys.program?.kind === 'app', 60000, name + ' runs', sys);
    await sleep(3500);
    restartAt = 0; bootingAt = 0;
    const t0 = performance.now();
    sys.button('bottom', true);
    await waitFor(() => bootingAt > 0, 30000, name + ' leaves', sys);
    sys.button('bottom', false);
    rows.push({ name, restart: Math.round(restartAt - t0), booting: Math.round(bootingAt - t0) });
    console.log(`${name.padEnd(14)} firmware restart request after ${String(rows.at(-1).restart).padStart(5)} ms, page sees booting after ${String(rows.at(-1).booting).padStart(5)} ms`);
  } catch (e) {
    rows.push({ name, error: String(e.message).split('\n')[0] });
    console.log(`${name.padEnd(14)} ${rows.at(-1).error}`);
  } finally {
    try { sys.stop(); sys.dispose(); } catch { /* done */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
fs.writeFileSync(path.join(process.env.HOLD_MEASURE_OUT || '/tmp/hold-measure.json'), JSON.stringify(rows, null, 1));
process.exit(0);
