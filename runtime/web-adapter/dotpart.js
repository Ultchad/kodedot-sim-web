// SPDX-License-Identifier: GPL-3.0-or-later
// .dotpart: read, limit-check and validate a component package (docs/component-api.md sections 3 and 8). Framework-free ES module,
// Node and browser. Nothing here instantiates anything: it is what an import dialog may run before the user says yes.
import SCHEMA from "./dotpart-schema.js";
import { readZip } from "./zip.js";

export const LIMITS = { entries: 64, totalBytes: 8 << 20, ratio: 100, manifest: 128 << 10, wasm: 2 << 20, picture: 1 << 20, model: 4 << 20, nameLen: 120 };
export const SCHEMA_ID = SCHEMA.$id;
const dec = new TextDecoder();

// ------------------------------------------------------------------------------ JSON Schema subset (draft 2020-12, what the manifest uses)
function resolve(root, ref) {
  if (!ref.startsWith("#/")) throw new Error("unsupported $ref " + ref);
  return ref.slice(2).split("/").reduce((o, k) => o[k], root);
}
const typeOk = (t, v) => t === "null" ? v === null : t === "array" ? Array.isArray(v) : t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v)
  : t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === t;

/** Validate `value` against `schema` (the manifest schema by default). Returns [{path, message}]. */
export function validateSchema(value, schema = SCHEMA, root = SCHEMA, path = "") {
  const errs = [];
  const err = (m, p = path) => errs.push({ path: p || "/", message: m });
  if (schema.$ref) return validateSchema(value, resolve(root, schema.$ref), root, path);
  if (schema.type !== undefined) {
    const ts = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!ts.some((t) => typeOk(t, value))) { err("must be " + ts.join(" or ") + ", got " + (Array.isArray(value) ? "array" : value === null ? "null" : typeof value)); return errs; }
  }
  if (schema.const !== undefined && value !== schema.const) err("must be " + JSON.stringify(schema.const));
  if (schema.enum && !schema.enum.includes(value)) err("must be one of " + schema.enum.map((x) => JSON.stringify(x)).join(", "));
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) err("is too short (min " + schema.minLength + ")");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err("is too long (max " + schema.maxLength + ")");
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) err("does not match " + schema.pattern);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) err("must be >= " + schema.minimum);
    if (schema.maximum !== undefined && value > schema.maximum) err("must be <= " + schema.maximum);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) err("must be > " + schema.exclusiveMinimum);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err("needs at least " + schema.minItems + " item(s)");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err("has too many items (max " + schema.maxItems + ")");
    if (schema.items) value.forEach((v, i) => errs.push(...validateSchema(v, schema.items, root, path + "/" + i)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) err('is missing "' + k + '"', path + "/" + k);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames) errs.push(...validateSchema(k, schema.propertyNames, root, path + "/" + k).map((e) => ({ ...e, message: "key " + e.message })));
      if (k in props) errs.push(...validateSchema(v, props[k], root, path + "/" + k));
      else if (schema.additionalProperties === false) err('unknown key "' + k + '"', path + "/" + k);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errs.push(...validateSchema(v, schema.additionalProperties, root, path + "/" + k));
    }
  }
  for (const s of schema.allOf ?? []) {
    if (s.if) {
      if (validateSchema(value, s.if, root, path).length === 0 && s.then) errs.push(...validateSchema(value, s.then, root, path));
    } else errs.push(...validateSchema(value, s, root, path));
  }
  if (schema.oneOf) {
    const tries = schema.oneOf.map((s) => validateSchema(value, s, root, path));
    const ok = tries.filter((t) => t.length === 0).length;
    if (ok === 0) {
      // report the closest alternative: fewest errors, ties broken by the one whose "type" const matched
      const idx = tries.map((t, i) => [t.length, i]).sort((a, b) => a[0] - b[0])[0][1];
      errs.push(...tries[idx]);
    } else if (ok > 1) err("matches more than one alternative");
  }
  return errs;
}

