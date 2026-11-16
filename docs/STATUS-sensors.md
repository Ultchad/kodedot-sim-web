# STATUS: sensors (power, motion, haptic)

Result: `tests/node/run.sh power`, `motion` and `haptic` pass from a clean seeded build dir
(`dotbench --build /tmp/sens-clean seed /home/claude/dotbench/build`), including the two stage-0 acceptance
tests, with the SDK examples `power`, `imu` and `haptic` running UNMODIFIED. Branch `area/sensors`.

    export DOTBENCH_BUILD=/tmp/sens-clean
    tests/node/run.sh power | motion | haptic

## Seam

All three areas fake at the I2C level (`dotbench_i2c_chip_t`, registered from `khal_i2c_init`), exactly like
TCA6408A / KTD2026 / CST820. The SDK's real `kdrv_bq25896`, `kdrv_cw2217`, `kdrv_qmi8658`, `kdrv_qmc5883p`,
`kdrv_aw86233` and their Active Objects (AO_Power, AO_Imu, AO_Haptic, AO_LowPower facade) run unchanged. One
mutex per area, no SDK calls inside; chip accessors run on SDK task threads, exports on the page thread.
No GPIO or expander line is needed: the SDK polls all of these chips (the gauge INT pin is not used by the SDK).

One SDK file is superseded (see Shared-file notes): `components/kaos/lowpower/src/lowpower_none.c`.

## POWER (`runtime/drivers/power/`)

### Chips
BQ25896 @0x6B, registers modelled: REG00 (IINLIM, EN_HIZ), REG02 (CONV_START latches a one-shot ADC that is valid
1 s later, CONV_RATE = live values; both self-clearing bits cleared), REG03 (CHG_CONFIG, WD_RST self-clears,
SYS_MIN), REG04 (ICHG), REG05 (IPRECHG, ITERM), REG06 (VREG), REG07 (EN_TERM, watchdog bits stored), REG09
(BATFET_DIS / BATFET_DLY -> ship event; FORCE_ICO and PUMPX self-clear), REG0A, REG0B (VBUS_STAT, CHRG_STAT,
PG_STAT, VSYS_STAT, all live), REG0C (NTC fault code live, latch clears on read), REG0E..REG13 (BATV, SYSV, TSPCT,
VBUS_GD/VBUSV, ICHGR, IDPM_LIM), REG14 (REG_RST 0x80 resets all registers and leaves ship mode; PN/revision read
only, reset value 0x02).
Not modelled: watchdog expiry, ICO, DPDM detection timing, boost mode, PUMPX, interrupts (the INT line is not
wired), faults other than NTC, safety timer, VINDPM/IDPM tracking, REG08/REG0D contents beyond stored values.

CW2217 @0x64, registers modelled: 0x00 version (0xA0), 0x02/0x03 VCELL (5/16 mV per LSB), 0x04/0x05 SOC
(integer % then 1/256), 0x06 temperature ((T+40)*2), 0x08 CONFIG (0x00 active; 0x30 restart; 0xF0 shutdown;
ready 0xA7 = 0x0C about 1.5 s after the part becomes active), 0x0E/0x0F and 0xA8/0xA9 current (160 uA per LSB over
the 10 mOhm shunt, charging positive), 0xA6 SOH (100), 0xAB firmware/chip id (0x41), other bytes are plain storage.
Not modelled: the battery profile upload, alert/INT thresholds, cycle counting, SOH computation, real
VCELL noise, AVE_CURRENT (reads the instantaneous current).

