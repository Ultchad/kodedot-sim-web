/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file ir_ao.c
 * @brief The IR Remote app's Active Object: learn a button, keep it in a named remote, send it back.
 */
#include "ir_ao.h"

#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "kit.h"
#include "kit_store.h"

#define TAG "ir.ao"   /**< This file's log tag. */

#define IR_DIR          "/storage/ir_kit"            /**< The app's folder on the internal volume. */
#define IR_FILE         "/storage/ir_kit/saved.bin"  /**< What is kept: the remotes and their buttons. */
#define IR_MAGIC        0x314B5249UL                 /**< "IRK1", the file's first four bytes. */
#define IR_MAX_REMOTES  6U                           /**< Remotes the app keeps. */
#define IR_MAX_BUTTONS  40U                          /**< Buttons in all remotes together. */
#define IR_KEEP         128U                         /**< Symbols a raw button keeps. */
#define IR_BTN_NAME_MAX 12U                          /**< The longest button name, NUL excluded. */
#define IR_REM_NAME_MAX 16U                          /**< The longest remote name, NUL excluded. */
#define IR_LEARN_MS     10000U                       /**< How long a learning window listens. */
#define IR_CARRIER_HZ   38000U                       /**< The carrier a raw frame is sent on. */
#define IR_HEAD_BYTES   8U                           /**< Magic and the two counts. */
#define IR_FOOT_Y       402                          /**< Where a page's buttons stand. */
#define IR_HALF_W       165                          /**< One of two buttons side by side. */
#define IR_FLASH_MS     700U                         /**< How long "Sent" shows on a button. */
#define IR_KIND_NEC     0U                           /**< A button that decoded as NEC. */
#define IR_KIND_RAW     1U                           /**< A button kept as marks and spaces. */

/** @brief This app's own signals. */
enum IrKitSignals
{
    IRKIT_TICK_SIG = MAX_SIG   /**< The render pass: kscreen's one-shot. */
};

/** @brief One saved button, as it is kept in the file. */
typedef struct {
    char                 name[IR_BTN_NAME_MAX + 1U];   /**< What the person called it. */
    uint8_t              remote;                       /**< The remote it belongs to. */
    uint8_t              kind;                         /**< IR_KIND_NEC or IR_KIND_RAW. */
    uint16_t             addr;                         /**< NEC address word, as heard. */
    uint16_t             cmd;                          /**< NEC command word, as heard. */
    uint16_t             n;                            /**< Symbols kept (raw) or heard (NEC, none kept). */
    kode_sys_ir_symbol_t sym[IR_KEEP];                 /**< The raw frame, mark first. */
} ir_button_t;

/** @brief One remote. */
typedef struct {
    char name[IR_REM_NAME_MAX + 1U];   /**< What the person called it. */
} ir_remote_t;

/** @brief What the Learn page is showing. */
typedef enum {
    IR_L_WAIT = 0,   /**< Listening. */
    IR_L_NEC,        /**< A NEC frame was heard. */
    IR_L_RAW,        /**< A frame that is not NEC was heard. */
    IR_L_LONG,       /**< A frame too long to keep. */
    IR_L_NONE,       /**< The window closed empty. */
    IR_L_NOIR,       /**< No infrared block. */
    IR_L_BUSY,       /**< The receiver is held. */
    IR_L_SAVED       /**< The button was saved. */
} ir_lstate_t;

/** @brief What the delete question is about. */
typedef enum {
    IR_DEL_BUTTON = 0,   /**< One button. */
    IR_DEL_REMOTE        /**< A remote and its buttons. */
} ir_del_t;

/** @brief What a name page is for. */
typedef enum {
    IR_NAME_NEW_REMOTE = 0,   /**< The remote a learned button goes into. */
    IR_NAME_NEW_BUTTON,       /**< The learned button. */
    IR_NAME_REN_REMOTE,       /**< A new name for a remote. */
    IR_NAME_REN_BUTTON        /**< A new name for a button. */
} ir_name_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive      super;                          /**< The QP/C base; must stay first. */
    kit_t        kit;                            /**< The screens. */
    kit_store_t  store;                          /**< The saved file. */
    ir_remote_t  remotes[IR_MAX_REMOTES];        /**< The remotes. */
    uint8_t      nremotes;                       /**< How many. */
    ir_button_t  buttons[IR_MAX_BUTTONS];        /**< Their buttons. */
    uint8_t      nbuttons;                       /**< How many. */
    ir_button_t  found;                          /**< The signal just heard. */
    uint16_t     found_total;                    /**< Its symbols, kept or not. */
    ir_lstate_t  lstate;                         /**< The Learn page's state. */
    uint8_t      pending;                        /**< Requests out that will each be answered. */
    bool         want;                           /**< The answer is still wanted. */
    int8_t       target;                         /**< The remote a learned button goes into, -1 for none yet. */
    uint8_t      learn_depth;                    /**< The depth of the Learn page. */
    uint8_t      rsel;                           /**< The remote a page is about. */
    uint8_t      bsel;                           /**< The button a page is about (global index). */
    ir_del_t     del;                            /**< What the delete question is about. */
    ir_name_t    namefor;                        /**< What the name page in use is for. */
    kit_name_t   name;                           /**< The name being typed. */
    char         last[IR_BTN_NAME_MAX + 1U];     /**< The button just saved. */
    bool         tx_out;                         /**< A raw send is out. */
    lv_obj_t    *rows[IR_MAX_BUTTONS];           /**< The rows of the remote page on the glass. */
    uint8_t      rows_btn[IR_MAX_BUTTONS];       /**< The button each row sends. */
    uint8_t      nrows;                          /**< How many rows. */
    lv_timer_t  *flash;                          /**< Puts the buttons' words back. */
} IrKitAo;

