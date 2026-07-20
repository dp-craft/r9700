#!/usr/bin/env python3
"""test_aggregate.py — unit + edge-case + stress tests for aggregate.py (stdlib unittest, no deps).

  python3 test_aggregate.py           # all tests
  python3 test_aggregate.py -v        # verbose
  python3 test_aggregate.py Stress    # just the stress class

Covers: helpers; load_cells across many field combinations (runaway variants, grade errors, missing
VRAM, partial/empty runs, bulk-`response` dropping); calib_bands (task-filtering, missing models);
findings (budget curve rise/hold/fall, depth delta, KV ≤5%-vs-exceeds both signs, capability gaps,
health flags incl. the GTT >500 boundary); end-to-end file output; a scaling stress test; and a fuzz
loop asserting invariants on random data.
"""
import json, os, sys, tempfile, time, random, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aggregate as A


def write_jsonl(path, rows):
    with open(path, "w") as fo:
        for r in rows:
            fo.write(json.dumps(r) + "\n")


class Run:
    """Builds a synthetic out/ dir + a configs.jsonl so load_cells/build_digest can be exercised
    against arbitrary matrices without touching the real campaign files."""
    def __init__(self):
        self.d = tempfile.mkdtemp(prefix="aggtest-")
        self.out = os.path.join(self.d, "out"); os.makedirs(self.out)
        self.configs = os.path.join(self.d, "configs.jsonl")
        self.calib = os.path.join(self.d, "calib.jsonl")
        self._cfg, self._ts, self._jd, self._o, self._vr, self._cal = [], [], [], [], [], []

    def cfg(self, label, model="M.gguf", kv="f16", depth="64k", budget=2048, **kw):
        self._cfg.append(dict(label=label, model=model, kv=kv, depth=depth, budget=budget, **kw)); return self

    def score(self, config, task_id="lru-cache", rep=0, tier="sonnet", score=0.8, hard_pass=False, objectives=None, **kw):
        r = dict(config=config, task_id=task_id, rep=rep, tier=tier, score=score, hard_pass=hard_pass,
                 objectives=objectives if objectives is not None else {"types": 1, "lint": 1, "tests": 1, "reuse": 0.5, "edge": 1})
        r.update(kw); self._ts.append(r); return self

    def judge(self, config, task_id="lru-cache", rep=0, design=4, clarity=4, robustness=4):
        self._jd.append(dict(config=config, task_id=task_id, rep=rep, design=design, clarity=clarity, robustness=robustness)); return self

    def out_row(self, config, task_id="lru-cache", rep=0, think_tokens: "int | None" = 1000, ttfa_s=10.0,
                decode_tps=90.0, finish_reason="stop", has_answer=True, truncated_thinking=False, response=None):
        r = dict(config=config, task_id=task_id, rep=rep, think_tokens=think_tokens, ttfa_s=ttfa_s,
                 decode_tps=decode_tps, finish_reason=finish_reason, has_answer=has_answer, truncated_thinking=truncated_thinking)
        if response is not None:
            r["response"] = response
        self._o.append(r); return self

    def vram(self, config, **kw):
        self._vr.append(dict(config=config, **kw)); return self

    def cal(self, model, task, score):
        self._cal.append(dict(model=model, task=task, score=score)); return self

    def flush(self):
        write_jsonl(self.configs, self._cfg)
        write_jsonl(os.path.join(self.out, "scores_typescript.jsonl"), self._ts)
        write_jsonl(os.path.join(self.out, "judge_scores.jsonl"), self._jd)
        write_jsonl(os.path.join(self.out, "outputs.jsonl"), self._o)
        write_jsonl(os.path.join(self.out, "vram.jsonl"), self._vr)
        write_jsonl(self.calib, self._cal)
        return self

    def cells(self):
        return A.load_cells(self.out, self.configs)


