#!/usr/bin/env python3
"""make_charts.py — turn the campaign's Phase-A/B outputs into decision-oriented SVG charts +
an appendix.md snippet for the analysis write-up. Stdlib only; self-contained theme-aware SVGs
(light/dark via prefers-color-scheme), so they embed in Markdown and render offline.

Design (per the dataviz method):
  - ONE fixed categorical color per config, assigned in canonical order, reused across ALL charts
    (identity follows the entity, never cycled) — validated palette slots 1..8.
  - ONE axis per chart. Metrics of different magnitude (tokens vs tok/s vs MiB vs °C) are SEPARATE
    small-multiple charts, never a dual axis — this is how "visible differences / scaling" is kept.
  - Every mark is direct-labeled (the palette's low-contrast slots require this relief) + a data
    table is emitted, so nothing depends on color alone.

    python3 make_charts.py --dir out            # reads out/{outputs,vram,scores_*,judge_scores}.jsonl
                                                 # writes out/charts/*.svg + out/charts/appendix.md
"""
import argparse, json, os, statistics as st
from collections import defaultdict, OrderedDict

CANON = ["rico03-distilled", "unsloth-mtp-off", "unsloth-mtp-on", "hauhau-uncensored", "jackrong-qwopus"]
# validated categorical slots (light / dark) — see dataviz references/palette.md
SLOT_L = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"]
SLOT_D = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"]


def load_jsonl(p):
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p) if l.strip()]


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return st.mean(xs) if xs else None


# ---------- SVG toolkit ----------
def _style(n):
    css_l = ";".join(f"--s{i+1}:{SLOT_L[i]}" for i in range(n))
    css_d = ";".join(f"--s{i+1}:{SLOT_D[i]}" for i in range(n))
    return f"""<style>
:root{{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;{css_l}}}
@media (prefers-color-scheme:dark){{:root{{--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;{css_d}}}}}
text{{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}}
.t{{fill:var(--ink);font-weight:600}}.lab{{fill:var(--ink2)}}.mut{{fill:var(--muted)}}.val{{fill:var(--ink);font-variant-numeric:tabular-nums}}
</style>"""


def svg(w, h, body, n=8):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img">{_style(n)}<rect width="{w}" height="{h}" fill="var(--surface)"/>{body}</svg>')


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def hbar(title, rows, unit="", fmt="{:.0f}", w=720, sub=""):
    """rows: list of (label, value, slot_idx). One axis (x=value). Direct value labels."""
    rows = [r for r in rows if isinstance(r[1], (int, float))]
    pad_l, pad_r, top, rh, gap = 168, 74, 54, 26, 12
    h = top + len(rows) * (rh + gap) + 24
    vmax = max([r[1] for r in rows] + [1e-9]) * 1.12
    plot_w = w - pad_l - pad_r
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>']
    if sub:
        b.append(f'<text x="20" y="44" class="mut" font-size="11">{esc(sub)}</text>')
    for i, (lab, val, slot) in enumerate(rows):
        y = top + i * (rh + gap)
        bw = max(2, plot_w * val / vmax)
        b.append(f'<text x="{pad_l-10}" y="{y+rh*0.68}" text-anchor="end" class="lab" font-size="12.5">{esc(lab)}</text>')
        b.append(f'<rect x="{pad_l}" y="{y}" width="{bw:.1f}" height="{rh}" rx="4" fill="var(--s{slot+1})"/>')
        b.append(f'<text x="{pad_l+bw+8:.1f}" y="{y+rh*0.68}" class="val" font-size="12.5">{fmt.format(val)}{unit}</text>')
    return svg(w, int(h), "".join(b))


