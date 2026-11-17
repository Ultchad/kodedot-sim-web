/* SPDX-License-Identifier: GPL-3.0-or-later
 * The PSA hash calls kdrv_kfw.c uses (SHA-256 only), over a small C implementation (kfw_deps_web.c). */
#ifndef DOTBENCH_PSA_CRYPTO_H
#define DOTBENCH_PSA_CRYPTO_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef int32_t psa_status_t;
typedef uint32_t psa_algorithm_t;
#define PSA_SUCCESS ((psa_status_t)0)
#define PSA_ERROR_GENERIC_ERROR ((psa_status_t)-132)
#define PSA_ALG_SHA_256 ((psa_algorithm_t)0x02000009)
typedef struct { uint32_t h[8]; uint64_t len; uint8_t buf[64]; uint32_t fill; int open; } psa_hash_operation_t;
#define PSA_HASH_OPERATION_INIT { {0}, 0, {0}, 0, 0 }
psa_status_t psa_crypto_init(void);
psa_status_t psa_hash_setup(psa_hash_operation_t *op, psa_algorithm_t alg);
psa_status_t psa_hash_update(psa_hash_operation_t *op, const uint8_t *in, size_t len);
psa_status_t psa_hash_finish(psa_hash_operation_t *op, uint8_t *out, size_t out_size, size_t *out_len);
psa_status_t psa_hash_abort(psa_hash_operation_t *op);
psa_status_t psa_hash_compute(psa_algorithm_t alg, const uint8_t *in, size_t len, uint8_t *out, size_t out_size, size_t *out_len);
#ifdef __cplusplus
}
#endif
#endif
