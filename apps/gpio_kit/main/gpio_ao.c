/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file gpio_ao.c
 * @brief The GPIO app's Active Object: the expansion header J3 as pins to read and drive, PWM, an I2C scan and a UART monitor.
 */
#include "gpio_ao.h"

#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "gpio_job.h"
#include "kit.h"
#include "kode_worker.h"

#define TAG "gpio.ao"   /**< This file's log tag. */

#define GP_PERIOD_MS    100U     /**< How often a live page is asked again. */
#define GP_FOOT_Y       402      /**< Where a page's buttons stand. */
#define GP_HALF_W       165      /**< One of two buttons side by side. */
#define GP_THIRD_W      104      /**< One of three buttons side by side. */
#define GP_UART_TEXT    480U     /**< The characters of the monitor's text. */
#define GP_UART_SHOWN   220U     /**< The last ones that are drawn. */
#define GP_PWM_STEPS    11U      /**< The frequencies the stepper offers. */
#define GP_DUTY_STEP    10U      /**< The duty's step, percent. */
#define GP_BTN_STEP_W   72       /**< A stepper's small button. */
#define GP_WORKER_STACK 8192U    /**< The worker's stack, bytes (in PSRAM). */
#define GP_WORKER_DEPTH 1U       /**< Jobs that may wait besides the one running. */

/** @brief This app's own signals. */
enum GpioKitSignals
{
    GPIOKIT_TICK_SIG = MAX_SIG,   /**< The render pass: kscreen's one-shot. */
    GPIOKIT_POLL_SIG,             /**< Time to ask a live page again. */
    GPIOKIT_DONE_SIG              /**< The worker finished a job. */
};

/** @brief What the app last did with a pin. */
typedef enum {
    GP_PIN_FREE = 0,   /**< Not touched. */
    GP_PIN_IN,         /**< Read as an input. */
    GP_PIN_LOW,        /**< Driven low. */
    GP_PIN_HIGH,       /**< Driven high. */
    GP_PIN_PWM,        /**< Running PWM. */
    GP_PIN_ANALOG      /**< Read as an analog input. */
} gp_pin_t;

/** @brief What the I2C page is showing. */
typedef enum {
    GP_I2C_IDLE = 0,   /**< Nothing asked. */
    GP_I2C_SCANNING,   /**< The scan runs. */
    GP_I2C_DONE,       /**< It ended with a list. */
    GP_I2C_NONE,       /**< It ended with nobody there. */
    GP_I2C_FAIL        /**< The bus could not be used. */
} gp_i2c_t;

/** @brief Whether a live page has its first answer. */
typedef enum {
    GP_LIVE_WAIT = 0,   /**< Not yet. */
    GP_LIVE_OK,         /**< Reading. */
    GP_LIVE_FAIL        /**< Refused. */
} gp_live_t;

/** @brief The UART's state. */
typedef enum {
    GP_UART_CLOSED = 0,   /**< Not begun. */
    GP_UART_OPENING,      /**< begin is out. */
    GP_UART_UP,           /**< Listening. */
    GP_UART_FAIL          /**< begin was refused. */
} gp_uart_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive         super;                       /**< The QP/C base; must stay first. */
    kit_t           kit;                         /**< The screens. */
    QTimeEvt        poll;                        /**< Times the live pages. */
    bool            polling;                     /**< The poll timer is armed. */
    kode_worker_t   worker;                      /**< Runs the blocking kode.h calls. */
    gp_job_t        job;                         /**< The job in flight. */
    bool            busy;                        /**< A job is out. */
    uint16_t        seq;                         /**< Its sequence number. */
    bool            queued;                      /**< A request waits for the job in flight. */
    gp_req_t        later;                       /**< That request. */
    gp_pin_t        pin[GP_PIN_LAST + 1U];     /**< What each pin was last made. */
    uint8_t         sel;                         /**< The pin a page is about. */
    bool            level;                       /**< The last level read or driven. */
    uint32_t        mv;                          /**< The last analog reading. */
    gp_live_t       live;                        /**< The input or analog page's state. */
    char            err[GP_ERR_MAX];             /**< Why the last call was refused, empty when it was not. */
    uint8_t         hz_i;                        /**< The frequency's step. */
    uint8_t         duty;                        /**< The duty, percent. */
    gp_i2c_t        i2c;                         /**< The I2C page's state. */
    uint8_t         found[GP_I2C_MAX];           /**< The addresses that answered. */
    uint8_t         nfound;                      /**< How many. */
    gp_uart_t       uart;                        /**< The UART's state. */
    uint8_t         baud_i;                      /**< The baud's step. */
    char            rx[GP_UART_TEXT + 1U];       /**< What came in, printable. */
    uint32_t        rx_count;                    /**< Bytes received since the page opened. */
    uint32_t        tx_count;                    /**< Bytes sent. */
    bool            v33;                         /**< J3's 3.3 V is on (as the app switched it). */
    bool            v33_wait;                    /**< A switch of the 3.3 V is out; EXP_POWER_SIG ends it. */
    char            perr[GP_ERR_MAX];            /**< Why the supply would not switch, empty when it did. */
} GpioKitAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static GpioKitAo   s_ao;                                               /**< The one instance. */

QActive * const AO_GpioKit = &s_ao.super;

static const uint32_t s_hz[GP_PWM_STEPS] = { 1U, 10U, 50U, 100U, 500U, 1000U, 2000U, 5000U, 10000U, 20000U, 40000U };   /**< The frequencies offered. */
static const uint32_t s_baud[] = { 9600U, 19200U, 38400U, 57600U, 115200U };   /**< The baud rates offered. */

