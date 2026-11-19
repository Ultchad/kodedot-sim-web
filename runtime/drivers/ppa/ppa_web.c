/* SPDX-License-Identifier: GPL-3.0-or-later
 * The ESP32-P4 pixel accelerator (ESP-IDF driver/ppa.h) in software, and esp_cache_msync() as a no-op.
 *
 * Seam: this is the layer under the SDK's kdrv_compose.c, which therefore runs as it is (its argument checks in
 * kdrv_compose_check.c, the quantised scale, the rows it writes back, the client per kind of pass), under AO_Display's
 * compose step and kscreen_pic_*. All three passes are blocking, as kdrv_compose asks (PPA_TRANS_MODE_BLOCKING).
 *
 * Assumptions (ESP-IDF's PPA documentation does not say, the bench cannot measure hardware):
 *  - RGB565 only, the one colour mode kdrv_compose uses; any other mode is ESP_ERR_NOT_SUPPORTED.
 *  - A scale is quantised to sixteenths as the hardware's 4-bit fraction does; the result is floor(block * scale / 16)
 *    pixels across, as kdrv_compose_landed() computes it. Pixels are picked by nearest neighbour at the pixel centre
 *    (the hardware may interpolate: the bench shows a slightly harder edge than the board).
 *  - Rotation is counter-clockwise, as ppa_srm_rotation_angle_t is documented; a mirror is applied after the rotation.
 *  - A blend is the standard "foreground at alpha over an opaque background": c = (fg * a + bg * (255 - a)) / 255 per
 *    8-bit channel after expanding RGB565, truncated back to RGB565.
 *  - A fill takes the top bits of the ARGB8888 colour's channels; its alpha is not used. */
#include "driver/ppa.h"
#include "esp_cache.h"

#include <stdlib.h>
#include <string.h>

struct ppa_client_t { ppa_operation_t kind; };

esp_err_t esp_cache_msync(void *addr, size_t size, int flags)
{
    (void)flags;
    return (addr == NULL || size == 0) ? ESP_ERR_INVALID_ARG : ESP_OK;
}

esp_err_t ppa_register_client(const ppa_client_config_t *config, ppa_client_handle_t *ret_client)
{
    if (config == NULL || ret_client == NULL || config->oper_type >= PPA_OPERATION_NUM || config->max_pending_trans_num == 0)
        return ESP_ERR_INVALID_ARG;
    struct ppa_client_t *c = calloc(1, sizeof *c);
    if (c == NULL) return ESP_ERR_NO_MEM;
    c->kind = config->oper_type;
    *ret_client = c;
    return ESP_OK;
}

esp_err_t ppa_unregister_client(ppa_client_handle_t client)
{
    if (client == NULL) return ESP_ERR_INVALID_ARG;
    free(client);
    return ESP_OK;
}

/* the destination block lies inside its picture and the buffer holds the picture */
static int out_ok(const void *buf, uint32_t size, uint32_t pw, uint32_t ph, uint32_t x, uint32_t y, uint32_t w, uint32_t h)
{
    return buf != NULL && pw && ph && w && h && x < pw && y < ph && w <= pw - x && h <= ph - y && (uint64_t)pw * ph * 2U <= size;
}
static int in_ok(const void *buf, uint32_t pw, uint32_t ph, uint32_t x, uint32_t y, uint32_t w, uint32_t h)
{
    return buf != NULL && pw && ph && w && h && x < pw && y < ph && w <= pw - x && h <= ph - y;
}

