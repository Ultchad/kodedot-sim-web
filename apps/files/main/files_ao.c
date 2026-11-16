/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file files_ao.c
 * @brief The Files app's Active Object: browse the internal storage and the microSD, preview, rename and delete.
 */
#include "files_ao.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

#include "glyphs.h"
#include "kit.h"

#define TAG "files.ao"   /**< This file's log tag. */

#define FILES_MAX_ENTRIES  40U     /**< Entries of one folder the app shows. */
#define FILES_NAME_MAX     64U     /**< The longest name an entry carries, NUL included. */
#define FILES_PATH_MAX     KODE_SYS_FILE_PATH_MAX   /**< The longest path. */
#define FILES_LEVELS       8U      /**< Folders deep the app goes. */
#define FILES_VIEW_BYTES   192U    /**< How much of a file a preview page shows. */
#define FILES_RENAME_MAX   31U     /**< The longest name the keypad edits. */
#define FILES_FOOT_Y       402     /**< Where a page's one button stands. */
#define FILES_INT_ROOT     "/storage"   /**< The internal volume. */
#define FILES_SD_ROOT      "/sdcard"    /**< The card. */

/** @brief This app's own signals. */
enum FilesSignals
{
    FILES_TICK_SIG = MAX_SIG   /**< The render pass: kscreen's one-shot. */
};

/** @brief What the one file request in flight is. */
typedef enum {
    FILES_OP_NONE = 0,   /**< Nothing is out. */
    FILES_OP_LIST,       /**< A folder listing. */
    FILES_OP_SPACE_INT,  /**< The internal volume's space. */
    FILES_OP_SPACE_SD,   /**< The card's space. */
    FILES_OP_READ,       /**< A window of a file. */
    FILES_OP_RENAME,     /**< A rename. */
    FILES_OP_DELETE      /**< A delete. */
} files_op_t;

/** @brief One entry of the folder on the glass. */
typedef struct {
    char     name[FILES_NAME_MAX];   /**< Its name. */
    uint32_t size;                   /**< Bytes. */
    bool     dir;                    /**< A folder. */
} files_entry_t;

/** @brief One folder level of the way in. */
typedef struct {
    char path[FILES_PATH_MAX];   /**< Where it is. */
} files_level_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive       super;                         /**< The QP/C base; must stay first. */
    kit_t         kit;                           /**< The screens. */
    files_op_t    op;                            /**< What is out. */
    bool          want_list;                     /**< A listing is wanted. */
    bool          want_space;                    /**< The volumes' space is wanted. */
    bool          want_read;                     /**< A read is wanted. */
    bool          want_rename;                   /**< A rename is wanted. */
    bool          want_delete;                   /**< A delete is wanted. */
    files_level_t level[FILES_LEVELS];           /**< The folders on the way in, by depth. */
    char          listed[FILES_PATH_MAX];        /**< The folder the entries are of; empty when stale. */
    char          list_for[FILES_PATH_MAX];      /**< The folder being listed. */
    char          want_path[FILES_PATH_MAX];     /**< The folder a wanted listing is of. */
    bool          space_fresh;                   /**< The volumes' space is known and current. */
    files_entry_t entry[FILES_MAX_ENTRIES];      /**< Its entries. */
    uint16_t      count;                         /**< How many. */
    uint16_t      skip;                          /**< Entries brought by earlier pages. */
    uint8_t       list_rc;                       /**< What the listing came to. */
    bool          list_done;                     /**< The entries are all in. */
    bool          truncated;                     /**< The folder holds more than the app shows. */
    bool          space_ok[2];                   /**< The space of each volume is known. */
    uint32_t      free_kb[2];                    /**< Free kilobytes of each. */
    uint32_t      total_kb[2];                   /**< Size in kilobytes of each. */
    char          fpath[FILES_PATH_MAX];         /**< The file a page is about. */
    char          fname[FILES_NAME_MAX];         /**< Its name. */
    uint32_t      fsize;                         /**< Its size. */
    uint8_t       folder_depth;                  /**< The depth of the folder page the file is in. */
    uint8_t       view[FILES_VIEW_BYTES + 1U];   /**< The preview's lent buffer. */
    uint32_t      view_off;                      /**< Where the window starts. */
    uint32_t      view_got;                      /**< Bytes in it. */
    bool          view_ready;                    /**< The window has arrived. */
    uint8_t       view_rc;                       /**< What the read came to. */
    kit_name_t    name;                          /**< The name being typed. */
    char          to[FILES_PATH_MAX];            /**< Where a rename goes. */
    char          msg_title[32];                 /**< The message page's big line. */
    char          msg_line[96];                  /**< Its second line. */
} FilesAo;

