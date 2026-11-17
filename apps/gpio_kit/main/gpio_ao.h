/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file gpio_ao.h
 * @brief The GPIO app's Active Object.
 */
#ifndef GPIO_AO_H_
#define GPIO_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_GpioKit;   /**< The one instance, opaque outside gpio_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before GpioKitAo_start(). */
void GpioKitAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void GpioKitAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* GPIO_AO_H_ */
