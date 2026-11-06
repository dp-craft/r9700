#!/usr/bin/env python3
"""haikubrief_gate.py OUTDIR...: cheap gate on set-S notes (Haiku's brief). One line per OUTDIR: target incidents found, planted found, INCIDENT lines.
OUTDIR holds NN.txt; its parent's MANIFEST.txt maps NN to the report."""
import os, re, sys
T = {'buildcmp': [('L52', {52}), ('L64', {64}), ('cold-start any', {24, 52, 64}), ('planted L66', {66})],
     'sharp': [('L293', {293, 294}), ('L282', {282}), ('planted L152', {152})]}
for out in sys.argv[1:]:
    man = dict(l.split() for l in open(os.path.join(os.path.dirname(out.rstrip('/')), 'MANIFEST.txt')) if l.strip())
    cells, n = [], 0
    for nn, path in sorted(man.items()):
        r = next((k for k in T if k in os.path.basename(path)), None)
        p = f"{out}/{nn}.txt"
        cited = {int(m.group(1)) for m in (re.match(r'INCIDENT\|(\d+)\|', l) for l in open(p)) if m} if os.path.exists(p) else None
        if cited is not None:
            n += len(cited)
        for name, lines in T.get(r, []):
            cells.append(f"{r}:{name}={'-' if cited is None else 'Y' if cited & lines else 'n'}")
    print(f"{out.split('/')[-2]}/{out.split('/')[-1]}: {' '.join(cells)} | incident lines {n}")