static QEvtPtr     s_queue[KODE_SYS_FILE_LIST_MAX + KODE_SYS_LIST_FREE_SLOTS + KQP_AO_QUEUE_LEN];   /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];   /**< Its stack, in words. */
static FilesAo     s_ao;                                                /**< The one instance. */

QActive * const AO_Files = &s_ao.super;

static QState FilesAo_initial(FilesAo * const me, void const * const par);
static QState FilesAo_running(FilesAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_folder(kit_t *kit, void *arg);
static void   page_file(kit_t *kit, void *arg);
static void   page_preview(kit_t *kit, void *arg);
static void   page_delete(kit_t *kit, void *arg);
static void   page_msg(kit_t *kit, void *arg);
static void   kick(FilesAo *me);

/* ---- Words ---- */

/**
 * @brief A size in words.
 * @param bytes The size.
 * @param out   Where.
 * @param cap   Its size.
 */
static void size_text(uint32_t bytes, char *out, size_t cap)
{
    if ( 1024U > bytes )
    {
        (void)snprintf(out, cap, "%u B", (unsigned)bytes);
    }
    else if ( (1024U * 1024U) > bytes )
    {
        (void)snprintf(out, cap, "%u.%u KB", (unsigned)(bytes / 1024U), (unsigned)(((bytes % 1024U) * 10U) / 1024U));
    }
    else
    {
        (void)snprintf(out, cap, "%u.%u MB", (unsigned)(bytes / (1024U * 1024U)),
                       (unsigned)(((bytes % (1024U * 1024U)) * 10U) / (1024U * 1024U)));
    }
}

/**
 * @brief Free space in words.
 * @param me  The Active Object.
 * @param vol 0 internal, 1 card.
 * @param out Where.
 * @param cap Its size.
 */
static void space_text(FilesAo const *me, uint32_t vol, char *out, size_t cap)
{
    char free_s[16];
    char total_s[16];

    if ( !me->space_ok[vol] )
    {
        (void)snprintf(out, cap, "%s", (1U == vol) ? "No card in the slot" : "Reading");
        return;
    }
    size_text(me->free_kb[vol] * 1024U, free_s, sizeof(free_s));
    size_text(me->total_kb[vol] * 1024U, total_s, sizeof(total_s));
    (void)snprintf(out, cap, "%s free of %s", free_s, total_s);
}

/**
 * @brief The last part of a path.
 * @param path The path.
 * @return The name.
 */
static const char *base_name(const char *path)
{
    const char * const s = strrchr(path, '/');

    return ((NULL != s) && ('\0' != s[1])) ? (s + 1) : path;
}

/**
 * @brief Whether a path is the root of a volume.
 * @param path The path.
 * @return true for "/storage" and "/sdcard".
 */
static bool is_root(const char *path)
{
    return (0 == strcmp(path, FILES_INT_ROOT)) || (0 == strcmp(path, FILES_SD_ROOT));
}

/**
 * @brief Say something went wrong, or right, on a page of its own.
 * @param me    The Active Object.
 * @param title The big line.
 * @param line  The second line.
 */
static void say(FilesAo *me, const char *title, const char *line)
{
    (void)snprintf(me->msg_title, sizeof(me->msg_title), "%s", title);
    (void)snprintf(me->msg_line, sizeof(me->msg_line), "%s", line);
    kit_push(&me->kit, &page_msg, me);
}

/* ---- The one file door ---- */

/**
 * @brief Send the next wanted request, when none is out.
 * @param me The Active Object.
 */
static void kick(FilesAo *me)
{
    kode_status_t rc = KODE_OK;

    if ( FILES_OP_NONE != me->op )
    {
        return;
    }
    if ( me->want_delete )
    {
        me->want_delete = false;
        rc = kode_sys_file_delete(&me->super, me->fpath);
        me->op = (KODE_OK == rc) ? FILES_OP_DELETE : FILES_OP_NONE;
    }
    else if ( me->want_rename )
    {
        me->want_rename = false;
        rc = kode_sys_file_rename(&me->super, me->fpath, me->to);
        me->op = (KODE_OK == rc) ? FILES_OP_RENAME : FILES_OP_NONE;
    }
    else if ( me->want_read )
    {
        me->want_read = false;
        (void)memset(me->view, 0, sizeof(me->view));
        rc = kode_sys_file_read(&me->super, me->fpath, me->view_off, me->view, FILES_VIEW_BYTES);
        me->op = (KODE_OK == rc) ? FILES_OP_READ : FILES_OP_NONE;
    }
    else if ( me->want_list )
    {
        me->want_list = false;
        (void)snprintf(me->list_for, sizeof(me->list_for), "%s", me->want_path);
        me->count     = 0U;
        me->skip      = 0U;
        me->list_done = false;
        me->truncated = false;
        rc = kode_sys_file_list(&me->super, me->list_for, 0U);
        me->op = (KODE_OK == rc) ? FILES_OP_LIST : FILES_OP_NONE;
    }
    else if ( me->want_space )
    {
        me->want_space = false;
        rc = kode_sys_file_space(&me->super, FILES_INT_ROOT);
        me->op = (KODE_OK == rc) ? FILES_OP_SPACE_INT : FILES_OP_NONE;
    }
    else
    {
        /* Nothing wanted. */
    }
    if ( (KODE_OK != rc) && (FILES_OP_NONE == me->op) )
    {
        KLOG_W(TAG, "a file request was refused (%d)", (int)rc);
    }
}

/**
 * @brief Keep the entries sorted: folders first, then by name.
 * @param me The Active Object.
 */
static void entries_sort(FilesAo *me)
{
    for ( uint32_t i = 1U; i < me->count; ++i )
    {
        files_entry_t key = me->entry[i];
        int32_t       j   = (int32_t)i - 1;

        while ( 0 <= j )
        {
            files_entry_t const *p = &me->entry[j];
            bool const           after = (p->dir != key.dir) ? (!p->dir && key.dir)
                                                              : (0 < strcasecmp(p->name, key.name));

            if ( !after )
            {
                break;
            }
            me->entry[j + 1] = me->entry[j];
            --j;
        }
        me->entry[j + 1] = key;
    }
}

/**
 * @brief The page on the glass wants redrawing after an answer.
 * @param me The Active Object.
 */
static void redraw(FilesAo *me)
{
    kit_build_fn_t const cur = kit_current(&me->kit);

    if ( (page_home == cur) || (page_folder == cur) || (page_preview == cur) )
    {
        kit_refresh(&me->kit);
    }
}

/**
 * @brief One entry of a listing arrived.
 * @param me The Active Object.
 * @param en The entry.
 */
static void entry_in(FilesAo *me, StorageEntryEvt const *en)
{
    if ( FILES_OP_LIST != me->op )
    {
        return;
    }
    me->skip++;
    if ( ('.' == en->name[0]) && (('\0' == en->name[1]) || (('.' == en->name[1]) && ('\0' == en->name[2]))) )
    {
        return;
    }
    if ( FILES_MAX_ENTRIES > me->count )
    {
        files_entry_t * const d = &me->entry[me->count++];

        (void)snprintf(d->name, sizeof(d->name), "%s", en->name);
        d->size = en->size;
        d->dir  = en->is_dir;
    }
    else
    {
        me->truncated = true;
    }
}

/**
 * @brief A page of a listing ended.
 * @param me  The Active Object.
 * @param end The answer.
 */
static void list_end(FilesAo *me, FileRspEvt const *end)
{
    me->op = FILES_OP_NONE;
    if ( (KODE_OK == end->rc) && end->more && (FILES_MAX_ENTRIES > me->count) )
    {
        if ( KODE_OK == kode_sys_file_list(&me->super, me->list_for, me->skip) )
        {
            me->op = FILES_OP_LIST;
            return;
        }
    }
    me->list_rc   = end->rc;
    me->list_done = true;
    if ( KODE_OK == end->rc )
    {
        entries_sort(me);
        (void)snprintf(me->listed, sizeof(me->listed), "%s", me->list_for);
    }
    else
    {
        me->listed[0] = '\0';
    }
    redraw(me);
    kick(me);
}

/* ---- Home ---- */

/** @brief Open a volume or a folder. @param path The path. */
static void open_folder(const char *path)
{
    uint8_t const d = kit_depth(&s_ao.kit);

    if ( FILES_LEVELS <= d )
    {
        say(&s_ao, "Too deep", "This folder is nested deeper than Files goes");
        return;
    }
    (void)snprintf(s_ao.level[d].path, sizeof(s_ao.level[d].path), "%s", path);
    s_ao.listed[0]   = '\0';
    s_ao.list_done   = false;
    s_ao.list_for[0] = '\0';
    kit_push(&s_ao.kit, &page_folder, &s_ao.level[d]);
}

/** @brief A tap on a volume. @param e The event. */
static void home_vol_cb(lv_event_t *e)
{
    open_folder(((uintptr_t)lv_event_get_user_data(e) == 0U) ? FILES_INT_ROOT : FILES_SD_ROOT);
}

/**
 * @brief The first page: the two volumes and how full they are.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    FilesAo * const  me   = (FilesAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Files");
    char             sub[48];

    (void)snprintf(me->level[0].path, sizeof(me->level[0].path), "/");
    space_text(me, 0U, sub, sizeof(sub));
    (void)kit_row(kit, body, "Internal storage", sub, &app_glyph_folder_40, NULL, KUI_COLOR_ACTION, &home_vol_cb,
                  (void *)(uintptr_t)0U);
    space_text(me, 1U, sub, sizeof(sub));
    (void)kit_row(kit, body, "SD card", sub, &app_glyph_card_40, NULL, KUI_COLOR_ACCENT, &home_vol_cb,
                  (void *)(uintptr_t)1U);
    if ( !me->space_fresh )
    {
        me->want_space = true;
        kick(me);
    }
}

/* ---- Folder ---- */

/** @brief A tap on an entry. @param e The event. */
static void folder_pick_cb(lv_event_t *e)
{
    FilesAo * const     me = &s_ao;
    uint32_t const      i  = (uint32_t)(uintptr_t)lv_event_get_user_data(e);
    uint8_t const       d  = kit_depth(&me->kit);
    char                path[FILES_PATH_MAX];
    files_entry_t const *en;

    if ( i >= me->count )
    {
        return;
    }
    en = &me->entry[i];
    (void)snprintf(path, sizeof(path), "%s/%s", me->level[d - 1U].path, en->name);
    if ( en->dir )
    {
        open_folder(path);
    }
    else
    {
        (void)snprintf(me->fpath, sizeof(me->fpath), "%s", path);
        (void)snprintf(me->fname, sizeof(me->fname), "%s", en->name);
        me->fsize        = en->size;
        me->folder_depth = d;
        kit_push(&me->kit, &page_file, me);
    }
}

/**
 * @brief A folder: its entries, folders first; or why there are none.
 * @param kit The kit.
 * @param arg The folder's level.
 */
static void page_folder(kit_t *kit, void *arg)
{
    FilesAo * const      me    = &s_ao;
    files_level_t const *lv    = (files_level_t const *)arg;
    const char          *title = is_root(lv->path) ? ((0 == strcmp(lv->path, FILES_SD_ROOT)) ? "SD card" : "Internal")
                                                   : base_name(lv->path);

    if ( 0 != strcmp(me->listed, lv->path) )
    {
        lv_obj_t * const page = kit_page_bare(kit);

        if ( me->list_done && (0 == strcmp(me->list_for, lv->path)) && (KODE_OK != me->list_rc) )
        {
            bool const nocard = (0 == strcmp(lv->path, FILES_SD_ROOT));

            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_folder_96,
                            nocard ? "No card" : "Cannot open",
                            nocard ? "Put a microSD card in the slot" : "This folder could not be read");
        }
        else
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_folder_96, "Reading", NULL);
            (void)snprintf(me->want_path, sizeof(me->want_path), "%s", lv->path);
            me->want_list = true;
        }
        kit_bar(kit, page, title);
        kick(me);
        return;
    }
    if ( 0U == me->count )
    {
        lv_obj_t * const page = kit_page_bare(kit);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_folder_96, "Empty folder", "Nothing in here yet");
        kit_bar(kit, page, title);
        return;
    }
    {
        lv_obj_t * const body = kit_page(kit, title);

        for ( uint32_t i = 0U; i < me->count; ++i )
        {
            files_entry_t const *en = &me->entry[i];
            char                 sub[24];

            if ( en->dir )
            {
                (void)snprintf(sub, sizeof(sub), "Folder");
            }
            else
            {
                size_text(en->size, sub, sizeof(sub));
            }
            (void)kit_row(kit, body, en->name, sub, en->dir ? &app_glyph_folder_40 : &app_glyph_file_40, NULL,
                          en->dir ? KUI_COLOR_ACTION : KUI_COLOR_TEXT_MUTED, &folder_pick_cb, (void *)(uintptr_t)i);
        }
        if ( me->truncated )
        {
            (void)kit_text(body, "Showing the first 40 entries", &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, true);
        }
    }
}

