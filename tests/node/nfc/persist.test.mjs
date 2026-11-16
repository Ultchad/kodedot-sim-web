// The NFC bench store is a dbp region ("nfc"): a tag made by the page reaches the durable backend through the dirty-chunk flush
// WITHOUT a stop, and is still there after a stop + new boot over the same store (what the page's IndexedDB does across a reload).
import assert from "node:assert/strict";
import nfcGlue from "../../../runtime/drivers/nfc/nfc.js";
import { Bench, RESET, pkgPath, glueCtx } from "../persist/host.mjs";

let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); } };
const nfcOf = (run) => nfcGlue(glueCtx(run.M));

await check("an NFC tag made by the page is flushed as dirty chunks (no stop), and survives a stop and a new boot", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("nfc_api"), { reason: RESET.POWERON });
  await run.waitFor(() => run.logText().includes("nfc_api ready"), 45000, "nfc_api ready");
  const nfc = nfcOf(run);
  nfc.tag({ uid: "04:12:34:56:78:9A:BC", text: "kept in a region", near: false });
  assert.equal(nfc.objects().length, 1);
  await bench.pm.flush();
  const stored = await bench.backend.load();
  const r = stored?.regions?.nfc;
  assert.ok(r && r.chunks.size > 0, "the nfc region reached the backend through flush(): " + JSON.stringify(Object.keys(stored?.regions ?? {})));
  await run.stop();

  run = await bench.boot(pkgPath("nfc_api"), { reason: RESET.POWERON });
  await run.waitFor(() => run.logText().includes("nfc_api ready"), 45000, "nfc_api ready 2");
  const again = nfcOf(run);
  const os = again.objects();
  assert.equal(os.length, 1, "the tag is still a bench object");
  assert.equal(os[0].content().text, "kept in a region");
  await run.stop();
});

console.log(failed ? "nfc persist: FAILED" : "nfc persist: PASSED");
process.exit(failed ? 1 : 0);
