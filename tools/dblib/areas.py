"""Hardware areas: runtime/drivers/<area>/area.json, discovered by globbing.

Adding an area means creating files inside runtime/drivers/<area>/ (and
tests/node/<area>/) only. The manifest keys (all optional except "area"):

  area        name; must equal the folder name
  supersedes  {sdk-relative path: reason}  SDK source files that are NOT compiled
              because this area (or generated stubs) provides their functions
  sources     list of globs, relative to the folder, of C files to compile
              (default ["*.c", "src/*.c"])
  i2c_chips   names of C functions `void f(void)` that register virtual I2C chips
              (called from khal_i2c_init through a generated file)
  exports     C functions the page may call (no leading underscore needed)
  sdkconfig   {CONFIG_NAME: value}  extra Kconfig values, applied after the web defaults
  js          JS glue files (relative to the folder), packaged into the bundle
  test_apps   apps the area's tests need built: "sdk:examples/<name>" (relative to
              the SDK) or "area:<path>" (relative to the area folder)
  roles       build roles the area applies to, default ["app", "kodeos"]; an area that only
              serves one firmware (e.g. runtime/drivers/kodeos_boot) lists just that role
  description one line
"""
import json
import pathlib
import sys


class Area:
    def __init__(self, d, data):
        self.dir = d
        self.name = data["area"]
        self.data = data
        self.supersedes = data.get("supersedes", {})
        self.i2c_chips = data.get("i2c_chips", [])
        self.exports = data.get("exports", [])
        self.sdkconfig = data.get("sdkconfig", {})
        self.js = data.get("js", [])
        self.test_apps = data.get("test_apps", [])
        self.roles = data.get("roles", ["app", "kodeos"])
        self.sources = []
        for g in data.get("sources", ["*.c", "src/*.c"]):
            self.sources += sorted(d.glob(g))


def load_areas(root, role="app"):
    """Areas of one build role (default: the app role, as before the kodeos role existed)."""
    root = pathlib.Path(root)
    areas = []
    for mf in sorted(list((root / "runtime").glob("*/area.json")) + list((root / "runtime/drivers").glob("*/area.json"))):
        try:
            data = json.loads(mf.read_text())
        except ValueError as e:
            sys.exit("dotbench: bad manifest %s: %s" % (mf, e))
        a = Area(mf.parent, data)
        if a.name != mf.parent.name:
            sys.exit("dotbench: %s: \"area\" must be %r" % (mf, mf.parent.name))
        if role in a.roles:
            areas.append(a)
    seen = {}
    for a in areas:
        for f in a.supersedes:
            if f in seen:
                sys.exit("dotbench: %s is superseded by both '%s' and '%s'" % (f, seen[f], a.name))
            seen[f] = a.name
    return areas


def superseded(areas):
    out = {}
    for a in areas:
        for f, why in a.supersedes.items():
            out[f] = "[%s] %s" % (a.name, why)
    return out


def exports(areas):
    out = ["_main"]
    for a in areas:
        for s in a.exports:
            s = s if s.startswith("_") else "_" + s
            if s not in out:
                out.append(s)
    return out


def area_sdkconfig(areas):
    lines = []
    for a in areas:
        for k, v in a.sdkconfig.items():
            lines.append("%s=%s" % (k, v if not isinstance(v, bool) else ("y" if v else "n")))
    return "\n".join(lines) + ("\n" if lines else "")
