# STATUS: infrared (`ir`)

Branch `area/ir`, worktree `/home/claude/wt/ir`. Files: `runtime/drivers/ir/` (area.json, ir_fake.c, ir.js), `tests/node/ir/` (bench.mjs, 5 tests, apps/ir_api), this file.

## Seam
The six functions of `components/kdrv/ir/include/kdrv_ir.h` (`init, rx_idle, rx_present, send, rx_take, rx_arm`), verified against the header: the code matches driver-surface.json.
`components/kdrv/ir/src/kdrv_ir.c` is superseded (it speaks request/reply to the C5 over the esp-hosted peer-data link, `kir_wire`). Real and unmodified above the seam:
`knec.c` (NEC codec), `ir_ao.c` (AO_Ir: arming, echo deaf window, retries, capture worker), `ir_verbs.c`, `kode_ir*.c`, `kode_sys_ir.c`, capture files.
The link is raw symbol trains (mark_us, space_us, up to 256 symbols, carrier Hz) both ways. Out: `kdrv_ir_send` queues a record (ring of 16) that the glue pops each tick and shows to every aimed TV.
In: `ir_rx_inject` (page thread, spin lock + copy only) is kept only if the receiver is armed (one capture per arming), the block is up, not deaf, carrier 36-40 kHz; a fake-owned thread then calls the owner's callback.
Kept as on the real driver: argument checks and status codes, one transmission in flight (second is KODE_DENIED, AO_Ir retries), zero space = 32767 us, zero mark = 1 us, arming an armed receiver = KODE_ERROR, `rx_present` re-arms and loses a waiting capture, capture truncated to the caller's cap.
With `CONFIG_KODEOS_RADIO` the link follows `kdrv_radio_link_up()` (a link that comes up resets the C5-side state: receiver disarmed).

## Collision with the radio area
None. radio has no `supersedes`; it provides `kdrv_radio_link_up` and the host bridge. grep of radio for `kdrv_ir`/`kir_` finds nothing; ir supersedes only `kdrv_ir.c`. ir depends on radio only through the optional `kdrv_radio_link_up()` (guarded by `CONFIG_KODEOS_RADIO`, which the radio area sets).
Without radio in the tree: `kode_ir_*` are compiled out of the firmware (no `CONFIG_KODEOS_RADIO`), so the `ir_api` tests print SKIPPED and exit 0. The passing run below had radio present (copy of the radio branch under `runtime/drivers/radio/`, git-excluded in this worktree, identical to /home/claude/wt/radio).
Also: `AO_Ir` only starts when the C5 link is up, so IR needs the radio glue attached in the page (the test bench attaches it too).

## Bench-object API (glue: `device.area("ir")`)
```
const ir = device.area("ir"); const tv = ir.tv({name}); const rem = ir.remote({name});   // both aimed at the Dot; ids "tv1","remote2",... (one counter)
rem.press("Power") / rem.hold("Vol+", ms) / rem.down(b), rem.up() / rem.sendRaw([...us], hz) / rem.addButton("Sony",{raw:[...],carrier})   // -> {ok, reason, frames:[{ok,code,reason}]}
tv.state() {power,volume,channel,muted,last}  tv.log()  tv.raw()  tv.update({...})  tv.clearLog()   // default NEC map: addr 0xFB04, Power 08, Vol+ 02, Vol- 03, Ch+ 04, Ch- 05, Mute 09
tv.aim(false) / rem.aim(false) ("pointing at the Dot")   tv.remove() / rem.remove() / ir.remove(id)   ir.objects() ir.get(id)
ir.state() (Dot side counters)  ir.configure({link,rxDeaf,txDark,rxFitted,restHigh,echo,agcUs,disarm})  events: area:ir:{tx,tv,tv-state,remote,created,removed}
```
Objects persist (region `ir`, JSON, 32 KiB). Header comment of `ir.js` is the full reference.

## Tests (`DOTBENCH_BUILD=/tmp/irb tests/node/run.sh ir`, seeded build dir)
```
api_nec        27 ok  PASSED   Dot sends NEC (TV decodes with its own decoder), Remote -> kode_ir_receive/last/event, repeats, bad args, echo
example_ir_remote 17 ok PASSED the SDK example, unmodified, built and driven (learn Power/Vol+, replay, 10 s timeout)
fake           19 ok  PASSED   ir_fake.c exports: key checks, injection codes -1..-5, per-cause drop counters, zero mark/space, blob
link           18 ok  PASSED   TV/Remote create/remove, aim off, link down, dead emitter, deaf receiver, unarmed, busy (second send refused 500+ times, AO_Ir retries, frame goes out)
raw            25 ok  PASSED   learn a 25-duration Sony train, replay, TV timings equal (exact; within AGC stretch when agcUs=80), 256-symbol limits, 56 kHz, raw hold, capture file and replay
ALL TESTS PASSED   (incl. 2 acceptance tests; 115 "ok" lines in total)
```
KodeOS role: `tools/dotbench build /home/claude/src/KodeOS --role kodeos` builds (6 `kdrv_ir_*` defined, so the old "kdrv.ir no peer-data slot" stub failure is gone) and `tests/node/kodeos/boot.kodeos-test.mjs` passes (13 ok). No IR-specific kodeOS test (kodeOS has no IR UI the bench can drive).
Stub count in the app build: 281 (the ir area adds none; the six kdrv_ir functions are real).

## Assumptions
- Receiver band 36-40 kHz (TSOP75338 class); outside it the frame is not heard. The TV is tolerant (any carrier) and says so in its log.
- Default NEC map and the TV's address word 0xFB04 (classic addr 0x04) are mine; the spec leaves them open.
- Echo of the Dot's own sends is off by default (spec says the bench must not deliver one); `configure({echo:true})` turns it on and AO_Ir's deaf window drops it (tested).
- A remote frame is lost when the receiver is not armed, as on the board (one capture per arming).
- Frame time: a NEC frame ends with the closing 32767 us gap, so 34 symbols last about 93 ms.

## Where docs disagreed with code
1. bench-spec says the header example address is "0x0004"; the driver word for classic 0x04 is 0xFB04 (spec's own open point 1). Words are stored; `classic` option on a Remote builds the inverted copy.
2. bench-spec "Radio off: infrared is busy, or the radio is off" and "link-down gives timeout or DENIED": with the block down `kdrv_ir_*` answer KODE_DENIED immediately (tested); the text the app sees comes from the SDK.
3. docs/driver-surface.json: seam is right, but `kdrv_ir_rx_present` re-arms the receiver (not stated); modelled.
4. Known issue 1 (SDK/runtime, not fixable here): `kode_ir_receive` waits ONE tick past AO_Ir's own deadline; on this pthread tick about half of silent calls report "the infrared receiver did not answer" instead of "no infrared signal in N ms". `api_nec` accepts both; the AO-level KODE_TIMEOUT is asserted in the example test.
5. While busy, AO_Ir polls the refused send (about 500 refusals per 260 ms frame); this is the SDK's behaviour, counted in `ir.state().sendRefused`.
6. ir.js ids are one counter across kinds (tv1, remote2, tv3), not per kind.
7. Node console input loses lines typed back to back; tests feed `txadd` one line at a time (helper `txRaw`).

## Shared changes needed
None. (The Node harness does not load glue; `bench.mjs` imports the packaged glue itself. Browser check not written: the guide does not require `tests/browser/ir`.)

## Risks
Timing tests (busy, echo, repeat spacing) can flake on the loaded 2-core machine; rerun before concluding. Depends on radio area for `CONFIG_KODEOS_RADIO`.
