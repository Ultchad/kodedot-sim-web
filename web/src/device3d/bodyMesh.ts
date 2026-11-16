/**
 * The body shell as an explicit lofted mesh.
 *
 * Construction (see lib/bodyModel.ts for the numbers):
 *   - the outline (rounded rectangle from the data) is sampled once into
 *     "stations"; every ring of the loft uses the same stations, so the
 *     topology is a clean grid of quads;
 *   - rings: front cap edge -> front fillet -> wall -> rear fillet -> back edge;
 *   - every flat region (front face, the four walls, the facets of the back) is
 *     a polygon with holes, triangulated by ear clipping, whose boundary IS the
 *     neighbouring ring, so there are no T-junctions and no gaps;
 *   - openings are real recesses with walls and floors, shaded by a baked
 *     occlusion factor in the vertex colours.
 * Normals are analytic (fillets are true arcs), UVs follow device3d/atlas.ts.
 */
import {
  backProfile,
  bodyDims,
  loopArea,
  type BodyDims,
  type Pt,
} from '../lib/bodyModel';
import { uvBack, uvFront, uvWall, wallAlong, type WallSide } from './atlas';
import { backOpenings, frontOpenings, wallOpenings, type Recess } from './features';
import { MeshBuilder, cross, dot, norm, scale, sub, type MeshData, type V2, type V3 } from './meshBuilder';

export const CORNER_SEGMENTS = 14;
export const FILLET_SEGMENTS = 6;

export interface Station {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** distance along the outline from the start of this station's wall island */
  along: number;
  island: WallSide;
  /** on the straight part of a side, between its two ends */
  mid: boolean;
  /** first station of a straight side / of a corner arc */
  sideStart: boolean;
  cornerStart: boolean;
}

/**
 * Stations counter-clockwise (seen from the front), starting at the bottom of
 * the right side. Each island = one straight side followed by one corner.
 * `breaks` are extra y values on the left and right sides.
 */
export function outlineStations(d: BodyDims, breaks: number[], cornerSeg = CORNER_SEGMENTS): Station[] {
  const R = d.cornerR;
  const ax = d.hw - R, ay = d.hh - R;
  const out: Station[] = [];
  // side: start point, direction, length, normal; corner: centre, start angle
  const sides: { p: Pt; dir: Pt; len: number; n: Pt; c: Pt; a0: number }[] = [
    { p: [d.hw, -ay], dir: [0, 1], len: 2 * ay, n: [1, 0], c: [ax, ay], a0: 0 },
    { p: [ax, d.hh], dir: [-1, 0], len: 2 * ax, n: [0, 1], c: [-ax, ay], a0: Math.PI / 2 },
    { p: [-d.hw, ay], dir: [0, -1], len: 2 * ay, n: [-1, 0], c: [-ax, -ay], a0: Math.PI },
    { p: [-ax, -d.hh], dir: [1, 0], len: 2 * ay, n: [0, -1], c: [ax, -ay], a0: 1.5 * Math.PI },
  ];
  sides[3].len = 2 * ax;
  sides.forEach((s, q) => {
    const island = q as WallSide;
    const ts = [0, s.len];
    if (q === 0 || q === 2) for (const y of breaks) ts.push(q === 0 ? y + ay : ay - y);
    ts.sort((a, b) => a - b);
    ts.forEach((t, i) => {
      if (t < -1e-9 || t > s.len + 1e-9) throw new Error('break outside the straight side');
      out.push({ x: s.p[0] + s.dir[0] * t, y: s.p[1] + s.dir[1] * t, nx: s.n[0], ny: s.n[1], along: t, island, mid: i > 0 && i < ts.length - 1, sideStart: i === 0, cornerStart: i === ts.length - 1 });
    });
    for (let i = 1; i < cornerSeg; i++) {
      const a = s.a0 + (i / cornerSeg) * (Math.PI / 2);
      out.push({ x: s.c[0] + R * Math.cos(a), y: s.c[1] + R * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a), along: s.len + (i / cornerSeg) * (Math.PI / 2) * R, island, mid: false, sideStart: false, cornerStart: false });
    }
  });
  return out;
}

interface Place {
  /** face coordinates (a, b) and a depth below the surface -> body frame */
  at(a: number, b: number, depth: number): V3;
  /** unit direction into the body */
  inward: V3;
  uv(a: number, b: number): V2;
}

