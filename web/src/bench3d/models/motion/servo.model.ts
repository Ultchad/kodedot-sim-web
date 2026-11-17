/**
 * SG90-class 9 g micro servo at real size: translucent blue case in three shells, the two mounting ears, the round gear
 * tower with the splined output, the white single-arm horn that turns to the live angle, and the brown / red / orange
 * lead ending in its three-way connector.
 * Dimensions after the usual SG90 drawing: case 22.5 x 12.2 x 22.7 mm, ears 32.3 mm tip to tip and 2.5 mm thick with
 * their underside 15.9 mm up, tower 11.8 mm across and 4.3 mm high with the shaft 6.1 mm from the lead's end; the long
 * single arm of the usual horn set, about 18.5 mm from the shaft to its tip (an estimate).
 *
 * Where things are is the manifest's (parts/servo): the output shaft is its `horn` visual, the case lies along X with
 * the lead's end towards -X, and the connector's three mouths are its terminals on the left face. The lead is the
 * part of a real one (about 250 mm) that fits between them.
 *
 * Live state: `visuals.horn` (-90..90, the manifest's scaling of `outputs.angle` 0..180) turns the horn, at the
 * 600 degrees a second a real one manages, so a jump of the signal is seen as a sweep.
 */
import manifest from '../../../../../parts/servo/manifest.json';
import {
  INK, Matrix4, PAL, PITCH, Shape, circleLoop, convexHull, defineModel, footprintOf, frontQuad, part, partState, print, roundedRectLoop, terminalsFromManifest, text,
  type Finish, type PartState, type V3,
} from '../../index';
import { DEG, WIRE, alongNegX, approach, asManifest, brick, num, visualAt } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);

// ---- the servo in its own millimetres: origin under the middle of the case, the lead and the shaft at the -x end
const CASE = { w: 22.5, d: 12.2, h: 22.7 };
const EARS = { span: 32.3, t: 2.5, y: 15.9, hole: 13.9 };
const TOWER = { x: -CASE.w / 2 + 6.1, r: 5.9, h: 4.3 };
const SPLINE = 3.2, HORN = 18.5;
/** The output shaft in the model frame, and with it the servo's own origin. */
const [SX, SZ] = visualAt(M, 'horn');
const OX = SX - TOWER.x, OZ = SZ;
/** The connector's three mouths, in the servo's millimetres. */
const ENDS = terminals.map((t): V3 => [t.pos[0] - OX, t.pos[1], t.pos[2] - OZ]);
const LEAD_D = 1.25;
/** The crimp housing: 14 mm long as a real one, shorter only if the terminals are closer to the case than that. */
const HOUSING = Math.max(2, Math.min(14, -CASE.w / 2 - ENDS[0][0] - 3));
const SHELL: Finish = ['glass', '#1d5fd6'];
const CORE: Finish = ['matte', '#143c98'];
const NYLON: Finish = ['matte', '#f4f2ec'];
const LEAD = [WIRE.brown, WIRE.red, WIRE.orange]; // ground, supply, signal: the order of the manifest's pins

