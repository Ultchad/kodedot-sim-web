/** microSD card: 11 x 15 x 1 mm, with its notch and lip. The end at -Z goes into the Dot's slot first. */
import { INK, Shape, defineModel, print, rr, text, topQuad, type Pt } from '../../index';
import type { WirelessState } from './state';

const OUTLINE: Pt[] = [[-5.5, -7.5], [3.5, -7.5], [4.6, -6.4], [4.6, -2.7], [5.5, -1.8], [5.5, 0.9], [4.8, 1.6], [4.8, 3.1], [5.5, 3.8], [5.5, 7.5], [-5.5, 7.5]];

export default defineModel<WirelessState>({
  id: 'sd.card',
  title: 'microSD card',
  footprintMm: { w: 11, d: 15, h: 1.1 },
  build() {
    const s = new Shape();
    s.prism('matte', '#1c1c1f', OUTLINE, 0, 0.8, 0.14, { cap: true, ao: 0.9 });
    s.box('matte', '#1c1c1f', 0, 6.7, 9.8, 1.1, 0.8, 1.05, 0.45, 0.1);
    const root = s.toObject();
    root.add(
      print({
        name: 'label',
        quad: topQuad(0, 0, 0.82, 5.5, 7.5),
        ppm: 24,
        draw(g) {
          g.fillStyle = INK.red;
          rr(g, -4.7, -5.6, 8.4, 10.6, 0.7);
          g.fill();
          g.fillStyle = INK.amber;
          rr(g, -4.7, 2.3, 8.4, 2.7, 0.7);
          g.fill();
          g.fillStyle = '#ffffff';
          text(g, 'micro', -0.5, -3.4, 2.3, { weight: 700 });
          text(g, 'SD', -0.5, -0.6, 3.3, { weight: 800 });
          g.fillStyle = '#231a05';
          text(g, '8 GB', -0.5, 3.75, 1.9, { weight: 800 });
        },
      }),
    );
    return root;
  },
});
