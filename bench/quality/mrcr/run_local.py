#!/usr/bin/env python3
"""Run MRCR V2 against a LOCAL OpenAI-compatible endpoint (llama-swap / llama-server).

The upstream run_evaluation.py talks to the Gemini API and needs google-genai + pandas.
This is the same evaluation pointed at http://127.0.0.1:9292/v1 instead, using only the
stdlib + requests (neither pandas nor the openai SDK is installed on this box).

    # what a run would cost, no GPU needed:
    ./run_local.py --csv ~/mrcr_v2/mrcr_v2/'mrcr_v2p1_8needle_in_(4096,8192)'*.csv --dry-run

    # smoke test: 3 samples on the shallowest bucket
    ./run_local.py --csv ~/mrcr_v2/mrcr_v2/'mrcr_v2p1_8needle_in_(4096,8192)'*.csv --limit 3

    # the real thing (484 samples, resumable -- see --out)
    ./run_local.py --csv ~/mrcr_v2/mrcr_v2/mrcr_v2p1_8needle_upto_128K*.csv

SCORING IS NOT REIMPLEMENTED HERE. mrcr_v2_metric is imported out of the upstream
run_evaluation.py so there is exactly one scorer and it cannot drift from GDM's; see
_load_reference_metric() for why that import needs a shim.

NOTE ON llama-swap: naming a model swaps out whatever else is loaded (they share one
`inference-group`), so starting a run will evict another session's model.
"""

import argparse
import csv
import glob
import importlib.util
import os
import pathlib
import statistics
import sys
import time
import types

import requests

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_URL = "http://127.0.0.1:9292/v1"
DEFAULT_MODEL = "qwen38-27b-q6k-mrcr-ctx200k-kvq8-mtp-frog-eff-medium"

# MRCR rows are megabytes of transcript in a single field. Python's csv module refuses fields
# over 128 KiB by default, so WITHOUT this every row of every file fails to parse with
# "_csv.Error: field larger than field limit". Must be set before any reader is built.
csv.field_size_limit(sys.maxsize)

# Columns copied through to the results file. Deliberately NOT `queries`: it is the whole
# multi-megabyte prompt, and echoing it back would make a 484-row result file ~110 MB for no
# analytic gain (it is already on disk in the input csv, addressable by `row`).
PASSTHROUGH = ("context_len", "answer_token_count", "num_relevant", "answer_context_position")
OUT_FIELDS = ("row", "model", "score", "elapsed_s", "completion_tokens", "prompt_tokens",
              "error", *PASSTHROUGH, "prediction")