static QEvtPtr              s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t          s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static uint8_t              s_file[IR_HEAD_BYTES + (IR_MAX_REMOTES * sizeof(ir_remote_t))
                                   + (IR_MAX_BUTTONS * sizeof(ir_button_t))];   /**< The file's lent buffer. */
static kode_sys_ir_symbol_t s_lent[KODE_SYS_IR_RX_MAX_SYMBOLS];                 /**< Where AO_Ir writes a heard frame. */
static kode_sys_ir_symbol_t s_tx[IR_KEEP];                                      /**< The raw frame being sent, lent until answered. */
static IrKitAo              s_ao;                                               /**< The one instance. */

QActive * const AO_IrKit = &s_ao.super;

static QState IrKitAo_initial(IrKitAo * const me, void const * const par);
static QState IrKitAo_running(IrKitAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_learn(kit_t *kit, void *arg);
static void   page_pick(kit_t *kit, void *arg);
static void   page_remotes(kit_t *kit, void *arg);
static void   page_remote(kit_t *kit, void *arg);
static void   page_edit(kit_t *kit, void *arg);
static void   page_button(kit_t *kit, void *arg);
static void   page_delete(kit_t *kit, void *arg);

/* ---- The saved file ---- */

/**
 * @brief Fill the file buffer from the remotes and buttons.
 * @param ctx The Active Object.
 * @param buf The buffer.
 * @param cap Its size.
 * @return The bytes.
 */
static uint32_t ir_pack(void *ctx, uint8_t *buf, uint32_t cap)
{
    IrKitAo * const me    = (IrKitAo *)ctx;
    uint32_t const  magic = IR_MAGIC;
    uint32_t        n     = IR_HEAD_BYTES;
    size_t const    rb    = (size_t)me->nremotes * sizeof(ir_remote_t);
    size_t const    bb    = (size_t)me->nbuttons * sizeof(ir_button_t);

    if ( (n + rb + bb) > cap )
    {
        return 0U;
    }
    (void)memcpy(buf, &magic, sizeof(magic));
    buf[4] = me->nremotes;
    buf[5] = me->nbuttons;
    buf[6] = 0U;
    buf[7] = 0U;
    (void)memcpy(&buf[n], me->remotes, rb);
    n += (uint32_t)rb;
    (void)memcpy(&buf[n], me->buttons, bb);
    n += (uint32_t)bb;
    return n;
}

/**
 * @brief Read the remotes and buttons back from the file buffer.
 * @param me  The Active Object.
 * @param len The bytes read.
 */
static void ir_unpack(IrKitAo *me, uint32_t len)
{
    uint32_t magic = 0U;

    if ( IR_HEAD_BYTES > len )
    {
        return;
    }
    (void)memcpy(&magic, s_file, sizeof(magic));
    if ( (IR_MAGIC == magic) && (IR_MAX_REMOTES >= s_file[4]) && (IR_MAX_BUTTONS >= s_file[5])
         && (len >= (IR_HEAD_BYTES + ((uint32_t)s_file[4] * (uint32_t)sizeof(ir_remote_t))
                     + ((uint32_t)s_file[5] * (uint32_t)sizeof(ir_button_t)))) )
    {
        uint32_t at = IR_HEAD_BYTES;

        me->nremotes = s_file[4];
        me->nbuttons = s_file[5];
        (void)memcpy(me->remotes, &s_file[at], (size_t)me->nremotes * sizeof(ir_remote_t));
        at += (uint32_t)me->nremotes * (uint32_t)sizeof(ir_remote_t);
        (void)memcpy(me->buttons, &s_file[at], (size_t)me->nbuttons * sizeof(ir_button_t));
        for ( uint32_t i = 0U; i < me->nremotes; ++i )
        {
            me->remotes[i].name[IR_REM_NAME_MAX] = '\0';
        }
        for ( uint32_t i = 0U; i < me->nbuttons; ++i )
        {
            me->buttons[i].name[IR_BTN_NAME_MAX] = '\0';
            if ( (IR_KEEP < me->buttons[i].n) || (me->buttons[i].remote >= me->nremotes) )
            {
                me->buttons[i].n      = 0U;
                me->buttons[i].remote = 0U;
            }
        }
    }
    else
    {
        KLOG_W(TAG, "the saved file is not ours; starting empty");
    }
}

/* ---- Words and lookups ---- */

/**
 * @brief How many buttons a remote has.
 * @param me The Active Object.
 * @param r  The remote.
 * @return The count.
 */
static uint8_t remote_count(IrKitAo const *me, uint8_t r)
{
    uint8_t n = 0U;

    for ( uint32_t i = 0U; i < me->nbuttons; ++i )
    {
        if ( r == me->buttons[i].remote )
        {
            n++;
        }
    }
    return n;
}

/**
 * @brief A button's second line.
 * @param b   The button.
 * @param out Where.
 * @param cap Its size.
 */
static void button_sub(ir_button_t const *b, char *out, size_t cap)
{
    if ( IR_KIND_NEC == b->kind )
    {
        (void)snprintf(out, cap, "NEC %04X %04X", (unsigned)b->addr, (unsigned)b->cmd);
    }
    else
    {
        (void)snprintf(out, cap, "Raw, %u pulses", (unsigned)b->n);
    }
}

/**
 * @brief The next name for a remote: "Remote 1", "Remote 2" ... not yet used.
 * @param me  The Active Object.
 * @param out Where.
 */
static void next_remote_name(IrKitAo *me, char *out)
{
    for ( uint32_t n = 1U; n < 100U; ++n )
    {
        bool used = false;

        (void)snprintf(out, IR_REM_NAME_MAX + 1U, "Remote %u", (unsigned)n);
        for ( uint32_t i = 0U; i < me->nremotes; ++i )
        {
            if ( 0 == strcmp(me->remotes[i].name, out) )
            {
                used = true;
            }
        }
        if ( !used )
        {
            return;
        }
    }
}

/**
 * @brief The next name for a button of a remote: "Button 1", "Button 2" ... not yet used there.
 * @param me  The Active Object.
 * @param r   The remote.
 * @param out Where.
 */
static void next_button_name(IrKitAo *me, uint8_t r, char *out)
{
    for ( uint32_t n = 1U; n < 100U; ++n )
    {
        bool used = false;

        (void)snprintf(out, IR_BTN_NAME_MAX + 1U, "Button %u", (unsigned)n);
        for ( uint32_t i = 0U; i < me->nbuttons; ++i )
        {
            if ( (r == me->buttons[i].remote) && (0 == strcmp(me->buttons[i].name, out)) )
            {
                used = true;
            }
        }
        if ( !used )
        {
            return;
        }
    }
}

/**
 * @brief Whether a name is "Power" in any case.
 * @param s The name.
 * @return true for Power.
 */
static bool is_power(char const *s)
{
    char const *p = "power";
    uint32_t    i = 0U;

    while ( ('\0' != p[i]) && ('\0' != s[i]) )
    {
        char c = s[i];

        if ( ('A' <= c) && ('Z' >= c) )
        {
            c = (char)(c - 'A' + 'a');
        }
        if ( c != p[i] )
        {
            return false;
        }
        i++;
    }
    return ('\0' == p[i]) && ('\0' == s[i]);
}

/* ---- The infrared block ---- */

/**
 * @brief Listen for the next frame, once: a second ask displaces the first, which is answered and dropped.
 * @param me The Active Object.
 */
static void learn_start(IrKitAo *me)
{
    me->lstate = IR_L_WAIT;
    me->want   = true;
    if ( KODE_OK == kode_sys_ir_capture(&me->super, s_lent, Q_DIM(s_lent), IR_LEARN_MS) )
    {
        me->pending++;
    }
    else
    {
        me->want   = false;
        me->lstate = IR_L_BUSY;
    }
}

/**
 * @brief A capture was answered.
 * @param me The Active Object.
 * @param a  The answer.
 */
static void capture_answer(IrKitAo *me, kode_sys_ir_capture_answer_t const *a)
{
    kode_status_t const rc = (kode_status_t)a->rc;

    if ( 0U < me->pending )
    {
        me->pending--;
    }
    if ( (0U < me->pending) || !me->want )
    {
        /* An older ask that a newer one displaced, or one nobody waits for. */
        return;
    }
    if ( KODE_OK == rc )
    {
        uint32_t const keep = (IR_KEEP < a->n) ? IR_KEEP : a->n;

        (void)memset(&me->found, 0, sizeof(me->found));
        (void)memcpy(me->found.sym, s_lent, (size_t)keep * sizeof(kode_sys_ir_symbol_t));
        me->found.n     = (uint16_t)keep;
        me->found_total = (uint16_t)a->n;
        if ( KODE_OK == kode_sys_ir_last(&me->super) )
        {
            me->pending++;
            return;
        }
        me->found.kind = IR_KIND_RAW;
        me->lstate     = (IR_KEEP < a->n) ? IR_L_LONG : IR_L_RAW;
    }
    else
    {
        me->want = false;
        if ( KODE_TIMEOUT == rc )
        {
            me->lstate = IR_L_NONE;
        }
        else if ( KODE_IO_ERROR == rc )
        {
            me->lstate = IR_L_NOIR;
        }
        else
        {
            me->lstate = IR_L_BUSY;
        }
    }
    if ( page_learn == kit_current(&me->kit) )
    {
        kit_refresh(&me->kit);
    }
}

/**
 * @brief What the frame decoded to.
 * @param me The Active Object.
 * @param a  The answer.
 */
static void last_answer(IrKitAo *me, kode_sys_ir_last_answer_t const *a)
{
    if ( 0U < me->pending )
    {
        me->pending--;
    }
    if ( (0U < me->pending) || !me->want )
    {
        return;
    }
    me->want = false;
    if ( ((uint8_t)KODE_OK == a->rc) && a->have && a->frame.nec )
    {
        me->found.kind = IR_KIND_NEC;
        me->found.addr = a->frame.addr;
        me->found.cmd  = a->frame.cmd;
        me->lstate     = IR_L_NEC;
    }
    else
    {
        me->found.kind = IR_KIND_RAW;
        me->lstate     = (IR_KEEP < me->found_total) ? IR_L_LONG : IR_L_RAW;
    }
    if ( page_learn == kit_current(&me->kit) )
    {
        kit_refresh(&me->kit);
    }
}

/**
 * @brief Send a button's signal.
 * @param me The Active Object.
 * @param b  The button.
 * @return true when the request was taken.
 */
static bool send_signal(IrKitAo *me, ir_button_t const *b)
{
    bool ok = false;

    if ( IR_KIND_NEC == b->kind )
    {
        ok = (KODE_OK == kode_sys_ir_send_nec(b->addr, b->cmd));
    }
    else if ( (!me->tx_out) && (0U < b->n) )
    {
        (void)memcpy(s_tx, b->sym, (size_t)b->n * sizeof(kode_sys_ir_symbol_t));
        if ( KODE_OK == kode_sys_ir_send_raw(&me->super, s_tx, b->n, IR_CARRIER_HZ) )
        {
            me->tx_out = true;
            ok         = true;
        }
    }
    else if ( me->tx_out )
    {
        /* The last frame is still going: a held button's next repeat waits for it. */
        ok = true;
    }
    else
    {
        /* Nothing to send. */
    }
    return ok;
}

/**
 * @brief Put the buttons' second lines back after "Sent".
 * @param t The timer.
 */
static void flash_cb(lv_timer_t *t)
{
    IrKitAo * const me = (IrKitAo *)lv_timer_get_user_data(t);

    lv_timer_pause(t);
    if ( page_remote == kit_current(&me->kit) )
    {
        for ( uint32_t i = 0U; i < me->nrows; ++i )
        {
            char sub[24];

            button_sub(&me->buttons[me->rows_btn[i]], sub, sizeof(sub));
            kit_row_set(me->rows[i], me->buttons[me->rows_btn[i]].name, sub);
        }
    }
}

/**
 * @brief Say on a row of the remote page what became of a send.
 * @param me   The Active Object.
 * @param row  The row index.
 * @param word What to say.
 */
static void say_on_row(IrKitAo *me, uint32_t row, char const *word)
{
    if ( (page_remote == kit_current(&me->kit)) && (row < me->nrows) )
    {
        kit_row_set(me->rows[row], me->buttons[me->rows_btn[row]].name, word);
        if ( NULL == me->flash )
        {
            me->flash = lv_timer_create(&flash_cb, IR_FLASH_MS, me);
        }
        lv_timer_reset(me->flash);
        lv_timer_resume(me->flash);
    }
}

/* ---- Home ---- */

/** @brief A tap on Learn from the first page. @param e The event. */
static void home_learn_cb(lv_event_t *e)
{
    (void)e;
    s_ao.target = -1;
    learn_start(&s_ao);
    s_ao.learn_depth = (uint8_t)(kit_depth(&s_ao.kit) + 1U);
    kit_push(&s_ao.kit, &page_learn, &s_ao);
}

/** @brief A tap on Remotes. @param e The event. */
static void home_remotes_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_remotes, &s_ao);
}

