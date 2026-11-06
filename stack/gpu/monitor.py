#!/usr/bin/env python3
"""monitor.py — live view of a running vLLM server (per-call metrics + GPU + log).

Read-only: polls the server's /metrics + rocm-smi + the log (on radiance also `docker logs`), shows a live table, and
optionally records the session to JSONL (one row per poll, with --out). Zero-install
(Python stdlib + rocm-smi).
Reuses vram_sampler.read_amd() for the GPU (iron rule 7 — measure, don't calculate). The
log section is a compact table of the recent loggers.py/metrics.py entries (not the raw lines).

Per-poll metrics come from diffing the engine's counters between polls. A request's counters tick
at different moments (computed tokens during prefill, TTFT at first token, the rest at the end),
so _fold_request folds the early deltas into the poll where the request finishes: one row per
finished poll. Prefill TPS = COMPUTED tokens / prefill time; prefix-cached tokens are not counted.

radiance rows do not use those deltas: its computed tokens tick when a prefill chunk is issued (~2 ms)
and the time when the chunk commits, and requests share polls, so a poll delta can show 4096 tokens in
4 ms (~1M t/s). Its rows come from the "I req ... done" line of `docker logs <container>` instead
(--container, default radiance-<port>): one exact row per request, comp = prompt - cache, prefill =
comp / TTFT. TTFT holds no decode time on radiance, as each request's first token comes from its last
prefill step. Requests waiting behind another one read low, as TTFT includes the wait. If `docker logs`
fails the rows fall back to per-poll deltas with comp/prefill shown n/a, and the block title says so.
The same read fills the log block with radiance's last lines; --log is not read there, as radiance
writes neither that file nor the vLLM lines this tool parses from it.
The server line and the 5-min average stay on the counters: tokens and time add up over a longer window.

The vLLM metric names are also exposed by radiance (a native engine), which lacks some of them:
_computed_tok, _prefill_seconds and _cached_tok resolve each value per engine. A rolling 5-min
window gives the weighted average (TPS weighted by TIME — Σ tokens / Σ time, TTFT weighted by
requests), so a short burst does not outweigh a long stretch.

Log-derived values (the authoritative per-interval TPS): the vLLM loggers.py line
"Average prompt throughput: X tok/s, average generation throughput: Y tok/s" and
the spec-decoding line ("Mean acceptance length: N, average draft acceptance rate: P%").

Usage:
    python3 monitor.py [--port 8000] [--interval 2] [--log PATH] [--container NAME] [--out JSONL] [--no-gpu] [--once] [--history 15]
    (see --help for the same, with usage examples)

  --once     single snapshot, then exit (for a quick check)
  --out      append one JSONL row per poll (the session record)
  --log      the engine log to tail (default stack/serve/var/servers/<port>.log; not read on radiance)
  --container  the radiance container whose log gives the request rows (default radiance-<port>; needs docker access)
  --history  number of past request rows under the current poll (default 15; 0 hides the past rows — the current poll row always shows)

It does NOT touch the server (no requests, no kill) — it only reads /metrics + rocm-smi + the logs.
"""
import argparse
import calendar
import json
import os
import re
import subprocess
import time
import urllib.request
from collections import deque

from vram_sampler import read_amd


def fetch_metrics(url):
    """GET the /metrics endpoint; None on any error (server down, timeout)."""
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.read().decode()
    except Exception:
        return None


GAUGE_MAX = {"vllm:kv_cache_usage_perc", "vllm:gpu_prefix_cache_hit_rate"}  # per-engine fractions; take max, not sum


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


def _is_radiance(m):
    """True for the radiance engine, whose rows come from its request log."""
    return "radiance:prefill_tokens_total" in m


def _first(m, *names):
    """First present value among `names` in m; None if none."""
    for n in names:
        if n in m:
            return m[n]
    return None


def _computed_tok(m):
    """Cumulative prompt tokens that actually went through compute (uncached); None if not reported."""
    return _first(m, "vllm:request_prefill_kv_computed_tokens_sum", "radiance:prefill_tokens_total")


def _prefill_seconds(m):
    """Cumulative seconds spent prefilling. radiance has no prefill histogram, so it is its non-decode
    scheduler step time; None if the engine reports neither."""
    seconds = m.get("vllm:request_prefill_time_seconds_sum")
    if seconds is not None:
        return seconds
    total, decode = m.get("radiance:engine_step_seconds_total"), m.get("radiance:engine_step_seconds_decode_total")
    return total - decode if total is not None and decode is not None else None


