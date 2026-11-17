#!/usr/bin/env python3
"""Appends message keys to the three language files. Input: a JSON object {key: [en, pt-BR, es]} on stdin. Dev helper."""
import json, sys, re, os
root = os.path.join(os.path.dirname(__file__), '..', 'src', 'i18n')
data = json.load(sys.stdin)
for i, name in enumerate(['en.ts', 'pt-BR.ts', 'es.ts']):
    p = os.path.join(root, name)
    s = open(p, encoding='utf-8').read()
    end = s.rindex('}')
    body, tail = s[:end], s[end:]
    for k, v in data.items():
        text = v[i].replace('\\', '\\\\').replace("'", "\\'")
        line = f"  '{k}': '{text}',\n"
        pat = re.compile(r"^  '" + re.escape(k) + r"': .*\n", re.M)
        if pat.search(body):
            body = pat.sub(lambda m: line, body)
        else:
            body += line
    open(p, 'w', encoding='utf-8').write(body + tail)
print('ok', len(data))
