/* SPDX-License-Identifier: GPL-3.0-or-later
 * The virtual board: what the fake khal_gpio, the fake khal_i2c and the chip
 * models share. Internal to runtime/drivers. */
#ifndef DOTBENCH_BOARD_H
#define DOTBENCH_BOARD_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* A pin driven from outside the chip (a button, an open-drain INT line). */
void dotbench_gpio_drive(uint8_t pin, bool level);

typedef struct dotbench_i2c_chip {
    uint8_t     addr;
    const char *name;
    /* Register-oriented access, the only shape khal_i2c exposes. Return 0 on ACK. */
    int (*read)(void *ctx, uint8_t reg, uint8_t *buf, size_t len);
    int (*write)(void *ctx, uint8_t reg, const uint8_t *buf, size_t len);
    void *ctx;
} dotbench_i2c_chip_t;

void dotbench_i2c_register(const dotbench_i2c_chip_t *chip);

/* Chip model entry points; each registers itself with the bus at khal_i2c_init(). */
void dotbench_ioexp_register(void);   /* gpio/  : TCA6408A + the six buttons + TP_INT */
void dotbench_led_register(void);     /* led/   : KTD2026 -> kweb_state.led_rgb       */
void dotbench_touch_register(void);   /* touch/ : CST820  <- kweb_touch()             */

/* ioexp <-> touch: the TP_INT line (expander bit 6, active low). */
void dotbench_ioexp_set_tp_int(bool asserted);
#endif
