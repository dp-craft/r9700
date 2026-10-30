#!/usr/bin/env python3
"""How much of Opus's corrected code (fenced blocks after '## Corrected' / '## Tests' in opus/W2-0x.md) appears in a model's
fixed brief, and how much of the brief changed vs its input. Line-level, whitespace-normalised, lines >= 12 chars.
Usage: opus_reuse.py RUN_ROOT ARM"""
import re, sys, os, difflib
root, arm = sys.argv[1], sys.argv[2]
norm = lambda s: re.sub(r"\s+", " ", s).strip()
for b in ("W2-06", "W2-07", "W2-08"):
    opus = open(os.path.join(root, "opus-reference", f"{b}.md")).read()
    code = []
    for blk in re.findall(r"```[a-z]*\n(.*?)```", opus, re.S):
        code += [norm(l) for l in blk.splitlines() if len(norm(l)) >= 12]
    fixed_p = os.path.join(root, arm, "outputs", f"{b}.md")
    if not os.path.exists(fixed_p): print(f"{b}: no fixed brief"); continue
    fixed = open(fixed_p).read(); inp = open(os.path.join(root, arm, "inputs", f"{b}.md")).read()
    fl = {norm(l) for l in fixed.splitlines()}
    hit = sum(1 for l in code if l in fl)
    sm = difflib.SequenceMatcher(None, inp.splitlines(), fixed.splitlines())
    print(f"{b}: opus code lines {len(code)}, in fixed brief {hit} ({(100*hit/len(code)) if code else 0:.0f}%) | "
          f"brief {len(inp.splitlines())} -> {len(fixed.splitlines())} lines, unchanged-ratio {sm.ratio():.2f}")
