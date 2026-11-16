/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file kit.h
 * @brief The starter apps' shared screen kit: pages, rows, buttons, empty states and the pad's grammar on top of kscreen and kui.
 */
#ifndef KIT_H_
#define KIT_H_

#include <stdbool.h>
#include <stdint.h>

#include "kscreen.h"
#include "kui.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Numbers ---- */

#define KIT_STACK_MAX     6U    /**< Pages one app keeps open at once, the first included. */
#define KIT_FOCUS_MAX     24U   /**< Controls on one page the pad can reach. */
#define KIT_BAR_Y         12    /**< Where the title line of the back bar starts. */
#define KIT_BAR_H         44    /**< The title line's height. */
#define KIT_BAR_FOOT      76    /**< Where the bar and its fade end. */
#define KIT_BODY_BOTTOM   72    /**< The room under the last row, so it can scroll clear of the glass's corners. */
#define KIT_SIDE          32    /**< The side margin of rows and buttons. */
#define KIT_GAP           12    /**< The gap between two rows. */
#define KIT_ROW_W         346   /**< A full-width row. */
#define KIT_DISC_BIG      112   /**< The disc of a result or empty state. */

/* ---- Types ---- */

/** @brief What a button is for: the one yellow answer, a red ending, or a quiet second way out. */
typedef enum {
    KIT_BTN_ACTION = 0,   /**< The page's answer: Bold Yellow, dark word. */
    KIT_BTN_DANGER,       /**< An ending: red, light word. */
    KIT_BTN_QUIET         /**< Another way: the row grey, light word. */
} kit_btn_kind_t;

struct kit_s;

/**
 * @brief A page builder: it makes the page with kit_page() and fills it; the kit shows it.
 * @param kit The kit.
 * @param arg What kit_push() was given.
 */
typedef void (*kit_build_fn_t)(struct kit_s *kit, void *arg);

/** @brief One entry of the back stack. */
typedef struct {
    kit_build_fn_t fn;    /**< Builds the page. */
    void          *arg;   /**< What it is given. */
} kit_entry_t;

/** @brief The kit: lives inside the app's Active Object. */
typedef struct kit_s {
    kscreen_t   screen;                   /**< LVGL on the glass. */
    bool        open;                     /**< The glass is up and pages may be built. */
    kit_entry_t stack[KIT_STACK_MAX];     /**< The pages open, the last one shown. */
    uint8_t     depth;                    /**< How many there are. */
    lv_obj_t   *cur;                      /**< The page on the glass. */
    lv_obj_t   *next;                     /**< The page being built. */
    lv_obj_t   *body;                     /**< The scrolling column of the page being built or shown. */
    lv_obj_t   *focus[KIT_FOCUS_MAX];     /**< The controls the pad reaches, in order. */
    uint8_t     nfocus;                   /**< How many. */
    int8_t      sel;                      /**< The one the ring is on, -1 for none. */
    bool        pad;                      /**< The pad was the last input: the ring is drawn. */
    bool        swipe_back;               /**< A swipe right goes back from the page being shown. */
    bool        bot_held;                 /**< The press of BOT in progress became a hold. */
    bool        bot_down;                 /**< BOT is down. */
    enum_t      tick_sig;                 /**< The signal of the render pass. */
} kit_t;

/** @brief Called when the pad's LEFT or RIGHT reaches a page that wants it (a level steps by itself). */
typedef void (*kit_key_fn_t)(void *arg, uint8_t key);

/* ---- The screen ---- */

/**
 * @brief Bind the kit to its Active Object; call from the constructor.
 * @param kit      The kit.
 * @param owner    The Active Object.
 * @param tick_sig The signal of the render pass.
 */
void kit_ctor(kit_t *kit, QActive *owner, enum_t tick_sig);

/**
 * @brief Subscribe to what the screen and the buttons say, and ask for the panel; call from the initial transition.
 * @param kit The kit.
 */
void kit_start(kit_t *kit);