# ------------------------------------------------------------------ helpers
class TestHelpers(unittest.TestCase):
    def test_mean(self):
        self.assertEqual(A.mean([1, 2, 3]), 2)
        self.assertIsNone(A.mean([]))
        self.assertIsNone(A.mean([None, None]))
        self.assertEqual(A.mean([1, None, 3, "x"]), 2)          # non-numeric filtered

    def test_pct(self):
        self.assertEqual(A.pct([0.5, 1.0]), 75.0)
        self.assertIsNone(A.pct([]))
        self.assertIsNone(A.pct([None]))

    def test_f(self):
        self.assertEqual(A.f(None), "—")
        self.assertEqual(A.f(3.14159, 2), "3.14")
        self.assertEqual(A.f(80.0, 0), "80")


# ------------------------------------------------------------------ load_cells
class TestLoadCells(unittest.TestCase):
    def test_basic_aggregation(self):
        r = Run().cfg("c1", depth="64k", budget=2048)
        r.score("c1", rep=0, score=0.8, hard_pass=False, objectives={"types": 1, "reuse": 0.5})
        r.score("c1", rep=1, score=1.0, hard_pass=True, objectives={"types": 1, "reuse": 1.0})
        r.judge("c1", rep=0, design=3, clarity=4, robustness=5)   # mean 4
        r.judge("c1", rep=1, design=5, clarity=5, robustness=5)   # mean 5
        r.out_row("c1", rep=0, think_tokens=1000, ttfa_s=10, truncated_thinking=True)   # runaway
        r.out_row("c1", rep=1, think_tokens=2000, ttfa_s=20, finish_reason="stop")      # ok
        r.vram("c1", peak_vram_used_mib=23000, peak_gtt_used_mib=78, avg_power_w=210)
        c = r.flush().cells()["c1"]
        self.assertAlmostEqual(c["ts_pct"], 90.0)
        self.assertAlmostEqual(c["hard_pct"], 50.0)
        self.assertAlmostEqual(c["objectives"]["types"], 1.0)
        self.assertAlmostEqual(c["objectives"]["reuse"], 0.75)
        self.assertAlmostEqual(c["judge"], 4.5)
        self.assertAlmostEqual(c["think_tok"], 1500)
        self.assertAlmostEqual(c["ttfa_s"], 15)
        self.assertAlmostEqual(c["runaway_pct"], 50.0)
        self.assertEqual(c["peak_vram"], 23000)
        self.assertEqual(c["n"], 2)
        self.assertEqual(c["n_fail"], 0)

    def test_runaway_variants(self):
        r = Run().cfg("c1")
        r.score("c1", rep=0).score("c1", rep=1).score("c1", rep=2).score("c1", rep=3)
        r.out_row("c1", rep=0, truncated_thinking=True)                                 # runaway
        r.out_row("c1", rep=1, finish_reason="length", has_answer=False)                # runaway
        r.out_row("c1", rep=2, finish_reason="length", has_answer=True)                 # NOT (finished w/ answer)
        r.out_row("c1", rep=3, finish_reason="stop", has_answer=True)                   # NOT
        c = r.flush().cells()["c1"]
        self.assertAlmostEqual(c["runaway_pct"], 50.0)                                  # 2 of 4

    def test_grade_errors_count_as_fail(self):
        r = Run().cfg("c1")
        r.score("c1", rep=0, score=1.0, hard_pass=True)
        r.score("c1", rep=1, score=0.0, hard_pass=False, grade_error="timeout")
        r.out_row("c1", rep=0).out_row("c1", rep=1)
        c = r.flush().cells()["c1"]
        self.assertEqual(c["n"], 2)
        self.assertEqual(c["n_fail"], 1)
        self.assertAlmostEqual(c["ts_pct"], 50.0)                                       # (1.0 + 0.0)/2

    def test_missing_vram_falls_back_then_none(self):
        r = Run().cfg("c1").cfg("c2")
        r.score("c1").out_row("c1").vram("c1", vram_used_mib_at_load=21000)             # no peak -> fallback
        r.score("c2").out_row("c2")                                                     # no vram row at all
        cells = r.flush().cells()
        self.assertEqual(cells["c1"]["peak_vram"], 21000)
        self.assertIsNone(cells["c2"]["peak_vram"])
        self.assertIsNone(cells["c2"]["peak_gtt"])

    def test_unrun_cell_skipped_and_empty(self):
        r = Run().cfg("c1").cfg("c2")                                                   # c2 has NO data
        r.score("c1").out_row("c1")
        cells = r.flush().cells()
        self.assertIn("c1", cells)
        self.assertNotIn("c2", cells)                                                   # skipped
        # totally empty run
        empty = Run().cfg("c1").flush().cells()
        self.assertEqual(empty, {})

    def test_bulk_response_is_dropped(self):
        big = "X" * 200_000
        r = Run().cfg("c1")
        r.score("c1").judge("c1").out_row("c1", response=big).vram("c1", peak_vram_used_mib=23000)
        r.flush()
        _, cells, _, md = A.build_digest(r.out, os.path.join(r.out, "summary.md"), r.configs, [r.calib])
        self.assertNotIn("response", cells["c1"])                                       # not carried into the cell
        self.assertNotIn(big, md)                                                       # not leaked into the digest
        with open(os.path.join(r.out, "summary.json")) as fh:
            self.assertNotIn(big, fh.read())


