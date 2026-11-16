/* SPDX-License-Identifier: GPL-3.0-or-later
 * Boot facts the host hands the firmware (see kweb_state_t "boot and reset"), and the
 * retention store. These replace the parts of kdrv_slot.c / khal_keep_esp.c the boot
 * banner and AO_Boot read:
 *   kdrv_reset_reason()   the reason the host gave this boot (KWEB_RESET_*)
 *   kdrv_running_desc()   name/version of the running program, from its app.json
 *   khal_keep*()          a 1 MiB block that survives a restart: it is a persist region,
 *                         so the host copies it into the next boot. Power-on starts zeroed. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "kdrv_slot.h"
#include "khal_keep.h"
#include "kweb_bridge.h"

int kdrv_reset_reason(void)
{
    uint32_t r = kweb_state()->boot_reason;
    return (int)(r ? r : KWEB_RESET_POWERON);
}

kode_status_t kdrv_running_desc(kdrv_slot_desc_t *out)
{
    if (!out) return KODE_DENIED;
    const kweb_state_t *s = kweb_state();
    memset(out, 0, sizeof *out);
    snprintf(out->project, sizeof out->project, "%s", s->boot_name[0] ? (const char *)s->boot_name : "dotbench");
    snprintf(out->version, sizeof out->version, "%s", s->boot_version[0] ? (const char *)s->boot_version : "0.0.0");
    snprintf(out->date, sizeof out->date, "%s", __DATE__);
    snprintf(out->time, sizeof out->time, "%s", __TIME__);
    snprintf(out->idf_ver, sizeof out->idf_ver, "6.1 (dotbench)");
    return KODE_OK;
}

bool kdrv_running_is_factory(void) { return true; }

/* ---- keep ---- */
static uint8_t g_keep[KHAL_KEEP_BYTES] __attribute__((aligned(64)));
__attribute__((constructor(110))) static void keep_register(void)
{
    kweb_persist_register("keep", g_keep, sizeof g_keep);
}
void khal_keep_init(void) { }
void *khal_keep(void) { return g_keep; }
void khal_keep_sync(size_t off, size_t len) { (void)off; (void)len; }
void khal_keep_forget_warm(void) { }
