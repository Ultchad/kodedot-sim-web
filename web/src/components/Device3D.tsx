/**
 * 3D device view (three + @react-three/fiber). Lazy-loaded by DevicePane so the
 * 2D page never downloads three.js. Dimensions come from the render's JSON via
 * lib/geometry; only the three named ESTIMATES are literals.
 *
 * Interaction model (all drags use window listeners, so leaving the canvas is safe):
 *   glass pointerdown  -> touch input (UV -> 410x502), no orbit
 *   cap / d-pad        -> setButton, released on pointerup/cancel
 *   body / background  -> rotate the model (orbit); two pointers -> pinch zoom
 * The model's orientation IS the pose (pitch/roll/heading). When "tilt link"
 * is on it is mirrored to the bench's Movimento object, and the sliders move it.
 */
import { useFrame, useLoader, useThree, Canvas, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, Suspense } from 'react';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  ShapeGeometry,
  Shape,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import type { MotionPose } from '../device/motion';
import type { ButtonId, KodeDevice } from '../device/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../device/types';
import type { InputController } from '../lib/input';
import { BODY_CORNER_RADIUS_MM_ESTIMATE, CAP_TO_RING_RATIO_ESTIMATE, DEVICE_THICKNESS_MM_ESTIMATE as T, SPEC, dpadDirection, metrics, uvToScreen } from '../lib/geometry';
import { ORBIT_LIMITS, ZERO_POSE, clampPose, poseToEuler, samePose } from '../lib/pose';
import type { ScreenPainter } from '../lib/screen';
import { backlightFactor } from './Device2D';

const M = metrics(SPEC);
const CREAM = '#f2e9da'; // sampled from the render's body
const BEVEL = 1.3; // mm, ESTIMATE of the edge rounding
const CAMERA_FOV = 30;
const CAMERA_ELEVATION = (8 * Math.PI) / 180; // slight look-down
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const DRAG_DEG_PER_PX = 0.45;

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

// ------------------------------------------------------------------ geometry
function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  const k = Math.min(r, w / 2, h / 2);
  s.moveTo(x + k, y);
  s.lineTo(x + w - k, y);
  s.absarc(x + w - k, y + k, k, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - k);
  s.absarc(x + w - k, y + h - k, k, 0, Math.PI / 2, false);
  s.lineTo(x + k, y + h);
  s.absarc(x + k, y + h - k, k, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + k);
  s.absarc(x + k, y + k, k, Math.PI, Math.PI * 1.5, false);
  return s;
}

function crossShape(span: number, arm: number): Shape {
  const s = span / 2;
  const a = arm / 2;
  const sh = new Shape();
  sh.moveTo(-a, s);
  for (const [x, y] of [[a, s], [a, a], [s, a], [s, -a], [a, -a], [a, -s], [-a, -s], [-a, -a], [-s, -a], [-s, a], [-a, a]] as const) sh.lineTo(x, y);
  sh.closePath();
  return sh;
}

function setPlanarUv(geo: BufferGeometry, map: (x: number, y: number) => [number, number]) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = map(pos.getX(i), pos.getY(i));
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

