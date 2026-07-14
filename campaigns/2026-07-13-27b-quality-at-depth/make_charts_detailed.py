#!/usr/bin/env python3
"""make_charts_detailed.py — PER-TASK decision charts for analysis_detailed.md.

Reuse, don't fork (CLAUDE.md iron rule #6): this imports the shared dataviz-validated SVG toolkit
from campaigns/2026-07-12-27b-finetune-quality/make_charts.py (hbar / small_multiples / line_panels /
heatmap / svg / esc) and adds ONE new multi-dimensional primitive (scatter_panels) that the campaign
tool doesn't have. The campaign-level charts still come from make_charts.py; this only adds the
task-resolved views the detailed write-up needs. Input: out/summary_by_task.json (from
`aggregate.py --by-task --scores <corrected grade>`) + out/summary.json + the orig/corrected grade
files. Output: charts/detailed/*.svg + charts/detailed/appendix.md.

    python3 make_charts_detailed.py --dir out --charts charts/detailed \
        --scores scores_typescript_regraded.jsonl --orig scores_typescript.orig.jsonl
"""
import argparse, importlib.util, json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
MC_PATH = os.path.join(REPO, "campaigns", "2026-07-12-27b-finetune-quality", "make_charts.py")
_spec = importlib.util.spec_from_file_location("make_charts_shared", MC_PATH)
mc = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(mc)   # shared SVG toolkit
import aggregate as agg                                                     # per-task aggregation

# task order: sonnet-tier first (reachable), opus-tier ceilings last
TASK_ORDER = ["deep-equal", "store-remove", "rate-limiter", "lru-cache", "async-memo", "expr-eval"]
# color semantics (palette slots from make_charts): warmer = more thinking / deeper / weaker
BUD_SLOT = {1024: 0, 2048: 2, 4096: 5, 16384: 6}          # blue -> amber -> red
DEPTH_SLOT = {"64k": 1, "128k": 4}                        # green (shallow) -> purple (deep)
REF_SLOT = {"haiku": 7, "sonnet": 4, "opus": 3}          # orange / purple / green(ceiling)


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return st.mean(xs) if xs else None


def order_tasks(by):
    return [t for t in TASK_ORDER if t in by] + [t for t in by if t not in TASK_ORDER]


def flabel(c):
    m = "un" if (c.get("model") or "").startswith("Qwen") else "jr"
    b = {1024: "b1k", 2048: "b2k", 4096: "b4k", 16384: "b16k"}.get(c.get("budget"), str(c.get("budget")))
    return f"{m}·{c.get('depth')}·{b}·{c.get('kv')}"


