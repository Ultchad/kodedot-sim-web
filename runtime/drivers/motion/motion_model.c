/* SPDX-License-Identifier: GPL-3.0-or-later
 * Virtual QMI8658A (accelerometer + gyroscope, 0x6A) and QMC5883P (magnetometer, 0x2C) over
 * one virtual orientation. Register facts follow the SDK drivers (components/kdrv/motion/src/
 * kdrv_qmi8658.c, kdrv_qmc5883p.c) and the Rust models in kode-sim
 * (crates/kodedot-chips/src/qmi8658a.rs and qmc5883p.rs, GPL-3.0-or-later), whose register
 * handling (CTRL1 endianness/auto-increment, the CTRL9 handshake, the self-tests, the FIFO,
 * the magnetometer ranges and stimulus) is ported here. What is new: the sensors measure a
 * physical orientation that moves over time, and the data rates, scales and enables the driver
 * programs are honoured.
 *
 * AXES (docs/STATUS-sensors.md): the chips' axes ARE the board's axes. kbsp_board.h maps both
 * chips with identity (KBSP_IMU_AXIS_X..Z = 0..2, KBSP_IMU_SIGN_* = +1, same for KBSP_MAG_*):
 * x to the right, y toward the top of the Dot, z out of the glass. The accelerometer reads the
 * reaction to gravity: +1 g on the axis that points up (face up and flat: z = +1 g), as the SDK
 * example and kcompass_heading() assume.
 *
 * ANGLES. pitch and roll are the angles the SDK's imu example prints from the accelerometer:
 *     a = ( -sin(pitch), cos(pitch) sin(roll), cos(pitch) cos(roll) )   in g
 *     pitch = atan2(-ax, sqrt(ay^2+az^2)),  roll = atan2(ay, az)
 * (positive pitch: the right edge goes down; positive roll: the top goes up). heading is what
 * kcompass_heading() computes: the compass bearing, clockwise from magnetic north, of the
 * horizontal projection of the top (y axis), 0..360. Given the three, the orientation is unique.
 * The field is in the world (east, north, up) as (0, H, -D): horizontal H toward north, D down.
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
#include "dotbench_board.h"

#define DEG (M_PI / 180.0)
#define G_PER_S 1.0

/* ---- the physical world -------------------------------------------------------------------- */
typedef struct { double p, r, h; } ori_t;     /* degrees */

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
DB_PAGE_REGISTER(motion, "motion", g_mu, DB_LOCK_MUTEX)
static bool g_registered;
static ori_t g_from, g_to = { 0, 0, 0 };
static uint64_t g_t0, g_dur;                  /* transition start and length, us (g_dur 0 = still) */
static double g_field_h = 250.0, g_field_d = 380.0;     /* mG: horizontal toward north, down */
static double g_magnet[3];                    /* mG, board axes: a disturbance added to the field */
static double g_die_c = 30.0;
/* shake: a windowed oscillating acceleration burst along a unit vector, board axes */
static uint64_t g_sh_t0, g_sh_dur;
static double g_sh_peak, g_sh_hz, g_sh_dir[3];

