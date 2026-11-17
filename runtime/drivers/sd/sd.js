// The virtual microSD card, from the page. Glue contract: default export (ctx) => api.
//   state()        -> {inserted, capacityMb, serial, writeProtect, generation, mounted}
//   insert()  eject()                 slot only: the card and its files are untouched. Inserting does NOT mount:
//                                     the firmware mounts (console `sd_mount`, or its boot probe), as on the board.
//   swap(mb, {format = true})         put in a different card: 2 MB .. 256 GB nominal (the page offers 4 MB .. 128 GB), FAT formatted
//                                     (default; MBR + FAT, formatted at its first mount) or blank. The old card's contents are gone.
//                                     Sparse: only blocks holding non-zero data are stored (see stats()).
//   stats()  -> {storedBytes, boundBytes, poolBytes, layout: "dense"|"sparse", known}   what the card really occupies in memory and in
//                                     the browser's storage, and the most real data it can hold before writes fail with an I/O error.
//                                     known is false until the firmware has touched the card since the device started.
//   setWriteProtect(bool)
//   mount() unmount()                 mount the FAT volume without the firmware's help (file API: storage glue, "/sdcard/..").
// Events (dev.on("area:sd:<type>")): "inserted", "removed", "card" {state}, "mounted", "unmounted".
// Pulled mid-write: the sector in flight is not written, earlier sectors are; the firmware sees EIO and the card
// is as consistent as a FAT is after a power cut (no journal). See docs/STATUS-persistence.md.
export default function (ctx) {
  const scr = ctx.call("dbfs_scratch");
  const read = () => {
    ctx.call("dbsd_page_state");
    const u = new Uint32Array(ctx.heap().slice(scr + 1024, scr + 1024 + 24).buffer);
    return { inserted: !!u[0], capacityMb: u[1], serial: u[2], writeProtect: !!u[3], generation: u[4], mounted: !!u[5] };
  };
  let last = read();
  const poll = () => {
    const s = read();
    if (s.inserted !== last.inserted) ctx.emit(s.inserted ? "inserted" : "removed", s);
    if (s.generation !== last.generation || s.capacityMb !== last.capacityMb || s.serial !== last.serial) ctx.emit("card", s);
    if (s.mounted !== last.mounted) ctx.emit(s.mounted ? "mounted" : "unmounted", s);
    last = s;
  };
  ctx.onTick(poll);
  const chk = (r, what) => { if (r < 0) throw new Error(`sd.${what} failed (errno ${-r}${{ 10: " EBUSY", 43: " ENODEV: no card, or no FAT volume on it", 28: " EINVAL", 29: " EIO" }[-r] ?? ""})`); return r; };
  return {
    state: read,
    stats() {
      ctx.call("dbsd_page_stats");
      const u = new Uint32Array(ctx.heap().slice(scr + 1024, scr + 1024 + 32).buffer);
      return { storedBytes: u[0] + u[1] * 4294967296, boundBytes: u[2] + u[3] * 4294967296, poolBytes: u[6], layout: u[4] === 1 ? "sparse" : "dense", known: !!u[5] };
    },
    insert() { chk(ctx.call("dbsd_page_set_inserted", 1), "insert"); poll(); },
    eject() { chk(ctx.call("dbsd_page_set_inserted", 0), "eject"); poll(); },
    swap(mb, { format = true } = {}) { chk(ctx.call("dbsd_page_new_card", mb, format ? 1 : 0), "swap"); poll(); },
    setWriteProtect(wp) { chk(ctx.call("dbsd_page_set_wp", wp ? 1 : 0), "setWriteProtect"); poll(); },
    mount() { chk(ctx.call("dbfs_page_sd_mount"), "mount"); poll(); },
    unmount() { ctx.call("dbfs_page_sd_unmount"); poll(); },
  };
}
