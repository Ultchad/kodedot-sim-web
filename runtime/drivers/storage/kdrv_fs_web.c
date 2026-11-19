/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_fs for the web: the internal FAT volume ("storage", mounted at /storage) on FatFs over the persistent
 * region "flash-fs". Same contract and log lines as components/kdrv/storage/src/kdrv_fs.c; the wear-levelling
 * layer is not modelled (the region is RAM that the host mirrors). */
#include "kdrv_fs.h"
#include "kode_log.h"
#include "dotbench_vfs.h"

#include <stdatomic.h>

#define TAG "kdrv.fs"

static atomic_bool s_raw;   /* the partition is being written raw: nothing mounts it */

const char *kdrv_fs_mount_point(void) { return dbv_mount_point(DBV_FLASH); }
bool kdrv_fs_mounted(void) { return dbv_mounted(DBV_FLASH) != 0; }

const char *kdrv_fs_mount(void)
{
    if (dbv_mounted(DBV_FLASH)) return dbv_mount_point(DBV_FLASH);
    if (atomic_load(&s_raw)) return NULL;   /* a raw write owns the partition: a mount would format half an image */
    int formatted = 0;
    int r = dbv_mount(DBV_FLASH, 0, &formatted);
    if (r != 0) {
        KLOG_W(TAG, "'storage' will not mount: a new board, or a damaged volume. "
                    "Mounting it again with a format; anything on it is lost");
        r = dbv_mount(DBV_FLASH, 1, &formatted);
    }
    if (r != 0) { KLOG_E(TAG, "mount of 'storage' failed (%d)", r); return NULL; }
    if (formatted) {
        int nf = 0, ne = 0; uint32_t nb = 0;
        dbv_seed_result(&nf, &nb, &ne);
        if (nf || ne) KLOG_I(TAG, "factory content: %d files, %uB copied to /storage%s", nf, (unsigned)nb, ne ? " (with errors)" : "");
    }
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

kode_status_t kdrv_fs_raw_begin(void)
{
    bool expect = false;
    if (!atomic_compare_exchange_strong(&s_raw, &expect, true)) return KODE_DENIED;
    if (dbv_mounted(DBV_FLASH)) {
        dbv_unmount(DBV_FLASH);
        KLOG_I(TAG, "storage unmounted for a raw write");
    }
    return KODE_OK;
}

kode_status_t kdrv_fs_raw_end(void)
{
    if (!atomic_load(&s_raw)) return KODE_DENIED;
    atomic_store(&s_raw, false);
    int formatted = 0;
    if (dbv_mount(DBV_FLASH, 0, &formatted) == 0) {
        KLOG_I(TAG, "storage mounted again after a raw write");
        return KODE_OK;
    }
    KLOG_E(TAG, "'storage' does not mount after a raw write; left unmounted, not formatted");
    return KODE_ERROR;
}
