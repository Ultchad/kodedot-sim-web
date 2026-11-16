/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file rfid_ao.c
 * @brief The RFID app's Active Object: read a 125 kHz tag, save it, list the saved ones, emulate, write to a T5577 or delete.
 */
#include "rfid_ao.h"

#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "kit.h"
#include "kit_store.h"

#define TAG "rfid.ao"   /**< This file's log tag. */

#define RFID_DIR        "/storage/rfid_kit"            /**< The app's folder on the internal volume. */
#define RFID_FILE       "/storage/rfid_kit/saved.bin"  /**< What is kept: the saved tags. */
#define RFID_MAGIC      0x31444652UL                   /**< "RFD1", the file's first four bytes. */
#define RFID_MAX_SAVED  16U                            /**< Tags the app keeps. */
#define RFID_NAME_MAX   20U                            /**< The longest name, NUL excluded. */
#define RFID_READ_MS    8000U                          /**< How long a read keeps the field up. */
#define RFID_WRITE_MS   8000U                          /**< How long a write waits for a tag. */
#define RFID_HEAD_BYTES 8U                             /**< Magic and count. */
#define RFID_FOOT_Y     402                            /**< Where a page's one button stands. */

/** @brief This app's own signals. */
enum RfidKitSignals
{
    RFIDKIT_TICK_SIG = MAX_SIG   /**< The render pass: kscreen's one-shot. */
};

/** @brief One saved tag, as it is kept in the file. */
typedef struct {
    char    name[RFID_NAME_MAX + 1U];       /**< What the person called it. */
    uint8_t id[KODE_SYS_RFID_ID_BYTES];     /**< The 40-bit EM4100 ID. */
    uint8_t pad[2];                         /**< Keeps the record's size even. */
} rfid_item_t;

/** @brief What the Read page is showing. */
typedef enum {
    RFID_R_WAIT = 0,   /**< Waiting for a tag. */
    RFID_R_FOUND,      /**< A tag was read. */
    RFID_R_SAVED,      /**< It was saved. */
    RFID_R_NOTAG,      /**< The window closed empty. */
    RFID_R_BUSY        /**< The front end is held. */
} rfid_rstate_t;

/** @brief What the Write page is showing. */
typedef enum {
    RFID_W_READY = 0,  /**< Told to hold a T5577, waiting for the tap. */
    RFID_W_WRITING,    /**< The write is out. */
    RFID_W_OK,         /**< Written and read back. */
    RFID_W_FAILED,     /**< It did not take. */
    RFID_W_BUSY        /**< The front end is held. */
} rfid_wstate_t;

/** @brief What the Emulate page is showing. */
typedef enum {
    RFID_E_STARTING = 0,   /**< The tag is being armed. */
    RFID_E_PLAYING,        /**< A reader may read it. */
    RFID_E_FAILED,         /**< It would not start. */
    RFID_E_IDLE            /**< Nothing plays. */
} rfid_estate_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive       super;                         /**< The QP/C base; must stay first. */
    kit_t         kit;                           /**< The screens. */
    kit_store_t   store;                         /**< The saved file. */
    rfid_item_t   saved[RFID_MAX_SAVED];         /**< The saved tags. */
    uint8_t       count;                         /**< How many. */
    rfid_item_t   found;                         /**< The tag just read. */
    uint8_t       rate;                          /**< The bit rate divider it was read at. */
    rfid_rstate_t rstate;                        /**< The Read page's state. */
    rfid_wstate_t wstate;                        /**< The Write page's state. */
    bool          op_out;                        /**< A read or a write request is out. */
    bool          want;                          /**< Its answer is still wanted. */
    rfid_estate_t estate;                        /**< The Emulate page's state. */
    bool          emu_out;                       /**< The tag is armed or being armed. */
    uint8_t       sel;                           /**< The saved tag a page is about. */
    kit_name_t    name;                          /**< The name being typed. */
    char          last[RFID_NAME_MAX + 1U];      /**< The name just saved. */
} RfidKitAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static uint8_t     s_file[RFID_HEAD_BYTES + (RFID_MAX_SAVED * sizeof(rfid_item_t))];   /**< The file's lent buffer. */
static RfidKitAo   s_ao;                                               /**< The one instance. */

