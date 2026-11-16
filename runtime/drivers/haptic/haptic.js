// SPDX-License-Identifier: GPL-3.0-or-later
// Glue for the haptic area (AW86233 model). Default export: (ctx) => api, called at every boot.
//
// What the SDK plays: kdrv_aw86233 only uses RTP (streamed samples). There is no ROM effect or
// waveform id in this driver, so a "buzz" is described by its gain register byte, RTP rate,
// samples and duration. The firmware's drive is published as a normalised level 0..1, where 1.0
// is the strongest drive the SDK ever asks for (gain 80 % x sample peak 80 %), into the bridge
// field `haptic` (0..255, offset 0x58) and `haptic_seq`.
//
// @typedef {{type:"start", gain:number, rateHz:number, playMode:number}} HapticStart
// @typedef {{type:"stop", durationMs:number, samples:number, peak:number}} HapticStop
// Events (dev.on("area:haptic:<type>")): "start" {gain, rateHz, playMode}, "stop" {durationMs,
// samples, peak}, "level" {level} (emitted on change, polled every tick).
// API: level() -> 0..1, playing() -> bool, last() -> {durationMs, samples, peak, gain},
//      buzzes() -> count, standby() -> bool, rateHz() -> number,
//      on(type, cb) -> unsubscribe, vibrate(navigatorLike?) -> unsubscribe  (maps start/stop to
//      navigator.vibrate on phones), poll().
const OFF_HAPTIC = 0x58;
const G = { GAIN: 0, PLAYING: 1, LEVEL: 2, RATE: 3, BUZZES: 4, LAST_MS: 5, LAST_SAMPLES: 6, LAST_PEAK: 7,
  LAST_GAIN: 8, STANDBY: 9, PLAY_MODE: 10, FIFO: 11, OVERRUNS: 12 };

export default function (ctx) {
  const listeners = new Map();
  const fire = (type, data) => {
    ctx.emit(type, data);
    for (const cb of listeners.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } }
  };
  const buf = ctx.alloc(16);
  let lastLevel = -1;
  const get = (id) => ctx.call("haptic_get", id);
  const level = () => ctx.u32(OFF_HAPTIC) / 255;
  function poll() {
    ctx.call("haptic_poll");
    for (let guard = 0; guard < 32 && ctx.call("haptic_event_pop", buf); guard++) {
      const v = new Int32Array(ctx.heap().buffer, buf, 4);
      if (v[0] === 1) fire("start", { gain: v[1], rateHz: v[2], playMode: v[3] });
      else if (v[0] === 2) fire("stop", { durationMs: v[1], samples: v[2], peak: v[3] / 1000 });
    }
    const lv = level();
    if (lv !== lastLevel) { lastLevel = lv; fire("level", { level: lv }); }
  }
  function on(type, cb) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb);
    return () => listeners.get(type)?.delete(cb);
  }
  ctx.onTick(poll);
  return {
    level,
    playing: () => get(G.PLAYING) === 1,
    standby: () => get(G.STANDBY) === 1,
    rateHz: () => get(G.RATE),
    buzzes: () => get(G.BUZZES),
    last: () => ({ durationMs: get(G.LAST_MS), samples: get(G.LAST_SAMPLES), peak: get(G.LAST_PEAK) / 1000, gain: get(G.LAST_GAIN) }),
    poll,
    on,
    /** Call navigator.vibrate on start (buzz length unknown: a long pulse) and cancel it on stop. */
    vibrate(nav = globalThis.navigator) {
      if (!nav?.vibrate) return () => {};
      const a = on("start", () => nav.vibrate(2000));
      const b = on("stop", () => nav.vibrate(0));
      return () => { a(); b(); };
    },
  };
}
