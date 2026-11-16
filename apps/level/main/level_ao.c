/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file level_ao.c
 * @brief The Level app's Active Object: a bubble level and a tilt-compensated compass from the motion sensors.
 */
#include "level_ao.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "kit.h"
#include "kit_store.h"

#define TAG "level.ao"   /**< This file's log tag. */

#define LEVEL_DIR         "/storage/level"            /**< The app's folder on the internal volume. */
#define LEVEL_FILE        "/storage/level/zero.bin"   /**< What is kept: the zero of the level. */
#define LEVEL_MAGIC       0x3156454CUL                /**< "LEV1", the file's first four bytes. */
#define LEVEL_FILE_BYTES  16U                         /**< The size of the file. */
#define LEVEL_PERIOD_MS   70U                         /**< How often the sensors are asked. */
#define LEVEL_SMOOTH      0.4f                        /**< How much of a new sample is taken in. */
#define LEVEL_RAD_DEG     57.29578f                   /**< Degrees in a radian. */
#define LEVEL_CX          205                         /**< The dial's centre, x. */
#define LEVEL_LY          196                         /**< The level dial's centre, y. */
#define LEVEL_LR          108                         /**< The level dial's radius. */
#define LEVEL_BUBBLE      56                          /**< The bubble's diameter. */
#define LEVEL_FULL_DEG    12.0f                       /**< The tilt at which the bubble reaches the rim. */
#define LEVEL_FLAT_DEG    1.0f                        /**< Below this the surface counts as level. */
#define LEVEL_CY          230                         /**< The compass dial's centre, y. */
#define LEVEL_CR          128                         /**< The compass dial's radius. */
#define LEVEL_ORBIT       100                         /**< Where the letters ride. */
#define LEVEL_LETTER      50                          /**< A letter disc's diameter. */
#define LEVEL_FOOT_Y      402                         /**< Where a page's one button stands. */
#define LEVEL_STILL_LO    0.85f                       /**< Below this many g the Dot is not at rest. */
#define LEVEL_STILL_HI    1.15f                       /**< Above this many g it is not at rest. */

/** @brief This app's own signals. */
enum LevelSignals
{
    LEVEL_TICK_SIG = MAX_SIG,   /**< The render pass: kscreen's one-shot. */
    LEVEL_POLL_SIG              /**< Time to ask the sensors again. */
};

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive     super;          /**< The QP/C base; must stay first. */
    kit_t       kit;            /**< The screens. */
    kit_store_t store;          /**< The settings file. */
    QTimeEvt    poll;           /**< Times the sensors. */
    bool        polling;        /**< The poll timer is armed. */
    float       a[3];           /**< The smoothed acceleration, g. */
    float       m[3];           /**< The smoothed field, mG. */
    bool        have_a;         /**< An IMU sample has come. */
    bool        have_m;         /**< A magnetometer sample has come. */
    bool        imu_out;        /**< An IMU request is out. */
    bool        mag_out;        /**< A magnetometer request is out. */
    bool        imu_absent;     /**< The IMU is not fitted. */
    bool        mag_absent;     /**< The magnetometer is not fitted. */
    int16_t     zero_x;         /**< The level's zero on x, in thousandths of g. */
    int16_t     zero_y;         /**< The level's zero on y, in thousandths of g. */
    lv_obj_t   *bubble;         /**< The level page's bubble. */
    lv_obj_t   *num;            /**< The page's big number. */
    lv_obj_t   *note;           /**< The page's line under it. */
    lv_obj_t   *letter[4];      /**< The compass's N, E, S and W. */
} LevelAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static uint8_t     s_file[LEVEL_FILE_BYTES];                           /**< The settings file's lent buffer. */
static LevelAo     s_ao;                                               /**< The one instance. */

QActive * const AO_Level = &s_ao.super;

