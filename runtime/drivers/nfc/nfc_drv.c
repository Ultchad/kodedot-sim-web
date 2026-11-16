/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_st25r3916 for the bench: the whole public interface of components/kdrv/nfc/include/kdrv_st25r3916.h,
 * answering from virtual NFC objects (nfc_bench.h) instead of from an ST25R3916B and ST's RFAL.
 *
 * What runs UNCHANGED above this seam: AO_Nfc (kaos/nfc), the standard layer (kode_nfc_*), kode_sys_nfc,
 * knfc_tag.c (identify, Type-2 / Type-4 / Mifare NDEF read and write), knfc_ndef.c, knfc_mfc.c and
 * knfc_crypto1.c (Mifare Classic over bit-counted frames), knfc_emu_img.c (the image an emulated card presents),
 * knfc_field.c. Only what is chip or radio is here: discovery and anticollision, the Type-2 READ/WRITE and
 * ISO-DEP exchanges, raw NFC-A frames, the listen window and the passive-target emulation worker.
 *
 * Behaviour that matters to callers is kept as the real driver has it:
 *  - discovery does not advance by itself: nothing activates until kdrv_st25r3916_worker() has been called
 *    a couple of times with an object near (AO_Nfc calls it on its 10 ms tick);
 *  - an activated tag is remembered until field_off(); if the object has left, every exchange answers
 *    KODE_TIMEOUT (as RFAL does) and it stays lost, even if the object returns, until a new discovery;
 *  - emulation stops asynchronously: emulate_stop() returns at once and emulate_active() stays true for
 *    EMU_STOP_MS, because the real worker tears the window down in its own task;
 *  - statuses: KODE_DENIED (no chip, bad argument, wrong state), KODE_TIMEOUT (nobody answered),
 *    KODE_ERROR (a NAK / refusal), KODE_NO_RESOURCES (message does not fit the image).
 * Every function holds the area spin lock for its whole body and calls nothing that can block. */
#include <string.h>
#include "kdrv_st25r3916.h"
#include "knfc_emu_img.h"
#include "knfc_field.h"
#include "knfc_tag.h"
#include "kode_log.h"
#include "nfc_bench.h"

#define TAG "kdrv.nfc"
#define ACT_CALLS    2u      /* worker() calls with an object near before it activates */
#define EMU_STOP_MS  20u     /* how long the emulation worker takes to release the reader */

static struct {
    bool present, field, discovering, cert, listening;
    int act;                                    /* slot of the activated object, -1 none */
    int cand;                                   /* slot being counted by the worker */
    uint32_t calls;
    bool act_lost;
    uint8_t act_uid[KDRV_ST25R3916_UID_MAX], act_uid_len, act_sak;
    uint16_t act_atqa;
    uint32_t tags, errors;
    nfc_mfc_sess_t mf;
    struct { uint8_t app, file; } t4;           /* ISO-DEP session: NDEF app selected, selected file (0 none, 1 CC, 2 NDEF) */
    knfc_field_acc_t lacc;
    uint32_t lstep;
    bool emulating, emu_stopping;
    uint32_t emu_stop_at, emu_gen;
    knfc_emu_image_t img;
    knfc_emu_stat_t stat;
    bool rd_in[NFC_SLOTS];
    uint32_t rd_gen[NFC_SLOTS];
} S = { .act = -1, .cand = -1 };

/* ------------------------------------------------------------------ helpers (lock held) */

static nfc_obj_t *slot_obj(int slot) { return &nfc_store()->obj[slot]; }

static void emu_refresh(void)
{
    if (S.emu_stopping && (int32_t)(nfc_now_ms() - S.emu_stop_at) >= 0) {
        S.emulating = false; S.emu_stopping = false;
        S.stat.active = false; S.stat.field = false; S.stat.selected = false;
        for (uint32_t i = 0; i < NFC_SLOTS; i++) S.rd_in[i] = false;
        nfc_event_push_locked(NFC_EV_EMU_STOPPED, 0, S.stat.reads, S.stat.sessions);
    }
}

