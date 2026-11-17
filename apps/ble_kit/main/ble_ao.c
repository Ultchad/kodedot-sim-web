/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file ble_ao.c
 * @brief The Bluetooth app's Active Object: listen for devices nearby, list them with their strength, and look at one.
 */
#include "ble_ao.h"

#include <stdio.h>
#include <string.h>

#include "ble_job.h"
#include "glyphs.h"
#include "kit.h"
#include "kode_worker.h"

#define TAG "ble.ao"   /**< This file's log tag. */

#define BLE_FOOT_Y      402                      /**< Where a page's buttons stand. */
#define BLE_WORKER_STACK 8192U                   /**< The worker's stack, bytes (in PSRAM). */
#define BLE_WORKER_DEPTH 1U                      /**< Jobs that may wait besides the one running. */
#define BLE_BAR_W       6                        /**< One signal bar's width. */
#define BLE_BAR_STEP    10                       /**< From one signal bar to the next. */
#define BLE_BAR_X       304                      /**< Where a row's bars start. */
#define BLE_NAME_W      214                      /**< A row's text width, clear of the bars. */
#define BLE_RSSI_STRONG (-60)                    /**< At or above: four bars. */
#define BLE_RSSI_GOOD   (-70)                    /**< At or above: three bars. */
#define BLE_RSSI_FAIR   (-80)                    /**< At or above: two bars. */

/** @brief This app's own signals. */
enum BleKitSignals
{
    BLEKIT_TICK_SIG = MAX_SIG,   /**< The render pass: kscreen's one-shot. */
    BLEKIT_DONE_SIG              /**< The worker's listen ended. */
};

/** @brief What the Nearby page is showing. */
typedef enum {
    BLE_S_IDLE = 0,    /**< Nothing asked yet. */
    BLE_S_LISTENING,   /**< A listen runs. */
    BLE_S_DONE,        /**< The list is in. */
    BLE_S_EMPTY,       /**< The listen ended with nothing. */
    BLE_S_BUSY,        /**< The radio is on something else. */
    BLE_S_OFF,         /**< Bluetooth is off in Settings. */
    BLE_S_NOPE         /**< The Dot cannot use Bluetooth. */
} ble_scan_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive        super;       /**< The QP/C base; must stay first. */
    kit_t          kit;         /**< The screens. */
    kode_worker_t  worker;      /**< Runs the listen. */
    ble_job_t      job;         /**< The listen's answer. */
    bool           busy;        /**< A listen is out. */
    uint16_t       seq;         /**< Its sequence number. */
    ble_scan_t     scan;        /**< The Nearby page's state. */
    uint8_t        sel;         /**< The device a page is about. */
} BleKitAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static BleKitAo    s_ao;                                               /**< The one instance. */

QActive * const AO_BleKit = &s_ao.super;

