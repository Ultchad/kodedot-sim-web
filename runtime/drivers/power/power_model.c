/* SPDX-License-Identifier: GPL-3.0-or-later
 * Virtual BQ25896 (charger, 0x6B) and CW2217 (fuel gauge, 0x64) over one virtual battery.
 *
 * The register facts follow the SDK drivers (components/kdrv/power/src/kdrv_bq25896.c and
 * kdrv_cw2217.c) and the Rust models in kode-sim (crates/kodedot-chips/src/power.rs,
 * GPL-3.0-or-later), whose reset values and register masks are ported here. Beyond that
 * model this one derives a consistent charger/gauge pair from the battery state:
 *
 *   battery   state of charge 0..100 %, optional cell voltage override, temperature, cable
 *   curve     open-circuit voltage from kbsp_cell.h's OCV table (the one AO_Power inverts)
 *   terminal  V = OCV + I * R_int, I into the cell positive (R_int = KBSP_CELL_R_INT_MOHM)
 *   charging  constant current ICHG (REG04) limited by the input (IINLIM, REG00), then
 *             constant voltage at VREG (REG06) with the current tapering, DONE below ITERM
 *   ADC       one-shot (CONV_START) results appear 1 s later, CONV_RATE gives live values
 *   gauge     VCELL/SOC/TEMP/CURRENT derived from the same state; a gauge in shutdown or
 *             in restart reads zeros and reports ready 1.5 s after CONFIG goes to 0x00
 *
 * Ship mode (REG09 BATFET_DIS) is not swallowed: it is published as a power:ship event.
 *
 * Threading: chip accessors run on SDK task threads, the bench exports on the page's thread.
 * One mutex guards everything; nothing inside it calls the SDK. */
#include "page_lock.h"
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <emscripten.h>
#include "kbsp_pins.h"
#include "kbsp_cell.h"
#include "dotbench_board.h"
#include "power_model.h"

#define BQ_NREG 0x15
#define ADC_LATENCY_US  1000000ull   /* tCONV of the one-shot conversion (datasheet: up to 1 s) */
#define GAUGE_READY_US  1500000ull   /* CW2217: ~1.5 s from the wake to 0xA7 ready (SDK header) */
#define SHIP_DELAY_MS   10000        /* BATFET_DLY: ship mode after about 10 s */
#define CABLE_SDP 1
#define CABLE_ADAPTER 2

enum { G_LEVEL_X100, G_VBAT_MV, G_CHARGING, G_USB, G_TEMP_X10, G_CURRENT_MA, G_SHIPPED, G_CABLE,
       G_VBUS_MV, G_LOAD_MA, G_OCV_MV, G_GAUGE_READY, G_SIM_X100, G_VOLT_OVERRIDE };

typedef struct { int32_t type, a, b, c; } event_t;
typedef struct {
    double ocv, vbat, i_cell;      /* mV, mV, mA (into the cell positive) */
    int phase;                     /* 0 none, 1 pre, 2 fast, 3 done */
    int ntc;                       /* REG0C[2:0]: 0 ok, 2 warm, 3 cool, 5 cold, 6 hot */
    int vbus_mv, vsys_mv;
    bool usb;
} calc_t;

static const uint8_t BQ_RESET[BQ_NREG] = {
    0x08, 0x06, 0x11, 0x1A, 0x08, 0x22, 0x5E, 0x9D, 0x03, 0x44, 0x93, 0x00, 0x00, 0x12, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x02 };
