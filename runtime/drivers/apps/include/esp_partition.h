/* SPDX-License-Identifier: GPL-3.0-or-later
 * The slice of ESP-IDF's esp_partition.h that kdrv_apps.c and kdrv_image_walk.h use, over the web flash model
 * (apps_flash_web.c): "apps" and "app_pending" are persistent regions. */
#ifndef DOTBENCH_ESP_PARTITION_H
#define DOTBENCH_ESP_PARTITION_H
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef enum { ESP_PARTITION_TYPE_APP = 0x00, ESP_PARTITION_TYPE_DATA = 0x01, ESP_PARTITION_TYPE_ANY = 0xff } esp_partition_type_t;
typedef int esp_partition_subtype_t;
#define ESP_PARTITION_SUBTYPE_ANY 0xff
typedef struct {
    esp_partition_type_t type;
    esp_partition_subtype_t subtype;
    uint32_t address;
    uint32_t size;
    uint32_t erase_size;
    char label[17];
    int encrypted;
} esp_partition_t;
typedef enum { ESP_PARTITION_MMAP_DATA, ESP_PARTITION_MMAP_INST } esp_partition_mmap_memory_t;
typedef uint32_t esp_partition_mmap_handle_t;
typedef struct { uint32_t offset; uint32_t size; } esp_partition_pos_t;

const esp_partition_t *esp_partition_find_first(esp_partition_type_t type, esp_partition_subtype_t subtype, const char *label);
esp_err_t esp_partition_read(const esp_partition_t *p, size_t off, void *dst, size_t len);
esp_err_t esp_partition_write(const esp_partition_t *p, size_t off, const void *src, size_t len);
esp_err_t esp_partition_erase_range(const esp_partition_t *p, size_t off, size_t len);
esp_err_t esp_partition_mmap(const esp_partition_t *p, size_t off, size_t len, esp_partition_mmap_memory_t mem,
                             const void **out, esp_partition_mmap_handle_t *h);
void esp_partition_munmap(esp_partition_mmap_handle_t h);
#ifdef __cplusplus
}
#endif
#endif