def _cached_tok(m):
    """Cumulative prompt tokens served from the prefix cache; None if not reported."""
    return _first(m, "vllm:prompt_tokens_cached_total", "radiance:linear_cached_tokens_total")


def _delta(cur, prev):
    """Counter delta, None if either is missing or the counter reset (cur < prev — a server restart)."""
    if cur is None or prev is None or cur < prev:
        return None
    return cur - prev


def _diff(m, prev, name):
    """Delta of a named counter between polls (see _delta)."""
    return _delta(m.get(name), prev.get(name))


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
    (used_mib, total_mib, gtt_mib, power_w, temp_c, mem_temp_c, sclk_mhz, mclk_mhz, busy_pct, fan_pct); None on error."""
    try:
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


def _last_log_values(log_lines, *keys):
    """The newest parse_log row carrying all keys, as a tuple of values; all None when absent."""
    for row in reversed(parse_log(log_lines)):
        if all(k in row for k in keys):
            return tuple(row[k] for k in keys)
    return (None,) * len(keys)


def log_throughput(log_lines):
    """The loggers.py line's Avg prompt/generation throughput (tokens/s)."""
    return _last_log_values(log_lines, "prompt", "gen")


def log_spec(log_lines):
    """The metrics.py spec-decoding line: (mean acceptance length, Avg draft acceptance rate %)."""
    return _last_log_values(log_lines, "acc", "accR")


REQUEST_LOG_TAIL = 200  # container log lines read per poll; far more than one poll of requests writes
LOG_TAIL_WIDTH = 110  # log block line width, about the widest other block's
REQUEST_DONE = re.compile(r"^(\S+) I req (\S+) done .*?\bprompt=(\d+) \(cache (\d+)\) gen=(\d+) "
                          r".*?\bttft=([\d.]+)s ([\d.]+) tok/s ([\d.]+)s")


def fetch_request_log(container):
    """Recent timestamped lines of the container's log (stdout + stderr); None if `docker logs` fails."""
    try:
        r = subprocess.run(["docker", "logs", "--timestamps", "--tail", str(REQUEST_LOG_TAIL), container],
                           capture_output=True, text=True, errors="replace", timeout=3)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout + r.stderr if r.returncode == 0 else None


def _log_stamp(stamp):
    """Epoch seconds of a `docker logs --timestamps` stamp (UTC, sub-second part dropped)."""
    return calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))


def container_log_tail(text, n=5):
    """The container log's last n non-empty lines, oldest first, as local 'HH:MM:SS text' cut to fit the box.
    The client address and model name go first, as every request line repeats them."""
    lines = sorted((l.split(" ", 1) for l in text.splitlines() if " " in l and l.split(" ", 1)[1].strip()),
                   key=lambda l: l[0][:19])
    return [f"{time.strftime('%H:%M:%S', time.localtime(_log_stamp(stamp)))} "
            f"{re.sub(r' from [^ ]+| model=[^ ]+', '', line)}"[:LOG_TAIL_WIDTH]
            for stamp, line in lines[-n:]]


