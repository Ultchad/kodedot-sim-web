/** NFC card: an ISO/IEC 7810 ID-1 card (85.6 x 54 mm), glossy, with a printed face. */
import { INK, PAL, Shape, defineModel, print, rr, text, topQuad, waves } from '../../index';
import type { WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'nfc.card',
  title: 'NFC card',
  footprintMm: { w: 85.6, d: 54, h: 1.1 },
  build() {
    const s = new Shape();
    s.box(...PAL.glossBlue, 0, 0, 85.6, 54, 0, 1.0, 3.3, 0.3);
    const root = s.toObject();
    root.add(
      print({
        name: 'face',
        quad: topQuad(0, 0, 1.02, 42.8, 27),
        ppm: 8,
        draw(g) {
          rr(g, -42.8, -27, 85.6, 54, 3.3);
          g.clip();
          // two soft shapes: a lighter blue and the page's amber
          g.fillStyle = '#3fa3cf';
          g.beginPath();
          g.arc(30, 30, 34, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = INK.amber;
          g.beginPath();
          g.arc(31, 17, 7.5, 0, Math.PI * 2);
          g.fill();
          // the contact pad of the chip
          g.fillStyle = INK.gold;
          rr(g, -34, -7.5, 12.5, 10, 1.8);
          g.fill();
          g.strokeStyle = 'rgba(90,60,10,0.55)';
          g.lineWidth = 0.3;
          g.beginPath();
          g.moveTo(-34, -2.5);
          g.lineTo(-21.5, -2.5);
          g.moveTo(-30, -7.5);
          g.lineTo(-30, 2.5);
          g.moveTo(-25.5, -7.5);
          g.lineTo(-25.5, 2.5);
          g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.92)';
          waves(g, 26, -15, 8.5, 4, 0, 1.05);
          g.fillStyle = 'rgba(255,255,255,0.92)';
          text(g, 'NFC-A  13.56 MHz', -34, -19, 3.1, { align: 'left' });
          g.fillStyle = 'rgba(255,255,255,0.75)';
          rr(g, -34, 11, 30, 2.4, 1.2);
          g.fill();
          rr(g, -34, 16.5, 19, 2.4, 1.2);
          g.fill();
        },
      }),
    );
    return root;
  },
});
