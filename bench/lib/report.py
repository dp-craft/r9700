#!/usr/bin/env python3
"""report.py — turn a benchmark run/campaign dir into decision-oriented, theme-aware **SVG** charts
plus an `appendix.md` snippet that embeds them (so the charts live INSIDE the Markdown write-up,
which is the repo's actual deliverable — not a separate HTML file nobody opens).

Stdlib only; self-contained SVGs (light/dark via prefers-color-scheme). Auto-detects the run kind:

  quality     outputs.jsonl (+ scores_deterministic.jsonl, judge_scores.jsonl, vram.jsonl)
              → quality-vs-cost frontier, deterministic accuracy, judge score, token economy,
                throughput, latency (ttft→ttfa), memory/power/thermal, per-task heatmap
  throughput  results.jsonl (aggregate rows from capture_engine probe, + gpu row)
              → depth curves, concurrency scaling, thinking ttfa, memory — per engine
  sweep       sweep-summary.json (+ sweep-log.jsonl) from model-bench
              → -ub / -b tuning curves + VRAM, KV f16-vs-q8_0 verdict

Design (the dataviz method): ONE fixed categorical color per entity (config/engine), assigned in a
stable order and reused across EVERY chart — never cycled. ONE axis per chart; differently-scaled
metrics become separate small-multiple panels, never a dual axis. Every mark is direct-labeled and a
color-independent data table is emitted, so nothing depends on color alone.

    python3 report.py RUN_DIR [RUN_DIR ...]          # writes <dir>/charts/*.svg + <dir>/appendix.md
    python3 report.py CAMPAIGN_DIR --charts DIR --appendix FILE
"""
import argparse, json, math, os, statistics as st
from collections import defaultdict, OrderedDict

# validated categorical slots (light / dark) — dataviz references/palette.md
SLOT_L = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"]
SLOT_D = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"]
GOOD, BAD, WARN = "#0ca30c", "#d03b3b", "#fab219"          # status palette (fixed, never themed)
JBLUE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]   # sequential blue 0..5


# ============================================================ small helpers
def load_jsonl(path):
    if path and os.path.exists(path):
        return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    return []


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float)) and not isinstance(x, bool)]
    return st.mean(xs) if xs else None


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def nice_max(v):
    """A rounded axis maximum a bit above v (1/2/2.5/5 × 10ⁿ)."""
    if v <= 0:
        return 1.0
    exp = math.floor(math.log10(v))
    base = 10 ** exp
    for m in (1, 2, 2.5, 5, 10):
        if v <= m * base * 1.001:
            return m * base
    return 10 * base


# ============================================================ SVG scaffold
def _style(n):
    css_l = ";".join(f"--s{i+1}:{SLOT_L[i]}" for i in range(n))
    css_d = ";".join(f"--s{i+1}:{SLOT_D[i]}" for i in range(n))
    return (f"<style>:root{{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;"
            f"--grid:#e1e0d9;--axis:#c3c2b7;{css_l}}}"
            f"@media (prefers-color-scheme:dark){{:root{{--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;"
            f"--muted:#898781;--grid:#2c2c2a;--axis:#383835;{css_d}}}}}"
            "text{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}"
            ".t{fill:var(--ink);font-weight:600}.lab{fill:var(--ink2)}.mut{fill:var(--muted)}"
            ".val{fill:var(--ink);font-variant-numeric:tabular-nums}</style>")


def svg(w, h, body, n=8):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img">{_style(n)}<rect width="{w}" height="{h}" fill="var(--surface)"/>{body}</svg>')


def _title(b, title, sub=""):
    b.append(f'<text x="20" y="26" class="t" font-size="15">{esc(title)}</text>')
    if sub:
        b.append(f'<text x="20" y="44" class="mut" font-size="11">{esc(sub)}</text>')


# ============================================================ chart primitives
def hbar(title, rows, unit="", fmt="{:.0f}", w=720, sub=""):
    """rows: (label, value, slot). One axis (x=value); direct value labels."""
    rows = [r for r in rows if isinstance(r[1], (int, float))]
    if not rows:
        return None
    pad_l, pad_r, top, rh, gap = 168, 74, 54, 26, 12
    h = top + len(rows) * (rh + gap) + 24
    vmax = max([r[1] for r in rows] + [1e-9]) * 1.12
    plot_w = w - pad_l - pad_r
    b = []; _title(b, title, sub)
    for i, (lab, val, slot) in enumerate(rows):
        y = top + i * (rh + gap)
        bw = max(2, plot_w * val / vmax)
        b.append(f'<text x="{pad_l-10}" y="{y+rh*0.68:.0f}" text-anchor="end" class="lab" font-size="12.5">{esc(lab)}</text>')
        b.append(f'<rect x="{pad_l}" y="{y}" width="{bw:.1f}" height="{rh}" rx="4" fill="var(--s{slot+1})"/>')
        b.append(f'<text x="{pad_l+bw+8:.1f}" y="{y+rh*0.68:.0f}" class="val" font-size="12.5">{fmt.format(val)}{unit}</text>')
    return svg(w, int(h), "".join(b))