/**
 * @brief The first page: learn a button, or open the saved remotes.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    IrKitAo * const  me   = (IrKitAo *)arg;
    lv_obj_t * const body = kit_page(kit, "IR Remote");
    char             sub[40];

    me->want = false;
    (void)kit_row(kit, body, "Learn", "Point a remote at the Dot", &app_glyph_signal_40, NULL, KUI_COLOR_ACTION,
                  &home_learn_cb, me);
    if ( 0U == me->nremotes )
    {
        (void)snprintf(sub, sizeof(sub), "Nothing saved yet");
    }
    else
    {
        (void)snprintf(sub, sizeof(sub), "%u saved", (unsigned)me->nremotes);
    }
    (void)kit_row(kit, body, "Remotes", sub, &app_glyph_ir_40, NULL, KUI_COLOR_ACCENT, &home_remotes_cb, me);
}

/* ---- Learn ---- */

/** @brief Try again. @param e The event. */
static void learn_again_cb(lv_event_t *e)
{
    (void)e;
    learn_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/** @brief Stop waiting and leave. @param e The event. */
static void learn_cancel_cb(lv_event_t *e)
{
    (void)e;
    s_ao.want = false;
    (void)kit_back(&s_ao.kit);
}

/** @brief Send what was heard, to check it. @param e The event. */
static void learn_test_cb(lv_event_t *e)
{
    (void)e;
    (void)send_signal(&s_ao, &s_ao.found);
}

/**
 * @brief Save the button that was named, then show that it is saved.
 * @param me   The Active Object.
 * @param text The button's name.
 */
static void button_named(IrKitAo *me, char const *text)
{
    if ( (IR_MAX_BUTTONS > me->nbuttons) && (0 <= me->target) )
    {
        ir_button_t * const b = &me->buttons[me->nbuttons];

        *b = me->found;
        (void)strncpy(b->name, text, IR_BTN_NAME_MAX);
        b->name[IR_BTN_NAME_MAX] = '\0';
        b->remote                = (uint8_t)me->target;
        (void)strncpy(me->last, b->name, IR_BTN_NAME_MAX);
        me->last[IR_BTN_NAME_MAX] = '\0';
        me->nbuttons++;
        kit_store_save(&me->store);
        me->lstate = IR_L_SAVED;
    }
    (void)kit_pop_to(&me->kit, me->learn_depth);
}

/** @brief Ask for the button's name. @param me The Active Object. */
static void ask_button_name(IrKitAo *me)
{
    me->namefor      = IR_NAME_NEW_BUTTON;
    me->name.max     = (uint8_t)IR_BTN_NAME_MAX;
    me->name.mode    = 1U;
    me->name.title   = "Name the button";
    me->name.answer  = "Save";
    next_button_name(me, (uint8_t)me->target, me->name.text);
}

/**
 * @brief A name was typed, whichever name page it was.
 * @param user The Active Object.
 * @param text The name.
 */
static void name_done(void *user, const char *text)
{
    IrKitAo * const me = (IrKitAo *)user;

    switch ( me->namefor )
    {
        case IR_NAME_NEW_REMOTE:
        {
            if ( IR_MAX_REMOTES > me->nremotes )
            {
                (void)strncpy(me->remotes[me->nremotes].name, text, IR_REM_NAME_MAX);
                me->remotes[me->nremotes].name[IR_REM_NAME_MAX] = '\0';
                me->target                                      = (int8_t)me->nremotes;
                me->nremotes++;
                ask_button_name(me);
                kit_replace(&me->kit, &kit_name_page, &me->name);
            }
            break;
        }
        case IR_NAME_NEW_BUTTON:
        {
            button_named(me, text);
            break;
        }
        case IR_NAME_REN_REMOTE:
        {
            if ( me->rsel < me->nremotes )
            {
                (void)strncpy(me->remotes[me->rsel].name, text, IR_REM_NAME_MAX);
                me->remotes[me->rsel].name[IR_REM_NAME_MAX] = '\0';
                kit_store_save(&me->store);
            }
            (void)kit_pop_to(&me->kit, kit_depth(&me->kit) - 2U);
            break;
        }
        case IR_NAME_REN_BUTTON:
        default:
        {
            if ( me->bsel < me->nbuttons )
            {
                (void)strncpy(me->buttons[me->bsel].name, text, IR_BTN_NAME_MAX);
                me->buttons[me->bsel].name[IR_BTN_NAME_MAX] = '\0';
                kit_store_save(&me->store);
            }
            (void)kit_back(&me->kit);
            break;
        }
    }
}

/** @brief Save: pick a remote, or start one. @param e The event. */
static void learn_save_cb(lv_event_t *e)
{
    IrKitAo * const me = &s_ao;

    (void)e;
    me->name.done = &name_done;
    me->name.user = me;
    if ( 0 <= me->target )
    {
        ask_button_name(me);
        kit_push(&me->kit, &kit_name_page, &me->name);
    }
    else if ( 0U == me->nremotes )
    {
        me->namefor     = IR_NAME_NEW_REMOTE;
        me->name.max    = (uint8_t)IR_REM_NAME_MAX;
        me->name.mode   = 1U;
        me->name.title  = "Name the remote";
        me->name.answer = "Next";
        next_remote_name(me, me->name.text);
        kit_push(&me->kit, &kit_name_page, &me->name);
    }
    else
    {
        kit_push(&me->kit, &page_pick, me);
    }
}

/** @brief Done: back to where Learn was opened from. @param e The event. */
static void learn_done_cb(lv_event_t *e)
{
    (void)e;
    s_ao.lstate = IR_L_WAIT;
    if ( 0 <= s_ao.target )
    {
        s_ao.rsel = (uint8_t)s_ao.target;
    }
    if ( 2U < s_ao.learn_depth )
    {
        (void)kit_back(&s_ao.kit);
    }
    else
    {
        kit_home(&s_ao.kit);
        kit_push(&s_ao.kit, &page_remotes, &s_ao);
        s_ao.rsel = (uint8_t)s_ao.target;
        kit_push(&s_ao.kit, &page_remote, &s_ao);
    }
}

/** @brief Another: listen again for the same remote. @param e The event. */
static void learn_another_cb(lv_event_t *e)
{
    (void)e;
    learn_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/**
 * @brief Two buttons side by side at the foot of a page.
 * @param kit    The kit.
 * @param page   The page.
 * @param left   The left one's word.
 * @param lkind  Its kind.
 * @param lcb    Its callback.
 * @param right  The right one's word.
 * @param rkind  Its kind.
 * @param rcb    Its callback.
 */
static void foot_two(kit_t *kit, lv_obj_t *page, char const *left, kit_btn_kind_t lkind, lv_event_cb_t lcb,
                     char const *right, kit_btn_kind_t rkind, lv_event_cb_t rcb)
{
    lv_obj_t * const l = kit_button(kit, page, left, lkind, IR_HALF_W, lcb, &s_ao);
    lv_obj_t * const r = kit_button(kit, page, right, rkind, IR_HALF_W, rcb, &s_ao);

    lv_obj_set_pos(l, KIT_SIDE, IR_FOOT_Y);
    lv_obj_set_pos(r, KBSP_LCD_H_RES - KIT_SIDE - IR_HALF_W, IR_FOOT_Y);
}

/**
 * @brief The Learn page: listening, what was heard, or why nothing was.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_learn(kit_t *kit, void *arg)
{
    IrKitAo * const  me   = (IrKitAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn  = NULL;
    char             line[96];

    kit_no_swipe(kit);
    switch ( me->lstate )
    {
        case IR_L_WAIT:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_signal_96, "Point a remote",
                            "Press a button on it. Listening for 10 seconds");
            btn = kit_button(kit, page, "Cancel", KIT_BTN_QUIET, KUI_ACTION_W, &learn_cancel_cb, me);
            break;
        }
        case IR_L_NEC:
        {
            (void)snprintf(line, sizeof(line), "Address 0x%04X\nCommand 0x%04X", (unsigned)me->found.addr,
                           (unsigned)me->found.cmd);
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_ir_96, "NEC signal", line);
            foot_two(kit, page, "Test", KIT_BTN_QUIET, &learn_test_cb, "Save", KIT_BTN_ACTION, &learn_save_cb);
            break;
        }
        case IR_L_RAW:
        {
            (void)snprintf(line, sizeof(line), "%u pulses.\nIt can be sent back as heard", (unsigned)me->found_total);
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_wave_96, "Raw signal", line);
            foot_two(kit, page, "Test", KIT_BTN_QUIET, &learn_test_cb, "Save", KIT_BTN_ACTION, &learn_save_cb);
            break;
        }
        case IR_L_LONG:
        {
            (void)snprintf(line, sizeof(line), "%u pulses is more than the Dot keeps (%u)", (unsigned)me->found_total,
                           (unsigned)IR_KEEP);
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wave_96, "Too long to save", line);
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &learn_again_cb, me);
            break;
        }
        case IR_L_SAVED:
        {
            (void)snprintf(line, sizeof(line), "%s in %s", me->last,
                           (0 <= me->target) ? me->remotes[me->target].name : "");
            (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_check_96, "Saved", line);
            foot_two(kit, page, "Done", KIT_BTN_QUIET, &learn_done_cb, "Another", KIT_BTN_ACTION, &learn_another_cb);
            break;
        }
        case IR_L_NOIR:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_signal_96, "No infrared",
                            "This Dot has no infrared receiver");
            btn = kit_button(kit, page, "Back", KIT_BTN_QUIET, KUI_ACTION_W, &learn_cancel_cb, me);
            break;
        }
        case IR_L_BUSY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_signal_96, "Receiver is busy",
                            "Something else is using it. Try again in a moment");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &learn_again_cb, me);
            break;
        }
        case IR_L_NONE:
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_signal_96, "Nothing heard",
                            "Aim the remote at the Dot and press a button");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &learn_again_cb, me);
            break;
        }
    }
    if ( NULL != btn )
    {
        lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, IR_FOOT_Y);
    }
}

/* ---- Which remote does it go in ---- */

/** @brief A remote was picked. @param e The event. */
static void pick_cb(lv_event_t *e)
{
    IrKitAo * const me = &s_ao;
    uint8_t const   r  = (uint8_t)(uintptr_t)lv_event_get_user_data(e);

    me->target = (int8_t)r;
    ask_button_name(me);
    kit_replace(&me->kit, &kit_name_page, &me->name);
}

/** @brief New remote was picked. @param e The event. */
static void pick_new_cb(lv_event_t *e)
{
    IrKitAo * const me = &s_ao;

    (void)e;
    me->namefor     = IR_NAME_NEW_REMOTE;
    me->name.max    = (uint8_t)IR_REM_NAME_MAX;
    me->name.mode   = 1U;
    me->name.title  = "Name the remote";
    me->name.answer = "Next";
    next_remote_name(me, me->name.text);
    kit_replace(&me->kit, &kit_name_page, &me->name);
}

/**
 * @brief Which remote the button goes in.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_pick(kit_t *kit, void *arg)
{
    IrKitAo * const  me   = (IrKitAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Save to");

    for ( uint32_t i = 0U; i < me->nremotes; ++i )
    {
        char sub[24];

        (void)snprintf(sub, sizeof(sub), "%u buttons", (unsigned)remote_count(me, (uint8_t)i));
        (void)kit_row(kit, body, me->remotes[i].name, sub, &app_glyph_ir_40, NULL, KUI_COLOR_ACCENT, &pick_cb,
                      (void *)(uintptr_t)i);
    }
    if ( IR_MAX_REMOTES > me->nremotes )
    {
        (void)kit_row(kit, body, "New remote", "Make another one", &app_glyph_plus_40, NULL, KUI_COLOR_ACTION,
                      &pick_new_cb, me);
    }
}

/* ---- Remotes ---- */

/** @brief A tap on a remote. @param e The event. */
static void remotes_pick_cb(lv_event_t *e)
{
    s_ao.rsel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    kit_push(&s_ao.kit, &page_remote, &s_ao);
}

/**
 * @brief The saved remotes, or what to do when there are none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_remotes(kit_t *kit, void *arg)
{
    IrKitAo * const me = (IrKitAo *)arg;

    if ( 0U == me->nremotes )
    {
        lv_obj_t * const page = kit_page_bare(kit);
        lv_obj_t * const btn  = kit_button(kit, page, "Learn a button", KIT_BTN_ACTION, KUI_ACTION_W, &home_learn_cb, me);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_ir_96, "Nothing saved yet",
                        "Learn a button and save it to find it here");
        lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, IR_FOOT_Y);
        kit_bar(kit, page, "Remotes");
        return;
    }
    {
        lv_obj_t * const body = kit_page(kit, "Remotes");

        for ( uint32_t i = 0U; i < me->nremotes; ++i )
        {
            char sub[24];

            (void)snprintf(sub, sizeof(sub), "%u buttons", (unsigned)remote_count(me, (uint8_t)i));
            (void)kit_row(kit, body, me->remotes[i].name, sub, &app_glyph_ir_40, NULL, KUI_COLOR_ACCENT,
                          &remotes_pick_cb, (void *)(uintptr_t)i);
        }
    }
}

/* ---- One remote ---- */

/** @brief A tap on a button: send it. @param e The event. */
static void remote_send_cb(lv_event_t *e)
{
    IrKitAo * const me  = &s_ao;
    uint32_t const  row = (uint32_t)(uintptr_t)lv_event_get_user_data(e);

    if ( row < me->nrows )
    {
        bool const ok = send_signal(me, &me->buttons[me->rows_btn[row]]);

        say_on_row(me, row, ok ? "Sent" : "Could not send");
    }
}

/** @brief A tap on Add button. @param e The event. */
static void remote_add_cb(lv_event_t *e)
{
    (void)e;
    s_ao.target      = (int8_t)s_ao.rsel;
    s_ao.learn_depth = (uint8_t)(kit_depth(&s_ao.kit) + 1U);
    learn_start(&s_ao);
    kit_push(&s_ao.kit, &page_learn, &s_ao);
}

/** @brief A tap on Edit remote. @param e The event. */
static void remote_edit_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_edit, &s_ao);
}

