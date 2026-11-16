/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_MAC_H
#define DOTBENCH_ESP_MAC_H
#include <stdint.h>
#include "esp_err.h"
typedef enum {
    ESP_MAC_WIFI_STA = 0, ESP_MAC_WIFI_SOFTAP, ESP_MAC_BT, ESP_MAC_ETH, ESP_MAC_IEEE802154, ESP_MAC_BASE,
    ESP_MAC_EFUSE_FACTORY, ESP_MAC_EFUSE_CUSTOM,
} esp_mac_type_t;
#endif
