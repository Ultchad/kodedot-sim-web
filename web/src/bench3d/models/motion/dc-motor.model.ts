/**
 * Small brushed DC motor, 130 size (the toy and hobby can motor): flat-sided steel can, nylon end bell with the two
 * solder tabs, bronze bushings, a 2 mm shaft, and a two-blade propeller pressed on it so that rotation can be seen.
 * Dimensions after the usual 130 drawing (can 20 x 15 mm across the flats, body 25 mm, boss 6 mm, shaft 2 mm); the
 * can's section and the terminals are the manifest's (parts/dc-motor): it lies on a flat, the shaft along +X, the tabs
 * at the -X end.
 *
 * Live state: `outputs.speed` (-1..1, the sign is the direction). The propeller turns at a rate the eye can follow
 * (5 turns a second at full speed, not the real 100), eases in and out, and a faint disc shows the blur above half speed.
 * The manifest declares no hazard for this part.
 */
import manifest from '../../../../../parts/dc-motor/manifest.json';
import { INK, Matrix4, PAL, Shape, circleLoop, defineModel, footprintOf, part, partState, print, roundedRectLoop, terminalsFromManifest, text, topQuad, type Finish, type PartState, type Pt } from '../../index';
import { TAU, alongNegX, alongX, asManifest, num, pinAt, visualAt } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w_mm: W, d_mm: D, h_mm: H } = M.body;
const R = D / 2, FLAT = H / 2, AY = H / 2; // the can: a circle of the footprint's depth cut by two flats; the axis
const [M1, M2] = [pinAt(M, 'M1'), pinAt(M, 'M2')];
// along the axis, from the tabs' eyelets (the terminals) to the shaft's tip at the footprint's edge
const X_BELL = M1[0] + 1.3, X_CAN = X_BELL + 5.2, X_FACE = X_BELL + 23.6, X_BOSS = X_FACE + 1.5;
const X_PROP = visualAt(M, 'rotor')[0];
const PROP_R = Math.min(FLAT, R) - 0.45;
/** Zinc-plated steel: brighter than the kit's steel, which reads as gunmetal on a big curved can. */
const CAN: Finish = ['metal', '#e4e6ea'];
/** Turns a second of the propeller at speed 1 (the real 6000 rpm would only alias on a screen). */
const TURNS = 5;

/** The can's section in a frame lying along X (local x is down, local z is Z): flats top and bottom, round sides. */
function section(r: number, flat: number, seg: number): Pt[] {
  const a0 = Math.asin(Math.min(1, flat / r));
  const out: Pt[] = [];
  for (const side of [1, -1]) {
    // a point a hair along each flat keeps the corners crisp
    out.push([-side * flat, side * (r * Math.cos(a0) - 0.35)]);
    for (let i = 0; i <= seg; i++) {
      const a = a0 - (2 * a0 * i) / seg;
      out.push([-side * r * Math.sin(a), side * r * Math.cos(a)]);
    }
    out.push([side * flat, side * (r * Math.cos(a0) - 0.35)]);
  }
  return out;
}