def _load_reference_metric():
    """Return mrcr_v2_metric from the upstream run_evaluation.py, unmodified.

    That module imports google.genai and pandas at module scope purely for its own main(),
    and neither is installed here -- but the metric itself is pure stdlib (difflib). Rather
    than copy ~30 lines of scoring into this file, where it could silently drift from the
    reference and quietly invalidate every number produced, we register throwaway stubs for
    the unused imports and exec the real module. main() does not run (it is __main__-guarded).
    """
    stub = {name: sys.modules.setdefault(name, types.ModuleType(name))
            for name in ("google", "google.genai", "google.genai.types", "pandas")}
    # setattr, not dotted assignment: `from google import genai` resolves the attribute, not just
    # the sys.modules entry, and a plain `mod.genai = ...` trips static checkers on ModuleType.
    setattr(stub["google"], "genai", stub["google.genai"])
    setattr(stub["google.genai"], "types", stub["google.genai.types"])

    path = HERE / "run_evaluation.py"
    spec = importlib.util.spec_from_file_location("mrcr_reference", path)
    if spec is None or spec.loader is None:
        sys.exit(f"cannot load the reference metric from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.mrcr_v2_metric


def resolve_csv(pattern):
    """Accept a path or a glob. The dataset filenames contain literal parentheses, which are
    awkward to type unquoted, so a partial pattern is the ergonomic way to name one."""
    matches = sorted(glob.glob(os.path.expanduser(pattern)))
    if not matches:
        sys.exit(f"no csv matched: {pattern}")
    if len(matches) > 1:
        sys.exit("pattern matched several files, pick one:\n  " + "\n  ".join(matches))
    return matches[0]


def load_rows(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def done_rows(out_path):
    """Row indices already scored in a previous run, so an interrupted sweep resumes instead of
    restarting. A 484-sample run is hours long; losing it to one Ctrl-C would be the single most
    likely way to waste a day here."""
    if not os.path.exists(out_path):
        return set()
    with open(out_path, newline="", encoding="utf-8") as fh:
        return {int(r["row"]) for r in csv.DictReader(fh) if r.get("row", "").isdigit()}


def check_model(url, model):
    """Fail loudly on a wrong model id. Without this, llama-swap answers an unknown name with a
    404 whose body is easy to mistake for a server problem."""
    try:
        resp = requests.get(f"{url}/models", timeout=10)
        resp.raise_for_status()
        served = [m["id"] for m in resp.json().get("data", [])]
    except requests.RequestException as exc:
        sys.exit(f"cannot reach {url}/models -- is llama-swap running?\n  {exc}")
    if model not in served:
        close = [m for m in served if "mrcr" in m] or served
        sys.exit(f"model {model!r} is not served. Candidates:\n  " + "\n  ".join(close))


def ask(url, model, prompt, max_tokens, temperature, timeout, effort=None):
    """One completion. Returns (text, usage, error). `error` non-empty means the request itself
    failed -- kept separate from a merely wrong answer so an exhausted context window (which the
    server REFUSES, because these rows run --no-context-shift) cannot be misread as a low score."""
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if effort:
        # Per-request override of the server-wide `reasoning_effort` pinned on the llama-swap row.
        # Per-request wins, which is the whole reason the pin is a DEFAULT and not a lock-in.
        # This is the dominant cost knob on this eval: the answers are ~400 tokens, so at medium
        # effort ~90% of every sample's decode is thinking.
        body["chat_template_kwargs"] = {"reasoning_effort": effort}
    try:
        # (connect, read): the read leg must cover llama-swap loading a 20 GB gguf on the first
        # call plus a full deep-context prefill, so it is minutes, not seconds.
        resp = requests.post(f"{url}/chat/completions", json=body, timeout=(10, timeout))
    except requests.RequestException as exc:
        return "", {}, f"request failed: {exc}"
    if resp.status_code != 200:
        return "", {}, f"HTTP {resp.status_code}: {resp.text[:300]}"
    data = resp.json()
    text = data["choices"][0]["message"].get("content") or ""
    return text, data.get("usage", {}), ""


# Total completion tokens (thinking + answer) per effort level. The llama-swap TEMPLATE_VARIANTS
# notes measure NATURAL THINKING length on a reasoning-heavy AIME-style task (medium 3058-3746),
# but MRCR is retrieval-and-copy and provokes far less deliberation: MEASURED 2026-09-02 over 35
# samples at 131k, medium effort produced a median of 860 total completion tokens (range 493-1664).
# Using the AIME figure here overestimated a medium-effort MRCR run by ~4x, so these are the
# MRCR-specific numbers, scaled from that measured medium point.
COMPLETION_TOKENS = {"none": 450, "low": 700, "medium": 860, "high": 2000, "xhigh": 2000}

# Throughput is strongly depth-dependent, and assuming otherwise is what made the first version of
# this estimator wrong by ~3x. Two MEASURED anchors on Qwen3.8-27B Q6_K / Vulkan / R9700:
#   ~32k ctx  : prefill 813 tok/s, decode 45.9 tok/s  (llama-swap bench, mixed project workloads)
#   ~133k ctx : prefill 294 tok/s, decode 30.5 tok/s  (this repo, 2026-09-02 MRCR run)
# Linearly interpolated between them and clamped outside. A 2-point fit, not a model -- treat
# anything far outside 32k-133k as a guess.
_ANCHORS = ((32768, 813.0, 45.9), (133000, 294.0, 30.5))


def rates_at(ctx):
    """(prefill tok/s, decode tok/s) at a given context depth."""
    (c0, p0, d0), (c1, p1, d1) = _ANCHORS
    f = max(0.0, min(1.0, (ctx - c0) / (c1 - c0)))
    return p0 + (p1 - p0) * f, d0 + (d1 - d0) * f


def transcript_groups(rows):
    """How many FULL prefills a file costs. Consecutive rows differ only in the closing query
    line, so llama-server's prompt cache carries the shared prefix over and only a transcript
    change forces a fresh prefill. Measured on the shipped data: 2 groups at 32k, 1 at 64k/128k."""
    groups, q = 1, [r["queries"] for r in rows]
    for a, b in zip(q, q[1:]):
        n, m = 0, min(len(a), len(b))
        while n < m and a[n] == b[n]:
            n += 1
        if len(b) - n > 1000:
            groups += 1
    return groups


def dry_run(rows, path, effort=None, stride=1):
    lens = [int(r["context_len"]) for r in rows]
    ans = [int(r["answer_token_count"]) for r in rows]
    sel = rows[::stride]
    groups = transcript_groups(rows)
    out_tok = COMPLETION_TOKENS[effort or "medium"]
    depth = int(statistics.median(lens))
    pre_rate, dec_rate = rates_at(depth)

    # Prefill: one full pass per transcript, then only the changed tail per later sample. MEASURED
    # 2026-09-02: llama.cpp reuses the cache in blocks, so the tail re-prefill was ~2050 tokens,
    # not the ~30 the raw character diff implies. Using 30 here under-counted by 70x.
    prefill = groups * depth + max(0, len(sel) - groups) * 2050
    decode = len(sel) * out_tok
    secs = prefill / pre_rate + decode / dec_rate

    print(f"{os.path.basename(path)}")
    print(f"  rows {len(rows)} (running {len(sel)} at stride {stride}), "
          f"ctx median {int(statistics.median(lens)):,}, {groups} base transcript(s)")
    print(f"  effort {effort or 'medium (server default)'}: ~{out_tok} completion tokens/sample "
          f"(reference answers are ~{int(statistics.median(ans))} tokens)")
    print(f"  rates at this depth: prefill {pre_rate:.0f} tok/s, decode {dec_rate:.1f} tok/s")
    print(f"  prefill {prefill:,} tok  +  decode {decode:,} tok  "
          f"-> ~{secs / 60:.0f} min ({secs / 3600:.2f} h)")
    return secs


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", required=True, action="append",
                    help="dataset csv (path or unique glob); repeatable, run in the order given")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--effort", default=None,
                    choices=["none", "low", "medium", "high", "xhigh"],
                    help="per-request reasoning_effort override (default: the row's pinned medium)")
    ap.add_argument("--time-budget", type=float, default=0,
                    help="stop cleanly after N seconds total (0 = no limit)")
    ap.add_argument("--stride", type=int, default=1,
                    help="take every Nth row, to spread a subsample across a file")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=None, help="results csv (default: results_<model>.csv)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new samples (0 = all)")
    ap.add_argument("--max-tokens", type=int, default=8192,
                    help="room for medium-effort thinking (~3-4k) plus the reproduced passage")
    ap.add_argument("--temperature", type=float, default=1.0,
                    help="1.0 matches the reference harness and the vendor thinking recipe")
    ap.add_argument("--timeout", type=int, default=3600, help="per-request read timeout, seconds")
    ap.add_argument("--dry-run", action="store_true", help="report cost and exit, no GPU needed")
    args = ap.parse_args()

    paths = [resolve_csv(p) for p in args.csv]
    if args.dry_run:
        total = sum(dry_run(load_rows(p), p, args.effort, args.stride) for p in paths)
        print(f"\nTOTAL ~{total / 60:.0f} min ({total / 3600:.2f} h) for {len(paths)} bucket(s)")
        return

    metric = _load_reference_metric()
    out_path = args.out or f"results_{args.model}.csv"
    already = done_rows(out_path)
    check_model(args.url, args.model)

    started = time.time()
    fresh = not os.path.exists(out_path)
    per_file, out_of_time = {}, False
    with open(out_path, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=OUT_FIELDS)
        if fresh:
            writer.writeheader()

        for path in paths:
            if out_of_time:
                break
            rows = load_rows(path)
            # bucket tag = whatever sits between the needle count and the '_dynamic' suffix,
            # i.e. 'in_(65536,131072)' or 'upto_128K'. Splitting on '_' and indexing would yield
            # the useless 'in'/'upto' half, since the tag itself contains an underscore.
            label = os.path.basename(path).split("needle_")[-1].split("_dynamic")[0]
            # File order is NOT arbitrary: consecutive rows share ~100% of their prompt prefix
            # (they differ only in the closing query line), so walking a file in order lets
            # llama-server reuse the cached KV and reduces every sample after the first in a
            # transcript to ~30 tokens of prefill. Shuffling here would re-prefill up to 131k
            # tokens per sample and blow any time budget. --stride subsamples without breaking
            # that, because every row in a file shares the same base transcript.
            todo = [i for i in range(0, len(rows), args.stride) if i not in already]
            if args.limit:
                todo = todo[:args.limit]
            key = f"{label}  n={len(rows)}"
            print(f"\n=== {path}\n    {len(rows)} rows, {len(todo)} to run "
                  f"(stride {args.stride}), effort={args.effort or 'server default (medium)'}")

            scores = []
            for n, i in enumerate(todo, 1):
                if args.time_budget and time.time() - started > args.time_budget:
                    print(f"    time budget of {args.time_budget:.0f}s reached, stopping cleanly")
                    out_of_time = True
                    break
                row = rows[i]
                start = time.time()
                text, usage, error = ask(args.url, args.model, row["queries"], args.max_tokens,
                                         args.temperature, args.timeout, args.effort)
                elapsed = time.time() - start
                # An errored request scores 0 the same way an empty response would, but the reason
                # is recorded so a run full of context-overflow refusals is not read as a bad model.
                score = metric(text, row["answer"])
                scores.append(score)
                writer.writerow({
                    "row": i, "model": args.model, "score": f"{score:.4f}",
                    "elapsed_s": f"{elapsed:.1f}",
                    "completion_tokens": usage.get("completion_tokens", ""),
                    "prompt_tokens": usage.get("prompt_tokens", ""),
                    "error": error,
                    **{k: row.get(k, "") for k in PASSTHROUGH},
                    "prediction": text,
                })
                fh.flush()  # survive a Ctrl-C with every completed sample already on disk
                print(f"    [{n}/{len(todo)}] row {i}  ctx {row['context_len']:>7}  "
                      f"score {score:.3f}  {elapsed:5.1f}s  mean "
                      f"{sum(scores) / len(scores):.4f}"
                      f"  {int(time.time() - started):4d}s elapsed"
                      f"{'  ' + error if error else ''}")
            if scores:
                per_file[key] = scores

    print(f"\n{'bucket':28s} {'n':>4s}  {'MRCR score':>10s}")
    for key, scores in per_file.items():
        print(f"{key:28s} {len(scores):4d}  {sum(scores) / len(scores):10.4f}")
    alls = [s for v in per_file.values() for s in v]
    if alls:
        print(f"{'TOTAL':28s} {len(alls):4d}  {sum(alls) / len(alls):10.4f}")
    print(f"\nwall clock {time.time() - started:.0f}s   full results: {out_path}")


if __name__ == "__main__":
    main()
