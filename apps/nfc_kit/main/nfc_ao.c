/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file nfc_ao.c
 * @brief The NFC app's Active Object: read a tag, save it, list the saved ones, emulate or delete one.
 */
#include "nfc_ao.h"

#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "kit.h"
#include "kit_store.h"

#define TAG "nfc.ao"   /**< This file's log tag. */

#define NFC_DIR        "/storage/nfc_kit"            /**< The app's folder on the internal volume. */
#define NFC_FILE       "/storage/nfc_kit/saved.bin"  /**< What is kept: the saved cards. */
#define NFC_MAGIC      0x3143464EUL                  /**< "NFC1", the file's first four bytes. */
#define NFC_MAX_SAVED  16U                           /**< Cards the app keeps. */
#define NFC_NAME_MAX   20U                           /**< The longest name, NUL excluded. */
#define NFC_READ_MS    8000U                         /**< How long a read keeps the field up. */
#define NFC_HEAD_BYTES 8U                            /**< Magic and count. */
#define NFC_FOOT_Y     402                           /**< Where a page's one button stands. */
#define NFC_SHOW_CHARS 30U                           /**< How much of a message a page shows. */

/** @brief This app's own signals. */
enum NfcKitSignals
{
    NFCKIT_TICK_SIG = MAX_SIG   /**< The render pass: kscreen's one-shot. */
};

/** @brief One saved card, as it is kept in the file. */
typedef struct {
    char     name[NFC_NAME_MAX + 1U];            /**< What the person called it. */
    uint8_t  uid[KODE_SYS_NFC_UID_MAX];          /**< NFCID1. */
    uint8_t  uid_len;                            /**< 4, 7 or 10. */
    uint8_t  type;                               /**< A KODE_SYS_NFC_TYPE_x. */
    uint8_t  sak;                                /**< SEL_RES. */
    uint8_t  uri;                                /**< The message is a link. */
    uint16_t atqa;                               /**< SENS_RES. */
    char     text[KODE_SYS_NFC_TEXT_MAX];        /**< The message, empty when there is none. */
} nfc_item_t;

/** @brief What the Read page is showing. */
typedef enum {
    NFC_R_WAIT = 0,   /**< Waiting for a tag. */
    NFC_R_FOUND,      /**< A tag was read. */
    NFC_R_SAVED,      /**< It was saved. */
    NFC_R_NOTAG,      /**< The window closed empty. */
    NFC_R_NOREADER,   /**< No reader fitted. */
    NFC_R_BUSY        /**< The reader is held. */
} nfc_rstate_t;

/** @brief What the Emulate page is showing. */
typedef enum {
    NFC_E_STARTING = 0,   /**< The card is being armed. */
    NFC_E_PLAYING,        /**< A reader may read it. */
    NFC_E_FAILED,         /**< It would not start. */
    NFC_E_IDLE            /**< Nothing plays. */
} nfc_estate_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive      super;                          /**< The QP/C base; must stay first. */
    kit_t        kit;                            /**< The screens. */
    kit_store_t  store;                          /**< The saved file. */
    nfc_item_t   saved[NFC_MAX_SAVED];           /**< The saved cards. */
    uint8_t      count;                          /**< How many. */
    nfc_item_t   found;                          /**< The tag just read. */
    bool         have_ndef;                      /**< The tag just read carries a message. */
    uint8_t      ndef_note;                      /**< Why there is none: 0 none, 1 locked, 2 too long. */
    nfc_rstate_t rstate;                         /**< The Read page's state. */
    bool         read_out;                       /**< A read request is out. */
    bool         want;                           /**< The answer is still wanted. */
    nfc_estate_t estate;                         /**< The Emulate page's state. */
    bool         emu_out;                        /**< The card is armed or being armed. */
    uint8_t      sel;                            /**< The saved card a page is about. */
    kit_name_t   name;                           /**< The name being typed. */
    char         last[NFC_NAME_MAX + 1U];        /**< The name just saved. */
    NfcNdefRspEvt ans;                           /**< The last answer, copied. */
} NfcKitAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static uint8_t     s_file[NFC_HEAD_BYTES + (NFC_MAX_SAVED * sizeof(nfc_item_t))];   /**< The file's lent buffer. */
static NfcKitAo       s_ao;                                               /**< The one instance. */

QActive * const AO_NfcKit = &s_ao.super;

