/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file kit.c
 * @brief The starter apps' shared screen kit.
 */
#include "kit.h"

#include <string.h>

#include "kode_sys.h"

#define TAG "kit"   /**< This file's log tag. */

#define KIT_SLIDE_MS      220        /**< How long a page takes to slide in. */
#define KIT_ARROW_W       12         /**< The back arrow's width. */
#define KIT_ARROW_H       22         /**< The back arrow's height. */
#define KIT_ARROW_INK     4          /**< The back arrow's stroke. */
#define KIT_ARROW_GAP     14         /**< From the arrow to the words. */
#define KIT_SCROLL_TOP    70         /**< Above this a focused row is scrolled down into view. */
#define KIT_SCROLL_BOT    436        /**< Below this a focused row is scrolled up into view. */
#define KIT_FOCUS_STATE   LV_STATE_USER_2   /**< The state the ring is drawn for. */
#define KIT_LEVEL_STEP    5          /**< How far LEFT or RIGHT moves a level. */
#define KIT_SPIN_MS       1100       /**< One turn of the spinner. */
#define KIT_SPIN_SWEEP    100        /**< The spinner's arc, degrees. */
#define KIT_KEYS_Y        130        /**< The keypad's top. */
#define KIT_KEYS_H        264        /**< The keypad's height. */
#define KIT_KEY_RADIUS    16         /**< A key's corner radius. */
#define KIT_FIELD_Y       64         /**< The name field's top. */
#define KIT_FIELD_H       56         /**< The name field's height. */
#define KIT_FOOT_Y        402        /**< Where a page's single button stands. */

/** @brief The keypad's pages. */
enum {
    KIT_MODE_UPPER = 0,   /**< Capital letters. */
    KIT_MODE_LOWER,       /**< Small letters. */
    KIT_MODE_SYMBOLS      /**< Digits and marks. */
};

static lv_style_t s_danger;        /**< A red ending button. */
static lv_style_t s_danger_text;   /**< Its word. */
static lv_style_t s_quiet;         /**< A quiet second button. */
static lv_style_t s_quiet_text;    /**< Its word. */
static lv_style_t s_key;           /**< A key of the keypad. */
static lv_style_t s_key_text;      /**< A key's letter. */
static lv_style_t s_key_down;      /**< A key held down. */
static bool       s_styles_ready;  /**< The styles above are initialised. */

/**
 * @brief Make the kit's own styles once, from kui's tokens.
 */
static void kit_styles(void)
{
    if ( !s_styles_ready )
    {
        lv_style_init(&s_danger);
        lv_style_set_bg_color(&s_danger, KUI_COLOR_DANGER);
        lv_style_set_bg_opa(&s_danger, LV_OPA_COVER);
        lv_style_set_radius(&s_danger, KUI_RADIUS_GLASS);
        lv_style_set_border_width(&s_danger, 0);
        lv_style_set_shadow_width(&s_danger, 0);
        lv_style_init(&s_danger_text);
        lv_style_set_text_font(&s_danger_text, &kui_font_button);
        lv_style_set_text_color(&s_danger_text, KUI_COLOR_TEXT_ON_BG);
        lv_style_init(&s_quiet);
        lv_style_set_bg_color(&s_quiet, KUI_COLOR_SURFACE);
        lv_style_set_bg_opa(&s_quiet, LV_OPA_COVER);
        lv_style_set_radius(&s_quiet, KUI_RADIUS_GLASS);
        lv_style_set_border_width(&s_quiet, 0);
        lv_style_set_shadow_width(&s_quiet, 0);
        lv_style_init(&s_quiet_text);
        lv_style_set_text_font(&s_quiet_text, &kui_font_button);
        lv_style_set_text_color(&s_quiet_text, KUI_COLOR_TEXT_ON_BG);
        lv_style_init(&s_key);
        lv_style_set_bg_color(&s_key, KUI_COLOR_SURFACE);
        lv_style_set_bg_opa(&s_key, LV_OPA_COVER);
        lv_style_set_radius(&s_key, KIT_KEY_RADIUS);
        lv_style_set_border_width(&s_key, 0);
        lv_style_set_shadow_width(&s_key, 0);
        lv_style_init(&s_key_text);
        lv_style_set_text_font(&s_key_text, &kui_font_name);
        lv_style_set_text_color(&s_key_text, KUI_COLOR_TEXT_ON_BG);
        lv_style_init(&s_key_down);
        lv_style_set_bg_color(&s_key_down, KUI_COLOR_REST);
        s_styles_ready = true;
    }
}

