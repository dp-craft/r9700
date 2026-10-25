#!/usr/bin/env python3
"""monitor.py — live view of a running vLLM server (per-call metrics + GPU + log).

Read-only: polls the server's /metrics + rocm-smi + the log, shows a live table, and
records the session to JSONL (one row per poll) so a full session can be charted later
(see bench/lib/report.py). Zero-install (Python stdlib + rocm-smi). Reuses
vram_sampler.read_amd() for the GPU (iron rule 6).

Per-call metrics come from diffing vLLM's per-request histograms (request_prompt_tokens,
request_generation_tokens, request_time_to_first_token_seconds, request_decode_time_seconds,
request_prefill_time_seconds) between polls -> input/output tokens, prefill TPS, decode TPS,
TTFT for the requests that completed in the window. A rolling 1-min window gives the min.

Usage:
    python3 monitor.py [--port 8000] [--interval 2] [--log PATH] [--out JSONL] [--no-gpu] [--once]

  --once   single snapshot, then exit (for a quick check)
  --out    append one JSONL row per poll (the session record)
  --log    the engine log to tail (default bench/.servers/<port>.log)

It does NOT touch the server (no requests, no kill) — it only reads /metrics + rocm-smi + the log.
"""
import argparse
import json
import os
import sys
import time
import urllib.request


def fetch_metrics(url):
    """GET the /metrics endpoint; None on any error (server down, timeout)."""
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.read().decode()
    except Exception:
        return None


def parse_prom(text):
    """Parse Prometheus text format into {metric_name: float} (first value per name)."""
    d = {}
    if not text:
        return d
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.rsplit(" ", 1)
        if len(parts) != 2:
            continue
        name, val = parts
        try:
            d[name.split("{")[0]] = float(val)
        except ValueError:
            pass
    return d


def _diff(m, prev, name):
    """Counter delta between polls (m - prev), or None if either is missing."""
    if name in m and name in prev:
        return m[name] - prev[name]
    return None


def _avg_diff(m, prev, name):
    """Per-request average of a histogram: (sum delta) / (count delta), or None if no new requests."""
    s, c = _diff(m, prev, name + "_sum"), _diff(m, prev, name + "_count")
    if s is not None and c is not None and c > 0:
        return s / c
    return None


