/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_HOSTED_TRANSPORT_CONFIG_H
#define DOTBENCH_ESP_HOSTED_TRANSPORT_CONFIG_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
typedef enum {
    ESP_TRANSPORT_OK = ESP_OK, ESP_TRANSPORT_ERR_INVALID_ARG = ESP_ERR_INVALID_ARG,
    ESP_TRANSPORT_ERR_ALREADY_SET = ESP_ERR_NOT_ALLOWED, ESP_TRANSPORT_ERR_INVALID_STATE = ESP_ERR_INVALID_STATE,
} esp_hosted_transport_err_t;
typedef struct { void *port; int pin; } gpio_pin_t;
struct esp_hosted_sdio_config {
    uint32_t clock_freq_khz; uint8_t bus_width; uint8_t slot;
    gpio_pin_t pin_clk, pin_cmd, pin_d0, pin_d1, pin_d2, pin_d3, pin_reset;
    uint8_t rx_mode; bool block_mode; bool iomux_enable; uint16_t tx_queue_size; uint16_t rx_queue_size;
};
esp_hosted_transport_err_t esp_hosted_sdio_get_config(struct esp_hosted_sdio_config **config);
#endif