def parse_requests(text):
    """Finished requests in a radiance log, oldest first: (request id, finish time, row)."""
    found = []
    for line in text.splitlines():
        r = REQUEST_DONE.match(line)
        if not r:
            continue
        in_tok, cached, out_tok = int(r[3]), int(r[4]), int(r[5])
        ttft = float(r[6])
        computed = in_tok - cached
        found.append((r[2], _log_stamp(r[1]), {
            "in_tok": in_tok,
            "cached_tok": cached,
            "computed_tok": computed,
            "out_tok": out_tok,
            "n_req": 1,
            "ttft_s": ttft,
            "e2e_s": float(r[8]),
            "prefill_tps": _ratio(computed or None, ttft),  # nothing computed -> no rate
            "decode_tps": float(r[7]),
        }))
    return sorted(found, key=lambda f: f[1])


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
        # legacy engine without any computed counter: the full prompt is the only count there is
        computed_tok = _delta(_computed_tok(m), _computed_tok(prev)) if _computed_tok(m) is not None else in_tok
        ttft_base = _ttft_base(m)
        ttft = _avg_diff(m, prev, ttft_base) if ttft_base else None
        n_req = _diff(m, prev, ttft_base + "_count") if ttft_base else None
        decode_t = _diff(m, prev, "vllm:request_decode_time_seconds_sum")
        prefill_t = _delta(_prefill_seconds(m), _prefill_seconds(prev))
        prefill_tps = _ratio(computed_tok, prefill_t)
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
            "prefill_tps": prefill_tps,
            "decode_tps": _ratio(out_tok, decode_t),
        }

    # session (cumulative): all requests since the server started
    ttft_base = _ttft_base(m)
    session_in = m.get("vllm:request_prompt_tokens_sum")
    session_out = m.get("vllm:request_generation_tokens_sum")
    prompt_total = m.get("vllm:prompt_tokens_total")
    cached_tok = _cached_tok(m)
    comp_tok = _computed_tok(m)
    if comp_tok is None and cached_tok is not None and prompt_total is not None:
        comp_tok = prompt_total - cached_tok  # legacy engine; both tick at first token, so they stay consistent
    itl = _avg(m, "vllm:inter_token_latency_seconds")
    queue = _avg(m, "vllm:request_queue_time_seconds")
    session = {
        "in_tok": session_in,
        "out_tok": session_out,
        "cached_tok": cached_tok,
        "comp_tok": comp_tok,
        "n_req": m.get(ttft_base + "_count") if ttft_base else None,
        "ttft_s": _avg(m, ttft_base) if ttft_base else None,
        "prefill_tps": _ratio(comp_tok, _prefill_seconds(m)),
        "decode_tps": _ratio(session_out, m.get("vllm:request_decode_time_seconds_sum")),
        "e2e_s": _avg(m, "vllm:e2e_request_latency_seconds"),
        "itl_ms": (itl * 1000) if itl is not None else None,
        "queue_ms": (queue * 1000) if queue is not None else None,
        "start_ts": m.get("vllm:request_prompt_tokens_created"),
    }

    # current state (not per-request)
    kv = m.get("vllm:kv_cache_usage_perc")
    running = m.get("vllm:num_requests_running")
    waiting = m.get("vllm:num_requests_waiting")
    ph = m.get("vllm:prefix_cache_hits_total")
    pq = m.get("vllm:prefix_cache_queries_total")
    sa = _first(m, "vllm:spec_decode_num_accepted_tokens_total", "radiance:draft_accepted_total")
    sd = _first(m, "vllm:spec_decode_num_draft_tokens_total", "radiance:draft_tokens_total")
    spec_rate = _ratio(sa, sd)
    log_pp, log_gen = log_throughput(log_lines)
    log_spec_len, log_spec_rate = log_spec(log_lines)
    block_hit = _ratio(ph, pq)
    if block_hit is None:
        block_hit = m.get("vllm:gpu_prefix_cache_hit_rate")  # radiance has the rate, not the hit/query counters
    state = {
        "kv": kv,
        "kv_pct": (kv * 100) if kv is not None else None,
        "prefix_block": block_hit,
        "prefix_tok": _ratio(cached_tok, prompt_total),
        "prefix_tok_n": cached_tok,
        "prefix_tok_d": prompt_total,
        "prefix_recomputed": m.get("radiance:prefix_hit_cut_tokens_total"),
        "spec": spec_rate,
        "spec_accepted": sa,
        "spec_draft": sd,
        "gen_counter": _first(m, "radiance:decode_tokens_total", "vllm:inter_token_latency_seconds_count"),
        "running": running,
        "waiting": waiting,
        "log_prompt_tps": log_pp,
        "log_gen_tps": log_gen,
        "log_spec_len": log_spec_len,
        "log_spec_rate": log_spec_rate,
        "flight_elapsed": None,
        "flight_gen": None,
    }

    return {"ts": t, "per": per, "session": session, "state": state, "gpu": g, "radiance": _is_radiance(m)}


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


def _with_unit(x, spec, unit):
    """Format a value with its unit; a bare 'n/a' (no unit) when None."""
    return "n/a" if x is None else format(x, spec) + unit


def _visible_len(s):
    """Length of s ignoring ANSI escape codes (used for box alignment with colored values)."""
    return len(re.sub(r"\033\[[0-9;]*m", "", s))


def _pad(s, w):
    """Right-align s to visible width w (ANSI codes are invisible)."""
    return " " * max(0, w - _visible_len(s)) + s


_COLORS = {"g": "\033[32m", "y": "\033[33m", "r": "\033[31m"}  # green/yellow/red
_RESET = "\033[0m"


def _color_level(value, low, high, invert=False):
    """Color level ('g'/'y'/'r') for a value against (low, high) thresholds.
    invert=True: higher is better (TPS) — green above high, red below low.
    invert=False: higher is worse (temp/power) — green below low, red above high."""
    if value is None:
        return None
    if invert:
        return "g" if value >= high else ("r" if value <= low else "y")
    return "g" if value < low else ("r" if value > high else "y")


