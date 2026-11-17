/* SPDX-License-Identifier: GPL-3.0-or-later
 * What the REAL kdrv_kfw.c (the container decoder AppMgr feeds every install through) needs from the chip's ROM and IDF:
 * SHA-256 (PSA hash API) and tinfl. SHA-256 is a plain C implementation; tinfl is not modelled (returns FAILED, so a DEFLATE
 * container is refused as corrupt and a bare image or an uncompressed container is installed). */
#include <string.h>
#include "psa/crypto.h"
#include "miniz.h"

static const uint32_t K[64] = {
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
#define ROR(x,n) (((x) >> (n)) | ((x) << (32 - (n))))

static void block(psa_hash_operation_t *o, const uint8_t *p)
{
    uint32_t w[64], a, b, c, d, e, f, g, h;
    for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4*i] << 24 | p[4*i+1] << 16 | p[4*i+2] << 8 | p[4*i+3];
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = ROR(w[i-15], 7) ^ ROR(w[i-15], 18) ^ (w[i-15] >> 3), s1 = ROR(w[i-2], 17) ^ ROR(w[i-2], 19) ^ (w[i-2] >> 10);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }
    a = o->h[0]; b = o->h[1]; c = o->h[2]; d = o->h[3]; e = o->h[4]; f = o->h[5]; g = o->h[6]; h = o->h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t t1 = h + (ROR(e, 6) ^ ROR(e, 11) ^ ROR(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
        uint32_t t2 = (ROR(a, 2) ^ ROR(a, 13) ^ ROR(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    o->h[0] += a; o->h[1] += b; o->h[2] += c; o->h[3] += d; o->h[4] += e; o->h[5] += f; o->h[6] += g; o->h[7] += h;
}

psa_status_t psa_crypto_init(void) { return PSA_SUCCESS; }
psa_status_t psa_hash_setup(psa_hash_operation_t *o, psa_algorithm_t alg)
{
    static const uint32_t iv[8] = { 0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19 };
    if (alg != PSA_ALG_SHA_256) return PSA_ERROR_GENERIC_ERROR;
    memcpy(o->h, iv, sizeof iv); o->len = 0; o->fill = 0; o->open = 1;
    return PSA_SUCCESS;
}
psa_status_t psa_hash_update(psa_hash_operation_t *o, const uint8_t *in, size_t n)
{
    if (!o->open) return PSA_ERROR_GENERIC_ERROR;
    o->len += n;
    while (n) {
        size_t t = 64 - o->fill; if (t > n) t = n;
        memcpy(o->buf + o->fill, in, t); o->fill += (uint32_t)t; in += t; n -= t;
        if (o->fill == 64) { block(o, o->buf); o->fill = 0; }
    }
    return PSA_SUCCESS;
}
psa_status_t psa_hash_finish(psa_hash_operation_t *o, uint8_t *out, size_t out_size, size_t *out_len)
{
    if (!o->open || out_size < 32) return PSA_ERROR_GENERIC_ERROR;
    uint64_t bits = o->len * 8;
    uint8_t pad = 0x80; psa_hash_update(o, &pad, 1);
    pad = 0; while (o->fill != 56) psa_hash_update(o, &pad, 1);
    uint8_t l[8]; for (int i = 0; i < 8; i++) l[i] = (uint8_t)(bits >> (56 - 8 * i));
    psa_hash_update(o, l, 8);
    for (int i = 0; i < 8; i++) { out[4*i] = (uint8_t)(o->h[i] >> 24); out[4*i+1] = (uint8_t)(o->h[i] >> 16); out[4*i+2] = (uint8_t)(o->h[i] >> 8); out[4*i+3] = (uint8_t)o->h[i]; }
    o->open = 0; *out_len = 32;
    return PSA_SUCCESS;
}
psa_status_t psa_hash_abort(psa_hash_operation_t *o) { o->open = 0; return PSA_SUCCESS; }
psa_status_t psa_hash_compute(psa_algorithm_t alg, const uint8_t *in, size_t len, uint8_t *out, size_t out_size, size_t *out_len)
{
    psa_hash_operation_t o;
    if (psa_hash_setup(&o, alg)) return PSA_ERROR_GENERIC_ERROR;
    psa_hash_update(&o, in, len);
    return psa_hash_finish(&o, out, out_size, out_len);
}

tinfl_status tinfl_decompress(tinfl_decompressor *r, const uint8_t *in, size_t *in_len, uint8_t *dict, uint8_t *out, size_t *out_len, mz_uint32 flags)
{
    (void)r; (void)in; (void)dict; (void)out; (void)flags;
    *in_len = 0; *out_len = 0;
    return TINFL_STATUS_FAILED;
}
