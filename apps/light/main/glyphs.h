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

extern const lv_image_dsc_t app_glyph_light_40; /**< The light glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_light_96; /**< The light glyph, 96 x 96. */
extern const lv_image_dsc_t app_glyph_sos_40; /**< The sos glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_sos_96; /**< The sos glyph, 96 x 96. */
extern const lv_image_dsc_t app_glyph_led_40; /**< The led glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_led_96; /**< The led glyph, 96 x 96. */
extern const lv_image_dsc_t app_glyph_screen_40; /**< The screen glyph, 40 x 40. */
extern const lv_image_dsc_t app_glyph_screen_96; /**< The screen glyph, 96 x 96. */

#ifdef __cplusplus
}
#endif

#endif /* GLYPHS_H_ */
