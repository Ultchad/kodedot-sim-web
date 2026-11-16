/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_SOC_SOC_H
#define DOTBENCH_SOC_SOC_H
#include <stdint.h>
extern volatile uint32_t dotbench_lp_store[16];
#define REG_READ(addr)        (*(volatile uint32_t *)(addr))
#define REG_WRITE(addr, val)  (*(volatile uint32_t *)(addr) = (val))
#endif
