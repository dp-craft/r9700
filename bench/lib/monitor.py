#!/usr/bin/env python3
"""monitor.py — live view of a running vLLM server (per-call metrics + GPU + log).

Read-only: polls the server's /metrics + rocm-smi + the log, shows a live table, and
records the session to JSONL (one row per poll) so a full session can be charted later
(see bench/lib/report.py). Zero-install (Python stdlib + rocm-smi). Reuses
vram_sampler.read_amd() for the GPU (iron rule 6). The log section is a compact table
of the recent loggers.py/metrics.py entries (not the raw lines).

Per-call metrics come from diffing vLLM's per-request histograms (prompt tokens,
generation tokens, TTFT, decode time, prefill time) between polls -> input/output
tokens, prefill TPS (COMPUTED tokens / prefill time — prefix-cached tokens are NOT
counted; request_prefill_kv_computed_tokens), decode TPS, and average TTFT for the
requests that completed in the poll. A rolling 5-min window (pruned by sample age)
gives the weighted average over the last 5 min (TPS weighted by TIME — Σ tokens / Σ
time, TTFT weighted by requests), so a short burst does not outweigh a long stretch.

Log-derived values (the authoritative per-interval TPS): the vLLM loggers.py line
"Average prompt throughput: X tok/s, average generation throughput: Y tok/s" and
the spec-decoding line ("Mean acceptance length: N, average draft acceptance rate: P%").

Usage:
    python3 monitor.py [--port 8000] [--interval 2] [--log PATH] [--out JSONL] [--no-gpu] [--once] [--history 15]
    (see --help for the same, with usage examples)

  --once     single snapshot, then exit (for a quick check)
  --out      append one JSONL row per poll (the session record)
  --log      the engine log to tail (default bench/.servers/<port>.log)
  --history  number of past request rows under the current poll (default 15; 0 hides it)

It does NOT touch the server (no requests, no kill) — it only reads /metrics + rocm-smi + the log.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from collections import deque


def fetch_metrics(url):
    """GET the /metrics endpoint; None on any error (server down, timeout)."""
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.read().decode()
    except Exception:
        return None


GAUGE_MAX = {"vllm:kv_cache_usage_perc"}  # per-engine fractions; take max, not sum


def parse_prom(text):
    """Parse Prometheus text format into {metric_name: float}. Counters/histograms SUM
    across label lines (multi-engine correct); gauges in GAUGE_MAX take max (a
    per-engine fraction like KV % cannot be summed). A single-label metric is
    unchanged (the sum of one value is the value)."""
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
            val = float(val)
        except ValueError:
            continue
        name = name.split("{")[0]
        if name in GAUGE_MAX:
            d[name] = max(d.get(name, val), val)
        else:
            d[name] = d.get(name, 0) + val
    return d


def _first(m, *names):
    """First present value among `names` in m; None if none."""
    for n in names:
        if n in m:
            return m[n]
    return None


def _diff(m, prev, name):
    """Counter delta between polls (m - prev), None if either is missing or the counter
    reset (m < prev — a server restart, since counters are monotonic). Returning None on
    a reset keeps the poll's diff clean instead of showing a negative token count."""
    if name in m and name in prev:
        d = m[name] - prev[name]
        if d < 0:
            return None  # counter reset (server restart) -> no data for this poll
        return d
    return None


def _avg_diff(m, prev, base):
    """Per-request average of a histogram: (sum delta) / (count delta), or None if no new requests."""
    s, c = _diff(m, prev, base + "_sum"), _diff(m, prev, base + "_count")
    if s is not None and c is not None and c > 0:
        return s / c
    return None


def _avg(m, base):
    """Cumulative per-request average of a histogram: sum / count, or None if no requests."""
    s, c = m.get(base + "_sum"), m.get(base + "_count")
    if s is not None and c is not None and c > 0:
        return s / c
    return None


def _ratio(a, b):
    """a / b when both are present and b > 0, else None."""
    if a is not None and b is not None and b > 0:
        return a / b
    return None


def _ttft_base(m):
    """TTFT histogram base name (old vLLM: request_time_to_first_token_seconds,
    new vLLM: time_to_first_token_seconds); None if neither exists."""
    for n in ("vllm:request_time_to_first_token_seconds", "vllm:time_to_first_token_seconds"):
        if n + "_sum" in m:
            return n
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