/* ---- A file ---- */

/** @brief A tap on Preview. @param e The event. */
static void file_preview_cb(lv_event_t *e)
{
    (void)e;
    s_ao.view_off   = 0U;
    s_ao.view_ready = false;
    s_ao.want_read  = true;
    kit_push(&s_ao.kit, &page_preview, &s_ao);
    kick(&s_ao);
}

/** @brief The new name was typed. @param user The Active Object. @param text The name. */
static void rename_done(void *user, const char *text)
{
    FilesAo * const me = (FilesAo *)user;
    char            dir[FILES_PATH_MAX];
    char const     *slash = strrchr(me->fpath, '/');
    size_t const    n     = (NULL != slash) ? (size_t)(slash - me->fpath) : 0U;

    (void)snprintf(dir, sizeof(dir), "%.*s", (int)n, me->fpath);
    if ( 0 == strcmp(text, me->fname) )
    {
        (void)kit_back(&me->kit);
        return;
    }
    if ( (strlen(dir) + strlen(text) + 2U) > sizeof(me->to) )
    {
        (void)kit_back(&me->kit);
        say(me, "Name too long", "Pick a shorter name");
        return;
    }
    (void)snprintf(me->to, sizeof(me->to), "%s/%s", dir, text);
    me->want_rename = true;
    kick(me);
}

