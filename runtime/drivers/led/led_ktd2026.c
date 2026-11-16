/* SPDX-License-Identifier: GPL-3.0-or-later
 * Virtual KTD2026 at 0x30. The three current sinks (OUT1 green, OUT2 blue,
 * OUT3 red on this board) and the enable bits are turned back into the colour
 * kdrv_led asked for: level = (code+1)*0.125 mA / 5 mA * 255. The result goes
 * to kweb_state.led_rgb (0x00RRGGBB) and led_seq. */
#include <math.h>
#include <pthread.h>
#include <string.h>
#include "kbsp_pins.h"
#include "kweb_bridge.h"
#include "dotbench_board.h"

#define R_EN_RST 0x00
#define R_LED_EN 0x04
#define R_ISET1  0x06
#define R_ISET2  0x07
#define R_ISET3  0x08
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static uint8_t g_reg[0x20];
static bool g_registered;

static uint32_t chan(int ch, uint8_t iset)
{
    bool on = ((g_reg[R_LED_EN] >> (2 * ch)) & 3u) == 1u;
    if ((g_reg[R_EN_RST] & 0x18u) != 0x18u) on = false;      /* asleep */
    if (!on) return 0;
    double ma = (iset + 1) * 0.125;
    long v = lround(ma / 5.0 * 255.0);
    return v > 255 ? 255 : (uint32_t)v;
}
static void publish(void)
{
    uint32_t g = chan(0, g_reg[R_ISET1]);
    uint32_t b = chan(1, g_reg[R_ISET2]);
    uint32_t r = chan(2, g_reg[R_ISET3]);
    uint32_t rgb = (r << 16) | (g << 8) | b;
    kweb_state_t *s = kweb_state();
    if (s->led_rgb != rgb) {
        s->led_rgb = rgb;
        __atomic_fetch_add(&s->led_seq, 1u, __ATOMIC_SEQ_CST);
    }
}
static int led_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) buf[i] = g_reg[(reg + i) & 0x1F];
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static int led_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (reg + i) & 0x1F;
        if (r == R_EN_RST && buf[i] == 0x07) memset(g_reg, 0, sizeof g_reg);   /* full reset */
        else g_reg[r] = buf[i];
    }
    publish();
    pthread_mutex_unlock(&g_mu);
    return 0;
}
void dotbench_led_register(void)
{
    if (g_registered) return;
    g_registered = true;
    static const dotbench_i2c_chip_t chip = { KBSP_I2C_ADDR_LED, "KTD2026", led_read, led_write, NULL };
    dotbench_i2c_register(&chip);
}
