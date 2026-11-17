/**
 * LED with resistor (parts/led): a red 5 mm LED whose series resistor is in the package, as in the real "resistor
 * LEDs" (5 V and 12 V types): a chip resistor on the anode's post, seen through the resin. Its three-digit marking
 * follows the part's `ohms` field. The rest is the library's LED (led5.ts).
 */
import manifest from '../../../../../parts/led/manifest.json';
import { FONT_MONO, Matrix4, PAL, defineModel, drawScreen, footprintOf, partState, screen, terminalsFromManifest, text, type PartState } from '../../index';
import { chipResistorCode } from './codes';
import { asManifest, fieldDefault, num, terminalOf, visualColour } from './common';
import { LEG_LONG, RESIN, animateLed, buildLed } from './led5';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const A = terminalOf(terminals, 'A'), K = terminalOf(terminals, 'K');
const LIT = visualColour(m, 'glow', 0xff3b30);
const OHMS = fieldDefault(m, 'ohms', 330);
/** The chip stands on the front of the anode's post (an 0603: 1.6 x 0.8 x 0.45 mm). */
const side = Math.sign(K[0] - A[0]) || 1;
const CX = -1.5 * side, CY = 3.2, CZ = 0.25;

// the marking is drawn per copy: the value comes with the state (no closure per frame)
let marking = OHMS;
function drawMarking(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#e9e6dc';
  g.setTransform(w / 1.0, 0, 0, w / 1.0, w / 2, h / 2); // millimetres: the quad is 1.0 mm wide
  text(g, chipResistorCode(marking), 0, 0.02, 0.44, { weight: 700, font: FONT_MONO });
}

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: LEG_LONG,
  terminals,
  build(ctx) {
    const root = buildLed(ctx, A, K, { resin: RESIN.red, lit: LIT }, (s) => {
      s.block('matte', '#1b1b1e', 0.4, 0.52, 0.2, new Matrix4().makeTranslation(CX, CY, CZ + 0.22), 0.04);
      for (const e of [-1, 1]) s.block(...PAL.tin, 0.42, 0.16, 0.22, new Matrix4().makeTranslation(CX, CY + e * 0.64, CZ + 0.22), 0.04);
    });
    // reads upwards along the chip, as it would lying on a board
    root.add(screen('ohms', { c: [CX, CY, CZ + 0.445], u: [0, 0.5, 0], v: [-0.34, 0, 0] }, 48, { lit: false }));
    return root;
  },
  animate(st, obj, env) {
    marking = num(st.fields.ohms, OHMS);
    drawScreen(obj, 'ohms', marking, drawMarking);
    return animateLed(st, obj, env, LIT);
  },
  states: {
    off: partState({ fields: { ohms: 330 }, outputs: { brightness: 0 } }),
    dim: partState({ fields: { ohms: 4700 }, outputs: { brightness: 0.12 } }),
    on: partState({ fields: { ohms: 330 }, outputs: { brightness: 1 } }),
    'r10k-faint': partState({ fields: { ohms: 10000 }, outputs: { brightness: 0.03 } }),
  },
});
