/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file kit_name.c
 * @brief The name page: a field and an on-screen keypad, in kui's colours.
 */
#include "kit.h"

#include <string.h>

#define KIT_NAME_FIELD_PAD   22     /**< The field's text starts this far in. */
#define KIT_NAME_FIELD_Y     64     /**< The name field's top. */
#define KIT_NAME_FIELD_H     56     /**< The name field's height. */
#define KIT_NAME_KEYS_Y      130    /**< The keypad's top. */
#define KIT_NAME_KEYS_H      262    /**< The keypad's height. */
#define KIT_NAME_FOOT_Y      402    /**< Where the answer stands. */
#define KIT_NAME_KEY_GAP     6      /**< The gap between two keys. */
#define KIT_NAME_KEY_RADIUS  16     /**< A key's corner radius. */
#define KIT_NAME_ANSWER_W    160    /**< The answer button's width. */
#define KIT_NAME_MODES       3U     /**< The keypad's pages. */
#define KIT_NAME_MAP_LEN     24U    /**< Entries of the longest key map. */

/** @brief The keypad's pages. */
enum {
    KIT_NAME_UPPER = 0,   /**< Capital letters. */
    KIT_NAME_LOWER,       /**< Small letters. */
    KIT_NAME_SYMBOLS,     /**< Digits and marks. */
    KIT_NAME_MORE         /**< The rest of the marks. */
};

static const char * const s_map_upper[] = {
    "A", "B", "C", "D", "E", "F", "G", "\n",
    "H", "I", "J", "K", "L", "M", "N", "\n",
    "O", "P", "Q", "R", "S", "T", "U", "\n",
    "V", "W", "X", "Y", "Z", "Del", "\n",
    "abc", "123", "Space", ""
};   /**< Capital letters. */

static const char * const s_map_lower[] = {
    "a", "b", "c", "d", "e", "f", "g", "\n",
    "h", "i", "j", "k", "l", "m", "n", "\n",
    "o", "p", "q", "r", "s", "t", "u", "\n",
    "v", "w", "x", "y", "z", "Del", "\n",
    "ABC", "123", "Space", ""
};   /**< Small letters. */

static const char * const s_map_symbols[] = {
    "1", "2", "3", "4", "5", "6", "7", "\n",
    "8", "9", "0", "-", ".", "_", "+", "\n",
    "#", "&", "'", "!", "?", "(", ")", "\n",
    "/", ":", ",", "@", "%", "Del", "\n",
    "ABC", "more", "Space", ""
};   /**< Digits and marks. */

static const char * const s_map_more[] = {
    "~", "$", "^", "*", "=", ";", "|", "\n",
    "<", ">", "[", "]", "{", "}", "\\", "\n",
    "\"", "`", "(", ")", "?", "!", "'", "\n",
    "#", "&", "%", "@", "/", "Del", "\n",
    "ABC", "123", "Space", ""
};   /**< The rest of the marks. */

static const lv_buttonmatrix_ctrl_t s_ctrl_letters[] = {
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 2,
    2, 2, 3
};   /**< Key widths of the two letter pages, in sevenths. */

/**
 * @brief Show the text and a caret, or the hint while it is empty.
 * @param n The name being edited.
 */
static void name_show(kit_name_t *n)
{
    char         shown[40];
    size_t const len  = strlen(n->text);
    size_t const keep = 18U;   /* What fits the field; a longer text shows its end. */
    size_t       at   = 0U;

    if ( '\0' == n->text[0] )
    {
        if ( NULL != n->hint )
        {
            lv_label_set_text(n->field, n->hint);
        }
        else
        {
            lv_label_set_text(n->field, "Type a name");
        }
        lv_obj_set_style_text_color(n->field, KUI_COLOR_TEXT_MUTED, 0);
        return;
    }
    if ( len > keep )
    {
        at = len - keep;
        shown[0] = '.';
        shown[1] = '.';
        shown[2] = '\0';
    }
    else
    {
        shown[0] = '\0';
    }
    for ( size_t i = at; i < len; ++i )
    {
        size_t const k = strlen(shown);

        shown[k] = n->text[i];
        if ( n->secret && !n->reveal )
        {
            shown[k] = '*';
        }
        shown[k + 1U] = '\0';
    }
    (void)strcat(shown, "_");
    lv_label_set_text(n->field, shown);
    lv_obj_set_style_text_color(n->field, KUI_COLOR_TEXT_ON_BG, 0);
}

/**
 * @brief Put a page of keys on the matrix.
 * @param keys The matrix.
 * @param mode The page.
 */
static void name_keys(lv_obj_t *keys, uint8_t mode)
{
    if ( KIT_NAME_UPPER == mode )
    {
        lv_buttonmatrix_set_map(keys, s_map_upper);
    }
    else if ( KIT_NAME_LOWER == mode )
    {
        lv_buttonmatrix_set_map(keys, s_map_lower);
    }
    else if ( KIT_NAME_SYMBOLS == mode )
    {
        lv_buttonmatrix_set_map(keys, s_map_symbols);
    }
    else
    {
        lv_buttonmatrix_set_map(keys, s_map_more);
    }
    lv_buttonmatrix_set_ctrl_map(keys, s_ctrl_letters);
}

/**
 * @brief A key was tapped.
 * @param e The event.
 */
