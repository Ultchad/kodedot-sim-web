/**
 * Latching push button (self-locking, push on / push off): the common 8.5 x 8.5 mm six-pin DPDT kind. A black moulded
 * base 7.5 mm high with a raised collar, a square plunger with a coloured cap, six legs in two rows of three.
 * Size and terminals come from parts/latching-button/manifest.json. ESTIMATES (no drawing at hand): the height (14 mm
 * released), the cap, and the legs, which the manifest has at 2.54 mm in the row and 7.62 mm between the rows.
 * The plunger is the control (`cap`, toggle, field `latched`): released it stands 14 mm high; latched it stays 2 mm
 * lower, which is how the real one shows its state.
 */
import manifestJson from '../../../../../parts/latching-button/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, markControl, part, partState, terminalsFromManifest, type PartState } from '../../index';
import { approach, asManifest, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D, h: H } = footprintOf(manifest.body);
const LEGS = 3.5;
const BASE = 7.5, COLLAR = 8.3;
const CAP_Y = 10.2; // the cap's underside, released
const TRAVEL = 2.0; // how far it stays down while latched
const SPEED = 30;

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build() {
    const s = new Shape();
    s.box(...PAL.plasticBlack, 0, 0, W, D, 0.3, BASE, 0.35, 0.25, { cap: true, ao: 0.82 });
    s.box(...PAL.plasticBlack, 0, 0, W - 1.2, D - 1.2, 0, 0.3, 0.2, 0, { cap: true, ao: 0.7 });
    s.box(...PAL.plasticBlack, 0, 0, 5.6, 5.6, BASE, COLLAR, 0.4, 0.15, { ao: 0.95 });
    s.box('matte', '#0c0c0e', 0, 0, 3.9, 3.9, COLLAR, COLLAR + 0.015, 0.2, 0, { ao: 1 });
    for (const t of terminals) flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 0.3, w: 0.7, t: 0.3, turn: 1 });
    const root = s.toObject();

    const cap = new Shape();
    cap.box(...PAL.plasticWhite, 0, 0, 3.5, 3.5, COLLAR - 2.4 - CAP_Y, 0, 0.2, 0.05, { ao: 0.75 });
    cap.box(...PAL.plasticBlue, 0, 0, 5.2, 5.2, 0, H - CAP_Y, 0.6, 0.4, { cap: true, ao: 0.9 });
    const node = markControl(cap.toObject('cap'), controlFromManifest(manifest, 'latched'));
    node.position.y = CAP_Y;
    root.add(node);
    return root;
  },
  animate(st, obj, env) {
    const cap = part(obj, 'cap');
    if (!cap) return;
    const target = CAP_Y - (st.fields.latched === true ? TRAVEL : 0);
    cap.position.y = approach(cap.position.y, target, SPEED, env.dt);
    return cap.position.y !== target;
  },
  states: {
    released: partState({ fields: { latched: false } }),
    latched: partState({ fields: { latched: true } }),
  },
});
