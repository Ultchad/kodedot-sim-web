// Radio core: the faked ESP32-C5 behind the SDK's real kdrv_radio / kdrv_c5 / kdrv_c5svc / AO_Radio.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { bootRadio, check, done, sleep } from "./bench.mjs";

// ---- 1. no glue: the radio is absent, nothing crashes ----
{
  const a = await bootRadio("network", { attach: false });
  const r = await a.cmd("radio_up");
  check(r.ok, "radio_up is accepted with no radio glue");
  await a.waitLog(/esp_hosted_init: ESP_ERR_TIMEOUT|connect_to_slave|link/i, 8000);
  await sleep(300);
  const info = await a.cmd("radio_info");
  check(info.ok && !/link=up/.test(info.lines.join()), "radio_info does not claim a link with no glue", info.lines);
  check(!/PANIC|abort\(|assertion failed/i.test(a.logText()), "no crash with the radio absent");
  a.button(4, true); await sleep(60); a.button(4, false); await sleep(200);
  check(/network up/.test(a.logText()) && !a.restartRequested(), "the app is alive and was not restarted");
  a.shutdown();
}

// ---- 2. the link comes up, version, identity, services ----
const a = await bootRadio("network");
let m = a.mark();
await a.cmd("radio_up");
await a.waitLog(/link up; esp-hosted v2\.12\.9/, 8000, m);
await a.waitLog(/KODE services v3, 0 networks, 0 BLE keys, identity 0x00/, 8000, m);
check(a.radio.state().link === "up" && a.radio.state().usable, "the world reports the link up");
check(/esp32c5, esp-hosted 2\.12\.9, project kode_c5, SDIO 4-bit @40000kHz/.test(a.logText()), "kdrv_c5 reads chip, version, project and the SDIO description");
check(/this board is KODE-.* \(from its C5 68:67:25:c5:00:01\)/.test(a.logText()), "the unit's name is derived from the C5's MAC");
const info = await a.cmd("radio_info");
check(/link=up fw=2\.12\.9/.test(info.lines.join()), "radio_info: link up, firmware 2.12.9", info.lines);
const c5 = await a.cmd("c5"); await sleep(200);
check(/chip_id=23 fw_major=2 fw_minor=12 fw_patch=9/.test(a.logText()) && /reset_reason=1/.test(a.logText()), "c5: chip id 23 (ESP32-C5), plausible version, reset reason power-on");

// firmware version is settable from the bench
a.radio.setFirmware(2, 13, 1);
await a.cmd("radio_down"); await sleep(600);
m = a.mark();
await a.cmd("radio_up");
await a.waitLog(/link up; esp-hosted v2\.13\.1/, 8000, m);
check(true, "a firmware version set on the bench is what the SDK reports after the next link-up");
a.radio.setFirmware(2, 12, 9);

// identity: a real P-256 key, a real CSR, real signatures
// AO_Radio is still starting Bluetooth for a moment after a link-up and answers identity commands only once that is done: ask again until it
// answers (the real condition), instead of one fixed sleep that is too long on a quiet machine and too short on a loaded one.
const getCsr = async () => {
  const mk = a.mark();
  for (let i = 0; i < 5 && !/csr part=/.test(a.logText().slice(mk)); i++) {
    await a.cmd("ident_csr");
    try { await a.waitLog(/csr part=(\d+) of=\1 /, 3000, mk); } catch { /* not served yet: ask again */ }
  }
  await a.waitLog(/csr part=(\d+) of=\1 /, 3000, mk);
  return Buffer.concat([...a.logText().slice(mk).matchAll(/csr part=\d+ of=\d+ der="([^"]+)"/g)].map((x) => Buffer.from(x[1], "base64")));
};
const der = await getCsr();
fs.writeFileSync("/tmp/radio-test.csr", der);
let csrOk = false;
try { execFileSync("openssl", ["req", "-inform", "DER", "-in", "/tmp/radio-test.csr", "-verify", "-noout"], { stdio: "pipe" }); csrOk = true; } catch (e) { console.log(String(e.stderr)); }
check(csrOk, "ident_csr returns a PKCS#10 request that openssl verifies");
check((await a.cmd("id_sign nonce=\"abc\"")).err !== null, "id_sign before a certificate is refused");
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", "/CN=t", "-days", "1", "-outform", "DER", "-keyout", "/tmp/radio-test.key", "-out", "/tmp/radio-test.cert"], { stdio: "pipe" });
const cert = fs.readFileSync("/tmp/radio-test.cert").toString("base64");
const parts = cert.match(/.{1,192}/g);
let cs;
for (let i = 0; i < parts.length; i++) cs = await a.cmd(`ident_cert part=${i + 1} of=${parts.length} der="${parts[i]}"`);
check(cs.ok, "ident_cert stores a certificate (sent in console-sized parts)", cs);
const msig = a.mark();
await a.cmd("id_sign nonce=\"nonce-1.x_y\"");
await a.waitLog(/sig/, 6000, msig);
const sline = a.logText().slice(msig);
const sigB64 = /sig der="([^"]+)"/.exec(sline);
let sigOk = false;
if (sigB64) sigOk = crypto.verify("sha256", Buffer.from("nonce-1.x_y"), { key: a.radio.identity.spki ? crypto.createPublicKey({ key: Buffer.from(a.radio.identity.spki), format: "der", type: "spki" }) : null, dsaEncoding: "der" }, Buffer.from(sigB64[1], "base64"));
check(sigOk, "id_sign signs the nonce with the key the CSR was made for (ECDSA P-256, DER)", sline.slice(0, 200));
check((await a.cmd("id_sign nonce=\"bad nonce!\"")).err !== null, "a nonce outside the alphabet is refused");
check((await a.cmd("ident_lock confirm=on")).ok, "ident_lock");
{ const mk = a.mark(); await a.cmd("ident_csr"); await sleep(600); check(!/csr part=/.test(a.logText().slice(mk)), "a locked identity gives no CSR (KODE_ST_LOCKED)"); }
check(a.radio.identity.locked && /identity 0x07/.test((await (async () => { await a.cmd("radio_down"); await sleep(500); const mm = a.mark(); await a.cmd("radio_up"); await a.waitLog(/identity 0x\d+/, 8000, mm); return a.logText().slice(mm); })())), "identity flags (key, cert, locked) survive a link restart: 0x07");

