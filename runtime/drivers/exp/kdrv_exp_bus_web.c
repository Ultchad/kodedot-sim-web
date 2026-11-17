/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_exp_bus over the bench model (replaces components/kdrv/exp_bus/src/kdrv_exp_bus.c). The SDK's kode_bus.c above it (locks,
 * pin loans, argument judging, the error texts) is unmodified; here a bus is a transaction handed to the bench's router
 * (docs/component-api.md 5.5): I2C and SPI as master, UART as a peer. With no bench attached nothing answers: an I2C address
 * does not ACK, an SPI read floats low, UART bytes go nowhere and none arrive. */
#include <pthread.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>

#include "dotbench_exp.h"
#include "kdrv_exp_bus.h"
#include "kbsp_board.h"

#define MARGIN_MS 300u   /* the bench lives on the page's thread: allow for its latency on top of the bus's own timeout */

static bool g_i2c, g_spi, g_uart;
static uint32_t g_baud;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;

static void sleep_us(uint64_t us)
{
    if (us > 2000000u) us = 2000000u;
    struct timespec t = { (time_t)(us / 1000000u), (long)(us % 1000000u) * 1000L };
    nanosleep(&t, NULL);
}

/* ---- I2C ---- */
kode_status_t kdrv_exp_i2c_open(uint8_t ctrl, uint32_t sda_gpio, uint32_t scl_gpio, uint32_t hz)
{
    int sda = dbx_gpio_to_pos((uint8_t)sda_gpio), scl = dbx_gpio_to_pos((uint8_t)scl_gpio);
    pthread_mutex_lock(&g_mu);
    bool bad = g_i2c || ctrl == (uint8_t)KBSP_I2C_BOARD || hz == 0 || sda < 0 || scl < 0 || sda == scl;
    if (!bad) g_i2c = true;
    pthread_mutex_unlock(&g_mu);
    if (bad) return KODE_DENIED;
    dbx_pin_set((uint8_t)sda_gpio, DBX_IN, DBX_PULL_UP, 0, 0, 0);   /* the SDK enables the internal pull-ups */
    dbx_pin_set((uint8_t)scl_gpio, DBX_IN, DBX_PULL_UP, 0, 0, 0);
    int32_t p[6] = { sda, scl, (int32_t)hz, 0, 0, 0 };
    int rc = dbx_call(DBX_RQ_I2C_OPEN, p, NULL, 0, NULL, 0, NULL, 1000u);
    if (rc == DBX_R_REFUSED) { pthread_mutex_lock(&g_mu); g_i2c = false; pthread_mutex_unlock(&g_mu); return KODE_ERROR; }
    return KODE_OK;
}

kode_status_t kdrv_exp_i2c_xfer(uint8_t addr, const uint8_t *out, size_t out_len, uint8_t *in, size_t in_len, uint32_t ms)
{
    if (!g_i2c || addr > KDRV_EXP_I2C_ADDR_MAX || (out_len == 0 && in_len == 0) || (out_len && !out) || (in_len && !in)) return KODE_DENIED;
    if (out_len > 1024 || in_len > 1024) return KODE_DENIED;
    int32_t p[6] = { addr, (int32_t)ms, 0, 0, 0, 0 };
    size_t got = 0;
    int rc = dbx_call(DBX_RQ_I2C_XFER, p, out, out_len, in, in_len, &got, ms + MARGIN_MS);
    if (rc == DBX_R_OK) { if (in_len && got < in_len) memset(in + got, 0xFF, in_len - got); return KODE_OK; }
    return KODE_IO_ERROR;
}

kode_status_t kdrv_exp_i2c_probe(uint8_t addr)
{
    if (!g_i2c || addr > KDRV_EXP_I2C_ADDR_MAX) return KODE_DENIED;
    int32_t p[6] = { addr, 0, 0, 0, 0, 0 };
    int rc = dbx_call(DBX_RQ_I2C_PROBE, p, NULL, 0, NULL, 0, NULL, KDRV_EXP_I2C_PROBE_MS + MARGIN_MS);
    if (rc == DBX_R_OK) return KODE_OK;
    if (rc == DBX_R_STUCK || rc == DBX_R_TIMEOUT) return KODE_TIMEOUT;
    return KODE_IO_ERROR;
}

kode_status_t kdrv_exp_i2c_close(void)
{
    pthread_mutex_lock(&g_mu); bool was = g_i2c; g_i2c = false; pthread_mutex_unlock(&g_mu);
    if (was) (void)dbx_call(DBX_RQ_I2C_CLOSE, NULL, NULL, 0, NULL, 0, NULL, 500u);
    return KODE_OK;
}

