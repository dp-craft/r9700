#!/usr/bin/env python3
"""Summarize a benchy_arms.sh campaign dir → markdown tables on stdout + summary.json in the dir.

Per arm and depth: benchy prefill/decode (mean ± sd, n=3), TTFT, MTP acceptance and mean accepted
length τ (tokens per verify step) over the 3 timed requests (server log `draft acceptance` lines:
1 coherence request, then per depth 1 warmup + 3 timed runs), ms per verify step = 1000·τ / decode,
VRAM@load / peak VRAM / peak GTT, memory-clock share and power from gpu_samples.csv.
Deltas vs the pooled baseline (base-mtp3 + base-mtp3-repeat, 6 runs) with Welch t.
rm_kq: interleaved llama-bench ABAB (stock vs rm_kq=1).
Per-position acceptance ("acc per pos") is not printed at llama-server's default verbosity.
"""
import json, math, re, statistics as st, sys
from pathlib import Path

camp = Path(sys.argv[1])
ARMS = ["base-mtp3", "mtp-nmax5", "mtp-ngram", "kvq8-mtp3", "pr-mtp3", "pr-adaptive12", "base-mtp3-repeat"]
BASE = ["base-mtp3", "base-mtp3-repeat"]
ACC = re.compile(r"draft acceptance = [\d.]+ \(\s*(\d+) accepted /\s*(\d+) generated\), mean len =\s*([\d.]+)")


def gpu(arm):
    d = Path((camp / f"{arm}.rundir").read_text().strip())
    lines = (d / "gpu_samples.csv").read_text().splitlines()
    summ = dict(re.findall(r"(\w+)=([\d.]+)", [l for l in lines if l.startswith("#")][-1]))
    rows = [l.split(",") for l in lines[1:] if l and not l.startswith("#")]
    busy = [r for r in rows if float(r[8]) >= 50]            # gpu_busy_pct ≥ 50 = inside a request
    hi = sum(1 for r in busy if float(r[7]) >= 1200)          # mclk ≥ 1200 of 1258 MHz max
    return {"vram_load": int(float(summ["load_vram_used_mib"])), "vram_peak": int(float(summ["peak_vram_used_mib"])),
            "gtt_peak": int(float(summ["peak_gtt_used_mib"])), "gtt_first": int(rows[0][3]),
            "avg_power_w": float(summ["avg_power_w"]), "mclk_hi_pct": round(100 * hi / len(busy), 1) if busy else None,
            "busy_samples": len(busy)}


def acceptance(arm):
    reqs = [(int(a), int(g), float(l)) for a, g, l in ACC.findall((camp / f"{arm}.server.log").read_text(errors="replace"))]
    if len(reqs) != 9:
        return None
    out = {}
    for depth, block in ((0, reqs[1:5]), (16384, reqs[5:9])):
        timed = block[1:]                                      # drop the per-test warmup request
        a, g = sum(x[0] for x in timed), sum(x[1] for x in timed)
        out[depth] = {"acc_pct": round(100 * a / g, 1), "mean_len": round(st.mean(x[2] for x in timed), 2)}
    return out


def welch(x, y):
    if len(x) < 2 or len(y) < 2:
        return None
    se = math.sqrt(st.variance(x) / len(x) + st.variance(y) / len(y))
    return round((st.mean(x) - st.mean(y)) / se, 1) if se else None


def grab(pat, s):
    m = re.search(pat, s)
    if not m:
        sys.exit(f"cmdline lacks {pat!r}")
    return m.group(1)


res = {}
for arm in ARMS:
    d = json.load(open(camp / f"{arm}.json"))
    cmd = (camp / f"{arm}.cmdline").read_text().strip()
    acc = acceptance(arm) or {}
    res[arm] = {"build": grab(r"build/([^/]+)/bin", cmd), "kv": grab(r"-ctk (\S+)", cmd),
                "spec": grab(r"(--spec-type .*)$", cmd), "gpu": gpu(arm), "depths": {}}
    for b in d["benchmarks"]:
        if b.get("is_context_prefill_phase"):
            continue
        dep = b["context_size"]
        x = {"pp": b["pp_throughput"]["values"], "tg": b["tg_throughput"]["values"],
             "ttft_s": round(b["e2e_ttft"]["mean"] / 1000, 2), **acc.get(dep, {})}
        if "mean_len" in x:
            x["ms_per_step"] = round(1000 * x["mean_len"] / st.mean(x["tg"]), 1)
        res[arm]["depths"][dep] = x

