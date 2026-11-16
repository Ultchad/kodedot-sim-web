/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file glyphs.h
 * @brief The app's own line glyphs.
 */
#ifndef GLYPHS_H_
#define GLYPHS_H_

#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

extern const lv_image_dsc_t app_glyph_level_40; /**< The level glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_level_96; /**< The level glyph, 96 x 96. */
extern const lv_image_dsc_t app_glyph_compass_40; /**< The compass glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_compass_96; /**< The compass glyph, 96 x 96. */
extern const lv_image_dsc_t app_glyph_check_40; /**< The check glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_check_96; /**< The check glyph, 96 x 96. */

#ifdef __cplusplus
}
#endif

#endif /* GLYPHS_H_ */
