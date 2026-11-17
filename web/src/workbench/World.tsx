/**
 * The Workbench inside the 3D canvas (lazy: loaded the first time the mode is shown). It mounts the scene of world.ts
 * next to the Dot's model, turns pointer, wheel, touch, keyboard and drag-and-drop input into camera moves and bench
 * edits, and tells the device view where the Dot lies.
 *
 * Input:
 *   drag a thing           slide it on the table (snapped; it goes round what is in the way; Alt = no snapping)
 *   click / Shift-click    select / add to the selection          Escape clears, Ctrl+A selects everything
 *   arrows                 nudge the selection one grid step (Shift: five); without a selection they are the D-pad
 *   R / Shift+R            quarter turn        Delete        Ctrl+D duplicate        N near / away
 *   Ctrl+Z / Ctrl+Shift+Z  undo / redo
 *   drag nothing           turn the view (Shift, middle or right button: slide it); wheel and pinch zoom; F the Dot, 0 the table
 *   the amber ball         tilt the Dot (Shift: turn it); Alt+arrows do the same from the keyboard
 */
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackSide, BufferGeometry, Group, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector2, Vector3, type Intersection, type Mesh, type Quaternion } from 'three';
import type { MotionPose } from '../device/motion';
import type { IrRemoteHandle } from '../bench/drivers/ir';
import { getKind } from '../bench/kinds';
import type { BenchStore } from '../bench/store';
import type { LiveStore } from '../bench/live';
import type { BenchRuntime } from '../bench/runtime';
import type { SdAreaApi } from '../bench/sd';
import type { KodeDevice } from '../device/types';
import { REMOTE_BUTTONS as REMOTE } from '../bench3d/models/wireless/ir-remote.model';
import { onPrintsRedrawn } from '../bench3d/print';
import { isEditableTarget, ownsArrowKeys } from '../lib/keys';
import { bodyDims } from '../lib/bodyModel';
import type { Pick } from './bodies';
import { DOT_ID, GRID, SD_ID, SIZES, clampToMat, hasBody, isFree, isNear, obstacles, settle, snap, zoneOf, type Placed, type Pos } from './layout';
import { KIND_MIME, type Selection, type WorkbenchBus } from './state';
import { BenchWorld, TILT_LIMIT } from './world';

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
const NONE: ReadonlySet<string> = new Set();
const D = bodyDims();
const DEG_PER_PX = 0.45;

