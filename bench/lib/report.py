#!/usr/bin/env python3
"""report.py — render a self-contained HTML report from bench/runs/ output dirs.

Zero dependencies (stdlib only); charts via the vendored Chart.js in bench/lib/vendor/.

Usage:
  ./report.py RUN_DIR [RUN_DIR ...] [--out FILE]

Supported run dirs (auto-detected):
  - model-bench sweep:   sweep-summary.json (+ sweep-log.jsonl)   -> tuning curves, KV verdict
  - engine-bench:        results.jsonl (campaign.sh / run.sh)     -> depth curve, concurrency,
                         thinking ttfa, failures                     (aggregate rows only)

Two or more sweep dirs additionally get an overlay comparison (e.g. ROCm vs Vulkan).
Default output: <first RUN_DIR>/report.html
"""
import argparse
import html
import json
from datetime import datetime
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent
CHARTJS = LIB_DIR / "vendor" / "chart.umd.min.js"


def read_meta(d: Path) -> dict:
    meta = {}
    f = d / "meta.txt"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                meta[k.strip()] = v.strip()
            elif ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
    return meta


def load_run(d: Path) -> dict:
    """Detect run type and load everything the renderer needs."""
    run = {"dir": str(d), "name": d.name, "meta": read_meta(d)}
    if (d / "sweep-summary.json").exists():
        run["type"] = "sweep"
        run["summary"] = json.loads((d / "sweep-summary.json").read_text())
        log = d / "sweep-log.jsonl"
        run["log"] = [json.loads(l) for l in log.read_text().splitlines() if l.strip()] if log.exists() else []
        return run
    if (d / "results.jsonl").exists():
        rows = [json.loads(l) for l in (d / "results.jsonl").read_text().splitlines() if l.strip()]
        run["type"] = "probe"
        aggs = [r for r in rows if r.get("kind") == "aggregate"]
        # merge GPU memory rows (kind=="gpu", keyed by label) onto the matching aggregate rows
        gpu = {r.get("label"): r for r in rows if r.get("kind") == "gpu"}
        for a in aggs:
            g = gpu.get(a.get("label"))
            if g:
                for k in ("vram_used_mib_at_load", "peak_vram_mib", "peak_gtt_mib"):
                    a[k] = g.get(k)
        run["aggregates"] = aggs
        run["n_requests"] = sum(1 for r in rows if r.get("kind") == "request")
        fails = d / "failures.txt"
        run["failures"] = [l.strip() for l in fails.read_text().splitlines() if l.strip()] if fails.exists() else []
        return run
    raise SystemExit(f"error: {d}: no sweep-summary.json or results.jsonl — not a supported run dir")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dirs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, help="output HTML path (default: <first run dir>/report.html)")
    args = ap.parse_args()

    if not CHARTJS.exists():
        raise SystemExit(f"error: {CHARTJS} missing — vendor it once:\n"
                         "  curl -sL -o bench/lib/vendor/chart.umd.min.js "
                         "https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js")

    runs = []
    for d in args.run_dirs:
        if not d.is_dir():
            raise SystemExit(f"error: {d}: not a directory")
        runs.append(load_run(d))

    data = {
        "generated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "title": ", ".join(r["name"] for r in runs),
        "runs": runs,
    }
    out = args.out or (args.run_dirs[0] / "report.html")
    page = TEMPLATE.replace("/*__CHARTJS__*/", CHARTJS.read_text()) \
                   .replace("__DATA__", json.dumps(data)) \
                   .replace("__TITLE__", html.escape(data["title"]))
    out.write_text(page)
    kinds = ", ".join(f"{r['name']} ({r['type']})" for r in runs)
    print(f"wrote {out}  [{kinds}]")


# ---------------------------------------------------------------------------
# Everything below is the HTML template: CSS variables (light+dark), the
# vendored Chart.js, and the renderer. Data goes in as one JSON blob.
# ---------------------------------------------------------------------------

TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bench report — __TITLE__</title>
<style>
:root {
  --surface: #fcfcfb; --page: #f9f9f7;
  --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #1baf7a;          /* categorical: blue, aqua */
  --good: #0ca30c; --critical: #d03b3b; --warning: #fab219;
  --code-bg: #f0efec;
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #1a1a19; --page: #0d0d0d;
    --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #199e70;
    --good: #0ca30c; --critical: #d03b3b; --warning: #fab219;
    --code-bg: #262624;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }
h1 { font-size: 20px; margin: 8px 0 2px; }
h2 { font-size: 16px; margin: 36px 0 4px; }
h3 { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 0 0 8px; }
.sub { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.meta { color: var(--ink2); font-size: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px; margin-top: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
.chartbox { position: relative; height: 260px; }
.chartbox.tall { height: 300px; }
.tiles { display: flex; flex-wrap: wrap; gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 16px; min-width: 130px; }
.tile .v { font-size: 22px; font-weight: 650; }
.tile .l { font-size: 11px; color: var(--muted); }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
  font-weight: 600; border: 1.5px solid; }
.badge.good { color: var(--good); border-color: var(--good); }
.badge.neutral { color: var(--ink2); border-color: var(--muted); }
.fail { border-left: 3px solid var(--critical); padding: 8px 12px; margin-top: 12px;
  background: var(--surface); border-radius: 0 8px 8px 0; font-size: 13px; }
.fail b { color: var(--critical); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
pre { background: var(--code-bg); padding: 10px 12px; border-radius: 6px; overflow-x: auto;
  color: var(--ink2); }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { text-align: right; padding: 4px 10px; border-bottom: 1px solid var(--grid);
  font-variant-numeric: tabular-nums; white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
th:first-child, td:first-child { text-align: left; }
td.best { font-weight: 700; color: var(--s1); }
details { margin-top: 12px; }
summary { cursor: pointer; color: var(--ink2); font-size: 13px; }
details .card { overflow-x: auto; }
hr.sect { border: 0; border-top: 1px solid var(--grid); margin: 40px 0 0; }
</style>
</head>
<body>
<main id="app"></main>
<script>/*__CHARTJS__*/</script>
<script>
const DATA = __DATA__;

// ---- theme ----------------------------------------------------------------
function themeVars() {
  const s = getComputedStyle(document.documentElement);
  const v = n => s.getPropertyValue(n).trim();
  return { surface: v('--surface'), ink: v('--ink'), ink2: v('--ink2'), muted: v('--muted'),
           grid: v('--grid'), axis: v('--axis'), s1: v('--s1'), s2: v('--s2'),
           good: v('--good'), critical: v('--critical') };
}
let T = themeVars();
const charts = [];

// direct-label plugin: draws dataset.peakLabel above dataset.peakIndex
const peakLabel = {
  id: 'peakLabel',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, i) => {
      if (ds.peakIndex == null || !chart.isDatasetVisible(i)) return;
      const el = chart.getDatasetMeta(i).data[ds.peakIndex];
      if (!el) return;
      ctx.save();
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = T.ink2;
      if (chart.options.indexAxis === 'y') {          // horizontal bar: label past the bar end
        ctx.textAlign = 'left';
        ctx.fillText(ds.peakLabel ?? '', el.x + 6, el.y + 4);
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(ds.peakLabel ?? '', el.x, el.y - 10);
      }
      ctx.restore();
    });
  }
};

function baseOpts(yTitle, xTitle) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    layout: { padding: { top: 16 } },   // room for the peak direct-label
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: T.ink2, usePointStyle: true, boxWidth: 8, boxHeight: 8,
                          font: { size: 11 } } },
      tooltip: { backgroundColor: T.surface, titleColor: T.ink, bodyColor: T.ink2,
                 borderColor: T.grid, borderWidth: 1, usePointStyle: true },
    },
    scales: {
      x: { title: { display: !!xTitle, text: xTitle, color: T.muted, font: { size: 11 } },
           ticks: { color: T.muted, font: { size: 11 } },
           grid: { color: T.grid }, border: { color: T.axis } },
      y: { title: { display: !!yTitle, text: yTitle, color: T.muted, font: { size: 11 } },
           ticks: { color: T.muted, font: { size: 11 }, precision: 0 },
           grid: { color: T.grid }, border: { color: T.axis },
           beginAtZero: true },
    },
  };
}

function mkChart(canvas, cfg) {
  cfg.plugins = [peakLabel];
  charts.push({ canvas, build: () => new Chart(canvas, cfg), inst: new Chart(canvas, cfg) });
}

// rebuild all charts when the color scheme flips
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  T = themeVars();
  document.getElementById('app').innerHTML = '';
  charts.length = 0;
  render();
});

// ---- helpers ---------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (x, d = 1) => x == null ? '—' : Number(x).toLocaleString('en-US',
                { minimumFractionDigits: d, maximumFractionDigits: d });