static QState GpioKitAo_initial(GpioKitAo * const me, void const * const par);
static QState GpioKitAo_running(GpioKitAo * const me, QEvt const * const e);
static void   job_ask(GpioKitAo *me, gp_op_t op, uint8_t pin, bool level, uint32_t hz, uint8_t duty);
static void page_home(kit_t *kit, void *arg);
static void page_pins(kit_t *kit, void *arg);
static void page_pin(kit_t *kit, void *arg);
static void page_input(kit_t *kit, void *arg);
static void page_output(kit_t *kit, void *arg);
static void page_pwm(kit_t *kit, void *arg);
static void page_analog(kit_t *kit, void *arg);
static void page_i2c(kit_t *kit, void *arg);
static void page_uart(kit_t *kit, void *arg);
static void page_power(kit_t *kit, void *arg);

/* ---- Facts about the header ---- */

/**
 * @brief Whether a pin has an analog input.
 * @param pin The pin.
 * @return true for 8 to 12 and 14.
 */
static bool has_adc(uint8_t pin)
{
    return ((pin >= 8U) && (pin <= 12U)) || (14U == pin);
}

/**
 * @brief What a pin can do, in two words.
 * @param pin The pin.
 * @return The words.
 */
static const char *pin_caps(uint8_t pin)
{
    const char *s = "Digital";

    if ( has_adc(pin) )
    {
        s = "Digital, analog";
    }
    else if ( (pin <= 7U) || (13U == pin) )
    {
        s = "Digital, works asleep";
    }
    else
    {
        /* Plain digital. */
    }
    return s;
}

/**
 * @brief What the app last made a pin, for its row.
 * @param me   The Active Object.
 * @param pin  The pin.
 * @param out  Where the words go.
 * @param size Its size.
 */
static void pin_state(GpioKitAo const *me, uint8_t pin, char *out, size_t size)
{
    switch ( me->pin[pin] )
    {
        case GP_PIN_IN:
        {
            (void)snprintf(out, size, "Input");
            break;
        }
        case GP_PIN_LOW:
        {
            (void)snprintf(out, size, "Output, low");
            break;
        }
        case GP_PIN_HIGH:
        {
            (void)snprintf(out, size, "Output, high");
            break;
        }
        case GP_PIN_PWM:
        {
            (void)snprintf(out, size, "PWM, %u%%", (unsigned)me->duty);
            break;
        }
        case GP_PIN_ANALOG:
        {
            (void)snprintf(out, size, "Analog input");
            break;
        }
        case GP_PIN_FREE:
        default:
        {
            (void)snprintf(out, size, "%s", pin_caps(pin));
            break;
        }
    }
}

/**
 * @brief A frequency in words.
 * @param hz   The frequency.
 * @param out  Where the words go.
 * @param size Its size.
 */
static void hz_text(uint32_t hz, char *out, size_t size)
{
    if ( hz >= 1000U )
    {
        (void)snprintf(out, size, "%u kHz", (unsigned)(hz / 1000U));
    }
    else
    {
        (void)snprintf(out, size, "%u Hz", (unsigned)hz);
    }
}

/* ---- Screen helpers ---- */

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

    lv_obj_align(b, LV_ALIGN_TOP_MID, 0, GP_FOOT_Y);
}

/**
 * @brief Two buttons at the foot of a page.
 * @param kit   The kit.
 * @param page  The page.
 * @param left  The left one's word.
 * @param lkind Its kind.
 * @param lcb   Its callback.
 * @param right The right one's word.
 * @param rkind Its kind.
 * @param rcb   Its callback.
 */
static void foot_two(kit_t *kit, lv_obj_t *page, char const *left, kit_btn_kind_t lkind, lv_event_cb_t lcb,
                     char const *right, kit_btn_kind_t rkind, lv_event_cb_t rcb)
{
    lv_obj_t * const l = kit_button(kit, page, left, lkind, GP_HALF_W, lcb, &s_ao);
    lv_obj_t * const r = kit_button(kit, page, right, rkind, GP_HALF_W, rcb, &s_ao);

    lv_obj_set_pos(l, KIT_SIDE, GP_FOOT_Y);
    lv_obj_set_pos(r, KBSP_LCD_H_RES - KIT_SIDE - GP_HALF_W, GP_FOOT_Y);
}

/**
 * @brief Whether the page on the glass is one that is asked again and again.
 * @param me The Active Object.
 * @return true for the input, analog, I2C and UART pages.
 */
static bool page_is_live(GpioKitAo const *me)
{
    kit_build_fn_t const cur = kit_current(&me->kit);

    return (page_input == cur) || (page_analog == cur) || (page_i2c == cur) || (page_uart == cur);
}

/**
 * @brief Start or stop the poll timer.
 * @param me The Active Object.
 * @param on Run it.
 */
static void poll_set(GpioKitAo *me, bool on)
{
    if ( on && !me->polling )
    {
        QTimeEvt_armX(&me->poll, KQP_TICKS_PER_MS(GP_PERIOD_MS), KQP_TICKS_PER_MS(GP_PERIOD_MS));
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

/* ---- Home ---- */

/** @brief A tap on Pins. @param e The event. */
static void home_pins_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_pins, &s_ao);
}

/** @brief A tap on I2C scan. @param e The event. */
static void home_i2c_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->i2c   = GP_I2C_IDLE;
    me->nfound = 0U;
    kit_push(&me->kit, &page_i2c, me);
}

/** @brief A tap on UART monitor. @param e The event. */
static void home_uart_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->rx[0]    = '\0';
    me->rx_count = 0U;
    me->tx_count = 0U;
    me->err[0]   = '\0';
    kit_push(&me->kit, &page_uart, me);
}

