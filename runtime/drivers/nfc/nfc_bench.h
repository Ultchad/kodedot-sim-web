/* SPDX-License-Identifier: GPL-3.0-or-later
 * Internal to runtime/drivers/nfc: the bench objects (virtual NFC tags, cards and readers) and
 * what the fake kdrv_st25r3916 and the page-side exports share.
 *
 * Everything in nfc_store_t lives in the persistent region "nfc": bench objects are physical things
 * on the desk, so a restart of the device does not make them disappear (or leave the antenna). The
 * runtime state of the fake driver (field, discovery, activated object, emulation window) is plain
 * RAM and starts clean at every boot, as the chip does.
 */
#ifndef NFC_BENCH_H
#define NFC_BENCH_H
#include <stdbool.h>
#include <stdint.h>
#include "knfc_crypto1.h"

#define NFC_SLOTS      6u        /* bench objects at once; ids are 1..NFC_SLOTS */
#define NFC_MEM_BYTES  4096u     /* biggest memory: a Mifare Classic 4K         */
#define NFC_UID_MAX    10u
#define NFC_T2T_PAGES_MAX (NFC_MEM_BYTES / 4u)

/* object kinds (exported to JS: keep in step with nfc.js) */
enum { NFC_KIND_NONE = 0, NFC_KIND_T2T = 1, NFC_KIND_T4T = 2, NFC_KIND_MIFARE = 3, NFC_KIND_OTHER = 4, NFC_KIND_READER = 5 };

/* object flags */
#define NFC_F_LOCKED  0x01u   /* the object refuses writes (T2T: NAK, T4T: write access denied, Mifare: NAK)  */
#define NFC_F_NOAPP   0x02u   /* T4T: the NDEF application is not there (SELECT answers 6A82)                   */
#define NFC_F_MUTE    0x04u   /* answers nothing at all: a dead tag. Never activates.                           */
#define NFC_F_AUTOREAD 0x08u  /* reader: read the whole Type-2 image as soon as the device is selected          */
#define NFC_F_DROP    0x10u   /* armed: leaves the field after drop_left more exchanges                          */

/* set_param keys */
enum { NFC_P_DROP_AFTER = 1, NFC_P_AMP = 2, NFC_P_MOD = 3 };

typedef struct {
    uint8_t  used, kind, near_, flags;
    uint8_t  uid_len, sak, amp, mod;          /* amp/mod: a reader's field level and modulation depth (listen windows) */
    uint16_t atqa;
    uint16_t mem_len;                         /* bytes of mem that are real */
    uint8_t  uid[NFC_UID_MAX];
    uint8_t  seen_uid_len, seen_sak;          /* reader: what the emulated card identified itself as */
    uint16_t seen_atqa;
    uint8_t  seen_uid[NFC_UID_MAX];
    uint16_t _pad;
    uint32_t drop_left;
    uint32_t mod_seq;                         /* bumped by every device write */
    uint32_t writes;                          /* device writes that succeeded (blocks / UPDATE BINARY) */
    uint32_t reads;                           /* exchanges served (tags/cards) / READs the reader made */
    uint32_t sessions;                        /* reader: sessions with the emulated card */
    uint8_t  seen_valid[NFC_MEM_BYTES / 4u / 8u]; /* reader: one bit per page it has read (128 bytes) */
    uint8_t  mem[NFC_MEM_BYTES];
} nfc_obj_t;

typedef struct {
    uint32_t magic;
    uint32_t chip_absent;                     /* 1 = no Antenna PCB: kdrv_st25r3916_init() fails */
    nfc_obj_t obj[NFC_SLOTS];
} nfc_store_t;

/* events (C -> JS ring) */
enum {
    NFC_EV_FIELD_ON = 1,        /* a = 0 discovery, 1 certification carrier */
    NFC_EV_FIELD_OFF = 2,
    NFC_EV_ACTIVATED = 3,       /* id = the object the device selected */
    NFC_EV_NEAR = 4,            /* id; a = 1 near, 0 away */
    NFC_EV_AWAY_DROPPED = 5,    /* id: the object left by itself (drop_after) */
    NFC_EV_EMU_STARTED = 6,     /* a = uid_len, b = sak */
    NFC_EV_EMU_STOPPED = 7,     /* a = reads served */
    NFC_EV_READER_SEEN = 8,     /* id = reader; a = sessions */
    NFC_EV_LOST = 9,            /* id = the activated object, found gone by an exchange */
    NFC_EV_REMOVED = 10,        /* id destroyed */
    NFC_EV_CREATED = 11         /* id */
};

/* ---- shared state (nfc_bench.c) ---- */
void nfc_lock(void);
void nfc_unlock(void);
nfc_store_t *nfc_store(void);                /* the store; call with the lock held for anything but reads of one byte */
void nfc_event_push_locked(uint32_t type, uint32_t id, uint32_t a, uint32_t b);
uint32_t nfc_now_ms(void);

/* ---- the fake driver's side of the bench (nfc_drv.c); all with the lock held ---- */
void nfc_drv_object_near_locked(int slot, bool near_);          /* an object came or went: readers meet the emulated card */
int  nfc_drv_reader_read_locked(int slot, int block);           /* a reader object READs 4 pages from the emulated card */
void nfc_drv_state_locked(uint32_t *out16);                     /* observable driver state, 16 words (see nfc_bench.c) */
void nfc_drv_chip_changed_locked(void);                         /* chip_absent was set */

/* ---- the Mifare Classic card model (nfc_mfc_card.c); lock held, called from the fake's transceive ---- */
typedef struct {
    uint8_t  state;          /* 0 idle (selected), 1 waiting for {nr}{ar}, 2 authenticated, 3 waiting for write data, 4 dead */
    uint8_t  sector_first;   /* first block of the authenticated sector */
    uint8_t  sector_blocks;
    uint8_t  write_block;
    uint32_t nt;
    uint32_t nonce_ctr;
    knfc_crypto1_t c;
} nfc_mfc_sess_t;

void nfc_mfc_sess_reset(nfc_mfc_sess_t *s);
/* returns 0 and fills rx/rx_bits, or 1 for "the card stays silent" */
int nfc_mfc_card_frame(nfc_obj_t *o, nfc_mfc_sess_t *s, const uint8_t *tx, uint16_t tx_bits, uint8_t *rx, uint16_t rx_cap,
                       uint16_t *rx_bits);
#endif