static QState NfcKitAo_initial(NfcKitAo * const me, void const * const par);
static QState NfcKitAo_running(NfcKitAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_read(kit_t *kit, void *arg);
static void   page_saved(kit_t *kit, void *arg);
static void   page_item(kit_t *kit, void *arg);
static void   page_emulate(kit_t *kit, void *arg);
static void   page_delete(kit_t *kit, void *arg);

/* ---- The saved file ---- */

/**
 * @brief Fill the file buffer from the saved cards.
 * @param ctx The Active Object.
 * @param buf The buffer.
 * @param cap Its size.
 * @return The bytes.
 */
static uint32_t nfc_pack(void *ctx, uint8_t *buf, uint32_t cap)
{
    NfcKitAo * const  me    = (NfcKitAo *)ctx;
    uint32_t const magic = NFC_MAGIC;
    uint32_t const n     = NFC_HEAD_BYTES + ((uint32_t)me->count * (uint32_t)sizeof(nfc_item_t));

    if ( n > cap )
    {
        return 0U;
    }
    (void)memcpy(buf, &magic, sizeof(magic));
    buf[4] = me->count;
    buf[5] = 0U;
    buf[6] = 0U;
    buf[7] = 0U;
    (void)memcpy(&buf[NFC_HEAD_BYTES], me->saved, (size_t)me->count * sizeof(nfc_item_t));
    return n;
}

/**
 * @brief Read the saved cards back from the file buffer.
 * @param me  The Active Object.
 * @param len The bytes read.
 */
static void nfc_unpack(NfcKitAo *me, uint32_t len)
{
    uint32_t magic = 0U;

    if ( NFC_HEAD_BYTES > len )
    {
        return;
    }
    (void)memcpy(&magic, s_file, sizeof(magic));
    if ( (NFC_MAGIC == magic) && (NFC_MAX_SAVED >= s_file[4])
         && (len >= (NFC_HEAD_BYTES + ((uint32_t)s_file[4] * (uint32_t)sizeof(nfc_item_t)))) )
    {
        me->count = s_file[4];
        (void)memcpy(me->saved, &s_file[NFC_HEAD_BYTES], (size_t)me->count * sizeof(nfc_item_t));
        for ( uint32_t i = 0U; i < me->count; ++i )
        {
            me->saved[i].name[NFC_NAME_MAX]               = '\0';
            me->saved[i].text[KODE_SYS_NFC_TEXT_MAX - 1U] = '\0';
        }
    }
    else
    {
        KLOG_W(TAG, "the saved file is not ours; starting empty");
    }
}

/* ---- Words ---- */

/**
 * @brief The kind of a tag in words.
 * @param type A KODE_SYS_NFC_TYPE_x.
 * @return The words.
 */
static const char *type_name(uint8_t type)
{
    const char *s = "NFC-A tag";

    if ( KODE_SYS_NFC_TYPE_T2T == type )
    {
        s = "Type 2 tag";
    }
    else if ( KODE_SYS_NFC_TYPE_T4T == type )
    {
        s = "Type 4 card";
    }
    else if ( KODE_SYS_NFC_TYPE_MIFARE == type )
    {
        s = "Mifare Classic";
    }
    else
    {
        /* Unknown. */
    }
    return s;
}

/**
 * @brief A UID as hex pairs.
 * @param it   The card.
 * @param out  Where.
 * @param cap  Its size.
 * @param sep  The separator between bytes, or NUL for none.
 */
static void uid_text(nfc_item_t const *it, char *out, size_t cap, char sep)
{
    size_t n = 0U;

    out[0] = '\0';
    for ( uint32_t i = 0U; (i < it->uid_len) && ((n + 4U) < cap); ++i )
    {
        n += (size_t)snprintf(&out[n], cap - n, "%02X", (unsigned)it->uid[i]);
        if ( ('\0' != sep) && ((i + 1U) < it->uid_len) && ((n + 2U) < cap) )
        {
            out[n++] = sep;
            out[n]   = '\0';
        }
    }
}

/**
 * @brief A message cut to what a page shows.
 * @param text The message.
 * @param out  Where.
 * @param cap  Its size.
 */
static void message_short(char const *text, char *out, size_t cap)
{
    (void)snprintf(out, cap, "%.*s%s", (int)NFC_SHOW_CHARS, text, (strlen(text) > NFC_SHOW_CHARS) ? "..." : "");
}

/**
 * @brief The next name for a card: "Tag 1", "Tag 2" ... not yet used.
 * @param me  The Active Object.
 * @param out Where.
 */
static void next_name(NfcKitAo *me, char *out)
{
    for ( uint32_t n = 1U; n < 100U; ++n )
    {
        bool used = false;

        (void)snprintf(out, NFC_NAME_MAX + 1U, "Tag %u", (unsigned)n);
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

/* ---- The reader ---- */

/**
 * @brief Ask for a tag, once: a second ask waits for the first one's answer.
 * @param me The Active Object.
 */
static void read_start(NfcKitAo *me)
{
    me->rstate = NFC_R_WAIT;
    me->want   = true;
    if ( !me->read_out )
    {
        if ( KODE_OK == kode_sys_nfc_ndef_read(&me->super, NFC_READ_MS) )
        {
            me->read_out = true;
        }
        else
        {
            me->want   = false;
            me->rstate = NFC_R_BUSY;
        }
    }
}

/**
 * @brief The reader answered.
 * @param me  The Active Object.
 * @param ans The answer.
 */
static void read_answer(NfcKitAo *me, NfcNdefRspEvt const *ans)
{
    me->read_out = false;
    if ( !me->want )
    {
        return;
    }
    me->want = false;
    if ( ans->have_tag )
    {
        (void)memset(&me->found, 0, sizeof(me->found));
        (void)memcpy(me->found.uid, ans->uid, sizeof(me->found.uid));
        me->found.uid_len = ans->uid_len;
        me->found.atqa    = ans->atqa;
        me->found.sak     = ans->sak;
        me->found.type    = ans->type;
        me->have_ndef     = (KODE_OK == ans->rc);
        me->ndef_note     = 0U;
        if ( me->have_ndef )
        {
            me->found.uri = ans->uri ? 1U : 0U;
            (void)strncpy(me->found.text, ans->text, sizeof(me->found.text) - 1U);
        }
        else if ( KODE_SYS_NFC_NDEF_LOCKED == ans->rc )
        {
            me->ndef_note = 1U;
        }
        else if ( KODE_SYS_NFC_NDEF_TOO_LONG == ans->rc )
        {
            me->ndef_note = 2U;
        }
        else
        {
            /* No message on it. */
        }
        me->rstate = NFC_R_FOUND;
    }
    else if ( KODE_IO_ERROR == ans->rc )
    {
        me->rstate = NFC_R_NOREADER;
    }
    else if ( KODE_DENIED == ans->rc )
    {
        me->rstate = NFC_R_BUSY;
    }
    else
    {
        me->rstate = NFC_R_NOTAG;
    }
    if ( page_read == kit_current(&me->kit) )
    {
        kit_refresh(&me->kit);
    }
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
 * @brief Stop what a page that is gone left playing.
 * @param me The Active Object.
 */
static void emu_leave(NfcKitAo *me)
{
    if ( me->emu_out )
    {
        (void)kode_sys_nfc_emulate_stop(&me->super);
        me->emu_out = false;
    }
    me->estate = NFC_E_IDLE;
}

/**
 * @brief The first page: read a tag, or open the saved ones.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    NfcKitAo * const    me   = (NfcKitAo *)arg;
    lv_obj_t * const body = kit_page(kit, "NFC");
    char             sub[40];

    emu_leave(me);
    me->want = false;
    (void)kit_row(kit, body, "Read", "Hold a tag to the back", &app_glyph_nfc_40, NULL, KUI_COLOR_ACTION,
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
    NfcKitAo * const me = (NfcKitAo *)user;

    if ( NFC_MAX_SAVED > me->count )
    {
        me->saved[me->count] = me->found;
        (void)strncpy(me->saved[me->count].name, text, NFC_NAME_MAX);
        me->saved[me->count].name[NFC_NAME_MAX] = '\0';
        (void)strncpy(me->last, me->saved[me->count].name, NFC_NAME_MAX);
        me->count++;
        kit_store_save(&me->store);
        me->rstate = NFC_R_SAVED;
    }
    (void)kit_back(&me->kit);
}

/** @brief Save: ask for a name. @param e The event. */
static void read_save_cb(lv_event_t *e)
{
    (void)e;
    s_ao.name.max    = (uint8_t)NFC_NAME_MAX;
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
    NfcKitAo * const    me   = (NfcKitAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;
    char             uid[40];
    char             line[160];
    char             msg[48];

    kit_no_swipe(kit);
    switch ( me->rstate )
    {
        case NFC_R_WAIT:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_nfc_96, "Hold a tag",
                            "Put it flat against the back of the Dot");
            btn = kit_button(kit, page, "Cancel", KIT_BTN_QUIET, KUI_ACTION_W, &read_cancel_cb, me);
            break;
        }
        case NFC_R_FOUND:
        {
            uid_text(&me->found, uid, sizeof(uid), ' ');
            if ( me->have_ndef )
            {
                message_short(me->found.text, msg, sizeof(msg));
                (void)snprintf(line, sizeof(line), "%s\n%s: %s", uid, me->found.uri ? "Link" : "Text", msg);
            }
            else
            {
                const char *why = (1U == me->ndef_note) ? "Locked, UID only"
                                  : ((2U == me->ndef_note) ? "Message too long to show" : "No message on it");

                (void)snprintf(line, sizeof(line), "%s\n%s", uid, why);
            }
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_tag_96, type_name(me->found.type), line);
            btn = kit_button(kit, page, "Save", KIT_BTN_ACTION, KUI_ACTION_W, &read_save_cb, me);
            break;
        }
        case NFC_R_SAVED:
        {
            (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_check_96, "Saved", me->last);
            btn = kit_button(kit, page, "Done", KIT_BTN_ACTION, KUI_ACTION_W, &read_done_cb, me);
            break;
        }
        case NFC_R_NOREADER:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_nfc_96, "No NFC reader",
                            "This Dot has no NFC antenna fitted");
            btn = kit_button(kit, page, "Back", KIT_BTN_QUIET, KUI_ACTION_W, &read_cancel_cb, me);
            break;
        }
        case NFC_R_BUSY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_nfc_96, "Reader is busy",
                            "Something else is using it. Try again in a moment");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &read_again_cb, me);
            break;
        }
        case NFC_R_NOTAG:
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_nfc_96, "No tag found",
                            "Hold it flat against the back and try again");
            btn = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &read_again_cb, me);
            break;
        }
    }
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, NFC_FOOT_Y);
}

