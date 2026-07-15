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
import argparse, json, os, statistics as st, sys

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
            # worst/best over every reply in the cell — the mean alone hides the swing a user feels,
            # and "can a rerun rescue this?" is answered by best, not by the average.
            "ts_worst": (100 * min(_s)) if (_s := [r["score"] for r in tsr if r.get("score") is not None]) else None,
            "ts_best": (100 * max(_s)) if _s else None,
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
    """{task: {model: {...}}} from the haiku/sonnet/opus references — WITH the objective vector, so
    reference rows sit in the same columns as the local per-rep rows.

    REFERENCE REPS: a reference point may now carry several reps (add `"rep": N` to its calibration
    rows). At the measured rep noise (~9.6 pts) a SINGLE reference sample carries roughly ±19 pts —
    which is why the n=1 ladder could never be quoted as a like-for-like gap. Reps collapse that.
    Rows with no `rep` field keep file order, so legacy n=1 calibration files aggregate to exactly
    the same numbers as before.

    Per (task, model) we return: score = mean over reps · sd/n · hard_pass = ANY rep strictly clean
    (the tier's *existence* semantics, unchanged from n=1) · hard_pass_k = how many of n."""
    files = files or [os.path.join(HERE, "calibration.jsonl"), os.path.join(HERE, "calibration-hard.jsonl")]
    acc = {}
    for r in (row for p in files for row in jl(p)):
        t, m = r.get("task"), r.get("model")
        if t is None or m is None:
            continue
        acc.setdefault(t, {}).setdefault(m, []).append(r)
    out = {}
    for t, models in acc.items():
        out[t] = {}
        for m, rows in models.items():
            rows = sorted(rows, key=lambda r: r.get("rep", 0))
            scores = [r.get("score") for r in rows if r.get("score") is not None]
            hps = [bool(r.get("hard_pass")) for r in rows]
            out[t][m] = {
                "score": mean([r.get("score") for r in rows]),
                "sd": st.stdev(scores) if len(scores) > 1 else None,
                "n": len(rows),
                "reps": rows,
                "objectives": {k: mean([(r.get("objectives") or {}).get(k) for r in rows]) for k in OBJ_COLS},
                "hard_pass": any(hps),        # ANY rep clean → this tier can do it (needed by tier_evidence)
                "hard_pass_k": sum(hps),
            }
    return out


def _objrow(objs):
    return " | ".join(f((objs or {}).get(k), 2) for k in OBJ_COLS)


