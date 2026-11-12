#!/usr/bin/env python3
"""boot_diag.py — boot diagnostics and boot measurables for campaign drivers (CPU-only, no GPU).

Added 2026-11-11 for campaigns/perf/2026-11-09-1825-27b-arms-kld (items B/G/H): a failed boot
left no retained diagnosis (the serve scripts `docker rm -f` the container on failure, so a
`docker logs` taken afterwards finds nothing), the WS7 "cold" label was a dir-existence guess,
and boots recorded no measurables. TDD: bench/perf/test_boot_diag.py.

Pure functions:
  boot_tail(text, n=300)         last n lines + every diagnostic-pattern line before them (bounded)
  cache_probe(path, budget_s)    host cache dir before a boot: files, bytes, newest mtime, scan time,
                                 cache_state cold (absent/no files) | warm (>=1 file) | unknown
  csv_peak / vram_peak           peak of a vram_sampler.py CSV column inside [t0, t1]; None if the CSV
                                 is missing or has no sample in the window
  parse_engine_log(text)         vLLM boot-log numbers (KV tokens, KV GiB, max concurrency, model load,
                                 graph capture, torch.compile, init engine) — None when a line is absent,
                                 never invented. Formats are vLLM V1 log lines, NOT yet verified against
                                 this stack's 1.11.0 / radiance logs (the first GPU run shows what parses).
  parse_server_txt(text)         resolved config from `serve_vllm.sh print` / `serve_radiance.sh print`

CLI (used by run.sh):
  boot_diag.py tail   --out FILE --section 'LABEL=PATH' ... [--meta k=v ...] [--lines 300]   (appends)
  boot_diag.py cache  --dir DIR [--budget-s 20]                                         (JSON on stdout)
  boot_diag.py record --out boots.jsonl --name N --arm A --kind vllm|radiance ...       (appends one line)
"""
import argparse
import json
import os
import re
import sys
import time

DIAG_RE = re.compile(r"error|Traceback|OutOfMemory|OOM|memory|fault|conflict|refused|in use|"
                     r"unsupported|not support", re.IGNORECASE)
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


# ------------------------------------------------------------------ boot tail
def boot_tail(text, n=300, max_matches=500):
    """Bounded diagnostic view of a log: every DIAG_RE line BEFORE the last n lines (with its
    1-based line number, capped at max_matches), then the last n lines verbatim."""
    lines = ANSI_RE.sub("", text or "").splitlines()
    head, tail = (lines[:-n], lines[-n:]) if len(lines) > n else ([], lines)
    matches = [f"{i + 1}: {l}" for i, l in enumerate(head) if DIAG_RE.search(l)]
    capped = len(matches) > max_matches
    out = [f"# {len(lines)} lines total; {len(matches)} diagnostic-pattern lines before the last "
           f"{len(tail)}" + (f" (capped at {max_matches})" if capped else "")]
    if matches:
        out.append("## pattern matches (line: text)")
        out += matches[:max_matches]
    out.append(f"## last {len(tail)} lines")
    out += tail
    return "\n".join(out) + "\n"


# ------------------------------------------------------------------ cache probe (item G)
def cache_probe(path, budget_s=20.0):
    """State of a host cache dir BEFORE a boot. Walks at most budget_s seconds (a bounded du).
    cache_state: cold = dir absent or holds no file; warm = >=1 file; unknown = the walk was cut
    by the budget before any file was seen, or the dir was unreadable."""
    t0 = time.monotonic()
    r = {"dir": path, "exists": os.path.isdir(path), "files": 0, "bytes": 0, "newest_mtime": None,
         "scan_s": None, "truncated": False, "errors": 0, "cache_state": None}
    if not r["exists"]:
        r["scan_s"] = round(time.monotonic() - t0, 3)
        r["cache_state"] = "cold"
        return r
    errs = []
    newest = None
    for root, _dirs, files in os.walk(path, onerror=errs.append):
        if time.monotonic() - t0 >= budget_s:
            r["truncated"] = True
            break
        for f in files:
            try:
                st = os.lstat(os.path.join(root, f))
            except OSError as e:
                errs.append(e)
                continue
            r["files"] += 1
            r["bytes"] += st.st_size
            newest = st.st_mtime if newest is None else max(newest, st.st_mtime)
    r["errors"] = len(errs)
    r["newest_mtime"] = newest
    r["scan_s"] = round(time.monotonic() - t0, 3)
    if r["files"] > 0:
        r["cache_state"] = "warm"
    elif r["truncated"] or errs:
        r["cache_state"] = "unknown"
    else:
        r["cache_state"] = "cold"
    return r


# ------------------------------------------------------------------ vram CSV (item H)
def csv_peak(csv_path, t0, t1, column="vram_used_mib"):
    """Max of `column` over vram_sampler.py rows with t0 <= unix_ts <= t1; None if no CSV/sample."""
    try:
        fh = open(csv_path, encoding="utf-8")
    except OSError:
        return None
    best = None
    with fh:
        cols = None
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if cols is None:
                cols = parts
                continue
            try:
                ts = float(parts[cols.index("unix_ts")])
                v = parts[cols.index(column)]
                v = int(float(v)) if v != "" else None
            except (ValueError, IndexError):
                continue
            if v is None or ts < float(t0) or ts > float(t1):
                continue
            best = v if best is None else max(best, v)
    return best


