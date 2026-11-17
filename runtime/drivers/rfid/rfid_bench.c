/* SPDX-License-Identifier: GPL-3.0-or-later
 * The 125 kHz bench: virtual EM4100 cards, T5577 tags and door readers, and the world's half of the ESP-IDF
 * peripherals the real kdrv_rfid_lf.c drives (see rfid_idf.c for the other half).
 *
 *  card / tag -> device : when the device's carrier is up and an object is near, the ADC "demod line" carries the
 *                         object's Manchester load modulation, synthesised per 80 kS/s sample, so the SDK's own
 *                         krfid_em4100_decode() runs over it.
 *  device -> tag        : the carrier gaps of a T5577 write (khal_pwm_pause/resume on the virtual clock) are
 *                         decoded here into block programs.
 *  device -> reader     : the PARLIO bit stream of an emulation is decoded here (independent decoder) as a door
 *                         reader would, if the reader's field is on and its clock matches.
 * Threading: one mutex, held for microseconds, never across an SDK call. Exports are safe from the page's thread. */
#include "page_lock.h"
#include <emscripten.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "rfid_bench.h"

#define RB_MAX_OBJ   16
#define RB_EV_CAP    256
enum { RB_NONE = 0, RB_CARD = 1, RB_T5577 = 2, RB_READER = 3 };
enum { EV_CARRIER = 1, EV_BOOST, EV_DEVICE_READ, EV_BLOCK, EV_TAG_ID, EV_EMU, EV_READER_SAW, EV_FIELD, EV_WRITE_REJECT, EV_LEFT };
enum { REJ_NO_TAG = 1, REJ_PROTECTED, REJ_LOCKED, REJ_NO_BOOST, REJ_BAD_FRAME };
enum { FAULT_ADC_DEAD = 1, FAULT_NO_CARRIER = 2 };

#define T5_CFG_EM4100 0x00148040U
#define POWERUP_SAMPLES 160U   /* a tag needs ~2 ms of field before it modulates */
#define SETTLE_SAMPLES  800U   /* and ~10 ms after being programmed */

typedef struct {
    uint32_t seq, type, obj, val;
    uint8_t  id[5], flag;
    uint16_t aux;
} rb_event_t;

typedef struct {
    int      used, kind, near;
    uint8_t  id[5];            /* card ID / reader's expected ID */
    uint32_t rf;               /* card: periods per bit (16/32/64) */
    uint32_t blk[8];           /* T5577 */
    uint8_t  lock;             /* T5577 per-block lock bits */
    int      wprot;            /* T5577: refuses every program */
    int      need_boost;       /* T5577: programs only under a boosted field (default 1) */
    uint8_t  last_id[5];       /* tag: last derived EM4100 ID reported */
    int      last_valid;
    uint32_t settle;           /* samples of silence left after a program */
    uint32_t read_samples;     /* delivered samples of this object in this field session */
    uint32_t leave_blocks, leave_samples, prog_count;   /* scripted removal: after n programmed blocks / n modulated samples (0 = never) */
    int      read_reported;
    /* reader */
    uint32_t field_hz;
    int      field_on;
    uint32_t delay_ms;
    int      seen_visible, seen_valid, seen_match;
    uint32_t seen_count;
    uint8_t  seen_id[5];
    uint64_t cond_since_ms;
    int      cond_counted;
} rb_obj_t;

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
DB_PAGE_REGISTER(rfid, "rfid", g_mu, DB_LOCK_MUTEX)
static rb_obj_t g_obj[RB_MAX_OBJ];
static rb_event_t g_ev[RB_EV_CAP];
static uint32_t g_ev_seq, g_ev_tail;   /* g_ev_seq = events ever pushed; g_ev_tail = next to pop */
static uint32_t g_fault;