def stacked_tokens(title, rows, w=720):
    """rows: (label, think, answer, slot). think solid, answer at .55 opacity, 2px gap; total labeled."""
    rows = [r for r in rows if isinstance(r[1], (int, float))]
    pad_l, pad_r, top, rh, gap = 168, 96, 66, 26, 12
    h = top + len(rows) * (rh + gap) + 24
    vmax = max([(r[1] or 0) + (r[2] or 0) for r in rows] + [1e-9]) * 1.14
    plot_w = w - pad_l - pad_r
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>',
         '<text x="20" y="44" class="mut" font-size="11">bar = config color · solid = thinking · faded = answer · number = total tokens</text>']
    for i, (lab, think, ans, slot) in enumerate(rows):
        y = top + i * (rh + gap); think = think or 0; ans = ans or 0
        tw = plot_w * think / vmax; aw = plot_w * ans / vmax
        b.append(f'<text x="{pad_l-10}" y="{y+rh*0.68}" text-anchor="end" class="lab" font-size="12.5">{esc(lab)}</text>')
        b.append(f'<rect x="{pad_l}" y="{y}" width="{max(1,tw):.1f}" height="{rh}" rx="4" fill="var(--s{slot+1})"/>')
        b.append(f'<rect x="{pad_l+tw+2:.1f}" y="{y}" width="{max(1,aw):.1f}" height="{rh}" rx="4" fill="var(--s{slot+1})" opacity="0.5"/>')
        b.append(f'<text x="{pad_l+tw+aw+8:.1f}" y="{y+rh*0.68}" class="val" font-size="12.5">{think+ans:.0f}</text>')
    return svg(w, int(h), "".join(b))


def dumbbell(title, rows, w=720):
    """rows: (label, ttft, ttfa, slot). line = think_time; left dot ttft, right dot ttfa."""
    rows = [r for r in rows if isinstance(r[1], (int, float)) and isinstance(r[2], (int, float))]
    pad_l, pad_r, top, rh, gap = 168, 96, 66, 24, 16
    h = top + len(rows) * (rh + gap) + 34
    vmax = max([r[2] for r in rows] + [1e-9]) * 1.12
    plot_w = w - pad_l - pad_r
    def x(v): return pad_l + plot_w * v / vmax
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>',
         '<text x="20" y="44" class="mut" font-size="11">○ first token (ttft) — ● first ANSWER token (ttfa) · gap = time spent thinking (s)</text>']
    for i, (lab, ttft, ttfa, slot) in enumerate(rows):
        y = top + i * (rh + gap) + rh / 2
        b.append(f'<text x="{pad_l-10}" y="{y+4}" text-anchor="end" class="lab" font-size="12.5">{esc(lab)}</text>')
        b.append(f'<line x1="{x(ttft):.1f}" y1="{y}" x2="{x(ttfa):.1f}" y2="{y}" stroke="var(--s{slot+1})" stroke-width="3"/>')
        b.append(f'<circle cx="{x(ttft):.1f}" cy="{y}" r="6" fill="var(--surface)" stroke="var(--s{slot+1})" stroke-width="2.5"/>')
        b.append(f'<circle cx="{x(ttfa):.1f}" cy="{y}" r="7" fill="var(--s{slot+1})" stroke="var(--surface)" stroke-width="2"/>')
        b.append(f'<text x="{x(ttfa)+9:.1f}" y="{y+4}" class="val" font-size="12">{ttfa:.1f}s</text>')
    return svg(w, int(h), "".join(b))