def vram_peak(csv_path, t0, t1):
    return csv_peak(csv_path, t0, t1, "vram_used_mib")


# ------------------------------------------------------------------ engine log (item H)
_NUM = r"([\d][\d,]*(?:\.\d+)?)"
ENGINE_PATTERNS = {
    "kv_cache_tokens": re.compile(r"GPU KV cache size:\s*" + _NUM + r"\s*tokens"),
    "kv_available_gib": re.compile(r"Available KV cache memory:\s*" + _NUM + r"\s*GiB"),
    "max_concurrency": re.compile(r"Maximum concurrency for\s*" + _NUM + r"\s*tokens per request:\s*"
                                  + _NUM + r"\s*x"),
    "model_load": re.compile(r"Model loading took\s*" + _NUM + r"\s*GiB(?: memory)? and\s*" + _NUM
                             + r"\s*s(?:econds|ecs?)?"),
    "graph_capture_s": re.compile(r"Graph capturing finished in\s*" + _NUM + r"\s*secs?"),
    "torch_compile_s": re.compile(r"torch\.compile takes?\s*" + _NUM + r"\s*s in total"),
    "init_engine_s": re.compile(r"init engine \(profile, create kv cache, warmup model\) took\s*" + _NUM
                                + r"\s*s"),
}
ENGINE_KEYS = ("kv_cache_tokens", "kv_available_gib", "max_concurrency",
               "max_concurrency_tokens_per_request", "model_load_s", "model_load_gib",
               "graph_capture_s", "torch_compile_s", "init_engine_s")


def _num(s):
    s = s.replace(",", "")
    return float(s) if "." in s else int(s)


def parse_engine_log(text):
    """Last occurrence of each known vLLM boot line; None when absent (never invented)."""
    text = ANSI_RE.sub("", text or "")
    r = {k: None for k in ENGINE_KEYS}

    def last(rx):
        m = None
        for m in rx.finditer(text):
            pass
        return m
    m = last(ENGINE_PATTERNS["kv_cache_tokens"])
    if m:
        r["kv_cache_tokens"] = int(_num(m.group(1)))
    m = last(ENGINE_PATTERNS["kv_available_gib"])
    if m:
        r["kv_available_gib"] = float(_num(m.group(1)))
    m = last(ENGINE_PATTERNS["max_concurrency"])
    if m:
        r["max_concurrency_tokens_per_request"] = int(_num(m.group(1)))
        r["max_concurrency"] = float(_num(m.group(2)))
    m = last(ENGINE_PATTERNS["model_load"])
    if m:
        r["model_load_gib"] = float(_num(m.group(1)))
        r["model_load_s"] = float(_num(m.group(2)))
    for k in ("graph_capture_s", "torch_compile_s", "init_engine_s"):
        m = last(ENGINE_PATTERNS[k])
        if m:
            r[k] = float(_num(m.group(1)))
    r["parsed"] = [k for k in ENGINE_KEYS if r[k] is not None]
    return r


# ------------------------------------------------------------------ resolved config
def _int(s):
    try:
        return int(re.sub(r"[^\d]", "", s)) if s is not None and re.search(r"\d", s) else None
    except ValueError:
        return None


def _float(s):
    try:
        return float(s) if s is not None else None
    except ValueError:
        return None


def parse_server_txt(text):
    """Config from a `serve_vllm.sh print` (KEY=VALUE comment lines + docker_argv) or a
    `serve_radiance.sh print` (bare argv). Env-style KEY=VALUE wins over argv flags."""
    text = text or ""
    kv = dict(re.findall(r"\b([A-Z][A-Z_]+)=(\S+)", text))
    flags = dict(re.findall(r"(--[a-z][a-z0-9-]*)\s+([^\s-][^\s]*)", text))
    m = re.search(r"num_speculative_tokens\\?\"?:\\?\s*(\d+)", text)
    spec = int(flags["--num-speculative-tokens"]) if "--num-speculative-tokens" in flags else (
        int(m.group(1)) if m else None)
    prof = re.search(r"^# profile=(\S+)", text, re.MULTILINE)
    return {
        "maxlen": _int(kv.get("MAXLEN")) or _int(flags.get("--max-model-len")),
        "maxseqs": _int(kv.get("MAXSEQS")) or _int(flags.get("--max-num-seqs")),
        "gpu_util": _float(kv.get("GPU_UTIL")) if "GPU_UTIL" in kv else _float(flags.get("--gpu-memory-utilization")),
        "kv_dtype": kv.get("KV_DTYPE") or flags.get("--kv-cache-dtype"),
        "served": kv.get("SERVED_NAME") or flags.get("--served-model-name"),
        "spec_tokens": spec,
        "profile": prof.group(1) if prof else None,
        "free_mib_floor": _int(kv.get("FREE_MIB_FLOOR")),
        "gpu_headroom_mib": _int(flags.get("--gpu-headroom-mib")),
    }


