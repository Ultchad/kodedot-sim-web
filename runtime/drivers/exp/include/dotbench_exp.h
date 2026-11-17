/* SPDX-License-Identifier: GPL-3.0-or-later
 * The expansion header's link to the bench model (runtime/web-adapter/bench.js): one shared block in the firmware's memory.
 *
 *   firmware -> bench   pin drive state (per J3 position), the 5 V boost bit, bus requests (one mailbox), UART TX
 *   bench -> firmware   the level and the millivolts on every position, UART RX bytes, bus replies
 *
 * Layout (all words little-endian u32/i32, read by exp.js; offsets pinned in exp_link.c):
 *   word 0  magic 'DBX1'   1 abi   2 attached (the bench sets it)   3 doorbell (the firmware bumps it)   4 in_seq (the bench bumps it)
 *   word 5  v5_boost       6 rx_wake  7 rx_head (bench)  8 rx_tail (firmware)  9 rx_drop
 *   word 16.. pin[14], 8 words each: seq(odd while writing) mode pull level hz duty_q16 gen 0
 *   word 128.. level_in[16]   144.. mv_in[16]     word 160.. mailbox      byte 704.. w[1024]  r[1024]  rx[1024]
 * Nothing here blocks the page; the firmware side may block (mailbox replies) and never holds a lock across an SDK call. */
#ifndef DOTBENCH_EXP_H
#define DOTBENCH_EXP_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define DBX_POS 14

typedef enum { DBX_Z = 0, DBX_IN = 1, DBX_OUT = 2, DBX_PWM = 3, DBX_ADC = 4 } dbx_mode_t;
enum { DBX_PULL_NONE = 0, DBX_PULL_UP = 1, DBX_PULL_DOWN = 2 };

/* Mailbox kinds. Parameters p[0..5]; results: 0 ok, 1 nack address, 2 nack data, 3 stuck, 4 timeout, 5 refused. */
enum {
    DBX_RQ_I2C_OPEN = 1, DBX_RQ_I2C_CLOSE, DBX_RQ_I2C_XFER, DBX_RQ_I2C_PROBE,
    DBX_RQ_SPI_OPEN, DBX_RQ_SPI_CLOSE, DBX_RQ_SPI_XFER,
    DBX_RQ_UART_OPEN, DBX_RQ_UART_CLOSE, DBX_RQ_UART_WRITE
};
enum { DBX_R_OK = 0, DBX_R_NACK_ADDR = 1, DBX_R_NACK_DATA = 2, DBX_R_STUCK = 3, DBX_R_TIMEOUT = 4, DBX_R_REFUSED = 5,
       DBX_R_NOHOST = -1001, DBX_R_NOREPLY = -1002 };

/* J3 position (0..13) of a GPIO number, or -1. */
int  dbx_gpio_to_pos(uint8_t gpio);
uint8_t dbx_pos_to_gpio(int pos);
bool dbx_attached(void);

/* Publish what the firmware does with a J3 GPIO (ignored for any other GPIO). Cheap, non-blocking. */
void dbx_pin_set(uint8_t gpio, dbx_mode_t mode, int pull, int level, uint32_t hz, uint32_t duty_q16);
/* Start the thread that turns the bench's level changes into GPIO interrupts (once, idempotent). */
void dbx_start(void);
/* The 5 V boost switch as the PMIC register says (called by the I2C tap). */
void dbx_set_v5_boost(bool on);

/* One synchronous mailbox call. Returns a DBX_R_* result. out/in may be NULL. */
int dbx_call(int kind, const int32_t p[6], const void *out, size_t out_len, void *in, size_t in_cap, size_t *in_len,
             uint32_t timeout_ms);

/* What the bench says about a position: the digital level and the millivolts (0 when no bench is attached). */
int     dbx_level(int pos);
int32_t dbx_mv(int pos);

/* UART receive ring (filled by the bench). */
size_t dbx_rx_read(uint8_t *d, size_t cap, uint32_t wait_ms);
void   dbx_rx_flush(void);
#endif