/** @brief A tap on Power. @param e The event. */
static void home_power_cb(lv_event_t *e)
{
    (void)e;
    s_ao.perr[0] = '\0';
    kit_push(&s_ao.kit, &page_power, &s_ao);
}

/**
 * @brief The first page: the pins, the I2C scan, the UART monitor and the supply.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    lv_obj_t * const body = kit_page(kit, "GPIO");
    char             sub[48];

    (void)arg;
    (void)kit_row(kit, body, "Pins", "Read and drive J3", &app_glyph_pin_40, NULL, KUI_COLOR_ACTION, &home_pins_cb,
                  &s_ao);
    (void)snprintf(sub, sizeof(sub), "SDA %u, SCL %u", (unsigned)GP_I2C_SDA, (unsigned)GP_I2C_SCL);
    (void)kit_row(kit, body, "I2C scan", sub, &app_glyph_chip_40, NULL, KUI_COLOR_ACCENT, &home_i2c_cb, &s_ao);
    (void)snprintf(sub, sizeof(sub), "TX %u, RX %u", (unsigned)GP_UART_TX, (unsigned)GP_UART_RX);
    (void)kit_row(kit, body, "UART monitor", sub, &app_glyph_term_40, NULL, KUI_COLOR_ACCENT, &home_uart_cb, &s_ao);
    (void)kit_row(kit, body, "Power", "Switch the 3.3 V on J3", &app_glyph_bolt_40, NULL, KUI_COLOR_ACTION, &home_power_cb,
                  &s_ao);
}

/* ---- The pin map ---- */

/** @brief A tap on a pin. @param e The event. */
static void pins_pick_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    me->sel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    kit_push(&me->kit, &page_pin, me);
}

/**
 * @brief The pin map: one row for each of the fourteen pins.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_pins(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  body = kit_page(kit, "Pins");
    char              name[16];
    char              sub[40];

    for ( uint8_t p = GP_PIN_FIRST; p <= GP_PIN_LAST; ++p )
    {
        lv_color_t slot = KUI_COLOR_ACCENT;

        (void)snprintf(name, sizeof(name), "Pin %u", (unsigned)p);
        (void)snprintf(sub, sizeof(sub), "%s", "");
        pin_state(me, p, sub, sizeof(sub));
        (void)snprintf(name, sizeof(name), "%u", (unsigned)p);
        if ( (GP_PIN_LOW == me->pin[p]) || (GP_PIN_HIGH == me->pin[p]) || (GP_PIN_PWM == me->pin[p]) )
        {
            slot = KUI_COLOR_ACTION;
        }
        {
            char title[16];

            (void)snprintf(title, sizeof(title), "Pin %u", (unsigned)p);
            (void)kit_row(kit, body, title, sub, NULL, name, slot, &pins_pick_cb, (void *)(uintptr_t)p);
        }
    }
}

/* ---- One pin ---- */

/** @brief A tap on Input. @param e The event. */
static void pin_input_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->err[0] = '\0';
    me->live   = GP_LIVE_WAIT;
    kit_push(&me->kit, &page_input, me);
    job_ask(me, GP_OP_READ, me->sel, false, 0U, 0U);
}

/** @brief A tap on Output. @param e The event. */
static void pin_output_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->err[0] = '\0';
    kit_push(&me->kit, &page_output, me);
}

/** @brief A tap on PWM. @param e The event. */
static void pin_pwm_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->err[0] = '\0';
    kit_push(&me->kit, &page_pwm, me);
}

/** @brief A tap on Analog. @param e The event. */
static void pin_analog_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->err[0] = '\0';
    me->live   = GP_LIVE_WAIT;
    kit_push(&me->kit, &page_analog, me);
    job_ask(me, GP_OP_ANALOG, me->sel, false, 0U, 0U);
}

/**
 * @brief A pin: what to do with it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_pin(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    char              title[16];
    lv_obj_t         *body;

    (void)snprintf(title, sizeof(title), "Pin %u", (unsigned)me->sel);
    body = kit_page(kit, title);
    (void)kit_row(kit, body, "Input", "Read the level", &app_glyph_search_40, NULL, KUI_COLOR_ACCENT, &pin_input_cb,
                  me);
    (void)kit_row(kit, body, "Output", "Drive high or low", &app_glyph_bolt_40, NULL, KUI_COLOR_ACTION, &pin_output_cb,
                  me);
    (void)kit_row(kit, body, "PWM", "Frequency and duty", &app_glyph_wave_sq_40, NULL, KUI_COLOR_ACCENT,
                  &pin_pwm_cb, me);
    if ( has_adc(me->sel) )
    {
        (void)kit_row(kit, body, "Analog", "Read the voltage", &app_glyph_sensor_40, NULL, KUI_COLOR_ACCENT,
                      &pin_analog_cb, me);
    }
}

/* ---- The worker ---- */

/**
 * @brief Hand a request to the worker now.
 * @param me The Active Object.
 * @param rq The request.
 */
static void job_submit(GpioKitAo *me, gp_req_t const *rq)
{
    kode_status_t rc;

    me->job.rq = *rq;
    rc = kode_worker_submit(&me->worker, &gp_run, &me->job, (enum_t)GPIOKIT_DONE_SIG, &me->seq);
    if ( KODE_OK == rc )
    {
        me->busy = true;
    }
    else
    {
        KLOG_E(TAG, "the worker would not take a job (status %d)", (int)rc);
        me->job.rs.ok = false;
        (void)snprintf(me->job.rs.err, sizeof(me->job.rs.err), "The worker is not running");
    }
}

