// Page-side file API for the internal volume (/storage) and the microSD (/sdcard).
// Glue contract: default export (ctx) => api. Every call is synchronous and non-blocking: it takes the
// firmware's volume lock with a bounded try, and throws FsError(EBUSY) if the firmware held it throughout
// (retry). Safe while the firmware runs: each call is one FatFs operation under the same lock the firmware
// takes, so a page write can never tear a firmware write. It is NOT safe to rely on a file's content while
// the firmware has it open for writing (you read what has been flushed so far). The SD volume must be
// mounted by the firmware (sd_mount) or by sd.mount(); the internal volume mounts itself.
// Events (dev.on("area:storage:<type>")): "changed" {path, op} after every mutation made through this API.
//
//   list(path)                -> [{name, type: "file"|"dir", size}]
//   stat(path)                -> {exists, isDir, size}
//   read(path, {offset, length}) -> Uint8Array          readText(path) -> string
//   write(path, data, {append, offset}) -> bytes        (data: Uint8Array | ArrayBuffer | string; replaces the file by default;
//                                                        {offset} writes in place without truncating; {append} adds at the end)
//   truncate(path, size)  remove(path)  mkdir(path, {parents})  rename(from, to)
//   usage(vol) -> {total, free, used}   format(vol)   mounted(vol)       vol: "storage" | "sdcard"
// Emscripten/WASI errno numbers (what the firmware's errno holds), by name.
export const E = { EACCES: 2, EBADF: 8, EBUSY: 10, EEXIST: 20, EINVAL: 28, EIO: 29, EISDIR: 31, ENAMETOOLONG: 37, ENFILE: 41,
  ENODEV: 43, ENOENT: 44, ENOMEM: 48, ENOSPC: 51, ENOTDIR: 54, ENOTEMPTY: 55, EPERM: 63, EROFS: 69, EXDEV: 75 };
export const ERRNO = Object.fromEntries(Object.entries(E).map(([k, v]) => [v, k]));

export class FsError extends Error {
  constructor(errno, op, path) {
    const code = ERRNO[errno] ?? "E" + errno;
    super(`${op} ${path ?? ""}: ${code}`);
    this.name = "FsError"; this.errno = errno; this.code = code; this.op = op; this.path = path;
  }
}

const VOL = { storage: 0, sdcard: 1 };
const DATA = 1024;

export default function (ctx) {
  const scr = ctx.call("dbfs_scratch");
  const SCR = ctx.call("dbfs_scratch_size");
  const CH = SCR - DATA;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const H = () => ctx.heap();

  const putStr = (off, s) => {
    const b = enc.encode(s);
    if (b.length > 500) throw new FsError(E.ENAMETOOLONG, "path", s);        // ENAMETOOLONG
    H().set(b, scr + off); H()[scr + off + b.length] = 0;
  };
  const retry = (op, path, fn) => {
    for (let i = 0; i < 200; i++) {
      const r = fn();
      if (r !== -E.EBUSY) { if (r < 0) throw new FsError(-r, op, path); return r; }
    }
    throw new FsError(E.EBUSY, op, path);
  };
  const volOf = (v) => { if (!(v in VOL)) throw new FsError(E.EINVAL, "volume", String(v)); return VOL[v]; };
  const changed = (path, op) => ctx.emit("changed", { path, op });
  const toBytes = (d) => typeof d === "string" ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d);

  const api = {
    mounted: (vol) => !!ctx.call("dbfs_page_mounted", volOf(vol)),
    list(path) {
      putStr(0, path);
      const n = retry("list", path, () => ctx.call("dbfs_page_list"));
      const text = dec.decode(H().slice(scr + DATA, scr + DATA + n));
      return text.split("\n").filter(Boolean).map((l) => {
        const [t, size, ...name] = l.split("\t");
        return { name: name.join("\t"), type: t === "d" ? "dir" : "file", size: Number(size) };
      });
    },
    stat(path) {
      putStr(0, path);
      for (let i = 0; i < 200; i++) {
        const r = ctx.call("dbfs_page_stat");
        if (r === -E.EBUSY) continue;
        if (r === -E.ENOENT) return { exists: false, isDir: false, size: 0 };
        if (r < 0) throw new FsError(-r, "stat", path);
        return { exists: true, isDir: H()[scr + DATA] === 2, size: r };
      }
      throw new FsError(E.EBUSY, "stat", path);
    },
    read(path, { offset = 0, length = Infinity } = {}) {
      const st = api.stat(path);
      if (!st.exists) throw new FsError(E.ENOENT, "read", path);
      if (st.isDir) throw new FsError(E.EISDIR, "read", path);
      const total = Math.max(0, Math.min(length, st.size - offset));
      const out = new Uint8Array(total);
      for (let got = 0; got < total;) {
        putStr(0, path);
        const want = Math.min(CH, total - got);
        const n = retry("read", path, () => ctx.call("dbfs_page_read", offset + got, want));
        if (!n) break;
        out.set(H().subarray(scr + DATA, scr + DATA + n), got); got += n;
      }
      return out;
    },
    readText: (path) => dec.decode(api.read(path)),
    write(path, data, { append = false, offset } = {}) {
      const inplace = offset !== undefined;       // an explicit offset (even 0) writes in place; no offset replaces the file
      offset ??= 0;
      const b = toBytes(data);
      let done = 0;
      do {
        const n = Math.min(CH, b.length - done);
        H().set(b.subarray(done, done + n), scr + DATA);
        putStr(0, path);
        const first = done === 0;
        const flags = append ? 2 : (first && !inplace ? 1 : 0);
        retry("write", path, () => ctx.call("dbfs_page_write", append ? 0 : offset + done, n, flags));
        done += n;
      } while (done < b.length);
      changed(path, "write");
      return b.length;
    },
    truncate(path, size) { putStr(0, path); retry("truncate", path, () => ctx.call("dbfs_page_truncate", size)); changed(path, "truncate"); },
    remove(path) { putStr(0, path); retry("remove", path, () => ctx.call("dbfs_page_remove")); changed(path, "remove"); },
    mkdir(path, { parents = false } = {}) {
      if (parents) {
        const parts = path.split("/").filter(Boolean); let cur = "";
        for (const p of parts.slice(0, 1)) cur += "/" + p;              // the volume root exists
        for (const p of parts.slice(1)) {
          cur += "/" + p;
          const st = api.stat(cur);
          if (st.exists) { if (!st.isDir) throw new FsError(E.ENOTDIR, "mkdir", cur); continue; }
          putStr(0, cur); retry("mkdir", cur, () => ctx.call("dbfs_page_mkdir"));
        }
      } else { putStr(0, path); retry("mkdir", path, () => ctx.call("dbfs_page_mkdir")); }
      changed(path, "mkdir");
    },
    rename(from, to) { putStr(0, from); putStr(512, to); retry("rename", from, () => ctx.call("dbfs_page_rename")); changed(to, "rename"); },
    usage(vol) {
      const v = volOf(vol);
      const r = ctx.call("dbfs_page_usage", v);
      if (r < 0) throw new FsError(-r, "usage", vol);
      const u = new Uint32Array(H().slice(scr + DATA, scr + DATA + 16).buffer);
      const total = u[0] + u[1] * 2 ** 32, free = u[2] + u[3] * 2 ** 32;
      return { total, free, used: total - free };
    },
    format(vol) { const r = ctx.call("dbfs_page_format", volOf(vol)); if (r < 0) throw new FsError(-r, "format", vol); changed("/" + vol, "format"); },
  };
  return api;
}
