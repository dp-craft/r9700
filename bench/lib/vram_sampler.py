#!/usr/bin/env python3
"""
vram_sampler.py — sample GPU VRAM/power to CSV while a benchmark runs (AMD rocm-smi or
NVIDIA nvidia-smi; auto-detected). Catches OOM headroom and power/thermal throttling that a
start-of-run snapshot misses.

Usage (from a run script):
    python3 vram_sampler.py --out "$OUT/gpu_samples.csv" --interval 1 &
    SAMPLER_PID=$!
    ... run the benchmark ...
    kill $SAMPLER_PID

CSV columns: unix_ts, vram_used_mib, vram_total_mib, gtt_used_mib, power_w, temp_c, sclk_mhz,
             mclk_mhz, gpu_busy_pct
gtt_used_mib = GPU-accessible SYSTEM RAM in use. On a healthy VRAM-only run it stays ~flat at the
idle baseline; a rising GTT figure means the model/KV spilled into host RAM (the freeze risk) and
the run is NOT VRAM-only. Summary appended as a final comment line on SIGTERM/INT:
'# load_vram_used_mib=<first sample> peak_vram_used_mib=... peak_gtt_used_mib=... avg_power_w=... samples=...'

gpu_busy_pct + mclk_mhz exist to separate the two ways a run can be slow, which sclk alone CANNOT
distinguish (2026-07-16): a GPU that is DOWNCLOCKED (thermal/power limit → low sclk, but busy%
stays high) versus a GPU that is STARVED by a CPU-bound host loop (low sclk AND low busy% — the
DPM governor drops the clock because there is no work queued). The pp>0 / MTP decode collapse is
exactly this ambiguity: ~58% sclk at ~62% power reads as "throttling" until busy% shows the GPU is
simply idle-waiting on the host sampler. mclk is the companion read: a memory-bound decode holds
mclk pinned high even when sclk sags.
"""
import argparse, json, shutil, signal, subprocess, sys, time

import re as _re

def _digits(s):
    m = _re.search(r"\d+(?:\.\d+)?", str(s));  return float(m.group(0)) if m else None

def read_amd():
    out = subprocess.run(["rocm-smi", "--showmeminfo", "vram", "gtt", "--showpower",
                          "--showtemp", "--showclocks", "--showuse", "--json"],
                         capture_output=True, text=True, timeout=10).stdout
    card = next(iter(json.loads(out).values()))
    used = int(card["VRAM Total Used Memory (B)"]) // 2**20
    total = int(card["VRAM Total Memory (B)"]) // 2**20
    gtt = None
    for k in ("GTT Total Used Memory (B)", "GTT Used Memory (B)"):
        if k in card:
            try: gtt = int(card[k]) // 2**20
            except (ValueError, TypeError): pass
            break
    power = None
    for k, v in card.items():
        if "Power" in k:
            try: power = float(v)
            except ValueError: pass
            break
    temp = None                                   # edge temperature (°C)
    for k, v in card.items():
        if "Temperature" in k and "edge" in k.lower():
            temp = _digits(v); break
    sclk = None                                   # GPU core clock (MHz)
    for k, v in card.items():
        if "sclk" in k.lower() and "clock" in k.lower():
            sclk = _digits(v); break
    mclk = None                                   # memory clock (MHz)
    for k, v in card.items():
        if "mclk" in k.lower() and "clock" in k.lower():
            mclk = _digits(v); break
    busy = None                                   # "GPU use (%)" — 0 when the host starves the GPU
    for k, v in card.items():
        if "use" in k.lower() and "%" in k:
            busy = _digits(v); break
    return used, total, gtt, power, temp, sclk, mclk, busy

def read_nvidia():
    out = subprocess.run(["nvidia-smi",
                          "--query-gpu=memory.used,memory.total,power.draw,temperature.gpu,clocks.sm,"
                          "clocks.mem,utilization.gpu",
                          "--format=csv,noheader,nounits"],
                         capture_output=True, text=True, timeout=10).stdout
    parts = [x.strip() for x in out.splitlines()[0].split(",")]
    used, total, power, temp, sclk, mclk, busy = parts[:7]
    return (int(float(used)), int(float(total)), None, float(power),  # no GTT concept on NVIDIA
            _digits(temp), _digits(sclk), _digits(mclk), _digits(busy))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--interval", type=float, default=1.0)
    a = ap.parse_args()

    if shutil.which("rocm-smi"):
        reader = read_amd
    elif shutil.which("nvidia-smi"):
        reader = read_nvidia
    else:
        sys.exit("vram_sampler: neither rocm-smi nor nvidia-smi found")

    rows = []
    stop = False
    def on_sig(*_):
        nonlocal stop; stop = True
    signal.signal(signal.SIGTERM, on_sig)
    signal.signal(signal.SIGINT, on_sig)

    def _n(x): return "" if x is None else x
    with open(a.out, "w") as f:
        f.write("unix_ts,vram_used_mib,vram_total_mib,gtt_used_mib,power_w,temp_c,sclk_mhz,"
                "mclk_mhz,gpu_busy_pct\n")
        while not stop:
            try:
                used, total, gtt, power, temp, sclk, mclk, busy = reader()
                f.write(f"{time.time():.1f},{used},{total},{_n(gtt)},{_n(power)},{_n(temp)},"
                        f"{_n(sclk)},{_n(mclk)},{_n(busy)}\n")
                f.flush()
                rows.append((used, gtt, power, temp, sclk, mclk, busy))
            except Exception:
                pass  # transient smi hiccup — keep sampling
            # sleep in small slices so signals interrupt promptly
            t_end = time.time() + a.interval
            while not stop and time.time() < t_end:
                time.sleep(0.1)
        if rows:
            def _peak(i):
                vals = [r[i] for r in rows if r[i] is not None]
                return max(vals) if vals else ""
            def _avg(i):
                vals = [r[i] for r in rows if r[i] is not None]
                return f"{sum(vals)/len(vals):.1f}" if vals else "n/a"
            f.write(f"# load_vram_used_mib={rows[0][0]} peak_vram_used_mib={max(r[0] for r in rows)} "
                    f"peak_gtt_used_mib={_peak(1)} avg_power_w={_avg(2)} peak_power_w={_peak(2)} "
                    f"peak_temp_c={_peak(3)} avg_sclk_mhz={_avg(4)} peak_sclk_mhz={_peak(4)} "
                    f"avg_mclk_mhz={_avg(5)} peak_mclk_mhz={_peak(5)} "
                    f"avg_gpu_busy_pct={_avg(6)} peak_gpu_busy_pct={_peak(6)} "
                    f"samples={len(rows)}\n")

if __name__ == "__main__":
    main()
