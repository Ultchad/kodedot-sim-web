# STATUS: radio, Wi-Fi and network (area/radio)

Three area folders under `runtime/drivers/`: `radio` (the C5 co-processor), `wifi` (esp_wifi / esp_netif and router bench objects),
`net` (esp_http_client, esp-mqtt, UDP, DNS, ping, SNTP). Tests: `tests/node/{radio,wifi,net}/`. No shared file was edited.

## Seam

The SDK's own `kdrv_radio.c`, `kdrv_c5.c`, `kdrv_c5svc.c`, `kdrv_wifi.c`, `kdrv_net.c`, `kdrv_frames.c`, `network_ao.c`/AO_Radio/AO_Net
(`kaos`) run **unmodified**. Nothing in the SDK is superseded (`supersedes` is empty in all three areas). What is faked is the layer
under them, the ESP-IDF / esp-hosted API the SDK calls:

* `radio`: `esp_hosted_*` (init, RPC, custom peer data, link events, `esp_hosted_cp_*`), `esp_chip_info`, `esp_event`, `esp_mac`, the
  slave-side RPC ids. One C bridge (`radio_host.c`, `include/dotbench_radio.h`): a firmware thread fills a call slot in shared memory and
  blocks on a futex; the glue (`radio.js`) completes it asynchronously; events go back through a byte ring to a platform thread.
  The C5 itself is JS: link up/down, power, faults, boot timing, firmware version, the five KODE peer services (SELF, VAULT, ID,
  BTKEYS, SNIFF) with a persistent vault (saved networks), identity and key store (kept across firmware restarts).
* `wifi`: `esp_wifi_*`, `esp_netif_*` over router objects.
* `net`: `esp_http_client`, `esp_crt_bundle`, `mqtt_client`, `lwip` sockets (UDP, getaddrinfo), `ping_sock`, `esp_netif_sntp`.
  `net_shim.c` is a thin C layer; HTTP goes through `fetch`, MQTT is a real 3.1.1 codec over `WebSocket`.

Build roles: the areas apply to both `app` and `kodeos` (default `roles`). See "kodeOS" below.

## Bench-object API (page: `device.area("radio")`, `("wifi")`, `("net")`)

```
radio.setPower(bool)  radio.setFault(null|"absent"|"failed"|"mute")  radio.dropLink(why)  radio.reboot()  radio.state()
radio.vault.{list(),entries(),add(ssid,pass),clear()}   radio.setFirmware(maj,min,patch)   radio.factoryReset()
radio.timing  radio.fastTiming() / realTiming()   radio.on(fn)  radio.notes
wifi.addRouter({ssid, password, security, channel, signal, hidden, internet, dhcp, ip, gateway, dns, latencyMs, wrongPasswordReason})
wifi.routers()  wifi.removeRouter(r)  wifi.clearRouters()  wifi.station()  wifi.setLossThreshold(dbm)
router.update(patch) .powerOff() .powerOn() .setSignal(dbm) .setInRange(b) .setInternet(b) .kick(reason) .remove() .snapshot()
router.host(name, {ip, routes, handler, upstream, latencyMs})   router.removeHost(name)      local HTTP(S) hosts, or forward to a real server
router.udpPeer(ip, port, handler) -> {received[], send()}                                   UDP peers
router.mapBroker(host, port, "ws://...")  router.enableBroker({users, hosts}) -> Broker     MQTT: real WS broker / in-page broker
net.lastHttp() httpLog corsLog udpLog pingLog mqttLog mqttClients() brokerOf(router) setFetch(fn) setWebSocket(cls) mqttUrl(uri)
events: area:wifi:{scan-done,join-start,join-failed,connected,got-ip,disconnected,router,rssi}  area:net:{http,cors,unreachable,mqtt,udp,ping}
        area:radio:{note,power,fault,...}
```
The default MQTT endpoint of a router is: a mapped real broker if `mapBroker` matches host:port; otherwise, with `internet` false (or
no route), the router's in-page `Broker` (created on demand); with `internet` true and no mapping the real hostname is tried over
`ws(s)://` (and fails offline). Wi-Fi security names: open, wep, wpa, wpa2, wpa/wpa2, wpa3, wpa2/wpa3. Router objects are created and removed at run
time and survive a firmware restart within the page.

## HTTP(S), CORS, and a proxy-free page

