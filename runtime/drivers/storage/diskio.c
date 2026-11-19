/* SPDX-License-Identifier: GPL-3.0-or-later
 * FatFs disk layer on persistent regions. All stores go through dbp_write so dirty tracking and the
 * power-cut fault injection apply. A card that is not inserted answers NOTRDY: a sector that was already
 * written stays written, the one in flight is not (sector writes are atomic here; a multi-sector write
 * stops between sectors). */
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <stdatomic.h>
#include "fatfs/ff.h"
#include "fatfs/diskio.h"
#include "dotbench_persist.h"
#include "dotbench_vfs.h"

/* Neither .bss nor calloc: with shared memory the linker initialises .bss with a memory.fill and calloc clears, which commits
 * every page. sbrk() hands out fresh wasm pages that nothing has written: zero, and uncommitted until something is stored.
 * The microSD's sectors (sparse store, runtime/drivers/sd/sdcard.c) have their own regions; this file only has the flash. */
static uint8_t *s_flash;
static uint8_t *zalloc64(size_t n)
{
    void *p = sbrk((intptr_t)(n + 64));
    return (p == (void *)-1) ? NULL : (uint8_t *)(((uintptr_t)p + 63u) & ~(uintptr_t)63u);
}
static dbp_region_t *r_flash;

__attribute__((constructor(120))) static void disk_ctor(void)
{
    s_flash = zalloc64(DBV_FLASH_BYTES);
    r_flash = dbp_register("flash-fs", s_flash, DBV_FLASH_BYTES, 0);
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

/* The raw view: the `storage` partition as kdrv_apps.c (firmware sink for a whole FAT image) sees it. */
int dbd_flash_raw_read(uint32_t off, void *dst, uint32_t len)
{
    if (!s_flash || off > DBV_FLASH_BYTES || len > DBV_FLASH_BYTES - off) return -1;
    memcpy(dst, s_flash + off, len);
    return 0;
}

int dbd_flash_raw_write(uint32_t off, const void *src, uint32_t len)
{
    if (!s_flash || off > DBV_FLASH_BYTES || len > DBV_FLASH_BYTES - off) return -1;
    const uint8_t *in = src;
    uint8_t tmp[256];
    for (uint32_t done = 0; done < len;) {
        uint32_t n = len - done < sizeof tmp ? len - done : (uint32_t)sizeof tmp;
        for (uint32_t i = 0; i < n; i++) tmp[i] = (uint8_t)(s_flash[off + done + i] & in[done + i]);
        dbp_write(r_flash, off + done, tmp, n);
        done += n;
    }
    return 0;
}

int dbd_flash_raw_erase(uint32_t off, uint32_t len)
{
    if (!s_flash || off > DBV_FLASH_BYTES || len > DBV_FLASH_BYTES - off) return -1;
    dbp_fill(r_flash, off, 0xFF, len);
    return 0;
}
