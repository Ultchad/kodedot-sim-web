/**
 * Diode 1N4007 (parts/diode): a rectifier in the DO-41 package lying on the board, its leads bent down to the two
 * terminals 10.16 mm apart. The light band marks the cathode (K).
 * Dimensions (DO-41): body 5.0 x 2.6 mm, leads 0.8 mm.
 * Over its rated current (`overcurrent`) the body glows.
 */
import manifest from '../../../../../parts/diode/manifest.json';
import { FONT_MONO, PAL, Shape, defineModel, footprintOf, partState, terminalsFromManifest, text, type PartState, type V2 } from '../../index';
import { PLUG, asManifest, axial, axialLeadsTo, axialShell, hotShell, printOnCylinder, setHot, terminalOf } from './common';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const A = terminalOf(terminals, 'A'), K = terminalOf(terminals, 'K');
const AXIS_Y = 1.4;
const R = 1.3, HALF = 2.5;
const BODY: V2[] = [[0, -HALF], [0.95, -HALF], [R, -HALF + 0.3], [R, HALF - 0.3], [0.95, HALF], [0, HALF]];
/** The cathode's end: +1 when K is on +X (as the manifest has it). */
const k = Math.sign(K[0] - A[0]) || 1;

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: PLUG,
  terminals,
  build(ctx) {
    const s = new Shape();
    s.with(axial(AXIS_Y), () => {
      s.lathe(...PAL.epoxyBlack, 0, 0, BODY, ctx.seg(14));
      // the cathode band, printed round the body near its end
      s.band('matte', '#d3d6da', 0, 0, R, k > 0 ? 1.2 : -2.0, k > 0 ? 2.0 : -1.2, 0, Math.PI * 2, ctx.seg(14));
    });
    axialLeadsTo(s, A, K, AXIS_Y, -HALF + 0.1, HALF - 0.1, 0.8);
    const root = s.toObject();
    root.add(
      // the type on the body, where it is read from above and from the front
      printOnCylinder(
        { o: [0, AXIS_Y, 0], axis: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], r: R, a0: 0.42, a1: 1.36, t0: k > 0 ? -2.05 : -1.05, t1: k > 0 ? 1.05 : 2.05, reads: 'axis', seg: 5 },
        {
          name: 'type',
          ppm: 34,
          draw(g) {
            g.fillStyle = '#c4c7cc';
            text(g, '1N4007', 0, 0, 0.78, { weight: 700, font: FONT_MONO, spacing: 0.03 });
          },
        },
      ),
      hotShell('hot', axialShell(AXIS_Y, BODY, ctx.seg(14))),
    );
    return root;
  },
  animate(st, obj, env) {
    const hot = st.power.on && st.outputs.overcurrent === true;
    setHot(obj, 'hot', hot, env.time);
    return hot;
  },
  states: {
    idle: partState({ outputs: { current_ma: 0 } }),
    conducting: partState({ outputs: { current_ma: 180 } }),
    overcurrent: partState({ outputs: { current_ma: 1600, overcurrent: true } }),
  },
});
