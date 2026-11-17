/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_exp's ADC port (replaces components/khal/exp/src/khal_exp_esp.c): the millivolts come from the bench's net solver.
 * khal_exp.c above it (positions, modes, loans, controller books) is the SDK's own, unmodified. */
#include <stdbool.h>
#include <stdint.h>

#include "dotbench_exp.h"
#include "kbsp_exp.h"
#include "kode_defs.h"

#define EXP_ADC_FS_MV  3100   /* the 12 dB range's full scale (the SDK's own constant, see khal_exp_esp.c) */
#define EXP_ADC_FS_RAW 4095

static uint8_t g_open;   /* bit n: ADC1 channel n is open */

static int pos_of_chan(uint8_t chan)
{
    if (chan >= 8 || chan == (uint8_t)KBSP_EXP_NO_ADC) return -1;
    for (int i = 0; i < DBX_POS; i++) if (KBSP_EXP[i].adc_chan == chan) return i;
    return -1;
}

kode_status_t khal_exp_port_adc_open(uint8_t chan)
{
    int pos = pos_of_chan(chan);
    if (pos < 0) return KODE_DENIED;
    g_open |= (uint8_t)(1u << chan);
    dbx_pin_set(dbx_pos_to_gpio(pos), DBX_ADC, DBX_PULL_NONE, 0, 0, 0);
    return KODE_OK;
}

kode_status_t khal_exp_port_adc_read(uint8_t chan, uint16_t *raw, int32_t *mv, bool *calibrated)
{
    *raw = 0; *mv = 0; *calibrated = false;
    int pos = pos_of_chan(chan);
    if (pos < 0 || !(g_open & (1u << chan))) return KODE_DENIED;
    int32_t v = dbx_mv(pos);
    if (v < 0) v = 0;
    int32_t r = (v * EXP_ADC_FS_RAW) / EXP_ADC_FS_MV;
    if (r > EXP_ADC_FS_RAW) r = EXP_ADC_FS_RAW;
    *raw = (uint16_t)r;
    *mv = (r * EXP_ADC_FS_MV) / EXP_ADC_FS_RAW;   /* what the calibrated scheme returns for that count */
    *calibrated = true;
    return KODE_OK;
}

void khal_exp_port_adc_close(uint8_t chan)
{
    int pos = pos_of_chan(chan);
    if (pos < 0) return;
    g_open &= (uint8_t)~(1u << chan);
    dbx_pin_set(dbx_pos_to_gpio(pos), DBX_Z, DBX_PULL_NONE, 0, 0, 0);
}
