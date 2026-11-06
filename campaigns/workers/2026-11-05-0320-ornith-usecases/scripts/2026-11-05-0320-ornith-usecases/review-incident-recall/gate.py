#!/usr/bin/env python3
"""gate.py CASE VARIANT...: one line per variant, target incidents only. PASS = every never-found target in >=2 of 3 runs and the planted one in all."""
import os, re, sys
RUN = '/home/dev/work/dp-craft/amd/campaigns/workers/2026-11-05-0320-ornith-usecases/results/2026-11-05-0320-ornith-usecases'
T = {'buildcmp': ({24, 52, 64}, {66}), 'sharp': ({293, 294}, {152}), 'depth': ({308}, {166})}  # targets..., planted last
case, variants = sys.argv[1], sys.argv[2:]
*targets, planted = T[case]
for v in variants:
    runs = []
    for i in (1, 2, 3):
        p = f"{RUN}/arms/docnotes.{case}.{os.environ.get("RD_V","V2")}.P0.{v}-{i}/output/01.txt"
        runs.append({int(m.group(1)) for m in (re.match(r'INCIDENT\|(\d+)\|', l) for l in open(p)) if m} if os.path.exists(p) else None)
    done = [r for r in runs if r is not None]
    hits = [sum(bool(r & t) for r in done) for t in targets]
    ok = len(done) == 3 and all(h >= 2 for h in hits) and all(r & planted for r in done)
    print(f"{v}: targets {' '.join(f'{h}/{len(done)}' for h in hits)}, planted {sum(bool(r & planted) for r in done)}/{len(done)} -> {'PASS' if ok else 'fail'}")