static uint64_t now_us(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}
static ori_t ori_at(uint64_t t)
{
    if (g_dur == 0 || t >= g_t0 + g_dur) return g_to;
    if (t <= g_t0) return g_from;
    double u = (double)(t - g_t0) / (double)g_dur;
    double s = u * u * (3.0 - 2.0 * u);                    /* smoothstep: rate 0 at both ends */
    double dh = fmod(g_to.h - g_from.h + 540.0, 360.0) - 180.0;
    return (ori_t){ g_from.p + (g_to.p - g_from.p) * s, g_from.r + (g_to.r - g_from.r) * s,
                    fmod(g_from.h + dh * s + 360.0, 360.0) };
}
/* Body axes in world (east, north, up): columns m[.][0..2] = x, y, z. */
static void axes_of(ori_t o, double m[3][3], double a_out[3])
{
    double p = o.p * DEG, r = o.r * DEG, h = o.h * DEG;
    double a[3] = { -sin(p), cos(p) * sin(r), cos(p) * cos(r) };
    double ce = sqrt(fmax(0.0, 1.0 - a[1] * a[1]));
    double xf[3], yf[3], zf[3];
    yf[0] = 0; yf[1] = ce; yf[2] = a[1];
    if (ce < 1e-9) { xf[0] = 1; xf[1] = 0; xf[2] = 0; }
    else { xf[0] = a[2] / ce; xf[1] = -a[0] * a[1] / ce; xf[2] = a[0]; }
    zf[0] = xf[1] * yf[2] - xf[2] * yf[1];
    zf[1] = xf[2] * yf[0] - xf[0] * yf[2];
    zf[2] = xf[0] * yf[1] - xf[1] * yf[0];
    double eh[3] = { cos(h), -sin(h), 0 }, nh[3] = { sin(h), cos(h), 0 };
    const double *f[3] = { xf, yf, zf };
    for (int c = 0; c < 3; c++)
        for (int k = 0; k < 2; k++) m[k][c] = f[c][0] * eh[k] + f[c][1] * nh[k];
    for (int c = 0; c < 3; c++) m[2][c] = f[c][2];
    if (a_out) memcpy(a_out, a, sizeof a);
}
static void shake_accel_g(uint64_t t, double out[3])
{
    out[0] = out[1] = out[2] = 0;
    if (g_sh_dur == 0 || t < g_sh_t0 || t >= g_sh_t0 + g_sh_dur) return;
    double tau = (double)(t - g_sh_t0) / 1e6;
    double env = sin(M_PI * (double)(t - g_sh_t0) / (double)g_sh_dur);
    double v = g_sh_peak * env * sin(2.0 * M_PI * g_sh_hz * tau);
    for (int i = 0; i < 3; i++) out[i] = v * g_sh_dir[i];
}
/* Acceleration, g, on the board's axes at time t. */
static void accel_g(uint64_t t, double out[3])
{
    double m[3][3], a[3], sh[3];
    axes_of(ori_at(t), m, a);
    shake_accel_g(t, sh);
    for (int i = 0; i < 3; i++) out[i] = a[i] + sh[i];
}
/* Rotation rate, deg/s, about the board's axes at time t (backward difference over 4 ms). */
static void gyro_dps(uint64_t t, double out[3])
{
    const uint64_t dt = 4000;
    out[0] = out[1] = out[2] = 0;
    if (g_dur == 0 || t > g_t0 + g_dur + dt || t < g_t0) return;
    double m0[3][3], m1[3][3], A[3][3];
    axes_of(ori_at(t - dt), m0, NULL);
    axes_of(ori_at(t), m1, NULL);
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) {
            double s = 0;
            for (int k = 0; k < 3; k++) s += m0[k][i] * m1[k][j];
            A[i][j] = s;
        }
    double d = (double)dt / 1e6 * 2.0;
    out[0] = (A[2][1] - A[1][2]) / d / DEG;
    out[1] = (A[0][2] - A[2][0]) / d / DEG;
    out[2] = (A[1][0] - A[0][1]) / d / DEG;
}
/* The magnetic field, mG, on the board's axes at time t. */
static void field_mg(uint64_t t, double out[3])
{
    double m[3][3];
    axes_of(ori_at(t), m, NULL);
    double w[3] = { 0, g_field_h, -g_field_d };
    for (int c = 0; c < 3; c++) out[c] = w[0] * m[0][c] + w[1] * m[1][c] + w[2] * m[2][c] + g_magnet[c];
}

/* ---- QMI8658A ------------------------------------------------------------------------------ */
#define Q_WHO 0x00
#define Q_REV 0x01
#define Q_CTRL1 0x02
#define Q_CTRL2 0x03
#define Q_CTRL3 0x04
#define Q_CTRL7 0x08
#define Q_CTRL8 0x09
#define Q_CTRL9 0x0A
#define Q_FIFO_CTRL 0x14
#define Q_FIFO_CNT 0x15
#define Q_FIFO_STATUS 0x16
#define Q_FIFO_DATA 0x17
#define Q_STATUSINT 0x2D
#define Q_STATUS0 0x2E
#define Q_TEMP_L 0x33
#define Q_GZ_H 0x40
#define Q_RESET 0x60
#define Q_DVX_L 0x51
#define Q_DVZ_H 0x56
#define FIFO_DEPTH 128u
#define ST_XL_LSB 1100
#define ST_GY_LSB 8000
#define ST_US 2000u

