#!/usr/bin/env python3
"""Build an anonymised blind-grading package: each source (review file + probe dir) -> <out>/<LABEL>/.
Usage: make_blind.py OUT name=REVIEW_MD:PROBE_DIR ...   (labels X, Y, Z assigned by a seeded shuffle; key -> OUT/../key.json)
Sanitises worktree paths and model/engine names in every text file; refuses to finish if a leak pattern survives."""
import json, os, random, re, shutil, sys

LEAK = re.compile(r"dpf-bench-[\w.-]+|heretic|swift|redhat|red ?hat|mxfp4|q4_?k_?xl|q4kxl|unsloth|sly|vllm|llama-?swap|"
                  r"dflash|cactus|replay|delta ?0|δ", re.I)
WT = re.compile(r"/home/dev/work/dippe/dpf-bench-[\w.-]+")

def clean(text):
    text = WT.sub("<WT>", text)
    return LEAK.sub("<REDACTED>", text)

def copy_clean(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        t = open(src, encoding="utf-8").read()
    except (UnicodeDecodeError, IsADirectoryError):
        return
    open(dst, "w", encoding="utf-8").write(clean(t))

out = sys.argv[1]
srcs = [a.split("=", 1) for a in sys.argv[2:]]
labels = ["X", "Y", "Z"][:len(srcs)]
rng = random.Random(20261031); rng.shuffle(labels)
key = {}
for (name, spec), lab in zip(srcs, labels):
    review, probes = spec.split(":", 1)
    key[lab] = {"name": name, "review": review, "probes": probes}
    copy_clean(review, f"{out}/{lab}/review.md")
    for root, _, files in os.walk(probes):
        for fn in files:
            if "node_modules" in root:
                continue
            rel = os.path.relpath(os.path.join(root, fn), probes)
            copy_clean(os.path.join(root, fn), f"{out}/{lab}/probes/{rel}")
leaks = []
for root, _, files in os.walk(out):
    for fn in files:
        p = os.path.join(root, fn)
        for m in LEAK.finditer(open(p, encoding="utf-8").read().replace("<REDACTED>", "")):
            leaks.append((p, m.group(0)))
json.dump(key, open(os.path.join(os.path.dirname(os.path.abspath(out)), "key.json"), "w"), indent=2)
print("labels:", {k: v["name"] for k, v in key.items()} if "--show" in os.environ.get("BLIND_SHOW", "") else "written to key.json")
print("leaks:", leaks[:10] if leaks else "none")
sys.exit(1 if leaks else 0)
