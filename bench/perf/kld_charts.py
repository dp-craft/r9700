#!/usr/bin/env python3
"""kld_charts.py — three theme-aware SVG charts + a table-twin appendix from COMMITTED KLD results.

Reads the per-arm score files (`kld_forced` JSON: kl_nats_per_tok, ci95_nats, top1_agreement,
kl_per_position.{median,p90}) and the paired-difference files (`kld_forced_diff` JSON:
diff_nats_per_tok, ci95_nats) named in a spec, and writes, under `<campaign>/<out>/`:

  charts/kld-scorecard.svg          K1  how far is each arm from the reference (KL + top-1 disagreement)
  charts/kld-effects.svg            K2  forest plot of the paired differences, one knob at a time
  charts/kld-typical-vs-mean.svg    K3  median / mean / p90 per arm on a log axis
  appendix.md                       embeds the 3 charts, each with a table twin (value, source file, field)
  sources.json                      relative path + sha256 of every input file (and of the spec)

    python3 bench/perf/kld_charts.py --spec campaigns/perf/<campaign>/inputs/kld-charts.json [--campaign DIR]

The campaign dir is `--campaign`, else the parent of the spec's dir when that dir is named `inputs`, else the
spec's dir. EVERY path in the spec is relative to the campaign dir. Any input path with a `tmp/` segment is
REFUSED (committed provenance only: raw data lives in tmp/, results ONLY in results/). Stdlib only.
The SVG primitives (svg, _title, esc, nice_max, the --sN colour slots) are reused from bench/core/report.py.

Spec (JSON):
  {"reference": "Q8_0", "out": "results/kld-final",
   "family_slots": {"llama.cpp": 1, "radiance": 2, "sly vLLM": 8},          # optional, 1-based report.py slots
   "arms":    [{"id","family","label","score": "<path>", "floor": true?}],  # spec order = tie-break order
   "effects": [{"group","label","a","b","diff": "<path>"}]}                 # Δ = KL(ref‖a) − KL(ref‖b)
"""
import argparse
import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "core"))
import report as R  # noqa: E402  (svg, _title, esc, nice_max, SLOT_L, SLOT_D)

MINUS = "−"
DEFAULT_FAMILY_SLOTS = {"llama.cpp": 1, "radiance": 2, "sly vLLM": 8}   # speed-campaign plan, fixed
CHARTS = ("kld-scorecard.svg", "kld-effects.svg", "kld-typical-vs-mean.svg")


class SpecError(Exception):
    """Bad spec / refused input: the CLI prints the message and exits 2."""


# ============================================================ paths and hashing
def _parts(p):
    return [s for s in p.replace("\\", "/").split("/") if s not in ("", ".")]


def resolve(campaign, rel, what="input"):
    """Absolute path of `rel` (campaign-relative). Refuses a `tmp/` segment (also via symlink) and any
    path that escapes the campaign dir."""
    camp = os.path.abspath(campaign)
    if os.path.isabs(rel):
        rel = os.path.relpath(rel, camp)
    norm = os.path.normpath(rel)
    parts = _parts(norm)
    if parts and parts[0] == "..":
        raise SpecError(f"REFUSED {what} path {rel!r}: it escapes the campaign dir (paths are campaign-relative)")
    if "tmp" in parts:
        raise SpecError(f"REFUSED {what} path {rel!r}: it contains a tmp/ segment. KLD charts read committed "
                        f"results only (raw data lives in tmp/, results in results/).")
    full = os.path.join(camp, norm)
    real_rel = _parts(os.path.relpath(os.path.realpath(full), os.path.realpath(camp)))
    if real_rel and real_rel[0] != ".." and "tmp" in real_rel:
        raise SpecError(f"REFUSED {what} path {rel!r}: it resolves (symlink) into a tmp/ dir.")
    return full


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path):
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        raise SpecError(f"cannot read {path}: {e}")
    try:
        return json.loads(raw), sha256_bytes(raw)
    except ValueError as e:
        raise SpecError(f"{path} is not valid JSON: {e}")


