/* SPDX-License-Identifier: GPL-3.0-or-later
 * The card side of a Mifare Classic: the half of the Crypto1 conversation the SDK's knfc_mfc.c (the reader
 * side, which runs unchanged above the seam) talks to. The cipher is the SDK's own knfc_crypto1.c, which is
 * symmetric; what is written here is the card's framing and state machine over kdrv_st25r3916_transceive_bits.
 *
 * Frames are bit-counted, least significant bit first within a byte, nine bits per byte (eight data bits and
 * the odd-parity bit; once encrypted, the parity bit is encrypted with the keystream bit that belongs to the
 * NEXT byte). A card that does not like a frame stays silent; the fake turns silence into KODE_TIMEOUT.
 *
 * Simplifications (documented in docs/STATUS-nfc.md): both keys open every data block of the sector (the
 * "transport configuration" access bits; the trailer's access bits are stored but not enforced), block 0 and
 * trailers refuse writes, a sector trailer reads back with key A zeroed as on a real card. */
#include <string.h>
#include "knfc_mfc.h"
#include "nfc_bench.h"

#define CMD_AUTH_A 0x60u
#define CMD_AUTH_B 0x61u
#define CMD_READ   0x30u
#define CMD_WRITE  0xA0u
#define ACK 0x0Au
#define NAK 0x05u

static uint8_t bit_get(const uint8_t *b, uint16_t pos) { return (uint8_t)((b[pos / 8u] >> (pos % 8u)) & 1u); }
static void bit_put(uint8_t *b, uint16_t pos, uint8_t v)
{
    uint8_t m = (uint8_t)(1u << (pos % 8u));
    if (v) b[pos / 8u] = (uint8_t)(b[pos / 8u] | m); else b[pos / 8u] = (uint8_t)(b[pos / 8u] & (uint8_t)~m);
}

static void crc_a(const uint8_t *d, uint16_t n, uint8_t *out)
{
    uint16_t crc = 0x6363u;
    for (uint16_t i = 0; i < n; i++) {
        uint8_t b = (uint8_t)(d[i] ^ (uint8_t)crc);
        b = (uint8_t)(b ^ (uint8_t)(b << 4));
        crc = (uint16_t)((crc >> 8) ^ ((uint16_t)b << 8) ^ ((uint16_t)b << 3) ^ ((uint16_t)b >> 4));
    }
    out[0] = (uint8_t)crc; out[1] = (uint8_t)(crc >> 8);
}

void nfc_mfc_sess_reset(nfc_mfc_sess_t *s)
{
    uint32_t ctr = s->nonce_ctr;
    memset(s, 0, sizeof *s);
    s->nonce_ctr = ctr;
}

/* n bytes, nine bits each, in the clear. Returns 0 when the parity of every byte is odd. */
static int get_plain(const uint8_t *in, uint8_t *out, int n)
{
    uint16_t pos = 0;
    for (int i = 0; i < n; i++) {
        uint8_t v = 0;
        for (uint8_t b = 0; b < 8; b++) v = (uint8_t)(v | (uint8_t)(bit_get(in, pos++) << b));
        if (bit_get(in, pos++) != knfc_crypto1_odd_parity(v)) return -1;
        out[i] = v;
    }
    return 0;
}

/* n bytes decrypted with the keystream (the cipher clocked with zero). nr_mode: the first four bytes of the
 * authentication, which the card feeds back as plaintext (the reader's nonce goes into the register). */
static int get_enc(knfc_crypto1_t *c, const uint8_t *in, uint8_t *out, int n, int feed_first)
{
    uint16_t pos = 0;
    for (int i = 0; i < n; i++) {
        uint8_t ct = 0;
        for (uint8_t b = 0; b < 8; b++) ct = (uint8_t)(ct | (uint8_t)(bit_get(in, pos++) << b));
        uint8_t ks = (i < feed_first) ? knfc_crypto1_byte(c, ct, true) : knfc_crypto1_byte(c, 0u, false);
        uint8_t pt = (uint8_t)(ks ^ ct);
        uint8_t pb = (uint8_t)(bit_get(in, pos++) ^ knfc_crypto1_peek(c));
        if (pb != knfc_crypto1_odd_parity(pt)) return -1;
        out[i] = pt;
    }
    return 0;
}

static uint16_t put_plain(uint8_t *out, const uint8_t *d, int n)
{
    uint16_t pos = 0;
    for (int i = 0; i < n; i++) {
        for (uint8_t b = 0; b < 8; b++) bit_put(out, pos++, (uint8_t)((d[i] >> b) & 1u));
        bit_put(out, pos++, knfc_crypto1_odd_parity(d[i]));
    }
    return pos;
}

static uint16_t put_enc(knfc_crypto1_t *c, uint8_t *out, const uint8_t *d, int n)
{
    uint16_t pos = 0;
    for (int i = 0; i < n; i++) {
        uint8_t ks = knfc_crypto1_byte(c, 0u, false);
        uint8_t e = (uint8_t)(ks ^ d[i]);
        for (uint8_t b = 0; b < 8; b++) bit_put(out, pos++, (uint8_t)((e >> b) & 1u));
        bit_put(out, pos++, (uint8_t)(knfc_crypto1_peek(c) ^ knfc_crypto1_odd_parity(d[i])));
    }
    return pos;
}

static uint16_t put_nibble(knfc_crypto1_t *c, uint8_t *out, uint8_t v)
{
    for (uint8_t b = 0; b < 4; b++) bit_put(out, b, (uint8_t)(((v >> b) & 1u) ^ knfc_crypto1_bit(c, 0u, false)));
    return 4;
}

