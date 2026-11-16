#!/usr/bin/env python3
"""Generate sdkconfig.h (and an sdkconfig text file) from the kode-sdk Kconfig files.

A small Kconfig evaluator, enough for the SDK's own files: menu/choice/if blocks,
config/menuconfig with bool/int/hex/string, `default X [if E]`, `depends on E`,
`select S [if E]`, `range` (ignored), help blocks, and expressions with
! && || == != < > <= >= and parentheses.

Values come from, in increasing priority:
  1. Kconfig defaults,
  2. --defaults files in the order given (sdkconfig.defaults syntax: CONFIG_X=y, "# CONFIG_X is not set").
Symbols that no Kconfig declares (ESP-IDF's own) are passed through from the
defaults files verbatim, and read as `n` when absent.

usage: gen_sdkconfig.py --sdk DIR [--defaults FILE]... --out-h sdkconfig.h [--out-config sdkconfig] [--json out.json]
"""
import argparse
import json
import pathlib
import re
import sys


class Sym:
    def __init__(self, name):
        self.name = name
        self.type = None          # bool/int/hex/string
        self.defaults = []        # (value_expr, cond_expr_or_None)
        self.depends = []         # expr strings (all must hold)
        self.selects = []         # (target, cond)
        self.choice = None
        self.declared = False


TOKEN = re.compile(r'\s*(?:(&&|\|\||==|!=|<=|>=|[!<>()])|("(?:[^"\\]|\\.)*")|([A-Za-z0-9_\-\.]+))')


def tokenize(expr):
    out, pos = [], 0
    expr = expr.strip()
    while pos < len(expr):
        m = TOKEN.match(expr, pos)
        if not m:
            raise ValueError("bad expression: %r" % expr)
        out.append(m.group(1) or m.group(2) or m.group(3))
        pos = m.end()
    return out


class Parser:
    """Recursive-descent expression evaluator over a symbol lookup function."""

    def __init__(self, toks, lookup):
        self.t, self.i, self.lookup = toks, 0, lookup

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def eat(self):
        v = self.t[self.i]
        self.i += 1
        return v

    def parse(self):
        return self.p_or()

    def p_or(self):
        v = self.p_and()
        while self.peek() == '||':
            self.eat()
            r = self.p_and()
            v = 'y' if (v == 'y' or r == 'y') else 'n'
        return v

    def p_and(self):
        v = self.p_cmp()
        while self.peek() == '&&':
            self.eat()
            r = self.p_cmp()
            v = 'y' if (v == 'y' and r == 'y') else 'n'
        return v

    def p_cmp(self):
        v = self.p_not()
        if self.peek() in ('==', '!=', '<', '>', '<=', '>='):
            op = self.eat()
            r = self.p_not()
            try:
                a, b = int(v, 0), int(r, 0)
            except (ValueError, TypeError):
                a, b = v, r
            res = {'==': a == b, '!=': a != b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b}[op]
            return 'y' if res else 'n'
        return v

    def p_not(self):
        if self.peek() == '!':
            self.eat()
            return 'n' if self.p_not() == 'y' else 'y'
        return self.p_atom()

    def p_atom(self):
        t = self.eat()
        if t == '(':
            v = self.p_or()
            self.eat()
            return v
        if t.startswith('"'):
            return t[1:-1]
        if t in ('y', 'n'):
            return t
        if re.fullmatch(r'-?(0x[0-9a-fA-F]+|\d+)', t):
            return t
        return self.lookup(t)


