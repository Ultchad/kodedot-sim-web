/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file sound_ao.c
 * @brief The Sound app's Active Object: a voice recorder that keeps WAV files, plays them back, and a tone generator.
 *
 * The audio calls of kode.h block, so they run on two workers: one for what takes time (a recording's start and
 * save, a playback, a tone) and one for the stop that has to get through while the first is busy.
 */
#include "sound_ao.h"

#include <stdio.h>
#include <string.h>
#include <strings.h>

#include "glyphs.h"
#include "kit.h"
#include "kit_store.h"
#include "kode.h"
#include "kode_worker.h"

#define TAG "sound.ao"   /**< This file's log tag. */

#define SND_DIR           "/storage/sound"                 /**< The app's folder on the internal volume. */
#define SND_FILE          "/storage/sound/settings.bin"    /**< What is kept besides the recordings. */
#define SND_VDIR          "flash/sound"                    /**< The same folder as kode.h names it. */
#define SND_MAGIC         0x31444E53UL                     /**< "SND1", the settings file's first four bytes. */
#define SND_FILE_BYTES    16U                              /**< The size of the settings file. */
#define SND_MAX_RECS      48U                              /**< Recordings the list holds. */
#define SND_NAME_MAX      48U                              /**< A file name, NUL included. */
#define SND_PATH_MAX      96U                              /**< A path, NUL included. */
#define SND_REC_MAX_MS    30000U                           /**< The longest recording the SDK takes. */
#define SND_TONE_MAX_MS   20000U                           /**< How long a tone sounds when nobody stops it. */
#define SND_TICK_MS       200U                             /**< How often a running page is redrawn. */
#define SND_WAV_HEAD      44U                              /**< A WAV file's header, bytes. */
#define SND_BYTES_PER_MS  96U                              /**< 48 kHz, mono, 16 bits. */
#define SND_HZ_MIN        400U                             /**< The lowest tone. */
#define SND_HZ_STEP       50U                              /**< The slider's step, Hz. */
#define SND_STEPS         60U                              /**< Slider steps: 400 Hz to 3400 Hz. */
#define SND_STEP_DEFAULT  12U                              /**< 1000 Hz. */
#define SND_RENAME_MAX    28U                              /**< The longest name the keypad takes. */
#define SND_FOOT_Y        402                              /**< Where a page's one button stands. */
#define SND_BAR_H         10                               /**< A progress track's height. */

/** @brief This app's own signals. */
enum SoundSignals
{
    SND_RENDER_SIG = MAX_SIG,   /**< The render pass: kscreen's one-shot. */
    SND_TICK_SIG,               /**< Time to redraw a running page. */
    SND_WORK_DONE_SIG,          /**< The worker's job ended. */
    SND_CTL_DONE_SIG            /**< The stop worker's job ended. */
};

/** @brief Where a recording is. */
typedef enum {
    REC_IDLE = 0,   /**< Nothing records. */
    REC_STARTING,   /**< The start was asked. */
    REC_ON,         /**< It records. */
    REC_SAVING,     /**< It is being written to a file. */
    REC_FAILED      /**< The last one did not work. */
} rec_state_t;

/** @brief What the file door has out. */
typedef enum {
    FOP_NONE = 0,   /**< Nothing. */
    FOP_LIST,       /**< A listing. */
    FOP_RENAME,     /**< A rename. */
    FOP_DELETE      /**< A delete. */
} fop_t;

/** @brief What a worker job does. */
typedef enum {
    JOB_REC_START = 0,   /**< Start recording. */
    JOB_REC_SAVE,        /**< End the recording and write the file. */
    JOB_PLAY,            /**< Play a file. */
    JOB_TONE,            /**< Play a tone. */
    JOB_STOP             /**< Stop a sound. */
} job_op_t;

/** @brief A job's description and what it came back with; lent to the worker until its done event. */
typedef struct {
    job_op_t op;                  /**< What to do. */
    char     path[SND_PATH_MAX];  /**< The file, for a save or a play. */
    uint16_t hz;                  /**< The tone. */
    char     err[64];             /**< Why it failed, in the SDK's words. */
} snd_job_t;

/** @brief One recording on the list. */
typedef struct {
    char     name[SND_NAME_MAX];  /**< The file's name, with .wav. */
    uint32_t size;                /**< Its size. */
} rec_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive        super;          /**< The QP/C base; must stay first. */
    kit_t          kit;            /**< The screens. */
    kit_store_t    store;          /**< The settings file. */
    kode_worker_t  work;           /**< The worker that waits for sounds. */
    kode_worker_t  ctl;            /**< The worker that stops them. */
    QTimeEvt       tick;           /**< Times the live pages. */
    bool           ticking;        /**< The tick is armed. */
    snd_job_t      work_job;       /**< The work worker's job. */
    snd_job_t      ctl_job;        /**< The stop worker's job. */
    bool           work_busy;      /**< A job is out on the work worker. */
    bool           ctl_busy;       /**< A stop is out. */
    uint16_t       work_seq;       /**< Its sequence number. */
    uint16_t       ctl_seq;        /**< The stop worker's. */
    uint32_t       next_id;        /**< The number of the next recording. */
    uint8_t        tone_step;      /**< The tone, in slider steps. */
    uint8_t        volume;         /**< The output volume, per cent. */
    rec_state_t    rec;            /**< The recorder. */
    uint32_t       rec_t0;         /**< When it started, LVGL ms. */
    char           rec_err[64];    /**< Why the last one failed. */
    char           saving[SND_NAME_MAX]; /**< The file being written. */
    bool           file_on;        /**< A recording is playing. */
    bool           tone_on;        /**< A tone sounds. */
    bool           tone_again;     /**< Start the tone again once it stops. */
    uint32_t       play_t0;        /**< When the playback started, LVGL ms. */
    char           cur_name[SND_NAME_MAX]; /**< The recording the detail page is on. */
    uint32_t       cur_size;       /**< Its size. */
    uint32_t       cur_ms;         /**< Its length. */
    uint8_t        base_depth;     /**< The depth of the page under the detail page. */
    rec_t          live[SND_MAX_RECS];  /**< The list as it was last read. */
    uint32_t       live_n;         /**< How many. */
    rec_t          tmp[SND_MAX_RECS];   /**< The list being read. */
    uint32_t       tmp_n;          /**< How many so far. */
    uint32_t       skip;           /**< Entries earlier pages brought. */
    bool           list_done;      /**< A listing has finished at least once. */
    bool           want_list;      /**< A listing is wanted. */
    bool           want_rename;    /**< A rename is wanted. */
    bool           want_delete;    /**< A delete is wanted. */
    fop_t          op;             /**< What the file door has out. */
    char           from[SND_PATH_MAX];  /**< The path a rename or delete is on. */
    char           to[SND_PATH_MAX];    /**< Where a rename goes. */
    kit_name_t     name;           /**< The name being typed. */
    char           msg_title[32];  /**< A message's title. */
    char           msg_line[96];   /**< A message's line. */
    lv_obj_t      *l_time;         /**< The live page's big time. */
    lv_obj_t      *l_fill;         /**< The live page's progress fill. */
    lv_obj_t      *l_hz;           /**< The tone page's frequency. */
    lv_obj_t      *l_slider;       /**< The tone page's slider. */
    lv_obj_t      *l_vol;          /**< The volume's caption. */
    uint32_t       l_sec;          /**< The second last drawn. */
} SoundAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static uint8_t     s_file[SND_FILE_BYTES];                             /**< The settings file's lent buffer. */
static SoundAo     s_ao;                                               /**< The one instance. */

