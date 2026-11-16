"""Locating and running the Emscripten toolchain; shared build helpers."""
import concurrent.futures as cf
import hashlib
import os
import pathlib
import shlex
import shutil
import subprocess
import sys


def activate_emsdk(emsdk):
    """Put emcc on PATH. Uses emsdk_env.sh when emcc is not already reachable."""
    if shutil.which("emcc"):
        return
    env_sh = pathlib.Path(emsdk) / "emsdk_env.sh"
    if not env_sh.exists():
        sys.exit("dotbench: emcc not found and %s does not exist (set DOTBENCH_EMSDK)" % env_sh)
    out = subprocess.run(["bash", "-c", ". %s >/dev/null 2>&1; env -0" % shlex.quote(str(env_sh))],
                         capture_output=True, check=True).stdout
    for item in out.split(b"\0"):
        if b"=" in item:
            k, v = item.decode(errors="replace").split("=", 1)
            os.environ[k] = v
    if not shutil.which("emcc"):
        sys.exit("dotbench: emsdk_env.sh did not provide emcc")


def emcc_version():
    r = subprocess.run(["emcc", "--version"], capture_output=True, text=True)
    first = r.stdout.splitlines()[0] if r.stdout else ""
    import re
    m = re.search(r"\)\s+(\d+\.\d+\.\d+)", first)
    return m.group(1) if m else first.strip()


def _read_deps(dfile):
    try:
        txt = pathlib.Path(dfile).read_text()
    except OSError:
        return None
    txt = txt.replace("\\\n", " ")
    parts = txt.split(":", 1)[1].split()
    return parts


def needs_build(obj, src, cmd):
    obj = pathlib.Path(obj)
    stamp = obj.with_suffix(".cmd")
    d = obj.with_suffix(".d")
    if not obj.exists() or not stamp.exists() or not d.exists():
        return True
    if stamp.read_text() != " ".join(cmd):
        return True
    t = obj.stat().st_mtime
    deps = _read_deps(d)
    if deps is None:
        return True
    for p in deps:
        try:
            if os.stat(p).st_mtime > t:
                return True
        except OSError:
            return True
    return False


def compile_one(job):
    src, obj, flags = job
    obj = pathlib.Path(obj)
    obj.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["emcc", "-c", str(src), "-o", str(obj), "-MMD", "-MF", str(obj.with_suffix(".d"))] + flags
    if not needs_build(obj, src, cmd):
        return (src, 0, "", False)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0:
        obj.with_suffix(".cmd").write_text(" ".join(cmd))
    return (src, r.returncode, r.stderr, True)


def compile_all(jobs, nproc, label):
    """jobs: list of (src, obj, flags). Returns list of failed sources."""
    failed = []
    built = 0
    with cf.ThreadPoolExecutor(nproc) as ex:
        for i, (src, rc, err, did) in enumerate(ex.map(compile_one, jobs), 1):
            if did:
                built += 1
                if rc == 0 and built % 25 == 0:
                    print("  [%s] %d/%d" % (label, i, len(jobs)), flush=True)
            if rc != 0:
                failed.append(src)
                print("FAILED: %s\n%s" % (src, err[-3000:]), file=sys.stderr)
    print("[%s] %d files, %d compiled, %d failed" % (label, len(jobs), built, len(failed)))
    return failed


def make_archive(archive, objs):
    archive = pathlib.Path(archive)
    objs = [str(o) for o in objs]
    if archive.exists():
        t = archive.stat().st_mtime
        if all(os.stat(o).st_mtime <= t for o in objs) and \
                archive.with_suffix(".list").exists() and archive.with_suffix(".list").read_text() == "\n".join(objs):
            return False
    if archive.exists():
        archive.unlink()
    # emar in chunks to keep the command line short
    for i in range(0, len(objs), 200):
        subprocess.run(["emar", "rcs", str(archive)] + objs[i:i + 200], check=True)
    archive.with_suffix(".list").write_text("\n".join(objs))
    return True


def defined_symbols(objs):
    """Global defined symbols of the given object files (llvm-nm via emnm)."""
    syms = set()
    objs = [str(o) for o in objs]
    for i in range(0, len(objs), 100):
        r = subprocess.run(["emnm", "-g", "--defined-only", "-P"] + objs[i:i + 100],
                           capture_output=True, text=True)
        for line in r.stdout.splitlines():
            f = line.split()
            if len(f) >= 2 and not line.endswith(":"):
                syms.add(f[0])
    return syms


def file_hash(paths):
    h = hashlib.sha1()
    for p in paths:
        try:
            h.update(pathlib.Path(p).read_bytes())
        except OSError:
            h.update(b"-")
    return h.hexdigest()
