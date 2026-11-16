// Device clock. The device's wall clock is the host clock plus an offset kept in the persistent region
// "dev-state" (so a clock set by the firmware or the page survives reset, power-off and a page reload).
// Zone: the firmware's own setting `config key="zone"` (a POSIX TZ string, in NVS), applied at boot by AO_Boot.
//   now() -> ms since epoch on the device      offsetMs()      set(msOrDate)      resetToHost()
//   zone() -> the stored zone string or null  (read from NVS, namespace "kapp", key "zone")
// Events: "set" {offsetMs}.
export default function (ctx) {
  return {
    offsetMs: () => ctx.call("kweb_time_offset_ms"),
    now: () => Date.now() + ctx.call("kweb_time_offset_ms"),
    set(t) { const ms = t instanceof Date ? t.getTime() : Number(t); ctx.call("kweb_time_set_offset_ms", ms - Date.now()); ctx.emit("set", { offsetMs: ms - Date.now() }); },
    resetToHost() { ctx.call("kweb_time_set_offset_ms", 0); ctx.emit("set", { offsetMs: 0 }); },
  };
}