static int find_tag(void)
{
    nfc_store_t *st = nfc_store();
    for (uint32_t i = 0; i < NFC_SLOTS; i++) {
        const nfc_obj_t *o = &st->obj[i];
        if (o->used && o->near_ && o->kind >= NFC_KIND_T2T && o->kind <= NFC_KIND_OTHER && !(o->flags & NFC_F_MUTE)) return (int)i;
    }
    return -1;
}

static void activate(int slot)
{
    const nfc_obj_t *o = slot_obj(slot);
    S.act = slot; S.act_lost = false;
    memset(S.act_uid, 0, sizeof S.act_uid);
    S.act_uid_len = o->uid_len > KDRV_ST25R3916_UID_MAX ? KDRV_ST25R3916_UID_MAX : o->uid_len;
    memcpy(S.act_uid, o->uid, S.act_uid_len);
    S.act_atqa = o->atqa; S.act_sak = o->sak;
    nfc_mfc_sess_reset(&S.mf);
    memset(&S.t4, 0, sizeof S.t4);
}

static void field_down(void)
{
    if (S.listening) { S.listening = false; }
    bool was = S.field || S.cert;
    S.field = false; S.discovering = false; S.cert = false;
    S.act = -1; S.act_lost = false; S.cand = -1; S.calls = 0;
    if (was) nfc_event_push_locked(NFC_EV_FIELD_OFF, 0, 0, 0);
}

static void lost(int slot)
{
    if (!S.act_lost) { S.act_lost = true; nfc_event_push_locked(NFC_EV_LOST, (uint32_t)slot + 1u, 0, 0); }
}

/* The gate every exchange passes: is the activated object still there? Fills *o. */
static kode_status_t gate(nfc_obj_t **o)
{
    if (!S.present || S.act < 0) return KODE_DENIED;
    nfc_obj_t *x = slot_obj(S.act);
    if (S.act_lost || !x->used || !x->near_) { lost(S.act); S.errors++; return KODE_TIMEOUT; }
    if (x->flags & NFC_F_DROP) {
        if (x->drop_left == 0) {                 /* the object leaves the field right now */
            x->flags &= (uint8_t)~NFC_F_DROP; x->near_ = 0;
            nfc_event_push_locked(NFC_EV_NEAR, (uint32_t)S.act + 1u, 0, 0);
            nfc_event_push_locked(NFC_EV_AWAY_DROPPED, (uint32_t)S.act + 1u, 0, 0);
            lost(S.act); S.errors++;
            return KODE_TIMEOUT;
        }
        x->drop_left--;
    }
    *o = x;
    return KODE_OK;
}

/* ------------------------------------------------------------------ emulation: readers meeting the emulated card */

static bool emu_live(void) { return S.emulating && !S.emu_stopping; }

static int reader_read(int slot, int block)
{
    nfc_obj_t *r = slot_obj(slot);
    emu_refresh();
    if (!emu_live() || !S.rd_in[slot]) return -2;
    if (block < 0 || (uint32_t)block >= KNFC_EMU_T2T_PAGES) return -3;
    for (uint32_t k = 0; k < 4; k++) {          /* a Type-2 READ answers four pages and wraps at the end of memory */
        uint32_t page = ((uint32_t)block + k) % KNFC_EMU_T2T_PAGES;
        memcpy(&r->mem[page * 4u], &S.img.t2t[page * 4u], 4);
        r->seen_valid[page / 8u] = (uint8_t)(r->seen_valid[page / 8u] | (1u << (page % 8u)));
    }
    r->mem_len = (uint16_t)KNFC_EMU_T2T_BYTES;
    r->reads++; S.stat.reads++;
    return 0;
}