def _color(value, spec, low, high, invert=False):
    """Format a value (spec) and color it green/yellow/red by thresholds; 'n/a' if None."""
    if value is None:
        return "n/a"
    lvl = _color_level(value, low, high, invert)
    return _COLORS[lvl] + format(value, spec) + _RESET


def _bar(value, max_value, width=16, color=None):
    """A bar of width chars, filled to value/max_value, optionally colored by level.
    'n/a' if value is None (no data). The bar is a VISIBLE-width string (ANSI-aware
    alignment is handled by _visible_len)."""
    if value is None or max_value is None or max_value <= 0:
        return "n/a"
    frac = max(0.0, min(1.0, value / max_value))
    filled = int(round(frac * width))
    bar = "█" * filled + "░" * (width - filled)
    return _COLORS[color] + bar + _RESET if color else bar


def _human(n):
    """Human-friendly number: 1.2M, 93.7k, 500, etc.; 'n/a' if None."""
    if n is None:
        return "n/a"
    if abs(n) >= 1e6:
        return f"{n/1e6:.1f}M"
    if abs(n) >= 1e3:
        return f"{n/1e3:.1f}k"
    return f"{n:.0f}"


def _fmt_uptime(seconds):
    """Format a duration as '2h 14m', '14m 30s', '30s'; 'n/a' if None."""
    if seconds is None:
        return "n/a"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def _fmt_color(value, width, spec, low, high, invert=False):
    """Color a value (spec) and right-align it to width (visible-length aware)."""
    return _pad(_color(value, spec, low, high, invert), width)


def _metric_line(label, value, spec, max_v, low, high, unit):
    """A GPU metric line: label + colored value + bar (same color level)."""
    lvl = _color_level(value, low, high)
    shown = "n/a" if value is None else _color(value, spec, low, high) + unit
    return f"{label:<6} {_pad(shown, 5)}   {_bar(value, max_v, color=lvl)}"


def _percent(value, spec):
    """A value colored by the usual 50/80 thresholds with a % sign; a bare 'n/a' when None."""
    return "n/a" if value is None else _color(value, spec, 50, 80) + "%"


def _live_row(snap):
    """The live row: elapsed time since the server last went busy, progress tokens, GPU %, wattage, KV %.
    Visually distinct (▶ prefix, bright color) from the past poll rows below it."""
    state = snap["state"]
    g = snap["gpu"]
    busy = g[8] if g else None
    power = g[3] if g else None
    kv = state.get("kv_pct")
    parts = ["\033[1m▶ live\033[0m",
             f"elapsed {_with_unit(state.get('flight_elapsed'), '.0f', 's')}",
             f"gen {_with_unit(state.get('flight_gen'), '.0f', ' tok')}",
             f"GPU {_percent(busy, '.0f')}",
             f"power {_with_unit(power, '.0f', 'W')}",
             f"KV {_percent(kv, '.1f')}"]
    return " ".join(parts)


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


def _fold_request(pending, per):
    """Fold this poll's deltas into the request in progress: (row, pending). One request's counters tick in
    different polls, so the early deltas wait in `pending` until the poll where it finishes (in_tok moves);
    that poll returns the merged row. Attribution is per poll: requests running concurrently, or one starting
    in the poll where another finishes, can exchange computed tokens."""
    pair = [(None, pending), (None, per)]
    merged = dict(per,
                  n_req=_window_sum(pair, "n_req"),
                  ttft_s=_window_avg(pair, "ttft_s", "n_req"),
                  computed_tok=_window_sum(pair, "computed_tok"),
                  prefill_t=_window_sum(pair, "prefill_t"))
    merged["prefill_tps"] = _ratio(merged["computed_tok"] or None, merged["prefill_t"])  # nothing computed -> no rate
    return (merged, {}) if per.get("in_tok") else (None, merged)