QActive * const AO_RfidKit = &s_ao.super;

static QState RfidKitAo_initial(RfidKitAo * const me, void const * const par);
static QState RfidKitAo_running(RfidKitAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_read(kit_t *kit, void *arg);
static void   page_saved(kit_t *kit, void *arg);
static void   page_item(kit_t *kit, void *arg);
static void   page_emulate(kit_t *kit, void *arg);
static void   page_write(kit_t *kit, void *arg);
static void   page_delete(kit_t *kit, void *arg);

/* ---- The saved file ---- */

/**
 * @brief Fill the file buffer from the saved tags.
 * @param ctx The Active Object.
 * @param buf The buffer.
 * @param cap Its size.
 * @return The bytes.
 */
static uint32_t rfid_pack(void *ctx, uint8_t *buf, uint32_t cap)
{
    RfidKitAo * const me    = (RfidKitAo *)ctx;
    uint32_t const    magic = RFID_MAGIC;
    uint32_t const    n     = RFID_HEAD_BYTES + ((uint32_t)me->count * (uint32_t)sizeof(rfid_item_t));

    if ( n > cap )
    {
        return 0U;
    }
    (void)memcpy(buf, &magic, sizeof(magic));
    buf[4] = me->count;
    buf[5] = 0U;
    buf[6] = 0U;
    buf[7] = 0U;
    (void)memcpy(&buf[RFID_HEAD_BYTES], me->saved, (size_t)me->count * sizeof(rfid_item_t));
    return n;
}

/**
 * @brief Read the saved tags back from the file buffer.
 * @param me  The Active Object.
 * @param len The bytes read.
 */
static void rfid_unpack(RfidKitAo *me, uint32_t len)
{
    uint32_t magic = 0U;

    if ( RFID_HEAD_BYTES > len )
    {
        return;
    }
    (void)memcpy(&magic, s_file, sizeof(magic));
    if ( (RFID_MAGIC == magic) && (RFID_MAX_SAVED >= s_file[4])
         && (len >= (RFID_HEAD_BYTES + ((uint32_t)s_file[4] * (uint32_t)sizeof(rfid_item_t)))) )
    {
        me->count = s_file[4];
        (void)memcpy(me->saved, &s_file[RFID_HEAD_BYTES], (size_t)me->count * sizeof(rfid_item_t));
        for ( uint32_t i = 0U; i < me->count; ++i )
        {
            me->saved[i].name[RFID_NAME_MAX] = '\0';
        }
    }
    else
    {
        KLOG_W(TAG, "the saved file is not ours; starting empty");
    }
}

/* ---- Words ---- */

/**
 * @brief An ID as hex pairs.
 * @param id  The five bytes.
 * @param out Where.
 * @param cap Its size.
 * @param sep The separator between bytes, or NUL for none.
 */
static void id_text(uint8_t const *id, char *out, size_t cap, char sep)
{
    if ( '\0' != sep )
    {
        (void)snprintf(out, cap, "%02X%c%02X%c%02X%c%02X%c%02X", (unsigned)id[0], sep, (unsigned)id[1], sep,
                       (unsigned)id[2], sep, (unsigned)id[3], sep, (unsigned)id[4]);
    }
    else
    {
        (void)snprintf(out, cap, "%02X%02X%02X%02X%02X", (unsigned)id[0], (unsigned)id[1], (unsigned)id[2],
                       (unsigned)id[3], (unsigned)id[4]);
    }
}

/**
 * @brief The next name for a tag: "Tag 1", "Tag 2" ... not yet used.
 * @param me  The Active Object.
 * @param out Where.
 */
static void next_name(RfidKitAo *me, char *out)
{
    for ( uint32_t n = 1U; n < 100U; ++n )
    {
        bool used = false;

        (void)snprintf(out, RFID_NAME_MAX + 1U, "Tag %u", (unsigned)n);
        for ( uint32_t i = 0U; i < me->count; ++i )
        {
            if ( 0 == strcmp(me->saved[i].name, out) )
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

/* ---- The front end ---- */

/**
 * @brief Ask for a tag, once: a second ask waits for the first one's answer.
 * @param me The Active Object.
 */
static void read_start(RfidKitAo *me)
{
    me->rstate = RFID_R_WAIT;
    me->want   = true;
    if ( !me->op_out )
    {
        if ( KODE_OK == kode_sys_rfid_read(&me->super, RFID_READ_MS) )
        {
            me->op_out = true;
        }
        else
        {
            me->want   = false;
            me->rstate = RFID_R_BUSY;
        }
    }
}

/**
 * @brief Ask for the selected tag to be written to a T5577.
 * @param me The Active Object.
 */
static void write_start(RfidKitAo *me)
{
    me->wstate = RFID_W_WRITING;
    me->want   = true;
    if ( !me->op_out )
    {
        if ( KODE_OK == kode_sys_rfid_write(&me->super, me->saved[me->sel].id, RFID_WRITE_MS) )
        {
            me->op_out = true;
        }
        else
        {
            me->want   = false;
            me->wstate = RFID_W_BUSY;
        }
    }
}

/**
 * @brief The front end answered a read or a write.
 * @param me  The Active Object.
 * @param ans The answer.
 */
static void op_answer(RfidKitAo *me, RfidOpRspEvt const *ans)
{
    me->op_out = false;
    if ( !me->want )
    {
        return;
    }
    me->want = false;
    if ( ans->write )
    {
        me->wstate = (KODE_OK == ans->rc) ? RFID_W_OK : ((KODE_DENIED == ans->rc) ? RFID_W_BUSY : RFID_W_FAILED);
        if ( page_write == kit_current(&me->kit) )
        {
            kit_refresh(&me->kit);
        }
        return;
    }
    if ( KODE_OK == ans->rc )
    {
        (void)memset(&me->found, 0, sizeof(me->found));
        (void)memcpy(me->found.id, ans->id, sizeof(me->found.id));
        me->rate   = ans->rf_div;
        me->rstate = RFID_R_FOUND;
    }
    else
    {
        me->rstate = (KODE_DENIED == ans->rc) ? RFID_R_BUSY : RFID_R_NOTAG;
    }
    if ( page_read == kit_current(&me->kit) )
    {
        kit_refresh(&me->kit);
    }
}

/**
 * @brief Stop what a page that is gone left playing.
 * @param me The Active Object.
 */
static void emu_leave(RfidKitAo *me)
{
    if ( me->emu_out )
    {
        (void)kode_sys_rfid_emulate_stop(&me->super);
        me->emu_out = false;
    }
    me->estate = RFID_E_IDLE;
}

/* ---- Home ---- */

/** @brief A tap on Read. @param e The event. */
static void home_read_cb(lv_event_t *e)
{
    (void)e;
    read_start(&s_ao);
    kit_push(&s_ao.kit, &page_read, &s_ao);
}

/** @brief A tap on Saved. @param e The event. */
static void home_saved_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_saved, &s_ao);
}

/**
 * @brief The first page: read a tag, or open the saved ones.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    RfidKitAo * const me   = (RfidKitAo *)arg;
    lv_obj_t * const  body = kit_page(kit, "RFID");
    char              sub[40];

    emu_leave(me);
    me->want = false;
    (void)kit_row(kit, body, "Read", "Hold a 125 kHz tag", &app_glyph_rfid_40, NULL, KUI_COLOR_ACTION,
                  &home_read_cb, me);
    if ( 0U == me->count )
    {
        (void)snprintf(sub, sizeof(sub), "Nothing saved yet");
    }
    else
    {
        (void)snprintf(sub, sizeof(sub), "%u saved", (unsigned)me->count);
    }
    (void)kit_row(kit, body, "Saved", sub, &app_glyph_card_40, NULL, KUI_COLOR_ACCENT, &home_saved_cb, me);
}

/* ---- Read ---- */

/** @brief Try again. @param e The event. */
static void read_again_cb(lv_event_t *e)
{
    (void)e;
    read_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/** @brief Stop waiting. @param e The event. */
static void read_cancel_cb(lv_event_t *e)
{
    (void)e;
    s_ao.want = false;
    (void)kit_back(&s_ao.kit);
}

/** @brief The name was typed. @param user The Active Object. @param text The name. */
static void save_done(void *user, const char *text)
{
    RfidKitAo * const me = (RfidKitAo *)user;

    if ( RFID_MAX_SAVED > me->count )
    {
        me->saved[me->count] = me->found;
        (void)strncpy(me->saved[me->count].name, text, RFID_NAME_MAX);
        me->saved[me->count].name[RFID_NAME_MAX] = '\0';
        (void)strncpy(me->last, me->saved[me->count].name, RFID_NAME_MAX);
        me->count++;
        kit_store_save(&me->store);
        me->rstate = RFID_R_SAVED;
    }
    (void)kit_back(&me->kit);
}

/** @brief Save: ask for a name. @param e The event. */
static void read_save_cb(lv_event_t *e)
{
    (void)e;
    s_ao.name.max    = (uint8_t)RFID_NAME_MAX;
    s_ao.name.mode   = 1U;
    s_ao.name.done   = &save_done;
    s_ao.name.user   = &s_ao;
    s_ao.name.title  = "Name it";
    s_ao.name.answer = "Save";
    next_name(&s_ao, s_ao.name.text);
    kit_push(&s_ao.kit, &kit_name_page, &s_ao.name);
}

/** @brief Done: back to the first page. @param e The event. */
static void read_done_cb(lv_event_t *e)
{
    (void)e;
    kit_home(&s_ao.kit);
}

/**
 * @brief The Read page: waiting, the tag that was found, or why there is none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_read(kit_t *kit, void *arg)
{
    RfidKitAo * const me   = (RfidKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    lv_obj_t         *btn;
    char              id[24];
    char              line[64];

    kit_no_swipe(kit);
    switch ( me->rstate )
    {
        case RFID_R_WAIT:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_rfid_96, "Hold a tag",
                            "Put the fob or card against the back of the Dot");
            btn = kit_button(kit, page, "Cancel", KIT_BTN_QUIET, KUI_ACTION_W, &read_cancel_cb, me);
            break;
        }
        case RFID_R_FOUND:
        {
            id_text(me->found.id, id, sizeof(id), ' ');
            (void)snprintf(line, sizeof(line), "%s\nRF/%u", id, (unsigned)me->rate);
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_rfid_96, "EM4100", line);
            btn = kit_button(kit, page, "Save", KIT_BTN_ACTION, KUI_ACTION_W, &read_save_cb, me);
            break;
        }
        case RFID_R_SAVED:
        {
            (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_check_96, "Saved", me->last);
            btn = kit_button(kit, page, "Done", KIT_BTN_ACTION, KUI_ACTION_W, &read_done_cb, me);
            break;
        }
        case RFID_R_BUSY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_rfid_96, "Reader is busy",
                            "Something else is using it. Try again in a moment");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &read_again_cb, me);
            break;
        }
        case RFID_R_NOTAG:
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_rfid_96, "No tag found",
                            "Hold it flat against the back and try again");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &read_again_cb, me);
            break;
        }
    }
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, RFID_FOOT_Y);
}

/* ---- Saved ---- */

/** @brief A tap on a saved tag. @param e The event. */
static void saved_pick_cb(lv_event_t *e)
{
    s_ao.sel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    kit_push(&s_ao.kit, &page_item, &s_ao);
}

/**
 * @brief The saved tags, or what to do when there are none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_saved(kit_t *kit, void *arg)
{
    RfidKitAo * const me = (RfidKitAo *)arg;

    emu_leave(me);
    if ( 0U == me->count )
    {
        lv_obj_t * const page = kit_page_bare(kit);
        lv_obj_t * const btn  = kit_button(kit, page, "Read a tag", KIT_BTN_ACTION, KUI_ACTION_W, &home_read_cb, me);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_card_96, "Nothing saved yet",
                        "Read a tag and save it to find it here");
        lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, RFID_FOOT_Y);
        kit_bar(kit, page, "Saved");
        return;
    }
    {
        lv_obj_t * const body = kit_page(kit, "Saved");

        for ( uint32_t i = 0U; i < me->count; ++i )
        {
            char id[24];

            id_text(me->saved[i].id, id, sizeof(id), '\0');
            (void)kit_row(kit, body, me->saved[i].name, id, &app_glyph_rfid_40, NULL, KUI_COLOR_ACCENT,
                          &saved_pick_cb, (void *)(uintptr_t)i);
        }
    }
}

/* ---- One saved tag ---- */

/** @brief A tap on Emulate. @param e The event. */
static void item_emulate_cb(lv_event_t *e)
{
    RfidKitAo * const me = &s_ao;

    (void)e;
    me->estate = RFID_E_STARTING;
    if ( KODE_OK == kode_sys_rfid_emulate_start(&me->super, me->saved[me->sel].id) )
    {
        me->emu_out = true;
    }
    else
    {
        me->estate = RFID_E_FAILED;
    }
    kit_push(&me->kit, &page_emulate, me);
}

/** @brief A tap on Write to tag. @param e The event. */
static void item_write_cb(lv_event_t *e)
{
    (void)e;
    s_ao.wstate = RFID_W_READY;
    kit_push(&s_ao.kit, &page_write, &s_ao);
}

/** @brief A tap on Delete. @param e The event. */
static void item_delete_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_delete, &s_ao);
}

/**
 * @brief A saved tag: its ID, and what can be done with it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_item(kit_t *kit, void *arg)
{
    RfidKitAo * const me = (RfidKitAo *)arg;
    lv_obj_t         *page;
    lv_obj_t         *row;
    char              id[24];

    emu_leave(me);
    if ( me->sel >= me->count )
    {
        (void)kit_back(kit);
        return;
    }
    page = kit_page_bare(kit);
    id_text(me->saved[me->sel].id, id, sizeof(id), ' ');
    (void)kit_text(page, "EM4100", &kui_font_body, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 70);
    (void)kit_text(page, id, &kui_font_name, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 106);
    row = kit_row(kit, page, "Emulate", "Play it to a reader", &app_glyph_play_40, NULL, KUI_COLOR_ACTION,
                  &item_emulate_cb, me);
    lv_obj_set_pos(row, KIT_SIDE, 166);
    row = kit_row(kit, page, "Write to tag", "Copy it onto a T5577", &app_glyph_edit_40, NULL, KUI_COLOR_ACCENT,
                  &item_write_cb, me);
    lv_obj_set_pos(row, KIT_SIDE, 258);
    row = kit_row(kit, page, "Delete", "Remove it from the Dot", &app_glyph_trash_40, NULL, KUI_COLOR_DANGER,
                  &item_delete_cb, me);
    kit_row_danger(row);
    lv_obj_set_pos(row, KIT_SIDE, 350);
    kit_bar(kit, page, me->saved[me->sel].name);
}

/* ---- Emulate ---- */

/** @brief Stop playing. @param e The event. */
static void emu_stop_cb(lv_event_t *e)
{
    (void)e;
    emu_leave(&s_ao);
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief The Emulate page.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_emulate(kit_t *kit, void *arg)
{
    RfidKitAo * const me   = (RfidKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    lv_obj_t         *btn;

    kit_no_swipe(kit);
    if ( RFID_E_FAILED == me->estate )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_rfid_96, "Could not start",
                        "The reader is busy or not fitted");
        btn = kit_button(kit, page, "Back", KIT_BTN_QUIET, KUI_ACTION_W, &emu_stop_cb, me);
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACTION, &app_glyph_rfid_96,
                        (RFID_E_PLAYING == me->estate) ? "Emulating" : "Starting", me->saved[me->sel].name);
        btn = kit_button(kit, page, "Stop", KIT_BTN_DANGER, KUI_ACTION_W, &emu_stop_cb, me);
    }
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, RFID_FOOT_Y);
}

