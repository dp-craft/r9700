#!/usr/bin/env python3
"""
sweep.py — adaptive optimum search over llama.cpp tuning knobs (model-bench track).

Coordinate descent over the axes (default: ub → batch → fa), then a KV-cache A/B stage.
For each numeric axis the grid EXPANDS (×2 up / ÷2 down) while the best value sits on the grid
boundary, and stops only when the peak is *interior* — i.e. measured neighbors on both sides are
slower — or a hard cap / OOM is hit. That is the "keep going until the optimum is bracketed"
guarantee: every shipped optimum has a measured, slower neighbor on each side.

KV stage (default on): at the winning config, f16 vs q8_0 KV is measured at --kv-depth context
depth. q8_0 is ACCEPTED only if BOTH prefill and decode lose ≤ --kv-max-loss-pct (default 5%);
the report includes the measured VRAM saving either way.

Every llama-bench invocation is stored raw (invocations/*.json), every measured point becomes a
line in sweep-log.jsonl, and sweep-summary.json holds the curves, decisions and the final
recommended config. GPU VRAM/power is sampled per invocation (bench/lib/vram_sampler.py).

Usage:
  ./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm
  ./sweep.py --model ... --llama-bench ../llamacpp-vulkan/llama-bench --slug 35b-vulkan
  ./sweep.py --model ... --pp 8192 --tg 256 --kv-depth 32768 --dry-run

Vendor notes: AMD is auto-detected (HSA_OVERRIDE_GFX_VERSION exported if unset); on NVIDIA just
pass a CUDA llama-bench via --llama-bench. Pure stdlib.
"""
import argparse, datetime, json, os, pathlib, shutil, signal, subprocess, sys, time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
SAMPLER = REPO / "bench/lib/vram_sampler.py"

UB_CAPS = (64, 16384)
BATCH_CAPS = (256, 16384)

# ---------------------------------------------------------------- environment

def setup_env():
    env = os.environ.copy()
    if shutil.which("rocm-smi") and "HSA_OVERRIDE_GFX_VERSION" not in env:
        env["HSA_OVERRIDE_GFX_VERSION"] = "12.0.1"  # gfx1201; pre-set the var for other AMD cards
    return env

def gpu_meta_lines():
    try:
        out = subprocess.run(["bash", "-c",
                              f'source "{REPO}/bench/lib/gpu_env.sh"; gpu_setup_env; gpu_meta'],
                             capture_output=True, text=True, timeout=15).stdout
        return out.strip().splitlines()
    except Exception:
        return ["gpu_vendor=unknown"]

# ---------------------------------------------------------------- measurement

