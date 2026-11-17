/**
 * Kode Camera module (KDCMR001 rev 1.0), SHAPE ONLY: the object, with no behaviour, no lamp and no picture.
 *
 * Sources: parts/kode-camera-shape/manifest.json (footprint 46.6 x 53.5 x 12 mm: the documented 46.6 x 45.5 mm board
 * plus the header's pins; the 20 connector terminals; the connector's seat) and the written spec
 * research/06-official-modules-spec.md section 4 (what is on the board: an OV5640 autofocus camera in an FD5640
 * module on a 24-way 0.5 mm flat flex J501, a 24 MHz oscillator, the 1.5 V and 2.8 V regulators U501 and U502, the
 * solder jumper JP501, four 3.2 mm holes, the 2x10 right-angle J401). No picture of this module exists among the
 * references: the family's look (black rounded-square board with a plain drilled hole in each corner, gold print,
 * bright header pins) is taken from the Maker and Robotics pictures, and where the holes (4.4 mm from the edges), the
 * lens, the flex and the small parts sit is a GUESS. The print is only the documented reference designators: what the real board prints is not known. Sizes of
 * the parts are their usual ones (camera head 8.5 x 8.5 x 5.5 mm, oscillator 3.2 x 2.5 mm, SOT-23-5 regulators).
 */
import manifest from '../../../../../parts/kode-camera-shape/manifest.json';
import { FONT, PAL, Shape, defineModel, footprintOf, print, silkBox, terminalsFromManifest, text, topQuad, type Finish, type PartState, type Pt } from '../../index';
import { SILK, asManifest, chipPassive, connectorOf, fpcConnector, moduleBoard, outlineBoard, rightAngleHeader, sot23 } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w: W, d: D } = footprintOf(M.body);
const con = connectorOf(M);

const B = moduleBoard(M, { inset: 4.4 }); // the documented 46.6 x 45.5 mm board; its holes are not in the manifest
const TOP = B.top; // the top face of the board
const EDGE = B.near; // its near edge: J401's plastic ends here, its pins go on
/** The parts' own layout was drawn round the middle of a board that ended 2 mm nearer: it is moved as one. */
const OZ = (-D / 2 + EDGE) / 2 + 1.9;

const CAM = { x: 0, z: -11.6, size: 8.5 }; // the camera head
const J501 = { x: 0, z: 2.6, w: 14.5 }; // the flex connector
const FLEX: Finish = ['gloss', '#b06a22']; // polyimide

