#!/usr/bin/env python3
"""
Makes web/src/project/fontdata.ts: the site's own fonts (Outfit, DM Sans, DM Mono; SIL Open Font License 1.1, from
@fontsource) cut down to the characters the project PDF writes in English, Portuguese and Spanish, as TrueType data
with the metrics the PDF needs. None of the three has an ohm sign, so one is drawn here in each font's own weight.
Dev helper, run by hand when the fonts or the character set change (needs python3 with fonttools):
    python3 scripts/pdf-fonts.py
The result is committed, so the site's build needs neither Python nor fonttools.
"""
import base64, io, json, math, os
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools import subset

root = os.path.join(os.path.dirname(__file__), '..')
FONTS = {
    'display': ('outfit', 'outfit-latin-600-normal.woff', 'Outfit-SemiBold'),
    'text': ('dm-sans', 'dm-sans-latin-400-normal.woff', 'DMSans-Regular'),
    'strong': ('dm-sans', 'dm-sans-latin-600-normal.woff', 'DMSans-SemiBold'),
    'mono': ('dm-mono', 'dm-mono-latin-400-normal.woff', 'DMMono-Regular'),
    'label': ('dm-mono', 'dm-mono-latin-500-normal.woff', 'DMMono-Medium'),
}
CHARS = [*range(0x20, 0x7f), *range(0xa0, 0x100), 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac]
OMEGA = 0x2126

def stem_of(font, cap):
    """The width of the T's stem: the extent of its outline below half the cap height."""
    rec = RecordingPen()
    gs = font.getGlyphSet()
    gs[font.getBestCmap()[ord('T')]].draw(rec)
    xs = [p[0] for _, pts in rec.value for p in pts if p is not None and p[1] < cap * 0.4]
    return max(xs) - min(xs)

def omega_outline(cap, t, mono_width=None):
    """An ohm sign as one closed polygon: an arc open at the bottom standing on two feet, stroked `t` wide."""
    R = cap * 0.40
    cy = cap * 0.55
    Ry = cap + cap * 0.012 - t / 2 - cy
    cx = 0.0
    line = [(cx - 0.98 * R, t / 2), (cx - 0.36 * R, t / 2)]
    a0, a1 = math.radians(238), math.radians(-58)
    n = 34
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        line.append((cx + R * math.cos(a), cy + Ry * math.sin(a)))
    line += [(cx + 0.36 * R, t / 2), (cx + 0.98 * R, t / 2)]
    def offset(side):
        out = []
        for i, p in enumerate(line):
            a = line[max(0, i - 1)]; b = line[min(len(line) - 1, i + 1)]
            if i == 0: a, b = p, line[1]
            if i == len(line) - 1: a, b = line[-2], p
            def normal(u, v):
                dx, dy = v[0] - u[0], v[1] - u[1]; l = math.hypot(dx, dy) or 1
                return (-dy / l, dx / l)
            if 0 < i < len(line) - 1:
                n1, n2 = normal(line[i - 1], p), normal(p, line[i + 1])
                mx, my = n1[0] + n2[0], n1[1] + n2[1]
                ml = math.hypot(mx, my) or 1
                mx, my = mx / ml, my / ml
                k = min(2.2, 1 / max(0.2, mx * n1[0] + my * n1[1]))
                nx, ny = mx * k, my * k
            else:
                nx, ny = normal(a, b)
            out.append((p[0] + side * nx * t / 2, p[1] + side * ny * t / 2))
        return out
    poly = offset(1) + offset(-1)[::-1]
    xmin = min(p[0] for p in poly); xmax = max(p[0] for p in poly)
    side = cap * 0.07
    adv = mono_width or round(xmax - xmin + 2 * side)
    shift = (adv - (xmax - xmin)) / 2 - xmin
    poly = [(round(x + shift), round(y)) for x, y in poly]
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    if area > 0: poly.reverse()  # TrueType: outer contours run clockwise
    return poly, adv

out = {}
total = 0
for key, (pkg, file, ps) in FONTS.items():
    font = TTFont(os.path.join(root, 'node_modules', '@fontsource', pkg, 'files', file))
    font.flavor = None
    cap = font['OS/2'].sCapHeight
    t = stem_of(font, cap)
    cmap = font.getBestCmap()
    mono = font['hmtx'][cmap[ord('0')]][0] if pkg == 'dm-mono' else None
    poly, adv = omega_outline(cap, t, mono)
    pen = TTGlyphPen(None)
    pen.moveTo(poly[0])
    for p in poly[1:]: pen.lineTo(p)
    pen.closePath()
    font.setGlyphOrder(font.getGlyphOrder() + ['Omega.kd'])
    font['glyf']['Omega.kd'] = pen.glyph()
    font['hmtx']['Omega.kd'] = (adv, min(p[0] for p in poly))
    for table in font['cmap'].tables:
        if table.isUnicode(): table.cmap[OMEGA] = 'Omega.kd'
    opts = subset.Options()
    opts.hinting = False
    opts.layout_features = []
    opts.name_IDs = [1, 2, 4, 6]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'DSIG', 'STAT', 'meta']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=CHARS + [OMEGA])
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    font = TTFont(io.BytesIO(data))
    order = font.getGlyphOrder()
    cmap = font.getBestCmap()
    head, hhea, os2 = font['head'], font['hhea'], font['OS/2']
    out[key] = {
        'name': ps,
        'upm': head.unitsPerEm,
        'ascent': hhea.ascent,
        'descent': hhea.descent,
        'cap': os2.sCapHeight,
        'xHeight': os2.sxHeight,
        'bbox': [head.xMin, head.yMin, head.xMax, head.yMax],
        'stem': round(t),
        'fixed': pkg == 'dm-mono',
        'cmap': sorted([cp, order.index(g)] for cp, g in cmap.items()),
        'adv': [font['hmtx'][g][0] for g in order],
        'ttf': base64.b64encode(data).decode(),
    }
    total += len(data)
    print(key, ps, len(order), 'glyphs', len(data), 'bytes', 'cap', cap, 'stem', round(t))

path = os.path.join(root, 'src', 'project', 'fontdata.ts')
with open(path, 'w') as f:
    f.write('// Made by scripts/pdf-fonts.py: do not edit. Outfit, DM Sans and DM Mono (SIL Open Font License 1.1), cut down to\n')
    f.write('// the characters the project PDF writes, with an ohm sign drawn in each. `ttf` is the TrueType file in base64.\n')
    f.write('export interface FontData {\n  name: string;\n  upm: number;\n  ascent: number;\n  descent: number;\n  cap: number;\n  xHeight: number;\n  bbox: number[];\n  stem: number;\n  fixed: boolean;\n  cmap: number[][];\n  adv: number[];\n  ttf: string;\n}\n')
    f.write('export type FontId = %s;\n' % ' | '.join("'%s'" % k for k in out))
    f.write('export const FONT_DATA: Record<FontId, FontData> = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print('total', total, 'bytes of fonts;', os.path.getsize(path), 'bytes of TypeScript')
