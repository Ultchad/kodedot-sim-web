/* SPDX-License-Identifier: GPL-3.0-or-later
 * The part of ESP-IDF's driver/ppa.h (ESP32-P4 pixel-processing accelerator) that kdrv_compose.c uses: clients, and the
 * blocking fill, scale/rotate/mirror and blend passes. runtime/drivers/ppa/ppa_web.c does them in software. */
#ifndef DOTBENCH_DRIVER_PPA_H
#define DOTBENCH_DRIVER_PPA_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct ppa_client_t *ppa_client_handle_t;

typedef enum { PPA_OPERATION_SRM, PPA_OPERATION_BLEND, PPA_OPERATION_FILL, PPA_OPERATION_NUM } ppa_operation_t;
typedef enum { PPA_TRANS_MODE_BLOCKING, PPA_TRANS_MODE_NON_BLOCKING } ppa_trans_mode_t;
typedef enum { PPA_SRM_ROTATION_ANGLE_0, PPA_SRM_ROTATION_ANGLE_90, PPA_SRM_ROTATION_ANGLE_180, PPA_SRM_ROTATION_ANGLE_270 } ppa_srm_rotation_angle_t;
typedef enum { PPA_ALPHA_NO_CHANGE, PPA_ALPHA_FIX_VALUE, PPA_ALPHA_SCALE, PPA_ALPHA_INVERT } ppa_alpha_update_mode_t;
typedef enum { PPA_SRM_COLOR_MODE_ARGB8888, PPA_SRM_COLOR_MODE_RGB888, PPA_SRM_COLOR_MODE_RGB565, PPA_SRM_COLOR_MODE_YUV420, PPA_SRM_COLOR_MODE_YUV444, PPA_SRM_COLOR_MODE_YUV422 } ppa_srm_color_mode_t;
typedef enum { PPA_BLEND_COLOR_MODE_ARGB8888, PPA_BLEND_COLOR_MODE_RGB888, PPA_BLEND_COLOR_MODE_RGB565, PPA_BLEND_COLOR_MODE_A8, PPA_BLEND_COLOR_MODE_A4 } ppa_blend_color_mode_t;
typedef enum { PPA_FILL_COLOR_MODE_ARGB8888, PPA_FILL_COLOR_MODE_RGB888, PPA_FILL_COLOR_MODE_RGB565 } ppa_fill_color_mode_t;

typedef struct {
    ppa_operation_t oper_type;
    uint32_t max_pending_trans_num;
} ppa_client_config_t;

typedef union { struct { uint32_t b : 8; uint32_t g : 8; uint32_t r : 8; uint32_t a : 8; }; uint32_t val; } color_pixel_argb8888_data_t;

/* One input and one output block type for all three passes, as in ESP-IDF: the colour mode is a union. The enums above share their
 * first values (ARGB8888, RGB888, RGB565), so the mode reads the same whichever member a caller names. */
typedef struct {
    const void *buffer;
    uint32_t pic_w, pic_h, block_w, block_h, block_offset_x, block_offset_y;
    union { ppa_srm_color_mode_t srm_cm; ppa_blend_color_mode_t blend_cm; };
} ppa_in_pic_blk_config_t;

typedef struct {
    void *buffer;
    uint32_t buffer_size;
    uint32_t pic_w, pic_h, block_offset_x, block_offset_y;
    union { ppa_srm_color_mode_t srm_cm; ppa_blend_color_mode_t blend_cm; ppa_fill_color_mode_t fill_cm; };
} ppa_out_pic_blk_config_t;

typedef struct {
    ppa_in_pic_blk_config_t in;
    ppa_out_pic_blk_config_t out;
    ppa_srm_rotation_angle_t rotation_angle;
    float scale_x, scale_y;
    bool mirror_x, mirror_y;
    bool rgb_swap, byte_swap;
    ppa_alpha_update_mode_t alpha_update_mode;
    uint32_t alpha_fix_val;
    ppa_trans_mode_t mode;
    void *user_data;
} ppa_srm_oper_config_t;

typedef struct {
    ppa_in_pic_blk_config_t in_bg, in_fg;
    ppa_out_pic_blk_config_t out;
    ppa_alpha_update_mode_t bg_alpha_update_mode, fg_alpha_update_mode;
    uint32_t bg_alpha_fix_val, fg_alpha_fix_val;
    float bg_alpha_scale_ratio, fg_alpha_scale_ratio;
    bool bg_rgb_swap, bg_byte_swap, fg_rgb_swap, fg_byte_swap;
    ppa_trans_mode_t mode;
    void *user_data;
} ppa_blend_oper_config_t;

typedef struct {
    ppa_out_pic_blk_config_t out;
    uint32_t fill_block_w, fill_block_h;
    color_pixel_argb8888_data_t fill_argb_color;
    ppa_trans_mode_t mode;
    void *user_data;
} ppa_fill_oper_config_t;

esp_err_t ppa_register_client(const ppa_client_config_t *config, ppa_client_handle_t *ret_client);
esp_err_t ppa_unregister_client(ppa_client_handle_t client);
esp_err_t ppa_do_scale_rotate_mirror(ppa_client_handle_t client, const ppa_srm_oper_config_t *config);
esp_err_t ppa_do_blend(ppa_client_handle_t client, const ppa_blend_oper_config_t *config);
esp_err_t ppa_do_fill(ppa_client_handle_t client, const ppa_fill_oper_config_t *config);

#ifdef __cplusplus
}
#endif
#endif
