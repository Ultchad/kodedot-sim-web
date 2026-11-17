/**
 * Slide switch, SPDT: the SS-12D00 family (stamped steel case 8.6 x 3.6 x 3.5 mm on a moulded base, a slot in the top
 * face, a black lever 3 mm long standing 4.5 mm proud, three flat pins at 2.5 mm). Size and terminals come from
 * parts/slide-switch/manifest.json. The lever is the control (`lever`, toggle, field `position`): at `a` it stands at
 * the A end (COM to A), at `b` at the B end, as in the real switch and in the part's picture.
 */
import manifestJson from '../../../../../parts/slide-switch/manifest.json';
import { Matrix4, PAL, Shape, defineModel, footprintOf, part, partState, print, roundedRectLoop, terminalsFromManifest, text, topQuad, type PartState } from '../../index';
import { controlFromManifest, markControl } from './controls';
import { approach, asManifest, fieldDefault, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D, h: H } = footprintOf(manifest.body);
const LEGS = 3.5;
const BASE = 0.9; // the moulded base under the case
const CASE_TOP = 4.0;
const SLOT_W = 5.6, SLOT_D = 1.7;
const LEVER_W = 3.0, LEVER_D = 1.4, LEVER_Y = CASE_TOP - 0.7;
const TRAVEL = (SLOT_W - LEVER_W) / 2 - 0.1; // each way from the middle
const SPEED = 45; // mm/s: across in 50 ms
const mark = controlFromManifest(manifest, 'position');
const DEFAULT = fieldDefault(manifest, 'position');
// the end of the row each position's pin is on: the lever goes towards it
const xOf = (pin: string): number => Math.sign(terminals.find((t) => t.id.toLowerCase() === pin)?.pos[0] ?? 0) * TRAVEL;
const X_OF: Record<string, number> = Object.fromEntries((mark.values ?? []).map((v) => [String(v), xOf(String(v))]));

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build() {
    const s = new Shape();
    s.box(...PAL.plasticBlack, 0, 0, W - 0.5, D - 0.5, 0, BASE, 0.15, 0, { cap: true, ao: 0.9 });
    // the case: a folded steel shell with the slot cut in its top
    s.prism(...PAL.tin, roundedRectLoop(0, 0, W, D, 0.3, 2), 0.45, CASE_TOP, 0.22, { cap: true, ao: 0.8, holes: [roundedRectLoop(0, 0, SLOT_W, SLOT_D, 0.3, 2)] });
    s.box('matte', '#0d0d0f', 0, 0, SLOT_W - 0.04, SLOT_D - 0.04, BASE, CASE_TOP - 0.5, 0, 0, { ao: 1 });
    // the tabs that clinch the base: two on each long side, one on each end
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) s.block(...PAL.tin, 0.6, 0.42, 0.05, new Matrix4().makeTranslation(sx * 2.5, 0.5, sz * (D / 2 + 0.02)), 0.04);
    for (const sx of [-1, 1]) s.block(...PAL.tin, 0.05, 0.42, 0.7, new Matrix4().makeTranslation(sx * (W / 2 + 0.02), 0.5, 0), 0.04);
    for (const t of terminals) flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 0.2, w: 0.8, t: 0.3 });
    const root = s.toObject();
    root.add(
      print({
        name: 'ends',
        quad: topQuad(0, 0, CASE_TOP + 0.02, W / 2, D / 2),
        ppm: 24,
        draw(g) {
          // the positions, stamped at the two ends of the slot: the pin of that end is the one COM connects to
          g.fillStyle = 'rgba(38,38,44,0.82)';
          for (const v of mark.values ?? []) text(g, String(v).toUpperCase(), Math.sign(X_OF[String(v)]) * (SLOT_W / 2 + (W - SLOT_W) / 4 - 0.05), 0.05, 1.05, { weight: 700 });
        },
      }),
    );

    const lever = new Shape();
    lever.box(...PAL.plasticBlack, 0, 0, LEVER_W, LEVER_D, 0, H - LEVER_Y, 0.3, 0.22, { ao: 0.75 });
    const node = markControl(lever.toObject('lever'), mark);
    node.position.set(X_OF[String(DEFAULT)] ?? -TRAVEL, LEVER_Y, 0);
    root.add(node);
    return root;
  },
  animate(st, obj, env) {
    const lever = part(obj, 'lever');
    if (!lever) return;
    const target = X_OF[String(st.fields.position ?? DEFAULT)] ?? -TRAVEL;
    lever.position.x = approach(lever.position.x, target, SPEED, env.dt);
    return lever.position.x !== target;
  },
  states: {
    a: partState({ fields: { position: 'a' } }),
    b: partState({ fields: { position: 'b' } }),
  },
});
