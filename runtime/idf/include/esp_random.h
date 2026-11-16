/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_RANDOM_H
#define DOTBENCH_ESP_RANDOM_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
uint32_t esp_random(void);
void esp_fill_random(void *buf, size_t len);
#ifdef __cplusplus
}
#endif
#endif
