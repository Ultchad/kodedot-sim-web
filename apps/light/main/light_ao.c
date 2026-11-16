/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file light_ao.c
 * @brief The Light app's Active Object: a torch from the screen, a colour LED and SOS.
 */
#include "light_ao.h"

#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "kit.h"
#include "kit_store.h"

#define TAG "light.ao"   /**< This file's log tag. */

#define LIGHT_DIR             "/storage/light"             /**< The app's folder on the internal volume. */
#define LIGHT_FILE            "/storage/light/prefs.bin"   /**< What is kept: the settings. */
#define LIGHT_MAGIC           0x3154474CUL                 /**< "LGT1", the file's first four bytes. */
#define LIGHT_FILE_BYTES      16U                          /**< The size of the file. */
#define LIGHT_TEMP_DEFAULT    50U                          /**< Soft white, on the 0 to 100 scale from warm to cool. */
#define LIGHT_BRIGHT_DEFAULT  100U                         /**< The screen light's brightness on its scale. */
#define LIGHT_LED_PCT_DEFAULT 60U                          /**< The LED's brightness. */
#define LIGHT_HUE_DEFAULT     12U                          /**< The hue level the LED starts at: amber. */
#define LIGHT_PCT_FLOOR       KODE_SYS_SCREEN_BRIGHT_MIN   /**< The panel's lowest lit level. */
#define LIGHT_SOS_UNIT_MS     150U                         /**< One Morse unit. */
#define LIGHT_SOS_STEPS       18U                          /**< Steps of one SOS: three letters of marks and gaps. */
#define LIGHT_SWATCHES        6U                           /**< Colours to tap. */
#define LIGHT_DOCK_Y          232                          /**< Where the controls card of the screen light starts. */
#define LIGHT_DOCK_H          212                          /**< Its height. */
#define LIGHT_DOCK_PAD        24                           /**< Its padding. */
#define LIGHT_LEVEL_W         298                          /**< A level's length in the card. */
#define LIGHT_HUE_DEGREES     360U                         /**< Degrees of a hue. */
#define LIGHT_FOOT_Y          396                          /**< Where a page's one button stands. */

/** @brief This app's own signals: they start at MAX_SIG and are posted, never published. */
enum LightSignals
{
    LIGHT_TICK_SIG = MAX_SIG,   /**< The render pass: kscreen's one-shot. */
    LIGHT_SOS_SIG               /**< The next step of the SOS. */
};

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive     super;         /**< The QP/C base; must stay first. */
    kit_t       kit;           /**< The screens. */
    kit_store_t store;         /**< The settings file. */
    QTimeEvt    sos_t;         /**< Times the Morse. */
    uint8_t     temp;          /**< The screen's colour, 0 warm to 100 cool. */
    uint8_t     bright;        /**< The screen's brightness, 0 to 100 on the scale. */
    bool        night;         /**< Red night mode. */
    uint8_t     led_r;         /**< The LED's colour. */
    uint8_t     led_g;         /**< The LED's colour. */
    uint8_t     led_b;         /**< The LED's colour. */
    uint8_t     led_pct;       /**< The LED's brightness, 5 to 100. */
    uint8_t     hue;           /**< The hue level, 0 to 100. */
    bool        led_on;        /**< The LED is lit. */
    bool        dock;          /**< The controls card of the screen light is showing. */
    bool        sos_on;        /**< SOS is running. */
    uint8_t     sos_idx;       /**< Where it is in the pattern. */
    uint8_t     panel_pct;     /**< The brightness the panel had when the app started. */
    bool        panel_set;     /**< The app has changed the panel's brightness. */
    lv_obj_t   *lamp;          /**< The LED page's lamp. */
    lv_obj_t   *swatch[LIGHT_SWATCHES];   /**< The LED page's colours. */
    lv_obj_t   *hue_lv;        /**< The hue level. */
    lv_obj_t   *led_btn;       /**< The LED page's on/off button. */
    lv_obj_t   *scr_dock;      /**< The screen light's card. */
} LightAo;

