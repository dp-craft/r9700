#!/usr/bin/env python3
"""aggregate.py — DETERMINISTIC digest of the depth run, so the analysis LLM never touches bulk JSON.

The summary step must not slurp the raw JSONL — `outputs.jsonl` alone is 120 full replies incl. thinking
(hundreds of thousands of tokens). This does ALL the arithmetic in Python and writes a compact
`out/summary.md` (+ `out/summary.json`): a per-cell table and the campaign's relational findings (budget
curve, depth delta, KV f16-vs-q8 A/B, capability vs haiku/Sonnet/Opus). The LLM then only writes prose
from this digest + `charts/appendix.md` — it is explicitly told NOT to read the per-reply jsonl.

  python3 aggregate.py --dir out --out out/summary.md
"""
import argparse, json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
GATES = ["types", "lint", "tests", "reuse", "edge"]


def jl(p):
    if not os.path.exists(p):
        return []
    with open(p) as fh:
        return [json.loads(l) for l in fh if l.strip()]


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return st.mean(xs) if xs else None


def pct(xs):
    m = mean(xs)
    return 100 * m if m is not None else None


def f(x, d=1):
    return "—" if x is None else f"{x:.{d}f}"


def load_cells(D, configs_path=None):
    """One aggregated record per config, keyed by configs.jsonl (authoritative depth/kv/budget/model).
    Reads only SMALL fields from outputs.jsonl (drops the huge `response`)."""
    cfgs = {c["label"]: c for c in jl(configs_path or os.path.join(HERE, "configs.jsonl"))}
    ts, jd, out = jl(f"{D}/scores_typescript.jsonl"), jl(f"{D}/judge_scores.jsonl"), jl(f"{D}/outputs.jsonl")
    vr = {v["config"]: v for v in jl(f"{D}/vram.jsonl")}
    cells = {}
    for label, c in cfgs.items():
        tsr = [r for r in ts if r.get("config") == label]
        jdr = [r for r in jd if r.get("config") == label]
        outr = [r for r in out if r.get("config") == label]
        if not tsr and not outr:
            continue                                    # cell not run
        objs = {k: mean([(r.get("objectives") or {}).get(k) for r in tsr]) for k in GATES}
        v = vr.get(label, {})
        runaway = mean([1 if (r.get("truncated_thinking") or
                              (r.get("finish_reason") == "length" and not r.get("has_answer"))) else 0
                        for r in outr])
        cells[label] = {
            "model": c.get("model", "").split(".gguf")[0], "depth": c.get("depth"), "kv": c.get("kv"),
            "budget": c.get("budget"), "n": len(tsr),
            "n_fail": sum(1 for r in tsr if r.get("grade_error")),
            "ts_pct": pct([r.get("score") for r in tsr]),
            "hard_pct": pct([1 if r.get("hard_pass") else 0 for r in tsr]),
            "objectives": objs,
            "judge": mean([mean([r.get("design"), r.get("clarity"), r.get("robustness")]) for r in jdr]) if jdr else None,
            "judge_axes": {ax: mean([r.get(ax) for r in jdr]) for ax in ("design", "clarity", "robustness")} if jdr else None,
            "think_tok": mean([r.get("think_tokens") for r in outr]),
            "ttfa_s": mean([r.get("ttfa_s") for r in outr]),
            "ttlt_s": mean([r.get("latency_s") for r in outr]),
            "decode_tps": mean([r.get("decode_tps") for r in outr]),
            "runaway_pct": (100 * runaway) if runaway is not None else None,
            "peak_vram": v.get("peak_vram_used_mib", v.get("vram_used_mib_at_load")),
            "peak_gtt": v.get("peak_gtt_used_mib"), "avg_power_w": v.get("avg_power_w"),
        }
    return cells


def calib_bands(run_task_ids, files=None):
    files = files or [os.path.join(HERE, "calibration.jsonl"), os.path.join(HERE, "calibration-hard.jsonl")]
    rows = [r for p in files for r in jl(p)]
    band = {}
    for r in rows:
        if run_task_ids and r.get("task") not in run_task_ids:
            continue
        band.setdefault(r.get("model"), []).append(r.get("score"))
    return {m: pct(v) for m, v in band.items() if mean(v) is not None}


