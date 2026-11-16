// Settings / NVS from the page (glue contract: default export (ctx) => api). Calls the same code the firmware
// runs, under the same lock. Typed: "u8" | "u64" | "str" | "blob".
//   list()                       -> [{ns, key, type, size}]
//   get(ns, key)                 -> {type, value} | null     (u64 as BigInt, str as string, blob as Uint8Array)
//   set(ns, key, type, value)    erase(ns, key)    eraseNamespace(ns)    wipe()    usage() -> {usedPages, totalPages}
// Events: "changed" {ns, key, op}.
export default function (ctx) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const withStr = (s, f) => { const b = enc.encode(s + "\0"); const p = ctx.alloc(b.length); ctx.heap().set(b, p); try { return f(p); } finally { ctx.free(p); } };
  const TYPES = { 1: "u8", 2: "u64", 3: "str", 4: "blob" };
  const api = {
    list() {
      for (let cap = 8192; cap <= 1 << 20; cap *= 4) {
        const p = ctx.alloc(cap);
        try {
          const n = ctx.call("dbnvs_list", p, cap);
          if (n < cap - 100) return dec.decode(ctx.heap().slice(p, p + n)).split("\n").filter(Boolean).map((l) => { const [ns, key, type, size] = l.split("\t"); return { ns, key, type, size: +size }; });
        } finally { ctx.free(p); }
      }
      return [];
    },
    get(ns, key) {
      return withStr(ns, (pn) => withStr(key, (pk) => {
        const t = ctx.call("dbnvs_type", pn, pk);
        if (!t) return null;
        const cap = 1 << 16, p = ctx.alloc(cap);
        try {
          const n = ctx.call("dbnvs_get", pn, pk, p, cap);
          if (n < 0) return null;
          const bytes = ctx.heap().slice(p, p + n);
          const type = TYPES[t];
          if (type === "u8") return { type, value: bytes[0] };
          if (type === "u64") return { type, value: new DataView(bytes.buffer).getBigUint64(0, true) };
          if (type === "str") return { type, value: dec.decode(bytes) };
          return { type, value: bytes };
        } finally { ctx.free(p); }
      }));
    },
    set(ns, key, type, value) {
      const t = { u8: 1, u64: 2, str: 3, blob: 4 }[type];
      if (!t) throw new Error("nvs type " + type);
      let b;
      if (type === "u8") b = Uint8Array.of(Number(value) & 255);
      else if (type === "u64") { b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(value), true); }
      else if (type === "str") b = enc.encode(String(value));
      else b = value instanceof Uint8Array ? value : new Uint8Array(value);
      const r = withStr(ns, (pn) => withStr(key, (pk) => { const p = ctx.alloc(b.length || 1); ctx.heap().set(b, p); try { return ctx.call("dbnvs_set", pn, pk, t, p, b.length); } finally { ctx.free(p); } }));
      if (r < 0) throw new Error(`nvs set ${ns}/${key} refused`);
      ctx.emit("changed", { ns, key, op: "set" });
    },
    erase(ns, key) { withStr(ns, (pn) => withStr(key, (pk) => ctx.call("dbnvs_erase", pn, pk))); ctx.emit("changed", { ns, key, op: "erase" }); },
    eraseNamespace(ns) { withStr(ns, (pn) => ctx.call("dbnvs_erase_ns", pn)); ctx.emit("changed", { ns, key: null, op: "erase-ns" }); },
    wipe() { ctx.call("dbnvs_wipe"); ctx.emit("changed", { ns: null, key: null, op: "wipe" }); },
    usage() {
      const p = ctx.alloc(8);
      try { ctx.call("dbnvs_usage", p, p + 4); const u = new Uint32Array(ctx.heap().slice(p, p + 8).buffer); return { usedPages: u[0], totalPages: u[1] }; } finally { ctx.free(p); }
    },
  };
  return api;
}
