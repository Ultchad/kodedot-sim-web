/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_display over the bridge's RGBA8888 framebuffer. Two RGB565 framebuffers
 * with the real driver's contract: a flush of one of them flips (it becomes the
 * front, the other the back); a flush of anything else is a chunk copied into
 * place. Every flush converts the rows it carries into kweb_state.fb, bumps
 * frame_seq, tracks dirty rows and signals the single completion that
 * kdrv_display_flush_wait() / kdrv_display_flush_abort() consume. Replaces
 * components/kdrv/display/src/kdrv_display.c; the capture/mirror/GRAM calls
 * are left to the generated stubs. */
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "kdrv_display.h"
#include "kweb_bridge.h"

#define W KBSP_LCD_H_RES
#define H KBSP_LCD_V_RES

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_cv;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;
static void once(void)
{
    pthread_condattr_t a;
    pthread_condattr_init(&a);
    pthread_condattr_setclock(&a, CLOCK_MONOTONIC);
    pthread_cond_init(&g_cv, &a);
}
static uint8_t *g_buf[2];      /* [0] back, [1] front */
static bool g_up, g_link = true, g_lit, g_sleep;
static bool g_done;            /* the binary completion */
static int64_t g_due_ns;       /* when the pending flip completes (CLOCK_MONOTONIC ns); 0 = none pending */
static uint8_t g_bright = 100;
static int32_t g_dy1 = H, g_dy2;
static uint32_t g_epoch = 1, g_recov;

static void complete_locked(void) { g_done = true; g_due_ns = 0; pthread_cond_broadcast(&g_cv); }

/* Pacing like the panel. On the board a FLIP (a flush of one of the two framebuffers) completes at the next frame boundary
 * of the 60 Hz tearing-effect signal (kdrv_display.c on_frame_done()); a chunk copy completes when its transfer is done, i.e.
 * at once. So a flip's completion is held back to the next boundary of a free-running 60 Hz grid, and only
 * kdrv_display_flush_wait() sees the difference: a game that waits for its last flip runs at 60 fps instead of as fast as
 * the host can paint. Define DOTBENCH_NO_DISPLAY_PACING to compile the old instant completion. */
#define VSYNC_NS 16666667LL
static int64_t mono_ns(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}
static void due_locked(void)
{
    if (g_due_ns && mono_ns() >= g_due_ns) complete_locked();
}

static void apply_panel(void)
{
    kweb_state_t *s = kweb_state();
    s->panel_on = (g_lit && !g_sleep) ? 1u : 0u;
    s->backlight = (g_lit && !g_sleep) ? g_bright : 0u;
}

kode_status_t kdrv_display_init(void)
{
    pthread_once(&g_once, once);
    pthread_mutex_lock(&g_mu);
    if (!g_up) {
        for (int i = 0; i < 2; i++) {
            g_buf[i] = aligned_alloc(KDRV_DISPLAY_CACHE_LINE, KDRV_DISPLAY_FB_BYTES);
            if (!g_buf[i]) { pthread_mutex_unlock(&g_mu); return KODE_NO_RESOURCES; }
            memset(g_buf[i], 0, KDRV_DISPLAY_FB_BYTES);
        }
        g_up = true;
        g_lit = false;           /* black until the first frame */
        g_done = false;
        g_epoch++;
    }
    kweb_state_t *s = kweb_state();
    s->panel_on = 0;
    s->backlight = 0;
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}

static void convert_rows(const uint16_t *src_row0, int32_t x1, int32_t x2, int32_t y1, int32_t y2, size_t src_stride_px)
{
    kweb_state_t *s = kweb_state();
    for (int32_t y = y1; y < y2; y++) {
        const uint16_t *sp = src_row0 + (size_t)(y - y1) * src_stride_px;
        uint32_t *dp = (uint32_t *)(void *)(s->fb + (size_t)y * s->fb_stride) + x1;
        for (int32_t x = x1; x < x2; x++) {
            uint16_t p = *sp++;
            uint32_t r = (p >> 11) & 31u, g = (p >> 5) & 63u, b = p & 31u;
            r = (r << 3) | (r >> 2);
            g = (g << 2) | (g >> 4);
            b = (b << 3) | (b >> 2);
            *dp++ = r | (g << 8) | (b << 16) | 0xFF000000u;   /* bytes R,G,B,A in memory */
        }
    }
}