void kit_ctor(kit_t *kit, QActive *owner, enum_t tick_sig)
{
    (void)memset(kit, 0, sizeof(*kit));
    kscreen_ctor(&kit->screen, owner, tick_sig);
    kit->tick_sig = tick_sig;
    kit->sel = -1;
    kit->swipe_back = true;
}

void kit_start(kit_t *kit)
{
    QActive_subscribe(kit->screen.owner, BUTTON_EVT_SIG);
    QActive_subscribe(kit->screen.owner, BUTTON_HOLD_SIG);
    kscreen_start(&kit->screen);
}

bool kit_open_glass(kit_t *kit, DisplayStateEvt const *d)
{
    if ( !kit->open )
    {
        if ( KODE_OK == kscreen_open(&kit->screen, d) )
        {
            kit_styles();
            kit->open = true;
        }
    }
    return kit->open;
}

bool kit_is_open(kit_t const *kit)
{
    return kit->open;
}

uint8_t kit_depth(kit_t const *kit)
{
    return kit->depth;
}

kit_build_fn_t kit_current(kit_t const *kit)
{
    kit_build_fn_t fn = NULL;

    if ( 0U < kit->depth )
    {
        fn = kit->stack[kit->depth - 1U].fn;
    }
    return fn;
}

bool kit_pad_active(kit_t const *kit)
{
    return kit->pad;
}

/* ---- The pad ---- */

/**
 * @brief Draw the ring on the focused control, and nowhere else.
 * @param kit The kit.
 */
static void kit_ring(kit_t *kit)
{
    for ( uint8_t i = 0U; i < kit->nfocus; ++i )
    {
        bool const on = kit->pad && (0 <= kit->sel) && ((int8_t)i == kit->sel);

        if ( on )
        {
            lv_obj_add_state(kit->focus[i], KIT_FOCUS_STATE);
        }
        else
        {
            lv_obj_remove_state(kit->focus[i], KIT_FOCUS_STATE);
        }
    }
}

/**
 * @brief Scroll the page so the focused control is clear of the bar and of the glass's corners.
 * @param kit The kit.
 */
static void kit_scroll_to_sel(kit_t *kit)
{
    if ( (NULL != kit->body) && (0 <= kit->sel) && ((uint8_t)kit->sel < kit->nfocus) )
    {
        lv_obj_t * const obj = kit->focus[kit->sel];
        lv_area_t        a;

        if ( lv_obj_get_parent(obj) == kit->body )
        {
            lv_obj_get_coords(obj, &a);
            if ( KIT_SCROLL_TOP > a.y1 )
            {
                lv_obj_scroll_by(kit->body, 0, KIT_SCROLL_TOP - a.y1, LV_ANIM_ON);
            }
            else if ( KIT_SCROLL_BOT < a.y2 )
            {
                lv_obj_scroll_by(kit->body, 0, KIT_SCROLL_BOT - a.y2, LV_ANIM_ON);
            }
            else
            {
                /* Already clear. */
            }
        }
    }
}

void kit_focus_add(kit_t *kit, lv_obj_t *obj)
{
    if ( KIT_FOCUS_MAX > kit->nfocus )
    {
        kit->focus[kit->nfocus] = obj;
        kit->nfocus++;
        lv_obj_add_style(obj, &kui_style_ring, KIT_FOCUS_STATE);
    }
}

/**
 * @brief The pad moved the focus.
 * @param kit  The kit.
 * @param step -1 up, 1 down.
 */
static void kit_move(kit_t *kit, int8_t step)
{
    if ( 0U < kit->nfocus )
    {
        int16_t next = kit->sel;

        if ( 0 > next )
        {
            next = 0;
        }
        else if ( kit->pad )
        {
            next = (int16_t)(next + step);
            if ( 0 > next )
            {
                next = 0;
            }
            if ( (int16_t)kit->nfocus <= next )
            {
                next = (int16_t)kit->nfocus - 1;
            }
        }
        else
        {
            /* The first press after a touch only shows the ring where it was. */
        }
        kit->sel = (int8_t)next;
    }
    kit->pad = true;
    kit_ring(kit);
    kit_scroll_to_sel(kit);
}