/* ---- Saved ---- */

/** @brief A tap on a saved card. @param e The event. */
static void saved_pick_cb(lv_event_t *e)
{
    s_ao.sel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    kit_push(&s_ao.kit, &page_item, &s_ao);
}

/**
 * @brief The saved cards, or what to do when there are none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_saved(kit_t *kit, void *arg)
{
    NfcKitAo * const me = (NfcKitAo *)arg;

    emu_leave(me);
    if ( 0U == me->count )
    {
        lv_obj_t * const page = kit_page_bare(kit);
        lv_obj_t * const btn  = kit_button(kit, page, "Read a tag", KIT_BTN_ACTION, KUI_ACTION_W, &home_read_cb, me);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_card_96, "Nothing saved yet",
                        "Read a tag and save it to find it here");
        lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, NFC_FOOT_Y);
        kit_bar(kit, page, "Saved");
        return;
    }
    {
        lv_obj_t * const body = kit_page(kit, "Saved");

        for ( uint32_t i = 0U; i < me->count; ++i )
        {
            char sub[40];
            char uid[24];

            uid_text(&me->saved[i], uid, sizeof(uid), '\0');
            (void)snprintf(sub, sizeof(sub), "%s", uid);
            (void)kit_row(kit, body, me->saved[i].name, sub, &app_glyph_tag_40, NULL, KUI_COLOR_ACCENT,
                          &saved_pick_cb, (void *)(uintptr_t)i);
        }
    }
}

/* ---- One saved card ---- */