static QState LevelAo_initial(LevelAo * const me, void const * const par);
static QState LevelAo_running(LevelAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_level(kit_t *kit, void *arg);
static void   page_compass(kit_t *kit, void *arg);

/* ---- The saved file ---- */

/**
 * @brief Fill the file buffer from the settings.
 * @param ctx The Active Object.
 * @param buf The buffer.
 * @param cap Its size.
 * @return The bytes.
 */
static uint32_t level_pack(void *ctx, uint8_t *buf, uint32_t cap)
{
    LevelAo * const me    = (LevelAo *)ctx;
    uint32_t const  magic = LEVEL_MAGIC;

    if ( LEVEL_FILE_BYTES > cap )
    {
        return 0U;
    }
    (void)memset(buf, 0, LEVEL_FILE_BYTES);
    (void)memcpy(buf, &magic, sizeof(magic));
    (void)memcpy(&buf[4], &me->zero_x, sizeof(me->zero_x));
    (void)memcpy(&buf[6], &me->zero_y, sizeof(me->zero_y));
    return LEVEL_FILE_BYTES;
}

/**
 * @brief Read the settings back from the file buffer.
 * @param me  The Active Object.
 * @param len The bytes read.
 */
static void level_unpack(LevelAo *me, uint32_t len)
{
    uint32_t magic = 0U;

    (void)memcpy(&magic, s_file, sizeof(magic));
    if ( (LEVEL_FILE_BYTES <= len) && (LEVEL_MAGIC == magic) )
    {
        (void)memcpy(&me->zero_x, &s_file[4], sizeof(me->zero_x));
        (void)memcpy(&me->zero_y, &s_file[6], sizeof(me->zero_y));
    }
    else
    {
        KLOG_W(TAG, "the settings file is not ours; keeping the defaults");
    }
}

/* ---- Sampling ---- */

/**
 * @brief Start or stop asking the sensors.
 * @param me The Active Object.
 * @param on Ask.
 */
static void poll_set(LevelAo *me, bool on)
{
    if ( on && !me->polling )
    {
        QTimeEvt_armX(&me->poll, KQP_TICKS_PER_MS(LEVEL_PERIOD_MS), KQP_TICKS_PER_MS(LEVEL_PERIOD_MS));
        me->polling = true;
    }
    else if ( !on && me->polling )
    {
        (void)QTimeEvt_disarm(&me->poll);
        me->polling = false;
    }
    else
    {
        /* Already so. */
    }
}

/**
 * @brief Mix a new sample into a smoothed value.
 * @param old The smoothed value.
 * @param raw The new one.
 * @param first Take it whole.
 * @return The mix.
 */
static float mix(float old, float raw, bool first)
{
    return first ? raw : (old + ((raw - old) * LEVEL_SMOOTH));
}

/**
 * @brief The acceleration with the zero taken off, in g.
 * @param me The Active Object.
 * @param x  Receives x.
 * @param y  Receives y.
 */
static void accel_zeroed(LevelAo const *me, float *x, float *y)
{
    *x = me->a[0] - ((float)me->zero_x / 1000.0f);
    *y = me->a[1] - ((float)me->zero_y / 1000.0f);
}

/**
 * @brief The tilt of the glass from level, degrees.
 * @param me The Active Object.
 * @return 0 flat, up to 90.
 */
static float tilt_deg(LevelAo const *me)
{
    float x;
    float y;
    float s;

    accel_zeroed(me, &x, &y);
    s = sqrtf((x * x) + (y * y));
    if ( 1.0f < s )
    {
        s = 1.0f;
    }
    return asinf(s) * LEVEL_RAD_DEG;
}

/**
 * @brief The direction the top edge points, tilt-compensated: degrees clockwise from north.
 * @param me  The Active Object.
 * @param deg Receives it.
 * @return false when there is none: the Dot is moving or the field has no sideways part.
 */
static bool heading_deg(LevelAo const *me, float *deg)
{
    float const g   = sqrtf((me->a[0] * me->a[0]) + (me->a[1] * me->a[1]) + (me->a[2] * me->a[2]));
    float       u[3];
    float       e[3];
    float       n[3];
    float       h;

    if ( (LEVEL_STILL_LO > g) || (LEVEL_STILL_HI < g) )
    {
        return false;
    }
    for ( uint32_t i = 0U; i < 3U; ++i )
    {
        u[i] = me->a[i] / g;
    }
    /* East is the field crossed with up, north is up crossed with east: the top edge's bearing is the angle between them. */
    e[0] = (me->m[1] * u[2]) - (me->m[2] * u[1]);
    e[1] = (me->m[2] * u[0]) - (me->m[0] * u[2]);
    e[2] = (me->m[0] * u[1]) - (me->m[1] * u[0]);
    n[0] = (u[1] * e[2]) - (u[2] * e[1]);
    n[1] = (u[2] * e[0]) - (u[0] * e[2]);
    n[2] = (u[0] * e[1]) - (u[1] * e[0]);
    if ( 20.0f > sqrtf((e[0] * e[0]) + (e[1] * e[1]) + (e[2] * e[2])) )
    {
        return false;
    }
    h = atan2f(e[1], n[1]) * LEVEL_RAD_DEG;
    if ( 0.0f > h )
    {
        h += 360.0f;
    }
    *deg = h;
    return true;
}

/* ---- Drawing the live parts ---- */

/**
 * @brief Move the bubble and write the tilt.
 * @param me The Active Object.
 */
static void level_show(LevelAo *me)
{
    char        txt[24];
    float       x;
    float       y;
    float const t = tilt_deg(me);
    float       k;
    int32_t     dx;
    int32_t     dy;
    int32_t const reach = LEVEL_LR - (LEVEL_BUBBLE / 2) - 6;
    bool const  flat  = (LEVEL_FLAT_DEG > t);

    if ( (NULL == me->bubble) || (NULL == me->num) )
    {
        return;
    }
    accel_zeroed(me, &x, &y);
    k  = (float)reach / sinf(LEVEL_FULL_DEG / LEVEL_RAD_DEG);
    dx = (int32_t)(x * k);
    dy = (int32_t)(-y * k);
    {
        float const len = sqrtf((float)((dx * dx) + (dy * dy)));

        if ( (float)reach < len )
        {
            dx = (int32_t)((float)dx * (float)reach / len);
            dy = (int32_t)((float)dy * (float)reach / len);
        }
    }
    lv_obj_set_pos(me->bubble, LEVEL_CX - (LEVEL_BUBBLE / 2) + dx, LEVEL_LY - (LEVEL_BUBBLE / 2) + dy);
    lv_obj_set_style_bg_color(me->bubble, flat ? KUI_COLOR_OK : KUI_COLOR_ACCENT, 0);
    (void)snprintf(txt, sizeof(txt), "%d.%d", (int)t, ((int)(t * 10.0f)) % 10);
    lv_label_set_text(me->num, txt);
    if ( NULL != me->note )
    {
        lv_label_set_text(me->note, flat ? "Level" : "Tilted");
        lv_obj_set_style_text_color(me->note, flat ? KUI_COLOR_OK : KUI_COLOR_TEXT_MUTED, 0);
    }
}

/**
 * @brief The words for a bearing.
 * @param deg The bearing.
 * @return N, NE, E ...
 */
static const char *cardinal(float deg)
{
    static const char *const names[8] = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" };
    uint32_t                 i        = (uint32_t)((deg + 22.5f) / 45.0f);

    return names[i % 8U];
}

/**
 * @brief Turn the compass: the letters ride round the dial, the number says where the top points.
 * @param me The Active Object.
 */
static void compass_show(LevelAo *me)
{
    float h = 0.0f;

    if ( (NULL == me->num) || (NULL == me->note) )
    {
        return;
    }
    if ( me->imu_absent || me->mag_absent )
    {
        lv_label_set_text(me->num, "--");
        lv_label_set_text(me->note, me->imu_absent ? "No motion sensor" : "No compass fitted");
        return;
    }
    if ( !(me->have_a && me->have_m) )
    {
        lv_label_set_text(me->num, "--");
        lv_label_set_text(me->note, "Reading the sensors");
        return;
    }
    if ( heading_deg(me, &h) )
    {
        char txt[16];

        (void)snprintf(txt, sizeof(txt), "%d", (int)(h + 0.5f) % 360);
        lv_label_set_text(me->num, txt);
        lv_label_set_text(me->note, cardinal(h));
        for ( uint32_t i = 0U; i < 4U; ++i )
        {
            float const a = (((float)i * 90.0f) - h) / LEVEL_RAD_DEG;

            lv_obj_set_pos(me->letter[i], LEVEL_CX - (LEVEL_LETTER / 2) + (int32_t)((float)LEVEL_ORBIT * sinf(a)),
                           LEVEL_CY - (LEVEL_LETTER / 2) - (int32_t)((float)LEVEL_ORBIT * cosf(a)));
        }
    }
    else
    {
        lv_label_set_text(me->note, "Hold it still and flat");
    }
}

/**
 * @brief Redraw whichever live page is on the glass.
 * @param me The Active Object.
 */
static void live_show(LevelAo *me)
{
    if ( page_level == kit_current(&me->kit) )
    {
        level_show(me);
    }
    else if ( page_compass == kit_current(&me->kit) )
    {
        compass_show(me);
    }
    else
    {
        /* Not a live page. */
    }
}

/**
 * @brief The poll timer fired: ask for what the page on the glass needs.
 * @param me The Active Object.
 */
static void poll_tick(LevelAo *me)
{
    bool const comp = (page_compass == kit_current(&me->kit));

    if ( (page_level != kit_current(&me->kit)) && !comp )
    {
        poll_set(me, false);
        return;
    }
    if ( !me->imu_out && !me->imu_absent )
    {
        me->imu_out = (KODE_OK == kode_sys_imu_read(&me->super));
    }
    if ( comp && !me->mag_out && !me->mag_absent )
    {
        me->mag_out = (KODE_OK == kode_sys_mag_read(&me->super));
    }
}

/**
 * @brief An IMU sample came.
 * @param me  The Active Object.
 * @param ans The answer.
 */
static void imu_answer(LevelAo *me, ImuSampleRspEvt const *ans)
{
    me->imu_out = false;
    if ( KODE_OK == ans->rc )
    {
        for ( uint32_t i = 0U; i < 3U; ++i )
        {
            me->a[i] = mix(me->a[i], (float)ans->sample.a_mg[i] / 1000.0f, !me->have_a);
        }
        me->have_a = true;
    }
    else if ( KODE_IO_ERROR == ans->rc )
    {
        me->imu_absent = true;
    }
    else
    {
        /* Busy or not ready: the next tick asks again. */
    }
    live_show(me);
}

/**
 * @brief A magnetometer sample came.
 * @param me  The Active Object.
 * @param ans The answer.
 */
static void mag_answer(LevelAo *me, MagSampleRspEvt const *ans)
{
    me->mag_out = false;
    if ( KODE_OK == ans->rc )
    {
        for ( uint32_t i = 0U; i < 3U; ++i )
        {
            me->m[i] = mix(me->m[i], (float)ans->mg[i], !me->have_m);
        }
        me->have_m = true;
    }
    else if ( KODE_IO_ERROR == ans->rc )
    {
        me->mag_absent = true;
    }
    else
    {
        /* No conversion ready: the next tick asks again. */
    }
    live_show(me);
}

/* ---- Pages ---- */

/** @brief A tap on Level. @param e The event. */
static void home_level_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_level, &s_ao);
}

