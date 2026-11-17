/* SPDX-License-Identifier: GPL-3.0-or-later
 * Virtual AW86233 (LRA haptic driver) at 0x5A, as kdrv_aw86233 drives it: soft reset,
 * SYSCTRL2 (standby, RTP sample rate), PLAYCFG2 (gain), PLAYCFG3 (play mode),
 * PLAYCFG4 (GO / STOP), the RTP FIFO behind RTPDATA, SYSST (FF_AFS), GLBRD5 (GLB_STATE)
 * and the identity at CHIPID_H/L.
 *
 * Register facts follow the SDK driver (components/kdrv/motion/src/kdrv_aw86233.c) and the
 * Rust model in kode-sim (crates/kodedot-chips/src/aw86233.rs, GPL-3.0-or-later), which this
 * file ports to C with the changes noted in docs/STATUS-sensors.md: the FIFO drains on the
 * monotonic clock at the programmed rate, the chip leaves RTP by itself when the FIFO runs
 * dry after it has played, and a normalised drive level follows the samples being played.
 *
 * Threading: chip accessors run on the SDK's task threads, exports on the page's thread.
 * One mutex guards the model; nothing inside it calls the SDK. */
#include "page_lock.h"
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <emscripten.h>
#include "kbsp_pins.h"
#include "kweb_bridge.h"
#include "dotbench_board.h"

#define R_RSTCFG   0x00
#define R_SYSST    0x01
#define R_PLAYCFG2 0x07
#define R_PLAYCFG3 0x08
#define R_PLAYCFG4 0x09
#define R_RTPDATA  0x32
#define R_GLBRD5   0x3F
#define R_SYSCTRL2 0x46
#define R_CHIPID_H 0x57
#define R_CHIPID_L 0x69

#define GLB_STANDBY 0x00
#define GLB_RTP     0x08
#define FF_AFS      0x08
#define FIFO_DEPTH  2048u
#define FIFO_AFS    1536u
#define NBURST      512          /* FIFO bursts remembered (each is >= 1 sample) */
/* The SDK clamps the gain register to 80 % and the sine peak to 80 % of full scale
 * (KDRV_AW_GAIN_MAX_PCT): that product is the strongest drive it ever asks for and is
 * what the normalised level maps to 1.0. */
#define DRIVE_MAX   0.64

enum { EV_START = 1, EV_STOP = 2 };
enum { G_GAIN, G_PLAYING, G_LEVEL_X1000, G_RATE_HZ, G_BUZZES, G_LAST_MS, G_LAST_SAMPLES,
       G_LAST_PEAK_X1000, G_LAST_GAIN, G_STANDBY, G_PLAY_MODE, G_FIFO_FILL, G_OVERRUNS };

typedef struct { uint16_t n; uint8_t peak; } burst_t;
typedef struct { int32_t type, a, b, c; } event_t;

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static bool g_registered;
static uint8_t g_reg[256];
/* FIFO and playback */
static burst_t g_burst[NBURST];
static unsigned g_head, g_count;         /* ring of bursts still to be played */
static uint32_t g_head_left;             /* samples left in the head burst */
static uint32_t g_fill;                  /* samples in the FIFO */
static uint64_t g_t_adv;                 /* us: when the FIFO was last advanced */
static uint64_t g_carry;                 /* sample-microseconds not yet a sample */
static bool g_go;                        /* GLB_STATE reads RTP */
static bool g_played;                    /* at least one sample was written since GO */
static uint32_t g_overruns;
/* buzz bookkeeping */
static uint32_t g_buzzes, g_buzz_samples, g_buzz_peak;   /* peak: 0..127 */
static uint32_t g_last_ms, g_last_samples, g_last_peak_x1000, g_last_gain;
static double g_level;
/* events */
static event_t g_ev[64];
static unsigned g_ev_r, g_ev_w;