static uint8_t q_reg[256];
static uint64_t q_en_a, q_en_g;               /* when each sensor was switched on, 0 = off */
static uint64_t q_st_at;                      /* self-test start, 0 = none */
static bool q_st_gyro;
static uint64_t q_fifo_from;
static uint64_t q_fifo_bytes;

static const double ODR_A_ONLY[16] = { 8000, 4000, 2000, 1000, 500, 250, 125, 62.5, 31.25, 0, 0, 0, 128, 21, 11, 3 };
static const double ODR_6DOF[16] = { 7174.4, 3587.2, 1793.6, 896.8, 448.4, 224.2, 112.1, 56.05, 28.025, 0, 0, 0, 128, 21, 11, 3 };
static bool q_on_a(void) { return q_reg[Q_CTRL7] & 1; }
static bool q_on_g(void) { return q_reg[Q_CTRL7] & 2; }
static double q_odr_a(void)
{
    const double *t = q_on_g() ? ODR_6DOF : ODR_A_ONLY;        /* with the gyroscope on, both run at its table */
    double v = t[(q_on_g() ? q_reg[Q_CTRL3] : q_reg[Q_CTRL2]) & 0x0F];
    return v > 0 ? v : 1000;
}
static double q_odr_g(void)
{
    double v = ODR_6DOF[q_reg[Q_CTRL3] & 0x0F];
    return v > 0 ? v : 896.8;
}
static double q_lsb_per_g(void) { return 16384.0 / (double)(1 << ((q_reg[Q_CTRL2] >> 4) & 3)); }
static double q_lsb_per_dps(void) { return 2048.0 / (double)(1 << ((q_reg[Q_CTRL3] >> 4) & 7)); }
static uint64_t quant(uint64_t t, double odr)
{
    double period = 1e6 / odr;
    return (uint64_t)(floor((double)t / period) * period);
}
static int16_t clip16(double v)
{
    long l = lround(v);
    return (int16_t)(l > 32767 ? 32767 : l < -32768 ? -32768 : l);
}
static void put16(uint8_t *d, int16_t v)
{
    if (q_reg[Q_CTRL1] & 0x20) { d[0] = (uint8_t)((uint16_t)v >> 8); d[1] = (uint8_t)v; }
    else { d[0] = (uint8_t)v; d[1] = (uint8_t)((uint16_t)v >> 8); }
}
static bool a_valid(uint64_t now) { return q_on_a() && q_en_a && now - q_en_a >= (uint64_t)(3e6 / q_odr_a()) + 1; }
static bool g_valid(uint64_t now) { return q_on_g() && q_en_g && now - q_en_g >= 150000u + (uint64_t)(3e6 / q_odr_g()); }
/* Registers 0x33..0x40 as they read at `now`: one snapshot (temperature, acceleration, rotation). */
static void q_data(uint64_t now, uint8_t d[14])
{
    memset(d, 0, 14);
    if (!q_on_a() && !q_on_g()) return;
    put16(&d[0], clip16(g_die_c * 256.0));
    double lg = q_lsb_per_g(), ld = q_lsb_per_dps();
    if (a_valid(now)) {
        double a[3];
        accel_g(quant(now, q_odr_a()), a);
        for (int i = 0; i < 3; i++) put16(&d[2 + 2 * i], clip16(a[i] * lg));
    }
    if (g_valid(now)) {
        double w[3];
        gyro_dps(quant(now, q_odr_g()), w);
        for (int i = 0; i < 3; i++) put16(&d[8 + 2 * i], clip16(w[i] * ld));
    }
}
static bool q_fifo_on(void) { return (q_reg[Q_FIFO_CTRL] & 3) == 1; }
static uint64_t q_fifo_samples(uint64_t now)
{
    if (!q_fifo_on()) return 0;
    double odr = q_odr_a();
    uint64_t made = (uint64_t)((double)(now - q_fifo_from) * odr / 1e6);
    uint64_t taken = q_fifo_bytes / 6;
    if (made > taken + FIFO_DEPTH) {                 /* full: the oldest samples are overwritten (documented) */
        taken = made - FIFO_DEPTH;
        q_fifo_bytes = taken * 6;
    }
    return made > taken ? made - taken : 0;
}
static uint8_t q_fifo_byte(uint64_t now)
{
    /* the k-th sample the FIFO ever made was converted at q_fifo_from + (k+1)/odr */
    uint64_t k = q_fifo_bytes / 6;
    uint8_t rec[6];
    double a[3];
    uint64_t ts = q_fifo_from + (uint64_t)((double)(k + 1) * 1e6 / q_odr_a());
    accel_g(ts, a);
    for (int i = 0; i < 3; i++) put16(&rec[2 * i], clip16(a[i] * q_lsb_per_g()));
    uint8_t b = rec[q_fifo_bytes % 6];
    if (q_fifo_samples(now) > 0 || q_fifo_bytes % 6) q_fifo_bytes++;
    return b;
}
static uint8_t q_statusint(uint64_t now)
{
    if (q_st_at && now - q_st_at >= ST_US) q_reg[Q_STATUSINT] |= 0x01;
    return q_reg[Q_STATUSINT];
}
static uint8_t q_step_reg(uint8_t reg, size_t i)
{
    if (reg == Q_FIFO_DATA) return reg;                              /* the FIFO port streams: no increment */
    return (q_reg[Q_CTRL1] & 0x40) ? (uint8_t)(reg + i) : reg;     /* auto-increment is CTRL1 bit 6 */
}
static int q_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    uint8_t d[14];
    q_data(now, d);                                              /* the burst is one instant */
    for (size_t i = 0; i < len; i++) {
        uint8_t r = q_step_reg(reg, i);
        uint8_t v;
        switch (r) {
        case Q_STATUSINT: v = q_statusint(now); break;
        case Q_STATUS0: v = (uint8_t)((a_valid(now) ? 1 : 0) | (g_valid(now) ? 2 : 0)); break;
        case Q_FIFO_CNT: v = (uint8_t)(q_fifo_samples(now) * 3); break;
        case Q_FIFO_STATUS: v = (uint8_t)(((q_fifo_samples(now) * 3) >> 8) & 3); break;
        case Q_FIFO_DATA: v = q_fifo_byte(now); break;
        case Q_TEMP_L ... Q_GZ_H: v = d[r - Q_TEMP_L]; break;
        case Q_DVX_L ... Q_DVZ_H: {
            int16_t w = q_st_gyro ? ST_GY_LSB : ST_XL_LSB;
            uint8_t b[2]; put16(b, w);
            v = b[(r - Q_DVX_L) & 1]; break;
        }
        default: v = q_reg[r];
        }
        buf[i] = v;
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static void q_reset(void)
{
    memset(q_reg, 0, sizeof q_reg);
    q_reg[Q_WHO] = 0x05;
    q_reg[Q_REV] = 0x7C;
    q_reg[Q_CTRL1] = 0x20;                                       /* big endian, no auto-increment */
    q_en_a = q_en_g = q_st_at = 0;
    q_fifo_from = q_fifo_bytes = 0;
}
static void q_put(uint64_t now, uint8_t reg, uint8_t v)
{
    switch (reg) {
    case Q_WHO: case Q_REV: case Q_STATUSINT: case Q_STATUS0: case Q_FIFO_CNT: case Q_FIFO_STATUS: case Q_FIFO_DATA:
    case Q_TEMP_L ... Q_GZ_H: case Q_DVX_L ... Q_DVZ_H:
        return;
    case Q_RESET:
        if (v == 0xB0) q_reset();                                 /* datasheet soft reset */
        return;
    case Q_CTRL2: case Q_CTRL3: {
        bool was = (q_reg[reg] & 0x80) != 0;
        q_reg[reg] = v;
        bool is = (v & 0x80) != 0;
        if (is && !was) { q_st_at = now; q_st_gyro = reg == Q_CTRL3; q_reg[Q_STATUSINT] &= (uint8_t)~0x01; }
        else if (!is && was) { q_st_at = 0; q_reg[Q_STATUSINT] &= (uint8_t)~0x01; }
        return;
    }
    case Q_CTRL7: {
        uint8_t old = q_reg[Q_CTRL7];
        q_reg[Q_CTRL7] = v;
        if ((v & 1) && !(old & 1)) q_en_a = now;
        if ((v & 2) && !(old & 2)) q_en_g = now;
        if (!(v & 1)) q_en_a = 0;
        if (!(v & 2)) q_en_g = 0;
        return;
    }
    case Q_CTRL9:
        q_reg[reg] = v;
        if (v == 0) q_reg[Q_STATUSINT] &= (uint8_t)~0x80;
        else {
            if (v == 0x04) { q_fifo_from = now; q_fifo_bytes = 0; }          /* CTRL_CMD_RST_FIFO */
            if (q_reg[Q_CTRL8] & 0x80) q_reg[Q_STATUSINT] |= 0x80;          /* handshake on STATUSINT bit 7 */
        }
        return;
    case Q_FIFO_CTRL: {
        bool was = q_fifo_on();
        q_reg[reg] = v;
        if (q_fifo_on() && !was) { q_fifo_from = now; q_fifo_bytes = 0; }
        return;
    }
    default: q_reg[reg] = v;
    }
}
static int q_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) q_put(now, q_step_reg(reg, i), buf[i]);
    pthread_mutex_unlock(&g_mu);
    return 0;
}

