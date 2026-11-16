/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * dotbench persistent regions: named byte regions that C code reads and writes synchronously in
 * shared memory and that the host mirrors to durable storage (IndexedDB in a page, a directory
 * under Node) asynchronously. Design and limits: docs/STATUS-persistence.md, runtime/persist/.
 *
 *   static uint8_t buf[SIZE] __attribute__((aligned(64)));
 *   static dbp_region_t *r;
 *   __attribute__((constructor(110))) static void reg(void) { r = dbp_register("my-region", buf, sizeof buf, 0); }
 *   ...
 *   dbp_write(r, off, src, len);              // memcpy + dirty bits
 *   memcpy(buf + off, src, len); dbp_dirty(r, off, len);   // or write in place, then mark (ALWAYS after the write)
 *
 * The host loads the saved bytes into the region BEFORE main() runs, so a region reads as it was when
 * the device last stopped (or all zero on a factory-fresh device). A region is registered once, with a
 * fixed size: a firmware build that changes a region's size starts that region empty.
 */
#ifndef DOTBENCH_PERSIST_H
#define DOTBENCH_PERSIST_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DBP_CHUNK_SHIFT   12u
#define DBP_CHUNK         (1u << DBP_CHUNK_SHIFT)   /* dirty-tracking and storage granule, bytes */
#define DBP_MAX_REGIONS   16u                       /* the legacy kweb_persist table (KWEB_PERSIST_MAX) should be raised to match */
#define DBP_FLAG_RETAIN   1u   /* survives a reset, is cleared at power-on, never mirrored to durable storage */

typedef struct dbp_region dbp_region_t;

/* Register a region. name <= 15 chars, buf 8-byte aligned, size a multiple of DBP_CHUNK. NULL when the
 * table (8 regions, 2048 chunk bitmap words) is full. Idempotent per name. Call from a constructor. */
dbp_region_t *dbp_register(const char *name, void *buf, uint32_t size, uint32_t flags);
dbp_region_t *dbp_find(const char *name);
void         *dbp_buf(const dbp_region_t *r);
uint32_t      dbp_size(const dbp_region_t *r);

/* Write through the service: memcpy/memset plus dirty marking, and the power-cut fault injection below
 * applies to it. Out-of-range writes are clipped. */
void dbp_write(dbp_region_t *r, uint32_t off, const void *src, uint32_t len);
void dbp_fill(dbp_region_t *r, uint32_t off, int byte, uint32_t len);
/* For code that wrote into dbp_buf() itself: mark [off, off+len) dirty. Mark AFTER writing. */
void dbp_dirty(dbp_region_t *r, uint32_t off, uint32_t len);

/* Power-cut fault injection (tests, and the bench's "pull the plug" control): after `bytes` more bytes
 * have been written through dbp_write/dbp_fill (all regions), every later write is dropped, and the one
 * that straddles the limit is applied only up to it (a torn write). dbp_cut_fired() tells that it happened. */
void     dbp_cut_after(uint32_t bytes);
bool     dbp_cut_fired(void);
void     dbp_cut_clear(void);

/* Device state shared by small areas: the RTC offset and the microSD slot. One 4 KiB region "dev-state". */
#define DBP_DEV_MAGIC 0x44455631u   /* "DEV1" */
typedef struct {
    uint32_t magic;
    uint32_t version;              /* 1 */
    int64_t  rtc_offset_us;        /* device wall clock = host clock + this; survives reset and power-on */
    uint32_t sd_inserted;          /* 0/1; default 1 on a factory-fresh device */
    uint32_t sd_capacity_mb;       /* virtual card size (2..32), default 8 */
    uint32_t sd_serial;            /* card serial number; changes when the card is replaced by a new one */
    uint32_t sd_write_protect;     /* 0/1 */
    uint32_t sd_generation;        /* +1 for every insert/remove/new card: anything mounted is stale */
    uint32_t sd_initialised;       /* 0 on a factory-fresh device: the first mount of the card formats it (FAT) */
} dbp_devstate_t;
dbp_devstate_t *dbp_devstate(void);        /* initialised on first use; NULL only if the table is full */
void            dbp_devstate_changed(void);/* mark it dirty after a change */

#ifdef __cplusplus
}
#endif
#endif