def _finished_rows(snap, pending, seen, container):
    """This poll's finished-request rows: (rows, pending, seen). `seen` holds the request ids in the last
    log read; None until the first read, whose requests predate this session and give no rows. On radiance
    the rows come from the request log and snap gets "requests"; if that log cannot be read the poll deltas
    still give the row, without comp/prefill, which only the log has right (see the module docstring).
    The read also gives snap "log_tail", the log block's lines."""
    if snap["radiance"]:
        text = fetch_request_log(container)
        if text is not None:
            snap["log_tail"] = container_log_tail(text)
            requests = parse_requests(text)
            new = [] if seen is None else [r for r in requests if r[0] not in seen]
            snap["requests"] = [per for _, _, per in new]
            return [dict(snap, ts=ts, per=per) for _, ts, per in new], {}, {r[0] for r in requests}
        snap["request_log_failed"] = True
    row, pending = _fold_request(pending, snap["per"])
    if row is None:
        return [], pending, seen
    if snap["radiance"]:
        row = dict(row, computed_tok=None, prefill_tps=None)
    return [dict(snap, per=row)], pending, seen


def _is_server_idle(state):
    """True when nothing is running or waiting. KV stays above 0 while the prefix cache is retained."""
    return state.get("running") == 0 and state.get("waiting") == 0


def _avg_snapshot(window):
    """The window's weighted averages (TPS by time, TTFT by requests) and totals."""
    return {
        "ttft": _window_avg(window, "ttft_s", "n_req"),
        "prefill": _window_avg(window, "prefill_tps", "prefill_t"),
        "decode": _window_avg(window, "decode_tps", "decode_t"),
        "n_req": _window_sum(window, "n_req"),
        "comp": _window_sum(window, "computed_tok"),
        "out": _window_sum(window, "out_tok"),
    }


def _trend(cur, prev):
    """Trend arrow: ▲ rising, ▼ falling, – flat; a space when either value is missing, so the line keeps its width."""
    if cur is None or prev is None:
        return " "
    if cur > prev:
        return "▲"
    if cur < prev:
        return "▼"
    return "–"


def _avg_line(cur, prev):
    """The avg block's single line, fixed-width so values do not move between polls."""
    def rate(key, spec, unit, width):
        return f"{_pad(_with_unit(cur[key], spec, unit), width)} {_trend(cur[key], prev[key])}"
    return (f"TTFT {rate('ttft', '.2f', ' s', 8)}   "
            f"prefill {rate('prefill', '.0f', ' tok/s', 12)}   "
            f"decode {rate('decode', '.1f', ' tok/s', 12)}   "
            f"req {_pad(_f(cur['n_req'], '.0f'), 5)}   "
            f"comp {_pad(_with_unit(cur['comp'], '.0f', ' tok'), 12)}   "
            f"out {_pad(_with_unit(cur['out'], '.0f', ' tok'), 11)}")


