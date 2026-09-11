#!/usr/bin/env python3
"""compare_builds.py — llama-bench A/B: a new llama.cpp build vs the previous one, per backend.

Skill: llamacpp-build. Reuses model-bench/run.sh (one invocation per arm) + lib/gpu_exclusive.sh.

  run --new VER [--backend vulkan|rocm|both] [--prev-vulkan NAME] [--prev-rocm NAME]
      [--reps 1] [--shapes 128:64,512:256,...] [--model GGUF] [--dry-run]
      Previous defaults to the build/latest-<backend> symlink target. Per backend: previous arm,
      then new arm, each after gpu_exclusive.sh. llama-swap is stopped for the whole run and
      restarted after it (also on failure / Ctrl-C / SIGTERM). Writes
      bench/runs/<stamp>-buildcmp-<VER>/arms.json, then the report (same as `report`).
  report CMP_DIR
      (Re)generates docs/analysis/<stamp>-llamacpp-<VER>-build-check.md from arms.json + the arm run
      dirs and runs docs/reindex.py. Deterministic: same inputs -> identical report.

Each request shape P:G is measured twice in one llama-bench call: `pp P` (prefill t/s) and `-pg P,G`
(the whole request: P prompt, then G generated). Decode t/s = G / (t_pg - t_pp).

Last stdout line is machine-readable:  VERDICT {"vulkan": "NEUTRAL", "rocm": "REGRESSION"}
"""
import argparse
import csv
import datetime as dt
import json
import math
import os
import pathlib
import re
import signal
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
BUILD = REPO / "build"
RUNS = REPO / "bench/runs"
DOCS = REPO / "docs/analysis"
RUN_SH = REPO / "bench/model-bench/run.sh"
GPU_EXCL = REPO / "bench/lib/gpu_exclusive.sh"
BUILD_SH = "bench/build_llamacpp.sh"
SWAP_DIR = pathlib.Path.home() / ".config/llama-swap"
SWAP_PORT = 9292

MODEL = "/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf"
# Fixed flags = llama-swap's serving shape for Qwen3.8 (generate.py COMMON: -ngl 99 -fa on
# -ub 2048 -b 4096; KV q8_0).
UB, BATCH, KV = 2048, 4096, "q8_0"
# Request shapes (prompt, generated) — user-defined 2026-09-11, chat turn → 32k-document job.
SHAPES = [(128, 64), (512, 256), (2048, 512), (8192, 1024), (32768, 2048)]
SHAPE_NAMES = dict(zip(SHAPES, ["Small", "Medium", "Large", "Big", "Very large"]))
# One throwaway pp + pg pass runs first (llama-bench order: -p list, then -pg list) and is dropped. Replaces
# llama-bench's per-test warmup, which re-runs every prompt in full (+~6.7 min per 4-arm run, 2026-09-11).
WARMUP_PP, WARMUP_PG = 1000, (1000, 32)
ETA_PP, ETA_TG = 754, 51           # user-stated current Qwen3.8 rates — ETA planning only
# A cell moved only if |Δ%| >= 5 AND (r > 1) |Δ| > 2σ_combined. n=1 has no σ, so the bar sits above the largest
# sd seen at r=3: ROCm prefill 4.5% (2026-09-11 build check).
SIG_SIGMA, SIG_PCT = 2.0, 5.0
IDLE_VRAM_MAX_MIB = 4096           # VRAM held when an arm starts -> another engine resident (rule 14)

MARK = {"better": "▲ better", "worse": "▼ worse", "flat": "= flat"}
DEVICE = {"vulkan": "Vulkan", "rocm": "ROCm"}   # --list-devices prefix == llama-bench `backends` value


def die(msg):
    sys.exit(f"compare_builds: {msg}")


def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return ""


def arm_name(ver, be):
    return ver if ver.endswith(f"-{be}") else f"{ver}-{be}"


def ver_of(name, be):
    return name[: -len(f"-{be}")] if name.endswith(f"-{be}") else name


def kfmt(n):
    return f"{n // 1024}k" if n >= 1024 and n % 1024 == 0 else str(n)


def shape_txt(s):
    return f"pp{s[0]} + tg{s[1]}"


