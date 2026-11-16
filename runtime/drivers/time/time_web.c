/* SPDX-License-Identifier: GPL-3.0-or-later
 * Wall clock for khal_time_esp.c (kept real). Emscripten's libc has no
 * settimeofday(); this adds one as an offset on top of the host clock, and
 * __wrap_gettimeofday (the link uses -Wl,--wrap=gettimeofday) applies it. */
#include <stdint.h>
#include <sys/time.h>
#include <emscripten.h>

extern int __real_gettimeofday(struct timeval *tv, void *tz);
static volatile int64_t g_offset_us;

int settimeofday(const struct timeval *tv, const struct timezone *tz)
{
    (void)tz;
    if (!tv) return -1;
    struct timeval now;
    __real_gettimeofday(&now, NULL);
    int64_t host = (int64_t)now.tv_sec * 1000000 + now.tv_usec;
    int64_t want = (int64_t)tv->tv_sec * 1000000 + tv->tv_usec;
    g_offset_us = want - host;
    return 0;
}

int __wrap_gettimeofday(struct timeval *tv, void *tz)
{
    int rc = __real_gettimeofday(tv, tz);
    if (rc == 0 && tv) {
        int64_t us = (int64_t)tv->tv_sec * 1000000 + tv->tv_usec + g_offset_us;
        tv->tv_sec = (time_t)(us / 1000000);
        tv->tv_usec = (suseconds_t)(us % 1000000);
    }
    return rc;
}

/* Page side: device clock = host clock + this offset (ms). The page keeps it across restarts like an RTC. */
EMSCRIPTEN_KEEPALIVE double kweb_time_offset_ms(void) { return (double)g_offset_us / 1000.0; }
EMSCRIPTEN_KEEPALIVE void kweb_time_set_offset_ms(double ms) { g_offset_us = (int64_t)(ms * 1000.0); }