# ------------------------------------------------------------------ CLI
def _read(path):
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except (OSError, TypeError):
        return None


def _opt_float(s):
    return float(s) if s not in (None, "") else None


def _opt_int(s):
    return int(float(s)) if s not in (None, "") else None


def cmd_tail(a):
    blocks = [f"=== boot attempt {time.strftime('%Y-%m-%dT%H:%M:%S%z')} ==="]
    blocks += [f"# {m}" for m in a.meta or []]
    for sec in a.section or []:
        label, _, path = sec.partition("=")
        txt = _read(path)
        if txt is None:
            blocks.append(f"--- {label}: (no file) {path}")
        elif not txt.strip():
            blocks.append(f"--- {label}: (empty) {path}")
        else:
            blocks.append(f"--- {label}: {path}")
            blocks.append(boot_tail(txt, a.lines).rstrip("\n"))
    with open(a.out, "a", encoding="utf-8") as f:
        f.write("\n".join(blocks) + "\n\n")
    return 0


def cmd_cache(a):
    print(json.dumps(cache_probe(a.dir, a.budget_s)))
    return 0


def cmd_record(a):
    cfg = parse_server_txt(_read(a.server_txt) or "") if a.server_txt else parse_server_txt("")
    cache = {}
    if a.cache_json:
        try:
            cache = json.loads(_read(a.cache_json) or "{}")
        except ValueError:
            cache = {}
    t0, t1 = _opt_float(a.t0), _opt_float(a.t1)
    rc = int(a.rc)
    rad_bytes = None
    if a.rad:
        try:
            rad_bytes = os.path.getsize(a.rad)
        except OSError:
            rad_bytes = None
    log = parse_engine_log(_read(a.log) or "") if a.log else parse_engine_log("")
    row = {
        "kind": "boot", "arm": a.arm, "slug": a.name, "engine": a.kind,
        "served": a.served or cfg["served"], "image": a.image, "image_id": a.image_id or None,
        "profile": cfg["profile"], "spec_tokens": cfg["spec_tokens"], "maxlen": cfg["maxlen"],
        "maxseqs": cfg["maxseqs"], "gpu_util": cfg["gpu_util"], "kv_dtype": cfg["kv_dtype"],
        "free_mib_floor": cfg["free_mib_floor"], "gpu_headroom_mib": cfg["gpu_headroom_mib"],
        "rad_path": a.rad or None, "rad_bytes": rad_bytes,
        "start_epoch": t0, "end_epoch": t1, "ready_epoch": t1 if rc == 0 else None,
        "boot_seconds": round(t1 - t0, 3) if (t0 is not None and t1 is not None) else None,
        "start_rc": rc, "ok": rc == 0,
        "cache_state": cache.get("cache_state"), "cache": cache or None,
        "vram_before_mib": _opt_int(a.vram_before), "vram_ready_mib": _opt_int(a.vram_ready),
        "vram_peak_boot_mib": vram_peak(a.vram_csv, t0, t1) if (a.vram_csv and t0 is not None and t1 is not None) else None,
        "gtt_peak_boot_mib": csv_peak(a.vram_csv, t0, t1, "gtt_used_mib") if (a.vram_csv and t0 is not None and t1 is not None) else None,
        "engine_log": log, "boot_tail": a.boot_tail or None,
        "provenance": {
            "config": "CLAIMED (resolved config printed by the serve script = what was requested)",
            "start_rc/boot_seconds/epochs": "MEASURED (driver wall clock around `serve_*.sh start`)",
            "vram_*": "MEASURED (sysfs mem_info_vram_used before/at ready; peak = vram_sampler CSV in the window)",
            "cache": "MEASURED (bounded walk of the host cache dir before the boot)",
            "engine_log": "MEASURED when parsed (the engine's own log lines); null = line absent",
            "image_id": "MEASURED (docker image inspect)",
        },
    }
    with open(a.out, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("tail")
    t.add_argument("--out", required=True)
    t.add_argument("--section", action="append", help="LABEL=PATH (repeatable)")
    t.add_argument("--meta", action="append", help="k=v header line (repeatable)")
    t.add_argument("--lines", type=int, default=300)
    c = sub.add_parser("cache")
    c.add_argument("--dir", required=True)
    c.add_argument("--budget-s", type=float, default=20.0)
    r = sub.add_parser("record")
    r.add_argument("--out", required=True)
    r.add_argument("--name", required=True)
    r.add_argument("--arm", required=True)
    r.add_argument("--kind", required=True)
    for opt in ("--served", "--image", "--image-id", "--server-txt", "--t0", "--t1", "--vram-before",
                "--vram-ready", "--vram-csv", "--log", "--cache-json", "--rad", "--boot-tail"):
        r.add_argument(opt, default=None)
    r.add_argument("--rc", required=True)
    a = ap.parse_args(argv)
    return {"tail": cmd_tail, "cache": cmd_cache, "record": cmd_record}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
