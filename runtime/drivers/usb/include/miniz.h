/* SPDX-License-Identifier: GPL-3.0-or-later
 * The slice of miniz's tinfl that kdrv_kfw.c names. The inflater itself is not modelled (kfw_deps_web.c): a DEFLATE
 * container is refused as corrupt; bare images and uncompressed containers work. */
#ifndef DOTBENCH_MINIZ_H
#define DOTBENCH_MINIZ_H
#include <stddef.h>
#include <stdint.h>
typedef uint32_t mz_uint32;
typedef struct { uint32_t state; } tinfl_decompressor;
#define TINFL_LZ_DICT_SIZE 32768
#define TINFL_FLAG_PARSE_ZLIB_HEADER 1
#define TINFL_FLAG_HAS_MORE_INPUT 2
typedef enum { TINFL_STATUS_FAILED = -1, TINFL_STATUS_DONE = 0, TINFL_STATUS_NEEDS_MORE_INPUT = 1 } tinfl_status;
#define tinfl_init(r) ((r)->state = 0)
tinfl_status tinfl_decompress(tinfl_decompressor *r, const uint8_t *in, size_t *in_len, uint8_t *dict, uint8_t *out, size_t *out_len, mz_uint32 flags);
#endif
