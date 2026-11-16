/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_alloc_psram / khal_realloc_psram / khal_free over the one linear memory. */
#include <stdlib.h>
#include <string.h>
#include "khal_system.h"

/* ---- alloc: PSRAM-style, aligned and zeroed (callers rely on both) ---- */
void *khal_alloc_psram(size_t align, size_t size)
{
    if (align < 64) align = 64;
    size_t sz = (size + align - 1) & ~(align - 1);
    void *p = aligned_alloc(align, sz ? sz : align);
    if (p) memset(p, 0, sz);
    return p;
}
void *khal_realloc_psram(void *p, size_t size) { return realloc(p, size); }
void khal_free(void *p) { free(p); }
