// SPDX-License-Identifier: GPL-3.0-or-later
// Glue for the motion area (QMI8658A + QMC5883P over one virtual orientation).
// Default export: (ctx) => api, called at every boot.
//
// Axes: the chips' axes are the board's axes (kbsp_board.h maps both with identity): x right,
// y toward the top of the Dot, z out of the glass. Accelerometer reads +1 g on the axis that
// points up (flat, face up: z = +1 g). pitch = atan2(-ax, sqrt(ay^2+az^2)),
// roll = atan2(ay, az) (what the SDK's imu example prints); heading = compass bearing of the
// top edge, clockwise from magnetic north (what kcompass_heading() computes).
//
// API (angles in degrees, ms durations):
//   setOrientation({pitch, roll, heading}, ms?)  ms omitted: duration scales with the change
//                                                (about 375 deg/s); 0 jumps. Partial objects keep the rest.
//   orientation() -> {pitch, roll, heading}  (where it is right now)
//   target() -> {pitch, roll, heading}       (where it is going)
//   moving() -> bool, shaking() -> bool
//   shake({peak=2.5, ms=400, hz=7, dir=[1,.6,.3]}?)  burst of acceleration in g
//   tap()  a short 40 ms 3 g spike along z (the SDK has no tap detection; documented)
//   setMagnet({x,y,z}) | setMagnet(null)     disturbance in mG on the board axes
//   setField(horizontalMg, downMg)           Earth's field (default 250 / 380 mG)
//   accel() -> {x,y,z} g, gyro() -> {x,y,z} deg/s, mag() -> {x,y,z} mG   ideal world values
//   config() -> what the driver programmed: {accelRangeG, gyroRangeDps, accelOdrHz, gyroOdrHz,
//                 accelOn, gyroOn, magOn, magRangeMg, magOdrHz}
//   on(type, cb) -> unsubscribe; events (dev.on("area:motion:<type>")): "orientation" {pitch,roll,heading}
//   (on each setOrientation), "shake" {peak,ms,hz}, "magnet" {x,y,z}.
const G = { PITCH: 0, ROLL: 1, HEADING: 2, MOVING: 3, SHAKING: 4, AX: 5, AY: 6, AZ: 7, GX: 8, GY: 9, GZ: 10,
  MX: 11, MY: 12, MZ: 13, ODR_A: 14, ODR_G: 15, FS_G: 16, FS_DPS: 17, MAG_RANGE: 18, MAG_ODR: 19, ON_BITS: 20,
  MAG_ON: 21, TP: 22, TR: 23, TH: 24 };

export default function (ctx) {
  const listeners = new Map();
  const fire = (type, data) => {
    ctx.emit(type, data);
    for (const cb of listeners.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } }
  };
  const get = (id) => ctx.call("motion_get", id);
  const orientation = () => ({ pitch: get(G.PITCH) / 100, roll: get(G.ROLL) / 100, heading: get(G.HEADING) / 100 });
  const target = () => ({ pitch: get(G.TP) / 100, roll: get(G.TR) / 100, heading: get(G.TH) / 100 });
  return {
    orientation, target,
    setOrientation(o, ms) {
      const t = target();
      const n = { pitch: o.pitch ?? t.pitch, roll: o.roll ?? t.roll, heading: o.heading ?? t.heading };
      ctx.call("motion_set_orientation", n.pitch, n.roll, n.heading, ms === undefined ? -1 : ms);
      fire("orientation", n);
    },
    moving: () => get(G.MOVING) === 1,
    shaking: () => get(G.SHAKING) === 1,
    shake(o = {}) {
      const { peak = 2.5, ms = 400, hz = 7, dir = [1, 0.6, 0.3] } = o;
      ctx.call("motion_shake", peak, ms, hz, dir[0], dir[1], dir[2]);
      fire("shake", { peak, ms, hz });
    },
    tap() { ctx.call("motion_shake", 3, 40, 12.5, 0, 0, 1); fire("shake", { peak: 3, ms: 40, hz: 12.5 }); },
    setMagnet(v) {
      const m = v ?? { x: 0, y: 0, z: 0 };
      ctx.call("motion_set_magnet", m.x ?? 0, m.y ?? 0, m.z ?? 0);
      fire("magnet", { x: m.x ?? 0, y: m.y ?? 0, z: m.z ?? 0 });
    },
    setField: (h, d) => ctx.call("motion_set_field", h, d),
    accel: () => ({ x: get(G.AX) / 1000, y: get(G.AY) / 1000, z: get(G.AZ) / 1000 }),
    gyro: () => ({ x: get(G.GX) / 1000, y: get(G.GY) / 1000, z: get(G.GZ) / 1000 }),
    mag: () => ({ x: get(G.MX), y: get(G.MY), z: get(G.MZ) }),
    config: () => ({
      accelRangeG: get(G.FS_G), gyroRangeDps: get(G.FS_DPS),
      accelOdrHz: get(G.ODR_A) / 100, gyroOdrHz: get(G.ODR_G) / 100,
      accelOn: (get(G.ON_BITS) & 1) === 1, gyroOn: (get(G.ON_BITS) & 2) === 2,
      magOn: get(G.MAG_ON) === 1, magRangeMg: get(G.MAG_RANGE), magOdrHz: get(G.MAG_ODR),
    }),
    on(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
      return () => listeners.get(type)?.delete(cb);
    },
  };
}
