/**
 * The Workbench inside the 3D canvas (lazy: loaded the first time the mode is shown). It mounts the scene of world.ts
 * next to the Dot's model, turns pointer, wheel, touch and keyboard input into camera moves and bench edits, and tells
 * the device view where the Dot lies.
 */
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, MeshBasicMaterial, type Quaternion, type Vector3 } from 'three';
import type { MotionPose } from '../device/motion';
import type { BenchStore } from '../bench/store';
import type { LiveStore } from '../bench/live';
import type { BenchRuntime } from '../bench/runtime';
import type { KodeDevice } from '../device/types';
import { DOT_ID } from './layout';
import type { Selection, WorkbenchBus } from './state';
import { BenchWorld } from './world';

/** What the scene needs from the page. */
export interface WorldDeps {
  bench: BenchStore;
  live: LiveStore;
  runtime: BenchRuntime;
  device: KodeDevice;
  select: Selection;
  bus: WorkbenchBus;
  applyPose(p: MotionPose): void;
  /** Default name of a new object of a kind, in the page language. */
  nameFor(kind: string): string;
}

/** What the device view asks of the Workbench each frame, and where it sends presses on the Dot's body. */
export interface WorldApi {
  step(dt: number, reduced: boolean): boolean;
  readonly camPos: Vector3;
  readonly camLook: Vector3;
  readonly dotQuat: Quaternion;
  readonly dotPos: Vector3;
  dotDown(e: ThreeEvent<PointerEvent>): void;
  dotDouble(): void;
}

export interface WorldProps {
  deps: WorldDeps;
  /** The Workbench is the mode on show (otherwise it is only kept ready). */
  active: boolean;
  dark: boolean;
  storePose: MotionPose;
  onApi(api: WorldApi | null): void;
}

const CLICK_SLOP_PX = 5;

export default function World({ deps, active, dark, storePose, onApi }: WorldProps) {
  const { gl, size, invalidate } = useThree();
  const world = useMemo(() => new BenchWorld(dark), []); // eslint-disable-line react-hooks/exhaustive-deps
  const hit = useMemo(() => new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: BackSide }), []);
  const live = useRef({ active, size, deps });
  live.current = { active, size, deps };
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    world.dispose();
    hit.dispose();
  }, [world, hit]);
  useEffect(() => {
    world.setDark(dark);
    invalidate();
  }, [world, dark, invalidate]);
  useEffect(() => {
    world.setPose(storePose);
    invalidate();
  }, [world, storePose, invalidate]);

  // ---- one pointer followed on the window until it lifts (leaving the canvas is safe)
  const watch = (pointerId: number, onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent | null) => void) => {
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) onMove(e);
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
      cancel.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    cancel.current = () => {
      stop();
      onEnd(null);
    };
  };

  /** Drag on nothing (or on the Dot's body): turn the view; with Shift, the middle or the right button: slide it. */
  const cameraDrag = (e: ThreeEvent<PointerEvent>, onClick: () => void) => {
    e.stopPropagation();
    const ne = e.nativeEvent;
    const pan = ne.pointerType === 'mouse' && (ne.button === 1 || ne.button === 2 || ne.shiftKey);
    if (ne.pointerType === 'mouse' && ne.button !== 0 && !pan) return;
    let x = ne.clientX, y = ne.clientY, travelled = 0;
    watch(
      ne.pointerId,
      (ev) => {
        const dx = ev.clientX - x, dy = ev.clientY - y;
        x = ev.clientX;
        y = ev.clientY;
        travelled += Math.abs(dx) + Math.abs(dy);
        if (travelled < CLICK_SLOP_PX) return;
        if (pan) world.rig.pan(dx, dy, live.current.size.height);
        else world.rig.orbit(dx, dy);
        invalidate();
      },
      (ev) => {
        if (ev && travelled < CLICK_SLOP_PX && !pan) onClick();
      },
    );
  };

  // ---- what the device view needs
  const api = useMemo<WorldApi>(
    () => ({
      step: (dt, reduced) => world.step(dt, reduced),
      camPos: world.rig.pos,
      camLook: world.rig.look,
      dotQuat: world.dotQuat,
      dotPos: world.dotPos,
      dotDown: (e) => cameraDrag(e, () => live.current.deps.select.only(DOT_ID)),
      dotDouble: () => {
        world.rig.focusDot(live.current.size.width / Math.max(1, live.current.size.height));
        invalidate();
      },
    }),
    [world, invalidate], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    onApi(api);
    return () => onApi(null);
  }, [api, onApi]);

  const aspect = () => live.current.size.width / Math.max(1, live.current.size.height);
  const frameAll = () => world.rig.frame(world.contentRect(), world.contentHeight(), aspect(), { pol: (40 * Math.PI) / 180, az: 0 });

  // the first time the table is shown, and whenever the view changes shape a lot, everything on it is in the picture
  const framed = useRef(false);
  useEffect(() => {
    if (!active || framed.current) return;
    framed.current = true;
    frameAll();
    world.rig.jump();
    invalidate();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- commands from the page
  useEffect(
    () =>
      deps.bus.on((c) => {
        if (c.type === 'focus-dot') world.rig.focusDot(aspect());
        else if (c.type === 'frame-all') frameAll();
        invalidate();
      }),
    [deps.bus, world, invalidate], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- wheel, two-finger pinch and slide, no context menu (the right button slides the view)
  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; mx: number; my: number } | null = null;
    const two = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        cancel.current?.();
        pinch = two();
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) {
        const now = two();
        if (now.d > 0 && pinch.d > 0) world.rig.zoom(pinch.d / now.d);
        world.rig.pan(now.mx - pinch.mx, now.my - pinch.my, live.current.size.height);
        pinch = now;
        invalidate();
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // a pinch on a trackpad arrives as a wheel with Ctrl: finer steps
      world.rig.zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.008 : 0.0013)));
      invalidate();
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', menu);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', menu);
      cancel.current?.();
    };
  }, [active, gl, world, invalidate]);

  return (
    <>
      <primitive object={world.group} />
      {active && (
        // whatever is not the Dot or a thing on the table: the view
        <mesh material={hit} onPointerDown={(e) => cameraDrag(e, () => deps.select.clear())}>
          <sphereGeometry args={[5000, 16, 10]} />
        </mesh>
      )}
    </>
  );
}
