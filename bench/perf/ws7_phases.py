#!/usr/bin/env python3
"""WS7 boot-phase breakdown for sly-radiance vLLM boots (CPU-only log parser).

Splits a `docker logs vllm-8000` capture of one boot into per-phase seconds for the
first-boot <=400 s investigation (campaigns/perf/2026-11-09-1825-27b-arms-kld, WS7).

Markers are the verbatim vLLM/aiter lines identified in
campaigns/perf/2026-11-09-1825-27b-arms-kld/research/ws7-boot-r2.md section 1
(1.9.1 cold boot, 475 s MEASURED).

Provenance (iron rule 1):
  - self_reported_s: MEASURED — parsed straight out of the log's own timers.
  - chain_s deltas: INFERRED — differences between MEASURED timestamp anchors
    (container-local HH:MM:SS, else docker-logs ISO prefix for lines with no in-message
    clock — 1.11.0 uvicorn/banner lines).
  - cacheable_per_r2_s: INFERRED — r2 section 2 mapping (inductor AOT + Triton).
A missing marker becomes null + a `missing` entry; the parser never crashes on a
truncated or format-drifted log (run.sh treats a failure as "raw log recorded").

Usage:
  python3 ws7_phases.py --log <file> --up-after-s <S> --cache <label> --out <json>
"""
import argparse
import json
import re
import sys

# --- line shape ------------------------------------------------------------------
# docker logs prefix: 2026-10-30T16:43:42.123456789Z stdout=P <message>
RE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?")
RE_STREAM = re.compile(r"^\s*(?:stdout|stderr)=[PF]\s+")
RE_HMS = re.compile(r"\b(\d{2}:\d{2}:\d{2})\b")
# vLLM's first banner, anchored to the message. 1.9.1: bare "INFO 10-30 …". 1.11.0:
# process-prefixed "(APIServer pid=1) INFO 11-10 …" — allow an optional (… pid=…) tag.
RE_INFO = re.compile(r"^(?:\([^)]*\)\s*)?INFO\b")
# ANSI escape sequences (color tags) — stripped from every line before matching, so
# timers and paths come out clean (1.11.0 aiter lines are colorized).
RE_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
RE_ENGINE = re.compile(r"Initializing a V1 LLM engine")

# --- self-reported timers (verbatim anchors from ws7-boot-r2.md section 1) -------
# 1.9.1: "[aiter] finish build …". 1.11.0: "[aiter] [pid=1 pname=MainProcess] finish build …"
# (ANSI already stripped). Allow the optional [..] tags between.
RE_AITER = re.compile(r"\[aiter\](?:\s*\[[^\]]*\])*\s+finish build \[module_aiter_core\], cost (\d+(?:\.\d+)?)s")
RE_MM = re.compile(r"Multi-modal warmup completed in (\d+(?:\.\d+)?)s")
RE_WEIGHT = re.compile(r"Model loading took (\d+(?:\.\d+)?) GiB memory and (\d+(?:\.\d+)?) seconds")
RE_COMPILE = re.compile(r"torch\.compile took (\d+(?:\.\d+)?) s in total")
RE_AOT = re.compile(r"saved AOT compiled function to (\S+)")
RE_WARMUP = re.compile(r"warmup run took (\d+(?:\.\d+)?) s")
RE_JIT = re.compile(r"JIT kernel warmup \((\d+) compile keys\)[^\n]*?finished in (\d+(?:\.\d+)?)\s*s")
RE_GRAPH = re.compile(r"Graph capturing finished in (\d+(?:\.\d+)?) secs?, took (\d+(?:\.\d+)?) GiB")
RE_ENGINE_DONE = re.compile(
    r"init engine \(profile, create kv cache, warmup model\) took (\d+(?:\.\d+)?) s "
    r"\(compilation: (\d+(?:\.\d+)?) s\)")
RE_JITMON = re.compile(r"Triton kernel JIT compilation during inference")
RE_FAULT = re.compile(r"Memory Fault")

D = lambda x: None if x is None else round(float(x), 2)


