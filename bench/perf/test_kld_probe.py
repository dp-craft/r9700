#!/usr/bin/env python3
"""Unit tests for kld_probe.py's math core — synthetic fixtures only, no server.

Method locked by the WS3 research (research/ws3-kld-r1.md / r2.md): paired greedy
continuation, KL(ref‖arm) per sly kv4/kl_compare.py (reference top-20 support, floor for
missing tokens, one lumped tail bucket, ε=1e-9, clamp at 0), cluster bootstrap CI
(block = prompt). Run: python3 bench/perf/test_kld_probe.py -v
"""
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kld_probe as K  # noqa: E402


def lp(p):
    return math.log(p)


class TestKLPosition(unittest.TestCase):
    def test_two_token_hand_computed(self):
        # ref = (0.5, 0.5) over {a,b}; arm = (0.9, 0.1); full coverage both sides →
        # tail bucket = EPS·ln(EPS/EPS) = 0. KL = 0.5·ln(0.5/0.9) + 0.5·ln(0.5/0.1)
        ref = [("a", lp(0.5)), ("b", lp(0.5))]
        arm = [("a", lp(0.9)), ("b", lp(0.1))]
        expected = 0.5 * math.log(0.5 / 0.9) + 0.5 * math.log(0.5 / 0.1)
        kl, rm, am = K.kl_position(ref, arm)
        self.assertAlmostEqual(kl, expected, delta=1e-12)
        self.assertAlmostEqual(rm, 1.0, delta=1e-12)
        self.assertAlmostEqual(am, 1.0, delta=1e-12)

    def test_identical_distributions_zero(self):
        # 20-token top + tail, ref == arm exactly → lower bound must be 0 (clamped ≥ 0).
        probs = [0.045 - 0.001 * i for i in range(20)]       # sums to 0.835
        ref = [(100 + i, lp(probs[i])) for i in range(20)]
        arm = list(ref)
        kl, rm, am = K.kl_position(ref, arm)
        self.assertEqual(kl, 0.0)
        self.assertAlmostEqual(rm, sum(probs), delta=1e-12)

    def test_floor_for_missing_token(self):
        # ref {a:0.4, c:0.5} (mass 0.9, tail 0.1); arm {a:0.6, b:0.39} (mass 0.99, tail
        # 0.01) — c is missing from the arm's top-20 ⇒ scored at the floor (the arm's
        # minimum top-20 logprob, exp = 0.39). Hand-computed over the buckets.
        expected = (0.4 * math.log(0.4 / 0.6)
                    + 0.5 * math.log(0.5 / 0.39)                 # missing token → floor
                    + 0.1 * math.log(0.1 / 0.01))                # tail bucket
        ref = [("a", lp(0.4)), ("c", lp(0.5))]
        arm = [("a", lp(0.6)), ("b", lp(0.39))]
        kl, rm, am = K.kl_position(ref, arm)
        self.assertAlmostEqual(kl, expected, delta=1e-12)
        self.assertAlmostEqual(rm, 0.9, delta=1e-12)
        self.assertAlmostEqual(am, 0.99, delta=1e-12)

    def test_floor_path_negative_sum_clamps(self):
        # A fixture where the FLOOR path is exercised and the raw sum is negative
        # (−0.16864 hand-computed) → the lower bound clamps at 0: the floor was applied
        # (c scored at 0.25, not absent), the clamp absorbed the negative sum.
        expected_raw = (0.5 * math.log(0.5 / 0.6)
                        + 0.3 * math.log(0.3 / 0.25)
                        + 0.1 * math.log(0.1 / 0.25)              # missing token → floor
                        + 0.1 * math.log(0.1 / 0.15))             # tail bucket
        self.assertLess(expected_raw, 0.0)   # the fixture's invariant
        ref = [("a", lp(0.5)), ("b", lp(0.3)), ("c", lp(0.1))]
        arm = [("a", lp(0.6)), ("b", lp(0.25))]
        kl, rm, am = K.kl_position(ref, arm)
        self.assertEqual(kl, 0.0)
        self.assertAlmostEqual(rm, 0.9, delta=1e-12)
        self.assertAlmostEqual(am, 0.85, delta=1e-12)

    def test_clamped_at_zero(self):
        # ref spread over 3 tokens, arm concentrated on one: the probe's lower bound is
        # negative (−0.9239…) and must be clamped to 0 (sly kl_compare's max(0,·)).
        ref = [("a", lp(0.3)), ("b", lp(0.3)), ("c", lp(0.3))]   # mass 0.9, tail 0.1
        arm = [("a", lp(0.95))]                                  # mass 0.95, tail 0.05
        kl, rm, am = K.kl_position(ref, arm)
        self.assertEqual(kl, 0.0)
        self.assertAlmostEqual(rm, 0.9, delta=1e-12)
        self.assertAlmostEqual(am, 0.95, delta=1e-12)

    def test_tail_bucket_hand_computed(self):
        # ref {a:0.6, b:0.2} (tail 0.2); arm {a:0.7, b:0.1} (tail 0.2):
        # KL = 0.6·ln(0.6/0.7) + 0.2·ln(0.2/0.1) + 0.2·ln(0.2/0.2)
        expected = 0.6 * math.log(0.6 / 0.7) + 0.2 * math.log(0.2 / 0.1)
        ref = [("a", lp(0.6)), ("b", lp(0.2))]
        arm = [("a", lp(0.7)), ("b", lp(0.1))]
        kl, rm, am = K.kl_position(ref, arm)
        self.assertAlmostEqual(kl, expected, delta=1e-12)
        self.assertAlmostEqual(rm, 0.8, delta=1e-12)
        self.assertAlmostEqual(am, 0.8, delta=1e-12)


class TestPairing(unittest.TestCase):
    def test_all_match(self):
        self.assertEqual(K.pair_positions([1, 2, 3], [1, 2, 3]), (3, None))

    def test_divergent_included(self):
        # divergence at position 1 → positions 0..1 paired (the divergent position is
        # included — its context is still identical), 2.. dropped.
        self.assertEqual(K.pair_positions([1, 2, 3, 4], [1, 5, 3, 4]), (2, 1))

    def test_diverge_at_zero(self):
        self.assertEqual(K.pair_positions([1, 2], [9, 1]), (1, 0))

    def test_unequal_lengths_no_divergence(self):
        self.assertEqual(K.pair_positions([1, 2, 3], [1, 2]), (2, None))

    def test_empty(self):
        self.assertEqual(K.pair_positions([], [1]), (0, None))