HTTP(S) uses `fetch`. A browser can only read a cross-origin response when the server sends `Access-Control-Allow-Origin`
(and answers a preflight for non-simple requests). When `fetch` fails with a TypeError and a `no-cors` probe shows the host is
reachable, the glue reports **CORS** (bench note, console warning, `area:net:cors`, `net.corsLog`) and the firmware sees an
unreachable host, which is what a real device would see for a dead server. Ways to a proxy-free experience, in order:
(1) router **local hosts** (`router.host("api.test", {routes})`) answer without the network, work with `internet: false`, and
cover most demos and tests; (2) **`upstream`** forwards a router host to a CORS-enabled server (for example the user's own
`localhost` service with CORS headers); (3) public CORS-open APIs work directly; (4) the page may offer an optional user-run proxy by
passing `net.setFetch(fn)` (the page's own `fetch` wrapper). `https://` and `http://` to a local host both work (no TLS is run; the
certificate bundle call succeeds). Request ends when the network goes away.

## SNTP, DNS, ping, UDP

* SNTP: after an address, the SDK's own `esp_netif_sntp` start leads to a time reply taken from the page's clock, only on a router with
  `internet: true` (a router without internet gives no time; kodeOS then keeps its own clock).
* DNS: IP literals, the router's host table (`host(name,{ip})`), `localhost`, `router.dnsNames[name]`; with `internet: true` any other name
  gets a stable synthetic address in 203.0.113.0/24 (the browser has no DNS API; HTTP to it still goes by name through `fetch`); with
  `internet: false` it fails.
* Ping: local host table, else a `no-cors` reachability probe (an approximation of ICMP); a host marked `down` answers no echo.
* UDP: the SDK only sends (there is no receive path in `kdrv_net.c`); datagrams go to `router.udpPeer`s; a peer's own `send` is
  dropped with a note.

## What was verified

Run from `/home/claude/wt/radio` with `DOTBENCH_BUILD=/tmp/radio` (seeded build dir):

```
tests/node/run.sh radio wifi net
```
Per suite, final results are pasted below (see "Final output").

| suite | what it drives |
|---|---|
| `radio/radio.test.mjs` | C5 boot, link up/down/drop, power, faults (absent/failed/mute), identity, vault persistence across restart, services |
| `wifi/wifi.test.mjs` | scan (strongest first, hidden, 2.4/5 GHz), join/leave, wrong password, DHCP off, loss, rejoin, weak signal, kick, twin SSIDs, status/RSSI |
| `net/net.test.mjs` | HTTP GET/POST/Range/chunked/redirect/errors/stall/cut, CORS note, DNS, ping, UDP, SNTP, threads (net_api test app) |
| `net/network_example.test.mjs` | SDK example `network` end to end (ping, GET, worker ping, busy, host down, router off/on) |
| `net/mqtt.test.mjs` | SDK example `mqtt` end to end: real WebSocket broker, buttons publish, messages drive the LED, drop and reconnect, retained, router off/on, broker gone, auth refusal, in-page broker, internet switch |
| `net/mqtt_api.test.mjs` | the broker at packet level (QoS 0/1, retained, wills, persistent sessions, takeover, wildcards, auth, protocol level, codec) and the task-side `kode_mqtt_*` calls |

## Assumptions

* Timing: `radio.fastTiming()` (boot 150 ms, 120 ms per scan step, join 500 ms) is what the tests use; `radio.realTiming()` gives chip-like
  values (boot 700 ms, 2.9 s per scan step, join 3.5 s). The SDK's own timers are untouched.
* MQTT is spoken as 3.1.1 on the wire; MQTT 5 connect properties are accepted and noted. QoS 2 is granted as 1 by the in-page broker.
* `mqtt://host:port` maps to `ws://host:port` (and `mqtts://` to `wss://`); a real broker needs a WebSocket listener, so the page maps the
  firmware's TCP endpoint to the WebSocket URL with `router.mapBroker`.
* A factory-fresh bench has no device name until the C5 has been seen once (`khal_identity_init` reads the NVS), and the `mqtt` example
  builds its topics at construction: the first boot refuses to connect (`no device id`), a second boot with the NVS kept (as on a board)
  runs. The test boots twice for this reason.
* The `mqtt` example's connect request now and then loses a race with AO_Net on GOT_IP (SDK behaviour); the example's own recovery
  (any button) is used by the test and the occurrences are counted in its output.
* A button edge that follows the previous release by tens of ms is dropped by the SDK's button debounce; tests wait between presses.

## Disagreements between docs and code (code wins)

