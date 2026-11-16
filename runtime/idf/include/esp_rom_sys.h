/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_ROM_SYS_H
#define DOTBENCH_ESP_ROM_SYS_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* The ROM's lock-free printf: here, a line straight into the bridge's log channel. */
int esp_rom_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
int ets_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void esp_rom_delay_us(uint32_t us);
void ets_delay_us(uint32_t us);
#ifdef __cplusplus
}
#endif
#endif