# ------------------------------------------------------------------ calib_bands
class TestCalibBands(unittest.TestCase):
    def _files(self, rows):
        p = os.path.join(tempfile.mkdtemp(prefix="calib-"), "c.jsonl"); write_jsonl(p, rows); return p

    def test_mean_per_model(self):
        p = self._files([{"model": "haiku", "task": "A", "score": 0.6},
                         {"model": "haiku", "task": "B", "score": 0.8},
                         {"model": "opus", "task": "A", "score": 1.0}])
        b = A.calib_bands(set(), [p])
        self.assertAlmostEqual(b["haiku"], 70.0)
        self.assertAlmostEqual(b["opus"], 100.0)

    def test_task_filter_intersection(self):
        p = self._files([{"model": "haiku", "task": "A", "score": 0.6},
                         {"model": "haiku", "task": "B", "score": 1.0}])
        self.assertAlmostEqual(A.calib_bands({"A"}, [p])["haiku"], 60.0)                # only task A
        self.assertAlmostEqual(A.calib_bands({"A", "B"}, [p])["haiku"], 80.0)
        self.assertAlmostEqual(A.calib_bands(set(), [p])["haiku"], 80.0)               # empty set = all

    def test_missing_files_and_models(self):
        self.assertEqual(A.calib_bands({"A"}, ["/does/not/exist.jsonl"]), {})


# ------------------------------------------------------------------ findings
def _cell(ts=None, hard=0.0, reuse=0.8, gtt=78, runaway=0.0, nfail=0, model="M", depth="64k",
          kv="f16", budget=2048, peak_vram=23000, obj=None):
    return {"model": model, "depth": depth, "kv": kv, "budget": budget, "n": 12, "n_fail": nfail,
            "ts_pct": ts, "hard_pct": hard, "objectives": obj if obj is not None else {"reuse": reuse}, "judge": 4.0,
            "think_tok": 1000, "ttfa_s": 10, "decode_tps": 90, "runaway_pct": runaway,
            "peak_vram": peak_vram, "peak_gtt": gtt, "avg_power_w": 210}


