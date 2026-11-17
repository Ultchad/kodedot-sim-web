/**
 * Passive buzzer: the 12 mm through-hole sounder (12 x 9.5 mm black can, sound hole 2.2 mm in the top with the
 * diaphragm showing through it, "+" moulded beside the positive pin, two round pins 7.6 mm apart; a passive one is
 * open underneath, with its little board showing). Size and terminals come from parts/buzzer/manifest.json.
 * Live state: `outputs.hz`. While it sounds, rings rise out of the sound hole, closer together and faster the higher
 * the pitch; silent, there is nothing to see.
 */
import manifestJson from '../../../../../parts/buzzer/manifest.json';
import { PAL, Shape, circleLoop, defineModel, footprintOf, part, partState, print, terminalsFromManifest, topQuad, type Object3D, type PartState } from '../../index';
import { asManifest, clamp01, setWave, waveRing } from './shared';
import type { Mesh } from 'three';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, h: H } = footprintOf(manifest.body);
const R = W / 2;
const LEGS = 5;
const HOLE = 1.2;
const TOP = H - 0.3; // the top face lies a little below its rim
const CAN = ['gloss', '#1b1b1e'] as const; // the can is shinier than the kit's matte black
const PLUS = terminals.find((t) => t.id === 'P') ?? terminals[0];
const WAVES = ['wave0', 'wave1', 'wave2'] as const;
const AMBER = 0xffac00;
const RISE = 6.5; // how far a ring travels before it is gone

function silence(obj: Object3D): void {
  for (let i = 0; i < WAVES.length; i++) {
    const ring = part(obj, WAVES[i]);
    if (ring) ring.visible = false;
  }
}

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    const seg = ctx.seg(32);
    // the little board that closes a passive buzzer, with its two solder joints
    s.disc(...PAL.pcbGreen, 0, 0, R - 0.45, 0.35, 1.0, 0.05, ctx.seg(24), { cap: true, ao: 1 });
    for (const t of terminals) {
      s.disc(...PAL.tin, t.pos[0], t.pos[2], 0.75, 0.15, 0.36, 0, 8, { cap: true, ao: 1 });
      s.rod(...PAL.tin, [t.pos[0], 0.6, t.pos[2]], [t.pos[0], -LEGS, t.pos[2]], 0.3, 8);
    }
    // the can: a rim at the foot, the wall, a rounded shoulder, a raised rim round the recessed top with the sound hole
    s.lathe(...CAN, 0, 0, [[R - 0.5, 0.75], [R - 0.12, 0.8], [R, 1.1], [R, H - 0.75], [R - 0.22, H - 0.25], [R - 0.75, H], [R - 1.25, H], [R - 1.5, TOP]], seg);
    s.disc(...CAN, 0, 0, R - 1.48, TOP - 1.1, TOP, 0, seg, { ao: 1, holes: [circleLoop(0, 0, HOLE, ctx.seg(16))] });
    // the diaphragm, seen through the hole
    s.disc(...PAL.aluminium, 0, 0, HOLE + 0.05, TOP - 1.6, TOP - 0.8, 0, ctx.seg(12), { ao: 1 });
    const root = s.toObject();
    root.add(
      print({
        name: 'top',
        quad: topQuad(0, 0, TOP + 0.02, R - 1.5, R - 1.5),
        ppm: 20,
        draw(g) {
          // the one mark a real buzzer carries: the "+" moulded beside the positive pin
          g.strokeStyle = 'rgba(236,232,224,0.86)';
          g.lineWidth = 0.34;
          g.lineCap = 'round';
          const x = PLUS.pos[0] * 0.84, y = PLUS.pos[2], a = 0.7;
          g.beginPath();
          g.moveTo(x - a, y);
          g.lineTo(x + a, y);
          g.moveTo(x, y - a);
          g.lineTo(x, y + a);
          g.stroke();
        },
      }),
    );
    for (const name of WAVES) {
      const ring = waveRing(name, AMBER, ctx.seg(28));
      ring.position.y = H - 0.4; // at rest inside the can
      root.add(ring);
    }
    return root;
  },
  animate(st, obj, env) {
    const hz = st.power.on ? Number(st.outputs.hz ?? 0) : 0;
    if (!(hz > 0)) {
      silence(obj);
      return;
    }
    // 100 Hz .. 8 kHz -> 1.1 .. 2.9 rings a second, each a little smaller: a higher note looks tighter and quicker
    const pitch = clamp01(Math.log2(hz / 100) / 6.32);
    const rate = 1.1 + 1.8 * pitch, reach = R * (1.05 - 0.3 * pitch);
    for (let i = 0; i < WAVES.length; i++) {
      const ring = part(obj, WAVES[i]) as Mesh | undefined;
      if (!ring) continue;
      const p = (env.time * rate * (1 / WAVES.length) + i / WAVES.length) % 1; // 0 at the hole, 1 gone
      setWave(ring, H + 0.15 + p * RISE, HOLE + 0.4 + p * (reach - HOLE), 0.75 * (1 - p) * Math.min(1, p * 10));
    }
    return true;
  },
  states: {
    silent: partState({ outputs: { hz: 0 } }),
    'tone-440': partState({ outputs: { hz: 440 } }),
    'tone-4000': partState({ outputs: { hz: 4000 } }),
  },
});
