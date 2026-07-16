#!/usr/bin/env python3
"""row.py — turn one llama-server /v1/chat/completions response (stdin) + its GPU sample CSV +
the server's CPU-time delta into one results.jsonl row. Used only by probe.sh in this run dir.

The three columns that carry this probe's argument:
  acceptance_pct  — from timings.draft_n / draft_n_accepted (was MTP's draft actually rejected?)
  reply_sha1      — sha1 of the whole assistant message (did the TOKENS change at all?)
  cpu_cores_used  — server CPU-seconds per wall-second (is the host, not the GPU, doing the work?)
"""
import hashlib, json, sys, statistics as st

label, arch, mtp, nmax, frag, csv, cpu0, cpu1, t0, t1 = sys.argv[1:11]

d = json.load(sys.stdin)
t = d["timings"]
m = d["choices"][0]["message"]
dn, da = t.get("draft_n", 0), t.get("draft_n_accepted", 0)

# GPU samples: keep only the ACTIVE window (busy>10%) so idle head/tail don't drag the mean.
sclk, busy, power, mclk, gtt = [], [], [], [], []
try:
    with open(csv) as f:
        hdr = f.readline().strip().split(",")
        ix = {n: i for i, n in enumerate(hdr)}
        for line in f:
            if line.startswith("#"):
                continue
            p = line.strip().split(",")
            def g(n):
                v = p[ix[n]] if ix.get(n) is not None and ix[n] < len(p) else ""
                return float(v) if v else None
            b = g("gpu_busy_pct")
            if b is None or b <= 10:
                continue
            busy.append(b)
            for arr, n in ((sclk, "sclk_mhz"), (power, "power_w"), (mclk, "mclk_mhz"), (gtt, "gtt_used_mib")):
                v = g(n)
                if v is not None:
                    arr.append(v)
except FileNotFoundError:
    pass

mean = lambda a: round(st.mean(a), 1) if a else None
# USER_HZ is 100 on Linux/x86_64: /proc stat ticks -> seconds.
wall = float(t1) - float(t0)
cpu_s = (float(cpu1) - float(cpu0)) / 100.0

row = {
    "label": label, "arch": arch, "mtp": int(mtp), "spec_draft_n_max": int(nmax),
    "sampler": json.loads("{" + frag + "}"),
    "decode_tps": round(t["predicted_per_second"], 2),
    "prefill_tps": round(t["prompt_per_second"], 2),
    "predicted_n": t["predicted_n"],
    "draft_n": dn, "draft_n_accepted": da,
    "acceptance_pct": round(100 * da / dn, 2) if dn else None,
    # k = draft tokens offered per speculation pass; llama.cpp emits a clean 3.00 at n-max 3.
    "draft_k_per_pass": round(dn / (t["predicted_n"] - da), 2) if (t["predicted_n"] - da) else None,
    "reply_sha1": hashlib.sha1(json.dumps(m, sort_keys=True).encode()).hexdigest()[:16],
    "reply_chars": len((m.get("reasoning_content") or "") + (m.get("content") or "")),
    "wall_s": round(wall, 2), "server_cpu_s": round(cpu_s, 2),
    "cpu_cores_used": round(cpu_s / wall, 2) if wall else None,
    "gpu_busy_pct_mean": mean(busy), "sclk_mhz_mean": mean(sclk), "mclk_mhz_mean": mean(mclk),
    "power_w_mean": mean(power), "gtt_used_mib_mean": mean(gtt), "gpu_samples_active": len(busy),
    "ctx": 4096, "kv": "f16", "build": "b9950-961e4b26a", "backend": "vulkan",
    "host_cpu": "Ryzen 5 3600 (6c/12t)",
}
print(json.dumps(row))
