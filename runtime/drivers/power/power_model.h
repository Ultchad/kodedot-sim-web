/* SPDX-License-Identifier: GPL-3.0-or-later
 * Internal to runtime/drivers/power: what power_model.c shares with lowpower_event.c. */
#ifndef DOTBENCH_POWER_MODEL_H
#define DOTBENCH_POWER_MODEL_H
#include <stdbool.h>
enum { PWR_EV_SHIP = 1, PWR_EV_OFF = 2 };
/* Queue an event for the page: type, then three ints (power_event_pop copies them out). */
void dotbench_power_event(int type, int a, int b, int c);
bool dotbench_power_usb(void);
#endif
