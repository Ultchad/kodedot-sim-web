import type { MotionPose } from '../../device/motion';
import '../../device/motion';
import { clampPose } from '../../lib/pose';
import type { BenchObject, KindDef } from '../model';
import type { AreaDriver, DriverCtx } from './types';

export const MOTION_KIND = 'motion.pose';

export const poseOf = (o: BenchObject): MotionPose => ({
  pitch: Number(o.fields.pitch) || 0,
  roll: Number(o.fields.roll) || 0,
  heading: Number(o.fields.heading) || 0,
});

export const motionKinds: KindDef[] = [
  {
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
    presence: { on: 'presence.inUse', off: 'presence.notInUse' },
    run(ctx, _obj, action) {
      if (action === 'shake') ctx.device.areas.motion?.shake?.();
    },
  },
];

interface MotionApi {
  setPose(p: MotionPose | null): void;
}

/** The Dot has one body: the object in use (the one that is near) decides the pose, none = flat. */
const apply = (api: MotionApi, ctx: DriverCtx) => {
  const active = ctx.nearIn('motion')[0];
  api.setPose(active ? clampPose(poseOf(active)) : null);
};

export const motionDriver: AreaDriver<MotionApi, true> = {
  area: 'motion',
  deviceArea: 'motion',
  events: [],
  sig: (o) => JSON.stringify(o.fields),
  create(api, _o, ctx) {
    apply(api, ctx);
    return true;
  },
  update(api, _h, _o, ctx) {
    apply(api, ctx);
  },
  remove(api, _h, _o, ctx) {
    apply(api, ctx);
  },
};