/**
 * @brief A remote: its buttons as big pills that send, and the ways to change it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_remote(kit_t *kit, void *arg)
{
    IrKitAo * const  me = (IrKitAo *)arg;
    lv_obj_t        *body;

    if ( me->rsel >= me->nremotes )
    {
        (void)kit_back(kit);
        return;
    }
    body       = kit_page(kit, me->remotes[me->rsel].name);
    me->nrows  = 0U;
    for ( uint32_t i = 0U; i < me->nbuttons; ++i )
    {
        if ( me->rsel == me->buttons[i].remote )
        {
            char         sub[24];
            lv_obj_t    *row;
            uint32_t const k = me->nrows;

            button_sub(&me->buttons[i], sub, sizeof(sub));
            if ( is_power(me->buttons[i].name) )
            {
                row = kit_row(kit, body, me->buttons[i].name, sub, &app_glyph_power_40, NULL, KUI_COLOR_ACTION,
                              &remote_send_cb, (void *)(uintptr_t)k);
            }
            else
            {
                char letter[2] = { me->buttons[i].name[0], '\0' };

                row = kit_row(kit, body, me->buttons[i].name, sub, NULL, letter, KUI_COLOR_ACTION, &remote_send_cb,
                              (void *)(uintptr_t)k);
            }
            /* Held, the button repeats: the first repeat comes once the press is long, so a tap is one frame. */
            lv_obj_add_event_cb(row, &remote_send_cb, LV_EVENT_LONG_PRESSED, (void *)(uintptr_t)k);
            lv_obj_add_event_cb(row, &remote_send_cb, LV_EVENT_LONG_PRESSED_REPEAT, (void *)(uintptr_t)k);
            me->rows[k]     = row;
            me->rows_btn[k] = (uint8_t)i;
            me->nrows++;
        }
    }
    if ( IR_MAX_BUTTONS > me->nbuttons )
    {
        (void)kit_row(kit, body, "Add button", "Learn another one", &app_glyph_plus_40, NULL, KUI_COLOR_ACCENT,
                      &remote_add_cb, me);
    }
    (void)kit_row(kit, body, "Edit remote", "Rename or delete", &app_glyph_edit_40, NULL, KUI_COLOR_ACCENT,
                  &remote_edit_cb, me);
}