// ------------------------------------------------------------------------------ SVG safety (docs 8.2)
export function checkSvg(text) {
  const bad = [];
  if (/<\s*script/i.test(text)) bad.push("contains <script>");
  if (/<\s*foreignObject/i.test(text)) bad.push("contains <foreignObject>");
  if (/\son[a-z]+\s*=/i.test(text)) bad.push("contains an on*= event attribute");
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) bad.push("declares entities");
  if (/(?:xlink:)?href\s*=\s*["']\s*(?!#)[^"']/i.test(text)) bad.push("has an href that is not a local #fragment");
  if (/url\(\s*["']?\s*(?!#)(?:https?:|\/\/|data:)/i.test(text)) bad.push("has a url() that is not a local #fragment");
  if (/@import/i.test(text)) bad.push("uses @import");
  return bad;
}

// ------------------------------------------------------------------------------ wasm allow-list (docs 5.9.3 and 8.1)
export const ABI1_IMPORTS = new Set(["time_us", "wait_until_us", "yield", "pin_mode", "pin_write", "pin_read", "pin_irq", "pwm", "adc_mv", "dac_mv", "uart_begin",
  "uart_write", "i2c_master_begin", "i2c_xfer", "i2c_slave_begin", "spi_begin", "spi_xfer", "field_f64", "field_bytes", "output_f64", "nvs_get", "nvs_set", "log"]);
export const ABI1_EXPORTS = new Set(["_initialize", "dp_start", "dp_scratch", "dp_i2c_slave_event", "dp_pin_event", "dp_uart_rx", "dp_spi_slave_event", "dp_wireless_request",
  "memory", "__indirect_function_table"]);
/** Check a compiled module's imports and exports against ABI 1. Returns [message]. */
export function checkWasmModule(mod) {
  const bad = [];
  for (const i of WebAssembly.Module.imports(mod)) {
    if (i.module !== "dotbench") bad.push(`imports ${i.module}.${i.name}: only the dotbench module is allowed`);
    else if (i.kind !== "function") bad.push(`imports a ${i.kind} (${i.name}): only functions are allowed`);
    else if (!ABI1_IMPORTS.has(i.name)) bad.push(`imports dotbench.${i.name}, which is not in ABI 1`);
  }
  for (const e of WebAssembly.Module.exports(mod)) if (!ABI1_EXPORTS.has(e.name)) bad.push(`exports ${e.name}, which is not in ABI 1`);
  return bad;
}

// ------------------------------------------------------------------------------ semantic lint (what `dotbench part check` adds to the schema)
const ELEM_PIN_KEYS = { switch: ["a", "b"], bridge: ["a", "b"], divider: ["top", "bottom", "wiper"], source: ["pin"], drive: ["pin"], i2c_slave: ["sda", "scl"],
  h_bridge: ["in1", "in2", "enable"], servo: ["pin"], led: ["anode", "cathode"], buzzer: ["pin", "ref"] };
/** Cross references and bounds. Returns {errors:[{path,message}], warnings:[{path,message}]} (schema errors are NOT repeated here). */
export function lintManifest(m, files = null, opts = {}) {
  const errors = [], warnings = [];
  const E = (path, message) => errors.push({ path, message }), Wn = (path, message) => warnings.push({ path, message });
  const pins = new Map(), fields = new Map(), outputs = new Set();
  const pic = m.picture ?? { width: 0, height: 0 };
  (m.pins ?? []).forEach((p, i) => {
    if (pins.has(p.name)) E(`/pins/${i}/name`, `duplicate pin name ${p.name}`);
    pins.set(p.name, p);
    if (p.pos && (p.pos.x > pic.width || p.pos.y > pic.height)) E(`/pins/${i}/pos`, `${p.name} at (${p.pos.x}, ${p.pos.y}) is outside the ${pic.width}x${pic.height} picture`);
    if (p.pull_rail && !pins.has(p.pull_rail) && !(m.pins ?? []).some((q) => q.name === p.pull_rail)) E(`/pins/${i}/pull_rail`, `pull_rail ${p.pull_rail} is not a pin of this part`);
  });
  const gpios = new Map();
  (m.pins ?? []).forEach((p, i) => { if (p.gpio !== undefined) { if (gpios.has(p.gpio)) E(`/pins/${i}/gpio`, `gpio ${p.gpio} is used by ${gpios.get(p.gpio)} and ${p.name}`); gpios.set(p.gpio, p.name); } });
  (m.fields ?? []).forEach((f, i) => { if (fields.has(f.name)) E(`/fields/${i}/name`, `duplicate field ${f.name}`); fields.set(f.name, f);
    if (f.type === "enum" && !f.values.some((v) => v.value === f.default)) E(`/fields/${i}/default`, `default is not one of the values`);
    if ((f.type === "number" || f.type === "integer") && ((f.min !== undefined && f.default < f.min) || (f.max !== undefined && f.default > f.max))) E(`/fields/${i}/default`, `default is outside min..max`); });
  (m.outputs ?? []).forEach((o, i) => { if (outputs.has(o.name)) E(`/outputs/${i}/name`, `duplicate output ${o.name}`); outputs.add(o.name); });
  (m.controls ?? []).forEach((c, i) => { if (!fields.has(c.field)) E(`/controls/${i}/field`, `unknown field ${c.field}`);
    if (c.region && (c.region.x + c.region.w > pic.width || c.region.y + c.region.h > pic.height)) Wn(`/controls/${i}/region`, "region reaches outside the picture"); });
  const ids = new Set();
  (m.visuals ?? []).forEach((v, i) => {
    if (ids.has(v.id)) E(`/visuals/${i}/id`, `duplicate visual id ${v.id}`); ids.add(v.id);
    const s = v.source ?? {};
    if (s.pin !== undefined && !pins.has(s.pin)) E(`/visuals/${i}/source/pin`, `unknown pin ${s.pin}`);
    if (s.output !== undefined && !outputs.has(s.output)) E(`/visuals/${i}/source/output`, `unknown output ${s.output}`);
    if (s.field !== undefined && !fields.has(s.field)) E(`/visuals/${i}/source/field`, `unknown field ${s.field}`);
    if (s.gpio !== undefined && m.behaviour?.type !== "wasm") Wn(`/visuals/${i}/source/gpio`, "a gpio source only means something for wasm parts");
  });
  const b = m.behaviour ?? {};
  if (b.type === "declarative") {
    (b.elements ?? []).forEach((el, i) => {
      for (const k of ELEM_PIN_KEYS[el.type] ?? []) if (el[k] !== undefined && !pins.has(el[k])) E(`/behaviour/elements/${i}/${k}`, `unknown pin ${el[k]}`);
      if (el.output !== undefined && !outputs.has(el.output)) E(`/behaviour/elements/${i}/output`, `unknown output ${el.output}`);
      const walk = (x, p) => { if (x && typeof x === "object") { if (typeof x.field === "string" && !fields.has(x.field)) E(p + "/field", `unknown field ${x.field}`); for (const [k, v] of Object.entries(x)) if (k !== "field") walk(v, p + "/" + k); } };
      for (const [k, v] of Object.entries(el)) if (typeof v === "object") walk(v, `/behaviour/elements/${i}/${k}`);
      if (el.type === "wireless" && !(m.wireless ?? []).some((w) => w.name === el.port)) E(`/behaviour/elements/${i}/port`, `unknown wireless port ${el.port}`);
    });
  } else if (b.type === "wasm") {
    if (files && !files.has(b.entry)) E("/behaviour/entry", `${b.entry} is not in the package`);
    if (!(m.pins ?? []).some((p) => p.kind === "power_in")) Wn("/pins", "a programmable part normally has a power_in pin (3V3)");
  }
  if (!(m.pins ?? []).some((p) => p.kind === "ground") && (m.pins ?? []).some((p) => p.kind === "power_in")) Wn("/pins", "a part with a power_in pin needs a ground pin or it can never power on");
  for (const key of ["name", "description"]) for (const loc of ["pt-BR", "es"]) if (m[key] && !m[key][loc]) Wn("/" + key, `missing ${loc} translation`);
  if (files && m.picture?.file && !files.has(m.picture.file)) E("/picture/file", `${m.picture.file} is not in the package`);
  if (m.id?.startsWith("dotbench.") && !opts.builtin) Wn("/id", "the dotbench. prefix is reserved for built-in parts");
  return { errors, warnings };
}

/** Schema + lint. */
export function validateManifest(m, files = null, opts = {}) {
  const schemaErrors = validateSchema(m);
  if (schemaErrors.length) return { errors: schemaErrors, warnings: [] };
  return lintManifest(m, files, opts);
}

// ------------------------------------------------------------------------------ container
const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true);
/** Look at the central directory only (nothing is inflated): [{name, method, csize, usize}] or throws on a violation of docs 3.1. */
export function scanZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = u16(view, eocd + 10);
  if (count > LIMITS.entries) throw new Error(`too many entries (${count}, max ${LIMITS.entries})`);
  let p = u32(view, eocd + 16), total = 0;
  const out = [];
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const flags = u16(view, p + 8), method = u16(view, p + 10), csize = u32(view, p + 20), usize = u32(view, p + 24);
    const nl = u16(view, p + 28), xl = u16(view, p + 30), cl = u16(view, p + 32), attr = u32(view, p + 38);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    if (flags & 1) throw new Error(`${name}: encrypted entries are not allowed`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new Error("ZIP64 is not allowed");
    if (((attr >>> 16) & 0xf000) === 0xa000) throw new Error(`${name}: symlinks are not allowed`);
    if (!name.endsWith("/")) {
      if (!/^[A-Za-z0-9._/-]{1,120}$/.test(name) || name.startsWith("/") || name.split("/").includes("..")) throw new Error(`bad file name ${JSON.stringify(name)}`);
      if (usize > csize * LIMITS.ratio + 1024) throw new Error(`${name}: inflate ratio over ${LIMITS.ratio}:1`);
      total += usize;
      out.push({ name, method, csize, usize });
    }
    p += 46 + nl + xl + cl;
  }
  if (total > LIMITS.totalBytes) throw new Error(`too big when unpacked (${total} bytes, max ${LIMITS.totalBytes})`);
  return out;
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Read a .dotpart. Throws on a package violation (path, size, ratio, missing manifest). Everything else is reported:
 * returns {manifest, files, bytes, sha256, picture:{file,mime,bytes}, wasm:Uint8Array|null, errors, warnings, ok}.
 */
export async function readDotpart(data, opts = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = scanZip(bytes);
  const files = await readZip(bytes);
  const mf = files.get("manifest.json");
  if (!mf) throw new Error("the package has no manifest.json");
  if (mf.length > LIMITS.manifest) throw new Error("manifest.json is too big");
  let manifest;
  try { manifest = JSON.parse(dec.decode(mf)); } catch (e) { throw new Error("manifest.json is not valid JSON: " + e.message); }
  const { errors, warnings } = validateManifest(manifest, files, opts);
  const picFile = manifest.picture?.file;
  const pic = picFile ? files.get(picFile) : null;
  if (pic) {
    if (pic.length > LIMITS.picture) errors.push({ path: "/picture/file", message: "picture is over 1 MB" });
    if (picFile.endsWith(".svg")) for (const why of checkSvg(dec.decode(pic))) errors.push({ path: "/picture/file", message: "picture " + why });
  }
  let wasm = null;
  const b = manifest.behaviour;
  if (b?.type === "wasm" && files.has(b.entry)) {
    wasm = files.get(b.entry);
    if (wasm.length > LIMITS.wasm) errors.push({ path: "/behaviour/entry", message: "wasm is over 2 MB" });
    else {
      try { for (const m of checkWasmModule(await WebAssembly.compile(wasm))) errors.push({ path: "/behaviour/entry", message: m }); }
      catch (e) { errors.push({ path: "/behaviour/entry", message: "not a valid WebAssembly module: " + e.message }); }
    }
  }
  const mime = !picFile ? null : picFile.endsWith(".svg") ? "image/svg+xml" : picFile.endsWith(".png") ? "image/png" : "image/webp";
  return { manifest, files, bytes, sha256: await sha256Hex(bytes), entries, picture: pic ? { file: picFile, mime, bytes: pic } : null, wasm, errors, warnings, ok: errors.length === 0 };
}

/** What the import dialog shows (docs 8.3), as data. */
export function describeDotpart(def) {
  const m = def.manifest, b = m.behaviour;
  return {
    id: m.id, version: m.version, names: m.name, author: m.author, license: m.license, size: def.bytes.length, sha256: def.sha256,
    runs: b.type === "wasm" ? { kind: "code", wasmBytes: def.wasm?.length ?? 0, memoryKb: b.memory_kb ?? 1024, sources: def.files.has("src/main.ino") || (b.sources ?? []).length > 0 } : { kind: "declarative", elements: b.elements.length },
    pins: m.pins.map((p) => ({ name: p.name, kind: p.kind, min_mv: p.min_mv, max_mv: p.max_mv })),
    buses: b.type === "wasm" ? ["i2c", "spi", "uart", "pwm", "adc", "gpio"] : b.elements.filter((e) => e.type === "i2c_slave").length ? ["i2c"] : [],
    wireless: m.wireless ?? [], fields: (m.fields ?? []).length, cannot: ["use the network", "read your files", "touch other parts or the device except through wires you draw"],
    errors: def.errors, warnings: def.warnings,
  };
}