# ============================================================ loading
def _need(d, keys, path):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            raise SpecError(f"{path}: missing field {'.'.join(keys)}")
        cur = cur[k]
    return cur


def load_spec(spec_path, campaign=None):
    spec, spec_sha = read_json(spec_path)
    if campaign is None:
        sd = os.path.dirname(os.path.abspath(spec_path))
        campaign = os.path.dirname(sd) if os.path.basename(sd) == "inputs" else sd
    camp = os.path.abspath(campaign)
    slots = dict(DEFAULT_FAMILY_SLOTS)
    slots.update(spec.get("family_slots") or {})
    for k in ("arms", "effects", "out"):
        if k not in spec:
            raise SpecError(f"spec: missing '{k}'")
    out_dir = resolve(camp, spec["out"], "out")
    inputs = []          # (relative path, sha256)

    def rel(p):
        return os.path.relpath(p, camp).replace(os.sep, "/")

    arms = []
    for i, a in enumerate(spec["arms"]):
        for k in ("id", "family", "label", "score"):
            if k not in a:
                raise SpecError(f"spec arms[{i}]: missing '{k}'")
        if a["family"] not in slots:
            raise SpecError(f"spec arms[{i}] ({a['id']}): unknown family {a['family']!r}; known: {sorted(slots)}")
        full = resolve(camp, a["score"], f"arm {a['id']} score")
        d, sha = read_json(full)
        inputs.append((rel(full), sha))
        if d.get("label") != a["id"]:
            raise SpecError(f"{rel(full)}: label {d.get('label')!r} != arm id {a['id']!r} (wrong file?)")
        lo, hi = _need(d, ["ci95_nats"], rel(full))
        arms.append(dict(
            id=a["id"], family=a["family"], label=a["label"], floor=bool(a.get("floor")),
            slot=slots[a["family"]] - 1, order=i, src=rel(full),
            kl=float(_need(d, ["kl_nats_per_tok"], rel(full))), lo=float(lo), hi=float(hi),
            top1=float(_need(d, ["top1_agreement"], rel(full))),
            med=float(_need(d, ["kl_per_position", "median"], rel(full))),
            p90=float(_need(d, ["kl_per_position", "p90"], rel(full))),
            ref=d.get("reference_label"), npos=d.get("n_positions")))
    by_id = {a["id"]: a for a in arms}
    if len(by_id) != len(arms):
        raise SpecError("spec: duplicate arm ids")

    effects = []
    warnings = []
    for i, e in enumerate(spec["effects"]):
        for k in ("group", "label", "a", "b", "diff"):
            if k not in e:
                raise SpecError(f"spec effects[{i}]: missing '{k}'")
        full = resolve(camp, e["diff"], f"effect {e['label']} diff")
        d, sha = read_json(full)
        inputs.append((rel(full), sha))
        if (d.get("label_a"), d.get("label_b")) != (e["a"], e["b"]):
            raise SpecError(f"{rel(full)}: labels ({d.get('label_a')}, {d.get('label_b')}) != spec ({e['a']}, {e['b']})")
        lo, hi = _need(d, ["ci95_nats"], rel(full))
        diff = float(_need(d, ["diff_nats_per_tok"], rel(full)))
        lo, hi = float(lo), float(hi)
        res = is_resolved(lo, hi)
        verdict = d.get("verdict", "")
        if res != (verdict != "not resolved") and verdict:
            warnings.append(f"{rel(full)}: CI-based resolved={res} disagrees with file verdict {verdict!r}")
        for side, key in (("a", "kl_a"), ("b", "kl_b")):
            arm = by_id.get(e[side])
            if arm and key in d and abs(float(d[key]) - arm["kl"]) > 2e-6:
                warnings.append(f"{rel(full)}: {key}={d[key]} differs from arm {e[side]} score {arm['kl']}")
        effects.append(dict(group=e["group"], label=e["label"], a=e["a"], b=e["b"], src=rel(full),
                            diff=diff, lo=lo, hi=hi, resolved=res, verdict=verdict))
    return dict(spec=spec, spec_sha=spec_sha, campaign=camp, out_dir=out_dir, arms=arms, effects=effects,
                inputs=inputs, slots=slots, warnings=warnings, reference=spec.get("reference", "Q8_0"))


