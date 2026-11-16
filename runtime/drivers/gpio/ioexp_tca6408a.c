/* SPDX-License-Identifier: GPL-3.0-or-later
 * Virtual TCA6408A at 0x20 plus what hangs off it: five buttons (P0..P4, low =
 * pressed), the touch IRQ (P6, low = finger down) and the open-drain INT line
 * on GPIO6. INT follows the datasheet: it falls when an input differs from
 * what the last read of the input register returned, and rises on that read.
 * The sixth button (TOP) is on GPIO35 and is driven here too. */
#include <pthread.h>
#include <string.h>
#include "kbsp_pins.h"
#include "kweb_bridge.h"
#include "dotbench_board.h"

#define R_IN 0
#define R_OUT 1
#define R_POL 2
#define R_CFG 3
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static uint8_t g_reg[4] = { 0x00, 0xFF, 0x00, 0xFF };
static uint8_t g_snapshot = 0xFF;
static bool g_tp_int;
static bool g_registered;

/* KWEB_BTN_* (bridge) = KODE_SYS_BUTTON numbering: UP0 DOWN1 LEFT2 RIGHT3 TOP4 BOT5. */
static uint8_t pins_now(void)
{
    uint32_t b = kweb_state()->buttons;
    uint8_t v = 0x7F;                       /* P0..P6 pulled up */
    if (b & (1u << 5)) v &= (uint8_t)~(1u << KBSP_IOEXP_BIT_BTN_BOT);
    if (b & (1u << 0)) v &= (uint8_t)~(1u << KBSP_IOEXP_BIT_PAD_UP);
    if (b & (1u << 2)) v &= (uint8_t)~(1u << KBSP_IOEXP_BIT_PAD_LEFT);
    if (b & (1u << 1)) v &= (uint8_t)~(1u << KBSP_IOEXP_BIT_PAD_DOWN);
    if (b & (1u << 3)) v &= (uint8_t)~(1u << KBSP_IOEXP_BIT_PAD_RIGHT);
    if (g_tp_int)      v &= (uint8_t)~(1u << KBSP_IOEXP_BIT_TP_INT);
    return v;
}
static uint8_t input_reg(void)
{
    /* Pins configured as outputs read back the output latch. */
    uint8_t cfg = g_reg[R_CFG];
    uint8_t v = (uint8_t)((pins_now() & cfg) | (g_reg[R_OUT] & (uint8_t)~cfg));
    return (uint8_t)(v ^ g_reg[R_POL]);
}
/* Caller holds g_mu. Returns the INT level to drive (true = released/high). */
static bool int_level(void) { return input_reg() == g_snapshot; }

static int ioexp_read(void *ctx, uint8_t reg, uint8_t *buf, size_t len)
{
    (void)ctx;
    if (reg > 3) return -1;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i) & 3;
        if (r == R_IN) { g_reg[R_IN] = input_reg(); g_snapshot = g_reg[R_IN]; }
        buf[i] = g_reg[r];
    }
    bool lvl = int_level();
    pthread_mutex_unlock(&g_mu);
    dotbench_gpio_drive(KBSP_PIN_IOEXP_INT, lvl);
    return 0;
}
static int ioexp_write(void *ctx, uint8_t reg, const uint8_t *buf, size_t len)
{
    (void)ctx;
    if (reg > 3) return -1;
    pthread_mutex_lock(&g_mu);
    for (size_t i = 0; i < len; i++) {
        uint8_t r = (uint8_t)(reg + i) & 3;
        if (r != R_IN) g_reg[r] = buf[i];
    }
    bool lvl = int_level();
    pthread_mutex_unlock(&g_mu);
    dotbench_gpio_drive(KBSP_PIN_IOEXP_INT, lvl);
    return 0;
}

static void on_buttons(void)
{
    bool top = (kweb_state()->buttons >> 4) & 1u;
    dotbench_gpio_drive(KBSP_PIN_BUTTON_TOP, !top);
    pthread_mutex_lock(&g_mu);
    bool lvl = int_level();
    pthread_mutex_unlock(&g_mu);
    dotbench_gpio_drive(KBSP_PIN_IOEXP_INT, lvl);
}
void dotbench_ioexp_set_tp_int(bool asserted)
{
    pthread_mutex_lock(&g_mu);
    g_tp_int = asserted;
    bool lvl = int_level();
    pthread_mutex_unlock(&g_mu);
    dotbench_gpio_drive(KBSP_PIN_IOEXP_INT, lvl);
}

void dotbench_ioexp_register(void)
{
    if (g_registered) return;
    g_registered = true;
    static const dotbench_i2c_chip_t chip = { KBSP_I2C_ADDR_IOEXP, "TCA6408A", ioexp_read, ioexp_write, NULL };
    dotbench_i2c_register(&chip);
    pthread_mutex_lock(&g_mu);
    g_snapshot = input_reg();
    pthread_mutex_unlock(&g_mu);
    dotbench_gpio_drive(KBSP_PIN_IOEXP_INT, true);
    dotbench_gpio_drive(KBSP_PIN_BUTTON_TOP, true);
    kweb_set_button_hook(on_buttons);
}
