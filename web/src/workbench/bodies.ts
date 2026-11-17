/**
 * Everything that stands on the table, drawn from the bench store: one Bench3D model per kind, its static body as
 * instances (one draw call per material family per kind, whatever the number of objects), its lamps, screens and
 * buttons as a small copy per object driven by the model's `animate`. Also: contact shadows, selection and hover
 * outlines and activity pulses (one instanced mesh), the range shown while dragging, the microSD card going into the
 * Dot's slot and the charger's cable reaching its port.
 *
 * Nothing here allocates per frame: matrices, colours and the per-object state objects are reused.
 */
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion,
  Raycaster, ShaderMaterial, Vector3, type Intersection, type Material, type Object3D, type Ray,
} from 'three';
import { controlOf, controlsIn, type ControlMark } from '../bench3d/controls';
import type { LiveStore } from '../bench/live';
import type { BenchStore } from '../bench/store';
import type { KodeDevice } from '../device/types';
import { bodyDims, SIDE_FEATURES_ESTIMATE } from '../lib/bodyModel';
import type { AnimEnv, PartModel } from '../bench3d/contract';
import { makeCtx } from '../bench3d/contract';
import { disposeInstance, instantiate, isStatic } from '../bench3d/nodes';
import { getModel } from '../bench3d/registry';
import { Shape, tubeIndices, writeTube } from '../bench3d/shape';
import { PAL } from '../bench3d/materials';
import { CHARGER_EXIT } from '../bench3d/models/wireless/power-charger.model';
import { COMPUTER_EXIT } from '../bench3d/models/wireless/usb-computer.model';
import type { WirelessState } from '../bench3d/models/wireless/state';
import { MAT, SD_ID, SIZES, hasBody, isNear, modelIdOf, zoneOf, type Rot, type Zone } from './layout';
import { hullCorners, transformed, vertexCloud } from './rest';

const D = bodyDims();
const HALF_PI = Math.PI / 2;
const UP = new Vector3(0, 1, 0);

/** Colour of an area's range and pulses (the bench's tile colours). */
const AREA_RGB: Record<string, [number, number, number]> = {
  nfc: [0.008, 0.541, 0.761],
  rfid: [0.788, 0.188, 0.239],
  wifi: [1, 0.675, 0],
  ir: [0.788, 0.188, 0.239],
  power: [0.086, 0.639, 0.29],
  sd: [0.1, 0.1, 0.1],
};
const SELECT_RGB: [number, number, number] = [1, 0.675, 0];
const HOVER_RGB: [number, number, number] = [0.004, 0.376, 0.557];
const TONE_RGB: Record<string, [number, number, number]> = { ok: [0.086, 0.639, 0.29], bad: [0.788, 0.188, 0.239], info: [1, 0.675, 0] };

/** Margin of the decoration quads round a footprint (mm): the shadow's penumbra and the pulse's travel. */
const PAD = 14;
const PULSE_S = 0.95;

interface Batch {
  model: PartModel;
  template: Object3D;
  parts: { geometry: BufferGeometry; material: Material; order: number }[];
  meshes: InstancedMesh[];
  capacity: number;
  count: number;
  hasDynamic: boolean;
  dirty: boolean;
}

export interface Body {
  id: string;
  kind: string;
  batch: Batch;
  slot: number;
  /** Where the store says it stands, and where it is drawn (it glides there). */
  tx: number;
  tz: number;
  trot: Rot;
  x: number;
  z: number;
  /** Quarter turns as an angle (radians), gliding. */
  ry: number;
  lift: number;
  mounted?: number[] | null;
  /** 0 on the table, 1 in the Dot (the microSD card in its slot). */
  dock: number;
  dockGoal: number;
  dyn: Object3D | null;
  /** A wired part: its model takes the parts engine's state. */
  isPart: boolean;
  /** The children of `dyn` that the pointer can work (bench3d/controls.ts). */
  controls: Object3D[];
  state: WirelessState;
  animating: boolean;
  /** Seconds (scene clock) of the last thing the Dot did with it; -1 never. */
  eventAt: number;
  seenStamp: number;
  seenCount: number;
  matrix: Matrix4;
  fresh: boolean;
}

export interface Pick {
  id: string;
  kind: string;
  distance: number;
  /** A named part under the pointer (a remote's button), or null. */
  part: string | null;
  /** The control's mark and node, when the pointer is on one. */
  mark: ControlMark | null;
  node: Object3D | null;
  isPart: boolean;
}

/** Where the wired parts' models and live states come from (parts/service.ts); absent in tests and on the stand. */
export interface PartsSource {
  /** A model for a part that has none in the registry (made from its manifest), or null while it is not loaded. */
  modelFor(id: string): PartModel | null;
  stateOf(instance: string): object | undefined;
  /** How high a part stands (its legs in a board's holes), mm. */
  liftOf?(instance: string): number;
  /** A module on the Dot's header: its model frame to the Dot's own frame (column-major 4x4), or null. */
  mountOf?(instance: string): number[] | null;
}