def is_resolved(lo, hi):
    """Resolved = the 95% CI excludes 0. A CI that touches 0 (lo == 0 or hi == 0, also -0.0) is NOT resolved."""
    return lo > 0 or hi < 0


def order_arms(arms):
    """KL ascending; ties keep spec order (sorted() is stable, key adds the spec index explicitly)."""
    return sorted(arms, key=lambda a: (a["kl"], a["order"]))


# ============================================================ formatting
def f4(v):
    """4 significant digits, trailing zeros kept (0.08870)."""
    return format(v, "#.4g")


def dis_pct(top1):
    return round(100.0 * (1.0 - top1), 6)


def f_dis(top1):
    return f"{dis_pct(top1):.2f}"


def fsigned(v, nd):
    s = f"{v:+.{nd}f}".replace("-", MINUS)
    if float(f"{v:.{nd}f}") == 0:
        s = f"{0:.{nd}f}"
    return s


def effect_decimals(e):
    return 6 if max(abs(e["diff"]), abs(e["lo"]), abs(e["hi"])) < 1e-3 else 4


def effect_text(e):
    nd = effect_decimals(e)
    return (f"{fsigned(e['diff'], nd)} [{fsigned(e['lo'], nd)}, {fsigned(e['hi'], nd)}] · "
            f"{'resolved' if e['resolved'] else 'within noise'}")


def ratio_text(mean, med):
    if med <= 0:
        return None
    r = mean / med
    return f"{r:.0f}×" if r >= 10 else f"{r:.1f}×"


def tick_text(v):
    return f"{round(v, 10):g}"


def tw(s, px=12.0):
    """Rough text width in px (no font metrics in stdlib)."""
    return len(s) * px * 0.53


def nice_step(vmax, n=5):
    return R.nice_max(vmax / n)


# ============================================================ SVG element helpers
def el(tag, attrs, title=None):
    a = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    if title is None:
        return f"<{tag} {a}/>"
    return f"<{tag} {a}><title>{R.esc(title)}</title></{tag}>"


def text(x, y, s, cls="lab", size=12, anchor="start", extra=""):
    return (f'<text x="{x:.1f}" y="{y:.1f}" class="{cls}" font-size="{size}" '
            f'text-anchor="{anchor}"{extra}>{R.esc(s)}</text>')


def fam_color(slot):
    return f"var(--s{slot + 1})"


def legend(x, y, fams, extra=()):
    """fams: [(family, slot)] swatches; extra: [(kind, label)] with kind in outline|filled|ring|tick|glyph."""
    b, cx = [], x
    for name, slot in fams:
        b.append(el("rect", dict(x=cx, y=y - 9, width=12, height=12, rx=3, fill=fam_color(slot)), name))
        b.append(text(cx + 17, y + 1, name, "lab", 11.5))
        cx += 17 + tw(name, 11.5) + 18
    for kind, label in extra:
        if kind == "outline":
            b.append(el("rect", dict(x=cx, y=y - 9, width=12, height=12, rx=3, fill="var(--surface)",
                                     stroke="var(--ink2)", stroke_width=1.8), label))
        elif kind == "filled":
            b.append(el("circle", dict(cx=cx + 6, cy=y - 3, r=5, fill="var(--ink)"), label))
        elif kind == "dot":
            b.append(el("circle", dict(cx=cx + 6, cy=y - 3, r=5, fill="var(--ink2)", stroke="var(--surface)",
                                       stroke_width=1.5), label))
        elif kind == "band":
            b.append(el("rect", dict(x=cx - 2, y=y - 8, width=18, height=10, rx=5, fill="var(--ink2)",
                                     fill_opacity=0.28), label))
            cx += 4
        elif kind == "ring":
            b.append(el("circle", dict(cx=cx + 6, cy=y - 3, r=4.2, fill="var(--surface)", stroke="var(--ink)",
                                       stroke_width=1.8), label))
        elif kind == "tick":
            b.append(el("line", dict(x1=cx + 6, y1=y - 9, x2=cx + 6, y2=y + 3, stroke="var(--ink2)",
                                     stroke_width=2.5), label))
        b.append(text(cx + 17, y + 1, label, "lab", 11.5))
        cx += 17 + tw(label, 11.5) + 18
    return "".join(b)