/**
 * @brief TOP: act on the focused control.
 * @param kit The kit.
 */
static void kit_act(kit_t *kit)
{
    if ( (0 <= kit->sel) && ((uint8_t)kit->sel < kit->nfocus) )
    {
        lv_obj_t * const obj = kit->focus[kit->sel];

        if ( !lv_obj_has_class(obj, &lv_slider_class) )
        {
            lv_obj_send_event(obj, LV_EVENT_CLICKED, NULL);
        }
    }
    else if ( 1U == kit->nfocus )
    {
        /* A page with one thing to do: TOP does it, ring or not. */
        lv_obj_send_event(kit->focus[0], LV_EVENT_CLICKED, NULL);
    }
    else
    {
        /* Nothing is focused yet. */
    }
}

/**
 * @brief LEFT or RIGHT on a focused level steps it.
 * @param kit  The kit.
 * @param step -1 or 1.
 */
static void kit_step(kit_t *kit, int32_t step)
{
    if ( (0 <= kit->sel) && ((uint8_t)kit->sel < kit->nfocus) )
    {
        lv_obj_t * const obj = kit->focus[kit->sel];

        if ( lv_obj_has_class(obj, &lv_slider_class) )
        {
            int32_t v = lv_slider_get_value(obj) + (step * KIT_LEVEL_STEP);

            if ( 0 > v )
            {
                v = 0;
            }
            if ( KUI_LEVEL_MAX < v )
            {
                v = KUI_LEVEL_MAX;
            }
            lv_slider_set_value(obj, v, LV_ANIM_OFF);
            lv_obj_send_event(obj, LV_EVENT_VALUE_CHANGED, NULL);
        }
    }
}

/* ---- Pages ---- */

/**
 * @brief A swipe on a page: right goes back.
 * @param e The gesture.
 */
static void kit_gesture_cb(lv_event_t *e)
{
    kit_t * const kit = (kit_t *)lv_event_get_user_data(e);

    if ( kit->swipe_back && (LV_DIR_RIGHT == lv_indev_get_gesture_dir(lv_indev_active())) )
    {
        (void)kit_back(kit);
    }
}

/**
 * @brief A tap on the back bar's line.
 * @param e The click.
 */
static void kit_bar_cb(lv_event_t *e)
{
    (void)kit_back((kit_t *)lv_event_get_user_data(e));
}

/**
 * @brief Run the builder at the top of the stack and put its page on the glass.
 * @param kit  The kit.
 * @param anim How the page arrives.
 */
static void kit_show(kit_t *kit, lv_screen_load_anim_t anim)
{
    int8_t const keep = kit->sel;
    lv_obj_t    *old  = kit->cur;

    kit->nfocus     = 0U;
    kit->sel        = -1;
    kit->next       = NULL;
    kit->body       = NULL;
    kit->swipe_back = true;
    kit->stack[kit->depth - 1U].fn(kit, kit->stack[kit->depth - 1U].arg);
    if ( NULL != kit->next )
    {
        kit->cur  = kit->next;
        kit->next = NULL;
        if ( kit->swipe_back )
        {
            lv_obj_add_event_cb(kit->cur, &kit_gesture_cb, LV_EVENT_GESTURE, kit);
        }
        if ( (0 <= keep) && kit->pad && (0U < kit->nfocus) )
        {
            kit->sel = keep;
            if ( (uint8_t)keep >= kit->nfocus )
            {
                kit->sel = (int8_t)(kit->nfocus - 1U);
            }
        }
        kit_ring(kit);
        if ( NULL == old )
        {
            lv_screen_load(kit->cur);
        }
        else if ( LV_SCREEN_LOAD_ANIM_NONE == anim )
        {
            /* In place: the old page may be the one whose event is running, so it goes later. */
            lv_screen_load(kit->cur);
            lv_obj_delete_async(old);
        }
        else
        {
            lv_screen_load_anim(kit->cur, anim, KIT_SLIDE_MS, 0U, true);
        }
    }
}

void kit_push(kit_t *kit, kit_build_fn_t fn, void *arg)
{
    if ( kit->open && (KIT_STACK_MAX > kit->depth) )
    {
        kit->stack[kit->depth].fn  = fn;
        kit->stack[kit->depth].arg = arg;
        kit->depth++;
        kit_show(kit, LV_SCREEN_LOAD_ANIM_MOVE_LEFT);
    }
}

