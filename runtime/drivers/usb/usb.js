// SPDX-License-Identifier: GPL-3.0-or-later
// Glue for the usb area: the USB-C cable as the computer's side sees it. Default export (ctx) => api, called at every boot.
// The cable state lives in C (usb_cable.c) and is NOT kept across a restart of the program: the page (UsbComputer in
// runtime/web-adapter/usb-computer.js, or the bench runtime) plugs it again after each boot, like power's plug().
//
// API
//   plug(on, {host=true}) -> bool   on: cable in. host: a computer with its serial port open (VBUS as a USB host, 500 mA);
//                                   host=false: a plain charger (adapter input, no console peer). Returns false when the port is
//                                   taken by the power area's own charger object (unplug that one first). Plugging also moves
//                                   VBUS in the power area: charging starts, kode_power_is_usb_connected() turns true.
//   setHost(on)                     the computer opens/closes its serial port, cable stays in (flushes both rings)
//   plugged() host() up()           state; up = plugged && host
//   send(bytes|string) -> n         computer -> Dot (8192-byte RX ring; what does not fit is dropped silently, as the hardware does)
//   read() -> Uint8Array            drain what the Dot wrote to the cable
//   stats() -> {rxFree, txPending, rxDropped, txDropped, stalled}
//   on(type, cb) -> unsubscribe     "plug" {plugged, host}   "data" Uint8Array (also dev.on("area:usb:data"))
const G = { PLUGGED: 0, HOST: 1, RX_FREE: 2, TX_PENDING: 3, RX_DROPPED: 4, TX_DROPPED: 5, STALLED: 6, GEN: 7 };
export default function (ctx) {
  const listeners = new Map();
  const fire = (type, data) => { ctx.emit(type, data); for (const cb of listeners.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } } };
  const on = (type, cb) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(cb); return () => listeners.get(type)?.delete(cb); };
  const get = (id) => ctx.call("usb_get", id);
  const SZ = 4096, buf = ctx.alloc(SZ);
  let gen = get(G.GEN);
  const drain = () => {
    const parts = []; let n;
    while ((n = ctx.call("usb_recv", buf, SZ)) > 0) parts.push(ctx.heap().slice(buf, buf + n));
    if (!parts.length) return new Uint8Array(0);
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const poll = () => { const d = drain(); if (d.length) fire("data", d); };
  ctx.onTick(poll);
  return {
    plug(on_, { host = true } = {}) {
      const rc = ctx.call("usb_plug", on_ ? 1 : 0, host ? 1 : 0);
      if (rc !== 0) return false;
      if (get(G.GEN) !== gen) { gen = get(G.GEN); fire("plug", { plugged: get(G.PLUGGED) === 1, host: get(G.HOST) === 1 }); }
      return true;
    },
    setHost(on_) { ctx.call("usb_host", on_ ? 1 : 0); fire("plug", { plugged: get(G.PLUGGED) === 1, host: get(G.HOST) === 1 }); },
    plugged: () => get(G.PLUGGED) === 1,
    host: () => get(G.HOST) === 1,
    up: () => get(G.PLUGGED) === 1 && get(G.HOST) === 1,
    send(data) {
      const b = typeof data === "string" ? new TextEncoder().encode(data) : data;
      let sent = 0;
      while (sent < b.length) {
        const n = Math.min(SZ, b.length - sent);
        ctx.heap().set(b.subarray(sent, sent + n), buf);
        const took = ctx.call("usb_send", buf, n);
        sent += took;
        if (took < n) break;
      }
      return sent;
    },
    read: drain,
    stats: () => ({ rxFree: get(G.RX_FREE), txPending: get(G.TX_PENDING), rxDropped: get(G.RX_DROPPED), txDropped: get(G.TX_DROPPED), stalled: get(G.STALLED) === 1 }),
    on,
    poll,
  };
}