kode_status_t kdrv_display_flush(int32_t x1, int32_t y1, int32_t x2, int32_t y2, const void *pixels, bool last)
{
    (void)last;
    bool flip = false;
    pthread_mutex_lock(&g_mu);
    if (!g_up || !g_link || !pixels || x1 < 0 || y1 < 0 || x2 > (int32_t)W || y2 > (int32_t)H) {
        pthread_mutex_unlock(&g_mu);
        return KODE_DENIED;
    }
    if (x2 <= x1 || y2 <= y1) {          /* an empty frame still completes */
        complete_locked();
        pthread_mutex_unlock(&g_mu);
        return KODE_OK;
    }
    if (pixels == g_buf[0] || pixels == g_buf[1]) {
        /* Drawn in place: the buffer is the frame; flip to it. */
        const uint16_t *fb = pixels;
        convert_rows(fb + (size_t)y1 * W + x1, x1, x2, y1, y2, W);
        if (pixels == g_buf[0]) { uint8_t *t = g_buf[0]; g_buf[0] = g_buf[1]; g_buf[1] = t; }
        flip = true;
    } else {
        convert_rows(pixels, x1, x2, y1, y2, (size_t)(x2 - x1));
        /* Keep the front buffer in step so readers of it see the picture. */
        for (int32_t y = y1; y < y2; y++)
            memcpy((uint16_t *)(void *)g_buf[1] + (size_t)y * W + x1,
                   (const uint16_t *)pixels + (size_t)(y - y1) * (x2 - x1), (size_t)(x2 - x1) * 2u);
    }
    if (y1 < g_dy1) g_dy1 = y1;
    if (y2 > g_dy2) g_dy2 = y2;
    kweb_state_t *s = kweb_state();
    s->dirty_y1 = (uint32_t)y1;
    s->dirty_y2 = (uint32_t)(y2 - 1);
    __atomic_fetch_add(&s->flushes, 1u, __ATOMIC_SEQ_CST);
    g_lit = true;
    apply_panel();
    __atomic_fetch_add(&s->frame_seq, 1u, __ATOMIC_SEQ_CST);
#ifndef DOTBENCH_NO_DISPLAY_PACING
    if (flip) {
        int64_t now = mono_ns();
        g_done = false;
        g_due_ns = (now / VSYNC_NS + 1) * VSYNC_NS;       /* the next boundary of the 60 Hz grid */
        pthread_cond_broadcast(&g_cv);
        pthread_mutex_unlock(&g_mu);
        return KODE_OK;
    }
#endif
    complete_locked();
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}

bool kdrv_display_flush_wait(uint32_t ms)
{
    pthread_once(&g_once, once);
    pthread_mutex_lock(&g_mu);
    int64_t deadline = mono_ns() + (int64_t)ms * 1000000LL;
    for (;;) {
        due_locked();
        if (g_done || !ms) break;
        int64_t until = (g_due_ns && g_due_ns < deadline) ? g_due_ns : deadline;
        if (mono_ns() >= deadline) break;
        struct timespec ts = { (time_t)(until / 1000000000LL), (long)(until % 1000000000LL) };
        pthread_cond_timedwait(&g_cv, &g_mu, &ts);
    }
    bool ok = g_done;
    g_done = false;
    pthread_mutex_unlock(&g_mu);
    return ok;
}
void kdrv_display_flush_abort(void)
{
    pthread_once(&g_once, once);
    pthread_mutex_lock(&g_mu);
    complete_locked();
    pthread_mutex_unlock(&g_mu);
}

void *kdrv_display_back_buffer(void)  { return (g_up && g_link) ? g_buf[0] : NULL; }
void *kdrv_display_front_buffer(void) { return (g_up && g_link) ? g_buf[1] : NULL; }

kode_status_t kdrv_display_brightness(uint8_t percent)
{
    if (!g_up) return KODE_DENIED;
    pthread_mutex_lock(&g_mu);
    g_bright = percent > 100 ? 100 : percent;
    apply_panel();
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
kode_status_t kdrv_display_link_set(bool up)
{
    pthread_mutex_lock(&g_mu);
    g_link = up;
    g_epoch++;
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
uint32_t kdrv_display_buffers_epoch(void) { return g_epoch; }
kode_status_t kdrv_display_panel_sleep(bool sleep)
{
    if (!g_up) return KODE_DENIED;
    pthread_mutex_lock(&g_mu);
    g_sleep = sleep;
    apply_panel();
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
bool kdrv_display_video_expected(void) { return g_up && g_link && g_lit; }
uint32_t kdrv_display_recoveries(void) { return g_recov; }
void kdrv_display_recoveries_set(uint32_t n) { g_recov = n; }
void kdrv_display_dirty_take(int32_t *y1, int32_t *y2)
{
    pthread_mutex_lock(&g_mu);
    if (y1) *y1 = g_dy1;
    if (y2) *y2 = g_dy2;
    g_dy1 = H;
    g_dy2 = 0;
    pthread_mutex_unlock(&g_mu);
}
void kdrv_display_link(kdrv_display_link_t *out)
{
    if (!out) return;
    memset(out, 0, sizeof *out);
    out->frames = kweb_state()->frame_seq;
}