QActive * const AO_Sound = &s_ao.super;

static QState SoundAo_initial(SoundAo * const me, void const * const par);
static QState SoundAo_running(SoundAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_record(kit_t *kit, void *arg);
static void   page_list(kit_t *kit, void *arg);
static void   page_rec(kit_t *kit, void *arg);
static void   page_tone(kit_t *kit, void *arg);
static void   page_delete(kit_t *kit, void *arg);
static void   page_msg(kit_t *kit, void *arg);
static void   kick(SoundAo *me);

/* ---- Text ---- */

/**
 * @brief Write a length as minutes and seconds.
 * @param out The buffer.
 * @param n   Its size.
 * @param ms  The length.
 */
static void fmt_dur(char *out, size_t n, uint32_t ms)
{
    uint32_t const s = (ms + 500U) / 1000U;

    (void)snprintf(out, n, "%u:%02u", (unsigned)(s / 60U), (unsigned)(s % 60U));
}

/**
 * @brief Write a size in kilobytes or megabytes.
 * @param out   The buffer.
 * @param n     Its size.
 * @param bytes The size.
 */
static void fmt_size(char *out, size_t n, uint32_t bytes)
{
    if ( bytes >= (1024U * 1024U) )
    {
        uint32_t const tenths = (bytes / (1024U * 1024U / 10U));

        (void)snprintf(out, n, "%u.%u MB", (unsigned)(tenths / 10U), (unsigned)(tenths % 10U));
    }
    else
    {
        (void)snprintf(out, n, "%u KB", (unsigned)((bytes + 1023U) / 1024U));
    }
}

/**
 * @brief The length of a WAV file of a given size.
 * @param size The file's size.
 * @return Milliseconds.
 */
static uint32_t size_ms(uint32_t size)
{
    return (size > SND_WAV_HEAD) ? ((size - SND_WAV_HEAD) / SND_BYTES_PER_MS) : 0U;
}

/**
 * @brief A file's name without its extension.
 * @param out  The buffer.
 * @param n    Its size.
 * @param file The file name.
 */
static void show_name(char *out, size_t n, const char *file)
{
    size_t len = strlen(file);

    if ( (4U < len) && (0 == strcasecmp(&file[len - 4U], ".wav")) )
    {
        len -= 4U;
    }
    (void)snprintf(out, n, "%.*s", (int)len, file);
}

/**
 * @brief The tone in Hz.
 * @param me The Active Object.
 * @return Hz.
 */
static uint16_t tone_hz(SoundAo const *me)
{
    return (uint16_t)(SND_HZ_MIN + ((uint32_t)me->tone_step * SND_HZ_STEP));
}

/* ---- The saved file ---- */

/**
 * @brief Fill the file buffer from the settings.
 * @param ctx The Active Object.
 * @param buf The buffer.
 * @param cap Its size.
 * @return The bytes.
 */
static uint32_t snd_pack(void *ctx, uint8_t *buf, uint32_t cap)
{
    SoundAo * const me    = (SoundAo *)ctx;
    uint32_t const  magic = SND_MAGIC;

    if ( SND_FILE_BYTES > cap )
    {
        return 0U;
    }
    (void)memset(buf, 0, SND_FILE_BYTES);
    (void)memcpy(buf, &magic, sizeof(magic));
    (void)memcpy(&buf[4], &me->next_id, sizeof(me->next_id));
    buf[8] = me->tone_step;
    buf[9] = me->volume;
    return SND_FILE_BYTES;
}

/**
 * @brief Read the settings back from the file buffer.
 * @param me  The Active Object.
 * @param len The bytes read.
 */
static void snd_unpack(SoundAo *me, uint32_t len)
{
    uint32_t magic = 0U;

    (void)memcpy(&magic, s_file, sizeof(magic));
    if ( (SND_FILE_BYTES <= len) && (SND_MAGIC == magic) )
    {
        uint32_t id = 0U;

        (void)memcpy(&id, &s_file[4], sizeof(id));
        if ( (0U < id) && (id > me->next_id) )
        {
            me->next_id = id;
        }
        if ( SND_STEPS >= s_file[8] )
        {
            me->tone_step = s_file[8];
        }
        if ( 100U >= s_file[9] )
        {
            me->volume = s_file[9];
            (void)kode_sys_audio_volume(me->volume);
        }
    }
    else
    {
        KLOG_W(TAG, "the settings file is not ours; keeping the defaults");
    }
}

/* ---- Workers ---- */

/**
 * @brief The work worker's job: one blocking audio call.
 * @param arg   The job.
 * @param value Out: the length recorded, for a save.
 * @return KODE_OK when the call worked.
 */
static kode_status_t job_work(void *arg, uint32_t *value)
{
    snd_job_t * const j  = (snd_job_t *)arg;
    bool              ok = false;

    *value    = 0U;
    j->err[0] = '\0';
    switch ( j->op )
    {
        case JOB_REC_START:
        {
            ok = kode_audio_record_start(SND_REC_MAX_MS);
            break;
        }
        case JOB_REC_SAVE:
        {
            kode_audio_record_status_t st;

            (void)kode_audio_record_stop();
            st     = kode_audio_record_status();
            *value = st.ms;
            if ( 0U == st.frames )
            {
                (void)snprintf(j->err, sizeof(j->err), "Nothing was recorded");
                return KODE_ERROR;
            }
            ok = kode_audio_record_save(j->path);
            break;
        }
        case JOB_PLAY:
        {
            ok = kode_audio_play(j->path);
            break;
        }
        case JOB_TONE:
        {
            ok = kode_audio_tone(j->hz, SND_TONE_MAX_MS);
            break;
        }
        default:
        {
            break;
        }
    }
    if ( !ok )
    {
        (void)snprintf(j->err, sizeof(j->err), "%s", kode_error());
    }
    return ok ? KODE_OK : KODE_ERROR;
}

/**
 * @brief The stop worker's job: end a sound that plays.
 * @param arg   Unused.
 * @param value Unused.
 * @return KODE_OK.
 */
static kode_status_t job_stop(void *arg, uint32_t *value)
{
    (void)arg;
    *value = 0U;
    (void)kode_audio_play_stop();
    return KODE_OK;
}

/**
 * @brief Hand a job to the work worker.
 * @param me The Active Object.
 * @param op What to do.
 * @return true when it was taken.
 */
static bool work_submit(SoundAo *me, job_op_t op)
{
    if ( me->work_busy )
    {
        return false;
    }
    me->work_job.op = op;
    if ( KODE_OK != kode_worker_submit(&me->work, &job_work, &me->work_job, (enum_t)SND_WORK_DONE_SIG, &me->work_seq) )
    {
        KLOG_W(TAG, "the worker did not take the job");
        return false;
    }
    me->work_busy = true;
    return true;
}

/**
 * @brief End the sound that plays, if one does.
 * @param me The Active Object.
 */
static void stop_sound(SoundAo *me)
{
    if ( (me->file_on || me->tone_on) && !me->ctl_busy )
    {
        me->ctl_job.op = JOB_STOP;
        if ( KODE_OK == kode_worker_submit(&me->ctl, &job_stop, &me->ctl_job, (enum_t)SND_CTL_DONE_SIG, &me->ctl_seq) )
        {
            me->ctl_busy = true;
        }
    }
}

/* ---- Live pages ---- */

/**
 * @brief Arm or disarm the tick.
 * @param me The Active Object.
 * @param on Run it.
 */
static void tick_set(SoundAo *me, bool on)
{
    if ( on && !me->ticking )
    {
        QTimeEvt_armX(&me->tick, KQP_TICKS_PER_MS(SND_TICK_MS), KQP_TICKS_PER_MS(SND_TICK_MS));
        me->ticking = true;
    }
    else if ( !on && me->ticking )
    {
        (void)QTimeEvt_disarm(&me->tick);
        me->ticking = false;
    }
    else
    {
        /* Already as wanted. */
    }
}

/**
 * @brief Forget the widgets of the page that was on the glass.
 * @param me The Active Object.
 */
static void live_reset(SoundAo *me)
{
    me->l_time   = NULL;
    me->l_fill   = NULL;
    me->l_hz     = NULL;
    me->l_slider = NULL;
    me->l_vol    = NULL;
    me->l_sec    = 0xFFFFFFFFUL;
}

/**
 * @brief Set a progress fill to a share of its track.
 * @param fill  The fill.
 * @param part  How much.
 * @param whole Out of how much.
 */
static void fill_set(lv_obj_t *fill, uint32_t part, uint32_t whole)
{
    int32_t w = 0;

    if ( (NULL == fill) || (0U == whole) )
    {
        return;
    }
    if ( part > whole )
    {
        part = whole;
    }
    w = (int32_t)(((uint64_t)part * (uint64_t)KIT_ROW_W) / whole);
    lv_obj_set_width(fill, (0 < part) && (w < SND_BAR_H) ? SND_BAR_H : w);
}

/**
 * @brief A progress track with its fill.
 * @param page   The page.
 * @param y      Where it stands.
 * @param colour The fill's colour.
 * @return The fill.
 */
static lv_obj_t *bar_make(lv_obj_t *page, int32_t y, lv_color_t colour)
{
    lv_obj_t * const track = lv_obj_create(page);
    lv_obj_t * const fill  = lv_obj_create(track);

    lv_obj_remove_style_all(track);
    lv_obj_set_pos(track, KIT_SIDE, y);
    lv_obj_set_size(track, KIT_ROW_W, SND_BAR_H);
    lv_obj_set_style_bg_color(track, KUI_COLOR_SURFACE, 0);
    lv_obj_set_style_bg_opa(track, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(track, SND_BAR_H / 2, 0);
    lv_obj_remove_flag(track, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_style_all(fill);
    lv_obj_set_pos(fill, 0, 0);
    lv_obj_set_size(fill, 0, SND_BAR_H);
    lv_obj_set_style_bg_color(fill, colour, 0);
    lv_obj_set_style_bg_opa(fill, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(fill, SND_BAR_H / 2, 0);
    return fill;
}

/**
 * @brief A centred line of text at a height.
 * @param page   The page.
 * @param text   The words.
 * @param font   The font.
 * @param colour The colour.
 * @param y      The top.
 * @return The label.
 */
static lv_obj_t *line_at(lv_obj_t *page, const char *text, const lv_font_t *font, lv_color_t colour, int32_t y)
{
    lv_obj_t * const t = kit_text(page, text, font, colour, KIT_ROW_W, true);

    lv_obj_set_pos(t, KIT_SIDE, y);
    return t;
}

/**
 * @brief Redraw what moves on the live page.
 * @param me The Active Object.
 */
static void live_draw(SoundAo *me)
{
    char buf[16];

    if ( REC_ON == me->rec )
    {
        uint32_t const el = lv_tick_elaps(me->rec_t0);

        if ( el >= SND_REC_MAX_MS )
        {
            return;
        }
        if ( (NULL != me->l_time) && ((el / 1000U) != me->l_sec) )
        {
            me->l_sec = el / 1000U;
            fmt_dur(buf, sizeof(buf), (el / 1000U) * 1000U);
            lv_label_set_text(me->l_time, buf);
        }
        fill_set(me->l_fill, el, SND_REC_MAX_MS);
    }
    else if ( me->file_on )
    {
        uint32_t el = lv_tick_elaps(me->play_t0);

        if ( el > me->cur_ms )
        {
            el = me->cur_ms;
        }
        if ( (NULL != me->l_time) && ((el / 1000U) != me->l_sec) )
        {
            me->l_sec = el / 1000U;
            fmt_dur(buf, sizeof(buf), (el / 1000U) * 1000U);
            lv_label_set_text(me->l_time, buf);
        }
        fill_set(me->l_fill, el, me->cur_ms);
    }
    else
    {
        /* Nothing moves. */
    }
}

/* ---- Recording ---- */

/**
 * @brief The name of the next recording.
 * @param me  The Active Object.
 * @param out The buffer.
 * @param n   Its size.
 */
static void next_name(SoundAo *me, char *out, size_t n)
{
    (void)snprintf(out, n, "Rec %03u.wav", (unsigned)me->next_id);
}

/**
 * @brief End the recording and write it.
 * @param me The Active Object.
 */
static void finish_recording(SoundAo *me)
{
    if ( REC_ON != me->rec )
    {
        return;
    }
    next_name(me, me->saving, sizeof(me->saving));
    (void)snprintf(me->work_job.path, sizeof(me->work_job.path), "%s/%s", SND_VDIR, me->saving);
    if ( work_submit(me, JOB_REC_SAVE) )
    {
        me->rec = REC_SAVING;
        tick_set(me, false);
        if ( page_record == kit_current(&me->kit) )
        {
            kit_refresh(&me->kit);
        }
    }
}

/**
 * @brief The page being left was not the recorder's: whatever runs ends.
 * @param me The Active Object.
 */
static void leave_guard(SoundAo *me)
{
    live_reset(me);
    if ( REC_ON == me->rec )
    {
        finish_recording(me);
    }
    stop_sound(me);
}

/** @brief A tap on Record. @param e The event. */
static void record_go_cb(lv_event_t *e)
{
    SoundAo * const me = &s_ao;

    (void)e;
    if ( me->work_busy || me->file_on || me->tone_on )
    {
        return;
    }
    if ( work_submit(me, JOB_REC_START) )
    {
        me->rec = REC_STARTING;
        kit_refresh(&me->kit);
    }
}

/** @brief A tap on Stop while recording. @param e The event. */
static void record_stop_cb(lv_event_t *e)
{
    (void)e;
    finish_recording(&s_ao);
}

/** @brief A tap on Try again. @param e The event. */
static void record_again_cb(lv_event_t *e)
{
    (void)e;
    s_ao.rec = REC_IDLE;
    kit_refresh(&s_ao.kit);
}

/**
 * @brief The recorder.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_record(kit_t *kit, void *arg)
{
    SoundAo * const  me   = (SoundAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *o;
    char             buf[16];

    live_reset(me);
    stop_sound(me);
    switch ( me->rec )
    {
        case REC_STARTING:
        {
            kit_no_swipe(kit);
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_mic_96, "Starting", NULL);
            break;
        }
        case REC_ON:
        {
            kit_no_swipe(kit);
            o = kit_disc(page, KIT_DISC_BIG, KUI_COLOR_DANGER, &app_glyph_mic_96);
            lv_obj_set_pos(o, 205 - (KIT_DISC_BIG / 2), 88);
            me->l_time = line_at(page, "0:00", &kui_font_title_60, KUI_COLOR_TEXT_ON_BG, 212);
            fmt_dur(buf, sizeof(buf), SND_REC_MAX_MS);
            (void)snprintf(me->msg_line, sizeof(me->msg_line), "of %s", buf);
            (void)line_at(page, me->msg_line, &kui_font_caption, KUI_COLOR_TEXT_MUTED, 284);
            me->l_fill = bar_make(page, 322, KUI_COLOR_DANGER);
            o = kit_button(kit, page, "Stop", KIT_BTN_DANGER, KUI_ACTION_W, &record_stop_cb, me);
            lv_obj_align(o, LV_ALIGN_TOP_MID, 0, SND_FOOT_Y);
            live_draw(me);
            break;
        }
        case REC_SAVING:
        {
            kit_no_swipe(kit);
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_wave_96, "Saving", NULL);
            break;
        }
        case REC_FAILED:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_mic_96, "Not recorded", me->rec_err);
            o = kit_button(kit, page, "Try again", KIT_BTN_ACTION, KUI_ACTION_W, &record_again_cb, me);
            lv_obj_align(o, LV_ALIGN_TOP_MID, 0, SND_FOOT_Y);
            break;
        }
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_mic_96, "Ready", "Up to 30 seconds");
            o = kit_button(kit, page, "Record", KIT_BTN_ACTION, KUI_ACTION_W, &record_go_cb, me);
            lv_obj_align(o, LV_ALIGN_TOP_MID, 0, SND_FOOT_Y);
            break;
        }
    }
    kit_bar(kit, page, (REC_ON == me->rec) ? "Recording" : "Record");
}

/* ---- The file door ---- */

/**
 * @brief Send the next wanted file request, when none is out.
 * @param me The Active Object.
 */
static void kick(SoundAo *me)
{
    kode_status_t rc = KODE_OK;

    if ( FOP_NONE != me->op )
    {
        return;
    }
    if ( me->want_delete )
    {
        me->want_delete = false;
        rc = kode_sys_file_delete(&me->super, me->from);
        me->op = (KODE_OK == rc) ? FOP_DELETE : FOP_NONE;
    }
    else if ( me->want_rename )
    {
        me->want_rename = false;
        rc = kode_sys_file_rename(&me->super, me->from, me->to);
        me->op = (KODE_OK == rc) ? FOP_RENAME : FOP_NONE;
    }
    else if ( me->want_list )
    {
        me->want_list = false;
        me->tmp_n     = 0U;
        me->skip      = 0U;
        rc = kode_sys_file_list(&me->super, SND_DIR, 0U);
        me->op = (KODE_OK == rc) ? FOP_LIST : FOP_NONE;
    }
    else
    {
        /* Nothing wanted. */
    }
    if ( (KODE_OK != rc) && (FOP_NONE == me->op) )
    {
        KLOG_W(TAG, "a file request was refused (%d)", (int)rc);
    }
}

/**
 * @brief Whether a name is a WAV file's.
 * @param name The name.
 * @return true for ".wav".
 */
static bool is_wav(const char *name)
{
    size_t const len = strlen(name);

    return (4U < len) && (0 == strcasecmp(&name[len - 4U], ".wav"));
}

/**
 * @brief Keep the list sorted by name.
 * @param me The Active Object.
 */
static void list_sort(SoundAo *me)
{
    for ( uint32_t i = 1U; i < me->live_n; ++i )
    {
        rec_t   key = me->live[i];
        int32_t j   = (int32_t)i - 1;

        while ( (0 <= j) && (0 < strcasecmp(me->live[j].name, key.name)) )
        {
            me->live[j + 1] = me->live[j];
            --j;
        }
        me->live[j + 1] = key;
    }
}

/**
 * @brief The page on the glass shows the list: draw it again.
 * @param me The Active Object.
 */
static void redraw(SoundAo *me)
{
    kit_build_fn_t const cur = kit_current(&me->kit);

    if ( (page_home == cur) || (page_list == cur) )
    {
        kit_refresh(&me->kit);
    }
}

/**
 * @brief One entry of a listing arrived.
 * @param me The Active Object.
 * @param en The entry.
 */
static void entry_in(SoundAo *me, StorageEntryEvt const *en)
{
    if ( FOP_LIST != me->op )
    {
        return;
    }
    me->skip++;
    if ( !en->is_dir && is_wav(en->name) && (SND_MAX_RECS > me->tmp_n) )
    {
        rec_t * const d = &me->tmp[me->tmp_n++];

        (void)snprintf(d->name, sizeof(d->name), "%s", en->name);
        d->size = en->size;
    }
}

/**
 * @brief A page of a listing ended.
 * @param me  The Active Object.
 * @param end The answer.
 */
static void list_end(SoundAo *me, FileRspEvt const *end)
{
    me->op = FOP_NONE;
    if ( (KODE_OK == end->rc) && end->more && (SND_MAX_RECS > me->tmp_n) )
    {
        if ( KODE_OK == kode_sys_file_list(&me->super, SND_DIR, (uint16_t)me->skip) )
        {
            me->op = FOP_LIST;
            return;
        }
    }
    if ( KODE_OK == end->rc )
    {
        uint32_t top = 0U;

        (void)memcpy(me->live, me->tmp, sizeof(rec_t) * me->tmp_n);
        me->live_n = me->tmp_n;
        list_sort(me);
        for ( uint32_t i = 0U; i < me->live_n; ++i )
        {
            unsigned id = 0U;

            if ( 1 == sscanf(me->live[i].name, "Rec %u.wav", &id) )
            {
                if ( id > top )
                {
                    top = id;
                }
            }
        }
        if ( (top + 1U) > me->next_id )
        {
            me->next_id = top + 1U;
            kit_store_save(&me->store);
        }
    }
    else
    {
        /* No folder yet is no recordings. */
        me->live_n = 0U;
    }
    me->list_done = true;
    redraw(me);
    kick(me);
}

/**
 * @brief Show a message page.
 * @param me    The Active Object.
 * @param title Its title.
 * @param line  Its line.
 */
static void say(SoundAo *me, const char *title, const char *line)
{
    (void)snprintf(me->msg_title, sizeof(me->msg_title), "%s", title);
    (void)snprintf(me->msg_line, sizeof(me->msg_line), "%s", line);
    kit_push(&me->kit, &page_msg, me);
}

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
    SoundAo * const  me   = (SoundAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;

    live_reset(me);
    kit_no_swipe(kit);
    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wave_96, me->msg_title, me->msg_line);
    btn = kit_button(kit, page, "Back", KIT_BTN_QUIET, KUI_ACTION_W, &msg_back_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, SND_FOOT_Y);
}

/* ---- Volume ---- */

/** @brief The volume moved. @param e The event. */
static void volume_cb(lv_event_t *e)
{
    SoundAo * const  me = &s_ao;
    lv_obj_t * const lv = lv_event_get_target_obj(e);
    char             buf[24];

    me->volume = (uint8_t)lv_slider_get_value(lv);
    (void)kode_sys_audio_volume(me->volume);
    if ( NULL != me->l_vol )
    {
        (void)snprintf(buf, sizeof(buf), "Volume %u%%", (unsigned)me->volume);
        lv_label_set_text(me->l_vol, buf);
    }
}

/** @brief A slider was let go: keep the settings. @param e The event. */
static void keep_cb(lv_event_t *e)
{
    (void)e;
    kit_store_save(&s_ao.store);
}

/**
 * @brief Put a slider on a page.
 * @param kit    The kit.
 * @param page   The page.
 * @param y      Where it stands.
 * @param lo     The least.
 * @param hi     The most.
 * @param val    Where it is.
 * @param cb     What a move does.
 * @return The slider.
 */
static lv_obj_t *slider_make(kit_t *kit, lv_obj_t *page, int32_t y, int32_t lo, int32_t hi, int32_t val,
                             lv_event_cb_t cb)
{
    lv_obj_t * const lv = kui_level_create(page, KUI_COLOR_LEVEL);

    lv_obj_set_pos(lv, KIT_SIDE, y);
    lv_obj_set_width(lv, KIT_ROW_W);
    lv_slider_set_range(lv, lo, hi);
    lv_slider_set_value(lv, val, LV_ANIM_OFF);
    lv_obj_add_event_cb(lv, cb, LV_EVENT_VALUE_CHANGED, &s_ao);
    lv_obj_add_event_cb(lv, &keep_cb, LV_EVENT_RELEASED, &s_ao);
    kit_focus_add(kit, lv);
    return lv;
}

/**
 * @brief The volume's caption and slider.
 * @param kit  The kit.
 * @param page The page.
 * @param y    The caption's top; the slider stands 30 under it.
 */
static void volume_make(kit_t *kit, lv_obj_t *page, int32_t y)
{
    char buf[24];

    (void)snprintf(buf, sizeof(buf), "Volume %u%%", (unsigned)s_ao.volume);
    s_ao.l_vol = line_at(page, buf, &kui_font_caption, KUI_COLOR_TEXT_MUTED, y);
    (void)slider_make(kit, page, y + 30, 0, 100, s_ao.volume, &volume_cb);
}

/* ---- Home ---- */

/** @brief A tap on Record. @param e The event. */
static void home_record_cb(lv_event_t *e)
{
    (void)e;
    if ( (REC_FAILED == s_ao.rec) || (REC_IDLE == s_ao.rec) )
    {
        s_ao.rec = REC_IDLE;
    }
    kit_push(&s_ao.kit, &page_record, &s_ao);
}

/** @brief A tap on Recordings. @param e The event. */
static void home_list_cb(lv_event_t *e)
{
    (void)e;
    s_ao.want_list = true;
    kick(&s_ao);
    kit_push(&s_ao.kit, &page_list, &s_ao);
}

/** @brief A tap on Tone. @param e The event. */
static void home_tone_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_tone, &s_ao);
}

/**
 * @brief The first page: record, listen, make a tone.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    SoundAo * const  me   = (SoundAo *)arg;
    lv_obj_t * const body = kit_page(kit, "Sound");
    char             sub[32];

    leave_guard(me);
    (void)kit_row(kit, body, "Record", "A voice note, up to 30 s", &app_glyph_mic_40, NULL, KUI_COLOR_DANGER,
                  &home_record_cb, me);
    if ( !me->list_done )
    {
        (void)snprintf(sub, sizeof(sub), "Play, rename, delete");
    }
    else if ( 0U == me->live_n )
    {
        (void)snprintf(sub, sizeof(sub), "None yet");
    }
    else
    {
        (void)snprintf(sub, sizeof(sub), "%u saved", (unsigned)me->live_n);
    }
    (void)kit_row(kit, body, "Recordings", sub, &app_glyph_wave_40, NULL, KUI_COLOR_ACCENT, &home_list_cb, me);
    (void)snprintf(sub, sizeof(sub), "%u Hz", (unsigned)tone_hz(me));
    (void)kit_row(kit, body, "Tone", sub, &app_glyph_tone_40, NULL, KUI_COLOR_ACTION, &home_tone_cb, me);
}

/* ---- The list ---- */

/** @brief A tap on a recording. @param e The event. */
static void list_pick_cb(lv_event_t *e)
{
    SoundAo * const me = &s_ao;
    uint32_t const  i  = (uint32_t)(uintptr_t)lv_event_get_user_data(e);

    if ( i >= me->live_n )
    {
        return;
    }
    (void)snprintf(me->cur_name, sizeof(me->cur_name), "%s", me->live[i].name);
    me->cur_size   = me->live[i].size;
    me->cur_ms     = size_ms(me->cur_size);
    me->base_depth = kit_depth(&me->kit);
    kit_push(&me->kit, &page_rec, me);
}

/** @brief A tap on Record in the empty list. @param e The event. */
static void list_record_cb(lv_event_t *e)
{
    (void)e;
    s_ao.rec = REC_IDLE;
    kit_replace(&s_ao.kit, &page_record, &s_ao);
}

/**
 * @brief The recordings, or why there are none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_list(kit_t *kit, void *arg)
{
    SoundAo * const me = (SoundAo *)arg;

    leave_guard(me);
    if ( !me->list_done )
    {
        lv_obj_t * const page = kit_page_bare(kit);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wave_96, "Looking", NULL);
        kit_bar(kit, page, "Recordings");
    }
    else if ( 0U == me->live_n )
    {
        lv_obj_t * const page = kit_page_bare(kit);
        lv_obj_t        *btn;

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_mic_96, "No recordings", "Record a voice note and it will show up here");
        btn = kit_button(kit, page, "Record", KIT_BTN_ACTION, KUI_ACTION_W, &list_record_cb, me);
        lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, SND_FOOT_Y);
        kit_bar(kit, page, "Recordings");
    }
    else
    {
        lv_obj_t * const body = kit_page(kit, "Recordings");

        for ( uint32_t i = 0U; i < me->live_n; ++i )
        {
            char nm[SND_NAME_MAX];
            char d[16];
            char z[16];
            char sub[40];

            show_name(nm, sizeof(nm), me->live[i].name);
            fmt_dur(d, sizeof(d), size_ms(me->live[i].size));
            fmt_size(z, sizeof(z), me->live[i].size);
            (void)snprintf(sub, sizeof(sub), "%s  %s", d, z);
            (void)kit_row(kit, body, nm, sub, &app_glyph_wave_40, NULL, KUI_COLOR_ACCENT, &list_pick_cb,
                          (void *)(uintptr_t)i);
        }
    }
}

/* ---- One recording ---- */

/** @brief A tap on Play or Stop. @param e The event. */
static void rec_play_cb(lv_event_t *e)
{
    SoundAo * const me = &s_ao;

    (void)e;
    if ( me->file_on )
    {
        stop_sound(me);
        return;
    }
    if ( me->work_busy )
    {
        return;
    }
    (void)snprintf(me->work_job.path, sizeof(me->work_job.path), "%s/%s", SND_VDIR, me->cur_name);
    if ( work_submit(me, JOB_PLAY) )
    {
        me->file_on = true;
        me->play_t0 = lv_tick_get();
        tick_set(me, true);
        kit_refresh(&me->kit);
    }
}

/**
 * @brief The rename keypad's answer.
 * @param user The Active Object.
 * @param text The name.
 */
static void rename_done(void *user, const char *text)
{
    SoundAo * const me = (SoundAo *)user;
    char            old[SND_NAME_MAX];

    show_name(old, sizeof(old), me->cur_name);
    if ( ('\0' == text[0]) || (0 == strcmp(text, old)) )
    {
        (void)kit_back(&me->kit);
        return;
    }
    (void)snprintf(me->from, sizeof(me->from), "%s/%s", SND_DIR, me->cur_name);
    (void)snprintf(me->to, sizeof(me->to), "%s/%s.wav", SND_DIR, text);
    me->want_rename = true;
    kick(me);
}

/** @brief A tap on Rename. @param e The event. */
static void rec_rename_cb(lv_event_t *e)
{
    SoundAo * const me = &s_ao;

    (void)e;
    stop_sound(me);
    show_name(me->name.text, sizeof(me->name.text), me->cur_name);
    me->name.max    = (uint8_t)SND_RENAME_MAX;
    me->name.mode   = 0U;
    me->name.done   = &rename_done;
    me->name.user   = me;
    me->name.title  = "Rename";
    me->name.answer = "Save";
    kit_push(&me->kit, &kit_name_page, &me->name);
}

/** @brief A tap on Delete. @param e The event. */
static void rec_delete_cb(lv_event_t *e)
{
    (void)e;
    stop_sound(&s_ao);
    kit_push(&s_ao.kit, &page_delete, &s_ao);
}

/**
 * @brief One recording: its length, a way to hear it, and what can be done with it.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_rec(kit_t *kit, void *arg)
{
    SoundAo * const  me   = (SoundAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *o;
    char             buf[24];
    char             nm[SND_NAME_MAX];
    int32_t const    half = (KIT_ROW_W - KIT_GAP) / 2;

    live_reset(me);
    fmt_dur(buf, sizeof(buf), me->file_on ? 0U : me->cur_ms);
    me->l_time = line_at(page, buf, &kui_font_title_60, KUI_COLOR_TEXT_ON_BG, 84);
    fmt_size(buf, sizeof(buf), me->cur_size);
    (void)line_at(page, buf, &kui_font_caption, KUI_COLOR_TEXT_MUTED, 154);
    me->l_fill = bar_make(page, 194, KUI_COLOR_ACCENT);
    fmt_dur(buf, sizeof(buf), me->cur_ms);
    (void)snprintf(nm, sizeof(nm), "of %s", buf);
    (void)line_at(page, nm, &kui_font_caption, KUI_COLOR_TEXT_MUTED, 210);
    if ( me->file_on )
    {
        o = kit_button(kit, page, "Stop", KIT_BTN_DANGER, 220, &rec_play_cb, me);
    }
    else
    {
        o = kit_button(kit, page, "Play", KIT_BTN_ACTION, 220, &rec_play_cb, me);
    }
    lv_obj_set_pos(o, 205 - 110, 244);
    o = kit_button(kit, page, "Rename", KIT_BTN_QUIET, half, &rec_rename_cb, me);
    lv_obj_set_pos(o, KIT_SIDE, 314);
    o = kit_button(kit, page, "Delete", KIT_BTN_DANGER, half, &rec_delete_cb, me);
    lv_obj_set_pos(o, KIT_SIDE + half + KIT_GAP, 314);
    volume_make(kit, page, 384);
    show_name(nm, sizeof(nm), me->cur_name);
    kit_bar(kit, page, nm);
    if ( me->file_on )
    {
        live_draw(me);
    }
}

/* ---- Delete ---- */

/** @brief Delete it. @param e The event. */
static void delete_yes_cb(lv_event_t *e)
{
    (void)e;
    (void)snprintf(s_ao.from, sizeof(s_ao.from), "%s/%s", SND_DIR, s_ao.cur_name);
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
    SoundAo * const  me   = (SoundAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *btn;
    char             nm[SND_NAME_MAX];

    live_reset(me);
    show_name(nm, sizeof(nm), me->cur_name);
    (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_trash_96, "Delete?", nm);
    btn = kit_button(kit, page, "Delete", KIT_BTN_DANGER, KUI_ACTION_W, &delete_yes_cb, me);
    lv_obj_align(btn, LV_ALIGN_TOP_MID, 0, SND_FOOT_Y);
}

/**
 * @brief A rename or a delete arrived.
 * @param me      The Active Object.
 * @param ans     The answer.
 * @param renamed Which of the two.
 */
static void change_end(SoundAo *me, FileRspEvt const *ans, bool renamed)
{
    me->op = FOP_NONE;
    if ( KODE_OK == ans->rc )
    {
        if ( renamed )
        {
            char const *slash = strrchr(me->to, '/');

            (void)snprintf(me->cur_name, sizeof(me->cur_name), "%s", (NULL != slash) ? &slash[1] : me->to);
            (void)kit_pop_to(&me->kit, (uint8_t)(me->base_depth + 1U));
        }
        else
        {
            (void)kit_pop_to(&me->kit, me->base_depth);
        }
        me->want_list = true;
    }
    else
    {
        (void)kit_back(&me->kit);
        if ( renamed )
        {
            say(me, "Not renamed", "That name is taken or not allowed");
        }
        else
        {
            say(me, "Not deleted", "The file could not be removed");
        }
    }
    kick(me);
}

/* ---- Tone ---- */

/**
 * @brief Start the tone, or stop it.
 * @param me The Active Object.
 */
static void tone_start(SoundAo *me)
{
    if ( me->work_busy )
    {
        return;
    }
    me->work_job.hz = tone_hz(me);
    if ( work_submit(me, JOB_TONE) )
    {
        me->tone_on = true;
        kit_refresh(&me->kit);
    }
}

/** @brief A tap on Play or Stop of the tone. @param e The event. */
static void tone_toggle_cb(lv_event_t *e)
{
    (void)e;
    if ( s_ao.tone_on )
    {
        s_ao.tone_again = false;
        stop_sound(&s_ao);
    }
    else
    {
        tone_start(&s_ao);
    }
}

/**
 * @brief The pitch changed: show it, and let a tone that sounds follow.
 * @param me The Active Object.
 */
static void tone_changed(SoundAo *me)
{
    char buf[16];

    if ( NULL != me->l_hz )
    {
        (void)snprintf(buf, sizeof(buf), "%u Hz", (unsigned)tone_hz(me));
        lv_label_set_text(me->l_hz, buf);
    }
}

/** @brief The pitch slider moved. @param e The event. */
static void tone_slide_cb(lv_event_t *e)
{
    lv_obj_t * const lv = lv_event_get_target_obj(e);

    s_ao.tone_step = (uint8_t)lv_slider_get_value(lv);
    tone_changed(&s_ao);
}

/** @brief The pitch slider was let go. @param e The event. */
static void tone_release_cb(lv_event_t *e)
{
    (void)e;
    kit_store_save(&s_ao.store);
    if ( s_ao.tone_on )
    {
        s_ao.tone_again = true;
        stop_sound(&s_ao);
    }
}

/** @brief A tap on a preset. @param e The event. */
static void tone_preset_cb(lv_event_t *e)
{
    SoundAo * const me = &s_ao;

    me->tone_step = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    if ( NULL != me->l_slider )
    {
        lv_slider_set_value(me->l_slider, me->tone_step, LV_ANIM_OFF);
    }
    tone_changed(me);
    kit_store_save(&me->store);
    if ( me->tone_on )
    {
        me->tone_again = true;
        stop_sound(me);
    }
}

/**
 * @brief The tone generator: a pitch, presets, and a button.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_tone(kit_t *kit, void *arg)
{
    SoundAo * const  me   = (SoundAo *)arg;
    lv_obj_t * const page = kit_page_bare(kit);
    lv_obj_t        *o;
    char             buf[16];
    static const struct { const char *label; uint8_t step; } presets[4] = {
        { "500", 2U }, { "1000", 12U }, { "2000", 32U }, { "3000", 52U }
    };
    int32_t const chip = (KIT_ROW_W - (3 * 10)) / 4;

    live_reset(me);
    (void)snprintf(buf, sizeof(buf), "%u Hz", (unsigned)tone_hz(me));
    me->l_hz = line_at(page, buf, &kui_font_title_60, KUI_COLOR_TEXT_ON_BG, 84);
    (void)line_at(page, me->tone_on ? "Sounding" : "Drag to change the pitch", &kui_font_caption,
                  KUI_COLOR_TEXT_MUTED, 154);
    o = kui_level_create(page, KUI_COLOR_LEVEL);
    lv_obj_set_pos(o, KIT_SIDE, 190);
    lv_obj_set_width(o, KIT_ROW_W);
    lv_slider_set_range(o, 0, (int32_t)SND_STEPS);
    lv_slider_set_value(o, me->tone_step, LV_ANIM_OFF);
    lv_obj_add_event_cb(o, &tone_slide_cb, LV_EVENT_VALUE_CHANGED, me);
    lv_obj_add_event_cb(o, &tone_release_cb, LV_EVENT_RELEASED, me);
    kit_focus_add(kit, o);
    me->l_slider = o;
    for ( uint32_t i = 0U; i < 4U; ++i )
    {
        o = kit_button(kit, page, presets[i].label, KIT_BTN_QUIET, chip, &tone_preset_cb,
                       (void *)(uintptr_t)presets[i].step);
        lv_obj_set_pos(o, KIT_SIDE + ((int32_t)i * (chip + 10)), 228);
    }
    if ( me->tone_on )
    {
        o = kit_button(kit, page, "Stop", KIT_BTN_DANGER, 220, &tone_toggle_cb, me);
    }
    else
    {
        o = kit_button(kit, page, "Play", KIT_BTN_ACTION, 220, &tone_toggle_cb, me);
    }
    lv_obj_set_pos(o, 205 - 110, 304);
    volume_make(kit, page, 384);
    kit_bar(kit, page, "Tone");
}

/* ---- Answers ---- */

/**
 * @brief The work worker's job ended.
 * @param me The Active Object.
 * @param d  The answer.
 */
static void work_end(SoundAo *me, kode_worker_done_t const *d)
{
    bool const        ok  = (KODE_OK == (kode_status_t)d->status);
    kit_build_fn_t    cur = kit_current(&me->kit);

    if ( d->seq != me->work_seq )
    {
        return;
    }
    me->work_busy = false;
    switch ( me->work_job.op )
    {
        case JOB_REC_START:
        {
            if ( ok )
            {
                me->rec    = REC_ON;
                me->rec_t0 = lv_tick_get();
                if ( page_record == cur )
                {
                    tick_set(me, true);
                    kit_refresh(&me->kit);
                }
                else
                {
                    finish_recording(me);
                }
            }
            else
            {
                me->rec = REC_FAILED;
                (void)snprintf(me->rec_err, sizeof(me->rec_err), "%s",
                               ('\0' != me->work_job.err[0]) ? me->work_job.err : "The microphone is not available");
                if ( page_record == cur )
                {
                    kit_refresh(&me->kit);
                }
            }
            break;
        }
        case JOB_REC_SAVE:
        {
            if ( ok )
            {
                (void)snprintf(me->cur_name, sizeof(me->cur_name), "%s", me->saving);
                me->cur_ms   = d->value;
                me->cur_size = SND_WAV_HEAD + (d->value * SND_BYTES_PER_MS);
                me->next_id++;
                kit_store_save(&me->store);
                me->rec       = REC_IDLE;
                me->want_list = true;
                kick(me);
                if ( page_record == cur )
                {
                    me->base_depth = (uint8_t)(kit_depth(&me->kit) - 1U);
                    kit_replace(&me->kit, &page_rec, me);
                }
            }
            else
            {
                me->rec = REC_FAILED;
                (void)snprintf(me->rec_err, sizeof(me->rec_err), "%s",
                               ('\0' != me->work_job.err[0]) ? me->work_job.err : "The file could not be written");
                if ( page_record == cur )
                {
                    kit_refresh(&me->kit);
                }
            }
            break;
        }
        case JOB_PLAY:
        {
            me->file_on = false;
            tick_set(me, false);
            if ( !ok )
            {
                say(me, "Cannot play", (NULL != strstr(me->work_job.err, "busy")) ? "Audio is busy, try again in a moment"
                                                                                : "Only 48 kHz mono 16-bit WAV files play");
            }
            else if ( page_rec == cur )
            {
                kit_refresh(&me->kit);
            }
            else
            {
                /* The page moved on. */
            }
            break;
        }
        case JOB_TONE:
        {
            me->tone_on = false;
            if ( me->tone_again && (page_tone == cur) )
            {
                me->tone_again = false;
                tone_start(me);
            }
            else
            {
                me->tone_again = false;
                if ( !ok )
                {
                    say(me, "No sound", ('\0' != me->work_job.err[0]) ? me->work_job.err : "The tone would not play");
                }
                else if ( page_tone == cur )
                {
                    kit_refresh(&me->kit);
                }
                else
                {
                    /* The page moved on. */
                }
            }
            break;
        }
        default:
        {
            break;
        }
    }
}

/* ---- The Active Object ---- */

void SoundAo_ctor(void)
{
    SoundAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&SoundAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)SND_RENDER_SIG);
    QTimeEvt_ctorX(&me->tick, &me->super, (enum_t)SND_TICK_SIG, 0U);
    kit_store_init(&me->store, &me->super, SND_DIR, SND_FILE, s_file, sizeof(s_file), &snd_pack, me);
    me->next_id   = 1U;
    me->tone_step = (uint8_t)SND_STEP_DEFAULT;
    me->volume    = 100U;
}

