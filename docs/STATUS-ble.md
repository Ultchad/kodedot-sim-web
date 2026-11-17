# STATUS: Bluetooth LE (area/ble)

One area folder, `runtime/drivers/ble/` (`area.json`, `ble_host.c`, `ble_priv.h`, `ble.js`), both build roles. Tests: `tests/node/ble/`
(5 app-role files, 2 kodeOS-role files, one test app `apps/ble_api`). Shared-file change: one line removed from
`runtime/drivers/kodeos_boot/area.json` (the `kdrv_ble.c` stub entry). Nothing in `runtime/drivers/radio/` was touched: BLE follows the
link by reading `kdrv_radio_link_up()`, as IR does.

## Seam (differs from docs/driver-surface.md and STATUS-radio.md)

The plan there (an HCI transport under a real NimBLE host, `esp_hosted_bt_controller_*`) is **not feasible in this tree**: NimBLE's headers
and sources are not on the machine, and `components/kdrv/radio/src/kdrv_ble.c` (4474 lines) is written against them. So the seam is the
interface of `kdrv_ble.h` itself: `kdrv_ble.c` is superseded by `ble_host.c`, which defines every non-static symbol that file defined and
keeps its rules (see below). Everything else of the SDK runs unmodified above and beside it: `kdrv_ble_adv.c` (advert packing, serial name,
connection parameters, pulse arithmetic), `kdrv_ble_app.c` (the app's service rules, values, queue, ring), `kdrv_ble_bonds.c`,
`kdrv_ble_heard.c`, `kdrv_ble_find.c`, `kdrv_ble_tokens.c`, AO_Radio (`radio_ao.c`, `radio_verbs.c`), `kdrv_radio.c`, `kode_ble_*`,
`kode_sys_ble_*`, kodeOS's Bluetooth page and passkey card.

`ble_priv.h` copies, verbatim, the declarations of three SDK-private headers (`kdrv_ble_app.h`, `kdrv_ble_bonds.h`, `kdrv_ble_find.h`,
SDK `c9568a3`) because area sources are compiled without the SDK's private `src` dirs. Keep it in step with the SDK.

## What `ble_host.c` keeps from `kdrv_ble.c`

Console line assembler (240 bytes, CR/LF, raw mode), the 2048-byte length-prefixed console ring with the 12-record drain, retry on
no-buffer and the confirmed-line request (answered by a discovery of the GAP service); the mirror pipe (8192 bytes); the app's characteristics
drain (`kdrv_ble_app_peek/pop`), the battery level; notification payload limited to MTU-3; ATT: console characteristics are not readable,
writes over 256 bytes (console) or the value size (app) are `INVALID_ATTR_VALUE_LEN`, a refused app write is `INSUFFICIENT_RES`; the scan table
(24 devices, strongest RSSI kept, name/manufacturer data/16-bit services taken from the first packet that has them, parsed from AD
structures), `kdrv_ble_scan_abort`, `scan_find`, the passive `hear` ring; the pulsed advert train (the SDK's `kdrv_ble_pulse_next` drives
the same state machine), hidden mode (no discoverable flag, empty scan response), `adv_calm`/`conn_calm`; pairing (DisplayOnly, MITM, secure
connections, bonding; passkey shown on the Dot through `pair_note`, reject, 30 s security-manager timeout, repeat pairing, Just Works undone
when the door is shut), the 3-bond store with round-robin eviction (a full store refuses in an app or while hidden), link security flags,
`kdrv_ble_bonds` is 0 while the stack is down, `kdrv_ble_unpair` starts the stack first. Permissions: with the passkey option on, every
characteristic of the console, mirror, app service and battery needs an encrypted and authenticated link (read, write and the subscription).
In the app role (`CONFIG_KODEOS_BOOT_ROLE_APP`) the Dot never shows a code and refuses every new pairing (`pairing refused: a new phone pairs in
kodeOS`); only a phone bonded in kodeOS reconnects. Log texts are the SDK's.

## The air: how the page talks to the host

Two byte queues (`ble_in` / `ble_out_pop`, record layouts in `ble_host.c` and `ble.js`, same names). One persistent host thread plays NimBLE's
host task (callouts, events). The page decides only what is on the air; the Dot decides everything else.

BLE **follows the radio core**: the host thread watches `kdrv_radio_link_up()`. A C5 power-off, fault or link drop is a controller reset for the
host: the connection ends (the Phone sees `disconnected`), advertising and scans stop, the state goes IDLE; when the link comes back the host
syncs again (`kdrv_ble_start` fails with `KODE_ERROR` while the link is down). AO_Radio's own recovery then brings advertising back.

## Bench-object API (page: `device.area("ble")`; the glue is ready for the web engineers, nothing under `web/` was written)

```
ble.addSensor({ name, rssi, inRange, address, addrType, services:[uuid16], mfg:"hex"|bytes, nameIn:"adv"|"rsp", interval, temperature, battery })
   sensor.update(patch) / .setValue(degC) / .setBattery(pct) / .read(0x2a6e|0x2a19) / .gatt() / .remove()     0x181A temperature (sint16, 0.01 C), 0x180F battery
ble.addPhone({ name, address, rssi, inRange, io:"keyboard"|"none", pairing:"auto"|"ask"|"never", mtu, mute, bond })
   await phone.scan(ms)  -> { sees, name, address, rssi, discoverable, hidden, bonded, uuids, connectable }
   await phone.connect({wait}) -> { ok, conn, reason }    (keeps scanning up to `wait` ms; a hidden Dot only to a bonded phone)
   await phone.pair({ passkey?, accept? }) -> { ok, status, authenticated }   "auto" reads the code off the Dot's screen, "ask" waits for phone.enterPasskey(n)
   phone.cancelPairing()  phone.whenSecure(ms)  phone.secure / .bonded / .connected  phone.forget()  phone.disconnect()  phone.stall(bool)
   await phone.read(ref) / .write(ref, bytes|string, {noResponse}) / .subscribe(ref, on) / phone.discover()    ref: handle | uuid | "console-rx" | "console-tx" | "mirror" | "battery" | "gap-name" | {app:n}
   phone.console.{send(line), lines, waitLine(re,ms), subscribe(), clear()}   phone.mirror.{bytes, chunks, subscribe()}   phone.notifications
ble.bondPhone(phone)   a phone that paired in kodeOS before: plants the bond on both sides
ble.sensors() phones() get(id) remove(id) clear() objects() state() info() gatt() lastPasskey() configure({scanSpeed, smTimeoutMs, passkey}) poll() dispose()
Events (dev.on("area:ble:<type>")): stack adv scan created removed connected disconnected passkey pairing bonds notify console sensor phone error persist-failed
```

`state()` reports the stack, the advert (name, UUIDs, manufacturer data), scan, connection, `secure`, `bonds`, `bondList`, the shown `passkey`.
The Dot's passkey is also exposed as the `passkey` event and `lastPasskey()` (a bench mirror: the page's Phone card can show it). Objects are saved
by the glue in the persistent region `ble` (bonds first, JSON objects after), so they survive a restart and a page reload.
`wipe` of the area (the page's reset) is `ble.clear()`; it does not touch the bonds (those are the Dot's: `ble_unpair`, kodeOS's Forget all,
or the factory reset's `c5_wipe`).

C exports for tests/page: `ble_in ble_out_pop ble_cfg ble_cfg_get ble_stat ble_set_addr ble_info ble_gatt_json ble_bond_inject ble_blob_*
ble_reset_counters ble_test_pair_reject` (the last calls `kdrv_ble_pair_reject`, what kodeOS's card calls when the user closes it).

## Proof (commands and output)

```
DOTBENCH_BUILD=/tmp/ble tests/node/run.sh ble                 # app role: 95 checks, ALL TESTS PASSED
   api 26 . bonds 15 . example_ble_peripheral 29 . radio_power 15 . scan 10
DOTBENCH_BUILD=/tmp/ble tests/node/kodeos/run.sh              # kodeOS role: KODEOS TESTS PASSED
   ble/pairing 38 . ble/ui 17 . kodeos/boot 13 . radio/kodeos_radio 11
```

* `example_ble_peripheral`: the SDK example, unmodified, with a bonded Phone: advert name and console UUID, connect, encrypt by stored key, count
  notifications 1 Hz and counting, read, write the LED ("led set to 1 2 3"), 2-byte write ignored, 300-byte write `INVALID_ATTR_VALUE_LEN`, write-only
  read `READ_NOT_PERMITTED`, unsubscribe, disconnect, advertise again, reconnect. A stranger is refused (app role) and no bond is made.
* `scan`: Sensors in range, out of range, RSSI ordering, a name only in the scan response, adding/removing/moving Sensors, an advert that does not fit.
* `api`: `kode_ble_set_name`, `set_manufacturer_data`, app service `val` (set_value, notify, write -> `ble_written`), console over BLE (`ble_info` over
  the air), long line chunking, stalled Phone (retry counter), the SDK's `ble_scan` verb over Sensors.
* `bonds`: bond persisted across a device restart (and the Phone object from the saved objects), `ble_info`/`ble_unpair`, stale bond refused (status
  518), wrong key (573, Dot's bond kept), store of three.
* `radio_power`: C5 power off/on and `dropLink`: connection, advert and scan follow, the bond survives, a bonded Phone is back after.
* kodeOS `pairing`: visible with no bond, passkey shown, authenticated bond, console + mirror characteristics, hidden once bonded, bonded Phone
  finds a hidden Dot, `ble_pair` opens the door, wrong passkey (0x401), phone cancel, 30 s timeout (set to 4 s), third/fourth bond (oldest evicted),
  Dot-side reject, `ble_unpair`.
* kodeOS `ui`: the Bluetooth page opened from the control centre by touch, the passkey card shown while the code is live and gone after, "Pair new
  device" by touch, "Forget all" by touch, and `c5_wipe confirm=on` (the factory reset's wipe: vault, BT keys, `kdrv_ble_unpair`) succeeds.
* Stubs: no `kdrv_ble_*` function is generated as a stub in either role (`grep kdrv_ble_ <build>/stubs <build>/kodeos/stubs` is empty); no test hits a
  `not implemented` line for a BLE function.

Other suites re-run after BLE was switched on for every app (see risks): `radio` (needs one change, below), wifi, net (mqtt, network example), ir,
acceptance all PASSED.

## Assumptions

* A bonded phone encrypts with its stored key by itself when it receives the Dot's Security Request; an unbonded "auto" phone starts pairing; "ask"
  waits for the user (`pair()`); "never" does nothing.
* Passkey entry (Phone `io:"keyboard"`) is the only authenticated path, as DisplayOnly + MITM gives; `io:"none"` is Just Works (unauthenticated).
* ATT security errors: unencrypted link -> `INSUFFICIENT_ENC` (0x0F), encrypted but unauthenticated -> `INSUFFICIENT_AUTHEN` (0x05). A Phone with
  `auto` pairing retries a request after securing the link (as phone OSes do).
* The controller address is the C5's Wi-Fi MAC with the last byte + 2 (`68:67:25:c5:00:03`), public address.
* One connection at a time (the SDK's own limit). Advert tx power is fixed (+9 dBm). Default MTU 23 until the Phone's exchange (its `mtu`, 247).
* Scans are as long as asked; `configure({scanSpeed})` shortens them for tests.

## Disagreements between docs and code (the code wins)

* docs/driver-surface.md, STATUS-radio.md: BLE via an HCI transport and `esp_hosted_bt_controller_*`: not possible (no NimBLE); seam is `kdrv_ble.h`.
* docs/bench-spec.md describes a Presenter app that is a HID-over-GATT keyboard and a Dot that connects out: **the SDK has neither** (no HID service, no
  central role: no `ble_gap_connect` outside `kdrv_ble.c`'s own confirmation discovery). Not modelled. A "Presenter" can only be a custom app service with
  notifications, which a Phone reads.
* The radio STATUS says the C5's BTKEYS service holds bond keys. In the real `kdrv_ble.c` it does; here the bond (address, key, authenticated) lives in this
  area's region and `btkeys` stays untouched (kodeOS logs "0 BLE keys").
* CONFIG_KODEOS_BLE is on by default only in the kodeOS role; in the app role this area turns on `CONFIG_BT_ENABLED`, `CONFIG_KODEOS_BLE`,
  `CONFIG_KODEOS_BLE_CONSOLE`, so BLE is on in every app (see risks).

## Not modelled

HID-over-GATT, central role, GATT client. Bond keys in the C5 (BTKEYS) and NimBLE's NVS; CCCD restore for a bonded peer on reconnect (a Phone
subscribes again); resolvable private addresses and IRK; LE legacy pairing and numeric comparison; indications; long writes and reliable writes; multiple
connections; connection-parameter negotiation beyond reporting what the SDK asks; radio coexistence with Wi-Fi; advert collisions and scan-window
timing (a Sensor is heard at its interval, not probabilistically); SDK `KODE_BLE_...` tx power setting; sleep (the `kdrv_ble_activity` counter only
counts GAP events).

## Merging with fix1 (overlap in `kodeos_boot`)

* `runtime/drivers/kodeos_boot/area.json`: **keep the `kdrv_ble.c` entry removed** (two areas superseding one file is a build error).
* `runtime/drivers/kodeos_boot/internal_stubs.c` (fix1 bb72703 adds `kdrv_ble_unpair`; main has `kdrv_ble_app_host_bytes`): **delete both stub definitions**.
  `ble_host.c` defines `kdrv_ble_unpair` strongly (the honest one: it clears the stored bonds and fails when the link is down) and
  `kdrv_ble_app_host_bytes` weakly (so a leftover stub of the name still links, but the stub logs "not implemented"). Without deleting `kdrv_ble_unpair`
  the kodeOS link fails with a duplicate symbol.
* fix1's "no bonds, unpair succeeds" answer is replaced by real bonds: kodeOS's factory reset now clears them (tested through `c5_wipe`).

## Risks

* `radio/radio.test.mjs` (radio area) fails at `ident_csr` ("refused") once BLE is on in the app role: AO_Radio is still busy bringing BLE up after the
  link. A `sleep(1500)` before `getCsr()` fixes it (verified on a patched copy: radio PASSED). Not edited here (another area's file).
* BLE advertises in every app now (default on), as in the real SDK when an app enables it; it raises `kdrv_ble` work in apps that never asked. The page's
  adapter must run `ble.js`'s tick for the Phone's flows (they need the queue drained about every frame).
* The page has no BLE driver yet (`web/src/bench/drivers/`); the glue API above is its contract.
* Real timings differ: the stack is up instantly, a scan ends exactly on time, a connect takes two ticks.