def log_throughput(log_lines):
    """The loggers.py line's Avg prompt/generation throughput (tokens/s) — the authoritative
    per-interval TPS (the histogram token/time ratios cover only a subset of requests).
    (None, None) when the line is absent."""
    for line in reversed(log_lines):
        p = re.search(r"Avg prompt throughput: ([\d.]+) tokens/s", line)
        g = re.search(r"Avg generation throughput: ([\d.]+) tokens/s", line)
        if p and g:
            return float(p.group(1)), float(g.group(1))
    return None, None


def log_spec(log_lines):
    """The metrics.py spec-decoding line: (mean acceptance length, Avg draft acceptance rate %).
    (None, None) when spec decode is off or the line is absent."""
    for line in reversed(log_lines):
        a = re.search(r"Mean acceptance length: ([\d.]+)", line)
        r = re.search(r"Avg Draft acceptance rate: ([\d.]+)%", line)
        if a and r:
            return float(a.group(1)), float(r.group(1))
    return None, None


LOG_INTERVAL_S = 10.0  # vLLM loggers.py default interval (10s between log lines)


def parse_log(log_lines):
    """Parse the log into structured rows (one per timestamp). Merges the loggers.py
    (throughput) and metrics.py (spec) lines that share a timestamp. Returns a list of
    dicts keyed by: time, prompt, gen, in, out, run, wait, kv, pref, acc, accR.
    in/out = prompt/gen throughput × log interval (tokens in that interval)."""
    rows = {}
    order = []
    for line in log_lines:
        ts = re.search(r"\d{2}-\d{2} (\d{2}:\d{2}:\d{2}) \[(?:loggers|metrics)\.py", line)
        if not ts:
            continue
        t = ts.group(1)
        if t not in rows:
            rows[t] = {"time": t}
            order.append(t)
        row = rows[t]
        if "loggers.py" in line:
            p = re.search(r"Avg prompt throughput: ([\d.]+) tokens/s", line)
            g = re.search(r"Avg generation throughput: ([\d.]+) tokens/s", line)
            r = re.search(r"Running: (\d+) reqs", line)
            w = re.search(r"Waiting: (\d+) reqs", line)
            kv = re.search(r"GPU KV cache usage: ([\d.]+)%", line)
            pref = re.search(r"Prefix cache hit rate: ([\d.]+)%", line)
            if p:
                row["prompt"] = float(p.group(1))
                row["in"] = float(p.group(1)) * LOG_INTERVAL_S
            if g:
                row["gen"] = float(g.group(1))
                row["out"] = float(g.group(1)) * LOG_INTERVAL_S
            if r: row["run"] = int(r.group(1))
            if w: row["wait"] = int(w.group(1))
            if kv: row["kv"] = float(kv.group(1))
            if pref: row["pref"] = float(pref.group(1))
        elif "metrics.py" in line:
            a = re.search(r"Mean acceptance length: ([\d.]+)", line)
            r = re.search(r"Avg Draft acceptance rate: ([\d.]+)%", line)
            if a: row["acc"] = float(a.group(1))
            if r: row["accR"] = float(r.group(1))
    return [rows[t] for t in order]


def log_table(log_lines):
    """Compact table of the recent log entries (header + value rows).
    Columns: time, prompt, gen, in, out, run, wait, KV, pref, acc, accR."""
    rows = parse_log(log_lines)
    keys = ["time", "prompt", "gen", "in", "out", "run", "wait", "kv", "pref", "acc", "accR"]
    cols = ["time", "prompt", "gen", "in", "out", "run", "wait", "KV", "pref", "acc", "accR"]
    widths = [8, 7, 6, 7, 6, 4, 4, 5, 5, 5, 5]
    specs = [None, ".1f", ".1f", ".0f", ".0f", ".0f", ".0f", ".1f", ".1f", ".2f", ".1f"]
    out = [" ".join(c.rjust(w) for c, w in zip(cols, widths))]
    for r in rows[-5:]:
        cells = []
        for k, w, spec in zip(keys, widths, specs):
            if k == "time":
                cells.append(r.get("time", "").rjust(w))
            else:
                cells.append(_fmt(r.get(k), w, spec))
        out.append(" ".join(cells))
    return out


