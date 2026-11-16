/* SPDX-License-Identifier: GPL-3.0-or-later
 * ESP-IDF memory/linkage attributes. There is one linear memory here, so the
 * placement attributes are no-ops. */
#ifndef DOTBENCH_ESP_ATTR_H
#define DOTBENCH_ESP_ATTR_H
#define IRAM_ATTR
#define DRAM_ATTR
#define DRAM_STR(s) (s)
#define RTC_IRAM_ATTR
#define RTC_DATA_ATTR
#define RTC_NOINIT_ATTR
#define RTC_FAST_ATTR
#define RTC_SLOW_ATTR
#define EXT_RAM_ATTR
#define EXT_RAM_BSS_ATTR
#define __NOINIT_ATTR
#define COREDUMP_DRAM_ATTR
#define IRAM_DATA_ATTR
#define TCM_IRAM_ATTR
#define FORCE_INLINE_ATTR static inline __attribute__((always_inline))
#define NOINLINE_ATTR __attribute__((noinline))
#define WORD_ALIGNED_ATTR __attribute__((aligned(4)))
#define DMA_ATTR WORD_ALIGNED_ATTR
#define ALIGNED_ATTR(x) __attribute__((aligned(x)))
#define PACKED_ATTR __attribute__((packed))
#define ESP_STATIC_ASSERT _Static_assert
#endif
