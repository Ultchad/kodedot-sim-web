// guardExports (dotbench-device.js): the host's calls into a module swallow Emscripten's ExitStatus and nothing else.
import assert from "node:assert/strict";
import { guardExports, isExitStatus } from "../../../runtime/web-adapter/dotbench-device.js";
let failed = false;
const check = (name, fn) => { try { fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
class ExitStatus { name = "ExitStatus"; constructor(status) { this.message = `Program terminated with exit(${status})`; this.status = status; } }   // as Emscripten emits it
const M = {
  _ok: (a, b) => a + b,
  _exits: () => { throw new ExitStatus(0); },
  _boom: () => { throw new Error("real failure"); },
  _strange: () => { throw "unwind"; },
  __internal: () => { throw new ExitStatus(1); },
  notExport: () => { throw new ExitStatus(2); },
  callMain: () => 1,
};
const seen = [];
guardExports(M, (s) => seen.push(s));
check("an ExitStatus thrown inside a wasm call is swallowed and recorded", () => { assert.equal(M._exits(), 0); assert.deepEqual(seen, [0]); });
check("results and arguments pass through", () => assert.equal(M._ok(2, 3), 5));
check("every other exception is rethrown", () => { assert.throws(() => M._boom(), /real failure/); assert.throws(() => M._strange(), (e) => e === "unwind"); });
check("only the host-called exports (_name) are wrapped, internals (__x) and other members are not", () => {
  assert.throws(() => M.__internal(), (e) => isExitStatus(e));
  assert.throws(() => M.notExport(), (e) => isExitStatus(e));
});
check("isExitStatus: the Emscripten object only", () => {
  assert.ok(isExitStatus(new ExitStatus(3)));
  assert.ok(!isExitStatus(new Error("ExitStatus")) && !isExitStatus("ExitStatus") && !isExitStatus(null) && !isExitStatus({ name: "ExitStatus" }));
});
check("wrapping twice does not stack wrappers", () => { const f = M._ok; guardExports(M); assert.equal(M._ok, f); });
process.exit(failed ? 1 : 0);