/** @brief A tap on Compass. @param e The event. */
static void home_compass_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_compass, &s_ao);
}

/**
 * @brief The first page: the two instruments.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    LevelAo * const  me   = (LevelAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Level");

    poll_set(me, false);
    me->bubble = NULL;
    me->num    = NULL;
    me->note   = NULL;
    (void)kit_row(kit, body, "Bubble level", "How flat is it", &app_glyph_level_40, NULL, KUI_COLOR_OK,
                  &home_level_cb, me);
    (void)kit_row(kit, body, "Compass", "Which way is the top", &app_glyph_compass_40, NULL, KUI_COLOR_ACCENT,
                  &home_compass_cb, me);
}

/**
 * @brief A round plate.
 * @param page The page.
 * @param cy   Centre, y.
 * @param r    Radius.
 * @return The plate.
 */
static lv_obj_t *plate(lv_obj_t *page, int32_t cy, int32_t r)
{
    lv_obj_t * const p = kit_disc(page, 2 * r, KUI_COLOR_SURFACE, NULL);

    lv_obj_set_pos(p, LEVEL_CX - r, cy - r);
    return p;
}

/** @brief Set the zero to where the Dot lies now. @param e The event. */
static void level_zero_cb(lv_event_t *e)
{
    LevelAo * const me = &s_ao;

    (void)e;
    if ( me->have_a )
    {
        me->zero_x = (int16_t)(me->a[0] * 1000.0f);
        me->zero_y = (int16_t)(me->a[1] * 1000.0f);
        kit_store_save(&me->store);
        kit_refresh(&me->kit);
    }
}