### Virtual battery and curve
State of charge 0..100 % (default 80, unplugged, 25 C, load 90 mA). Open-circuit voltage is the SDK's own table
`kbsp_cell.h` interpolated linearly (mV/%): 3300/0, 3500/5, 3600/11, 3680/19, 3740/30, 3800/42, 3850/53, 3920/65,
3980/75, 4040/84, 4100/90, 4150/96, 4200/100. Terminal voltage = OCV + I * 180 mOhm (I into the cell positive), so
80 % is OCV 4013 mV (between 3980 at 75 % and 4040 at 84 %); unplugged on the default 90 mA load the terminal voltage is 4013 - 16 = 3997 mV, which is what the example logs.
Charging: CC at min(ICHG, 0.9 * IINLIM), then CV at VREG with tapering current; DONE when the taper falls to ITERM
(EN_TERM) , PRE when OCV < BATLOWV; blocked when the NTC says hot (>= 60 C) or cold (< 0 C). NTC codes: 0 ok,
2 warm 45-60, 3 cool 0-10, 5 cold, 6 hot. Plugging sets IINLIM (SDP 500 mA, adapter 3.25 A) like the real DPDM
result, clears BATFET_DIS and the shipped flag. Optional drift: `setSimSpeed(x)` integrates charge/load into the SoC.

### Events (JS, `dev.on("area:power:<type>")`)
`usb {plugged, cable}`, `charge {phase}`, `level {level, voltage}`, `low {level}` (below 15 %, re-arms at 20),
`ship {delayed, usb, delayMs, poweredOff}` (BATFET_DIS written: AO_Power's low-cell cut, the `ship_mode` console verb,
ship-on-unplug), `off {target, source, usb}` (the SDK asked AO_LowPower for power-off / rest).
The SDK-side `battery_low` (kode.h layer, level < 15 and not charging) is driven by the same registers; the test
suite checks the register path and the area `low` event, no kode.h test app was added.

### C exports
`power_set_level(double pct)`, `power_set_usb(int plugged, int kind /*1 SDP, 2 adapter*/)`, `power_set_temp(double c)`,
`power_set_load(int ma)`, `power_set_voltage(int mv /*OCV override, 0 = follow the curve*/)`,
`power_set_sim_speed(double)`, `power_get(int id)`, `power_event_pop(int32_t out[4])`, and the test hooks
`power_i2c_read/write(addr, reg, buf, len)`.

### JS API (`power.js`)
`level() setLevel(pct) voltage() setVoltage(mv|null) ocv() currentMa() charging() ("none"|"pre"|"fast"|"done")
isCharging() cable() ("none"|"usb"|"adapter") plug(on, kind) temperature() setTemperature(c) setLoad(ma)
setSimSpeed(x) shipped() gaugeReady() poll() on(type, cb)`.

## MOTION (`runtime/drivers/motion/`)

### Axis convention (source: `kbsp_board.h` identity maps)
The chips' axes are the board's: x to the right, y toward the top of the Dot, z out of the glass. The accelerometer
reads the reaction to gravity: flat face-up is (0, 0, +1 g). pitch = atan2(-ax, sqrt(ay^2 + az^2)), roll = atan2(ay, az)
(these are the definitions the imu example prints), heading = compass bearing of the top (y) axis, clockwise from
magnetic north, as `kcompass_heading()` computes. Earth's field in the world (east, north, up) is (0, 250, -380) mG by
default (mid-northern latitude, as kode-sim): flat and facing north the magnetometer reads (0, 250, -380); facing east
(heading 90) the board's x axis points south and reads (-250, 0, -380). Note the example's own printed heading is
atan2(my, mx) in the math sense (90 when facing north); the tests assert that formula, not the compass one.

