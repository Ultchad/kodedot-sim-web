/** EM4100 card: the thick white clamshell card (85.6 x 54 x 1.9 mm) with its lanyard slot and printed number. */
import { FONT_MONO, INK, Shape, defineModel, print, roundedRectLoop, text, topQuad } from '../../index';
import type { WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'rfid.card',
  title: 'EM4100 card',
  footprintMm: { w: 85.6, d: 54, h: 2 },
  build() {
    const s = new Shape();
    // the lanyard slot is punched through
    const slot = roundedRectLoop(0, -21.6, 14, 3.2, 1.6, 5);
    s.prism('matte', '#f6f3ec', roundedRectLoop(0, 0, 85.6, 54, 3.4, 6), 0, 1.9, 0.55, { holes: [slot] });
    const root = s.toObject();
    root.add(
      print({
        name: 'face',
        quad: topQuad(0, 0, 1.92, 42.8, 27),
        ppm: 8,
        draw(g) {
          // the coil shows faintly through the shell
          g.strokeStyle = 'rgba(120,105,85,0.16)';
          g.lineWidth = 2.4;
          g.beginPath();
          g.arc(14, 3, 17, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = INK.red;
          g.beginPath();
          g.roundRect(-36, -9, 3.2, 14, 1.6);
          g.fill();
          g.fillStyle = '#3d3a36';
          text(g, '125 kHz', -30.5, -5.2, 4.3, { align: 'left', weight: 700 });
          g.fillStyle = '#6b665e';
          text(g, 'ID card', -30.5, 1.2, 3.1, { align: 'left' });
          text(g, '0007820901  119,22357', -36, 19.5, 2.9, { align: 'left', weight: 500, font: FONT_MONO });
        },
      }),
    );
    return root;
  },
});