def collect(m, prev, prev_t, g, log_lines):
    """One snapshot: per-call (diffed), session (cumulative), state, GPU, log. All None-safe."""
    t = time.time()
    per = {}
    if prev is not None and prev_t is not None and t > prev_t:
        in_tok = _diff(m, prev, "vllm:request_prompt_tokens_sum")
        out_tok = _diff(m, prev, "vllm:request_generation_tokens_sum")
        computed_tok = _diff(m, prev, "vllm:request_prefill_kv_computed_tokens_sum")
        if computed_tok is None:
            computed_tok = in_tok  # old vLLM: no per-request computed-token metric
        ttft_base = _ttft_base(m)
        ttft = _avg_diff(m, prev, ttft_base) if ttft_base else None
        n_req = _diff(m, prev, ttft_base + "_count") if ttft_base else None
        decode_t = _diff(m, prev, "vllm:request_decode_time_seconds_sum")
        prefill_t = _diff(m, prev, "vllm:request_prefill_time_seconds_sum")
        e2e = _avg_diff(m, prev, "vllm:e2e_request_latency_seconds")
        per = {
            "in_tok": in_tok,
            "out_tok": out_tok,
            "computed_tok": computed_tok,
            "n_req": n_req,
            "ttft_s": ttft,
            "e2e_s": e2e,
            "prefill_t": prefill_t,
            "decode_t": decode_t,
            "prefill_tps": _ratio(computed_tok, prefill_t),
            "decode_tps": _ratio(out_tok, decode_t),
        }

    # session (cumulative): all requests since the server started
    ttft_base = _ttft_base(m)
    session_in = m.get("vllm:request_prompt_tokens_sum")
    session_out = m.get("vllm:request_generation_tokens_sum")
    cached_tok = m.get("vllm:prompt_tokens_cached_total")
    comp_tok = (session_in - cached_tok) if (session_in is not None and cached_tok is not None) else None
    itl = _avg(m, "vllm:inter_token_latency_seconds")
    queue = _avg(m, "vllm:request_queue_time_seconds")
    session = {
        "in_tok": session_in,
        "out_tok": session_out,
        "cached_tok": cached_tok,
        "comp_tok": comp_tok,
        "n_req": m.get(ttft_base + "_count") if ttft_base else None,
        "ttft_s": _avg(m, ttft_base) if ttft_base else None,
        "prefill_tps": _ratio(comp_tok, m.get("vllm:request_prefill_time_seconds_sum")),
        "decode_tps": _ratio(session_out, m.get("vllm:request_decode_time_seconds_sum")),
        "e2e_s": _avg(m, "vllm:e2e_request_latency_seconds"),
        "itl_ms": (itl * 1000) if itl is not None else None,
        "queue_ms": (queue * 1000) if queue is not None else None,
        "start_ts": m.get("vllm:request_prompt_tokens_created"),
    }

    # current state (not per-request)
    kv = _first(m, "vllm:kv_cache_usage_perc")
    running = _first(m, "vllm:num_requests_running")
    waiting = _first(m, "vllm:num_requests_waiting")
    ph = _first(m, "vllm:prefix_cache_hits_total")
    pq = _first(m, "vllm:prefix_cache_queries_total")
    tc = _first(m, "vllm:prompt_tokens_cached_total")
    tp = _first(m, "vllm:prompt_tokens_total")
    sa = _first(m, "vllm:spec_decode_num_accepted_tokens_total")
    sd = _first(m, "vllm:spec_decode_num_draft_tokens_total")
    spec_rate = _ratio(sa, sd)
    log_pp, log_gen = log_throughput(log_lines)
    log_spec_len, log_spec_rate = log_spec(log_lines)
    state = {
        "kv": kv,
        "kv_pct": (kv * 100) if kv is not None else None,
        "prefix_block": _ratio(ph, pq),
        "prefix_tok": _ratio(tc, tp),
        "prefix_tok_n": tc,
        "prefix_tok_d": tp,
        "spec": spec_rate,
        "running": running,
        "waiting": waiting,
        "log_prompt_tps": log_pp,
        "log_gen_tps": log_gen,
        "log_spec_len": log_spec_len,
        "log_spec_rate": log_spec_rate,
    }

    return {"ts": t, "per": per, "session": session, "state": state, "gpu": g}


