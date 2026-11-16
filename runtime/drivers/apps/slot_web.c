/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_slot.c stays superseded (OTA slots, otadata and the coredump partition do not exist here); the stubs it leaves behind are right
 * except one: AO_Boot reads kdrv_otadata_blank() to tell "the rescue image took over" (factory running, otadata not blank) from a
 * normal boot. A generated stub answers false, which reads as a rescue and turns every boot into KBOOT_UNEXPECTED
 * ("a kodeOS update never confirmed"). There is no otadata here, so it is blank. */
#include <stdbool.h>
#include "kdrv_slot.h"

bool kdrv_otadata_blank(void) { return true; }