/**
 * @brief Let the kit take an event that is about the glass or the buttons.
 * @param kit The kit.
 * @param e   The event.
 * @return true when it was the kit's: the display, the tick, the touch, a repaint, a park or a button.
 */
bool kit_on_event(kit_t *kit, QEvt const *e);

/**
 * @brief Open the glass from the panel's announcement.
 * @param kit The kit.
 * @param d   The announcement.
 * @return true when LVGL is up (pages may be pushed).
 */
bool kit_open_glass(kit_t *kit, DisplayStateEvt const *d);

/**
 * @brief Whether LVGL is up.
 * @param kit The kit.
 * @return true after kit_on_event() opened the glass.
 */
bool kit_is_open(kit_t const *kit);

/* ---- Pages ---- */

/**
 * @brief Show a page over the one on the glass, keeping that one to go back to.
 * @param kit The kit.
 * @param fn  Builds the page.
 * @param arg What it is given.
 */
void kit_push(kit_t *kit, kit_build_fn_t fn, void *arg);

/**
 * @brief Show a page in place of the one on the glass.
 * @param kit The kit.
 * @param fn  Builds the page.
 * @param arg What it is given.
 */
void kit_replace(kit_t *kit, kit_build_fn_t fn, void *arg);

/**
 * @brief Go back one page; at the first page nothing happens.
 * @param kit The kit.
 * @return true when a page was left.
 */
bool kit_back(kit_t *kit);

/**
 * @brief Go back to a given depth in one step, building only the page it ends on.
 * @param kit   The kit.
 * @param depth The depth to end at, 1 for the first page.
 * @return true when pages were left.
 */
bool kit_pop_to(kit_t *kit, uint8_t depth);

/**
 * @brief Go back to the first page and show it again.
 * @param kit The kit.
 */
void kit_home(kit_t *kit);

/**
 * @brief Build the page on the glass again, from the app's state; the pad's place is kept.
 * @param kit The kit.
 */
void kit_refresh(kit_t *kit);

/**
 * @brief How many pages are open.
 * @param kit The kit.
 * @return The depth, 1 for the first page.
 */
uint8_t kit_depth(kit_t const *kit);

/**
 * @brief The page builder that is on the glass.
 * @param kit The kit.
 * @return Its function, NULL when none.
 */
kit_build_fn_t kit_current(kit_t const *kit);

/**
 * @brief Start a list page: a black page with the back bar and a scrolling column for rows.
 *
 * Call it first in a builder. The arrow is drawn on every page but the first.
 *
 * @param kit   The kit.
 * @param title The bar's words.
 * @return The column to put rows in.
 */
lv_obj_t *kit_page(kit_t *kit, const char *title);

/**
 * @brief Start a bare page: black, nothing on it, for an app's own picture.
 * @param kit The kit.
 * @return The page; the app draws on it. A tap on nothing does nothing.
 */
lv_obj_t *kit_page_bare(kit_t *kit);

/**
 * @brief Put the back bar on a bare page.
 * @param kit   The kit.
 * @param page  The page.
 * @param title The bar's words.
 */
void kit_bar(kit_t *kit, lv_obj_t *page, const char *title);

/**
 * @brief A page without a swipe back (it has a level the finger drags).
 * @param kit The kit.
 */
void kit_no_swipe(kit_t *kit);

/**
 * @brief Say a title in the bar of the page on the glass.
 * @param kit   The kit.
 * @param title The words.
 */
void kit_set_title(kit_t *kit, const char *title);

/* ---- Rows and buttons ---- */

/**
 * @brief A row: a pill with a round slot, a name and a line under it.
 * @param kit    The kit.
 * @param parent Where it goes, normally the page's column.
 * @param name   The bold line.
 * @param sub    The muted line.
 * @param glyph  A line glyph for the slot, or NULL.
 * @param letter The slot's letter or count when there is no glyph; may be NULL.
 * @param slot   The slot's colour.
 * @param cb     Called on a tap.
 * @param user   What it is given.
 * @return The pill.
 */
lv_obj_t *kit_row(kit_t *kit, lv_obj_t *parent, const char *name, const char *sub,
                  const lv_image_dsc_t *glyph, const char *letter, lv_color_t slot,
                  lv_event_cb_t cb, void *user);