void kit_replace(kit_t *kit, kit_build_fn_t fn, void *arg)
{
    if ( kit->open && (0U < kit->depth) )
    {
        kit->stack[kit->depth - 1U].fn  = fn;
        kit->stack[kit->depth - 1U].arg = arg;
        kit_show(kit, LV_SCREEN_LOAD_ANIM_NONE);
    }
}

bool kit_back(kit_t *kit)
{
    bool left = false;

    if ( kit->open && (1U < kit->depth) )
    {
        kit->depth--;
        kit->sel = -1;
        kit_show(kit, LV_SCREEN_LOAD_ANIM_MOVE_RIGHT);
        left = true;
    }
    return left;
}

bool kit_pop_to(kit_t *kit, uint8_t depth)
{
    bool left = false;

    if ( kit->open && (1U <= depth) && (depth < kit->depth) )
    {
        kit->depth = depth;
        kit->sel   = -1;
        kit_show(kit, LV_SCREEN_LOAD_ANIM_MOVE_RIGHT);
        left = true;
    }
    return left;
}

void kit_home(kit_t *kit)
{
    if ( kit->open && (0U < kit->depth) )
    {
        kit->depth = 1U;
        kit->sel   = -1;
        kit_show(kit, LV_SCREEN_LOAD_ANIM_MOVE_RIGHT);
    }
}

void kit_refresh(kit_t *kit)
{
    if ( kit->open && (0U < kit->depth) )
    {
        kit_show(kit, LV_SCREEN_LOAD_ANIM_NONE);
    }
}

void kit_no_swipe(kit_t *kit)
{
    kit->swipe_back = false;
}

/**
 * @brief A black page with its flags set.
 * @param kit The kit.
 * @return The page.
 */
static lv_obj_t *kit_blank(kit_t *kit)
{
    lv_obj_t * const page = lv_obj_create(NULL);

    lv_obj_add_style(page, &kui_style_screen, 0);
    lv_obj_set_style_pad_all(page, 0, 0);
    lv_obj_set_style_border_width(page, 0, 0);
    lv_obj_set_scrollable(page, false);
    lv_obj_add_style(page, &kui_style_scrollbar_hidden, LV_PART_SCROLLBAR);
    kit->next = page;
    return page;
}

lv_obj_t *kit_page_bare(kit_t *kit)
{
    return kit_blank(kit);
}

