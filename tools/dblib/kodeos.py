"""The "kodeos" build role: what differs from the app role.

kodeOS is the same SDK built "the way an app is", plus its own GUI component (kgui) and main.
Everything here is additive: the app role never calls into this module.

  * the OS-role sdkconfig: kbsp/sdkconfig.board, KodeOS/sdkconfig.defaults, then the web overrides
    (tools/profiles/sdkconfig.web.kodeos.defaults) and the areas' own overrides; kgui's Kconfig is read too
  * extra SDK sources the OS role compiles that the app role does not (test_dot, kui_pack)
  * kgui's sources, read from its CMakeLists.txt
  * ThorVG (C++) and the LVGL pieces it needs, cJSON, and the factory content packaged for the firmware
"""
import json
import pathlib
import re

DEFAULT_KODEOS = "/home/claude/src/KodeOS"

# SDK sources some area supersedes for the app role but that kodeOS needs for real.
# (platform/area.json supersedes kui_pack.c only because cJSON was missing; third_party/cJSON provides it.)
UNSUPERSEDE = {
    "components/kui/pack/src/kui_pack.c",
}


def web_defaults(root):
    return pathlib.Path(root) / "tools/profiles/sdkconfig.web.kodeos.defaults"


def kconfigs(kos):
    return [pathlib.Path(kos) / "components/kgui/Kconfig"]


def os_defaults(kos):
    return pathlib.Path(kos) / "sdkconfig.defaults"


def extra_sdk_sources(sdk, cfg):
    """{component: [files]} compiled in the OS role on top of sources.sdk_sources()."""
    on = lambda k: cfg.get(k) == "y"
    c = "components/"
    out = {"kaos": [], "kui": []}
    if on("KODE_TEST_DOT"):
        out["kaos"] += [c + "kaos/test_dot/analysis/src/" + f for f in ("tdan_geom.c", "tdan_pix.c", "tdan_judge.c")]
        out["kaos"] += [c + "kaos/test_dot/src/" + f for f in
                        ("test_dot_ao.c", "test_dot_worker.c", "test_dot_cam.c", "test_dot_jpeg.c")]
        if on("KODEOS_CONSOLE"):
            out["kaos"].append(c + "kaos/test_dot/src/test_dot_verbs.c")
        out["kui"] += [c + "kui/test_dot/src/" + f for f in
                       ("kui_test_dot_paint.c", "kui_test_dot_canvas.c", "kui_test_dot_screens.c",
                        "kui_test_dot_patterns.c")]
    out["kui"].append(c + "kui/pack/src/kui_pack.c")
    return out


# private include directories of the extra sources (ESP-IDF's PRIV_INCLUDE_DIRS)
EXTRA_PRIVATE_GLOBS = {
    "kaos": ["components/kaos/test_dot/analysis/include", "components/kaos/test_dot/analysis/src",
             "components/kaos/test_dot/src"],
    "kui": ["components/kui/pack/src"],
}
EXTRA_PUBLIC_GLOBS = ["components/kui/test_dot/include", "components/kui/pack/include"]


# kaos' test_dot analysis is compiled with -ffp-contract=off (kaos/CMakeLists.txt)
NO_FP_CONTRACT = ("tdan_geom.c", "tdan_pix.c", "tdan_judge.c")


def kgui_sources(kos, cfg):
    """kgui's source files, from its CMakeLists.txt (the list is long and changes with kodeOS)."""
    kos = pathlib.Path(kos)
    cm = (kos / "components/kgui/CMakeLists.txt").read_text()
    cm = re.sub(r"#[^\n]*", "", cm)
    m = re.search(r"idf_component_register\s*\((.*?)\bINCLUDE_DIRS", cm, re.S)
    body = m.group(1)
    srcs = re.findall(r'"([^"\s]+\.c)"', body)
    if cfg.get("KODE_TEST_DOT") == "y":
        srcs.append("kgui_test_dot.c")
    return [kos / "components/kgui" / s for s in srcs]


def kgui_includes(kos):
    k = pathlib.Path(kos) / "components/kgui"
    return [k / "include", k, k / "screens", k / "glyphs"]


def thorvg_sources(lvgl, cfg):
    """ThorVG's C++ (the Lottie player of Kody and the vector draw backend). Only with LV_USE_THORVG_INTERNAL."""
    if cfg.get("LV_USE_THORVG_INTERNAL") != "y":
        return []
    return sorted(str(p.relative_to(lvgl)) for p in (pathlib.Path(lvgl) / "src/libs/thorvg").glob("*.cpp"))


def lodepng_sources(lvgl, cfg):
    return []   # compiled with the rest of LVGL (lvgl_sources lists every .c under src/libs/lodepng) when enabled


def cjson_sources(root):
    return [pathlib.Path(root) / "third_party/cJSON/cJSON.c"]


def factory_files(sdk, kos):
    """Files the firmware expects on its FAT volume (CMakeLists.txt of kodeOS, `storage_stage`):
    Kody's pack under kode/, then everything in storage_image/ except README.md and *.commit.
    Returns [(path inside the volume, source file)]."""
    sdk, kos = pathlib.Path(sdk), pathlib.Path(kos)
    out = []
    pack = sdk / "components/kui/kody/pack"
    if pack.is_dir():
        out += [("kode/" + p.name, p) for p in sorted(pack.iterdir()) if p.is_file()]
    img = kos / "storage_image"
    if img.is_dir():
        for p in sorted(img.rglob("*")):
            if p.is_file() and p.name != "README.md" and p.suffix != ".commit":
                out.append((str(p.relative_to(img)), p))
    return out


def factory_manifest(files):
    return [{"path": rel, "size": src.stat().st_size} for rel, src in files]


# Link parameters of the OS role (apps: 96 MB, 32 workers, 1 MB main stack). Numbers are in STATUS-kodeos.md.
MEMORY_MB = 96
POOL = 48
MAIN_STACK = "1MB"


def git_commit(d):
    import subprocess
    r = subprocess.run(["git", "-C", str(d), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else "unknown"


def compat_flags(root):
    """Forced include that maps the two kode-sdk API changes between 0910112 (kodeOS's pin) and c9568a3."""
    return ["-include", str(pathlib.Path(root) / "tools/profiles/kodeos_compat.h")]


# Symbols the OS role wraps at link time (-Wl,--wrap=X): runtime/drivers/kodeos_boot defines __wrap_X and calls
# __real_X. Used to correct another area's fake without editing it. See display_link.c.
LINK_WRAPS = ["kdrv_display_link"]
