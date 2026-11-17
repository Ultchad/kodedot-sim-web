/**
 * NFC tag: a round sticker tag (NTAG-style coin, 29 mm), the SIMPLE reference model of the kit.
 * Two solids and one print; no moving parts. Real size: 29 to 30 mm across, about 1.4 mm with its clear dome.
 */
import { INK, Shape, defineModel, print, topQuad, waves, rr } from '../../index';
import type { WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'nfc.tag',
  title: 'NFC tag',
  footprintMm: { w: 30, d: 30, h: 1.5 },
  build(ctx) {
    const s = new Shape();
    // the paper backing peeks out under the clear dome
    s.disc('matte', '#ece8df', 0, 0, 14.8, 0, 0.45, 0.15, ctx.seg(40));
    s.disc('gloss', '#fbfaf6', 0, 0, 13.7, 0.45, 1.4, 0.55, ctx.seg(40));
    const root = s.toObject();
    root.add(
      print({
        name: 'coil',
        quad: topQuad(0, 0, 1.42, 13.7, 13.7),
        ppm: 12,
        draw(g) {
          // the antenna: a copper coil under the clear face, with the chip bridging it
          g.strokeStyle = INK.copper;
          g.lineWidth = 0.42;
          for (let i = 0; i < 6; i++) {
            g.beginPath();
            g.arc(0, 0, 12.3 - i * 0.82, 0, Math.PI * 2);
            g.stroke();
          }
          g.fillStyle = '#2b2a2d';
          rr(g, -1.5, 7.6, 3, 2.2, 0.4);
          g.fill();
          // the middle in the bench's colour for NFC, with the contactless sign
          g.fillStyle = INK.blue;
          g.beginPath();
          g.arc(0, 0, 6.1, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#ffffff';
          waves(g, -2.6, 0, 5.4, 3, 0, 0.95);
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(-2.6, 0, 0.75, 0, Math.PI * 2);
          g.fill();
        },
      }),
    );
    return root;
  },
});
