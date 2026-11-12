#!/usr/bin/env python3
"""aggregate.py: arms/ and quarantine/ into summary.jsonl and a Markdown table with throughput. Source tokens come from sizes.json or the fixture key."""
import glob, json, os, re, sys
RUN = "/home/dev/work/dp-craft/amd/campaigns/workers/2026-11-05-0320-ornith-usecases/results/2026-11-05-0320-ornith-usecases"
UC = "/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad/uc"
sizes = json.load(open(f"{UC}/sizes.json")) if os.path.exists(f"{UC}/sizes.json") else {}


def src(task, size):
    k = f"{UC}/{task}-{size}/key.json"
    if os.path.exists(k):
        t = json.load(open(k)).get("tokens")
        if t:
            return t
    for key in (f"{task}-{size}", f"{task}.{size}"):
        v = sizes.get(key)
        if isinstance(v, dict):
            v = v.get("tokens")
        if v:
            return v
    return None


rows = []
for p in sorted(glob.glob(f"{RUN}/arms/*/result.json")):
    r = json.load(open(p))
    a = r["arm"].split(".")
    task, size, v, preset = a[:4]
    rep = a[4] if len(a) > 4 else ""
    s = src(task, size)
    d = r["detail"]
    x = dict(arm=r["arm"], task=task, size=size, brief=v, preset=preset, rep=rep, score=r["score"], wall_s=r["wall_s"], gen=r["gen"], reason=r["reason"], peak=r["prompt_peak"], drops=r["drops"], rate=r["rate"], vram=r["peak_vram"], gtt=r["peak_gtt"], src_tokens=s,
             src_per_min=round(s / r["wall_s"] * 60) if s else None, gen_per_1k=round(r["gen"] / s * 1000) if s else None)
    for k in ("zero_loss", "clean", "lost_lines", "altered_lines", "added_lines", "duplicated_lines", "numbers_missing", "numbers_invented", "sections_right", "sections_intact", "sections", "original_order_agreement", "needles_hit", "needles", "fact_exact", "facts"):
        if k in d:
            x[k] = d[k]
    rows.append(x)
with open(f"{RUN}/summary.jsonl", "w") as f:
    for x in rows:
        f.write(json.dumps(x) + "\n")
print("| Arm | Score | Clean | s | Gen | Source tok | Source/min | Gen per 1k | Peak | Drops | VRAM MiB | GTT MiB |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for x in rows:
    print(f"| {x['arm']} | {x['score']} | {x.get('clean', '')} | {x['wall_s']} | {x['gen']} | {x['src_tokens'] or ''} | {x['src_per_min'] or ''} | {x['gen_per_1k'] or ''} | {x['peak']} | {x['drops']} | {int(x['vram'])} | {int(x['gtt'])} |")
q = sorted(os.path.basename(p) for p in glob.glob(f"{RUN}/quarantine/*"))
print("\nQuarantined:", ", ".join(q) or "none")