def _f(x, spec=""):
    """Format a value, or 'n/a' when it is None (None-safe display).

    n/a vs 0 is intentional: 'n/a' means *no data / can't compute* (first poll,
    counter reset, no requests so the rate/latency denominator is 0); 0 means
    *measured zero* (e.g. an idle poll where tokens diff to 0). Both are shown
    as-is — a 0 is a real reading, not a placeholder."""
    return "n/a" if x is None else format(x, spec)


def _fmt(x, w, spec=""):
    """Right-aligned column: _f() then padded to width w."""
    return _f(x, spec).rjust(w)


def _visible_len(s):
    """Length of s ignoring ANSI escape codes (used for box alignment with colored values)."""
    return len(re.sub(r"\033\[[0-9;]*m", "", s))


def _flag(x, threshold, spec=""):
    """Format x, highlighted red if it exceeds threshold (anomaly); 'n/a' if None."""
    if x is None:
        return "n/a"
    s = format(x, spec)
    if x > threshold:
        return "\033[31m" + s + "\033[0m"
    return s


def section(title, lines, width=None):
    """Render a block: ┌─ title ─┐ / │  line  │ / └─┘, 2-char padding, aligned to the
    longest line (or the given width). Alignment is by VISIBLE length (ANSI codes are
    invisible, so len() alone would under-pad colored lines)."""
    head = f" {title} "
    w = max([_visible_len(head)] + [_visible_len(l) for l in lines])
    if width is not None:
        w = max(w, width)
    print(f"┌  {head + '─' * (w + 2 - len(head))}┐")
    for l in lines:
        print(f"│  {l}{' ' * (w - _visible_len(l))}  │")
    print("└" + "─" * (w + 4) + "┘")


