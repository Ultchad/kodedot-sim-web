/**
 * 3D device view (three + @react-three/fiber). Lazy-loaded by DevicePane so the
 * 2D page never downloads three.js.
 *
 * The model itself lives in src/device3d/ (geometry, materials' textures, the
 * studio light) and src/lib/bodyModel.ts (dimensions and maths, unit-tested).
 * This file wires it to the page:
 *
 * Interaction (all drags use window listeners, so leaving the canvas is safe):
 *   glass pointerdown  -> touch input (point on the glass -> 410x502), no orbit
 *   button / d-pad     -> setButton, released on pointerup/cancel
 *   body / background  -> rotate the model (orbit); two pointers -> pinch zoom
 * The model's orientation IS the pose (pitch/roll/heading). When "tilt link"
 * is on it is mirrored to the bench's Movimento object, and the sliders move it.
 */
import { useFrame, useThree, Canvas, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  type PerspectiveCamera,
  PointLight,
  Plane,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import type { MotionPose } from '../device/motion';
import type { ButtonId, KodeDevice } from '../device/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../device/types';
import type { InputController } from '../lib/input';
import {
  BUTTON_PROUD_MM_ESTIMATE,
  BUTTON_TRAVEL_MM,
  DPAD_HIT_GROW_MM,
  DPAD_PROUD_MM_ESTIMATE,
  DPAD_TILT_RAD,
  bodyDims,
  buttonHitRadius,
  controlCentre,
  dpadHit,
  glassMmToScreen,
  screenToGlassMm,
} from '../lib/bodyModel';
import { SPEC, metrics } from '../lib/geometry';
import { ORBIT_LIMITS, ZERO_POSE, clampPose, poseToEuler, samePose } from '../lib/pose';
import type { ScreenPainter } from '../lib/screen';
import { buildBodyMesh } from '../device3d/bodyMesh';
import type { MeshData } from '../device3d/meshBuilder';
import { buildButton, buildDpadArm, buildGlass, buildLed, buildPad, buildScreen, buildScrew, buildWindow } from '../device3d/parts';
import { footprint } from '../device3d/stage';
import { makeStudioEnvironment } from '../device3d/studio';
import { makeGrainNormalMap, makeOcclusionTexture, makeShadowTexture } from '../device3d/textures';
import { backlightFactor } from './Device2D';
import { loadGlbModel, type GlbModel } from './glbModel';

const M = metrics(SPEC);
const D = bodyDims(M);

// ---- look (see public/device/MODEL.md)
/** Matte warm off-white plastic. Chosen so that, under the studio light, the lit face lands near the render's #F0E8D9 without clipping. */
const CREAM = '#ebe6dc';
const BLACK_PLASTIC = '#313133';
const GLASS_BLACK = '#060607';
const LED_OFF = '#fbf6ae'; // pale yellow light guide when the LED is off
const EXPOSURE = 1.04;
/** The glass mirrors the studio only faintly: the picture must stay the picture. */
const GLASS_REFLECTION = 0.5;
/** The data's inlay colours are saturated base colours; the maker's render shows them lighter. A little self-colour gets there without washing them out. */
const INLAY_LIFT = 0.28;
/** The light guide is translucent: it never looks as dark as an opaque part, even when the LED is off. */
const LED_IDLE_GLOW = 0.22;
const ENV_INTENSITY = 1.0;

// ---- staging
const CAMERA_FOV = 30;
const CAMERA_ELEVATION = (8 * Math.PI) / 180; // slight look-down
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const DRAG_DEG_PER_PX = 0.45;
/** The ground (soft shadow only) sits this far below the upright device. */
const GROUND_GAP_MM = 9;
/**
 * The view the page opens with while the tilt link is off: a slight
 * three-quarter turn, so the depth, the fillets and the left wall read at
 * once. "Recentre" (and the tilt link) still mean exactly face-on.
 */
const OPENING_VIEW: MotionPose = { pitch: 0, roll: 17, heading: 0 };

export interface Device3DProps {
  device: KodeDevice;
  input: InputController;
  painter: ScreenPainter;
  /** Pose of the bench's active motion object, used when tiltLink is on. */
  storePose: MotionPose;
  tiltLink: boolean;
  onPose(p: MotionPose): void;
  resetSignal: number;
  reducedMotion: boolean;
  onContextLost(): void;
}

function toGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  g.setAttribute('color', new BufferAttribute(m.colors, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const noRaycast = () => null;

// ------------------------------------------------------------------- canvas
export default function Device3D(props: Device3DProps) {
  return (
    <div className="device-surface relative min-h-0 min-w-0 flex-1" style={{ touchAction: 'none' }} data-testid="device-3d">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, toneMapping: NeutralToneMapping, toneMappingExposure: EXPOSURE }}
        camera={{ fov: CAMERA_FOV, near: 20, far: 1500, position: [0, 0, 300] }}
        onCreated={({ gl }) => {
          gl.toneMapping = NeutralToneMapping;
          gl.toneMappingExposure = EXPOSURE;
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            props.onContextLost();
          });
          gl.domElement.setAttribute('data-testid', 'webgl-canvas');
        }}
      >
        <Suspense fallback={null}>
          <Scene {...props} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// -------------------------------------------------------------------- scene
function Scene({ device, input, painter, storePose, tiltLink, onPose, resetSignal, reducedMotion }: Device3DProps) {
  const { gl, camera, size, invalidate, scene } = useThree();

  // ---- static geometry
  const built = useMemo(() => {
    const t0 = performance.now();
    const body = buildBodyMesh(D);
    const top = buildButton('top', D);
    const bottom = buildButton('bottom', D);
    const geo = {
      body: toGeometry(body),
      glass: toGeometry(buildGlass(D)),
      screen: toGeometry(buildScreen(D)),
      led: toGeometry(buildLed(D)),
      window: toGeometry(buildWindow(D)),
      pads: [0, 1, 2, 3, 4].map((i) => toGeometry(buildPad(i, D))),
      screw: toGeometry(buildScrew(D)),
      topBody: toGeometry(top.body),
      topInlay: toGeometry(top.inlay),
      bottomBody: toGeometry(bottom.body),
      bottomInlay: toGeometry(bottom.inlay),
      dpadArm: toGeometry(buildDpadArm(D)),
    };
    const all = [geo.body, geo.glass, geo.screen, geo.led, geo.window, ...geo.pads, geo.screw, geo.topBody, geo.topInlay, geo.bottomBody, geo.bottomInlay, geo.dpadArm];
    const triangles = all.reduce((s, g) => s + (g.index?.count ?? 0) / 3, 0) + 3 * ((geo.dpadArm.index?.count ?? 0) / 3);
    return { ...geo, all, triangles, shellTriangles: body.indices.length / 3, buildMs: performance.now() - t0 };
  }, []);

  // ---- materials
  const mats = useMemo(() => {
    const screenTex = new CanvasTexture(painter.canvas);
    screenTex.colorSpace = SRGBColorSpace;
    screenTex.minFilter = LinearFilter;
    screenTex.magFilter = LinearFilter;
    screenTex.generateMipmaps = false;
    const ao = makeOcclusionTexture(D);
    const grain = makeGrainNormalMap();
    const shadowTex = makeShadowTexture();
    const plastic = (color: string, roughness: number) => new MeshStandardMaterial({ color, roughness, metalness: 0, vertexColors: true, normalMap: grain, normalScale: new Vector2(0.07, 0.07) });
    return {
      screenTex,
      textures: [screenTex, ao, grain, shadowTex],
      body: new MeshStandardMaterial({ color: CREAM, map: ao, vertexColors: true, roughness: 0.74, metalness: 0, normalMap: grain, normalScale: new Vector2(0.11, 0.11) }),
      // the lit picture: unlit, straight sRGB, never tone-mapped
      screen: new MeshBasicMaterial({ map: screenTex, toneMapped: false }),
      // black glass under and around the picture, and the same glass's reflection added over the picture
      glass: new MeshStandardMaterial({ color: GLASS_BLACK, roughness: 0.1, metalness: 0, vertexColors: true, envMapIntensity: GLASS_REFLECTION }),
      gloss: new MeshStandardMaterial({ color: '#000000', roughness: 0.1, metalness: 0, transparent: true, blending: AdditiveBlending, depthWrite: false, envMapIntensity: GLASS_REFLECTION }),
      window: new MeshStandardMaterial({ color: '#111113', roughness: 0.36, metalness: 0, vertexColors: true, envMapIntensity: 0.1 }),
      dpad: plastic(BLACK_PLASTIC, 0.5),
      button: plastic(BLACK_PLASTIC, 0.44),
      inlayTop: new MeshStandardMaterial({ color: SPEC.top_px.colour, roughness: 0.4, emissive: SPEC.top_px.colour, emissiveIntensity: INLAY_LIFT }),
      inlayBot: new MeshStandardMaterial({ color: SPEC.bot_px.colour, roughness: 0.4, emissive: SPEC.bot_px.colour, emissiveIntensity: INLAY_LIFT }),
      gold: new MeshStandardMaterial({ color: '#f0b246', roughness: 0.34, metalness: 0.6, vertexColors: true }),
      silver: new MeshStandardMaterial({ color: '#e4e5e8', roughness: 0.32, metalness: 0.6, vertexColors: true }),
      led: new MeshStandardMaterial({ color: LED_OFF, roughness: 0.35, emissive: new Color(LED_OFF), emissiveIntensity: LED_IDLE_GLOW, vertexColors: true }),
      hit: new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }), // invisible, still ray-cast
      shadow: new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.5 }),
    };
  }, [painter]);

  // ---- studio light (prefiltered environment; see device3d/studio.ts)
  useEffect(() => {
    const env = makeStudioEnvironment(gl);
    const gloss = makeStudioEnvironment(gl, true); // what the glass mirrors: the studio with a black flag in front
    scene.environment = env.texture;
    scene.environmentIntensity = ENV_INTENSITY;
    for (const m of [mats.glass, mats.gloss, mats.window]) {
      m.envMap = gloss.texture;
      m.needsUpdate = true;
    }
    invalidate();
    return () => {
      scene.environment = null;
      for (const m of [mats.glass, mats.gloss, mats.window]) m.envMap = null;
      env.dispose();
      gloss.dispose();
    };
  }, [gl, scene, mats, invalidate]);

  // optional drop-in model: /device/model.glb (see public/device/MODEL.md)
  const [glb, setGlb] = useState<GlbModel | null>(null);
  useEffect(() => {
    let dead = false;
    void loadGlbModel().then((m) => {
      if (!dead && m) setGlb(m);
    });
    return () => {
      dead = true;
    };
  }, []);
  // the glTF convention puts UV (0,0) at the top-left of an image: same canvas, not flipped
  const glbScreenTex = useMemo(() => {
    if (!glb) return null;
    const t = new CanvasTexture(painter.canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    return t;
  }, [glb, painter]);
  const glbScreenMat = useMemo(() => (glbScreenTex ? new MeshBasicMaterial({ map: glbScreenTex, toneMapped: false }) : null), [glbScreenTex]);
  useEffect(
    () => () => {
      glbScreenTex?.dispose();
      glbScreenMat?.dispose();
    },
    [glbScreenTex, glbScreenMat],
  );

  useEffect(
    () => () => {
      built.all.forEach((g) => g.dispose());
      mats.textures.forEach((t) => t.dispose());
      Object.values(mats).forEach((m) => (m as { dispose?: () => void }).dispose?.());
    },
    [built, mats],
  );

  // ---- refs
  const model = useRef<Group>(null);
  const glassMesh = useRef<Mesh | null>(null);
  const ledMats = useRef<MeshStandardMaterial[]>([]);
  const ledLight = useRef<PointLight>(null);
  const shadowMesh = useRef<Mesh>(null);
  const glbRest = useRef(new Map<Object3D, number>());
  const topGrp = useRef<Group>(null);
  const botGrp = useRef<Group>(null);
  const dpadTilt = useRef<Group>(null);
  const dpadRest = useRef<Group>(null);
  const opening = tiltLink ? ZERO_POSE : OPENING_VIEW;
  const target = useRef<MotionPose>({ ...opening });
  const display = useRef<MotionPose>({ ...opening });
  const zoom = useRef({ target: 1, display: 1 });
  const press = useRef<Record<ButtonId, number>>({ top: 0, bottom: 0, up: 0, down: 0, left: 0, right: 0 });
  const cancelInteraction = useRef<(() => void) | null>(null);
  const live = useRef({ tiltLink, onPose, reducedMotion });
  live.current = { tiltLink, onPose, reducedMotion };
  const dragging = useRef(false);

  // ---- subscriptions that wake the demand loop
  useEffect(() => {
    const wake = () => invalidate();
    const offs = [
      painter.onFrame(() => {
        mats.screenTex.needsUpdate = true;
        if (glbScreenTex) glbScreenTex.needsUpdate = true;
        invalidate();
      }),
      device.led.subscribe(wake),
      device.haptic.subscribe(wake),
      device.backlight.subscribe(wake),
      device.panelOn.subscribe(wake),
      input.pressed.subscribe(wake),
    ];
    mats.screenTex.needsUpdate = true;
    invalidate();
    return () => offs.forEach((o) => o());
  }, [device, input, painter, mats, glbScreenTex, invalidate]);

  // ---- pose in: tilt link mirrors the store; otherwise the view is local
  useEffect(() => {
    if (tiltLink && !dragging.current) {
      target.current = { ...storePose };
      invalidate();
    }
  }, [tiltLink, storePose, invalidate]);

  useEffect(() => {
    if (!tiltLink) target.current = clampPose(target.current, ORBIT_LIMITS);
  }, [tiltLink]);

  // ---- recentre
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    target.current = { ...ZERO_POSE };
    zoom.current.target = 1;
    if (live.current.tiltLink) live.current.onPose({ ...ZERO_POSE });
    invalidate();
  }, [resetSignal, invalidate]);

  // ---- helpers
  const ray = useMemo(() => new Raycaster(), []);
  const tmp = useMemo(() => ({ v: new Vector3(), n: new Vector3(), p: new Plane(), ndc: new Vector2(), box: new Box3() }), []);

  const clampPx = (x: number, y: number) => ({ x: Math.min(SCREEN_WIDTH - 1, Math.max(0, Math.floor(x))), y: Math.min(SCREEN_HEIGHT - 1, Math.max(0, Math.floor(y))) });

  /** Screen pixel under a client point. Procedural glass: exact plane maths (keeps tracking off the glass). Drop-in model: the hit UV. */
  const glassPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const mesh = glassMesh.current;
    if (!mesh) return null;
    const r = gl.domElement.getBoundingClientRect();
    tmp.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(tmp.ndc, camera);
    mesh.updateWorldMatrix(true, false);
    if (glb) {
      const hit = ray.intersectObject(mesh, false)[0];
      return hit?.uv ? clampPx(hit.uv.x * SCREEN_WIDTH, hit.uv.y * SCREEN_HEIGHT) : null;
    }
    tmp.v.setFromMatrixPosition(mesh.matrixWorld);
    tmp.n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    tmp.p.setFromNormalAndCoplanarPoint(tmp.n, tmp.v);
    const hit = ray.ray.intersectPlane(tmp.p, new Vector3());
    if (!hit) return null;
    mesh.worldToLocal(hit);
    return glassMmToScreen(hit.x, hit.y, D);
  };

  const watch = (pointerId: number, onMove: ((e: PointerEvent) => void) | null, onEnd: (e: PointerEvent | null) => void) => {
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) onMove?.(e);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      stop();
      onEnd(e);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      cancelInteraction.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    cancelInteraction.current = () => {
      stop();
      onEnd(null);
    };
  };

  // pinch zoom + wheel (DOM level on the canvas element)
  useEffect(() => {
    const el = gl.domElement;
    const pts = new Map<number, { x: number; y: number }>();
    let pinchStart: { d: number; z: number } | null = null;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        cancelInteraction.current?.();
        pinchStart = { d: dist(), z: zoom.current.target };
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchStart && pts.size === 2) {
        zoom.current.target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (pinchStart.z * dist()) / pinchStart.d));
        invalidate();
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinchStart = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current.target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.current.target * Math.exp(-e.deltaY * 0.0015)));
      invalidate();
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [gl, invalidate]);

  // ---- pointer handlers (R3F only does the first hit-test)
  const onGlassDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const ne = e.nativeEvent;
    if (!ne.isPrimary || (ne.pointerType === 'mouse' && ne.button !== 0)) return;
    const p = glassPoint(ne.clientX, ne.clientY);
    if (!p || !input.touchDown(ne.pointerId, p.x, p.y)) return;
    let last = p;
    watch(
      ne.pointerId,
      (ev) => {
        const q = glassPoint(ev.clientX, ev.clientY);
        if (q) {
          last = q;
          input.touchMove(ev.pointerId, q.x, q.y);
        }
      },
      () => input.touchUp(ne.pointerId, last.x, last.y),
    );
  };

  const holdButton = (id: ButtonId, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const ne = e.nativeEvent;
    if (ne.pointerType === 'mouse' && ne.button !== 0) return;
    const src = `p3:${ne.pointerId}`;
    input.press(id, src);
    watch(ne.pointerId, null, () => input.release(id, src));
  };

  /** The generous invisible target over the pad: the point decides the arm. */
  const onDpadDown = (e: ThreeEvent<PointerEvent>) => {
    const rest = dpadRest.current;
    if (!rest) return;
    const local = rest.worldToLocal(e.point.clone());
    const dir = dpadHit(local.x, local.y, D);
    if (dir) holdButton(dir, e); // otherwise the event carries on to whatever is behind (button target or body)
  };

  const onBodyDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const ne = e.nativeEvent;
    if (ne.pointerType === 'mouse' && ne.button !== 0) return;
    const start = { x: ne.clientX, y: ne.clientY, pose: { ...(live.current.tiltLink ? storePose : target.current) } };
    dragging.current = true;
    watch(
      ne.pointerId,
      (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        const next: MotionPose = ev.shiftKey || ev.altKey
          ? { ...start.pose, heading: start.pose.heading + dx * DRAG_DEG_PER_PX }
          : { ...start.pose, roll: start.pose.roll + dx * DRAG_DEG_PER_PX, pitch: start.pose.pitch - dy * DRAG_DEG_PER_PX };
        const c = clampPose(next, ORBIT_LIMITS);
        target.current = c;
        if (live.current.tiltLink) live.current.onPose(c);
        invalidate();
      },
      () => {
        dragging.current = false;
      },
    );
  };

  const onBodyDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    target.current = { ...ZERO_POSE };
    zoom.current.target = 1;
    if (live.current.tiltLink) live.current.onPose({ ...ZERO_POSE });
    invalidate();
  };

  // ---- debug hook (headless verification): only with ?debug in the URL
  const view = useRef<{ elevation: number; distance: number | null; fov: number; rotation: [number, number, number] | null; position: [number, number, number] | null; offsetY: number; shadow: boolean }>({ elevation: CAMERA_ELEVATION, distance: null, fov: CAMERA_FOV, rotation: null, position: null, offsetY: 0, shadow: true });
  const frameMs = useRef<number[]>([]);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    const projectWorld = (v: Vector3) => {
      const r = gl.domElement.getBoundingClientRect();
      const p = v.clone().project(camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
    const w = window as unknown as Record<string, unknown>;
    w.__dotbench3d = {
      /** Client coordinates of 'glass:x,y' (a screen pixel), 'top', 'bottom' or 'dpad:up|down|left|right'. */
      project(spec: string) {
        const g = model.current;
        if (!g) return null;
        g.updateWorldMatrix(true, true);
        camera.updateMatrixWorld();
        const nodeCentre = (o: Object3D) => projectWorld(tmp.box.setFromObject(o).getCenter(new Vector3()));
        if (spec.startsWith('glass:')) {
          const [x, y] = spec.slice(6).split(',').map(Number);
          const mesh = glassMesh.current;
          if (!mesh) return null;
          if (glb) {
            const bb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!);
            const u = (x + 0.5) / SCREEN_WIDTH, v = (y + 0.5) / SCREEN_HEIGHT;
            return projectWorld(mesh.localToWorld(new Vector3(bb.min.x + u * (bb.max.x - bb.min.x), bb.max.y - v * (bb.max.y - bb.min.y), (bb.min.z + bb.max.z) / 2)));
          }
          const q = screenToGlassMm(x, y, D);
          return projectWorld(mesh.localToWorld(new Vector3(q.x, q.y, 0)));
        }
        const id = (spec.startsWith('dpad:') ? spec.slice(5) : spec) as ButtonId;
        if (!(id in press.current)) return null;
        if (glb) return nodeCentre(glb.press[id]);
        return projectWorld(g.localToWorld(new Vector3(...controlCentre(id, D))));
      },
      scene: () => scene,
      textureVersion: () => mats.screenTex.version,
      rendered: () => gl.info.render.frame,
      pose: () => ({ ...display.current }),
      setPoseDebug: (p: MotionPose) => {
        target.current = p;
        invalidate();
      },
      /** Extras for scripts/model-shots.mjs. */
      setViewDebug: (v: { elevationDeg?: number; distance?: number | null; fovDeg?: number; zoom?: number; rotationZXY?: [number, number, number] | null; position?: [number, number, number] | null; offsetY?: number; shadow?: boolean }) => {
        if (v.shadow !== undefined) view.current.shadow = v.shadow; // ground shadow on/off (silhouette comparisons)
        if (v.position !== undefined) view.current.position = v.position; // model position override (mm)
        if (v.offsetY !== undefined) view.current.offsetY = v.offsetY; // look-at point, as a fraction of the body height below the centre
        if (v.rotationZXY !== undefined) view.current.rotation = v.rotationZXY; // radians about X, Y, Z, applied as Rz*Rx*Ry; null = follow the pose
        if (v.elevationDeg !== undefined) view.current.elevation = (v.elevationDeg * Math.PI) / 180;
        if (v.distance !== undefined) view.current.distance = v.distance;
        if (v.fovDeg !== undefined) view.current.fov = v.fovDeg;
        if (v.zoom !== undefined) zoom.current.target = zoom.current.display = v.zoom;
        invalidate();
      },
      /** Controls currently held, as the input layer sees them. */
      pressed: () => [...input.pressed.get()],
      info: () => ({ triangles: built.triangles, shellTriangles: built.shellTriangles, buildMs: built.buildMs, calls: gl.info.render.calls, rendered: gl.info.render.triangles, glb: !!glb, webgl2: gl.capabilities.isWebGL2 }),
      /** Renders `n` frames back to back and returns the mean milliseconds per frame (GPU work included). */
      bench: (n = 60) => {
        const ctx = gl.getContext();
        const px = new Uint8Array(4);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          gl.render(scene, camera);
          ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px); // forces the frame to finish
        }
        return (performance.now() - t0) / n;
      },
      frameTimes: () => frameMs.current.slice(),
    };
    return () => {
      delete w.__dotbench3d;
    };
  }, [gl, camera, scene, built, mats, glb, tmp, input, invalidate]);

  // ---- per-frame animation
  const baseDist = useRef(300);
  useFrame((_, dt) => {
    const rm = live.current.reducedMotion;
    let busy = false;
    if (frameMs.current.length < 600) frameMs.current.push(dt * 1000);

    // pose damping
    const k = rm ? 1 : 1 - Math.exp(-dt * 16);
    const d = display.current;
    const t = target.current;
    d.pitch += (t.pitch - d.pitch) * k;
    d.roll += (t.roll - d.roll) * k;
    d.heading += (t.heading - d.heading) * k;
    if (!samePose(d, t, 0.02)) busy = true;
    else Object.assign(d, t);
    const g = model.current;
    if (g) {
      const [ex, ey, ez] = poseToEuler(d);
      if (view.current.rotation) g.rotation.set(...view.current.rotation, 'ZXY');
      else g.rotation.set(ex, ey, ez, 'YXZ');
      // haptic: a small physical shake
      const h = rm ? 0 : device.haptic.get();
      if (h > 0.01) {
        g.position.set((Math.random() - 0.5) * h * 1.6, (Math.random() - 0.5) * h * 1.6, 0);
        busy = true;
      } else if (view.current.position) g.position.set(...view.current.position);
      else g.position.set(0, 0, 0);
      // ground shadow follows the footprint
      const sh = shadowMesh.current;
      if (sh) {
        sh.visible = view.current.shadow;
        g.updateMatrix();
        const f = footprint(g.matrix.elements, D);
        const groundY = -(D.hh + GROUND_GAP_MM);
        const gap = Math.max(0, f.lowest - groundY);
        const soft = 1.9 + gap * 0.045; // the blob texture keeps half of its size as penumbra
        sh.position.set(f.x, groundY, f.z);
        sh.rotation.set(-Math.PI / 2, 0, -f.angle);
        sh.scale.set(f.a * 2 * soft, f.b * 2 * soft, 1);
        mats.shadow.opacity = 0.62 / (1 + gap * 0.035);
      }
    }

    // camera fit
    const cam = camera as PerspectiveCamera;
    if (cam.fov !== view.current.fov) {
      cam.fov = view.current.fov;
      cam.updateProjectionMatrix();
    }
    const aspect = size.width / Math.max(1, size.height);
    const halfH = Math.max((M.bodyMm.h / 2) * 1.16, ((M.bodyMm.w / 2) * 1.2) / aspect);
    baseDist.current = halfH / Math.tan((view.current.fov * Math.PI) / 360);
    const z = zoom.current;
    z.display += (z.target - z.display) * (rm ? 1 : 1 - Math.exp(-dt * 12));
    if (Math.abs(z.target - z.display) > 0.001) busy = true;
    else z.display = z.target;
    const dist = (view.current.distance ?? baseDist.current) / z.display;
    const lookY = -view.current.offsetY * M.bodyMm.h;
    camera.position.set(0, lookY + dist * Math.sin(view.current.elevation), dist * Math.cos(view.current.elevation));
    camera.lookAt(0, lookY, 0);

    // buttons
    const pr = input.pressed.get();
    const ease = rm ? 1 : 1 - Math.exp(-dt * 30);
    (Object.keys(press.current) as ButtonId[]).forEach((id) => {
      const goal = pr.has(id) ? 1 : 0;
      press.current[id] += (goal - press.current[id]) * ease;
      if (Math.abs(goal - press.current[id]) > 0.01) busy = true;
      else press.current[id] = goal;
    });
    const P = press.current;
    if (topGrp.current) topGrp.current.position.z = -P.top * BUTTON_TRAVEL_MM;
    if (botGrp.current) botGrp.current.position.z = -P.bottom * BUTTON_TRAVEL_MM;
    const tilt = dpadTilt.current;
    if (tilt) {
      // one rocker: it leans towards the held arm and sinks a little
      tilt.rotation.x = (P.up - P.down) * -DPAD_TILT_RAD;
      tilt.rotation.y = (P.right - P.left) * DPAD_TILT_RAD;
      tilt.position.z = -Math.max(P.up, P.down, P.left, P.right) * 0.25;
    }
    if (glb) {
      for (const [id, node] of Object.entries(glb.press) as [ButtonId, Object3D][]) {
        const rest = glbRest.current.get(node) ?? node.position.z;
        glbRest.current.set(node, rest);
        node.position.z = rest - P[id] * BUTTON_TRAVEL_MM;
      }
    }

    // screen: backlight dim / panel off. Same dimming curve as the 2D view (an sRGB-space multiply).
    const bl = device.panelOn.get() ? backlightFactor(device.backlight.get()) : 0;
    mats.screen.color.setRGB(bl, bl, bl, SRGBColorSpace);
    glbScreenMat?.color.setRGB(bl, bl, bl, SRGBColorSpace);

    // LED: light guide glows with the live colour
    const led = device.led.get();
    const on = led.r + led.g + led.b > 0;
    const ledMs = glb ? ledMats.current : [mats.led];
    for (const lm of ledMs) {
      if (on) {
        // mostly self-lit, so the hue survives the tone mapping instead of burning out to white
        lm.color.setRGB(0.12 + (led.r / 255) * 0.4, 0.12 + (led.g / 255) * 0.4, 0.12 + (led.b / 255) * 0.4);
        lm.emissive?.setRGB(led.r / 255, led.g / 255, led.b / 255);
        lm.emissiveIntensity = 1.0;
      } else {
        lm.color.set(LED_OFF);
        lm.emissive?.set(LED_OFF);
        lm.emissiveIntensity = LED_IDLE_GLOW;
      }
    }
    if (ledLight.current) {
      ledLight.current.color.setRGB(led.r / 255, led.g / 255, led.b / 255);
      ledLight.current.intensity = on ? 520 : 0;
    }

    if (busy) invalidate();
  });

  // ---- drop-in model wiring
  const glbDown = (e: ThreeEvent<PointerEvent>) => {
    for (let n: Object3D | null = e.object; n; n = n.parent) {
      if (n === glb?.screenNode) return onGlassDown(e);
      for (const [id, node] of Object.entries(glb?.press ?? {}) as [ButtonId, Object3D][]) if (n === node) return holdButton(id, e);
    }
    return onBodyDown(e);
  };
  useEffect(() => {
    if (!glb || !glbScreenMat) return;
    glbRest.current.clear();
    glassMesh.current = glb.screen;
    glb.screen.material = glbScreenMat;
    ledMats.current = glb.ledMaterials;
    invalidate();
    return () => {
      glassMesh.current = null;
    };
  }, [glb, glbScreenMat, invalidate]);

  const zf = D.zf;
  const armNames = ['dpad_right', 'dpad_up', 'dpad_left', 'dpad_down'] as const;
  const armIds: ButtonId[] = ['right', 'up', 'left', 'down'];
  const dpadHitSize = (D.dpad.half + DPAD_HIT_GROW_MM) * 2;

  return (
    <>
      {/* soft shadow on the (implicit) ground */}
      <mesh ref={shadowMesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1} material={mats.shadow} raycast={noRaycast}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* background plane: drag to orbit */}
      <mesh position={[0, 0, -90]} material={mats.hit} onPointerDown={onBodyDown} onDoubleClick={onBodyDouble}>
        <planeGeometry args={[900, 900]} />
      </mesh>

      <group ref={model}>
        {glb ? (
          <primitive object={glb.root} onPointerDown={glbDown} onDoubleClick={onBodyDouble} />
        ) : (
          <>
            <mesh name="body" geometry={built.body} material={mats.body} onPointerDown={onBodyDown} onDoubleClick={onBodyDouble} />

            {/* black glass (flush), the lit picture on it, and the glass's reflection over the picture */}
            <mesh name="glass" geometry={built.glass} material={mats.glass} onPointerDown={onBodyDown} />
            <mesh name="screen" ref={glassMesh} geometry={built.screen} material={mats.screen} position={[D.screen.cx, D.screen.cy, zf + 0.012]} onPointerDown={onGlassDown} />
            <mesh geometry={built.screen} material={mats.gloss} position={[D.screen.cx, D.screen.cy, zf + 0.024]} raycast={noRaycast} renderOrder={2} />

            {/* light guide */}
            <mesh name="led" geometry={built.led} material={mats.led} onPointerDown={onBodyDown} />
            <pointLight ref={ledLight} position={[D.led.bounds.x1 - 2, D.led.bounds.y1 - 2, zf + 5]} intensity={0} distance={60} decay={2} />

            {/* right wall window; back: contact pads (first one silver) and the screw */}
            <mesh geometry={built.window} material={mats.window} onPointerDown={onBodyDown} />
            {built.pads.map((g, i) => (
              <mesh key={i} geometry={g} material={i === 0 ? mats.silver : mats.gold} onPointerDown={onBodyDown} />
            ))}
            <mesh geometry={built.screw} material={mats.silver} onPointerDown={onBodyDown} />

            {/* round buttons: black body with a coloured inlay, moving as one */}
            {(['top', 'bottom'] as const).map((id) => {
              const b = D.buttons[id];
              return (
                <group key={id} position={[b.x, b.y, zf]}>
                  <group ref={id === 'top' ? topGrp : botGrp} name={id === 'top' ? 'btn_top' : 'btn_bottom'}>
                    <mesh geometry={id === 'top' ? built.topBody : built.bottomBody} material={mats.button} onPointerDown={(e) => holdButton(id, e)} />
                    <mesh geometry={id === 'top' ? built.topInlay : built.bottomInlay} material={id === 'top' ? mats.inlayTop : mats.inlayBot} onPointerDown={(e) => holdButton(id, e)} />
                  </group>
                  <mesh position={[0, 0, BUTTON_PROUD_MM_ESTIMATE + 0.15]} material={mats.hit} onPointerDown={(e) => holdButton(id, e)}>
                    <circleGeometry args={[buttonHitRadius(id, D), 32]} />
                  </mesh>
                </group>
              );
            })}

            {/* d-pad: four arm meshes on one rocker */}
            <group ref={dpadRest} position={[D.dpad.x, D.dpad.y, zf]}>
              <group ref={dpadTilt}>
                {armIds.map((id, q) => (
                  <mesh key={id} name={armNames[q]} geometry={built.dpadArm} material={mats.dpad} rotation={[0, 0, (q * Math.PI) / 2]} onPointerDown={(e) => holdButton(id, e)} />
                ))}
              </group>
              <mesh position={[0, 0, DPAD_PROUD_MM_ESTIMATE + 0.15]} material={mats.hit} onPointerDown={onDpadDown}>
                <planeGeometry args={[dpadHitSize, dpadHitSize]} />
              </mesh>
            </group>
          </>
        )}
      </group>
    </>
  );
}