function radialTexture(stops: [number, string][], size = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function capGeometry(r: number, h: number): BufferGeometry {
  const pts = [new Vector2(0, h), new Vector2(r * 0.8, h), new Vector2(r * 0.96, h * 0.82), new Vector2(r, h * 0.45), new Vector2(r, 0)];
  const g = new LatheGeometry(pts, 40);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z (towards the viewer)
  return g;
}

// ------------------------------------------------------------------- canvas
export default function Device3D(props: Device3DProps) {
  return (
    <div className="device-surface relative min-h-0 min-w-0 flex-1" style={{ touchAction: 'none' }} data-testid="device-3d">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        flat
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: CAMERA_FOV, near: 10, far: 2000, position: [0, 0, 300] }}
        onCreated={({ gl }) => {
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
  const { gl, camera, size, invalidate } = useThree();
  const frontTex = useLoader(TextureLoader, '/device/kode-dot.png');

  // ---- static geometry / materials
  const built = useMemo(() => {
    const bs = BEVEL;
    const w = M.bodyMm.w - 2 * bs;
    const h = M.bodyMm.h - 2 * bs;
    const outline = roundedRect(w, h, Math.max(0.5, BODY_CORNER_RADIUS_MM_ESTIMATE - bs));
    const depth = T - 2 * bs;
    const body = new ExtrudeGeometry(outline, { depth, bevelEnabled: true, bevelThickness: bs, bevelSize: bs, bevelSegments: 6, curveSegments: 28 });
    body.translate(0, 0, -depth / 2);
    const skin = new ShapeGeometry(outline, 28);
    setPlanarUv(skin, (x, y) => {
      const px = M.mmToPx(x, y);
      return [px.x / M.imgW, 1 - px.y / M.imgH];
    });
    const sw = M.screenMm.w;
    const sh = M.screenMm.h;
    const glass = new ShapeGeometry(roundedRect(sw, sh, M.screenMm.r), 28);
    setPlanarUv(glass, (x, y) => [(x + sw / 2) / sw, (y + sh / 2) / sh]);
    const capR = (M.buttons.top.d / 2 / M.ppm) * CAP_TO_RING_RATIO_ESTIMATE;
    const hitR = M.buttons.top.d / 2 / M.ppm;
    const cap = capGeometry(capR, 1.3);
    const arm = SPEC.dpad_px.arm_w / M.ppm;
    const span = SPEC.dpad_px.span / M.ppm;
    const dbs = 0.45;
    const dpad = new ExtrudeGeometry(crossShape(span - 2 * dbs, arm - 2 * dbs), { depth: 0.9, bevelEnabled: true, bevelThickness: dbs, bevelSize: dbs, bevelSegments: 4, curveSegments: 8 });
    return { body, skin, glass, cap, capR, hitR, dpad, span, arm };
  }, []);

  const mats = useMemo(() => {
    frontTex.colorSpace = SRGBColorSpace;
    frontTex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const screenTex = new CanvasTexture(painter.canvas);
    screenTex.colorSpace = SRGBColorSpace;
    screenTex.minFilter = LinearFilter;
    screenTex.magFilter = LinearFilter;
    screenTex.generateMipmaps = false;
    const shadowTex = radialTexture([[0, 'rgba(0,0,0,0.55)'], [0.55, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0)']]);
    const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
    return {
      screenTex,
      shadowTex,
      glowTex,
      body: new MeshStandardMaterial({ color: CREAM, roughness: 0.78, metalness: 0 }),
      skin: new MeshBasicMaterial({ map: frontTex, toneMapped: false }),
      screen: new MeshBasicMaterial({ map: screenTex, toneMapped: false }),
      dpad: new MeshStandardMaterial({ color: '#232325', roughness: 0.55, metalness: 0.05 }),
      capTop: new MeshStandardMaterial({ color: SPEC.top_px.colour, roughness: 0.45 }),
      capBot: new MeshStandardMaterial({ color: SPEC.bot_px.colour, roughness: 0.45 }),
      hit: new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
      glow: new MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, color: new Color(0, 0, 0) }),
      shadow: new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }),
    };
  }, [frontTex, gl, painter]);

  useEffect(
    () => () => {
      Object.values(built).forEach((g) => (g as BufferGeometry).dispose?.());
      Object.values(mats).forEach((m) => (m as { dispose?: () => void }).dispose?.());
    },
    [built, mats],
  );

  // ---- refs
  const model = useRef<Group>(null);
  const glassMesh = useRef<Mesh>(null);
  const topGrp = useRef<Group>(null);
  const botGrp = useRef<Group>(null);
  const dpadTilt = useRef<Group>(null);
  const dpadRest = useRef<Group>(null);
  const target = useRef<MotionPose>({ ...ZERO_POSE });
  const display = useRef<MotionPose>({ ...ZERO_POSE });
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
  }, [device, input, painter, mats, invalidate]);

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
  const tmp = useMemo(() => ({ v: new Vector3(), n: new Vector3(), p: new Plane(), ndc: new Vector2() }), []);

  const glassPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const mesh = glassMesh.current;
    if (!mesh) return null;
    const r = gl.domElement.getBoundingClientRect();
    tmp.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(tmp.ndc, camera);
    mesh.updateWorldMatrix(true, false);
    tmp.v.setFromMatrixPosition(mesh.matrixWorld);
    tmp.n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    tmp.p.setFromNormalAndCoplanarPoint(tmp.n, tmp.v);
    const hit = ray.ray.intersectPlane(tmp.p, new Vector3());
    if (!hit) return null;
    mesh.worldToLocal(hit);
    return uvToScreen((hit.x + M.screenMm.w / 2) / M.screenMm.w, (hit.y + M.screenMm.h / 2) / M.screenMm.h);
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
    const p = e.uv ? uvToScreen(e.uv.x, e.uv.y) : glassPoint(ne.clientX, ne.clientY);
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

  const onDpadDown = (e: ThreeEvent<PointerEvent>) => {
    const rest = dpadRest.current;
    if (!rest) return;
    const local = rest.worldToLocal(e.point.clone());
    const dir = dpadDirection(local.x * M.ppm, -local.y * M.ppm, SPEC.dpad_px.span, SPEC.dpad_px.arm_w);
    if (dir) holdButton(dir, e);
    else e.stopPropagation();
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
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    const projectWorld = (v: Vector3) => {
      const r = gl.domElement.getBoundingClientRect();
      const p = v.clone().project(camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
    const w = window as unknown as Record<string, unknown>;
    w.__dotbench3d = {
      project(spec: string) {
        model.current?.updateWorldMatrix(true, true);
        camera.updateMatrixWorld();
        const world = (g: Group | Mesh | null, off = new Vector3()) => (g ? g.localToWorld(off.clone()) : new Vector3());
        if (spec.startsWith('glass:')) {
          const [x, y] = spec.slice(6).split(',').map(Number);
          const u = (x + 0.5) / SCREEN_WIDTH;
          const v = 1 - (y + 0.5) / SCREEN_HEIGHT;
          return projectWorld(world(glassMesh.current, new Vector3((u - 0.5) * M.screenMm.w, (v - 0.5) * M.screenMm.h, 0)));
        }
        if (spec === 'top') return projectWorld(world(topGrp.current, new Vector3(0, 0, 1.5)));
        if (spec === 'bottom') return projectWorld(world(botGrp.current, new Vector3(0, 0, 1.5)));
        if (spec.startsWith('dpad:')) {
          const k = (built.span / 2) * 0.7;
          const o = ({ up: [0, k], down: [0, -k], left: [-k, 0], right: [k, 0] } as Record<string, number[]>)[spec.slice(5)];
          return projectWorld(world(dpadRest.current, new Vector3(o[0], o[1], 1.2)));
        }
        return null;
      },
      textureVersion: () => mats.screenTex.version,
      rendered: () => gl.info.render.frame,
      pose: () => ({ ...display.current }),
      setPoseDebug: (p: MotionPose) => {
        target.current = p;
        invalidate();
      },
    };
    return () => {
      delete w.__dotbench3d;
    };
  }, [gl, camera, built, mats, invalidate]);

  // ---- per-frame animation
  const baseDist = useRef(300);
  useFrame((_, dt) => {
    const rm = live.current.reducedMotion;
    let busy = false;

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
      g.rotation.set(ex, ey, ez, 'YXZ');
      // haptic: a small physical shake
      const h = rm ? 0 : device.haptic.get();
      if (h > 0.01) {
        g.position.set((Math.random() - 0.5) * h * 1.6, (Math.random() - 0.5) * h * 1.6, 0);
        busy = true;
      } else g.position.set(0, 0, 0);
    }

    // camera fit
    const aspect = size.width / Math.max(1, size.height);
    const halfH = Math.max((M.bodyMm.h / 2) * 1.16, ((M.bodyMm.w / 2) * 1.2) / aspect);
    baseDist.current = halfH / Math.tan((CAMERA_FOV * Math.PI) / 360);
    const z = zoom.current;
    z.display += (z.target - z.display) * (rm ? 1 : 1 - Math.exp(-dt * 12));
    if (Math.abs(z.target - z.display) > 0.001) busy = true;
    else z.display = z.target;
    const dist = baseDist.current / z.display;
    camera.position.set(0, dist * Math.sin(CAMERA_ELEVATION), dist * Math.cos(CAMERA_ELEVATION));
    camera.lookAt(0, 0, 0);

    // buttons
    const pr = input.pressed.get();
    const ease = rm ? 1 : 1 - Math.exp(-dt * 30);
    (Object.keys(press.current) as ButtonId[]).forEach((id) => {
      const goal = pr.has(id) ? 1 : 0;
      press.current[id] += (goal - press.current[id]) * ease;
      if (Math.abs(goal - press.current[id]) > 0.01) busy = true;
      else press.current[id] = goal;
    });
    const base = T / 2 + 0.06;
    if (topGrp.current) topGrp.current.position.z = base + 0.55 - press.current.top * 0.75;
    if (botGrp.current) botGrp.current.position.z = base + 0.55 - press.current.bottom * 0.75;
    const tilt = dpadTilt.current;
    if (tilt) {
      const P = press.current;
      const a = 0.1;
      tilt.rotation.x = (P.down - P.up) * a;
      tilt.rotation.y = (P.right - P.left) * a;
      tilt.position.z = -Math.max(P.up, P.down, P.left, P.right) * 0.25;
    }

    // screen: backlight dim / panel off
    const bl = device.panelOn.get() ? backlightFactor(device.backlight.get()) : 0;
    mats.screen.color.setRGB(bl, bl, bl);

    // LED glow
    const led = device.led.get();
    const on = led.r + led.g + led.b > 0;
    mats.glow.color.setRGB(led.r / 255, led.g / 255, led.b / 255);
    mats.glow.opacity = on ? 0.95 : 0;

    if (busy) invalidate();
  });

  const baseZ = T / 2 + 0.06;
  const m = M;
  return (
    <>
      <ambientLight intensity={1.15} />
      <hemisphereLight args={['#ffffff', '#b9ae9a', 0.55]} />
      <directionalLight position={[-60, 90, 120]} intensity={1.7} />
      <directionalLight position={[80, -20, -90]} intensity={0.6} />

      {/* contact shadow on the (implicit) matte surface */}
      <mesh position={[0, -(m.bodyMm.h / 2 + 7), 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1} material={mats.shadow}>
        <planeGeometry args={[m.bodyMm.w * 1.9, T * 4.2]} />
      </mesh>

      {/* background plane: drag to orbit */}
      <mesh position={[0, 0, -90]} material={mats.hit} onPointerDown={onBodyDown} onDoubleClick={onBodyDouble}>
        <planeGeometry args={[900, 900]} />
      </mesh>

      <group ref={model}>
        <mesh geometry={built.body} material={mats.body} onPointerDown={onBodyDown} onDoubleClick={onBodyDouble} />
        <mesh geometry={built.skin} material={mats.skin} position={[0, 0, T / 2 + 0.03]} onPointerDown={onBodyDown} onDoubleClick={onBodyDouble} />

        <mesh ref={glassMesh} geometry={built.glass} material={mats.screen} position={[m.screenMm.cx, m.screenMm.cy, T / 2 + 0.07]} onPointerDown={onGlassDown} />

        {/* LED light guide glow */}
        <mesh position={[m.led.mm.x, m.led.mm.y, T / 2 + 0.09]} material={mats.glow}>
          <planeGeometry args={[(m.led.w / m.ppm) * 2.1, (m.led.h / m.ppm) * 2.1]} />
        </mesh>

        {/* round buttons */}
        <group position={[m.buttons.top.mm.x, m.buttons.top.mm.y, 0]}>
          <group ref={topGrp} position={[0, 0, baseZ]}>
            <mesh geometry={built.cap} material={mats.capTop} />
          </group>
          <mesh position={[0, 0, T / 2 + 0.1]} material={mats.hit} onPointerDown={(e) => holdButton('top', e)}>
            <circleGeometry args={[built.hitR, 32]} />
          </mesh>
        </group>
        <group position={[m.buttons.bottom.mm.x, m.buttons.bottom.mm.y, 0]}>
          <group ref={botGrp} position={[0, 0, baseZ]}>
            <mesh geometry={built.cap} material={mats.capBot} />
          </group>
          <mesh position={[0, 0, T / 2 + 0.1]} material={mats.hit} onPointerDown={(e) => holdButton('bottom', e)}>
            <circleGeometry args={[built.hitR, 32]} />
          </mesh>
        </group>

        {/* d-pad */}
        <group ref={dpadRest} position={[m.dpad.mm.x, m.dpad.mm.y, baseZ]}>
          <group ref={dpadTilt}>
            <mesh geometry={built.dpad} material={mats.dpad} position={[0, 0, 0.2]} />
          </group>
          <mesh position={[0, 0, 1.4]} material={mats.hit} onPointerDown={onDpadDown}>
            <planeGeometry args={[built.span, built.span]} />
          </mesh>
        </group>
      </group>
    </>
  );
}

export type { Texture };
