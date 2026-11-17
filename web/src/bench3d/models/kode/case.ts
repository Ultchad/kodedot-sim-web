/**
 * The moulding of the two cased Kode modules (Mesh, white; the multi-radio one, black).
 *
 * Its measures were taken from the owner's reference pictures (ref-5 to ref-8, never copied) with a camera solved for
 * each: the mounted pictures against the Dot's own features, the pictures of the module alone against the 2.54 mm
 * pitch of its pins, and points seen in both triangulated. They are now the MANIFEST's, and the model takes them
 * from there:
 *
 *   - `body`: 47 mm wide (as wide as the Dot), 35 deep, 95 high with the whips;
 *   - `profile`: the side silhouette, one L-shaped moulding: a block 18.2 mm high whose front face leans forward
 *     (31 mm deep at its foot, 35 at its top) over a tongue 14 mm thick that hangs 26 mm below it, flush with the
 *     block's back and with both of its ends;
 *   - the 2x10 pin terminals and `mount.connector` (7 mm of pin under the block, 10 mm in front of the tongue: the
 *     Dot hangs on them with its back against the tongue);
 *   - `refs` SMA1 and SMA2: where the two whip antennas stand on the flat top, and how long they are.
 *
 * What the manifest does not hold is read off the same pictures: the fillets (3 to 5.5 mm on the block, tighter on
 * the tongue), the whips' girth (8.5 to 8.8 mm), their grooves, the gold SMA parts under them, the black shroud.
 * The maker moulds its name into the front face: it is not reproduced, the face is left plain.
 *
 * The module STANDS, as in the pictures: tongue down to the table, antennas up, the leaning face and the pins towards
 * the viewer (+Z).
 */
import { PAL, Shape, footprintOf, type BuildCtx, type Finish, type Object3D, type Pt } from '../../index';
import { connectorOf, connectorPins, moulding, whipAntenna, type KodeManifest } from './shared';

/** The pins' bright tin, a little warm as the pictures show it. */
const PIN: Finish = ['metal', '#aaa798'];

export interface CaseLook {
  shell: Finish;
}

export function buildCasedModule(m: KodeManifest, look: CaseLook, ctx: BuildCtx): Object3D {
  const { w: W, d: D } = footprintOf(m.body);
  const con = connectorOf(m);
  // the manifest's silhouette in the model frame (z, y), counter-clockwise from the foot of the back:
  // foot of the back, foot of the tongue's front, the hollow under the block, the block's front foot and top, the back's top
  const profile: Pt[] = (m.profile ?? []).map((q) => [q.y - D / 2, q.z] as Pt);
  if (profile.length !== 6) throw new Error(`${m.id}: the housing's profile must be the six points of an L`);
  const zT = profile[1][0], yU = profile[2][1], zF0 = profile[3][0], yT = profile[4][1];
  const s = new Shape();

  // the moulding: one skin
  moulding(s, look.shell, profile, [2.4, 2.4, 1.0, 3.6, 3.2, 3.8], [3, 2.2, 5.2, 3.6, 5.4, 3.8], -W / 2, W / 2, {
    steps: ctx.seg(6),
    seg: ctx.seg(5),
    // the shadow the block throws: its own underside, and the tongue just below it
    shade(p, n) {
      if (n[1] < -0.5 && p[1] > yU - 1.5 && p[2] > zT) return 0.5 + (0.2 * (p[2] - zT)) / (zF0 - zT);
      if (n[2] > 0.5 && p[1] < yU + 0.5 && p[2] < zT + 1.2) return 1 - 0.42 * Math.exp(-(yU - p[1]) / 6.5);
      if (n[2] > 0.5 && p[1] >= yU) return 0.93 + (0.07 * (p[1] - yU)) / (yT - yU);
      return 1;
    },
  });

  // the 2x10: a thin black shroud let into the underside, a square pin on every connector terminal, pointing down
  const pins = connectorPins(m);
  const xs = pins.map((p) => p[0]), zs = pins.map((p) => p[2]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const seat = con.seat[1], tip = seat - con.length;
  s.box(...PAL.plasticBlack, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 2.54, z1 - z0 + 2.54, seat - 0.35, seat + 0.4, 0.25, 0.12, { cap: true, ao: 1 });
  // 0.64 mm square pins with flat faces (each corner is two points a hair apart) and a chamfered tip
  const sq = (px: number, pz: number, h: number): Pt[] => [[1, -1], [1, 1], [-1, 1], [-1, -1]].flatMap(([a, b]) => (a === b ? [[px + a * h, pz + b * (h - 0.02)], [px + a * (h - 0.02), pz + b * h]] : [[px + a * (h - 0.02), pz + b * h], [px + a * h, pz + b * (h - 0.02)]]) as Pt[]);
  for (const p of pins) {
    s.prism(...PIN, sq(p[0], p[2], 0.32), tip + 0.5, seat - 0.3, 0, { cap: true, ao: 1 });
    s.prism(...PIN, sq(p[0], p[2], 0.17), tip, tip + 0.5, 0, { cap: true, ao: 1 });
  }
  // the antennas: the shorter whip is the stubbier one
  const sma = (m.refs ?? []).filter((r) => r.kind === 'antenna_sma');
  const shortest = Math.min(...sma.map((r) => r.length_mm ?? 30));
  for (const r of sma) {
    const len = r.length_mm ?? 30, stub = len === shortest;
    whipAntenna(s, { x: r.mm.x - W / 2, y: r.mm.z, z: r.mm.y - D / 2, length: len, d: stub ? 8.8 : 8.5, grooves: stub ? 7 : 4.2, seg: ctx.seg(18) });
  }

  // the maker moulds its name into the leaning face: it is not reproduced, the face stays plain
  return s.toObject();
}
