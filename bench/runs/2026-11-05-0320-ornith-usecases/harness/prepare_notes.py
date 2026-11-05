#!/usr/bin/env python3
"""prepare_notes.py UC_ROOT: one-document docnotes fixtures from the earlier report's X set, with its planted fictional incidents. key.json holds that document's oracle."""
import json, os, shutil, sys
UC = sys.argv[1]
SP = os.path.dirname(UC.rstrip("/"))
E = "/home/dev/work/dp-craft/amd/bench/runs/2026-11-04-2207-docanalysis-ornith-vs-haiku/X/key.json"
PICK = {"hardest": "2026-07-14-hardest-tasks-27b-vs-35b.analysis.md", "depth": "2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md", "sharp": "2026-10-31-redhat-sharp-w208-blind.analysis.md", "buildcmp": "2026-09-15-stew675-buildcmp.analysis.md"}
k = json.load(open(E))
for short, name in PICK.items():
    d = f"{UC}/docnotes-{short}"
    os.makedirs(f"{d}/docs", exist_ok=True)
    shutil.copy(f"{SP}/f/X/docs/{name}", f"{d}/docs/{name}")
    json.dump(dict(order=[name], docs={name: k["docs"][name]}), open(f"{d}/key.json", "w"), indent=1)
    print(short, os.path.getsize(f"{d}/docs/{name}"), "bytes", k["docs"][name]["lines"], "lines")