def used_families(arms, slots):
    seen = []
    for a in arms:
        if a["family"] not in [s[0] for s in seen]:
            seen.append((a["family"], slots[a["family"]] - 1))
    return seen


def gutter_width(labels, size=12.0):
    return 20 + max(tw(s, size) for s in labels) + 12


# ============================================================ K1 scorecard
def chart_scorecard(data):
    arms = order_arms(data["arms"])
    fams = used_families(data["arms"], data["slots"])
    ref = data["reference"]
    G = gutter_width([a["label"] for a in arms])
    x1, pw1, lab1 = G + 6, 290, 168
    x2 = x1 + pw1 + lab1 + 28
    pw2 = 150
    W = int(max(900, x2 + pw2 + 70))
    top, pitch, bh = 112, 26, 18
    nrows = len(arms)
    bot = top + nrows * pitch
    H = bot + 46
    kmax = max(a["hi"] for a in arms)
    s1 = nice_step(kmax)
    k_axis = math.ceil(kmax / s1 - 1e-9) * s1
    dmax = max(dis_pct(a["top1"]) for a in arms)
    s2 = nice_step(dmax)
    d_axis = math.ceil(dmax / s2 - 1e-9) * s2

    def X1(v): return x1 + pw1 * v / k_axis
    def X2(v): return x2 + pw2 * v / d_axis

    b = []
    R._title(b, f"How far is each arm from {ref}?",
             f"KL({ref} ‖ arm), 128 prompts × 32 positions · dot = mean (the score) · shaded band = 95% "
             f"cluster-bootstrap CI · lower = closer to {ref}")
    b.append(legend(20, 66, fams, [("dot", "mean"), ("band", "95% CI"),
                                   ("outline", "hollow / outlined = re-boot floor")]))
    b.append(text(x1, top - 28, "KL (nats/token)", "t", 12.5))
    b.append(text(x2, top - 28, "Top-1 disagreement (%)", "t", 12.5))
    # grids + tick labels (recessive)
    for panel, ax, st_, X in ((1, k_axis, s1, X1), (2, d_axis, s2, X2)):
        n = int(round(ax / st_))
        for i in range(n + 1):
            v = i * st_
            b.append(el("line", dict(x1=f"{X(v):.1f}", y1=top - 4, x2=f"{X(v):.1f}", y2=bot, stroke="var(--grid)",
                                     stroke_width=1)))
            b.append(text(X(v), bot + 16, tick_text(v), "mut", 10.5, "middle"))
    for panel, X0, pw in ((1, x1, pw1), (2, x2, pw2)):
        b.append(el("line", dict(x1=X0, y1=top - 4, x2=X0, y2=bot, stroke="var(--axis)", stroke_width=1.2)))
    # reference line at the llama.cpp floor row
    floor_arm = next((a for a in data["arms"] if a["id"] == data["spec"].get("floor_ref", "q8f")), None)
    if floor_arm is not None:
        fx = X1(floor_arm["kl"])
        b.append(el("line", dict(x1=f"{fx:.1f}", y1=top - 6, x2=f"{fx:.1f}", y2=bot, stroke="var(--ink2)",
                                 stroke_width=1.2, stroke_dasharray="4 3", data_kind="ref-line"),
                    f"llama.cpp re-run floor: KL {f4(floor_arm['kl'])} ({floor_arm['id']})"))
        b.append(text(fx + 6, top - 10, "llama.cpp re-run floor", "lab", 10.5))
    for i, a in enumerate(arms):
        y = top + i * pitch + (pitch - bh) / 2
        cy = y + bh / 2
        col = fam_color(a["slot"])
        b.append(text(G, cy + 4, a["label"], "lab", 12, "end"))
        tip = (f"{a['label']}: KL {f4(a['kl'])} nats/tok, 95% CI [{f4(a['lo'])}, {f4(a['hi'])}]; "
               f"top-1 disagreement {f_dis(a['top1'])}%" + (" (re-boot floor)" if a["floor"] else ""))
        # left panel: dot-and-band (no bar, so the CI never reads as a misaligned bar end)
        xl, xh = X1(a["lo"]), X1(a["hi"])
        bw_ = max(10.0, xh - xl)
        b.append(el("rect", dict(x=f"{(xl + xh - bw_) / 2:.1f}", y=f"{cy - 5:.1f}", width=f"{bw_:.1f}", height=10,
                                 rx=5, fill=col, fill_opacity=0.28, data_kind="ci-band", data_arm=a["id"]), tip))
        dot = dict(cx=f"{X1(a['kl']):.1f}", cy=f"{cy:.1f}", r=5.5, data_kind="mean-dot", data_arm=a["id"])
        if a["floor"]:
            dot.update(fill="var(--surface)", stroke=col, stroke_width=2.2, data_floor=1)
        else:
            dot.update(fill=col, stroke="var(--surface)", stroke_width=1.5)
        b.append(el("circle", dot, tip))
        lx = max(xh, X1(a["kl"]) + 6) + 10
        b.append(text(lx, cy + 4, f4(a["kl"]), "val", 12))
        b.append(text(lx + tw(f4(a["kl"]), 12) + 6, cy + 4, f"[{f4(a['lo'])}–{f4(a['hi'])}]", "mut", 10.5))
        # right panel: bar
        bw2 = max(1.5, X2(dis_pct(a["top1"])) - x2)
        at = dict(x=f"{x2:.1f}", y=f"{y:.1f}", width=f"{bw2:.1f}", height=bh, rx=min(4, bw2 / 2),
                  data_arm=a["id"], data_kind="bar-dis")
        if a["floor"]:
            at.update(fill="var(--surface)", stroke=col, stroke_width=2, data_floor=1)
        else:
            at.update(fill=col)
        b.append(el("rect", at, tip))
        b.append(text(X2(dis_pct(a["top1"])) + 8, cy + 4, f_dis(a["top1"]), "val", 12))
    return R.svg(W, H, "".join(b))