void SoundAo_start(void)
{
    QActive_setAttr(AO_Sound, TASK_NAME_ATTR, "sound_ao");
    QACTIVE_START(AO_Sound, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: the panel, the workers, the settings and the list, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to SoundAo_running.
 */
static QState SoundAo_initial(SoundAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    if ( (KODE_OK != kode_worker_start(&me->work, &me->super, "snd_work", 4096U, KODE_PRIO_USER_LOW, 1U))
         || (KODE_OK != kode_worker_start(&me->ctl, &me->super, "snd_stop", 3072U, KODE_PRIO_USER_LOW, 1U)) )
    {
        KLOG_E(TAG, "a worker did not start; sounds will be refused");
    }
    kit_store_load(&me->store);
    me->want_list = true;
    kick(me);
    KLOG_I(TAG, "up");
    return Q_TRAN(&SoundAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState SoundAo_running(SoundAo * const me, QEvt const * const e)
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
        case SND_TICK_SIG:
        {
            live_draw(me);
            if ( (REC_ON == me->rec) && (lv_tick_elaps(me->rec_t0) >= SND_REC_MAX_MS) )
            {
                finish_recording(me);
            }
            break;
        }
        case SND_WORK_DONE_SIG:
        {
            work_end(me, Q_EVT_CAST(kode_worker_done_t));
            break;
        }
        case SND_CTL_DONE_SIG:
        {
            me->ctl_busy = false;
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
            uint32_t           len = 0U;
            kit_store_result_t res;

            if ( !kit_on_event(&me->kit, e) )
            {
                res = kit_store_on_event(&me->store, e, &len);
                if ( KIT_STORE_LOADED == res )
                {
                    snd_unpack(me, len);
                }
                else if ( KIT_STORE_EMPTY == res )
                {
                    /* A first run: write the settings now, which makes the folder the recordings go in. */
                    kit_store_save(&me->store);
                }
                else if ( KIT_STORE_NONE == res )
                {
                    status = Q_SUPER(&QHsm_top);
                }
                else
                {
                    /* Saved or failed: nothing for the screen. */
                }
            }
            break;
        }
    }
    return status;
}