def findings(cells, bands):
    """The campaign's four questions, answered numerically."""
    out = []
    g = lambda label, k: (cells.get(label) or {}).get(k)

    def curve(depth):
        pts = [(b, g(f"un-d{depth}-f16-rb{b}", "ts_pct"), g(f"un-d{depth}-f16-rb{b}", "hard_pct"))
               for b in (1024, 2048, 4096)]
        pts = [(b, ts, hp) for b, ts, hp in pts if ts is not None]
        if not pts:
            return None, None
        best = max(pts, key=lambda p: p[1])[0]
        return pts, best
    c64, best64 = curve("64")
    c128, best128 = curve("128")
    if c64 or c128:
        s = "**(a) Budget curve — does the optimum rise with depth?** unsloth-f16 TS% by budget:  "
        if c64:
            s += "64k: " + ", ".join(f"{b}→{f(ts,0)}%" for b, ts, _ in c64) + f" (peak {best64}). "
        if c128:
            s += "128k: " + ", ".join(f"{b}→{f(ts,0)}%" for b, ts, _ in c128) + f" (peak {best128}). "
        if best64 and best128:
            s += ("Optimum **rises** with depth." if best128 > best64
                  else "Optimum **holds** with depth." if best128 == best64 else "Optimum **falls** with depth.")
        out.append(s)

    a, b = g("un-d64-f16-rb2048", "ts_pct"), g("un-d128-f16-rb2048", "ts_pct")
    ar, br = (g("un-d64-f16-rb2048", "objectives") or {}).get("reuse"), (g("un-d128-f16-rb2048", "objectives") or {}).get("reuse")
    if a is not None and b is not None:
        out.append(f"**(b) Depth 64k→128k (budget 2048):** TS% {f(a,0)}→{f(b,0)} (Δ{f(b-a,0)}); "
                   f"reuse-objective {f(ar,2) if ar is not None else '—'}→{f(br,2) if br is not None else '—'} "
                   f"(the lost-in-the-middle sensor).")

    fkv, qkv = g("un-d128-f16-rb2048", "ts_pct"), g("un-d128-q8-rb2048", "ts_pct")
    fv, qv = g("un-d128-f16-rb2048", "peak_vram"), g("un-d128-q8-rb2048", "peak_vram")
    if fkv is not None and qkv is not None:
        d = qkv - fkv
        verdict = "within the ≤5% rule" if abs(d) <= 5 else "EXCEEDS 5% — q8 costs quality"
        vram = f"VRAM {f(fv,0)}→{f(qv,0)} MiB (saves {f(fv-qv,0) if (fv and qv) else '—'})" if (fv and qv) else ""
        out.append(f"**(c) KV f16 vs q8 @128k (budget 2048):** TS% {f(fkv,0)}→{f(qkv,0)} (Δ{f(d,1)}%, {verdict}). {vram}")

    best = max((v for v in cells.values() if v.get("ts_pct") is not None), key=lambda v: v["ts_pct"] or 0, default=None)
    if best and bands:
        gaps = " · ".join(f"{m} {f(bands[m],0)}% (Δ{f(best['ts_pct']-bands[m],0)})" for m in ("haiku", "sonnet", "opus") if m in bands)
        out.append(f"**(d) Capability:** best local cell = {f(best['ts_pct'],0)}% TS. Reference: {gaps}.")

    fails = [l for l, v in cells.items() if v.get("n_fail")]
    runaway = [l for l, v in cells.items() if (v.get("runaway_pct") or 0) > 0]
    gtt = [l for l, v in cells.items() if (v.get("peak_gtt") or 0) > 500]
    health = []
    if fails:
        health.append(f"grade errors in: {', '.join(fails)}")
    if runaway:
        health.append(f"runaway>0 in: {', '.join(runaway)}")
    if gtt:
        health.append(f"**GTT spill (>500 MiB) in: {', '.join(gtt)}** — freeze risk, flag loudly")
    out.append("**Health:** " + ("; ".join(health) if health else "no grade errors, no runaways, no GTT spill."))
    return out


def render_md(cells, bands):
    order = sorted(cells, key=lambda l: (cells[l]["model"], cells[l]["depth"] or "", cells[l]["kv"] or "", cells[l]["budget"] or 0))
    L = ["# Depth run — deterministic digest (`aggregate.py`)",
         "", "_All numbers computed in Python from out/*.jsonl. The analysis LLM writes prose from THIS "
         "+ charts/appendix.md — it does not read the per-reply jsonl._", "",
         "## Per-cell aggregates", "",
         "| cell | model | depth | kv | budget | n | TS % | hard % | judge/5 | judge d·c·r | think tok | ttfa s | full s | decode t/s | peak VRAM | peak GTT | runaway % | fails |",
         "|------|-------|-------|----|-------:|--:|-----:|-------:|--------:|:-----------:|----------:|-------:|-------:|-----------:|----------:|---------:|----------:|------:|"]
    for l in order:
        c = cells[l]
        ja = c.get("judge_axes") or {}
        dcr = ("·".join(f(ja.get(ax), 1) for ax in ("design", "clarity", "robustness"))) if ja else "—"
        L.append(f"| {l} | {c['model']} | {c['depth']} | {c['kv']} | {c['budget']} | {c['n']} | "
                 f"{f(c['ts_pct'],0)} | {f(c['hard_pct'],0)} | {f(c['judge'],1)} | {dcr} | {f(c['think_tok'],0)} | "
                 f"{f(c['ttfa_s'],1)} | {f(c['ttlt_s'],1)} | {f(c['decode_tps'],1)} | {f(c['peak_vram'],0)} | {f(c['peak_gtt'],0)} | "
                 f"{f(c['runaway_pct'],0)} | {c['n_fail']} |")
    L += ["", "## Findings (computed, not inferred)", ""]
    L += [f"- {s}" for s in findings(cells, bands)]
    return "\n".join(L) + "\n"


def build_digest(D, out_path=None, configs_path=None, calib_files=None):
    cells = load_cells(D, configs_path)
    run_task_ids = {r.get("task_id") for r in jl(f"{D}/scores_typescript.jsonl")}
    bands = calib_bands(run_task_ids, calib_files)
    md = render_md(cells, bands)
    out_path = out_path or f"{D}/summary.md"
    with open(out_path, "w") as fh:
        fh.write(md)
    with open(out_path.replace(".md", ".json"), "w") as fh:
        json.dump({"cells": cells, "bands": bands}, fh, indent=1)
    return out_path, cells, bands, md


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "out"))
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    outp, cells, _, _ = build_digest(a.dir, a.out or None)
    print(f"wrote {outp} ({len(cells)} cells) + {outp.replace('.md', '.json')}")


if __name__ == "__main__":
    main()