class TestCI(unittest.TestCase):
    def test_cluster_ci_single_block(self):
        self.assertEqual(K.cluster_bootstrap_ci([[0.1, 0.3]], n_boot=50, seed=1), (0.2, 0.2, 0.2))

    def test_cluster_ci_discrete_blocks(self):
        # two equal blocks, means 0.1 and 0.3 → every resample mean ∈ {0.1, 0.2, 0.3}
        # with p(0.1)=p(0.3)=0.25 → 2.5/97.5 percentiles are 0.1 / 0.3; overall mean 0.2.
        mean, lo, hi = K.cluster_bootstrap_ci([[0.1] * 100, [0.3] * 100], n_boot=1000, seed=1)
        self.assertAlmostEqual(mean, 0.2, delta=1e-12)
        self.assertAlmostEqual(lo, 0.1, delta=1e-9)
        self.assertAlmostEqual(hi, 0.3, delta=1e-9)

    def test_cluster_ci_narrower_with_more_blocks(self):
        # Same 2000 values (1000 × 0.001 + 1000 × 0.003, mean 0.002). Coarse split = 2
        # contiguous blocks (means 0.001 / 0.003) → wide CI; fine split = 100 interleaved
        # blocks (mean 0.002 each) → degenerate CI. Same seed, same data → block
        # granularity is the lever.
        vals = [0.001] * 1000 + [0.003] * 1000
        coarse = [vals[:1000], vals[1000:]]
        fine = [[vals[i] for i in range(j, 2000, 100)] for j in range(100)]
        _, lo_c, hi_c = K.cluster_bootstrap_ci(coarse, n_boot=500, seed=7)
        _, lo_f, hi_f = K.cluster_bootstrap_ci(fine, n_boot=500, seed=7)
        self.assertLess(hi_f - lo_f, hi_c - lo_c)

    def test_pooled_ci_hand_computed(self):
        vals = [0, 1, 2, 3, 4]
        mean, lo, hi = K.pooled_ci([v * 0.001 for v in vals])
        self.assertAlmostEqual(mean, 0.002, delta=1e-15)
        sd = math.sqrt(sum((v - 2) ** 2 for v in vals) / (len(vals) - 1))
        self.assertAlmostEqual(hi - mean, 1.96 * sd * 0.001 / math.sqrt(len(vals)), delta=1e-18)
        self.assertAlmostEqual(mean - lo, 1.96 * sd * 0.001 / math.sqrt(len(vals)), delta=1e-18)

    def test_pooled_ci_single(self):
        self.assertEqual(K.pooled_ci([0.25]), (0.25, 0.25, 0.25))

    def test_pooled_ci_empty(self):
        self.assertEqual(K.pooled_ci([]), (0.0, 0.0, 0.0))


class TestSegments(unittest.TestCase):
    def test_segments(self):
        vals = [float(i) for i in range(2500)]
        segs = K.segments(vals, 1000)
        self.assertEqual([s["n"] for s in segs], [1000, 1000, 500])
        self.assertAlmostEqual(segs[0]["mean"], 499.5, delta=1e-12)
        self.assertAlmostEqual(segs[1]["mean"], 1499.5, delta=1e-12)
        self.assertAlmostEqual(segs[2]["mean"], 2249.5, delta=1e-12)
        self.assertEqual([s["start"] for s in segs], [0, 1000, 2000])

    def test_segments_empty(self):
        self.assertEqual(K.segments([]), [])


# ------------------------------------------------------------------ shape normalizer (no server)
def _entry(t, p, rank=0):
    return {"token": t, "logprob": lp(p), "rank": rank}


class TestTopKEntries(unittest.TestCase):
    """One top_logprobs row → ((token, lp) × ≤20, mass). The live shape drifted from the
    one the probe was TDD'd against (2026-11-10: 16/16 d-fetch rows 0 logprobs), so the
    normalizer tolerates the known shapes and the shape it saw is reported, not hidden."""

    def test_canonical_list_of_dicts(self):
        top, mass = K._topk_entries([_entry("a", 0.5), _entry("b", 0.5)])
        self.assertEqual(top, [("a", lp(0.5)), ("b", lp(0.5))])
        self.assertAlmostEqual(mass, 1.0, delta=1e-12)

    def test_dict_map_row(self):
        top, mass = K._topk_entries({"a": lp(0.6), "b": lp(0.4)})
        self.assertEqual(sorted(top), [("a", lp(0.6)), ("b", lp(0.4))])
        self.assertAlmostEqual(mass, 1.0, delta=1e-12)

    def test_none_row(self):
        self.assertEqual(K._topk_entries(None), ([], 0.0))

    def test_empty_list(self):
        self.assertEqual(K._topk_entries([]), ([], 0.0))

    def test_nonfinite_skipped(self):
        top, _ = K._topk_entries([_entry("a", 0.5), {"token": "b", "logprob": float("nan")}])
        self.assertEqual(top, [("a", lp(0.5))])

    def test_int_token_accepted(self):
        top, _ = K._topk_entries([{"token": 42, "logprob": lp(0.9)}])
        self.assertEqual(top, [(42, lp(0.9))])

    def test_caps_at_top_k(self):
        top, _ = K._topk_entries([_entry(str(i), 0.01, i) for i in range(30)])
        self.assertEqual(len(top), K.TOP_K)


class TestLogprobsShape(unittest.TestCase):
    """logprobs_shape: the observed live shape, in one line (diagnostic; the failure
    message and the selftest JSON must say WHAT the server returned, not just that it
    was 'unsupported')."""

    def test_missing(self):
        self.assertEqual(K.logprobs_shape(None), "logprobs missing")

    def test_none_tops(self):
        self.assertEqual(K.logprobs_shape({"tokens": ["a", "b"], "top_logprobs": None}),
                         "tokens=2, top_logprobs=None")

    def test_empty_tops(self):
        self.assertEqual(K.logprobs_shape({"tokens": ["a", "b", "c", "d"], "top_logprobs": []}),
                         "tokens=4, top_logprobs=list[0]")

    def test_none_rows(self):
        self.assertEqual(K.logprobs_shape({"tokens": ["a", "b"], "top_logprobs": [None, None]}),
                         "tokens=2, top_logprobs=list[2] rows=None")

    def test_dict_map_rows(self):
        self.assertEqual(K.logprobs_shape({"tokens": ["a"], "top_logprobs": [{"a": -0.7, "b": -1.4}]}),
                         "tokens=1, top_logprobs=list[1] row=dict-map[2]")

    def test_canonical_rows(self):
        self.assertEqual(
            K.logprobs_shape({"tokens": ["a"], "top_logprobs": [[_entry("a", 0.5), _entry("b", 0.5)]]}),
            "tokens=1, top_logprobs=list[1] row=list[2] entry=dict(logprob,rank,token)")