/** @brief A tap on Emulate. @param e The event. */
static void item_emulate_cb(lv_event_t *e)
{
    NfcKitAo * const me = &s_ao;
    nfc_item_t const *it = &me->saved[me->sel];
    kode_sys_nfc_card_t card;

    (void)e;
    (void)memset(&card, 0, sizeof(card));
    (void)memcpy(card.uid, it->uid, sizeof(card.uid));
    card.uid_len = it->uid_len;
    card.atqa    = it->atqa;
    card.sak     = it->sak;
    card.uri     = (0U != it->uri);
    (void)strncpy(card.ndef, it->text, KODE_SYS_NFC_EMU_NDEF_MAX);
    me->estate = NFC_E_STARTING;
    if ( KODE_OK == kode_sys_nfc_emulate_start(&me->super, &card) )
    {
        me->emu_out = true;
    }
    else
    {
        me->estate = NFC_E_FAILED;
    }
    kit_push(&me->kit, &page_emulate, me);
}

/** @brief A tap on Delete. @param e The event. */
static void item_delete_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_delete, &s_ao);
}

/**
 * @brief A saved card: what is on it, and what can be done with it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_item(kit_t *kit, void *arg)
{
    NfcKitAo * const    me = (NfcKitAo *)arg;
    lv_obj_t        *page;
    char             uid[40];
    char             msg[48];
    char             line[96];
    nfc_item_t const *it;

    emu_leave(me);
    if ( me->sel >= me->count )
    {
        (void)kit_back(kit);
        return;
    }
    it   = &me->saved[me->sel];
    page = kit_page_bare(kit);
    uid_text(it, uid, sizeof(uid), ' ');
    (void)kit_text(page, type_name(it->type), &kui_font_body, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 78);
    (void)kit_text(page, uid, &kui_font_name, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 114);
    if ( '\0' != it->text[0] )
    {
        message_short(it->text, msg, sizeof(msg));
        (void)snprintf(line, sizeof(line), "%s: %s", it->uri ? "Link" : "Text", msg);
    }
    else
    {
        (void)snprintf(line, sizeof(line), "No message, UID only");
    }
    (void)kit_text(page, line, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 192);
    {
        lv_obj_t *row = kit_row(kit, page, "Emulate", "Play it to a reader", &app_glyph_play_40, NULL,
                                KUI_COLOR_ACTION, &item_emulate_cb, me);

        lv_obj_set_pos(row, KIT_SIDE, 250);
        row = kit_row(kit, page, "Delete", "Remove it from the Dot", &app_glyph_trash_40, NULL, KUI_COLOR_DANGER,
                      &item_delete_cb, me);
        kit_row_danger(row);
        lv_obj_set_pos(row, KIT_SIDE, 342);
    }
    kit_bar(kit, page, it->name);
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
    NfcKitAo * const    me   = (NfcKitAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;

    kit_no_swipe(kit);
    if ( NFC_E_FAILED == me->estate )
    {
        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_nfc_96, "Could not start",
                        "The reader is busy or not fitted");
        btn = kit_button(kit, page, "Back", KIT_BTN_QUIET, KUI_ACTION_W, &emu_stop_cb, me);
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACTION, &app_glyph_nfc_96,
                        (NFC_E_PLAYING == me->estate) ? "Emulating" : "Starting",
                        me->saved[me->sel].name);
        btn = kit_button(kit, page, "Stop", KIT_BTN_DANGER, KUI_ACTION_W, &emu_stop_cb, me);
    }
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, NFC_FOOT_Y);
}

/* ---- Delete ---- */

