/* SPDX-License-Identifier: GPL-3.0-or-later
 * The flash the apps region and the mailbox live in, for the REAL kdrv_apps.c (kdrv/apps/src, not superseded any more).
 *
 *   esp_partition_*   over two persistent regions: "apps" (the 64 KB-aligned image store + A/B directory + boot request)
 *                     and "app-pending" (the mailbox; its intent word is its last 4 KB sector, derived by kdrv_apps.c from the size).
 *   esp_image_verify  header walk + checksum byte (no SHA-256: the synthesised images carry none).
 *
 * The regions hold the COMPLEMENT of the flash bytes, so erased flash (0xFF) is zero and the host's sparse mirror stores nothing for it.
 * Programming keeps NOR semantics: a write can only clear flash bits (set stored bits). The host half is runtime/web-adapter/kapps.js
 * (the page installs the factory set and plays the bootloader on the same bytes); APPS_SIZE / PENDING_SIZE below equal its constants.
 * Sizes: 64 entries x 64 KB images + the 64 KB directory area = 0x410000 (the board's is 0xBC0000; only the 64-entry limit and
 * the allocator matter here); the mailbox is 1 MiB (the board's is 6 MB; kdrv_apps.c reads the intent sector from the size). */
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "dotbench_persist.h"
#include "esp_image_format.h"
#include "esp_partition.h"
#include "dotbench_vfs.h"

#define APPS_SIZE     0x410000u
#define PENDING_SIZE  0x100000u
#define SECTOR        0x1000u

static uint8_t g_apps[APPS_SIZE] __attribute__((aligned(64)));
static uint8_t g_pend[PENDING_SIZE] __attribute__((aligned(64)));
static dbp_region_t *g_apps_r, *g_pend_r;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;

__attribute__((constructor(115))) static void apps_flash_register(void)
{
    g_apps_r = dbp_register("apps", g_apps, sizeof g_apps, 0);
    g_pend_r = dbp_register("app-pending", g_pend, sizeof g_pend, 0);
}

static const esp_partition_t PART_APPS = { ESP_PARTITION_TYPE_DATA, 0x40, 0xC40000u, APPS_SIZE, SECTOR, "apps", 0 };
static const esp_partition_t PART_PEND = { ESP_PARTITION_TYPE_DATA, 0x41, 0x1A00000u, PENDING_SIZE, SECTOR, "app_pending", 0 };

/* "storage": the internal FAT volume (partitions.csv: data, fat, 2 MB). Its bytes are the flash-fs region of the storage driver (the FAT
 * image as FatFs sees it, no wear-levelling layer), reached through dbd_flash_raw_*; unlike the two above it holds the real bytes, not
 * their complement. kdrv_apps.c writes a whole FAT image into it with kdrv_fs_raw_begin/end around (the web kdrv_fs_web.c). */
static const esp_partition_t PART_STORAGE = { ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_FAT, 0x1800000u, DBV_FLASH_BYTES, SECTOR, "storage", 0 };

const esp_partition_t *esp_partition_find_first(esp_partition_type_t type, esp_partition_subtype_t subtype, const char *label)
{
    const esp_partition_t *all[3] = { &PART_APPS, &PART_PEND, &PART_STORAGE };
    for (int i = 0; i < 3; i++) {
        if (type != ESP_PARTITION_TYPE_ANY && type != all[i]->type) continue;
        if (subtype != ESP_PARTITION_SUBTYPE_ANY && subtype != all[i]->subtype) continue;
        if (label && strcmp(label, all[i]->label)) continue;
        return all[i];
    }
    return NULL;
}

static uint8_t *buf_of(const esp_partition_t *p, dbp_region_t **r)
{
    if (p == &PART_APPS) { *r = g_apps_r; return g_apps; }
    if (p == &PART_PEND) { *r = g_pend_r; return g_pend; }
    return NULL;
}

esp_err_t esp_partition_read(const esp_partition_t *p, size_t off, void *dst, size_t len)
{
    if (p == &PART_STORAGE) return (dst && dbd_flash_raw_read((uint32_t)off, dst, (uint32_t)len) == 0) ? ESP_OK : ESP_ERR_INVALID_ARG;
    dbp_region_t *r; uint8_t *b = buf_of(p, &r);
    if (!b || !dst || off > p->size || len > p->size - off) return ESP_ERR_INVALID_ARG;
    uint8_t *d = dst;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) d[i] = (uint8_t)~b[off + i];
    pthread_mutex_unlock(&g_mu);
    return ESP_OK;
}