/* ---- QMC5883P ------------------------------------------------------------------------------ */
#define M_ID 0x00
#define M_X_LSB 0x01
#define M_Z_MSB 0x06
#define M_STATUS 0x09
#define M_CTRL1 0x0A
#define M_CTRL2 0x0B
#define M_SIGN 0x29
static uint8_t m_reg[256];
static uint64_t m_since;                      /* when the mode became continuous, 0 = suspended */
static uint64_t m_last_read_idx;              /* conversion index of the last data read */
static bool m_stimulus;

static double m_odr(void)
{
    static const double t[4] = { 10, 50, 100, 200 };
    return t[(m_reg[M_CTRL1] >> 2) & 3];
}
static bool m_continuous(void) { return (m_reg[M_CTRL1] & 3) == 3; }
static double m_lsb_per_g(void) { static const double t[4] = { 1000, 2500, 3750, 15000 }; return t[(m_reg[M_CTRL2] >> 2) & 3]; }
static double m_range_mg(void) { static const double t[4] = { 30000, 12000, 8000, 2000 }; return t[(m_reg[M_CTRL2] >> 2) & 3]; }
/* Index of the latest finished conversion (the first one finishes a period after the mode was set). */
static uint64_t m_index(uint64_t now)
{
    if (!m_continuous() || !m_since) return 0;
    return (uint64_t)((double)(now - m_since) * m_odr() / 1e6);
}
static void m_field(uint64_t now, double f[3])
{
    uint64_t idx = m_index(now);
    uint64_t ts = m_since + (uint64_t)((double)idx * 1e6 / m_odr());
    if (idx == 0 || !m_continuous()) ts = now;
    field_mg(ts, f);
    if (m_stimulus) { static const double st[3] = { -1500, 1500, 1500 }; for (int i = 0; i < 3; i++) f[i] += st[i]; }
}
static int m_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    double f[3];
    m_field(now, f);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i);
        uint8_t v;
        if (r == M_STATUS) {
            v = 0;
            if (m_continuous() && m_index(now) > m_last_read_idx) {            /* a conversion nobody has read yet */
                v |= 0x01;
                if (fabs(f[0]) > m_range_mg() || fabs(f[1]) > m_range_mg() || fabs(f[2]) > m_range_mg()) v |= 0x02;
            }
        } else if (r >= M_X_LSB && r <= M_Z_MSB) {
            int ax = (r - M_X_LSB) / 2;
            int16_t c = clip16(f[ax] * m_lsb_per_g() / 1000.0);
            v = ((r - M_X_LSB) & 1) ? (uint8_t)((uint16_t)c >> 8) : (uint8_t)c;
            if (r == M_Z_MSB) {
                m_last_read_idx = m_index(now);                                 /* DRDY drops once the data is read */
                if (m_stimulus) {
                    m_stimulus = false;
                    m_reg[M_CTRL2] &= (uint8_t)~0x40;
                    m_reg[M_CTRL1] = (uint8_t)((m_reg[M_CTRL1] & ~3u) | 0u);   /* the part parks itself */
                    m_since = 0;
                }
            }
        } else v = m_reg[r];
        buf[i] = v;
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static void m_reset(void)
{
    memset(m_reg, 0, sizeof m_reg);
    m_reg[M_ID] = 0x80;
    m_since = 0; m_last_read_idx = 0; m_stimulus = false;
}
static int m_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    uint64_t now = now_us();
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i), v = buf[i];
        if (r == M_ID || r == M_STATUS || (r >= M_X_LSB && r <= M_Z_MSB)) continue;
        if (r == M_CTRL1) {
            m_reg[r] = v;
            if ((v & 3) == 3) { if (!m_since) { m_since = now; m_last_read_idx = 0; } }
            else m_since = 0;
        } else if (r == M_CTRL2) {
            if (v & 0x80) { m_reset(); continue; }                              /* soft reset */
            m_reg[r] = v;
            m_stimulus = (v & 0x40) != 0;
        } else m_reg[r] = v;
    }
    pthread_mutex_unlock(&g_mu);
    return 0;
}