/* device state */
static struct {
    int carrier, boost, pull, adc_run;
    uint32_t carrier_hz, field_samples;   /* samples delivered since the carrier came up */
    uint64_t sample_clock;
    uint32_t lcg;
    /* emulation */
    int emu_on, emu_ext, emu_decoded;
    uint32_t emu_in_hz, emu_out_hz, emu_rep, emu_ppb, emu_nbits;
    uint8_t emu_id[5];
    uint8_t emu_bits[1024];   /* the PARLIO buffer, LSB first: at most 8192 bits (KRFID_MOD_EM4100_LEVELS * 2) */
    /* downlink decoder */
    int in_gap, collecting, have_prev;
    uint64_t gap_start, last_end;
    int nbits;
    uint8_t bits[48];
    uint32_t gaps_seen, programs, rejects;
    uint64_t vt;
} d;

/* ---------------------------------------------------------------- EM4100 (the bench's own) */

uint64_t rb_em4100_frame(const uint8_t id[5])
{
    uint64_t f = 0;
    int pos = 63, col[4] = {0, 0, 0, 0};
    for (int i = 0; i < 9; i++) f |= (uint64_t)1 << pos--;
    for (int r = 0; r < 10; r++) {
        int nib = (r & 1) ? (id[r / 2] & 15) : (id[r / 2] >> 4), p = 0;
        for (int b = 0; b < 4; b++) {
            int v = (nib >> (3 - b)) & 1;
            f |= (uint64_t)v << pos--;
            p ^= v; col[b] ^= v;
        }
        f |= (uint64_t)p << pos--;
    }
    for (int b = 0; b < 4; b++) f |= (uint64_t)col[b] << pos--;
    return f;   /* the stop bit (bit 0) stays 0 */
}

static bool parse_at(const uint8_t *bit, uint32_t n, uint32_t s, int inv, uint8_t id[5])
{
    #define B(k) ((bit[((s) + (k)) % n]) ^ (inv))
    for (int k = 0; k < 9; k++) if (!B(k)) return false;
    uint8_t nib[10];
    int p = 9;
    for (int r = 0; r < 10; r++, p += 5) {
        int x = B(p) << 3 | B(p + 1) << 2 | B(p + 2) << 1 | B(p + 3);
        int par = B(p) ^ B(p + 1) ^ B(p + 2) ^ B(p + 3);
        if (par != B(p + 4)) return false;
        nib[r] = (uint8_t)x;
    }
    for (int c = 0; c < 4; c++) {
        int par = 0;
        for (int r = 0; r < 10; r++) par ^= (nib[r] >> (3 - c)) & 1;
        if (par != B(p + c)) return false;
    }
    if (B(p + 4)) return false;
    #undef B
    for (int i = 0; i < 5; i++) id[i] = (uint8_t)(nib[2 * i] << 4 | nib[2 * i + 1]);
    return true;
}

bool rb_em4100_parse_stream(const uint8_t *bits, uint32_t n, uint8_t id[5])
{
    if (n < 64) return false;
    for (int inv = 0; inv < 2; inv++)
        for (uint32_t s = 0; s < n; s++)
            if (parse_at(bits, n, s, inv, id)) return true;
    return false;
}

/* ---------------------------------------------------------------- helpers (mutex held) */

static uint64_t now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)(ts.tv_nsec / 1000000);
}

static void ev(uint32_t type, uint32_t obj, uint32_t val, const uint8_t *id, uint32_t flag, uint32_t aux)
{
    rb_event_t *e = &g_ev[g_ev_seq % RB_EV_CAP];
    memset(e, 0, sizeof *e);
    e->seq = g_ev_seq + 1; e->type = type; e->obj = obj; e->val = val; e->flag = (uint8_t)flag; e->aux = (uint16_t)aux;
    if (id) memcpy(e->id, id, 5);
    g_ev_seq++;
    if (g_ev_seq - g_ev_tail > RB_EV_CAP) g_ev_tail = g_ev_seq - RB_EV_CAP;   /* oldest dropped */
}

