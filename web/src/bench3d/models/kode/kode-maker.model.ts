/**
 * Kode Maker module (KDMKR001 rev 1.0): a passive breadboard carrier for the Dot's expansion header.
 *
 * Sources: parts/kode-maker/manifest.json (the footprint: a 58 x 54 mm board plus the header's pins; the four
 * mounting holes; all 220 terminals; the connector's seat: measured from the picture by the parts engineer, an
 * ESTIMATE), the written spec research/06-official-modules-spec.md section 2 (an SYB-170 breadboard, 45.5 x 34.5 mm,
 * glued in the middle; the silkscreen ratings "5V-1A" and "3V3-1A") and the maker's store picture (ref-4, never
 * copied) for everything seen: the black rounded-square board with a gold-ringed hole in each corner, the plain white
 * breadboard with its closed centre channel inside a thin gold outline, the row of fourteen sockets on the far edge
 * with a small turned legend at each, two single-file strips of four power sockets down each side, the 2x10
 * right-angle header with bright pins on the near edge.
 * The print is the functional legends and the board's own name and revision; the maker's logo, name mark and web
 * address, which the real board prints above the header, are left out (the kit's rule: no real marks).
 * The legend at each socket could not be read off the picture beyond its number: the GPIO number is printed, taken
 * from the manifest (the socket's net and the mount table). Each power strip is named by the rail the MANIFEST wires
 * it to (the picture prints one legend beside each strip: the rail with its documented rating, or GND), so that the
 * print can never disagree with what the strip does on the bench.
 *
 * Every socket and every breadboard hole is drawn on its manifest terminal, the board and its holes where the
 * manifest has them, the header on the connector's seat. The 170 holes are print, not geometry (the board is drawn
 * many times over).
 *
 * The board is passive: nothing lights. Its one hazard, more than a GPIO socket stands (5 V on a 3.3 V line), shows
 * as a red-hot collar round the socket: the simulator's own way of speaking, not a part of the board.
 */
import manifest from '../../../../../parts/kode-maker/manifest.json';
import { PAL, PITCH, Shape, defineModel, footprintOf, glowing, part, partState, print, roundedRectLoop, rr, setLamp, terminalsFromManifest, topQuad, type PartState, type V3 } from '../../index';
import { SILK, asManifest, connectorOf, moduleBoard, outlineBoard, pinPoints, rightAngleHeader, silkText, socketStrip, stripBetween, tailRows } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const at = pinPoints(M);
const { w: W, d: D } = footprintOf(M.body);
const con = connectorOf(M);
const B = moduleBoard(M);
const TOP = B.top; // the top face of the board
const EDGE = B.near; // its near edge: J401's plastic ends here, its pins go on

/** The breadboard: every tie point of the manifest, and the documented 45.5 x 34.5 mm body centred on them. */
const TIES = M.pins.filter((p) => /^[a-j]\d+$/.test(p.name)).map((p) => at[p.name]);
const BB = {
  x: (Math.min(...TIES.map((p) => p[0])) + Math.max(...TIES.map((p) => p[0]))) / 2,
  z: (Math.min(...TIES.map((p) => p[2])) + Math.max(...TIES.map((p) => p[2]))) / 2,
  w: 45.5,
  d: 34.5,
  h: TIES[0][1] - TOP, // its top face is where the tie points are
};
/** The closed channel between rows e and f: in the picture it runs from the third column to the fifteenth. */
const CHANNEL = { x: (at.e3[0] + at.e15[0]) / 2, z: (at.e1[2] + at.f1[2]) / 2, w: Math.abs(at.e15[0] - at.e3[0]) + 1, d: at.f1[2] - at.e1[2] - 2.3, depth: 2.2 };
/** The thin outline printed round the breadboard stands this far off it. */
const BB_OUTLINE = 0.7;

/**
 * The GPIO sockets S1..S14 with the GPIO each carries (its net holds one pin of J401, which the mount table maps)
 * and the most each one stands (the manifest's abs_max_mv), for the legends and the overvoltage look.
 */
const SOCKETS = M.pins
  .filter((p) => /^S\d+$/.test(p.name))
  .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1)))
  .map((p) => {
    const net = M.groups?.find((g) => g.pins.includes(p.name))?.pins ?? [];
    return { name: p.name, x: at[p.name][0], max: p.abs_max_mv ?? 3600, gpio: M.mount?.pins.find((mp) => net.includes(mp.pin))?.gpio };
  });