1. `docs/driver-surface.md` note 9 describes a "web job executor that copies the dispatch switch" and fakes `kdrv_radio.c`: not done.
   The real `kdrv_radio.c` runs over a faked `esp_hosted`, which is lower and keeps more SDK code real; no SDK file is replaced.
2. `docs/driver-surface.md` line "net-http-mqtt: fake the kdrv_net_* API": same, `kdrv_net.c` is real; the fake is `esp_http_client` and friends.
3. `kode.h` says an HTTP redirect is not followed; `kdrv_net.c` leaves `esp_http_client`'s default (follow up to ten) for GET and POST, so the
   redirect target comes back. The bench follows the code.
4. `kode.h` allows a UDP datagram of length 0; `kdrv_net_udp_send` refuses it. The bench follows the code.
5. `bench-spec.md` (Wi-Fi scenarios 3, 4, 6) quotes failure texts ("could not join 'Home': wrong password or out of range", "no address from
   'Home' within 30 s"); the SDK prints its own lines (`'Home5G' refused us (wrong password, reason 202)`, `'NoDHCP': no address within 20000ms`)
   and the bench shows those. A wrong password and an out-of-range router are different reasons here (202 AUTH_FAIL vs a missing network), not one text.
6. `bench-spec.md` expects a scan of about 38 s; the bench uses `fastTiming()` by default in tests (see assumptions).
7. UDP: `bench-spec.md` implies a UDP receive path; `kdrv_net.c` has only `kdrv_net_udp_send`. Peers can receive but not send to the firmware.
8. `docs/kodeos-plan.md` and `runtime/drivers/kodeos_boot/area.json` stub `kdrv_radio.c`, `kdrv_radio_rpc.c`, `kdrv_c5.c`, `kdrv_wifi.c`,
   `kdrv_net.c` in the kodeos role "owner: radio": with this area they are real, so those five entries must go (shared file, see below).

## BLE: how the BLE area plugs into the radio core

* Real code above: `kdrv_ble.c` (NimBLE host over esp-hosted), `kdrv_ble_adv/app/heard/bonds/tokens/find.c`, `kdrv_c5svc.c` (the
  BTKEYS service) all stay real. They call `esp_hosted_bt_controller_init/enable/disable/deinit` (declared in
  `radio/include/esp_hosted.h`, deliberately **not defined** by the radio area) and NimBLE's HCI transport (`ble_transport_*` over esp-hosted's
  virtual HCI).
* The BLE area supplies: (a) C: the four `esp_hosted_bt_controller_*` functions and an HCI transport that moves H4 packets through `dbh_call("ble.hci.tx",
  ...)` (host to controller) and `dbh_on_event("ble.hci.rx", ...)` (controller to host), using `dotbench_radio.h` exactly as `radio_hosted.c`
  and `wifi_shim.c` do; (b) JS (`ble.js`, `ctx.module.__dbw`): `w.op("ble.hci.tx", fn)` receives HCI commands/ACL, emits events with
  `w.emit("ble.hci.rx", bytes)`; a virtual controller answers HCI (reset, features, adv, scan, connections, ATT/GATT in JS) and exposes bench
  objects (phones, beacons) that appear in scans.
* Reused from the radio core: `w.c5.usable()` (do not answer HCI when the C5 is powered off, faulted or the link is down), `radio.setPower`
  / `setFault` / `reboot` (hook `w.hooks.c5Reset` to drop all connections), `w.timing`, `w.after`/`w.sleep` (cancelled on dispose), the `BTKEYS`
  service (bond key store, persisted in `PERSIST.btkeys`, survives firmware restart), `w.note`, `w.event` (page events).
* Wi-Fi/BLE coexistence is not modelled; the C5 serves both independently.
* Registration order does not matter: glue files that attach before the world exists are queued on `M.__dbwq`.

## Infrared: conflict check

IR is carried by the real `kdrv_ir.c` as KODE peer data (`KIR_REQ` 0x4B495201 to the C5, `KIR_EVT` 0x4B495281 back). The radio core
registers a **default** handler (`w.peer(KIR_REQ, ...)`) that answers every request with `KIR_FAIL` ("the peripheral refused"). Nothing in
the radio fake conflicts with an area that supersedes `kdrv_ir.c`: the default handler is simply never called. An IR area that keeps the real
`kdrv_ir.c` replaces it with `w.peer(KODE.KIR_REQ, fn)` and answers with `w.peerSend(KODE.KIR_EVT, bytes)`; the later registration wins
(world callbacks queued before the radio glue exists run after it). Nothing in the radio area exports a symbol named `kdrv_ir_*`.

