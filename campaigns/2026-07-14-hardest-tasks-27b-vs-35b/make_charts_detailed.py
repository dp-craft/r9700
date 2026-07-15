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
# color semantics (palette slots from make_charts). This campaign's axis is QUANT (fixed budget rb4096):
# cooler->warmer with rising precision across the 27B ladder, orange reserved for the 35B-A3B.
QUANT_ORDER = ["Q4_K_M", "Q4_K_XL", "Q5_K_M", "Q6_K"]     # 27B ladder, low -> high precision
MODEL_SLOT = {"Q4_K_M": 0, "Q4_K_XL": 1, "Q5_K_M": 4, "Q6_K": 5, "35B": 7}  # blue..red ladder / orange 35B
REF_SLOT = {"haiku": 7, "sonnet": 4, "opus": 3}          # orange / purple / green(ceiling)


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return st.mean(xs) if xs else None


def order_tasks(by):
    return [t for t in TASK_ORDER if t in by] + [t for t in by if t not in TASK_ORDER]


def mtag(model):
    """Quant/model tag for the 27B ladder + the 35B-A3B."""
    m = model or ""
    if "35B" in m:
        return "35B"
    if "Q4_K_XL" in m:
        return "Q4_K_XL"
    if "Q5_K_M" in m or "Q5" in m:
        return "Q5_K_M"
    if "Q6" in m:
        return "Q6_K"
    return "Q4_K_M"


def flabel(c):
    return mtag(c.get("model"))


def cslot(c):
    """Palette slot for a cell — by quant/model (the axis of this campaign)."""
    return MODEL_SLOT.get(mtag(c.get("model")), 0)


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

    # 27B quant ladder (low->high precision) present in the data, plus the 35B, per task
    def quant_cells(t):
        """[(tag, cell, slot)] in ladder order, then 35B, for cells that exist for task t."""
        cs = by[t]["cells"]
        out = []
        for lbl, tag in [("un-d128-f16-rb4096", "Q4_K_M"), ("xl-d128-f16-rb4096", "Q4_K_XL"),
                         ("q5-d128-q8-rb4096", "Q5_K_M"), ("q6-d128-q8-rb4096", "Q6_K"),
                         ("a3b-d128-f16-rb4096", "35B")]:
            c = cs.get(lbl)
            if c:
                out.append((tag, c, MODEL_SLOT[tag]))
        return out

    # D1 — capability per task: best 27B (any quant) & 35B vs the haiku/sonnet/opus ladder
    panels = []
    for t in tasks:
        cells = by[t]["cells"]; refs = by[t]["refs"]
        q27 = [c["ts_pct"] for c in cells.values()
               if c.get("ts_pct") is not None and mtag(c.get("model")) != "35B"]
        b35 = [c["ts_pct"] for c in cells.values()
               if c.get("ts_pct") is not None and mtag(c.get("model")) == "35B"]
        rows = [("27B best", max(q27) if q27 else None, MODEL_SLOT["Q6_K"]),
                ("35B", max(b35) if b35 else None, MODEL_SLOT["35B"])]
        for m in ("haiku", "sonnet", "opus"):
            if m in refs:
                rows.append((m, refs[m], REF_SLOT[m]))
        panels.append((f"{t}  ({by[t]['tier']})", "%", "{:.0f}", rows))
    files["d1_capability_by_task.svg"] = mc.small_multiples(
        "🎯 Capability per task — best 27B & 35B vs haiku / sonnet / opus one-shot", panels)

    # D2/D3 — the 27B quant ladder (Q4_K_M->Q6_K) + 35B: quality and output-token cost, per task
    def quant_rows(t, metric):
        return [(tag, c.get(metric), slot) for tag, c, slot in quant_cells(t)]
    files["d2_quant_quality.svg"] = mc.small_multiples(
        "🔎 Quant ladder → quality (TS %), per task — 27B Q4_K_M→Q4_K_XL→Q5_K_M→Q6_K vs 35B @128k f16 rb4096",
        [(t, "%", "{:.0f}", quant_rows(t, "ts_pct")) for t in tasks])
    files["d3_quant_cost.svg"] = mc.small_multiples(
        "💸 Quant ladder → output tokens (cost), per task — does higher precision change how much it writes?",
        [(t, " tok", "{:.0f}", quant_rows(t, "out_tok")) for t in tasks])

    # D4 — efficiency frontier: quality vs generation time, per task (color = quant/model)
    CFGS = [l for l in agg.jl(f"{D}/../configs.jsonl") if not l.get("optin")]
    max_tok = max((c.get("out_tok") or 0) for t in tasks for c in by[t]["cells"].values()) or 1
    sp = []
    for t in tasks:
        pts = []
        for cfg in CFGS:
            c = cell(t, cfg["label"])
            if c and c.get("gen_s") and c.get("ts_pct") is not None:
                pts.append((c["gen_s"], c["ts_pct"], (c.get("out_tok") or 0) / max_tok,
                            cslot(c), flabel(c), False))
        sp.append((f"{t}  ({by[t]['tier']})", pts))
    files["d4_efficiency_by_task.svg"] = scatter_panels(
        "⚡ Best quality for least time, per task (bubble = output tokens, color = quant/model, label = quant)", sp)

    # D5 — hard-pass rate (all gates clean at once) per cell, per task
    def hp_rows(t):
        return [(tag, c.get("hard_pct"), slot) for tag, c, slot in quant_cells(t)]
    files["d5_hardpass_by_task.svg"] = mc.small_multiples(
        "✅ Hard-pass rate (every gate objective clean at once) per task", [(t, "%", "{:.0f}", hp_rows(t)) for t in tasks])

    # D6 — headline head-to-head: full quant ladder + 35B, quality per task (@128k f16 rb4096)
    files["d6_model_by_task.svg"] = mc.small_multiples(
        "🤖 27B quant ladder + 35B-A3B → quality (TS %), per task (@128k f16, rb4096)",
        [(t, "%", "{:.0f}", quant_rows(t, "ts_pct")) for t in tasks])

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

    for name, content in files.items():
        open(f"{cdir}/{name}", "w").write(content)

    ap_lines = ["## Appendix — per-task detailed charts\n",
                "_Generated by `make_charts_detailed.py` (reuses the `make_charts.py` SVG toolkit). "
                "Colors: 27B quant ladder Q4_K_M→Q4_K_XL→Q5_K_M→Q6_K = blue→red; 35B-A3B = orange. "
                "All cells share one reasoning budget (rb4096) @128k f16._\n"]
    titles = [
        ("d1_capability_by_task.svg", "Capability per task — best 27B & 35B vs haiku/sonnet/opus"),
        ("d2_quant_quality.svg", "Quant ladder → quality, per task (27B Q4_K_M→Q6_K vs 35B)"),
        ("d3_quant_cost.svg", "Quant ladder → output-token cost, per task"),
        ("d4_efficiency_by_task.svg", "Efficiency frontier — quality vs generation time, per task"),
        ("d5_hardpass_by_task.svg", "Hard-pass rate (all gates clean) per task"),
        ("d6_model_by_task.svg", "27B quant ladder + 35B-A3B → quality, per task"),
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
