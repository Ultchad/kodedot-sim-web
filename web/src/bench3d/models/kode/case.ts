/**
 * The moulded case of the two cased Kode modules (Mesh and the multi-radio one): an L-shaped shell in the Dot's own
 * plastic. Standing as the maker shows it, a cap sits on the Dot's top wall with the antenna jacks on its top and the
 * 2x10 pin block (the passive interposer) under its overhang, and a flat body hangs down the Dot's back.
 *
 * In the model frame the module LIES ON ITS BACK, as it does beside a Dot lying on its back: the flat body on the
 * table, the cap at the far end (-Z) rising to the footprint's height, the pins pointing at the viewer (+Z, into the
 * Dot's top wall) above the body, the jacks pointing away. The sloping face of the cap (where the maker moulds its
 * mark, left out here) carries the plain designation.
 *
 * What is NOT here: the whip antennas. The manifests' footprints (about 42 x 45 x 20 mm, the bare board plus a guess
 * of the height) have no room for them in any pose: only the jacks they screw onto are built. The case itself is
 * about 20 % shorter than the pictures suggest, for the same reason.
 */
import { FONT_HEAD, FONT_MONO, Matrix4, PAL, PITCH, Shape, footprintOf, print, roundPolygon, rr, text, topQuad, type BuildCtx, type Finish, type Object3D, type Pt, type Quad } from '../../index';
import { LYING, mountBlock, smaJack, type KodeManifest, type KodeMount } from './shared';

export interface CaseLook {
  shell: Finish;
  /** The seam between the case's two halves. */
  seam: string;
  /** Legends moulded tone on tone: the shade of the letters and of their lit edge. */
  ink: string;
  inkEdge: string;
  /** Plain designation on the cap's slope and the part code under it. */
  name: string;
  code: string;
  /** The antenna jacks on the cap, by their place along X, with the legend beside each. */
  jacks: readonly { x: number; label: string }[];
  /** Further legends on the body's inner face (drawn in millimetres round its middle, y down the face). */
  face?(g: CanvasRenderingContext2D, w: number, d: number): void;
}

const JACK = 6.2; // how far an SMA jack stands out of the cap
const CAP = 12.5; // the cap along Z (its height when the module stands)
const BODY = 6; // thickness of the flat body
const SLOPE = 5.4; // the cap's sloping face, measured along each of its two sides
const BRASS: Finish = ['metal', '#d9c489']; // gold flash over brass: paler than the kit's contact gold

/** A profile drawn in (z, y), extruded across the part from -w/2 to +w/2 with both ends bevelled. */
function extrudeAcross(s: Shape, finish: Finish, profile: Pt[], w: number, bevel: number): void {
  // two halves, each growing outwards from the middle, so that both ends get the rounded edge of a prism's top
  s.with(new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1), () => s.prism(...finish, profile, 0, w / 2, bevel, { ao: 1 }));
  s.with(new Matrix4().set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1), () => s.prism(...finish, profile.map(([z, y]) => [-z, y] as Pt).reverse(), 0, w / 2, bevel, { ao: 1 }));
}