export default function World({ deps, active, dark, storePose, onApi }: WorldProps) {
  const { gl, size, camera, invalidate } = useThree();
  const world = useMemo(() => new BenchWorld(dark, { bench: deps.bench, live: deps.live, device: deps.device }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const mats = useMemo(
    () => ({
      hit: new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: BackSide }),
      ball: new MeshStandardMaterial({ color: '#ffac00', roughness: 0.35 }),
      stalk: new MeshStandardMaterial({ color: '#191919', roughness: 0.6 }),
      none: new BufferGeometry(),
    }),
    [],
  );
  const live = useRef({ active, size, deps, storePose, camera });
  live.current = { active, size, deps, storePose, camera };
  const cancel = useRef<(() => void) | null>(null);
  const proxy = useRef<Mesh>(null);
  const handle = useRef<Group>(null);
  const tools = useMemo(() => ({ ray: new Raycaster(), ndc: new Vector2(), a: new Vector3(), b: new Vector3() }), []);

  useEffect(
    () => () => {
      world.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [world, mats],
  );
  useEffect(() => {
    world.setDark(dark);
    invalidate();
  }, [world, dark, invalidate]);
  useEffect(() => {
    world.setPose(storePose);
    invalidate();
  }, [world, storePose, invalidate]);
  useEffect(() => world.bodies.setDevice(deps.device), [world, deps.device]);

  // ---- the bench and the selection drive what stands on the table
  useEffect(() => {
    world.bodies.onWake = invalidate;
    const sync = () => {
      world.bodies.sync();
      deps.select.keep((id) => id === DOT_ID || world.bodies.items.has(id));
    };
    const pick = () => {
      world.bodies.selected = deps.select.get();
      invalidate();
    };
    const range = () => world.bodies.showRange(deps.bus.dragKind);
    sync();
    pick();
    const offs = [deps.bench.subscribe(sync), deps.select.subscribe(pick), deps.bus.onDragKind(range), onPrintsRedrawn(invalidate)];
    return () => offs.forEach((o) => o());
  }, [world, deps.bench, deps.select, deps.bus, invalidate]);

  /** The point of the table under a client position. */
  const tablePoint = useCallback(
    (clientX: number, clientY: number, out: Vector3): boolean => {
      const r = gl.domElement.getBoundingClientRect();
      tools.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      tools.ray.setFromCamera(tools.ndc, live.current.camera);
      const { origin, direction } = tools.ray.ray;
      if (direction.y > -1e-4) return false;
      out.copy(direction).multiplyScalar(-origin.y / direction.y).add(origin);
      return true;
    },
    [gl, tools],
  );

  const placedAll = (): Placed[] => {
    const st = live.current.deps.bench.getState();
    const all: Placed[] = st.objects.map((o) => ({ id: o.id, kind: o.kind, pos: o.pos, rot: o.rot }));
    for (const [id, f] of Object.entries(st.fixtures)) all.push({ id, kind: id, pos: f.pos, rot: f.rot });
    return all;
  };
  const placedOf = (id: string): Placed | null => placedAll().find((p) => p.id === id && hasBody(p.kind)) ?? null;

  /** The card was dropped: in its range it goes into the slot, out of it it comes out. */
  const applyCard = () => {
    const f = live.current.deps.bench.getState().fixtures[SD_ID];
    const sd = (live.current.deps.device.areas as Record<string, unknown>).sd as SdAreaApi | undefined;
    if (!f || !sd) return;
    try {
      const want = isNear(SD_ID, f.pos, f.rot);
      const s = sd.state();
      if (want && !s.inserted) {
        sd.insert();
        sd.mount();
      } else if (!want && s.inserted) sd.eject();
    } catch {
      /* the Dot is off: the card just lies where it was put */
    }
  };

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

  // ---- things on the table
  const bodyOf = (e: { intersections: Intersection[] }): Pick | null => (e.intersections[0] as unknown as { body?: Pick } | undefined)?.body ?? null;

  const onBodyDown = (e: ThreeEvent<PointerEvent>) => {
    const hit = (e as unknown as { body?: Pick }).body ?? bodyOf(e);
    if (!hit) return;
    e.stopPropagation();
    const ne = e.nativeEvent;
    if (ne.pointerType === 'mouse' && ne.button !== 0) return cameraDrag(e, () => undefined);
    const { bench, select, runtime } = live.current.deps;
    const id = hit.id;

    // a button of the remote: pressing it sends, for as long as it is held
    if (hit.part) {
      select.only(id);
      const h = runtime.handle<IrRemoteHandle>(id);
      world.bodies.pressed = [id, hit.part];
      h?.down(hit.part);
      invalidate();
      watch(ne.pointerId, () => undefined, () => {
        h?.up();
        world.bodies.pressed = null;
        invalidate();
      });
      return;
    }

    const add = ne.shiftKey || ne.ctrlKey || ne.metaKey;
    if (add) {
      select.toggle(id);
      return;
    }
    const wasSelected = select.has(id);
    if (!wasSelected) select.only(id);
    const ids = (wasSelected ? [...select.get()] : [id]).filter((x) => x !== DOT_ID);
    const starts = ids.map(placedOf).filter((p): p is Placed => !!p).map((p) => ({ ...p, pos: { ...p.pos } }));
    const grab = new Vector3();
    if (!starts.length || !tablePoint(ne.clientX, ne.clientY, grab)) return;
    const moving = new Set(starts.map((s) => s.id));
    const obs = obstacles(placedAll(), moving);
    let x = ne.clientX, y = ne.clientY, travelled = 0, moved = false;
    const cur = new Vector3();
    watch(
      ne.pointerId,
      (ev) => {
        travelled += Math.abs(ev.clientX - x) + Math.abs(ev.clientY - y);
        x = ev.clientX;
        y = ev.clientY;
        if (!moved) {
          if (travelled < CLICK_SLOP_PX) return;
          moved = true;
          bench.checkpoint();
          world.bodies.dragging = moving;
          world.bodies.showRange(starts.find((s) => s.id === id)?.kind ?? starts[0].kind);
          gl.domElement.style.cursor = 'grabbing';
        }
        if (!tablePoint(ev.clientX, ev.clientY, cur)) return;
        const dx = cur.x - grab.x, dz = cur.z - grab.z;
        if (starts.length === 1) {
          const s = starts[0];
          const pos = settle(s.kind, { x: s.pos.x + dx, z: s.pos.z + dz }, s.rot, obs, !ev.altKey);
          if (pos) bench.moveMany([{ id: s.id, pos }]);
        } else {
          // several things keep their arrangement: the step is taken only when all of them have room
          const sx = ev.altKey ? dx : snap(dx), sz = ev.altKey ? dz : snap(dz);
          const moves = starts.map((s) => ({ id: s.id, pos: { x: s.pos.x + sx, z: s.pos.z + sz } }));
          const ok = moves.every((m, i) => {
            const c = clampToMat(starts[i].kind, m.pos, starts[i].rot);
            return c.x === m.pos.x && c.z === m.pos.z && isFree(starts[i].kind, m.pos, starts[i].rot, obs);
          });
          if (ok) bench.moveMany(moves);
        }
        invalidate();
      },
      (ev) => {
        world.bodies.dragging = NONE;
        world.bodies.showRange(live.current.deps.bus.dragKind);
        gl.domElement.style.cursor = '';
        if (moved) {
          if (moving.has(SD_ID)) applyCard();
        } else if (ev && wasSelected) select.only(id);
        invalidate();
      },
    );
  };
  const onBodyMove = (e: ThreeEvent<PointerEvent>) => {
    const hit = bodyOf(e);
    const id = hit?.id ?? null;
    if (world.bodies.hover !== id) {
      world.bodies.hover = id;
      invalidate();
    }
    if (!world.bodies.dragging.size) gl.domElement.style.cursor = hit ? (hit.part ? 'pointer' : 'grab') : '';
  };
  const onBodyOut = () => {
    if (world.bodies.hover) {
      world.bodies.hover = null;
      invalidate();
    }
    if (!world.bodies.dragging.size) gl.domElement.style.cursor = '';
  };

  const aspect = () => live.current.size.width / Math.max(1, live.current.size.height);
  const frameAll = () => world.rig.frame(world.contentRect(), world.contentHeight(), aspect(), { pol: (40 * Math.PI) / 180, az: 0 });
  const focusOn = (id: string) => {
    if (id === DOT_ID) return world.rig.focusDot(aspect());
    const p = placedOf(id);
    if (!p) return;
    const s = SIZES[p.kind];
    const r = Math.max(s.w, s.d) / 2 + 30;
    world.rig.frame({ x0: p.pos.x - r, x1: p.pos.x + r, z0: p.pos.z - r, z1: p.pos.z + r }, s.h, aspect(), { pol: (34 * Math.PI) / 180 });
  };
  const onBodyDouble = (e: ThreeEvent<MouseEvent>) => {
    const hit = bodyOf(e);
    if (!hit) return;
    e.stopPropagation();
    focusOn(hit.id);
    invalidate();
  };

  // ---- the tilt handle of the Dot
  const onHandleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const ne = e.nativeEvent;
    if (ne.pointerType === 'mouse' && ne.button !== 0) return;
    const start = { ...live.current.storePose };
    const x0 = ne.clientX, y0 = ne.clientY;
    live.current.deps.select.only(DOT_ID);
    live.current.deps.bench.checkpoint('tilt');
    gl.domElement.style.cursor = 'grabbing';
    watch(
      ne.pointerId,
      (ev) => {
        const dx = (ev.clientX - x0) * DEG_PER_PX, dy = (ev.clientY - y0) * DEG_PER_PX;
        const clampTo = (v: number, m: number) => Math.min(m, Math.max(-m, v));
        live.current.deps.applyPose(
          ev.shiftKey
            ? { ...start, heading: (((start.heading + dx) % 360) + 360) % 360 }
            : { pitch: clampTo(Math.round(start.pitch - dy), TILT_LIMIT.pitch), roll: clampTo(Math.round(start.roll + dx), TILT_LIMIT.roll), heading: start.heading },
        );
      },
      () => {
        gl.domElement.style.cursor = '';
      },
    );
  };
  const layFlat = (e?: ThreeEvent<MouseEvent>) => {
    e?.stopPropagation();
    live.current.deps.bench.checkpoint('tilt');
    live.current.deps.applyPose({ pitch: 0, roll: 0, heading: 0 });
  };

  // ---- what the device view needs
  const api = useMemo<WorldApi>(
    () => ({
      step: (dt, reduced) => {
        const busy = world.step(dt, reduced);
        const h = handle.current;
        if (h) {
          const p = world.shownPose();
          h.visible = live.current.active && (live.current.deps.select.has(DOT_ID) || Math.abs(p.pitch) > 0.5 || Math.abs(p.roll) > 0.5);
          h.position.copy(world.dotPos);
          h.quaternion.copy(world.dotQuat);
        }
        return busy;
      },
      camPos: world.rig.pos,
      camLook: world.rig.look,
      dotQuat: world.dotQuat,
      dotPos: world.dotPos,
      dotDown: (e) => cameraDrag(e, () => live.current.deps.select.only(DOT_ID)),
      dotDouble: () => {
        world.rig.focusDot(aspect());
        invalidate();
      },
    }),
    [world, invalidate], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    onApi(api);
    return () => onApi(null);
  }, [api, onApi]);

  // the first time the table is shown, everything on it is in the picture
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
        else if (c.type === 'focus') focusOn(c.id);
        else if (c.type === 'shake') world.rattle();
        invalidate();
      }),
    [deps.bus, world, invalidate], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- wheel, two-finger pinch and slide, no context menu (the right button slides the view), drops from the palette
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
    const isKind = (e: DragEvent) => !!e.dataTransfer?.types.includes(KIND_MIME);
    const over = (e: DragEvent) => {
      if (!isKind(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!isKind(e)) return;
      e.preventDefault();
      const kind = e.dataTransfer!.getData(KIND_MIME);
      const p = new Vector3();
      const { bench, select, nameFor, bus } = live.current.deps;
      bus.setDragKind(null);
      if (!getKind(kind) || !tablePoint(e.clientX, e.clientY, p)) return;
      bench.checkpoint();
      const obj = bench.add(kind, nameFor(kind), { x: p.x, z: p.z });
      if (obj) select.only(obj.id);
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', menu);
    el.addEventListener('dragover', over);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', menu);
      el.removeEventListener('dragover', over);
      el.removeEventListener('drop', drop);
      cancel.current?.();
      el.style.cursor = '';
    };
  }, [active, gl, world, invalidate, tablePoint]);

  // ---- keyboard: every drag has its keys
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const { bench, select, applyPose } = live.current.deps;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const ids = [...select.get()].filter((id) => id !== DOT_ID);
      const objects = select.objects();
      const done = () => {
        e.preventDefault();
        e.stopPropagation();
        invalidate();
      };
      if (mod && k === 'z') {
        if (e.shiftKey) bench.redo();
        else bench.undo();
        return done();
      }
      if (mod && k === 'y') {
        bench.redo();
        return done();
      }
      if (mod && k === 'a') {
        select.set([...world.bodies.items.keys()]);
        return done();
      }
      if (mod && k === 'd' && objects.length) {
        bench.checkpoint();
        const copies = objects.map((id) => bench.duplicate(id)?.id).filter((x): x is string => !!x);
        if (copies.length) select.set(copies);
        return done();
      }
      if (mod || (e.altKey && !k.startsWith('Arrow'))) return;
      if (k.startsWith('Arrow') && ownsArrowKeys(e.target)) return;
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dz = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      if (dx || dz) {
        if (e.altKey && select.has(DOT_ID)) {
          // tilt the Dot: up lifts its top edge, right dips its right side
          const p = live.current.storePose;
          bench.checkpoint('tilt');
          const c = (v: number, m: number) => Math.min(m, Math.max(-m, v));
          applyPose({ pitch: c(p.pitch - dz * 5, TILT_LIMIT.pitch), roll: c(p.roll + dx * 5, TILT_LIMIT.roll), heading: p.heading });
          return done();
        }
        if (!ids.length) return; // the arrows are the Dot's D-pad
        const step = GRID * (e.shiftKey ? 5 : 1);
        const moving = new Set(ids);
        const obs = obstacles(placedAll(), moving);
        const moves: { id: string; pos: Pos }[] = [];
        for (const id of ids) {
          const p = placedOf(id);
          if (!p) continue;
          const pos = { x: p.pos.x + dx * step, z: p.pos.z + dz * step };
          const c = clampToMat(p.kind, pos, p.rot);
          if (c.x !== pos.x || c.z !== pos.z || !isFree(p.kind, pos, p.rot, obs)) return done(); // no room: nothing moves
          moves.push({ id, pos });
        }
        bench.checkpoint('nudge');
        bench.moveMany(moves);
        if (moving.has(SD_ID)) applyCard();
        return done();
      }
      if (k === 'Escape' && select.get().size) {
        select.clear();
        return done();
      }
      if ((k === 'Delete' || k === 'Backspace') && objects.length) {
        bench.checkpoint();
        bench.removeMany(objects);
        return done();
      }
      if (k === 'r' && ids.length) {
        bench.checkpoint();
        bench.rotate(ids, e.shiftKey ? -1 : 1);
        return done();
      }
      if (k === 'n' && objects.length) {
        bench.checkpoint();
        for (const id of objects) {
          const o = bench.get(id);
          if (o && zoneOf(o.kind)) bench.setNear(id, !o.near);
        }
        return done();
      }
      if (k === 'f') {
        world.rig.focusDot(aspect());
        return done();
      }
      if (k === '0' || k === 'Home') {
        frameAll();
        return done();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, world, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- for the check scripts (?debug): where things are on the screen
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    const toClient = (v: Vector3) => {
      const r = gl.domElement.getBoundingClientRect();
      const p = v.clone().project(live.current.camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
    const w = window as unknown as Record<string, unknown>;
    w.__dotbenchWb = {
      world,
      /** Client position of a point of the table (mm). */
      table: (x: number, z: number, y = 0) => toClient(new Vector3(x, y, z)),
      /** Client position of the middle of a body's top (or of a remote's button). */
      body(id: string, part?: string) {
        const it = world.bodies.items.get(id);
        if (!it) return null;
        if (it.dock > 0.5) return toClient(new Vector3().setFromMatrixPosition(it.matrix));
        return toClient(new Vector3(it.x, SIZES[it.kind].h, it.z).add(part ? partOffset(it.kind, part, it.ry) : new Vector3()));
      },
      handle: () => toClient(world.handlePos.clone()),
      view: () => ({ ...world.rig.cur }),
      setView: (v: Partial<typeof world.rig.goal>, jump = true) => {
        Object.assign(world.rig.goal, v);
        if (jump) world.rig.jump();
        invalidate();
      },
      frameAll: () => {
        frameAll();
        world.rig.jump();
        invalidate();
      },
      focus: (id: string) => {
        focusOn(id);
        world.rig.jump();
        invalidate();
      },
      showRange: (kind: string | null) => world.bodies.showRange(kind),
      cardInserted: () => world.bodies.cardInserted,
      settled: () => [...world.bodies.items.values()].every((it) => Math.abs(it.x - it.tx) < 0.05 && Math.abs(it.z - it.tz) < 0.05 && Math.abs(it.dock - it.dockGoal) < 0.01),
    };
    return () => {
      delete w.__dotbenchWb;
    };
  }, [gl, world, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  const raycastBodies = useCallback(
    (raycaster: Raycaster, hits: Intersection[]) => {
      const p = world.bodies.pick(raycaster.ray);
      if (p && proxy.current) hits.push({ distance: p.distance, point: raycaster.ray.at(p.distance, new Vector3()), object: proxy.current, body: p } as unknown as Intersection);
    },
    [world],
  );

  return (
    <>
      <primitive object={world.group} />
      {/* the Dot's tilt handle: a ball off its top edge */}
      <group ref={handle} visible={false}>
        <mesh position={[0, D.hh + 7, D.zf - 1]} material={mats.stalk} raycast={() => null}>
          <cylinderGeometry args={[0.55, 0.55, 14, 8]} />
        </mesh>
        <mesh position={[0, D.hh + 15, D.zf - 1]} material={mats.ball} onPointerDown={onHandleDown} onDoubleClick={layFlat} name="tilt-handle">
          <sphereGeometry args={[4.4, 20, 14]} />
        </mesh>
      </group>
      {active && (
        <>
          {/* everything on the table answers through one pick */}
          <mesh ref={proxy} geometry={mats.none} material={mats.hit} raycast={raycastBodies} onPointerDown={onBodyDown} onPointerMove={onBodyMove} onPointerOut={onBodyOut} onDoubleClick={onBodyDouble} />
          {/* whatever is not the Dot or a thing on the table: the view */}
          <mesh material={mats.hit} onPointerDown={(e) => cameraDrag(e, () => deps.select.clear())}>
            <sphereGeometry args={[5000, 16, 10]} />
          </mesh>
        </>
      )}
    </>
  );
}

/** Offset of a named part from the middle of its body's top (for the check scripts). */
function partOffset(kind: string, part: string, ry: number): Vector3 {
  if (kind !== 'ir.remote') return new Vector3();
  const b = REMOTE[part];
  if (!b) return new Vector3();
  const c = Math.cos(ry), s = Math.sin(ry);
  return new Vector3(b.x * c + b.z * s, 0, -b.x * s + b.z * c);
}