static const uint16_t OCV_MV[KBSP_CELL_OCV_POINTS] = KBSP_CELL_OCV_MV;
static const uint8_t OCV_PCT[KBSP_CELL_OCV_POINTS] = KBSP_CELL_OCV_PCT;

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
DB_PAGE_REGISTER(power, "power", g_mu, DB_LOCK_MUTEX)
static bool g_registered;
/* the battery (bench side) */
static double g_soc = 80.0;        /* % */
static int g_ovr_mv;               /* 0 = follow the curve */
static double g_temp_c = 25.0;
static bool g_usb;
static int g_cable = CABLE_SDP;
static int g_load_ma = 90;         /* what the board draws on battery, mA */
static double g_sim;               /* simulated-time multiplier for SoC drift, 0 = frozen */
static uint64_t g_sim_t;
static bool g_shipped;
/* BQ25896 */
static uint8_t g_bq[BQ_NREG];
static bool g_adc_ever, g_adc_pending, g_adc_live_valid;
static uint64_t g_adc_t0;
static uint8_t g_adc[6];           /* latched REG0E..REG13 */
/* CW2217 */
static uint8_t g_cw[256];
static uint64_t g_cw_ready_at;
static bool g_cw_active;
/* events */
static event_t g_ev[64];
static unsigned g_ev_r, g_ev_w;

static uint64_t now_us(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}
static void ev_push(int32_t type, int32_t a, int32_t b, int32_t c)
{
    if (g_ev_w - g_ev_r >= 64) g_ev_r++;
    g_ev[g_ev_w++ & 63] = (event_t){ type, a, b, c };
}
void dotbench_power_event(int type, int a, int b, int c)
{
    pthread_mutex_lock(&g_mu);
    ev_push(type, a, b, c);
    pthread_mutex_unlock(&g_mu);
}
bool dotbench_power_usb(void)
{
    pthread_mutex_lock(&g_mu);
    bool u = g_usb;
    pthread_mutex_unlock(&g_mu);
    return u;
}

/* ---- the cell ---------------------------------------------------------------------------- */
static double curve_mv(double pct)
{
    if (pct <= OCV_PCT[0]) return OCV_MV[0];
    for (int i = 1; i < KBSP_CELL_OCV_POINTS; i++)
        if (pct <= OCV_PCT[i])
            return OCV_MV[i - 1] + (pct - OCV_PCT[i - 1]) * (double)(OCV_MV[i] - OCV_MV[i - 1])
                                   / (double)(OCV_PCT[i] - OCV_PCT[i - 1]);
    return OCV_MV[KBSP_CELL_OCV_POINTS - 1];
}
static double curve_pct(double mv)
{
    if (mv <= OCV_MV[0]) return 0;
    for (int i = 1; i < KBSP_CELL_OCV_POINTS; i++)
        if (mv <= OCV_MV[i])
            return OCV_PCT[i - 1] + (mv - OCV_MV[i - 1]) * (double)(OCV_PCT[i] - OCV_PCT[i - 1])
                                    / (double)(OCV_MV[i] - OCV_MV[i - 1]);
    return 100;
}
static double soc_now(void) { return g_ovr_mv ? curve_pct(g_ovr_mv) : g_soc; }

static int ntc_of(double t)
{
    if (t < 0) return 5;        /* cold */
    if (t < 10) return 3;       /* cool */
    if (t < 45) return 0;
    if (t < 60) return 2;       /* warm */
    return 6;                   /* hot */
}

static void calc(calc_t *c)
{
    double rint = KBSP_CELL_R_INT_MOHM / 1000.0;           /* ohm; mV = mA * ohm */
    int ichg_set = (g_bq[0x04] & 0x7F) * 64;
    int iinlim = 100 + (g_bq[0x00] & 0x3F) * 50;
    double vreg = 3840 + ((g_bq[0x06] >> 2) & 0x3F) * 16;
    int iterm = 64 + (g_bq[0x05] & 0x0F) * 64;
    int iprechg = 64 + ((g_bq[0x05] >> 4) & 0x0F) * 64;
    double batlowv = (g_bq[0x06] & 0x02) ? 3000 : 2800;
    int sysmin = 3000 + ((g_bq[0x03] >> 1) & 7) * 100;
    c->usb = g_usb;
    c->ocv = g_ovr_mv ? g_ovr_mv : curve_mv(g_soc);
    c->ntc = ntc_of(g_temp_c);
    c->phase = 0;
    c->i_cell = 0;
    bool allowed = g_usb && (g_bq[0x03] & 0x10) && !(g_bq[0x00] & 0x80) && c->ntc != 5 && c->ntc != 6;
    if (allowed && ichg_set > 0) {
        double cc = ichg_set;
        if (cc > iinlim * 0.9) cc = iinlim * 0.9;           /* input current limit, 90 % efficient path */
        if (c->ocv < batlowv) { c->phase = 1; c->i_cell = iprechg < cc ? iprechg : cc; }
        else {
            double v = c->ocv + cc * rint;
            double i = cc;
            if (v > vreg) i = (vreg - c->ocv) / rint;        /* constant voltage: the current tapers */
            if (i <= iterm && (g_bq[0x07] & 0x80)) { c->phase = 3; i = 0; }
            else c->phase = 2;
            c->i_cell = i > 0 ? i : 0;
        }
    } else if (!g_usb) {
        c->i_cell = -(double)g_load_ma;
    }
    c->vbat = c->ocv + c->i_cell * rint;
    c->vbus_mv = g_usb ? 5000 : 0;
    c->vsys_mv = (int)lround(g_usb && c->vbat < sysmin ? sysmin : c->vbat);
}