void dotbench_motion_register(void)
{
    if (g_registered) return;
    g_registered = true;
    pthread_mutex_lock(&g_mu);
    q_reset();
    m_reset();
    pthread_mutex_unlock(&g_mu);
    static const dotbench_i2c_chip_t imu = { KBSP_I2C_ADDR_IMU, "QMI8658A", q_read, q_write, NULL };
    static const dotbench_i2c_chip_t mag = { KBSP_I2C_ADDR_MAG, "QMC5883P", m_read, m_write, NULL };
    dotbench_i2c_register(&imu);
    dotbench_i2c_register(&mag);
}

/* ---- bench side (page thread) ---------------------------------------------------------------- */
/* Move to pitch/roll/heading (degrees). ms < 0: pick a duration that keeps the rate near
 * 375 deg/s (4 ms per degree of the largest change, 120 ms..2 s); ms == 0: jump. */
EMSCRIPTEN_KEEPALIVE void motion_set_orientation(double pitch, double roll, double heading, double ms)
{
    uint64_t now = now_us();
    DB_PAGE_LOCK_V(&g_mu);
    ori_t cur = ori_at(now);
    ori_t to = { pitch, roll, fmod(fmod(heading, 360.0) + 360.0, 360.0) };
    double dh = fabs(fmod(to.h - cur.h + 540.0, 360.0) - 180.0);
    double big = fmax(fmax(fabs(to.p - cur.p), fabs(to.r - cur.r)), dh);
    double d_ms = ms < 0 ? fmin(2000.0, fmax(120.0, big * 4.0)) : ms;
    g_from = cur; g_to = to; g_t0 = now;
    g_dur = d_ms > 0 ? (uint64_t)(d_ms * 1000.0) : 0;
    if (g_dur == 0) g_from = to;
    pthread_mutex_unlock(&g_mu);
}
/* A burst of acceleration: peak (g) windowed over ms, oscillating at hz along (dx, dy, dz). */
EMSCRIPTEN_KEEPALIVE void motion_shake(double peak_g, double ms, double hz, double dx, double dy, double dz)
{
    uint64_t now = now_us();
    double n = sqrt(dx * dx + dy * dy + dz * dz);
    DB_PAGE_LOCK_V(&g_mu);
    if (n < 1e-9) { dx = 1; dy = 0.6; dz = 0.3; n = sqrt(1 + 0.36 + 0.09); }
    g_sh_dir[0] = dx / n; g_sh_dir[1] = dy / n; g_sh_dir[2] = dz / n;
    g_sh_peak = peak_g; g_sh_hz = hz > 0 ? hz : 6;
    g_sh_t0 = now; g_sh_dur = ms > 0 ? (uint64_t)(ms * 1000.0) : 0;
    pthread_mutex_unlock(&g_mu);
}
/* A disturbing field on the board's axes, mG (a magnet near the sensor); 0,0,0 removes it. */
EMSCRIPTEN_KEEPALIVE void motion_set_magnet(double mx, double my, double mz)
{
    DB_PAGE_LOCK_V(&g_mu);
    g_magnet[0] = mx; g_magnet[1] = my; g_magnet[2] = mz;
    pthread_mutex_unlock(&g_mu);
}
/* The Earth's field where the bench is: horizontal (toward magnetic north) and downward, mG. */
EMSCRIPTEN_KEEPALIVE void motion_set_field(double horizontal_mg, double down_mg)
{
    DB_PAGE_LOCK_V(&g_mu);
    g_field_h = horizontal_mg; g_field_d = down_mg;
    pthread_mutex_unlock(&g_mu);
}
enum { G_PITCH_X100, G_ROLL_X100, G_HEADING_X100, G_MOVING, G_SHAKING, G_AX, G_AY, G_AZ, G_GX, G_GY, G_GZ,
       G_MX, G_MY, G_MZ, G_ODR_A_X100, G_ODR_G_X100, G_FS_G, G_FS_DPS, G_MAG_RANGE, G_MAG_ODR, G_ON_BITS,
       G_MAG_ON, G_TARGET_P_X100, G_TARGET_R_X100, G_TARGET_H_X100 };