# ============================================================ K2 effects forest
def chart_effects(data):
    effs = data["effects"]
    ref = data["reference"]
    groups = []
    for e in effs:
        if e["group"] not in [g[0] for g in groups]:
            groups.append((e["group"], []))
        dict(groups)[e["group"]].append(e)
    G = gutter_width([e["label"] for e in effs])
    x0, pw = G + 14, 380
    txt_w = max(tw(effect_text(e), 11.5) for e in effs)
    W = int(max(900, x0 + pw + 24 + txt_w + 24))
    lo_v = min([e["lo"] for e in effs] + [0.0])
    hi_v = max([e["hi"] for e in effs] + [0.0])
    step = R.nice_max((hi_v - lo_v) / 6)
    a_lo = math.floor(lo_v / step + 1e-9) * step
    a_hi = math.ceil(hi_v / step - 1e-9) * step

    def X(v): return x0 + pw * (v - a_lo) / (a_hi - a_lo)

    top = 100
    pitch, gpitch = 27, 26
    y = top
    rows = []                       # (kind, y, payload)
    for gname, es in groups:
        rows.append(("g", y + 12, gname))
        y += gpitch
        for e in es:
            rows.append(("r", y + pitch / 2, e))
            y += pitch
    bot = y + 2
    H = bot + 66
    b = []
    R._title(b, "What changes quality? One knob at a time",
             f"Δ KL = KL({ref}‖A) − KL({ref}‖B) on the same 4,096 positions · whisker = 95% CI "
             f"· ● resolved (CI excludes 0) · ○ within noise")
    b.append(legend(20, 66, [], [("filled", "resolved (CI excludes 0)"), ("ring", "within noise (CI includes 0)")]))
    n = int(round((a_hi - a_lo) / step))
    for i in range(n + 1):
        v = a_lo + i * step
        b.append(el("line", dict(x1=f"{X(v):.1f}", y1=top - 4, x2=f"{X(v):.1f}", y2=bot, stroke="var(--grid)",
                                 stroke_width=1)))
        b.append(text(X(v), bot + 15, fsigned(round(v, 10), 3) if abs(v) > 1e-12 else "0", "mut", 10.5, "middle"))
    b.append(el("line", dict(x1=f"{X(0):.1f}", y1=top - 4, x2=f"{X(0):.1f}", y2=bot, stroke="var(--ink2)",
                             stroke_width=1.4, data_kind="zero-line"), "zero: no difference"))
    b.append(text(x0, bot + 38, f"← A closer to {ref}", "lab", 11.5, "start"))
    b.append(text(x0 + pw, bot + 38, f"A further from {ref} →", "lab", 11.5, "end"))
    b.append(text(x0 + pw / 2, bot + 56, "Δ KL (nats/token), A − B", "mut", 10.5, "middle"))
    for kind, yy, p in rows:
        if kind == "g":
            b.append(text(20, yy + 4, p.upper(), "mut", 10.5, "start", ' font-weight="600" letter-spacing="0.6"'))
            continue
        e = p
        tip = (f"{e['label']}: Δ KL {effect_text(e)}; 95% CI [{e['lo']}, {e['hi']}]; "
               f"{'CI excludes 0' if e['resolved'] else 'CI includes 0'}")
        b.append(text(G, yy + 4, e["label"], "lab", 12, "end"))
        xl, xh = X(e["lo"]), X(e["hi"])
        b.append(el("line", dict(x1=f"{xl:.1f}", y1=f"{yy:.1f}", x2=f"{xh:.1f}", y2=f"{yy:.1f}", stroke="var(--ink)",
                                 stroke_width=1.5, data_kind="whisker"), tip))
        for xx in (xl, xh):
            b.append(el("line", dict(x1=f"{xx:.1f}", y1=f"{yy - 4:.1f}", x2=f"{xx:.1f}", y2=f"{yy + 4:.1f}",
                                     stroke="var(--ink)", stroke_width=1.5, data_kind="cap"), tip))
        mk = dict(cx=f"{X(e['diff']):.1f}", cy=f"{yy:.1f}", r=5, data_kind="marker",
                  data_resolved=int(e["resolved"]))
        if e["resolved"]:
            mk.update(fill="var(--ink)", stroke="var(--surface)", stroke_width=1.5)
        else:
            mk.update(fill="var(--surface)", stroke="var(--ink)", stroke_width=1.8)
        b.append(el("circle", mk, tip))
        wt = ' font-weight="600"' if e["resolved"] else ""
        b.append(text(x0 + pw + 24, yy + 4, effect_text(e), "val" if e["resolved"] else "lab", 11.5, "start", wt))
    return R.svg(W, int(H), "".join(b))


