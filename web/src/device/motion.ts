/** Hardware area "motion" (tilt + shake). First area wired through the registry. */

export interface MotionPose {
  /** Degrees, -90..90 (nose up positive). */
  pitch: number;
  /** Degrees, -180..180. */
  roll: number;
  /** Degrees, 0..360 (compass). */
  heading: number;
}

export interface MotionArea {
  /** Place the device in a pose, or `null` when no motion object is attached (reads as flat, zero). */
  setPose(pose: MotionPose | null): void;
  /** A shake gesture lasting `durationMs`. */
  shake(durationMs?: number): void;
}

declare module './types' {
  interface HardwareAreas {
    motion: MotionArea;
  }
}