/**
 * @brief Ask the worker for something; one job runs at a time, the latest request waits for it.
 * @param me    The Active Object.
 * @param op    What to do.
 * @param pin   The pin.
 * @param level The level to drive.
 * @param hz    The frequency or baud.
 * @param duty  The duty.
 */
static void job_ask(GpioKitAo *me, gp_op_t op, uint8_t pin, bool level, uint32_t hz, uint8_t duty)
{
    gp_req_t rq;

    rq.op    = op;
    rq.pin   = pin;
    rq.level = level;
    rq.hz    = hz;
    rq.duty  = duty;
    if ( me->busy )
    {
        me->later  = rq;
        me->queued = true;
    }
    else
    {
        job_submit(me, &rq);
    }
}

/* ---- Input ---- */

/**
 * @brief The live level of a pin.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_input(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              title[16];
    char              line[32];

    (void)snprintf(title, sizeof(title), "Pin %u", (unsigned)me->sel);
    (void)snprintf(line, sizeof(line), "Pin %u, 3.3 V logic", (unsigned)me->sel);
    kit_no_swipe(kit);
    if ( GP_LIVE_FAIL == me->live )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wave_sq_96, "Cannot read", me->err);
    }
    else if ( GP_LIVE_WAIT == me->live )
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_wave_sq_96, "Reading", line);
    }
    else if ( me->level )
    {
        (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_wave_sq_96, "High", line);
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wave_sq_96, "Low", line);
    }
    kit_bar(kit, page, title);
    poll_set(me, true);
}

/* ---- Output ---- */

/** @brief Drive the selected pin. @param level The level. */
static void output_drive(bool level)
{
    GpioKitAo * const me = &s_ao;

    job_ask(me, GP_OP_WRITE, me->sel, level, 0U, 0U);
}

/** @brief A tap on Low. @param e The event. */
static void output_low_cb(lv_event_t *e)
{
    (void)e;
    output_drive(false);
}

/** @brief A tap on High. @param e The event. */
static void output_high_cb(lv_event_t *e)
{
    (void)e;
    output_drive(true);
}

/**
 * @brief An output: low or high.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_output(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              title[16];
    char              line[32];

    (void)snprintf(title, sizeof(title), "Pin %u", (unsigned)me->sel);
    (void)snprintf(line, sizeof(line), "Pin %u", (unsigned)me->sel);
    kit_no_swipe(kit);
    if ( '\0' != me->err[0] )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_bolt_96, "Cannot drive it", me->err);
    }
    else if ( GP_PIN_HIGH == me->pin[me->sel] )
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACTION, &app_glyph_bolt_96, "High", "Driven to 3.3 V");
    }
    else if ( GP_PIN_LOW == me->pin[me->sel] )
    {
        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_bolt_96, "Low", "Driven to 0 V");
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_bolt_96, "Not driven", line);
    }
    foot_two(kit, page, "Low", KIT_BTN_QUIET, &output_low_cb, "High", KIT_BTN_ACTION, &output_high_cb);
    kit_bar(kit, page, title);
}

/* ---- PWM ---- */

/** @brief A tap on a stepper. @param e The event: user data 0 frequency down, 1 up, 2 duty down, 3 up. */
static void pwm_step_cb(lv_event_t *e)
{
    GpioKitAo * const me  = &s_ao;
    uintptr_t const   how = (uintptr_t)lv_event_get_user_data(e);

    if ( (0U == how) && (me->hz_i > 0U) )
    {
        me->hz_i--;
    }
    else if ( (1U == how) && ((me->hz_i + 1U) < GP_PWM_STEPS) )
    {
        me->hz_i++;
    }
    else if ( (2U == how) && (me->duty >= GP_DUTY_STEP) )
    {
        me->duty = (uint8_t)(me->duty - GP_DUTY_STEP);
    }
    else if ( (3U == how) && (me->duty <= (100U - GP_DUTY_STEP)) )
    {
        me->duty = (uint8_t)(me->duty + GP_DUTY_STEP);
    }
    else
    {
        /* At the end of its range. */
    }
    if ( GP_PIN_PWM == me->pin[me->sel] )
    {
        job_ask(me, GP_OP_PWM, me->sel, false, s_hz[me->hz_i], me->duty);
    }
    kit_refresh(&me->kit);
}

/** @brief A tap on Start or Stop. @param e The event. */
static void pwm_run_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    if ( GP_PIN_PWM == me->pin[me->sel] )
    {
        job_ask(me, GP_OP_WRITE, me->sel, false, 0U, 0U);
    }
    else
    {
        job_ask(me, GP_OP_PWM, me->sel, false, s_hz[me->hz_i], me->duty);
    }
}

/**
 * @brief One stepper: a caption, a value, and a minus and a plus.
 * @param kit   The kit.
 * @param page  The page.
 * @param y     Where it stands.
 * @param label The caption.
 * @param value The value in words.
 * @param base  The user data of the minus; the plus is base + 1.
 */
static void stepper(kit_t *kit, lv_obj_t *page, int32_t y, char const *label, char const *value, uintptr_t base)
{
    lv_obj_t *l;
    lv_obj_t *minus;
    lv_obj_t *plus;

    l = kit_text(page, label, &kui_font_caption, KUI_COLOR_TEXT_MUTED, 200, false);
    lv_obj_set_pos(l, KIT_SIDE, y);
    l = kit_text(page, value, &kui_font_name, KUI_COLOR_TEXT_ON_BG, 190, false);
    lv_obj_set_pos(l, KIT_SIDE, y + 26);
    minus = kit_button(kit, page, "-", KIT_BTN_QUIET, GP_BTN_STEP_W, &pwm_step_cb, (void *)base);
    plus  = kit_button(kit, page, "+", KIT_BTN_QUIET, GP_BTN_STEP_W, &pwm_step_cb, (void *)(base + 1U));
    lv_obj_set_pos(minus, KBSP_LCD_H_RES - KIT_SIDE - (2 * GP_BTN_STEP_W) - KIT_GAP, y + 2);
    lv_obj_set_pos(plus, KBSP_LCD_H_RES - KIT_SIDE - GP_BTN_STEP_W, y + 2);
}

