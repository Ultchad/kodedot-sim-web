import type { MotionPose } from '../device/motion';
import type { KodeDevice } from '../device/types';
import { KINDS, getKind } from './kinds';
import { MOTION_KIND } from './motion';
import type { BenchStore } from './store';

/** Pushes every area's active object to the device. Cheap and idempotent: call on any bench change. */
export function syncBench(device: KodeDevice, bench: BenchStore): void {
  for (const kind of KINDS) {
    if (!kind.sync) continue;
    const active = bench.activeIn(kind.area);
    kind.sync(device, active && active.kind === kind.key ? active : null);
  }
}

/**
 * Writes a pose into the active motion object (creating and activating one if
 * there is none). Single entry point for the 3D tilt link and the phone sensors.
 */
export function applyPoseToBench(bench: BenchStore, pose: MotionPose, defaultName: () => string): void {
  let obj = bench.activeIn('motion');
  if (!obj) {
    if (!getKind(MOTION_KIND)) return;
    obj = bench.add(MOTION_KIND, `${defaultName()} ${bench.countOf(MOTION_KIND) + 1}`);
    if (!obj) return;
    bench.bringNear(obj.id);
  }
  bench.setFields(obj.id, { pitch: pose.pitch, roll: pose.roll, heading: pose.heading });
}
