/**
 * Resistor (parts/resistor): a 0.25 W axial carbon film resistor lying on the board, its leads bent down to the two
 * terminals 10.16 mm apart. The four colour bands show the part's `ohms` (two digits, multiplier, 5 % gold), so the
 * value can be read off the model as off the real part.
 * Dimensions (the usual CF-1/4 drawing): body 6.3 x 2.5 mm with the two swollen end caps, leads 0.55 mm.
 *
 * The body and leads are the static body (instanced). The bands are one small mesh per copy whose geometry is shared
 * by every resistor of the same value (colours in the vertices, the kit's matte material): no material per copy.
 * Above its rated power (from `current_ma` and `ohms`) the body glows: the bench's "overpower" hazard.
 */
import { Mesh, type BufferGeometry } from 'three';
import manifest from '../../../../../parts/resistor/manifest.json';
import { Shape, defineModel, familyMaterial, footprintOf, part, partState, terminalsFromManifest, type Finish, type PartState, type V2 } from '../../index';
import { BAND_COLOURS, bandsOf, resistorBands } from './codes';
import { PLUG, asManifest, asSeen, axial, axialLeadsTo, axialShell, fieldDefault, hotShell, num, setHot, terminalOf } from './common';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const OHMS = fieldDefault(m, 'ohms', 330);
const RATED_W = Number(m.behaviour?.elements?.[0]?.rated_mw ?? 250) / 1000;
/** The lacquer of a carbon film resistor (a candidate for PAL: resistorTan). */
const TAN: Finish = ['gloss', '#e8d6b2'];
const AXIS_Y = 1.35;
const R_CAP = 1.25, R_WAIST = 1.08;
/** The body's outline, [radius, x]: two end caps and the waist between them. */
const BODY: V2[] = [[0, -3.15], [0.62, -3.15], [1.08, -2.98], [R_CAP, -2.62], [R_CAP, -1.95], [R_WAIST, -1.55], [R_WAIST, 1.55], [R_CAP, 1.95], [R_CAP, 2.62], [1.08, 2.98], [0.62, 3.15], [0, 3.15]];
/** Where the bands sit: [x, radius under it]. Digits and multiplier together at one end, the tolerance apart at the other. */
const BANDS: V2[] = [[-2.28, R_CAP], [-1.02, R_WAIST], [0.06, R_WAIST], [2.28, R_CAP]];
const BAND_W = 0.52;

const cache = new Map<number, BufferGeometry>();
/** The four bands of a value as one geometry, built once per value and shared by every copy that has it. */
function bandGeometry(code: number): BufferGeometry {
  let g = cache.get(code);
  if (!g) {
    const s = new Shape();
    const colours = bandsOf(code);
    s.with(axial(AXIS_Y), () => BANDS.forEach(([x, r], i) => s.band('matte', asSeen(BAND_COLOURS[colours[i]]), 0, 0, r, x - BAND_W / 2, x + BAND_W / 2, 0, Math.PI * 2, 14)));
    g = s.build().matte!;
    cache.set(code, g);
  }
  return g;
}

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: PLUG,
  terminals,
  build(ctx) {
    const s = new Shape();
    s.with(axial(AXIS_Y), () => s.lathe(...TAN, 0, 0, BODY, ctx.seg(14)));
    axialLeadsTo(s, terminalOf(terminals, 'A'), terminalOf(terminals, 'B'), AXIS_Y, -3.05, 3.05);
    const root = s.toObject();
    const code = resistorBands(OHMS);
    const bands = new Mesh(bandGeometry(code), familyMaterial('matte'));
    bands.name = 'bands';
    bands.userData.bench3d = 'bands';
    bands.userData.code = code;
    root.add(bands, hotShell('hot', axialShell(AXIS_Y, BODY.filter((_, i) => i !== 2 && i !== 9), ctx.seg(14))));
    return root;
  },
  animate(st, obj, env) {
    const ohms = num(st.fields.ohms, OHMS);
    const code = resistorBands(ohms);
    const bands = part(obj, 'bands') as Mesh;
    if (bands.userData.code !== code) {
      bands.userData.code = code;
      bands.geometry = bandGeometry(code);
    }
    // P = I^2 R against the rating: the body glows while it is overloaded
    const amps = num(st.outputs.current_ma, 0) / 1000;
    const hot = st.power.on && amps * amps * ohms > RATED_W;
    setHot(obj, 'hot', hot, env.time);
    return hot;
  },
  states: {
    r330: partState({ fields: { ohms: 330 }, outputs: { current_ma: 4 } }),
    r4k7: partState({ fields: { ohms: 4700 }, outputs: { current_ma: 0.7 } }),
    r10k: partState({ fields: { ohms: 10000 }, outputs: { current_ma: 0.33 } }),
    r1M: partState({ fields: { ohms: 1000000 } }),
    r0R47: partState({ fields: { ohms: 0.47 }, outputs: { current_ma: 120 } }),
    r68: partState({ fields: { ohms: 68 }, outputs: { current_ma: 20 } }),
    overpower: partState({ fields: { ohms: 10 }, outputs: { current_ma: 500 } }),
  },
});