static void reader_meet(int slot)
{
    nfc_obj_t *r = slot_obj(slot);
    if (!emu_live() || (S.rd_in[slot] && S.rd_gen[slot] == S.emu_gen)) return;
    S.rd_in[slot] = true; S.rd_gen[slot] = S.emu_gen;
    S.stat.field = true; S.stat.selected = true; S.stat.sessions++;
    r->sessions++;
    memset(r->seen_valid, 0, sizeof r->seen_valid); memset(r->mem, 0, KNFC_EMU_T2T_BYTES); r->mem_len = 0;
    r->seen_uid_len = S.img.nfcid_len; memcpy(r->seen_uid, S.img.nfcid, S.img.nfcid_len);
    r->seen_atqa = (uint16_t)(S.img.sens_res[0] | (S.img.sens_res[1] << 8)); r->seen_sak = S.img.sak;
    nfc_event_push_locked(NFC_EV_READER_SEEN, (uint32_t)slot + 1u, r->sessions, 0);
    if (r->flags & NFC_F_AUTOREAD) {
        for (int b = 0; b < (int)KNFC_EMU_T2T_PAGES; b += 4) (void)reader_read(slot, b);
    }
}

static void readers_update_levels(void)
{
    bool any = false, sel = false;
    for (uint32_t i = 0; i < NFC_SLOTS; i++) {
        const nfc_obj_t *o = &nfc_store()->obj[i];
        if (o->used && o->kind == NFC_KIND_READER && o->near_) { any = true; if (S.rd_in[i]) sel = true; }
        else S.rd_in[i] = false;
    }
    if (S.emulating) { S.stat.field = any; S.stat.selected = sel; }
}

void nfc_drv_object_near_locked(int slot, bool near_)
{
    nfc_obj_t *o = slot_obj(slot);
    if (o->kind == NFC_KIND_READER) {
        emu_refresh();
        if (near_) reader_meet(slot); else S.rd_in[slot] = false;
        readers_update_levels();
    }
    /* a tag leaving is noticed by the next exchange, as with RFAL */
}

int nfc_drv_reader_read_locked(int slot, int block)
{
    int rc = reader_read(slot, block);
    if (rc == 0) nfc_event_push_locked(NFC_EV_READER_SEEN, (uint32_t)slot + 1u, slot_obj(slot)->sessions, (uint32_t)block + 1u);
    return rc;
}

void nfc_drv_state_locked(uint32_t *w)
{
    emu_refresh();
    w[0] = nfc_store()->chip_absent ? 0u : 1u; w[1] = S.present; w[2] = S.field; w[3] = S.discovering;
    w[4] = S.act >= 0 ? (uint32_t)S.act + 1u : 0u; w[5] = S.act_lost; w[6] = S.emulating; w[7] = S.emu_stopping;
    w[8] = S.listening; w[9] = S.tags; w[10] = S.errors; w[11] = S.stat.sessions; w[12] = S.stat.reads;
    w[13] = S.stat.field; w[14] = S.stat.selected; w[15] = S.cert;
}

void nfc_drv_chip_changed_locked(void) { }

/* ------------------------------------------------------------------ the kdrv interface */

kode_status_t kdrv_st25r3916_init(void)
{
    nfc_lock();
    kode_status_t rc;
    if (S.present) rc = KODE_OK;
    else if (nfc_store()->chip_absent) rc = KODE_ERROR;
    else { S.present = true; rc = KODE_OK; }
    nfc_unlock();
    if (rc != KODE_OK) KLOG_W(TAG, "no reader: the Antenna PCB is not fitted on the bench");
    return rc;
}

bool kdrv_st25r3916_present(void) { nfc_lock(); bool p = S.present; nfc_unlock(); return p; }

kode_status_t kdrv_st25r3916_park(void)
{
    nfc_lock();
    kode_status_t rc = nfc_store()->chip_absent ? KODE_ERROR : KODE_OK;
    if (rc == KODE_OK) field_down();
    nfc_unlock();
    return rc;
}

kode_status_t kdrv_st25r3916_identity(uint8_t *out)
{
    if (!out) return KODE_DENIED;
    nfc_lock();
    bool p = S.present;
    nfc_unlock();
    if (!p) return KODE_DENIED;
    *out = KDRV_ST25R3916_IDENTITY;
    return KODE_OK;
}