/**
 * @brief PWM: frequency and duty, start and stop.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_pwm(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              title[16];
    char              value[24];
    lv_obj_t         *l;

    (void)snprintf(title, sizeof(title), "Pin %u PWM", (unsigned)me->sel);
    kit_no_swipe(kit);
    hz_text(s_hz[me->hz_i], value, sizeof(value));
    stepper(kit, page, 78, "Frequency", value, 0U);
    (void)snprintf(value, sizeof(value), "%u%%", (unsigned)me->duty);
    stepper(kit, page, 186, "Duty", value, 2U);
    if ( '\0' != me->err[0] )
    {
        l = kit_text(page, me->err, &kui_font_caption, KUI_COLOR_DANGER, KIT_ROW_W, false);
    }
    else if ( GP_PIN_PWM == me->pin[me->sel] )
    {
        l = kit_text(page, "Running", &kui_font_name, KUI_COLOR_OK, KIT_ROW_W, false);
    }
    else
    {
        l = kit_text(page, "Stopped", &kui_font_name, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    }
    lv_obj_set_pos(l, KIT_SIDE, 304);
    if ( GP_PIN_PWM == me->pin[me->sel] )
    {
        foot_one(kit, page, "Stop", KIT_BTN_DANGER, &pwm_run_cb);
    }
    else
    {
        foot_one(kit, page, "Start", KIT_BTN_ACTION, &pwm_run_cb);
    }
    kit_bar(kit, page, title);
}

/* ---- Analog ---- */

/**
 * @brief The voltage on a pin.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_analog(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              title[16];
    char              big[16];
    char              line[32];

    (void)snprintf(title, sizeof(title), "Pin %u", (unsigned)me->sel);
    kit_no_swipe(kit);
    if ( GP_LIVE_FAIL == me->live )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_sensor_96, "Cannot read", me->err);
    }
    else if ( GP_LIVE_WAIT == me->live )
    {
        (void)snprintf(line, sizeof(line), "Pin %u", (unsigned)me->sel);
        (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_sensor_96, "Reading", line);
    }
    else
    {
        (void)snprintf(big, sizeof(big), "%u.%02u V", (unsigned)(me->mv / 1000U), (unsigned)((me->mv % 1000U) / 10U));
        (void)snprintf(line, sizeof(line), "%u mV on pin %u", (unsigned)me->mv, (unsigned)me->sel);
        (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_sensor_96, big, line);
    }
    kit_bar(kit, page, title);
    poll_set(me, true);
}

/* ---- I2C ---- */

/**
 * @brief What a common address usually is.
 * @param addr The 7-bit address.
 * @return The words.
 */
static const char *i2c_guess(uint8_t addr)
{
    const char *s = "Unknown device";

    if ( (0x3CU == addr) || (0x3DU == addr) )
    {
        s = "Small display";
    }
    else if ( (addr >= 0x40U) && (addr <= 0x47U) )
    {
        s = "Sensor or driver";
    }
    else if ( (addr >= 0x48U) && (addr <= 0x4FU) )
    {
        s = "Sensor or converter";
    }
    else if ( (addr >= 0x50U) && (addr <= 0x57U) )
    {
        s = "Memory";
    }
    else if ( (0x68U == addr) || (0x69U == addr) )
    {
        s = "Clock or motion sensor";
    }
    else if ( (0x76U == addr) || (0x77U == addr) )
    {
        s = "Pressure sensor";
    }
    else
    {
        /* Not a common one. */
    }
    return s;
}

/**
 * @brief Begin a scan: the worker takes the bus and probes.
 * @param me The Active Object.
 */
static void i2c_start(GpioKitAo *me)
{
    me->nfound = 0U;
    me->err[0] = '\0';
    me->i2c    = GP_I2C_SCANNING;
    job_ask(me, GP_OP_I2C, 0U, false, 0U, 0U);
}

