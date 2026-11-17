import type { MotionPose } from '../device/motion';
import { getKind } from './kinds';
import { MOTION_KIND } from './drivers/motion';
import type { BenchStore } from './store';

/**
 * Writes a pose into the object in use (creating one if there is none). Single entry point for the 3D tilt link and
 * the phone sensors.
 */
export function applyPoseToBench(bench: BenchStore, pose: MotionPose, defaultName: () => string): void {
  let obj = bench.activeIn('motion');
  if (!obj) {
    if (!getKind(MOTION_KIND)) return;
    obj = bench.add(MOTION_KIND, `${defaultName()} ${bench.countOf(MOTION_KIND) + 1}`);
    if (!obj) return;
    bench.setNear(obj.id, true);
  }
  bench.setFields(obj.id, { pitch: pose.pitch, roll: pose.roll, heading: pose.heading });
}