class Kconfig:
    def __init__(self):
        self.syms = {}
        self.choices = []          # (members, default_expr list, depends)
        self.user = {}             # name -> raw value from defaults files
        self.order = {}            # name -> sequence number of the last defaults line that set it

    def sym(self, name):
        if name not in self.syms:
            self.syms[name] = Sym(name)
        return self.syms[name]

    # ---- parsing ----
    def parse_file(self, path):
        lines = pathlib.Path(path).read_text(errors="replace").splitlines()
        stack_if, stack_menu_dep = [], []
        cur = None
        choice = None
        in_help = None
        i = 0

        def block_deps():
            return [d for d in stack_if] + [d for d in stack_menu_dep]

        while i < len(lines):
            raw = lines[i]
            i += 1
            s = raw.strip()
            s = re.sub(r"\s+#.*$", "", s) if not s.startswith("#") and '"' not in s.split("#")[0][-1:] else s
            if in_help is not None:
                if s == "" or (len(raw) - len(raw.lstrip())) > in_help:
                    continue
                in_help = None
            if not s or s.startswith("#"):
                continue
            m = re.match(r"(menuconfig|config)\s+([A-Za-z0-9_]+)", s)
            if m:
                cur = self.sym(m.group(2))
                cur.declared = True
                for d in block_deps():
                    cur.depends.append(d)
                if choice is not None:
                    cur.choice = choice
                    choice["members"].append(cur)
                continue
            if s.startswith("choice"):
                choice = {"members": [], "defaults": [], "depends": list(block_deps())}
                self.choices.append(choice)
                cur = None
                continue
            if s.startswith("endchoice"):
                choice = None
                cur = None
                continue
            if s.startswith("menu ") or s == "menu":
                stack_menu_dep.append(None)
                continue
            if s.startswith("endmenu"):
                stack_menu_dep.pop()
                continue
            if s.startswith("if "):
                stack_if.append(s[3:].strip())
                cur = None
                continue
            if s.startswith("endif"):
                stack_if.pop()
                continue
            if s.startswith("source") or s.startswith("comment") or s.startswith("mainmenu"):
                continue
            if s.startswith("help") or s == "---help---":
                in_help = len(raw) - len(raw.lstrip())
                continue
            # attributes
            target_default = choice if (cur is None and choice is not None) else None
            m = re.match(r"(bool|int|hex|string)\b(.*)", s)
            if m:
                if cur is not None:
                    cur.type = m.group(1)
                continue
            m = re.match(r"default\s+(.+?)(?:\s+if\s+(.+))?$", s)
            if m:
                if cur is not None:
                    cur.defaults.append((m.group(1).strip(), m.group(2)))
                elif target_default is not None:
                    target_default["defaults"].append((m.group(1).strip(), m.group(2)))
                continue
            m = re.match(r"depends on\s+(.+)$", s)
            if m:
                if cur is not None:
                    cur.depends.append(m.group(1).strip())
                elif choice is not None:
                    choice["depends"].append(m.group(1).strip())
                continue
            m = re.match(r"select\s+([A-Za-z0-9_]+)(?:\s+if\s+(.+))?$", s)
            if m and cur is not None:
                cur.selects.append((m.group(1), m.group(2), cur.name))
                continue
            # prompt, range, imply, option ...: ignored

    _n = 0

    def _seq(self):
        Kconfig._n += 1
        return Kconfig._n

    def load_defaults(self, path):
        for line in pathlib.Path(path).read_text(errors="replace").splitlines():
            line = line.strip()
            m = re.match(r"CONFIG_([A-Za-z0-9_]+)=(.*)$", line)
            if m:
                v = m.group(2).strip()
                self.user[m.group(1)] = v
                self.order[m.group(1)] = len(self.order) + 1000000 * 0 + self._seq()
                continue
            m = re.match(r"#\s*CONFIG_([A-Za-z0-9_]+) is not set", line)
            if m:
                self.user[m.group(1)] = "n"
                self.order[m.group(1)] = self._seq()

    # ---- evaluation ----
    def evaluate(self):
        val = {}
        selected = {}

        def lookup(name):
            if name in val:
                return val[name]
            sym = self.syms.get(name)
            if sym is None or not sym.declared:
                v = self.user.get(name, "n")
                return v[1:-1] if v.startswith('"') else v
            return "n" if sym.type in ("bool", None) else ""

        def ev(expr):
            if expr is None:
                return "y"
            return Parser(tokenize(expr), lookup).parse()

        names = sorted(self.syms)
        for _ in range(30):
            new = {}
            choice_pick = {}
            # choices first: one y member
            for ch in self.choices:
                dep_ok = all(ev(d) == "y" for d in ch["depends"] if d)
                pick = None
                if dep_ok:
                    best = -1
                    for m_ in ch["members"]:
                        if self.user.get(m_.name) == "y" and self.order.get(m_.name, 0) > best:
                            pick = m_.name
                            best = self.order.get(m_.name, 0)
                    if pick is None:
                        for dv, cond in ch["defaults"]:
                            if ev(cond) == "y":
                                pick = dv
                                break
                    if pick is None:
                        for m_ in ch["members"]:
                            if all(ev(d) == "y" for d in m_.depends if d):
                                pick = m_.name
                                break
                for m_ in ch["members"]:
                    choice_pick[m_.name] = "y" if m_.name == pick else "n"
            for name in names:
                sym = self.syms[name]
                if not sym.declared:
                    continue
                visible = all(ev(d) == "y" for d in sym.depends if d)
                if not visible:
                    new[name] = "n" if sym.type in ("bool", None) else ""
                    continue
                if sym.choice is not None:
                    new[name] = choice_pick.get(name, "n")
                    continue
                v = None
                if name in self.user:
                    v = self.user[name]
                else:
                    for dv, cond in sym.defaults:
                        if ev(cond) == "y":
                            v = dv
                            if dv not in ("y", "n") and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", dv):
                                v = lookup(dv)   # a default that names another symbol
                            elif dv not in ("y", "n") and not dv.startswith('"') and not re.fullmatch(r"-?(0x[0-9a-fA-F]+|\d+)", dv):
                                v = ev(dv)       # an expression
                            break
                if v is None:
                    v = "n" if sym.type in ("bool", None) else ("" if sym.type == "string" else "0")
                if sym.type == "string" and v.startswith('"'):
                    v = v[1:-1]
                new[name] = v
            # selects
            sel = {}
            for name in names:
                sym = self.syms[name]
                for tgt, cond, _src in sym.selects:
                    if new.get(name) == "y" and ev(cond) == "y":
                        sel[tgt] = "y"
            for tgt in sel:
                if tgt in new and self.syms[tgt].type == "bool":
                    new[tgt] = "y"
            for tgt in sel:
                if tgt not in new:
                    new[tgt] = "y"
            if new == val:
                break
            val = new
            selected = sel
        return val

    def resolve(self):
        val = self.evaluate()
        out = dict(val)
        for k, v in self.user.items():
            if k not in self.syms or not self.syms[k].declared:
                out[k] = v[1:-1] if v.startswith('"') else v
        return out