# ------------------------------------------------------------------ live shapes (canned loopback server)
class TestMockServer(unittest.TestCase):
    """selftest/fetch behavior against a canned local HTTP server (stdlib urllib/http,
    127.0.0.1:0, no GPU, no network) — the shapes the live 1.11.0/1.17.0 boots actually
    returned on 2026-11-10, replayed deterministically."""

    @classmethod
    def setUpClass(cls):
        import http.server
        import json as _json
        import threading

        class Handler(http.server.BaseHTTPRequestHandler):
            canned = {}

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                resp = self.canned.get(self.path)
                if resp is None:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b'{"error": "no route"}')
                    return
                data = _json.dumps(resp).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        cls.Handler = Handler
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _serve(self, completions=None, tokenize=None):
        self.Handler.canned = {}
        if completions is not None:
            self.Handler.canned["/v1/completions"] = completions
        if tokenize is not None:
            self.Handler.canned["/tokenize"] = tokenize

    def _completions(self, toks, tops):
        return {"id": "cmpl", "choices": [{"index": 0, "text": "".join(toks),
                                           "finish_reason": "length",
                                           "logprobs": {"tokens": toks, "top_logprobs": tops}}]}

    def test_selftest_canonical_rows_pass(self):
        self._serve(self._completions(["a", "b", "c", "d"],
                                      [[_entry("a", 0.5), _entry("b", 0.5)] for _ in range(4)]))
        ok, checks = K.selftest(self.url, "m")
        self.assertTrue(ok)
        self.assertTrue(checks["logprobs20"])
        self.assertIn("entry=dict", checks["logprobs_shape"])

    def test_selftest_empty_tops_reports_shape(self):
        self._serve(self._completions(["a", "b", "c", "d"], []))
        ok, checks = K.selftest(self.url, "m")
        self.assertFalse(ok)
        self.assertEqual(checks["logprobs_shape"], "tokens=4, top_logprobs=list[0]")

    def test_selftest_none_rows_reports_shape(self):
        self._serve(self._completions(["a", "b", "c", "d"], [None] * 4))
        ok, checks = K.selftest(self.url, "m")
        self.assertFalse(ok)
        self.assertEqual(checks["logprobs_shape"], "tokens=4, top_logprobs=list[4] rows=None")

    def test_selftest_dict_map_rows_pass(self):
        self._serve(self._completions(["a", "b", "c", "d"],
                                      [{"a": lp(0.5), "b": lp(0.5)} for _ in range(4)]))
        ok, checks = K.selftest(self.url, "m")
        self.assertTrue(ok)
        self.assertIn("dict-map[2]", checks["logprobs_shape"])

    def test_selftest_request_failure_records_shape(self):
        self._serve()
        ok, checks = K.selftest(self.url, "m")
        self.assertFalse(ok)
        self.assertIn("request failed", checks["logprobs_shape"])
        self.assertIn("HTTPError", checks["logprobs20_error"])

    def test_selftest_records_provenance(self):
        # rule 2: the selftest JSON must name the endpoint and the served model it tested, so a
        # saved file can be tied to its boot after the fact (2026-11-11: the GPU selftest files
        # carried no model or url)
        self._serve(self._completions(["a", "b", "c", "d"],
                                      [{"a": lp(0.5), "b": lp(0.5)} for _ in range(4)]))
        ok, checks = K.selftest(self.url, "m")
        self.assertEqual(checks["model"], "m")
        self.assertEqual(checks["url"], self.url)

    def test_fetch_dict_map_populates_toks_and_pos(self):
        self._serve(self._completions(["a", "b", "c", "d"],
                                      [{"a": lp(0.6), "b": lp(0.4)} for _ in range(4)]))
        blocks = K.fetch(self.url, "m", [("p1", "hello")])
        self.assertIsNone(blocks[0]["error"])
        self.assertEqual(blocks[0]["toks"], ["a", "b", "c", "d"])
        self.assertEqual(len(blocks[0]["pos"]), 4)
        self.assertEqual(dict(blocks[0]["pos"][0][1]), {"a": lp(0.6), "b": lp(0.4)})

    def test_fetch_empty_tops_error_carries_shape(self):
        self._serve(self._completions(["a", "b"], []))
        blocks = K.fetch(self.url, "m", [("p1", "hello")])
        self.assertIn("logprobs rows 0 != tokens 2", blocks[0]["error"])
        self.assertIn("shape: tokens=2, top_logprobs=list[0]", blocks[0]["error"])

    def test_fetch_no_tokens_error_carries_shape(self):
        self._serve(self._completions([], []))
        blocks = K.fetch(self.url, "m", [("p1", "hello")])
        self.assertIn("no generated tokens", blocks[0]["error"])
        self.assertIn("shape: tokens=0", blocks[0]["error"])


# ------------------------------------------------------------------ 2026-11-11 items C/D/F/H
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMPROOT = os.path.join(REPO, "campaigns", "perf", "2026-11-09-1825-27b-arms-kld", "tmp", "unit-kld-probe")


