/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_sdmmc for the web: a virtual microSD card. Its sectors live in persistent region "sd-card" (up to
 * 32 MiB), its identity and slot state in region "dev-state" (inserted, capacity, serial, write protect).
 * The FAT volume is FatFs drive 1 (runtime/drivers/storage). kdrv_sd.c, the real SDK file, runs on top.
 *
 * Slot behaviour (the SDK has no card-detect event; neither does this):
 *  - pulling the card while idle: khal_sdmmc_mounted() turns false at once, raw and file I/O fail (EIO /
 *    KODE_DENIED), nothing is lost on the card.
 *  - pulling it during a write: the sector in flight is not written, sectors before it are; the file system
 *    is as consistent as a FAT is after a power cut (no journal). Re-insert, `sd_mount`, and it mounts.
 *  - inserting a card does not mount it: the firmware mounts explicitly (sd_mount / the boot probe), as it
 *    does on the board.
 *  - a blank card (no FAT) answers like the board does: KODE_IO_ERROR from mount. */
#include <string.h>
#include "khal_sdmmc.h"
#include "kode_log.h"
#include "dotbench_persist.h"
#include "dotbench_vfs.h"

#define TAG "khal.sdmmc"

static bool s_hosted;

bool khal_sdmmc_ready(void) { return true; }
void khal_sdmmc_set_hosted(bool h) { s_hosted = h; }
bool khal_sdmmc_hosted(void) { return s_hosted; }
const char *khal_sdmmc_mount_point(void) { return dbv_mount_point(DBV_SD); }
bool khal_sdmmc_mounted(void) { return dbv_mounted(DBV_SD) != 0; }

static void identify(uint8_t width, uint32_t max_khz, khal_sdmmc_card_t *c)
{
    dbp_devstate_t *d = dbp_devstate();
    memset(c, 0, sizeof *c);
    c->mfg_id = 0x03; c->oem_id = 0x5344; memcpy(c->name, "DOTSD", 6); c->revision = 0x10;
    c->serial = d->sd_serial; c->date = (uint16_t)((26u << 4) | 1u);
    c->csd_ver = 1; c->sectors = dbd_sd_sectors(); c->sector_size = 512; c->read_block_len = 512;
    c->ccc = 0x5B5; c->tr_speed_khz = 25000; c->sd_spec = 3; c->bus_widths = 0x5; c->erase_state = false;
    c->au_kb = 4; c->erase_size_au = 1; c->discard = true; c->high_capacity = true;
    c->bus_width = width; c->max_freq_khz = 25000;
    c->freq_khz = (max_khz && max_khz < 25000) ? max_khz : 20000;
    c->rca = 1;
}

kode_status_t khal_sdmmc_mount(uint8_t width, uint32_t max_khz, khal_sdmmc_card_t *out)
{
    if ((width != 1 && width != 4) || dbv_mounted(DBV_SD)) return KODE_DENIED;
    if (!dbd_sd_present()) return KODE_TIMEOUT;               /* nobody answered */
    int r = dbv_mount(DBV_SD, 0, NULL);
    if (r != 0) {
        KLOG_D(TAG, "%d-bit mount at %lukHz: FatFs %d", (int)width, (unsigned long)max_khz, r);
        return (r == 13 /* FR_NO_FILESYSTEM */) ? KODE_IO_ERROR : KODE_ERROR;
    }
    if (out) identify(width, max_khz, out);
    return KODE_OK;
}

void khal_sdmmc_unmount(void) { dbv_unmount(DBV_SD); }

kode_status_t khal_sdmmc_info(uint64_t *total, uint64_t *free_bytes)
{
    if (!dbv_mounted(DBV_SD)) return KODE_DENIED;
    uint64_t t = 0, f = 0;
    if (dbv_info(DBV_SD, &t, &f) != 0) return KODE_ERROR;
    if (total) *total = t;
    if (free_bytes) *free_bytes = f;
    return KODE_OK;
}

uint32_t khal_sdmmc_cluster_bytes(void) { return dbv_cluster_bytes(DBV_SD); }

kode_status_t khal_sdmmc_format(void)
{
    if (!dbv_mounted(DBV_SD)) return KODE_DENIED;
    KLOG_I(TAG, "formatting the card (%u sectors)", (unsigned)dbd_sd_sectors());
    return dbv_format(DBV_SD) == 0 ? KODE_OK : KODE_ERROR;
}

kode_status_t khal_sdmmc_read_sectors(uint32_t first, uint32_t count, void *dst)
{
    if (!dbv_mounted(DBV_SD) || !dst || !count) return KODE_DENIED;
    return dbd_sd_read(first, count, dst) == 0 ? KODE_OK : KODE_ERROR;
}

kode_status_t khal_sdmmc_write_sectors(uint32_t first, uint32_t count, const void *src)
{
    if (!dbv_mounted(DBV_SD) || !src || !count) return KODE_DENIED;
    return dbd_sd_write(first, count, src) == 0 ? KODE_OK : KODE_ERROR;
}