def _hms_to_s(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def _line_time(msg):
    """(seconds-of-day, raw-timestamp-string) for a message, else (None, None).
    Container-local HH:MM:SS (vLLM's own clock); the docker ISO prefix carries the
    same instant in UTC, so the message clock is the one the phase anchors agree on."""
    m = RE_HMS.search(msg)
    if m:
        return _hms_to_s(m.group(1)), m.group(1)
    return None, None  # caller may fall back to the docker-ISO clock


def parse(text, up_after_s):
    """Parse a boot log into the WS7 JSON payload (see module docstring for provenance).

    Clock: the message's own HH:MM:SS wins (vLLM's clock); lines with no in-message clock
    (1.11.0 uvicorn lines, the RADIANCE bandwidth banner, aiter tags) fall back to the
    docker-ISO prefix — the same instant in UTC, so both clocks agree for a UTC container
    (documented assumption; a non-UTC container TZ would skew fallback lines only)."""
    text = RE_ANSI.sub("", text)          # one strip: timer/regex matches below stay clean
    entries = []  # (t, message, tstr)
    for line in text.splitlines():
        m_iso = RE_ISO.match(line)
        msg = RE_STREAM.sub("", RE_ISO.sub("", line))
        t, tstr = _line_time(msg)
        if t is None and m_iso:
            t, tstr = _hms_to_s(m_iso.group(1)), m_iso.group(1)
        if t is not None:
            entries.append((t, msg, tstr))

    out = {
        "up_after_s": up_after_s,
        "provenance": ("self_reported_s=MEASURED (log's own timers); chain_s deltas=INFERRED "
                       "(differences of MEASURED timestamps); cacheable_per_r2_s=INFERRED (r2 sec 2 mapping)"),
        "t0": None,
        "chain_s": {},
        "self_reported_s": {},
        "cacheable_per_r2_s": None,
        "jit_monitor_warnings": sum(1 for _, m, _ in entries if RE_JITMON.search(m)),
        "memory_fault": sum(1 for _, m, _ in entries if RE_FAULT.search(m)),
        "aot_paths": sorted(set(RE_AOT.findall(text))),
        "missing": [],
    }
    if not entries:
        out["missing"] = ["no parseable timestamps in log"]
        return out

    t0, out["t0"] = entries[0][0], entries[0][2]

    def ts_first(regex, pred=None):
        """Seconds-relative-to-t0 of the first entry whose message matches regex, else None."""
        for t, m, _ in entries:
            if regex.search(m) and (pred is None or pred(m)):
                return t - t0
        return None

    t_cli = ts_first(RE_INFO)
    t_engine = ts_first(RE_ENGINE)
    t_done = ts_first(RE_ENGINE_DONE)

    aiter = RE_AITER.findall(text)
    mm = RE_MM.findall(text)
    weights = RE_WEIGHT.findall(text)
    compiles = RE_COMPILE.findall(text)
    warmups = RE_WARMUP.findall(text)
    jits = RE_JIT.findall(text)
    graphs = RE_GRAPH.findall(text)
    done = RE_ENGINE_DONE.search(text)

    sr = out["self_reported_s"]
    missing = out["missing"]

    def put(key, found, value):
        sr[key] = D(value)
        if not found:
            missing.append(key)

    put("aiter_build_s", bool(aiter), float(aiter[0])) if aiter else missing.append("aiter_build_s")
    put("mm_warmup_s", bool(mm), float(mm[0])) if mm else missing.append("mm_warmup_s")
    sr["weight_gib"] = [D(g) for g, _ in weights] or None
    put("weight_load_s", bool(weights), sum(float(s) for _, s in weights)) if weights \
        else missing.append("weight_load_s")
    sr["torch_compile_modules_s"] = [D(c) for c in compiles] or None
    if done:
        sr["compilation_s"] = D(float(done.group(2)))
    elif compiles:
        sr["compilation_s"] = D(sum(map(float, compiles)))
    else:
        sr["compilation_s"] = None
        missing.append("compilation_s")
    if compiles and done:
        sr["compilation_module_sum_s"] = D(sum(map(float, compiles)))
    put("profiling_warmup_s", bool(warmups), sum(map(float, warmups))) if warmups \
        else missing.append("profiling_warmup_s")
    put("jit_kernel_warmup_s", bool(jits), float(jits[0][1])) if jits \
        else missing.append("jit_kernel_warmup_s")
    if jits:
        sr["jit_keys"] = int(jits[0][0])
    put("graph_capture_s", bool(graphs), sum(float(g) for g, _ in graphs)) if graphs \
        else missing.append("graph_capture_s")
    if done:
        sr["engine_init_total_s"] = D(float(done.group(1)))
    else:
        missing.append("engine_init_total_s")
    # stable JSON shape: known keys always present (null when the marker was absent)
    for k in ("aiter_build_s", "mm_warmup_s", "weight_load_s", "compilation_s",
              "profiling_warmup_s", "jit_kernel_warmup_s", "graph_capture_s",
              "engine_init_total_s"):
        sr.setdefault(k, None)

    chain = out["chain_s"]
    seg = {
        "entrypoint_to_cli_s": t_cli,
        "cli_to_engine_s": (t_engine - t_cli) if (t_cli is not None and t_engine is not None) else None,
        "engine_to_done_s": (t_done - t_engine) if (t_engine is not None and t_done is not None) else None,
        "done_to_health_s": (up_after_s - t_done) if t_done is not None else None,
    }
    for k, v in seg.items():
        chain[k] = D(v)
        if v is None:
            missing.append(k)
    known = [v for v in seg.values() if v is not None]
    chain["chain_sum_s"] = D(sum(known))
    chain["unaccounted_s"] = D(up_after_s - sum(known))

    if None not in (sr.get("compilation_s"), sr.get("profiling_warmup_s"), sr.get("jit_kernel_warmup_s")):
        out["cacheable_per_r2_s"] = D(sr["compilation_s"] + sr["profiling_warmup_s"]
                                      + sr["jit_kernel_warmup_s"])
    return out


def main(argv=None):
    a = argparse.ArgumentParser(description="WS7 sly-radiance boot log -> per-phase seconds (JSON)")
    a.add_argument("--log", required=True)
    a.add_argument("--up-after-s", required=True, type=int)
    a.add_argument("--cache", required=True, help="cache-state label (cold/warm/warm-first ...)")
    a.add_argument("--out", required=True)
    args = a.parse_args(argv)
    try:
        text = open(args.log, encoding="utf-8", errors="replace").read()
    except OSError as e:
        print(f"ws7_phases: cannot read log: {e}", file=sys.stderr)
        return 1
    if not text.strip():
        print("ws7_phases: log is empty", file=sys.stderr)
        return 1
    out = parse(text, args.up_after_s)
    out["cache"] = args.cache
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    sr = out["self_reported_s"]
    print(f"ws7_phases: up_after {out['up_after_s']} s | compilation {sr.get('compilation_s')} s | "
          f"jit-warmup {sr.get('jit_kernel_warmup_s')} s | weight {sr.get('weight_load_s')} s | "
          f"chain {out['chain_s'].get('chain_sum_s')} s (unaccounted {out['chain_s'].get('unaccounted_s')} s) | "
          f"jit_monitor warnings {out['jit_monitor_warnings']} | missing: {out['missing'] or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
