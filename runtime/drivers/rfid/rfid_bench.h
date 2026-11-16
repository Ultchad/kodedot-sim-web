/* SPDX-License-Identifier: GPL-3.0-or-later
 * Internal to the RFID bench: what rfid_idf.c (the ESP-IDF peripheral fakes the real kdrv_rfid_lf.c runs on)
 * tells rfid_bench.c (the virtual cards, tags and door readers). */
#ifndef DOTBENCH_RFID_BENCH_H
#define DOTBENCH_RFID_BENCH_H
#include <stdbool.h>
#include <stdint.h>

#define RB_ADC_HZ        80000U   /* the driver samples the demod line at this rate */
#define RB_CARRIER_HZ    125000U  /* the nominal LF carrier */

/* ---- device side (called from the firmware's threads) ---- */
void     rb_dev_carrier(bool on, uint32_t hz);                 /* RFID_OUT's carrier started / went quiet */
void     rb_dev_gap(bool paused, uint64_t vt_us);              /* the carrier's timer paused / resumed, virtual time */
void     rb_dev_boost(bool on);                                /* VO4 held at 3.3 V */
void     rb_dev_pull(int level);                               /* RFID_PULL level */
void     rb_dev_adc_start(void);
void     rb_dev_adc_samples(uint16_t *out, uint32_t n);        /* synthesise the next n demod samples */
void     rb_dev_emu(bool on, const uint8_t *bits, uint32_t nbits, bool ext, uint32_t in_hz, uint32_t out_hz);
uint32_t rb_dev_field_hz(void);                                /* what a PCNT on RFID_CARRIER would count per second */
uint32_t rb_fault(void);
void     rb_log_vt(uint64_t vt_us);

/* ---- the independent EM4100 encoder (not the SDK's) ---- */
uint64_t rb_em4100_frame(const uint8_t id[5]);
bool     rb_em4100_parse_stream(const uint8_t *bits, uint32_t n, uint8_t id[5]); /* circular search, either polarity */
#endif