export interface BodiesDeps {
  parts?: PartsSource;
  bench: BenchStore;
  live: LiveStore;
  device: KodeDevice;
  /** Where the Dot's model is (for the card in its slot and the plug in its port). */
  dotQuat: Quaternion;
  dotPos: Vector3;
}

const DECOR_VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec2 aParam;
varying vec2 vP;
varying vec2 vHalf;
varying vec4 vColor;
varying vec2 vParam;
void main() {
  vec2 hf = 0.5 * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vHalf = hf;
  vP = position.xz * 2.0 * hf;
  vColor = aColor;
  vParam = aParam;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  mv.xyz -= normalize(mv.xyz) * (aParam.x < 0.5 ? 0.12 : 0.3);
  gl_Position = projectionMatrix * mv;
}`;
const DECOR_FRAG = /* glsl */ `
varying vec2 vP;
varying vec2 vHalf;
varying vec4 vColor;
varying vec2 vParam;
const float PAD = ${PAD.toFixed(1)};
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 body = max(vHalf - vec2(PAD), vec2(0.5));
  float r = min(min(body.x, body.y), 5.0);
  float d = sdRound(vP, body, r);
  float a;
  if (vParam.x < 0.5) {
    // contact shadow: darkest under the body, gone a little way out
    a = (1.0 - smoothstep(-3.0, PAD * 0.62, d));
    a = a * a * 0.42;
  } else if (vParam.x < 1.5) {
    // selected: an outline just off the body and a breath of fill
    a = smoothstep(1.1, 1.5, d) * (1.0 - smoothstep(2.7, 3.1, d)) + (1.0 - smoothstep(0.0, 1.4, d)) * 0.12;
  } else if (vParam.x < 2.5) {
    a = smoothstep(1.3, 1.6, d) * (1.0 - smoothstep(2.2, 2.5, d)) * 0.75;
  } else {
    // a pulse: a ring that leaves the body and fades
    float t = vParam.y;
    float e = d - 1.5 - t * (PAD - 4.5);
    a = (1.0 - smoothstep(0.2, 1.7, abs(e))) * (1.0 - t) * (1.0 - t);
  }
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