/** @brief Take the zero away again. @param e The event. */
static void level_unzero_cb(lv_event_t *e)
{
    LevelAo * const me = &s_ao;

    (void)e;
    me->zero_x = 0;
    me->zero_y = 0;
    kit_store_save(&me->store);
    kit_refresh(&me->kit);
}

/**
 * @brief The bubble level: a dial, a bubble that rides to the high side, and the tilt in degrees.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_level(kit_t *kit, void *arg)
{
    LevelAo * const  me   = (LevelAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *o;

    kit_no_swipe(kit);
    (void)plate(page, LEVEL_LY, LEVEL_LR);
    o = kit_disc(page, LEVEL_BUBBLE + 14, lv_color_black(), NULL);
    lv_obj_set_pos(o, LEVEL_CX - ((LEVEL_BUBBLE + 14) / 2), LEVEL_LY - ((LEVEL_BUBBLE + 14) / 2));
    o = kit_disc(page, LEVEL_BUBBLE + 6, KUI_COLOR_SURFACE, NULL);
    lv_obj_set_pos(o, LEVEL_CX - ((LEVEL_BUBBLE + 6) / 2), LEVEL_LY - ((LEVEL_BUBBLE + 6) / 2));
    me->bubble = kit_disc(page, LEVEL_BUBBLE, KUI_COLOR_ACCENT, NULL);
    lv_obj_set_pos(me->bubble, LEVEL_CX - (LEVEL_BUBBLE / 2), LEVEL_LY - (LEVEL_BUBBLE / 2));
    me->num = kit_text(page, "--", &kui_font_title_60, KUI_COLOR_TEXT_ON_BG, 200, true);
    lv_obj_set_pos(me->num, LEVEL_CX - 100, 312);
    me->note = kit_text(page, "Reading the sensors", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 300, true);
    lv_obj_set_pos(me->note, LEVEL_CX - 150, 374);
    if ( (0 != me->zero_x) || (0 != me->zero_y) )
    {
        o = kit_button(kit, page, "Clear zero", KIT_BTN_QUIET, KUI_ACTION_W, &level_unzero_cb, me);
    }
    else
    {
        o = kit_button(kit, page, "Set zero", KIT_BTN_ACTION, KUI_ACTION_W, &level_zero_cb, me);
    }
    lv_obj_align(o, LV_ALIGN_TOP_MID, 0, LEVEL_FOOT_Y);
    kit_bar(kit, page, "Bubble level");
    if ( me->imu_absent )
    {
        lv_label_set_text(me->note, "No motion sensor");
    }
    else if ( me->have_a )
    {
        level_show(me);
    }
    else
    {
        /* The first sample will draw it. */
    }
    poll_set(me, true);
}