### Chips
QMI8658A @0x6A, modelled: WHO_AM_I 0x05 and revision 0x7C; CTRL1 (reset 0x20 = big endian / no auto-increment; the
driver's 0x58 = little endian + auto-increment; the FIFO port never increments); CTRL2/CTRL3 (full scale: accel
16384 >> FS LSB per g, gyro 2048 >> FS LSB per dps; ODR codes: 6DOF 7174.4 ... 28 Hz when the gyro is on, accel-only
8000 ... 31 Hz; self-test bit 7); CTRL7 enables (accel valid after 3/ODR, gyro after 150 ms + 3/ODR, zero before);
CTRL8 handshake and CTRL9 commands (RST_FIFO, REQ_FIFO, STATUSINT bit 7); FIFO_CTRL (FIFO mode, 128 samples),
FIFO_CNT in words, FIFO_DATA streaming accel samples at the accel ODR; STATUSINT, STATUS0; the 14-byte burst at 0x33
(temperature 8.8 fixed about 30 C, accel, gyro) sampled at ODR boundaries; self-test dV registers 0x51..0x56
(1100 LSB accel, 8000 LSB gyro, ready 2 ms after the test starts); RESET 0x60 = 0xB0.
Values saturate at the programmed full scale. Not modelled: sensor noise and bias, CTRL5 low-pass filters, the
motion engines (tap, wake on motion, pedometer, no-motion), the on-chip AttitudeEngine, FIFO watermark/interrupt pins,
calibration commands, the gyro bias error (reads exactly 0 still). The FIFO overwrites its oldest samples when full
(the real part stops in FIFO mode; the SDK driver resets it, so reads are the same). The SDK has no tap or shake
detection, so a tap is only a short acceleration spike (`tap()`); the QMI tap engine is not used.

QMC5883P @0x2C, modelled: chip id 0x80, X/Y/Z little-endian at 0x01..0x06 (1000/2500/3750/15000 LSB per G for
ranges 30/12/8/2 G, saturating), STATUS DRDY (a finished conversion nobody has read; drops when the Z high byte is
read) and OVFL (field beyond the range), CTRL1 (mode: continuous = 3, suspend = 0; ODR 10/50/100/200 Hz),
CTRL2 (range bits 3:2; bit 6 self-test stimulus (-1500, 1500, 1500) mG for one read, after which the part parks
itself; bit 7 soft reset), 0x29 sign register stored. The stray address 0x0C NACKs. Not modelled: OSR/downsample
bits, set/reset period behaviour, temperature, noise.

### Orientation, gyro, shake, magnet
`setOrientation({pitch, roll, heading}, ms?)` interpolates (smoothstep, shortest heading path); default duration is
4 ms per degree of the biggest change (120 ms..2 s, about 375 deg/s), `0` jumps. The gyroscope is the true rotation
rate of that motion in the board frame (skew part of R(t-4 ms)^T R(t)), so it integrates to the angle and is 0 when
still. `shake({peak, ms, hz, dir})` adds a windowed sine acceleration (default 2.5 g, 400 ms, 7 Hz) to gravity.
`setMagnet({x,y,z})` adds a body-frame field in mG; beyond the range it sets OVFL.

