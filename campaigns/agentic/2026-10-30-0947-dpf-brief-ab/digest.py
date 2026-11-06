#!/usr/bin/env python3
"""Bounded thinking-block digest per run, for a cheap qualitative read (repetition / loops / re-verification).
Per run: the 6 largest blocks + the 6 least-distinct blocks (head + tail + most repeated lines), and a run of 15
consecutive blocks from the compare step (head only) to judge re-derivation across turns.
Usage: digest.py RUNROOT OUTDIR"""
import json, re, sys, os, glob, collections

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
RUNS = {
    "heretic_w208": (["heretic/session-0.jsonl"], "2026-10-30T09:19:53", "2026-10-30T09:31:50"),
    "redhat_d05_all": (sorted(os.path.relpath(f, ROOT) for f in glob.glob(ROOT + "/redhat/session-*.jsonl")), None, None),
    "redhat_d0_w208": (["delta0-w208/session-0.jsonl", "delta0-w208/session-1.jsonl", "delta0-w208-part2/session-1.jsonl"], None, None),
}
norm = lambda s: re.sub(r"\s+", " ", s).strip()

for name, (files, t0, t1) in RUNS.items():
    blocks, opus_read = [], None
    for f in files:
        for l in open(os.path.join(ROOT, f), errors="replace"):
            try: d = json.loads(l)
            except Exception: continue
            ts = d.get("timestamp") or ""
            if d.get("type") != "assistant" or (t0 and not (t0 <= ts[:19] <= t1)): continue
            for c in d["message"].get("content") or []:
                if c.get("type") == "thinking" and c.get("thinking"):
                    th = c["thinking"]; ls = [norm(x) for x in th.splitlines() if len(norm(x)) >= 40]
                    blocks.append({"i": len(blocks), "ts": ts[:19], "file": f, "chars": len(th), "lines": len(ls),
                                   "distinct": round(len(set(ls)) / len(ls), 2) if ls else 1.0, "text": th})
                elif c.get("type") == "tool_use" and not opus_read and "/opus/" in json.dumps(c.get("input")):
                    opus_read = len(blocks)
    pick = sorted(blocks, key=lambda b: -b["chars"])[:6]
    pick += [b for b in sorted((b for b in blocks if b["lines"] >= 20), key=lambda b: b["distinct"])[:6] if b not in pick]
    with open(f"{OUT}/{name}.md", "w") as o:
        o.write(f"# {name}: {len(blocks)} thinking blocks, {sum(b['chars'] for b in blocks)} chars\n\n## Sampled blocks (largest + least distinct)\n")
        for b in sorted(pick, key=lambda b: b["i"]):
            top = collections.Counter(norm(x) for x in b["text"].splitlines() if len(norm(x)) >= 40).most_common(3)
            o.write(f"\n### block {b['i']} @ {b['ts']}Z  chars={b['chars']} lines>=40ch={b['lines']} distinct={b['distinct']}\n")
            o.write("most repeated lines: " + " | ".join(f"x{n}: {t[:120]}" for t, n in top if n > 1) + "\n")
            t = b["text"]
            o.write("HEAD:\n" + t[:1500] + ("\n[... middle elided ...]\nTAIL:\n" + t[-1500:] if len(t) > 3000 else t[1500:]) + "\n")
        s = opus_read if opus_read is not None else len(blocks) // 2
        o.write(f"\n## 15 consecutive blocks from block {s} on (start of the compare step, or mid-run), head 700 chars each\n")
        for b in blocks[s:s + 15]:
            o.write(f"\n### block {b['i']} @ {b['ts']}Z chars={b['chars']} distinct={b['distinct']}\n{b['text'][:700]}\n")
    print(name, len(blocks), "blocks; digest", os.path.getsize(f"{OUT}/{name}.md"), "bytes")