static void name_key_cb(lv_event_t *e)
{
    kit_name_t * const n    = (kit_name_t *)lv_event_get_user_data(e);
    lv_obj_t * const   keys = lv_event_get_target_obj(e);
    uint32_t const     id   = lv_buttonmatrix_get_selected_button(keys);
    const char * const txt  = lv_buttonmatrix_get_button_text(keys, id);
    size_t const       len  = strlen(n->text);

    if ( NULL == txt )
    {
        return;
    }
    if ( 0 == strcmp(txt, "Del") )
    {
        if ( 0U < len )
        {
            n->text[len - 1U] = '\0';
            /* An empty field starts a name again, with a capital. */
            if ( (1U == len) && !n->secret )
            {
                n->mode = KIT_NAME_UPPER;
                name_keys(keys, n->mode);
            }
        }
    }
    else if ( 0 == strcmp(txt, "Space") )
    {
        if ( (0U < len) && ((size_t)n->max > len) )
        {
            n->text[len]      = ' ';
            n->text[len + 1U] = '\0';
        }
    }
    else if ( 0 == strcmp(txt, "abc") )
    {
        n->mode = KIT_NAME_LOWER;
        name_keys(keys, n->mode);
    }
    else if ( 0 == strcmp(txt, "ABC") )
    {
        n->mode = KIT_NAME_UPPER;
        name_keys(keys, n->mode);
    }
    else if ( 0 == strcmp(txt, "123") )
    {
        n->mode = KIT_NAME_SYMBOLS;
        name_keys(keys, n->mode);
    }
    else if ( 0 == strcmp(txt, "more") )
    {
        n->mode = KIT_NAME_MORE;
        name_keys(keys, n->mode);
    }
    else if ( (size_t)n->max > len )
    {
        n->text[len]      = txt[0];
        n->text[len + 1U] = '\0';
        /* A name begins with a capital and goes on in small letters. */
        if ( (KIT_NAME_UPPER == n->mode) && (0U == len) && !n->secret )
        {
            n->mode = KIT_NAME_LOWER;
            name_keys(keys, n->mode);
        }
    }
    else
    {
        /* Full. */
    }
    name_show(n);
}

/**
 * @brief A tap on the field of a password lifts the stars, or puts them back.
 * @param e The event.
 */
static void name_field_cb(lv_event_t *e)
{
    kit_name_t * const n = (kit_name_t *)lv_event_get_user_data(e);

    if ( n->secret )
    {
        n->reveal = !n->reveal;
        name_show(n);
    }
}

/**
 * @brief The answer was tapped.
 * @param e The event.
 */
static void name_answer_cb(lv_event_t *e)
{
    kit_name_t * const n = (kit_name_t *)lv_event_get_user_data(e);

    if ( ('\0' != n->text[0]) && (NULL != n->done) )
    {
        n->done(n->user, n->text);
    }
}

void kit_name_page(kit_t *kit, void *arg)
{
    kit_name_t * const n     = (kit_name_t *)arg;
    lv_obj_t * const   page  = kit_page_bare(kit);
    lv_obj_t * const   field = lv_obj_create(page);
    lv_obj_t * const   keys  = lv_buttonmatrix_create(page);
    lv_obj_t          *btn;

    kit_no_swipe(kit);
    lv_obj_remove_style_all(field);
    lv_obj_set_pos(field, KIT_SIDE, KIT_NAME_FIELD_Y);
    lv_obj_set_size(field, KIT_ROW_W, KIT_NAME_FIELD_H);
    lv_obj_set_style_bg_color(field, KUI_COLOR_SURFACE, 0);
    lv_obj_set_style_bg_opa(field, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(field, KUI_RADIUS_GLASS, 0);
    lv_obj_set_scrollable(field, false);
    lv_obj_add_flag(field, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(field, &name_field_cb, LV_EVENT_CLICKED, n);
    n->reveal = false;
    n->field = lv_label_create(field);
    lv_obj_set_style_text_font(n->field, &kui_font_name, 0);
    lv_label_set_long_mode(n->field, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_set_width(n->field, KIT_ROW_W - (2 * KIT_NAME_FIELD_PAD));
    lv_obj_align(n->field, LV_ALIGN_LEFT_MID, KIT_NAME_FIELD_PAD, 0);

    lv_obj_remove_style_all(keys);
    lv_obj_set_pos(keys, KIT_SIDE, KIT_NAME_KEYS_Y);
    lv_obj_set_size(keys, KIT_ROW_W, KIT_NAME_KEYS_H);
    lv_obj_set_style_pad_row(keys, KIT_NAME_KEY_GAP, 0);
    lv_obj_set_style_pad_column(keys, KIT_NAME_KEY_GAP, 0);
    lv_obj_set_style_bg_opa(keys, LV_OPA_TRANSP, 0);
    lv_obj_set_style_bg_opa(keys, LV_OPA_COVER, LV_PART_ITEMS);
    lv_obj_set_style_bg_color(keys, KUI_COLOR_SURFACE, LV_PART_ITEMS);
    lv_obj_set_style_bg_color(keys, KUI_COLOR_REST, (uint32_t)LV_PART_ITEMS | (uint32_t)LV_STATE_PRESSED);
    lv_obj_set_style_radius(keys, KIT_NAME_KEY_RADIUS, LV_PART_ITEMS);
    lv_obj_set_style_border_width(keys, 0, LV_PART_ITEMS);
    lv_obj_set_style_shadow_width(keys, 0, LV_PART_ITEMS);
    lv_obj_set_style_text_font(keys, &kui_font_name, LV_PART_ITEMS);
    lv_obj_set_style_text_color(keys, KUI_COLOR_TEXT_ON_BG, LV_PART_ITEMS);
    name_keys(keys, n->mode);
    lv_obj_add_event_cb(keys, &name_key_cb, LV_EVENT_VALUE_CHANGED, n);

    btn = kit_button(kit, page, n->answer, KIT_BTN_ACTION, KIT_NAME_ANSWER_W, &name_answer_cb, n);
    lv_obj_set_pos(btn, (KBSP_LCD_H_RES - KIT_NAME_ANSWER_W) / 2, KIT_NAME_FOOT_Y);
    kit_bar(kit, page, n->title);
    name_show(n);
}