def stacked_tokens(title, rows, w=720):
    """rows: (label, think, answer, slot). think solid, answer .5 opacity, total labeled."""
    rows = [r for r in rows if isinstance(r[1], (int, float)) or isinstance(r[2], (int, float))]
    if not rows:
        return None
    pad_l, pad_r, top, rh, gap = 168, 96, 66, 26, 12
    h = top + len(rows) * (rh + gap) + 24
    vmax = max([(r[1] or 0) + (r[2] or 0) for r in rows] + [1e-9]) * 1.14
    plot_w = w - pad_l - pad_r
    b = []; _title(b, title, "bar = config color · solid = thinking · faded = answer · number = total tokens")
    for i, (lab, think, ans, slot) in enumerate(rows):
        y = top + i * (rh + gap); think = think or 0; ans = ans or 0
        tw = plot_w * think / vmax; aw = plot_w * ans / vmax
        b.append(f'<text x="{pad_l-10}" y="{y+rh*0.68:.0f}" text-anchor="end" class="lab" font-size="12.5">{esc(lab)}</text>')
        b.append(f'<rect x="{pad_l}" y="{y}" width="{max(1,tw):.1f}" height="{rh}" rx="4" fill="var(--s{slot+1})"/>')
        b.append(f'<rect x="{pad_l+tw+2:.1f}" y="{y}" width="{max(1,aw):.1f}" height="{rh}" rx="4" fill="var(--s{slot+1})" opacity="0.5"/>')
        b.append(f'<text x="{pad_l+tw+aw+8:.1f}" y="{y+rh*0.68:.0f}" class="val" font-size="12.5">{think+ans:.0f}</text>')
    return svg(w, int(h), "".join(b))


def dumbbell(title, rows, w=720, sub="○ first token (ttft) — ● first ANSWER token (ttfa) · gap = thinking time (s)"):
    """rows: (label, left, right, slot). line = gap; ○ left, ● right."""
    rows = [r for r in rows if isinstance(r[1], (int, float)) and isinstance(r[2], (int, float))]
    if not rows:
        return None
    pad_l, pad_r, top, rh, gap = 168, 96, 66, 24, 16
    h = top + len(rows) * (rh + gap) + 34
    vmax = max([max(r[1], r[2]) for r in rows] + [1e-9]) * 1.12
    plot_w = w - pad_l - pad_r
    def x(v): return pad_l + plot_w * v / vmax
    b = []; _title(b, title, sub)
    for i, (lab, lo, hi, slot) in enumerate(rows):
        y = top + i * (rh + gap) + rh / 2
        b.append(f'<text x="{pad_l-10}" y="{y+4:.0f}" text-anchor="end" class="lab" font-size="12.5">{esc(lab)}</text>')
        b.append(f'<line x1="{x(lo):.1f}" y1="{y}" x2="{x(hi):.1f}" y2="{y}" stroke="var(--s{slot+1})" stroke-width="3"/>')
        b.append(f'<circle cx="{x(lo):.1f}" cy="{y}" r="6" fill="var(--surface)" stroke="var(--s{slot+1})" stroke-width="2.5"/>')
        b.append(f'<circle cx="{x(hi):.1f}" cy="{y}" r="7" fill="var(--s{slot+1})" stroke="var(--surface)" stroke-width="2"/>')
        b.append(f'<text x="{x(hi)+9:.1f}" y="{y+4:.0f}" class="val" font-size="12">{hi:.1f}s</text>')
    return svg(w, int(h), "".join(b))


