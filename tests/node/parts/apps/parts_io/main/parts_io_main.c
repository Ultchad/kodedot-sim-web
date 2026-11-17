/* SPDX-License-Identifier: GPL-3.0-or-later
 * parts_io: the Kode Dot blinks an LED part and reads a button part through the J3 expansion header.
 *   EXP4 drives the LED (anode; cathode to GND)           EXP6 reads a push button wired between 3V3 and EXP6 (no pull: it reads 0 while open)
 * Every change is logged: "led 1", "button down". */
#include <stdbool.h>
#include <stdint.h>

#include "kode.h"
#include "kode_log.h"

KODE_APP_MANIFEST("Parts IO", "test");
#define TAG "parts_io"
#define LED_POS 4U
#define BTN_POS 6U
#define STEPS_PER_BLINK 10U
#define STEP_MS 20U

void app_main(void)
{
    bool led = false, last = false;

    kode_init();
    KLOG_I(TAG, "3V3 rail on: %d", (int)kode_pin_power_3v3(true));
    KLOG_I(TAG, "parts_io up");
    for ( ;; )
    {
        led = !led;
        (void)kode_pin_write(LED_POS, led);
        KLOG_I(TAG, "led %d", (int)led);
        for ( uint32_t i = 0U; i < STEPS_PER_BLINK; i++ )
        {
            const bool b = kode_pin_read(BTN_POS);
            if ( b != last )
            {
                last = b;
                KLOG_I(TAG, "button %s", b ? "down" : "up");
            }
            kode_delay(STEP_MS);
        }
    }
}