def has_device(name, be):
    """Silent-CPU-fallback guard: release assets load GPU backends dynamically and DROP one whose runtime
    libs are missing (2026-09-11: b9950-rocm ran a 27B on the CPU, no error anywhere)."""
    out = sh(f"'{BUILD / name / 'bin' / 'llama-server'}' --list-devices 2>&1")
    return re.search(rf"^\s*{DEVICE[be]}\d+:", out, re.M) is not None


def eta_secs(cfg):
    s = cfg["shapes"] + [WARMUP_PG]
    return ((sum(2 * p for p, _ in s) / ETA_PP             # pp test + the pg test's own prompt
             + sum(g for _, g in s) / ETA_TG) * cfg["reps"] + 20)   # + model load


# ---------------------------------------------------------------- llama-swap
def port_pid(port):
    """PID listening on the port, or None — exact, unlike a pgrep pattern that can match itself."""
    m = re.search(r"pid=(\d+)", sh(f"ss -ltnpH 'sport = :{port}'"))
    return int(m.group(1)) if m else None


def stop_swap():
    """Stop llama-swap for the whole run: unload alone is not enough — a request mid-arm reloads a model
    onto the GPU (2026-09-11: that contaminated an arm and, stacked on a Vulkan device loss, took the
    desktop session down). Returns True if it was running, so the caller restarts it."""
    pid = port_pid(SWAP_PORT)
    if pid is None:
        return False
    try:
        cmd = pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        cmd = ""
    if "llama-swap" not in cmd:
        die(f":{SWAP_PORT} is held by pid {pid} ({cmd[:80] or '?'}), not llama-swap — refusing to stop it")
    os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        time.sleep(0.5)
        if port_pid(SWAP_PORT) is None and not pathlib.Path(f"/proc/{pid}").exists():
            print(f"llama-swap (pid {pid}) stopped for the run — restarted when it ends", flush=True)
            return True
    die(f"llama-swap pid {pid} did not stop within 15 s — stop it manually and re-run")


def start_swap():
    # own session: llama-swap must outlive this tool's process group (a background runner may reap it)
    p = subprocess.run(["bash", str(SWAP_DIR / "restart_llama_swap.sh"), "start"], capture_output=True,
                       text=True, start_new_session=True)
    out = (p.stdout + p.stderr).strip().splitlines()
    print(f"llama-swap restart: {out[-1] if out else f'exit {p.returncode}'}", flush=True)