def calib_bands(run_task_ids, files=None):
    """Reference band per model, averaged over the run's tasks. Means per (model, task) FIRST, then
    across tasks — so a task with more reference reps cannot outweigh the others. Identical to the
    old row-wise mean when every reference point is n=1."""
    refs = calib_by_task_full(files)
    band = {}
    for t, models in refs.items():
        if run_task_ids and t not in run_task_ids:
            continue
        for m, d in models.items():
            if d.get("score") is not None:
                band.setdefault(m, []).append(d["score"])
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
         "| cell | model | depth | kv | budget | n | TS % | worst | best | hard % | judge/5 | judge d·c·r | think tok | ttfa s | full s | decode t/s | peak VRAM | peak GTT | runaway % | fails |",
         "|------|-------|-------|----|-------:|--:|-----:|------:|-----:|-------:|--------:|:-----------:|----------:|-------:|-------:|-----------:|----------:|---------:|----------:|------:|"]
    for l in order:
        c = cells[l]
        ja = c.get("judge_axes") or {}
        dcr = ("·".join(f(ja.get(ax), 1) for ax in ("design", "clarity", "robustness"))) if ja else "—"
        L.append(f"| {l} | {c['model']} | {c['depth']} | {c['kv']} | {c['budget']} | {c['n']} | "
                 f"{f(c['ts_pct'],0)} | {f(c.get('ts_worst'),0)} | {f(c.get('ts_best'),0)} | "
                 f"{f(c['hard_pct'],0)} | {f(c['judge'],1)} | {dcr} | {f(c['think_tok'],0)} | "
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


T_CRIT_95 = {1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262}


def _sdse(xs):
    """(mean, sd, se) — sd/se are None for n<2."""
    xs = [x for x in xs if isinstance(x, (int, float))]
    if not xs:
        return None, None, None
    if len(xs) < 2:
        return xs[0], None, None
    sd = st.stdev(xs)
    return st.mean(xs), sd, sd / len(xs) ** 0.5


def tier_evidence(task, refs):
    """TIER = the weakest REFERENCE tier that produces a strictly-clean **hard_pass** — it is NOT a score
    band (a task can be 'opus-tier' while every model scores 60-90% on partial credit). Recompute it from
    the measured calibration so a stale label (assigned under the old binary grader) cannot mislead."""
    rf = refs.get(task, {})
    seen, hp = [], None
    for m in ("haiku", "sonnet", "opus"):
        r = rf.get(m)
        if not r:
            seen.append(f"{m} n/a")
            continue
        ok = bool(r.get("hard_pass"))          # ANY rep strictly clean → the tier can do it
        n, k = r.get("n", 1), r.get("hard_pass_k", 0)
        # With reps, a bare ✓/✗ hides how RELIABLY the tier passes: 1/3 and 3/3 are both "✓" but mean
        # very different things. Show k/n whenever n>1; n=1 renders exactly as before.
        mark = ("✓" if ok else "✗") + (f"{k}/{n}" if n > 1 else "")
        seen.append(f"{m} {f(100*r['score'],0)}%{mark}")
        if ok and hp is None:
            hp = m
    return hp, " · ".join(seen)


def render_uncertainty(D, configs_path=None):
    """Uncertainty + significance — WITHOUT this the reader treats noise as shape. Reports per-cell
    sd/SE/95% CI, the within-(cell,task) rep noise, and a PAIRED-by-task t-test vs the Q4_K_M baseline
    (pairing removes task-difficulty variance = the most sensitive test available at this n)."""
    cfgs = {c["label"]: c for c in jl(configs_path or os.path.join(HERE, "configs.jsonl"))}
    ts = jl(f"{D}/scores_typescript.jsonl")
    if not ts:
        return ""
    tasks = list(dict.fromkeys(r.get("task_id") for r in ts))
    def sc(lbl, task=None):
        return [100 * r["score"] for r in ts if r.get("config") == lbl and r.get("score") is not None
                and (task is None or r.get("task_id") == task)]
    order = [l for l, _ in QUANT_LADDER] + [A3B_CELL]
    labels = [l for l in order if l in cfgs] + [l for l in cfgs if l not in order]
    L = ["", "## Uncertainty — is the ladder resolvable? (READ BEFORE QUOTING ANY Δ)", "",
         "| cell | n | TS % | sd | SE | 95% CI |", "|---|--:|--:|--:|--:|:--:|"]
    for lbl in labels:
        s = sc(lbl)
        if not s:
            continue
        m, sd, se = _sdse(s)
        ci = f"[{f(m-1.96*se,1)}, {f(m+1.96*se,1)}]" if se else "—"
        L.append(f"| {_cell_name(lbl, cfgs)} | {len(s)} | {f(m,1)} | {f(sd,1)} | {f(se,1)} | {ci} |")
    # within-(cell,task) rep noise
    reps_sd = [st.stdev(sc(l, t)) for l in labels for t in tasks if len(sc(l, t)) > 1]
    if reps_sd:
        msd = st.mean(reps_sd)
        L += ["", f"**Rep noise (MEASURED):** mean within-(cell,task) sd = **{f(msd,1)} pts** → SE of a "
              f"{len(sc(labels[0], tasks[0]))}-rep mean ≈ **{f(msd/max(len(sc(labels[0], tasks[0])),1)**0.5,1)} pts**. "
              f"A single-task cell-vs-cell gap must exceed ~**{f(2*1.96*msd/max(len(sc(labels[0], tasks[0])),1)**0.5,0)} pts** to beat rep noise alone."]
    # paired-by-task t-test vs baseline
    base = QUANT_LADDER[0][0]
    if base in cfgs:
        L += ["", f"### Paired Δ vs {_LADDER_NAME.get(base, base)} (by task — removes task-difficulty variance)", "",
              "| cell | Δ per task | meanΔ | sd | t | verdict |", "|---|---|--:|--:|--:|---|"]
        for lbl in labels:
            if lbl == base:
                continue
            d = [st.mean(sc(lbl, t)) - st.mean(sc(base, t)) for t in tasks if sc(lbl, t) and sc(base, t)]
            if len(d) < 2:
                continue
            m, sd, se = _sdse(d)
            tv = m / se if se else 0.0
            crit = T_CRIT_95.get(len(d) - 1, 2.0)
            verdict = "**SIGNIFICANT**" if abs(tv) > crit else f"not significant (|t|<{crit}, n={len(d)} tasks)"
            L.append(f"| {_cell_name(lbl, cfgs)} | {', '.join(f'{x:+.0f}' for x in d)} | **{f(m,1)}** | "
                     f"{f(sd,1)} | {f(tv,2)} | {verdict} |")
        if reps_sd:
            sd_d = st.mean([st.stdev([st.mean(sc(l, t)) - st.mean(sc(base, t)) for t in tasks])
                            for l in labels if l != base and all(sc(l, t) for t in tasks)] or [0])
            if sd_d:
                need = lambda dl: 2 * (1.96 + 0.84) ** 2 * sd_d ** 2 / dl ** 2
                L += ["", f"**Power (INFERRED):** with **{len(tasks)} tasks** this design resolves only "
                      f"**≳{f(2.776*sd_d/len(tasks)**0.5,0)} pts**. To detect Δ=10 pts needs ~**{need(10):.0f} tasks**; "
                      f"Δ=5 pts needs ~**{need(5):.0f} tasks** (reps do not help — task-to-task variance dominates)."]
    return "\n".join(L) + "\n"


def render_fluctuation(D, configs_path=None):
    """FLUCTUATION + RERUN VALUE — the mean hides the two things a user actually decides on: how much a
    cell swings, and whether re-rolling buys anything.

    Three ideas, kept distinct on purpose:
      * **worst / best**  — the raw extremes over every reply in the cell. Range = best - worst.
      * **rep sd**        — mean within-(cell,task) sd = how much the SAME cell varies on the SAME task.
        This is THE fluctuation number, and comparing it ACROSS cells is how "did this setting calm the
        model down?" gets answered (budget / temperature axes). Cell-level sd would be useless here: it
        is dominated by task difficulty, not by instability.
      * **best-of-R / Δ rerun** — per task take the BEST rep, then average over tasks. Δ rerun =
        best-of-R − mean = what re-rolling R times and keeping the winner buys you.

    Why best-of-R is honest here (and not oracle cheating): the pick is made by the TOOLCHAIN, not by a
    human who already knows the answer — tsc/eslint/vitest say which candidate is clean. `hard@R` (a task
    counts if ANY rep is strictly clean) is therefore a REAL, reproducible strategy for this task class,
    which is exactly why it is reported next to hard@1."""
    cfgs = {c["label"]: c for c in jl(configs_path or os.path.join(HERE, "configs.jsonl"))}
    ts = jl(f"{D}/scores_typescript.jsonl")
    if not ts:
        return ""
    tasks = list(dict.fromkeys(r.get("task_id") for r in ts))
    order = [l for l, _ in QUANT_LADDER] + [A3B_CELL]
    labels = [l for l in order if l in cfgs] + [l for l in cfgs if l not in order]

    def rows_of(lbl, task=None):
        return [r for r in ts if r.get("config") == lbl and r.get("score") is not None
                and (task is None or r.get("task_id") == task)]

    def sc(lbl, task=None):
        return [100 * r["score"] for r in rows_of(lbl, task)]

    L = ["", "## Fluctuation & rerun value (the mean hides both)", "",
         "_`rep sd` = mean within-(cell,task) sd — how much the same cell swings on the same task; compare it "
         "ACROSS cells to see whether a setting **changed** the fluctuation. `best-of-R` takes the best rep per "
         "task, then averages over tasks; `Δ rerun` = best-of-R − mean = what re-rolling buys. `hard@1` = "
         "per-reply strict-clean rate; `hard@R` = share of TASKS where **any** rep is strictly clean — the "
         "toolchain (tsc/eslint/vitest) picks the winner, so this is a real strategy, not an oracle._", "",
         "| cell | n | mean | worst | best | range | **rep sd** | best-of-R | **Δ rerun** | worst-of-R | hard@1 | **hard@R** |",
         "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|"]
    base_sd = None
    for lbl in labels:
        s = sc(lbl)
        if not s:
            continue
        per_task = [sc(lbl, t) for t in tasks if sc(lbl, t)]
        sds = [st.stdev(v) for v in per_task if len(v) > 1]
        rsd = st.mean(sds) if sds else None
        if base_sd is None and rsd is not None:
            base_sd = rsd
        bestR = mean([max(v) for v in per_task]) if per_task else None
        worstR = mean([min(v) for v in per_task]) if per_task else None
        m = st.mean(s)
        hp1 = pct([1 if r.get("hard_pass") else 0 for r in rows_of(lbl)])
        hpR = pct([1 if any(r.get("hard_pass") for r in rows_of(lbl, t)) else 0 for t in tasks if rows_of(lbl, t)])
        L.append(f"| {_cell_name(lbl, cfgs)} | {len(s)} | {f(m,1)} | {f(min(s),0)} | {f(max(s),0)} | "
                 f"{f(max(s)-min(s),0)} | **{f(rsd,1)}** | {f(bestR,1)} | **{f((bestR-m) if bestR is not None else None,1)}** | "
                 f"{f(worstR,1)} | {f(hp1,0)}% | **{f(hpR,0)}%** |")

    # change of fluctuation: rep sd per cell against the first cell (the campaign's baseline)
    if len(labels) > 1:
        ref = labels[0]
        rows = []
        for lbl in labels:
            sds = [st.stdev(sc(lbl, t)) for t in tasks if len(sc(lbl, t)) > 1]
            if sds:
                rows.append((lbl, st.mean(sds)))
        if len(rows) > 1 and base_sd:
            L += ["", f"**Change of fluctuation vs `{_cell_name(ref, cfgs)}` (rep sd, pts):**", "",
                  "| cell | rep sd | Δ sd vs baseline | steadier? |", "|---|--:|--:|:--:|"]
            for lbl, v in rows:
                d = v - base_sd
                mark = "—" if lbl == ref else ("✅ steadier" if d < -1 else ("⚠ noisier" if d > 1 else "≈ same"))
                L.append(f"| {_cell_name(lbl, cfgs)} | {f(v,1)} | {f(d,1) if lbl != ref else '—'} | {mark} |")
            L += ["", "_A Δ sd inside ±1 pt is not a change — rep sd is itself estimated from few reps._"]
    return "\n".join(L) + "\n"


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
         "references are one-shot. `— (no calib)` = reference point not yet collected (see README add-on D)._",
         "",
         "> **TIER is a difficulty class, NOT a score band.** It names the weakest REFERENCE tier that produces a "
         "strictly-clean **hard_pass** — so a task can be `tier opus` while every model scores 60–90% on partial "
         "credit. Each header below prints the label next to the MEASURED hard-pass evidence; trust the evidence.",
         "> **The references are NOT depth-matched:** they are one-shot on a ~550–620-token prompt, while local "
         "cells answer the same task at ~132.9k tokens (**~213× deeper**), and each reference is a single sample "
         "(n=1) vs the local n=3. Reference-vs-local Δ are therefore indicative only — do not quote them as a "
         "like-for-like capability gap.", ""]
    for task in tasks:
        tier = next((r.get("tier") for r in ts if r.get("task_id") == task and r.get("tier")), "?")
        hp, ev = tier_evidence(task, refs)
        measured = hp or "NONE (ceiling)"
        flag = "" if (hp == tier or (hp is None and tier == "opus")) else \
               f"  ⚠ **LABEL CONTRADICTED BY DATA** (label says `{tier}`, measured weakest hard-pass = `{measured}`)"
        L += [f"### {task} · tier `{tier}` — measured weakest hard-pass: **{measured}** ({ev}){flag}", "", hdr, sep]
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
            if m not in rf:
                L.append(f"| _{m}_ | – | — (no calib) | | " + " | ".join("—" for _ in OBJ_COLS) + " | | |")
                continue
            d = rf[m]
            reps = d.get("reps") or []
            if len(reps) > 1:      # multi-rep reference: every rep, then a mean row (as for local cells)
                for r in reps:
                    sc = None if r.get("score") is None else 100 * r["score"]
                    L.append(f"| _{m}_ ref | {r.get('rep',0)} | {f(sc,0)} | {'✓' if r.get('hard_pass') else '✗'} | "
                             f"{_objrow(r.get('objectives'))} | | |")
                L.append(f"| _**{m} — mean**_ | – | **{f(pct([r.get('score') for r in reps]),0)}** | "
                         f"{f(pct([1 if r.get('hard_pass') else 0 for r in reps]),0)}% | "
                         f"{_objrow(d.get('objectives'))} | | |")
            else:
                sc = None if d.get("score") is None else 100 * d["score"]
                L.append(f"| _{m}_ 1-shot | – | {f(sc,0)} | | {_objrow(d.get('objectives'))} | | |")
        L.append("")
    return "\n".join(L) + "\n"