const el = (parent, tag, cls, htmlStr) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (htmlStr != null) e.innerHTML = htmlStr;
  parent.appendChild(e);
  return e;
};

// engine "rocm-mtp1-kvq8_0" -> composite visual encoding:
// color = backend (slot1/slot2), dash = MTP off, point shape = KV type
function engineStyle(engine, backends) {
  const m = /^(.+?)-mtp([01])-kv(.+)$/.exec(engine);
  const backend = m ? m[1] : engine;
  const idx = Math.max(0, backends.indexOf(backend)) % 2;
  return {
    color: idx === 0 ? T.s1 : T.s2,
    dash: m && m[2] === '0' ? [6, 4] : [],
    point: m && m[3] !== 'f16' ? 'rectRot' : 'circle',
  };
}
function backendsOf(engines) {
  const b = [];
  engines.forEach(e => { const m = /^(.+?)-mtp/.exec(e); const x = m ? m[1] : e;
                         if (!b.includes(x)) b.push(x); });
  return b;
}
function lineDataset(label, data, style, extra = {}) {
  return Object.assign({
    label, data,
    borderColor: style.color, backgroundColor: style.color,
    borderWidth: 2, borderDash: style.dash, pointStyle: style.point,
    pointRadius: 4, pointHoverRadius: 7,
    pointBorderColor: T.surface, pointBorderWidth: 1.5,   // 2px-ish surface ring
    tension: 0, spanGaps: false, fill: false,
  }, extra);
}
function chartCard(parent, title, tall = false) {
  const c = el(parent, 'div', 'card');
  el(c, 'h3', null, esc(title));
  const box = el(c, 'div', 'chartbox' + (tall ? ' tall' : ''));
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  return canvas;
}
function detailsTable(parent, summary, headers, rows, bestCol = null, bestMax = true) {
  const d = el(parent, 'details');
  el(d, 'summary', null, esc(summary));
  const c = el(d, 'div', 'card');
  let best = null;
  if (bestCol != null) {
    const vals = rows.map(r => r[bestCol]).filter(v => typeof v === 'number');
    if (vals.length) best = bestMax ? Math.max(...vals) : Math.min(...vals);
  }
  const body = rows.map(r =>
    '<tr>' + r.map((v, i) => {
      const cls = (bestCol === i && typeof v === 'number' && v === best) ? ' class="best"' : '';
      return `<td${cls}>${typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 1) : esc(v ?? '—')}</td>`;
    }).join('') + '</tr>').join('');
  el(c, 'table', null,
     '<thead><tr>' + headers.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead>' +
     `<tbody>${body}</tbody>`);
}

