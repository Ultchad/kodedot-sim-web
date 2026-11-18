/**
 * Tactile button, 2 pins: the small 6 x 3.5 mm two-leg tact switch (moulded base, a stamped steel cover clipped over
 * it, an oblong plunger, one flat leg under each short end). Size and terminals come from
 * parts/push-button/manifest.json (id `dotbench.push-button`: it was drawn as a 6 x 6 mm body until the 4-pin buttons
 * arrived; the legs are where they were about the centre). Sizes are estimates (no drawing at hand): body 6 x 3.5 mm,
 * 5 mm to the plunger's top, legs 5.08 mm apart.
 * The plunger is the control (`cap`, momentary, field `pressed`). Its real travel is 0.25 mm; the model moves it
 * 0.7 mm so that a press can be seen from the Workbench's camera.
 */
import manifestJson from '../../../../../parts/push-button/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, hitPad, markControl, part, partState, terminalsFromManifest, type PartState } from '../../index';
import { approach, asManifest, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D, h: H } = footprintOf(manifest.body);
const LEGS = 3.5; // below the seating plane
const COVER = H - 1.45; // top of the steel cover: the plunger stands 1.45 mm above it
const CAP_H = 1.9; // the plunger, of which 0.45 mm stays inside the cover
const TRAVEL = 0.7;
const SPEED = 14; // mm/s: down in 50 ms

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build() {
    const s = new Shape();
    // moulded base, then the cover: a steel cap folded down over the two long sides
    s.box(...PAL.plasticBlack, 0, 0, W - 0.1, D - 0.3, 0, COVER - 0.9, 0.25, 0.12, { cap: true, ao: 0.82 });
    s.box(...PAL.tin, 0, 0, W - 0.5, D, COVER - 1.6, COVER, 0.3, 0.12, { ao: 1 });
    // the slot the plunger moves in
    s.box('matte', '#0c0c0e', 0, 0, 3.0, 1.9, COVER, COVER + 0.015, 0.7, 0, { ao: 1 });
    // one leg per terminal, its flat face across the body
    for (const t of terminals) flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 0.5, neck: -0.4, w: 0.7, shoulder: 1.1, t: 0.25, turn: 1 });
    const root = s.toObject();

    const cap = new Shape();
    cap.box(...PAL.plasticRed, 0, 0, 2.6, 1.5, 0, CAP_H, 0.6, 0.25, { ao: 0.8 });
    const node = hitPad(markControl(cap.toObject('cap'), controlFromManifest(manifest, 'pressed')), { y: CAP_H - 0.3, w: 4.2, d: 2.8, h: 0.6 });
    node.position.y = H - CAP_H;
    root.add(node);
    return root;
  },
  animate(st, obj, env) {
    const cap = part(obj, 'cap');
    if (!cap) return;
    const down = st.fields.pressed === true || (st.visuals.cap ?? 0) > 0;
    const target = H - CAP_H - (down ? TRAVEL : 0);
    cap.position.y = approach(cap.position.y, target, SPEED, env.dt);
    return cap.position.y !== target;
  },
  states: {
    released: partState({ fields: { pressed: false } }),
    pressed: partState({ fields: { pressed: true } }),
  },
});
