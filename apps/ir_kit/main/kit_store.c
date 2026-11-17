/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file kit_store.c
 * @brief A small saved file kept through kode_sys_file_*.
 */
#include "kit_store.h"

#include <string.h>

#define TAG "kit.store"   /**< This file's log tag. */

void kit_store_init(kit_store_t *s, QActive *owner, const char *dir, const char *path,
                    uint8_t *buf, uint32_t cap, kit_store_pack_fn_t pack, void *ctx)
{
    (void)memset(s, 0, sizeof(*s));
    s->owner = owner;
    s->dir   = dir;
    s->path  = path;
    s->buf   = buf;
    s->cap   = cap;
    s->pack  = pack;
    s->ctx   = ctx;
}

void kit_store_load(kit_store_t *s)
{
    if ( KODE_OK == kode_sys_file_read(s->owner, s->path, 0U, s->buf, s->cap) )
    {
        s->state = KIT_STORE_LOADING;
    }
    else
    {
        KLOG_W(TAG, "the read of %s was not taken", s->path);
    }
}

/**
 * @brief Pack the data and write it; the folder is made first when it may not exist.
 * @param s The store.
 */
static void store_write(kit_store_t *s)
{
    uint32_t const len = s->pack(s->ctx, s->buf, s->cap);

    s->dirty = false;
    if ( KODE_OK == kode_sys_file_write(s->owner, s->path, s->buf, len, false) )
    {
        s->state = KIT_STORE_WRITING;
    }
    else
    {
        s->dirty = true;
        KLOG_W(TAG, "the write of %s was not taken", s->path);
    }
}

/**
 * @brief Start the next step of a save: the folder, then the file.
 * @param s The store.
 */
static void store_start(kit_store_t *s)
{
    if ( (!s->dir_ok) && (KODE_OK == kode_sys_file_create_folder(s->owner, s->dir)) )
    {
        s->state = KIT_STORE_MKDIR;
    }
    else
    {
        store_write(s);
    }
}

void kit_store_save(kit_store_t *s)
{
    s->dirty = true;
    if ( KIT_STORE_IDLE == s->state )
    {
        store_start(s);
    }
}

bool kit_store_busy(kit_store_t const *s)
{
    return s->dirty || (KIT_STORE_IDLE != s->state);
}

kit_store_result_t kit_store_on_event(kit_store_t *s, QEvt const *e, uint32_t *len)
{
    kit_store_result_t res = KIT_STORE_NONE;

    if ( (FILE_READ_RSP_SIG == e->sig) && (KIT_STORE_LOADING == s->state) )
    {
        kode_sys_file_answer_t const * const a = Q_EVT_CAST(kode_sys_file_answer_t);

        s->state = KIT_STORE_IDLE;
        if ( ((uint8_t)KODE_OK == a->rc) && (0U < a->got) )
        {
            *len = a->got;
            res  = KIT_STORE_LOADED;
        }
        else
        {
            res = KIT_STORE_EMPTY;
        }
        if ( s->dirty )
        {
            store_start(s);
        }
    }
    else if ( (FILE_FOLDER_RSP_SIG == e->sig) && (KIT_STORE_MKDIR == s->state) )
    {
        /* The folder may exist already: either way the write is next. */
        s->dir_ok = true;
        store_write(s);
    }
    else if ( (FILE_WRITE_RSP_SIG == e->sig) && (KIT_STORE_WRITING == s->state) )
    {
        kode_sys_file_answer_t const * const a = Q_EVT_CAST(kode_sys_file_answer_t);

        s->state = KIT_STORE_IDLE;
        if ( (uint8_t)KODE_OK == a->rc )
        {
            s->failed = false;
            s->writes++;
            res = KIT_STORE_SAVED;
        }
        else
        {
            s->failed = true;
            KLOG_W(TAG, "the write failed (status %d)", (int)a->rc);
            res = KIT_STORE_FAILED;
        }
        if ( s->dirty )
        {
            store_start(s);
        }
    }
    else
    {
        /* Not the store's. */
    }
    return res;
}