void kit_bar(kit_t *kit, lv_obj_t *page, const char *title)
{
    static const lv_point_precise_t s_arrow[] = {
        { KIT_ARROW_W, 0 }, { 0, KIT_ARROW_H / 2 }, { KIT_ARROW_W, KIT_ARROW_H },
    };
    bool const    back  = (1U < kit->depth);
    int32_t const line  = KIT_BAR_Y + KIT_BAR_H;
    lv_obj_t     *bar   = lv_obj_create(page);
    lv_obj_t     *hit   = lv_obj_create(bar);
    lv_obj_t     *words = lv_label_create(bar);
    lv_point_t    said;
    int32_t       x;

    lv_obj_set_name(bar, "kit_bar");
    lv_obj_remove_style_all(bar);
    lv_obj_set_pos(bar, 0, 0);
    lv_obj_set_size(bar, (int32_t)KBSP_LCD_H_RES, KIT_BAR_FOOT);
    lv_obj_set_scrollable(bar, false);
    lv_obj_remove_flag(bar, LV_OBJ_FLAG_CLICKABLE);
    /* Solid to the foot of its line, then out to nothing: the list passes under it. */
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(bar, KUI_COLOR_BG, 0);
    lv_obj_set_style_bg_grad_color(bar, KUI_COLOR_BG, 0);
    lv_obj_set_style_bg_grad_dir(bar, LV_GRAD_DIR_VER, 0);
    lv_obj_set_style_bg_main_opa(bar, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_grad_opa(bar, LV_OPA_TRANSP, 0);
    lv_obj_set_style_bg_main_stop(bar, (line * 255) / KIT_BAR_FOOT, 0);
    lv_obj_set_style_bg_grad_stop(bar, 255, 0);
    lv_obj_remove_style_all(hit);
    lv_obj_set_size(hit, (int32_t)KBSP_LCD_H_RES, line);
    lv_obj_set_scrollable(hit, false);
    if ( back )
    {
        lv_obj_add_flag(hit, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(hit, &kit_bar_cb, LV_EVENT_CLICKED, kit);
    }
    lv_obj_set_name(words, "bar_words");
    lv_obj_set_style_text_font(words, &kui_font_name, 0);
    lv_obj_set_style_text_color(words, KUI_COLOR_TEXT_ON_BG, 0);
    lv_label_set_text(words, title);
    lv_obj_remove_flag(words, LV_OBJ_FLAG_CLICKABLE);
    lv_text_get_size(&said, title, &kui_font_name, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    x = ((int32_t)KBSP_LCD_H_RES - said.x) / 2;
    lv_obj_set_pos(words, x, KIT_BAR_Y + ((KIT_BAR_H - lv_font_get_line_height(&kui_font_name)) / 2));
    if ( back )
    {
        lv_obj_t * const arrow = lv_line_create(bar);

        lv_obj_set_name(arrow, "bar_arrow");
        lv_line_set_points(arrow, s_arrow, sizeof(s_arrow) / sizeof(s_arrow[0]));
        lv_obj_set_style_line_width(arrow, KIT_ARROW_INK, 0);
        lv_obj_set_style_line_rounded(arrow, true, 0);
        lv_obj_set_style_line_color(arrow, KUI_COLOR_TEXT_ON_BG, 0);
        lv_obj_remove_flag(arrow, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_pos(arrow, x - KIT_ARROW_GAP - KIT_ARROW_W, KIT_BAR_Y + ((KIT_BAR_H - KIT_ARROW_H) / 2));
    }
}

void kit_set_title(kit_t *kit, const char *title)
{
    if ( NULL != kit->cur )
    {
        lv_obj_t * const words = lv_obj_find_by_name(kit->cur, "bar_words");

        if ( NULL != words )
        {
            lv_label_set_text(words, title);
        }
    }
}

lv_obj_t *kit_page(kit_t *kit, const char *title)
{
    lv_obj_t * const page = kit_blank(kit);
    lv_obj_t * const body = kui_flex_create(page, LV_FLEX_FLOW_COLUMN, KIT_GAP, 0U, LV_FLEX_ALIGN_START,
                                            LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_obj_set_name(body, "kit_body");
    lv_obj_set_pos(body, 0, 0);
    lv_obj_set_size(body, (int32_t)KBSP_LCD_H_RES, (int32_t)KBSP_LCD_V_RES);
    lv_obj_set_style_pad_top(body, KIT_BAR_FOOT, 0);
    lv_obj_set_style_pad_bottom(body, KIT_BODY_BOTTOM, 0);
    lv_obj_set_scroll_dir(body, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(body, LV_SCROLLBAR_MODE_OFF);
    kit->body = body;
    kit_bar(kit, page, title);
    return body;
}

/* ---- Rows and buttons ---- */

lv_obj_t *kit_row(kit_t *kit, lv_obj_t *parent, const char *name, const char *sub,
                  const lv_image_dsc_t *glyph, const char *letter, lv_color_t slot,
                  lv_event_cb_t cb, void *user)
{
    lv_obj_t * const pill = kui_pill_create(parent, name, sub);
    lv_obj_t * const disc = lv_obj_find_by_name(pill, "slot");
    lv_obj_t * const img  = lv_obj_find_by_name(pill, "slot_img");
    lv_obj_t * const text = lv_obj_find_by_name(pill, "slot_text");

    lv_obj_set_style_bg_color(disc, slot, 0);
    if ( NULL != glyph )
    {
        lv_image_set_src(img, glyph);
        lv_obj_set_style_image_recolor(img, KUI_COLOR_TEXT, 0);
        lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
        lv_obj_set_hidden(img, false);
        lv_obj_set_hidden(text, true);
    }
    else if ( NULL != letter )
    {
        lv_label_set_text(text, letter);
        lv_obj_set_style_text_font(text, &kui_font_name, 0);
    }
    else
    {
        /* A bare disc. */
    }
    if ( NULL != cb )
    {
        lv_obj_add_event_cb(pill, cb, LV_EVENT_CLICKED, user);
    }
    kit_focus_add(kit, pill);
    return pill;
}

void kit_row_set(lv_obj_t *row, const char *name, const char *sub)
{
    lv_label_set_text(lv_obj_find_by_name(row, "name"), name);
    lv_label_set_text(lv_obj_find_by_name(row, "sub"), sub);
}

void kit_row_danger(lv_obj_t *row)
{
    lv_obj_t * const disc = lv_obj_find_by_name(row, "slot");

    lv_obj_set_style_bg_color(disc, KUI_COLOR_DANGER, 0);
    lv_obj_set_style_text_color(lv_obj_find_by_name(row, "slot_text"), KUI_COLOR_TEXT_ON_BG, 0);
    lv_obj_set_style_image_recolor(lv_obj_find_by_name(row, "slot_img"), KUI_COLOR_TEXT_ON_BG, 0);
}

lv_obj_t *kit_button(kit_t *kit, lv_obj_t *parent, const char *label, kit_btn_kind_t kind,
                     int32_t width, lv_event_cb_t cb, void *user)
{
    lv_obj_t * const btn = lv_button_create(parent);
    lv_obj_t * const txt = lv_label_create(btn);

    lv_obj_set_name(btn, "kit_btn");
    lv_obj_set_size(btn, width, KUI_ACTION_H);
    lv_obj_set_scrollbar_mode(btn, LV_SCROLLBAR_MODE_OFF);
    lv_label_set_text(txt, label);
    lv_obj_set_align(txt, LV_ALIGN_CENTER);
    if ( KIT_BTN_DANGER == kind )
    {
        lv_obj_add_style(btn, &s_danger, 0);
        lv_obj_add_style(txt, &s_danger_text, 0);
    }
    else if ( KIT_BTN_QUIET == kind )
    {
        lv_obj_add_style(btn, &s_quiet, 0);
        lv_obj_add_style(txt, &s_quiet_text, 0);
    }
    else
    {
        lv_obj_add_style(btn, &kui_style_action, 0);
        lv_obj_add_style(btn, &kui_style_action_pressed, LV_STATE_PRESSED);
        lv_obj_add_style(txt, &kui_style_action_text, 0);
    }
    if ( NULL != cb )
    {
        lv_obj_add_event_cb(btn, cb, LV_EVENT_CLICKED, user);
    }
    kit_focus_add(kit, btn);
    return btn;
}

lv_obj_t *kit_disc(lv_obj_t *parent, int32_t d, lv_color_t colour, const lv_image_dsc_t *glyph)
{
    lv_obj_t * const disc = lv_obj_create(parent);

    lv_obj_remove_style_all(disc);
    lv_obj_set_size(disc, d, d);
    lv_obj_set_style_radius(disc, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(disc, colour, 0);
    lv_obj_set_style_bg_opa(disc, LV_OPA_COVER, 0);
    lv_obj_set_scrollable(disc, false);
    lv_obj_remove_flag(disc, LV_OBJ_FLAG_CLICKABLE);
    if ( NULL != glyph )
    {
        lv_obj_t * const img = lv_image_create(disc);

        lv_image_set_src(img, glyph);
        lv_obj_set_style_image_recolor(img, KUI_COLOR_TEXT, 0);
        lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
        lv_obj_set_align(img, LV_ALIGN_CENTER);
    }
    return disc;
}

lv_obj_t *kit_text(lv_obj_t *parent, const char *text, const lv_font_t *font, lv_color_t colour,
                   int32_t width, bool centre)
{
    lv_obj_t * const l = lv_label_create(parent);

    lv_label_set_text(l, text);
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, colour, 0);
    if ( 0 < width )
    {
        lv_obj_set_width(l, width);
    }
    if ( centre )
    {
        lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    }
    lv_obj_remove_flag(l, LV_OBJ_FLAG_CLICKABLE);
    return l;
}

lv_obj_t *kit_stage(kit_t *kit, lv_obj_t *page, lv_color_t colour, const lv_image_dsc_t *glyph,
                    const char *title, const char *line)
{
    lv_obj_t * const col = kui_flex_create(page, LV_FLEX_FLOW_COLUMN, KUI_SPACE_LG, 0U, LV_FLEX_ALIGN_START,
                                           LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    (void)kit;
    lv_obj_set_name(col, "kit_stage");
    lv_obj_set_pos(col, 0, 0);
    lv_obj_set_size(col, (int32_t)KBSP_LCD_H_RES, KIT_FOOT_Y - 4);
    lv_obj_set_style_pad_top(col, KIT_BAR_FOOT + 4, 0);
    lv_obj_set_style_pad_hor(col, KIT_SIDE, 0);
    lv_obj_set_scrollable(col, false);
    (void)kit_disc(col, KIT_DISC_BIG, colour, glyph);
    (void)kit_text(col, title, &kui_font_display_40, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, true);
    if ( NULL != line )
    {
        (void)kit_text(col, line, &kui_font_body, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, true);
    }
    return col;
}

/**
 * @brief The spinner's animation step.
 * @param obj The arc.
 * @param v   The turn, degrees.
 */
static void kit_spin_cb(void *obj, int32_t v)
{
    lv_arc_set_rotation((lv_obj_t *)obj, v);
}

lv_obj_t *kit_spinner(lv_obj_t *parent, int32_t d, lv_color_t colour)
{
    lv_obj_t * const arc = lv_arc_create(parent);
    lv_anim_t        a;

    lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
    lv_obj_remove_flag(arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(arc, d, d);
    lv_arc_set_bg_angles(arc, 0, 360);
    lv_arc_set_angles(arc, 0, KIT_SPIN_SWEEP);
    lv_obj_set_style_arc_width(arc, KUI_SPACE_MD, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, KUI_SPACE_MD, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, KUI_COLOR_SURFACE, LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, colour, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(arc, true, LV_PART_INDICATOR);
    lv_anim_init(&a);
    lv_anim_set_var(&a, arc);
    lv_anim_set_exec_cb(&a, &kit_spin_cb);
    lv_anim_set_values(&a, 0, 360);
    lv_anim_set_duration(&a, KIT_SPIN_MS);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    (void)lv_anim_start(&a);
    return arc;
}

/* ---- Buttons and touch ---- */

/**
 * @brief A button edge from AO_Buttons.
 * @param kit The kit.
 * @param be  The edge.
 */
static void kit_pad_event(kit_t *kit, ButtonEvt const *be)
{
    switch ( (uint32_t)be->id )
    {
        case KODE_SYS_BUTTON_UP:
        {
            if ( be->pressed )
            {
                kit_move(kit, -1);
            }
            break;
        }
        case KODE_SYS_BUTTON_DOWN:
        {
            if ( be->pressed )
            {
                kit_move(kit, 1);
            }
            break;
        }
        case KODE_SYS_BUTTON_LEFT:
        {
            if ( be->pressed )
            {
                kit_step(kit, -1);
            }
            break;
        }
        case KODE_SYS_BUTTON_RIGHT:
        {
            if ( be->pressed )
            {
                kit_step(kit, 1);
            }
            break;
        }
        case KODE_SYS_BUTTON_TOP:
        {
            if ( be->pressed )
            {
                kit->pad = true;
                kit_act(kit);
            }
            break;
        }
        case KODE_SYS_BUTTON_BOT:
        {
            if ( be->pressed )
            {
                kit->bot_down = true;
                kit->bot_held = false;
            }
            else
            {
                /* Back on the release of a short press: a hold is the OS's. */
                if ( kit->bot_down && !kit->bot_held )
                {
                    (void)kit_back(kit);
                }
                kit->bot_down = false;
            }
            break;
        }
        default:
        {
            break;
        }
    }
}

bool kit_on_event(kit_t *kit, QEvt const *e)
{
    bool mine = true;

    if ( kit->tick_sig == e->sig )
    {
        kscreen_tick(&kit->screen);
        return true;
    }
    switch ( e->sig )
    {
        case TOUCH_EVT_SIG:
        {
            TouchEvt const * const t = (TouchEvt const *)e;

            kscreen_touch(&kit->screen, t);
            if ( t->pressed && kit->pad )
            {
                kit->pad = false;
                kit_ring(kit);
            }
            break;
        }
        case DISPLAY_REPAINT_SIG:
        {
            kscreen_repaint(&kit->screen);
            break;
        }
        case DISPLAY_PARK_SIG:
        {
            kscreen_park(&kit->screen, ((DisplayParkEvt const *)e)->seq);
            break;
        }
        case BUTTON_EVT_SIG:
        {
            if ( kit->open )
            {
                kit_pad_event(kit, (ButtonEvt const *)e);
            }
            break;
        }
        case BUTTON_HOLD_SIG:
        {
            if ( KODE_SYS_BUTTON_BOT == (uint32_t)((ButtonHoldEvt const *)e)->id )
            {
                kit->bot_held = true;
            }
            break;
        }
        default:
        {
            mine = false;
            break;
        }
    }
    return mine;
}
