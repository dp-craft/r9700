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

CSV columns: unix_ts, vram_used_mib, vram_total_mib, gtt_used_mib, power_w
gtt_used_mib = GPU-accessible SYSTEM RAM in use. On a healthy VRAM-only run it stays ~flat at the
idle baseline; a rising GTT figure means the model/KV spilled into host RAM (the freeze risk) and
the run is NOT VRAM-only. Summary appended as a final comment line on SIGTERM/INT:
'# load_vram_used_mib=<first sample> peak_vram_used_mib=... peak_gtt_used_mib=... avg_power_w=... samples=...'
"""
import argparse, json, shutil, signal, subprocess, sys, time

def read_amd():
    out = subprocess.run(["rocm-smi", "--showmeminfo", "vram", "gtt", "--showpower", "--json"],
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
    return used, total, gtt, power

def read_nvidia():
    out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total,power.draw",
                          "--format=csv,noheader,nounits"],
                         capture_output=True, text=True, timeout=10).stdout
    used, total, power = [x.strip() for x in out.splitlines()[0].split(",")]
    return int(float(used)), int(float(total)), None, float(power)  # no GTT concept on NVIDIA

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

    with open(a.out, "w") as f:
        f.write("unix_ts,vram_used_mib,vram_total_mib,gtt_used_mib,power_w\n")
        while not stop:
            try:
                used, total, gtt, power = reader()
                f.write(f"{time.time():.1f},{used},{total},"
                        f"{'' if gtt is None else gtt},{'' if power is None else power}\n")
                f.flush()
                rows.append((used, gtt, power))
            except Exception:
                pass  # transient smi hiccup — keep sampling
            # sleep in small slices so signals interrupt promptly
            t_end = time.time() + a.interval
            while not stop and time.time() < t_end:
                time.sleep(0.1)
        if rows:
            load = rows[0][0]
            peak = max(r[0] for r in rows)
            gtts = [r[1] for r in rows if r[1] is not None]
            peak_gtt = max(gtts) if gtts else ""
            powers = [r[2] for r in rows if r[2] is not None]
            avg_p = f"{sum(powers)/len(powers):.1f}" if powers else "n/a"
            f.write(f"# load_vram_used_mib={load} peak_vram_used_mib={peak} "
                    f"peak_gtt_used_mib={peak_gtt} avg_power_w={avg_p} samples={len(rows)}\n")

if __name__ == "__main__":
    main()