class TestFindings(unittest.TestCase):
    def _ladder_cells(self, q4, xl, q5, q6, a3b):
        """One cell per quant + the 35B, all at the single shared budget (rb4096)."""
        return {
            "un-d128-f16-rb4096": _cell(ts=q4, depth="128k", budget=4096, model="Qwen3.6-27B-MTP-Q4_K_M"),
            "xl-d128-f16-rb4096": _cell(ts=xl, depth="128k", budget=4096, model="Qwen3.6-27B-UD-Q4_K_XL"),
            "q5-d128-q8-rb4096": _cell(ts=q5, depth="128k", budget=4096, model="Qwen3.6-27B-Q5_K_M"),
            "q6-d128-q8-rb4096": _cell(ts=q6, depth="128k", budget=4096, model="Qwen3.6-27B-Q6_K"),
            "a3b-d128-f16-rb4096": _cell(ts=a3b, depth="128k", budget=4096, model="Qwen3.6-35B-A3B"),
        }

    def test_quant_ladder(self):
        s = " ".join(A.findings(self._ladder_cells(70, 72, 74, 78, 75), {}))
        self.assertIn("27B quant ladder", s)
        self.assertIn("Q4_K_M 70% → Q4_K_XL 72% → Q5_K_M 74% → Q6_K 78%", s)
        self.assertIn("best Q6_K", s)

    def test_model_comparison(self):
        s = " ".join(A.findings(self._ladder_cells(70, 72, 74, 78, 75), {}))
        self.assertIn("27B (best quant) vs 35B-A3B", s)
        # best 27B quant = Q6_K 78; 35B = 75 -> Δ-3
        self.assertIn("27B 78 vs 35B 75 (Δ-3)", s)

    def test_ladder_partial_omits_missing(self):
        # only two quants present -> ladder still renders with what exists
        c = {"un-d128-f16-rb4096": _cell(ts=70, depth="128k", budget=4096, model="Qwen3.6-27B-Q4_K_M"),
             "q6-d128-q8-rb4096": _cell(ts=78, depth="128k", budget=4096, model="Qwen3.6-27B-Q6_K")}
        s = " ".join(A.findings(c, {}))
        self.assertIn("Q4_K_M 70% → Q6_K 78%", s)
        self.assertNotIn("Q5_K_M", s)

    def test_strict_wall_means(self):
        c = {"a": _cell(ts=70, obj={"lint": 0.4, "types": 0.6, "tests": 0.9, "edge": 0.95, "reuse": 1.0}),
             "b": _cell(ts=72, obj={"lint": 0.6, "types": 0.8, "tests": 0.9, "edge": 0.95, "reuse": 1.0})}
        s = " ".join(A.findings(c, {}))
        self.assertIn("strict-code wall", s)
        self.assertIn("lint 0.50", s); self.assertIn("types 0.70", s)

    def test_capability_gaps(self):
        c = {"un-d64-f16-rb4096": _cell(ts=87)}
        s = " ".join(A.findings(c, {"haiku": 74.0, "sonnet": 85.0, "opus": 95.0}))
        self.assertIn("best local cell = 87%", s)
        self.assertIn("opus 95% (Δ-8)", s)

    def test_health_flags_and_gtt_boundary(self):
        clean = " ".join(A.findings({"x": _cell(ts=80, gtt=500, runaway=0.0, nfail=0)}, {}))
        self.assertIn("no grade errors, no runaways, no GTT spill", clean)             # 500 is NOT a spill (>500)
        bad = " ".join(A.findings({"x": _cell(ts=80, gtt=501, runaway=8.0, nfail=2)}, {}))
        self.assertIn("GTT spill", bad); self.assertIn("runaway/truncation>0", bad); self.assertIn("HARNESS/grade errors", bad)

    def test_partial_matrix_omits_lines(self):
        s = A.findings({"un-d64-f16-rb2048": _cell(ts=80)}, {})                         # no 128k, no q8
        joined = " ".join(s)
        self.assertNotIn("(c) KV", joined)                                             # A/B needs both cells
        self.assertIn("Health", joined)                                                # always present


# ------------------------------------------------------------------ end to end
class TestEndToEnd(unittest.TestCase):
    def test_build_digest_writes_files(self):
        r = Run().cfg("un-d64-f16-rb2048", depth="64k")
        for rep in range(2):
            r.score("un-d64-f16-rb2048", rep=rep, score=0.8).judge("un-d64-f16-rb2048", rep=rep).out_row("un-d64-f16-rb2048", rep=rep)
        r.vram("un-d64-f16-rb2048", peak_vram_used_mib=23000, peak_gtt_used_mib=78)
        r.cal("haiku", "lru-cache", 0.7).cal("opus", "lru-cache", 0.95)
        r.flush()
        outp, cells, _, md = A.build_digest(r.out, os.path.join(r.out, "summary.md"), r.configs, [r.calib])
        self.assertTrue(os.path.exists(outp) and os.path.exists(outp.replace(".md", ".json")))
        self.assertEqual(len(cells), 1)
        self.assertIn("Per-cell aggregates", md)
        self.assertIn("un-d64-f16-rb2048", md)
        j = json.load(open(outp.replace(".md", ".json")))
        self.assertIn("cells", j); self.assertIn("bands", j)
        self.assertAlmostEqual(j["bands"]["haiku"], 70.0)