esp_err_t ppa_do_fill(ppa_client_handle_t client, const ppa_fill_oper_config_t *c)
{
    if (client == NULL || c == NULL || client->kind != PPA_OPERATION_FILL) return ESP_ERR_INVALID_ARG;
    if (c->out.fill_cm != PPA_FILL_COLOR_MODE_RGB565) return ESP_ERR_NOT_SUPPORTED;
    if (!out_ok(c->out.buffer, c->out.buffer_size, c->out.pic_w, c->out.pic_h, c->out.block_offset_x, c->out.block_offset_y,
                c->fill_block_w, c->fill_block_h))
        return ESP_ERR_INVALID_ARG;
    uint16_t px = (uint16_t)(((c->fill_argb_color.r >> 3) << 11) | ((c->fill_argb_color.g >> 2) << 5) | (c->fill_argb_color.b >> 3));
    uint16_t *dst = (uint16_t *)c->out.buffer;
    for (uint32_t y = 0; y < c->fill_block_h; y++) {
        uint16_t *row = dst + (size_t)(c->out.block_offset_y + y) * c->out.pic_w + c->out.block_offset_x;
        for (uint32_t x = 0; x < c->fill_block_w; x++) row[x] = px;
    }
    return ESP_OK;
}

esp_err_t ppa_do_scale_rotate_mirror(ppa_client_handle_t client, const ppa_srm_oper_config_t *c)
{
    if (client == NULL || c == NULL || client->kind != PPA_OPERATION_SRM) return ESP_ERR_INVALID_ARG;
    if (c->in.srm_cm != PPA_SRM_COLOR_MODE_RGB565 || c->out.srm_cm != PPA_SRM_COLOR_MODE_RGB565) return ESP_ERR_NOT_SUPPORTED;
    if (!in_ok(c->in.buffer, c->in.pic_w, c->in.pic_h, c->in.block_offset_x, c->in.block_offset_y, c->in.block_w, c->in.block_h))
        return ESP_ERR_INVALID_ARG;
    if (c->scale_x < 1.0f / 16 || c->scale_y < 1.0f / 16 || c->scale_x > 16.0f || c->scale_y > 16.0f) return ESP_ERR_INVALID_ARG;
    uint32_t qx = (uint32_t)(c->scale_x * 16.0f + 0.5f), qy = (uint32_t)(c->scale_y * 16.0f + 0.5f);   /* sixteenths */
    uint32_t sw = (c->in.block_w * qx) / 16U, sh = (c->in.block_h * qy) / 16U;                         /* scaled, upright */
    if (sw == 0 || sh == 0) return ESP_ERR_INVALID_ARG;
    int odd = (c->rotation_angle == PPA_SRM_ROTATION_ANGLE_90 || c->rotation_angle == PPA_SRM_ROTATION_ANGLE_270);
    uint32_t ow = odd ? sh : sw, oh = odd ? sw : sh;
    if (!out_ok(c->out.buffer, c->out.buffer_size, c->out.pic_w, c->out.pic_h, c->out.block_offset_x, c->out.block_offset_y, ow, oh))
        return ESP_ERR_INVALID_ARG;
    const uint16_t *src = (const uint16_t *)c->in.buffer;
    uint16_t *dst = (uint16_t *)c->out.buffer;
    /* nearest source column of every scaled column (and row), at the pixel centre */
    uint32_t *cx = malloc(sizeof(uint32_t) * (sw + sh));
    if (cx == NULL) return ESP_ERR_NO_MEM;
    uint32_t *cy = cx + sw;
    for (uint32_t i = 0; i < sw; i++) { uint32_t v = ((2U * i + 1U) * 16U) / (2U * qx); cx[i] = v < c->in.block_w ? v : c->in.block_w - 1U; }
    for (uint32_t i = 0; i < sh; i++) { uint32_t v = ((2U * i + 1U) * 16U) / (2U * qy); cy[i] = v < c->in.block_h ? v : c->in.block_h - 1U; }
    for (uint32_t y = 0; y < oh; y++) {
        uint16_t *row = dst + (size_t)(c->out.block_offset_y + y) * c->out.pic_w + c->out.block_offset_x;
        for (uint32_t x = 0; x < ow; x++) {
            uint32_t mx = c->mirror_x ? ow - 1U - x : x, my = c->mirror_y ? oh - 1U - y : y;   /* after the turn */
            uint32_t ux, uy;                                                                     /* the upright scaled picture */
            switch (c->rotation_angle) {
            case PPA_SRM_ROTATION_ANGLE_90:  ux = sw - 1U - my; uy = mx; break;                /* counter-clockwise */
            case PPA_SRM_ROTATION_ANGLE_180: ux = sw - 1U - mx; uy = sh - 1U - my; break;
            case PPA_SRM_ROTATION_ANGLE_270: ux = my; uy = sh - 1U - mx; break;
            default:                         ux = mx; uy = my; break;
            }
            row[x] = src[(size_t)(c->in.block_offset_y + cy[uy]) * c->in.pic_w + c->in.block_offset_x + cx[ux]];
        }
    }
    free(cx);
    return ESP_OK;
}

