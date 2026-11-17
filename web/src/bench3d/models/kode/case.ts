/**
 * The moulding of the two cased Kode modules (Mesh, white; the multi-radio one, black).
 *
 * MEASURED on the owner's reference pictures (ref-5 to ref-8, never copied) with a camera solved for each: the
 * mounted pictures against the Dot's own features (its width 46.65 mm, its glass, its buttons), the pictures of the
 * module alone against the 2.54 mm pitch of its pins, and points seen in both triangulated. What they give, to about
 * a millimetre:
 *
 *   - one L-shaped moulding as wide as the Dot (47 mm): a block 18 mm high and 31 to 35 mm deep over a tongue 14 mm
 *     thick that hangs 26 mm below the block's underside, flush with the block's back and with both of its ends;
 *   - the block's front face leans forward, its top 4 mm ahead of its foot; every edge is soft (3 to 4.5 mm), the
 *     tongue's a little tighter; the top is flat;
 *   - the 2x10 pins (bright, about 7 mm showing, in a black shroud let into the underside) stand 10 mm in front of
 *     the tongue: the Dot hangs on them with its back against the tongue;
 *   - two whip antennas on gold SMA parts over the tongue (10.5 mm from the back), 11.1 mm left and 11.4 mm right of
 *     the pins' middle, 30.5 and 50.5 mm tall, 8.5 to 8.8 mm thick.
 *
 * The maker moulds its name into the front face: it is not reproduced, the face is left plain.
 *
 * The module STANDS, as in the pictures: tongue down to the table, antennas up, the leaning face and the pins towards
 * the viewer (+Z). The pins stand on the manifest's terminals (their place across and in depth); everything else is
 * hung on them with the measures above. Where the manifest's body cannot hold that (it was estimated before these
 * pictures came), `casedFootprint` declares the box that does, round the manifest's own centre, so that the terminals
 * keep their manifest coordinates; it is the manifest's box again as soon as that one is large enough.
 */
import { PAL, Shape, footprintOf, type BuildCtx, type Finish, type Object3D, type Pt } from '../../index';
import { connectorPins, moulding, whipAntenna, type KodeManifest } from './shared';

/** The moulding's measures (mm), relative to the middle of the pin field. */
export const CASE = {
  width: 47,
  tongue: { thick: 14, below: 26 },
  block: { height: 18.2, back: 24.5, frontFoot: 6.5, frontTop: 10.5 },
  pins: { showing: 7 },
  antennas: [
    { x: -11.1, z: -14, length: 30.5, d: 8.8, grooves: 7 },
    { x: 11.4, z: -14, length: 50.5, d: 8.5, grooves: 4.2 },
  ],
} as const;

/** The pins' bright tin, a little warm as the pictures show it. */
const PIN: Finish = ['metal', '#c9c4b6'];

export interface CaseLook {
  shell: Finish;
}

/** The middle of the pin field (model frame) from the manifest's connector terminals. */
function pinField(m: KodeManifest): { x: number; z: number; pins: [number, number][] } {
  const pins = connectorPins(m).map((p) => [p[0], p[2]] as [number, number]);
  const mid = (k: 0 | 1) => (Math.min(...pins.map((p) => p[k])) + Math.max(...pins.map((p) => p[k]))) / 2;
  return { x: mid(0), z: mid(1), pins };
}
/** The manifest's body when it holds the moulding; otherwise the smallest box round the same centre that does. */
export function casedFootprint(m: KodeManifest): { w: number; d: number; h: number } {
  const f = footprintOf(m.body), at = pinField(m);
  const up = (v: number) => Math.ceil(v * 2) / 2;
  const tall = CASE.tongue.below + CASE.block.height + Math.max(...CASE.antennas.map((a) => a.length));
  return {
    w: Math.max(f.w, up(2 * (Math.abs(at.x) + CASE.width / 2))),
    d: Math.max(f.d, up(2 * Math.max(CASE.block.back - at.z, CASE.block.frontTop + at.z))),
    h: Math.max(f.h, up(tall)),
  };
}

export function buildCasedModule(m: KodeManifest, look: CaseLook, ctx: BuildCtx): Object3D {
  const at = pinField(m);
  const yU = CASE.tongue.below, yT = yU + CASE.block.height;
  const zB = at.z - CASE.block.back, zT = zB + CASE.tongue.thick, zF0 = at.z + CASE.block.frontFoot, zF1 = at.z + CASE.block.frontTop;
  const s = new Shape();

  // the moulding: one skin. Its side profile, counter-clockwise from the foot of the back
  const profile: Pt[] = [[zB, 0], [zT, 0], [zT, yU], [zF0, yU], [zF1, yT], [zB, yT]];
  s.at(at.x, 0, 0, () =>
    moulding(s, look.shell, profile, [2.4, 2.4, 1.0, 3.6, 3.2, 3.8], [3, 2.2, 5.2, 3.6, 5.4, 3.8], -CASE.width / 2, CASE.width / 2, {
      steps: ctx.seg(6),
      seg: ctx.seg(5),
      // the shadow the block throws: its own underside, and the tongue just below it
      shade(p, n) {
        if (n[1] < -0.5 && p[1] > yU - 1.5 && p[2] > zT) return 0.5 + (0.2 * (p[2] - zT)) / (zF0 - zT);
        if (n[2] > 0.5 && p[1] < yU + 0.5 && p[2] < zT + 1.2) return 1 - 0.42 * Math.exp(-(yU - p[1]) / 6.5);
        if (n[2] > 0.5 && p[1] >= yU) return 0.93 + (0.07 * (p[1] - yU)) / (yT - yU);
        return 1;
      },
    }),
  );

  // the 2x10: a black shroud let into the underside, a bright pin on every connector terminal, pointing down
  const xs = at.pins.map((p) => p[0]), zs = at.pins.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  s.box(...PAL.plasticBlack, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 2.3, z1 - z0 + 2.4, yU - 0.15, yU + 0.4, 0.3, 0, { cap: true, ao: 1 });
  // square pins with flat faces (each corner is two points a hair apart), a blunt point at the tip
  const sq = (px: number, pz: number, h: number): Pt[] => [[1, -1], [1, 1], [-1, 1], [-1, -1]].flatMap(([a, b]) => (a === b ? [[px + a * h, pz + b * (h - 0.02)], [px + a * (h - 0.02), pz + b * h]] : [[px + a * (h - 0.02), pz + b * h], [px + a * h, pz + b * (h - 0.02)]]) as Pt[]);
  for (const [px, pz] of at.pins) {
    s.prism(...PIN, sq(px, pz, 0.37), yU - CASE.pins.showing + 0.6, yU - 0.2, 0, { ao: 1 });
    s.prism(...PIN, sq(px, pz, 0.23), yU - CASE.pins.showing, yU - CASE.pins.showing + 0.6, 0, { cap: true, ao: 1 });
  }
  for (const a of CASE.antennas) whipAntenna(s, { x: at.x + a.x, y: yT, z: at.z + a.z, length: a.length, d: a.d, grooves: a.grooves, seg: ctx.seg(18) });

  // the maker moulds its name into the leaning face: it is not reproduced, the face stays plain
  const root = s.toObject();
  return root;
}
