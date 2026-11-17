/* SPDX-License-Identifier: GPL-3.0-or-later
 * parts_robotics: the Kode Dot drives two DC motors and a servo through the Kode Robotics module, mounted upright on J3.
 * Pin positions (SDK numbering) of the module's upright map: AIN2 = 8 (GPIO21), nSLEEP = 9 (GPIO19), AIN1 = 10 (GPIO20), BIN1 = 6 (GPIO13), BIN2 = 7 (GPIO14), servo = 4 (GPIO11).
 * It follows the module's documented usage: wake the driver (nSLEEP high), hold one input and pulse the other at 20 kHz, servo at 50 Hz. Every phase is logged. */
#include <stdbool.h>
#include <stdint.h>

#include "kode.h"
#include "kode_log.h"

KODE_APP_MANIFEST("Parts Robotics", "test");
#define TAG "parts_robotics"
#define POS_AIN2 8U
#define POS_NSLEEP 9U
#define POS_AIN1 10U
#define POS_BIN1 6U
#define POS_BIN2 7U
#define POS_SERVO 4U
#define PWM_HZ 20000U
#define PHASE_MS 600U

static void stop_all(void)
{
    (void)kode_pin_write(POS_AIN1, false);
    (void)kode_pin_write(POS_AIN2, false);
    (void)kode_pin_write(POS_BIN1, false);
    (void)kode_pin_write(POS_BIN2, false);
}

void app_main(void)
{
    kode_init();
    KLOG_I(TAG, "3V3 rail on: %d", (int)kode_pin_power_3v3(true));
    KLOG_I(TAG, "5V rail on: %d", (int)kode_pin_power_5v(true));      /* on battery the motors need the boost; on USB the 5 V is there anyway */
    KLOG_I(TAG, "parts_robotics up");
    for ( ;; )
    {
        (void)kode_pin_write(POS_NSLEEP, true);
        KLOG_I(TAG, "phase motor A forward");
        (void)kode_pin_write(POS_AIN2, false);
        (void)kode_pin_write_pwm(POS_AIN1, PWM_HZ, 60U);
        kode_delay(PHASE_MS);
        stop_all();
        KLOG_I(TAG, "phase motor B reverse, servo 83");
        (void)kode_pin_write(POS_BIN1, false);
        (void)kode_pin_write_pwm(POS_BIN2, PWM_HZ, 60U);
        (void)kode_pin_write_pwm(POS_SERVO, 50U, 7U);
        kode_delay(PHASE_MS);
        stop_all();
        KLOG_I(TAG, "phase asleep, servo 180");
        (void)kode_pin_write_pwm(POS_SERVO, 50U, 12U);
        (void)kode_pin_write(POS_NSLEEP, false);
        (void)kode_pin_write(POS_AIN1, true);
        kode_delay(PHASE_MS);
        (void)kode_pin_write(POS_AIN1, false);
    }
}
