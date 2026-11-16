/* SPDX-License-Identifier: GPL-3.0-or-later
 * kodeos role only. khal_zlib_decompress() on LVGL's bundled lodepng (CONFIG_LV_USE_LODEPNG=y in the kodeos
 * profile). The device uses the ESP ROM's tinfl; Emscripten has no libz offline.
 *
 * Differences from khal_zlib_esp.c, all in the strictness of damaged input: lodepng checks the Adler-32 and the
 * zlib header but does not report bytes that follow the stream, so "other bytes follow the stream" is not
 * refused (KODE_ERROR on the device). Kody's packs are well formed, so nothing observes the difference.
 * Output is decoded into lodepng's own buffer (lv_malloc) and copied: one extra copy.
 *
 * Owner of the real thing: the "platform" area (it supersedes khal_zlib_esp.c); when it provides
 * khal_zlib_decompress, delete this file. */
#include <string.h>
#include "khal_zlib.h"
#include "lvgl.h"
#include "src/libs/lodepng/lodepng.h"

kode_status_t khal_zlib_decompress(const void *src, size_t src_len, void *dst, size_t dst_cap, size_t *out_len)
{
    if (out_len) *out_len = 0;
    if (!src || !dst || !out_len || src_len == 0 || dst_cap == 0) return KODE_DENIED;
    unsigned char *out = NULL;
    size_t n = 0;
    LodePNGDecompressSettings st;
    lodepng_decompress_settings_init(&st);
    st.max_output_size = dst_cap;
    unsigned err = lodepng_zlib_decompress(&out, &n, (const unsigned char *)src, src_len, &st);
    if (err) {
        lv_free(out);
        return (err == 109 /* max_output_size exceeded */) ? KODE_DENIED : KODE_ERROR;
    }
    if (n > dst_cap) { lv_free(out); return KODE_DENIED; }
    memcpy(dst, out, n);
    lv_free(out);
    *out_len = n;
    return KODE_OK;
}
