#!/usr/bin/env python3
# Relabel the ollama OLLAMA_VULKAN=1 rows: they actually ran on ROCm (scheduler kept rocm_v7_2).
import sys, json
fn = sys.argv[1]; out = []
for l in open(fn):
    s = l.strip()
    if not s:
        continue
    try:
        r = json.loads(s)
        if r.get("label", "").startswith("ollvk"):
            r["backend"] = "ROCm7.2-ollama (OLLAMA_VULKAN ignored)"
            s = json.dumps(r)
    except Exception:
        pass
    out.append(s)
open(fn, "w").write("\n".join(out) + "\n")
print("relabeled ollvk rows")
