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
          // a plain label: the capacity, and the card format in small
          g.fillStyle = INK.amber;
          rr(g, -4.7, -5.6, 8.4, 10.6, 0.7);
          g.fill();
          g.fillStyle = '#231a05';
          text(g, '8', -0.5, -2.2, 4.6, { weight: 800 });
          text(g, 'GB', -0.5, 1.4, 2.4, { weight: 800 });
          text(g, 'microSD', -0.5, 3.9, 1.35, { weight: 700 });
        },
      }),
    );
    return root;
  },
});