# ============================================================ K3 typical vs mean (log)
def chart_typical(data):
    arms = order_arms(data["arms"])
    fams = used_families(data["arms"], data["slots"])
    G = gutter_width([a["label"] for a in arms])
    pos = [v for a in arms for v in (a["med"], a["p90"], a["kl"]) if v > 0]
    lo_exp = math.floor(math.log10(min(pos)) - 0.15)
    hi_exp = math.ceil(math.log10(max(pos)) + 0.15)
    amin = 10.0 ** lo_exp
    x0, pw = G + 8, 420
    lab_txt = [f"{f4(a['kl'])} · mean ÷ median = {ratio_text(a['kl'], a['med']) or 'n/a'}" for a in arms]
    W = int(max(900, x0 + pw + 18 + max(tw(s, 11.5) for s in lab_txt) + 24))
    top, pitch = 88, 26
    bot = top + len(arms) * pitch
    H = bot + 50

    def X(v):
        v = max(v, amin)
        return x0 + pw * (math.log10(v) - lo_exp) / (hi_exp - lo_exp)

    def fmin():
        return f"1e{lo_exp}" if lo_exp < -2 else f"{amin:g}"

    b = []
    R._title(b, "Most tokens agree; the score is driven by rare large misses",
             "per arm, log scale, nats/token: ○ median position · ● mean (the score) "
             "· ┃ 90th percentile")
    b.append(legend(20, 66, fams, [("ring", "median"), ("filled", "mean (the score)"), ("tick", "90th percentile")]))
    for e in range(lo_exp, hi_exp + 1):
        v = 10.0 ** e
        b.append(el("line", dict(x1=f"{X(v):.1f}", y1=top - 4, x2=f"{X(v):.1f}", y2=bot, stroke="var(--grid)",
                                 stroke_width=1)))
        t = f"1e{e}" if e < -2 else f"{v:g}"
        b.append(text(X(v), bot + 16, t, "mut", 10.5, "middle"))
    b.append(el("line", dict(x1=x0, y1=top - 4, x2=x0, y2=bot, stroke="var(--axis)", stroke_width=1.2)))
    b.append(text(x0 + pw / 2, bot + 36, "KL per position (nats/token), log scale", "mut", 10.5, "middle"))
    for i, a in enumerate(arms):
        cy = top + i * pitch + pitch / 2
        col = fam_color(a["slot"])
        b.append(text(G, cy + 4, a["label"], "lab", 12, "end"))
        clamp = {k: a[k] <= 0 for k in ("med", "p90", "kl")}
        tip = (f"{a['label']}: median {a['med']:g}, mean {a['kl']:g}, p90 {a['p90']:g} nats/token" +
               (f"; value(s) ≤ 0 clamped to the axis minimum {fmin()}" if any(clamp.values()) else ""))
        xm, xp, xk = X(a["med"]), X(a["p90"]), X(a["kl"])
        b.append(el("line", dict(x1=f"{xm:.1f}", y1=f"{cy:.1f}", x2=f"{xp:.1f}", y2=f"{cy:.1f}", stroke=col,
                                 stroke_width=1.5, data_kind="spread", data_arm=a["id"]), tip))
        b.append(el("line", dict(x1=f"{xp:.1f}", y1=f"{cy - 7:.1f}", x2=f"{xp:.1f}", y2=f"{cy + 7:.1f}", stroke=col,
                                 stroke_width=2.5, data_kind="p90", data_arm=a["id"]), tip))
        b.append(el("circle", dict(cx=f"{xm:.1f}", cy=f"{cy:.1f}", r=4.2, fill="var(--surface)", stroke=col,
                                   stroke_width=2, data_kind="median", data_arm=a["id"]), tip))
        b.append(el("circle", dict(cx=f"{xk:.1f}", cy=f"{cy:.1f}", r=5, fill=col, stroke="var(--surface)",
                                   stroke_width=1.5, data_kind="mean", data_arm=a["id"]), tip))
        for k, xx in (("med", xm), ("p90", xp), ("kl", xk)):
            if clamp[k]:
                b.append(text(xx + 8, cy - 8, f"≤ {fmin()}", "mut", 9.5))
        b.append(text(x0 + pw + 18, cy + 4, lab_txt[i], "val", 11.5))
    return R.svg(W, int(H), "".join(b))


