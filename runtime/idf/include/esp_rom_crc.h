/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_ROM_CRC_H
#define DOTBENCH_ESP_ROM_CRC_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
uint32_t esp_rom_crc32_le(uint32_t crc, uint8_t const *buf, uint32_t len);
uint16_t esp_rom_crc16_le(uint16_t crc, uint8_t const *buf, uint32_t len);
uint8_t  esp_rom_crc8_le(uint8_t crc, uint8_t const *buf, uint32_t len);
#ifdef __cplusplus
}
#endif
#endif
