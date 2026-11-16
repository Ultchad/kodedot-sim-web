/* SPDX-License-Identifier: GPL-3.0-or-later
 * Virtual CST820 at 0x15. Register 0x01 holds the frame the SDK reads (gesture,
 * fingers, event|x_hi, x_lo, y_hi, y_lo), 0xA7 the identity (chip 0xB7). The
 * page's kweb_touch() updates the frame and pulls TP_INT (expander P6) low
 * while a finger is down. */
#include <pthread.h>
#include <string.h>
#include "kbsp_pins.h"
#include "kweb_bridge.h"
#include "dotbench_board.h"

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static uint8_t g_reg[0x100];
static bool g_registered;

static void on_touch(void)
{
    kweb_state_t *s = kweb_state();
    int x = s->touch_x, y = s->touch_y;
    bool down = s->touch_down != 0;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    pthread_mutex_lock(&g_mu);
    g_reg[0x01] = 0;                                       /* gesture */
    g_reg[0x02] = down ? 1 : 0;                            /* fingers */
    g_reg[0x03] = (uint8_t)((down ? 0x80 : 0x40) | ((x >> 8) & 0x0F));   /* event | xh */
    g_reg[0x04] = (uint8_t)x;
    g_reg[0x05] = (uint8_t)((y >> 8) & 0x0F);
    g_reg[0x06] = (uint8_t)y;
    pthread_mutex_unlock(&g_mu);
    dotbench_ioexp_set_tp_int(down);
}
static int tp_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) buf[i] = g_reg[(reg + i) & 0xFF];
    pthread_mutex_unlock(&g_mu);
    return 0;
}
static int tp_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++)
        if ((uint8_t)(reg + i) > 0x06) g_reg[(uint8_t)(reg + i)] = buf[i];   /* the frame is read-only */
    pthread_mutex_unlock(&g_mu);
    return 0;
}
void dotbench_touch_register(void)
{
    if (g_registered) return;
    g_registered = true;
    g_reg[0xA7] = 0xB7; g_reg[0xA8] = 0x01; g_reg[0xA9] = 0x01;
    static const dotbench_i2c_chip_t chip = { KBSP_I2C_ADDR_TOUCH, "CST820", tp_read, tp_write, NULL };
    dotbench_i2c_register(&chip);
    kweb_set_touch_hook(on_touch);
}