/* The simulated drift of the SoC (off by default): charge or load integrated over wall time. */
static void sim_step(uint64_t now, const calc_t *c)
{
    if (g_sim > 0 && g_sim_t && !g_ovr_mv) {
        double hours = (double)(now - g_sim_t) / 3.6e9 * g_sim;
        double d = c->i_cell * hours / KBSP_CELL_CAPACITY_MAH * 100.0;
        g_soc += d;
        if (g_soc > 100) g_soc = 100;
        if (g_soc < 0) g_soc = 0;
    }
    g_sim_t = now;
}
static void snapshot(uint64_t now, calc_t *c)
{
    calc(c);
    sim_step(now, c);
    calc(c);
}

/* ---- BQ25896 ----------------------------------------------------------------------------- */
static void bq_adc_bytes(const calc_t *c, uint8_t out[6])
{
    int vb = (int)lround((c->vbat - 2304) / 20.0), vs = (int)lround((c->vsys_mv - 2304) / 20.0);
    double ts = 50.8 - (g_temp_c - 25.0) * 0.9;              /* % of REGN: documented approximation */
    if (ts < 21) ts = 21;
    if (ts > 80) ts = 80;
    int tsr = (int)lround((ts - 21.0) / 0.465);
    int vbus = c->usb ? (int)lround((c->vbus_mv - 2600) / 100.0) : 0;
    int ichg = c->i_cell > 0 ? (int)lround(c->i_cell / 50.0) : 0;
    if (vb < 0) vb = 0; if (vb > 127) vb = 127;
    if (vs < 0) vs = 0; if (vs > 127) vs = 127;
    if (tsr < 0) tsr = 0; if (tsr > 127) tsr = 127;
    if (vbus > 127) vbus = 127; if (ichg > 127) ichg = 127;
    out[0] = (uint8_t)vb;                                    /* REG0E: THERM_STAT 0, BATV */
    out[1] = (uint8_t)vs;                                    /* REG0F: SYSV */
    out[2] = (uint8_t)tsr;                                   /* REG10: TSPCT */
    out[3] = (uint8_t)((c->usb ? 0x80 : 0) | vbus);          /* REG11: VBUS_GD, VBUSV */
    out[4] = (uint8_t)ichg;                                  /* REG12: ICHGR */
    out[5] = (uint8_t)(c->usb ? (g_bq[0x00] & 0x3F) : 0);    /* REG13: IDPM_LIM (no DPM active) */
}
static void bq_adc_update(uint64_t now, const calc_t *c)
{
    if (g_adc_pending && now - g_adc_t0 >= ADC_LATENCY_US) {
        bq_adc_bytes(c, g_adc);
        g_adc_pending = false;
        g_adc_ever = true;
    }
}
static uint8_t bq_read_one(uint64_t now, const calc_t *c, int r)
{
    switch (r) {
    case 0x0B: {
        int vs = (c->usb ? g_cable : 0);
        uint8_t v = (uint8_t)((vs << 5) | (c->phase << 3) | (c->usb ? 0x04 : 0));
        if (c->usb && c->vbat < ((3000 + ((g_bq[0x03] >> 1) & 7) * 100))) v |= 0x01;   /* VSYS_STAT */
        return v;
    }
    case 0x0C: {
        uint8_t v = (uint8_t)(g_bq[0x0C] | c->ntc);
        g_bq[0x0C] = 0;                                      /* the latch clears on read */
        return v;
    }
    case 0x0E ... 0x13: {
        if (g_bq[0x02] & 0x40) {                             /* CONV_RATE: continuous, live */
            uint8_t b[6]; bq_adc_bytes(c, b); return b[r - 0x0E];
        }
        bq_adc_update(now, c);
        if (!g_adc_ever) return 0;                           /* bottom of every scale */
        return g_adc[r - 0x0E];
    }
    default: return g_bq[r];
    }
}
static void bq_reset(void)
{
    memcpy(g_bq, BQ_RESET, sizeof g_bq);
    g_adc_ever = g_adc_pending = false;
}
static int bq_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    calc_t c; snapshot(now, &c);
    for (size_t i = 0; i < len; i++) {
        unsigned r = (unsigned)reg + (unsigned)i;
        if (r >= BQ_NREG) { pthread_mutex_unlock(&g_mu); return -1; }
        buf[i] = bq_read_one(now, &c, (int)r);
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static int bq_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    calc_t c; snapshot(now, &c);
    for (size_t i = 0; i < len; i++) {
        unsigned r = (unsigned)reg + (unsigned)i;
        uint8_t b = buf[i];
        if (r >= BQ_NREG) { pthread_mutex_unlock(&g_mu); return -1; }
        if (r >= 0x0B && r <= 0x13) continue;                /* status, faults and ADC: read only */
        if (r == 0x14) {
            if (b & 0x80) {                                  /* REG_RST */
                bool was_ship = (g_bq[0x09] & 0x20) != 0;
                bq_reset();
                if (was_ship) g_shipped = false;
            }
            continue;                                        /* PN, revision, ICO flag read only */
        }
        uint8_t keep = b;
        if (r == 0x02) {
            if (b & 0x80) { g_adc_pending = true; g_adc_t0 = now; }   /* one-shot conversion starts */
            keep &= (uint8_t)~0x82;                           /* CONV_START, FORCE_DPDM self-clear */
        } else if (r == 0x03) keep &= (uint8_t)~0x40;         /* WD_RST */
        else if (r == 0x09) {
            keep &= (uint8_t)~0x83;                           /* FORCE_ICO, PUMPX_UP/DN */
            if ((b & 0x20) && !(g_bq[0x09] & 0x20)) {         /* BATFET_DIS: ship mode */
                int delayed = (b & 0x08) ? 1 : 0;
                ev_push(PWR_EV_SHIP, delayed, c.usb ? 1 : 0, delayed ? SHIP_DELAY_MS : 0);
                if (!delayed && !c.usb) g_shipped = true;     /* the board has no supply any more */
            }
        }
        g_bq[r] = keep;
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}

/* ---- CW2217 ------------------------------------------------------------------------------ */
static bool cw_ready(uint64_t now) { return g_cw_active && now >= g_cw_ready_at; }
static bool cw_ro(unsigned r) { return r <= 0x07 || r == 0x0E || r == 0x0F || (r >= 0xA4 && r <= 0xA9) || r == 0xAB; }
static uint8_t cw_read_one(uint64_t now, const calc_t *c, unsigned r)
{
    bool awake = g_cw_active;
    switch (r) {
    case 0x02: case 0x03: {
        if (!awake) return 0;
        unsigned raw = (unsigned)lround(c->vbat * 16.0 / 5.0) & 0x3FFF;
        return r == 0x02 ? (uint8_t)(raw >> 8) : (uint8_t)raw;
    }
    case 0x04: case 0x05: {
        if (!awake) return 0;
        double s = g_ovr_mv ? curve_pct(g_ovr_mv) : g_soc;
        unsigned x = (unsigned)lround(s * 256.0);
        if (x > 100u * 256u) x = 100u * 256u;
        return r == 0x04 ? (uint8_t)(x >> 8) : (uint8_t)x;
    }
    case 0x06: {
        if (!awake) return 0;
        long raw = lround((g_temp_c + 40.0) * 2.0);
        return (uint8_t)(raw < 0 ? 0 : raw > 255 ? 255 : raw);
    }
    case 0x0E: case 0x0F: case 0xA8: case 0xA9: {
        if (!awake) return 0;
        long raw = lround(c->i_cell * 1000.0 / 160.0);       /* 160 uA per step across the 10 mOhm shunt */
        if (raw > 32767) raw = 32767;
        if (raw < -32768) raw = -32768;
        uint16_t u = (uint16_t)(int16_t)raw;
        return (r & 1) == 0 ? (uint8_t)(u >> 8) : (uint8_t)u;
    }
    case 0xA7: return cw_ready(now) ? 0x0C : 0x00;
    case 0xAB: return awake ? 0x41 : 0x00;                   /* bits 7:6 = 01 for a CW2217 */
    case 0xA6: return awake ? 100 : 0;                       /* SOH */
    default: return g_cw[r];
    }
}
static int cw_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    calc_t c; snapshot(now, &c);
    for (size_t i = 0; i < len; i++) buf[i] = cw_read_one(now, &c, (uint8_t)(reg + i));
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static int cw_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i), b = buf[i];
        if (cw_ro(r)) continue;
        g_cw[r] = b;
        if (r == 0x08) {
            if (b == 0x00) {                                 /* active */
                if (!g_cw_active) { g_cw_active = true; g_cw_ready_at = now + GAUGE_READY_US; }
            } else g_cw_active = false;                      /* 0x30 restart / 0xF0 shutdown */
        }
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}