class Bench:
    """Runs llama-bench invocations, caches measured points, logs everything."""

    def __init__(self, args, outdir, env):
        self.args, self.out, self.env = args, outdir, env
        self.cache = {}          # key -> point dict
        self.n_invocations = 0
        self.log = open(outdir / "sweep-log.jsonl", "a")

    def key(self, ub, batch, fa, kv, depth):
        return (ub, batch, fa, kv, depth)

    def measure(self, ubs, batch, fa, kv, depths=(0,)):
        """One llama-bench invocation; ubs is a list (comma-swept). Returns list of points."""
        # llama.cpp silently clamps ub to b — keep the pair consistent instead
        eff_batch = max(batch, max(ubs))
        want = [self.key(u, eff_batch, fa, kv, d) for u in ubs for d in depths]
        missing = [k for k in want if k not in self.cache]
        if missing:
            self._run(sorted({k[0] for k in missing}), eff_batch, fa, kv,
                      sorted({k[4] for k in missing}))
        return [self.cache[k] for k in want if k in self.cache]

    def _run(self, ubs, batch, fa, kv, depths):
        a = self.args
        self.n_invocations += 1
        tag = f"{self.n_invocations:03d}-ub{'x'.join(map(str,ubs))}-b{batch}-fa{fa}-kv{kv}-d{'x'.join(map(str,depths))}"
        cmd = [a.llama_bench, "-m", a.model,
               "-p", str(a.pp), "-n", str(a.tg), "-d", ",".join(map(str, depths)),
               "-ngl", str(a.ngl), "-fa", fa,
               "-ub", ",".join(map(str, ubs)), "-b", str(batch),
               "-ctk", kv, "-ctv", kv, "-r", str(a.reps), "-o", "json"]
        print(f"  [{tag}] {' '.join(cmd)}", flush=True)
        if a.dry_run:
            return
        inv_dir = self.out / "invocations"; inv_dir.mkdir(exist_ok=True)
        sampler = subprocess.Popen([sys.executable, str(SAMPLER),
                                    "--out", str(inv_dir / f"{tag}.gpu.csv"), "--interval", "1"])
        t0 = time.time()
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, env=self.env,
                               timeout=a.invocation_timeout)
        finally:
            sampler.send_signal(signal.SIGTERM); sampler.wait(timeout=10)
        (inv_dir / f"{tag}.err").write_text(r.stderr)
        vram_peak = self._peak(inv_dir / f"{tag}.gpu.csv")
        if r.returncode != 0 or not r.stdout.strip():
            print(f"  [{tag}] FAILED (rc={r.returncode}, likely OOM) — treated as axis boundary")
            for u in ubs:
                for d in depths:
                    self.cache[self.key(u, batch, fa, kv, d)] = {
                        "ub": u, "batch": batch, "fa": fa, "kv": kv, "depth": d,
                        "failed": True, "vram_peak_mib": vram_peak}
            return
        (inv_dir / f"{tag}.json").write_text(r.stdout)
        rows = json.loads(r.stdout)
        pts = {}
        for row in rows:
            k = self.key(row["n_ubatch"], row["n_batch"], row.get("flash_attn", fa),
                         row.get("type_k", kv), row.get("n_depth", 0))
            p = pts.setdefault(k, {"ub": k[0], "batch": k[1], "fa": str(k[2]), "kv": k[3],
                                   "depth": k[4], "failed": False,
                                   "vram_peak_mib": vram_peak, "secs": round(time.time()-t0, 1)})
            if row.get("n_prompt", 0) > 0 and row.get("n_gen", 0) == 0:
                p["pp_ts"], p["pp_stddev"] = row["avg_ts"], row.get("stddev_ts")
            elif row.get("n_gen", 0) > 0 and row.get("n_prompt", 0) == 0:
                p["tg_ts"], p["tg_stddev"] = row["avg_ts"], row.get("stddev_ts")
            p["build_commit"] = row.get("build_commit")
        for k, p in pts.items():
            # normalize fa key back to on/off strings
            k = self.key(p["ub"], p["batch"], "on" if str(p["fa"]) in ("1", "True", "on") else "off",
                         p["kv"], p["depth"])
            p["fa"] = k[2]
            self.cache[k] = p
            self.log.write(json.dumps(p) + "\n"); self.log.flush()

    @staticmethod
    def _peak(csv_path):
        try:
            for line in reversed(csv_path.read_text().splitlines()):
                if line.startswith("# peak_vram_used_mib="):
                    return int(line.split("=")[1].split()[0])
        except OSError:
            pass
        return None

# ---------------------------------------------------------------- peak search

def metric_of(point, metric):
    if point.get("failed"):
        return None
    return point.get(f"{metric}_ts")

def find_peak(values, points_by_value, metric, noise_pct):
    """Return (best_value, curve, plateau_flag). Peak = argmax over measured, non-failed points."""
    curve = []
    for v in sorted(values):
        p = points_by_value.get(v)
        m = metric_of(p, metric) if p else None
        curve.append({"value": v, metric: m,
                      "other": (p or {}).get("tg_ts" if metric == "pp" else "pp_ts"),
                      "vram_peak_mib": (p or {}).get("vram_peak_mib"),
                      "failed": bool(p and p.get("failed"))})
    ok = [c for c in curve if c[metric] is not None]
    if not ok:
        return None, curve, False
    best = max(ok, key=lambda c: c[metric])
    # plateau: any other point within noise of the peak
    plateau = any(c is not best and c[metric] is not None and
                  abs(c[metric] - best[metric]) / best[metric] * 100 <= noise_pct for c in ok)
    return best["value"], curve, plateau

def sweep_numeric_axis(bench, axis, grid, fixed, metric, noise_pct, caps):
    """Coordinate-descent one numeric axis; expand grid while the peak sits on the boundary."""
    lo_cap, hi_cap = caps
    values = sorted(set(grid))
    measure = lambda vs: bench.measure(
        ubs=vs if axis == "ub" else [fixed["ub"]],
        batch=(fixed["batch"] if axis == "ub" else vs[0]),
        fa=fixed["fa"], kv=fixed["kv"], depths=(fixed["depth"],))
    pbv = {}
    if axis == "ub":
        for p in measure(values): pbv[p["ub"]] = p
    else:
        for v in values:
            for p in bench.measure(ubs=[fixed["ub"]], batch=v, fa=fixed["fa"],
                                   kv=fixed["kv"], depths=(fixed["depth"],)):
                pbv[p["batch"]] = p
    while True:
        best, curve, plateau = find_peak(values, pbv, metric, noise_pct)
        if best is None:
            return None, curve, False   # everything failed
        nxt = None
        if best == max(values) and best * 2 <= hi_cap:
            nxt = best * 2
        elif best == min(values) and best // 2 >= lo_cap:
            nxt = best // 2
        if nxt is None or nxt in values:
            if best in (max(values), min(values)):
                print(f"  axis {axis}: peak {best} at hard cap / failure boundary — cannot bracket further")
            return best, curve, plateau
        print(f"  axis {axis}: peak at boundary ({best}) → extending grid with {nxt}")
        values.append(nxt); values.sort()
        if axis == "ub":
            for p in measure([nxt]): pbv[p["ub"]] = p
        else:
            for p in bench.measure(ubs=[fixed["ub"]], batch=nxt, fa=fixed["fa"],
                                   kv=fixed["kv"], depths=(fixed["depth"],)):
                pbv[p["batch"]] = p

# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True)
    ap.add_argument("--llama-bench", default=str(REPO / "bench/llamacpp/llama-bench"))
    ap.add_argument("--slug", default="sweep")
    ap.add_argument("--pp", type=int, default=8192, help="prefill size measured (tokens)")
    ap.add_argument("--tg", type=int, default=128, help="decode tokens measured")
    ap.add_argument("--depth", type=int, default=0, help="context depth for the axis sweeps (-d)")
    ap.add_argument("--ngl", type=int, default=99)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--metric", choices=["pp", "tg"], default="pp",
                    help="peak-search metric for ub/batch (both are always recorded)")
    ap.add_argument("--ub-grid", default="512,1024,2048")
    ap.add_argument("--batch-grid", default="2048,4096")
    ap.add_argument("--no-fa-check", action="store_true", help="skip the fa on/off A/B")
    ap.add_argument("--no-kv-check", action="store_true", help="skip the f16 vs q8_0 KV stage")
    ap.add_argument("--kv-depth", type=int, default=32768,
                    help="context depth for the KV A/B (decide at the TARGET depth, not at 0)")
    ap.add_argument("--kv-max-loss-pct", type=float, default=5.0)
    ap.add_argument("--noise-pct", type=float, default=3.0,
                    help="differences within this % are treated as a plateau (run-to-run noise)")
    ap.add_argument("--invocation-timeout", type=int, default=3600)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not pathlib.Path(a.model).is_file():
        sys.exit(f"model not found: {a.model}")
    if not os.access(a.llama_bench, os.X_OK):
        sys.exit(f"llama-bench not executable: {a.llama_bench}")

    stamp = datetime.datetime.now().strftime("%Y-%m-%d-%H%M")
    out = REPO / "bench/runs" / f"{stamp}-sweep-{a.slug}"
    out.mkdir(parents=True, exist_ok=True)
    env = setup_env()
    meta = [f"date={datetime.datetime.now().isoformat()}",
            f"host={os.uname().nodename} {os.uname().release}",
            *gpu_meta_lines(),
            f"llama_bench={a.llama_bench}", f"model={a.model}",
            f"sweep_args={vars(a)}"]
    (out / "meta.txt").write_text("\n".join(str(m) for m in meta) + "\n")
    print(f"sweep → {out}")

    bench = Bench(a, out, env)
    fixed = {"ub": int(a.ub_grid.split(",")[0]), "batch": int(a.batch_grid.split(",")[0]),
             "fa": "on", "kv": "f16", "depth": a.depth}
    summary = {"model": a.model, "llama_bench": a.llama_bench, "pp": a.pp, "tg": a.tg,
               "depth": a.depth, "metric": a.metric, "noise_pct": a.noise_pct, "axes": {}}

    # --- axis 1: ub ---
    print(f"\n== axis ub (grid {a.ub_grid}, metric {a.metric}, batch={fixed['batch']}) ==")
    best_ub, curve, plateau = sweep_numeric_axis(
        bench, "ub", [int(x) for x in a.ub_grid.split(",")], fixed, a.metric, a.noise_pct, UB_CAPS)
    if best_ub is None and not a.dry_run:
        sys.exit("ub sweep: all points failed — check llama-bench / model")
    if best_ub is not None:
        fixed["ub"] = best_ub
        fixed["batch"] = max(fixed["batch"], best_ub)
    summary["axes"]["ub"] = {"best": best_ub, "plateau_within_noise": plateau, "curve": curve}

    # --- axis 2: batch ---
    grid_b = sorted({max(int(x), fixed["ub"]) for x in a.batch_grid.split(",")})
    print(f"\n== axis batch (grid {grid_b}, ub={fixed['ub']}) ==")
    # batch cannot go below ub (llama.cpp clamps ub to b) — raise the lower cap accordingly
    batch_caps = (max(BATCH_CAPS[0], fixed["ub"]), BATCH_CAPS[1])
    best_b, curve, plateau = sweep_numeric_axis(
        bench, "batch", grid_b, fixed, a.metric, a.noise_pct, batch_caps)
    if best_b is not None:
        fixed["batch"] = best_b
    summary["axes"]["batch"] = {"best": best_b, "plateau_within_noise": plateau, "curve": curve}

    # --- axis 3: flash attention on/off ---
    if not a.no_fa_check:
        print(f"\n== axis fa (on vs off at ub={fixed['ub']} b={fixed['batch']}) ==")
        pts = {}
        for fa in ("on", "off"):
            for p in bench.measure(ubs=[fixed["ub"]], batch=fixed["batch"], fa=fa,
                                   kv=fixed["kv"], depths=(fixed["depth"],)):
                pts[fa] = p
        if pts and not a.dry_run:
            usable = {k: v for k, v in pts.items() if metric_of(v, a.metric) is not None}
            if usable:
                best_fa = max(usable, key=lambda k: metric_of(usable[k], a.metric) or 0.0)
                fixed["fa"] = best_fa
                summary["axes"]["fa"] = {
                    "best": best_fa,
                    "curve": [{"value": k, "pp": v.get("pp_ts"), "tg": v.get("tg_ts"),
                               "failed": v.get("failed", False)} for k, v in pts.items()]}

    # --- KV stage: f16 vs q8_0 at target depth, ≤N% acceptance rule ---
    if not a.no_kv_check:
        print(f"\n== KV A/B: f16 vs q8_0 at depth {a.kv_depth} "
              f"(accept q8_0 if pp AND tg loss ≤ {a.kv_max_loss_pct}%) ==")
        kvres = {}
        for kv in ("f16", "q8_0"):
            for p in bench.measure(ubs=[fixed["ub"]], batch=fixed["batch"], fa=fixed["fa"],
                                   kv=kv, depths=(a.kv_depth,)):
                kvres[kv] = p
        if not a.dry_run and "f16" in kvres and "q8_0" in kvres and \
           not kvres["f16"].get("failed") and not kvres["q8_0"].get("failed"):
            f16, q8 = kvres["f16"], kvres["q8_0"]
            d_pp = (q8.get("pp_ts", 0) - f16.get("pp_ts", 1)) / f16.get("pp_ts", 1) * 100
            d_tg = (q8.get("tg_ts", 0) - f16.get("tg_ts", 1)) / f16.get("tg_ts", 1) * 100
            vram_save = (f16.get("vram_peak_mib") or 0) - (q8.get("vram_peak_mib") or 0)
            accept = d_pp >= -a.kv_max_loss_pct and d_tg >= -a.kv_max_loss_pct
            if accept:
                fixed["kv"] = "q8_0"
            summary["kv_check"] = {
                "depth": a.kv_depth, "max_loss_pct": a.kv_max_loss_pct,
                "f16": {"pp": f16.get("pp_ts"), "tg": f16.get("tg_ts"),
                        "vram_peak_mib": f16.get("vram_peak_mib")},
                "q8_0": {"pp": q8.get("pp_ts"), "tg": q8.get("tg_ts"),
                         "vram_peak_mib": q8.get("vram_peak_mib")},
                "delta_pp_pct": round(d_pp, 2), "delta_tg_pct": round(d_tg, 2),
                "vram_saved_mib": vram_save,
                "verdict": "ACCEPT q8_0" if accept else "KEEP f16"}
            print(f"  Δpp={d_pp:+.1f}%  Δtg={d_tg:+.1f}%  VRAM saved={vram_save} MiB "
                  f"→ {summary['kv_check']['verdict']}")
        elif not a.dry_run:
            summary["kv_check"] = {"error": "one or both KV runs failed (likely OOM at depth) — "
                                            "that itself is a result: q8_0 may be REQUIRED to fit"}

    summary["recommended"] = fixed
    summary["recommended_server_cmd"] = (
        f"llama-server -m {a.model} -ngl {a.ngl} -fa {fixed['fa']} "
        f"-ub {fixed['ub']} -b {fixed['batch']} -ctk {fixed['kv']} -ctv {fixed['kv']} "
        f"-c <ctx> [--spec-type draft-mtp]")
    summary["n_invocations"] = bench.n_invocations
    (out / "sweep-summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\n== DONE ==\nrecommended: {fixed}\nsummary: {out}/sweep-summary.json")

if __name__ == "__main__":
    main()