# ------------------------------------------------------------------ stress + fuzz
class TestStress(unittest.TestCase):
    def test_scale_and_speed(self):
        """40 configs × 8 tasks × 3 reps = 960 replies, each outputs row carrying a 15 KB response
        (~14 MB outputs.jsonl) — proves it drops the bulk field and stays fast."""
        r = Run()
        labels = [f"m{m}-d{d}-{kv}-rb{b}" for m in range(4) for d in ("64k", "128k")
                  for kv in ("f16", "q8_0") for b in (1024, 2048, 4096)][:40]   # 48 combos -> 40
        blob = "Z" * 15_000
        for L in labels:
            r.cfg(L, depth="128k" if "d128" in L else "64k", kv="q8_0" if "q8_0" in L else "f16",
                  budget=int(L.split("rb")[1]))
            for t in range(8):
                for rep in range(3):
                    r.score(L, task_id=f"t{t}", rep=rep, score=random.uniform(0.5, 1.0), hard_pass=random.random() > 0.7)
                    r.judge(L, task_id=f"t{t}", rep=rep, design=random.randint(2, 5))
                    r.out_row(L, task_id=f"t{t}", rep=rep, response=blob,
                              truncated_thinking=random.random() > 0.9)
        r.flush()
        t0 = time.time()
        _, cells, _, md = A.build_digest(r.out, os.path.join(r.out, "summary.md"), r.configs, [r.calib])
        dt = time.time() - t0
        self.assertEqual(len(cells), 40)
        self.assertLess(dt, 15.0, f"aggregate too slow on 960 rows: {dt:.1f}s")
        self.assertNotIn(blob, md)                                                     # bulk not leaked
        for c in cells.values():                                                       # invariants
            self.assertTrue(0 <= c["ts_pct"] <= 100)
            self.assertTrue(0 <= c["runaway_pct"] <= 100)
            self.assertEqual(c["n"], 24)

    def test_fuzz_no_crash_invariants(self):
        """Random adversarial-ish data for many runs: must never raise and always keep invariants."""
        for it in range(40):
            random.seed(it)
            r = Run()
            for ci in range(random.randint(0, 5)):
                L = f"c{ci}"; r.cfg(L, depth=random.choice(["64k", "128k"]), kv=random.choice(["f16", "q8_0"]))
                for _ in range(random.randint(0, 4)):
                    rep = random.randint(0, 9)
                    kw = {}
                    if random.random() > 0.7:
                        kw["grade_error"] = "x"
                    r.score(L, rep=rep, score=random.choice([0.0, 0.5, 1.0, random.random()]),
                            hard_pass=random.random() > 0.5, **kw)
                    if random.random() > 0.3:
                        r.out_row(L, rep=rep, think_tokens=random.choice([None, 0, 5000]),
                                  finish_reason=random.choice(["stop", "length"]),
                                  has_answer=random.random() > 0.5,
                                  truncated_thinking=random.random() > 0.5)
                    if random.random() > 0.5:
                        r.judge(L, rep=rep, design=random.randint(0, 5))
                    if random.random() > 0.5:
                        r.vram(L, peak_vram_used_mib=random.randint(0, 32000), peak_gtt_used_mib=random.randint(0, 3000))
            r.flush()
            _, cells, _, md = A.build_digest(r.out, os.path.join(r.out, "summary.md"), r.configs, [r.calib])
            self.assertIsInstance(md, str)
            for c in cells.values():
                if c["ts_pct"] is not None:
                    self.assertTrue(0 <= c["ts_pct"] <= 100)
                if c["runaway_pct"] is not None:
                    self.assertTrue(0 <= c["runaway_pct"] <= 100)
                self.assertGreaterEqual(c["n_fail"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