// ---- 3. BLE and IR are clean "not supported" ----
{
  const w = a.world, sent = [];
  const orig = w.peerSend;
  w.peerSend = (id, bytes) => sent.push({ id, bytes: Array.from(bytes) });
  const req = (op, extra = []) => w.peers.get(0x4B495201)(Uint8Array.from([op, 1, ...extra]));
  req(1, [1, 0, 0xa0, 0x8c, 0, 0, 0, 0, 0, 0]); req(2); req(3); req(4);
  w.peerSend = orig;
  check(sent.length === 4 && sent.every((s) => s.id === 0x4B495281), "IR requests get IR events back, not silence");
  check(sent[0].bytes[0] === 1 && sent[0].bytes[2] === 1 && sent[1].bytes[0] === 4 && sent[1].bytes[2] === 1, "SEND and ARM answer KIR_FAIL");
  check(sent[2].bytes[0] === 3 && sent[2].bytes[3] === 1 && sent[3].bytes[3] === 1, "IDLE and PRESENT answer a level event with KIR_FAIL");
  check(!w.ops.has("ble.init") && !w.ops.has("hci.tx"), "BLE registers nothing yet: its ops are not defined (DBH_ERR_NOOP to the firmware, never a crash)");
}

// ---- 4. faults and power ----
{
  const faults = [];
  a.radio.on((t, d) => faults.push({ t, ...d }));
  await a.cmd("radio_down"); await sleep(600);
  a.radio.setFault("absent");
  m = a.mark();
  await a.cmd("radio_up");
  await a.waitLog(/connect_to_slave: ESP_FAIL/, 8000, m);
  check(a.radio.state().link === "down", "fault 'absent': the SDK's connect fails and the link stays down");
  a.radio.setFault(null);

  a.radio.setPower(false);
  m = a.mark();
  await a.cmd("radio_up");
  await a.waitLog(/connect_to_slave: ESP_FAIL/, 8000, m);
  check(faults.some((f) => f.t === "power" && f.on === false), "switching the C5 off is an event");
  a.radio.setPower(true);
  m = a.mark();
  await a.cmd("radio_up");
  await a.waitLog(/link up; esp-hosted/, 8000, m);
  check(a.radio.state().usable, "switched back on, the radio comes back");

  a.radio.setPower(false);
  await a.waitLog(/link to the C5 dropped/, 12000, m);
  check(a.radio.state().link === "down", "power off while up: the SDK reports the link dropped");
  a.radio.setPower(true);

  a.radio.setFault("failed");
  m = a.mark();
  await a.cmd("radio_up");
  await a.waitLog(/no CP_INIT from the C5 in 10s/, 16000, m);
  check(true, "fault 'failed': transport up, no CP_INIT, the SDK gives up after its 10 s");
  a.radio.setFault(null);

  m = a.mark();
  await a.cmd("radio_up");
  await a.waitLog(/link up; esp-hosted/, 8000, m);
  a.radio.setFault("mute");
  m = a.mark();
  await a.cmd("wifi_scan");
  await a.waitLog(/the C5 has stopped answering; the link is lost/, 15000, m);
  check(true, "fault 'mute': RPCs time out and the SDK declares the link lost");
  a.radio.setFault(null);
  await a.waitLog(/link up; esp-hosted/, 15000, m).catch(() => {});

  m = a.mark();
  a.radio.dropLink();
  await a.waitLog(/link to the C5 dropped/, 12000, m);
  check(true, "dropLink(): TRANSPORT_FAILURE reaches the SDK");
}