static const uint32_t T5_RF[8] = {8, 16, 32, 40, 50, 64, 100, 128};

/* The bit stream an object modulates, MSB first; returns the count (0: nothing recognisable) and periods per bit. */
static uint32_t obj_stream(const rb_obj_t *o, uint8_t *bits, uint32_t cap, uint32_t *rf)
{
    if (o->kind == RB_CARD) {
        uint64_t f = rb_em4100_frame(o->id);
        for (int i = 0; i < 64; i++) bits[i] = (uint8_t)((f >> (63 - i)) & 1);
        *rf = o->rf;
        return 64;
    }
    if (o->kind == RB_T5577) {
        uint32_t cfg = o->blk[0], mod = (cfg >> 12) & 0x1F, mb = (cfg >> 5) & 7, n = 0;
        if (mod != 0x08) return 0;           /* only Manchester is modelled */
        if (mb == 0) return 0;               /* maxblock 0: only the config block, nothing to modulate */
        *rf = T5_RF[(cfg >> 18) & 7];
        for (uint32_t b = 1; b <= mb && n + 32 <= cap; b++)
            for (int i = 0; i < 32; i++) bits[n++] = (uint8_t)((o->blk[b] >> (31 - i)) & 1);
        return n;
    }
    return 0;
}

/* Does the tag currently read back as an EM4100 ID? */
static bool tag_id(const rb_obj_t *o, uint8_t id[5])
{
    uint8_t bits[256];
    uint32_t rf, n = obj_stream(o, bits, sizeof bits, &rf);
    if (!n || (rf != 16 && rf != 32 && rf != 64)) return false;
    return rb_em4100_parse_stream(bits, n, id);
}

static void tag_report(int h, int from_write)
{
    rb_obj_t *o = &g_obj[h];
    uint8_t id[5] = {0};
    int v = tag_id(o, id);
    if (v != o->last_valid || (v && memcmp(id, o->last_id, 5))) {
        o->last_valid = v;
        memcpy(o->last_id, id, 5);
        ev(EV_TAG_ID, (uint32_t)h, 0, id, (uint32_t)v, (uint32_t)from_write);
    }
}

static int first_near_t5577(void)
{
    for (int i = 0; i < RB_MAX_OBJ; i++) if (g_obj[i].used && g_obj[i].kind == RB_T5577 && g_obj[i].near) return i;
    return -1;
}

/* ---------------------------------------------------------------- the T5577 downlink decoder */

static void program(uint32_t addr, uint32_t data, int lock)
{
    int h = first_near_t5577();
    d.programs++;
    if (h < 0 || !d.carrier) { d.rejects++; ev(EV_WRITE_REJECT, 0, data, NULL, 0, REJ_NO_TAG); return; }
    rb_obj_t *o = &g_obj[h];
    if (o->wprot)                          { d.rejects++; ev(EV_WRITE_REJECT, (uint32_t)h, data, NULL, 0, REJ_PROTECTED); return; }
    if (o->need_boost && !d.boost)         { d.rejects++; ev(EV_WRITE_REJECT, (uint32_t)h, data, NULL, 0, REJ_NO_BOOST); return; }
    if ((o->lock >> addr) & 1)             { d.rejects++; ev(EV_WRITE_REJECT, (uint32_t)h, data, NULL, 0, REJ_LOCKED); return; }
    o->blk[addr] = data;
    if (lock) o->lock |= (uint8_t)(1u << addr);
    o->settle = SETTLE_SAMPLES; o->read_samples = 0; o->read_reported = 0;
    ev(EV_BLOCK, (uint32_t)h, data, NULL, (uint32_t)lock, addr);
    tag_report(h, 1);
    if (o->leave_blocks && ++o->prog_count >= o->leave_blocks) { o->near = 0; o->leave_blocks = 0; ev(EV_LEFT, (uint32_t)h, 0, NULL, 0, 1); }
}

