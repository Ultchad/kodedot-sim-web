/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file sound_ao.h
 * @brief The Sound app's Active Object.
 */
#ifndef SOUND_AO_H_
#define SOUND_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_Sound;   /**< The one instance, opaque outside sound_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before SoundAo_start(). */
void SoundAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void SoundAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* SOUND_AO_H_ */
