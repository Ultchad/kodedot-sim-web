/* SPDX-License-Identifier: GPL-3.0-or-later
 * kodeos role only. Hand-written "not supported" stubs for functions of the superseded kdrv files that are NOT
 * declared in a public khal/kdrv header (gen_stubs.py only sees public headers) but that other compiled SDK files
 * call. Same policy as the generated stubs: log once, return failure.
 *
 * Replaced by: the radio engineer (kdrv_ble_app_host_bytes) and the exp/station engineer
 * (kdrv_station_i2c_*) when they take over the superseded kdrv_radio_*, kdrv_ble and kdrv_station_i2c files. */
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include "kode_defs.h"
#include "dotbench_stub.h"

/* esp-hosted: tells the C5 the host is entering/leaving light sleep (kdrv_radio_sleep.c). The radio area's C5 is a fake that
 * needs no such notice, so this succeeds (it used to be a logged failure while kdrv_radio was stubbed). */
int bus_inform_slave_host_power_save_start(void) { return 0; }
int bus_inform_slave_host_power_save_stop(void) { return 0; }

/* kdrv_ble.c: size of the BLE host's share of the app-data block (kdrv_ble_app.c). 0: no host state. */
size_t kdrv_ble_app_host_bytes(void)
{
    DOTBENCH_UNIMPLEMENTED(kdrv_ble_app_host_bytes);
    return 0;
}

/* kdrv_station_i2c.c: the E5 station's private I2C bus, used by kdrv_pcf8574.c and kdrv_ads1115.c */
kode_status_t kdrv_station_i2c_write(uint8_t addr, const uint8_t *tx, size_t n)
{
    (void)addr; (void)tx; (void)n;
    DOTBENCH_UNIMPLEMENTED(kdrv_station_i2c_write);
    return KODE_ERROR;
}

kode_status_t kdrv_station_i2c_write_read(uint8_t addr, const uint8_t *tx, size_t ntx, uint8_t *rx, size_t nrx)
{
    (void)addr; (void)tx; (void)ntx; (void)rx; (void)nrx;
    DOTBENCH_UNIMPLEMENTED(kdrv_station_i2c_write_read);
    return KODE_ERROR;
}

bool kdrv_station_i2c_probe(uint8_t addr)
{
    (void)addr;
    DOTBENCH_UNIMPLEMENTED(kdrv_station_i2c_probe);
    return false;
}