/** Wall + floor of a recess whose rim (on the surface) the caller has already cut. */
function addRecess(mb: MeshBuilder, r: Recess, place: Place, baseDepth = 0) {
  const loop = r.loop;
  const n = loop.length;
  const rim: number[] = [];
  const low: number[] = [];
  const P = loop.map(([a, b]) => place.at(a, b, baseDepth));
  // wall normals point into the void: left of the tangent for a counter-clockwise loop seen from outside
  const seenCcw = loopArea(loop) > 0 === dot(cross(sub(place.at(1, 0, 0), place.at(0, 0, 0)), sub(place.at(0, 1, 0), place.at(0, 0, 0))), place.inward) < 0;
  for (let i = 0; i < n; i++) {
    const t = sub(P[(i + 1) % n], P[(i + n - 1) % n]);
    let wn = norm(cross(t, place.inward));
    if (!seenCcw) wn = scale(wn, -1);
    const uv = place.uv(loop[i][0], loop[i][1]);
    rim.push(mb.vertex(P[i], wn, uv, r.shade[0]));
    low.push(mb.vertex(place.at(loop[i][0], loop[i][1], baseDepth + r.depth), wn, uv, r.shade[1]));
  }
  mb.strip(rim, low, true);
  if (r.floor) {
    const fn = scale(place.inward, -1);
    const floorOf = (lp: Pt[]) => lp.map(([a, b]) => mb.vertex(place.at(a, b, baseDepth + r.depth), fn, place.uv(a, b), r.shade[2]));
    const outer = floorOf(loop);
    const inner = (r.inner ?? []).map((q) => floorOf(q.loop));
    // project on the two axes most perpendicular to `inward`
    const ax = Math.abs(place.inward[0]), ay = Math.abs(place.inward[1]), az = Math.abs(place.inward[2]);
    const to2d = (p: V3): V2 => (az >= ax && az >= ay ? [p[0], p[1]] : ax >= ay ? [p[1], p[2]] : [p[0], p[2]]);
    mb.polygon(outer, inner, to2d, fn);
    for (const q of r.inner ?? []) addRecess(mb, q, place, baseDepth + r.depth);
  }
}

export interface BodyMesh extends MeshData {
  stations: Station[];
}

