/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file light_ao.h
 * @brief The Light app's Active Object: a torch from the screen, a colour LED and SOS.
 */
#ifndef LIGHT_AO_H_
#define LIGHT_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---- The Active Object ---- */

extern QActive * const AO_Light;   /**< The one instance, opaque outside light_ao.c. */

/* ---- Calls ---- */

/**
 * @brief Construct the Active Object; call it after kode_init() and before LightAo_start().
 */
void LightAo_ctor(void);

/**
 * @brief Give the Active Object its task, queue and stack, and start it.
 */
void LightAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* LIGHT_AO_H_ */