pool = {dep: {k: sum((res[a]["depths"][dep][k] for a in BASE), []) for k in ("pp", "tg")} for dep in (0, 16384)}
f = lambda v: f"{st.mean(v):.1f} ± {st.stdev(v):.1f}"

print("| Arm | Build | KV | Depth | Prefill t/s | Decode t/s | TTFT s | Accept. | τ | ms/step | VRAM@load | Peak VRAM | Peak GTT | mclk≥1200 | Power W |")
print("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for arm in ARMS:
    r, g = res[arm], res[arm]["gpu"]
    for dep, x in r["depths"].items():
        print(f"| {arm} | `{r['build']}` | {r['kv']} | {dep} | {f(x['pp'])} | {f(x['tg'])} | {x['ttft_s']} | "
              f"{x.get('acc_pct', '—')}% | {x.get('mean_len', '—')} | {x.get('ms_per_step', '—')} | {g['vram_load']} | "
              f"{g['vram_peak']} | {g['gtt_peak']} | {g['mclk_hi_pct']}% | {g['avg_power_w']:.0f} |")

print("\n| Arm | Depth | Prefill Δ vs pooled baseline (t) | Decode Δ vs pooled baseline (t) |")
print("|---|---:|---:|---:|")
for arm in ARMS:
    if arm in BASE:
        continue
    for dep, x in res[arm]["depths"].items():
        cells = [f"{100 * (st.mean(x[k]) / st.mean(pool[dep][k]) - 1):+.1f}% ({welch(x[k], pool[dep][k])})" for k in ("pp", "tg")]
        x["delta_vs_pooled_baseline"] = cells
        print(f"| {arm} | {dep} | {cells[0]} | {cells[1]} |")
for a_name, c_name in (("pr-adaptive12", "pr-mtp3"), ("base-mtp3-repeat", "base-mtp3")):
    for dep in (0, 16384):
        a, c = res[a_name]["depths"][dep], res[c_name]["depths"][dep]
        print(f"| {a_name} vs {c_name} | {dep} | {100 * (st.mean(a['pp']) / st.mean(c['pp']) - 1):+.1f}% ({welch(a['pp'], c['pp'])}) "
              f"| {100 * (st.mean(a['tg']) / st.mean(c['tg']) - 1):+.1f}% ({welch(a['tg'], c['tg'])}) |")

print("\n| rm_kq run | Build | pp512 t/s | tg128 t/s | run dir |")
print("|---|---|---:|---:|---|")
rk = {"stock": [], "rm_kq=1": []}
for i in range(1, 5):
    d = Path((camp / f"rmkq-{i}.rundir").read_text().strip())
    rows = json.load(open(d / "llama-bench.json"))
    pp = next(r for r in rows if r["n_prompt"] > 0 and r["n_gen"] == 0)
    tg = next(r for r in rows if r["n_gen"] > 0 and r["n_prompt"] == 0)
    key = "rm_kq=1" if "rmkq1-vulkan" in d.name else "stock"
    rk[key].append({"pp": pp["avg_ts"], "tg": tg["avg_ts"], "commit": pp["build_commit"], "dir": d.name})
    print(f"| {i} | {key} (`{pp['build_commit']}`) | {pp['avg_ts']:.1f} ± {pp['stddev_ts']:.1f} | "
          f"{tg['avg_ts']:.2f} ± {tg['stddev_ts']:.2f} | `{d.name}` |")
m = {k: (st.mean(x["pp"] for x in v), st.mean(x["tg"] for x in v)) for k, v in rk.items()}
print(f"\nrm_kq=1 vs stock (mean of 2 invocations each): prefill {100 * (m['rm_kq=1'][0] / m['stock'][0] - 1):+.2f}%, "
      f"decode {100 * (m['rm_kq=1'][1] / m['stock'][1] - 1):+.2f}%")

json.dump({"arms": res, "rm_kq": rk}, open(camp / "summary.json", "w"), indent=1)
