#!/usr/bin/env python3
"""Generate a self-contained HTML chart report from engine-bench results.jsonl file(s).

Reads the `kind:"aggregate"` rows and emits line charts:
  1. Decode tok/s per stream vs context depth (prompt_tokens), one line per config series.
  2. Prefill tok/s vs context depth.
  3. Decode/stream and aggregate tok/s vs concurrency (parallel rows).

Chart.js is INLINED from bench/lib/vendor/chart.umd.min.js — the output HTML is fully
offline/self-contained (no network, matches the repo's provenance rules).

Usage:
  make_charts.py OUT.html RESULTS.jsonl [RESULTS2.jsonl ...]
  make_charts.py OUT.html 'bench/runs/*-engine-deep-*/results.jsonl'   # globs are expanded

Series key = the aggregate row's `engine` + `label` with any trailing digits stripped
(so deep-mtp1-cr8000 / deep-mtp1-cr128000 / deep-mtp1-cr200000 collapse to one depth curve).
No third-party deps; provenance (source files, generation time) is embedded in the page.
"""
import sys, os, json, glob, re, html, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR_JS = os.path.join(HERE, "vendor", "chart.umd.min.js")

PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2",
           "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b91c1c"]


def load_aggregates(patterns):
    files, rows = [], []
    for pat in patterns:
        matched = glob.glob(pat) if any(c in pat for c in "*?[") else [pat]
        for fp in matched:
            if not os.path.isfile(fp):
                continue
            files.append(fp)
            with open(fp) as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if r.get("kind") == "aggregate":
                        rows.append(r)
    return files, rows


def series_key(r):
    label = str(r.get("label", "?"))
    base = re.sub(r"[-_]?\d+$", "", label) or label
    return f"{r.get('engine', '?')}/{base}"


def num(v):
    return v if isinstance(v, (int, float)) else None


def build_datasets(rows, xkey, ykey, want_conc=None):
    """Return [{label, points:[(x,y)]}] grouped by series_key, sorted by x."""
    groups = {}
    for r in rows:
        if want_conc is not None:
            c = r.get("concurrency") or 1
            if want_conc == "single" and c != 1:
                continue
            if want_conc == "multi" and c <= 1:
                continue
        x, y = num(r.get(xkey)), num(r.get(ykey))
        if x is None or y is None:
            continue
        groups.setdefault(series_key(r), []).append((x, y))
    out = []
    for k in sorted(groups):
        pts = sorted(set(groups[k]))
        if pts:
            out.append({"label": k, "points": pts})
    return out


def chart_block(canvas_id, title, xlabel, ylabel, datasets, xtype="linear"):
    if not datasets:
        return ""
    ds_json = []
    for i, d in enumerate(datasets):
        color = PALETTE[i % len(PALETTE)]
        data = [{"x": x, "y": y} for x, y in d["points"]]
        ds_json.append({
            "label": d["label"], "data": data,
            "borderColor": color, "backgroundColor": color,
            "tension": 0.15, "pointRadius": 4, "borderWidth": 2, "fill": False,
        })
    cfg = {
        "type": "line",
        "data": {"datasets": ds_json},
        "options": {
            "responsive": True, "maintainAspectRatio": False,
            "interaction": {"mode": "nearest", "intersect": False},
            "plugins": {
                "title": {"display": True, "text": title, "font": {"size": 16}},
                "legend": {"position": "bottom"},
            },
            "scales": {
                "x": {"type": xtype, "title": {"display": True, "text": xlabel}},
                "y": {"title": {"display": True, "text": ylabel},
                      "beginAtZero": True},
            },
        },
    }
    return (f'<div class="chart"><canvas id="{canvas_id}"></canvas></div>\n'
            f'<script>new Chart(document.getElementById("{canvas_id}"),'
            f'{json.dumps(cfg)});</script>\n')


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: make_charts.py OUT.html RESULTS.jsonl [more.jsonl ...]")
    out_html, patterns = sys.argv[1], sys.argv[2:]
    files, rows = load_aggregates(patterns)
    if not rows:
        sys.exit(f"no aggregate rows found in: {patterns}")

    try:
        chart_js = open(VENDOR_JS, encoding="utf-8").read()
    except OSError as e:
        sys.exit(f"cannot read vendored Chart.js ({VENDOR_JS}): {e}")

    blocks = [
        chart_block("decDepth", "Decode tok/s per stream vs context depth",
                    "prompt tokens (depth)", "decode tok/s/stream",
                    build_datasets(rows, "prompt_tokens",
                                   "decode_tok_s_per_stream_p50", want_conc="single")),
        chart_block("pfDepth", "Prefill tok/s vs context depth",
                    "prompt tokens (depth)", "prefill tok/s",
                    build_datasets(rows, "prompt_tokens",
                                   "prefill_tok_s_p50", want_conc="single")),
        chart_block("decConc", "Decode tok/s per stream vs concurrency",
                    "concurrency", "decode tok/s/stream",
                    build_datasets(rows, "concurrency",
                                   "decode_tok_s_per_stream_p50", want_conc="multi")),
        chart_block("aggConc", "Aggregate tok/s vs concurrency",
                    "concurrency", "aggregate tok/s",
                    build_datasets(rows, "concurrency",
                                   "aggregate_tok_s", want_conc="multi")),
    ]
    blocks = [b for b in blocks if b]

    src_list = "".join(f"<li><code>{html.escape(f)}</code></li>" for f in files)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Benchmark charts</title>
<style>
 body{{font-family:system-ui,Arial,sans-serif;margin:24px;max-width:1000px}}
 h1{{font-size:20px}} .chart{{height:380px;margin:28px 0;border:1px solid #ddd;
 border-radius:8px;padding:8px}} .meta{{color:#555;font-size:13px}}
 code{{font-size:12px}}
</style></head><body>
<h1>Benchmark charts — R9700 (gfx1201)</h1>
<p class="meta">Generated {now} · {len(rows)} aggregate rows · MEASURED.
Sources:</p><ul class="meta">{src_list}</ul>
<script>{chart_js}</script>
{''.join(blocks)}
</body></html>"""
    with open(out_html, "w", encoding="utf-8") as fh:
        fh.write(page)
    print(f"wrote {out_html} ({len(rows)} rows, {len(blocks)} charts, "
          f"{len(files)} source files)")


if __name__ == "__main__":
    main()
