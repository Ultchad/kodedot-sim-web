// SPDX-License-Identifier: GPL-3.0-or-later
// Glue for the power area: one virtual battery behind the BQ25896 charger and CW2217 gauge.
// Default export: (ctx) => api, called at every boot (the battery state is C's, nothing is kept here).
//
// Defaults: 80 %, cable unplugged, 25 C, 90 mA load on battery. The cell voltage follows the
// SDK's own open-circuit table (kbsp_cell.h) with V = OCV + I * 180 mOhm, I into the cell positive.
//
// @typedef {"none"|"pre"|"fast"|"done"} ChargePhase
// @typedef {"none"|"usb"|"adapter"} Cable        usb = 500 mA host port, adapter = 3.25 A input
//
// API
//   level() -> 0..100          setLevel(pct)           state of charge (leaves any voltage override)
//   voltage() -> mV            setVoltage(mv|null)     terminal voltage / open-circuit override (null = curve)
//   ocv() -> mV                currentMa() -> mA       into the cell positive (charging > 0)
//   charging() -> ChargePhase  isCharging() -> bool    "pre" or "fast"
//   cable() -> Cable           plug(on, kind="usb")    kind: "usb" | "adapter"; plugging leaves ship mode
//   temperature() -> C         setTemperature(c)
//   setLoad(ma)                setSimSpeed(x)          x > 0: SoC drifts with the current at x times real time
//   shipped() -> bool          gaugeReady() -> bool
//   on(type, cb) -> unsubscribe
// Events (also dev.on("area:power:<type>")):
//   "ship"   {delayed, usb, delayMs, poweredOff}  BATFET_DIS was written: ship mode (poweredOff: board lost its supply)
//   "off"    {target:"asleep"|"off", usb, source}   the app asked kode_sys_power_off()/sleep (the SDK refuses it in this build)
//   "usb"    {plugged, cable}                       the cable changed
//   "charge" {phase}                                the charge phase changed
//   "level"  {level, voltage}                       the level moved by at least 1 %
//   "low"    {level}                                the level fell below 15 % (KODE_BATTERY_LOW_PCT); re-arms at 20 %
const G = { LEVEL: 0, VBAT: 1, CHARGING: 2, USB: 3, TEMP: 4, CURRENT: 5, SHIPPED: 6, CABLE: 7, VBUS: 8, LOAD: 9,
  OCV: 10, GAUGE_READY: 11, SIM: 12, OVR: 13 };
const PHASES = ["none", "pre", "fast", "done"];
const CABLES = ["none", "usb", "adapter"];
const TARGETS = ["awake", "asleep", "off"];

export default function (ctx) {
  const listeners = new Map();
  const fire = (type, data) => {
    ctx.emit(type, data);
    for (const cb of listeners.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } }
  };
  const on = (type, cb) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb);
    return () => listeners.get(type)?.delete(cb);
  };
  const get = (id) => ctx.call("power_get", id);
  const buf = ctx.alloc(16);
  let last = { phase: get(G.CHARGING), usb: get(G.CABLE), level: get(G.LEVEL) / 100, low: false };
  function poll() {
    for (let guard = 0; guard < 32 && ctx.call("power_event_pop", buf); guard++) {
      const v = new Int32Array(ctx.heap().buffer, buf, 4);
      if (v[0] === 1) fire("ship", { delayed: v[1] === 1, usb: v[2] === 1, delayMs: v[3], poweredOff: v[1] !== 1 && v[2] !== 1 });
      else if (v[0] === 2) fire("off", { target: TARGETS[v[1]] ?? String(v[1]), source: v[2], usb: v[3] === 1 });
    }
    const cable = get(G.CABLE);
    if (cable !== last.usb) { last.usb = cable; fire("usb", { plugged: cable !== 0, cable: CABLES[cable] }); }
    const ph = get(G.CHARGING);
    if (ph !== last.phase) { last.phase = ph; fire("charge", { phase: PHASES[ph] }); }
    const lv = get(G.LEVEL) / 100;
    if (Math.abs(lv - last.level) >= 1) { last.level = lv; fire("level", { level: lv, voltage: get(G.VBAT) }); }
    if (!last.low && lv < 15) { last.low = true; fire("low", { level: lv }); }
    else if (last.low && lv >= 20) last.low = false;
  }
  ctx.onTick(poll);
  return {
    level: () => get(G.LEVEL) / 100,
    setLevel: (pct) => { ctx.call("power_set_level", Number(pct)); poll(); },
    voltage: () => get(G.VBAT),
    ocv: () => get(G.OCV),
    setVoltage: (mv) => { ctx.call("power_set_voltage", mv == null ? 0 : Math.round(mv)); poll(); },
    currentMa: () => get(G.CURRENT),
    charging: () => PHASES[get(G.CHARGING)],
    isCharging: () => { const p = get(G.CHARGING); return p === 1 || p === 2; },
    cable: () => CABLES[get(G.CABLE)],
    plug: (on, kind = "usb") => { ctx.call("power_set_usb", on ? 1 : 0, kind === "adapter" ? 2 : 1); poll(); },
    temperature: () => get(G.TEMP) / 10,
    setTemperature: (c) => ctx.call("power_set_temp", Number(c)),
    setLoad: (ma) => ctx.call("power_set_load", Math.round(ma)),
    setSimSpeed: (x) => ctx.call("power_set_sim_speed", Number(x)),
    shipped: () => get(G.SHIPPED) === 1,
    gaugeReady: () => get(G.GAUGE_READY) === 1,
    poll,
    on,
  };
}
