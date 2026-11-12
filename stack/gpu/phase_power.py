#!/usr/bin/env python3
"""phase_power.py — GPU power per request PHASE, from a run dir's gpu_samples.csv joined with the
wall-clock phase boundaries capture_engine writes on every request/turn row
(wall_start → wall_first_token = prefill, wall_first_token → wall_end = decode).

Why: a run-wide average power (vram_sampler's summary line) mixes idle gaps, boot and both phases,
so it cannot tell a healthy run from one that silently fell off the fast kernel path. Per-phase
power can: on this card (210 W cap) a compute-heavy MXFP4 prefill should sit near the cap, and a
phase far below it is a CONFIG SUSPECT (wrong kernel/dtype path, throttling, clocks pinned low) —
flagged, never auto-corrected. Monitor only.

    python3 phase_power.py RUN_DIR [--low-w 150]  >> RUN_DIR/results.jsonl
Emits {kind:"power_request"} per request/turn and one {kind:"power"} summary per label.
Phases shorter than the sampler interval may hold 0 samples → null (reported as n=0, not guessed).
"""
import argparse, csv, json, os, statistics as st
from collections import defaultdict


def load_samples(path):
    out = []
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(l for l in fh if not l.startswith("#")):
            try:
                out.append((float(r["unix_ts"]), float(r["power_w"])))
            except (KeyError, TypeError, ValueError):
                continue
    return out


def window(samples, lo, hi):
    return [p for t, p in samples if lo <= t <= hi]


def stats(ws):
    return (round(st.mean(ws), 1), round(max(ws), 1), len(ws)) if ws else (None, None, 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir")
    ap.add_argument("--low-w", type=float, default=float(os.environ.get("POWER_LOW_W", 150)),
                    help="flag a phase whose average is below this (default 150 W, env POWER_LOW_W)")
    a = ap.parse_args()
    gs, rs = os.path.join(a.run_dir, "gpu_samples.csv"), os.path.join(a.run_dir, "results.jsonl")
    if not (os.path.exists(gs) and os.path.exists(rs)):
        return
    samples = load_samples(gs)
    rows = [json.loads(l) for l in open(rs, encoding="utf-8") if l.strip()]
    per_label = defaultdict(lambda: {"prefill": [], "decode": []})
    for r in rows:
        if r.get("kind") not in ("request", "turn") or "wall_start" not in r or r.get("error"):
            continue
        pf = window(samples, r["wall_start"], r["wall_first_token"])
        dc = window(samples, r["wall_first_token"], r["wall_end"])
        per_label[r.get("label")]["prefill"] += pf
        per_label[r.get("label")]["decode"] += dc
        (pa, pp, pn), (da, dp, dn) = stats(pf), stats(dc)
        print(json.dumps({"kind": "power_request", "label": r.get("label"), "rep": r.get("rep"),
                          "stream": r.get("stream"), "turn": r.get("turn"),
                          "context_tokens": r.get("context_tokens") or r.get("prompt_tokens"),
                          "prefill_w_avg": pa, "prefill_w_peak": pp, "prefill_n": pn,
                          "decode_w_avg": da, "decode_w_peak": dp, "decode_n": dn}))
    for lab, ph in per_label.items():
        (pa, pp, pn), (da, dp, dn) = stats(ph["prefill"]), stats(ph["decode"])
        low = [n for n, v in (("prefill", pa), ("decode", da)) if v is not None and v < a.low_w]
        print(json.dumps({"kind": "power", "label": lab,
                          "prefill_w_avg": pa, "prefill_w_peak": pp, "prefill_n": pn,
                          "decode_w_avg": da, "decode_w_peak": dp, "decode_n": dn,
                          "low_threshold_w": a.low_w, "low_phases": low,
                          "flag": ("SUSPECT: " + "/".join(low) + f" avg < {a.low_w:.0f} W — check config")
                                  if low else None}))


if __name__ == "__main__":
    main()