# ---------------------------------------------------------------- run
def run_arm(name, be, cfg, cmp_dir):
    bench = BUILD / name / "bin" / "llama-bench"
    arm = {"name": name, "backend": be}
    ex = subprocess.run(["bash", str(GPU_EXCL)], capture_output=True, text=True)
    if ex.returncode:
        die(f"gpu_exclusive.sh refused before arm {name} (GPU not free):\n{ex.stdout}{ex.stderr}")
    pps = [WARMUP_PP] + sorted({p for p, _ in cfg["shapes"]})
    env = {**os.environ, "LLAMA_BENCH": str(bench), "MODEL": cfg["model"], "SLUG": f"buildcmp-{name}",
           "PP": ",".join(map(str, pps)), "TG": "0", "DEPTH": "0",
           "PG": " ".join(f"{p},{g}" for p, g in [WARMUP_PG] + cfg["shapes"]), "WARMUP": "0",
           "UB": str(cfg["ub"]), "BATCH": str(cfg["batch"]), "CTK": cfg["kv"], "CTV": cfg["kv"],
           "REPS": str(cfg["reps"]), "VRAM_SAMPLE": "1"}
    # LD_LIBRARY_PATH outranks RUNPATH: an inherited one would load another build's libllama.
    env.pop("LD_LIBRARY_PATH", None)
    limit = 3 * eta_secs(cfg) + 120   # run.sh has no timeout; a hung model load would block forever
    print(f"  arm {name}: running (timeout {limit / 60:.0f} min) …", flush=True)
    t0 = time.time()
    # own process group, so timeout / Ctrl-C / SIGTERM take llama-bench down too — never an orphan on the GPU
    p = subprocess.Popen(["bash", str(RUN_SH)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=limit)
        rc = p.returncode
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, err = p.communicate()
        rc = f"timeout after {limit / 60:.0f} min"
    except BaseException:
        os.killpg(p.pid, signal.SIGKILL)
        raise
    log = cmp_dir / f"arm-{name}.log"
    log.write_text(out[-20000:] + "\n--- stderr ---\n" + err[-20000:])
    arm["secs"] = round(time.time() - t0, 1)
    m = re.search(r"→ results: (\S+)", out)
    if m:
        arm["run_dir"] = str(pathlib.Path(m.group(1)).relative_to(REPO))
    if rc or not m:
        arm["failed"] = f"run.sh {rc if isinstance(rc, str) else f'exit {rc}'} — see {log.relative_to(REPO)}"
    print(f"  arm {name}: {'FAILED' if arm.get('failed') else 'ok'} in {arm['secs'] / 60:.1f} min", flush=True)
    return arm


def cmd_run(a):
    backends = ["vulkan", "rocm"] if a.backend == "both" else [a.backend]
    for p, g in a.shapes:
        if p <= 0 or g <= 0 or p == WARMUP_PP or (p, g) == WARMUP_PG:
            die(f"bad shape {p}:{g} (both > 0; {WARMUP_PP} is the warmup prompt)")
    cfg = {"model": a.model, "shapes": [list(s) for s in a.shapes], "ub": UB, "batch": BATCH, "kv": KV,
           "reps": a.reps, "warmup": {"pp": WARMUP_PP, "pg": list(WARMUP_PG)}}
    pairs = []
    for be in backends:
        new = arm_name(a.new, be)
        prev = getattr(a, f"prev_{be}")
        if not prev:
            link = BUILD / f"latest-{be}"
            if not link.is_symlink():
                die(f"no previous build for {be}: build/latest-{be} unset — pass --prev-{be}")
            prev = os.readlink(link)
        prev = arm_name(prev, be)
        if prev == new:
            print(f"[{be}] skipped: {new} is already latest-{be} — nothing to compare")
            continue
        for n in (prev, new):
            if not os.access(BUILD / n / "bin" / "llama-bench", os.X_OK):
                die(f"[{be}] build/{n}/bin/llama-bench missing — build it first ({BUILD_SH} build)")
            if not has_device(n, be):
                die(f"[{be}] build/{n} exposes no {DEVICE[be]} device — it would silently run on the CPU "
                    "(missing runtime libs?)")
        pairs.append((be, prev, new))
    if not pairs:
        die("nothing to compare")
    if not pathlib.Path(a.model).is_file():
        die(f"model not found: {a.model}")
    eta = eta_secs({**cfg, "shapes": a.shapes}) * 2 * len(pairs) / 60
    print(f"plan: {2 * len(pairs)} arms {[p[1:] for p in pairs]} · shapes "
          f"{', '.join(shape_txt(s) for s in a.shapes)} · r={a.reps} · warmup pass · "
          f"ETA ~{eta:.0f} min (at {ETA_PP}/{ETA_TG} t/s)", flush=True)
    if a.dry_run:
        return
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M")
    cmp_dir = RUNS / f"{stamp}-buildcmp-{a.new}"
    cmp_dir.mkdir(parents=True, exist_ok=False)
    doc = {"stamp": stamp, "new": a.new, "config": cfg, "arms": [],
           "env": {"kernel": sh("uname -r"), "hip": sh("hipconfig --version"),
                   "mesa": sh("vulkaninfo --summary 2>/dev/null | grep -m1 driverInfo | sed 's/.*= //'")}}
    swap_was_up = stop_swap()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit("compare_builds: terminated"))  # -> finally runs
    try:
        for be, prev, new in pairs:
            for n in (prev, new):
                doc["arms"].append(run_arm(n, be, {**cfg, "shapes": a.shapes}, cmp_dir))
                (cmp_dir / "arms.json").write_text(json.dumps(doc, indent=2) + "\n")
        report(cmp_dir)
    finally:
        if swap_was_up:
            start_swap()


# ---------------------------------------------------------------- report
def memory(path):
    if not path.exists():
        return None
    rows = list(csv.DictReader(l for l in path.read_text().splitlines() if l and not l.startswith("#")))
    vram = [float(r["vram_used_mib"]) for r in rows if r.get("vram_used_mib")]
    gtt = [float(r["gtt_used_mib"]) for r in rows if r.get("gtt_used_mib")]
    if not vram:
        return None
    return {"idle": vram[0], "peak_vram": max(vram), "peak_gtt": max(gtt) if gtt else None,
            "total": float(rows[0].get("vram_total_mib") or 0)}