def log_stale(path, max_age=120.0):
    """True if the log file is missing or its mtime is older than max_age seconds
    (vLLM writes a loggers.py line every ~10s, so a fresh log is <120s old)."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return True
    return (time.time() - mtime) > max_age


def _window_avg(window, key, wkey):
    """Weighted average of per[key] over the window, weighted by per[wkey]
    (TPS by time, TTFT by requests — Σ v·w / Σ w, the exact aggregate over the
    window). None if no sample has both."""
    num = 0.0
    den = 0.0
    for _, p in window:
        v, w = p.get(key), p.get(wkey)
        if v is not None and w is not None and w > 0:
            num += v * w
            den += w
    return num / den if den > 0 else None


def _window_sum(window, key):
    """Sum of per[key] over the window (a TOTAL over the window, not a rate):
    Σ per[key] over all samples. None if no sample has the value (all None) —
    so an idle window shows 'n/a' rather than a misleading 0."""
    total = 0.0
    found = False
    for _, p in window:
        v = p.get(key)
        if v is not None:
            total += v
            found = True
    return total if found else None


def _trend(cur, prev):
    """Trend arrow: ▲ rising, ▼ falling, – flat/none. None-safe (no arrow if either
    value is missing)."""
    if cur is None or prev is None:
        return ""
    if cur > prev:
        return "▲"
    if cur < prev:
        return "▼"
    return "–"


def render(a, snap, window, history, log_lines, log_stale, cur_avg, prev_avg):
    per, session = snap["per"], snap["session"]
    state, g = snap["state"], snap["gpu"]

    # Build all box contents first, then size every box to the widest (the history table).
    # When the server is idle (KV 0 %, nothing running/waiting) collapse the cache/queue/spec
    # block to a single line — no point re-printing it every poll while idle.
    idle = state.get("kv") is not None and state.get("kv") == 0 \
        and (state.get("running") or 0) == 0 \
        and (state.get("waiting") or 0) == 0
    if idle:
        cache_lines = [f"idle   KV {_f(state.get('kv_pct'), '.1f')}%   running {_f(state.get('running'), '.0f')}   waiting {_f(state.get('waiting'), '.0f')}"]
    else:
        cache_lines = [
            f"KV        {_flag(state.get('kv_pct'), 90, '.1f')}%",
            f"prefix    {_f(state.get('prefix_tok') * 100 if state.get('prefix_tok') is not None else None, '.1f')} tok "
            f"({_f(state.get('prefix_tok_n'), '.0f')}/{_f(state.get('prefix_tok_d'), '.0f')})   block {_f(state.get('prefix_block') * 100 if state.get('prefix_block') is not None else None, '.1f')}%",
            f"spec      {_f(state.get('spec') * 100 if state.get('spec') is not None else None, '.1f')}% accepted "
            f"(log: len {_f(state.get('log_spec_len'), '.2f')}   rate {_f(state.get('log_spec_rate'), '.1f')}%)",
            f"queue     running {_f(state.get('running'), '.0f')}   waiting {_f(state.get('waiting'), '.0f')}",
        ]
    # polls table: current poll row first, then one row per past poll that moved
    # a request (recorded in main() — idle polls do not fill the table).
    blocks = [
        ("polls (requests)", _history_rows([snap] + (list(history) if history is not None else []))),
        ("avg (last 5 min)", [
            f"TTFT {_f(cur_avg['ttft'], '.2f')} s {_trend(cur_avg['ttft'], prev_avg['ttft'])}   "
            f"prefill {_f(cur_avg['prefill'], '.0f')} tok/s {_trend(cur_avg['prefill'], prev_avg['prefill'])}   "
            f"decode {_f(cur_avg['decode'], '.1f')} tok/s {_trend(cur_avg['decode'], prev_avg['decode'])}   "
            f"req {_f(cur_avg['n_req'], '.0f')}   comp {_f(cur_avg['comp'], '.0f')} tok   out {_f(cur_avg['out'], '.0f')} tok",
        ]),
        ("session" + (f" (since {time.strftime('%H:%M:%S', time.localtime(session.get('start_ts')))})"
                     if session.get("start_ts") else ""),
         _session_rows(session)),
        ("cache / queue / spec", cache_lines),
    ]
    if g is not None:
        used, total, gtt, power, temp, sclk, mclk, busy = g
        blocks.append(("GPU  (rocm-smi)", [
            f"VRAM  {_f(used)}/{_f(total)} MiB   GTT {_f(gtt)} MiB",
            f"power {_flag(power, 200, '.0f')} W   temp {_f(temp, '.0f')} C   busy {_f(busy, '.0f')}%",
            f"sclk  {_f(sclk, '.0f')} MHz   mclk {_f(mclk, '.0f')} MHz",
        ]))
    else:
        blocks.append(("GPU  (rocm-smi)", ["(no rocm-smi)"]))
    if log_lines:
        if log_stale:
            blocks.append(("log", ["(log stale — not the current server)"]))
        else:
            blocks.append(("log  (last 5 entries)", log_table(log_lines)))

    # Every box shares one width — the widest content line (the history table) — plus the
    # section's uniform 2-char padding, so all boxes line up edge-to-edge.
    width = max((_visible_len(l) for _, lines in blocks for l in lines), default=0)

    print("\033[2J\033[H")
    print(f"vLLM monitor — port {a.port}   [{time.strftime('%H:%M:%S', time.localtime(snap['ts']))}]   (Ctrl-C to quit)")
    print()
    for title, lines in blocks:
        section(title, lines, width)
        print()


def _session_rows(session):
    """Columnar session table: header + one value row. Units live in the headers
    (TTFT(s) / gap(ms) / full(s) ...) so the values stay bare numbers.
    Columns: req | in (total prompt tokens) | cached (read from the prefix cache) |
    comp (prompt tokens actually computed/prefilled) | out (generated) | TTFT |
    prefill/decode TPS | gap (inter-token latency) | queue | full (full round-trip)."""
    cols = [("req", 6), ("in", 10), ("cached", 10), ("comp", 10), ("out", 8),
            ("TTFT(s)", 8), ("prefill(t/s)", 12), ("decode(t/s)", 12),
            ("gap(ms)", 8), ("queue(ms)", 8), ("full(s)", 9)]
    vals = [(session.get("n_req"), ".0f"), (session.get("in_tok"), ".0f"),
            (session.get("cached_tok"), ".0f"), (session.get("comp_tok"), ".0f"),
            (session.get("out_tok"), ".0f"), (session.get("ttft_s"), ".2f"),
            (session.get("prefill_tps"), ".0f"), (session.get("decode_tps"), ".1f"),
            (session.get("itl_ms"), ".1f"), (session.get("queue_ms"), ".3f"),
            (session.get("e2e_s"), ".2f")]
    return [
        " ".join(c.rjust(w) for c, w in cols),
        " ".join(_fmt(v, w, spec) for (v, spec), (_, w) in zip(vals, cols)),
    ]


def _history_rows(history):
    """Fixed-width table of poll rows (one per poll: the batch of requests that
    completed in that window). render() passes [current poll] + past request rows,
    so this is the whole "polls (requests)" block. The widest block — the other
    boxes align to this width (2-char padding is applied by section(), so it is NOT
    added here).
    Columns: in_tok (total prompt tokens) | comp (non-cached prompt tokens, what
    was actually prefilled) | out_tok (generated) | ttft (first token) | prefill/decode
    TPS | full (full round-trip time) | KV% | busy%."""
    rows = [
        f"{'time':>8} {'n':>4} {'in_tok':>8} {'comp':>8} {'out_tok':>8} {'ttft':>7} {'prefill':>8} {'decode':>8} {'full':>7} {'KV%':>5} {'busy%':>5}",
    ]
    for h in history:
        per, state, g = h["per"], h["state"], h["gpu"]
        rows.append(
            f"{time.strftime('%H:%M:%S', time.localtime(h['ts'])):>8} "
            f"{_fmt(per.get('n_req'), 4, '.0f')} "
            f"{_fmt(per.get('in_tok'), 8, '.0f')} "
            f"{_fmt(per.get('computed_tok'), 8, '.0f')} "
            f"{_fmt(per.get('out_tok'), 8, '.0f')} "
            f"{_fmt(per.get('ttft_s'), 7, '.2f')} "
            f"{_fmt(per.get('prefill_tps'), 8, '.0f')} "
            f"{_fmt(per.get('decode_tps'), 8, '.1f')} "
            f"{_fmt(per.get('e2e_s'), 7, '.2f')} "
            f"{_fmt(state.get('kv_pct'), 5, '.1f')} "
            f"{_fmt(g[7] if g else None, 5, '.0f')}")
    return rows


def _row(snap):
    """One JSONL session row (chartable later via bench/lib/report.py)."""
    per, session, state, g = snap["per"], snap["session"], snap["state"], snap["gpu"]
    row = {
        "ts": snap["ts"],
        "input_tokens": per.get("in_tok"),
        "output_tokens": per.get("out_tok"),
        "computed_tokens": per.get("computed_tok"),
        "n_requests": per.get("n_req"),
        "ttft_s": per.get("ttft_s"),
        "prefill_tps": per.get("prefill_tps"),
        "decode_tps": per.get("decode_tps"),
        "kv_usage": state.get("kv"),
        "running": state.get("running"),
        "waiting": state.get("waiting"),
        "prefix_hit_rate": state.get("prefix_block"),
        "prefix_token_hit": state.get("prefix_tok"),
        "spec_acceptance": state.get("spec"),
        "log_prompt_tps": state.get("log_prompt_tps"),
        "log_gen_tps": state.get("log_gen_tps"),
        "log_spec_len": state.get("log_spec_len"),
        "log_spec_rate": state.get("log_spec_rate"),
        "e2e_s": session.get("e2e_s"),
        "itl_ms": session.get("itl_ms"),
        "queue_ms": session.get("queue_ms"),
    }
    if g is not None:
        row.update({"vram_used_mib": g[0], "vram_total_mib": g[1], "gtt_mib": g[2],
                    "power_w": g[3], "temp_c": g[4], "sclk_mhz": g[5], "busy_pct": g[7]})
    return row


def main():
    ap = argparse.ArgumentParser(
        description="live vLLM server monitor — read-only: polls /metrics + rocm-smi + the log, never touches the server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="examples:\n"
               "  monitor.py --port 8000                       live table, polls every 2 s (Ctrl-C to quit)\n"
               "  monitor.py --port 8000 --once                single snapshot, then exit\n"
               "  monitor.py --port 8000 --out session.jsonl   live + record one JSONL row per poll (chart via bench/lib/report.py)\n"
               "  bench/engine-bench/claude/monitor.sh         same, with PORT/paths from _lib.sh\n\n"
               "blocks:\n"
               "  polls (requests)  current poll + one row per past poll that moved a request (in/comp/out tokens, TTFT, prefill/decode TPS, full, KV %, busy %)\n"
               "  avg (last 5 min)  weighted-average TTFT/prefill/decode (TPS by time, TTFT by requests; trend arrows) + window req/comp/out totals\n"
               "  session           cumulative since server start (req, in/cached/comp/out, TTFT, prefill/decode TPS, gap = inter-token latency, queue, full)\n"
               "  cache/queue/spec  KV %, prefix-cache hit, spec acceptance, running/waiting\n"
               "  GPU               VRAM/GTT/power/temp/clocks/busy (rocm-smi)\n"
               "  log               tail of the loggers.py/metrics.py lines (stale mtime > 120 s -> flagged)")
    ap.add_argument("--port", type=int, default=8000, help="server port (default 8000)")
    ap.add_argument("--interval", type=float, default=2.0, help="poll interval in seconds (default 2.0)")
    ap.add_argument("--log", default=None, help="engine log to tail (default bench/.servers/<port>.log)")
    ap.add_argument("--out", default=None,
                    help="append one JSONL row per poll — the session record, chartable via bench/lib/report.py")
    ap.add_argument("--no-gpu", action="store_true", help="skip rocm-smi (no GPU block)")
    ap.add_argument("--once", action="store_true", help="single snapshot, then exit")
    ap.add_argument("--history", type=int, default=15,
                    help="number of past request rows under the current poll (default 15; 0 hides it)")
    a = ap.parse_args()

    url = f"http://127.0.0.1:{a.port}/metrics"
    if a.log is None:
        a.log = f"bench/.servers/{a.port}.log"

    prev, prev_t = None, None
    window = []  # rolling (ts, per) list, pruned to the last 5 min
    history = deque(maxlen=a.history) if a.history > 0 else None
    prev_avg = {"ttft": None, "prefill": None, "decode": None, "n_req": None, "comp": None, "out": None}
    out = open(a.out, "a") if a.out else None

    try:
        while True:
            t = time.time()
            m = parse_prom(fetch_metrics(url))
            g = None if a.no_gpu else gpu()
            log_lines = tail_log(a.log, 12)

            if not m:
                print(f"\n[monitor] {time.strftime('%H:%M:%S')} — server not reachable at {url}")
                if a.once:
                    break
                time.sleep(a.interval)
                continue

            snap = collect(m, prev, prev_t, g, log_lines)

            # rolling window (last 5 min) -> weighted average; pruned by each sample's age
            if snap["per"]:
                window.append((snap["ts"], snap["per"]))
            window = [(ts, p) for ts, p in window if snap["ts"] - ts <= 300]
            # history: a row only when a request moved (tokens in/out or n_req > 0).
            # vLLM updates the TTFT count at first-token and the token histograms at request-end,
            # so those land in ADJACENT polls — a row must be added when tokens move too, not
            # only when n_req>0, or the request's result row (in/out/speed) is never recorded.
            if history is not None:
                per = snap["per"]
                active = (per.get("n_req") or 0) > 0 \
                    or (per.get("in_tok") or 0) > 0 \
                    or (per.get("out_tok") or 0) > 0
                if active:
                    history.append(snap)

            # 5-min weighted averages (TPS by time, TTFT by requests) + trend vs previous poll
            cur_avg = {
                "ttft": _window_avg(window, "ttft_s", "n_req"),
                "prefill": _window_avg(window, "prefill_tps", "prefill_t"),
                "decode": _window_avg(window, "decode_tps", "decode_t"),
                "n_req": _window_sum(window, "n_req"),
                "comp": _window_sum(window, "computed_tok"),
                "out": _window_sum(window, "out_tok"),
            }
            render(a, snap, window, history, log_lines, log_stale(a.log), cur_avg, prev_avg)
            prev_avg = cur_avg

            # record one row per poll (the session record)
            if out:
                out.write(json.dumps(_row(snap)) + "\n")
                out.flush()

            prev, prev_t = m, snap["ts"]
            if a.once:
                break
            time.sleep(a.interval)
    finally:
        if out:
            out.close()


if __name__ == "__main__":
    main()
