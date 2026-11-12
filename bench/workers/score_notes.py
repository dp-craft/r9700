#!/usr/bin/env python3
"""score_notes.py WORKDIR KEYDIR: docnotes through the earlier report's scorer. score = mean of exact facts, planted incidents found, and paths found. Meaning is graded separately, blind."""
import json, os, subprocess, sys, tempfile
W, K = sys.argv[1:3]
S = "/home/dev/work/dp-craft/amd/campaigns/workers/2026-11-04-2207-docanalysis-ornith-vs-haiku/harness/score.py"
with tempfile.TemporaryDirectory() as t:
    os.symlink(f"{K}/key.json", f"{t}/key.json")
    os.symlink(f"{W}/docs", f"{t}/docs")
    os.symlink(f"{W}/out", f"{t}/out-o")
    r = json.loads(subprocess.run(["python3", S, t, "o"], capture_output=True, text=True, check=True).stdout)
T = r["total"]
fact = T["exact"] / max(T["fact"], 1)
need = T["hits"] / max(T["needles"], 1)
path = T["tp"] / max(T["paths_want"], 1) if T["paths_want"] else 1.0
print(json.dumps(dict(score=round((fact + need + path) / 3, 3) if T["notes"] else 0.0, fact_exact=T["exact"], fact_wrongline=T["wrongline"], fact_fabricated=T["fabricated"], facts=T["fact"], needles_hit=T["hits"], needles=T["needles"], paths_found=T["tp"], paths_want=T["paths_want"], paths_invented=T["invented"], incidents=T["inc"], doc=r["docs"][0]), indent=1))