def render(a, snap, history, log_lines, log_is_stale, cur_avg, prev_avg):
    per, session = snap["per"], snap["session"]
    state, g = snap["state"], snap["gpu"]

    # Build all box contents first, then size every box to the widest (the history table).
    # When the server is idle (nothing running/waiting) collapse the cache/queue/spec
    # block to a single line — no point re-printing it every poll while idle.
    if _is_server_idle(state):
        cache_lines = [f"idle   KV {_with_unit(state.get('kv_pct'), '.1f', '%')}   running {_f(state.get('running'), '.0f')}   waiting {_f(state.get('waiting'), '.0f')}"]
    else:
        pt = state.get("prefix_tok")
        pb = state.get("prefix_block")
        spec = state.get("spec")
        spec_line = f"spec      {_with_unit(spec * 100 if spec is not None else None, '.1f', '%')} accepted " \
                   f"({_human(state.get('spec_accepted'))}/{_human(state.get('spec_draft'))} draft)"
        # log spec values are only shown when present (they're absent when spec decode is off)
        if state.get("log_spec_len") is not None and state.get("log_spec_rate") is not None:
            spec_line += f"   (log: len {_f(state.get('log_spec_len'), '.2f')}   rate {_with_unit(state.get('log_spec_rate'), '.1f', '%')})"
        prefix_line = f"prefix    {_with_unit(pt * 100 if pt is not None else None, '.1f', '%')} cached " \
                      f"({_human(state.get('prefix_tok_n'))}/{_human(state.get('prefix_tok_d'))} tok)   block hit {_with_unit(pb * 100 if pb is not None else None, '.1f', '%')}"
        # radiance only: tokens the attention cache held but no checkpoint let it skip
        if state.get("prefix_recomputed") is not None:
            prefix_line += f"   recomputed {_human(state.get('prefix_recomputed'))} tok"
        cache_lines = [
            f"KV        {_percent(state.get('kv_pct'), '.1f')}",
            prefix_line,
            spec_line,
            f"queue     running {_f(state.get('running'), '.0f')}   waiting {_f(state.get('waiting'), '.0f')}",
        ]

    # server block: cumulative since server start + uptime (elapsed since start_ts)
    start_ts = session.get("start_ts")
    if start_ts:
        server_title = f"server (up {_fmt_uptime(time.time() - start_ts)}, since {time.strftime('%H:%M:%S', time.localtime(start_ts))})"
    else:
        server_title = "server"

    # GPU block: 5 colored bars + edge/mem temp + fan + clocks
    if g is not None:
        used, total, gtt, power, temp, mem_temp, sclk, mclk, busy, fan = g
        vram_pct = (used / total * 100) if (total and used is not None) else None
        gpu_lines = [
            f"VRAM  {_f(used)}/{_f(total)} MiB   GTT {_f(gtt)} MiB",
            _metric_line("GPU", busy, ".0f", 100, 50, 80, "%"),
            _metric_line("power", power, ".0f", 250, 100, 200, "W"),
            _metric_line("vram", vram_pct, ".0f", 100, 50, 80, "%"),
            _metric_line("edge", temp, ".0f", 100, 55, 80, "C"),
            _metric_line("mem", mem_temp, ".0f", 100, 65, 90, "C"),
            f"{'fan':<6} {_pad(_with_unit(fan, '.0f', '%'), 5)}   sclk {_with_unit(sclk, '.0f', ' MHz')}   mclk {_with_unit(mclk, '.0f', ' MHz')}",
        ]
        gpu_block = ("GPU  (rocm-smi)", gpu_lines)
    else:
        gpu_block = ("GPU  (rocm-smi)", ["(no rocm-smi)"])

    # finished-requests block: live row + separator + rows, newest first
    requests_title = "finished requests"
    if snap.get("request_log_failed"):
        requests_title += f"  (docker logs {a.container} failed: rows per poll, comp/prefill n/a)"
    request_rows = _history_rows(history if history is not None else [])
    live_lines = [_live_row(snap), "─" * _visible_len(request_rows[0])]

    blocks = [
        gpu_block,
        ("cache / queue / spec", cache_lines),
        (server_title, _session_rows(session)),
        (requests_title, live_lines + request_rows),
        ("avg (last 5 min)", [_avg_line(cur_avg, prev_avg)]),
    ]
    if snap.get("log_tail"):
        blocks.append((f"log  (docker logs {a.container})", snap["log_tail"]))
    elif log_lines:
        if log_is_stale:
            blocks.append(("log", ["(log stale — not the current server)"]))
        else:
            blocks.append(("log  (last 5 entries)", log_table(log_lines)))

    # Every box shares one width — the widest content line — plus the
    # section's uniform 2-char padding, so all boxes line up edge-to-edge.
    width = max((_visible_len(l) for _, lines in blocks for l in lines), default=0)

    print("\033[2J\033[H")
    print(f"vLLM monitor — port {a.port}   [{time.strftime('%H:%M:%S', time.localtime(snap['ts']))}]   (Ctrl-C to quit)")
    print()
    for title, lines in blocks:
        section(title, lines, width)
        print()


def _session_rows(session):
    """Columnar session table: header + one value row, cumulative since server start. Units live in
    the headers so the values stay bare numbers.
    Columns: req | in (total prompt tokens) | cached (read from the prefix cache) |
    comp (prompt tokens actually computed/prefilled) | out (generated) | TTFT |
    prefill/decode TPS | gap (inter-token latency) | queue | full (mean full round trip, e2e)."""
    cols = [("req", 6), ("in", 10), ("cached", 10), ("comp", 10), ("out", 8),
            ("TTFT(s)", 8), ("prefill(t/s)", 12), ("decode(t/s)", 12),
            ("gap(ms)", 8), ("queue(ms)", 9), ("full(s)", 9)]
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
    """Fixed-width table of finished requests, newest first (history is oldest-first; a row is one request
    on radiance, else a _fold_request result, so requests finishing in the same poll share it).
    Columns: time | req (request count) | in (prompt tokens, not a rate; big for long-context/agentic requests) |
    comp (non-cached prompt tokens, what was actually prefilled) | out (generated) | TTFT (includes prefill) |
    prefill TPS | decode TPS | full (full round trip, request start to last token, e2e = TTFT + decode) |
    KV(%) (KV cache usage, retained prefix cache included), GPU(%) (both sampled at the poll's end, not over the request)."""
    rows = [
        f"{'time':>8} {'req':>4} {'in':>8} {'comp':>8} {'out':>8} {'TTFT(s)':>8} {'prefill(t/s)':>12} {'decode(t/s)':>12} {'full(s)':>9} {'KV(%)':>6} {'GPU(%)':>7}",
    ]
    for h in reversed(list(history)):
        per, state, g = h["per"], h["state"], h["gpu"]
        rows.append(
            f"{time.strftime('%H:%M:%S', time.localtime(h['ts'])):>8} "
            f"{_fmt(per.get('n_req'), 4, '.0f')} "
            f"{_fmt(per.get('in_tok'), 8, '.0f')} "
            f"{_fmt(per.get('computed_tok'), 8, '.0f')} "
            f"{_fmt(per.get('out_tok'), 8, '.0f')} "
            f"{_fmt(per.get('ttft_s'), 8, '.2f')} "
            f"{_fmt(per.get('prefill_tps'), 12, '.0f')} "
            f"{_fmt(per.get('decode_tps'), 12, '.1f')} "
            f"{_fmt(per.get('e2e_s'), 9, '.2f')} "
            f"{_fmt_color(state.get('kv_pct'), 6, '.1f', 50, 80)} "
            f"{_fmt_color(g[8] if g else None, 7, '.0f', 50, 80)}")
    return rows