# ============================================================ appendix + sources
def appendix_md(data):
    arms = order_arms(data["arms"])
    ref = data["reference"]
    L = []
    L.append("## Appendix: KLD charts (generated by `bench/perf/kld_charts.py`)\n")
    L.append(f"Generated from the committed score and paired-difference files listed in `sources.json` (sha256 per file). "
             f"Reference: {ref}. Each chart is followed by a table twin with every plotted value, its source file and field. "
             "\"Resolved\" means the 95% CI of the paired difference excludes 0 (a CI that touches 0 is within noise). "
             "Colors: llama.cpp, radiance and sly vLLM are fixed family colors; every mark also has a direct label.\n")
    # K1
    L.append("### K1. How far is each arm from the reference?\n")
    L.append("![KL scorecard](charts/kld-scorecard.svg)\n")
    L.append("Table twin. Rows are sorted by KL ascending (ties keep spec order). Floor rows (hollow dot / outlined bar) are re-boots/re-runs. "
             "Fields: `kl_nats_per_tok`, `ci95_nats`, `top1_agreement` (plotted as 100 × (1 − `top1_agreement`)).\n")
    L.append("| Arm | Family | Floor | KL nats/tok | CI95 low | CI95 high | top-1 agreement | Top-1 disagreement % | Source file |")
    L.append("|---|---|---|--:|--:|--:|--:|--:|---|")
    for a in arms:
        L.append(f"| {a['label']} | {a['family']} | {'yes' if a['floor'] else ''} | {a['kl']} | {a['lo']} | {a['hi']} | "
                 f"{a['top1']} | {f_dis(a['top1'])} | `{a['src']}` |")
    # K2
    L.append("\n### K2. What changes quality? One knob at a time\n")
    L.append("![Paired effects](charts/kld-effects.svg)\n")
    L.append("Table twin. Δ KL = KL(ref‖A) − KL(ref‖B). Fields: `diff_nats_per_tok`, `ci95_nats`, `verdict` (the file's own verdict).\n")
    L.append("| Group | Comparison | A | B | Δ KL | CI95 low | CI95 high | Resolved (CI excludes 0) | File verdict | Source file |")
    L.append("|---|---|---|---|--:|--:|--:|---|---|---|")
    for e in data["effects"]:
        L.append(f"| {e['group']} | {e['label']} | {e['a']} | {e['b']} | {e['diff']} | {e['lo']} | {e['hi']} | "
                 f"{'resolved' if e['resolved'] else 'within noise'} | {e['verdict']} | `{e['src']}` |")
    # K3
    L.append("\n### K3. Typical position vs the mean\n")
    L.append("![Typical vs mean](charts/kld-typical-vs-mean.svg)\n")
    L.append("Table twin. Rows in the K1 order. Fields: `kl_per_position.median`, `kl_per_position.p90`, `kl_nats_per_tok` "
             "(the mean, i.e. the score). Mean ÷ median is computed here (INFERRED, ratio of the two MEASURED values).\n")
    L.append("| Arm | Median / position | p90 / position | Mean (score) | Mean ÷ median | Source file |")
    L.append("|---|--:|--:|--:|--:|---|")
    for a in arms:
        r = ratio_text(a["kl"], a["med"]) or "n/a (median ≤ 0)"
        L.append(f"| {a['label']} | {a['med']} | {a['p90']} | {a['kl']} | {r} | `{a['src']}` |")
    L.append("")
    return "\n".join(L)