const S_FIRST = at[SOCKETS[0].name], S_LAST = at[SOCKETS[SOCKETS.length - 1].name];
const SOCKET_H = S_FIRST[1] - TOP;

/** What the board prints beside a strip, by the rail the strip is wired to (ratings: the written spec). */
const RAIL_LEGEND: Record<string, string> = { V5: '5V-1A', V33: '3V3-1A', GND: 'GND' };
/**
 * The power strips: the manifest's sockets named <strip>_<n>, strip by strip, each a single file from its first to
 * its last contact, with the rail its net is wired to (the net holds a pin of J401 that the mount table calls a rail).
 */
const STRIPS = (() => {
  const by = new Map<string, { n: number; p: V3 }[]>();
  for (const p of M.pins) {
    const m = /^([A-Z]+\d*)_(\d+)$/.exec(p.name);
    if (!m || /^J\d/.test(p.name) || p.face !== 'top' || !at[p.name]) continue;
    by.set(m[1], [...(by.get(m[1]) ?? []), { n: Number(m[2]), p: at[p.name] }]);
  }
  return [...by.entries()].map(([name, list]) => {
    list.sort((a, b) => a.n - b.n);
    const net = M.groups?.find((g) => g.pins.includes(`${name}_${list[0].n}`))?.pins ?? [];
    const rail = M.mount?.rails.find((r) => net.includes(r.pin))?.rail;
    return { name, n: list.length, a: list[0].p, b: list[list.length - 1].p, legend: rail ? RAIL_LEGEND[rail] ?? rail : name };
  });
})();

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Maker module',
  footprintMm: footprintOf(M.body),
  build() {
    const s = new Shape();
    outlineBoard(s, { loop: B.loop, y: B.under, thick: TOP - B.under, holes: B.holes });

    // J502, the fourteen GPIO sockets on the far edge, and the four single-file power strips down the sides
    socketStrip(s, { ...stripBetween(S_FIRST, S_LAST), y: TOP, n: SOCKETS.length, h: SOCKET_H });
    for (const st of STRIPS) socketStrip(s, { ...stripBetween(st.a, st.b), y: TOP, n: st.n, h: st.a[1] - TOP });
    rightAngleHeader(s, { x: con.seat[0], y: TOP, z: EDGE, n: 10, length: con.length, tail: TOP - B.under - 0.05 });

    // the breadboard on its foam pad: a white block with the channel let into its top
    s.box('soft', '#d9d5cb', BB.x, BB.z, BB.w - 1.2, BB.d - 1.2, TOP, TOP + 0.9, 1, 0, { ao: 0.8 });
    s.prism(...PAL.plasticWhite, roundedRectLoop(BB.x, BB.z, BB.w, BB.d, 1.1, 3), TOP + 0.9, TOP + BB.h, 0.45, {
      ao: 0.86,
      holes: [roundedRectLoop(CHANNEL.x, CHANNEL.z, CHANNEL.w, CHANNEL.d, 0.5, 2)],
    });
    s.box('matte', '#bdb8ad', CHANNEL.x, CHANNEL.z, CHANNEL.w, CHANNEL.d, TOP + 0.9, TOP + BB.h - CHANNEL.depth, 0.5, 0, { ao: 1 });

    const root = s.toObject();
    const top = TOP + BB.h;
    // the collar that glows round an overloaded socket: built on the first one, moved by `animate`, hidden until then
    const collar = new Shape();
    collar.prism('gloss', '#c2241c', roundedRectLoop(S_FIRST[0], S_FIRST[2], 7, 7, 2, 4), TOP + SOCKET_H - 0.9, TOP + SOCKET_H + 0.45, 0.35, {
      ao: 1,
      holes: [roundedRectLoop(S_FIRST[0], S_FIRST[2], 2.7, 2.7, 0.3, 2)],
    });
    const hot = glowing('hot', collar);
    hot.visible = false;
    root.add(
      print({
        name: 'holes',
        quad: topQuad(BB.x, BB.z, top + 0.02, BB.w / 2, BB.d / 2),
        ppm: 16,
        draw(g) {
          // each tie point: a chamfered square mouth with the spring's shadow inside
          for (const p of TIES) {
            const x = p[0] - BB.x, y = p[2] - BB.z;
            g.fillStyle = 'rgba(150,142,128,0.5)';
            g.fillRect(x - 0.88, y - 0.88, 1.76, 1.76);
            g.fillStyle = '#242220';
            g.fillRect(x - 0.72, y - 0.72, 1.44, 1.44);
            g.fillStyle = 'rgba(8,8,8,0.6)';
            g.fillRect(x - 0.72, y - 0.72, 1.44, 0.5);
          }
        },
      }),
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 16,
        draw(g) {
          g.fillStyle = g.strokeStyle = SILK;
          const label = (t: string, x: number, z: number, size: number, angle = 0, align: CanvasTextAlign = 'center') => silkText(g, t, x, z, size, { angle, align });
          // the legend of each socket, turned as on the real board, between the row and the far edge
          const beyond = (B.far + S_FIRST[2] - PITCH / 2) / 2;
          for (const so of SOCKETS) if (so.gpio !== undefined) label(String(so.gpio), so.x, beyond, 1.3, -Math.PI / 2);
          // the thin outline round the breadboard
          const bb = { x0: BB.x - BB.w / 2 - BB_OUTLINE, x1: BB.x + BB.w / 2 + BB_OUTLINE, z0: BB.z - BB.d / 2 - BB_OUTLINE, z1: BB.z + BB.d / 2 + BB_OUTLINE };
          g.lineWidth = 0.18;
          rr(g, bb.x0, bb.z0, bb.x1 - bb.x0, bb.z1 - bb.z0, 0.6);
          g.stroke();
          // each power strip: the corner marks of its outline, and its rail running up beside it: outside the strip
          // where the board has the room (as in the picture), otherwise between the strip and the breadboard
          for (const st of STRIPS) {
            const x = st.a[0], out = x < BB.x ? -1 : 1, z0 = Math.min(st.a[2], st.b[2]) - PITCH / 2 - 0.3, z1 = Math.max(st.a[2], st.b[2]) + PITCH / 2 + 0.3;
            const edge = out < 0 ? B.x0 : B.x1, outer = x + (out * PITCH) / 2, inner = x - (out * PITCH) / 2, wall = out < 0 ? bb.x0 : bb.x1;
            const outside = Math.abs(edge - outer) >= 1.9;
            label(st.legend, outside ? (edge + outer) / 2 : (wall + inner) / 2, (z0 + z1) / 2, 1.3, -Math.PI / 2);
            const m = x - out * (PITCH / 2 + 0.3);
            g.beginPath();
            g.moveTo(m, z0 + 1.2);
            g.lineTo(m, z0);
            g.lineTo(m + out * 1.2, z0);
            g.moveTo(m, z1 - 1.2);
            g.lineTo(m, z1);
            g.lineTo(m + out * 1.2, z1);
            g.stroke();
          }
          // above the header, from the middle of the board to the right: the board's own name and revision
          const [, tails] = tailRows(EDGE);
          const band = tails - 0.9 - bb.z1;
          label('maker rev1.0', con.seat[0], bb.z1 + band / 2 + 0.05, Math.min(1.72, band * 0.8), 0, 'left');
        },
      }),
      hot,
    );
    return root;
  },
  terminals,
  animate(st, obj, env) {
    // the worst overloaded GPIO socket (each has a 3.3 V protection diode behind 68 ohm: 5 V on it is the hazard)
    let worst = -1, over = 0;
    for (let i = 0; i < SOCKETS.length; i++) {
      const p = st.pins[SOCKETS[i].name];
      if (p && !p.floating && p.mv - SOCKETS[i].max > over) {
        over = p.mv - SOCKETS[i].max;
        worst = i;
      }
    }
    const flagged = st.outputs.overvoltage === true;
    const hot = part(obj, 'hot')!;
    hot.visible = worst >= 0 || flagged;
    if (!hot.visible) return;
    // a hazard the engine flags without saying where: the middle of the row
    hot.position.x = (worst >= 0 ? SOCKETS[worst].x : (S_FIRST[0] + S_LAST[0]) / 2) - S_FIRST[0];
    setLamp(obj, 'hot', 0xff1800, 0.35 + 0.55 * Math.abs(Math.sin(env.time * 7)));
    return true;
  },
  states: {
    idle: partState({}),
    overvoltage: partState({ pins: { S5: { mv: 5000, level: 1, floating: false } } }),
  },
});
