/* SPDX-License-Identifier: GPL-3.0-or-later
 * FatFs disk layer on persistent regions. All stores go through dbp_write so dirty tracking and the
 * power-cut fault injection apply. A card that is not inserted answers NOTRDY: a sector that was already
 * written stays written, the one in flight is not (sector writes are atomic here; a multi-sector write
 * stops between sectors). */
#include <string.h>
#include <stdatomic.h>
#include "fatfs/ff.h"
#include "fatfs/diskio.h"
#include "dotbench_persist.h"
#include "dotbench_vfs.h"

static uint8_t s_flash[DBV_FLASH_BYTES] __attribute__((aligned(64)));
static uint8_t s_sd[DBV_SD_MAX_MB << 20] __attribute__((aligned(64)));
static dbp_region_t *r_flash, *r_sd;

__attribute__((constructor(120))) static void disk_ctor(void)
{
    r_flash = dbp_register("flash-fs", s_flash, sizeof s_flash, 0);
    r_sd    = dbp_register("sd-card",  s_sd,    sizeof s_sd,    0);
}

static uint32_t sd_cap_mb(void)
{
    uint32_t mb = dbp_devstate()->sd_capacity_mb;
    return (mb < DBV_SD_MIN_MB) ? 8u : (mb > DBV_SD_MAX_MB ? DBV_SD_MAX_MB : mb);
}

int      dbd_sd_present(void) { return dbp_devstate()->sd_inserted != 0; }
uint32_t dbd_sd_sectors(void) { return sd_cap_mb() * 2048u; }

int dbd_sd_read(uint32_t first, uint32_t count, void *dst)
{
    if (!dbd_sd_present() || (uint64_t)first + count > dbd_sd_sectors()) return -1;
    memcpy(dst, s_sd + (size_t)first * 512u, (size_t)count * 512u);
    return 0;
}

int dbd_sd_write(uint32_t first, uint32_t count, const void *src)
{
    if ((uint64_t)first + count > dbd_sd_sectors() || dbp_devstate()->sd_write_protect) return -1;
    for (uint32_t i = 0; i < count; i++) {
        if (!dbd_sd_present()) return -1;               /* pulled mid-write: stop between sectors */
        dbp_write(r_sd, (first + i) * 512u, (const uint8_t *)src + (size_t)i * 512u, 512u);
    }
    return 0;
}

DSTATUS disk_status(BYTE pdrv)
{
    if (pdrv == DBV_FLASH) return 0;
    if (pdrv == DBV_SD) {
        if (!dbd_sd_present()) return STA_NOINIT | STA_NODISK;
        return dbp_devstate()->sd_write_protect ? STA_PROTECT : 0;
    }
    return STA_NOINIT;
}

DSTATUS disk_initialize(BYTE pdrv) { return disk_status(pdrv); }

DRESULT disk_read(BYTE pdrv, BYTE *buff, LBA_t sector, UINT count)
{
    if (pdrv == DBV_FLASH) {
        if ((uint64_t)sector + count > DBV_FLASH_BYTES / 4096u) return RES_PARERR;
        memcpy(buff, s_flash + (size_t)sector * 4096u, (size_t)count * 4096u);
        return RES_OK;
    }
    if (pdrv == DBV_SD) {
        if (!dbd_sd_present()) return RES_NOTRDY;
        return dbd_sd_read((uint32_t)sector, count, buff) == 0 ? RES_OK : RES_PARERR;
    }
    return RES_PARERR;
}

DRESULT disk_write(BYTE pdrv, const BYTE *buff, LBA_t sector, UINT count)
{
    if (pdrv == DBV_FLASH) {
        if ((uint64_t)sector + count > DBV_FLASH_BYTES / 4096u) return RES_PARERR;
        dbp_write(r_flash, (uint32_t)sector * 4096u, buff, count * 4096u);
        return RES_OK;
    }
    if (pdrv == DBV_SD) {
        if (!dbd_sd_present()) return RES_NOTRDY;
        if (dbp_devstate()->sd_write_protect) return RES_WRPRT;
        return dbd_sd_write((uint32_t)sector, count, buff) == 0 ? RES_OK : RES_NOTRDY;
    }
    return RES_PARERR;
}

DRESULT disk_ioctl(BYTE pdrv, BYTE cmd, void *buff)
{
    if (pdrv >= DBV_COUNT) return RES_PARERR;
    if (pdrv == DBV_SD && !dbd_sd_present()) return RES_NOTRDY;
    switch (cmd) {
    case CTRL_SYNC: return RES_OK;
    case GET_SECTOR_COUNT: *(LBA_t *)buff = (pdrv == DBV_FLASH) ? DBV_FLASH_BYTES / 4096u : dbd_sd_sectors(); return RES_OK;
    case GET_SECTOR_SIZE:  *(WORD *)buff = (pdrv == DBV_FLASH) ? 4096 : 512; return RES_OK;
    case GET_BLOCK_SIZE:   *(DWORD *)buff = 1; return RES_OK;
    default: return RES_PARERR;
    }
}
