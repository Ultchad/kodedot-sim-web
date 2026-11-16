import type { MotionPose } from '../device/motion';
import '../device/motion';
import { clampPose } from '../lib/pose';
import type { BenchObject, KindDef } from './model';

export const MOTION_KIND = 'motion.pose';

export const poseOf = (o: BenchObject): MotionPose => ({
  pitch: Number(o.fields.pitch) || 0,
  roll: Number(o.fields.roll) || 0,
  heading: Number(o.fields.heading) || 0,
});

export const motionKind: KindDef = {
  key: MOTION_KIND,
  area: 'motion',
  labelKey: 'kind.motion.pose',
  descKey: 'kind.motion.pose.desc',
  fields: [
    { key: 'pitch', labelKey: 'field.pitch', type: 'range', min: -90, max: 90, step: 1, unit: '°' },
    { key: 'roll', labelKey: 'field.roll', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'heading', labelKey: 'field.heading', type: 'range', min: 0, max: 360, step: 1, unit: '°' },
  ],
  defaults: { pitch: 0, roll: 0, heading: 0 },
  actions: [{ key: 'shake', labelKey: 'action.shake' }],
  sync(device, active) {
    device.areas.motion?.setPose(active ? clampPose(poseOf(active)) : null);
  },
  run(device, _obj, action) {
    if (action === 'shake') device.areas.motion?.shake();
  },
};