/** @brief One step of the SOS: lit or dark, for some units. */
typedef struct {
    uint8_t lit;     /**< 1 lit. */
    uint8_t units;   /**< How many Morse units it lasts. */
} light_step_t;

/** @brief A colour to tap on the LED page. */
typedef struct {
    uint8_t r;   /**< Red. */
    uint8_t g;   /**< Green. */
    uint8_t b;   /**< Blue. */
} light_rgb_t;

static const light_step_t s_sos[LIGHT_SOS_STEPS] = {
    { 1U, 1U }, { 0U, 1U }, { 1U, 1U }, { 0U, 1U }, { 1U, 1U }, { 0U, 3U },
    { 1U, 3U }, { 0U, 1U }, { 1U, 3U }, { 0U, 1U }, { 1U, 3U }, { 0U, 3U },
    { 1U, 1U }, { 0U, 1U }, { 1U, 1U }, { 0U, 1U }, { 1U, 1U }, { 0U, 7U },
};   /**< S, O, S in Morse, with the gaps between letters and at the end. */

static const light_rgb_t s_colours[LIGHT_SWATCHES] = {
    { 0xFFU, 0x2DU, 0x2DU },   /* Red. */
    { 0xFFU, 0xACU, 0x00U },   /* Amber. */
    { 0x31U, 0xC4U, 0x5AU },   /* Green. */
    { 0x02U, 0x8AU, 0xC2U },   /* Blue. */
    { 0xB0U, 0x60U, 0xFFU },   /* Violet. */
    { 0xFFU, 0xFFU, 0xFFU },   /* White. */
};   /**< The swatches. */

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static uint8_t     s_file[LIGHT_FILE_BYTES];                           /**< The settings file's lent buffer. */
static LightAo     s_ao;                                               /**< The one instance. */

QActive * const AO_Light = &s_ao.super;