def _scratch(name):
    import shutil
    d = os.path.join(TMPROOT, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    return d


def _calibration(d, n, boom=()):
    """n prompts cal-001..; ids in `boom` get a prompt containing BOOM (the fake server 500s on it)."""
    import json as _json
    rows = []
    for i in range(1, n + 1):
        pid = f"cal-{i:03d}"
        src = os.path.join(d, f"src{i}.txt")
        open(src, "w").write(("BOOM " if pid in boom else "") + f"prompt body {i}\n")
        rows.append({"id": pid, "src": src, "char_cut": 100})
    cal = os.path.join(d, "cal.jsonl")
    with open(cal, "w") as f:
        for r in rows:
            f.write(_json.dumps(r) + "\n")
    return cal


METRICS_BEFORE = """# HELP vllm:spec_decode_num_draft_tokens_total x
# TYPE vllm:spec_decode_num_draft_tokens_total counter
vllm:spec_decode_num_draft_tokens_total{engine="0",model_name="m"} 100.0
vllm:spec_decode_num_accepted_tokens_total{engine="0",model_name="m"} 40.0
vllm:prefix_cache_queries_total{engine="0"} 1000.0
vllm:prefix_cache_hits_total{engine="0"} 10.0
vllm:num_preemptions_total{engine="0"} 0.0
vllm:kv_cache_usage_perc{engine="0"} 0.01
vllm:spec_decode_num_draft_tokens_created{engine="0"} 1.7e9
"""
METRICS_AFTER = METRICS_BEFORE.replace("} 100.0", "} 300.0").replace("} 40.0", "} 140.0") \
    .replace("} 1000.0", "} 3000.0").replace("} 10.0", "} 510.0").replace("preemptions_total{engine=\"0\"} 0.0",
                                                                           "preemptions_total{engine=\"0\"} 2.0")


class _CountingServer:
    """Loopback OpenAI-ish server: dict-map top-k rows (like the live servers), usage block, a
    configurable top-k width, BOOM prompts -> HTTP 500, /metrics text (or 404). Counts POSTs."""

    def __init__(self, topk=20, metrics=True):
        import http.server
        import json as _json
        import threading
        outer = self
        self.posts = 0
        self.topk = topk
        self.metrics = [METRICS_BEFORE, METRICS_AFTER] if metrics else None
        self.metrics_gets = 0

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/metrics" and outer.metrics:
                    body = outer.metrics[min(outer.metrics_gets, len(outer.metrics) - 1)].encode()
                    outer.metrics_gets += 1
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(404)
                self.end_headers()

            def do_POST(self):
                body = _json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.posts += 1
                if "BOOM" in body.get("prompt", ""):
                    self.send_response(500)
                    self.end_headers()
                    return
                toks = ["a", "b", "c"]
                row = {f"t{j}": -0.1 * (j + 1) for j in range(outer.topk)}
                data = _json.dumps({"choices": [{"text": "abc", "finish_reason": "length",
                                                 "logprobs": {"tokens": toks, "top_logprobs": [row] * 3}}],
                                    "usage": {"prompt_tokens": 11, "completion_tokens": 3,
                                              "prompt_tokens_details": {"cached_tokens": 8}}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}/v1"

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


def _run_main(argv):
    old = sys.argv
    sys.argv = ["kld_probe.py"] + argv
    try:
        K.main()
        return 0
    except SystemExit as e:
        return e.code or 0
    finally:
        sys.argv = old


def _rows(path):
    import json as _json
    return [_json.loads(l) for l in open(path) if l.strip()]


class TestCacheKey(unittest.TestCase):
    """Item C: a KLD cache records its key (n, calibration sha256, max_tokens, top_k, model, image) in
    <file>.key.json; it is reused only on an exact match (a KLD_N=2 file must never serve N=16/128)."""

    def setUp(self):
        self.d = _scratch(self._testMethodName)
        self.cal = _calibration(self.d, 4)
        self.srv = _CountingServer()

    def tearDown(self):
        self.srv.close()

    def _fetch(self, out, limit=None, max_tokens=None, model="m", image="img:1"):
        argv = ["fetch", "--url", self.srv.url, "--model", model, "--calibration", self.cal,
                "--repo-root", self.d, "--out", out, "--image", image]
        if limit is not None:
            argv += ["--limit", str(limit)]
        if max_tokens is not None:
            argv += ["--max-tokens", str(max_tokens)]
        return _run_main(argv)

    def test_key_fields(self):
        import hashlib
        k = K.cache_key(self.cal, 2, 512, "m", "img:1")
        self.assertEqual(k["n"], 2)
        self.assertEqual(k["max_tokens"], 512)
        self.assertEqual(k["top_k"], K.TOP_K)
        self.assertEqual(k["model"], "m")
        self.assertEqual(k["image"], "img:1")
        self.assertEqual(k["calibration_sha256"], hashlib.sha256(open(self.cal, "rb").read()).hexdigest())
        self.assertEqual(K.cache_key(self.cal, None, 512, "m", None)["n"], 4)
        self.assertEqual(K.cache_key(self.cal, 99, 512, "m", None)["n"], 4)

    def test_same_key_is_reused(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        self._fetch(out, limit=2)
        self.assertEqual(self.srv.posts, 2)
        self.assertTrue(os.path.exists(out + ".key.json"))
        self._fetch(out, limit=2)
        self.assertEqual(self.srv.posts, 2)       # nothing re-requested
        self.assertEqual(K.cache_status(out, self.cal, 2, K.N_MAX, "m", "img:1")[0], 0)

    def test_n_change_is_refetched_and_old_renamed(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        self._fetch(out, limit=2)
        self.assertEqual(K.cache_status(out, self.cal, 4, K.N_MAX, "m", "img:1")[0], 2)   # key mismatch
        self._fetch(out, limit=4)
        self.assertEqual(self.srv.posts, 2 + 4)   # full re-fetch, the N=2 rows are not reused
        self.assertEqual(len(_rows(out)), 4)
        stale = [f for f in os.listdir(self.d) if f.startswith("kld-x.jsonl.stale-") and not f.endswith(".key.json")]
        self.assertEqual(len(stale), 1)            # renamed, never deleted
        self.assertEqual(len(_rows(os.path.join(self.d, stale[0]))), 2)

    def test_max_tokens_change_is_refetched(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        self._fetch(out, limit=2)
        self._fetch(out, limit=2, max_tokens=256)
        self.assertEqual(self.srv.posts, 4)
        self.assertEqual(K.read_key(out)["max_tokens"], 256)

    def test_image_or_model_change_is_refetched(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        self._fetch(out, limit=1)
        self._fetch(out, limit=1, image="img:2")
        self.assertEqual(self.srv.posts, 2)

    def test_legacy_file_without_key_is_stale(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        open(out, "w").write('{"id": "cal-001", "toks": ["x"], "pos": [], "error": null}\n')
        self.assertEqual(K.cache_status(out, self.cal, 1, K.N_MAX, "m", "img:1")[0], 2)
        self._fetch(out, limit=1)
        self.assertEqual(self.srv.posts, 1)
        self.assertTrue(any(f.startswith("kld-x.jsonl.stale-") for f in os.listdir(self.d)))

    def test_status_codes(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        self.assertEqual(K.cache_status(out, self.cal, 2, K.N_MAX)[0], 3)     # absent
        self._fetch(out, limit=2)
        self.assertEqual(K.cache_status(out, self.cal, 2, K.N_MAX)[0], 0)     # model/image not compared
        rows = _rows(out)
        with open(out, "w") as f:                                             # one id missing
            f.write(__import__("json").dumps(rows[0]) + "\n")
        self.assertEqual(K.cache_status(out, self.cal, 2, K.N_MAX)[0], 1)
        with open(out, "w") as f:                                             # duplicate id
            for r in (rows[0], rows[0]):
                f.write(__import__("json").dumps(r) + "\n")
        self.assertEqual(K.cache_status(out, self.cal, 2, K.N_MAX)[0], 1)

    def test_cache_status_cli_exit_code(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        self._fetch(out, limit=2)
        self.assertEqual(_run_main(["cache-status", "--out", out, "--calibration", self.cal, "--limit", "2",
                                    "--model", "m", "--image", "img:1"]), 0)
        self.assertEqual(_run_main(["cache-status", "--out", out, "--calibration", self.cal, "--limit", "3"]), 2)


class TestResumableFetch(unittest.TestCase):
    """Item D: one deterministic error must not re-fetch the whole calibration; only the error rows
    are re-requested, OK rows are kept, exactly one row per prompt id."""

    def setUp(self):
        self.d = _scratch(self._testMethodName)
        self.cal = _calibration(self.d, 4, boom={"cal-003"})
        self.srv = _CountingServer()
        self.out = os.path.join(self.d, "kld-x.jsonl")

    def tearDown(self):
        self.srv.close()

    def _fetch(self):
        return _run_main(["fetch", "--url", self.srv.url, "--model", "m", "--calibration", self.cal,
                          "--repo-root", self.d, "--out", self.out])

    def test_only_error_rows_are_re_requested(self):
        self.assertEqual(self._fetch(), 0)              # partial: 3 OK + 1 error (exit 0, as before)
        self.assertEqual(self.srv.posts, 4)
        self.assertEqual(K.cache_status(self.out, self.cal, None, K.N_MAX)[0], 1)
        self._fetch()
        self.assertEqual(self.srv.posts, 5)             # exactly 1 POST on the second run
        rows = _rows(self.out)
        self.assertEqual([r["id"] for r in rows], ["cal-001", "cal-002", "cal-003", "cal-004"])
        self.assertTrue(rows[2]["error"])               # errored again -> still incomplete
        self.assertEqual(K.cache_status(self.out, self.cal, None, K.N_MAX)[0], 1)

    def test_recovered_error_completes(self):
        self._fetch()
        open(os.path.join(self.d, "src3.txt"), "w").write("prompt body 3 healed\n")
        # healed prompt text = a new calibration sha -> key mismatch; keep the sha stable instead:
        # rewrite the src but keep cal.jsonl identical (sha is over cal.jsonl bytes)
        self._fetch()
        self.assertEqual(self.srv.posts, 5)
        self.assertEqual(K.cache_status(self.out, self.cal, None, K.N_MAX)[0], 0)
        self.assertEqual(len(_rows(self.out)), 4)

    def test_cut_file_resumes_missing_only(self):
        import json as _json
        self._fetch()                                    # 4 posts
        rows = _rows(self.out)
        with open(self.out, "w") as f:                   # simulate a kill: 2 rows + a torn last line
            f.write(_json.dumps(rows[0]) + "\n" + _json.dumps(rows[1]) + "\n" + '{"id": "cal-0')
        self._fetch()
        self.assertEqual(self.srv.posts, 4 + 2)          # cal-003 (error) + cal-004 (missing)
        self.assertEqual([r["id"] for r in _rows(self.out)], ["cal-001", "cal-002", "cal-003", "cal-004"])


class TestFetchMeasurables(unittest.TestCase):
    """Item H: per-row usage/latency/top-k width and a per-fetch /metrics window (spec decode
    acceptance, prefix cache, preemptions, KV usage); null when /metrics is absent."""

    def setUp(self):
        self.d = _scratch(self._testMethodName)
        self.cal = _calibration(self.d, 2)

    def test_row_fields(self):
        srv = _CountingServer(topk=19)
        try:
            blocks = K.fetch(srv.url, "m", [("p1", "hello")])
        finally:
            srv.close()
        b = blocks[0]
        self.assertEqual(list(b)[:4], ["id", "toks", "pos", "error"])     # existing keys first, unchanged
        self.assertEqual(b["prompt_tokens"], 11)
        self.assertEqual(b["completion_tokens"], 3)
        self.assertEqual(b["cached_prompt_tokens"], 8)
        self.assertEqual(b["finish_reason"], "length")
        self.assertIsNotNone(b["latency_s"])
        self.assertIsNotNone(b["gen_tok_s_e2e"])
        self.assertEqual(b["topk_len_min"], 19)
        self.assertEqual(b["topk_len_mean"], 19.0)

    def test_parse_metrics(self):
        m = K.parse_metrics(METRICS_BEFORE)
        self.assertEqual(m["spec_drafted"], 100.0)
        self.assertEqual(m["spec_accepted"], 40.0)
        self.assertEqual(m["prefix_queries"], 1000.0)
        self.assertEqual(m["prefix_hits"], 10.0)
        self.assertEqual(m["preemptions"], 0.0)
        self.assertEqual(m["kv_usage"], 0.01)
        self.assertIsNone(m["prompt_tokens"])            # absent -> None

    def test_window_summary(self):
        w = K.window_summary(K.parse_metrics(METRICS_BEFORE), K.parse_metrics(METRICS_AFTER), [0.2, 0.5])
        self.assertEqual(w["spec_drafted"], 200.0)
        self.assertEqual(w["spec_accepted"], 100.0)
        self.assertEqual(w["spec_acceptance_rate"], 0.5)
        self.assertEqual(w["prefix_hits"], 500.0)
        self.assertEqual(w["prefix_queries"], 2000.0)
        self.assertEqual(w["preemptions"], 2.0)
        self.assertEqual(w["kv_usage_max"], 0.5)
        self.assertTrue(w["metrics_available"])
        n = K.window_summary(None, None, [])
        self.assertFalse(n["metrics_available"])
        self.assertIsNone(n["spec_acceptance_rate"])
        self.assertIsNone(n["kv_usage_max"])

    def test_window_out_line_per_fetch(self):
        out = os.path.join(self.d, "kld-x.jsonl")
        win = os.path.join(self.d, "windows.jsonl")
        for metrics in (True, False):
            srv = _CountingServer(metrics=metrics)
            try:
                _run_main(["fetch", "--url", srv.url, "--model", "m", "--calibration", self.cal,
                           "--repo-root", self.d, "--out", out + str(metrics), "--window-out", win])
            finally:
                srv.close()
        lines = _rows(win)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0]["metrics_available"])
        self.assertEqual(lines[0]["n_requested"], 2)
        self.assertFalse(lines[1]["metrics_available"])
        self.assertIsNone(lines[1]["spec_acceptance_rate"])


def _blk(pid, pos):
    return {"id": pid, "toks": [t for t, _ in pos], "pos": pos, "error": None}


class TestScoreExtras(unittest.TestCase):
    """Item F: quantify the 19-vs-20 top-k caveat (short arm rows, floor substitutions both ways) and
    add paired top-1, median/p90/max per-position KL — without touching the KL math or old keys."""

    def _pair(self):
        ref_top = [(f"t{j}", lp(0.04)) for j in range(20)]                  # 20 entries
        arm_top = [(f"t{j}", lp(0.04)) for j in range(19)]                  # 19 entries, t19 missing
        arm_top_x = arm_top[:18] + [("zz", lp(0.04))]                         # t18,t19 missing; zz extra
        ref = [_blk("p1", [("t0", ref_top), ("t0", ref_top), ("t0", ref_top)])]
        arm = [_blk("p1", [("t0", arm_top), ("t0", arm_top_x), ("t0", arm_top)])]
        return ref, arm

    def test_old_keys_unchanged(self):
        ref, arm = self._pair()
        r = K.score(ref, arm, "x", "note")
        for k in ("kind", "label", "reference", "mode", "n_prompts", "n_prompt_errors", "n_positions",
                  "n_positions_dropped", "kl_nats_per_tok", "ci95_nats", "ci_method", "pooled_ci_nats",
                  "pooled_note", "lower_bound_note", "dnll_nats_per_tok", "top1_agreement",
                  "first_divergent_pos", "coverage_ref_mean", "coverage_arm_mean", "segments_per_1k",
                  "noise_floors"):
            self.assertIn(k, r)

    def test_topk_len_short_rows(self):
        ref, arm = self._pair()
        r = K.score(ref, arm, "x", "note")
        self.assertEqual(r["topk_len"]["arm"]["n_short"], 3)
        self.assertEqual(r["topk_len"]["arm"]["frac_short"], 1.0)
        self.assertEqual(r["topk_len"]["arm"]["min_len"], 19)
        self.assertEqual(r["topk_len"]["ref"]["n_short"], 0)
        self.assertEqual(r["topk_len"]["ref"]["min_len"], 20)
        self.assertEqual(r["topk_len"]["arm"]["n_positions"], 3)

    def test_floor_substitutions(self):
        ref, arm = self._pair()
        f = K.score(ref, arm, "x", "note")["floor_substitutions"]
        self.assertEqual(f["ref_tokens_missing_from_arm"], 1 + 2 + 1)
        self.assertEqual(f["ref_entries"], 60)
        self.assertAlmostEqual(f["ref_missing_frac"], 4 / 60, places=6)
        self.assertEqual(f["positions_with_floor"], 3)
        self.assertEqual(f["arm_tokens_missing_from_ref"], 1)
        self.assertEqual(f["arm_entries"], 57)
        self.assertAlmostEqual(f["ref_mass_floored_mean"], (0.04 + 0.08 + 0.04) / 3, places=6)

    def test_paired_top1_and_kl_quantiles(self):
        top_a = [("a", lp(0.7)), ("b", lp(0.2))]
        top_b = [("b", lp(0.6)), ("a", lp(0.3))]
        ref = [_blk("p1", [("a", top_a), ("a", top_a), ("a", top_a), ("a", top_a)])]
        arm = [_blk("p1", [("a", top_a), ("a", top_b), ("a", top_a), ("a", top_a)])]
        r = K.score(ref, arm, "x", "note")
        self.assertEqual(r["top1_agreement_paired"], 0.75)
        kls = sorted(K.kl_position(top_a, t)[0] for t in (top_a, top_b, top_a, top_a))
        self.assertAlmostEqual(r["kl_per_position"]["max"], round(kls[-1], 6), places=6)
        self.assertAlmostEqual(r["kl_per_position"]["median"], 0.0, places=9)
        self.assertAlmostEqual(r["kl_per_position"]["p90"], round(kls[-1], 6), places=6)


# ------------------------------------------------------------------ 2026-11-11 compare round
def _content(toks, alts):
    """llama.cpp /v1/completions logprobs shape: {"content": [{token, logprob, top_logprobs: [...]}]}"""
    return {"content": [{"id": i, "token": t, "logprob": lp(0.5), "bytes": [],
                         "top_logprobs": [{"id": j, "token": a, "logprob": lp(p), "bytes": []}
                                          for j, (a, p) in enumerate(alts)]}
                        for i, t in enumerate(toks)]}


class TestNormalizeLogprobs(unittest.TestCase):
    """llama.cpp answers /v1/completions logprobs in the chat-style `content` list, not the
    OpenAI completions `tokens`/`top_logprobs` pair; both must normalize to the same (toks, tops)."""

    def test_openai_completions_shape_passthrough(self):
        toks, tops = K.normalize_logprobs({"tokens": ["a", "b"], "top_logprobs": [{"a": -0.1}, {"b": -0.2}]})
        self.assertEqual(toks, ["a", "b"])
        self.assertEqual(tops, [{"a": -0.1}, {"b": -0.2}])

    def test_llamacpp_content_shape(self):
        toks, tops = K.normalize_logprobs(_content(["a", "b"], [("a", 0.6), ("b", 0.3)]))
        self.assertEqual(toks, ["a", "b"])
        self.assertEqual(len(tops), 2)
        top, _m = K._topk_entries(tops[0])
        self.assertEqual(dict(top), {"a": lp(0.6), "b": lp(0.3)})

    def test_missing_or_garbage(self):
        self.assertEqual(K.normalize_logprobs(None), ([], []))
        self.assertEqual(K.normalize_logprobs({}), ([], []))
        self.assertEqual(K.normalize_logprobs({"content": None}), ([], []))

    def test_shape_names_content(self):
        s = K.logprobs_shape(_content(["a", "b", "c"], [("a", 0.6)]))
        self.assertIn("content=list[3]", s)
        self.assertIn("top_logprobs=list[1]", s)


class TestMockServerCompare(TestMockServer):
    """The compare round's live-shape fixes, against the same canned loopback server."""

    def _llama(self, toks, alts):
        return {"id": "cmpl", "choices": [{"index": 0, "text": "".join(toks), "finish_reason": "length",
                                           "logprobs": _content(toks, alts)}],
                "usage": {"prompt_tokens": 7, "completion_tokens": len(toks)}}

    def test_selftest_llamacpp_content_pass(self):
        self._serve(self._llama(["a", "b", "c", "d"], [("a", 0.6), ("b", 0.3)]))
        ok, checks = K.selftest(self.url, "m")
        self.assertTrue(ok)
        self.assertIn("content=list[4]", checks["logprobs_shape"])

    def test_fetch_llamacpp_content_rows(self):
        self._serve(self._llama(["a", "b", "c"], [("a", 0.6), ("b", 0.3)]))
        blocks = K.fetch(self.url, "m", [("p1", "hello")])
        self.assertIsNone(blocks[0]["error"])
        self.assertEqual(blocks[0]["toks"], ["a", "b", "c"])
        self.assertEqual(dict(blocks[0]["pos"][2][1]), {"a": lp(0.6), "b": lp(0.3)})
        self.assertEqual(blocks[0]["prompt_tokens"], 7)

    def test_tokenize_tokens_key(self):
        # vLLM and llama.cpp answer /tokenize with `tokens`, not `ids` (2026-11-11: every live
        # selftest recorded tokenize_ids null with no error — the probe only read `ids`)
        self._serve(self._completions(["a", "b", "c", "d"], [{"a": lp(0.5)} for _ in range(4)]),
                    tokenize={"tokens": [11, 12, 13], "count": 3})
        _ok, checks = K.selftest(self.url, "m")
        self.assertEqual(checks["tokenize_ids"], [11, 12, 13])

    def test_tokenize_ids_key_still_read(self):
        self._serve(self._completions(["a", "b", "c", "d"], [{"a": lp(0.5)} for _ in range(4)]),
                    tokenize={"ids": [5, 6]})
        _ok, checks = K.selftest(self.url, "m")
        self.assertEqual(checks["tokenize_ids"], [5, 6])

    def test_tokenize_answer_without_ids_is_an_error_not_null(self):
        self._serve(self._completions(["a", "b", "c", "d"], [{"a": lp(0.5)} for _ in range(4)]),
                    tokenize={"something": 1})
        _ok, checks = K.selftest(self.url, "m")
        self.assertIsNone(checks["tokenize_ids"])
        self.assertIn("no ids/tokens", checks["tokenize_error"])


def _blk_pt(pid, pos, prompt_tokens):
    b = _blk(pid, pos)
    b["prompt_tokens"] = prompt_tokens
    return b


class TestTokenizerGuard(unittest.TestCase):
    """Score-time tokenizer guard: the same prompt text must tokenize to the same prompt length on
    the reference and the arm (a tokenizer drift silently breaks the string-keyed support)."""

    top = [("a", lp(0.9))]

    def test_match_is_ok(self):
        ref = [_blk_pt("p1", [("a", self.top)], 100), _blk_pt("p2", [("a", self.top)], 50)]
        arm = [_blk_pt("p1", [("a", self.top)], 100), _blk_pt("p2", [("a", self.top)], 50)]
        g = K.score(ref, arm, "x", "note")["tokenizer_check"]
        self.assertEqual(g["verdict"], "ok")
        self.assertEqual(g["n_compared"], 2)
        self.assertEqual(g["n_mismatch"], 0)

    def test_mismatch_is_flagged_with_ids(self):
        ref = [_blk_pt("p1", [("a", self.top)], 100), _blk_pt("p2", [("a", self.top)], 50)]
        arm = [_blk_pt("p1", [("a", self.top)], 101), _blk_pt("p2", [("a", self.top)], 50)]
        g = K.score(ref, arm, "x", "note")["tokenizer_check"]
        self.assertEqual(g["verdict"], "MISMATCH")
        self.assertEqual(g["n_mismatch"], 1)
        self.assertEqual(g["mismatches"], [{"id": "p1", "ref": 100, "arm": 101}])

    def test_unavailable_without_prompt_tokens(self):
        ref = [_blk("p1", [("a", self.top)])]
        arm = [_blk("p1", [("a", self.top)])]
        g = K.score(ref, arm, "x", "note")["tokenizer_check"]
        self.assertEqual(g["verdict"], "unavailable")
        self.assertEqual(g["n_compared"], 0)

    def test_prompt_id_order_mismatch_raises(self):
        ref = [_blk("p1", [("a", self.top)]), _blk("p2", [("a", self.top)])]
        arm = [_blk("p2", [("a", self.top)]), _blk("p1", [("a", self.top)])]
        with self.assertRaises(ValueError):
            K.score(ref, arm, "x", "note")


class TestScoreCLIAndMatrix(unittest.TestCase):
    """score --ref-label (arm-vs-arm without the FP8 reference) and the pairwise matrix table."""

    def setUp(self):
        self.d = _scratch("compare-cli")
        top_a = [("a", lp(0.7)), ("b", lp(0.2))]
        top_b = [("b", lp(0.6)), ("a", lp(0.3))]
        self.files = {}
        for name, tops in (("x", [top_a, top_a]), ("y", [top_a, top_b])):
            p = os.path.join(self.d, f"kld-{name}.jsonl")
            with open(p, "w") as f:
                f.write(json.dumps(_blk_pt("cal-001", [("a", t) for t in tops], 9)) + "\n")
            self.files[name] = p

    def _score(self, arm, ref, label=None):
        import subprocess
        out = os.path.join(self.d, f"kld-pair-{arm}-vs-{ref}.json")
        cmd = [sys.executable, K.__file__, "score", "--ref", self.files[ref], "--arm", self.files[arm],
               "--label", arm, "--out", out]
        if label:
            cmd += ["--ref-label", label]
        subprocess.run(cmd, check=True, capture_output=True)
        return json.load(open(out))

    def test_ref_label_replaces_fp8_note(self):
        r = self._score("y", "x", label="x")
        self.assertEqual(r["reference"], "x")
        self.assertEqual(r["reference_label"], "x")

    def test_default_reference_note_kept(self):
        r = self._score("y", "x")
        self.assertIn("FP8", r["reference"])

    def test_matrix_markdown(self):
        self._score("y", "x", label="x")
        self._score("x", "y", label="y")
        rows = K.load_pair_results(self.d)
        self.assertEqual(sorted((r["label"], r["reference_label"]) for r in rows), [("x", "y"), ("y", "x")])
        md = K.matrix_markdown(rows)
        self.assertIn("| arm \\ ref | x | y |", md)
        self.assertIn("| x | — |", md)          # diagonal
        self.assertIn("tokenizer", md)


# ------------------------------------------------------------------ teacher-forced mode (2026-11-12)
class TestForcedPositions(unittest.TestCase):
    def test_short_reference_takes_every_position(self):
        self.assertEqual(K.forced_positions(5, 32), [0, 1, 2, 3, 4])

    def test_empty(self):
        self.assertEqual(K.forced_positions(0, 32), [])

    def test_evenly_spaced_unique_sorted_with_both_ends(self):
        p = K.forced_positions(512, 32)
        self.assertEqual(len(p), 32)
        self.assertEqual(p, sorted(set(p)))
        self.assertEqual((p[0], p[-1]), (0, 511))

    def test_exactly_k(self):
        self.assertEqual(K.forced_positions(32, 32), list(range(32)))


class _ForcedServer:
    """Loopback 'token model': /tokenize answers fixed prompt ids; /v1/completions takes an int-list
    prompt and answers ONE generated token whose top-k row depends on len(prompt) — so a request is
    identified by its forced prefix length. Records every request body. Knobs: usage_delta (a server
    that miscounts the prompt — e.g. one that stringified the list), fail_at (prompt length -> 500)."""

    def __init__(self, prompt_ids=(1, 2, 3), usage_delta=0, fail_at=None, llama_shape=False):
        import http.server
        import json as _json
        import threading
        outer = self
        self.bodies = []

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = _json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.bodies.append((self.path, body))
                if self.path == "/tokenize":
                    data = {"tokens": list(prompt_ids)}
                else:
                    p = body.get("prompt")
                    n = len(p) if isinstance(p, list) else 999
                    if fail_at is not None and n == fail_at:
                        self.send_response(500)
                        self.end_headers()
                        return
                    row = {f"t{n}": -0.1, "z": -2.5}
                    if llama_shape:
                        lpo = {"content": [{"id": 7, "token": f"t{n}", "logprob": -0.1,
                                            "top_logprobs": [{"id": 7, "token": t, "logprob": v}
                                                             for t, v in row.items()]}]}
                    else:
                        lpo = {"tokens": [f"t{n}"], "top_logprobs": [row]}
                    data = {"choices": [{"text": f"t{n}", "finish_reason": "length", "logprobs": lpo}],
                            "usage": {"prompt_tokens": n + usage_delta, "completion_tokens": 1}}
                raw = _json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *a):
                pass
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}/v1"

    def completions(self):
        return [b for p, b in self.bodies if p == "/v1/completions"]

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


def _ref_block(pid="p1", ids=(10, 11, 12, 13), prompt_tokens=3):
    toks = [f"r{i}" for i in ids]
    return {"id": pid, "toks": toks, "ids": list(ids), "prompt_tokens": prompt_tokens, "error": None,
            "pos": [(t, [(t, -0.05), ("z", -3.0)]) for t in toks]}


class TestFetchKeepsIds(TestMockServer):
    def test_llama_content_ids_stored(self):
        self._serve({"choices": [{"text": "ab", "finish_reason": "length", "logprobs": {"content": [
            {"id": 5, "token": "a", "logprob": -0.1, "top_logprobs": [{"id": 5, "token": "a", "logprob": -0.1}]},
            {"id": 6, "token": "b", "logprob": -0.2, "top_logprobs": [{"id": 6, "token": "b", "logprob": -0.2}]}]}}]})
        blk = K.fetch(self.url, "m", [("p1", "x")], max_tokens=2)[0]
        self.assertIsNone(blk["error"])
        self.assertEqual(blk["ids"], [5, 6])

    def test_openai_shape_has_no_ids(self):
        self._serve(self._completions(["a"], [[_entry("a", 0.9)]]))
        blk = K.fetch(self.url, "m", [("p1", "x")], max_tokens=1)[0]
        self.assertNotIn("ids", blk)


class TestFetchForced(unittest.TestCase):
    def _run(self, srv, ref, k=32, text="hello"):
        try:
            return K.fetch_forced(srv.url, "m", [(ref["id"], text)], {ref["id"]: ref}, k=k)[0]
        finally:
            srv.close()

    def test_prefixes_are_prompt_ids_plus_reference_prefix(self):
        srv = _ForcedServer()
        blk = self._run(srv, _ref_block())
        self.assertIsNone(blk["error"])
        self.assertEqual(blk["positions"], [0, 1, 2, 3])
        prompts = [b["prompt"] for b in srv.completions()]
        self.assertEqual(prompts, [[1, 2, 3], [1, 2, 3, 10], [1, 2, 3, 10, 11], [1, 2, 3, 10, 11, 12]])
        for b in srv.completions():
            self.assertEqual((b["max_tokens"], b["temperature"], b["logprobs"]), (1, 0, K.TOP_K))
        # each scored row is the ARM's next-token row at that forced prefix, keyed by the ref token
        self.assertEqual([t for t, _ in blk["pos"]], ["r10", "r11", "r12", "r13"])
        self.assertEqual(dict(blk["pos"][1][1])["t4"], -0.1)

    def test_llama_content_shape_parses(self):
        blk = self._run(_ForcedServer(llama_shape=True), _ref_block())
        self.assertIsNone(blk["error"])
        self.assertEqual(len(blk["pos"]), 4)

    def test_positions_capped_at_k(self):
        srv = _ForcedServer()
        blk = self._run(srv, _ref_block(ids=tuple(range(100, 140))), k=8)
        self.assertEqual(blk["positions"], K.forced_positions(40, 8))
        self.assertEqual(len(srv.completions()), 8)

    def test_usage_mismatch_quarantines_prompt(self):
        # a server that did not take the int list as token ids (e.g. stringified it) miscounts the prompt
        blk = self._run(_ForcedServer(usage_delta=5), _ref_block())
        self.assertIn("prompt_tokens", blk["error"])
        self.assertEqual(blk["pos"], [])

    def test_tokenizer_mismatch_vs_reference(self):
        blk = self._run(_ForcedServer(prompt_ids=(1, 2)), _ref_block(prompt_tokens=3))
        self.assertIn("tokeniz", blk["error"])

    def test_reference_without_ids(self):
        ref = _ref_block()
        del ref["ids"]
        blk = self._run(_ForcedServer(), ref)
        self.assertIn("no token ids", blk["error"])

    def test_errored_reference_is_not_forced(self):
        ref = _ref_block()
        ref["error"] = "boom"
        srv = _ForcedServer()
        blk = self._run(srv, ref)
        self.assertIn("reference", blk["error"])
        self.assertEqual(srv.completions(), [])

    def test_http_error_mid_prompt_quarantines_whole_prompt(self):
        blk = self._run(_ForcedServer(fail_at=5), _ref_block())   # position 2 (3 prompt ids + 2)
        self.assertIsNotNone(blk["error"])
        self.assertEqual(blk["pos"], [])


def _forced_block(pid, rows, positions=None, err=None):
    return {"id": pid, "mode": "forced", "positions": positions or list(range(len(rows))),
            "pos": rows, "error": err}


class TestScoreForced(unittest.TestCase):
    def setUp(self):
        self.ref = [_ref_block("p1", ids=(10, 11)), _ref_block("p2", ids=(20,))]

    def _arm(self, p1_rows, p2_rows):
        return [_forced_block("p1", p1_rows), _forced_block("p2", p2_rows)]

    def test_identical_is_zero(self):
        arm = self._arm([r for r in self.ref[0]["pos"]], [r for r in self.ref[1]["pos"]])
        r = K.score_forced(self.ref, arm, "x", "q8")
        self.assertEqual(r["kind"], "kld_forced")
        self.assertAlmostEqual(r["kl_nats_per_tok"], 0.0, places=9)
        self.assertEqual(r["top1_agreement"], 1.0)
        self.assertEqual(r["n_positions"], 3)
        self.assertEqual(r["reference_label"], "q8")

    def test_mean_is_pooled_kl_position(self):
        other = ("r10", [("z", -0.05), ("r10", -3.0)])     # argmax flipped at p1 position 0
        arm = self._arm([other, self.ref[0]["pos"][1]], [self.ref[1]["pos"][0]])
        r = K.score_forced(self.ref, arm, "x", "q8")
        k0 = K.kl_position(self.ref[0]["pos"][0][1], other[1])[0]
        self.assertAlmostEqual(r["kl_nats_per_tok"], round(k0 / 3, 6), places=6)
        self.assertAlmostEqual(r["top1_agreement"], round(2 / 3, 5), places=5)

    def test_errored_arm_prompt_excluded_and_counted(self):
        arm = [_forced_block("p1", list(self.ref[0]["pos"])), _forced_block("p2", [], err="boom")]
        r = K.score_forced(self.ref, arm, "x", "q8")
        self.assertEqual((r["n_prompt_errors"], r["n_positions"]), (1, 2))

    def test_position_out_of_reference_range_raises(self):
        arm = self._arm([self.ref[0]["pos"][0]], [self.ref[1]["pos"][0]])
        arm[0]["positions"] = [7]
        with self.assertRaises(ValueError):
            K.score_forced(self.ref, arm, "x", "q8")

    def test_prompt_order_mismatch_raises(self):
        arm = list(reversed(self._arm(list(self.ref[0]["pos"]), list(self.ref[1]["pos"]))))
        with self.assertRaises(ValueError):
            K.score_forced(self.ref, arm, "x", "q8")


class TestForcedCLI(unittest.TestCase):
    def setUp(self):
        self.d = _scratch("forced-" + self._testMethodName)
        self.cal = os.path.join(self.d, "cal.jsonl")
        src = os.path.join(self.d, "p.txt")
        open(src, "w").write("hello world")
        with open(self.cal, "w") as f:
            f.write(json.dumps({"id": "p1", "src": src, "char_cut": 5}) + "\n")
        self.ref = os.path.join(self.d, "kld-q8.jsonl")
        with open(self.ref, "w") as f:
            f.write(json.dumps(_ref_block("p1")) + "\n")
        self.out = os.path.join(self.d, "kld-x.jsonl")

    def _forced(self, srv):
        return _run_main(["forced", "--url", srv.url, "--model", "m", "--calibration", self.cal,
                          "--ref", self.ref, "--positions", "32", "--out", self.out, "--image", "img"])

    def _status(self, extra=()):
        return _run_main(["cache-status", "--calibration", self.cal, "--out", self.out,
                          "--forced-ref", self.ref, "--positions", "32", "--model", "m", "--image", "img", *extra])

    def test_forced_writes_rows_and_forced_key(self):
        srv = _ForcedServer()
        try:
            self.assertEqual(self._forced(srv), 0)
        finally:
            srv.close()
        rows = _rows(self.out)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["positions"], [0, 1, 2, 3])
        key = json.load(open(self.out + ".key.json"))
        self.assertEqual((key["mode"], key["positions"]), ("forced", 32))
        self.assertEqual(len(key["ref_sha256"]), 64)
        self.assertEqual(self._status(), 0)

    def test_complete_forced_cache_is_not_rerequested(self):
        srv = _ForcedServer()
        try:
            self._forced(srv)
            n = len(srv.completions())
            self._forced(srv)
            self.assertEqual(len(srv.completions()), n)
        finally:
            srv.close()

    def test_changed_reference_is_a_key_mismatch(self):
        srv = _ForcedServer()
        try:
            self._forced(srv)
        finally:
            srv.close()
        with open(self.ref, "w") as f:
            f.write(json.dumps(_ref_block("p1", ids=(10, 11, 99))) + "\n")
        self.assertEqual(self._status(), 2)

    def test_greedy_status_rejects_forced_cache(self):
        srv = _ForcedServer()
        try:
            self._forced(srv)
        finally:
            srv.close()
        code = _run_main(["cache-status", "--calibration", self.cal, "--out", self.out])
        self.assertEqual(code, 2)

    def test_score_forced_cli(self):
        srv = _ForcedServer()
        try:
            self._forced(srv)
        finally:
            srv.close()
        res = os.path.join(self.d, "kldf-x.json")
        self.assertEqual(_run_main(["score-forced", "--ref", self.ref, "--arm", self.out, "--label", "x",
                                    "--ref-label", "q8", "--out", res]), 0)
        r = json.load(open(res))
        self.assertEqual((r["kind"], r["label"], r["reference_label"], r["n_positions"]),
                         ("kld_forced", "x", "q8", 4))


if __name__ == "__main__":
    unittest.main(verbosity=2)