/** @brief A tap on Scan again. @param e The event. */
static void i2c_again_cb(lv_event_t *e)
{
    (void)e;
    i2c_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/** @brief A tap on Back. @param e The event. */
static void i2c_back_cb(lv_event_t *e)
{
    (void)e;
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief The I2C scan: waiting, the devices, or why there are none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_i2c(kit_t *kit, void *arg)
{
    GpioKitAo * const me = (GpioKitAo *)arg;
    lv_obj_t         *page;
    char              line[48];

    if ( GP_I2C_IDLE == me->i2c )
    {
        i2c_start(me);
    }
    if ( GP_I2C_DONE == me->i2c )
    {
        lv_obj_t * const body = kit_page(kit, "I2C scan");

        for ( uint32_t i = 0U; i < me->nfound; ++i )
        {
            char name[12];

            (void)snprintf(name, sizeof(name), "0x%02X", (unsigned)me->found[i]);
            (void)kit_row(kit, body, name, i2c_guess(me->found[i]), &app_glyph_chip_40, NULL, KUI_COLOR_ACCENT,
                          NULL, me);
        }
        (void)kit_row(kit, body, "Scan again", "Look once more", &app_glyph_refresh_40, NULL, KUI_COLOR_ACTION,
                      &i2c_again_cb, me);
        return;
    }
    page = kit_page_bare(kit);
    kit_no_swipe(kit);
    switch ( me->i2c )
    {
        case GP_I2C_NONE:
        {
            (void)snprintf(line, sizeof(line), "Nothing on SDA %u and SCL %u%s", (unsigned)GP_I2C_SDA,
                           (unsigned)GP_I2C_SCL, me->v33 ? "" : ". 3.3 V is off");
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_chip_96, "No devices found", line);
            foot_one(kit, page, "Scan again", KIT_BTN_ACTION, &i2c_again_cb);
            break;
        }
        case GP_I2C_FAIL:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_chip_96, "Cannot scan", me->err);
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &i2c_again_cb);
            break;
        }
        case GP_I2C_SCANNING:
        case GP_I2C_IDLE:
        case GP_I2C_DONE:
        default:
        {
            (void)snprintf(line, sizeof(line), "Probing 0x%02X to 0x%02X", (unsigned)GP_I2C_FIRST,
                           (unsigned)GP_I2C_LAST);
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_chip_96, "Scanning", line);
            foot_one(kit, page, "Cancel", KIT_BTN_QUIET, &i2c_back_cb);
            break;
        }
    }
    kit_bar(kit, page, "I2C scan");
}

/* ---- UART ---- */

/**
 * @brief Take what arrived into the monitor's text.
 * @param me The Active Object.
 * @param rs The answer with the bytes.
 */
static void uart_add(GpioKitAo *me, gp_res_t const *rs)
{
    size_t len = strlen(me->rx);

    for ( size_t i = 0U; i < rs->nrx; ++i )
    {
        char c = (char)rs->rx[i];

        if ( len >= GP_UART_TEXT )
        {
            (void)memmove(me->rx, &me->rx[GP_UART_TEXT / 2U], (GP_UART_TEXT / 2U) + 1U);
            len = strlen(me->rx);
        }
        if ( '\r' == c )
        {
            continue;
        }
        if ( ('\n' != c) && ((c < ' ') || (c > '~')) )
        {
            c = '.';
        }
        me->rx[len] = c;
        len++;
        me->rx[len] = '\0';
    }
    me->rx_count += (uint32_t)rs->nrx;
}

/** @brief A tap on Baud. @param e The event. */
static void uart_baud_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    if ( GP_UART_UP == me->uart )
    {
        job_ask(me, GP_OP_UART_CLOSE, 0U, false, 0U, 0U);
        me->uart = GP_UART_CLOSED;
    }
    me->baud_i = (uint8_t)((me->baud_i + 1U) % (sizeof(s_baud) / sizeof(s_baud[0])));
    me->uart   = GP_UART_OPENING;
    job_ask(me, GP_OP_UART_OPEN, 0U, false, s_baud[me->baud_i], 0U);
    kit_refresh(&me->kit);
}

/** @brief A tap on Send. @param e The event. */
static void uart_send_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    if ( GP_UART_UP == me->uart )
    {
        job_ask(me, GP_OP_UART_SEND, 0U, false, 0U, 0U);
    }
}

/** @brief A tap on Clear. @param e The event. */
static void uart_clear_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->rx[0]    = '\0';
    me->rx_count = 0U;
    me->tx_count = 0U;
    kit_refresh(&me->kit);
}

/** @brief A tap on Try again. @param e The event. */
static void uart_retry_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;

    (void)e;
    me->uart = GP_UART_CLOSED;
    kit_refresh(&me->kit);
}

/**
 * @brief The UART monitor: what comes in, and a way to send.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_uart(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              line[64];
    lv_obj_t         *box;
    lv_obj_t         *l;
    lv_obj_t         *b;
    size_t            len;
    size_t            from = 0U;

    kit_no_swipe(kit);
    if ( GP_UART_CLOSED == me->uart )
    {
        me->uart = GP_UART_OPENING;
        job_ask(me, GP_OP_UART_OPEN, 0U, false, s_baud[me->baud_i], 0U);
    }
    if ( GP_UART_FAIL == me->uart )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_term_96, "Cannot listen", me->err);
        foot_one(kit, page, "Try again", KIT_BTN_ACTION, &uart_retry_cb);
        kit_bar(kit, page, "UART monitor");
        return;
    }
    (void)snprintf(line, sizeof(line), "%u baud, TX %u, RX %u", (unsigned)s_baud[me->baud_i], (unsigned)GP_UART_TX,
                   (unsigned)GP_UART_RX);
    l = kit_text(page, line, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(l, KIT_SIDE, 70);
    box = lv_obj_create(page);
    lv_obj_remove_style_all(box);
    lv_obj_set_size(box, KIT_ROW_W, 262);
    lv_obj_set_pos(box, KIT_SIDE, 100);
    lv_obj_set_style_bg_color(box, KUI_COLOR_SURFACE, 0);
    lv_obj_set_style_bg_opa(box, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(box, KUI_RADIUS_GLASS, 0);
    lv_obj_set_style_pad_all(box, 14, 0);
    lv_obj_set_scrollable(box, false);
    len = strlen(me->rx);
    if ( len > GP_UART_SHOWN )
    {
        from = len - GP_UART_SHOWN;
    }
    if ( 0U == len )
    {
        l = kit_text(box, "Waiting for data", &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W - 28, false);
    }
    else
    {
        l = kit_text(box, &me->rx[from], &kui_font_caption, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W - 28, false);
        lv_obj_align(l, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    }
    (void)snprintf(line, sizeof(line), "%u in, %u out", (unsigned)me->rx_count, (unsigned)me->tx_count);
    l = kit_text(page, line, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(l, KIT_SIDE, 368);
    b = kit_button(kit, page, "Baud", KIT_BTN_QUIET, GP_THIRD_W, &uart_baud_cb, me);
    lv_obj_set_pos(b, KIT_SIDE, GP_FOOT_Y);
    b = kit_button(kit, page, "Send", KIT_BTN_QUIET, GP_THIRD_W, &uart_send_cb, me);
    lv_obj_set_pos(b, (KBSP_LCD_H_RES - GP_THIRD_W) / 2, GP_FOOT_Y);
    b = kit_button(kit, page, "Clear", KIT_BTN_ACTION, GP_THIRD_W, &uart_clear_cb, me);
    lv_obj_set_pos(b, KBSP_LCD_H_RES - KIT_SIDE - GP_THIRD_W, GP_FOOT_Y);
    kit_bar(kit, page, "UART monitor");
    poll_set(me, true);
}

/* ---- Power ---- */