// ---- sweep section ----------------------------------------------------------
function renderSweep(root, run, allSweeps) {
  const s = run.summary;
  el(root, 'h2', null, esc(run.name));
  const build = (run.log && run.log[0] && run.log[0].build_commit) || run.meta.build || '?';
  el(root, 'div', 'meta',
     `model <code>${esc((s.model || '').split('/').pop())}</code> · build <code>${esc(build)}</code>` +
     ` · metric ${esc(s.metric)} pp${s.pp}/tg${s.tg} · noise ±${s.noise_pct}%` +
     (run.meta.gpu_name ? ` · ${esc(run.meta.gpu_name)}` : ''));

  // verdict tiles
  const tiles = el(root, 'div', 'tiles');
  const rec = s.recommended || {};
  const t1 = el(tiles, 'div', 'tile');
  el(t1, 'div', 'v', `-ub ${rec.ub} -b ${rec.batch}`);
  el(t1, 'div', 'l', 'recommended micro/logical batch');
  const t2 = el(tiles, 'div', 'tile');
  el(t2, 'div', 'v', `-fa ${rec.fa}`);
  el(t2, 'div', 'l', 'flash attention');
  const kv = s.kv_check || {};
  const t3 = el(tiles, 'div', 'tile');
  const ok = /accept/i.test(kv.verdict || '');
  el(t3, 'div', 'v', `<span class="badge ${ok ? 'good' : 'neutral'}">${ok ? '✓' : '✗'} ${esc(kv.verdict || '?')}</span>`);
  el(t3, 'div', 'l', `KV @ depth ${kv.depth}: Δpp ${fmt(kv.delta_pp_pct)}% · Δtg ${fmt(kv.delta_tg_pct)}% · saves ${fmt(kv.vram_saved_mib, 0)} MiB`);

  // axis curves: throughput + its own VRAM chart (never dual-axis)
  for (const axis of ['ub', 'batch']) {
    const a = (s.axes || {})[axis];
    if (!a || !a.curve || !a.curve.length) continue;
    const labels = a.curve.map(p => String(p.value));
    const grid = el(root, 'div', 'grid2');
    const peakIdx = a.curve.findIndex(p => p.value === a.best);
    const note = a.plateau_within_noise ? ' (plateau within noise)' : '';
    const c1 = chartCard(grid, `${s.metric} tok/s vs -${axis === 'batch' ? 'b' : 'ub'} — best ${a.best}${note}`);
    mkChart(c1, { type: 'line',
      data: { labels, datasets: [lineDataset('prefill tok/s', a.curve.map(p => p.failed ? null : p.pp),
        { color: T.s1, dash: [], point: 'circle' },
        { peakIndex: peakIdx >= 0 ? peakIdx : null, peakLabel: peakIdx >= 0 ? fmt(a.curve[peakIdx].pp, 0) : '' })] },
      options: (() => { const o = baseOpts('tok/s', `-${axis === 'batch' ? 'b' : 'ub'}`);
                        o.plugins.legend.display = false; return o; })() });
    const c2 = chartCard(grid, `VRAM peak vs -${axis === 'batch' ? 'b' : 'ub'}`);
    mkChart(c2, { type: 'line',
      data: { labels, datasets: [lineDataset('VRAM peak MiB', a.curve.map(p => p.vram_peak_mib),
        { color: T.s1, dash: [], point: 'circle' })] },
      options: (() => { const o = baseOpts('MiB', `-${axis === 'batch' ? 'b' : 'ub'}`);
                        o.plugins.legend.display = false; o.scales.y.beginAtZero = false; return o; })() });
  }

  // KV A/B table + recommended command
  if (kv.f16 && kv.q8_0) {
    detailsTable(root, `KV f16 vs q8_0 @ depth ${kv.depth} (raw numbers)`,
      ['KV', 'prefill tok/s', 'decode tok/s', 'VRAM peak MiB'],
      [['f16', kv.f16.pp, kv.f16.tg, kv.f16.vram_peak_mib],
       ['q8_0', kv.q8_0.pp, kv.q8_0.tg, kv.q8_0.vram_peak_mib]]);
  }
  if (run.log && run.log.length) {
    detailsTable(root, `all ${run.log.length} sweep invocations`,
      ['ub', 'b', 'fa', 'kv', 'depth', 'pp tok/s', '±', 'tg tok/s', '±', 'VRAM MiB', 'failed'],
      run.log.map(r => [r.ub, r.batch, r.fa, r.kv, r.depth, r.pp_ts, r.pp_stddev, r.tg_ts,
                        r.tg_stddev, r.vram_peak_mib, r.failed ? 'FAIL' : '']),
      5, true);
  }
  if (s.recommended_server_cmd) {
    const c = el(root, 'div');
    el(c, 'h3', null, 'recommended server command');
    el(c, 'pre', null, esc(s.recommended_server_cmd));
  }
}

// overlay: same axis curves from 2+ sweeps on one chart (e.g. rocm vs vulkan)
function renderSweepOverlay(root, sweeps) {
  el(root, 'h2', null, 'sweep comparison — ' + sweeps.map(r => esc(r.name.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, ''))).join(' vs '));
  el(root, 'div', 'meta', 'same axes overlaid; identity = color (see legend)');
  const grid = el(root, 'div', 'grid2');
  for (const axis of ['ub', 'batch']) {
    const canvas = chartCard(grid, `${sweeps[0].summary.metric} tok/s vs -${axis === 'batch' ? 'b' : 'ub'}`);
    const allVals = [...new Set(sweeps.flatMap(r => (r.summary.axes[axis]?.curve || []).map(p => p.value)))]
                    .sort((a, b) => a - b);
    const labels = allVals.map(String);
    const datasets = sweeps.slice(0, 2).map((r, i) => {
      const curve = r.summary.axes[axis]?.curve || [];
      const byVal = Object.fromEntries(curve.map(p => [p.value, p]));
      const slug = r.name.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, '');
      return lineDataset(slug, allVals.map(v => byVal[v] && !byVal[v].failed ? byVal[v].pp : null),
                         { color: i === 0 ? T.s1 : T.s2, dash: [], point: i === 0 ? 'circle' : 'rectRot' });
    });
    mkChart(canvas, { type: 'line', data: { labels, datasets },
                      options: baseOpts('tok/s', `-${axis === 'batch' ? 'b' : 'ub'}`) });
  }
}

