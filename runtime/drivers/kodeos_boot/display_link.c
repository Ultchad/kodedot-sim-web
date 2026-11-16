/* SPDX-License-Identifier: GPL-3.0-or-later
 * kodeos role only. TEMPORARY STAND-IN, wrapped around the display area's fake with the linker's --wrap
 * (tools/dblib/kodeos.py LINK_WRAPS), so runtime/drivers/display is not edited.
 *
 * Why: AO_Display watches the DSI link every 100 ms (display_ao.c health look). With video expected it requires
 * kdrv_display_link().frames to ADVANCE between two looks; on the board the frame interrupt counts every refresh
 * (about 60 per second) whether or not kodeOS drew. The display area's fake reports kweb_state()->frame_seq,
 * which only counts FLUSHES, so on a still screen it stops, AO_Display declares "the glass is lost", resets the
 * panel and, after three restarts, would ask for ship mode on battery.
 *
 * Replaced by: the display area's owner. Fix there: kdrv_display_link() should report frames = refresh ticks
 * since the panel came up (CLOCK_MONOTONIC * 60 Hz while video is expected), not flushes. Then delete this file
 * and LINK_WRAPS in tools/dblib/kodeos.py. */
#include <stdint.h>
#include <time.h>
#include "kdrv_display.h"

void __real_kdrv_display_link(kdrv_display_link_t *out);

void __wrap_kdrv_display_link(kdrv_display_link_t *out)
{
    static uint64_t t0_ms;
    __real_kdrv_display_link(out);
    if (!out) return;
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    uint64_t now = (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
    if (!t0_ms) t0_ms = now;
    out->frames = (uint32_t)(1u + (now - t0_ms) * 60u / 1000u);   /* 60 Hz refresh counter */
}