/** @brief A tap on Rename. @param e The event. */
static void file_rename_cb(lv_event_t *e)
{
    FilesAo * const me = &s_ao;

    (void)e;
    if ( strlen(me->fname) > FILES_RENAME_MAX )
    {
        say(me, "Name too long", "Files can only retype names up to 31 characters");
        return;
    }
    (void)snprintf(me->name.text, sizeof(me->name.text), "%s", me->fname);
    me->name.max    = (uint8_t)FILES_RENAME_MAX;
    me->name.mode   = 1U;
    me->name.done   = &rename_done;
    me->name.user   = me;
    me->name.title  = "Rename";
    me->name.answer = "Rename";
    kit_push(&me->kit, &kit_name_page, &me->name);
}

/** @brief A tap on Delete. @param e The event. */
static void file_delete_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_delete, &s_ao);
}

/**
 * @brief A file: its size and what can be done with it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_file(kit_t *kit, void *arg)
{
    FilesAo * const me = (FilesAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *row;
    char             sz[24];

    size_text(me->fsize, sz, sizeof(sz));
    (void)kit_text(page, sz, &kui_font_title, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 74);
    (void)kit_text(page, me->fpath, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(lv_obj_get_child(page, -1), KIT_SIDE, 120);
    row = kit_row(kit, page, "Preview", "Text or bytes", &app_glyph_file_40, NULL, KUI_COLOR_ACTION, &file_preview_cb, me);
    lv_obj_set_pos(row, KIT_SIDE, 178);
    row = kit_row(kit, page, "Rename", "Give it another name", &app_glyph_edit_40, NULL, KUI_COLOR_ACCENT,
                  &file_rename_cb, me);
    lv_obj_set_pos(row, KIT_SIDE, 270);
    row = kit_row(kit, page, "Delete", "Remove it for good", &app_glyph_trash_40, NULL, KUI_COLOR_DANGER,
                  &file_delete_cb, me);
    kit_row_danger(row);
    lv_obj_set_pos(row, KIT_SIDE, 362);
    kit_bar(kit, page, me->fname);
}

/* ---- Preview ---- */