### C exports
`motion_set_orientation(pitch, roll, heading, ms)`, `motion_shake(peak_g, ms, hz, dx, dy, dz)`,
`motion_set_magnet(mx, my, mz)`, `motion_set_field(horizontal_mg, down_mg)`, `motion_get(id)` (ideal world values and
the driver's programmed configuration), test hooks `motion_i2c_read/write`.

### JS API (`motion.js`)
`orientation() target() setOrientation(o, ms) moving() shaking() shake(opts) tap() setMagnet(v|null)
setField(h, d) accel() gyro() mag() config() on(type, cb)`; events `orientation`, `shake`, `magnet`.

## HAPTIC (`runtime/drivers/haptic/`)

AW86233 @0x5A, modelled: CHIPID 0x57 = 0x23 and 0x69 = 0x30; RSTCFG 0x00 = 0xAA soft reset (SYSCTRL2 = 0x40);
SYSST 0x01 FF_AFS (set at 1536 or more queued samples); PLAYCFG2 gain; PLAYCFG3 mode; PLAYCFG4 GO/STOP (GO needs RTP
mode and out of standby); RTPDATA 0x32 FIFO port (no auto-increment, 2048 deep, only accepted after GO, overflow
counted); GLBRD5 0x3F (8 while playing RTP); SYSCTRL2 0x46 (standby bit 6, rate bits 24/48/12 kHz). Playback
advances on the host clock at that rate; the chip leaves RTP by itself when the FIFO runs dry after playing.
Not modelled: ROM waveforms (the SDK driver only streams RTP, so there is no effect id), the haptic LRA resonance
tracking, trigger pins, brake, calibration, interrupts.

What the driver plays is captured as start `{gain, rateHz, playMode}` and stop `{durationMs, samples, peak}`.
The drive level published to the bridge field `haptic` (0..255, `haptic_seq` bumped on change) is
`(peak/127) * (gain/255) / 0.64` clamped to 1, so 1.0 is the strongest drive the SDK asks for (gain 80 % x peak 80 %).

C exports: `haptic_get(id)`, `haptic_poll()`, `haptic_event_pop(int32_t out[4])`, test hooks `haptic_i2c_read/write`.
JS API (`haptic.js`): `level() playing() standby() rateHz() buzzes() last() poll() on(type, cb) vibrate(navigator)`;
events `start`, `stop`, `level`.

## Scenarios

| Scenario | Result |
|---|---|
| power example: first reading 80 %, USB absent, not charging | pass |
| power example: plug / unplug logs and charging state | pass |
| power example: level change reaches the SDK's computed level | pass |
| power example: second bottom press -> `off` event, SDK still logs "did not take the request" | pass |
| power example: empty cell unplugged -> AO_Power cuts the cell -> `ship` event | pass |
| BQ25896 / CW2217 register tests (identity, config, status, ADC latency, NTC, ship, gauge wake) | pass |
| imu example: defaults, pitch/roll, gyro while moving and zero after, heading, magnet, shake, pause | pass |
| QMI8658A / QMC5883P register tests (identity, config, scales, ODR, enable delay, FIFO, self-test, DRDY/OVFL) | pass |
| haptic example: 400 ms buzz, bridge level and sequence, start/stop events, subscription API | pass |
| AW86233 register tests (identity, reset, GO/standby, FIFO AFS, run-dry, rate, level) | pass |
| Timing-sensitive tests re-run (haptic chip x12, motion chips x4, power and motion examples x2) | pass |

## Assumptions and deviations

- I did not read docs/bench-spec in depth; I worked from COMMON.md, the SDK sources and kode-sim. Where kode-sim and the SDK
  drivers disagreed the driver won. kode-sim's QMI8658 revision 0x7C is kept. The SDK comments (896.8 Hz with both sensors on)
  agree with the model.
- `CONFIG_KODE_LOWPOWER` depends on the radio and is off, so `kode_sys_power_off()` still returns KODE_DENIED and the
  power example's second press logs "AO_LowPower did not take the request". The area publishes `power:off` from
  its replacement of `lowpower_none.c`; it does not shut the page down (the page decides).
- Ship mode: the chips keep answering after BATFET_DIS (the page decides what a shipped Dot does); only
  `shipped()` flips, when it was an immediate cut with no USB.
- The gauge is found already active at power-on (CONFIG 0x00), as the SDK's wake sequence expects; FW id 0x41 is assumed.
- The gauge INT pin and the charger INT pin are not wired; AO_Power polls.
- PRE-charge is reachable only through `setVoltage` (an OCV below BATLOWV); the curve starts at 3300 mV.
- Haptic and accelerometer are not coupled (no vibration in the IMU while buzzing).
- No sensor noise anywhere; every value is exact up to ADC quantisation.
- Test hooks `*_i2c_read/write` are exported so register-level tests can talk to the models; they are test-only.
- The tests are hosted by `buttons_led` (chips tests) after the SDK's park pass (`AW86233 parked` log line).

## Shared-file notes

- `components/kaos/lowpower/src/lowpower_none.c` is superseded by power/lowpower_event.c (power area manifest). If another
  area supersedes the same file, one of the two must win; none is known.
- No change to shared files, the bridge layout (the existing `haptic`/`haptic_seq` fields are enough) or the build tool.

## Final passing output
```
### tests/node/run.sh power
== dotbench sdk
gen_stubs: 408 stub functions in 34 files
== dotbench build buttons_led
== dotbench build display_lvgl
== dotbench build power
== rtos unit tests
85 checks, 0 failed
ALL PASSED
== acceptance/buttons_led.test.mjs (Node)
ok   - boots and logs 'up; the top button swaps the colour'
ok   - LED becomes green (0,32,0)
ok   - top button press turns the LED red (32,0,0)
ok   - releasing the top button changes nothing (toggle is on press)
ok   - a second press toggles back to green
buttons_led: PASSED
== acceptance/display_lvgl.test.mjs (Node)
ok   - boots: LVGL up and the panel lit
ok   - framebuffer is non-uniform
ok   - touch changes the counter and the picture
ok   - top button press changes the counter
display_lvgl: PASSED
== power/chips.test.mjs (Node)
ok   - unregistered address NACKs
ok   - BQ25896 identity: REG14 reset value 0x02 (PN 000, DEV_REV 10)
ok   - BQ25896 read-only registers ignore writes
ok   - BQ25896 config registers store (ICHG, VREG, IINLIM)
ok   - cable status: none / SDP / adapter in REG0B
ok   - charging phase appears in CHRG_STAT (bits 4:3) and the battery current is positive
ok   - ADC one-shot: zero before CONV_START, valid 1 s after, bit self-clears
ok   - NTC: hot battery sets REG0C and blocks charging
ok   - ship mode: BATFET_DIS write raises a ship event; unplugged and not delayed = shipped
ok   - CW2217 identity and awake at power-on (CONFIG 0x00)
ok   - CW2217 readings follow the battery: VCELL, SOC, TEMP, CURRENT
ok   - CW2217 restart sequence 0xF0 -> 0x30 -> 0x00: not ready, then ready after ~1.5 s
ok   - glue: level/voltage/cable/temperature API and defaults
power chips: PASSED (13 ok, 0 failed)
== power/example.test.mjs (Node)
ok   - defaults: first reading 80 %, ~3997 mV, USB absent, not charging
ok   - plugging USB logs 'USB plugged in' and the charger starts
ok   - top button prints the battery with charging state
ok   - unplugging logs 'USB unplugged' and charging stops
ok   - changing the level moves the reading the SDK computes (80 -> 70 %; the AO slews 2 % per poll)
ok   - bottom button arms; a second press asks for power-off and the app sees power:off
ok   - empty cell on battery makes AO_Power cut the cell: ship event reaches the app
power example: PASSED (7 ok, 0 failed)
ALL TESTS PASSED
### tests/node/run.sh motion
== dotbench sdk
gen_stubs: 408 stub functions in 34 files
== dotbench build buttons_led
== dotbench build display_lvgl
== dotbench build imu
== rtos unit tests
85 checks, 0 failed
ALL PASSED
== acceptance/buttons_led.test.mjs (Node)
ok   - boots and logs 'up; the top button swaps the colour'
ok   - LED becomes green (0,32,0)
ok   - top button press turns the LED red (32,0,0)
ok   - releasing the top button changes nothing (toggle is on press)
ok   - a second press toggles back to green
buttons_led: PASSED
== acceptance/display_lvgl.test.mjs (Node)
ok   - boots: LVGL up and the panel lit
ok   - framebuffer is non-uniform
ok   - touch changes the counter and the picture
ok   - top button press changes the counter
display_lvgl: PASSED
== motion/chips.test.mjs (Node)
ok   - QMI8658A identity: WHO_AM_I 0x05, revision 0x7C; unknown address NACKs
ok   - QMI8658A CTRL1 reset is 0x20 (big endian, no auto-increment) and the config registers store
ok   - accelerometer flat, face up, +-8 g: z = +4096 LSB (+1 g), x = y = 0; gyro 0; temperature ~30 C
ok   - accelerometer follows pitch/roll: pitch 30 gives ax = -sin(30) g, az = cos(30) g
ok   - the full-scale range the driver programs sets the LSB size (+-2/4/8/16 g)
ok   - a large shake saturates the +-2 g range instead of wrapping
ok   - gyroscope: rates while the orientation changes (integral = the angle), zero when still, +-512 dps scale
ok   - data is zero before the enable settles: gyro needs 150 ms + 3/ODR
ok   - ODR the driver programs: accel-only 1000 Hz at code 3, both sensors 896.8 Hz
ok   - FIFO: FIFO mode fills at the accel ODR up to 128 samples; the count is in words; the data is the gravity
ok   - CTRL9 handshake: with CTRL8 bit 7 the command-done flag appears in STATUSINT bit 7 and clears on CTRL9=0
ok   - self-test: accel stimulus reads 1100 dV LSB after the test time, gyro 8000; flag clears
ok   - QMC5883P identity: chip id 0x80 at 0; the stray address 0x0C NACKs
ok   - QMC5883P suspended by default: no DRDY; CTRL1 = 0x07 starts 50 Hz continuous
ok   - magnetometer follows the heading (east: field north along -x) and tilt
ok   - magnet near: adds to the field; beyond the programmed range sets OVFL; a wider range clears it
ok   - range changes the LSB per gauss (2500/3750/15000 LSB per G)
ok   - self-test: the +-1.5 G stimulus appears for one read, then the part parks in suspend
ok   - suspend (CTRL1 = 0) stops the conversions; soft reset clears the config
motion chips: PASSED (19 ok, 0 failed)
== motion/example.test.mjs (Node)
ok   - defaults: flat face-up, heading north: a=(0,0,1000) mg, w=0, pitch=roll=0, m=(0,250,-380) mG
ok   - pitch 20, roll -15 gives the accelerometer gravity and the example's pitch/roll
ok   - moving: the gyro reports rates while the orientation changes and 0 once still
ok   - heading east turns the magnetometer: field north now along -x; the log tracks it
ok   - a magnet near the sensor adds its field and the log shows it
ok   - a shake burst shows up as acceleration well above 1 g in the log
ok   - the driver's programmed ranges and rates are what the model honours
ok   - top button pauses the example (no new lines), top again resumes
motion example: PASSED (8 ok, 0 failed)
ALL TESTS PASSED
### tests/node/run.sh haptic
== dotbench sdk
gen_stubs: 408 stub functions in 34 files
== dotbench build buttons_led
== dotbench build display_lvgl
== dotbench build haptic
== rtos unit tests
85 checks, 0 failed
ALL PASSED
== acceptance/buttons_led.test.mjs (Node)
ok   - boots and logs 'up; the top button swaps the colour'
ok   - LED becomes green (0,32,0)
ok   - top button press turns the LED red (32,0,0)
ok   - releasing the top button changes nothing (toggle is on press)
ok   - a second press toggles back to green
buttons_led: PASSED
== acceptance/display_lvgl.test.mjs (Node)
ok   - boots: LVGL up and the panel lit
ok   - framebuffer is non-uniform
ok   - touch changes the counter and the picture
ok   - top button press changes the counter
display_lvgl: PASSED
== haptic/chip.test.mjs (Node)
ok   - identity: CHIPID 0x57 = 0x23 and 0x69 = 0x30
ok   - soft reset 0xAA: SYSCTRL2 = 0x40 (standby), gain restored
ok   - config registers store: gain, mode
ok   - GO ignored in standby; plays out of standby
ok   - level = (peak/127) * (gain/255) / 0.64 on the bridge, 0 when stopped
ok   - half the sample peak gives half the drive (before the full-drive normalisation)
ok   - FIFO: bytes before GO are not played; FF_AFS (SYSST bit 3) is set at 1536 queued and clears as it drains
ok   - the chip leaves RTP itself when the FIFO runs dry; stop event reports samples
ok   - SYSCTRL2 rate bits: 24 kHz and 48 kHz are honoured
ok   - unknown address NACKs
haptic chip: PASSED (10 ok, 0 failed)
== haptic/example.test.mjs (Node)
ok   - chip is found (no 'no AW86233' warning) and idle at 0
ok   - bottom button: a 400 ms buzz is logged, the bridge level goes up then back to 0
ok   - start/stop events carry what the driver programmed
ok   - the level stayed high for about the buzz length
ok   - top button: a tick buzz also plays and is logged
ok   - subscription API: on('start') receives events; unsubscribe stops them
haptic example: PASSED (6 ok, 0 failed)
ALL TESTS PASSED
```