/**
 * @brief The compass: letters riding a dial, the bearing of the top edge in the middle.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_compass(kit_t *kit, void *arg)
{
    LevelAo * const  me   = (LevelAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *o;
    static const char *const names[4] = { "N", "E", "S", "W" };

    kit_no_swipe(kit);
    (void)plate(page, LEVEL_CY, LEVEL_CR);
    o = kit_disc(page, 16, KUI_COLOR_ACTION, NULL);
    lv_obj_set_pos(o, LEVEL_CX - 8, LEVEL_CY - LEVEL_CR - 22);
    for ( uint32_t i = 0U; i < 4U; ++i )
    {
        lv_obj_t *t;

        o = kit_disc(page, LEVEL_LETTER, (0U == i) ? KUI_COLOR_DANGER : KUI_COLOR_TEXT_MUTED, NULL);
        lv_obj_set_pos(o, LEVEL_CX - (LEVEL_LETTER / 2), LEVEL_CY - (LEVEL_LETTER / 2) - LEVEL_ORBIT);
        t = lv_label_create(o);
        lv_label_set_text(t, names[i]);
        lv_obj_set_style_text_font(t, &kui_font_name, 0);
        lv_obj_set_style_text_color(t, (0U == i) ? KUI_COLOR_TEXT_ON_BG : KUI_COLOR_TEXT, 0);
        lv_obj_center(t);
        me->letter[i] = o;
    }
    me->num = kit_text(page, "--", &kui_font_title_60, KUI_COLOR_TEXT_ON_BG, 160, true);
    lv_obj_set_pos(me->num, LEVEL_CX - 80, LEVEL_CY - 36);
    me->note = kit_text(page, "Reading the sensors", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 320, true);
    lv_obj_set_pos(me->note, LEVEL_CX - 160, LEVEL_CY + 30);
    me->bubble = NULL;
    kit_bar(kit, page, "Compass");
    (void)kit_text(page, "Keep it away from magnets", &kui_font_caption, KUI_COLOR_TEXT_MUTED, 340, true);
    lv_obj_set_pos(lv_obj_get_child(page, -1), LEVEL_CX - 170, 398);
    compass_show(me);
    poll_set(me, true);
}

/* ---- The Active Object ---- */