static QState LightAo_initial(LightAo * const me, void const * const par);
static QState LightAo_running(LightAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_screen(kit_t *kit, void *arg);
static void   page_led(kit_t *kit, void *arg);
static void   page_sos(kit_t *kit, void *arg);

/* ---- Colours ---- */

/**
 * @brief Blend two bytes.
 * @param a One end.
 * @param b The other.
 * @param t 0 to 100 along from a to b.
 * @return The blend.
 */
static uint8_t blend(uint8_t a, uint8_t b, uint32_t t)
{
    return (uint8_t)((((uint32_t)a * (100U - t)) + ((uint32_t)b * t)) / 100U);
}

/**
 * @brief The colour of the screen light: warm amber through soft white to a cool blue-white, or night red.
 * @param temp  0 to 100.
 * @param night Red night mode.
 * @return The colour.
 */
static lv_color_t light_colour(uint8_t temp, bool night)
{
    lv_color_t c;

    if ( night )
    {
        c = lv_color_make(0xE0U, 0x10U, 0x00U);
    }
    else if ( 50U >= temp )
    {
        uint32_t const t = (uint32_t)temp * 2U;

        c = lv_color_make(blend(0xFFU, 0xFFU, t), blend(0xA8U, 0xF6U, t), blend(0x5CU, 0xEAU, t));
    }
    else
    {
        uint32_t const t = ((uint32_t)temp - 50U) * 2U;

        c = lv_color_make(blend(0xFFU, 0xB4U, t), blend(0xF6U, 0xD4U, t), blend(0xEAU, 0xFFU, t));
    }
    return c;
}

/**
 * @brief A fully saturated colour from a hue.
 * @param hue 0 to 100 around the wheel.
 * @param out Receives the colour.
 */
static void hue_rgb(uint8_t hue, light_rgb_t *out)
{
    uint32_t const h      = ((uint32_t)hue * (LIGHT_HUE_DEGREES - 1U)) / 100U;
    uint32_t const sector = h / 60U;
    uint32_t const rise   = ((h % 60U) * 255U) / 60U;
    uint32_t const fall   = 255U - rise;

    switch ( sector )
    {
        case 0U: { out->r = 255U;           out->g = (uint8_t)rise; out->b = 0U;            break; }
        case 1U: { out->r = (uint8_t)fall;  out->g = 255U;          out->b = 0U;            break; }
        case 2U: { out->r = 0U;             out->g = 255U;          out->b = (uint8_t)rise; break; }
        case 3U: { out->r = 0U;             out->g = (uint8_t)fall; out->b = 255U;          break; }
        case 4U: { out->r = (uint8_t)rise;  out->g = 0U;            out->b = 255U;          break; }
        default: { out->r = 255U;           out->g = 0U;            out->b = (uint8_t)fall; break; }
    }
}

/* ---- The settings file ---- */

/**
 * @brief Fill the file buffer from the settings.
 * @param ctx The Active Object.
 * @param buf The buffer.
 * @param cap Its size.
 * @return The bytes to write.
 */
static uint32_t prefs_pack(void *ctx, uint8_t *buf, uint32_t cap)
{
    LightAo const * const me    = (LightAo const *)ctx;
    uint32_t const        magic = LIGHT_MAGIC;

    (void)cap;
    (void)memset(buf, 0, LIGHT_FILE_BYTES);
    (void)memcpy(buf, &magic, sizeof(magic));
    buf[4]  = me->temp;
    buf[5]  = me->bright;
    buf[6]  = 0U;
    if ( me->night )
    {
        buf[6] = 1U;
    }
    buf[7]  = me->led_r;
    buf[8]  = me->led_g;
    buf[9]  = me->led_b;
    buf[10] = me->led_pct;
    buf[11] = me->hue;
    return LIGHT_FILE_BYTES;
}

/**
 * @brief Read the settings back from the file buffer.
 * @param me  The Active Object.
 * @param len The bytes read.
 */
static void prefs_unpack(LightAo *me, uint32_t len)
{
    uint32_t magic = 0U;

    (void)memcpy(&magic, s_file, sizeof(magic));
    if ( (LIGHT_FILE_BYTES <= len) && (LIGHT_MAGIC == magic) && (100U >= s_file[4]) && (100U >= s_file[5])
         && (100U >= s_file[10]) && (LIGHT_PCT_FLOOR <= s_file[10]) && (100U >= s_file[11]) )
    {
        me->temp    = s_file[4];
        me->bright  = s_file[5];
        me->night   = (0U != s_file[6]);
        me->led_r   = s_file[7];
        me->led_g   = s_file[8];
        me->led_b   = s_file[9];
        me->led_pct = s_file[10];
        me->hue     = s_file[11];
    }
    else
    {
        KLOG_W(TAG, "the settings file is not ours; keeping the defaults");
    }
}

/* ---- The devices ---- */

/**
 * @brief Put the LED where the settings say.
 * @param me The Active Object.
 */
static void led_apply(LightAo *me)
{
    uint8_t r = 0U;
    uint8_t g = 0U;
    uint8_t b = 0U;

    if ( me->led_on )
    {
        r = (uint8_t)(((uint32_t)me->led_r * me->led_pct) / 100U);
        g = (uint8_t)(((uint32_t)me->led_g * me->led_pct) / 100U);
        b = (uint8_t)(((uint32_t)me->led_b * me->led_pct) / 100U);
    }
    if ( KODE_OK != kode_sys_led_set_rgb(r, g, b) )
    {
        KLOG_W(TAG, "AO_LedMgr is busy; the LED stays as it was");
    }
}

/**
 * @brief The panel's brightness for a level on the app's 0 to 100 scale.
 * @param level 0 to 100.
 * @return 5 to 100.
 */
static uint8_t panel_for(uint8_t level)
{
    return (uint8_t)(LIGHT_PCT_FLOOR + (((uint32_t)level * (100U - LIGHT_PCT_FLOOR)) / 100U));
}

/**
 * @brief Set the panel's brightness for the screen light.
 * @param me    The Active Object.
 * @param level 0 to 100.
 */
static void panel_apply(LightAo *me, uint8_t level)
{
    if ( KODE_OK == kode_sys_screen_brightness(panel_for(level)) )
    {
        me->panel_set = true;
    }
}

/**
 * @brief Give the panel back the brightness it had.
 * @param me The Active Object.
 */
static void panel_restore(LightAo *me)
{
    if ( me->panel_set && (LIGHT_PCT_FLOOR <= me->panel_pct) )
    {
        (void)kode_sys_screen_brightness(me->panel_pct);
        me->panel_set = false;
    }
}

/**
 * @brief Stop the SOS and leave the LED where the settings say.
 * @param me The Active Object.
 */
static void sos_stop(LightAo *me)
{
    if ( me->sos_on )
    {
        me->sos_on = false;
        QTimeEvt_disarm(&me->sos_t);
        led_apply(me);
    }
}

/**
 * @brief Show a step of the SOS on the glass and the LED, and arm the next.
 * @param me The Active Object.
 */
static void sos_step(LightAo *me)
{
    light_step_t const st = s_sos[me->sos_idx];
    lv_color_t         ground = lv_color_black();

    if ( 0U != st.lit )
    {
        (void)kode_sys_led_set_rgb(0xFFU, 0xFFU, 0xFFU);
        ground = lv_color_white();
    }
    else
    {
        (void)kode_sys_led_set_rgb(0U, 0U, 0U);
    }
    if ( NULL != me->kit.cur )
    {
        lv_obj_set_style_bg_color(me->kit.cur, ground, 0);
    }
    QTimeEvt_armX(&me->sos_t, KQP_TICKS_PER_MS((uint32_t)st.units * LIGHT_SOS_UNIT_MS), 0U);
    me->sos_idx = (uint8_t)((me->sos_idx + 1U) % LIGHT_SOS_STEPS);
}

/* ---- The home page ---- */

/**
 * @brief The words under the Screen light row.
 * @param me  The Active Object.
 * @param out The buffer.
 * @param cap Its size.
 */
static void screen_sub(LightAo const *me, char *out, size_t cap)
{
    const char *kind = "Soft white";

    if ( me->night )
    {
        kind = "Night mode";
    }
    else if ( 25U > me->temp )
    {
        kind = "Warm white";
    }
    else if ( 75U < me->temp )
    {
        kind = "Cool white";
    }
    else
    {
        /* Soft white. */
    }
    (void)snprintf(out, cap, "%s, %u%%", kind, (unsigned)panel_for(me->bright));
}

/** @brief A tap on Screen light. @param e The event. */
static void home_screen_cb(lv_event_t *e)
{
    (void)e;
    s_ao.dock = true;
    kit_push(&s_ao.kit, &page_screen, &s_ao);
}

/** @brief A tap on LED. @param e The event. */
static void home_led_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_led, &s_ao);
}