kode_status_t kdrv_st25r3916_discover_start(void)
{
    nfc_lock();
    emu_refresh();
    kode_status_t rc = KODE_DENIED;
    if (S.present && !S.listening && !S.emulating) {
        S.act = -1; S.act_lost = false; S.cand = -1; S.calls = 0;
        if (!S.field) nfc_event_push_locked(NFC_EV_FIELD_ON, 0, 0, 0);
        S.field = true; S.discovering = true; S.cert = false;
        rc = KODE_OK;
    }
    nfc_unlock();
    return rc;
}

void kdrv_st25r3916_worker(void)
{
    nfc_lock();
    if (S.present && S.discovering && S.act < 0) {
        int s = find_tag();
        if (s < 0) { S.cand = -1; S.calls = 0; }
        else {
            if (s == S.cand) S.calls++; else { S.cand = s; S.calls = 1; }
            if (S.calls >= ACT_CALLS) {
                activate(s); S.tags++;
                nfc_event_push_locked(NFC_EV_ACTIVATED, (uint32_t)s + 1u, 0, 0);
            }
        }
    }
    nfc_unlock();
}

bool kdrv_st25r3916_activated(void) { nfc_lock(); bool a = S.act >= 0; nfc_unlock(); return a; }

bool kdrv_st25r3916_is_iso_dep(void)
{
    nfc_lock();
    bool d = S.act >= 0 && (S.act_sak & 0x20u) != 0u;
    nfc_unlock();
    return d;
}

kode_status_t kdrv_st25r3916_active_tag(uint8_t *uid, uint8_t *uid_len, uint16_t *atqa, uint8_t *sak)
{
    if (!uid || !uid_len || !atqa || !sak) return KODE_DENIED;
    nfc_lock();
    kode_status_t rc = KODE_OK;
    if (!S.present) rc = KODE_DENIED;
    else if (S.act < 0) rc = KODE_ERROR;
    else {
        memcpy(uid, S.act_uid, KDRV_ST25R3916_UID_MAX);
        *uid_len = S.act_uid_len; *atqa = S.act_atqa; *sak = S.act_sak;
    }
    nfc_unlock();
    return rc;
}

void kdrv_st25r3916_field_off(void)
{
    nfc_lock();
    if (S.present) field_down();
    nfc_unlock();
}

kode_status_t kdrv_st25r3916_cert_carrier(bool modulated)
{
    (void)modulated;
    nfc_lock();
    emu_refresh();
    kode_status_t rc = KODE_DENIED;
    if (S.present && !S.listening && !S.emulating) {
        field_down();
        S.field = true; S.cert = true;
        nfc_event_push_locked(NFC_EV_FIELD_ON, 0, 1, modulated ? 1u : 0u);
        rc = KODE_OK;
    }
    nfc_unlock();
    return rc;
}

/* ---- listen window: the external field, measured with the transmitter off ---- */

kode_status_t kdrv_st25r3916_listen_begin(void)
{
    nfc_lock();
    emu_refresh();
    kode_status_t rc = KODE_DENIED;
    if (S.present && !S.field && !S.listening && !S.emulating) {
        knfc_field_reset(&S.lacc); S.lstep = 0; S.listening = true; rc = KODE_OK;
    }
    nfc_unlock();
    return rc;
}

kode_status_t kdrv_st25r3916_listen_step(void)
{
    nfc_lock();
    kode_status_t rc = KODE_DENIED;
    if (S.listening) {
        uint8_t amp[KNFC_LISTEN_BURST];
        bool ext = false;
        uint8_t level = 0, mod = 0;
        for (uint32_t i = 0; i < NFC_SLOTS; i++) {
            const nfc_obj_t *o = &nfc_store()->obj[i];
            if (o->used && o->kind == NFC_KIND_READER && o->near_ && o->amp >= level) { ext = true; level = o->amp; mod = o->mod; }
        }
        for (uint32_t i = 0; i < KNFC_LISTEN_BURST; i++) {
            if (!ext) amp[i] = (uint8_t)(2u + (i & 1u));                         /* receiver noise floor */
            else amp[i] = (i & 1u) ? (uint8_t)(level > mod ? level - mod : 0) : level;
        }
        knfc_field_fold(&S.lacc, amp, KNFC_LISTEN_BURST, ext);
        S.lstep++;
        rc = KODE_OK;
    }
    nfc_unlock();
    return rc;
}

