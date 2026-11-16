/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_IMAGE_FORMAT_H
#define DOTBENCH_ESP_IMAGE_FORMAT_H
#include <stdint.h>
#define ESP_IMAGE_HEADER_MAGIC 0xE9
typedef enum { ESP_CHIP_ID_ESP32 = 0, ESP_CHIP_ID_ESP32S2 = 2, ESP_CHIP_ID_ESP32C3 = 5, ESP_CHIP_ID_ESP32S3 = 9,
               ESP_CHIP_ID_ESP32C2 = 12, ESP_CHIP_ID_ESP32C6 = 13, ESP_CHIP_ID_ESP32H2 = 16, ESP_CHIP_ID_ESP32P4 = 18,
               ESP_CHIP_ID_ESP32C5 = 23, ESP_CHIP_ID_INVALID = 0xFFFF } __attribute__((packed)) esp_chip_id_t;
typedef struct {
    uint8_t magic;
    uint8_t segment_count;
    uint8_t spi_mode;
    uint8_t spi_speed : 4;
    uint8_t spi_size : 4;
    uint32_t entry_addr;
    uint8_t wp_pin;
    uint8_t spi_pin_drv[3];
    esp_chip_id_t chip_id;
    uint8_t min_chip_rev;
    uint16_t min_chip_rev_full;
    uint16_t max_chip_rev_full;
    uint8_t reserved[4];
    uint8_t hash_appended;
} __attribute__((packed)) esp_image_header_t;
#endif