/** @brief A tap on SOS. @param e The event. */
static void home_sos_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_sos, &s_ao);
}

/** @brief A tap on Night mode. @param e The event. */
static void home_night_cb(lv_event_t *e)
{
    (void)e;
    s_ao.night = true;
    kit_store_save(&s_ao.store);
    s_ao.dock  = true;
    kit_push(&s_ao.kit, &page_screen, &s_ao);
}

/**
 * @brief The first page: three ways to make light, and night mode.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    LightAo * const  me   = (LightAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Light");
    char             sub[48];

    /* Coming back from a page that took over the panel or the LED. */
    sos_stop(me);
    panel_restore(me);
    screen_sub(me, sub, sizeof(sub));
    (void)kit_row(kit, body, "Screen light", sub, &app_glyph_screen_40, NULL, KUI_COLOR_LEVEL, &home_screen_cb, me);
    if ( me->led_on )
    {
        (void)snprintf(sub, sizeof(sub), "On, %u%%", (unsigned)me->led_pct);
    }
    else
    {
        (void)snprintf(sub, sizeof(sub), "Off");
    }
    (void)kit_row(kit, body, "LED", sub, &app_glyph_led_40, NULL, KUI_COLOR_TEXT_ON_BG, &home_led_cb, me);
    (void)kit_row(kit, body, "SOS", "Flash it in Morse", &app_glyph_sos_40, NULL, KUI_COLOR_TEXT_MUTED, &home_sos_cb, me);
    (void)kit_row(kit, body, "Night mode", "Red screen for the dark", &app_glyph_light_40, NULL,
                  KUI_COLOR_DANGER, &home_night_cb, me);
}