def emit_h(cfg, path, quoted):
    lines = ["/* generated by tools/gen_sdkconfig.py from the kode-sdk Kconfig files; do not edit */",
             "#pragma once"]
    for k in sorted(cfg):
        v = cfg[k]
        if v == "y":
            lines.append("#define CONFIG_%s 1" % k)
        elif v == "n" or v == "":
            if v == "" and k in quoted:
                lines.append('#define CONFIG_%s ""' % k)
            continue
        elif k in quoted:
            lines.append('#define CONFIG_%s "%s"' % (k, v))
        elif re.fullmatch(r"-?(0x[0-9a-fA-F]+|\d+)", v):
            lines.append("#define CONFIG_%s %s" % (k, v))
        else:
            lines.append('#define CONFIG_%s "%s"' % (k, v))
    pathlib.Path(path).write_text("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sdk", required=True)
    ap.add_argument("--kconfig", action="append", default=[], help="extra Kconfig file (e.g. LVGL's)")
    ap.add_argument("--defaults", action="append", default=[])
    ap.add_argument("--out-h", required=True)
    ap.add_argument("--out-config")
    ap.add_argument("--json")
    a = ap.parse_args()
    kc = Kconfig()
    sdk = pathlib.Path(a.sdk)
    for f in sorted(sdk.glob("components/**/Kconfig*")):
        if "qpc" in f.parts:
            continue
        kc.parse_file(f)
    for k in a.kconfig:
        kc.parse_file(k)
    for d in a.defaults:
        kc.load_defaults(d)
    cfg = kc.resolve()
    quoted = {k for k, v in kc.syms.items() if v.type == "string"}
    quoted |= {k for k, v in kc.user.items() if kc.user[k].startswith('"')}
    emit_h(cfg, a.out_h, quoted)
    if a.out_config:
        pathlib.Path(a.out_config).write_text(
            "\n".join(("CONFIG_%s=%s" % (k, ("y" if cfg[k] == "y" else ('"%s"' % cfg[k] if k in quoted else cfg[k])))
                       if cfg[k] != "n" else "# CONFIG_%s is not set" % k) for k in sorted(cfg)) + "\n")
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps(cfg, indent=1, sort_keys=True))
    print("sdkconfig: %d symbols, %d enabled" % (len(cfg), sum(1 for v in cfg.values() if v not in ("n", ""))))


if __name__ == "__main__":
    sys.exit(main())