/* The world as the sensors would see it right now (ideal, unquantised): milli-g, milli-dps, mG. */
EMSCRIPTEN_KEEPALIVE int motion_get(int id)
{
    uint64_t now = now_us();
    DB_PAGE_LOCK(&g_mu, 0);
    ori_t o = ori_at(now);
    double a[3], w[3], f[3];
    accel_g(now, a); gyro_dps(now, w); field_mg(now, f);
    int v = 0;
    switch (id) {
    case G_PITCH_X100: v = (int)lround(o.p * 100); break;
    case G_ROLL_X100: v = (int)lround(o.r * 100); break;
    case G_HEADING_X100: v = (int)lround(o.h * 100); break;
    case G_MOVING: v = (g_dur && now < g_t0 + g_dur) ? 1 : 0; break;
    case G_SHAKING: v = (g_sh_dur && now >= g_sh_t0 && now < g_sh_t0 + g_sh_dur) ? 1 : 0; break;
    case G_AX: v = (int)lround(a[0] * 1000); break;
    case G_AY: v = (int)lround(a[1] * 1000); break;
    case G_AZ: v = (int)lround(a[2] * 1000); break;
    case G_GX: v = (int)lround(w[0] * 1000); break;
    case G_GY: v = (int)lround(w[1] * 1000); break;
    case G_GZ: v = (int)lround(w[2] * 1000); break;
    case G_MX: v = (int)lround(f[0]); break;
    case G_MY: v = (int)lround(f[1]); break;
    case G_MZ: v = (int)lround(f[2]); break;
    case G_ODR_A_X100: v = (int)lround(q_odr_a() * 100); break;
    case G_ODR_G_X100: v = (int)lround(q_odr_g() * 100); break;
    case G_FS_G: v = 2 << ((q_reg[Q_CTRL2] >> 4) & 3); break;
    case G_FS_DPS: v = 16 << ((q_reg[Q_CTRL3] >> 4) & 7); break;
    case G_MAG_RANGE: v = (int)m_range_mg(); break;
    case G_MAG_ODR: v = (int)m_odr(); break;
    case G_ON_BITS: v = q_reg[Q_CTRL7] & 3; break;
    case G_MAG_ON: v = m_continuous() ? 1 : 0; break;
    case G_TARGET_P_X100: v = (int)lround(g_to.p * 100); break;
    case G_TARGET_R_X100: v = (int)lround(g_to.r * 100); break;
    case G_TARGET_H_X100: v = (int)lround(g_to.h * 100); break;
    default: break;
    }
    pthread_mutex_unlock(&g_mu);
    return v;
}

/* Test hooks: a register access as the I2C bus would do it (0 = ACK, -1 = no such chip). */
EMSCRIPTEN_KEEPALIVE int motion_i2c_read(int addr, int reg, uint8_t *buf, int len)
{
    if (addr == KBSP_I2C_ADDR_IMU) return q_read(NULL, (uint8_t)reg, buf, (size_t)len);
    if (addr == KBSP_I2C_ADDR_MAG) return m_read(NULL, (uint8_t)reg, buf, (size_t)len);
    return -1;
}
EMSCRIPTEN_KEEPALIVE int motion_i2c_write(int addr, int reg, const uint8_t *buf, int len)
{
    if (addr == KBSP_I2C_ADDR_IMU) return q_write(NULL, (uint8_t)reg, buf, (size_t)len);
    if (addr == KBSP_I2C_ADDR_MAG) return m_write(NULL, (uint8_t)reg, buf, (size_t)len);
    return -1;
}
