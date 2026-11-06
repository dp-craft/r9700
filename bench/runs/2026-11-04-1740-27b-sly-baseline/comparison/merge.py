#!/usr/bin/env python3
"""Merge the aggregate rows of the four comparable arms and relabel them so bench/lib/report.py finds the depths.
report.py reads depth only from labels shaped '<engine>-d<N>' or 'cr<N>'; the probes used '<arm>-<N>'.
Run from the repo root, then: python3 bench/lib/report.py <this dir> --charts <this dir>/charts --appendix <this dir>/appendix.md"""
import json, os
ARMS = {
    "Ornith 1.5 w4a8 Radiance MTP3": "bench/runs/2026-11-04-1730-ornith15-w4a8-radiance/ornith15-w4a8",
    "Qwen3.8-27B Sly DFlash2 k7": "bench/runs/2026-11-04-1740-27b-sly-baseline/sly-27b-dflash",
    "Qwen3.5-35B Sly triton_unfused DFlash k7": "bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/dflash-unfused",
    "Qwen3.5-35B Sly EMULATION DFlash k7": "bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/dflash-k7",
}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "results.jsonl"), "w") as out:
    for engine, path in ARMS.items():
        for row in map(json.loads, open(os.path.join(path, "results.jsonl"))):
            if row.get("kind") == "aggregate":
                row["source_label"] = row["label"]
                row["engine"] = engine
                row["label"] = f"{engine}-d{row['label'].rsplit('-', 1)[1]}"
                out.write(json.dumps(row) + "\n")