export default defineModel<PartState>({
  id: M.id,
  title: M.name.en,
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    const seg = ctx.seg(12);
    // ---- the can, its front face towards +X
    s.with(alongX(X_CAN, AY), () => {
      s.prism(...CAN, section(R, FLAT, seg), 0, X_FACE - X_CAN, 0.9, { ao: 1 });
      // front bushing boss and its bronze bearing
      s.disc(...CAN, 0, 0, 3.05, X_FACE - X_CAN, X_BOSS - X_CAN, 0.45, ctx.seg(18), { ao: 0.9 });
      s.disc('metal', '#b88a3a', 0, 0, 1.75, X_BOSS - X_CAN, X_BOSS - X_CAN + 0.12, 0.05, ctx.seg(12), { ao: 1 });
      // the two vent holes of the face
      for (const sz of [-1, 1]) s.disc('matte', '#17171a', 0, sz * 6.6, 1.0, X_FACE - X_CAN, X_FACE - X_CAN + 0.03, 0, 10, { ao: 1 });
    });
    // the seam where the can is crimped over the end bell, and the two crimp lugs on the flats
    s.with(alongX(X_CAN - 0.25, AY), () => s.prism('metal', '#8d9097', section(R - 0.12, FLAT - 0.12, seg), 0, 0.5, 0, { ao: 1 }));
    for (const sy of [0, 1]) s.box(...CAN, X_CAN - 0.5, 0, 1.3, 3.6, sy ? H - 0.42 : 0.3, sy ? H : 0.72, 0.2, 0.1, { cap: true, ao: 1 });
    // ---- the end bell, its back towards -X, with the rear bushing
    s.with(alongNegX(X_CAN - 0.25, AY), () => {
      s.prism(...PAL.plasticWhite, section(R - 0.35, FLAT - 0.3, seg), 0, X_CAN - 0.25 - X_BELL, 0.7, { ao: 0.92 });
      s.disc(...PAL.plasticWhite, 0, 0, 3.4, X_CAN - 0.25 - X_BELL, X_CAN + 0.55 - X_BELL, 0.3, ctx.seg(16), { ao: 0.9 });
      s.disc('metal', '#b88a3a', 0, 0, 1.5, X_CAN + 0.55 - X_BELL, X_CAN + 0.7 - X_BELL, 0.06, ctx.seg(12), { ao: 1 });
      s.disc(...PAL.steel, 0, 0, 0.9, X_CAN + 0.7 - X_BELL, X_CAN + 1.0 - X_BELL, 0.15, 10, { ao: 1 });
      // the brush holders show as two slots
      for (const sz of [-1, 1]) s.box('matte', '#bdb8ac', 0, sz * 7.2, 5.4, 1.2, X_CAN - 0.25 - X_BELL, X_CAN - 0.22 - X_BELL, 0.3, 0, { ao: 1 });
    });
    // ---- the solder tabs: brass, flat, an eyelet where the wire goes (the terminals)
    for (const t of [M1, M2]) {
      const x0 = X_BELL - 0.2, x1 = Math.max(-W / 2 + 0.12, t[0] - 1.0);
      s.prism('metal', '#c9a24a', roundedRectLoop((x0 + x1) / 2, t[2], x0 - x1, 2.7, 0.7, 2), t[1] - 0.2, t[1] + 0.2, 0.06, { cap: true, ao: 1, holes: [circleLoop(t[0] - 0.05, t[2], 0.5, 10)] });
      // the root of the tab, moulded into the bell
      s.box(...PAL.plasticWhite, X_BELL + 0.15, t[2], 1.1, 3.5, t[1] - 0.8, t[1] + 0.8, 0.3, 0.25, { cap: true, ao: 0.95 });
    }
    const root = s.toObject();
    root.add(
      print({
        name: 'label',
        quad: topQuad((X_BELL + X_FACE) / 2, 0, H + 0.02, (X_FACE - X_BELL) / 2, 6),
        ppm: 14,
        draw(g) {
          const x0 = -(X_FACE - X_BELL) / 2; // the bell's back
          // polarity, moulded marks on the bell: + at M1 (the far tab)
          g.fillStyle = INK.red;
          text(g, '+', x0 + 2.6, M1[2] - 0.2, 3.4, { weight: 700 });
          g.fillStyle = 'rgba(60,56,50,0.7)';
          text(g, '−', x0 + 2.6, M2[2], 3.4, { weight: 700 });
          // the paper label on the can
          const lx = x0 + 7.4, lw = X_FACE - X_BELL - 9.2;
          g.fillStyle = '#f3efe4';
          g.beginPath();
          g.roundRect(lx, -4.9, lw, 9.8, 0.7);
          g.fill();
          g.fillStyle = INK.silkDark;
          text(g, 'DC MOTOR 130', lx + 1.2, -2.7, 1.5, { weight: 800, align: 'left', spacing: 0.04 });
          text(g, '3–6 V', lx + 1.2, 0.75, 2.1, { weight: 700, align: 'left' });
          text(g, '6000 rpm', lx + 1.2, 3.3, 1.4, { weight: 600, align: 'left' });
          // which way it turns for + on M1
          g.strokeStyle = INK.red;
          g.lineWidth = 0.42;
          g.lineCap = 'round';
          const ax = lx + lw - 2.5, ay = 2.3;
          g.beginPath();
          g.arc(ax, ay, 1.45, Math.PI * 0.25, Math.PI * 1.5);
          g.stroke();
          g.fillStyle = INK.red;
          g.beginPath();
          g.moveTo(ax - 0.1, ay - 2.3);
          g.lineTo(ax + 1.35, ay - 1.45);
          g.lineTo(ax - 0.1, ay - 0.6);
          g.closePath();
          g.fill();
        },
      }),
    );

    // ---- what turns: the shaft and the propeller, about the axis through (X_PROP, AY, 0)
    const r = new Shape();
    r.rod(...PAL.steel, [X_BOSS - X_PROP, 0, 0], [Math.min(W / 2 - 0.1 - X_PROP, 3.1), 0, 0], 1.0, ctx.seg(10));
    r.with(new Matrix4().makeRotationZ(-Math.PI / 2), () => {
      // hub and spinner
      r.lathe(...PAL.plasticRed, 0, 0, [[1.6, -1.4], [1.8, -1.1], [1.8, 0.9], [1.55, 1.5], [1.0, 2.1], [0.45, 2.45], [0, 2.55]], ctx.seg(16));
      r.disc(...PAL.plasticRed, 0, 0, 1.6, -1.45, -1.4, 0, ctx.seg(16), { cap: true, ao: 1 });
    });
    const blade: Pt[] = [];
    const n = ctx.seg(14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, u = (1 - Math.cos(a)) / 2; // 0 at the root, 1 at the tip
      blade.push([1.2 + (PROP_R - 1.2) * u, Math.sin(a) * (1.1 + 2.0 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.8)]);
    }
    for (let k = 0; k < 2; k++) {
      // local x is the radius, local y the thickness (along the axis), pitched about the radius
      const m = new Matrix4().makeRotationX(k * Math.PI).multiply(new Matrix4().makeRotationZ(-Math.PI / 2)).multiply(new Matrix4().makeRotationX(0.62));
      r.with(m, () => {
        r.prism(...PAL.plasticAmber, blade, -0.28, 0.28, 0.2, { cap: true, ao: 1 });
        // one tip is white: the eye can count the turns and tell the direction
        if (k === 0) r.prism(...PAL.plasticWhite, blade.map(([x, z]) => [Math.max(x, PROP_R - 1.9), z * 1.02] as Pt), -0.31, 0.31, 0.2, { cap: true, ao: 1 });
      });
    }
    const rotor = r.toObject('rotor');
    rotor.position.set(X_PROP, AY, 0);
    // the blur of the blades at speed: a clear amber disc, shown above half speed
    const b = new Shape();
    b.with(alongX(X_PROP - 0.12, AY), () => b.prism('glass', '#ffb629', circleLoop(0, 0, PROP_R - 0.15, ctx.seg(28)), 0, 0.24, 0, { cap: true, ao: 1 }));
    const blur = b.toObject('blur');
    blur.visible = false;
    root.add(rotor, blur);
    return root;
  },
  animate(st, obj, env) {
    const u = obj.userData;
    const target = Math.max(-1.2, Math.min(1.2, num(st.outputs.speed)));
    // the rotor has some inertia: it runs up and coasts down in a fraction of a second
    let w = typeof u.w === 'number' ? u.w : target;
    w += (target - w) * Math.min(1, env.dt * 7);
    if (Math.abs(target - w) < 0.004) w = target;
    u.w = w;
    const spin = ((typeof u.spin === 'number' ? u.spin : 0.6) + w * TURNS * TAU * env.dt) % TAU;
    u.spin = spin;
    part(obj, 'rotor')!.rotation.x = spin;
    part(obj, 'blur')!.visible = Math.abs(w) > 0.5;
    return w !== 0 || target !== 0;
  },
  states: {
    stopped: partState({ outputs: { speed: 0, rpm: 0, current_ma: 0 } }),
    slow: partState({ outputs: { speed: 0.25, rpm: 1500, current_ma: 375 } }),
    fast: partState({ outputs: { speed: 1, rpm: 6000, current_ma: 1500 } }),
    reverse: partState({ outputs: { speed: -0.8, rpm: -4800, current_ma: -1200 } }),
  },
});
