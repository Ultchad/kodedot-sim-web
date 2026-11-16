#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Line glyphs for the starter apps, as A8 LVGL images, and each app's icon.png.

Flat, one stroke, round caps, drawn 8x and shrunk, like kui's own line glyphs.
usage: glyphgen.py <app dir> <glyph name>...   writes main/glyphs.c, main/glyphs.h and appdata/icon.png
"""
import math
import os
import sys
from PIL import Image, ImageDraw

SS = 8                      # supersampling
SIZES = (40, 96)            # the pill slot's and the stage disc's glyph
STROKE = 0.085              # of the canvas


def canvas(n):
    im = Image.new("L", (n * SS, n * SS), 0)
    return im, ImageDraw.Draw(im)


class Pen:
    def __init__(self, n):
        self.n = n * SS
        self.im = Image.new("L", (self.n, self.n), 0)
        self.d = ImageDraw.Draw(self.im)
        self.w = max(2, int(round(STROKE * self.n)))
        self.fill = 255

    def p(self, v):
        return v * self.n

    def line(self, pts, w=None):
        w = w or self.w
        pts = [(self.p(x), self.p(y)) for x, y in pts]
        self.d.line(pts, fill=self.fill, width=w, joint="curve")
        for x, y in (pts[0], pts[-1]):
            self.d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=self.fill)

    def arc(self, cx, cy, r, a0, a1, w=None):
        w = w or self.w
        pts = []
        steps = 48
        for i in range(steps + 1):
            a = math.radians(a0 + (a1 - a0) * i / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        self.line(pts, w)

    def ring(self, cx, cy, r, w=None):
        w = w or self.w
        c = (self.p(cx), self.p(cy))
        rr = self.p(r)
        self.d.ellipse((c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr), outline=self.fill, width=w)

    def disc(self, cx, cy, r):
        c = (self.p(cx), self.p(cy))
        rr = self.p(r)
        self.d.ellipse((c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr), fill=self.fill)

    def rrect(self, x0, y0, x1, y1, r, w=None):
        w = w or self.w
        self.d.rounded_rectangle((self.p(x0), self.p(y0), self.p(x1), self.p(y1)), radius=self.p(r), outline=self.fill, width=w)

    def out(self, n):
        return self.im.resize((n, n), Image.LANCZOS)


def g_nfc(pen):
    for r in (0.15, 0.30, 0.45, 0.60):
        pen.arc(0.2, 0.5, r, -42, 42)
    pen.disc(0.2, 0.5, 0.06)


def g_rfid(pen):
    pen.rrect(0.1, 0.26, 0.9, 0.74, 0.1)
    pen.ring(0.3, 0.5, 0.09)
    pen.line([(0.52, 0.42), (0.78, 0.42)])
    pen.line([(0.52, 0.58), (0.7, 0.58)])


def g_ir(pen):
    pen.rrect(0.3, 0.3, 0.62, 0.92, 0.1)
    pen.ring(0.46, 0.46, 0.04)
    pen.line([(0.4, 0.68), (0.52, 0.68)])
    pen.line([(0.4, 0.8), (0.52, 0.8)])
    pen.arc(0.46, 0.3, 0.2, -135, -45)
    pen.arc(0.46, 0.3, 0.34, -135, -45)


def g_light(pen):
    pen.ring(0.5, 0.4, 0.26)
    pen.line([(0.4, 0.72), (0.4, 0.8)])
    pen.line([(0.6, 0.72), (0.6, 0.8)])
    pen.line([(0.4, 0.8), (0.6, 0.8)])
    pen.line([(0.42, 0.9), (0.58, 0.9)])


def g_sos(pen):
    pen.line([(0.5, 0.12), (0.92, 0.84), (0.08, 0.84), (0.5, 0.12)])
    pen.line([(0.5, 0.4), (0.5, 0.62)])
    pen.disc(0.5, 0.74, 0.035)


def g_level(pen):
    pen.ring(0.5, 0.5, 0.38)
    pen.disc(0.58, 0.42, 0.1)
    pen.line([(0.5, 0.1), (0.5, 0.2)])
    pen.line([(0.5, 0.8), (0.5, 0.9)])
    pen.line([(0.1, 0.5), (0.2, 0.5)])
    pen.line([(0.8, 0.5), (0.9, 0.5)])


def g_compass(pen):
    pen.ring(0.5, 0.5, 0.4)
    pen.line([(0.5, 0.22), (0.62, 0.5), (0.5, 0.78), (0.38, 0.5), (0.5, 0.22)])
    pen.disc(0.5, 0.5, 0.04)


def g_tone(pen):
    pts = []
    for i in range(0, 101):
        x = 0.08 + 0.84 * i / 100
        pts.append((x, 0.5 - 0.28 * math.sin(i / 100 * 2 * math.pi * 1.5)))
    pen.line(pts)


def g_led(pen):
    pen.ring(0.5, 0.5, 0.2)
    for a in range(0, 360, 45):
        r0, r1 = 0.32, 0.44
        x0 = 0.5 + r0 * math.cos(math.radians(a)); y0 = 0.5 + r0 * math.sin(math.radians(a))
        x1 = 0.5 + r1 * math.cos(math.radians(a)); y1 = 0.5 + r1 * math.sin(math.radians(a))
        pen.line([(x0, y0), (x1, y1)])


def g_screen(pen):
    pen.rrect(0.22, 0.1, 0.78, 0.9, 0.12)
    pen.line([(0.42, 0.78), (0.58, 0.78)])


def g_tag(pen):
    pen.rrect(0.14, 0.18, 0.86, 0.82, 0.12)
    pen.line([(0.28, 0.4), (0.6, 0.4)])
    pen.line([(0.28, 0.6), (0.48, 0.6)])


def g_wave(pen):
    for i, r in enumerate((0.14, 0.3, 0.46)):
        pen.arc(0.5, 0.5, r, -50, 50)
    pen.disc(0.5, 0.5, 0.05)


def g_folder(pen):
    pen.line([(0.1, 0.28), (0.1, 0.8), (0.9, 0.8), (0.9, 0.36), (0.46, 0.36), (0.38, 0.24), (0.1, 0.24), (0.1, 0.28)])


def g_file(pen):
    pen.line([(0.24, 0.1), (0.62, 0.1), (0.8, 0.28), (0.8, 0.9), (0.24, 0.9), (0.24, 0.1)])
    pen.line([(0.62, 0.1), (0.62, 0.28), (0.8, 0.28)])
    pen.line([(0.38, 0.52), (0.66, 0.52)])
    pen.line([(0.38, 0.68), (0.58, 0.68)])


def g_mic(pen):
    pen.rrect(0.38, 0.1, 0.62, 0.55, 0.12)
    pen.arc(0.5, 0.5, 0.26, 0, 180)
    pen.line([(0.5, 0.76), (0.5, 0.9)])
    pen.line([(0.36, 0.9), (0.64, 0.9)])


def g_play(pen):
    pen.line([(0.3, 0.14), (0.84, 0.5), (0.3, 0.86), (0.3, 0.14)])


def g_stop(pen):
    pen.rrect(0.22, 0.22, 0.78, 0.78, 0.08)


def g_trash(pen):
    pen.line([(0.16, 0.26), (0.84, 0.26)])
    pen.line([(0.4, 0.26), (0.4, 0.14), (0.6, 0.14), (0.6, 0.26)])
    pen.line([(0.24, 0.26), (0.3, 0.88), (0.7, 0.88), (0.76, 0.26)])


def g_plus(pen):
    pen.line([(0.5, 0.18), (0.5, 0.82)])
    pen.line([(0.18, 0.5), (0.82, 0.5)])


def g_check(pen):
    pen.line([(0.16, 0.54), (0.4, 0.76), (0.86, 0.26)])


def g_wifi(pen):
    for r in (0.18, 0.34, 0.5):
        pen.arc(0.5, 0.8, r, -135, -45)
    pen.disc(0.5, 0.8, 0.05)


def g_ble(pen):
    pen.line([(0.28, 0.32), (0.72, 0.68), (0.5, 0.88), (0.5, 0.12), (0.72, 0.32), (0.28, 0.68)])


def g_chip(pen):
    pen.rrect(0.26, 0.26, 0.74, 0.74, 0.06)
    for t in (0.38, 0.5, 0.62):
        pen.line([(t, 0.12), (t, 0.26)])
        pen.line([(t, 0.74), (t, 0.88)])
        pen.line([(0.12, t), (0.26, t)])
        pen.line([(0.74, t), (0.88, t)])


def g_usb(pen):
    pen.rrect(0.1, 0.3, 0.9, 0.7, 0.08)
    for i in range(6):
        pen.line([(0.22 + i * 0.112, 0.42), (0.22 + i * 0.112, 0.46)])
    pen.line([(0.28, 0.58), (0.72, 0.58)])


def g_sensor(pen):
    pen.ring(0.5, 0.5, 0.12)
    pen.arc(0.5, 0.5, 0.28, -60, 60)
    pen.arc(0.5, 0.5, 0.28, 120, 240)
    pen.arc(0.5, 0.5, 0.44, -60, 60)
    pen.arc(0.5, 0.5, 0.44, 120, 240)


def g_edit(pen):
    pen.line([(0.2, 0.8), (0.24, 0.62), (0.7, 0.16), (0.84, 0.3), (0.38, 0.76), (0.2, 0.8)])


def g_copy(pen):
    pen.rrect(0.3, 0.3, 0.84, 0.86, 0.08)
    pen.line([(0.16, 0.7), (0.16, 0.14), (0.62, 0.14)])


def g_card(pen):
    pen.rrect(0.1, 0.24, 0.9, 0.76, 0.1)
    pen.line([(0.1, 0.42), (0.9, 0.42)])


def g_search(pen):
    pen.ring(0.44, 0.44, 0.26)
    pen.line([(0.64, 0.64), (0.88, 0.88)])


def g_pin(pen):
    pen.line([(0.5, 0.12), (0.5, 0.5)])
    pen.ring(0.5, 0.62, 0.12)
    pen.line([(0.5, 0.74), (0.5, 0.9)])


def _wifi_n(pen, n):
    for i, r in enumerate((0.18, 0.34, 0.5)):
        pen.fill = 255 if i < n else 70
        pen.arc(0.5, 0.8, r, -135, -45)
    pen.fill = 255
    pen.disc(0.5, 0.8, 0.05)


def g_wifi1(pen):
    _wifi_n(pen, 1)


def g_wifi2(pen):
    _wifi_n(pen, 2)


def g_wifi3(pen):
    _wifi_n(pen, 3)


def g_power(pen):
    pen.arc(0.5, 0.52, 0.34, -60, 240)
    pen.line([(0.5, 0.1), (0.5, 0.5)])


def g_lock(pen):
    pen.rrect(0.2, 0.44, 0.8, 0.88, 0.08)
    pen.arc(0.5, 0.44, 0.18, 180, 360)
    pen.line([(0.32, 0.44), (0.32, 0.34)])
    pen.line([(0.68, 0.44), (0.68, 0.34)])
    pen.disc(0.5, 0.66, 0.04)


def g_refresh(pen):
    pen.arc(0.5, 0.5, 0.34, -40, 250)
    pen.line([(0.18, 0.1), (0.2, 0.34), (0.42, 0.3)])


def g_bars(pen):
    for i, h in enumerate((0.25, 0.45, 0.65, 0.85)):
        x = 0.16 + i * 0.2
        pen.line([(x, 0.9), (x, 0.9 - h * 0.8)])


def g_signal(pen):
    pen.disc(0.5, 0.5, 0.07)
    for r in (0.22, 0.38):
        pen.arc(0.5, 0.5, r, -50, 50)
        pen.arc(0.5, 0.5, r, 130, 230)


def g_wave_sq(pen):
    pen.line([(0.1, 0.7), (0.1, 0.3), (0.35, 0.3), (0.35, 0.7), (0.6, 0.7), (0.6, 0.3), (0.9, 0.3)])


def g_bolt(pen):
    pen.line([(0.58, 0.08), (0.3, 0.54), (0.5, 0.54), (0.42, 0.92), (0.72, 0.42), (0.52, 0.42), (0.58, 0.08)])


def g_term(pen):
    pen.rrect(0.1, 0.18, 0.9, 0.82, 0.1)
    pen.line([(0.26, 0.4), (0.4, 0.5), (0.26, 0.6)])
    pen.line([(0.48, 0.64), (0.68, 0.64)])


GLYPHS = {"nfc": g_nfc, "rfid": g_rfid, "ir": g_ir, "light": g_light, "sos": g_sos, "level": g_level,
          "compass": g_compass, "tone": g_tone, "led": g_led, "screen": g_screen, "tag": g_tag, "wave": g_wave,
          "folder": g_folder, "file": g_file, "mic": g_mic, "play": g_play, "stop": g_stop, "trash": g_trash,
          "plus": g_plus, "check": g_check, "wifi": g_wifi, "ble": g_ble, "chip": g_chip, "usb": g_usb,
          "sensor": g_sensor, "wifi1": g_wifi1, "wifi2": g_wifi2, "wifi3": g_wifi3, "power": g_power, "lock": g_lock, "refresh": g_refresh, "bars": g_bars, "signal": g_signal, "wave_sq": g_wave_sq, "bolt": g_bolt, "term": g_term, "edit": g_edit, "copy": g_copy, "card": g_card, "search": g_search, "pin": g_pin}


def render(name, n):
    pen = Pen(n)
    # keep inside a margin so the stroke never touches the edge
    GLYPHS[name](pen)
    return pen.out(n)


def emit_c(names):
    out = ["/* SPDX-License-Identifier: GPL-3.0-or-later */", "/**", " * @file glyphs.c",
           " * @brief The app's own line glyphs: A8 images of one stroke, recoloured as they are drawn.", " */",
           '#include "glyphs.h"', "", "#ifndef LV_ATTRIBUTE_MEM_ALIGN", "#define LV_ATTRIBUTE_MEM_ALIGN", "#endif", ""]
    for name in names:
        for n in SIZES:
            im = render(name, n)
            data = list(im.getdata())
            sym = f"app_glyph_{name}_{n}"
            out.append(f"static const LV_ATTRIBUTE_MEM_ALIGN uint8_t {sym}_map[] = {{")
            for i in range(0, len(data), 40):
                out.append("    " + ",".join(f"0x{v:02x}" for v in data[i:i + 40]) + ",")
            out.append("};")
            out.append("")
            out.append(f"const lv_image_dsc_t {sym} = {{")
            out.append("    .header = {")
            out.append("        .magic = LV_IMAGE_HEADER_MAGIC,")
            out.append("        .cf = LV_COLOR_FORMAT_A8,")
            out.append("        .flags = 0,")
            out.append(f"        .w = {n},")
            out.append(f"        .h = {n},")
            out.append(f"        .stride = {n},")
            out.append("    },")
            out.append(f"    .data_size = sizeof({sym}_map),")
            out.append(f"    .data = {sym}_map,")
            out.append("};")
            out.append("")
    return "\n".join(out)


def emit_h(names):
    out = ["/* SPDX-License-Identifier: GPL-3.0-or-later */", "/**", " * @file glyphs.h",
           " * @brief The app's own line glyphs.", " */", "#ifndef GLYPHS_H_", "#define GLYPHS_H_", "",
           '#include "lvgl.h"', "", "#ifdef __cplusplus", 'extern "C" {', "#endif", ""]
    for name in names:
        for n in SIZES:
            out.append(f"extern const lv_image_dsc_t app_glyph_{name}_{n}; /**< The {name} glyph, {n} x {n}. */")
    out += ["", "#ifdef __cplusplus", "}", "#endif", "", "#endif /* GLYPHS_H_ */", ""]
    return "\n".join(out)


def make_icon(path, glyph, color):
    n = 64
    big = Image.new("RGBA", (n * 4, n * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    d.ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=color)
    big = big.resize((n, n), Image.LANCZOS)
    g = render(glyph, 40)
    mask = Image.new("L", (n, n), 0)
    mask.paste(g, ((n - 40) // 2, (n - 40) // 2))
    ink = Image.new("RGBA", (n, n), (222, 215, 205, 255))
    big.paste(ink, (0, 0), mask)
    big.save(path)


if __name__ == "__main__":
    app = sys.argv[1]
    names = sys.argv[2:]
    with open(os.path.join(app, "main/glyphs.c"), "w") as f:
        f.write(emit_c(names))
    with open(os.path.join(app, "main/glyphs.h"), "w") as f:
        f.write(emit_h(names))