esp_err_t esp_partition_write(const esp_partition_t *p, size_t off, const void *src, size_t len)
{
    if (p == &PART_STORAGE) return (src && dbd_flash_raw_write((uint32_t)off, src, (uint32_t)len) == 0) ? ESP_OK : ESP_ERR_INVALID_ARG;
    dbp_region_t *r; uint8_t *b = buf_of(p, &r);
    if (!b || !src || off > p->size || len > p->size - off) return ESP_ERR_INVALID_ARG;
    const uint8_t *s = src;
    uint8_t tmp[256];
    pthread_mutex_lock(&g_mu);
    for (size_t done = 0; done < len;) {
        size_t n = len - done < sizeof tmp ? len - done : sizeof tmp;
        for (size_t i = 0; i < n; i++) tmp[i] = (uint8_t)(b[off + done + i] | (uint8_t)~s[done + i]);   /* ~(flash & data) */
        dbp_write(r, (uint32_t)(off + done), tmp, (uint32_t)n);
        done += n;
    }
    pthread_mutex_unlock(&g_mu);
    return ESP_OK;
}

esp_err_t esp_partition_erase_range(const esp_partition_t *p, size_t off, size_t len)
{
    if (p == &PART_STORAGE) return ((off % SECTOR) || (len % SECTOR) || dbd_flash_raw_erase((uint32_t)off, (uint32_t)len)) ? ESP_ERR_INVALID_ARG : ESP_OK;
    dbp_region_t *r; uint8_t *b = buf_of(p, &r);
    if (!b || (off % SECTOR) || (len % SECTOR) || off > p->size || len > p->size - off) return ESP_ERR_INVALID_ARG;
    pthread_mutex_lock(&g_mu);
    dbp_fill(r, (uint32_t)off, 0, (uint32_t)len);
    pthread_mutex_unlock(&g_mu);
    return ESP_OK;
}

esp_err_t esp_partition_mmap(const esp_partition_t *p, size_t off, size_t len, esp_partition_mmap_memory_t mem,
                             const void **out, esp_partition_mmap_handle_t *h)
{
    (void)mem;
    dbp_region_t *r; uint8_t *b = buf_of(p, &r);
    if (p == &PART_STORAGE) b = (uint8_t *)1;   /* served by esp_partition_read below */
    if (!b || !out || !h || off > p->size || len > p->size - off) return ESP_ERR_INVALID_ARG;
    uint8_t *copy = malloc(len ? len : 1);
    if (!copy) return ESP_ERR_NO_MEM;
    esp_partition_read(p, off, copy, len);
    *out = copy; *h = (esp_partition_mmap_handle_t)(uintptr_t)copy;
    return ESP_OK;
}
void esp_partition_munmap(esp_partition_mmap_handle_t h) { free((void *)(uintptr_t)h); }

esp_err_t esp_image_verify(esp_image_load_mode_t mode, const esp_partition_pos_t *pos, esp_image_metadata_t *meta)
{
    (void)mode;
    const esp_partition_t *p = pos->offset >= PART_PEND.address ? &PART_PEND : &PART_APPS;
    size_t base = pos->offset - p->address;
    if (base > p->size || pos->size > p->size - base) return ESP_ERR_INVALID_SIZE;
    esp_image_header_t h;
    if (esp_partition_read(p, base, &h, sizeof h) != ESP_OK || h.magic != ESP_IMAGE_HEADER_MAGIC || !h.segment_count
        || h.segment_count > ESP_IMAGE_MAX_SEGMENTS)
        return ESP_ERR_IMAGE_INVALID;
    uint32_t off = sizeof h; uint8_t x = 0xEF;
    for (uint8_t i = 0; i < h.segment_count; i++) {
        esp_image_segment_header_t s;
        if (off + sizeof s > pos->size || esp_partition_read(p, base + off, &s, sizeof s) != ESP_OK) return ESP_ERR_IMAGE_INVALID;
        if (s.data_len > pos->size - off - sizeof s) return ESP_ERR_IMAGE_INVALID;
        for (uint32_t j = 0; j < s.data_len; j++) { uint8_t c; esp_partition_read(p, base + off + sizeof s + j, &c, 1); x ^= c; }
        off += (uint32_t)sizeof s + s.data_len;
    }
    off = (off | 15u) + 1u;
    uint8_t sum;
    if (off > pos->size || esp_partition_read(p, base + off - 1, &sum, 1) != ESP_OK || sum != x) return ESP_ERR_IMAGE_INVALID;
    if (meta) { meta->image_len = off + (h.hash_appended ? 32u : 0u); meta->start_addr = pos->offset; }
    return ESP_OK;
}