## kodeOS role

The areas apply to the `kodeos` role (default `roles`), and kodeOS runs the same real `kdrv_radio`, AO_Radio, AO_Net over them. Verified in a scratch
checkout of `main` (kodeOS build profile, kodeos_boot, kgui) with this branch's three area folders and tests overlaid, and the five stub entries of item 1
under "Shared-file changes" removed from `kodeos_boot/area.json`:

```
tools/dotbench --build /tmp/radio-k seed /home/claude/dotbench/build ; DOTBENCH_BUILD=/tmp/radio-k tools/dotbench sdk
DOTBENCH_BUILD=/tmp/radio-k tools/dotbench build /home/claude/src/KodeOS --role kodeos
DOTBENCH_BUILD=/tmp/radio-k node --expose-gc tests/node/radio/kodeos_radio.kodeos-test.mjs     # 11 checks, PASSED
DOTBENCH_BUILD=/tmp/radio-k node --expose-gc tests/node/kodeos/boot.kodeos-test.mjs            # main's own kodeOS test, 5 checks, still PASSED
```
`tests/node/radio/kodeos_radio.kodeos-test.mjs` (named like main's kodeOS tests so `tests/node/run.sh` skips it; it needs the main tree) checks: C5 link up
and the board named from the C5; no "not implemented" for radio/Wi-Fi/net functions; the control centre (swipe down), a tap on the Wi-Fi circle (switches
it on) and a long press (opens the Wi-Fi page) list the three bench routers with security and dBm; a touch on the open "Cafe" row joins it (`joined 'Cafe'`,
bench station says Cafe, saved in the C5's vault); SNTP delivers the network time ("the time arrived from the network"); router off gives "the network went
away", back on rejoins and asks for the time again; a router with `internet: false` gives an address and no network time. Typing a password on kodeOS's
keyboard (the WPA row) is not driven by the test; the same join is covered by the console path in `wifi.test.mjs`.
This test cannot run from this branch alone (the branch base predates the kodeOS merge); it runs once the branch is merged with main and item 1 is applied.


## Shared-file changes needed (not made)

1. `runtime/drivers/kodeos_boot/area.json` (on main): delete the `supersedes` entries for `components/kdrv/radio/src/kdrv_radio.c`,
   `kdrv_radio_rpc.c`, `kdrv_c5.c`, `kdrv_wifi.c`, `kdrv_net.c`; the radio areas provide the layer beneath them. `kdrv_ble.c` stays stubbed until the BLE area.
2. None for the app role. No bridge struct, export list, or build-tool change.

## Risks

* Under load on the shared 2-core machine, long waits (rejoin, 20 s) and button timing can flake; re-run before concluding.
* The `mqtt` example's GOT_IP race and the button debounce are SDK behaviours the tests work around, not hide.
* Real brokers over the browser need a WebSocket listener and a `mapBroker`; plain TCP brokers cannot be reached from a page.
* CORS limits real HTTP from the page (see above); there is no built-in proxy.

## Final output

Last full run, `DOTBENCH_BUILD=/tmp/radio tests/node/run.sh radio wifi net` (rtos 85 checks, 0 failed; acceptance buttons_led 5 and display_lvgl 4 ok), per suite:

```
wifi/wifi.test.mjs               39 ok   wifi: PASSED
net/mqtt.test.mjs                39 ok   mqtt example: PASSED
net/mqtt_api.test.mjs            38 ok   mqtt api and broker: PASSED
net/net.test.mjs                 76 ok   net: PASSED
net/network_example.test.mjs     16 ok   network example: PASSED
radio/radio.test.mjs             43 ok   radio: PASSED   (two later standalone runs; see below)
```
In that run `radio.test.mjs` failed once at `link to the C5 dropped` (5 s wait) while the machine's load average was 24 to 33 (other engineers'
builds); it passed in the 3 standalone runs that followed (2 before and 1 after widening that wait to 12 s; the assertion is unchanged). That is the only failure
seen, and it is a timing flake under load, not a logic one. Total: 251 checks in the area suites, plus 11 for kodeOS.

The build log of that run printed `282 stub functions` (app role); it was not compared with `main`'s count for this branch's base, so "stub count did not
grow" is not asserted. Browser check: the guide asks for one only if the glue matters; the three glue files are exercised through the real attach path
(`bench.mjs` loads them as packaged) and none touches the DOM; no browser test was added.