kode_status_t kdrv_st25r3916_listen_end(knfc_field_t *out)
{
    nfc_lock();
    kode_status_t rc = KODE_DENIED;
    if (S.listening) { knfc_field_close(&S.lacc, out); S.listening = false; rc = KODE_OK; }
    nfc_unlock();
    return rc;
}

/* ---- emulation ---- */

kode_status_t kdrv_st25r3916_emulate_start(const knfc_emu_card_t *card)
{
    if (!card) return KODE_DENIED;
    nfc_lock();
    emu_refresh();
    kode_status_t rc = KODE_DENIED;
    if (S.present && !S.field && !S.listening && !S.emulating) {
        knfc_emu_image_t img;
        rc = knfc_emu_image_build(card, &img);
        if (rc == KODE_OK) {
            S.img = img; S.emulating = true; S.emu_stopping = false; S.emu_gen++;
            memset(&S.stat, 0, sizeof S.stat); S.stat.active = true;
            memset(S.rd_in, 0, sizeof S.rd_in);
            nfc_event_push_locked(NFC_EV_EMU_STARTED, 0, img.nfcid_len, img.sak);
            for (uint32_t i = 0; i < NFC_SLOTS; i++) {
                const nfc_obj_t *o = &nfc_store()->obj[i];
                if (o->used && o->kind == NFC_KIND_READER && o->near_) reader_meet((int)i);
            }
            readers_update_levels();
        }
    }
    nfc_unlock();
    return rc;
}

kode_status_t kdrv_st25r3916_emulate_stop(void)
{
    nfc_lock();
    emu_refresh();
    kode_status_t rc = KODE_DENIED;
    if (S.present && S.emulating) {
        if (!S.emu_stopping) { S.emu_stopping = true; S.emu_stop_at = nfc_now_ms() + EMU_STOP_MS; }
        rc = KODE_OK;
    }
    nfc_unlock();
    return rc;
}

bool kdrv_st25r3916_emulate_active(void) { nfc_lock(); emu_refresh(); bool a = S.emulating; nfc_unlock(); return a; }

void kdrv_st25r3916_emulate_snapshot(knfc_emu_stat_t *out)
{
    if (!out) return;
    nfc_lock();
    emu_refresh();
    *out = S.stat;
    nfc_unlock();
}

/* ---- Type-2 ---- */

kode_status_t kdrv_st25r3916_t2t_read(uint8_t block, uint8_t *buf, uint16_t cap, uint16_t *got)
{
    if (!buf || cap < 16u) return KODE_DENIED;
    nfc_lock();
    nfc_obj_t *o = NULL;
    kode_status_t rc = gate(&o);
    uint16_t n = 0;
    if (rc == KODE_OK) {
        if (o->kind == NFC_KIND_T2T) {
            if ((uint32_t)block * 4u >= o->mem_len) { rc = KODE_ERROR; S.errors++; }          /* NAK: page out of range */
            else {
                for (uint32_t i = 0; i < 16u; i++) buf[i] = o->mem[((uint32_t)block * 4u + i) % o->mem_len];   /* wraps like an NTAG */
                n = 16; o->reads++;
            }
        } else if (o->kind == NFC_KIND_MIFARE) { rc = KODE_ERROR; S.errors++; }                  /* an unauthenticated Classic NAKs */
        else { rc = KODE_TIMEOUT; S.errors++; }                                                  /* nothing answers a Type-2 command */
    }
    nfc_unlock();
    if (got) *got = n;
    return rc;
}

