/* SPDX-License-Identifier: GPL-3.0-or-later
 * The low-power facade of a build without CONFIG_KODE_LOWPOWER, as the SDK's
 * components/kaos/lowpower/src/lowpower_none.c has it (the option needs the radio, which the web
 * build does not have), with one addition: a request to sleep or switch off is also published
 * to the page as a power:off event, so it is observable instead of only logged.
 * The answer to the app is unchanged: kode_sys_power_off() still returns KODE_DENIED. */
#include "kaos.h"
#include "kode_log.h"
#include "power_model.h"

#define TAG "kaos.lowpower"
#define NOT_BUILT "not built"

void lowpower_request(kode_lp_state_t target, uint8_t src)
{
    dotbench_power_event(PWR_EV_OFF, (int)target, (int)src, dotbench_power_usb() ? 1 : 0);
    KLOG_W(TAG, "low power not built: the request is refused");
}

bool lowpower_request_rest(uint8_t src)
{
    dotbench_power_event(PWR_EV_OFF, (int)KODE_LP_ASLEEP, (int)src, dotbench_power_usb() ? 1 : 0);
    KLOG_W(TAG, "low power not built: the request to rest is refused");
    return false;
}

void lowpower_input_note(uint8_t src)
{
    (void)src;
}

const char *lowpower_last_refusal(void)
{
    return NOT_BUILT;
}