static uint32_t mix(uint32_t f, uint32_t b, uint32_t a) { return (f * a + b * (255U - a)) / 255U; }

esp_err_t ppa_do_blend(ppa_client_handle_t client, const ppa_blend_oper_config_t *c)
{
    if (client == NULL || c == NULL || client->kind != PPA_OPERATION_BLEND) return ESP_ERR_INVALID_ARG;
    if (c->in_bg.blend_cm != PPA_BLEND_COLOR_MODE_RGB565 || c->in_fg.blend_cm != PPA_BLEND_COLOR_MODE_RGB565 ||
        c->out.blend_cm != PPA_BLEND_COLOR_MODE_RGB565)
        return ESP_ERR_NOT_SUPPORTED;
    if (c->bg_alpha_update_mode != PPA_ALPHA_FIX_VALUE || c->fg_alpha_update_mode != PPA_ALPHA_FIX_VALUE || c->bg_alpha_fix_val != 255U ||
        c->fg_alpha_fix_val > 255U)
        return ESP_ERR_NOT_SUPPORTED;   /* the only mode kdrv_compose asks for: an opaque background, a foreground at a fixed alpha */
    uint32_t w = c->in_fg.block_w, h = c->in_fg.block_h;
    if (!in_ok(c->in_fg.buffer, c->in_fg.pic_w, c->in_fg.pic_h, c->in_fg.block_offset_x, c->in_fg.block_offset_y, w, h) ||
        !in_ok(c->in_bg.buffer, c->in_bg.pic_w, c->in_bg.pic_h, c->in_bg.block_offset_x, c->in_bg.block_offset_y, w, h) ||
        !out_ok(c->out.buffer, c->out.buffer_size, c->out.pic_w, c->out.pic_h, c->out.block_offset_x, c->out.block_offset_y, w, h))
        return ESP_ERR_INVALID_ARG;
    uint32_t a = c->fg_alpha_fix_val;
    const uint16_t *fg = (const uint16_t *)c->in_fg.buffer, *bg = (const uint16_t *)c->in_bg.buffer;
    uint16_t *dst = (uint16_t *)c->out.buffer;
    for (uint32_t y = 0; y < h; y++) {
        const uint16_t *f = fg + (size_t)(c->in_fg.block_offset_y + y) * c->in_fg.pic_w + c->in_fg.block_offset_x;
        const uint16_t *b = bg + (size_t)(c->in_bg.block_offset_y + y) * c->in_bg.pic_w + c->in_bg.block_offset_x;
        uint16_t *o = dst + (size_t)(c->out.block_offset_y + y) * c->out.pic_w + c->out.block_offset_x;
        for (uint32_t x = 0; x < w; x++) {
            uint32_t fr = (f[x] >> 11) & 31U, fgn = (f[x] >> 5) & 63U, fb = f[x] & 31U;
            uint32_t br = (b[x] >> 11) & 31U, bgn = (b[x] >> 5) & 63U, bb = b[x] & 31U;
            fr = (fr << 3) | (fr >> 2); fgn = (fgn << 2) | (fgn >> 4); fb = (fb << 3) | (fb >> 2);
            br = (br << 3) | (br >> 2); bgn = (bgn << 2) | (bgn >> 4); bb = (bb << 3) | (bb >> 2);
            o[x] = (uint16_t)(((mix(fr, br, a) >> 3) << 11) | ((mix(fgn, bgn, a) >> 2) << 5) | (mix(fb, bb, a) >> 3));
        }
    }
    return ESP_OK;
}
