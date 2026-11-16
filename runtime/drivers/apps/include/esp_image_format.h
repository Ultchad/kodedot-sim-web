/* SPDX-License-Identifier: GPL-3.0-or-later
 * esp_image_format.h reduced to what kdrv_apps.c needs: the header layouts and esp_image_verify() (apps_flash_web.c). */
#ifndef DOTBENCH_ESP_IMAGE_FORMAT_H
#define DOTBENCH_ESP_IMAGE_FORMAT_H
#include <stdint.h>
#include "esp_partition.h"
#ifdef __cplusplus
extern "C" {
#endif
#define ESP_IMAGE_HEADER_MAGIC 0xE9
#define ESP_IMAGE_MAX_SEGMENTS 16
#define ESP_ERR_IMAGE_INVALID 0x2000
/* Chip ids: kdrv_radio.c checks the C5's image header against ESP_CHIP_ID_ESP32C5 (the radio area used to carry its own
 * copy of this header; the two were merged here because the include path holds exactly one esp_image_format.h). */
typedef enum { ESP_CHIP_ID_ESP32 = 0, ESP_CHIP_ID_ESP32S2 = 2, ESP_CHIP_ID_ESP32C3 = 5, ESP_CHIP_ID_ESP32S3 = 9,
               ESP_CHIP_ID_ESP32C2 = 12, ESP_CHIP_ID_ESP32C6 = 13, ESP_CHIP_ID_ESP32H2 = 16, ESP_CHIP_ID_ESP32P4 = 18,
               ESP_CHIP_ID_ESP32C5 = 23, ESP_CHIP_ID_INVALID = 0xFFFF } __attribute__((packed)) esp_chip_id_t;
typedef struct {
    uint8_t magic;
    uint8_t segment_count;
    uint8_t spi_mode;
    uint8_t spi_speed_size;
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
_Static_assert(sizeof(esp_image_header_t) == 24, "esp_image_header_t is 24 bytes");
typedef struct { uint32_t load_addr; uint32_t data_len; } esp_image_segment_header_t;
typedef struct { uint32_t image_len; uint32_t start_addr; } esp_image_metadata_t;
typedef enum { ESP_IMAGE_VERIFY, ESP_IMAGE_VERIFY_SILENT, ESP_IMAGE_LOAD } esp_image_load_mode_t;
/* pos.offset is a flash ADDRESS (partition address + offset), as in IDF. Checks the header chain and the checksum byte; there is no
 * SHA-256 or signature (the synthesised images carry none). */
esp_err_t esp_image_verify(esp_image_load_mode_t mode, const esp_partition_pos_t *pos, esp_image_metadata_t *meta);
#ifdef __cplusplus
}
#endif
#endif