static uint64_t now_us(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}
static uint32_t rate_hz(void)
{
    switch (g_reg[R_SYSCTRL2] & 3u) { case 0: return 24000; case 1: return 48000; default: return 12000; }
}
static void ev_push(int32_t type, int32_t a, int32_t b, int32_t c)
{
    if (g_ev_w - g_ev_r >= 64) g_ev_r++;                  /* full: drop the oldest */
    g_ev[g_ev_w++ & 63] = (event_t){ type, a, b, c };
}
static void publish_level(double lv)
{
    if (lv < 0) lv = 0;
    if (lv > 1) lv = 1;
    g_level = lv;
    uint32_t v = (uint32_t)lround(lv * 255.0);
    kweb_state_t *s = kweb_state();
    if (s->haptic != v) {
        s->haptic = v;
        __atomic_fetch_add(&s->haptic_seq, 1u, __ATOMIC_SEQ_CST);
    }
}
static double drive_of(uint8_t peak)
{
    return ((double)peak / 127.0) * ((double)g_reg[R_PLAYCFG2] / 255.0) / DRIVE_MAX;
}
static void end_buzz(void)
{
    if (!g_go) return;
    g_go = false;
    g_reg[R_GLBRD5] = GLB_STANDBY;
    g_count = g_fill = g_head_left = 0;
    g_carry = 0;
    publish_level(0);
    if (g_played) {
        uint32_t rate = rate_hz();
        g_buzzes++;
        g_last_samples = g_buzz_samples;
        g_last_ms = (uint32_t)(((uint64_t)g_buzz_samples * 1000u + rate - 1) / rate);
        g_last_gain = g_reg[R_PLAYCFG2];
        g_last_peak_x1000 = (uint32_t)lround(drive_of((uint8_t)g_buzz_peak) * 1000.0);
        if (g_last_peak_x1000 > 1000) g_last_peak_x1000 = 1000;
        ev_push(EV_STOP, (int32_t)g_last_ms, (int32_t)g_last_samples, (int32_t)g_last_peak_x1000);
    }
    g_played = false;
}
/* Play out what the clock allows; the chip leaves RTP by itself when the FIFO is dry. */
static void advance(uint64_t now)
{
    if (!g_go) { g_t_adv = now; return; }
    if (g_fill == 0) {
        g_t_adv = now;
        g_carry = 0;
        if (g_played) end_buzz();                         /* ran dry after playing */
        return;
    }
    g_carry += (now - g_t_adv) * rate_hz();
    g_t_adv = now;
    uint64_t take = g_carry / 1000000u;
    g_carry %= 1000000u;
    while (take > 0 && g_count > 0) {
        uint32_t n = take < g_head_left ? (uint32_t)take : g_head_left;
        g_head_left -= n; take -= n; g_fill -= n;
        if (g_head_left == 0) {
            g_head = (g_head + 1) % NBURST; g_count--;
            g_head_left = g_count ? g_burst[g_head].n : 0;
        }
    }
    if (g_fill == 0) {
        g_carry = 0;
        if (g_played) { end_buzz(); return; }
    }
    publish_level(g_count ? drive_of(g_burst[g_head].peak) : 0.0);
}
static void rtp_write(const uint8_t *buf, size_t len, uint64_t now)
{
    advance(now);
    if (!g_go || len == 0) return;                       /* acked, not played: chip not in RTP */
    unsigned room = FIFO_DEPTH - g_fill;
    unsigned take = len < room ? (unsigned)len : room;
    if (take < len) g_overruns += (uint32_t)(len - take);
    if (take == 0) return;
    uint8_t peak = 0;
    for (unsigned i = 0; i < take; i++) {
        int v = (int8_t)buf[i]; if (v < 0) v = -v; if (v > 127) v = 127;
        if (v > peak) peak = (uint8_t)v;
    }
    if (g_fill == 0) { g_t_adv = now; g_carry = 0; }     /* the clock starts with the first sample */
    if (g_count == NBURST) {                             /* ring full: merge into the last burst */
        unsigned last = (g_head + g_count - 1) % NBURST;
        g_burst[last].n = (uint16_t)(g_burst[last].n + take);
        if (peak > g_burst[last].peak) g_burst[last].peak = peak;
    } else {
        g_burst[(g_head + g_count) % NBURST] = (burst_t){ (uint16_t)take, peak };
        if (g_count == 0) g_head_left = take;
        g_count++;
    }
    g_fill += take;
    if (!g_played) {
        g_played = true; g_buzz_samples = 0; g_buzz_peak = 0;
        ev_push(EV_START, g_reg[R_PLAYCFG2], (int32_t)rate_hz(), (int32_t)(g_reg[R_PLAYCFG3] & 3u));
    }
    g_buzz_samples += take;
    if (peak > g_buzz_peak) g_buzz_peak = peak;
    publish_level(drive_of(g_burst[g_head].peak));
}
static void soft_reset(uint64_t now)
{
    end_buzz();
    memset(g_reg, 0, sizeof g_reg);
    g_reg[R_CHIPID_H] = 0x23;
    g_reg[R_CHIPID_L] = 0x30;
    g_reg[R_SYSCTRL2] = 0x40;                            /* standby, 24 kHz, until the driver runs it */
    g_t_adv = now;
}
static int hp_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    pthread_mutex_lock(&g_mu);
    advance(now_us());
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i);
        if (r == R_SYSST) buf[i] = g_fill >= FIFO_AFS ? FF_AFS : 0;
        else buf[i] = g_reg[r];
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static int hp_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    if (reg == R_RTPDATA) {                              /* the FIFO port does not auto-increment */
        rtp_write(buf, len, now);
        pthread_mutex_unlock(&g_mu);
        return 0;
    }
    advance(now);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i), b = buf[i];
        if (r == R_CHIPID_H || r == R_CHIPID_L || r == R_GLBRD5 || r == R_SYSST) continue;
        if (r == R_RSTCFG) { if (b == 0xAA) soft_reset(now); continue; }
        if (r == R_PLAYCFG4) {
            if (b & 0x02) end_buzz();                    /* STOP */
            else if ((b & 0x01) && (g_reg[R_PLAYCFG3] & 3u) == 1u && !(g_reg[R_SYSCTRL2] & 0x40)) {
                end_buzz();                              /* GO in RTP, out of standby */
                g_go = true; g_played = false; g_fill = 0; g_count = 0; g_head_left = 0;
                g_carry = 0; g_t_adv = now;
                g_reg[R_GLBRD5] = GLB_RTP;
            }                                            /* GO in standby: acked, nothing happens */
            continue;
        }
        g_reg[r] = b;
        if (r == R_SYSCTRL2 && (b & 0x40) && g_go) end_buzz();   /* parked while playing */
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}
void dotbench_haptic_register(void)
{
    if (g_registered) return;
    g_registered = true;
    pthread_mutex_lock(&g_mu);
    soft_reset(now_us());
    pthread_mutex_unlock(&g_mu);
    static const dotbench_i2c_chip_t chip = { KBSP_I2C_ADDR_HAPTIC, "AW86233", hp_read, hp_write, NULL };
    dotbench_i2c_register(&chip);
}