def scatter_quality_cost(title, pts, w=720, h=470):
    """pts: (label, cost_tokens, quality_pct, slot). Headline decision chart (up-left = best).
    y is zoomed to the data band (padded) so near-equal configs separate; labels are decluttered
    vertically with leader lines and flip to the left of the marker near the right edge."""
    pts = [p for p in pts if isinstance(p[1], (int, float)) and isinstance(p[2], (int, float))]
    pad_l, pad_r, top, pad_b = 92, 96, 66, 58
    xmin, xmax = 0, max([p[1] for p in pts] + [1]) * 1.18
    qs = [p[2] for p in pts] or [0, 100]
    ymin = max(0, (min(qs) // 10) * 10 - 5); ymax = min(100, (max(qs) // 10) * 10 + 12)
    if ymax - ymin < 20: ymax = min(100, ymin + 20)
    pw, ph = w - pad_l - pad_r, h - top - pad_b
    def X(v): return pad_l + pw * (v - xmin) / (xmax - xmin)
    def Y(v): return top + ph * (1 - (v - ymin) / (ymax - ymin))
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>',
         '<text x="20" y="44" class="mut" font-size="11">↑ better quality · ← fewer tokens · so UP-and-LEFT is the efficient choice</text>']
    step = 5 if (ymax - ymin) <= 30 else 10
    gy = int(ymin)
    while gy <= ymax:                                  # recessive gridlines + y ticks
        b.append(f'<line x1="{pad_l}" y1="{Y(gy):.1f}" x2="{pad_l+pw}" y2="{Y(gy):.1f}" stroke="var(--grid)" stroke-width="1"/>')
        b.append(f'<text x="{pad_l-10}" y="{Y(gy)+4:.1f}" text-anchor="end" class="mut" font-size="11">{gy}</text>')
        gy += step
    b.append(f'<text x="{pad_l}" y="{h-16}" class="lab" font-size="12">mean tokens per task (cost →)</text>')
    b.append(f'<text x="20" y="{top+ph/2}" class="lab" font-size="12" transform="rotate(-90 20 {top+ph/2:.0f})" text-anchor="middle">quality %  ↑</text>')
    for gx in range(1, 5):
        xv = xmax * gx / 4
        b.append(f'<text x="{X(xv):.1f}" y="{h-40}" text-anchor="middle" class="mut" font-size="11">{xv:.0f}</text>')
    # markers
    for lab, cost, q, slot in pts:
        b.append(f'<circle cx="{X(cost):.1f}" cy="{Y(q):.1f}" r="8.5" fill="var(--s{slot+1})" stroke="var(--surface)" stroke-width="2"/>')
    # declutter labels vertically (leader line if moved); flip side near the right edge
    items = sorted([(X(c), Y(q), lab, slot) for lab, c, q, slot in pts], key=lambda p: p[1])
    placed = []
    for px, py, lab, slot in items:
        ly = py if not placed else max(py, placed[-1] + 16)
        placed.append(ly)
        left = px > pad_l + pw * 0.60
        tx = px - 13 if left else px + 13
        anc = "end" if left else "start"
        if abs(ly - py) > 2:
            lx = px - 10 if left else px + 10
            b.append(f'<line x1="{px:.1f}" y1="{py:.1f}" x2="{lx:.1f}" y2="{ly-4:.1f}" stroke="var(--muted)" stroke-width="1"/>')
        b.append(f'<text x="{tx:.1f}" y="{ly:.1f}" text-anchor="{anc}" class="val" font-size="12">{esc(lab)}</text>')
    return svg(w, h, "".join(b))


def small_multiples(title, panels, w=720):
    """panels: list of (panel_title, unit, fmt, [(label,val,slot)]). Each its own x-scale."""
    cols = 2
    pw = w // cols
    per_rows = max(len(p[3]) for p in panels)
    ph = 40 + per_rows * 22 + 20
    import math
    prows = math.ceil(len(panels) / cols)
    h = 52 + prows * ph
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>',
         '<text x="20" y="44" class="mut" font-size="11">each panel has its own scale — compare within a panel, not across</text>']
    for pi, (pt, unit, fmt, rows) in enumerate(panels):
        ox = (pi % cols) * pw + 16
        oy = 60 + (pi // cols) * ph
        rows = [r for r in rows if isinstance(r[1], (int, float))]
        vmax = max([r[1] for r in rows] + [1e-9]) * 1.15
        b.append(f'<text x="{ox}" y="{oy}" class="t" font-size="12.5">{esc(pt)}</text>')
        bw_area = pw - 150
        for i, (lab, val, slot) in enumerate(rows):
            y = oy + 12 + i * 22
            bw = max(2, bw_area * val / vmax)
            b.append(f'<text x="{ox+92}" y="{y+9}" text-anchor="end" class="lab" font-size="10.5">{esc(lab[:12])}</text>')
            b.append(f'<rect x="{ox+98}" y="{y}" width="{bw:.1f}" height="13" rx="3" fill="var(--s{slot+1})"/>')
            b.append(f'<text x="{ox+98+bw+5:.1f}" y="{y+10}" class="val" font-size="10.5">{fmt.format(val)}{unit}</text>')
    return svg(w, int(h), "".join(b))


def line_panels(title, xlabel, panels, w=720):
    """Connected-parameter view: a swept scalar on x (e.g. reasoning-budget), one colored line
    per series (e.g. model), a separate panel per metric (own y-scale). Each point direct-labeled;
    x uses categorical rank ticks so uneven / '∞' stops space evenly.
    panels: [(panel_title, unit, fmt, series)]  series: [(name, slot, [(xtick, y), ...])]"""
    import math
    cols = 2
    pw = w // cols
    ph = 150
    prows = math.ceil(len(panels) / cols)
    h = 70 + prows * ph
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>',
         f'<text x="20" y="44" class="mut" font-size="11">x = {esc(xlabel)} · one line per series · each panel its own y-scale · connect the dots to read the trend</text>']
    # shared categorical x ticks (union of all series ticks, in first-seen order)
    ticks = []
    for _, _, _, series in panels:
        for _, _, pts in series:
            for xt, _y in pts:
                if xt not in ticks:
                    ticks.append(xt)
    nx = max(len(ticks), 1)
    xpos = {t: i for i, t in enumerate(ticks)}
    for pi, (pt, unit, fmt, series) in enumerate(panels):
        ox = (pi % cols) * pw + 60
        oy = 74 + (pi // cols) * ph
        plot_w = pw - 96
        plot_h = ph - 66
        allv = [y for _, _, pts in series for _, y in pts if isinstance(y, (int, float))]
        if not allv:
            continue
        vmax = max(allv) * 1.14 or 1.0
        vmin = min(allv + [0])
        vmin = 0 if vmin >= 0 else vmin * 1.1
        def X(t): return ox + (plot_w * (xpos[t] + 0.5) / nx)
        def Y(v): return oy + plot_h * (1 - (v - vmin) / (vmax - vmin + 1e-9))
        b.append(f'<text x="{ox-6}" y="{oy-8}" class="t" font-size="12">{esc(pt)}</text>')
        # baseline + x ticks
        b.append(f'<line x1="{ox}" y1="{Y(vmin):.1f}" x2="{ox+plot_w}" y2="{Y(vmin):.1f}" stroke="var(--axis)" stroke-width="1"/>')
        for t in ticks:
            b.append(f'<text x="{X(t):.1f}" y="{oy+plot_h+15}" text-anchor="middle" class="mut" font-size="10">{esc(str(t))}</text>')
        for name, slot, pts in series:
            pts = [(t, y) for t, y in pts if isinstance(y, (int, float))]
            if not pts:
                continue
            d = " ".join(f"{'M' if i==0 else 'L'}{X(t):.1f} {Y(y):.1f}" for i, (t, y) in enumerate(pts))
            b.append(f'<path d="{d}" fill="none" stroke="var(--s{slot+1})" stroke-width="2.5"/>')
            for t, y in pts:
                b.append(f'<circle cx="{X(t):.1f}" cy="{Y(y):.1f}" r="4" fill="var(--s{slot+1})" stroke="var(--surface)" stroke-width="1.5"/>')
            lt, ly = pts[-1]
            b.append(f'<text x="{X(lt)+7:.1f}" y="{Y(ly)+4:.1f}" class="val" font-size="10.5" fill="var(--s{slot+1})">{esc(name)} {fmt.format(ly)}{unit}</text>')
    return svg(w, int(h), "".join(b))


def heatmap(title, configs, tasks, cell, w=760):
    """cell(config,task) -> (fill_css, label). Status-colored pass/fail/partial grid."""
    pad_l, top = 168, 90
    cw = (w - pad_l - 20) // max(len(tasks), 1)
    ch = 30
    h = top + len(configs) * (ch + 4) + 20
    b = [f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>',
         '<text x="20" y="44" class="mut" font-size="11">green = pass · red = fail · amber = truncated/partial · shaded = judge score</text>']
    for j, t in enumerate(tasks):                      # rotated column headers
        x = pad_l + j * cw + cw / 2
        b.append(f'<text x="{x:.1f}" y="{top-6}" text-anchor="start" class="mut" font-size="9.5" transform="rotate(-40 {x:.1f} {top-6})">{esc(t[:16])}</text>')
    for i, c in enumerate(configs):
        y = top + i * (ch + 4)
        b.append(f'<text x="{pad_l-10}" y="{y+ch*0.66}" text-anchor="end" class="lab" font-size="12">{esc(c)}</text>')
        for j, t in enumerate(tasks):
            x = pad_l + j * cw
            fill, labl = cell(c, t)
            b.append(f'<rect x="{x+2}" y="{y}" width="{cw-4}" height="{ch}" rx="3" fill="{fill}"/>')
            if labl:
                b.append(f'<text x="{x+cw/2:.1f}" y="{y+ch*0.66}" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">{esc(labl)}</text>')
    return svg(w, int(h), "".join(b), n=8)


# ---------- aggregation ----------
def slot_of(cfg, order):
    return order.index(cfg) if cfg in order else len(order)


def main():
    HERE = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "out"), help="dir with the Phase-A/B jsonl outputs")
    ap.add_argument("--charts", default=os.path.join(HERE, "charts"),
                    help="output dir for SVGs+appendix (default: campaign/charts, next to analysis.md)")
    ap.add_argument("--order", default="",
                    help="comma-separated config order (palette + row order); overrides CANON for this campaign")
    a = ap.parse_args()
    D = a.dir
    outs = [r for r in load_jsonl(f"{D}/outputs.jsonl") if "error" not in r]
    vram = load_jsonl(f"{D}/vram.jsonl")
    dets = load_jsonl(f"{D}/scores_deterministic.jsonl")
    judg = load_jsonl(f"{D}/judge_scores.jsonl")
    cdir = a.charts; cbase = os.path.basename(cdir.rstrip("/")); os.makedirs(cdir, exist_ok=True)

    seed = [c.strip() for c in a.order.split(",") if c.strip()] or CANON
    configs = [c for c in seed if any(r.get("config") == c for r in outs)]
    for r in outs:                                      # keep any config not named in the seed order
        if r.get("config") not in configs:
            configs.append(r["config"])
    order = configs

    by = lambda key: {c: [r.get(key) for r in outs if r.get("config") == c] for c in configs}
    tok_total = {c: mean(v) for c, v in by("total_tokens").items()}
    tok_think = {c: mean(v) for c, v in by("think_tokens").items()}
    tok_ans = {c: mean(v) for c, v in by("answer_tokens").items()}
    decode = {c: mean(v) for c, v in by("decode_tps").items()}
    prefill = {c: mean(v) for c, v in by("prefill_tps").items()}
    ttft = {c: mean(v) for c, v in by("ttft_s").items()}
    ttfa = {c: mean(v) for c, v in by("ttfa_s").items()}
    def _rate(c):
        m = mean([1 if r.get("truncated_thinking") else 0 for r in outs if r.get("config") == c])
        return 100 * m if m is not None else None
    trunc = {c: _rate(c) for c in configs}

    detpass = {}
    for c in configs:
        rows = [d for d in dets if d.get("config") == c]
        detpass[c] = 100 * sum(1 for d in rows if d.get("passed")) / len(rows) if rows else None
    judge_mean = {}
    for c in configs:
        rows = [j for j in judg if j.get("config") == c]
        vals = [mean([j.get("correctness"), j.get("depth"), j.get("clarity")]) for j in rows]
        judge_mean[c] = mean(vals) if vals else None
    vr = {v.get("config"): v for v in vram}

    S = lambda c: slot_of(c, order)
    files = OrderedDict()

    # 1. headline: quality vs cost
    pts = [(c.replace("-mtp", "‑mtp"), tok_total.get(c), detpass.get(c), S(c)) for c in configs]
    files["quality_vs_cost.svg"] = scatter_quality_cost(
        "Quality vs token cost — the efficient frontier", pts)
    # 2. deterministic pass rate
    files["quality_deterministic.svg"] = hbar(
        "Deterministic accuracy (objective, auto-graded)",
        sorted([(c, detpass.get(c), S(c)) for c in configs if detpass.get(c) is not None],
               key=lambda r: -(r[1] or 0)), unit="%", fmt="{:.0f}")
    # 3. judge score
    if any(judge_mean.get(c) is not None for c in configs):
        files["quality_judge.svg"] = hbar(
            "Open-ended quality (LLM-judge, mean of correctness/depth/clarity)",
            sorted([(c, judge_mean.get(c), S(c)) for c in configs if judge_mean.get(c) is not None],
                   key=lambda r: -(r[1] or 0)), unit="/5", fmt="{:.1f}")
    # 4. token economy
    files["token_economy.svg"] = stacked_tokens(
        "Token economy — thinking vs answer tokens per task",
        [(c, tok_think.get(c), tok_ans.get(c), S(c)) for c in configs])
    # 5. throughput (two panels, different scale)
    files["throughput.svg"] = small_multiples("Throughput", [
        ("Decode tok/s (higher = faster generation)", "", "{:.1f}",
         [(c, decode.get(c), S(c)) for c in configs]),
        ("Prefill tok/s (prompt ingest)", "", "{:.0f}",
         [(c, prefill.get(c), S(c)) for c in configs]),
    ])
    # 6. latency dumbbell
    files["latency.svg"] = dumbbell(
        "Latency — time to first token vs first ANSWER token",
        [(c, ttft.get(c), ttfa.get(c), S(c)) for c in configs])
    # 7. memory / power / thermal small multiples
    files["memory_power.svg"] = small_multiples("Memory · power · thermal (per config)", [
        ("Peak VRAM (MiB)", "", "{:.0f}", [(c, vr.get(c, {}).get("peak_vram_used_mib", vr.get(c, {}).get("vram_used_mib_at_load")), S(c)) for c in configs]),
        ("Peak GTT / host-RAM spill (MiB)", "", "{:.0f}", [(c, vr.get(c, {}).get("peak_gtt_used_mib"), S(c)) for c in configs]),
        ("Avg power (W)", "", "{:.0f}", [(c, vr.get(c, {}).get("avg_power_w"), S(c)) for c in configs]),
        ("Peak temp (°C)", "", "{:.0f}", [(c, vr.get(c, {}).get("peak_temp_c"), S(c)) for c in configs]),
    ])
    # 8. per-task heatmap
    tasks = list(dict.fromkeys([d.get("task_id") for d in dets] + [j.get("task_id") for j in judg]))
    det_idx = {(d.get("config"), d.get("task_id")): d for d in dets}
    jdg_idx = defaultdict(list)
    for j in judg:
        jdg_idx[(j.get("config"), j.get("task_id"))].append(j)
    GOOD, BAD, WARN = "#0ca30c", "#d03b3b", "#fab219"
    # sequential blue ramp (dataviz palette, step 250→650) for the 0..5 judge score
    JBLUE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]
    def cell(c, t):
        d = det_idx.get((c, t))
        if d is not None:
            if d.get("passed"):
                return (GOOD, "✓")
            return (WARN, "◐") if (d.get("detail") or "").startswith("timeout") else (BAD, "✗")
        js = jdg_idx.get((c, t))
        if js:
            sc = mean([mean([x.get("correctness"), x.get("depth"), x.get("clarity")]) for x in js]) or 0
            return (JBLUE[min(5, int(round(sc)))], f"{sc:.1f}")
        return ("var(--grid)", "")
    if tasks:
        files["task_heatmap.svg"] = heatmap("Per-task outcomes (config × task)", configs, tasks, cell)

    # 9. connected-parameter sweeps (optional): out/sweeps.json declares line charts over a swept
    #    scalar (e.g. reasoning-budget) so relationships read as trends, not unordered bars.
    METRICS = {  # metric key -> (pretty title, unit, fmt, value-dict)
        "det_pass_pct": ("Deterministic accuracy", "%", "{:.0f}", detpass),
        "judge_mean": ("LLM-judge quality", "/5", "{:.1f}", judge_mean),
        "think_tokens": ("Thinking tokens / task", "", "{:.0f}", tok_think),
        "answer_tokens": ("Answer tokens / task", "", "{:.0f}", tok_ans),
        "total_tokens": ("Total tokens / task", "", "{:.0f}", tok_total),
        "ttfa_s": ("Time to first ANSWER token", "s", "{:.0f}", ttfa),
        "ttft_s": ("Time to first token", "s", "{:.1f}", ttft),
        "decode_tps": ("Decode tok/s", "", "{:.0f}", decode),
        "prefill_tps": ("Prefill tok/s", "", "{:.0f}", prefill),
        "runaway_pct": ("Runaway rate", "%", "{:.0f}",
                        {c: trunc.get(c) for c in configs}),
    }
    sweeps = []
    if os.path.exists(f"{D}/sweeps.json"):                  # whole-file JSON array (not JSONL)
        sweeps = json.load(open(f"{D}/sweeps.json"))
    sweep_appendix = []
    for si, sw in enumerate(sweeps):
        panels = []
        for mk in sw.get("metrics", []):
            if mk not in METRICS:
                continue
            ptitle, unit, fmt, vals = METRICS[mk]
            series = []
            for ser in sw.get("series", []):
                pts = [(pt.get("tick", str(pt["x"])), vals.get(pt["config"])) for pt in ser["points"]]
                series.append((ser["name"], ser.get("slot", sw["series"].index(ser)), pts))
            panels.append((ptitle, unit, fmt, series))
        if not panels:
            continue
        fn = sw.get("file", f"sweep_{si}.svg")
        files[fn] = line_panels(sw.get("title", "Parameter sweep"), sw.get("xlabel", "x"), panels)
        sweep_appendix.append((fn, sw.get("title", "Parameter sweep")))

    for name, content in files.items():
        open(f"{cdir}/{name}", "w").write(content)

    # appendix.md
    ap_lines = ["## Appendix — charts\n",
                "_Generated by `make_charts.py`. One fixed color per config across all charts; "
                "each chart uses a single axis (differently-scaled metrics are separate panels). "
                "SVGs are theme-aware (light/dark)._\n"]
    order_titles = list(sweep_appendix) + [
        ("quality_vs_cost.svg", "Headline: quality vs token cost (up-and-left wins)"),
        ("quality_deterministic.svg", "Objective accuracy"),
        ("quality_judge.svg", "Open-ended quality (LLM-judge)"),
        ("token_economy.svg", "Token economy (thinking vs answer)"),
        ("throughput.svg", "Throughput (decode / prefill)"),
        ("latency.svg", "Latency (ttft → ttfa)"),
        ("memory_power.svg", "Memory, power & thermal"),
        ("task_heatmap.svg", "Per-task outcomes"),
    ]
    for fn, ti in order_titles:
        if fn in files:
            ap_lines.append(f"\n**{ti}**\n\n![{ti}]({cbase}/{fn})\n")
    # data table (relief for low-contrast slots + color-independent record)
    ap_lines.append("\n### Data table\n")
    ap_lines.append("| config | det % | judge/5 | think tok | ans tok | decode t/s | ttfa s | peak VRAM | trunc % |")
    ap_lines.append("|--------|------:|--------:|----------:|--------:|-----------:|-------:|----------:|--------:|")
    def f(x, d=0): return "—" if x is None else (f"{x:.{d}f}")
    for c in configs:
        v = vr.get(c, {})
        ap_lines.append(f"| {c} | {f(detpass.get(c))} | {f(judge_mean.get(c),1)} | {f(tok_think.get(c))} | "
                        f"{f(tok_ans.get(c))} | {f(decode.get(c),1)} | {f(ttfa.get(c),1)} | "
                        f"{f(v.get('peak_vram_used_mib', v.get('vram_used_mib_at_load')))} | {f(trunc.get(c))} |")
    open(f"{cdir}/appendix.md", "w").write("\n".join(ap_lines) + "\n")
    print(f"wrote {len(files)} charts + appendix.md -> {cdir}/")
    for n in files:
        print(f"  {n}")


if __name__ == "__main__":
    main()