static QState BleKitAo_initial(BleKitAo * const me, void const * const par);
static QState BleKitAo_running(BleKitAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_scan(kit_t *kit, void *arg);
static void   page_dev(kit_t *kit, void *arg);

/* ---- Words and drawing ---- */

/**
 * @brief How many of four bars a strength lights.
 * @param rssi dBm.
 * @return 1 to 4.
 */
static uint8_t bars_of(int8_t rssi)
{
    uint8_t n = 1U;

    if ( BLE_RSSI_STRONG <= rssi )
    {
        n = 4U;
    }
    else if ( BLE_RSSI_GOOD <= rssi )
    {
        n = 3U;
    }
    else if ( BLE_RSSI_FAIR <= rssi )
    {
        n = 2U;
    }
    else
    {
        /* Weak: one bar. */
    }
    return n;
}

/**
 * @brief A strength in a word.
 * @param rssi dBm.
 * @return The word.
 */
static const char *strength_word(int8_t rssi)
{
    const char *s = "Weak";

    if ( BLE_RSSI_STRONG <= rssi )
    {
        s = "Strong";
    }
    else if ( BLE_RSSI_GOOD <= rssi )
    {
        s = "Good";
    }
    else if ( BLE_RSSI_FAIR <= rssi )
    {
        s = "Fair";
    }
    else
    {
        /* Weak. */
    }
    return s;
}

/**
 * @brief The name a row shows for a device.
 * @param d The device.
 * @return Its name, or "Unnamed".
 */
static const char *dev_title(ble_dev_t const *d)
{
    const char *s = d->name;

    if ( '\0' == d->name[0] )
    {
        s = "Unnamed";
    }
    return s;
}

/**
 * @brief Four signal bars, some lit.
 * @param parent Where they go.
 * @param lit    How many are lit.
 * @param x      The first bar's left edge.
 * @param bottom Their common foot.
 */
static void draw_bars(lv_obj_t *parent, uint8_t lit, int32_t x, int32_t bottom)
{
    for ( uint8_t i = 0U; i < 4U; ++i )
    {
        lv_obj_t * const b = lv_obj_create(parent);
        int32_t const    h = 8 + ((int32_t)i * 6);

        lv_obj_remove_style_all(b);
        lv_obj_set_size(b, BLE_BAR_W, h);
        lv_obj_set_pos(b, x + ((int32_t)i * BLE_BAR_STEP), bottom - h);
        lv_obj_set_style_radius(b, BLE_BAR_W / 2, 0);
        lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
        if ( i < lit )
        {
            lv_obj_set_style_bg_color(b, KUI_COLOR_TEXT_ON_BG, 0);
        }
        else
        {
            lv_obj_set_style_bg_color(b, KUI_COLOR_REST, 0);
        }
        lv_obj_remove_flag(b, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(b, LV_OBJ_FLAG_SCROLLABLE);
    }
}

/**
 * @brief The one button at the foot of a page.
 * @param kit  The kit.
 * @param page The page.
 * @param word Its word.
 * @param kind Its kind.
 * @param cb   Its callback.
 */
static void foot_one(kit_t *kit, lv_obj_t *page, char const *word, kit_btn_kind_t kind, lv_event_cb_t cb)
{
    lv_obj_t * const b = kit_button(kit, page, word, kind, KUI_ACTION_W, cb, &s_ao);

    lv_obj_align(b, LV_ALIGN_TOP_MID, 0, BLE_FOOT_Y);
}

/* ---- The listen ---- */

/**
 * @brief Start a listen, once: while one is out the page just waits for it.
 * @param me The Active Object.
 */
static void scan_start(BleKitAo *me)
{
    kode_status_t rc;

    if ( me->busy )
    {
        return;
    }
    rc = kode_worker_submit(&me->worker, &ble_run, &me->job, (enum_t)BLEKIT_DONE_SIG, &me->seq);
    if ( KODE_OK == rc )
    {
        me->busy = true;
        me->scan = BLE_S_LISTENING;
        KLOG_I(TAG, "listening for %u ms", (unsigned)BLE_LISTEN_MS);
    }
    else
    {
        me->scan = BLE_S_NOPE;
        KLOG_E(TAG, "the worker would not take the listen (status %d)", (int)rc);
    }
}

/**
 * @brief The worker came back: take the answer in and redraw.
 * @param me The Active Object.
 * @param d  The done event.
 */
static void scan_done(BleKitAo *me, kode_worker_done_t const *d)
{
    kit_build_fn_t const cur = kit_current(&me->kit);

    if ( d->seq != me->seq )
    {
        return;
    }
    me->busy = false;
    switch ( me->job.fail )
    {
        case BLE_FAIL_OFF:
        {
            me->scan = BLE_S_OFF;
            break;
        }
        case BLE_FAIL_BUSY:
        {
            me->scan = BLE_S_BUSY;
            break;
        }
        case BLE_FAIL_NOPE:
        {
            me->scan = BLE_S_NOPE;
            break;
        }
        case BLE_FAIL_NONE:
        default:
        {
            if ( 0U < me->job.n )
            {
                me->scan = BLE_S_DONE;
            }
            else
            {
                me->scan = BLE_S_EMPTY;
            }
            break;
        }
    }
    KLOG_I(TAG, "listen ended: %u devices, fail %d: %s", (unsigned)me->job.n, (int)me->job.fail, me->job.err);
    if ( (page_home == cur) || (page_scan == cur) )
    {
        kit_refresh(&me->kit);
    }
}

/* ---- Home ---- */

/** @brief A tap on Nearby. @param e The event. */
static void home_nearby_cb(lv_event_t *e)
{
    BleKitAo * const me = &s_ao;

    (void)e;
    if ( (BLE_S_LISTENING != me->scan) && (BLE_S_DONE != me->scan) )
    {
        scan_start(me);
    }
    kit_push(&me->kit, &page_scan, me);
}

/**
 * @brief The first page: Nearby.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    BleKitAo * const me   = (BleKitAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Bluetooth");
    char             sub[32];

    switch ( me->scan )
    {
        case BLE_S_DONE:
        {
            if ( 1U == me->job.n )
            {
                (void)snprintf(sub, sizeof(sub), "1 device heard");
            }
            else
            {
                (void)snprintf(sub, sizeof(sub), "%u devices heard", (unsigned)me->job.n);
            }
            break;
        }
        case BLE_S_LISTENING:
        {
            (void)snprintf(sub, sizeof(sub), "Listening");
            break;
        }
        case BLE_S_OFF:
        {
            (void)snprintf(sub, sizeof(sub), "Bluetooth is off");
            break;
        }
        case BLE_S_NOPE:
        {
            (void)snprintf(sub, sizeof(sub), "Not available");
            break;
        }
        case BLE_S_EMPTY:
        {
            (void)snprintf(sub, sizeof(sub), "Nothing heard");
            break;
        }
        case BLE_S_BUSY:
        case BLE_S_IDLE:
        default:
        {
            (void)snprintf(sub, sizeof(sub), "Listen for devices");
            break;
        }
    }
    (void)kit_row(kit, body, "Nearby", sub, &app_glyph_ble_40, NULL, KUI_COLOR_ACTION, &home_nearby_cb, me);
}

/* ---- Nearby ---- */

/** @brief A tap on a device. @param e The event. */
static void scan_pick_cb(lv_event_t *e)
{
    s_ao.sel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    kit_push(&s_ao.kit, &page_dev, &s_ao);
}

/** @brief A tap on Scan again or Try again. @param e The event. */
static void scan_again_cb(lv_event_t *e)
{
    (void)e;
    scan_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/** @brief A tap on Scan again on a device's page: back to the list, listening again. @param e The event. */
static void dev_again_cb(lv_event_t *e)
{
    (void)e;
    scan_start(&s_ao);
    (void)kit_back(&s_ao.kit);
}

/** @brief A tap on Cancel or Back. @param e The event. */
static void scan_back_cb(lv_event_t *e)
{
    (void)e;
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief One device as a row.
 * @param kit  The kit.
 * @param body The column.
 * @param me   The Active Object.
 * @param i    Its index.
 */
static void dev_row(kit_t *kit, lv_obj_t *body, BleKitAo *me, uint32_t i)
{
    ble_dev_t const * const d   = &me->job.dev[i];
    lv_obj_t * const        row = kit_row(kit, body, dev_title(d), d->addr, &app_glyph_ble_40, NULL, KUI_COLOR_ACCENT,
                                          &scan_pick_cb, (void *)(uintptr_t)i);

    lv_obj_set_width(lv_obj_find_by_name(row, "name"), BLE_NAME_W);
    lv_obj_set_width(lv_obj_find_by_name(row, "sub"), BLE_NAME_W);
    draw_bars(row, bars_of(d->rssi), BLE_BAR_X, 54);
}

/**
 * @brief The Nearby page: waiting, the list, or why there is none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_scan(kit_t *kit, void *arg)
{
    BleKitAo * const me = (BleKitAo *)arg;
    lv_obj_t         *page;

    if ( BLE_S_DONE == me->scan )
    {
        lv_obj_t * const body = kit_page(kit, "Nearby");

        for ( uint32_t i = 0U; i < me->job.n; ++i )
        {
            dev_row(kit, body, me, i);
        }
        (void)kit_row(kit, body, "Scan again", "Listen once more", &app_glyph_refresh_40, NULL, KUI_COLOR_ACTION,
                      &scan_again_cb, me);
        return;
    }
    page = kit_page_bare(kit);
    kit_no_swipe(kit);
    switch ( me->scan )
    {
        case BLE_S_EMPTY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_ble_96, "No devices found",
                            "Nothing nearby is advertising");
            foot_one(kit, page, "Scan again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case BLE_S_BUSY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_ble_96, "Radio is busy",
                            "Something else is using it. Try again in a moment");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case BLE_S_OFF:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_ble_96, "Bluetooth is off",
                            "Switch it on in Settings");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case BLE_S_NOPE:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_ble_96, "Bluetooth is not available",
                            "This Dot cannot use Bluetooth right now");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case BLE_S_LISTENING:
        case BLE_S_IDLE:
        case BLE_S_DONE:
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_ble_96, "Listening", "It takes about five seconds");
            foot_one(kit, page, "Cancel", KIT_BTN_QUIET, &scan_back_cb);
            break;
        }
    }
    kit_bar(kit, page, "Nearby");
}

/* ---- One device ---- */

/**
 * @brief A caption and its value.
 * @param page    The page.
 * @param y       Where it stands.
 * @param caption The muted line.
 * @param value   The bold line.
 */
static void detail(lv_obj_t *page, int32_t y, char const *caption, char const *value)
{
    lv_obj_t *l;

    l = kit_text(page, caption, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(l, KIT_SIDE, y);
    l = kit_text(page, value, &kui_font_name, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W - 50, false);
    lv_obj_set_pos(l, KIT_SIDE, y + 26);
}

/**
 * @brief A device: what is known of it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_dev(kit_t *kit, void *arg)
{
    BleKitAo * const  me = (BleKitAo *)arg;
    lv_obj_t         *page;
    ble_dev_t const  *d;
    char              line[48];

    if ( me->sel >= me->job.n )
    {
        (void)kit_back(kit);
        return;
    }
    d    = &me->job.dev[me->sel];
    page = kit_page_bare(kit);
    detail(page, 74, "Name", dev_title(d));
    detail(page, 148, "Address", d->addr);
    (void)snprintf(line, sizeof(line), "%s, %d dBm", strength_word(d->rssi), (int)d->rssi);
    detail(page, 222, "Signal", line);
    draw_bars(page, bars_of(d->rssi), 330, 262);
    foot_one(kit, page, "Scan again", KIT_BTN_ACTION, &dev_again_cb);
    kit_bar(kit, page, dev_title(d));
}

/* ---- The Active Object ---- */

void BleKitAo_ctor(void)
{
    BleKitAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&BleKitAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)BLEKIT_TICK_SIG);
}

void BleKitAo_start(void)
{
    QActive_setAttr(AO_BleKit, TASK_NAME_ATTR, "ble_kit_ao");
    QACTIVE_START(AO_BleKit, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: bring the worker up, ask for the panel, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to BleKitAo_running.
 */
static QState BleKitAo_initial(BleKitAo * const me, void const * const par)
{
    kode_status_t const rc = kode_worker_start(&me->worker, &me->super, "ble_kit_wk", BLE_WORKER_STACK,
                                               KODE_PRIO_USER_LOW, BLE_WORKER_DEPTH);

    (void)par;
    if ( KODE_OK != rc )
    {
        KLOG_E(TAG, "the worker did not start (status %d)", (int)rc);
    }
    kit_start(&me->kit);
    KLOG_I(TAG, "up");
    return Q_TRAN(&BleKitAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState BleKitAo_running(BleKitAo * const me, QEvt const * const e)
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
        case BLEKIT_DONE_SIG:
        {
            scan_done(me, Q_EVT_CAST(kode_worker_done_t));
            break;
        }
        default:
        {
            if ( !kit_on_event(&me->kit, e) )
            {
                status = Q_SUPER(&QHsm_top);
            }
            break;
        }
    }
    return status;
}