/**
 * @brief A tap on 3.3 V: ask AO_Radio to switch J3's supply. The app draws its own screen, so its Active Object holds the level the
 *        standard layer's kode_pin_power_3v3() needs (KODE_PRIO_USER_GUI): the extended call kode_sys_exp_power() is the one open to
 *        it, and the end of the switch comes as EXP_POWER_SIG.
 * @param e The event.
 */
static void power_v33_cb(lv_event_t *e)
{
    GpioKitAo * const me = &s_ao;
    kode_status_t     rc;

    (void)e;
    if ( me->v33_wait )
    {
        return;
    }
    me->perr[0] = '\0';
    rc = kode_sys_exp_power(!me->v33);
    if ( KODE_OK == rc )
    {
        me->v33_wait = true;
    }
    else
    {
        (void)snprintf(me->perr, sizeof(me->perr), "The radio would not take it (status %d)", (int)rc);
    }
    kit_refresh(&me->kit);
}

/**
 * @brief J3's supply: a part wired to the connector gets nothing until the app switches 3.3 V on.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_power(kit_t *kit, void *arg)
{
    GpioKitAo * const me   = (GpioKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);

    kit_no_swipe(kit);
    if ( '\0' != me->perr[0] )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_bolt_96, "Cannot switch it", me->perr);
    }
    else if ( me->v33_wait )
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_bolt_96, "Switching", "Asking the radio");
    }
    else if ( me->v33 )
    {
        (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_bolt_96, "3.3 V is on", "Pins 2 and 19 of J3");
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_bolt_96, "3.3 V is off", "Pins 2 and 19 of J3");
    }
    foot_one(kit, page, me->v33 ? "Switch off" : "Switch on", me->v33 ? KIT_BTN_QUIET : KIT_BTN_ACTION, &power_v33_cb);
    kit_bar(kit, page, "Power");
}

/* ---- The worker's answers ---- */

/**
 * @brief A job came back: take its answer into the app's books and redraw.
 * @param me The Active Object.
 * @param d  The done event.
 */
static void job_done(GpioKitAo *me, kode_worker_done_t const *d)
{
    gp_req_t const rq = me->job.rq;
    gp_res_t const *rs = &me->job.rs;
    bool            redraw = true;

    if ( d->seq != me->seq )
    {
        return;
    }
    me->busy = false;
    switch ( rq.op )
    {
        case GP_OP_READ:
        {
            if ( rs->ok )
            {
                redraw = (GP_LIVE_OK != me->live) || (rs->level != me->level);
                me->level          = rs->level;
                me->live           = GP_LIVE_OK;
                me->pin[rq.pin]    = GP_PIN_IN;
                me->err[0]         = '\0';
            }
            else
            {
                redraw = (GP_LIVE_FAIL != me->live);
                me->live = GP_LIVE_FAIL;
                (void)snprintf(me->err, sizeof(me->err), "%s", rs->err);
            }
            if ( redraw )
            {
                KLOG_I(TAG, "pin %u read: ok %u level %u %s", (unsigned)rq.pin, (unsigned)rs->ok,
                       (unsigned)rs->level, rs->err);
            }
            break;
        }
        case GP_OP_ANALOG:
        {
            if ( rs->ok )
            {
                redraw = (GP_LIVE_OK != me->live) || (rs->mv != me->mv);
                me->mv          = rs->mv;
                me->live        = GP_LIVE_OK;
                me->pin[rq.pin] = GP_PIN_ANALOG;
            }
            else
            {
                redraw = (GP_LIVE_FAIL != me->live);
                me->live = GP_LIVE_FAIL;
                (void)snprintf(me->err, sizeof(me->err), "%s", rs->err);
            }
            break;
        }
        case GP_OP_WRITE:
        {
            if ( rs->ok )
            {
                me->err[0] = '\0';
                me->level  = rq.level;
                if ( rq.level )
                {
                    me->pin[rq.pin] = GP_PIN_HIGH;
                }
                else
                {
                    me->pin[rq.pin] = GP_PIN_LOW;
                }
                KLOG_I(TAG, "pin %u driven %u", (unsigned)rq.pin, (unsigned)rq.level);
            }
            else
            {
                (void)snprintf(me->err, sizeof(me->err), "%s", rs->err);
                KLOG_W(TAG, "pin %u write refused: %s", (unsigned)rq.pin, rs->err);
            }
            break;
        }
        case GP_OP_PWM:
        {
            if ( rs->ok )
            {
                me->err[0]      = '\0';
                me->pin[rq.pin] = GP_PIN_PWM;
                KLOG_I(TAG, "pin %u pwm %u Hz %u%%", (unsigned)rq.pin, (unsigned)rq.hz, (unsigned)rq.duty);
            }
            else
            {
                (void)snprintf(me->err, sizeof(me->err), "%s", rs->err);
                me->pin[rq.pin] = GP_PIN_FREE;
                KLOG_W(TAG, "pin %u pwm refused: %s", (unsigned)rq.pin, rs->err);
            }
            break;
        }
        case GP_OP_I2C:
        {
            if ( rs->ok )
            {
                (void)memcpy(me->found, rs->found, sizeof(me->found));
                me->nfound = rs->nfound;
                if ( 0U < me->nfound )
                {
                    me->i2c = GP_I2C_DONE;
                }
                else
                {
                    me->i2c = GP_I2C_NONE;
                }
            }
            else
            {
                me->i2c = GP_I2C_FAIL;
                (void)snprintf(me->err, sizeof(me->err), "%s", rs->err);
            }
            KLOG_I(TAG, "i2c scan ended: %u devices, ok %u", (unsigned)me->nfound, (unsigned)rs->ok);
            break;
        }
        case GP_OP_UART_OPEN:
        {
            if ( rs->ok )
            {
                me->uart = GP_UART_UP;
            }
            else
            {
                me->uart = GP_UART_FAIL;
                (void)snprintf(me->err, sizeof(me->err), "%s", rs->err);
            }
            KLOG_I(TAG, "uart open ok %u", (unsigned)rs->ok);
            break;
        }
        case GP_OP_UART_SEND:
        {
            if ( rs->ok )
            {
                me->tx_count += 6U;
            }
            break;
        }
        case GP_OP_UART_TAKE:
        {
            redraw = (0U < rs->nrx);
            if ( redraw )
            {
                uart_add(me, rs);
            }
            break;
        }
        case GP_OP_UART_CLOSE:
        {
            redraw = false;
            break;
        }
        default:
        {
            redraw = false;
            break;
        }
    }
    if ( me->queued )
    {
        me->queued = false;
        job_submit(me, &me->later);
    }
    if ( redraw )
    {
        kit_refresh(&me->kit);
    }
}