/** @brief Show the next window. @param e The event. */
static void view_next_cb(lv_event_t *e)
{
    (void)e;
    s_ao.view_off  += FILES_VIEW_BYTES;
    s_ao.view_ready = false;
    s_ao.want_read  = true;
    kit_refresh(&s_ao.kit);
    kick(&s_ao);
}

/** @brief Show the first window again. @param e The event. */
static void view_first_cb(lv_event_t *e)
{
    (void)e;
    s_ao.view_off   = 0U;
    s_ao.view_ready = false;
    s_ao.want_read  = true;
    kit_refresh(&s_ao.kit);
    kick(&s_ao);
}

/**
 * @brief Whether the window is plain text.
 * @param me The Active Object.
 * @return true when every byte is printable ASCII, a tab or a line break.
 */
static bool view_is_text(FilesAo const *me)
{
    for ( uint32_t i = 0U; i < me->view_got; ++i )
    {
        uint8_t const c = me->view[i];

        if ( !((0x20U <= c) && (0x7EU >= c)) && ('\n' != c) && ('\r' != c) && ('\t' != c) )
        {
            return false;
        }
    }
    return true;
}

/**
 * @brief The preview: text as it reads, anything else as bytes.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_preview(kit_t *kit, void *arg)
{
    FilesAo * const me = (FilesAo *)arg;

    if ( !me->view_ready )
    {
        lv_obj_t * const page = kit_page_bare(kit);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_file_96, "Reading", NULL);
        kit_bar(kit, page, "Preview");
        return;
    }
    if ( KODE_OK != me->view_rc )
    {
        lv_obj_t * const page = kit_page_bare(kit);

        (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_file_96, "Cannot read", "The file could not be opened");
        kit_bar(kit, page, "Preview");
        return;
    }
    {
        lv_obj_t * const body = kit_page(kit, me->fname);
        char             line[40];
        char             text[FILES_VIEW_BYTES * 3U + 16U];
        bool const       as_text = view_is_text(me);

        if ( 0U == me->view_got )
        {
            (void)kit_text(body, (0U == me->view_off) ? "The file is empty" : "That is the end of the file",
                           &kui_font_body, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, true);
        }
        else if ( as_text )
        {
            (void)snprintf(text, sizeof(text), "%.*s", (int)me->view_got, (const char *)me->view);
            (void)kit_text(body, text, &kui_font_body, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, false);
        }
        else
        {
            size_t n = 0U;

            text[0] = '\0';
            for ( uint32_t i = 0U; i < me->view_got; i += 8U )
            {
                n += (size_t)snprintf(&text[n], sizeof(text) - n, "%04X", (unsigned)(me->view_off + i));
                for ( uint32_t j = i; (j < (i + 8U)) && (j < me->view_got); ++j )
                {
                    n += (size_t)snprintf(&text[n], sizeof(text) - n, " %02X", (unsigned)me->view[j]);
                }
                n += (size_t)snprintf(&text[n], sizeof(text) - n, "\n");
            }
            (void)kit_text(body, text, &kui_font_caption, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W, false);
        }
        (void)snprintf(line, sizeof(line), "Bytes %u to %u of %u", (unsigned)me->view_off,
                       (unsigned)(me->view_off + me->view_got), (unsigned)me->fsize);
        (void)kit_text(body, line, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, true);
        if ( (me->view_off + me->view_got) < me->fsize )
        {
            (void)kit_row(kit, body, "Next", "The next 192 bytes", &app_glyph_file_40, NULL, KUI_COLOR_ACTION,
                          &view_next_cb, me);
        }
        if ( 0U < me->view_off )
        {
            (void)kit_row(kit, body, "From the start", "Back to the top of the file", &app_glyph_file_40, NULL,
                          KUI_COLOR_TEXT_MUTED, &view_first_cb, me);
        }
    }
}

/* ---- Delete ---- */

