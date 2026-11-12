#!/usr/bin/env python3
"""Tests for kld_charts.py (synthetic score/diff JSON; scratch dirs live under bench/perf/tmp/, never /tmp)."""
import hashlib
import json
import os
import shutil
import sys
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kld_charts as K  # noqa: E402

SCRATCH = os.path.join(HERE, "tmp", "unit-kld-charts")
SVG_NS = "{http://www.w3.org/2000/svg}"

# id, family, label, kl, lo, hi, top1, median, p90, floor
ARMS = [
    ("q8f", "llama.cpp", "q8f · Q8 re-run", 0.001759, 0.000724, 0.003269, 0.99463, 0.0, 0.000549, True),
    ("c", "radiance", "c · IQ4 radiance", 0.007944, 0.005538, 0.0107, 0.9873, 3.5e-05, 0.007642, False),
    ("d0", "sly vLLM", "d0 · RedHat sly", 0.060662, 0.043289, 0.080256, 0.95508, 0.000386, 0.081545, False),
    ("d0f", "sly vLLM", "d0f · re-boot of d0", 0.060662, 0.043293, 0.080256, 0.95508, 0.000386, 0.081545, True),
    ("e", "sly vLLM", "e · heretic sly", 0.088703, 0.066886, 0.112943, 0.94409, 0.000489, 0.130089, False),
]
# a, b, diff, lo, hi
EFFECTS = [
    ("Re-boot noise", "vLLM re-boot", "d0f", "d0", 4e-06, -0.0, 1e-05),         # CI touches 0 -> within noise
    ("Engine", "touches zero above", "d0", "c", 0.01, 0.0, 0.02),               # lo == 0 -> within noise
    ("Engine", "resolved lower", "c", "d0", -0.05, -0.07, -0.03),               # hi < 0 -> resolved
    ("Model", "resolved higher", "e", "d0", 0.0282, 0.009, 0.042),              # lo > 0 -> resolved
]


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f)


def make_campaign(name, arms=ARMS, effects=EFFECTS, score_dir="results/b1/scores"):
    camp = os.path.join(SCRATCH, name)
    shutil.rmtree(camp, ignore_errors=True)
    spec = {"reference": "Q8_0", "out": "results/kld-final", "arms": [], "effects": []}
    for i, fam, lab, kl, lo, hi, t1, med, p90, fl in arms:
        rel = f"{score_dir}/kldf2-{i}.json"
        write(os.path.join(camp, rel), {"kind": "kld_forced", "label": i, "reference_label": "q8", "n_positions": 4096,
                                        "kl_nats_per_tok": kl, "ci95_nats": [lo, hi], "top1_agreement": t1,
                                        "kl_per_position": {"median": med, "p90": p90, "max": 1.0}})
        a = {"id": i, "family": fam, "label": lab, "score": rel}
        if fl:
            a["floor"] = True
        spec["arms"].append(a)
    kls = {a[0]: a[3] for a in arms}
    for g, lab, a, b, d, lo, hi in effects:
        rel = f"results/b1/diffs/diff2-{a}-{b}.json"
        write(os.path.join(camp, rel), {"kind": "kld_forced_diff", "label_a": a, "label_b": b, "kl_a": kls.get(a),
                                        "kl_b": kls.get(b), "diff_nats_per_tok": d, "ci95_nats": [lo, hi],
                                        "verdict": "resolved" if K.is_resolved(lo, hi) else "not resolved"})
        spec["effects"].append({"group": g, "label": lab, "a": a, "b": b, "diff": rel})
    sp = os.path.join(camp, "inputs", "kld-charts.json")
    write(sp, spec)
    return camp, sp


def rb(path):
    with open(path, "rb") as f:
        return f.read()


def rj(path):
    with open(path) as f:
        return json.load(f)


def parse(path):
    return ET.parse(path).getroot()


def texts(root):
    return [("".join(t.itertext())) for t in root.iter(SVG_NS + "text")]


class KldChartsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.camp, cls.spec = make_campaign("main")
        cls.data = K.run(cls.spec)
        cls.out = os.path.join(cls.camp, "results", "kld-final")
        cls.svg = {n: os.path.join(cls.out, "charts", n) for n in K.CHARTS}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(SCRATCH, ignore_errors=True)

    def test_outputs_exist_and_parse_as_xml(self):
        for n, p in self.svg.items():
            self.assertTrue(os.path.exists(p), n)
            root = parse(p)
            self.assertEqual(root.tag, SVG_NS + "svg")
        for f in ("appendix.md", "sources.json"):
            self.assertTrue(os.path.exists(os.path.join(self.out, f)))

    def test_every_arm_label_and_value_present(self):
        for n in ("kld-scorecard.svg", "kld-typical-vs-mean.svg"):
            tx = "\n".join(texts(parse(self.svg[n])))
            for a in self.data["arms"]:
                self.assertIn(a["label"], tx, (n, a["id"]))
        sc = "\n".join(texts(parse(self.svg["kld-scorecard.svg"])))
        for a in self.data["arms"]:
            self.assertIn(K.f4(a["kl"]), sc)
            self.assertIn(K.f_dis(a["top1"]), sc)
        self.assertIn("0.001759", sc)           # 4 sig digits kept
        self.assertIn("0.06066", sc)
        self.assertIn("5.59", sc)               # 100 * (1 - 0.94409)
        self.assertIn("llama.cpp re-run floor", sc)
        ty = "\n".join(texts(parse(self.svg["kld-typical-vs-mean.svg"])))
        self.assertIn("mean ÷ median", ty)
        ef = "\n".join(texts(parse(self.svg["kld-effects.svg"])))
        for e in self.data["effects"]:
            self.assertIn(e["label"], ef)
            self.assertIn(K.effect_text(e), ef)
        self.assertIn("← A closer to Q8_0", ef)
        self.assertIn("A further from Q8_0 →", ef)

    def test_scorecard_sorted_by_kl_ties_keep_spec_order(self):
        order = [a["id"] for a in K.order_arms(self.data["arms"])]
        self.assertEqual(order, ["q8f", "c", "d0", "d0f", "e"])      # d0 and d0f tie: spec order
        tx = texts(parse(self.svg["kld-scorecard.svg"]))
        labs = [t for t in tx if any(t == a["label"] for a in self.data["arms"])]
        self.assertEqual(labs, [a["label"] for a in K.order_arms(self.data["arms"])])

    def test_resolved_logic(self):
        self.assertFalse(K.is_resolved(-0.0, 1e-05))
        self.assertFalse(K.is_resolved(0.0, 0.02))       # lower bound touches 0
        self.assertFalse(K.is_resolved(-0.02, 0.0))      # upper bound touches 0
        self.assertFalse(K.is_resolved(-0.001, 0.001))
        self.assertTrue(K.is_resolved(0.000001, 0.02))
        self.assertTrue(K.is_resolved(-0.07, -0.03))
        flags = [e["resolved"] for e in self.data["effects"]]
        self.assertEqual(flags, [False, False, True, True])
        root = parse(self.svg["kld-effects.svg"])
        marks = [c for c in root.iter(SVG_NS + "circle") if c.get("data-kind") == "marker"]
        self.assertEqual([m.get("data-resolved") for m in marks], ["0", "0", "1", "1"])
        for m in marks:
            if m.get("data-resolved") == "1":
                self.assertEqual(m.get("fill"), "var(--ink)")
            else:
                self.assertEqual(m.get("fill"), "var(--surface)")        # hollow
        ef = "\n".join(texts(root))
        self.assertIn("· within noise", ef)
        self.assertIn("· resolved", ef)

    def test_floor_rows_render_outlined(self):
        root = parse(self.svg["kld-scorecard.svg"])
        bars = [r for r in root.iter(SVG_NS + "rect") if r.get("data-kind", "").startswith("bar-")]
        bars += [c for c in root.iter(SVG_NS + "circle") if c.get("data-kind") == "mean-dot"]
        self.assertEqual(len(bars), 2 * len(ARMS))
        floors = {a[0] for a in ARMS if a[-1]}
        for r in bars:
            if r.get("data-arm") in floors:
                self.assertEqual(r.get("fill"), "var(--surface)")
                self.assertTrue(r.get("stroke", "").startswith("var(--s"))
                self.assertEqual(r.get("data-floor"), "1")
            else:
                self.assertTrue(r.get("fill", "").startswith("var(--s"))
                self.assertIn(r.get("stroke"), (None, "var(--surface)"))
        # family colours: q8f llama.cpp = slot 1, c radiance = slot 2, d0 sly = slot 8
        by = {r.get("data-arm"): r for r in bars if r.get("data-kind") == "mean-dot"}
        self.assertEqual(by["c"].get("fill"), "var(--s2)")
        self.assertEqual(by["d0"].get("fill"), "var(--s8)")
        self.assertEqual(by["q8f"].get("stroke"), "var(--s1)")

    def test_every_mark_has_a_tooltip(self):
        for n, p in self.svg.items():
            root = parse(p)
            for tag in ("rect", "circle", "line"):
                for e in root.iter(SVG_NS + tag):
                    if e.get("data-kind") in ("bar-kl", "bar-dis", "whisker", "cap", "ci-band", "mean-dot", "marker", "median", "mean",
                                              "p90", "spread"):
                        t = e.find(SVG_NS + "title")
                        self.assertTrue(t is not None and t.text, (n, e.attrib))

    def test_log_axis_clamps_zero_median(self):
        # q8f has median 0.0 in the synthetic data
        root = parse(self.svg["kld-typical-vs-mean.svg"])
        tx = texts(root)
        clamp = [t for t in tx if t.startswith("≤ ")]
        self.assertEqual(len(clamp), 1, clamp)
        pos = [v for a in self.data["arms"] for v in (a["med"], a["p90"], a["kl"]) if v > 0]
        import math
        amin = 10.0 ** (math.floor(math.log10(min(pos)) - 0.15))
        self.assertIn(f"≤ {amin:g}" if amin >= 1e-2 else f"≤ 1e{round(math.log10(amin))}", clamp)
        med = [c for c in root.iter(SVG_NS + "circle") if c.get("data-kind") == "median" and c.get("data-arm") == "q8f"][0]
        cx = float(med.get("cx"))
        self.assertTrue(math.isfinite(cx))
        others = [float(c.get("cx")) for c in root.iter(SVG_NS + "circle")
                  if c.get("data-kind") == "median" and c.get("data-arm") != "q8f"]
        self.assertLess(cx, min(others))                       # sits at the left axis edge
        self.assertIn("clamped", [t for t in root.iter(SVG_NS + "title") if "q8f" in (t.text or "")][0].text)
        # and the ratio for a 0 median is n/a, not a crash
        self.assertIsNone(K.ratio_text(0.001, 0.0))
        self.assertIn("n/a", "\n".join(texts(root)))

    def test_axis_covers_all_values(self):
        root = parse(self.svg["kld-typical-vs-mean.svg"])
        xs = [float(c.get("cx")) for c in root.iter(SVG_NS + "circle") if c.get("data-kind") in ("median", "mean")]
        self.assertTrue(all(x >= 0 for x in xs))
        # p90 ticks are inside the plot too
        p90 = [float(l.get("x1")) for l in root.iter(SVG_NS + "line") if l.get("data-kind") == "p90"]
        self.assertTrue(max(p90) <= max(xs) + 200)

    def test_tmp_input_path_refused(self):
        camp, sp = make_campaign("tmpref", score_dir="tmp/runs/x/scores")
        with self.assertRaises(K.SpecError) as cm:
            K.load_spec(sp)
        self.assertIn("tmp/", str(cm.exception))
        self.assertEqual(K.main(["--spec", sp]), 2)
        self.assertFalse(os.path.exists(os.path.join(camp, "results", "kld-final")))
        # also `..` escapes and tmp reached through a dot-segment
        with self.assertRaises(K.SpecError):
            K.resolve(camp, "results/./tmp/x.json")
        with self.assertRaises(K.SpecError):
            K.resolve(camp, "../other/x.json")
        self.assertEqual(os.path.basename(K.resolve(camp, "results/attmp/x.json")), "x.json")   # not a segment

    def test_tmp_symlink_refused(self):
        camp, sp = make_campaign("symlink")
        os.makedirs(os.path.join(camp, "tmp", "real"))
        os.symlink(os.path.join(camp, "tmp", "real"), os.path.join(camp, "results", "linked"))
        with self.assertRaises(K.SpecError):
            K.resolve(camp, "results/linked/x.json")

    def test_sources_json_sha256_match(self):
        src = rj(os.path.join(self.out, "sources.json"))
        self.assertEqual(len(src["inputs"]), len(ARMS) + len(EFFECTS))
        for ent in src["inputs"]:
            raw = rb(os.path.join(self.camp, ent["path"]))
            self.assertEqual(ent["sha256"], hashlib.sha256(raw).hexdigest(), ent["path"])
            self.assertNotIn("tmp", ent["path"].split("/"))
        raw = rb(self.spec)
        self.assertEqual(src["spec"]["sha256"], hashlib.sha256(raw).hexdigest())

    def test_appendix_twins_list_every_value_with_source(self):
        md = rb(os.path.join(self.out, "appendix.md")).decode()
        for n in K.CHARTS:
            self.assertIn(f"charts/{n}", md)
        for a in self.data["arms"]:
            self.assertIn(a["src"], md)
            self.assertIn(str(a["kl"]), md)
            self.assertIn(str(a["med"]), md)
            self.assertIn(str(a["p90"]), md)
        for e in self.data["effects"]:
            self.assertIn(e["src"], md)
            self.assertIn(str(e["diff"]), md)

    def test_bad_label_in_score_file_is_an_error(self):
        camp, sp = make_campaign("badlabel")
        p = os.path.join(camp, "results/b1/scores/kldf2-c.json")
        d = rj(p); d["label"] = "zzz"; write(p, d)
        with self.assertRaises(K.SpecError):
            K.load_spec(sp)


if __name__ == "__main__":
    unittest.main()
