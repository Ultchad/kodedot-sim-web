/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_SYSTEM_H
#define DOTBENCH_ESP_SYSTEM_H
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
void esp_restart(void) __attribute__((noreturn));
uint32_t esp_get_free_heap_size(void);
uint32_t esp_get_minimum_free_heap_size(void);
#ifdef __cplusplus
}
#endif
#endif