def _row(snap):
    """One JSONL session row. Values are per-poll; the session_ keys are cumulative since server start, and
    "requests" lists radiance's requests finished in this poll. A radiance poll has no valid prefill_tps."""
    per, session, state, g = snap["per"], snap["session"], snap["state"], snap["gpu"]
    row = {
        "ts": snap["ts"],
        "input_tokens": per.get("in_tok"),
        "output_tokens": per.get("out_tok"),
        "computed_tokens": per.get("computed_tok"),
        "n_requests": per.get("n_req"),
        "ttft_s": per.get("ttft_s"),
        "prefill_tps": None if snap.get("radiance") else per.get("prefill_tps"),
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
        "e2e_s": per.get("e2e_s"),
        "session_e2e_s": session.get("e2e_s"),
        "session_itl_ms": session.get("itl_ms"),
        "session_queue_ms": session.get("queue_ms"),
    }
    if snap.get("requests"):
        row["requests"] = snap["requests"]
    if g is not None:
        row.update({"vram_used_mib": g[0], "vram_total_mib": g[1], "gtt_mib": g[2],
                    "power_w": g[3], "temp_c": g[4], "mem_temp_c": g[5],
                    "sclk_mhz": g[6], "busy_pct": g[8], "fan_pct": g[9]})
    return row


def _default_log_path(port):
    """The engine log under stack/serve/var/servers, independent of the current directory."""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".servers", f"{port}.log")