/** @brief Delete it. @param e The event. */
static void delete_yes_cb(lv_event_t *e)
{
    NfcKitAo * const me = &s_ao;

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
 * @brief The question before a delete: a card is never lost by one tap.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_delete(kit_t *kit, void *arg)
{
    NfcKitAo * const    me   = (NfcKitAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    char             title[48];
    lv_obj_t        *btn;

    (void)snprintf(title, sizeof(title), "Delete?");
    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_trash_96, title,
                    (me->sel < me->count) ? me->saved[me->sel].name : "");
    btn = kit_button(kit, page, "Delete", KIT_BTN_DANGER, KUI_ACTION_W, &delete_yes_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, NFC_FOOT_Y);
}

/* ---- The Active Object ---- */

void NfcKitAo_ctor(void)
{
    NfcKitAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&NfcKitAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)NFCKIT_TICK_SIG);
    kit_store_init(&me->store, &me->super, NFC_DIR, NFC_FILE, s_file, sizeof(s_file), &nfc_pack, me);
}

void NfcKitAo_start(void)
{
    QActive_setAttr(AO_NfcKit, TASK_NAME_ATTR, "nfc_kit_ao");
    QACTIVE_START(AO_NfcKit, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe, ask for the panel and the saved cards, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to NfcKitAo_running.
 */
static QState NfcKitAo_initial(NfcKitAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    kit_store_load(&me->store);
    KLOG_I(TAG, "up");
    return Q_TRAN(&NfcKitAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState NfcKitAo_running(NfcKitAo * const me, QEvt const * const e)
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
        case NFC_NDEF_RSP_SIG:
        {
            read_answer(me, Q_EVT_CAST(NfcNdefRspEvt));
            break;
        }
        case NFC_EMU_RSP_SIG:
        {
            NfcEmuRspEvt const * const r = Q_EVT_CAST(NfcEmuRspEvt);

            if ( me->emu_out && (NFC_E_STARTING == me->estate) )
            {
                me->estate = (KODE_OK == r->rc) ? NFC_E_PLAYING : NFC_E_FAILED;
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
                    nfc_unpack(me, len);
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