// ---- 5. the vault's semantics (the SDK drives it through the real wire) ----
{
  a.radio.setFault(null);
  const v = a.radio.vault;
  v.clear();
  const w = a.world;
  const svc = (op, payload) => w.services.get(1)(op, payload);
  const cred = (s, p) => { const b = new Uint8Array(98); b.set(new TextEncoder().encode(s)); b.set(new TextEncoder().encode(p), 33); return b; };
  check((await svc(1, cred("a", "short"))).status === 2, "REMEMBER refuses a password of 1..7 characters");
  check((await svc(1, cred("", "longenough"))).status === 2, "REMEMBER refuses an empty name");
  for (let i = 0; i < 10; i++) await svc(1, cred("net" + i, "password" + i));
  check(v.list().length === 8 && v.list()[0] === "net9" && !v.list().includes("net0") && !v.list().includes("net1"), "the vault keeps 8 networks, newest first, oldest evicted", v.list());
  await svc(1, cred("net5", "password5"));
  check(v.list()[0] === "net5" && v.list().length === 8, "remembering a known network moves it to the front");
  const open = await svc(1, cred("OpenCafe", ""));
  check(open.status === 0 && v.entries()[0].pass === "", "an open network is stored with an empty password");
  const ssid = (s) => { const b = new Uint8Array(33); b.set(new TextEncoder().encode(s)); return b; };
  check((await svc(2, ssid("nope"))).status === 3, "JOIN of an unknown network: NOT_FOUND");
  check((await svc(4, ssid("nope"))).status === 3 && (await svc(4, ssid("net5"))).status === 0 && !v.list().includes("net5"), "FORGET: NOT_FOUND then OK");
  const lst = await svc(3);
  check(lst.payload.length === 1 + 8 * 33 && lst.payload[0] === v.list().length, "LIST: count and 8 slots of 33 bytes");
  check((await svc(5)).status === 0 && v.list().length === 0, "WIPE empties the vault");
  const bk = (op, p) => w.services.get(3)(op, p);
  const k = new Uint8Array(32).fill(7);
  check((await bk(1, k)).status === 0 && (await bk(4, k.slice(0, 16))).status === 0 && (await bk(4, new Uint8Array(16))).status === 3, "BTKEYS PUT / HAS / HAS-unknown");
  check((await bk(2, k.slice(0, 16))).status === 0 && (await bk(2, k.slice(0, 16))).status === 3, "BTKEYS DEL, then NOT_FOUND");
  const sn = (op, p) => w.services.get(4)(op, p);
  check((await sn(1, Uint8Array.from([0, 0]))).payload[3] === 1, "SNIFF START with Wi-Fi not started: WHY_WIFI_OFF");
  check((await w.services.get(0)(99)).status === 2, "an unknown SELF op is BAD_REQUEST");
  check(!(await w.services.get(9)) , "an unknown service has no handler (the world answers BAD_REQUEST on the wire)");
}

done(a, "radio");