def build_digest(D, out_path=None, configs_path=None, calib_files=None):
    cells = load_cells(D, configs_path)
    run_task_ids = {r.get("task_id") for r in jl(f"{D}/scores_typescript.jsonl")}
    bands = calib_bands(run_task_ids, calib_files)
    md = (render_md(cells, bands) + render_uncertainty(D, configs_path)
          + render_fluctuation(D, configs_path)
          + render_reps(D, configs_path, calib_files))
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
    # --by-task is ADDITIVE, as its help says. It used to `return` early, so summary.md and
    # summary_by_task.json could only ever be produced by two SEPARATE invocations — which is exactly
    # how they drifted apart (summary_by_task.json 16 min behind a corrected re-grade, 2026-07-15).
    # One invocation now writes both, from the same data, always.
    outp, cells, _, _ = build_digest(a.dir, a.out or None)
    print(f"wrote {outp} ({len(cells)} cells) + {outp.replace('.md', '.json')}")
    if a.by_task:
        if a.scores != "scores_typescript.jsonl":
            print(f"  NOTE: --scores {a.scores} applies to summary_by_task.json only; the digest above "
                  f"is built from scores_typescript.jsonl — do not compare them.", file=sys.stderr)
        outp2, by = build_by_task(a.dir, a.scores)
        print(f"wrote {outp2} ({len(by)} tasks) from {a.scores}")


if __name__ == "__main__":
    main()
