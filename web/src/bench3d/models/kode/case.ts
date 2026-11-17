/**
 * The moulding of the two cased Kode modules (Mesh, white; the multi-radio one, black), as the owner's reference
 * pictures show it (ref-4 to ref-8, never copied): a wide, fairly shallow block with generously rounded edges that
 * sits on the Dot's top wall, its front face sloping back, with a shallow debossed recess (left blank: the maker moulds its name there); a thin tongue,
 * about three quarters as wide, flush with the block's back, that hangs down the Dot's back; the 2x10 pins (silver,
 * in a black shroud let into the block's underside) pointing down along the tongue; and on the flat top the two whip
 * antennas on their gold SMA parts, one short and stubby, one about twice as tall.
 *
 * The module STANDS, as in the pictures and as the manifest's body (about 50 x 24 x 91 mm, antennas included) lays it
 * out: tongue down to the table, antennas up, the sloping face and the pins towards the viewer (+Z). Everything is hung
 * on the manifest: the block's underside is the connector's seat, each pin stands on its terminal, the block's top
 * and the two antennas (place, length) are the `refs` SMA1 and SMA2, the tongue's thickness is what is left behind
 * the pins once half of the Dot's depth is taken off. Proportions not in the manifest (the slope, the radii, the
 * tongue's width, the antennas' girth) are read off the pictures against the Dot's 46.65 mm width.
 */
import { DEPTH_MM_ESTIMATE } from '../../../lib/bodyModel';
import { Matrix4, PAL, Shape, footprintOf, print, roundedRectLoop, rr, type BuildCtx, type Finish, type Object3D, type Pt, type Quad } from '../../index';
import { LYING, connectorOf, connectorPins, roundedBar, whipAntenna, type KodeManifest } from './shared';

export interface CaseLook {
  shell: Finish;
  /** The parting line between the two halves of the moulding. */
  seam: string;
  /** The blank debossed recess: the shade of its floor, the shadow under its upper edge, the light on its lower edge. */
  mark: string;
  markShadow: string;
  markLight: string;
}

const SLOPE = 4.2; // how far the top of the front face stands back from its foot
const END = 4.4; // radius of the block's two ends
const TONGUE = 0.78; // the tongue's width, as a share of the block's

export function buildCasedModule(m: KodeManifest, look: CaseLook, ctx: BuildCtx): Object3D {
  const { w: W, d: D } = footprintOf(m.body);
  const con = connectorOf(m);
  const sma = (m.refs ?? []).filter((r) => r.kind === 'antenna_sma');
  const yU = con.seat[1]; // the block's underside: where the connector seats
  const yT = sma.length ? sma[0].mm.z : yU + 16; // its flat top: where the antennas stand
  const zB = -D / 2, zF = D / 2;
  // the Dot hangs on the pins with its back against the tongue: what is left behind it is the tongue
  const tt = Math.min(6, Math.max(2.6, con.seat[2] - zB - DEPTH_MM_ESTIMATE / 2));
  const wt = W * TONGUE;
  const s = new Shape();

  // the tongue: a slab with round lower corners and soft edges, running up into the block
  const turn = new Matrix4().makeRotationY(Math.PI / 2); // the bar's length (x) becomes depth, its profile lies in (X, Y)
  roundedBar(s, look.shell, [[-wt / 2, 0], [wt / 2, 0], [wt / 2, yU + 2], [-wt / 2, yU + 2]], [4.6, 4.6, 0.04, 0.04], -zB - tt, -zB, Math.min(1.1, tt / 2 - 0.3), { steps: 3, seg: ctx.seg(5), m: turn });
  // the block: side profile with the sloping front, swept across with round ends
  const profile: Pt[] = [[zB, yU], [zF, yU], [zF - SLOPE, yT], [zB, yT]];
  roundedBar(s, look.shell, profile, [1.2, 3.8, 3.2, 2.4], -W / 2, W / 2, END, { steps: ctx.seg(5), seg: ctx.seg(5) });
  // the faint parting lines: a hair proud of the surface, round the tongue's edge and round the block
  const zSeamT = zB + tt / 2, zSeamB = zB + END + 0.5;
  s.with(LYING, () => {
    s.prism('matte', look.seam, roundedRectLoop(0, -(yU + 2) / 2, wt + 0.14, yU + 2.14, 4.67, 4), zSeamT - 0.1, zSeamT + 0.1, 0, { ao: 1 });
    s.prism('matte', look.seam, roundedRectLoop(0, -(yU + yT) / 2, W + 0.14, yT - yU + 0.14, END + 0.07, 5), zSeamB - 0.1, zSeamB + 0.1, 0, { ao: 1 });
  });

  // the interposer's 2x10: a black shroud let into the underside, one pin on every connector terminal, pointing down
  const pins = connectorPins(m);
  const xs = pins.map((p) => p[0]), zs = pins.map((p) => p[2]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  s.box(...PAL.plasticBlack, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 3.6, z1 - z0 + 3.4, yU - 0.55, yU + 0.4, 0.5, 0, { cap: true, ao: 1 });
  s.with(new Matrix4().makeRotationX(Math.PI), () => {
    for (const p of pins) s.prism(...PAL.tin, [[p[0] + 0.32, -p[2] - 0.32], [p[0] + 0.32, -p[2] + 0.32], [p[0] - 0.32, -p[2] + 0.32], [p[0] - 0.32, -p[2] - 0.32]], -yU + 0.5, -yU + con.length, 0.2, { ao: 1 });
  });
  // the antennas: the shorter one is the stubby one
  const shortest = Math.min(...sma.map((r) => r.length_mm ?? 20));
  for (const r of sma) {
    const len = r.length_mm ?? 20;
    whipAntenna(s, { x: r.mm.x - W / 2, y: yT, z: r.mm.y - D / 2, length: len, d: len === shortest ? 8.8 : 7.6, seg: ctx.seg(16) });
  }

  const root = s.toObject();
  // the shallow recess on the sloping face, a little left of its middle as in the pictures: blank
  const a = Math.atan2(SLOPE, yT - yU), ca = Math.cos(a), sa = Math.sin(a);
  const hh = 3.6, hw = 11;
  const face: Quad = { c: [-1, (yU + yT) / 2 + 0.2 + 0.05 * sa, zF - SLOPE / 2 - 0.2 * sa + 0.05 * ca], u: [hw, 0, 0], v: [0, hh * ca, -hh * sa] };
  root.add(
    print({
      name: 'recess',
      quad: face,
      ppm: 20,
      draw(g) {
        // a sunk panel: the light caught by its lower edge, the shadow thrown by its upper edge, then its floor
        const w = 18.6, h = 5.4, r = 1.5;
        g.fillStyle = look.markLight;
        rr(g, -w / 2 + 0.05, -h / 2 + 0.18, w, h, r);
        g.fill();
        g.fillStyle = look.markShadow;
        rr(g, -w / 2 - 0.03, -h / 2 - 0.12, w, h, r);
        g.fill();
        g.fillStyle = look.shell[1];
        rr(g, -w / 2, -h / 2 + 0.1, w, h - 0.14, r);
        g.fill();
        g.fillStyle = look.mark;
        rr(g, -w / 2, -h / 2 + 0.1, w, h - 0.14, r);
        g.fill();
      },
    }),
  );
  return root;
}