export function buildBodyMesh(d: BodyDims = bodyDims()): BodyMesh {
  const mb = new MeshBuilder();
  const prof = backProfile(d);
  const st = outlineStations(d, prof.breaks);
  const N = st.length;
  const rf = d.frontFillet;
  const rb = d.rearFillet;
  const nf = FILLET_SEGMENTS + 2;
  const nb = FILLET_SEGMENTS;
  const front = frontOpenings(d);
  const walls = wallOpenings(d);
  const back = backOpenings();

  // ---------------------------------------------------------- front fillet
  // rings 0..nf over the stations that are not mid-side breaks
  const fIdx = st.map((s, i) => (s.mid ? -1 : i)).filter((i) => i >= 0);
  const frontRings: number[][] = [];
  const fa = rf; // on the front face
  const fb = d.frontFilletDepth; // down the wall
  const quarter = (Math.PI / 4) * (fa + fb); // length of the quarter ellipse, near enough for laying out UVs
  for (let k = 0; k <= nf; k++) {
    const th = (k / nf) * (Math.PI / 2);
    const inset = fa * (1 - Math.sin(th));
    const z = d.zf - fb * (1 - Math.cos(th));
    const nl = Math.hypot(fb * Math.sin(th), fa * Math.cos(th));
    const no = (fb * Math.sin(th)) / nl, nz = (fa * Math.cos(th)) / nl;
    const roll = quarter * (k / nf) - fa; // rolled-flat distance beyond the cap edge, measured from the outline
    frontRings.push(
      fIdx.map((i) => {
        const s = st[i];
        return mb.vertex([s.x - s.nx * inset, s.y - s.ny * inset, z], [s.nx * no, s.ny * no, nz], uvFront(d, s.x + s.nx * roll, s.y + s.ny * roll));
      }),
    );
  }
  for (let k = 0; k < nf; k++) mb.strip(frontRings[k], frontRings[k + 1], true);

  // -------------------------------------------------------------- front cap
  const up: V3 = [0, 0, 1];
  const frontPlace: Place = { at: (a, b, depth) => [a, b, d.zf - depth], inward: [0, 0, -1], uv: (a, b) => uvFront(d, a, b) };
  const cutFront = (loop: Pt[]) => loop.map(([x, y]) => mb.vertex([x, y, d.zf], up, uvFront(d, x, y)));
  const frontHoles: number[][] = [];
  for (const r of [front.bezel, front.led, front.top, front.bottom, front.dpad]) {
    frontHoles.push(cutFront(r.loop));
    addRecess(mb, r, frontPlace);
  }
  frontHoles.push(cutFront(d.lanyard.loop)); // wall added with the back, below
  mb.polygon(frontRings[0], frontHoles, (p) => [p[0], p[1]], up);

  // ------------------------------------------------------------ rear fillet
  // per station: wall end, arc, back edge. Positions first, normals from the grid.
  const rearPos: V3[][] = [];
  const wallZ: number[] = [];
  for (let j = 0; j <= nb; j++) rearPos.push([]);
  st.forEach((s) => {
    const yB = s.y - s.ny * rb;
    const zB = prof.z(yB);
    const m = prof.slope(yB) * -s.ny; // dz per mm going inwards
    const L = rb * Math.hypot(1, m);
    const zc = zB - m * rb;
    const gamma = Math.acos(m / Math.hypot(1, m)); // between the wall (towards the front) and the back surface (inwards)
    const rho = L * Math.tan(gamma / 2);
    const theta = Math.PI - gamma;
    wallZ.push(zc + L);
    for (let j = 0; j <= nb; j++) {
      const ph = (j / nb) * theta;
      const inset = rho * (1 - Math.cos(ph));
      rearPos[j].push([s.x - s.nx * inset, s.y - s.ny * inset, zc + L - rho * Math.sin(ph)]);
    }
  });
  const facetN = (y: number): V3 => norm([0, prof.slope(y), -1]);
  const rearRings: number[][] = [];
  for (let j = 0; j <= nb; j++) {
    rearRings.push(
      st.map((s, i) => {
        const p = rearPos[j][i];
        let nrm: V3;
        if (j === 0) nrm = [s.nx, s.ny, 0];
        else if (j === nb) nrm = facetN(p[1]);
        else {
          const du = sub(rearPos[j][(i + 1) % N], rearPos[j][(i + N - 1) % N]);
          const dv = sub(rearPos[j + 1][i], rearPos[j - 1][i]);
          nrm = norm(cross(du, dv));
          if (dot(nrm, [s.nx, s.ny, -1]) < 0) nrm = scale(nrm, -1);
        }
        const roll = rb * (1 - j / nb) * (Math.PI / 2) - rb;
        return mb.vertex(p, nrm, uvBack(d, s.x + s.nx * roll, s.y + s.ny * roll));
      }),
    );
  }
  for (let j = 0; j < nb; j++) mb.strip(rearRings[j], rearRings[j + 1], true);

  // ------------------------------------------------------------------ walls
  // one island per side: straight wall (polygon with holes) + the corner after it (quads)
  const islandStart: number[] = [];
  st.forEach((s, i) => {
    if (s.sideStart) islandStart[s.island] = i;
  });
  const wallHoles: Record<WallSide, Recess[]> = { 0: [walls.windowRecess], 1: walls.connector, 2: [...walls.grille, walls.slot], 3: [] };
  for (let q = 0 as WallSide; q < 4; q = (q + 1) as WallSide) {
    const a = islandStart[q];
    const b = islandStart[((q + 1) % 4) as WallSide];
    const range: number[] = [];
    for (let i = a; ; i = (i + 1) % N) {
      range.push(i);
      if (i === b) break;
    }
    const s0 = st[a];
    const wn: V3 = [s0.nx, s0.ny, 0];
    const alongOf = (i: number) => (i === b ? st[a].along + sideLen(d, q) + (Math.PI / 2) * d.cornerR : st[i].along);
    const frontRow = new Map<number, number>();
    const rearRow = new Map<number, number>();
    for (const i of range) {
      const s = st[i];
      const nrm: V3 = [s.nx, s.ny, 0];
      if (!s.mid) frontRow.set(i, mb.vertex([s.x, s.y, d.zf - d.frontFilletDepth], nrm, uvWall(q, alongOf(i), d.zf - d.frontFilletDepth)));
      rearRow.set(i, mb.vertex([s.x, s.y, wallZ[i]], nrm, uvWall(q, alongOf(i), wallZ[i])));
    }
    const cornerAt = range.findIndex((i) => st[i].cornerStart);
    const side = range.slice(0, cornerAt + 1);
    const corner = range.slice(cornerAt);
    // straight wall: t = y on left/right, x on top/bottom
    const horizontal = q === 1 || q === 3;
    const to2d = (p: V3): V2 => [horizontal ? p[0] : p[1], p[2]];
    const fixed = horizontal ? s0.y : s0.x;
    const place: Place = {
      at: (t, z, depth) => (horizontal ? [t, fixed - wn[1] * depth, z] : [fixed - wn[0] * depth, t, z]),
      inward: scale(wn, -1),
      uv: (t, z) => uvWall(q, wallAlong(d, q, t), z),
    };
    const holes = wallHoles[q].map((r) => {
      const ring = r.loop.map(([t, z]) => mb.vertex(place.at(t, z, 0), wn, place.uv(t, z)));
      addRecess(mb, r, place);
      return ring;
    });
    const contour = [frontRow.get(side[0])!, frontRow.get(side[side.length - 1])!, ...side.slice().reverse().map((i) => rearRow.get(i)!)];
    mb.polygon(contour, holes, to2d, wn);
    mb.strip(corner.map((i) => frontRow.get(i)!), corner.map((i) => rearRow.get(i)!), false);
  }

  // ------------------------------------------------------------------- back
  const backPlace: Place = { at: (a, b, depth) => [a, b, prof.z(b) + depth], inward: [0, 0, 1], uv: (a, b) => uvBack(d, a, b) };
  const edge = rearRings[nb];
  const yOf = (i: number) => rearPos[nb][i][1];
  const cutBack = (loop: Pt[]) => loop.map(([x, y]) => mb.vertex([x, y, prof.z(y)], facetN(y), uvBack(d, x, y)));
  const backHoles: { y0: number; y1: number; ring: number[] }[] = [];
  for (const r of [back.deboss, back.pogo, back.screw]) {
    const ys = r.loop.map((p) => p[1]);
    backHoles.push({ y0: Math.min(...ys), y1: Math.max(...ys), ring: cutBack(r.loop) });
    addRecess(mb, r, backPlace);
  }
  // lanyard: straight through, front face to the bottom facet
  {
    const loop = d.lanyard.loop;
    const ys = loop.map((p) => p[1]);
    backHoles.push({ y0: Math.min(...ys), y1: Math.max(...ys), ring: cutBack(loop) });
    const n = loop.length;
    const rows: number[][] = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const [x, y] = loop[i];
      const [px, py] = loop[(i + n - 1) % n];
      const [qx, qy] = loop[(i + 1) % n];
      const wn = norm([-(qy - py), qx - px, 0]); // loop is counter-clockwise: this points into the hole
      const zB = prof.z(y);
      const zs = [d.zf, d.zf - 2.2, zB + 2.2, zB];
      const sh = [0.86, 0.5, 0.48, 0.8];
      zs.forEach((z, k) => rows[k].push(mb.vertex([x, y, z], wn, uvFront(d, x, y), sh[k])));
    }
    for (let k = 0; k < 3; k++) mb.strip(rows[k], rows[k + 1], true);
  }
  // bands between consecutive breaks; the first and last band take the corners
  const leftAt = new Map<number, number>();
  const rightAt = new Map<number, number>();
  st.forEach((s, i) => {
    if (s.island === 0 && (s.mid || s.sideStart || s.cornerStart)) rightAt.set(round(s.y), i);
    if (s.island === 2 && (s.mid || s.sideStart || s.cornerStart)) leftAt.set(round(s.y), i);
  });
  const br = prof.breaks;
  const holesIn = (lo: number, hi: number) => {
    const inside = backHoles.filter((h) => h.y0 > lo && h.y1 < hi);
    for (const h of inside) backHoles.splice(backHoles.indexOf(h), 1);
    return inside.map((h) => h.ring);
  };
  const to2d = (p: V3): V2 => [p[0], p[1]];
  // bottom band: from the right break, down round the bottom, up to the left break
  {
    const iR = rightAt.get(round(br[0]))!;
    const iL = leftAt.get(round(br[0]))!;
    const contour: number[] = [];
    for (let i = iL; ; i = (i + 1) % N) {
      contour.push(edge[i]);
      if (i === iR) break;
    }
    mb.polygon(contour, holesIn(-Infinity, yOf(iR)), to2d, facetN(-d.hh));
  }
  for (let k = 0; k < br.length - 1; k++) {
    const r0 = rightAt.get(round(br[k]))!, r1 = rightAt.get(round(br[k + 1]))!;
    const l0 = leftAt.get(round(br[k]))!, l1 = leftAt.get(round(br[k + 1]))!;
    const contour = [edge[r0], edge[r1], edge[l1], edge[l0]];
    mb.polygon(contour, holesIn(yOf(r0), yOf(r1)), to2d, facetN((br[k] + br[k + 1]) / 2));
  }
  {
    const iR = rightAt.get(round(br[br.length - 1]))!;
    const iL = leftAt.get(round(br[br.length - 1]))!;
    const contour: number[] = [];
    for (let i = iR; ; i = (i + 1) % N) {
      contour.push(edge[i]);
      if (i === iL) break;
    }
    mb.polygon(contour, holesIn(yOf(iR), Infinity), to2d, facetN(d.hh));
  }
  if (backHoles.length) throw new Error('a back feature straddles a crease of the back');

  return { ...mb.build(), stations: st };
}

const round = (v: number) => Math.round(v * 1e6);
function sideLen(d: BodyDims, q: WallSide): number {
  return q === 0 || q === 2 ? 2 * (d.hh - d.cornerR) : 2 * (d.hw - d.cornerR);
}
