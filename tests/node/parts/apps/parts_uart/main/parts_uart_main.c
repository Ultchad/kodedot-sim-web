/* SPDX-License-Identifier: GPL-3.0-or-later
 * parts_uart: the Kode Dot talks to an ESP32 part running a real sketch that echoes UART1.
 *   TX on EXP9 (wire it to the part's RX), RX on EXP10 (wire it to the part's TX), 115200 baud 8N1.
 * Every 300 ms it sends "ping N\n" and logs what comes back: "reply <bytes>". */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "kode.h"
#include "kode_log.h"

KODE_APP_MANIFEST("Parts UART", "test");
#define TAG "parts_uart"

void app_main(void)
{
    uint32_t n = 0U;
    char out[32], in[64];

    kode_init();
    KLOG_I(TAG, "3V3 rail on: %d", (int)kode_pin_power_3v3(true));
    if ( !kode_uart_begin(9U, 10U, 115200U) ) { KLOG_E(TAG, "uart did not begin: %s", kode_error()); }
    KLOG_I(TAG, "parts_uart up");
    for ( ;; )
    {
        const int len = snprintf(out, sizeof out, "ping %lu\n", (unsigned long)++n);
        (void)kode_uart_write((const uint8_t *)out, (size_t)len);
        size_t got = kode_uart_read((uint8_t *)in, sizeof in - 1U, 250U);
        in[got] = '\0';
        for ( size_t i = 0U; i < got; i++ ) { if ( in[i] == '\n' || in[i] == '\r' ) { in[i] = '|'; } }
        KLOG_I(TAG, "reply %lu: %s", (unsigned long)n, got ? in : "(nothing)");
        kode_delay(50U);
    }
}