/* ---- Edit a remote ---- */

/** @brief A tap on Rename remote. @param e The event. */
static void edit_rename_cb(lv_event_t *e)
{
    IrKitAo * const me = &s_ao;

    (void)e;
    me->namefor     = IR_NAME_REN_REMOTE;
    me->name.done   = &name_done;
    me->name.user   = me;
    me->name.max    = (uint8_t)IR_REM_NAME_MAX;
    me->name.mode   = 1U;
    me->name.title  = "Rename remote";
    me->name.answer = "Save";
    (void)strncpy(me->name.text, me->remotes[me->rsel].name, sizeof(me->name.text) - 1U);
    me->name.text[sizeof(me->name.text) - 1U] = '\0';
    kit_push(&me->kit, &kit_name_page, &me->name);
}

/** @brief A tap on a button to edit it. @param e The event. */
static void edit_pick_cb(lv_event_t *e)
{
    s_ao.bsel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    kit_push(&s_ao.kit, &page_button, &s_ao);
}

/** @brief A tap on Delete remote. @param e The event. */
static void edit_delete_cb(lv_event_t *e)
{
    (void)e;
    s_ao.del = IR_DEL_REMOTE;
    kit_push(&s_ao.kit, &page_delete, &s_ao);
}

/**
 * @brief Edit a remote: rename it, pick a button to change, or delete all of it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_edit(kit_t *kit, void *arg)
{
    IrKitAo * const  me   = (IrKitAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Edit remote");
    lv_obj_t        *row;

    if ( me->rsel >= me->nremotes )
    {
        (void)kit_back(kit);
        return;
    }
    (void)kit_row(kit, body, "Rename", me->remotes[me->rsel].name, &app_glyph_edit_40, NULL, KUI_COLOR_ACTION,
                  &edit_rename_cb, me);
    for ( uint32_t i = 0U; i < me->nbuttons; ++i )
    {
        if ( me->rsel == me->buttons[i].remote )
        {
            char sub[24];

            button_sub(&me->buttons[i], sub, sizeof(sub));
            (void)kit_row(kit, body, me->buttons[i].name, sub, NULL, "...", KUI_COLOR_ACCENT, &edit_pick_cb,
                          (void *)(uintptr_t)i);
        }
    }
    row = kit_row(kit, body, "Delete remote", "With all its buttons", &app_glyph_trash_40, NULL, KUI_COLOR_DANGER,
                  &edit_delete_cb, me);
    kit_row_danger(row);
}

/* ---- One button ---- */

