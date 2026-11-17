/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file ir_ao.h
 * @brief The IR Remote app's Active Object.
 */
#ifndef IR_AO_H_
#define IR_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_IrKit;   /**< The one instance, opaque outside ir_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before IrKitAo_start(). */
void IrKitAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void IrKitAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* IR_AO_H_ */