/** @brief Delete it. @param e The event. */
static void delete_yes_cb(lv_event_t *e)
{
    (void)e;
    s_ao.want_delete = true;
    kick(&s_ao);
}

/**
 * @brief The question before a delete.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_delete(kit_t *kit, void *arg)
{
    FilesAo * const  me   = (FilesAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;

    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_trash_96, "Delete?", me->fname);
    btn = kit_button(kit, page, "Delete", KIT_BTN_DANGER, KUI_ACTION_W, &delete_yes_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, FILES_FOOT_Y);
}

/* ---- A message ---- */

/** @brief Back from a message. @param e The event. */
static void msg_back_cb(lv_event_t *e)
{
    (void)e;
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief A plain message: what happened, and a way back.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_msg(kit_t *kit, void *arg)
{
    FilesAo * const  me   = (FilesAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;

    kit_no_swipe(kit);
    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_file_96, me->msg_title, me->msg_line);
    btn = kit_button(kit, page, "Back", KIT_BTN_QUIET, KUI_ACTION_W, &msg_back_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, FILES_FOOT_Y);
}

/* ---- Answers ---- */

/**
 * @brief A read arrived.
 * @param me  The Active Object.
 * @param ans The answer.
 */
static void read_end(FilesAo *me, FileRspEvt const *ans)
{
    me->op        = FILES_OP_NONE;
    me->view_rc   = ans->rc;
    me->view_got  = (KODE_OK == ans->rc) ? ans->got : 0U;
    me->view_ready = true;
    redraw(me);
    kick(me);
}

/**
 * @brief A rename or a delete arrived: back to the folder, listed again.
 * @param me      The Active Object.
 * @param ans     The answer.
 * @param renamed Which of the two.
 */
static void change_end(FilesAo *me, FileRspEvt const *ans, bool renamed)
{
    me->op = FILES_OP_NONE;
    if ( KODE_OK == ans->rc )
    {
        me->listed[0]   = '\0';
        me->space_fresh = false;
        (void)kit_pop_to(&me->kit, me->folder_depth);
    }
    else
    {
        if ( renamed )
        {
            (void)kit_back(&me->kit);
            say(me, "Not renamed", "That name is taken or not allowed");
        }
        else
        {
            (void)kit_back(&me->kit);
            say(me, "Not deleted", "A folder has to be empty before it goes");
        }
    }
    kick(me);
}

/**
 * @brief A volume's space arrived.
 * @param me  The Active Object.
 * @param ans The answer.
 */
static void space_end(FilesAo *me, FileRspEvt const *ans)
{
    uint32_t const vol = (FILES_OP_SPACE_SD == me->op) ? 1U : 0U;

    me->space_ok[vol] = (KODE_OK == ans->rc);
    me->free_kb[vol]  = (KODE_OK == ans->rc) ? ans->space.free_kb : 0U;
    me->total_kb[vol] = (KODE_OK == ans->rc) ? ans->space.total_kb : 0U;
    if ( 0U == vol )
    {
        me->op = (KODE_OK == kode_sys_file_space(&me->super, FILES_SD_ROOT)) ? FILES_OP_SPACE_SD : FILES_OP_NONE;
    }
    else
    {
        me->op = FILES_OP_NONE;
    }
    if ( FILES_OP_NONE == me->op )
    {
        me->space_fresh = true;
        if ( page_home == kit_current(&me->kit) )
        {
            kit_refresh(&me->kit);
        }
        kick(me);
    }
}

/* ---- The Active Object ---- */

void FilesAo_ctor(void)
{
    FilesAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&FilesAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)FILES_TICK_SIG);
}

void FilesAo_start(void)
{
    QActive_setAttr(AO_Files, TASK_NAME_ATTR, "files_ao");
    QACTIVE_START(AO_Files, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe, ask for the panel, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to FilesAo_running.
 */
static QState FilesAo_initial(FilesAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    KLOG_I(TAG, "up");
    return Q_TRAN(&FilesAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState FilesAo_running(FilesAo * const me, QEvt const * const e)
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
        case STORAGE_ENTRY_SIG:
        {
            entry_in(me, Q_EVT_CAST(StorageEntryEvt));
            break;
        }
        case FILE_LIST_END_SIG:
        {
            list_end(me, Q_EVT_CAST(FileRspEvt));
            break;
        }
        case FILE_SPACE_RSP_SIG:
        {
            space_end(me, Q_EVT_CAST(FileRspEvt));
            break;
        }
        case FILE_READ_RSP_SIG:
        {
            read_end(me, Q_EVT_CAST(FileRspEvt));
            break;
        }
        case FILE_RENAME_RSP_SIG:
        {
            change_end(me, Q_EVT_CAST(FileRspEvt), true);
            break;
        }
        case FILE_DELETE_RSP_SIG:
        {
            change_end(me, Q_EVT_CAST(FileRspEvt), false);
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