/** @brief A tap on Rename button. @param e The event. */
static void button_rename_cb(lv_event_t *e)
{
    IrKitAo * const me = &s_ao;

    (void)e;
    me->namefor     = IR_NAME_REN_BUTTON;
    me->name.done   = &name_done;
    me->name.user   = me;
    me->name.max    = (uint8_t)IR_BTN_NAME_MAX;
    me->name.mode   = 1U;
    me->name.title  = "Rename button";
    me->name.answer = "Save";
    (void)strncpy(me->name.text, me->buttons[me->bsel].name, sizeof(me->name.text) - 1U);
    me->name.text[sizeof(me->name.text) - 1U] = '\0';
    kit_push(&me->kit, &kit_name_page, &me->name);
}

/** @brief A tap on Delete button. @param e The event. */
static void button_delete_cb(lv_event_t *e)
{
    (void)e;
    s_ao.del = IR_DEL_BUTTON;
    kit_push(&s_ao.kit, &page_delete, &s_ao);
}

/**
 * @brief A button: what it is, and rename or delete.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_button(kit_t *kit, void *arg)
{
    IrKitAo * const     me = (IrKitAo *)arg;
    lv_obj_t           *page;
    lv_obj_t           *row;
    ir_button_t const  *b;
    char                line[64];

    if ( me->bsel >= me->nbuttons )
    {
        (void)kit_back(kit);
        return;
    }
    b    = &me->buttons[me->bsel];
    page = kit_page_bare(kit);
    (void)kit_text(page, (IR_KIND_NEC == b->kind) ? "NEC signal" : "Raw signal", &kui_font_body, KUI_COLOR_TEXT_MUTED,
                   KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 78);
    if ( IR_KIND_NEC == b->kind )
    {
        (void)snprintf(line, sizeof(line), "%04X  %04X", (unsigned)b->addr, (unsigned)b->cmd);
    }
    else
    {
        (void)snprintf(line, sizeof(line), "%u pulses", (unsigned)b->n);
    }
    (void)kit_text(page, line, &kui_font_name, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 114);
    (void)kit_text(page, (IR_KIND_NEC == b->kind) ? "Address, then command" : "Sent as it was heard",
                   &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 160);
    row = kit_row(kit, page, "Rename", "Change its name", &app_glyph_edit_40, NULL, KUI_COLOR_ACTION,
                  &button_rename_cb, me);
    lv_obj_set_pos(row, KIT_SIDE, 250);
    row = kit_row(kit, page, "Delete", "Remove it from the remote", &app_glyph_trash_40, NULL, KUI_COLOR_DANGER,
                  &button_delete_cb, me);
    kit_row_danger(row);
    lv_obj_set_pos(row, KIT_SIDE, 342);
    kit_bar(kit, page, b->name);
}

/* ---- Delete ---- */

