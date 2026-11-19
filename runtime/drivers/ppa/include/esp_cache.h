/* SPDX-License-Identifier: GPL-3.0-or-later
 * esp_cache_msync() for the browser: there is one linear memory and no data cache, so a write-back or an invalidate has
 * nothing to do. It still refuses what the real one refuses (a NULL address, a size of 0), so a caller that passes nonsense
 * is told so here too. */
#ifndef DOTBENCH_ESP_CACHE_H
#define DOTBENCH_ESP_CACHE_H
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
#define ESP_CACHE_MSYNC_FLAG_DIR_C2M      (1 << 0)   /* cache to memory (write back) */
#define ESP_CACHE_MSYNC_FLAG_DIR_M2C      (1 << 1)   /* memory to cache (invalidate) */
#define ESP_CACHE_MSYNC_FLAG_TYPE_DATA    (1 << 2)
#define ESP_CACHE_MSYNC_FLAG_TYPE_INST    (1 << 3)
#define ESP_CACHE_MSYNC_FLAG_INVALIDATE   (1 << 4)
#define ESP_CACHE_MSYNC_FLAG_UNALIGNED    (1 << 5)
esp_err_t esp_cache_msync(void *addr, size_t size, int flags);
#ifdef __cplusplus
}
#endif
#endif