/* ---- SPI ---- */
kode_status_t kdrv_exp_spi_open(uint8_t host, uint32_t sck, uint32_t mosi, uint32_t miso, uint32_t cs, uint32_t hz, uint8_t mode)
{
    (void)host;
    int ps = dbx_gpio_to_pos((uint8_t)sck), pm = dbx_gpio_to_pos((uint8_t)mosi), pi = dbx_gpio_to_pos((uint8_t)miso), pc = dbx_gpio_to_pos((uint8_t)cs);
    pthread_mutex_lock(&g_mu);
    bool bad = g_spi || hz < KDRV_EXP_SPI_HZ_MIN || mode > KDRV_EXP_SPI_MODE_MAX || ps < 0 || pm < 0 || pi < 0 || pc < 0;
    if (!bad) g_spi = true;
    pthread_mutex_unlock(&g_mu);
    if (bad) return KODE_DENIED;
    dbx_pin_set((uint8_t)cs, DBX_OUT, DBX_PULL_NONE, 1, 0, 0);
    dbx_pin_set((uint8_t)sck, DBX_OUT, DBX_PULL_NONE, (mode >> 1) & 1, 0, 0);
    dbx_pin_set((uint8_t)mosi, DBX_OUT, DBX_PULL_NONE, 0, 0, 0);
    dbx_pin_set((uint8_t)miso, DBX_IN, DBX_PULL_NONE, 0, 0, 0);
    int32_t p[6] = { ps, pm, pi, pc, (int32_t)hz, mode };
    int rc = dbx_call(DBX_RQ_SPI_OPEN, p, NULL, 0, NULL, 0, NULL, 1000u);
    if (rc == DBX_R_REFUSED) { pthread_mutex_lock(&g_mu); g_spi = false; pthread_mutex_unlock(&g_mu); return KODE_ERROR; }
    return KODE_OK;
}

kode_status_t kdrv_exp_spi_xfer(const uint8_t *out, uint8_t *in, size_t len)
{
    if (!g_spi || !out || len == 0 || len > KDRV_EXP_SPI_XFER_MAX) return KODE_DENIED;
    uint8_t rx[KDRV_EXP_SPI_XFER_MAX];
    size_t got = 0;
    memset(rx, 0, sizeof rx);
    int rc = dbx_call(DBX_RQ_SPI_XFER, NULL, out, len, rx, len, &got, 1000u + MARGIN_MS);
    if (rc != DBX_R_OK) { memset(rx, 0, sizeof rx); got = 0; }   /* nobody answered: the data-in pin floated low */
    if (in) memcpy(in, rx, len);
    return KODE_OK;
}

kode_status_t kdrv_exp_spi_close(void)
{
    pthread_mutex_lock(&g_mu); bool was = g_spi; g_spi = false; pthread_mutex_unlock(&g_mu);
    if (was) (void)dbx_call(DBX_RQ_SPI_CLOSE, NULL, NULL, 0, NULL, 0, NULL, 500u);
    return KODE_OK;
}

/* ---- UART (8N1) ---- */
kode_status_t kdrv_exp_uart_open(uint8_t port, uint32_t tx, uint32_t rx, uint32_t baud)
{
    (void)port;
    int pt = dbx_gpio_to_pos((uint8_t)tx), pr = dbx_gpio_to_pos((uint8_t)rx);
    pthread_mutex_lock(&g_mu);
    bool bad = g_uart || baud == 0 || pt < 0 || pr < 0 || pt == pr;
    if (!bad) { g_uart = true; g_baud = baud; }
    pthread_mutex_unlock(&g_mu);
    if (bad) return KODE_DENIED;
    dbx_pin_set((uint8_t)tx, DBX_OUT, DBX_PULL_NONE, 1, 0, 0);
    dbx_pin_set((uint8_t)rx, DBX_IN, DBX_PULL_NONE, 0, 0, 0);
    dbx_rx_flush();
    int32_t p[6] = { pt, pr, (int32_t)baud, 0, 0, 0 };
    int rc = dbx_call(DBX_RQ_UART_OPEN, p, NULL, 0, NULL, 0, NULL, 1000u);
    if (rc == DBX_R_REFUSED) { pthread_mutex_lock(&g_mu); g_uart = false; pthread_mutex_unlock(&g_mu); return KODE_ERROR; }
    return KODE_OK;
}

kode_status_t kdrv_exp_uart_write(const uint8_t *d, size_t len, size_t *sent)
{
    if (sent) *sent = 0;
    if (!g_uart || !d || len == 0) return KODE_DENIED;
    for (size_t off = 0; off < len;) {
        size_t n = len - off > 1024 ? 1024 : len - off;
        int32_t p[6] = { 0 };
        (void)dbx_call(DBX_RQ_UART_WRITE, p, d + off, n, NULL, 0, NULL, 1000u);
        off += n;
    }
    /* write() returns once the last byte is in the FIFO: the bytes' time less the 128 the FIFO holds */
    if (len > 128 && g_baud) sleep_us((uint64_t)(len - 128) * 10u * 1000000u / g_baud);
    if (sent) *sent = len;
    return KODE_OK;
}

kode_status_t kdrv_exp_uart_read(uint8_t *d, size_t cap, uint32_t ms, size_t *got)
{
    if (got) *got = 0;
    if (!g_uart || !d || cap == 0) return KODE_DENIED;
    size_t n = dbx_rx_read(d, cap, ms);
    if (got) *got = n;
    return KODE_OK;
}

kode_status_t kdrv_exp_uart_close(void)
{
    pthread_mutex_lock(&g_mu); bool was = g_uart; g_uart = false; pthread_mutex_unlock(&g_mu);
    if (was) (void)dbx_call(DBX_RQ_UART_CLOSE, NULL, NULL, 0, NULL, 0, NULL, 500u);
    return KODE_OK;
}
