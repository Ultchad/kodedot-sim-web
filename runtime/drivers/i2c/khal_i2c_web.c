/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_i2c over virtual chips. A chip registers its address and two register
 * accessors; an address nobody registered does not ACK (probe fails, add
 * fails). Replaces components/khal/i2c/src/khal_i2c_esp.c. */
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include "khal_i2c.h"
#include "dotbench_board.h"

struct i2c_master_dev_t { const dotbench_i2c_chip_t *chip; };
#define MAXCHIPS 16
static dotbench_i2c_chip_t g_chips[MAXCHIPS];
static int g_nchips;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static bool g_init;

void dotbench_i2c_register(const dotbench_i2c_chip_t *c)
{
    pthread_mutex_lock(&g_mu);
    if (g_nchips < MAXCHIPS) g_chips[g_nchips++] = *c;
    pthread_mutex_unlock(&g_mu);
}
static const dotbench_i2c_chip_t *lookup(uint16_t addr)
{
    for (int i = 0; i < g_nchips; i++) if (g_chips[i].addr == addr) return &g_chips[i];
    return NULL;
}
kode_status_t khal_i2c_init(void)
{
    pthread_mutex_lock(&g_mu);
    bool first = !g_init;
    g_init = true;
    pthread_mutex_unlock(&g_mu);
    if (first) {
        dotbench_register_chips();      /* generated from the areas' manifests */
    }
    return KODE_OK;
}
struct i2c_master_bus_t *khal_i2c_bus(void) { return NULL; }
bool khal_i2c_probe(uint16_t addr, uint32_t timeout_ms)
{
    (void)timeout_ms;
    return g_init && lookup(addr) != NULL;
}
kode_status_t khal_i2c_add(uint16_t addr, khal_i2c_dev_t *out)
{
    if (!out || !g_init) return KODE_DENIED;
    const dotbench_i2c_chip_t *c = lookup(addr);
    if (!c) return KODE_ERROR;
    struct i2c_master_dev_t *d = malloc(sizeof *d);
    if (!d) return KODE_NO_RESOURCES;
    d->chip = c;
    *out = d;
    return KODE_OK;
}
kode_status_t khal_i2c_remove(khal_i2c_dev_t dev) { free(dev); return KODE_OK; }
kode_status_t khal_i2c_write_reg(khal_i2c_dev_t dev, uint8_t reg, uint8_t val)
{
    return khal_i2c_write_regs(dev, reg, &val, 1);
}
kode_status_t khal_i2c_read_reg(khal_i2c_dev_t dev, uint8_t reg, uint8_t *buf, size_t len)
{
    if (!dev || !buf || !len || len > KHAL_I2C_BURST_MAX) return KODE_DENIED;
    return dev->chip->read(dev->chip->ctx, reg, buf, len) == 0 ? KODE_OK : KODE_IO_ERROR;
}
kode_status_t khal_i2c_write_regs(khal_i2c_dev_t dev, uint8_t reg, const uint8_t *buf, size_t len)
{
    if (!dev || !buf || !len || len > KHAL_I2C_BURST_MAX) return KODE_DENIED;
    return dev->chip->write(dev->chip->ctx, reg, buf, len) == 0 ? KODE_OK : KODE_IO_ERROR;
}
