#!/usr/bin/env python3
"""Turn bench JSONL files into a detailed markdown report.

Emits per-workload tables with EVERY collected metric, per-rep detail (not just medians),
and a cross-label comparison so engines line up side by side.
"""
import glob, json, os, sys

METRICS = [
    ("prefill_tok_s", "prefill tok/s"),
    ("decode_tok_s", "decode tok/s"),
    ("e2e_tok_s", "e2e tok/s"),
    ("wall_s", "wall s"),
    ("ttft_proxy_s", "prompt-eval s"),
    ("draft_accept_rate", "draft accept"),
]

RAW_FIELDS = [
    "timings.prompt_n", "timings.prompt_ms", "timings.prompt_per_token_ms", "timings.prompt_per_second",
    "timings.predicted_n", "timings.predicted_ms", "timings.predicted_per_token_ms",
    "timings.predicted_per_second", "timings.draft_n", "timings.draft_n_accepted", "timings.cache_n",
    "usage.prompt_tokens", "usage.completion_tokens", "usage.total_tokens",
    "usage.prompt_tokens_details.cached_tokens",
]


def load(path):
    recs = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    recs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return recs


def fmt(v):
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.2f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def main(outdir):
    files = sorted(glob.glob(os.path.join(outdir, "*.jsonl")))
    if not files:
        print("no jsonl found in " + outdir)
        return
    labels = {}
    for path in files:
        recs = load(path)
        meta = next((r for r in recs if r.get("kind") == "meta"), {})
        label = meta.get("label") or os.path.basename(path).replace(".jsonl", "")
        labels[label] = {"meta": meta, "recs": recs, "path": path}

    out = []
    out.append("## Per-run detail\n")
    for label, d in labels.items():
        m = d["meta"]
        out.append(f"### `{label}`\n")
        out.append(f"- model: `{m.get('model','?')}`")
        out.append(f"- endpoint: `{m.get('base_url','?')}`")
        out.append(f"- started: {m.get('started','?')} · reps: {m.get('reps','?')}")
        if m.get("extra_body"):
            out.append(f"- extra body: `{json.dumps(m['extra_body'])}`")
        if m.get("note"):
            out.append(f"- note: {m['note']}")
        out.append("")
        runs = [r for r in d["recs"] if r.get("kind") == "run"]
        warm = [r for r in d["recs"] if r.get("kind") == "warmup"]
        errs = [r for r in d["recs"] if r.get("kind") == "error"]
        if errs:
            out.append("**Errors:**\n")
            for e in errs:
                out.append(f"- `{e.get('workload')}` rep {e.get('rep', e.get('phase'))}: {e.get('error')}")
            out.append("")
        for wl in sorted({r["workload"] for r in runs}):
            out.append(f"#### workload `{wl}`\n")
            wruns = [r for r in runs if r["workload"] == wl]
            wwarm = [r for r in warm if r["workload"] == wl]
            hdr = "| rep | " + " | ".join(h for _, h in METRICS) + " | finish | out chars |"
            sep = "|---|" + "---|" * (len(METRICS) + 2)
            out.append(hdr)
            out.append(sep)
            for r in wwarm:
                out.append("| warmup* | " + " | ".join(fmt(r.get(k)) for k, _ in METRICS) +
                           f" | {r.get('finish_reason','—')} | {fmt(r.get('content_chars'))} |")
            for r in wruns:
                out.append(f"| {r['rep']} | " + " | ".join(fmt(r.get(k)) for k, _ in METRICS) +
                           f" | {r.get('finish_reason','—')} | {fmt(r.get('content_chars'))} |")
            s = next((r for r in d["recs"] if r.get("kind") == "summary" and r["workload"] == wl), {})
            if s:
                med = " | ".join(fmt(s.get(f"{k}_median")) for k, _ in METRICS)
                out.append(f"| **median** | {med} | | |")
                rng = " | ".join(
                    (f"{fmt(s.get(k+'_min'))}–{fmt(s.get(k+'_max'))}" if s.get(k + "_min") is not None else "—")
                    for k, _ in METRICS)
                out.append(f"| range | {rng} | | |")
                sd = " | ".join(fmt(s.get(f"{k}_stdev")) for k, _ in METRICS)
                out.append(f"| stdev | {sd} | | |")
            out.append("")
            out.append("<details><summary>raw engine counters (rep 1)</summary>\n")
            if wruns:
                r0 = wruns[0]
                out.append("| field | value |")
                out.append("|---|---|")
                for f in RAW_FIELDS:
                    if f in r0:
                        out.append(f"| `{f}` | {fmt(r0[f])} |")
            out.append("\n</details>\n")

    # cross-label comparison
    out.append("## Cross-engine comparison (medians)\n")
    all_wl = sorted({r["workload"] for d in labels.values()
                     for r in d["recs"] if r.get("kind") == "summary"})
    for wl in all_wl:
        out.append(f"### `{wl}`\n")
        out.append("| label | " + " | ".join(h for _, h in METRICS) + " |")
        out.append("|---|" + "---|" * len(METRICS))
        for label, d in labels.items():
            s = next((r for r in d["recs"] if r.get("kind") == "summary" and r["workload"] == wl), None)
            if s:
                out.append(f"| `{label}` | " + " | ".join(fmt(s.get(f"{k}_median")) for k, _ in METRICS) + " |")
        out.append("")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/test/hipfire-bench")
