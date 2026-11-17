/**
 * Kode Camera module (KDCMR001 rev 1.0), SHAPE ONLY: the object, with no behaviour, no lamp and no picture.
 *
 * Sources: parts/kode-camera-shape/manifest.json (footprint 46.6 x 45.5 x 12 mm: the documented board size; the 17
 * mount terminals) and the written spec research/06-official-modules-spec.md section 4 (what is on the board: an
 * OV5640 autofocus camera in an FD5640 module on a 24-way 0.5 mm flat flex J501, a 24 MHz oscillator, the 1.5 V and
 * 2.8 V regulators U501 and U502, the solder jumper JP501 "autofocus", four 3.2 mm holes, the 2x10 right-angle J401).
 * The store picture does not show this module: the family's look (black board with eared corners, amber print,
 * tinned header pins) is taken from its Maker and Robotics pictures. Where the lens, the flex and the small parts
 * sit on the board is NOT documented: the arrangement here is a guess. Sizes of the parts are their usual ones
 * (camera head 8.5 x 8.5 x 5.5 mm, oscillator 3.2 x 2.5 mm, SOT-23-5 regulators).
 *
 * J401 is the real 2x10 right-angle header, centred on the manifest's mount pins, pins pointing at the viewer (+Z,
 * into the Dot's top wall): see shared.ts. The manifest's footprint is the bare board, so the board is drawn 3.8 mm
 * shorter than documented to keep the pins inside it. No maker's logo or wordmark: the print is the plain designation.
 */
import manifest from '../../../../../parts/kode-camera-shape/manifest.json';
import { FONT_HEAD, FONT_MONO, INK, PAL, Shape, defineModel, footprintOf, print, rr, silkBox, terminalsFromManifest, text, topQuad, type Finish, type PartState, type Pt } from '../../index';
import { asManifest, chipPassive, earOutline, fpcConnector, mountBlock, outlineBoard, rightAngleHeader, sot23, type KodeMount } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const { w: W, d: D } = footprintOf(M.body);
const mount = mountBlock(M);

const BOARD_Y = 1.3; // the board rests on the solder joints of J401
const TOP = BOARD_Y + 1.6;
const J401_Z = mount.z0 - 1.3;
const J401_LEN = D / 2 - 0.2 - J401_Z;
const OUTLINE = earOutline({ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: J401_Z + 1.5, ear: 4, inset: { far: 1.5, near: 1.5, side: 1.5 } });

const CAM = { x: 0, z: -11.6, size: 8.5 }; // the camera head
const J501 = { x: 0, z: 2.6, w: 14.5 }; // the flex connector
const FLEX: Finish = ['gloss', '#b06a22']; // polyimide

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Camera module (shape only)',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    const s = new Shape();
    outlineBoard(s, { loop: OUTLINE.loop, y: BOARD_Y, holes: OUTLINE.ears.map(([x, z]) => ({ x, z, d: 3.2 })) });
    const tip = rightAngleHeader(s, { x: mount.x, y: TOP, z: J401_Z, n: 10, length: J401_LEN });

    // the camera head on its foam pad: holder, the autofocus motor's can, the barrel and the lens
    const h = CAM.size;
    s.box('soft', '#2b2b2e', CAM.x, CAM.z, h + 0.8, h + 0.8, TOP, TOP + 0.5, 0.6, 0, { ao: 0.9 });
    s.box(...PAL.plasticBlack, CAM.x, CAM.z, h, h, TOP + 0.5, TOP + 2.3, 0.7, 0.2, { ao: 0.92 });
    s.box(...PAL.blackOxide, CAM.x, CAM.z, h - 0.3, h - 0.3, TOP + 2.3, TOP + 4.5, 1.0, 0.4, { ao: 0.95 });
    s.disc(...PAL.plasticBlack, CAM.x, CAM.z, 3.35, TOP + 4.5, TOP + 5.5, 0.3, ctx.seg(24), { ao: 0.95 });
    s.disc('gloss', '#0d0d10', CAM.x, CAM.z, 2.6, TOP + 5.5, TOP + 5.62, 0.1, ctx.seg(24), { ao: 1 });
    s.disc('gloss', '#1c1438', CAM.x, CAM.z, 1.7, TOP + 5.62, TOP + 5.7, 0.06, ctx.seg(20), { ao: 1 }); // the coated front element
    s.lathe(...PAL.glassSmoke, CAM.x, CAM.z, [[1.7, TOP + 5.7], [1.45, TOP + 5.95], [0.85, TOP + 6.15], [0, TOP + 6.22]], ctx.seg(16));
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

    const root = s.toObject();
    root.add(
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 16,
        draw(g) {
          g.fillStyle = INK.amber;
          const mono = (t: string, x: number, z: number, size = 0.95, align: CanvasTextAlign = 'center') => text(g, t, x, z, size, { font: FONT_MONO, weight: 700, align });
          // where the head sits, with the corner mark of the sensor's first pixel
          silkBox(g, CAM.x - h / 2 - 1.1, CAM.z - h / 2 - 1.1, h + 2.2, h + 2.2, 0.9, 0.16, INK.amber);
          g.beginPath();
          g.arc(CAM.x - h / 2 - 1.9, CAM.z - h / 2 - 1.9, 0.4, 0, Math.PI * 2);
          g.fill();
          mono('J501', J501.x + J501.w / 2 + 2.6, J501.z + 0.2);
          mono('Y501', -13.2, -15);
          mono('U501', 13, -15.9);
          mono('U502', 13, -9.3);
          mono('JP501', 14, -1.7);
          mono('AF', 14, 2.9, 1.1);
          mono('SCL', -12.4, -2.6, 0.9, 'left');
          mono('SDA', -12.4, -0.2, 0.9, 'left');
          mono('J401', mount.x + 14, J401_Z - 1.3, 0.9, 'left');
          // the plain designation, where the maker prints its mark
          text(g, 'CAMERA', -9.6, 7.9, 2.0, { font: FONT_HEAD, weight: 700, spacing: 0.45 });
          mono('KDCMR001  rev 1.0', 8.6, 7.2, 1.0);
          mono('5 MP AF  3V3', 8.6, 8.8, 0.9);
          g.strokeStyle = INK.amber;
          g.lineWidth = 0.16;
          rr(g, 0.8, 5.9, 15.6, 4.1, 0.6);
          g.stroke();
        },
      }),
    );
    root.userData.kodeMount = { pos: tip, dir: [0, 0, 1], via: M.mount?.via ?? 'direct' } satisfies KodeMount;
    return root;
  },
  terminals,
});