/* ---- Polling ---- */

/**
 * @brief The poll timer fired: ask what the live page on the glass shows.
 * @param me The Active Object.
 */
static void poll_tick(GpioKitAo *me)
{
    kit_build_fn_t const cur = kit_current(&me->kit);

    if ( (page_uart != cur) && ((GP_UART_UP == me->uart) || (GP_UART_FAIL == me->uart)) )
    {
        if ( GP_UART_UP == me->uart )
        {
            job_ask(me, GP_OP_UART_CLOSE, 0U, false, 0U, 0U);
        }
        me->uart = GP_UART_CLOSED;
    }
    if ( !page_is_live(me) && !me->busy )
    {
        poll_set(me, false);
        return;
    }
    if ( me->busy )
    {
        return;
    }
    if ( page_input == cur )
    {
        job_ask(me, GP_OP_READ, me->sel, false, 0U, 0U);
    }
    else if ( page_analog == cur )
    {
        job_ask(me, GP_OP_ANALOG, me->sel, false, 0U, 0U);
    }
    else if ( (page_uart == cur) && (GP_UART_UP == me->uart) )
    {
        job_ask(me, GP_OP_UART_TAKE, 0U, false, 0U, 0U);
    }
    else
    {
        /* Nothing to ask. */
    }
}

/* ---- The Active Object ---- */

void GpioKitAo_ctor(void)
{
    GpioKitAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&GpioKitAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)GPIOKIT_TICK_SIG);
    QTimeEvt_ctorX(&me->poll, &me->super, (enum_t)GPIOKIT_POLL_SIG, 0U);
    me->hz_i = 5U;
    me->duty = 50U;
}

void GpioKitAo_start(void)
{
    QActive_setAttr(AO_GpioKit, TASK_NAME_ATTR, "gpio_kit_ao");
    QACTIVE_START(AO_GpioKit, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: bring the worker up, ask for the panel, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to GpioKitAo_running.
 */
static QState GpioKitAo_initial(GpioKitAo * const me, void const * const par)
{
    kode_status_t const rc = kode_worker_start(&me->worker, &me->super, "gpio_kit_wk", GP_WORKER_STACK,
                                               KODE_PRIO_USER_LOW, GP_WORKER_DEPTH);

    (void)par;
    if ( KODE_OK != rc )
    {
        KLOG_E(TAG, "the worker did not start (status %d)", (int)rc);
    }
    kit_start(&me->kit);
    QActive_subscribe(&me->super, EXP_POWER_SIG);
    KLOG_I(TAG, "up");
    return Q_TRAN(&GpioKitAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState GpioKitAo_running(GpioKitAo * const me, QEvt const * const e)
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
        case GPIOKIT_POLL_SIG:
        {
            poll_tick(me);
            break;
        }
        case GPIOKIT_DONE_SIG:
        {
            job_done(me, Q_EVT_CAST(kode_worker_done_t));
            break;
        }
        case EXP_POWER_SIG:
        {
            kode_sys_exp_power_done_t const * const d = Q_EVT_CAST(kode_sys_exp_power_done_t);

            me->v33_wait = false;
            if ( (uint8_t)KODE_OK == d->rc )
            {
                me->v33 = d->on;
                KLOG_I(TAG, "J3 3.3 V %s", d->on ? "on" : "off");
            }
            else
            {
                (void)snprintf(me->perr, sizeof(me->perr), "The C5 would not switch it (status %u)", (unsigned)d->rc);
                KLOG_W(TAG, "J3 3.3 V refused: %s", me->perr);
            }
            kit_refresh(&me->kit);
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
