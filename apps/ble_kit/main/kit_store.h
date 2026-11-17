/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file kit_store.h
 * @brief A small saved file kept through kode_sys_file_*: loaded at start, written after every change, never waited for.
 */
#ifndef KIT_STORE_H_
#define KIT_STORE_H_

#include <stdbool.h>
#include <stdint.h>

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief What the store is doing. */
typedef enum {
    KIT_STORE_IDLE = 0,   /**< Nothing out. */
    KIT_STORE_LOADING,    /**< A read is out. */
    KIT_STORE_MKDIR,      /**< The folder is being made. */
    KIT_STORE_WRITING     /**< A write is out. */
} kit_store_state_t;

/** @brief What an answer meant to the app. */
typedef enum {
    KIT_STORE_NONE = 0,   /**< Nothing for the app. */
    KIT_STORE_LOADED,     /**< The file was read: unpack @c buf. */
    KIT_STORE_EMPTY,      /**< There was no file, or it was empty. */
    KIT_STORE_SAVED,      /**< A write finished. */
    KIT_STORE_FAILED      /**< A write failed. */
} kit_store_result_t;

/** @brief Fills the buffer from the app's data when a write starts; returns the bytes. */
typedef uint32_t (*kit_store_pack_fn_t)(void *ctx, uint8_t *buf, uint32_t cap);

/** @brief One saved file. */
typedef struct {
    QActive            *owner;     /**< The Active Object the answers come to. */
    const char         *dir;       /**< The app's folder on /storage. */
    const char         *path;      /**< The file in it. */
    uint8_t            *buf;       /**< The lent buffer: read into it, packed into it. */
    uint32_t            cap;       /**< Its size. */
    kit_store_pack_fn_t pack;      /**< Fills it for a write. */
    void               *ctx;       /**< What pack is given. */
    kit_store_state_t   state;     /**< What is out. */
    bool                dirty;     /**< A change waits for a write. */
    bool                failed;    /**< The last write failed. */
    bool                dir_ok;    /**< The folder has been made. */
    uint32_t            writes;    /**< Writes that finished, for the tests. */
} kit_store_t;

/**
 * @brief Set a store up.
 * @param s     The store.
 * @param owner The Active Object.
 * @param dir   The folder, absolute.
 * @param path  The file, absolute.
 * @param buf   The buffer.
 * @param cap   Its size.
 * @param pack  Fills the buffer for a write.
 * @param ctx   What pack is given.
 */
void kit_store_init(kit_store_t *s, QActive *owner, const char *dir, const char *path,
                    uint8_t *buf, uint32_t cap, kit_store_pack_fn_t pack, void *ctx);

/**
 * @brief Ask for the file's bytes.
 * @param s The store.
 */
void kit_store_load(kit_store_t *s);

/**
 * @brief Note a change: the file is written as soon as the owner of the disk is free.
 * @param s The store.
 */
void kit_store_save(kit_store_t *s);

/**
 * @brief Whether a change has not reached the disk.
 * @param s The store.
 * @return true while one is out or waiting.
 */
bool kit_store_busy(kit_store_t const *s);

/**
 * @brief Let the store take an answer.
 * @param s   The store.
 * @param e   The event.
 * @param len Receives the bytes of a load.
 * @return What the answer meant; KIT_STORE_NONE when it was not the store's.
 */
kit_store_result_t kit_store_on_event(kit_store_t *s, QEvt const *e, uint32_t *len);

#ifdef __cplusplus
}
#endif

#endif /* KIT_STORE_H_ */
