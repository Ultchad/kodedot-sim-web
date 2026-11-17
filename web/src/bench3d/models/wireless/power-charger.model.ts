/**
 * Charger: a compact USB-C wall adapter (40 x 32 x 25 mm) with folding pins. The cable and its plug are drawn by the
 * Workbench (they reach to the Dot's port); `CHARGER_EXIT` is where the cable leaves the body.
 */
import { INK, Matrix4, PAL, Shape, bolt, defineModel, lamp, print, setLamp, text, topQuad, type V3 } from '../../index';
import { state, type WirelessState } from './state';

export const CHARGER_EXIT: V3 = [0, 11, -20.6];

export default defineModel<WirelessState>({
  id: 'power.charger',
  title: 'Charger',
  footprintMm: { w: 44, d: 44, h: 26 },
  build() {
    const s = new Shape();
    s.box(...PAL.glossWhite, 0, -2, 40, 32, 0, 25, 7.5, 2.4);
    for (const sx of [-1, 1]) s.block(...PAL.tin, 3.1, 0.75, 3.6, new Matrix4().makeTranslation(sx * 6.4, 12.5, 17.4), 0.25);
    s.box(...PAL.silicone, 0, -19.2, 8.4, 3.2, 7.2, 14.8, 1.4, 0.5);
    const root = s.toObject();
    root.add(
      print({
        name: 'rating',
        quad: topQuad(0, -2, 25.03, 20, 16),
        ppm: 10,
        draw(g) {
          g.fillStyle = INK.amber;
          bolt(g, -9, 0.5, 5.2);
          g.fillStyle = '#6b665e';
          text(g, '5 V   2 A', 4.5, -1.6, 3.4, { weight: 700 });
          text(g, 'USB-C', 4.5, 3.4, 2.7, { spacing: 0.3 });
        },
      }),
      lamp('on', [13, 25.05, -12], [1.25, 0.5, 1.25]),
    );
    return root;
  },
  animate(st, obj, env) {
    // amber and breathing while the Dot charges, green when it is full or merely powered
    const phase = String(st.live.phase ?? 'none');
    const charging = st.near && (phase === 'pre' || phase === 'fast');
    setLamp(obj, 'on', charging ? 0xffac00 : 0x35d06a, st.near ? (charging ? 0.55 + 0.45 * Math.sin(env.time * 2.4) ** 2 : 0.8) : 0);
    return charging;
  },
  states: { unplugged: state({}), charging: state({ near: true, live: { phase: 'fast' } }), full: state({ near: true, live: { phase: 'done' } }) },
});
