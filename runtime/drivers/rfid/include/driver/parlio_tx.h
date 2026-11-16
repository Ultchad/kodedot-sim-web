/* SPDX-License-Identifier: GPL-3.0-or-later
 * The slice of ESP-IDF's driver/parlio_tx.h that kdrv_rfid_lf.c uses (the EM4100 emulation loop). */
#ifndef DOTBENCH_RFID_SHIM_PARLIO_TX_H
#define DOTBENCH_RFID_SHIM_PARLIO_TX_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct dotbench_parlio_tx *parlio_tx_unit_handle_t;
typedef enum { PARLIO_CLK_SRC_XTAL = 0, PARLIO_CLK_SRC_EXTERNAL = 1 } parlio_clock_source_t;
typedef enum { PARLIO_SHIFT_EDGE_POS = 0, PARLIO_SHIFT_EDGE_NEG = 1 } parlio_sample_edge_t;
typedef enum { PARLIO_BIT_PACK_ORDER_MSB = 0, PARLIO_BIT_PACK_ORDER_LSB = 1 } parlio_bit_pack_order_t;
typedef struct {
    parlio_clock_source_t clk_src;
    uint32_t input_clk_src_freq_hz;
    uint32_t output_clk_freq_hz;
    size_t data_width;
    int clk_in_gpio_num;
    int clk_out_gpio_num;
    int valid_gpio_num;
    int data_gpio_nums[16];
    size_t trans_queue_depth;
    size_t max_transfer_size;
    parlio_sample_edge_t shift_edge;
    parlio_bit_pack_order_t bit_pack_order;
} parlio_tx_unit_config_t;
typedef struct {
    uint32_t idle_value;
    struct { uint32_t loop_transmission : 1; } flags;
} parlio_transmit_config_t;
esp_err_t parlio_new_tx_unit(const parlio_tx_unit_config_t *cfg, parlio_tx_unit_handle_t *out);
esp_err_t parlio_del_tx_unit(parlio_tx_unit_handle_t unit);
esp_err_t parlio_tx_unit_enable(parlio_tx_unit_handle_t unit);
esp_err_t parlio_tx_unit_disable(parlio_tx_unit_handle_t unit);
esp_err_t parlio_tx_unit_transmit(parlio_tx_unit_handle_t unit, const void *payload, size_t payload_bits,
                                  const parlio_transmit_config_t *cfg);
#ifdef __cplusplus
}
#endif
#endif
