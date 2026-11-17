/** T5577 key fob: the teardrop 125 kHz fob (about 31 x 38 x 5 mm) on its split ring. */
import { INK, PAL, Shape, circleLoop, convexHull, defineModel, print, text, topQuad, type V3 } from '../../index';
import type { WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'rfid.tag',
  title: 'T5577 key fob',
  footprintMm: { w: 31, d: 46, h: 6.2 },
  build(ctx) {
    const s = new Shape();
    const eye = circleLoop(0, -11.2, 2.4, ctx.seg(14));
    s.prism(...PAL.glossRed, convexHull([...circleLoop(0, 8.4, 14.5, ctx.seg(40)), ...circleLoop(0, -9.6, 6.9, ctx.seg(24))]), 0, 5.2, 1.5, { holes: [eye] });
    s.disc('gloss', '#f1ede5', 0, 8.4, 10.4, 5.2, 5.95, 0.6, ctx.seg(32));
    // the split ring through the eye: it rests on the table at its far end
    const ring: V3[] = [];
    const n = ctx.seg(24);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const z = -15.9 + Math.cos(a) * 6.1;
      ring.push([Math.sin(a) * 6.1, 0.95 + ((z + 22) / 12.2) * 4.6, z]);
    }
    s.tube(...PAL.steel, ring, 0.8, 8, true);
    const root = s.toObject();
    root.add(
      print({
        name: 'dome',
        quad: topQuad(0, 8.4, 5.97, 10, 10),
        ppm: 12,
        draw(g) {
          g.strokeStyle = 'rgba(201,48,61,0.9)';
          g.lineWidth = 0.55;
          g.beginPath();
          g.arc(0, 0, 8.3, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = INK.red;
          text(g, '125', 0, -1.1, 6.4, { weight: 800 });
          g.fillStyle = '#7a756c';
          text(g, 'kHz', 0, 4.1, 2.9);
        },
      }),
    );
    return root;
  },
});
