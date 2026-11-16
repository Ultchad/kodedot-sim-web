/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file level_ao.h
 * @brief The Level app's Active Object.
 */
#ifndef LEVEL_AO_H_
#define LEVEL_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_Level;   /**< The one instance, opaque outside level_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before LevelAo_start(). */
void LevelAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void LevelAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* LEVEL_AO_H_ */