/**
 * @brief Change a row's two lines.
 * @param row  A row from kit_row().
 * @param name The bold line.
 * @param sub  The muted line.
 */
void kit_row_set(lv_obj_t *row, const char *name, const char *sub);

/**
 * @brief Dress a row as an ending: a red slot.
 * @param row A row from kit_row().
 */
void kit_row_danger(lv_obj_t *row);

/**
 * @brief A button, centred or full width.
 * @param kit    The kit.
 * @param parent Where it goes.
 * @param label  Its word.
 * @param kind   What it is for.
 * @param width  Its width in pixels.
 * @param cb     Called on a tap.
 * @param user   What it is given.
 * @return The button.
 */
lv_obj_t *kit_button(kit_t *kit, lv_obj_t *parent, const char *label, kit_btn_kind_t kind,
                     int32_t width, lv_event_cb_t cb, void *user);

/**
 * @brief Make the pad reach a control.
 * @param kit The kit.
 * @param obj The control.
 */
void kit_focus_add(kit_t *kit, lv_obj_t *obj);

/**
 * @brief A round disc with a glyph, for a result or an empty state.
 * @param parent The parent.
 * @param d      Its diameter.
 * @param colour Its colour.
 * @param glyph  The glyph, A8, drawn in dark ink; may be NULL.
 * @return The disc.
 */
lv_obj_t *kit_disc(lv_obj_t *parent, int32_t d, lv_color_t colour, const lv_image_dsc_t *glyph);

/**
 * @brief A line of text on a page.
 * @param parent The parent.
 * @param text   The words.
 * @param font   The face.
 * @param colour The colour.
 * @param width  The line's width, 0 for the content's.
 * @param centre Centre it.
 * @return The label.
 */
lv_obj_t *kit_text(lv_obj_t *parent, const char *text, const lv_font_t *font, lv_color_t colour,
                   int32_t width, bool centre);

/**
 * @brief A centred column for a result, an empty state or a wait: the disc, a title and a line.
 * @param kit    The kit.
 * @param page   The page (a bare one, or the column's parent).
 * @param colour The disc's colour.
 * @param glyph  The disc's glyph, or NULL.
 * @param title  The big line.
 * @param line   The muted lines under it, may be NULL.
 * @return The column; add a button to it.
 */
lv_obj_t *kit_stage(kit_t *kit, lv_obj_t *page, lv_color_t colour, const lv_image_dsc_t *glyph,
                    const char *title, const char *line);

/**
 * @brief A turning ring for a wait of no known length.
 * @param parent The parent.
 * @param d      Its diameter.
 * @param colour Its colour.
 * @return The ring.
 */
lv_obj_t *kit_spinner(lv_obj_t *parent, int32_t d, lv_color_t colour);

/**
 * @brief Whether the pad should be shown a ring now.
 * @param kit The kit.
 * @return true after the pad was used and before a touch.
 */
bool kit_pad_active(kit_t const *kit);

/* ---- The name keypad ---- */

/**
 * @brief The text a name page edits and what it does when done.
 */
typedef struct {
    char     text[32];                          /**< The name being typed, NUL terminated. */
    uint8_t  max;                               /**< The most characters. */
    uint8_t  mode;                              /**< Which keys are shown. */
    void   (*done)(void *user, const char *text); /**< Called with the name when the answer is tapped. */
    void    *user;                              /**< What it is given. */
    const char *title;                          /**< The bar's words. */
    const char *answer;                         /**< The button's word. */
    lv_obj_t *field;                            /**< The label that shows the text. */
} kit_name_t;

/**
 * @brief A page that edits a name with an on-screen keypad.
 *
 * Use it as a builder: kit_push(kit, kit_name_page, &name).
 *
 * @param kit The kit.
 * @param arg A kit_name_t that outlives the page.
 */
void kit_name_page(kit_t *kit, void *arg);

#ifdef __cplusplus
}
#endif

#endif /* KIT_H_ */