static void finalize_burst(void)
{
    if (!d.collecting) return;
    d.collecting = 0;
    if (d.nbits == 38 && d.bits[0] == 1 && d.bits[1] == 0) {          /* opcode 10: page 0 program */
        uint32_t data = 0, addr;
        for (int i = 0; i < 32; i++) data = data << 1 | d.bits[3 + i];
        addr = (uint32_t)(d.bits[35] << 2 | d.bits[36] << 1 | d.bits[37]);
        program(addr, data, d.bits[2]);
    } else if (d.nbits != 2) {
        d.rejects++;
        ev(EV_WRITE_REJECT, 0, (uint32_t)d.nbits, NULL, 0, REJ_BAD_FRAME);
    }
    d.nbits = 0;
}

void rb_dev_gap(bool paused, uint64_t vt)
{
    pthread_mutex_lock(&g_mu);
    d.vt = vt;
    if (paused) {
        d.in_gap = 1; d.gap_start = vt;
    } else if (d.in_gap) {
        uint64_t gap = vt - d.gap_start, on = d.have_prev ? d.gap_start - d.last_end : 1000000;
        d.in_gap = 0; d.last_end = vt; d.have_prev = 1; d.gaps_seen++;
        if (gap >= 200) {                      /* start gap (240 us) vs write gap (144 us) */
            finalize_burst();
            d.collecting = 1; d.nbits = 0;
        } else if (d.collecting) {
            if (on > 1500) d.collecting = 0;    /* the carrier stayed up too long: not one burst */
            else if (d.nbits < (int)sizeof d.bits) d.bits[d.nbits++] = on >= 320;   /* 192 us -> 0, 448 us -> 1 */
        }
    }
    pthread_mutex_unlock(&g_mu);
}

/* ---------------------------------------------------------------- device-side hooks */

void rb_dev_carrier(bool on, uint32_t hz)
{
    pthread_mutex_lock(&g_mu);
    if ((int)on != d.carrier) {
        if (!on) finalize_burst();
        d.carrier = on; d.carrier_hz = hz; d.field_samples = 0;
        d.have_prev = 0; d.in_gap = 0; d.collecting = 0;
        for (int i = 0; i < RB_MAX_OBJ; i++) { g_obj[i].read_samples = 0; g_obj[i].read_reported = 0; }
        ev(EV_CARRIER, 0, hz, NULL, (uint32_t)on, 0);
    }
    pthread_mutex_unlock(&g_mu);
}

void rb_dev_boost(bool on)
{
    pthread_mutex_lock(&g_mu);
    if ((int)on != d.boost) { d.boost = on; ev(EV_BOOST, 0, 0, NULL, (uint32_t)on, 0); }
    pthread_mutex_unlock(&g_mu);
}

void rb_dev_pull(int level) { pthread_mutex_lock(&g_mu); d.pull = level; pthread_mutex_unlock(&g_mu); }
void rb_dev_adc_start(void) { pthread_mutex_lock(&g_mu); d.adc_run = 1; pthread_mutex_unlock(&g_mu); }
uint32_t rb_fault(void) { pthread_mutex_lock(&g_mu); uint32_t f = g_fault; pthread_mutex_unlock(&g_mu); return f; }

static uint32_t rnd(void) { d.lcg = d.lcg * 1664525u + 1013904223u; return d.lcg >> 16; }

static struct { int h; uint8_t bits[256]; uint32_t nb, rf; } g_src[RB_MAX_OBJ];   /* static: the worker's stack is 8 KB */

