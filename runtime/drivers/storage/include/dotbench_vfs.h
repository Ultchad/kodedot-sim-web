/* SPDX-License-Identifier: GPL-3.0-or-later
 * dotbench volume layer: FatFs on two persistent regions.
 *   volume 0  "flash-fs"  2 MiB, 4096-byte sectors, mounted at /storage  (partitions.csv: storage 0x200000)
 *   volume 1  "sd-card"   virtual card, 2..32 MiB (dev-state), 512-byte sectors, mounted at /sdcard
 * Internal header shared by the storage and sd drivers. Page-side API: runtime/drivers/storage/storage.js. */
#ifndef DOTBENCH_VFS_H
#define DOTBENCH_VFS_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

#define DBV_FLASH 0
#define DBV_SD    1
#define DBV_COUNT 2
#define DBV_FLASH_BYTES (2u << 20)
#define DBV_SD_MAX_MB   32u
#define DBV_SD_MIN_MB   2u

int      dbv_vol_of(const char *vpath);                 /* 0, 1, or -1 when the path names no volume */
const char *dbv_mount_point(int vol);                   /* "/storage", "/sdcard" */
int      dbv_mount(int vol, int format_if_blank, int *formatted);  /* 0 ok, else a FRESULT (FR_NO_FILESYSTEM = blank) */
void     dbv_unmount(int vol);
int      dbv_mounted(int vol);
int      dbv_format(int vol);                           /* mkfs and mount; 0 ok, else FRESULT; unmounted on failure */
int      dbv_info(int vol, uint64_t *total, uint64_t *free_bytes);  /* 0 ok, -1 not mounted / error */
uint32_t dbv_cluster_bytes(int vol);
void     dbv_seed_result(int *files, uint32_t *bytes, int *errs);   /* factory content applied by the last format-on-mount */

/* sector layer */
int      dbd_sd_present(void);                          /* card inserted */
uint32_t dbd_sd_sectors(void);
int      dbd_sd_read(uint32_t first, uint32_t count, void *dst);        /* 0 ok, -1 refused */
int      dbd_sd_write(uint32_t first, uint32_t count, const void *src);

/* page-visible card control (called from the page thread, any time) */
int      dbsd_set_inserted(int inserted);
int      dbsd_new_card(int capacity_mb, int format);    /* swaps in a new card: blank or FAT formatted */
int      dbsd_set_write_protect(int wp);

#ifdef __cplusplus
}
#endif
#endif
