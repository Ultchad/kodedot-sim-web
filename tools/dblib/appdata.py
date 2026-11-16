"""The board's data folder of an app (app.json + icon.k64), made at build time with KodeOS's own tools/kappdata.py.

On the board an app's name and icon live apart from its image, in /storage/.kode/appsdata/<project>/. kodeOS's list reads
them from there. `dotbench build` puts the same two files into the .dotbench under board/, so the page can install them on
/storage when it installs the app. kappdata.py is loaded from the KodeOS checkout (read only, never copied or modified):
its validation and its picture-to-k64 conversion are the board's contract.
"""
import importlib.util
import json
import pathlib
import re
import sys
import tempfile

ICON_SIDE = 64          # the form every kodeOS reads (kappdata.py: "64x64 ... which the board doubles")


def _kappdata(kos):
    p = pathlib.Path(kos) / "tools" / "kappdata.py"
    if not p.is_file():
        return None
    spec = importlib.util.spec_from_file_location("kappdata", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def project_version(appdir, fallback="0.0.0"):
    """`set(PROJECT_VER "x")` of the app's CMakeLists.txt (what the board prints under the name), else `fallback`."""
    m = re.search(r'^\s*set\s*\(\s*PROJECT_VER\s+"?([^")\s]+)"?\s*\)', (pathlib.Path(appdir) / "CMakeLists.txt").read_text(), re.M)
    return m.group(1) if m else fallback


def board_folder(appdir, kos, description=""):
    """(app.json bytes, icon.k64 bytes or b"") for the app, or None when kappdata.py is not available.

    Source: the app's appdata/ folder (app.json + icon.png/jpg/k64) when it has one, else a minimal app.json and the icon.png beside
    CMakeLists.txt if any. A folder the board would refuse is reported on stderr and skipped (the app still builds)."""
    ka = _kappdata(kos)
    if ka is None:
        print("dotbench: %s/tools/kappdata.py not found: no icon.k64 in the package" % kos, file=sys.stderr)
        return None
    appdir = pathlib.Path(appdir)
    src = appdir / "appdata"
    try:
        if (src / "app.json").is_file():
            return ka.load(str(src), ICON_SIDE)
        with tempfile.TemporaryDirectory() as t:
            t = pathlib.Path(t)
            (t / "app.json").write_text(json.dumps({"kode": "1", **({"description": description[:52]} if description else {})}))
            icon = appdir / "icon.png"
            if icon.is_file():
                (t / "icon.png").write_bytes(icon.read_bytes())
            return ka.load(str(t), ICON_SIDE)
    except ValueError as e:
        print("dotbench: board data of %s skipped: %s" % (appdir.name, e), file=sys.stderr)
        return None