void LevelAo_ctor(void)
{
    LevelAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&LevelAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)LEVEL_TICK_SIG);
    QTimeEvt_ctorX(&me->poll, &me->super, (enum_t)LEVEL_POLL_SIG, 0U);
    kit_store_init(&me->store, &me->super, LEVEL_DIR, LEVEL_FILE, s_file, sizeof(s_file), &level_pack, me);
}

void LevelAo_start(void)
{
    QActive_setAttr(AO_Level, TASK_NAME_ATTR, "level_ao");
    QACTIVE_START(AO_Level, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe, ask for the panel and the settings, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to LevelAo_running.
 */
static QState LevelAo_initial(LevelAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    kit_store_load(&me->store);
    KLOG_I(TAG, "up");
    return Q_TRAN(&LevelAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState LevelAo_running(LevelAo * const me, QEvt const * const e)
{
    QState status = Q_HANDLED();

    switch ( e->sig )
    {
        case DISPLAY_STATE_SIG:
        {
            if ( kit_open_glass(&me->kit, Q_EVT_CAST(DisplayStateEvt)) && (0U == kit_depth(&me->kit)) )
            {
                kit_push(&me->kit, &page_home, me);
            }
            break;
        }
        case LEVEL_POLL_SIG:
        {
            poll_tick(me);
            break;
        }
        case IMU_SAMPLE_RSP_SIG:
        {
            imu_answer(me, Q_EVT_CAST(ImuSampleRspEvt));
            break;
        }
        case MAG_SAMPLE_RSP_SIG:
        {
            mag_answer(me, Q_EVT_CAST(MagSampleRspEvt));
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
                    level_unpack(me, len);
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