// ---- probe / campaign section ------------------------------------------------
function renderProbe(root, run) {
  el(root, 'h2', null, esc(run.name));
  const m = run.meta;
  el(root, 'div', 'meta',
     [m.model && `model <code>${esc(String(m.model).split('/').pop())}</code>`,
      m['base'] && `base ${esc(m['base'])}`, m.gpu_name && esc(m.gpu_name),
      `${run.aggregates.length} aggregate rows / ${run.n_requests} requests`]
     .filter(Boolean).join(' · '));

  // failures first — never hide them
  const errRows = run.aggregates.filter(r => r.n_err > 0);
  if (run.failures.length || errRows.length) {
    const f = el(root, 'div', 'fail');
    const items = [...run.failures,
                   ...errRows.map(r => `n_err=${r.n_err} in ${r.engine}/${r.label}`)];
    f.innerHTML = `<b>⚠ ${items.length} failure(s)</b> — missing from the charts below, not averaged in:<br>` +
                  items.map(esc).join('<br>');
  }

  const ag = run.aggregates;
  const engines = [...new Set(ag.map(r => r.engine))];
  const backends = backendsOf(engines);
  const style = e => engineStyle(e, backends);

  // 1) context-depth curves (cr<NNNN> labels)
  const crRows = ag.filter(r => /^cr\d+$/.test(r.label));
  const depths = [...new Set(crRows.map(r => parseInt(r.label.slice(2), 10)))].sort((a, b) => a - b);
  if (depths.length >= 2) {
    const grid = el(root, 'div', 'grid2');
    const mkDepth = (title, yTitle, field) => {
      const canvas = chartCard(grid, title, true);
      const datasets = engines.map(e => {
        const byD = Object.fromEntries(crRows.filter(r => r.engine === e)
                     .map(r => [parseInt(r.label.slice(2), 10), r[field]]));
        return lineDataset(e, depths.map(d => byD[d] ?? null), style(e));
      }).filter(ds => ds.data.some(v => v != null));
      mkChart(canvas, { type: 'line',
        data: { labels: depths.map(d => (d / 1000) + 'K'), datasets },
        options: baseOpts(yTitle, 'prompt depth (tokens)') });
    };
    mkDepth('prefill vs context depth (p50)', 'prefill tok/s', 'prefill_tok_s_p50');
    mkDepth('decode vs context depth (p50, per stream)', 'decode tok/s', 'decode_tok_s_per_stream_p50');
    detailsTable(root, 'depth rows (p50)',
      ['engine', 'label', 'prompt tok', 'prefill tok/s', 'decode tok/s', 'TTFT p50 s', 'TTFT p95 s',
       'VRAM@load MiB', 'peak VRAM MiB', 'peak GTT MiB', 'errs'],
      crRows.map(r => [r.engine, r.label, r.prompt_tokens, r.prefill_tok_s_p50,
                       r.decode_tok_s_per_stream_p50, r.ttft_s_p50, r.ttft_s_p95,
                       r.vram_used_mib_at_load, r.peak_vram_mib, r.peak_gtt_mib, r.n_err || 0]),
      4, true);
  }

  // 2) thinking: ttfa per engine — one series, one color, best direct-labeled.
  // ttfa can be null across the board (think budget exhausted before the first
  // answer token) — fall back to decode tok/s and say so instead of hiding the rows.
  const think = ag.filter(r => r.label === 'thinking');
  if (think.length) {
    const hasTtfa = think.some(r => r.ttfa_s_p50 != null);
    const field = hasTtfa ? 'ttfa_s_p50' : 'decode_tok_s_per_stream_p50';
    think.sort((a, b) => hasTtfa ? (a[field] ?? 1e9) - (b[field] ?? 1e9) : b[field] - a[field]);
    const title = hasTtfa
      ? 'thinking — time to first answer token (p50, lower = better)'
      : 'thinking — decode tok/s (no answer token: think budget exhausted in every run)';
    const grid = el(root, 'div', 'grid2');
    const canvas = chartCard(grid, title, true);
    mkChart(canvas, { type: 'bar',
      data: { labels: think.map(r => r.engine),
              datasets: [{ label: hasTtfa ? 'ttfa s' : 'decode tok/s', data: think.map(r => r[field]),
                           backgroundColor: T.s1, borderRadius: 4, maxBarThickness: 18,
                           peakIndex: 0, peakLabel: fmt(think[0][field], hasTtfa ? 2 : 0) + (hasTtfa ? ' s' : '') }] },
      options: (() => { const o = baseOpts('', hasTtfa ? 'seconds' : 'tok/s'); o.indexAxis = 'y';
                        o.plugins.legend.display = false;
                        o.interaction = { mode: 'nearest', intersect: false }; return o; })() });
    detailsTable(grid, 'thinking rows', ['engine', 'ttfa s p50', 'think tok p50', 'decode tok/s', 'errs'],
      think.map(r => [r.engine, r.ttfa_s_p50, r.think_tokens_p50, r.decode_tok_s_per_stream_p50, r.n_err || 0]),
      hasTtfa ? 1 : 3, !hasTtfa);
  }

  // 3) concurrency scaling (agentic-c<N> labels)
  const agn = ag.filter(r => /^agentic-c\d+$/.test(r.label));
  const concs = [...new Set(agn.map(r => r.concurrency))].sort((a, b) => a - b);
  if (concs.length >= 2) {
    const grid = el(root, 'div', 'grid2');
    const mkConc = (title, yTitle, field) => {
      const canvas = chartCard(grid, title, true);
      const datasets = engines.map(e => {
        const byC = Object.fromEntries(agn.filter(r => r.engine === e).map(r => [r.concurrency, r[field]]));
        return lineDataset(e, concs.map(c => byC[c] ?? null), style(e));
      }).filter(ds => ds.data.some(v => v != null));
      mkChart(canvas, { type: 'line', data: { labels: concs.map(String), datasets },
                        options: baseOpts(yTitle, 'parallel streams') });
    };
    mkConc('aggregate throughput vs concurrency', 'tok/s (all streams)', 'aggregate_tok_s');
    mkConc('per-stream decode vs concurrency (p50)', 'tok/s per stream', 'decode_tok_s_per_stream_p50');
    mkConc('TTFT p95 vs concurrency (lower = better)', 'seconds', 'ttft_s_p95');
    detailsTable(grid, 'concurrency rows',
      ['engine', 'streams', 'aggregate tok/s', 'per-stream tok/s', 'TTFT p95 s', 'errs'],
      agn.map(r => [r.engine, r.concurrency, r.aggregate_tok_s, r.decode_tok_s_per_stream_p50,
                    r.ttft_s_p95, r.n_err || 0]),
      2, true);
  }

  // 4) anything not covered above still gets its table (run.sh smoke etc.)
  const covered = new Set([...crRows, ...think, ...agn]);
  const rest = ag.filter(r => !covered.has(r));
  if (rest.length) {
    detailsTable(root, `other aggregate rows (${rest.length})`,
      ['engine', 'label', 'conc', 'prompt tok', 'prefill tok/s', 'decode tok/s', 'aggregate tok/s',
       'TTFT p50 s', 'ttfa s', 'VRAM@load MiB', 'peak VRAM MiB', 'peak GTT MiB', 'errs'],
      rest.map(r => [r.engine, r.label, r.concurrency, r.prompt_tokens, r.prefill_tok_s_p50,
                     r.decode_tok_s_per_stream_p50, r.aggregate_tok_s, r.ttft_s_p50,
                     r.ttfa_s_p50, r.vram_used_mib_at_load, r.peak_vram_mib, r.peak_gtt_mib,
                     r.n_err || 0]));
  }
}

// ---- page -------------------------------------------------------------------
function render() {
  T = themeVars();
  const app = document.getElementById('app');
  el(app, 'h1', null, 'bench report');
  el(app, 'div', 'sub', esc(DATA.title) + ' · generated ' + esc(DATA.generated));

  const sweeps = DATA.runs.filter(r => r.type === 'sweep');
  DATA.runs.forEach((r, i) => {
    if (i) el(app, 'hr', 'sect');
    if (r.type === 'sweep') renderSweep(app, r, sweeps);
    else renderProbe(app, r);
  });
  if (sweeps.length >= 2) {
    el(app, 'hr', 'sect');
    renderSweepOverlay(app, sweeps);
  }
}
render();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