/** Everything that stands on the board, in the layout's own frame. */
function parts(s: Shape, seg: (n: number) => number): void {
  const h = CAM.size;
  // the camera head on its foam pad: holder, the autofocus motor's can, the barrel and the lens
  s.box('soft', '#2b2b2e', CAM.x, CAM.z, h + 0.8, h + 0.8, TOP, TOP + 0.5, 0.6, 0, { ao: 0.9 });
  s.box(...PAL.plasticBlack, CAM.x, CAM.z, h, h, TOP + 0.5, TOP + 2.3, 0.7, 0.2, { ao: 0.92 });
  s.box(...PAL.blackOxide, CAM.x, CAM.z, h - 0.3, h - 0.3, TOP + 2.3, TOP + 4.5, 1.0, 0.4, { ao: 0.95 });
  s.disc(...PAL.plasticBlack, CAM.x, CAM.z, 3.35, TOP + 4.5, TOP + 5.5, 0.3, seg(24), { ao: 0.95 });
  s.disc('gloss', '#0d0d10', CAM.x, CAM.z, 2.6, TOP + 5.5, TOP + 5.62, 0.1, seg(24), { ao: 1 });
  s.disc('gloss', '#1c1438', CAM.x, CAM.z, 1.7, TOP + 5.62, TOP + 5.7, 0.06, seg(20), { ao: 1 }); // the coated front element
  s.lathe(...PAL.glassSmoke, CAM.x, CAM.z, [[1.7, TOP + 5.7], [1.45, TOP + 5.95], [0.85, TOP + 6.15], [0, TOP + 6.22]], seg(16));
  // the flat flex from the head to J501: a narrow neck that widens to the connector, with its stiffener
  const zHead = CAM.z + h / 2 - 0.4, zCon = J501.z - 0.4;
  const flex: Pt[] = [[-3.4, zHead], [3.4, zHead], [3.4, zHead + 4.2], [6.2, zHead + 7], [6.2, zCon], [-6.2, zCon], [-6.2, zHead + 7], [-3.4, zHead + 4.2]];
  s.prism(...FLEX, flex.map(([x, z]) => [CAM.x + x, z] as Pt), TOP + 0.45, TOP + 0.62, 0.05, { ao: 1 });
  s.box('matte', '#5b3d1c', CAM.x, zCon - 2.2, 12.4, 3.6, TOP + 0.62, TOP + 0.82, 0.3, 0.05, { ao: 1 });
  fpcConnector(s, { x: J501.x, z: J501.z, y: TOP, w: J501.w, turn: 2 });

  // the 24 MHz oscillator, the two regulators with their capacitors, the pull resistors
  s.box(...PAL.tin, -13.2, -12.4, 3.2, 2.5, TOP, TOP + 1.0, 0.4, 0.2, { ao: 0.95 });
  chipPassive(s, { x: -13.2, z: -8.9, y: TOP }); // R503 in the clock line
  chipPassive(s, { x: -9.4, z: -12.4, y: TOP, turn: 1, body: PAL.ceramic });
  sot23(s, { x: 13, z: -13, y: TOP, turn: 1 }); // U501, 1.5 V core
  sot23(s, { x: 13, z: -6.4, y: TOP, turn: 1 }); // U502, 2.8 V analogue
  for (const z of [-13, -6.4]) for (const dx of [-3, 3]) chipPassive(s, { x: 13 + dx, z, y: TOP, turn: 1, body: PAL.ceramic });
  chipPassive(s, { x: -15.4, z: -2.6, y: TOP }); // 2.2 k on SCL
  chipPassive(s, { x: -15.4, z: -0.2, y: TOP }); // 2.2 k on SDA
  chipPassive(s, { x: -15.4, z: 2.2, y: TOP }); // 10 k pull-down on PWDN
  chipPassive(s, { x: -11.4, z: 2.2, y: TOP, body: PAL.ceramic }); // reset RC
  // JP501 "autofocus": two pads bridged with solder
  for (const dx of [-0.8, 0.8]) s.box(...PAL.gold, 14 + dx, 0.6, 1.3, 1.9, TOP, TOP + 0.05, 0.3, 0, { ao: 1 });
  s.box(...PAL.tin, 14, 0.6, 1.5, 1.3, TOP + 0.05, TOP + 0.4, 0.5, 0.25, { ao: 1 });
}

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Camera module (shape only)',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    const s = new Shape();
    outlineBoard(s, { loop: B.loop, y: B.under, thick: TOP - B.under, holes: B.holes });
    rightAngleHeader(s, { x: con.seat[0], y: TOP, z: EDGE, n: 10, length: con.length, tail: TOP - B.under - 0.05 });
    s.at(0, 0, OZ, () => parts(s, ctx.seg));

    const root = s.toObject();
    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 16,
        draw(g) {
          g.translate(0, OZ);
          g.fillStyle = SILK;
          const h = CAM.size;
          const ref = (t: string, x: number, z: number) => text(g, t, x, z, 1.05, { font: FONT, weight: 700 });
          // where the head sits, and the documented reference designators
          silkBox(g, CAM.x - h / 2 - 1.1, CAM.z - h / 2 - 1.1, h + 2.2, h + 2.2, 0.9, 0.16, SILK);
          ref('J501', J501.x + J501.w / 2 + 2.8, J501.z + 0.2);
          ref('U501', 13, -15.9);
          ref('U502', 13, -9.3);
          ref('JP501', 14, -1.7);
        },
      }),
    );
    return root;
  },
  terminals,
});
