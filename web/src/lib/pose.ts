import type { MotionPose } from '../device/motion';

const DEG = Math.PI / 180;

export const ORBIT_LIMITS = { pitch: 80, roll: 180 } as const;

/**
 * Model orientation for a pose. Neutral (0,0,0) is the device upright, facing the viewer.
 *  pitch > 0: top edge tilts away from the viewer (rotation about X)
 *  roll  > 0: right edge moves away (rotation about Y)
 *  heading > 0: clockwise spin in the plane of the screen (rotation about Z)
 * Euler order 'YXZ' = Ry(roll) * Rx(pitch) * Rz(heading).
 */
export function poseToEuler(p: MotionPose): [number, number, number] {
  return [-p.pitch * DEG, p.roll * DEG, -p.heading * DEG];
}

export function wrapHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

export function clampPose(p: MotionPose, limits: { pitch: number; roll: number } = { pitch: 90, roll: 180 }): MotionPose {
  const c = (v: number, m: number) => Math.min(m, Math.max(-m, v));
  return { pitch: c(p.pitch, limits.pitch), roll: c(p.roll, limits.roll), heading: wrapHeading(p.heading) };
}

export const clampOrbit = (p: MotionPose) => clampPose(p, ORBIT_LIMITS);

export const samePose = (a: MotionPose, b: MotionPose, eps = 0.05) =>
  Math.abs(a.pitch - b.pitch) < eps && Math.abs(a.roll - b.roll) < eps && Math.abs(a.heading - b.heading) < eps;

export const ZERO_POSE: MotionPose = { pitch: 0, roll: 0, heading: 0 };
