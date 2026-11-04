#!/usr/bin/env python3
"""Gera n8n/build/*.ts substituindo '__CODE:nome__' pelo conteúdo de code/nome.js (string JSON)."""
import json, os, re, glob
base = os.path.dirname(os.path.abspath(__file__))
os.makedirs(f'{base}/build', exist_ok=True)
for src in sorted(glob.glob(f'{base}/src/*.ts')):
    s = open(src, encoding='utf8').read()
    def rep(m):
        return json.dumps(open(f"{base}/code/{m.group(1)}.js", encoding='utf8').read().rstrip('\n'), ensure_ascii=False)
    s = re.sub(r"'__CODE:([a-z0-9-]+)__'", rep, s)
    s = re.sub(r"'__PROMPT:([a-z0-9-]+)__'", lambda m: json.dumps(open(f"{base}/prompts/{m.group(1)}.md", encoding='utf8').read().rstrip('\n'), ensure_ascii=False), s)
    open(f"{base}/build/{os.path.basename(src)}", 'w', encoding='utf8').write(s)
    print('ok', os.path.basename(src))