def load(arm, shapes):
    """Arm -> per-shape results. Anything short of a complete result set counts as failed (iron rule 18)."""
    a = dict(arm)
    if a.get("failed"):
        return a
    rd = REPO / a["run_dir"]
    try:
        rows = json.loads((rd / "llama-bench.json").read_text())
    except (OSError, ValueError) as e:
        return {**a, "failed": f"unreadable llama-bench.json ({e})"}
    # dict keeps the last row per key: the warmup pass runs first, so it can never shadow a measured row
    pp = {r["n_prompt"]: r for r in rows if r["n_prompt"] > 0 and r["n_gen"] == 0}
    pg = {(r["n_prompt"], r["n_gen"]): r for r in rows if r["n_prompt"] > 0 and r["n_gen"] > 0}
    missing = [f"{p}:{g}" for p, g in shapes if p not in pp or (p, g) not in pg]
    if not rows or missing:
        return {**a, "failed": f"incomplete llama-bench.json (missing shapes {missing})"}
    if DEVICE[a["backend"]] not in str(rows[0].get("backends", "")):
        return {**a, "failed": f"ran on backends '{rows[0].get('backends')}', not {DEVICE[a['backend']]}"}
    res = {}
    for p, g in shapes:
        r_pp, r_pg = pp[p], pg[(p, g)]
        t_pp, t_pg = r_pp["avg_ns"] / 1e9, r_pg["avg_ns"] / 1e9
        if t_pg <= t_pp:
            return {**a, "failed": f"pg {p},{g} ({t_pg:.2f} s) not longer than pp {p} ({t_pp:.2f} s)"}
        t_dec = t_pg - t_pp
        tg = g / t_dec
        sd_dec = math.hypot(r_pg["stddev_ns"], r_pp["stddev_ns"]) / 1e9   # propagated; 0 at r=1
        res[(p, g)] = {"pp": (r_pp["avg_ts"], r_pp["stddev_ts"]), "tg": (tg, tg * sd_dec / t_dec), "req": t_pg}
    return {**a, "shape": res, "mem": memory(rd / "gpu_samples.csv"),
            "version": f'{rows[0]["build_number"]} ({rows[0]["build_commit"]})'}


def contended(a):
    return bool(a.get("mem")) and a["mem"]["idle"] > IDLE_VRAM_MAX_MIB


def cell(prev, new):  # (mean, sd) pairs, higher is better -> (Δ%, better|worse|flat)
    d = new[0] - prev[0]
    pct = 100 * d / prev[0]
    moved = abs(d) > SIG_SIGMA * math.hypot(prev[1], new[1]) and abs(pct) >= SIG_PCT
    return pct, ("better" if d > 0 else "worse") if moved else "flat"


def fit(points):  # power law: ln(rate) = c + k ln(x) -> (k, R²)
    pts = [(x, v) for x, v in points if x > 0]
    if len(pts) < 2:
        return None
    xs, ys = [math.log(x) for x, _ in pts], [math.log(v) for _, v in pts]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / sxx, (sxy * sxy / (sxx * syy) if syy else 1.0)


def verdict(p, n, shapes):
    if not n or n.get("failed"):
        return "FAILED"
    if not p or p.get("failed"):
        return "NO-BASELINE"
    if contended(p) or contended(n):
        return "CONTENDED"
    moves = [cell(p["shape"][s][m], n["shape"][s][m])[1] for s in shapes for m in ("pp", "tg")]
    return "REGRESSION" if "worse" in moves else "IMPROVEMENT" if "better" in moves else "NEUTRAL"


def recommendation(be, v, p, n):
    nv, pv = ver_of(n["name"], be), ver_of(p["name"], be)
    promote = f"`{BUILD_SH} promote {nv} --backend {be}`"
    return {
        "IMPROVEMENT": f"**Promote** {promote}.",
        "NEUTRAL": f"**Promote** {promote} — no measurable change; newer fixes come for free.",
        "REGRESSION": f"**Hold** — keep `{pv}` as latest-{be}; review the ▼ cells first. Promote anyway: "
                      f"{promote}; roll back later: `{BUILD_SH} promote {pv} --backend {be}`.",
        "FAILED": f"**Do not promote** — the new build's bench failed: {n.get('failed', 'not run')}.",
        "NO-BASELINE": f"**Re-run** — the previous build's bench failed ({p.get('failed')}); no comparison.",
        "CONTENDED": f"**Re-run** — VRAM was held by another engine at arm start (> {IDLE_VRAM_MAX_MIB} MiB); "
                     f"numbers invalid: `bench/model-bench/compare_builds.py run --new {nv} --backend {be}`.",
    }[v]


