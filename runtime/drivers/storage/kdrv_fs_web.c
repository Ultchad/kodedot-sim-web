/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_fs for the web: the internal FAT volume ("storage", mounted at /storage) on FatFs over the persistent
 * region "flash-fs". Same contract and log lines as components/kdrv/storage/src/kdrv_fs.c; the wear-levelling
 * layer is not modelled (the region is RAM that the host mirrors). */
#include "kdrv_fs.h"
#include "kode_log.h"
#include "dotbench_vfs.h"

#define TAG "kdrv.fs"

const char *kdrv_fs_mount_point(void) { return dbv_mount_point(DBV_FLASH); }
bool kdrv_fs_mounted(void) { return dbv_mounted(DBV_FLASH) != 0; }

const char *kdrv_fs_mount(void)
{
    if (dbv_mounted(DBV_FLASH)) return dbv_mount_point(DBV_FLASH);
    int formatted = 0;
    int r = dbv_mount(DBV_FLASH, 0, &formatted);
    if (r != 0) {
        KLOG_W(TAG, "'storage' will not mount: a new board, or a damaged volume. "
                    "Mounting it again with a format; anything on it is lost");
        r = dbv_mount(DBV_FLASH, 1, &formatted);
    }
    if (r != 0) { KLOG_E(TAG, "mount of 'storage' failed (%d)", r); return NULL; }
    uint64_t total = 0, freeb = 0;
    if (kdrv_fs_usage(&total, &freeb) == KODE_OK)
        KLOG_I(TAG, "storage mounted at /storage (%lluKB free of %lluKB)", freeb / 1024ULL, total / 1024ULL);
    else
        KLOG_I(TAG, "storage mounted at /storage");
    return dbv_mount_point(DBV_FLASH);
}

void kdrv_fs_unmount(void)
{
    if (!dbv_mounted(DBV_FLASH)) return;
    dbv_unmount(DBV_FLASH);
    KLOG_I(TAG, "storage unmounted");
}

uint32_t kdrv_fs_cluster_bytes(void) { return dbv_cluster_bytes(DBV_FLASH); }

kode_status_t kdrv_fs_usage(uint64_t *total, uint64_t *free_bytes)
{
    if (!dbv_mounted(DBV_FLASH)) return KODE_DENIED;
    uint64_t t = 0, f = 0;
    if (dbv_info(DBV_FLASH, &t, &f) != 0) return KODE_ERROR;
    if (total) *total = t;
    if (free_bytes) *free_bytes = f;
    return KODE_OK;
}