/** @brief Delete it. @param e The event. */
static void delete_yes_cb(lv_event_t *e)
{
    IrKitAo * const me = &s_ao;

    (void)e;
    if ( IR_DEL_BUTTON == me->del )
    {
        if ( me->bsel < me->nbuttons )
        {
            for ( uint32_t i = me->bsel; (i + 1U) < me->nbuttons; ++i )
            {
                me->buttons[i] = me->buttons[i + 1U];
            }
            me->nbuttons--;
        }
        kit_store_save(&me->store);
        (void)kit_pop_to(&me->kit, kit_depth(&me->kit) - 2U);
    }
    else
    {
        uint32_t keep = 0U;

        for ( uint32_t i = 0U; i < me->nbuttons; ++i )
        {
            if ( me->rsel != me->buttons[i].remote )
            {
                me->buttons[keep] = me->buttons[i];
                if ( me->buttons[keep].remote > me->rsel )
                {
                    me->buttons[keep].remote--;
                }
                keep++;
            }
        }
        me->nbuttons = (uint8_t)keep;
        for ( uint32_t i = me->rsel; (i + 1U) < me->nremotes; ++i )
        {
            me->remotes[i] = me->remotes[i + 1U];
        }
        if ( 0U < me->nremotes )
        {
            me->nremotes--;
        }
        kit_store_save(&me->store);
        (void)kit_pop_to(&me->kit, 2U);
    }
}