void rb_dev_adc_samples(uint16_t *out, uint32_t n)
{
    pthread_mutex_lock(&g_mu);
    /* what is near and what it modulates */
    int ns = 0, reader_field = 0;
    for (int i = 0; i < RB_MAX_OBJ; i++) {
        rb_obj_t *o = &g_obj[i];
        if (!o->used || !o->near) continue;
        if (o->kind == RB_READER && o->field_on) reader_field = 1;
        if (o->kind == RB_CARD || o->kind == RB_T5577) {
            g_src[ns].h = i;
            g_src[ns].nb = obj_stream(o, g_src[ns].bits, sizeof g_src[ns].bits, &g_src[ns].rf);
            ns++;
        }
    }
    for (uint32_t k = 0; k < n; k++) {
        int level = 60 + (int)(rnd() % 9);
        if (d.carrier) {
            int loaded = 0;
            level = 2600;
            for (int s = 0; s < ns; s++) {
                rb_obj_t *o = &g_obj[g_src[s].h];
                if (o->settle) { o->settle--; continue; }                       /* just programmed: not answering yet */
                if (d.field_samples < POWERUP_SAMPLES || !g_src[s].nb) continue;  /* not powered yet / nothing it can send */
                uint64_t c = ((uint64_t)(d.field_samples - POWERUP_SAMPLES) * 25u) / 16u;   /* carrier cycle of this sample */
                uint32_t rf = g_src[s].rf, bit = (uint32_t)((c / rf) % g_src[s].nb), within = (uint32_t)(c % rf);
                int b = g_src[s].bits[bit];
                loaded |= b ? (within < rf / 2) : (within >= rf / 2);
                o->read_samples++;
                if (o->leave_samples && o->read_samples >= o->leave_samples) { o->near = 0; o->leave_samples = 0; ev(EV_LEFT, (uint32_t)g_src[s].h, 0, NULL, 0, 2); }
                if (!o->read_reported && o->read_samples > (g_src[s].nb + 8) * (rf * 16u / 25u + 1u)) {
                    uint8_t id[5];
                    o->read_reported = 1;
                    if (tag_id(o, id)) ev(EV_DEVICE_READ, (uint32_t)g_src[s].h, 0, id, 1, (uint32_t)rf);
                }
            }
            if (loaded) level -= 600;
            level += (int)(rnd() % 21) - 10;
            d.field_samples++;
        } else if (reader_field) {
            level = 1500 + (int)(rnd() % 31) - 15;   /* someone else's carrier on the detector: steady, little ripple */
        }
        out[k] = (uint16_t)(level < 0 ? 0 : level > 4095 ? 4095 : level);
        d.sample_clock++;
    }
    pthread_mutex_unlock(&g_mu);
}

/* ---- emulation ---- */

static void emu_decode(void)
{
    /* bits[] holds one level per output-clock tick; periods are rep ticks wide. Find the loop period. */
    uint32_t rep = d.emu_rep ? d.emu_rep : 1, L = d.emu_nbits / rep, p = 0;
    static uint8_t lv[8192];
    d.emu_decoded = 0; d.emu_ppb = 0;
    if (L == 0 || L > sizeof lv) return;
    for (uint32_t i = 0; i < L; i++) lv[i] = d.emu_bits[(i * rep) / 8] >> ((i * rep) % 8) & 1;
    for (uint32_t q = 1; q <= L; q++) {
        if (L % q) continue;
        int ok = 1;
        for (uint32_t i = 0; i < L && ok; i++) if (lv[i] != lv[(i + q) % L]) ok = 0;
        if (ok) { p = q; break; }
    }
    if (!p || p % 64) return;
    uint32_t ppb = p / 64;
    if (ppb < 2 || (ppb & 1)) return;
    static uint8_t bits[64];
    for (int j = 0; j < 64; j++) {
        int a = lv[(uint32_t)j * ppb], b = lv[(uint32_t)j * ppb + ppb / 2];
        if (a == b) return;                   /* a Manchester violation */
        bits[j] = (uint8_t)a;                 /* loaded first half = 1 */
    }
    if (rb_em4100_parse_stream(bits, 64, d.emu_id)) { d.emu_decoded = 1; d.emu_ppb = ppb; }
}