export function buildCasedModule(m: KodeManifest, look: CaseLook, ctx: BuildCtx): Object3D {
  const { w: W, d: D, h: H } = footprintOf(m.body);
  const mount = mountBlock(m);
  const z0 = -D / 2 + JACK + 0.1; // the cap's top face (it looks at -Z)
  const z1 = z0 + CAP; // the cap's underside (it looks at +Z, at the Dot)
  const zEnd = D / 2 - 0.1;
  const capH = H - 0.2;
  const s = new Shape();

  // the flat body: base and lid with the seam between them
  const zMid = (z0 + zEnd) / 2, len = zEnd - z0;
  s.box(...look.shell, 0, zMid, W, len, 0, 2.5, 3.6, 0, { ao: 0.8 });
  s.box('matte', look.seam, 0, zMid, W - 0.5, len - 0.5, 2.5, 2.75, 3.4, 0, { ao: 1 });
  s.box(...look.shell, 0, zMid, W, len, 2.75, BODY, 3.6, 1.1, { ao: 0.95 });
  // the cap: a wedge with soft edges, its slope between the jack face and the face that rests on the Dot's top
  const profile = roundPolygon([[z0, 0], [z1, 0], [z1, capH], [z0 + SLOPE, capH], [z0, capH - SLOPE]], [0.5, 0, 1.7, 1.3, 1.3], 3);
  extrudeAcross(s, look.shell, profile, W, 1.4);

  // the interposer's pin block under the cap: 2 x 10 at 2.54 mm, pointing at the Dot
  const yc = BODY + (capH - BODY) / 2;
  const zPins = z1 + 0.9, pinLen = 7.5;
  s.box('matte', '#141416', mount.x, z1 + 0.1, 10 * PITCH + 1.2, 0.3, yc - PITCH - 0.6, yc + PITCH + 0.6, 0.15, 0, { ao: 1 });
  for (let i = 0; i < 10; i++) s.box(...PAL.plasticBlack, mount.x + (i - 4.5) * PITCH, z1 + 0.45, PITCH - 0.1, 0.9, yc - PITCH, yc + PITCH, 0.2, 0.25, { cap: true, ao: 0.95 });
  for (let i = 0; i < 10; i++) for (const r of [-0.5, 0.5]) {
    const px = mount.x + (i - 4.5) * PITCH, py = yc + r * PITCH;
    s.with(LYING, () => s.prism(...BRASS, [[px + 0.32, -py - 0.32], [px + 0.32, -py + 0.32], [px - 0.32, -py + 0.32], [px - 0.32, -py - 0.32]], zPins, zPins + pinLen, 0.16, { ao: 1 }));
  }
  // the antenna jacks
  const yJack = 6, faceH = capH - SLOPE;
  for (const j of look.jacks) smaJack(s, { x: j.x, y: yJack, z: z0, len: JACK, seg: ctx.seg(16), finish: BRASS });

  const root = s.toObject();
  const moulded = (g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, o: Parameters<typeof text>[5] = {}) => {
    // letters sunk into the plastic: the shade, and a hair of light on their lower edge
    g.fillStyle = look.inkEdge;
    text(g, t, x, y + size * 0.06, size, o);
    g.fillStyle = look.ink;
    text(g, t, x, y, size, o);
  };
  const faceD = zEnd - z1;
  const slope: Quad = { c: [0, capH - SLOPE / 2 + 0.03, z0 + SLOPE / 2 - 0.03], u: [-(W / 2 - 3), 0, 0], v: [0, 1.95, 1.95] };
  const jackFace: Quad = { c: [0, faceH / 2, z0 - 0.03], u: [-(W / 2 - 1.5), 0, 0], v: [0, faceH / 2 - 0.6, 0] };
  root.add(
    print({
      name: 'face',
      quad: topQuad(0, (z1 + zEnd) / 2, BODY + 0.02, W / 2, faceD / 2),
      ppm: 12,
      draw(g) {
        // the panel line of the lid, and the part code at the foot of the face
        g.strokeStyle = look.ink;
        g.lineWidth = 0.22;
        rr(g, -W / 2 + 2.6, -faceD / 2 + 1.2, W - 5.2, faceD - 3.8, 2.2);
        g.stroke();
        moulded(g, `${look.code}  rev 1.0`, 0, faceD / 2 - 5.2, 1.25, { font: FONT_MONO, weight: 700 });
        look.face?.(g, W, faceD);
      },
    }),
    print({
      name: 'slope',
      quad: slope,
      ppm: 12,
      draw(g) {
        moulded(g, look.name, 0, 0.1, 3.3, { font: FONT_HEAD, weight: 700, spacing: 1.1 });
      },
    }),
    print({
      name: 'jacks',
      quad: jackFace,
      ppm: 12,
      draw(g) {
        // seen from behind, +X is on the left: each legend sits over its jack
        for (const j of look.jacks) moulded(g, j.label, -j.x, faceH / 2 - (yJack + 6.3), 1.35, { font: FONT_MONO, weight: 700 });
      },
    }),
  );
  root.userData.kodeMount = { pos: [mount.x, yc, zPins + pinLen], dir: [0, 0, 1], via: m.mount?.via ?? 'interposer' } satisfies KodeMount;
  return root;
}
