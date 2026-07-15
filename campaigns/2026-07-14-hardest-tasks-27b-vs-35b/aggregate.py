#!/usr/bin/env python3
"""aggregate.py — DETERMINISTIC digest of the depth run, so the analysis LLM never touches bulk JSON.

The summary step must not slurp the raw JSONL — `outputs.jsonl` alone is 60 full replies incl. thinking
(hundreds of thousands of tokens). This does ALL the arithmetic in Python and writes a compact
`out/summary.md` (+ `out/summary.json`): a per-cell table, a PER-REP detail table (every rep + the
haiku/sonnet/opus references), and the campaign's relational findings (quant ladder, 27B-vs-35B,
capability vs haiku/Sonnet/Opus). The LLM then only writes prose from this digest + `charts/appendix.md`
— it is explicitly told NOT to read the per-reply jsonl.

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


OBJ_COLS = ["types", "lint", "tests", "edge", "reuse", "bdd", "novj"]   # per-rep objective vector


def calib_by_task_full(files=None):
    """{task: {model: {score, objectives}}} from the haiku/sonnet/opus one-shots — WITH the objective
    vector, so reference rows sit in the same columns as the local per-rep rows."""
    files = files or [os.path.join(HERE, "calibration.jsonl"), os.path.join(HERE, "calibration-hard.jsonl")]
    out = {}
    for r in (row for p in files for row in jl(p)):
        t, m = r.get("task"), r.get("model")
        if t is None or m is None:
            continue
        out.setdefault(t, {})[m] = {"score": r.get("score"), "objectives": r.get("objectives") or {}}
    return out


def _objrow(objs):
    return " | ".join(f((objs or {}).get(k), 2) for k in OBJ_COLS)


def calib_bands(run_task_ids, files=None):
    files = files or [os.path.join(HERE, "calibration.jsonl"), os.path.join(HERE, "calibration-hard.jsonl")]
    rows = [r for p in files for r in jl(p)]
    band = {}
    for r in rows:
        if run_task_ids and r.get("task") not in run_task_ids:
            continue
        band.setdefault(r.get("model"), []).append(r.get("score"))
    return {m: pct(v) for m, v in band.items() if mean(v) is not None}


# 27B quant ladder, lowest -> highest precision. Single fixed reasoning budget (rb4096) this campaign;
# the budget sweep {0,2048,8192} is deferred to a follow-up campaign.
QUANT_LADDER = [("un-d128-f16-rb4096", "Q4_K_M"), ("xl-d128-f16-rb4096", "Q4_K_XL"),
                ("q5-d128-q8-rb4096", "Q5_K_M"), ("q6-d128-q8-rb4096", "Q6_K")]
A3B_CELL = "a3b-d128-f16-rb4096"


def findings(cells, bands):
    """This campaign's questions, answered numerically: the 27B quant ladder (Q4_K_M->Q6_K), 27B-vs-35B,
    the fractional lint/types wall, capability vs the ladder, and health (incl. harness grade-errors).
    All cells share one reasoning budget (rb4096); the budget sweep is a separate follow-up campaign."""
    out = []
    g = lambda label, k: (cells.get(label) or {}).get(k)

    ladder = [(name, g(lbl, "ts_pct")) for lbl, name in QUANT_LADDER]
    ladder = [(name, ts) for name, ts in ladder if ts is not None]
    if ladder:
        best_name = max(ladder, key=lambda p: p[1])[0]
        out.append("**(a) 27B quant ladder (TS% @163840 rb4096; KV f16, two heaviest quants on q8_0 → confound, see README; low→high precision):** "
                   + " → ".join(f"{name} {f(ts,0)}%" for name, ts in ladder)
                   + f" (best {best_name}). *(Does higher precision clear the strict lint/types wall?)*")

    # best 27B quant vs the 35B-A3B, at the shared budget
    u_best = max((ts for _, ts in ladder), default=None)
    a = g(A3B_CELL, "ts_pct")
    if u_best is not None and a is not None:
        out.append(f"**(b) 27B (best quant) vs 35B-A3B (TS%):** 27B {f(u_best,0)} vs 35B {f(a,0)} "
                   f"(Δ{f(a-u_best,0)}).")

    def omean(k):
        vs = [(v.get("objectives") or {}).get(k) for v in cells.values()]
        return mean([x for x in vs if isinstance(x, (int, float))])
    out.append(f"**(c) The strict-code wall (fractional, mean across cells):** "
               f"lint {f(omean('lint'),2)} · types {f(omean('types'),2)} · tests {f(omean('tests'),2)} · "
               f"edge {f(omean('edge'),2)} · reuse {f(omean('reuse'),2)}.")

    best = max((v for v in cells.values() if v.get("ts_pct") is not None), key=lambda v: v["ts_pct"] or 0, default=None)
    if best and bands:
        gaps = " · ".join(f"{m} {f(bands[m],0)}% (Δ{f(best['ts_pct']-bands[m],0)})" for m in ("haiku", "sonnet", "opus") if m in bands)
        out.append(f"**(d) Capability (hardest tasks):** best local cell = {f(best['ts_pct'],0)}% TS. Reference: {gaps}.")

    harness = [l for l, v in cells.items() if v.get("n_fail")]
    runaway = [l for l, v in cells.items() if (v.get("runaway_pct") or 0) > 0]
    gtt = [l for l, v in cells.items() if (v.get("peak_gtt") or 0) > 500]
    health = []
    if harness:
        health.append(f"**HARNESS/grade errors in: {', '.join(harness)}** — investigate, do NOT trust those scores")
    if runaway:
        health.append(f"runaway/truncation>0 in: {', '.join(runaway)} (watch expr-eval at depth; Q5/Q6 run q8_0 KV)")
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


_LADDER_NAME = dict(QUANT_LADDER); _LADDER_NAME[A3B_CELL] = "35B-A3B"


def _cell_name(label, cfgs):
    c = cfgs.get(label, {})
    name = _LADDER_NAME.get(label) or label     # label is unique → never collide if not in the ladder map
    return f"{name} ({c.get('kv', '?')})"


def render_reps(D, configs_path=None, calib_files=None):
    """Per-rep detail — for each hardest task, EVERY local rep (all objectives, no averaging), a mean
    row, and the haiku/sonnet/opus one-shot references in the SAME columns (existing calibration data;
    missing points, e.g. opus on lru-cache/rate-limiter, are marked). This is the 'see all 3 values'
    table the analysis inlines; it reads only small fields (never the bulk `response`)."""
    cfgs = {c["label"]: c for c in jl(configs_path or os.path.join(HERE, "configs.jsonl"))}
    ts = jl(f"{D}/scores_typescript.jsonl")
    if not ts:
        return ""
    out, jd = jl(f"{D}/outputs.jsonl"), jl(f"{D}/judge_scores.jsonl")
    think = {(r.get("config"), r.get("task_id"), r.get("rep", 0)): r.get("think_tokens") for r in out}
    jdix = {(r.get("config"), r.get("task_id"), r.get("rep", 0)): r for r in jd}
    refs = calib_by_task_full(calib_files)
    tasks = list(dict.fromkeys(r.get("task_id") for r in ts))
    order = [l for l, _ in QUANT_LADDER] + [A3B_CELL]
    labels = [l for l in order if l in cfgs] + [l for l in cfgs if l not in order]
    hdr = "| model (kv) | rep | TS % | hard | " + " | ".join(OBJ_COLS) + " | think | judge d·c·r |"
    sep = "|" + "---|" * (5 + len(OBJ_COLS) + 1)
    L = ["", "## Per-rep detail — every rep + haiku/sonnet/opus reference (nothing averaged away)", "",
         "_Local cells show all REPS individually (full objective vector 0–1) then a **mean** row; "
         "references are one-shot. `— (no calib)` = reference point not yet collected (see README add-on D)._", ""]
    for task in tasks:
        tier = next((r.get("tier") for r in ts if r.get("task_id") == task and r.get("tier")), "?")
        L += [f"### {task} · tier {tier}", "", hdr, sep]
        for label in labels:
            rows = sorted([r for r in ts if r.get("config") == label and r.get("task_id") == task],
                          key=lambda r: r.get("rep", 0))
            if not rows:
                continue
            disp = _cell_name(label, cfgs)
            for r in rows:
                rep, o = r.get("rep", 0), r.get("objectives") or {}
                j = jdix.get((label, task, rep)) or {}
                dcr = "·".join(f(j.get(x), 1) for x in ("design", "clarity", "robustness")) if j else "—"
                sc = None if r.get("score") is None else 100 * r["score"]
                he = "⚠ HARNESS" if r.get("grade_error") else ("✓" if r.get("hard_pass") else "✗")
                L.append(f"| {disp} | {rep} | {f(sc,0)} | {he} | {_objrow(o)} | "
                         f"{f(think.get((label, task, rep)),0)} | {dcr} |")
            mobj = {k: mean([(x.get('objectives') or {}).get(k) for x in rows]) for k in OBJ_COLS}
            L.append(f"| **{disp} — mean** | – | **{f(pct([x.get('score') for x in rows]),0)}** | "
                     f"{f(pct([1 if x.get('hard_pass') else 0 for x in rows]),0)}% | {_objrow(mobj)} | | |")
        rf = refs.get(task, {})
        for m in ("haiku", "sonnet", "opus"):
            if m in rf:
                d = rf[m]
                sc = None if d.get("score") is None else 100 * d["score"]
                L.append(f"| _{m}_ 1-shot | – | {f(sc,0)} | | {_objrow(d.get('objectives'))} | | |")
            else:
                L.append(f"| _{m}_ | – | — (no calib) | | " + " | ".join("—" for _ in OBJ_COLS) + " | | |")
        L.append("")
    return "\n".join(L) + "\n"


def build_digest(D, out_path=None, configs_path=None, calib_files=None):
    cells = load_cells(D, configs_path)
    run_task_ids = {r.get("task_id") for r in jl(f"{D}/scores_typescript.jsonl")}
    bands = calib_bands(run_task_ids, calib_files)
    md = render_md(cells, bands) + render_reps(D, configs_path, calib_files)
    out_path = out_path or f"{D}/summary.md"
    with open(out_path, "w") as fh:
        fh.write(md)
    with open(out_path.replace(".md", ".json"), "w") as fh:
        json.dump({"cells": cells, "bands": bands}, fh, indent=1)
    return out_path, cells, bands, md


# ---------------------------------------------------------------------------
# Per-TASK aggregation (for analysis_detailed.md): one record per (task, config),
# joined with judge notes + per-reply timing, plus per-task calibration references.
# Reads only SMALL fields from outputs.jsonl (drops the huge `response`). Lets the
# analysis LLM write task-level prose + charts without touching the raw jsonl.
# ---------------------------------------------------------------------------
OBJ_ALL = ["types", "lint", "tests", "edge", "reuse", "bdd", "novj"]


def calib_by_task(files=None):
    """{task: {model: score%}} from the calibration one-shots (haiku/sonnet/opus)."""
    files = files or [os.path.join(HERE, "calibration.jsonl"), os.path.join(HERE, "calibration-hard.jsonl")]
    out = {}
    for r in (row for p in files for row in jl(p)):
        t, m, s = r.get("task"), r.get("model"), r.get("score")
        if t is None or m is None or s is None:
            continue
        out.setdefault(t, {})[m] = 100 * s
    return out


def load_by_task(D, scores_file="scores_typescript.jsonl", configs_path=None):
    """Per (task, config) aggregate. `scores_file` selects the grade source (e.g. the corrected
    re-grade). Timing uses GENERATION time = (think+answer)/decode_tps — prefill-free, so the shared
    cold-prefill outlier (~300 s on the first task of a server) does not pollute per-task cost."""
    cfgs = {c["label"]: c for c in jl(configs_path or os.path.join(HERE, "configs.jsonl"))}
    ts = jl(f"{D}/{scores_file}")
    jd = jl(f"{D}/judge_scores.jsonl")
    out = jl(f"{D}/outputs.jsonl")
    o_idx = {}
    for r in out:
        o_idx.setdefault((r.get("config"), r.get("task_id")), []).append(r)
    tasks = list(dict.fromkeys(r.get("task_id") for r in ts))          # first-seen order
    refs = calib_by_task()
    by = {}
    for task in tasks:
        tier = next((r.get("tier") for r in ts if r.get("task_id") == task and r.get("tier")), None)
        cells = {}
        for label, c in cfgs.items():
            tsr = [r for r in ts if r.get("config") == label and r.get("task_id") == task]
            if not tsr:
                continue
            jdr = [r for r in jd if r.get("config") == label and r.get("task_id") == task]
            outr = o_idx.get((label, task), [])
            objs = {k: mean([(r.get("objectives") or {}).get(k) for r in tsr]) for k in OBJ_ALL}
            objs = {k: v for k, v in objs.items() if v is not None}
            think = mean([r.get("think_tokens") for r in outr])
            ans = mean([r.get("answer_tokens") for r in outr])
            gen = mean([((r.get("think_tokens") or 0) + (r.get("answer_tokens") or 0)) / r["decode_tps"]
                        for r in outr if r.get("decode_tps")])
            warm = min([r.get("ttft_s") for r in outr if isinstance(r.get("ttft_s"), (int, float))], default=None)
            cap = mean([1 if (r.get("truncated_thinking") or r.get("finish_reason") == "length") else 0 for r in outr])
            cells[label] = {
                "model": c.get("model", "").split(".gguf")[0], "depth": c.get("depth"), "kv": c.get("kv"),
                "budget": c.get("budget"), "mtp": c.get("mtp"), "n": len(tsr),
                "ts_pct": pct([r.get("score") for r in tsr]),
                "hard_pct": pct([1 if r.get("hard_pass") else 0 for r in tsr]),
                "objectives": objs,
                "judge": {ax: mean([r.get(ax) for r in jdr]) for ax in ("design", "clarity", "robustness")} if jdr else None,
                "judge_mean": mean([mean([r.get("design"), r.get("clarity"), r.get("robustness")]) for r in jdr]) if jdr else None,
                "notes": [{"rep": r.get("rep"), "design": r.get("design"), "clarity": r.get("clarity"),
                           "robustness": r.get("robustness"), "note": r.get("notes"),
                           "fails": {k: v for k, v in ((next((s for s in tsr if s.get("rep") == r.get("rep")), {}) or {})
                                     .get("objectives") or {}).items() if isinstance(v, (int, float)) and v < 1}}
                          for r in sorted(jdr, key=lambda x: x.get("rep") or 0)],
                "think_tok": think, "answer_tok": ans, "out_tok": (think + ans) if (think is not None and ans is not None) else None,
                "total_tok": mean([r.get("total_tokens") for r in outr]),
                "decode_tps": mean([r.get("decode_tps") for r in outr]),
                "gen_s": gen, "ttft_warm_s": warm, "cap_hit_pct": (100 * cap) if cap is not None else None,
            }
        by[task] = {"tier": tier, "refs": refs.get(task, {}), "cells": cells}
    return by


def cell_ts_by_scores(D, scores_file):
    """Per-config mean TS% for a given grade file — for the orig-vs-regrade correction table."""
    ts = jl(f"{D}/{scores_file}")
    labels = list(dict.fromkeys(r.get("config") for r in ts))
    return {l: pct([r.get("score") for r in ts if r.get("config") == l]) for l in labels}, \
           {l: pct([1 if r.get("hard_pass") else 0 for r in ts if r.get("config") == l]) for l in labels}


def build_by_task(D, scores_file="scores_typescript.jsonl", out_json=None):
    by = load_by_task(D, scores_file)
    out_json = out_json or f"{D}/summary_by_task.json"
    with open(out_json, "w") as fh:
        json.dump({"scores_file": scores_file, "by_task": by, "refs": calib_by_task()}, fh, indent=1)
    return out_json, by


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "out"))
    ap.add_argument("--out", default="")
    ap.add_argument("--by-task", action="store_true", help="also emit out/summary_by_task.json (per task×config)")
    ap.add_argument("--scores", default="scores_typescript.jsonl", help="grade file to aggregate (e.g. the corrected re-grade)")
    a = ap.parse_args()
    if a.by_task:
        outp, by = build_by_task(a.dir, a.scores)
        print(f"wrote {outp} ({len(by)} tasks) from {a.scores}")
        return
    outp, cells, _, _ = build_digest(a.dir, a.out or None)
    print(f"wrote {outp} ({len(cells)} cells) + {outp.replace('.md', '.json')}")


if __name__ == "__main__":
    main()