/**
 * @brief The question before a delete: nothing is lost by one tap.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_delete(kit_t *kit, void *arg)
{
    IrKitAo * const  me   = (IrKitAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;
    char const      *what = "";

    if ( IR_DEL_BUTTON == me->del )
    {
        if ( me->bsel < me->nbuttons )
        {
            what = me->buttons[me->bsel].name;
        }
    }
    else if ( me->rsel < me->nremotes )
    {
        what = me->remotes[me->rsel].name;
    }
    else
    {
        /* Gone already. */
    }
    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_trash_96, "Delete?", what);
    btn = kit_button(kit, page, "Delete", KIT_BTN_DANGER, KUI_ACTION_W, &delete_yes_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, IR_FOOT_Y);
}

/* ---- The Active Object ---- */

void IrKitAo_ctor(void)
{
    IrKitAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&IrKitAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)IRKIT_TICK_SIG);
    kit_store_init(&me->store, &me->super, IR_DIR, IR_FILE, s_file, sizeof(s_file), &ir_pack, me);
    me->target = -1;
}

void IrKitAo_start(void)
{
    QActive_setAttr(AO_IrKit, TASK_NAME_ATTR, "ir_kit_ao");
    QACTIVE_START(AO_IrKit, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe, ask for the panel and the saved remotes, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to IrKitAo_running.
 */
static QState IrKitAo_initial(IrKitAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    kit_store_load(&me->store);
    KLOG_I(TAG, "up");
    return Q_TRAN(&IrKitAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState IrKitAo_running(IrKitAo * const me, QEvt const * const e)
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
        case IR_CAPTURE_RSP_SIG:
        {
            capture_answer(me, Q_EVT_CAST(kode_sys_ir_capture_answer_t));
            break;
        }
        case IR_LAST_RSP_SIG:
        {
            last_answer(me, Q_EVT_CAST(kode_sys_ir_last_answer_t));
            break;
        }
        case IR_SEND_RAW_RSP_SIG:
        {
            me->tx_out = false;
            if ( KODE_OK != (kode_status_t)Q_EVT_CAST(kode_sys_ir_send_answer_t)->rc )
            {
                KLOG_W(TAG, "a raw frame was not sent");
                for ( uint32_t i = 0U; i < me->nrows; ++i )
                {
                    say_on_row(me, i, "Not sent");
                }
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
                    ir_unpack(me, len);
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