def sources_json(data):
    camp = data["campaign"]
    try:
        spec_rel = os.path.relpath(data["spec_path"], camp).replace(os.sep, "/")
    except ValueError:
        spec_rel = data["spec_path"]
    return {"spec": {"path": spec_rel, "sha256": data["spec_sha"]},
            "inputs": [{"path": p, "sha256": s} for p, s in sorted(set(data["inputs"]))]}


# ============================================================ main
def run(spec_path, campaign=None):
    data = load_spec(spec_path, campaign)
    data["spec_path"] = os.path.abspath(spec_path)
    out = data["out_dir"]
    os.makedirs(os.path.join(out, "charts"), exist_ok=True)
    for name, fn in zip(CHARTS, (chart_scorecard, chart_effects, chart_typical)):
        with open(os.path.join(out, "charts", name), "w", encoding="utf-8") as f:
            f.write(fn(data))
    with open(os.path.join(out, "appendix.md"), "w", encoding="utf-8") as f:
        f.write(appendix_md(data))
    with open(os.path.join(out, "sources.json"), "w", encoding="utf-8") as f:
        json.dump(sources_json(data), f, indent=1)
        f.write("\n")
    return data


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--spec", required=True, help="spec JSON (all paths inside are relative to the campaign dir)")
    ap.add_argument("--campaign", help="campaign dir (default: parent of the spec's `inputs/` dir)")
    args = ap.parse_args(argv)
    try:
        data = run(args.spec, args.campaign)
    except SpecError as e:
        print(f"kld_charts: {e}", file=sys.stderr)
        return 2
    for w in data["warnings"]:
        print(f"kld_charts: WARN {w}", file=sys.stderr)
    print(f"kld_charts: wrote {len(CHARTS)} charts, appendix.md, sources.json -> "
          f"{os.path.relpath(data['out_dir'], os.getcwd())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
