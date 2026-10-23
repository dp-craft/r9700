#!/usr/bin/env python3
"""speeds.py LABEL [LABEL ...] -- prefill/decode speed of a gate run, from logs/<label>.server.

vLLM logs one stats line per ~10 s window (Avg prompt / generation throughput). With MAXSEQS=1:
  decode  = median generation rate over windows with NO prompt tokens (pure decode, DFlash included)
  prefill = median / max prompt rate over windows with >= 1000 prompt tok/s (prefill-dominated;
            a window that is part prefill, part idle/decode reads LOW, so max is the closer estimate)
  accept  = mean DFlash acceptance length over windows that drafted
Window averages, not per-request timings: good for comparing images on the same workload, not a
substitute for capture_engine.py probe.
"""
import re, statistics as st, sys
from pathlib import Path

LOGS = Path(__file__).resolve().parent / "logs"
TP = re.compile(r"Avg prompt throughput: ([\d.]+) tokens/s, Avg generation throughput: ([\d.]+) tokens/s, Running: (\d+)")
AL = re.compile(r"Mean acceptance length: ([\d.]+)")

def med(xs): return f"{st.median(xs):.0f}" if xs else "-"

print("label\tdecode_med_tok/s\tdecode_n\tprefill_med_tok/s\tprefill_max_tok/s\tprefill_n\taccept_len\tprompt_tok_total")
for label in sys.argv[1:]:
    f = LOGS / f"{label}.server"
    if not f.exists():
        print(f"{label}\t(no {f.name})"); continue
    dec, pre, acc, tot = [], [], [], 0.0
    for line in f.read_text(errors="replace").splitlines():
        if m := TP.search(line):
            p, g, run = float(m[1]), float(m[2]), int(m[3])
            tot += p * 10
            if run and p == 0 and g > 0: dec.append(g)
            if p >= 1000: pre.append(p)
        elif m := AL.search(line):
            acc.append(float(m[1]))
    print(f"{label}\t{med(dec)}\t{len(dec)}\t{med(pre)}\t{f'{max(pre):.0f}' if pre else '-'}\t{len(pre)}\t"
          f"{f'{st.mean(acc):.2f}' if acc else '-'}\t{tot:.0f}")