def scatter_quality_cost(title, pts, w=720, h=470,
                         sub="↑ better quality · ← fewer tokens · so UP-and-LEFT is the efficient choice",
                         xlab="mean tokens per task (cost →)", ylab="quality %  ↑"):
    """pts: (label, x_cost, y_quality, slot). Headline: up-and-left wins. y zoomed to the data band,
    labels decluttered vertically with leader lines, flipped left near the right edge."""
    pts = [p for p in pts if isinstance(p[1], (int, float)) and isinstance(p[2], (int, float))]
    if not pts:
        return None
    pad_l, pad_r, top, pad_b = 92, 96, 66, 58
    xmax = max([p[1] for p in pts] + [1]) * 1.18
    qs = [p[2] for p in pts]
    ymin = max(0, (min(qs) // 10) * 10 - 5); ymax = min(100, (max(qs) // 10) * 10 + 12)
    if ymax - ymin < 20:
        ymax = min(100, ymin + 20)
    pw, ph = w - pad_l - pad_r, h - top - pad_b
    def X(v): return pad_l + pw * v / xmax
    def Y(v): return top + ph * (1 - (v - ymin) / (ymax - ymin))
    b = []; _title(b, title, sub)
    step = 5 if (ymax - ymin) <= 30 else 10
    gy = int(ymin)
    while gy <= ymax:
        b.append(f'<line x1="{pad_l}" y1="{Y(gy):.1f}" x2="{pad_l+pw}" y2="{Y(gy):.1f}" stroke="var(--grid)" stroke-width="1"/>')
        b.append(f'<text x="{pad_l-10}" y="{Y(gy)+4:.1f}" text-anchor="end" class="mut" font-size="11">{gy}</text>')
        gy += step
    b.append(f'<text x="{pad_l}" y="{h-16}" class="lab" font-size="12">{esc(xlab)}</text>')
    b.append(f'<text x="20" y="{top+ph/2:.0f}" class="lab" font-size="12" transform="rotate(-90 20 {top+ph/2:.0f})" text-anchor="middle">{esc(ylab)}</text>')
    for gx in range(1, 5):
        xv = xmax * gx / 4
        b.append(f'<text x="{X(xv):.1f}" y="{h-40}" text-anchor="middle" class="mut" font-size="11">{xv:.0f}</text>')
    for lab, cost, q, slot in pts:
        b.append(f'<circle cx="{X(cost):.1f}" cy="{Y(q):.1f}" r="8.5" fill="var(--s{slot+1})" stroke="var(--surface)" stroke-width="2"/>')
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
    """panels: (panel_title, unit, fmt, [(label,val,slot)]). Each panel its OWN x-scale."""
    panels = [p for p in panels if any(isinstance(r[1], (int, float)) for r in p[3])]
    if not panels:
        return None
    cols = 2
    pw = w // cols
    per_rows = max((len(p[3]) for p in panels), default=1)
    ph = 40 + per_rows * 22 + 20
    prows = math.ceil(len(panels) / cols)
    h = 52 + prows * ph
    b = []; _title(b, title, "each panel has its own scale — compare within a panel, not across")
    for pi, (pt, unit, fmt, rows) in enumerate(panels):
        ox = (pi % cols) * pw + 16
        oy = 60 + (pi // cols) * ph
        rows = [r for r in rows if isinstance(r[1], (int, float))]
        vmax = max([r[1] for r in rows] + [1e-9]) * 1.15
        b.append(f'<text x="{ox}" y="{oy}" class="t" font-size="12.5">{esc(pt)}</text>')
        bw_area = pw - 178
        for i, (lab, val, slot) in enumerate(rows):
            y = oy + 12 + i * 22
            bw = max(2, bw_area * val / vmax)
            dlab = str(lab)[9:] if str(lab).startswith("llamacpp-") else str(lab)
            b.append(f'<text x="{ox+108}" y="{y+9}" text-anchor="end" class="lab" font-size="10">{esc(dlab[:16])}</text>')
            b.append(f'<rect x="{ox+114}" y="{y}" width="{bw:.1f}" height="13" rx="3" fill="var(--s{slot+1})"/>')
            b.append(f'<text x="{ox+114+bw+5:.1f}" y="{y+10}" class="val" font-size="10.5">{fmt.format(val)}{unit}</text>')
    return svg(w, int(h), "".join(b))


def heatmap(title, rows_labels, cols, cell, w=760,
            sub="green = pass · red = fail · amber = truncated/partial · shaded = judge score"):
    """cell(row,col) -> (fill, label). Status-colored grid."""
    if not rows_labels or not cols:
        return None
    pad_l, top = 168, 90
    cw = (w - pad_l - 20) // max(len(cols), 1)
    ch = 30
    h = top + len(rows_labels) * (ch + 4) + 20
    b = []; _title(b, title, sub)
    for j, c in enumerate(cols):
        x = pad_l + j * cw + cw / 2
        b.append(f'<text x="{x:.1f}" y="{top-6}" text-anchor="start" class="mut" font-size="9.5" transform="rotate(-40 {x:.1f} {top-6})">{esc(str(c)[:16])}</text>')
    for i, rl in enumerate(rows_labels):
        y = top + i * (ch + 4)
        b.append(f'<text x="{pad_l-10}" y="{y+ch*0.66:.0f}" text-anchor="end" class="lab" font-size="12">{esc(rl)}</text>')
        for j, c in enumerate(cols):
            x = pad_l + j * cw
            fill, labl = cell(rl, c)
            b.append(f'<rect x="{x+2}" y="{y}" width="{cw-4}" height="{ch}" rx="3" fill="{fill}"/>')
            if labl:
                b.append(f'<text x="{x+cw/2:.1f}" y="{y+ch*0.66:.0f}" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">{esc(labl)}</text>')
    return svg(w, int(h), "".join(b))


def lines(title, xlabels, series, ylabel, xlabel, w=720, h=340, sub="", ymin0=True):
    """series: (name, [values|None], slot). Multi-series line chart, one color per entity, legend via
    end-point direct labels. ONE y axis (auto-scaled)."""
    series = [s for s in series if any(isinstance(v, (int, float)) for v in s[1])]
    if not series or len(xlabels) < 1:
        return None
    pad_l, pad_r, top, pad_b = 66, 116, 72, 52
    allv = [v for s in series for v in s[1] if isinstance(v, (int, float))]
    vlo = 0 if ymin0 else min(allv) * 0.95
    vhi = nice_max(max(allv) * 1.02) if ymin0 else max(allv) * 1.05
    if vhi <= vlo:
        vhi = vlo + 1
    pw, ph = w - pad_l - pad_r, h - top - pad_b
    n = len(xlabels)
    def X(i): return pad_l + (pw * i / (n - 1) if n > 1 else pw / 2)
    def Y(v): return top + ph * (1 - (v - vlo) / (vhi - vlo))
    b = []; _title(b, title, sub)
    for k in range(5):
        yv = vlo + (vhi - vlo) * k / 4
        b.append(f'<line x1="{pad_l}" y1="{Y(yv):.1f}" x2="{pad_l+pw}" y2="{Y(yv):.1f}" stroke="var(--grid)" stroke-width="1"/>')
        b.append(f'<text x="{pad_l-8}" y="{Y(yv)+4:.1f}" text-anchor="end" class="mut" font-size="10.5">{yv:.0f}</text>')
    for i, xl in enumerate(xlabels):
        b.append(f'<text x="{X(i):.1f}" y="{top+ph+18:.0f}" text-anchor="middle" class="mut" font-size="10.5">{esc(str(xl))}</text>')
    b.append(f'<text x="{pad_l+pw/2:.0f}" y="{h-14}" text-anchor="middle" class="lab" font-size="11.5">{esc(xlabel)}</text>')
    b.append(f'<text x="16" y="{top+ph/2:.0f}" class="lab" font-size="11.5" transform="rotate(-90 16 {top+ph/2:.0f})" text-anchor="middle">{esc(ylabel)}</text>')
    ends = []
    for name, vals, slot in series:
        pts = [(X(i), Y(v)) for i, v in enumerate(vals) if isinstance(v, (int, float))]
        if not pts:
            continue
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        b.append(f'<path d="{d}" fill="none" stroke="var(--s{slot+1})" stroke-width="2"/>')
        for x, y in pts:
            b.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="var(--s{slot+1})" stroke="var(--surface)" stroke-width="1.5"/>')
        disp = name[9:] if name.startswith("llamacpp-") else name       # strip common prefix
        ends.append((pts[-1][1], pts[-1][0], disp[:17], slot))
    ends.sort()                                                          # declutter end labels vertically
    placed = []
    for ly0, lx, disp, slot in ends:
        ly = ly0 if not placed else max(ly0, placed[-1] + 13)
        ly = min(ly, top + ph + 4)
        placed.append(ly)
        if abs(ly - ly0) > 2:
            b.append(f'<line x1="{lx:.1f}" y1="{ly0:.1f}" x2="{lx+5:.1f}" y2="{ly-4:.1f}" stroke="var(--muted)" stroke-width="1"/>')
        b.append(f'<text x="{lx+8:.1f}" y="{ly+4:.1f}" class="val" font-size="10.5" fill="var(--s{slot+1})">{esc(disp)}</text>')
    return svg(w, int(h), "".join(b))


# ============================================================ detect + load
def _find(d, name):
    for cand in (os.path.join(d, name), os.path.join(d, "out", name)):
        if os.path.exists(cand):
            return cand
    return None


def detect(d):
    if _find(d, "sweep-summary.json"):
        return "sweep"
    if _find(d, "outputs.jsonl"):
        return "quality"
    if _find(d, "results.jsonl"):
        return "throughput"
    return None


def slot_map(order):
    return {name: i for i, name in enumerate(order)}


# ============================================================ render: quality
def render_quality(d):
    raw = load_jsonl(_find(d, "outputs.jsonl"))
    outs = [r for r in raw if "error" not in r]
    errs = [r for r in raw if "error" in r]
    dets = load_jsonl(_find(d, "scores_deterministic.jsonl"))
    judg = load_jsonl(_find(d, "judge_scores.jsonl"))
    vram = load_jsonl(_find(d, "vram.jsonl"))
    if not outs:
        return {}, ["_No successful task outputs to chart._"]
    configs = list(OrderedDict((r.get("config"), 1) for r in outs))   # stable first-seen order
    S = slot_map(configs)

    def by(key):
        return {c: mean([r.get(key) for r in outs if r.get("config") == c]) for c in configs}
    tok_total, tok_think, tok_ans = by("total_tokens"), by("think_tokens"), by("answer_tokens")
    decode, prefill = by("decode_tps"), by("prefill_tps")
    ttft, ttfa = by("ttft_s"), by("ttfa_s")
    trunc = {c: (lambda m: 100 * m if m is not None else None)(
        mean([1 if r.get("truncated_thinking") else 0 for r in outs if r.get("config") == c]))
        for c in configs}
    detpass = {}
    for c in configs:
        rr = [x for x in dets if x.get("config") == c]
        detpass[c] = 100 * sum(1 for x in rr if x.get("passed")) / len(rr) if rr else None
    judge_mean = {}
    for c in configs:
        rr = [j for j in judg if j.get("config") == c]
        vals = [mean([j.get("correctness"), j.get("depth"), j.get("clarity")]) for j in rr]
        judge_mean[c] = mean(vals) if vals else None
    vr = {v.get("config"): v for v in vram}
    pk = lambda c: (vr.get(c, {}).get("peak_vram_used_mib") or vr.get(c, {}).get("vram_used_mib_at_load"))

    files = OrderedDict()
    files["quality_vs_cost.svg"] = scatter_quality_cost(
        "Quality vs token cost — the efficient frontier",
        [(c, tok_total.get(c), detpass.get(c), S[c]) for c in configs])
    files["quality_deterministic.svg"] = hbar(
        "Deterministic accuracy (objective, auto-graded)",
        sorted([(c, detpass.get(c), S[c]) for c in configs], key=lambda r: -(r[1] or -1)),
        unit="%", fmt="{:.0f}")
    if any(judge_mean.get(c) is not None for c in configs):
        files["quality_judge.svg"] = hbar(
            "Open-ended quality (LLM-judge: mean of correctness/depth/clarity)",
            sorted([(c, judge_mean.get(c), S[c]) for c in configs], key=lambda r: -(r[1] or -1)),
            unit="/5", fmt="{:.1f}")
    files["token_economy.svg"] = stacked_tokens(
        "Token economy — thinking vs answer tokens per task",
        [(c, tok_think.get(c), tok_ans.get(c), S[c]) for c in configs])
    files["throughput.svg"] = small_multiples("Throughput", [
        ("Decode tok/s (generation speed)", "", "{:.1f}", [(c, decode.get(c), S[c]) for c in configs]),
        ("Prefill tok/s (prompt ingest)", "", "{:.0f}", [(c, prefill.get(c), S[c]) for c in configs]),
    ])
    files["latency.svg"] = dumbbell(
        "Latency — time to first token vs first ANSWER token",
        [(c, ttft.get(c), ttfa.get(c), S[c]) for c in configs])
    files["memory_power.svg"] = small_multiples("Memory · power · thermal (per config)", [
        ("Peak VRAM (MiB)", "", "{:.0f}", [(c, pk(c), S[c]) for c in configs]),
        ("Peak GTT / host-RAM spill (MiB)", "", "{:.0f}", [(c, vr.get(c, {}).get("peak_gtt_used_mib"), S[c]) for c in configs]),
        ("Avg power (W)", "", "{:.0f}", [(c, vr.get(c, {}).get("avg_power_w"), S[c]) for c in configs]),
        ("Peak temp (°C)", "", "{:.0f}", [(c, vr.get(c, {}).get("peak_temp_c"), S[c]) for c in configs]),
    ])
    tasks = list(dict.fromkeys([x.get("task_id") for x in dets] + [j.get("task_id") for j in judg]))
    det_idx = {(x.get("config"), x.get("task_id")): x for x in dets}
    jdg_idx = defaultdict(list)
    for j in judg:
        jdg_idx[(j.get("config"), j.get("task_id"))].append(j)

    def cell(c, t):
        x = det_idx.get((c, t))
        if x is not None:
            if x.get("passed"):
                return (GOOD, "✓")
            return (WARN, "◐") if (x.get("detail") or "").startswith("timeout") else (BAD, "✗")
        js = jdg_idx.get((c, t))
        if js:
            sc = mean([mean([q.get("correctness"), q.get("depth"), q.get("clarity")]) for q in js]) or 0
            return (JBLUE[min(5, int(round(sc)))], f"{sc:.1f}")
        return ("var(--grid)", "")
    if tasks:
        files["task_heatmap.svg"] = heatmap("Per-task outcomes (config × task)", configs, tasks, cell)

    # --- appendix markdown ---
    titles = [("quality_vs_cost.svg", "Headline: quality vs token cost (up-and-left wins)"),
              ("quality_deterministic.svg", "Objective accuracy"),
              ("quality_judge.svg", "Open-ended quality (LLM-judge)"),
              ("token_economy.svg", "Token economy (thinking vs answer)"),
              ("throughput.svg", "Throughput (decode / prefill)"),
              ("latency.svg", "Latency (ttft → ttfa)"),
              ("memory_power.svg", "Memory, power & thermal"),
              ("task_heatmap.svg", "Per-task outcomes")]
    ap = []
    if errs:
        bad = sorted({f"{e.get('config')}/{e.get('task_id')}" for e in errs})
        ap.append(f"> ⚠️ **{len(errs)} errored request(s)** excluded from the charts (not averaged in): "
                  + ", ".join(bad) + ".\n")
    for fn, ti in titles:
        if files.get(fn):
            ap.append(f"\n**{ti}**\n\n![{ti}](charts/{fn})\n")
    ap.append("\n### Data table\n")
    ap.append("| config | det % | judge/5 | think tok | ans tok | decode t/s | ttfa s | peak VRAM | trunc % |")
    ap.append("|--------|------:|--------:|----------:|--------:|-----------:|-------:|----------:|--------:|")
    f = lambda x, dd=0: "—" if x is None else f"{x:.{dd}f}"
    for c in configs:
        ap.append(f"| {c} | {f(detpass.get(c))} | {f(judge_mean.get(c),1)} | {f(tok_think.get(c))} | "
                  f"{f(tok_ans.get(c))} | {f(decode.get(c),1)} | {f(ttfa.get(c),1)} | {f(pk(c))} | {f(trunc.get(c))} |")
    return {k: v for k, v in files.items() if v}, ap


# ============================================================ render: throughput
def render_throughput(d):
    rows = load_jsonl(_find(d, "results.jsonl"))
    ag = [r for r in rows if r.get("kind") == "aggregate" and "error" not in r]
    if not ag:
        return {}, ["_No aggregate rows to chart._"]
    gpu = {r.get("label"): r for r in rows if r.get("kind") == "gpu"}
    for a in ag:                                              # merge gpu memory onto matching labels
        g = gpu.get(a.get("label"))
        if g:
            for k in ("vram_used_mib_at_load", "peak_vram_mib", "peak_gtt_mib", "avg_power_w"):
                a.setdefault(k, g.get(k))
    engines = list(OrderedDict((r.get("engine"), 1) for r in ag))
    S = slot_map(engines)
    files = OrderedDict()

    cr = [r for r in ag if isinstance(r.get("label"), str) and r["label"][:2] == "cr" and r["label"][2:].isdigit()]
    depths = sorted({int(r["label"][2:]) for r in cr})
    if len(depths) >= 2:
        xl = [f"{x//1000}K" for x in depths]
        for fn, ti, field, yl in [
                ("depth_prefill.svg", "Prefill tok/s vs context depth (p50)", "prefill_tok_s_p50", "prefill tok/s"),
                ("depth_decode.svg", "Decode tok/s vs context depth (p50, per stream)", "decode_tok_s_per_stream_p50", "decode tok/s")]:
            series = [(e, [({int(r["label"][2:]): r.get(field) for r in cr if r.get("engine") == e}).get(x) for x in depths], S[e]) for e in engines]
            files[fn] = lines(ti, xl, series, yl, "prompt depth (tokens)")

    agn = [r for r in ag if isinstance(r.get("label"), str) and r["label"].startswith("agentic-c")]
    concs = sorted({r.get("concurrency") for r in agn if r.get("concurrency")})
    if len(concs) >= 2:
        xl = [str(c) for c in concs]
        for fn, ti, field, yl, z in [
                ("conc_aggregate.svg", "Aggregate throughput vs concurrency", "aggregate_tok_s", "tok/s (all streams)", True),
                ("conc_perstream.svg", "Per-stream decode vs concurrency (p50)", "decode_tok_s_per_stream_p50", "tok/s per stream", True),
                ("conc_ttft.svg", "TTFT p95 vs concurrency (lower = better)", "ttft_s_p95", "seconds", False)]:
            series = [(e, [({r.get("concurrency"): r.get(field) for r in agn if r.get("engine") == e}).get(c) for c in concs], S[e]) for e in engines]
            files[fn] = lines(ti, xl, series, yl, "parallel streams", ymin0=z)

    think = [r for r in ag if r.get("label") == "thinking"]
    if think:
        has = any(r.get("ttfa_s_p50") is not None for r in think)
        field = "ttfa_s_p50" if has else "decode_tok_s_per_stream_p50"
        rows_b = sorted([(r.get("engine"), r.get(field), S[r.get("engine")]) for r in think],
                        key=lambda t: (t[1] if t[1] is not None else 1e9) if has else -(t[1] or 0))
        files["thinking.svg"] = hbar(
            "Thinking — time to first ANSWER token (p50, lower = better)" if has
            else "Thinking — decode tok/s (no answer token: think budget exhausted)",
            rows_b, unit="s" if has else "", fmt="{:.2f}" if has else "{:.0f}")

    if any(a.get("peak_vram_mib") or a.get("vram_used_mib_at_load") for a in ag):
        seen, mem = set(), []
        for a in ag:
            e = a.get("engine")
            if e in seen:
                continue
            seen.add(e); mem.append((e, a))
        files["memory.svg"] = small_multiples("Memory & power (per engine)", [
            ("Peak VRAM (MiB)", "", "{:.0f}", [(e, a.get("peak_vram_mib") or a.get("vram_used_mib_at_load"), S[e]) for e, a in mem]),
            ("Peak GTT / host-RAM spill (MiB)", "", "{:.0f}", [(e, a.get("peak_gtt_mib"), S[e]) for e, a in mem]),
            ("Avg power (W)", "", "{:.0f}", [(e, a.get("avg_power_w"), S[e]) for e, a in mem]),
        ])

    # --- appendix ---
    ftxt = os.path.join(d, "failures.txt")
    fail_lines = [l.strip() for l in open(ftxt, encoding="utf-8")] if os.path.exists(ftxt) else []
    fail_lines = [l for l in fail_lines if l]
    ap = []
    errrows = [r for r in ag if r.get("n_err")]
    if fail_lines or errrows:
        items = fail_lines + [f"n_err={r['n_err']} in {r.get('engine')}/{r.get('label')}" for r in errrows]
        ap.append(f"> ⚠️ **{len(items)} failure(s)** (excluded from charts): " + "; ".join(map(esc, items)) + "\n")
    order = [("depth_prefill.svg", "Prefill vs depth"), ("depth_decode.svg", "Decode vs depth"),
             ("conc_aggregate.svg", "Aggregate tok/s vs concurrency"),
             ("conc_perstream.svg", "Per-stream decode vs concurrency"),
             ("conc_ttft.svg", "TTFT p95 vs concurrency"), ("thinking.svg", "Thinking latency"),
             ("memory.svg", "Memory & power")]
    for fn, ti in order:
        if files.get(fn):
            ap.append(f"\n**{ti}**\n\n![{ti}](charts/{fn})\n")
    ap.append("\n### Aggregate rows\n")
    ap.append("| engine | label | conc | prompt tok | prefill p50 | decode p50 | agg tok/s | ttft p50 | ttft p95 | peak VRAM | peak GTT | err |")
    ap.append("|--------|-------|-----:|-----------:|------------:|-----------:|----------:|---------:|---------:|----------:|---------:|----:|")
    f = lambda x, dd=1: "—" if x is None else (f"{x:.{dd}f}" if isinstance(x, float) else str(x))
    for r in ag:
        ap.append(f"| {r.get('engine')} | {r.get('label')} | {r.get('concurrency')} | {f(r.get('prompt_tokens'),0)} | "
                  f"{f(r.get('prefill_tok_s_p50'),0)} | {f(r.get('decode_tok_s_per_stream_p50'))} | {f(r.get('aggregate_tok_s'))} | "
                  f"{f(r.get('ttft_s_p50'),3)} | {f(r.get('ttft_s_p95'),3)} | {f(r.get('peak_vram_mib'),0)} | "
                  f"{f(r.get('peak_gtt_mib'),0)} | {r.get('n_err') or 0} |")
    return {k: v for k, v in files.items() if v}, ap


# ============================================================ render: sweep
def render_sweep(d):
    sp = _find(d, "sweep-summary.json")
    if not sp:
        return {}, ["_No sweep-summary.json._"]
    s = json.loads(open(sp, encoding="utf-8").read())
    log = load_jsonl(_find(d, "sweep-log.jsonl"))
    files = OrderedDict()
    axes = s.get("axes", {})
    for axis, short in (("ub", "-ub"), ("batch", "-b")):
        a = axes.get(axis)
        if not a or not a.get("curve"):
            continue
        curve = a["curve"]
        xl = [str(p["value"]) for p in curve]
        pp = [(None if p.get("failed") else p.get("pp")) for p in curve]
        vr = [p.get("vram_peak_mib") for p in curve]
        files[f"sweep_{axis}_tps.svg"] = lines(
            f"{s.get('metric','pp')} tok/s vs {short}  —  best {a.get('best')}", xl, [("tok/s", pp, 0)],
            "tok/s", short)
        files[f"sweep_{axis}_vram.svg"] = lines(
            f"VRAM peak vs {short}", xl, [("MiB", vr, 1)], "MiB", short, ymin0=False)
    ap = []
    rec = s.get("recommended", {})
    kv = s.get("kv_check", {})
    ap.append(f"\n- **Recommended:** `-ub {rec.get('ub')} -b {rec.get('batch')} -fa {rec.get('fa')}`")
    if kv:
        ap.append(f"- **KV f16 vs q8_0** @ depth {kv.get('depth')}: Δpp {kv.get('delta_pp_pct')}% · "
                  f"Δtg {kv.get('delta_tg_pct')}% · saves {kv.get('vram_saved_mib')} MiB → *{kv.get('verdict')}*\n")
    for axis, short in (("ub", "-ub"), ("batch", "-b")):
        for suff, ti in (("tps", f"tok/s vs {short}"), ("vram", f"VRAM vs {short}")):
            fn = f"sweep_{axis}_{suff}.svg"
            if files.get(fn):
                ap.append(f"\n**{ti}**\n\n![{ti}](charts/{fn})\n")
    if log:
        ap.append("\n### All sweep invocations\n")
        ap.append("| ub | b | fa | kv | depth | pp tok/s | tg tok/s | VRAM MiB | failed |")
        ap.append("|---:|--:|:--:|:--:|------:|---------:|---------:|---------:|:------:|")
        for r in log:
            ap.append(f"| {r.get('ub')} | {r.get('batch')} | {r.get('fa')} | {r.get('kv')} | {r.get('depth')} | "
                      f"{r.get('pp_ts')} | {r.get('tg_ts')} | {r.get('vram_peak_mib')} | {'FAIL' if r.get('failed') else ''} |")
    if s.get("recommended_server_cmd"):
        ap.append(f"\n```\n{s['recommended_server_cmd']}\n```\n")
    return {k: v for k, v in files.items() if v}, ap


RENDERERS = {"quality": render_quality, "throughput": render_throughput, "sweep": render_sweep}


# ============================================================ main
def process(d, charts_dir=None, appendix_path=None):
    kind = detect(d)
    if not kind:
        print(f"skip {d}: no outputs.jsonl / results.jsonl / sweep-summary.json")
        return False
    files, ap = RENDERERS[kind](d)
    cdir = charts_dir or os.path.join(d, "charts")
    os.makedirs(cdir, exist_ok=True)
    for name, content in files.items():
        with open(os.path.join(cdir, name), "w", encoding="utf-8") as f:
            f.write(content)
    header = [f"## Appendix — charts ({kind})\n",
              "_Generated by `bench/lib/report.py`. One fixed color per entity across all charts; "
              "each chart has a single axis (differently-scaled metrics are separate panels); "
              "SVGs are theme-aware (light/dark)._\n"]
    apath = appendix_path or os.path.join(d, "appendix.md")
    with open(apath, "w", encoding="utf-8") as f:
        f.write("\n".join(header + ap) + "\n")
    print(f"[{kind}] wrote {len(files)} charts -> {cdir}/  + {apath}")
    for n in files:
        print(f"    {n}")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dirs", nargs="+")
    ap.add_argument("--charts", help="output dir for SVGs (default: <run_dir>/charts)")
    ap.add_argument("--appendix", help="output appendix.md path (default: <run_dir>/appendix.md)")
    a = ap.parse_args()
    ok = False
    for d in a.run_dirs:
        if not os.path.isdir(d):
            print(f"skip {d}: not a directory")
            continue
        ok = process(d, a.charts, a.appendix) or ok
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