kode_status_t kdrv_st25r3916_t2t_write(uint8_t block, const uint8_t *data)
{
    if (!data) return KODE_DENIED;
    nfc_lock();
    nfc_obj_t *o = NULL;
    kode_status_t rc = gate(&o);
    if (rc == KODE_OK) {
        if (o->kind == NFC_KIND_T2T) {
            uint32_t pages = o->mem_len / 4u;
            if (block >= pages || block < 2u || (block >= 4u && (o->flags & NFC_F_LOCKED))) { rc = KODE_ERROR; S.errors++; }
            else {
                uint8_t *p = &o->mem[(uint32_t)block * 4u];
                if (block == 2u) { p[2] |= data[2]; p[3] |= data[3]; }                            /* lock bytes only set */
                else if (block == 3u) { for (int i = 0; i < 4; i++) p[i] |= data[i]; }            /* capability container is one-time programmable */
                else memcpy(p, data, 4);
                o->writes++; o->mod_seq++;
            }
        } else if (o->kind == NFC_KIND_MIFARE) { rc = KODE_ERROR; S.errors++; }
        else { rc = KODE_TIMEOUT; S.errors++; }
    }
    nfc_unlock();
    return rc;
}

/* ---- ISO-DEP (Type 4) ---- */

#define SW(buf, n, a, b) do { (buf)[(n)] = (a); (buf)[(n) + 1] = (b); } while (0)

static uint16_t t4_apdu(nfc_obj_t *o, const uint8_t *c, uint16_t cl, uint8_t *r)
{
    static const uint8_t aid[7] = { 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01 };
    if (cl < 4u) { SW(r, 0, 0x67, 0x00); return 2; }
    if (c[0] != 0x00u) { SW(r, 0, 0x6E, 0x00); return 2; }
    uint8_t ins = c[1];
    if (ins == 0xA4u) {                                                     /* SELECT */
        if (cl < 5u) { SW(r, 0, 0x67, 0x00); return 2; }
        uint8_t lc = c[4];
        if (cl < 5u + lc) { SW(r, 0, 0x67, 0x00); return 2; }
        if (c[2] == 0x04u) {                                                /* by name */
            if (lc == 7u && memcmp(&c[5], aid, 7) == 0 && !(o->flags & NFC_F_NOAPP)) { S.t4.app = 1; S.t4.file = 0; SW(r, 0, 0x90, 0x00); }
            else SW(r, 0, 0x6A, 0x82);
            return 2;
        }
        if (c[2] == 0x00u && lc == 2u && S.t4.app) {                        /* by file id */
            if (c[5] == 0xE1u && c[6] == 0x03u) { S.t4.file = 1; SW(r, 0, 0x90, 0x00); }
            else if (c[5] == 0xE1u && c[6] == 0x04u) { S.t4.file = 2; SW(r, 0, 0x90, 0x00); }
            else SW(r, 0, 0x6A, 0x82);
            return 2;
        }
        SW(r, 0, 0x6A, 0x82); return 2;
    }
    if (ins == 0xB0u) {                                                     /* READ BINARY */
        if (!S.t4.file) { SW(r, 0, 0x69, 0x86); return 2; }
        uint32_t off = ((uint32_t)c[2] << 8) | c[3], le = cl >= 5u ? c[4] : 0u;
        if (le == 0) le = 256;
        uint8_t cc[15] = { 0x00, 0x0F, 0x20, 0x00, 0xFF, 0x00, 0xFF, 0x04, 0x06, 0xE1, 0x04,
                           (uint8_t)(o->mem_len >> 8), (uint8_t)o->mem_len, 0x00, (uint8_t)((o->flags & NFC_F_LOCKED) ? 0xFF : 0x00) };
        const uint8_t *src = S.t4.file == 1 ? cc : o->mem;
        uint32_t size = S.t4.file == 1 ? sizeof cc : o->mem_len;
        if (off >= size) { SW(r, 0, 0x6B, 0x00); return 2; }
        uint32_t n = size - off < le ? size - off : le;
        memcpy(r, src + off, n); SW(r, n, 0x90, 0x00);
        o->reads++;
        return (uint16_t)(n + 2u);
    }
    if (ins == 0xD6u) {                                                     /* UPDATE BINARY */
        if (S.t4.file != 2) { SW(r, 0, 0x69, 0x86); return 2; }
        if (o->flags & NFC_F_LOCKED) { SW(r, 0, 0x69, 0x82); return 2; }
        uint32_t off = ((uint32_t)c[2] << 8) | c[3], lc = cl >= 5u ? c[4] : 0u;
        if (cl < 5u + lc || off + lc > o->mem_len) { SW(r, 0, 0x67, 0x00); return 2; }
        memcpy(&o->mem[off], &c[5], lc);
        o->writes++; o->mod_seq++;
        SW(r, 0, 0x90, 0x00); return 2;
    }
    SW(r, 0, 0x6D, 0x00);
    return 2;
}

