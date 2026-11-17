// Pictures of the wires and of the Kode modules on the Dot, for looking at (headless Chrome on the built site).
//
//   npm run build && UX_PORT=4398 node scripts/wires-mount-shots.mjs [--out <folder>] [--only wires,cross,modules] [--cost]
//
// Scenes: a wire from the Dot's header to a breadboard seen close from two sides; three wires crossing a board; the Dot
// with each of the five modules from the side at table level (anything under the table would show) and from above.
// --cost also measures the frame time with 60 parts and 40 wires. Pictures land in screenshots/workbench2/ (or --out).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, shots, sleep, until } from './proof-lib.mjs';

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? null : process.argv[i + 1];
};
const out = arg('--out') ?? shots;
const only = arg('--only')?.split(',') ?? ['wires', 'cross', 'modules'];
mkdirSync(out, { recursive: true });

const MODULES = [
  ['maker', 'dotbench.kode-maker', ['upright', 'turned']],
  ['robotics', 'dotbench.kode-robotics', ['upright', 'turned']],
  ['camera', 'dotbench.kode-camera-shape', ['upright', 'turned']],
  ['mesh', 'dotbench.kode-mesh-shape', ['upright']],
  ['hacking', 'dotbench.kode-hacking-shape', ['upright']],
];

async function run() {
  const b = await openBench();
  const { page, D } = b;
  try {
    await b.ready();
    const box = await page.$eval('canvas', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const shot = async (name) => {
      await b.settled();
      await sleep(700);
      await page.screenshot({ path: join(out, `${name}.png`), clip: box });
      console.log(`shot  ${name}`);
      if (b.problems.length) console.log('  page problems:', b.problems.splice(0).join('\n  '));
    };
    const place = async (id, x, z) => {
      const o = await D((i, at) => window.__dotbench.parts.place(i, i.split('.')[1], at).then((p) => p?.id ?? null), id, { x, z });
      await until(() => D((i) => window.__dotbenchWb.world.bodies.items.has(i), o), 25000, 150);
      await b.settled();
      return o;
    };
    const wire = (from, to, color) => D((f, t, c) => window.__dotbench.bench.addWire(f, t, c)?.id ?? null, from, to, color);
    const clear = async () => {
      await D(() => {
        const s = window.__dotbench.bench;
        s.removeMany?.(s.getState().objects.filter((o) => o.area === 'part').map((o) => o.id));
      });
      await D(() => window.__dotbench.select.clear());
      await b.settled();
    };
    const view = (x, z, dist, pol, az) => b.look(x, z, dist, pol, az);

    if (only.includes('wires')) {
      await clear();
      // as in the owner's picture: a breadboard behind the Dot, one wire from the header to a hole
      const bb = await place('dotbench.breadboard-half', 20, -125);
      await wire('device.EXP1', `${bb}.e12`, '#d9632b');
      await view(8, -70, 300, 0.5, 0);
      await shot('wire-header-to-breadboard-front');
      await view(8, -80, 240, 1.25, Math.PI / 2);
      await shot('wire-header-to-breadboard-side');
      await view(0, -60, 150, 1.1, Math.PI);
      await shot('wire-header-from-behind');
      // the other end in front of the Dot: the wire has the Dot between its ends
      await clear();
      const bf = await place('dotbench.breadboard-half', 0, 95);
      await wire('device.EXP3', `${bf}.c8`, '#2f6fdb');
      await wire('device.GND', `${bf}.B2_3`, '#1d1d1d');
      await view(0, 20, 360, 0.75, 0.5);
      await shot('wire-round-the-dot');
      // several wires between the same two things: they fan out
      await clear();
      const bn = await place('dotbench.breadboard-half', 0, -125);
      const colors = ['#d9412b', '#e3b21a', '#2f9e57', '#2f6fdb', '#1d1d1d'];
      for (let i = 0; i < 5; i++) await wire(`device.EXP${i + 1}`, `${bn}.${'abcde'[i]}${10 + i * 2}`, colors[i]);
      await view(0, -80, 250, 0.35, 0);
      await shot('wires-fan');
    }

    if (only.includes('cross')) {
      await clear();
      const mid = await place('dotbench.breadboard-half', 120, -20);
      const uno = await place('dotbench.uno-r3', 250, -20);
      await wire('device.EXP1', `${uno}.D13`, '#d9412b');
      await wire('device.EXP2', `${uno}.D12`, '#e3b21a');
      await wire('device.GND', `${uno}.GND_T`, '#1d1d1d');
      await wire(`${mid}.a3`, `${uno}.A0`, '#2f9e57');
      await view(125, -25, 430, 0.7, 0.25);
      await shot('wires-crossing-a-board');
      await view(125, -25, 330, 1.3, 0);
      await shot('wires-crossing-a-board-low');
    }

    if (only.includes('modules')) {
      for (const [name, id, sides] of MODULES) {
        await clear();
        const m = await place(id, 110, 0);
        for (const side of sides) {
          await D((i, s) => window.__dotbench.parts.mount(i, s), m, side);
          await until(() => D((i) => !!window.__dotbenchWb.world.bodies.items.get(i)?.mounted, m), 8000, 100);
          await D(() => window.__dotbench.select.clear());
          const tag = side === 'upright' ? '' : '-turned';
          // from the side, the eye at the table's level: the table is the line everything must stand on
          await view(0, -25, 330, 1.545, Math.PI / 2);
          await shot(`module-${name}${tag}-side`);
          if (side === 'upright') {
            await view(0, -30, 330, 0.04, 0);
            await shot(`module-${name}-above`);
            await view(0, -30, 300, 0.95, 0.6);
            await shot(`module-${name}-angle`);
          }
          await D((i) => window.__dotbench.parts.mount(i, null), m);
          await b.settled();
        }
      }
    }

    if (process.argv.includes('--cost')) {
      // the scene and the measure of workbench-proof's section p: 60 mixed parts, 40 wires between neighbours, the whole table in view
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
        let n = 0;
        for (let i = 0; i + 1 < ids.length && n < 40; i++) {
          const a = p.manifest(ids[i][1]).pins, c = p.manifest(ids[i + 1][1]).pins;
          if (s.addWire(`${ids[i][0]}.${a[0].name}`, `${ids[i + 1][0]}.${c[c.length - 1].name}`, ['#d9412b', '#2f6fdb', '#e9b824', '#2f9e5b'][n % 4])) n++;
        }
        return { parts: ids.length, wires: s.getState().wires.length, first: ids[0][0] };
      }, mix);
      await until(async () => (await b.engine()).parts.length === made.parts, 60000, 300);
      await sleep(2500);
      await D(() => window.__dotbenchWb.setView({ x: 0, z: -45, az: 0, pol: 0.72, dist: 1250 }));
      await sleep(1000);
      const perf = await D((first) => {
        const g = window.__dotbench3d, w = window.__dotbenchWb.world.wires, s = window.__dotbench.bench;
        g.bench(3);
        const frames = [g.bench(12), g.bench(12), g.bench(12)];
        const i = g.info();
        const time = (fn, n = 20) => {
          const t0 = performance.now();
          for (let k = 0; k < n; k++) fn();
          return (performance.now() - t0) / n;
        };
        // every wire made from nothing
        const all = time(() => {
          w.built?.clear();
          w.drawKey = '';
          w.draw();
        });
        // one part moved a step and back: what is made again
        const at = s.get(first).pos;
        let remade = [];
        const one = time(() => {
          s.moveMany([{ id: first, pos: { x: at.x + 5, z: at.z } }]);
          w.draw();
          remade.push(w.remade ?? 'all');
          s.moveMany([{ id: first, pos: at }]);
          w.draw();
        }, 10) / 2;
        // nothing changed
        const idle = time(() => w.draw(), 200);
        return { frames, calls: i.calls, triangles: i.rendered, wires: w.stats(), allWiresMs: all, onePartMovedMs: one, remadePerMove: remade.slice(0, 3), idleMs: idle };
      }, made.first);
      console.log('cost', JSON.stringify({ made, perf }));
      await shot('cost-60-parts-40-wires');
    }
    if (b.problems.length) console.log('page problems:', b.problems.join('\n'));
  } finally {
    await b.close();
  }
}

for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    await run();
    break;
  } catch (e) {
    console.log(`attempt ${attempt} failed: ${e.message}`);
  }
}
process.exit(0);
