/* SPDX-License-Identifier: GPL-3.0-or-later
 * Declarations of the SDK's PRIVATE radio headers that ble_host.c needs, copied verbatim (kode-sdk c9568a3):
 *   components/kdrv/radio/src/kdrv_ble_app.h, kdrv_ble_bonds.h, kdrv_ble_find.h.
 * The area's sources are compiled without the SDK's private src dirs on the include path, and these three are the seams between
 * kdrv_ble.c (which this area replaces) and the SDK files that stay (kdrv_ble_app.c, kdrv_ble_bonds.c, kdrv_ble_find.c).
 * If the SDK changes them, change this file the same way: it is a ABI mirror, not a design. */
#ifndef BLE_PRIV_H_
#define BLE_PRIV_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "kdrv_ble.h"

#define KDRV_BLE_UUID128_BYTES  16U
#define KDRV_BLE_APP_RING_SLOTS 8U

typedef struct {
    uint32_t read;
    uint32_t write;
    uint32_t notify;
} kdrv_ble_app_perm_t;

typedef struct {
    uint8_t  svc_uuid[KDRV_BLE_UUID128_BYTES];
    uint8_t  count;
    uint8_t  uuid[KDRV_BLE_APP_CHARS_MAX][KDRV_BLE_UUID128_BYTES];
    uint32_t flags[KDRV_BLE_APP_CHARS_MAX];
} kdrv_ble_app_table_t;

bool kdrv_ble_app_build(const kdrv_ble_app_service_t *svc, const kdrv_ble_app_perm_t *perm, kdrv_ble_app_table_t *out);
const kdrv_ble_app_service_t *kdrv_ble_app_fix(void);
void kdrv_ble_app_select_forget(void);
size_t kdrv_ble_app_host_bytes(void);
void *kdrv_ble_app_host(void);
bool kdrv_ble_app_queued(void);
void kdrv_ble_app_link_reset(void);
void kdrv_ble_app_subscribed(uint8_t chr, bool on);
bool kdrv_ble_app_written(uint8_t chr, const uint8_t *data, uint16_t len);
uint16_t kdrv_ble_app_read(uint8_t chr, uint16_t offset, uint16_t span, uint8_t *out, uint16_t cap);
uint8_t *kdrv_ble_app_scratch(void);
bool kdrv_ble_app_peek(uint8_t *chr, uint8_t *out, uint16_t *len);
void kdrv_ble_app_pop(void);

bool kdrv_ble_bonds_changed(uint8_t n);
uint32_t kdrv_ble_bonds_begin(void);
bool kdrv_ble_bonds_settle(uint32_t ticket, uint8_t n);
uint8_t kdrv_ble_bonds_kept(void);

#define KDRV_BLE_FIND_NAME_MAX  (KDRV_BLE_ADV_MAX - 2U)
#define KDRV_BLE_FIND_ADDR_LEN  6U

typedef struct {
    char            name[KDRV_BLE_FIND_NAME_MAX + 1U];
    volatile bool   on;
    volatile bool   hit;
    kdrv_ble_dev_t  dev;
} kdrv_ble_find_t;

bool kdrv_ble_find_begin(kdrv_ble_find_t *f, const char *name);
bool kdrv_ble_find_offer(kdrv_ble_find_t *f, const uint8_t *addr_le, uint8_t addr_type, int8_t rssi, const uint8_t *name, size_t name_len);
void kdrv_ble_find_end(kdrv_ble_find_t *f);

#endif /* BLE_PRIV_H_ */