static uint32_t cuid32(const nfc_obj_t *o)
{
    const uint8_t *u = o->uid_len > 4u ? &o->uid[o->uid_len - 4u] : o->uid;
    return ((uint32_t)u[0] << 24) | ((uint32_t)u[1] << 16) | ((uint32_t)u[2] << 8) | u[3];
}

static uint16_t first_block(uint32_t sector) { return knfc_mfc_sector_first((uint8_t)sector); }

static int sector_of(uint32_t blk)
{
    return blk < 128u ? (int)(blk / 4u) : 32 + (int)((blk - 128u) / 16u);
}

int nfc_mfc_card_frame(nfc_obj_t *o, nfc_mfc_sess_t *s, const uint8_t *tx, uint16_t tx_bits, uint8_t *rx, uint16_t rx_cap,
                       uint16_t *rx_bits)
{
    uint32_t nblk = o->mem_len / 16u;
    if (rx_cap < 24u) return 1;
    memset(rx, 0, rx_cap);

    switch (s->state) {
    case 0: {   /* selected: the only thing a card does here is start an authentication, in the clear */
        uint8_t f[4], crc[2];
        if (tx_bits < 36u || get_plain(tx, f, 4)) return 1;
        crc_a(f, 2, crc);
        if (crc[0] != f[2] || crc[1] != f[3]) return 1;
        if ((f[0] != CMD_AUTH_A && f[0] != CMD_AUTH_B) || f[1] >= nblk) { s->state = 4; return 1; }
        int sec = sector_of(f[1]);
        uint32_t tb = (uint32_t)first_block((uint32_t)sec) + knfc_mfc_sector_blocks((uint8_t)sec) - 1u;
        if (tb >= nblk) { s->state = 4; return 1; }
        const uint8_t *key = &o->mem[tb * 16u + (f[0] == CMD_AUTH_B ? 10u : 0u)];
        uint64_t k48 = 0;
        for (int i = 0; i < 6; i++) k48 = (k48 << 8) | key[i];
        s->nonce_ctr++;
        s->nt = knfc_crypto1_prng_successor(0x5A17C0DEu ^ (s->nonce_ctr * 0x9E3779B1u), 32u);
        knfc_crypto1_init(&s->c, k48);
        (void)knfc_crypto1_word(&s->c, cuid32(o) ^ s->nt, false);
        s->sector_first = (uint8_t)first_block((uint32_t)sec);
        s->sector_blocks = knfc_mfc_sector_blocks((uint8_t)sec);
        uint8_t nt[4] = { (uint8_t)(s->nt >> 24), (uint8_t)(s->nt >> 16), (uint8_t)(s->nt >> 8), (uint8_t)s->nt };
        *rx_bits = put_plain(rx, nt, 4);
        s->state = 1;
        return 0;
    }
    case 1: {   /* {nr}{ar}: the reader proves it knows the key; a wrong key gets silence */
        uint8_t f[8];
        if (tx_bits < 72u || get_enc(&s->c, tx, f, 8, 4)) { s->state = 4; return 1; }
        uint32_t ar = ((uint32_t)f[4] << 24) | ((uint32_t)f[5] << 16) | ((uint32_t)f[6] << 8) | f[7];
        if (ar != knfc_crypto1_prng_successor(s->nt, 64u)) { s->state = 4; return 1; }
        uint32_t at = knfc_crypto1_prng_successor(s->nt, 96u);
        uint8_t a[4] = { (uint8_t)(at >> 24), (uint8_t)(at >> 16), (uint8_t)(at >> 8), (uint8_t)at };
        *rx_bits = put_enc(&s->c, rx, a, 4);
        s->state = 2;
        return 0;
    }
    case 2: {   /* authenticated: READ and WRITE */
        uint8_t f[4], crc[2];
        if (tx_bits < 36u || get_enc(&s->c, tx, f, 4, 0)) { s->state = 4; return 1; }
        crc_a(f, 2, crc);
        if (crc[0] != f[2] || crc[1] != f[3]) { s->state = 4; return 1; }
        uint32_t blk = f[1];
        bool in_sector = blk >= s->sector_first && blk < (uint32_t)s->sector_first + s->sector_blocks && blk < nblk;
        if (f[0] == CMD_READ) {
            if (!in_sector) { *rx_bits = put_nibble(&s->c, rx, NAK); s->state = 4; return 0; }
            uint8_t d[18];
            memcpy(d, &o->mem[blk * 16u], 16);
            if (knfc_mfc_is_trailer((uint8_t)blk)) memset(d, 0, 6);          /* key A never reads back */
            crc_a(d, 16, &d[16]);
            *rx_bits = put_enc(&s->c, rx, d, 18);
            o->reads++;
            return 0;
        }
        if (f[0] == CMD_WRITE) {
            if (!in_sector || blk == 0u || knfc_mfc_is_trailer((uint8_t)blk) || (o->flags & NFC_F_LOCKED)) {
                *rx_bits = put_nibble(&s->c, rx, NAK); s->state = 4; return 0;
            }
            s->write_block = (uint8_t)blk;
            *rx_bits = put_nibble(&s->c, rx, ACK);
            s->state = 3;
            return 0;
        }
        s->state = 4;
        return 1;
    }
    case 3: {   /* the 16 data bytes and their CRC */
        uint8_t d[18], crc[2];
        if (tx_bits < 162u || get_enc(&s->c, tx, d, 18, 0)) { s->state = 4; return 1; }
        crc_a(d, 16, crc);
        if (crc[0] != d[16] || crc[1] != d[17]) { s->state = 4; return 1; }
        memcpy(&o->mem[(uint32_t)s->write_block * 16u], d, 16);
        o->writes++; o->mod_seq++;
        *rx_bits = put_nibble(&s->c, rx, ACK);
        s->state = 2;
        return 0;
    }
    default:    /* dead: silent until the reader re-selects the card */
        return 1;
    }
}