void rb_dev_emu(bool on, const uint8_t *bits, uint32_t nbits, bool ext, uint32_t in_hz, uint32_t out_hz)
{
    pthread_mutex_lock(&g_mu);
    if (on) {
        d.emu_on = 1; d.emu_ext = ext; d.emu_in_hz = ext ? in_hz : RB_CARRIER_HZ; d.emu_out_hz = out_hz;
        d.emu_rep = ext ? out_hz / (in_hz ? in_hz : 1) : out_hz / RB_CARRIER_HZ;
        d.emu_nbits = nbits > sizeof d.emu_bits * 8 ? (uint32_t)sizeof d.emu_bits * 8 : nbits;
        memset(d.emu_bits, 0, sizeof d.emu_bits);
        memcpy(d.emu_bits, bits, (d.emu_nbits + 7) / 8);
        emu_decode();
        ev(EV_EMU, 0, d.emu_in_hz, d.emu_id, 1u | (d.emu_decoded ? 2u : 0u), (uint32_t)(ext ? 1 : 0));
    } else if (d.emu_on) {
        d.emu_on = 0; d.emu_decoded = 0;
        ev(EV_EMU, 0, 0, d.emu_id, 0, 0);
    }
    pthread_mutex_unlock(&g_mu);
}

uint32_t rb_dev_field_hz(void)
{
    uint32_t hz = 0;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < RB_MAX_OBJ; i++)
        if (g_obj[i].used && g_obj[i].kind == RB_READER && g_obj[i].near && g_obj[i].field_on) hz = g_obj[i].field_hz;
    ev(EV_FIELD, 0, hz, NULL, hz ? 1 : 0, 0);
    pthread_mutex_unlock(&g_mu);
    return hz;
}

/* ---------------------------------------------------------------- readers (mutex held) */

static int reader_timing_ok(const rb_obj_t *r)
{
    /* periods per bit as this reader's clock counts them, against RF/16, RF/32, RF/64 within 10 % */
    uint32_t base = d.emu_ext ? d.emu_in_hz : RB_CARRIER_HZ;
    if (!base || !r->field_hz) return 0;
    double per = (double)d.emu_ppb * (double)r->field_hz / (double)base;
    static const double want[3] = {16, 32, 64};
    for (int i = 0; i < 3; i++) if (per >= want[i] * 0.9 && per <= want[i] * 1.1) return 1;
    return 0;
}

static void readers_eval(void)
{
    uint64_t t = now_ms();
    for (int i = 0; i < RB_MAX_OBJ; i++) {
        rb_obj_t *r = &g_obj[i];
        if (!r->used || r->kind != RB_READER) continue;
        int cond = r->near && r->field_on && d.emu_on && d.emu_decoded && reader_timing_ok(r);
        if (cond) {
            if (!r->cond_since_ms) r->cond_since_ms = t ? t : 1;
            if (r->seen_visible && memcmp(r->seen_id, d.emu_id, 5)) r->seen_visible = 0;   /* the tag changed under it: a new read */
            if (!r->seen_visible && t - r->cond_since_ms >= r->delay_ms) {
                r->seen_visible = 1; r->seen_valid = 1;
                memcpy(r->seen_id, d.emu_id, 5);
                r->seen_match = !memcmp(r->seen_id, r->id, 5);
                r->seen_count++;
                ev(EV_READER_SAW, (uint32_t)i, r->seen_count, r->seen_id, (uint32_t)r->seen_match, 1);
            }
        } else {
            r->cond_since_ms = 0;
            if (r->seen_visible) { r->seen_visible = 0; ev(EV_READER_SAW, (uint32_t)i, r->seen_count, r->seen_id, (uint32_t)r->seen_match, 0); }
        }
    }
}

/* ================================================================ exports (the page's thread) */

#define X EMSCRIPTEN_KEEPALIVE
static int hv(int h) { return h >= 0 && h < RB_MAX_OBJ && g_obj[h].used; }

X void rfid_world_reset(void)
{
    DB_PAGE_LOCK_V(&g_mu);
    memset(g_obj, 0, sizeof g_obj);
    g_ev_tail = g_ev_seq;
    g_fault = 0;
    pthread_mutex_unlock(&g_mu);
}