/* ---- bench side, called on the page's thread -------------------------------------------- */
EMSCRIPTEN_KEEPALIVE void haptic_poll(void)
{
    DB_PAGE_LOCK_V(&g_mu);
    advance(now_us());
    pthread_mutex_unlock(&g_mu);
}
EMSCRIPTEN_KEEPALIVE int haptic_get(int id)
{
    int v = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    advance(now_us());
    switch (id) {
    case G_GAIN: v = g_reg[R_PLAYCFG2]; break;
    case G_PLAYING: v = g_go ? 1 : 0; break;
    case G_LEVEL_X1000: v = (int)lround(g_level * 1000.0); break;
    case G_RATE_HZ: v = (int)rate_hz(); break;
    case G_BUZZES: v = (int)g_buzzes; break;
    case G_LAST_MS: v = (int)g_last_ms; break;
    case G_LAST_SAMPLES: v = (int)g_last_samples; break;
    case G_LAST_PEAK_X1000: v = (int)g_last_peak_x1000; break;
    case G_LAST_GAIN: v = (int)g_last_gain; break;
    case G_STANDBY: v = (g_reg[R_SYSCTRL2] >> 6) & 1; break;
    case G_PLAY_MODE: v = g_reg[R_PLAYCFG3] & 3; break;
    case G_FIFO_FILL: v = (int)g_fill; break;
    case G_OVERRUNS: v = (int)g_overruns; break;
    default: break;
    }
    pthread_mutex_unlock(&g_mu);
    return v;
}
/* out[0..3] = type, a, b, c. Returns 1 when an event was copied. */
EMSCRIPTEN_KEEPALIVE int haptic_event_pop(int32_t *out)
{
    int got = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    advance(now_us());
    if (g_ev_r != g_ev_w) {
        event_t e = g_ev[g_ev_r++ & 63];
        out[0] = e.type; out[1] = e.a; out[2] = e.b; out[3] = e.c;
        got = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return got;
}

/* Test hooks: a register access as the I2C bus would do it (0 = ACK, -1 = no such chip). */
EMSCRIPTEN_KEEPALIVE int haptic_i2c_read(int addr, int reg, uint8_t *buf, int len)
{
    return addr == KBSP_I2C_ADDR_HAPTIC ? hp_read(NULL, (uint8_t)reg, buf, (size_t)len) : -1;
}
EMSCRIPTEN_KEEPALIVE int haptic_i2c_write(int addr, int reg, const uint8_t *buf, int len)
{
    return addr == KBSP_I2C_ADDR_HAPTIC ? hp_write(NULL, (uint8_t)reg, buf, (size_t)len) : -1;
}