def main():
    ap = argparse.ArgumentParser(
        description="live vLLM server monitor — read-only: polls /metrics + rocm-smi + the logs, never touches the server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="examples:\n"
               "  monitor.py --port 8000                       live table, polls every 2 s (Ctrl-C to quit)\n"
               "  monitor.py --port 8000 --once                single snapshot, then exit\n"
               "  monitor.py --port 8000 --out session.jsonl   live + record one JSONL row per poll\n"
               "  stack/gpu/monitor.sh         same, with PORT/paths from _lib.sh\n\n"
               "blocks:\n"
               "  GPU               VRAM/GTT + 5 colored bars (GPU use / power / VRAM / edge temp / mem temp) + fan + clocks; red over 80/90 C\n"
               "  cache/queue/spec  KV % (colored), prefix-cache % cached + block hit rate (radiance: + recomputed = tokens the attention cache held but no linear checkpoint let it skip, since server start), spec acceptance (accepted/draft tokens), running/waiting\n"
               "  server            cumulative since server start (uptime shown in the title; req, in/cached/comp/out, TTFT, prefill/decode TPS, gap = inter-token latency, queue, full = mean full round trip)\n"
               "  finished requests live row (elapsed + progress tokens + GPU % + W + KV %) + one row per poll where a request finished, on radiance one row per request, newest first (in = total prompt tokens, not a rate; full = full round trip, request start to last token, TTFT + decode; KV(%) = KV cache usage, GPU(%) = GPU busy, both sampled at the poll's end)\n"
               "  avg (last 5 min)  weighted-average TTFT/prefill/decode (TPS by time, TTFT by requests; trend arrows) + window req/comp/out totals\n"
               "  log               parsed table of the last 5 loggers.py/metrics.py entries (stale mtime > 120 s -> flagged); on radiance the last 5 `docker logs` lines\n\n"
               "radiance request rows:\n"
               "  read from the \"I req ... done\" lines of `docker logs --tail 200 <container>` each poll, so they need docker access\n"
               "  (default container radiance-<port>, see --container); poll deltas cannot split comp and prefill time per request.\n"
               "  comp = prompt - cache (tokens reused via a linear-state checkpoint), prefill = comp / TTFT, no decode time in it;\n"
               "  requests waiting behind another one read low, and rows start from the requests finishing after the monitor starts.\n"
               "  if `docker logs` fails: rows per poll, comp/prefill n/a, no log block, and the block title says so.")
    ap.add_argument("--port", type=int, default=8000, help="server port (default 8000)")
    ap.add_argument("--interval", type=float, default=2.0, help="poll interval in seconds (default 2.0)")
    ap.add_argument("--log", default=None, help="engine log to tail (default stack/serve/var/servers/<port>.log; not read on radiance, see below)")
    ap.add_argument("--container", default=None,
                    help="radiance container whose log gives the request rows (default radiance-<port>; needs docker access)")
    ap.add_argument("--out", default=None,
                    help="append one JSONL row per poll — the session record")
    ap.add_argument("--no-gpu", action="store_true", help="skip rocm-smi (GPU block shows 'no rocm-smi')")
    ap.add_argument("--once", action="store_true", help="single snapshot, then exit")
    ap.add_argument("--history", type=int, default=15,
                    help="number of past request rows under the current poll (default 15; 0 hides the past rows — the current poll row always shows)")
    a = ap.parse_args()

    url = f"http://127.0.0.1:{a.port}/metrics"
    if a.log is None:
        a.log = _default_log_path(a.port)
    if a.container is None:
        a.container = f"radiance-{a.port}"

    prev, prev_t = None, None
    window = []  # rolling (ts, per) list, pruned to the last 5 min
    pending = {}  # deltas of the request in progress (see _fold_request)
    seen = None  # request ids in the last request-log read (see _finished_rows)
    history = deque(maxlen=a.history) if a.history > 0 else None
    prev_avg = {"ttft": None, "prefill": None, "decode": None, "n_req": None, "comp": None, "out": None}
    flight_start = None  # time.time() when running went 0->>0 (in-flight request elapsed base)
    flight_base = None   # gen_counter when running went 0->>0 (progress token base)
    out = open(a.out, "a") if a.out else None

    try:
        while True:
            t = time.time()
            m = parse_prom(fetch_metrics(url))
            g = None if a.no_gpu else gpu()
            log_lines = [] if _is_radiance(m) else tail_log(a.log, 12)

            if not m:
                print(f"\n[monitor] {time.strftime('%H:%M:%S')} — server not reachable at {url}")
                if a.once:
                    break
                time.sleep(a.interval)
                continue

            snap = collect(m, prev, prev_t, g, log_lines)

            # flight tracking: in-flight request elapsed time + progress (tokens generated).
            # When a request is running (running > 0), track how long it has been in flight
            # and how many tokens it has generated (gen_counter delta). Approximate per-batch on sly.
            running = snap["state"].get("running") or 0
            gen_counter = snap["state"].get("gen_counter")
            if running > 0 and flight_start is None:
                flight_start = time.time()
                flight_base = gen_counter
            elif running == 0 and flight_start is not None:
                flight_start = None
                flight_base = None
            if flight_start is not None:
                snap["state"]["flight_elapsed"] = time.time() - flight_start
                if gen_counter is not None and flight_base is not None:
                    snap["state"]["flight_gen"] = max(0, gen_counter - flight_base)

            # rolling window (last 5 min) -> weighted average; pruned by each sample's age
            if snap["per"]:
                window.append((snap["ts"], snap["per"]))
            window = [(ts, p) for ts, p in window if snap["ts"] - ts <= 300]
            rows, pending, seen = _finished_rows(snap, pending, seen, a.container)
            if history is not None:
                history.extend(rows)

            cur_avg = _avg_snapshot(window)
            render(a, snap, history, log_lines, log_stale(a.log), cur_avg, prev_avg)
            prev_avg = cur_avg

            # record one row per poll (the session record)
            if out:
                out.write(json.dumps(_row(snap)) + "\n")
                out.flush()

            prev, prev_t = m, snap["ts"]
            if a.once:
                break
            time.sleep(a.interval)
    except KeyboardInterrupt:
        print()
    finally:
        if out:
            out.close()


if __name__ == "__main__":
    main()