const RANGE_VERT = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xz;
  vec4 mv = viewMatrix * w;
  mv.xyz -= normalize(mv.xyz) * 0.08;
  gl_Position = projectionMatrix * mv;
}`;
const RANGE_FRAG = /* glsl */ `
uniform vec2 uC;
uniform float uR;
uniform float uSector;
uniform float uDir;
uniform float uHalf;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uIn;
varying vec2 vW;
void main() {
  vec2 p = vW - uC;
  float len = length(p);
  float d = len - uR;
  float dash;
  if (uSector > 0.5) {
    // the beam leaves towards uDir (0 = -Z): its sides are two rays
    vec2 f = vec2(sin(uDir), -cos(uDir));
    float along = dot(p, f);
    float across = abs(p.x * f.y - p.y * f.x);
    float side = across * cos(uHalf) - along * sin(uHalf);
    d = max(d, side);
    dash = step(0.5, fract((d > side - 0.01 && side > len - uR ? len : atan(across, along) * uR) / 9.0));
  } else {
    dash = step(0.5, fract(atan(p.y, p.x) * uR / 9.0));
  }
  float fill = (1.0 - smoothstep(-1.0, 0.0, d)) * (0.055 + 0.075 * uIn);
  float edge = (1.0 - smoothstep(0.45, 1.0, abs(d))) * dash * (0.42 + 0.3 * uIn);
  float a = (fill + edge) * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class Bodies {
  readonly group = new Group();
  readonly items = new Map<string, Body>();
  private order: Body[] = [];
  private batches = new Map<string, Batch>();
  private decor: InstancedMesh;
  private decorColor: InstancedBufferAttribute;
  private decorParam: InstancedBufferAttribute;
  private decorMat: ShaderMaterial;
  private range: Mesh;
  private rangeMat: ShaderMaterial;
  private rangeGoal = 0;
  private rangeAlpha = 0;
  private rangeKind: string | null = null;
  /** Selection, hover and what is being dragged (set by the input layer). */
  selected: ReadonlySet<string> = new Set();
  hover: string | null = null;
  dragging: ReadonlySet<string> = new Set();
  /** The remote button held down: [object id, button]. */
  pressed: [string, string] | null = null;
  private env: AnimEnv = { time: 0, dt: 0 };
  private time = 0;
  private sdInserted: boolean | null = null;
  private dotStamp = '';
  // the charger's cable and plug
  private cable: Mesh;
  private cablePos: Float32Array;
  private cableNrm: Float32Array;
  private cablePts: Float32Array[] = [];
  private plug: Group;
  private plugT = 0;
  private cableKey = '';
  // scratch
  private m = new Matrix4();
  private q = new Quaternion();
  private q2 = new Quaternion();
  private v = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private one = new Vector3(1, 1, 1);
  private caster = new Raycaster();
  private hits: Intersection[] = [];
  private liveOff: () => void;
  /** Set when something changed that needs a frame (the host invalidates). */
  onWake: () => void = () => {};

  /** The Dot was swapped (test device on or off): the card slot is the new one's. */
  setDevice(device: KodeDevice): void {
    this.deps.device = device;
    this.pollCard();
  }
  /**
   * Looks at the Dot's card slot (the card is also put in and taken out from the panel and by kodeOS). The scene only
   * draws when something changes, so the host calls this on a slow timer; a change wakes the scene.
   */
  pollCard(): void {
    const sd = (this.deps.device.areas as Record<string, { state?: () => { inserted: boolean } } | undefined>).sd;
    let inserted: boolean | null = null;
    try {
      inserted = sd?.state ? !!sd.state().inserted : null;
    } catch {
      inserted = null;
    }
    if (inserted === this.sdInserted) return;
    this.sdInserted = inserted;
    this.onSdChange(inserted);
    this.onWake();
  }

  constructor(private deps: BodiesDeps) {
    this.group.name = 'bodies';
    // decorations: shadows, outlines, pulses
    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-HALF_PI);
    this.decorMat = new ShaderMaterial({ vertexShader: DECOR_VERT, fragmentShader: DECOR_FRAG, transparent: true, depthWrite: false, side: DoubleSide });
    this.decor = new InstancedMesh(plane, this.decorMat, 512);
    this.decorColor = new InstancedBufferAttribute(new Float32Array(512 * 4), 4);
    this.decorParam = new InstancedBufferAttribute(new Float32Array(512 * 2), 2);
    this.decorColor.setUsage(DynamicDrawUsage);
    this.decorParam.setUsage(DynamicDrawUsage);
    plane.setAttribute('aColor', this.decorColor);
    plane.setAttribute('aParam', this.decorParam);
    this.decor.count = 0;
    this.decor.frustumCulled = false;
    this.decor.renderOrder = 1;
    this.decor.raycast = () => {};
    // the range of the kind being dragged
    const mat = new PlaneGeometry(MAT.x1 - MAT.x0 + 80, MAT.z1 - MAT.z0 + 80);
    mat.rotateX(-HALF_PI);
    this.rangeMat = new ShaderMaterial({
      vertexShader: RANGE_VERT,
      fragmentShader: RANGE_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uC: { value: [0, 0] }, uR: { value: 50 }, uSector: { value: 0 }, uDir: { value: 0 }, uHalf: { value: 0.5 }, uColor: { value: new Color(1, 0.675, 0) }, uAlpha: { value: 0 }, uIn: { value: 0 } },
    });
    this.range = new Mesh(mat, this.rangeMat);
    this.range.position.set((MAT.x0 + MAT.x1) / 2, 0.03, (MAT.z0 + MAT.z1) / 2);
    this.range.visible = false;
    this.range.renderOrder = 1;
    this.range.raycast = () => {};
    // the charger's cable: a tube rewritten in place, and its USB-C plug
    const RINGS = 26, SEG = 7;
    this.cablePos = new Float32Array(RINGS * SEG * 3);
    this.cableNrm = new Float32Array(RINGS * SEG * 3);
    for (let i = 0; i < RINGS; i++) this.cablePts.push(new Float32Array(3));
    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(this.cablePos, 3).setUsage(DynamicDrawUsage));
    cg.setAttribute('normal', new BufferAttribute(this.cableNrm, 3).setUsage(DynamicDrawUsage));
    cg.setIndex(new BufferAttribute(tubeIndices(RINGS, SEG), 1));
    this.cable = new Mesh(cg, new MeshStandardMaterial({ color: '#e9e6df', roughness: 0.85 }));
    this.cable.frustumCulled = false;
    this.cable.visible = false;
    this.cable.raycast = () => {};
    const ps = new Shape();
    // the plug points along -Z: the metal tip in front, the grip behind it
    ps.block(...PAL.silicone, 4.4, 2.7, 5.2, new Matrix4().makeTranslation(0, 0, 5.2), 1.0);
    ps.block(...PAL.tin, 4.1, 1.25, 3.2, new Matrix4().makeTranslation(0, 0, -3.1), 0.5);
    this.plug = ps.toObject('plug');
    this.plug.visible = false;
    this.plug.traverse((o) => (o.raycast = () => {}));
    this.group.add(this.decor, this.range, this.cable, this.plug);
    this.liveOff = deps.live.subscribe(() => this.readLive());
  }

  // ----------------------------------------------------------------------------------------------- store -> bodies
  private batchFor(modelId: string): Batch | null {
    let b = this.batches.get(modelId);
    if (b) return b;
    const model = getModel(modelId) ?? this.deps.parts?.modelFor(modelId) ?? null;
    if (!model) return null;
    const template = model.build(makeCtx());
    const parts: Batch['parts'] = [];
    let hasDynamic = false;
    template.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (isStatic(o, template)) parts.push({ geometry: mesh.geometry, material: mesh.material as Material, order: mesh.renderOrder });
      else hasDynamic = true;
    });
    b = { model, template, parts, meshes: [], capacity: 0, count: 0, hasDynamic, dirty: true };
    this.batches.set(modelId, b);
    return b;
  }
  private grow(b: Batch, need: number): void {
    if (need <= b.capacity) return;
    for (const m of b.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    b.capacity = Math.max(8, b.capacity * 2, need);
    b.meshes = b.parts.map((p) => {
      const im = new InstancedMesh(p.geometry, p.material, b.capacity);
      im.frustumCulled = false;
      im.renderOrder = p.order;
      im.raycast = () => {};
      im.count = 0;
      this.group.add(im);
      return im;
    });
    b.dirty = true;
  }

  /** Makes the bodies match the store. Cheap when nothing changed (it is called on every store change). */
  sync(): void {
    const st = this.deps.bench.getState();
    const seen = new Set<string>();
    const put = (id: string, kind: string, x: number, z: number, rot: Rot, near: boolean, fields: WirelessState['fields'], isPart = false) => {
      if (!hasBody(kind)) return;
      const batch = this.batchFor(modelIdOf(kind));
      if (!batch) return;
      seen.add(id);
      let it = this.items.get(id);
      if (!it) {
        it = {
          id, kind, batch, slot: -1, tx: x, tz: z, trot: rot, x, z, ry: -rot * HALF_PI, lift: 0, dock: 0, dockGoal: 0,
          dyn: batch.hasDynamic ? instantiate(batch.template, { dynamicOnly: true }) : null,
          state: { near, fields, live: this.deps.live.get(id).data, area: this.deps.live.get(`area:${kind.split('.')[0]}`).data, sinceEvent: Infinity, tone: 'info', pressed: null },
          animating: true, eventAt: -1, seenStamp: 0, seenCount: 0, matrix: new Matrix4(), fresh: true, controls: [], isPart,
        };
        if (it.dyn) {
          it.dyn.matrixAutoUpdate = false;
          it.controls = controlsIn(it.dyn).map((c) => c.node);
          // only the controls answer a ray (a cap, a lever, a knob); the rest of the body is picked as a box
          it.dyn.traverse((o) => {
            if (!controlOf(o)) o.raycast = () => {};
          });
          this.group.add(it.dyn);
        }
        // what the Dot did before this body existed is not news
        const last = this.deps.live.get(id).entries.at(-1);
        if (last) {
          it.seenStamp = last.at;
          it.seenCount = last.count;
        }
        this.items.set(id, it);
      }
      it.tx = x;
      it.tz = z;
      it.trot = rot;
      it.state.near = near;
      it.state.fields = fields;
      it.animating = true;
    };
    for (const o of st.objects) put(o.id, o.kind, o.pos.x, o.pos.z, o.rot, o.near, o.fields, o.area === 'part');
    const sd = st.fixtures[SD_ID];
    if (sd) put(SD_ID, SD_ID, sd.pos.x, sd.pos.z, sd.rot, false, EMPTY);
    for (const [id, it] of [...this.items]) {
      if (seen.has(id)) continue;
      if (it.dyn) {
        this.group.remove(it.dyn);
        disposeInstance(it.dyn);
      }
      this.items.delete(id);
    }
    // slots: each batch draws its bodies in order
    this.order = [...this.items.values()];
    for (const b of this.batches.values()) b.count = 0;
    for (const it of this.order) it.slot = it.batch.count++;
    for (const b of this.batches.values()) {
      this.grow(b, b.count);
      for (const m of b.meshes) m.count = b.count;
      b.dirty = true;
    }
    this.cableKey = '';
    this.onWake();
  }

  /** New feedback from the Dot: note when, for the pulses and the models' "just now". */
  private readLive(): void {
    let news = false;
    for (const it of this.order) {
      const l = this.deps.live.get(it.id);
      it.state.live = l.data;
      it.state.area = this.deps.live.get(`area:${it.kind.split('.')[0]}`).data;
      const last = l.entries[l.entries.length - 1];
      if (last && (last.at !== it.seenStamp || last.count !== it.seenCount)) {
        it.seenStamp = last.at;
        it.seenCount = last.count;
        it.eventAt = this.time;
        it.state.tone = last.tone;
      }
      it.animating = true;
      news = true;
    }
    if (news) this.onWake();
  }

  // --------------------------------------------------------------------------------------------------- interaction
  /** Shows (or hides) the range of a kind on the table. */
  showRange(kind: string | null): void {
    const zone = kind ? zoneOf(kind) : null;
    if (!zone) {
      this.rangeGoal = 0;
      return;
    }
    this.rangeKind = kind;
    const u = this.rangeMat.uniforms;
    (u.uC.value as number[])[0] = zone.x;
    (u.uC.value as number[])[1] = zone.z;
    u.uR.value = zone.shape === 'circle' ? zone.r : zone.len;
    u.uSector.value = zone.shape === 'sector' ? 1 : 0;
    if (zone.shape === 'sector') {
      u.uDir.value = zone.dir;
      u.uHalf.value = zone.half;
    }
    const c = AREA_RGB[kind === SD_ID ? 'sd' : kind!.split('.')[0]] ?? SELECT_RGB;
    (u.uColor.value as Color).setRGB(c[0], c[1], c[2]);
    this.rangeGoal = 1;
    this.range.visible = true;
    this.onWake();
  }
  zoneShown(): Zone | null {
    return this.rangeGoal > 0 && this.rangeKind ? zoneOf(this.rangeKind) : null;
  }

  /** The parts engine has news: the parts' models show it. */
  partsChanged(): void {
    for (const it of this.order) if (it.isPart) it.animating = true;
    this.onWake();
  }

  /** The body under a ray (nearest first), with small things given a generous target. */
  pick(ray: Ray): Pick | null {
    let best: Body | null = null;
    let bestT = Infinity;
    const o = ray.origin, d = ray.direction;
    for (const it of this.order) {
      let x0: number, x1: number, y0: number, y1: number, z0: number, z1: number;
      if (it.dock > 0.5) {
        // in the Dot's slot: the end that sticks out
        this.v.setFromMatrixPosition(it.matrix);
        x0 = this.v.x - 9;
        x1 = this.v.x + 4;
        y0 = this.v.y - 5;
        y1 = this.v.y + 5;
        z0 = this.v.z - 7;
        z1 = this.v.z + 7;
      } else {
        const s = SIZES[it.kind];
        const turned = it.trot % 2 === 1;
        const hw = Math.max(turned ? s.d : s.w, 14) / 2, hd = Math.max(turned ? s.w : s.d, 14) / 2;
        x0 = it.x - hw;
        x1 = it.x + hw;
        z0 = it.z - hd;
        z1 = it.z + hd;
        y0 = 0;
        y1 = Math.max(s.h, 5) + it.lift;
      }
      // slab test
      let t0 = 0, t1 = Infinity;
      const ax = [o.x, o.y, o.z], dx = [d.x, d.y, d.z], lo = [x0, y0, z0], hi = [x1, y1, z1];
      let hit = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dx[k]) < 1e-9) {
          if (ax[k] < lo[k] || ax[k] > hi[k]) {
            hit = false;
            break;
          }
        } else {
          let a = (lo[k] - ax[k]) / dx[k], b = (hi[k] - ax[k]) / dx[k];
          if (a > b) {
            const t = a;
            a = b;
            b = t;
          }
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
          if (t0 > t1) {
            hit = false;
            break;
          }
        }
      }
      if (hit && t0 < bestT) {
        bestT = t0;
        best = it;
      }
    }
    if (!best) return null;
    let part: string | null = null;
    let mark: ControlMark | null = null;
    let node: Object3D | null = null;
    if (best.dyn && best.controls.length) {
      // a control under the pointer (a remote's button): the model marked it, the ray finds it
      best.dyn.updateMatrixWorld(true);
      this.caster.ray.copy(ray);
      this.hits.length = 0;
      this.caster.intersectObjects(best.controls, true, this.hits);
      if (this.hits.length) {
        const c = controlOf(this.hits[0].object);
        part = c?.mark.field ?? null;
        mark = c?.mark ?? null;
        node = c?.node ?? null;
      }
    }
    return { id: best.id, kind: best.kind, distance: bestT, part, mark, node, isPart: best.isPart };
  }

  /** The rectangle that holds every body (for framing the camera), or null when the table is empty. */
  bounds(): { x0: number; x1: number; z0: number; z1: number; h: number } | null {
    let any = false;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, h = 0;
    for (const it of this.order) {
      const s = SIZES[it.kind];
      const r = Math.max(s.w, s.d) / 2;
      x0 = Math.min(x0, it.tx - r);
      x1 = Math.max(x1, it.tx + r);
      z0 = Math.min(z0, it.tz - r);
      z1 = Math.max(z1, it.tz + r);
      h = Math.max(h, s.h);
      any = true;
    }
    return any ? { x0, x1, z0, z1, h } : null;
  }

  // ------------------------------------------------------------------------------------------- the module on the Dot
  private hulls = new Map<string, Float32Array>();
  private mountKind = '';
  private mountMat: number[] | null = null;
  private mountPts: Float32Array | null = null;
  /**
   * The module on the Dot's header as points in the Dot's own frame (the corners of its model's hull through the mount
   * matrix), or null when nothing is mounted: what the Dot needs to rest the whole assembly on the table (world.ts).
   * The same array comes back until the module or the way it is mounted changes.
   */
  mountedPoints(): Float32Array | null {
    const mounts = this.deps.bench.getState().mounts;
    let id = '';
    for (const k in mounts) {
      id = k;
      break;
    }
    const it = id ? this.items.get(id) : undefined;
    const mat = it?.isPart ? (this.deps.parts?.mountOf?.(it.id) ?? null) : null;
    if (!it || !mat) {
      this.mountMat = null;
      return (this.mountPts = null);
    }
    if (mat === this.mountMat && it.kind === this.mountKind) return this.mountPts;
    let hull = this.hulls.get(it.kind);
    if (!hull) this.hulls.set(it.kind, (hull = hullCorners(vertexCloud(it.batch.template))));
    this.mountMat = mat;
    this.mountKind = it.kind;
    return (this.mountPts = transformed(hull, mat));
  }

  // --------------------------------------------------------------------------------------------------------- frame
  private dockMatrix(out: Matrix4): void {
    // in the card slot of the left wall: the card flat, its far end 2.6 mm out of the shell
    const slot = SIDE_FEATURES_ESTIMATE.slot;
    this.v.set(-D.hw - 7.5 + 12.4, slot.y, D.zf - slot.zBehind).applyQuaternion(this.deps.dotQuat).add(this.deps.dotPos);
    // card x -> model -Y, card y -> model +Z, card z -> model -X
    this.m.set(0, 0, -1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    this.q.setFromRotationMatrix(this.m).premultiply(this.deps.dotQuat);
    out.compose(this.v, this.q, this.one);
  }

  /** Advances what moves; true while something still does. */
  step(dt: number, reduced: boolean): boolean {
    this.time += dt;
    this.env.time = this.time;
    this.env.dt = dt;
    let busy = false;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 13);

    const card = this.items.get(SD_ID);
    if (card) card.dockGoal = this.sdInserted && !this.dragging.has(SD_ID) ? 1 : 0;
    const dotStamp = `${this.deps.dotPos.y.toFixed(3)},${this.deps.dotQuat.x.toFixed(4)},${this.deps.dotQuat.z.toFixed(4)},${this.deps.dotQuat.w.toFixed(4)}`;
    const dotMoved = dotStamp !== this.dotStamp;
    this.dotStamp = dotStamp;

    let decor = 0;
    const pc = this.decorColor.array as Float32Array, pp = this.decorParam.array as Float32Array;
    const addDecor = (it: Body, type: number, t: number, rgb: readonly number[], alpha: number) => {
      if (decor >= 512) return;
      const s = SIZES[it.kind];
      this.q.setFromAxisAngle(UP, it.ry);
      this.v.set(it.x, 0.02, it.z);
      this.v2.set(s.w + PAD * 2, 1, s.d + PAD * 2);
      this.m.compose(this.v, this.q, this.v2);
      this.decor.setMatrixAt(decor, this.m);
      pc[decor * 4] = rgb[0];
      pc[decor * 4 + 1] = rgb[1];
      pc[decor * 4 + 2] = rgb[2];
      pc[decor * 4 + 3] = alpha;
      pp[decor * 2] = type;
      pp[decor * 2 + 1] = t;
      decor++;
    };

    for (const it of this.order) {
      const drag = this.dragging.has(it.id);
      // glide to where the store says (a dragged body is simply there)
      const goalRy = -it.trot * HALF_PI;
      let dry = goalRy - it.ry;
      while (dry > Math.PI) dry -= Math.PI * 2;
      while (dry < -Math.PI) dry += Math.PI * 2;
      const mount = it.isPart ? (this.deps.parts?.mountOf?.(it.id) ?? null) : null;
      const liftGoal = (drag ? 3.2 : 0) + (it.isPart && !mount ? (this.deps.parts?.liftOf?.(it.id) ?? 0) : 0);
      const kk = drag || it.fresh ? 1 : k;
      let moving = Math.abs(it.tx - it.x) > 0.01 || Math.abs(it.tz - it.z) > 0.01 || Math.abs(dry) > 0.001 || Math.abs(liftGoal - it.lift) > 0.01 || Math.abs(it.dockGoal - it.dock) > 0.002;
      if (moving) {
        it.x += (it.tx - it.x) * kk;
        it.z += (it.tz - it.z) * kk;
        it.ry += dry * kk;
        it.lift += (liftGoal - it.lift) * (reduced ? 1 : 1 - Math.exp(-dt * 20));
        it.dock += (it.dockGoal - it.dock) * (reduced ? 1 : 1 - Math.exp(-dt * 9));
      } else if (it.x !== it.tx || it.z !== it.tz || it.ry !== goalRy || it.dock !== it.dockGoal) {
        it.x = it.tx;
        it.z = it.tz;
        it.ry = goalRy;
        it.lift = liftGoal;
        it.dock = it.dockGoal;
        moving = true; // one last write with the exact values
      }
      if (moving || it.fresh || it.batch.dirty || (it.dock > 0 && dotMoved) || (mount && (dotMoved || it.mounted !== mount)) || (!mount && it.mounted)) {
        it.mounted = mount;
        this.q.setFromAxisAngle(UP, it.ry);
        this.v.set(it.x, it.lift, it.z);
        it.matrix.compose(this.v, this.q, this.one);
        if (mount) {
          // on the Dot's header: it goes where the Dot goes
          this.m.compose(this.deps.dotPos, this.deps.dotQuat, this.one);
          it.matrix.fromArray(mount).premultiply(this.m);
        }
        if (it.dock > 0) {
          // on its way into (or out of) the slot: between the table and the slot, on a small arc
          this.dockMatrix(this.m);
          this.v2.setFromMatrixPosition(this.m);
          this.q2.setFromRotationMatrix(this.m);
          const e = it.dock * it.dock * (3 - 2 * it.dock);
          this.v.lerp(this.v2, e);
          this.v.y += Math.sin(e * Math.PI) * 9;
          this.q.slerp(this.q2, e);
          it.matrix.compose(this.v, this.q, this.one);
        }
        for (const m of it.batch.meshes) {
          m.setMatrixAt(it.slot, it.matrix);
          m.instanceMatrix.needsUpdate = true;
        }
        if (it.dyn) {
          it.dyn.matrix.copy(it.matrix);
          it.dyn.matrixWorldNeedsUpdate = true;
        }
        if (it.kind === 'power.charger' || it.kind === 'usb.computer') this.cableKey = '';
        it.fresh = false;
        if (moving) busy = true;
      }

      // the model shows the live state
      const since = it.eventAt < 0 ? Infinity : this.time - it.eventAt;
      it.state.sinceEvent = since;
      it.state.pressed = this.pressed && this.pressed[0] === it.id ? this.pressed[1] : null;
      if (it.dyn && it.batch.model.animate && (it.animating || since < 2)) {
        const st = it.isPart ? (this.deps.parts?.stateOf(it.id) ?? IDLE_PART) : it.state;
        it.animating = it.batch.model.animate(st as never, it.dyn, this.env) === true;
        if (it.animating || since < 2) busy = true;
      }

      // decorations
      if (it.dock < 0.5) addDecor(it, 0, 0, BLACK, 1 - it.dock * 2);
      if (this.selected.has(it.id)) addDecor(it, 1, 0, SELECT_RGB, 1);
      else if (this.hover === it.id) addDecor(it, 2, 0, HOVER_RGB, 1);
      if (since < PULSE_S && !reduced) {
        addDecor(it, 3, since / PULSE_S, TONE_RGB[it.state.tone] ?? SELECT_RGB, 0.95);
        busy = true;
      }
    }
    for (const b of this.batches.values()) b.dirty = false;
    this.decor.count = decor;
    this.decor.instanceMatrix.needsUpdate = true;
    this.decorColor.needsUpdate = true;
    this.decorParam.needsUpdate = true;

    // the range fades in and out; it reads stronger while the dragged thing is inside
    if (this.rangeAlpha !== this.rangeGoal) {
      this.rangeAlpha += (this.rangeGoal - this.rangeAlpha) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
      if (Math.abs(this.rangeGoal - this.rangeAlpha) < 0.01) this.rangeAlpha = this.rangeGoal;
      else busy = true;
      this.rangeMat.uniforms.uAlpha.value = this.rangeAlpha;
      this.range.visible = this.rangeAlpha > 0;
    }
    if (this.rangeGoal > 0 && this.rangeKind) {
      let inside = 0;
      for (const id of this.dragging) {
        const it = this.items.get(id);
        if (it && it.kind === this.rangeKind && isNear(it.kind, { x: it.tx, z: it.tz }, it.trot)) inside = 1;
      }
      const u = this.rangeMat.uniforms.uIn;
      if (Math.abs(u.value - inside) > 0.01) {
        u.value += (inside - u.value) * (reduced ? 1 : 1 - Math.exp(-dt * 14));
        busy = true;
      } else u.value = inside;
    }

    busy = this.stepCable(dt, reduced, dotMoved) || busy;
    return busy;
  }

  /** The card was put in or taken out somewhere else than on the table: its place follows. */
  private onSdChange(inserted: boolean | null): void {
    if (inserted === null || this.dragging.has(SD_ID)) return;
    const f = this.deps.bench.getState().fixtures[SD_ID];
    if (!f) return;
    if (isNear(SD_ID, f.pos, f.rot) !== inserted) this.deps.bench.moveMany([{ id: SD_ID, pos: this.deps.bench.fixtureSpot(SD_ID, inserted) }]);
  }
  /** What the slot holds, as last seen (null: no card slot, the Dot is off). */
  get cardInserted(): boolean | null {
    return this.sdInserted;
  }

  /** The charger's cable: from the charger to its plug, which is in the Dot's port when plugged and beside the charger when not. */
  private stepCable(dt: number, reduced: boolean, dotMoved: boolean): boolean {
    let charger: Body | null = null;
    // one cable is drawn: the plugged thing's, else the charger's, else the computer's
    for (const it of this.order) if ((it.kind === 'power.charger' || it.kind === 'usb.computer') && (!charger || it.state.near || (!charger.state.near && it.kind === 'power.charger'))) charger = it;
    const EXIT = charger?.kind === 'usb.computer' ? COMPUTER_EXIT : CHARGER_EXIT;
    const side = charger?.kind === 'usb.computer';
    this.cable.visible = this.plug.visible = !!charger;
    if (!charger) return false;
    const goal = charger.state.near ? 1 : 0;
    let busy = false;
    if (this.plugT !== goal) {
      this.plugT += (goal - this.plugT) * (reduced ? 1 : 1 - Math.exp(-dt * 9));
      if (Math.abs(goal - this.plugT) < 0.004) this.plugT = goal;
      busy = true;
      this.cableKey = '';
    }
    if (dotMoved && this.plugT > 0) this.cableKey = '';
    const key = `${charger.id},${charger.x.toFixed(2)},${charger.z.toFixed(2)},${charger.ry.toFixed(3)},${charger.lift.toFixed(2)}`;
    if (key === this.cableKey) return busy;
    this.cableKey = key;
    // where the cable leaves the charger, and which way
    const c = Math.cos(charger.ry), s = Math.sin(charger.ry);
    const ex = charger.x + EXIT[0] * c + EXIT[2] * s, ez = charger.z - EXIT[0] * s + EXIT[2] * c, ey = EXIT[1] + charger.lift;
    const fx = side ? -c : -s, fz = side ? s : -c; // the charger's back (-Z of the model) in the world; the computer's left side (-X)
    // the plug at rest: on the table a little behind the charger, pointing away from it
    this.v.set(ex + fx * 30, 2.75, ez + fz * 30);
    this.q.setFromAxisAngle(UP, charger.ry);
    // the plug in the port: in the middle of the Dot's bottom wall, its tip pointing into the body (+Y of the model)
    this.v2.set(0, -D.hh - 0.4, 0).applyQuaternion(this.deps.dotQuat).add(this.deps.dotPos);
    this.m.set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1); // plug x -> X, plug y -> Z, plug z -> -Y (model frame)
    this.q2.setFromRotationMatrix(this.m).premultiply(this.deps.dotQuat);
    const e = this.plugT * this.plugT * (3 - 2 * this.plugT);
    this.v.lerp(this.v2, e);
    this.v.y += Math.sin(e * Math.PI) * 7;
    this.q.slerp(this.q2, e);
    this.plug.position.copy(this.v);
    this.plug.quaternion.copy(this.q);
    // the cable: out of the charger, down to the table, up into the back of the plug
    this.v3.set(0, 0, 1).applyQuaternion(this.q); // the plug's tail direction
    const tx = this.v.x + this.v3.x * 10.4, ty = this.v.y + this.v3.y * 10.4, tz = this.v.z + this.v3.z * 10.4;
    const span = Math.hypot(tx - ex, tz - ez);
    const reach = Math.max(12, span * 0.42);
    const n = this.cablePts.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), u = 1 - t;
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      const p = this.cablePts[i];
      p[0] = b0 * ex + b1 * (ex + fx * reach) + b2 * (tx + this.v3.x * reach) + b3 * tx;
      p[2] = b0 * ez + b1 * (ez + fz * reach) + b2 * (tz + this.v3.z * reach) + b3 * tz;
      // it sags to the table between its two ends
      const sag = Math.sin(t * Math.PI);
      p[1] = Math.max(1.5, u * ey + t * ty - sag * Math.min(Math.max(ey, ty), 6 + span * 0.2));
    }
    writeTube(this.cablePos, this.cableNrm, this.cablePts, 1.45, 7);
    const g = this.cable.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('normal').needsUpdate = true;
    return busy;
  }

  dispose(): void {
    this.liveOff();
    for (const it of this.items.values()) if (it.dyn) disposeInstance(it.dyn);
    for (const b of this.batches.values()) for (const m of b.meshes) m.dispose();
    this.decor.dispose();
    this.decor.geometry.dispose();
    this.decorMat.dispose();
    this.range.geometry.dispose();
    this.rangeMat.dispose();
    this.cable.geometry.dispose();
    (this.cable.material as Material).dispose();
  }
}

const EMPTY: WirelessState['fields'] = {};
const IDLE_PART = { fields: {}, outputs: {}, visuals: {}, power: { on: false }, pins: {} };
const BLACK: readonly number[] = [0.22, 0.15, 0.09];