/* ---- The screen light ---- */

/** @brief Tap on the lit screen: show or hide the controls. @param e The event. */
static void screen_tap_cb(lv_event_t *e)
{
    (void)e;
    s_ao.dock = !s_ao.dock;
    if ( NULL != s_ao.scr_dock )
    {
        lv_obj_set_hidden(s_ao.scr_dock, !s_ao.dock);
    }
}

/** @brief The warmth level moved. @param e The event. */
static void screen_temp_cb(lv_event_t *e)
{
    lv_obj_t * const lv = lv_event_get_target_obj(e);

    s_ao.temp = (uint8_t)lv_slider_get_value(lv);
    lv_obj_set_style_bg_color(s_ao.kit.cur, light_colour(s_ao.temp, s_ao.night), 0);
    if ( !lv_slider_is_dragged(lv) )
    {
        kit_store_save(&s_ao.store);
    }
}

/** @brief The brightness level moved. @param e The event. */
static void screen_bright_cb(lv_event_t *e)
{
    lv_obj_t * const lv = lv_event_get_target_obj(e);

    s_ao.bright = (uint8_t)lv_slider_get_value(lv);
    panel_apply(&s_ao, s_ao.bright);
    if ( !lv_slider_is_dragged(lv) )
    {
        kit_store_save(&s_ao.store);
    }
}

/** @brief A level was let go: keep it. @param e The event. */
static void keep_cb(lv_event_t *e)
{
    (void)e;
    kit_store_save(&s_ao.store);
}

/** @brief Night mode toggled. @param e The event. */
static void screen_night_cb(lv_event_t *e)
{
    (void)e;
    s_ao.night = !s_ao.night;
    kit_store_save(&s_ao.store);
    kit_refresh(&s_ao.kit);
}