def gpu():
    """GPU metrics via vram_sampler.read_amd (rocm-smi) ->
    (used_mib, total_mib, gtt_mib, power_w, temp_c, sclk_mhz, mclk_mhz, busy_pct); None on error."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from vram_sampler import read_amd
        return read_amd()
    except Exception:
        return None


def tail_log(path, n=5):
    """Last n lines of the log (empty list if the file is missing)."""
    try:
        with open(path, "r", errors="replace") as f:
            return [l.rstrip("\n") for l in f.readlines()[-n:]]
    except Exception:
        return []


def _f(x, spec=""):
    """Format a value, or 'n/a' when it is None (None-safe display)."""
    return "n/a" if x is None else format(x, spec)


def _pct(x):
    """x * 100, or None if x is None (None-safe percentage)."""
    return None if x is None else x * 100


def _window_min(window, key):
    """Min of window[key] over the rolling window, or None if no samples have it."""
    vals = [p[key] for p in window if p.get(key) is not None]
    return min(vals) if vals else None


def main():
    ap = argparse.ArgumentParser(description="live vLLM monitor (read-only)")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--log", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-gpu", action="store_true")
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()

    url = f"http://127.0.0.1:{a.port}/metrics"
    if a.log is None:
        a.log = f"bench/.servers/{a.port}.log"

    prev, prev_t = None, None
    window = []  # rolling window of per-poll metric dicts (last 1 min)
    out = open(a.out, "w") if a.out else None

    while True:
        t = time.time()
        m = parse_prom(fetch_metrics(url))
        g = None if a.no_gpu else gpu()
        log_lines = tail_log(a.log)

        if not m:
            print(f"\n[monitor] {time.strftime('%H:%M:%S')} — server not reachable at {url}")
            if a.once:
                break
            time.sleep(a.interval)
            continue

        # per-call metrics: diff the per-request histograms since the last poll
        per = {}
        if prev is not None and prev_t is not None and t > prev_t:
            in_tok = _diff(m, prev, "vllm:request_prompt_tokens_sum")
            out_tok = _diff(m, prev, "vllm:request_generation_tokens_sum")
            ttft = _avg_diff(m, prev, "vllm:request_time_to_first_token_seconds")
            decode_t = _avg_diff(m, prev, "vllm:request_decode_time_seconds")
            prefill_t = _avg_diff(m, prev, "vllm:request_prefill_time_seconds")
            n_req = _diff(m, prev, "vllm:request_time_to_first_token_seconds_count") or 0
            per = {
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "n_requests": n_req,
                "ttft_s": ttft,
                "prefill_tps": (in_tok / prefill_t) if (in_tok and prefill_t) else None,
                "decode_tps": (out_tok / decode_t) if (out_tok and decode_t) else None,
            }

        # rolling window (last 60 s) -> min
        window.append(per)
        window = [p for p in window if p and t - prev_t <= 60 and p is not None]

        # current-state metrics (not per-request)
        kv = m.get("vllm:kv_cache_usage_perc")
        running = m.get("vllm:num_requests_running")
        waiting = m.get("vllm:num_requests_waiting")
        ph = m.get("vllm:prefix_cache_hits_total", 0)
        pq = m.get("vllm:prefix_cache_queries_total", 0)
        hit_rate = (ph / pq) if pq > 0 else None
        sa = m.get("vllm:spec_decode_num_accepted_tokens_total", 0)
        sd = m.get("vllm:spec_decode_num_draft_tokens_total", 0)
        spec_rate = (sa / sd) if sd > 0 else None

        # display (clear screen, redraw)
        print("\033[2J\033[H")
        print(f"vLLM monitor  port {a.port}   [{time.strftime('%H:%M:%S')}]   (Ctrl-C to quit)")
        print(f"  this window:   in {_f(per.get('input_tokens'), '.0f')} tok   out {_f(per.get('output_tokens'), '.0f')} tok   n={_f(per.get('n_requests'), '.0f')} req")
        print(f"                prefill {_f(per.get('prefill_tps'), '.1f')} tok/s   decode {_f(per.get('decode_tps'), '.1f')} tok/s   TTFT {_f(per.get('ttft_s'), '.2f')} s")
        print(f"  min (60 s):    prefill {_f(_window_min(window, 'prefill_tps'), '.1f')} tok/s   decode {_f(_window_min(window, 'decode_tps'), '.1f')} tok/s   TTFT {_f(_window_min(window, 'ttft_s'), '.2f')} s")
        print(f"  KV {_f(_pct(kv), '.1f')}%   prefix hit {_f(_pct(hit_rate), '.1f')}%   spec {_f(_pct(spec_rate), '.1f')}%   running {_f(running)}   waiting {_f(waiting)}")
        if g is not None:
            used, total, gtt, power, temp, sclk, mclk, busy = g
            print(f"  GPU  VRAM {_f(used)}/{_f(total)} MiB   GTT {_f(gtt)}   power {_f(power, '.0f')} W"
                  f"   temp {_f(temp, '.0f')} C   sclk {_f(sclk, '.0f')} MHz   busy {_f(busy, '.0f')}%")
        else:
            print("  GPU  (no rocm-smi)")
        if log_lines:
            print("  log:")
            for l in log_lines:
                print(f"    {l}")

        # record one row per poll (the session record)
        if out:
            row = {
                "ts": t,
                "input_tokens": per.get("input_tokens"),
                "output_tokens": per.get("output_tokens"),
                "n_requests": per.get("n_requests"),
                "ttft_s": per.get("ttft_s"),
                "prefill_tps": per.get("prefill_tps"),
                "decode_tps": per.get("decode_tps"),
                "kv_usage": kv,
                "running": running,
                "waiting": waiting,
                "prefix_hit_rate": hit_rate,
                "spec_acceptance": spec_rate,
            }
            if g is not None:
                row.update({"vram_used_mib": g[0], "vram_total_mib": g[1], "gtt_mib": g[2],
                            "power_w": g[3], "temp_c": g[4], "sclk_mhz": g[5], "busy_pct": g[7]})
            out.write(json.dumps(row) + "\n")
            out.flush()

        prev, prev_t = m, t
        if a.once:
            break
        time.sleep(a.interval)

    if out:
        out.close()


if __name__ == "__main__":
    main()