X int rfid_obj_create(int kind)
{
    int h = -1;
    if (kind < RB_CARD || kind > RB_READER) return -1;
    DB_PAGE_LOCK(&g_mu, 0);
    for (int i = 0; i < RB_MAX_OBJ && h < 0; i++) if (!g_obj[i].used) h = i;
    if (h >= 0) {
        rb_obj_t *o = &g_obj[h];
        memset(o, 0, sizeof *o);
        o->used = 1; o->kind = kind;
        static const uint8_t def[5] = {1, 2, 3, 4, 5};
        memcpy(o->id, def, 5); o->rf = 64; o->need_boost = 1;
        o->blk[0] = 0x000880E0u;       /* a factory-blank T5577: Manchester RF/32, maxblock 7, all data zero */
        o->field_hz = RB_CARRIER_HZ; o->field_on = 1; o->delay_ms = 50;
    }
    pthread_mutex_unlock(&g_mu);
    return h;
}

X void rfid_obj_remove(int h)
{
    DB_PAGE_LOCK_V(&g_mu);
    if (hv(h)) { memset(&g_obj[h], 0, sizeof g_obj[h]); readers_eval(); }
    pthread_mutex_unlock(&g_mu);
}

X int rfid_obj_near(int h, int near)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h)) {
        rb_obj_t *o = &g_obj[h];
        if ((o->near != 0) != (near != 0)) {
            o->near = near != 0; o->read_samples = 0; o->read_reported = 0; o->settle = 0;
            if (o->kind == RB_T5577 && o->near) { o->last_valid = 0; tag_report(h, 0); }
        }
        ok = 1;
        readers_eval();
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

/* Scripted removal, for deterministic "taken away mid-operation" scenarios: the object leaves the antenna after it has
 * had `blocks` T5577 blocks programmed / has modulated `samples` demod samples (0 clears). */
X int rfid_obj_leave_after(int h, uint32_t blocks, uint32_t samples)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h)) { g_obj[h].leave_blocks = blocks; g_obj[h].leave_samples = samples; g_obj[h].prog_count = 0; ok = 1; }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

X int rfid_obj_is_near(int h) { DB_PAGE_LOCK(&g_mu, 0); int r = hv(h) && g_obj[h].near; pthread_mutex_unlock(&g_mu); return r; }