export default defineModel<PartState>({
  id: M.id,
  title: M.name.en,
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    const fit = new Matrix4().makeTranslation(OX, 0, OZ);
    const seamA = 4.6, seamB = EARS.y;
    s.with(fit, () => {
      // ---- what shows through the case: the works inside
      s.box(...CORE, 0, 0, CASE.w - 0.9, CASE.d - 0.9, 0.4, CASE.h - 0.45, 0.9, 0.5, { ao: 0.8 });
      // the motor's can and the feedback pot against the front wall, the control board in the bottom shell
      s.box('metal', '#aab4c6', 4.6, CASE.d / 2 - 0.55, 6.2, 0.5, seamA + 0.8, EARS.y - 0.6, 0.6, 0.2, { ao: 1 });
      s.box('matte', '#12357a', TOWER.x, CASE.d / 2 - 0.55, 5.2, 0.5, seamA + 2.6, EARS.y - 2.2, 0.6, 0.2, { ao: 1 });
      s.box('matte', '#1f7a4d', 0, CASE.d / 2 - 0.55, CASE.w - 2.6, 0.5, 1.5, seamA - 0.7, 0.3, 0.1, { ao: 1 });
      // the gear train under the lid
      for (const [x, r] of [[TOWER.x, 4.6], [1.6, 3.3], [6.6, 2.6]]) s.disc('matte', '#6f93dc', x, 0, r, CASE.h - 0.45, CASE.h - 0.2, 0.1, ctx.seg(16), { ao: 1 });
      // ---- the case: three translucent shells, the ears on the top one
      s.box(...SHELL, 0, 0, CASE.w, CASE.d, 0, seamA - 0.08, 1.1, 0.5, { ao: 0.85 });
      s.box(...SHELL, 0, 0, CASE.w, CASE.d, seamA + 0.08, seamB - 0.08, 1.1, 0, { ao: 0.95 });
      s.box(...SHELL, 0, 0, CASE.w, CASE.d, seamB + 0.08, CASE.h, 1.1, 0.6, { ao: 1 });
      const slot = (sx: number) => convexHull([...circleLoop(sx * EARS.hole, 0, 1.1, 10), ...circleLoop(sx * (EARS.span / 2 - 0.9), 0, 0.6, 6)]);
      s.prism(...SHELL, roundedRectLoop(0, 0, EARS.span, CASE.d, 1.2, 3), EARS.y, EARS.y + EARS.t, 0.35, { cap: true, ao: 1, holes: [slot(-1), slot(1)] });
      // the gear tower and the bump of the idler beside it
      s.disc(...SHELL, TOWER.x, 0, TOWER.r, CASE.h, CASE.h + TOWER.h, 0.7, ctx.seg(26), { ao: 0.95 });
      s.disc(...SHELL, TOWER.x + 7.0, 0, 2.9, CASE.h, CASE.h + TOWER.h - 0.4, 0.6, ctx.seg(14), { ao: 0.95 });
      s.disc(...CORE, TOWER.x, 0, TOWER.r - 0.55, CASE.h - 0.5, CASE.h + TOWER.h - 0.4, 0.6, ctx.seg(20), { ao: 0.9 });
      // the four case screws show at the lid's corners
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.disc(...PAL.steel, sx * (CASE.w / 2 - 1.7), sz * (CASE.d / 2 - 1.7), 0.75, CASE.h - 0.3, CASE.h + 0.04, 0, 8, { ao: 1 });
      // the label's plate on the front
      brick(s, ['matte', '#eef0f3'], 2.2, CASE.d / 2 + 0.03, 12.6, 0.08, seamA + 1.3, EARS.y - 1.2);
      // ---- the lead: out of the bottom shell at the shaft's end, into its connector, whose mouths are the terminals
      const x0 = -CASE.w / 2;
      s.box(...SHELL, x0 - 0.3, 0, 0.8, 5.0, 1.6, 4.4, 0.3, 0.2, { cap: true, ao: 1 });
      ENDS.forEach((e, i) => {
        const back = e[0] + HOUSING;
        s.with(alongNegX(back, e[1], e[2]), () => {
          s.box(...PAL.plasticBlack, 0, 0, PITCH - 0.06, PITCH - 0.06, 0, HOUSING, 0.3, 0.3, { cap: true, ao: 1 });
          brick(s, ['matte', '#0c0c0d'], 0, 0, 1.25, 1.25, HOUSING, HOUSING + 0.02);
          brick(s, PAL.gold, 0, 0, 0.5, 0.5, HOUSING + 0.02, HOUSING + 0.03);
          brick(s, ['matte', '#0c0c0d'], PITCH / 2 - 0.02, 0, 0.06, 1.3, HOUSING * 0.25, HOUSING * 0.55); // the latch window, on top
        });
        // the three wires leave the case as a flat ribbon and fan out to the housing's 2.54 mm
        const z0 = (i - 1) * (LEAD_D + 0.05), run = x0 - back;
        const pts: V3[] = [[x0 + 0.5, 3.0, z0], [x0 - 0.8, 3.0, z0]];
        for (let k = 1; k < 6; k++) {
          const t = k / 6, u = t * t * (3 - 2 * t);
          pts.push([x0 - 0.8 - (run - 1.6) * t, 3.0 + (e[1] - 3.0) * u, z0 + (e[2] - z0) * u]);
        }
        pts.push([back + 0.8, e[1], e[2]], [back - 0.5, e[1], e[2]]);
        s.tube('matte', LEAD[i], pts, LEAD_D / 2, 8);
      });
    });
    const root = s.toObject();
    const plate = { x: OX + 2.2, y: (seamA + 1.3 + EARS.y - 1.2) / 2, hw: 6.3, hh: (EARS.y - seamA - 2.5) / 2 };
    root.add(
      print({
        name: 'label',
        quad: frontQuad(plate.x, plate.y, OZ + CASE.d / 2 + 0.08, plate.hw, plate.hh),
        ppm: 26,
        draw(g) {
          g.fillStyle = INK.blue;
          text(g, 'MICRO SERVO', 0, -2.9, 1.3, { weight: 800, spacing: 0.1 });
          g.fillStyle = INK.silkDark;
          text(g, 'SG90', -0.2, 0.3, 3.1, { weight: 800, spacing: 0.2 });
          text(g, '9 g  ·  4.8 V  ·  180°', 0, 3.3, 1.15, { weight: 600 });
        },
      }),
    );

    // ---- what turns: the splined output and the horn on it, about the tower's axis
    const h = new Shape();
    {
      const y0 = CASE.h + TOWER.h;
      h.disc(...NYLON, 0, 0, 2.4, y0 - 0.3, y0 + SPLINE, 0.2, ctx.seg(14), { ao: 0.9 });
      h.disc(...NYLON, 0, 0, 3.5, y0 + 1.2, y0 + SPLINE + 1.0, 0.5, ctx.seg(20), { cap: true, ao: 0.95 });
      // the arm, built towards -z: the middle of the travel (90 degrees), up the part's picture
      const holes = [];
      for (let r = 5; r < HORN - 1.6; r += 2) holes.push(circleLoop(0, -r, 0.5, 8));
      h.prism(...NYLON, convexHull([...circleLoop(0, 0, 3.3, 16), ...circleLoop(0, -(HORN - 1.6), 1.6, 12)]), y0 + SPLINE - 0.6, y0 + SPLINE + 0.8, 0.3, { cap: true, ao: 1, holes });
      // the horn screw
      h.disc(...PAL.steel, 0, 0, 1.45, y0 + SPLINE + 1.0, y0 + SPLINE + 1.55, 0.35, ctx.seg(12), { ao: 1 });
      brick(h, ['matte', '#3c3d42'], 0, 0, 1.9, 0.36, y0 + SPLINE + 1.55, y0 + SPLINE + 1.58);
      brick(h, ['matte', '#3c3d42'], 0, 0, 0.36, 1.9, y0 + SPLINE + 1.55, y0 + SPLINE + 1.58);
    }
    const horn = h.toObject('horn');
    horn.position.set(SX, 0, SZ);
    root.add(horn);
    return root;
  },
  animate(st, obj, env) {
    const u = obj.userData;
    // degrees from the middle of the travel, clockwise seen from above: the manifest's `horn` visual
    const v = st.visuals.horn;
    const target = Math.max(-90, Math.min(90, typeof v === 'number' ? v : num(st.outputs.angle, 90) - 90));
    const cur = approach(typeof u.horn === 'number' ? u.horn : target, target, 600 * env.dt);
    u.horn = cur;
    part(obj, 'horn')!.rotation.y = -cur * DEG;
    return cur !== target;
  },
  states: {
    'at-0': partState({ outputs: { angle: 0 }, visuals: { horn: -90 } }),
    'at-45': partState({ outputs: { angle: 45 }, visuals: { horn: -45 } }),
    'at-90': partState({ outputs: { angle: 90 }, visuals: { horn: 0 } }),
    'at-135': partState({ outputs: { angle: 135 }, visuals: { horn: 45 } }),
    'at-180': partState({ outputs: { angle: 180 }, visuals: { horn: 90 } }),
    unpowered: partState({ power: { on: false, reason: 'V5' }, outputs: { angle: 90 }, visuals: { horn: 0 } }),
  },
});
