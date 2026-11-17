/* SPDX-License-Identifier: GPL-3.0-or-later
 * parts_i2c: the Kode Dot reads an HDC1080 temperature and humidity sensor (I2C 0x40) on EXP4 (SDA) and EXP5 (SCL).
 * Logs "probe 0x40 yes", "manufacturer 0x5449", "temp raw=0x6285 23.50 C", "humidity raw=0x7333 45.0 %". */
#include <stdbool.h>
#include <stdint.h>

#include "kode.h"
#include "kode_log.h"

KODE_APP_MANIFEST("Parts I2C", "test");
#define TAG "parts_i2c"
#define ADDR 0x40U

static bool reg16(uint8_t reg, uint16_t *out)
{
    uint8_t raw[2];
    if ( !kode_i2c_write_read(ADDR, &reg, 1U, raw, 2U) ) { return false; }
    *out = (uint16_t)(((uint16_t)raw[0] << 8) | raw[1]);
    return true;
}

void app_main(void)
{
    uint16_t v;

    kode_init();
    KLOG_I(TAG, "3V3 rail on: %d", (int)kode_pin_power_3v3(true));
    if ( !kode_i2c_begin(4U, 5U, 100000U) ) { KLOG_E(TAG, "bus did not begin: %s", kode_error()); }
    KLOG_I(TAG, "probe 0x40 %s", kode_i2c_probe(ADDR) ? "yes" : "no");
    KLOG_I(TAG, "probe 0x41 %s", kode_i2c_probe(0x41U) ? "yes" : "no");
    if ( reg16(0xFEU, &v) ) { KLOG_I(TAG, "manufacturer 0x%04X", (unsigned)v); }
    else { KLOG_W(TAG, "no manufacturer id: %s", kode_error()); }
    for ( ;; )
    {
        if ( reg16(0x00U, &v) )
        {
            const int32_t centi = ((int32_t)v * 16500) / 65536 - 4000;
            KLOG_I(TAG, "temp raw=0x%04X %ld.%02ld C", (unsigned)v, (long)(centi / 100), (long)(centi % 100));
        }
        else { KLOG_W(TAG, "no temperature: %s", kode_error()); }
        if ( reg16(0x01U, &v) )
        {
            const int32_t tenth = ((int32_t)v * 1000) / 65536;
            KLOG_I(TAG, "humidity raw=0x%04X %ld.%ld %%", (unsigned)v, (long)(tenth / 10), (long)(tenth % 10));
        }
        kode_delay(250U);
    }
}