kode_status_t kdrv_st25r3916_apdu(const uint8_t *tx, uint16_t tx_len, uint8_t *rx, uint16_t rx_cap, uint16_t *rx_len)
{
    if (!tx || !rx || tx_len == 0 || tx_len > KDRV_ST25R3916_APDU_MAX || rx_cap == 0) return KODE_DENIED;
    nfc_lock();
    kode_status_t rc = KODE_DENIED;
    uint16_t n = 0;
    if (S.present && S.act >= 0 && (S.act_sak & 0x20u)) {
        nfc_obj_t *o = NULL;
        rc = gate(&o);
        if (rc == KODE_OK) {
            if (o->kind != NFC_KIND_T4T) { rc = KODE_TIMEOUT; S.errors++; }                      /* no ISO-DEP stack behind that SAK */
            else {
                uint8_t r[300];
                uint16_t len = t4_apdu(o, tx, tx_len, r);
                n = len > rx_cap ? rx_cap : len;
                memcpy(rx, r, n);
            }
        }
    }
    nfc_unlock();
    if (rx_len) *rx_len = n;
    return rc;
}

/* ---- raw NFC-A (Mifare Classic) ---- */

kode_status_t kdrv_st25r3916_transceive_bits(const uint8_t *tx, uint16_t tx_bits, uint8_t *rx, uint16_t rx_cap, uint16_t *rx_bits,
                                             uint16_t fwt_ms)
{
    (void)fwt_ms;
    if (!tx || !rx || tx_bits == 0 || rx_cap == 0) return KODE_DENIED;
    nfc_lock();
    nfc_obj_t *o = NULL;
    kode_status_t rc = gate(&o);
    uint16_t bits = 0;
    if (rc == KODE_OK) {
        if (o->kind != NFC_KIND_MIFARE || nfc_mfc_card_frame(o, &S.mf, tx, tx_bits, rx, rx_cap, &bits)) { bits = 0; rc = KODE_TIMEOUT; }
    }
    nfc_unlock();
    if (rx_bits) *rx_bits = bits;
    return rc;
}

kode_status_t kdrv_st25r3916_reselect(void)
{
    nfc_lock();
    kode_status_t rc = KODE_DENIED;
    if (S.present) {
        int keep = -1;
        if (S.act >= 0) { const nfc_obj_t *a = slot_obj(S.act); if (a->used && a->near_ && !(a->flags & NFC_F_MUTE)) keep = S.act; }
        int s = keep >= 0 ? keep : find_tag();
        if (s >= 0) { activate(s); rc = KODE_OK; }
        else { if (S.act >= 0) lost(S.act); rc = KODE_TIMEOUT; }
    }
    nfc_unlock();
    return rc;
}

/* ---- the console's field table ---- */

