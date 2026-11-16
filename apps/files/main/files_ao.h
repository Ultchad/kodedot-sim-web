/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file files_ao.h
 * @brief The Files app's Active Object.
 */
#ifndef FILES_AO_H_
#define FILES_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_Files;   /**< The one instance, opaque outside files_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before FilesAo_start(). */
void FilesAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void FilesAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* FILES_AO_H_ */
