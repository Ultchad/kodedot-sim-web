/**
 * Ceramic capacitor (parts/capacitor-ceramic): a dipped ceramic disc standing on its two leads, 5.08 mm apart. The
 * code printed on its face follows the part's `uf` field ("104" for 0.1 uF, picofarads as two digits and a power of
 * ten), with the rated voltage under it.
 * Dimensions (a common 50 V disc): 6.2 mm across, 2.5 mm thick, the coating running a little way down the leads.
 */
import manifest from '../../../../../parts/capacitor-ceramic/manifest.json';
import { FONT, Matrix4, PAL, Shape, defineModel, drawScreen, footprintOf, frontQuad, partState, screen, terminalsFromManifest, text, type PartState } from '../../index';
import { capacitorCode } from './codes';
import { PLUG, asManifest, fieldDefault, num, terminalOf } from './common';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const UF = fieldDefault(m, 'uf', 0.1);
const VOLTS = `${Math.round(Number(m.behaviour?.elements?.[0]?.max_mv ?? 50000) / 1000)}V`;
const DIP = PAL.dipOchre;
const INK = '#2b1d12';
const CY = 3.85, R = 3.1, T = 1.25;
const FACE_W = 4.0, FACE_H = 2.7;
/** The disc about its own axis (Z): a flat face, a rounded rim. */
const DISC = new Matrix4().makeTranslation(0, CY, 0).multiply(new Matrix4().makeRotationX(Math.PI / 2));

// drawn per copy: the value comes with the state
let value = UF;
function drawCode(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.setTransform(w / FACE_W, 0, 0, w / FACE_W, w / 2, h / 2); // millimetres from the middle of the face
  g.fillStyle = INK;
  text(g, capacitorCode(value), 0, -0.3, 1.55, { weight: 700, font: FONT, spacing: 0.06 });
  text(g, VOLTS, 0, 0.92, 0.66, { weight: 600, font: FONT });
}

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: PLUG,
  terminals,
  build(ctx) {
    const s = new Shape();
    s.with(DISC, () => s.lathe(...DIP, 0, 0, [[0, -T], [2.2, -T + 0.04], [2.7, -0.95], [3.02, -0.5], [R, 0], [3.02, 0.5], [2.7, 0.95], [2.2, T - 0.04], [0, T]], ctx.seg(20)));
    for (const id of ['A', 'B']) {
      const [x, , z] = terminalOf(terminals, id);
      // the leads leave the disc closer together and are kinked out to the 5.08 mm pitch
      const xi = x * 0.77;
      s.tube(...PAL.tin, [[xi, 3.0, z], [xi, 1.8, z], [x, 1.0, z], [x, -PLUG, z]], 0.25, 6);
      // a drop of the dip round each lead where it leaves the disc
      s.lathe(...DIP, xi + Math.sign(x) * 0.12, z, [[0.26, 1.18], [0.4, 1.36], [0.46, 1.62], [0.34, 1.95]], ctx.seg(8));
    }
    const root = s.toObject();
    root.add(screen('code', frontQuad(0, CY + 0.1, T + 0.02, FACE_W / 2, FACE_H / 2), 26, { lit: false }));
    return root;
  },
  animate(st, obj) {
    value = num(st.fields.uf, UF);
    drawScreen(obj, 'code', value, drawCode);
  },
  states: {
    c100n: partState({ fields: { uf: 0.1 }, outputs: { volts_mv: 3300 } }),
    c22p: partState({ fields: { uf: 0.000022 } }),
    c4n7: partState({ fields: { uf: 0.0047 } }),
    c1u: partState({ fields: { uf: 1 } }),
    c4p7: partState({ fields: { uf: 0.0000047 } }),
  },
});