/** @brief Done: back to the list. @param e The event. */
static void screen_done_cb(lv_event_t *e)
{
    (void)e;
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief The screen as a light: the whole glass one colour, and a card of controls over it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_screen(kit_t *kit, void *arg)
{
    LightAo * const  me   = (LightAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t * const dock = lv_obj_create(page);
    lv_obj_t        *lv;
    lv_obj_t        *btn;
    int32_t const    half = (LIGHT_LEVEL_W - KUI_SPACE_MD) / 2;

    kit_no_swipe(kit);
    lv_obj_set_style_bg_color(page, light_colour(me->temp, me->night), 0);
    lv_obj_add_flag(page, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(page, &screen_tap_cb, LV_EVENT_CLICKED, me);
    panel_apply(me, me->bright);

    me->scr_dock = dock;
    lv_obj_remove_style_all(dock);
    lv_obj_set_pos(dock, KIT_SIDE, LIGHT_DOCK_Y);
    lv_obj_set_size(dock, KIT_ROW_W, LIGHT_DOCK_H);
    lv_obj_set_style_bg_color(dock, KUI_COLOR_SURFACE, 0);
    lv_obj_set_style_bg_opa(dock, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(dock, KUI_RADIUS_GLASS / 2, 0);
    lv_obj_set_scrollable(dock, false);
    lv_obj_set_hidden(dock, !me->dock);

    (void)kit_text(dock, "Warmth", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 0, false);
    lv_obj_set_pos(lv_obj_get_child(dock, -1), LIGHT_DOCK_PAD, 18);
    lv = kui_level_create(dock, KUI_COLOR_LEVEL);
    lv_obj_set_pos(lv, LIGHT_DOCK_PAD, 56);
    lv_obj_set_width(lv, LIGHT_LEVEL_W);
    lv_slider_set_value(lv, me->temp, LV_ANIM_OFF);
    lv_obj_add_event_cb(lv, &screen_temp_cb, LV_EVENT_VALUE_CHANGED, me);
    lv_obj_add_event_cb(lv, &keep_cb, LV_EVENT_RELEASED, me);
    kit_focus_add(kit, lv);

    (void)kit_text(dock, "Brightness", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 0, false);
    lv_obj_set_pos(lv_obj_get_child(dock, -1), LIGHT_DOCK_PAD, 84);
    lv = kui_level_create(dock, KUI_COLOR_LEVEL);
    lv_obj_set_pos(lv, LIGHT_DOCK_PAD, 122);
    lv_obj_set_width(lv, LIGHT_LEVEL_W);
    lv_slider_set_value(lv, me->bright, LV_ANIM_OFF);
    lv_obj_add_event_cb(lv, &screen_bright_cb, LV_EVENT_VALUE_CHANGED, me);
    lv_obj_add_event_cb(lv, &keep_cb, LV_EVENT_RELEASED, me);
    kit_focus_add(kit, lv);

    if ( me->night )
    {
        btn = kit_button(kit, dock, "Night on", KIT_BTN_DANGER, half, &screen_night_cb, me);
    }
    else
    {
        btn = kit_button(kit, dock, "Night", KIT_BTN_QUIET, half, &screen_night_cb, me);
    }
    lv_obj_set_pos(btn, LIGHT_DOCK_PAD, 146);
    btn = kit_button(kit, dock, "Done", KIT_BTN_ACTION, half, &screen_done_cb, me);
    lv_obj_set_pos(btn, LIGHT_DOCK_PAD + half + KUI_SPACE_MD, 146);
}

/* ---- The LED ---- */

/**
 * @brief Show the colour on the lamp and the swatches.
 * @param me The Active Object.
 */
static void led_show(LightAo *me)
{
    lv_color_t const c = lv_color_make(me->led_r, me->led_g, me->led_b);

    if ( NULL != me->lamp )
    {
        kui_lamp_set(me->lamp, c, me->led_on);
    }
    for ( uint8_t i = 0U; i < LIGHT_SWATCHES; ++i )
    {
        bool const chosen = (me->led_r == s_colours[i].r) && (me->led_g == s_colours[i].g)
                            && (me->led_b == s_colours[i].b);

        if ( NULL != me->swatch[i] )
        {
            if ( chosen )
            {
                lv_obj_add_state(me->swatch[i], LV_STATE_CHECKED);
            }
            else
            {
                lv_obj_remove_state(me->swatch[i], LV_STATE_CHECKED);
            }
        }
    }
    if ( NULL != me->hue_lv )
    {
        kui_level_set_colour(me->hue_lv, c);
    }
    if ( NULL != me->led_btn )
    {
        if ( me->led_on )
        {
            lv_label_set_text(lv_obj_get_child(me->led_btn, 0), "Turn off");
        }
        else
        {
            lv_label_set_text(lv_obj_get_child(me->led_btn, 0), "Turn on");
        }
    }
}

/** @brief A swatch was tapped. @param e The event. */
static void led_swatch_cb(lv_event_t *e)
{
    uint32_t const i = (uint32_t)(uintptr_t)lv_event_get_user_data(e);

    s_ao.led_r  = s_colours[i].r;
    s_ao.led_g  = s_colours[i].g;
    s_ao.led_b  = s_colours[i].b;
    s_ao.led_on = true;
    led_apply(&s_ao);
    led_show(&s_ao);
    kit_store_save(&s_ao.store);
}

/** @brief The hue level moved. @param e The event. */
static void led_hue_cb(lv_event_t *e)
{
    lv_obj_t * const lv = lv_event_get_target_obj(e);
    light_rgb_t      c;

    s_ao.hue = (uint8_t)lv_slider_get_value(lv);
    hue_rgb(s_ao.hue, &c);
    s_ao.led_r  = c.r;
    s_ao.led_g  = c.g;
    s_ao.led_b  = c.b;
    s_ao.led_on = true;
    led_apply(&s_ao);
    led_show(&s_ao);
    if ( !lv_slider_is_dragged(lv) )
    {
        kit_store_save(&s_ao.store);
    }
}

/** @brief The LED brightness level moved. @param e The event. */
static void led_bright_cb(lv_event_t *e)
{
    lv_obj_t * const lv = lv_event_get_target_obj(e);
    int32_t          v  = lv_slider_get_value(lv);

    if ( (int32_t)LIGHT_PCT_FLOOR > v )
    {
        v = (int32_t)LIGHT_PCT_FLOOR;
    }
    s_ao.led_pct = (uint8_t)v;
    led_apply(&s_ao);
    if ( !lv_slider_is_dragged(lv) )
    {
        kit_store_save(&s_ao.store);
    }
}

/** @brief The on/off button. @param e The event. */
static void led_toggle_cb(lv_event_t *e)
{
    (void)e;
    s_ao.led_on = !s_ao.led_on;
    led_apply(&s_ao);
    led_show(&s_ao);
}

/**
 * @brief The LED page: a lamp, six colours, a hue and a brightness.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_led(kit_t *kit, void *arg)
{
    LightAo * const  me   = (LightAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    int32_t const    gap  = (KIT_ROW_W - ((int32_t)LIGHT_SWATCHES * KUI_SWATCH)) / ((int32_t)LIGHT_SWATCHES - 1);
    lv_obj_t        *lv;

    kit_no_swipe(kit);
    me->lamp = kui_lamp_create(page, 84);
    lv_obj_align(me->lamp, LV_ALIGN_TOP_MID, 0, 74);
    for ( uint32_t i = 0U; i < LIGHT_SWATCHES; ++i )
    {
        lv_obj_t * const sw = kui_swatch_create(page, lv_color_make(s_colours[i].r, s_colours[i].g, s_colours[i].b));

        lv_obj_set_pos(sw, KIT_SIDE + ((int32_t)i * (KUI_SWATCH + gap)), 214);
        lv_obj_add_event_cb(sw, &led_swatch_cb, LV_EVENT_CLICKED, (void *)(uintptr_t)i);
        kit_focus_add(kit, sw);
        me->swatch[i] = sw;
    }
    (void)kit_text(page, "Colour", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 0, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 282);
    lv = kui_level_create(page, lv_color_make(me->led_r, me->led_g, me->led_b));
    lv_obj_set_pos(lv, KIT_SIDE, 322);
    lv_slider_set_value(lv, me->hue, LV_ANIM_OFF);
    lv_obj_add_event_cb(lv, &led_hue_cb, LV_EVENT_VALUE_CHANGED, me);
    lv_obj_add_event_cb(lv, &keep_cb, LV_EVENT_RELEASED, me);
    kit_focus_add(kit, lv);
    me->hue_lv = lv;
    (void)kit_text(page, "Brightness", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 0, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 346);
    lv = kui_level_create(page, KUI_COLOR_LEVEL);
    lv_obj_set_pos(lv, KIT_SIDE, 386);
    lv_slider_set_value(lv, me->led_pct, LV_ANIM_OFF);
    lv_obj_add_event_cb(lv, &led_bright_cb, LV_EVENT_VALUE_CHANGED, me);
    lv_obj_add_event_cb(lv, &keep_cb, LV_EVENT_RELEASED, me);
    kit_focus_add(kit, lv);
    me->led_btn = kit_button(kit, page, "Turn on", KIT_BTN_ACTION, KUI_ACTION_W, &led_toggle_cb, me);
    lv_obj_align(me->led_btn, LV_ALIGN_TOP_MID, 0, 414);
    kit_bar(kit, page, "LED");
    led_show(me);
}

/* ---- SOS ---- */

/** @brief Start or stop the SOS. @param e The event. */
static void sos_toggle_cb(lv_event_t *e)
{
    (void)e;
    if ( s_ao.sos_on )
    {
        sos_stop(&s_ao);
        kit_refresh(&s_ao.kit);
    }
    else
    {
        s_ao.sos_on    = true;
        s_ao.sos_idx   = 0U;
        (void)kode_sys_screen_brightness(KODE_SYS_SCREEN_BRIGHT_MAX);
        s_ao.panel_set = true;
        kit_refresh(&s_ao.kit);
        sos_step(&s_ao);
    }
}

/**
 * @brief The SOS page: what it does, and one button; running, the glass flashes and only the button stays.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_sos(kit_t *kit, void *arg)
{
    LightAo * const  me   = (LightAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;

    kit_no_swipe(kit);
    if ( me->sos_on )
    {
        btn = kit_button(kit, page, "Stop", KIT_BTN_DANGER, KUI_ACTION_W, &sos_toggle_cb, me);
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_LEVEL, &app_glyph_sos_96, "Signal for help",
                        "Flashes the screen and the LED: three short, three long, three short.");
        btn = kit_button(kit, page, "Start", KIT_BTN_ACTION, KUI_ACTION_W, &sos_toggle_cb, me);
        kit_bar(kit, page, "SOS");
    }
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, LIGHT_FOOT_Y);
}

/* ---- The Active Object ---- */

void LightAo_ctor(void)
{
    LightAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&LightAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)LIGHT_TICK_SIG);
    QTimeEvt_ctorX(&me->sos_t, &me->super, (enum_t)LIGHT_SOS_SIG, 0U);
    kit_store_init(&me->store, &me->super, LIGHT_DIR, LIGHT_FILE, s_file, sizeof(s_file), &prefs_pack, me);
    me->temp    = LIGHT_TEMP_DEFAULT;
    me->bright  = LIGHT_BRIGHT_DEFAULT;
    me->led_r   = s_colours[1].r;
    me->led_g   = s_colours[1].g;
    me->led_b   = s_colours[1].b;
    me->led_pct = LIGHT_LED_PCT_DEFAULT;
    me->hue     = LIGHT_HUE_DEFAULT;
}

void LightAo_start(void)
{
    /* A named task: an assert then names it instead of "AO". */
    QActive_setAttr(AO_Light, TASK_NAME_ATTR, "light_ao");
    /* The renderer's level, just above AO_Net: a slow frame can only delay this app. */
    QACTIVE_START(AO_Light, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe, ask for the panel and for the saved settings, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to LightAo_running.
 */
static QState LightAo_initial(LightAo * const me, void const * const par)
{
    (void)par;
    /* Subscribe first, then ask the owner for its state. */
    kit_start(&me->kit);
    kit_store_load(&me->store);
    KLOG_I(TAG, "up");
    return Q_TRAN(&LightAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState LightAo_running(LightAo * const me, QEvt const * const e)
{
    QState status = Q_HANDLED();

    switch ( e->sig )
    {
        case DISPLAY_STATE_SIG:
        {
            DisplayStateEvt const * const st = Q_EVT_CAST(DisplayStateEvt);

            if ( (!kit_is_open(&me->kit)) && (LIGHT_PCT_FLOOR <= st->bright) )
            {
                me->panel_pct = st->bright;
            }
            if ( kit_open_glass(&me->kit, st) && (0U == kit_depth(&me->kit)) )
            {
                kit_push(&me->kit, &page_home, me);
            }
            break;
        }
        case LIGHT_SOS_SIG:
        {
            if ( me->sos_on )
            {
                sos_step(me);
            }
            break;
        }
        default:
        {
            uint32_t           len = 0U;
            kit_store_result_t res;

            if ( !kit_on_event(&me->kit, e) )
            {
                res = kit_store_on_event(&me->store, e, &len);
                if ( KIT_STORE_LOADED == res )
                {
                    prefs_unpack(me, len);
                    kit_refresh(&me->kit);
                }
                else if ( KIT_STORE_NONE == res )
                {
                    status = Q_SUPER(&QHsm_top);
                }
                else
                {
                    /* Saved, empty or failed: nothing for the screen. */
                }
            }
            break;
        }
    }
    return status;
}