def fmt_v(v):  # (mean, sd) -> "812.3" or "812.3 ± 4.1"
    return f"{v[0]:.1f}" + (f" ± {v[1]:.1f}" if v[1] else "")


def pct_txt(e0, e1):
    return f"{100 * (e1 - e0) / e0:+.1f}%"


def report(cmp_dir):
    cmp_dir = pathlib.Path(cmp_dir).resolve()
    doc = json.loads((cmp_dir / "arms.json").read_text())
    cfg, env, new, stamp = doc["config"], doc["env"], doc["new"], doc["stamp"]
    if "shapes" not in cfg:
        die(f"{cmp_dir.name} is from the pre-shapes depth-sweep version — its report stays as generated")
    shapes, cmp_rel = [tuple(s) for s in cfg["shapes"]], cmp_dir.relative_to(REPO)
    hl = max(shapes, key=sum)   # headline = the largest request shape
    arms = [load(x, shapes) for x in doc["arms"]]
    per_be = {}
    for x in arms:
        per_be.setdefault(x["backend"], []).append(x)
    res = []  # (be, prev_arm, new_arm, verdict)
    for be, xs in per_be.items():
        n = xs[1] if len(xs) > 1 else {"name": arm_name(new, be), "failed": "arm not run (interrupted)"}
        res.append((be, xs[0], n, verdict(xs[0], n, shapes)))
    verdicts = {be: v for be, _, _, v in res}

    def ok(p, n):
        return not (p.get("failed") or n.get("failed"))

    def req_txt(p, n, s):
        if not ok(p, n):
            return "n/a"
        e0, e1 = p["shape"][s]["req"], n["shape"][s]["req"]
        return f"{e0:.1f} s → {e1:.1f} s ({pct_txt(e0, e1)})"

    wl = f"{kfmt(hl[0])}-in / {kfmt(hl[1])}-out"
    take = "; ".join(f"{be}: **{v}** vs `{p['name']}` ({wl} request "
                     f"{pct_txt(p['shape'][hl]['req'], n['shape'][hl]['req']) if ok(p, n) else 'n/a'})"
                     for be, p, n, v in res)
    model = pathlib.Path(cfg["model"]).name
    total = next((a["mem"]["total"] for a in arms if a.get("mem")), 0)
    wu = cfg["warmup"]

    L = ["<!-- meta", f"date: {stamp[:10]} {stamp[11:13]}:{stamp[13:15]}",
         f"takeaway: llama.cpp **{new}** build check on `{model}` / KV {cfg['kv']} — {take}.", "-->", "",
         f"# Build check: llama.cpp {new} vs previous — R9700 (gfx1201)", "",
         f"- **Date:** {stamp[:10]} {stamp[11:13]}:{stamp[13:15]} · **Track:** model-bench (llama-bench) · "
         f"generated by `bench/model-bench/compare_builds.py` — do not hand-edit; regenerate with "
         f"`bench/model-bench/compare_builds.py report {cmp_rel}`",
         f"- **GPU/Host:** AMD Radeon AI PRO R9700 (gfx1201), {total:.0f} MiB · kernel {env['kernel']} · "
         f"HIP {env['hip']} · {env['mesa']} · `HSA_OVERRIDE_GFX_VERSION=12.0.1`",
         f"- **Model:** `{model}` · KV **{cfg['kv']}** · `-ngl 99 -fa on -ub {cfg['ub']} -b {cfg['batch']}` · "
         f"request shapes {', '.join(shape_txt(s) for s in shapes)} · r={cfg['reps']} · warmup pass "
         f"pp{wu['pp']} + pg{wu['pg'][0]},{wu['pg'][1]} (dropped)",
         "- **Builds:** " + " · ".join(
             f"{be} `{p['name']}` ({p.get('version', '?')}) → `{n['name']}` ({n.get('version', '?')})"
             for be, p, n, _ in res),
         f"- **Data:** `{cmp_rel}/arms.json` → per-arm `bench/runs/<stamp>-model-buildcmp-<build>/` "
         "(`llama-bench.json`, `meta.txt`, `gpu_samples.csv`)", "",
         "## Summary", "",
         f"| Backend | Previous | New | Verdict | {wl} request (MEASURED) | Recommendation |", "|---|---|---|---|---|---|"]
    for be, p, n, v in res:
        L.append(f"| {be} | `{p['name']}` | `{n['name']}` | **{v}** | {req_txt(p, n, hl)} | "
                 f"{recommendation(be, v, p, n)} |")
    L += ["", "## Legend", "",
          "- **Prefill t/s** — llama-bench `pp P`: a P-token prompt into an empty context. MEASURED.",
          "- **Decode t/s** — G / (t(`-pg P,G`) − t(`pp P`)): the G tokens generated right after the P-token prompt, "
          "i.e. decode at depth P…P+G. Derived from two MEASURED timings (sd propagated from both when r > 1).",
          "- **Request** — wall time of llama-bench `-pg P,G`: prompt + generation in one context. MEASURED.",
          f"- **Δ%** — new vs previous. ▲/▼ only when |Δ%| ≥ {SIG_PCT:.0f} (and, when r > 1, |Δ| > "
          f"{SIG_SIGMA:.0f}·√(sd_prev² + sd_new²)); otherwise = flat.",
          "- **Verdict** — REGRESSION: any ▼ prefill/decode cell · IMPROVEMENT: ≥1 ▲, no ▼ · NEUTRAL: all flat · "
          "FAILED / NO-BASELINE / CONTENDED: no valid comparison.", ""]
    detail = ["## Results per request shape (MEASURED)", "",
              "| Shape | In / out | Backend | Prefill t/s prev | Prefill t/s new | Prefill Δ | Decode t/s prev | "
              "Decode t/s new | Decode Δ | Request prev → new |",
              "|---|---|---|---|---|---|---|---|---|---|"]
    for be, p, n, _ in res:
        if not ok(p, n):
            detail.append(f"| — | — | {be} | {p.get('failed') or 'ok'} | {n.get('failed') or 'ok'} | | | | | |")
    for s in shapes:   # grouped by shape, so both backends sit side by side per request size
        for be, p, n, _ in res:
            if not ok(p, n):
                continue
            a0, a1 = p["shape"][s], n["shape"][s]
            pp_pct, pp_m = cell(a0["pp"], a1["pp"])
            tg_pct, tg_m = cell(a0["tg"], a1["tg"])
            detail.append(f"| {SHAPE_NAMES.get(s, 'custom')} | {s[0]} / {s[1]} | {be} | {fmt_v(a0['pp'])} | "
                          f"{fmt_v(a1['pp'])} | {pp_pct:+.1f}% {MARK[pp_m]} | {fmt_v(a0['tg'])} | "
                          f"{fmt_v(a1['tg'])} | {tg_pct:+.1f}% {MARK[tg_m]} | {req_txt(p, n, s)} |")
    L += detail
    L += ["", "## Size decay — power-law fit (INFERRED, iron rule 16)", "",
          "Prefill: average prompt rate vs prompt size P. Decode: decode rate vs the depth P it starts at.", "",
          "| Backend | Build | prefill exponent | prefill R² | decode exponent | decode R² | fit range |",
          "|---|---|---|---|---|---|---|"]
    for be, p, n, _ in res:
        for a in (p, n):
            if a.get("failed"):
                continue
            fp = fit([(s[0], a["shape"][s]["pp"][0]) for s in shapes])
            ft = fit([(s[0], a["shape"][s]["tg"][0]) for s in shapes])
            if not (fp and ft):
                L.append(f"| {be} | `{a['name']}` | — | — | — | — | < 2 shapes |")
                continue
            L.append(f"| {be} | `{a['name']}` | {fp[0]:+.3f} | {fp[1]:.2f} | {ft[0]:+.3f} | {ft[1]:.2f} | "
                     f"P = {shapes[0][0]}–{shapes[-1][0]} ({len(shapes)} pts) |")
    L += ["", "## Memory (MEASURED, `bench/lib/vram_sampler.py`)", "",
          "| Backend | Build | VRAM at arm start (MiB) | peak VRAM (MiB) | peak GTT (MiB) | contended |", "|---|---|---|---|---|---|"]
    for be, p, n, _ in res:
        for a in (p, n):
            m = a.get("mem")
            if not m:
                L.append(f"| {be} | `{a['name']}` | — | — | — | no samples |")
                continue
            gtt = "—" if m["peak_gtt"] is None else f"{m['peak_gtt']:.0f}"
            L.append(f"| {be} | `{a['name']}` | {m['idle']:.0f} | {m['peak_vram']:.0f} | {gtt} | "
                     f"{'**YES**' if contended(a) else 'no'} |")
    L += ["", "## Recommendation", ""]
    L += [f"- **{be}:** {recommendation(be, v, p, n)}" for be, p, n, v in res]
    L += ["", "## Methodology & caveats", "",
          "- Same session, same model file, same flags; per backend the previous build runs first, then the new one. "
          "llama-swap is stopped for the whole run (restarted after) and `bench/lib/gpu_exclusive.sh` "
          "(asserts ≥ 26000 MiB free) runs before every arm.",
          "- Each arm is one `bench/model-bench/run.sh` → `llama-bench` invocation: the `pp P` tests, then the "
          f"`-pg P,G` tests, r={cfg['reps']} each. llama-bench's per-test warmup is off (it re-runs every prompt in "
          f"full); one throwaway pp{wu['pp']} and pg{wu['pg'][0]},{wu['pg'][1]} run first instead — warming the "
          "prefill and decode paths — and are dropped.",
          f"- r={cfg['reps']}" + (": no noise estimate. The 5% bar sits above the largest sd seen at r=3 (ROCm prefill "
          "4.5%); still, a single ▼ deserves a re-run with `--reps 3` before acting on it. The smallest prompts take "
          "well under 1 s, so their prefill cells are the noisiest." if cfg["reps"] == 1 else
          ": sd is a rough noise estimate; the 2σ + 5% rule guards against calling noise a change."),
          "- Raw llama-bench throughput: no MTP / speculative decoding, no server, no prompt cache. llama-swap's "
          "served decode (MTP on) is higher — compare builds here, not against serving wall-clock.",
          "- One model (dense 27B, Q4_K_XL) and one KV type: MoE or other quants can move differently.",
          "- Cross-report comparisons are only valid when the GPU/Host line (kernel, HIP, Mesa) is identical.", "",
          "## Reproduce", "", "```bash",
          f"{BUILD_SH} build --tag {new}",
          f"bench/model-bench/compare_builds.py run --new {new} "
          + (f"--backend {res[0][0]} " if len(res) == 1 else "")
          + " ".join(f"--prev-{be} {p['name']}" for be, p, _, _ in res)
          + f" --reps {cfg['reps']} --shapes {','.join(f'{p}:{g}' for p, g in shapes)}",
          "```", ""]

    out = DOCS / f"{stamp}-llamacpp-{new}-build-check.md"
    out.write_text("\n".join(L))
    ri = subprocess.run([sys.executable, str(REPO / "docs/reindex.py")], cwd=REPO, capture_output=True, text=True)
    print("\n" + "\n".join(L[L.index("## Summary") + 2: L.index("## Legend") - 1]))
    print("\n" + "\n".join(detail[2:]))
    print(f"\nreport: {out.relative_to(REPO)}" + ("" if ri.returncode == 0 else f"  (reindex FAILED: {ri.stderr.strip()})"))
    print("VERDICT " + json.dumps(verdicts))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="bench previous vs new build per backend, then report")
    r.add_argument("--new", required=True, help="new build version, e.g. b10906")
    r.add_argument("--backend", choices=["vulkan", "rocm", "both"], default="both")
    r.add_argument("--prev-vulkan", help="previous vulkan build (default: build/latest-vulkan target)")
    r.add_argument("--prev-rocm", help="previous rocm build (default: build/latest-rocm target)")
    r.add_argument("--reps", type=int, default=1)
    r.add_argument("--shapes", default=SHAPES, help="request shapes P:G,P:G (prompt:generated)",
                   type=lambda s: [tuple(int(x) for x in t.split(":")) for t in s.split(",")])
    r.add_argument("--model", default=MODEL)
    r.add_argument("--dry-run", action="store_true", help="print the plan + ETA, run nothing")
    g = sub.add_parser("report", help="regenerate the report from a bench/runs/<stamp>-buildcmp-<VER> dir")
    g.add_argument("cmp_dir")
    a = ap.parse_args()
    cmd_run(a) if a.cmd == "run" else report(a.cmp_dir)


if __name__ == "__main__":
    main()