void dotbench_power_register(void)
{
    if (g_registered) return;
    g_registered = true;
    pthread_mutex_lock(&g_mu);
    bq_reset();
    g_cw[0x00] = 0xA0;                                       /* VERSION: CW221x */
    g_cw[0x08] = 0x00;                                       /* the gauge runs off the cell: found active */
    g_cw_active = true;
    g_cw_ready_at = 0;
    g_sim_t = now_us();
    pthread_mutex_unlock(&g_mu);
    static const dotbench_i2c_chip_t bq = { KBSP_I2C_ADDR_CHARGER, "BQ25896", bq_read, bq_write, NULL };
    static const dotbench_i2c_chip_t cw = { KBSP_I2C_ADDR_GAUGE, "CW2217", cw_read, cw_write, NULL };
    dotbench_i2c_register(&bq);
    dotbench_i2c_register(&cw);
}

/* ---- bench side (page thread) ------------------------------------------------------------- */
EMSCRIPTEN_KEEPALIVE void power_set_level(double pct)
{
    if (!(pct >= 0)) pct = 0;
    if (pct > 100) pct = 100;
    DB_PAGE_LOCK_V(&g_mu);
    g_soc = pct; g_ovr_mv = 0; g_sim_t = now_us();
    pthread_mutex_unlock(&g_mu);
}
/* kind: 1 USB host (500 mA), 2 adapter (3.25 A). Plugging also leaves ship mode, as VBUS does. */
EMSCRIPTEN_KEEPALIVE void power_set_usb(int plugged, int kind)
{
    DB_PAGE_LOCK_V(&g_mu);
    bool p = plugged != 0;
    if (kind == CABLE_SDP || kind == CABLE_ADAPTER) g_cable = kind;
    if (p) {
        g_bq[0x00] = (uint8_t)((g_bq[0x00] & 0xC0) | (g_cable == CABLE_ADAPTER ? 0x3F : 0x08));   /* input detection */
        if (g_bq[0x09] & 0x20) g_bq[0x09] &= (uint8_t)~0x20;
        g_shipped = false;
    }
    g_usb = p;
    g_sim_t = now_us();
    pthread_mutex_unlock(&g_mu);
}
EMSCRIPTEN_KEEPALIVE void power_set_temp(double c)
{
    DB_PAGE_LOCK_V(&g_mu);
    g_temp_c = c < -40 ? -40 : c > 80 ? 80 : c;
    pthread_mutex_unlock(&g_mu);
}
EMSCRIPTEN_KEEPALIVE void power_set_load(int ma)
{
    DB_PAGE_LOCK_V(&g_mu);
    g_load_ma = ma < 0 ? 0 : ma > 3000 ? 3000 : ma;
    pthread_mutex_unlock(&g_mu);
}
EMSCRIPTEN_KEEPALIVE void power_set_voltage(int mv)        /* open-circuit mV, 0 = follow the curve */
{
    pthread_mutex_lock(&g_mu);
    g_ovr_mv = mv <= 0 ? 0 : mv < 2000 ? 2000 : mv > 4500 ? 4500 : mv;
    pthread_mutex_unlock(&g_mu);
}
EMSCRIPTEN_KEEPALIVE void power_set_sim_speed(double x)
{
    DB_PAGE_LOCK_V(&g_mu);
    g_sim = x > 0 ? x : 0; g_sim_t = now_us();
    pthread_mutex_unlock(&g_mu);
}
EMSCRIPTEN_KEEPALIVE int power_get(int id)
{
    uint64_t now = now_us();
    DB_PAGE_LOCK(&g_mu, 0);
    calc_t c; snapshot(now, &c);
    int v = 0;
    switch (id) {
    case G_LEVEL_X100: v = (int)lround(soc_now() * 100.0); break;
    case G_VBAT_MV: v = (int)lround(c.vbat); break;
    case G_CHARGING: v = c.phase; break;
    case G_USB: v = g_usb ? 1 : 0; break;
    case G_TEMP_X10: v = (int)lround(g_temp_c * 10.0); break;
    case G_CURRENT_MA: v = (int)lround(c.i_cell); break;
    case G_SHIPPED: v = g_shipped ? 1 : 0; break;
    case G_CABLE: v = g_usb ? g_cable : 0; break;
    case G_VBUS_MV: v = c.vbus_mv; break;
    case G_LOAD_MA: v = g_load_ma; break;
    case G_OCV_MV: v = (int)lround(c.ocv); break;
    case G_GAUGE_READY: v = cw_ready(now) ? 1 : 0; break;
    case G_SIM_X100: v = (int)lround(g_sim * 100.0); break;
    case G_VOLT_OVERRIDE: v = g_ovr_mv; break;
    default: break;
    }
    pthread_mutex_unlock(&g_mu);
    return v;
}
EMSCRIPTEN_KEEPALIVE int power_event_pop(int32_t *out)
{
    int got = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (g_ev_r != g_ev_w) {
        event_t e = g_ev[g_ev_r++ & 63];
        out[0] = e.type; out[1] = e.a; out[2] = e.b; out[3] = e.c;
        got = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return got;
}

/* Test hooks: a register access as the I2C bus would do it (0 = ACK, -1 = no such chip). */
EMSCRIPTEN_KEEPALIVE int power_i2c_read(int addr, int reg, uint8_t *buf, int len)
{
    if (addr == KBSP_I2C_ADDR_CHARGER) return bq_read(NULL, (uint8_t)reg, buf, (size_t)len);
    if (addr == KBSP_I2C_ADDR_GAUGE) return cw_read(NULL, (uint8_t)reg, buf, (size_t)len);
    return -1;
}
EMSCRIPTEN_KEEPALIVE int power_i2c_write(int addr, int reg, const uint8_t *buf, int len)
{
    if (addr == KBSP_I2C_ADDR_CHARGER) return bq_write(NULL, (uint8_t)reg, buf, (size_t)len);
    if (addr == KBSP_I2C_ADDR_GAUGE) return cw_write(NULL, (uint8_t)reg, buf, (size_t)len);
    return -1;
}