static const kdrv_st25r3916_field_info_t ROWS[KDRV_ST25_FIELD_MAX] = {
    [KDRV_ST25_IDENTITY]   = { "identity",   "bits",  0, 255, 1, false },
    [KDRV_ST25_IC_TYPE]    = { "ic_type",    "code",  0,  31, 1, false },
    [KDRV_ST25_IC_REV]     = { "ic_rev",     "code",  0,   7, 1, false },
    [KDRV_ST25_OP_CONTROL] = { "op_control", "bits",  0, 255, 1, false },
    [KDRV_ST25_EN]         = { "en",         "bool",  0,   1, 1, false },
    [KDRV_ST25_RX_EN]      = { "rx_en",      "bool",  0,   1, 1, false },
    [KDRV_ST25_RX_CHN]     = { "rx_chn",     "bool",  0,   1, 1, false },
    [KDRV_ST25_RX_MAN]     = { "rx_man",     "bool",  0,   1, 1, false },
    [KDRV_ST25_TX_EN]      = { "tx_en",      "bool",  0,   1, 1, false },
    [KDRV_ST25_WU]         = { "wu",         "bool",  0,   1, 1, false },
    [KDRV_ST25_MODE]       = { "mode",       "bits",  0, 255, 1, false },
    [KDRV_ST25_OM]         = { "om",         "code",  0,  15, 1, false },
    [KDRV_ST25_TR_AM]      = { "tr_am",      "bool",  0,   1, 1, false },
    [KDRV_ST25_BIT_RATE]   = { "bit_rate",   "bits",  0, 255, 1, false },
    [KDRV_ST25_TXRATE]     = { "txrate",     "code",  0,  15, 1, false },
    [KDRV_ST25_RXRATE]     = { "rxrate",     "code",  0,  15, 1, false },
    [KDRV_ST25_REGULATOR]  = { "regulator",  "bits",  0, 255, 1, false },
    [KDRV_ST25_FIELD]      = { "field",      "bool",  0,   1, 1, false },
    [KDRV_ST25_TAGS]       = { "tags",       "count", 0, INT32_MAX, 1, false },
    [KDRV_ST25_ERRORS]     = { "errors",     "count", 0, INT32_MAX, 1, false },
};

/* The registers are approximated from the driver's own state (awake = field, listen window or emulation;
 * the operation mode is NFC-A initiator while a field is up). The chip's analog registers are not modelled. */
kode_status_t kdrv_st25r3916_get(kdrv_st25r3916_field_t f, int32_t *value)
{
    if (!value || (unsigned)f >= (unsigned)KDRV_ST25_FIELD_MAX) return KODE_DENIED;
    nfc_lock();
    emu_refresh();
    kode_status_t rc = KODE_OK;
    if (!S.present) rc = KODE_DENIED;
    else {
        bool awake = S.field || S.listening || S.emulating;
        int en = awake, rx = S.field || S.listening, tx = S.field, om = S.field ? 1 : 0;
        int op = (en << 7) | (rx << 6) | (tx << 3);
        switch (f) {
        case KDRV_ST25_IDENTITY: *value = KDRV_ST25R3916_IDENTITY; break;
        case KDRV_ST25_IC_TYPE: *value = KDRV_ST25R3916_IDENTITY >> 3; break;
        case KDRV_ST25_IC_REV: *value = KDRV_ST25R3916_IDENTITY & 7; break;
        case KDRV_ST25_OP_CONTROL: *value = op; break;
        case KDRV_ST25_EN: *value = en; break;
        case KDRV_ST25_RX_EN: *value = rx; break;
        case KDRV_ST25_TX_EN: *value = tx; break;
        case KDRV_ST25_MODE: *value = om << 3; break;
        case KDRV_ST25_OM: *value = om; break;
        case KDRV_ST25_FIELD: *value = S.field; break;
        case KDRV_ST25_TAGS: *value = (int32_t)S.tags; break;
        case KDRV_ST25_ERRORS: *value = (int32_t)S.errors; break;
        default: *value = 0; break;
        }
    }
    nfc_unlock();
    return rc;
}

const kdrv_st25r3916_field_info_t *kdrv_st25r3916_field_info(kdrv_st25r3916_field_t f)
{
    if ((unsigned)f >= (unsigned)KDRV_ST25_FIELD_MAX) return NULL;
    return &ROWS[f];
}
