// The build tool refuses two areas that supersede the same SDK file, names both with their reasons, and does not mix roles.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const FILE = "components/kdrv/storage/src/kdrv_fs.c";
const load = (areas, role) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "areas-"));
  for (const [name, m] of Object.entries(areas)) {
    fs.mkdirSync(path.join(tmp, "runtime/drivers", name), { recursive: true });
    fs.writeFileSync(path.join(tmp, "runtime/drivers", name, "area.json"), JSON.stringify({ area: name, ...m }));
  }
  const r = spawnSync("python3", ["-I", "-c", "import sys; sys.path.insert(0, sys.argv[1]); from dblib import areas; a = areas.load_areas(sys.argv[2], role=sys.argv[3]); print(','.join(x.name for x in a))",
    path.join(root, "tools"), tmp, role], { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  return r;
};

await check("two areas of one role superseding one file: non-zero exit, both areas and both reasons named", () => {
  const r = load({ storage: { supersedes: { [FILE]: "FatFs on a region" } }, standin: { supersedes: { [FILE]: "in-memory stand-in" } } }, "app");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /superseded by two areas/);
  assert.match(r.stderr, /'storage'.*FatFs on a region/s);
  assert.match(r.stderr, /'standin'.*in-memory stand-in/s);
  assert.ok(r.stderr.includes(FILE));
  assert.match(r.stderr, /role 'app'/);
});
await check("the same pair in different roles is fine (a role-only stand-in is invisible to the other role)", () => {
  const areas = { storage: { supersedes: { [FILE]: "real" } }, standin: { roles: ["kodeos"], supersedes: { [FILE]: "stand-in" } } };
  const app = load(areas, "app");
  assert.equal(app.status, 0, app.stderr);
  assert.equal(app.stdout.trim(), "storage");
  const os_ = load(areas, "kodeos");
  assert.notEqual(os_.status, 0, "in the kodeos role both apply: that is the conflict the stand-in must resolve by being removed");
  assert.match(os_.stderr, /role 'kodeos'/);
});
await check("the repository's own areas have no conflict in either role", () => {
  for (const role of ["app", "kodeos"]) {
    const r = spawnSync("python3", ["-I", "-c", "import sys; sys.path.insert(0, sys.argv[1] + '/tools'); from dblib import areas; areas.load_areas(sys.argv[1], role=sys.argv[2])", root, role], { encoding: "utf8" });
    assert.equal(r.status, 0, role + ": " + r.stderr);
  }
});
console.log(failed ? "areas_conflict: FAILED" : "areas_conflict: PASSED");
process.exit(failed ? 1 : 0);