/* ---- Write ---- */

/** @brief Cancel or leave the Write page. @param e The event. */
static void write_leave_cb(lv_event_t *e)
{
    (void)e;
    s_ao.want = false;
    (void)kit_back(&s_ao.kit);
}

/** @brief Try the write again. @param e The event. */
static void write_again_cb(lv_event_t *e)
{
    (void)e;
    write_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/**
 * @brief The Write page: waiting for a blank T5577, then the result.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_write(kit_t *kit, void *arg)
{
    RfidKitAo * const me   = (RfidKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    lv_obj_t         *btn;

    kit_no_swipe(kit);
    switch ( me->wstate )
    {
        case RFID_W_OK:
        {
            (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_check_96, "Written", "The tag now answers with this ID");
            btn = kit_button(kit, page, "Done", KIT_BTN_ACTION, KUI_ACTION_W, &write_leave_cb, me);
            break;
        }
        case RFID_W_FAILED:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_rfid_96, "Not written",
                            "Use a T5577 tag, hold it still, and try again");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &write_again_cb, me);
            break;
        }
        case RFID_W_BUSY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_rfid_96, "Reader is busy",
                            "Something else is using it. Try again in a moment");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &write_again_cb, me);
            break;
        }
        case RFID_W_WRITING:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_edit_96, "Writing", "Keep the tag still");
            btn = kit_button(kit, page, "Cancel", KIT_BTN_QUIET, KUI_ACTION_W, &write_leave_cb, me);
            break;
        }
        case RFID_W_READY:
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_edit_96, "Hold a T5577",
                            "Put the tag against the back, then tap Write. What is on it is replaced");
            btn = kit_button(kit, page, "Write", KIT_BTN_ACTION, KUI_ACTION_W, &write_again_cb, me);
            break;
        }
    }
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, RFID_FOOT_Y);
}

/* ---- Delete ---- */

/** @brief Delete it. @param e The event. */
static void delete_yes_cb(lv_event_t *e)
{
    RfidKitAo * const me = &s_ao;

    (void)e;
    if ( me->sel < me->count )
    {
        for ( uint32_t i = me->sel; (i + 1U) < me->count; ++i )
        {
            me->saved[i] = me->saved[i + 1U];
        }
        me->count--;
        kit_store_save(&me->store);
    }
    (void)kit_pop_to(&me->kit, kit_depth(&me->kit) - 2U);
}

/**
 * @brief The question before a delete.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_delete(kit_t *kit, void *arg)
{
    RfidKitAo * const me   = (RfidKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    lv_obj_t         *btn;

    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_trash_96, "Delete?",
                    (me->sel < me->count) ? me->saved[me->sel].name : "");
    btn = kit_button(kit, page, "Delete", KIT_BTN_DANGER, KUI_ACTION_W, &delete_yes_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, RFID_FOOT_Y);
}

/* ---- The Active Object ---- */

void RfidKitAo_ctor(void)
{
    RfidKitAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&RfidKitAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)RFIDKIT_TICK_SIG);
    kit_store_init(&me->store, &me->super, RFID_DIR, RFID_FILE, s_file, sizeof(s_file), &rfid_pack, me);
}

void RfidKitAo_start(void)
{
    QActive_setAttr(AO_RfidKit, TASK_NAME_ATTR, "rfid_kit_ao");
    QACTIVE_START(AO_RfidKit, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe, ask for the panel and the saved tags, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to RfidKitAo_running.
 */
static QState RfidKitAo_initial(RfidKitAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    kit_store_load(&me->store);
    KLOG_I(TAG, "up");
    return Q_TRAN(&RfidKitAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState RfidKitAo_running(RfidKitAo * const me, QEvt const * const e)
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
        case RFID_OP_RSP_SIG:
        {
            op_answer(me, Q_EVT_CAST(RfidOpRspEvt));
            break;
        }
        case RFID_EMU_RSP_SIG:
        {
            RfidEmuRspEvt const * const r = Q_EVT_CAST(RfidEmuRspEvt);

            if ( me->emu_out && (RFID_E_STARTING == me->estate) && !r->stop )
            {
                me->estate  = (KODE_OK == r->rc) ? RFID_E_PLAYING : RFID_E_FAILED;
                me->emu_out = (KODE_OK == r->rc);
                if ( page_emulate == kit_current(&me->kit) )
                {
                    kit_refresh(&me->kit);
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
                    rfid_unpack(me, len);
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