# ---------- new multi-dimensional primitive: per-task efficiency scatter ----------
def scatter_panels(title, panels, w=760, sub=""):
    """panels: [(panel_title, [(x, y, size01, slot, label, best_bool), ...])]. Per-panel scales.
    x = generation seconds (→ slower), y = quality % (↑ better), bubble area ~ size01, color = slot
    (budget). UP-and-LEFT = best quality for least time. Only the best (up-left) point is labeled to
    stay readable."""
    import math
    cols = 2
    pw = w // cols
    ph = 200
    prows = math.ceil(len(panels) / cols)
    h = 78 + prows * ph
    b = [f'<text x="20" y="26" class="t" font-size="15">{mc.esc(title)}</text>',
         f'<text x="20" y="45" class="mut" font-size="11">{mc.esc(sub or "x = generation seconds (→ slower) · y = quality % (↑) · bubble = output tokens · color = reasoning budget · UP-and-LEFT wins")}</text>']
    for pi, (pt, pts) in enumerate(panels):
        pts = [p for p in pts if isinstance(p[0], (int, float)) and isinstance(p[1], (int, float))]
        ox = (pi % cols) * pw + 56
        oy = 74 + (pi // cols) * ph
        plot_w, plot_h = pw - 92, ph - 74
        xs = [p[0] for p in pts] or [0, 1]
        ys = [p[1] for p in pts] or [0, 100]
        xmin, xmax = min(xs) * 0.9, max(xs) * 1.12 + 1e-6
        ymin = max(0, (min(ys) // 10) * 10 - 5)
        ymax = min(100, (max(ys) // 10) * 10 + 12)
        if ymax - ymin < 15:
            ymax = min(100, ymin + 15)
        def X(v): return ox + plot_w * (v - xmin) / (xmax - xmin)
        def Y(v): return oy + plot_h * (1 - (v - ymin) / (ymax - ymin))
        b.append(f'<text x="{ox-6}" y="{oy-8}" class="t" font-size="12">{mc.esc(pt)}</text>')
        # y gridlines
        gy = int(ymin)
        stepy = 10 if (ymax - ymin) > 30 else 5
        while gy <= ymax:
            b.append(f'<line x1="{ox}" y1="{Y(gy):.1f}" x2="{ox+plot_w}" y2="{Y(gy):.1f}" stroke="var(--grid)" stroke-width="1"/>')
            b.append(f'<text x="{ox-6}" y="{Y(gy)+4:.1f}" text-anchor="end" class="mut" font-size="9">{gy}</text>')
            gy += stepy
        # x ticks (min & max seconds)
        for xv in (xmin / 0.9, xmax / 1.12):
            b.append(f'<text x="{X(xv):.1f}" y="{oy+plot_h+14}" text-anchor="middle" class="mut" font-size="9">{xv:.0f}s</text>')
        for x, y, s01, slot, _lab, _best in pts:
            r = 4 + 9 * (s01 ** 0.5)
            b.append(f'<circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="{r:.1f}" fill="var(--s{slot+1})" '
                     f'fill-opacity="0.78" stroke="var(--surface)" stroke-width="1.5"/>')
        # label only the best point (highest y, tie-break lowest x)
        if pts:
            bestp = min(pts, key=lambda p: (-p[1], p[0]))
            bx, byy = X(bestp[0]), Y(bestp[1])
            side = -1 if bx > ox + plot_w * 0.5 else 1
            b.append(f'<text x="{bx + side*11:.1f}" y="{byy+4:.1f}" text-anchor="{"end" if side<0 else "start"}" '
                     f'class="val" font-size="10">★ {mc.esc(bestp[4])}</text>')
    return mc.svg(w, int(h), "".join(b), n=8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "out"))
    ap.add_argument("--charts", default=os.path.join(HERE, "charts", "detailed"))
    ap.add_argument("--scores", default="scores_typescript_regraded.jsonl")
    ap.add_argument("--orig", default="scores_typescript.orig.jsonl")
    a = ap.parse_args()
    D, cdir = a.dir, a.charts
    os.makedirs(cdir, exist_ok=True)
    cbase = "/".join(cdir.rstrip("/").split("/")[-2:])   # e.g. "charts/detailed" for markdown links

    by = json.load(open(f"{D}/summary_by_task.json"))["by_task"]
    tasks = order_tasks(by)
    files = {}

    def cell(task, label):
        return by[task]["cells"].get(label)

    # D1 — capability per task vs the haiku/sonnet/opus ladder (corrected grades)
    panels = []
    for t in tasks:
        cells = by[t]["cells"]; refs = by[t]["refs"]
        locs = [c["ts_pct"] for c in cells.values() if c.get("ts_pct") is not None]
        rows = [("27B best", max(locs) if locs else None, 0), ("27B avg", mean(locs), 1)]
        for m in ("haiku", "sonnet", "opus"):
            if m in refs:
                rows.append((m, refs[m], REF_SLOT[m]))
        panels.append((f"{t}  ({by[t]['tier']})", "%", "{:.0f}", rows))
    files["d1_capability_by_task.svg"] = mc.small_multiples(
        "🎯 Capability per task — 27B (corrected) vs haiku / sonnet / opus one-shot", panels)

    # D2 — reasoning-budget × depth -> QUALITY, per task (unsloth f16)
    def budget_series(t, metric):
        s = []
        for depth in ("64k", "128k"):
            pts = []
            for bud in (1024, 2048, 4096):
                c = cell(t, f"un-d{depth.replace('k','')}-f16-rb{bud}")
                if c:
                    pts.append(({1024: "1k", 2048: "2k", 4096: "4k"}[bud], c.get(metric)))
            if pts:
                s.append((depth, DEPTH_SLOT[depth], pts))
        return s
    files["d2_budget_depth_quality.svg"] = mc.line_panels(
        "🧠 Reasoning budget × depth → quality (TS %), per task — unsloth f16",
        "reasoning budget (thinking-token cap)",
        [(t, "%", "{:.0f}", budget_series(t, "ts_pct")) for t in tasks if budget_series(t, "ts_pct")])

    # D3 — reasoning-budget × depth -> COST (output tokens), per task
    files["d3_budget_depth_cost.svg"] = mc.line_panels(
        "💸 Reasoning budget × depth → output tokens (cost), per task — unsloth f16",
        "reasoning budget (thinking-token cap)",
        [(t, " tok", "{:.0f}", budget_series(t, "out_tok")) for t in tasks if budget_series(t, "out_tok")])

    # D4 — efficiency frontier: quality vs generation time, per task (all unsloth cells)
    UN = [l for l in agg.jl(f"{D}/../configs.jsonl") if l["label"].startswith("un-") and not l.get("optin")]
    max_tok = max((c.get("out_tok") or 0) for t in tasks for c in by[t]["cells"].values()) or 1
    sp = []
    for t in tasks:
        pts = []
        for cfg in UN:
            c = cell(t, cfg["label"])
            if c and c.get("gen_s") and c.get("ts_pct") is not None:
                pts.append((c["gen_s"], c["ts_pct"], (c.get("out_tok") or 0) / max_tok,
                            BUD_SLOT.get(c["budget"], 0), flabel(c), False))
        sp.append((f"{t}  ({by[t]['tier']})", pts))
    files["d4_efficiency_by_task.svg"] = scatter_panels(
        "⚡ Best quality for least time, per task — unsloth (bubble = output tokens, color = budget)", sp)

    # D5 — KV f16 vs q8 -> quality, per task (128k, budget 2048)
    def kv_rows(t):
        out = []
        for lbl, nm, slot in [("un-d128-f16-rb2048", "unsloth f16", 0), ("un-d128-q8-rb2048", "unsloth q8", 2),
                              ("jr-d128-f16-rb2048", "jackrong f16", 7), ("jr-d128-q8-rb2048", "jackrong q8", 5)]:
            c = cell(t, lbl)
            if c:
                out.append((nm, c.get("ts_pct"), slot))
        return out
    files["d5_kv_by_task.svg"] = mc.small_multiples(
        "📉 KV precision f16 vs q8 → quality (TS %) at 128k · budget 2048, per task",
        [(t, "%", "{:.0f}", kv_rows(t)) for t in tasks])

    # D6 — model unsloth vs jackrong -> quality, per task (128k f16 b2048 + 64k f16 b2048)
    def model_rows(t):
        out = []
        for lbl, nm, slot in [("un-d128-f16-rb2048", "unsloth 128k", 0), ("jr-d128-f16-rb2048", "jackrong 128k", 7),
                              ("un-d64-f16-rb2048", "unsloth 64k", 1), ("jr-d64-f16-rb2048", "jackrong 64k", 5)]:
            c = cell(t, lbl)
            if c:
                out.append((nm, c.get("ts_pct"), slot))
        return out
    files["d6_model_by_task.svg"] = mc.small_multiples(
        "🤖 Model — unsloth vs jackrong → quality (TS %), per task (f16 · budget 2048)",
        [(t, "%", "{:.0f}", model_rows(t)) for t in tasks])

    # D7 — judge axes (design/clarity/robustness) per task, averaged over cells
    def judge_rows(t):
        cells = list(by[t]["cells"].values())
        return [("design", mean([(c.get("judge") or {}).get("design") for c in cells]), 0),
                ("clarity", mean([(c.get("judge") or {}).get("clarity") for c in cells]), 2),
                ("robustness", mean([(c.get("judge") or {}).get("robustness") for c in cells]), 5)]
    files["d7_judge_axes_by_task.svg"] = mc.small_multiples(
        "⚖️ Blind-judge profile (design / clarity / robustness, /5) per task",
        [(t, "", "{:.1f}", judge_rows(t)) for t in tasks])

    # D8 — objective heatmap: WHERE each task fails (mean objective over all cells, corrected)
    OBJ = ["types", "lint", "tests", "edge", "reuse", "bdd", "novj"]
    RAMP = ["#e06666", "#f0a860", "#f6d24b", "#c6d94a", "#8ec96a", "#4fb06a"]   # 0..1 red->green
    def ocell(t, k):
        vals = [(c.get("objectives") or {}).get(k) for c in by[t]["cells"].values()]
        v = mean(vals)
        if v is None:
            return ("var(--grid)", "–")
        return (RAMP[min(5, int(round(v * 5)))], f"{v:.2f}")
    files["d8_objective_by_task.svg"] = mc.heatmap(
        "🔬 Where each task fails — mean objective across all configs (green=clean, red=fails)",
        tasks, OBJ, ocell)

    # D9 — data correction: original (broken vitest) vs corrected re-grade, per config
    orig_ts, _ = agg.cell_ts_by_scores(D, a.orig)
    corr_ts, _ = agg.cell_ts_by_scores(D, a.scores)
    labels = [l["label"] for l in agg.jl(f"{D}/../configs.jsonl") if l["label"] in corr_ts]
    files["d9_correction.svg"] = mc.small_multiples(
        "🛠️ Data correction — grader re-run recovers the real scores (TS %)", [
            ("Original run — vitest FAILED (tests/edge=0)", "%", "{:.0f}", [(l, orig_ts.get(l), 5) for l in labels]),
            ("Corrected re-grade — vitest runs", "%", "{:.0f}", [(l, corr_ts.get(l), 1) for l in labels]),
        ])

    for name, content in files.items():
        open(f"{cdir}/{name}", "w").write(content)

    ap_lines = ["## Appendix — per-task detailed charts\n",
                "_Generated by `make_charts_detailed.py` (reuses the `make_charts.py` SVG toolkit). "
                "Colors: budget 1k/2k/4k = blue/amber/red; depth 64k/128k = green/purple. "
                "All quality numbers use the CORRECTED re-grade._\n"]
    titles = [
        ("d9_correction.svg", "Data correction — original broken grade vs corrected re-grade"),
        ("d1_capability_by_task.svg", "Capability per task vs haiku/sonnet/opus"),
        ("d2_budget_depth_quality.svg", "Reasoning budget × depth → quality, per task"),
        ("d3_budget_depth_cost.svg", "Reasoning budget × depth → output-token cost, per task"),
        ("d4_efficiency_by_task.svg", "Efficiency frontier — quality vs generation time, per task"),
        ("d5_kv_by_task.svg", "KV f16 vs q8 → quality, per task"),
        ("d6_model_by_task.svg", "Model unsloth vs jackrong → quality, per task"),
        ("d7_judge_axes_by_task.svg", "Blind-judge design/clarity/robustness, per task"),
        ("d8_objective_by_task.svg", "Objective heatmap — where each task fails"),
    ]
    for fn, ti in titles:
        if fn in files:
            ap_lines.append(f"\n**{ti}**\n\n![{ti}]({cbase}/{fn})\n")
    open(f"{cdir}/appendix.md", "w").write("\n".join(ap_lines) + "\n")
    print(f"wrote {len(files)} detailed charts + appendix.md -> {cdir}/")
    for n in files:
        print(" ", n)


if __name__ == "__main__":
    main()