/* card (and reader expected ID): id points at 5 bytes */
X int rfid_card_set(int h, const uint8_t *id, int rf)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h) && g_obj[h].kind == RB_CARD && (rf == 16 || rf == 32 || rf == 64)) {
        memcpy(g_obj[h].id, id, 5); g_obj[h].rf = (uint32_t)rf;
        g_obj[h].read_samples = 0; g_obj[h].read_reported = 0;
        ok = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

/* t: 9 x u32 = blocks[0..7], then flags (bit0 write-protected, bit1 needs-boost) | locks << 8 */
X int rfid_t5577_set(int h, const uint32_t *t)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h) && g_obj[h].kind == RB_T5577) {
        rb_obj_t *o = &g_obj[h];
        memcpy(o->blk, t, 32);
        o->wprot = t[8] & 1; o->need_boost = (t[8] >> 1) & 1; o->lock = (uint8_t)(t[8] >> 8);
        o->read_samples = 0; o->read_reported = 0;
        if (o->near) tag_report(h, 0);
        ok = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

X int rfid_t5577_get(int h, uint32_t *t)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h) && g_obj[h].kind == RB_T5577) {
        rb_obj_t *o = &g_obj[h];
        memcpy(t, o->blk, 32);
        t[8] = (uint32_t)(o->wprot ? 1 : 0) | (uint32_t)(o->need_boost ? 2 : 0) | (uint32_t)o->lock << 8;
        ok = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

/* 1 and the 5 bytes when the tag (or card) currently reads back as an EM4100 ID */
X int rfid_obj_id(int h, uint8_t *id)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h)) {
        rb_obj_t *o = &g_obj[h];
        if (o->kind == RB_CARD) { memcpy(id, o->id, 5); ok = 1; }
        else if (o->kind == RB_T5577) ok = tag_id(o, id);
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

X int rfid_reader_set(int h, const uint8_t *expect, uint32_t field_hz, int field_on, uint32_t delay_ms)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h) && g_obj[h].kind == RB_READER) {
        rb_obj_t *o = &g_obj[h];
        memcpy(o->id, expect, 5); o->field_hz = field_hz; o->field_on = field_on != 0; o->delay_ms = delay_ms;
        if (o->seen_visible) o->seen_match = !memcmp(o->seen_id, o->id, 5);
        o->cond_since_ms = 0;
        readers_eval();
        ok = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

/* out: u32[4] = visible, read count, match, valid; id: the last ID it saw (5 bytes) */
X int rfid_reader_get(int h, uint32_t *out, uint8_t *id)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (hv(h) && g_obj[h].kind == RB_READER) {
        rb_obj_t *o = &g_obj[h];
        readers_eval();
        out[0] = (uint32_t)o->seen_visible; out[1] = o->seen_count; out[2] = (uint32_t)o->seen_match; out[3] = (uint32_t)o->seen_valid;
        memcpy(id, o->seen_id, 5);
        ok = 1;
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

X void rfid_fault_set(uint32_t mask) { DB_PAGE_LOCK_V(&g_mu); g_fault = mask; pthread_mutex_unlock(&g_mu); }

/* out: u32[12] = flags(1 carrier,2 boost,4 adc,8 emulating,16 pull high,32 emu decodes), carrier hz, emu in hz, emu out hz,
 * emu periods/bit, gaps seen, programs, rejects, sample clock lo, vt lo, emu_ext, rep; id: the ID the emulated frame carries */
X void rfid_state(uint32_t *out, uint8_t *id)
{
    DB_PAGE_LOCK_V(&g_mu);
    readers_eval();
    out[0] = (uint32_t)(d.carrier ? 1 : 0) | (d.boost ? 2u : 0) | (d.adc_run ? 4u : 0) | (d.emu_on ? 8u : 0) | (d.pull ? 16u : 0) | (d.emu_decoded ? 32u : 0);
    out[1] = d.carrier_hz; out[2] = d.emu_in_hz; out[3] = d.emu_out_hz; out[4] = d.emu_ppb;
    out[5] = d.gaps_seen; out[6] = d.programs; out[7] = d.rejects; out[8] = (uint32_t)d.sample_clock; out[9] = (uint32_t)d.vt;
    out[10] = (uint32_t)d.emu_ext; out[11] = d.emu_rep;
    memcpy(id, d.emu_id, 5);
    pthread_mutex_unlock(&g_mu);
}

/* Evaluate the readers (their clocks run on the wall) and report how many events wait. */
X int rfid_poll(void)
{
    DB_PAGE_LOCK(&g_mu, 0);
    readers_eval();
    int n = (int)(g_ev_seq - g_ev_tail);
    pthread_mutex_unlock(&g_mu);
    return n;
}

/* Pop the oldest event into 24 bytes: u32 seq, type, obj, val; id[5], flag, u16 aux. 1 if one was there. */
X int rfid_ev_pop(rb_event_t *out)
{
    int ok = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (g_ev_tail < g_ev_seq) { *out = g_ev[g_ev_tail % RB_EV_CAP]; g_ev_tail++; ok = 1; }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

/* The bench's independent encoder, for the unit tests: 64-bit frame as hi/lo into out[2]. */
X void rfid_frame(const uint8_t *id, uint32_t *out)
{
    uint64_t f = rb_em4100_frame(id);
    out[0] = (uint32_t)(f >> 32); out[1] = (uint32_t)f;
}
