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


class TestCanonicalTokens(unittest.TestCase):
    """2026-11-12: llama.cpp renders control specials as '' and vLLM as '<|im_end|>'; several '' entries in one
    top-20 collided in a dict (the q8 self-floor read 0.11 nats/tok, ~20 nats at each end-of-turn position)."""
    def test_canon_tok(self):
        for s in ("", "<|im_end|>", "<|endoftext|>", "<tts_pad>"):
            self.assertEqual(K.canon_tok(s), K.SPECIAL_BUCKET)
        for s in ("<tool_call>", "</think>", "\n", "|", "<|", "a"):
            self.assertEqual(K.canon_tok(s), s)

    def test_canon_top_merges_duplicates_by_logsumexp(self):
        top = K.canon_top([("", math.log(0.5)), ("x", math.log(0.2)), ("<|im_end|>", math.log(0.25))])
        self.assertEqual([t for t, _ in top], [K.SPECIAL_BUCKET, "x"])
        self.assertAlmostEqual(math.exp(top[0][1]), 0.75)

    def test_duplicate_empty_strings_do_not_inflate_kl(self):
        ref = [("", -0.0001), ("\n", -9.0), ("", -25.0)]
        self.assertLess(K.kl_position(ref, list(ref))[0], 1e-9)

    def test_cross_engine_special_rendering_is_the_same_token(self):
        ref = [("", -0.001), ("\n", -7.0)]
        arm = [("<|im_end|>", -0.001), ("\n", -7.0)]
        self.assertLess(K.kl_position(ref, arm)[0], 1e-9)

    def test_score_forced_top1_and_missing_use_canonical_tokens(self):
        ref = [{"id": "p1", "toks": [""], "ids": [5], "prompt_tokens": 3, "error": None,
                "pos": [("", [("", -0.001), ("\n", -7.0)])]}]
        arm = [{"id": "p1", "mode": "forced", "positions": [0], "error": None,
                "pos": [("", [("<|im_end|>", -0.001), ("\n", -7.0)])]}]
        r = K.score_forced(ref, arm, "x", "q8")
        self.assertEqual(r["top1_agreement"], 1.0)
        self.assertEqual(r["ref_missing_frac"], 0.0)
        self.assertLess(r["kl_nats_per_tok"], 1e-6)
        self.assertLess(abs(r["dnll_nats_per_tok"]), 1e-9)


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
                if self.path == "/v1/models":
                    body = b'{"object": "list", "data": [{"id": "m", "owned_by": "llamacpp"}]}'
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
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

    def test_skip_excludes_and_respreads(self):
        p = K.forced_positions(512, 32, skip={0, 511, 100})
        self.assertEqual(len(p), 32)
        self.assertFalse({0, 511, 100} & set(p))
        self.assertEqual((p[0], p[-1]), (1, 510))
        self.assertEqual(K.forced_positions(5, 32, skip={2}), [0, 1, 3, 4])

    def test_partial_utf8_positions(self):
        pos = [("a", [("a", -0.1)]), ("\ufffd", [("\ufffd", -0.2)]), ("b", [("\ufffd", -0.1), ("b", -0.3)]),
               ("c", [("c", -0.1), ("\ufffd", -2.0)])]
        # the chosen token or the top-1 alternative is a partial UTF-8 byte; a lower alternative is fine
        self.assertEqual(K.partial_utf8_positions(pos), {1, 2})


class _ForcedServer:
    """Loopback 'token model': /tokenize answers fixed prompt ids; /v1/completions takes an int-list
    prompt and answers ONE generated token whose top-k row depends on len(prompt) — so a request is
    identified by its forced prefix length. Records every request body. Knobs: usage_delta (a server
    that miscounts the prompt — e.g. one that stringified the list), fail_at (prompt length -> 500)."""

    def __init__(self, prompt_ids=(1, 2, 3), usage_delta=0, fail_at=None, llama_shape=False, owned_by=None,
                 radiance_shape=False, models="ok"):
        import http.server
        import json as _json
        import threading
        outer = self
        self.bodies = []

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                # /v1/models owned_by: how the probe tells vLLM from the other engines (detect_engine);
                # models: "ok" | "500" (a server still loading) | "garbage" (not JSON)
                if self.path == "/v1/models" and models != "500":
                    card = {"id": "m", **({"owned_by": owned_by} if owned_by else {})}
                    raw = (b"<html>not json" if models == "garbage"
                           else _json.dumps({"object": "list", "data": [card]}).encode())
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                self.send_response(500 if self.path == "/v1/models" else 404)
                self.end_headers()

            def do_POST(self):
                body = _json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.bodies.append((self.path, body))
                if self.path == "/tokenize":
                    data = {"tokens": list(prompt_ids)}
                else:
                    p = body.get("prompt")
                    n = len(p) if isinstance(p, list) else len(prompt_ids)   # a text prompt = the tokenized ids
                    if fail_at is not None and n == fail_at:
                        self.send_response(500)
                        self.end_headers()
                        return
                    row = {f"t{n}": -0.1, "z": -2.5}
                    if body.get("return_tokens_as_token_ids"):
                        # vLLM: every token string becomes "token_id:N" (z = id 9999)
                        lpo = {"tokens": [f"token_id:{n}"],
                               "top_logprobs": [{f"token_id:{n}": -0.1, "token_id:9999": -2.5}]}
                    elif llama_shape:
                        lpo = {"content": [{"id": 7, "token": f"t{n}", "logprob": -0.1,
                                            "top_logprobs": [{"id": 7, "token": t, "logprob": v}
                                                             for t, v in row.items()]}]}
                    elif radiance_shape:
                        # radiance: the legacy dict AND the content array (ids + bytes) side by side
                        lpo = {"tokens": [f"t{n}"], "top_logprobs": [row],
                               "content": [{"id": n, "token": f"t{n}", "logprob": -0.1, "bytes": [],
                                            "top_logprobs": [{"id": n, "token": f"t{n}", "logprob": -0.1, "bytes": []},
                                                             {"id": 9999, "token": "z", "logprob": -2.5, "bytes": []}]}]}
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

    def test_partial_utf8_reference_positions_skipped(self):
        ref = _ref_block()
        ref["pos"][1] = ("\ufffd", [("\ufffd", -0.05), ("z", -3.0)])
        srv = _ForcedServer()
        blk = self._run(srv, ref)
        self.assertIsNone(blk["error"])
        self.assertEqual(blk["positions"], [0, 2, 3])
        self.assertEqual(len(srv.completions()), 3)

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
        self.assertEqual(key["position_rule"], K.POSITION_RULE)
        self.assertEqual(len(key["ref_sha256"]), 64)
        self.assertEqual(self._status(), 0)

    def test_old_position_rule_cache_is_a_key_mismatch(self):
        srv = _ForcedServer()
        try:
            self._forced(srv)
        finally:
            srv.close()
        kp = self.out + ".key.json"
        key = json.load(open(kp))
        del key["position_rule"]   # a fetch made before the partial-UTF-8 skip rule
        json.dump(key, open(kp, "w"))
        self.assertEqual(self._status(), 2)

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



class TestScoreForcedDiff(unittest.TestCase):
    """Paired difference of two forced arms on the SAME reference positions (user 2026-11-12: '128 + paired diff')."""
    def setUp(self):
        self.ref = [_ref_block(f"p{i}", ids=(10, 11)) for i in range(6)]
        self.same = [_forced_block(b["id"], list(b["pos"])) for b in self.ref]
        off = ("r10", [("z", -0.05), ("r10", -3.0)])
        self.worse = [_forced_block(b["id"], [off, b["pos"][1]]) for b in self.ref]

    def test_identical_arms_diff_zero_unresolved(self):
        r = K.score_forced_diff(self.ref, self.same, self.same, "a", "b", "q8")
        self.assertEqual(r["kind"], "kld_forced_diff")
        self.assertAlmostEqual(r["diff_nats_per_tok"], 0.0, places=9)
        self.assertEqual(r["verdict"], "not resolved")

    def test_worse_arm_resolved_and_sign(self):
        r = K.score_forced_diff(self.ref, self.worse, self.same, "worse", "same", "q8")
        k = K.kl_position(self.ref[0]["pos"][0][1], [("z", -0.05), ("r10", -3.0)])[0]
        self.assertAlmostEqual(r["diff_nats_per_tok"], round(k / 2, 6), places=6)
        self.assertGreater(r["ci95_nats"][0], 0)
        self.assertEqual(r["verdict"], "same lower")
        self.assertEqual(r["frac_prompts_a_lower"], 0.0)
        self.assertAlmostEqual(r["kl_a"] - r["kl_b"], r["diff_nats_per_tok"], places=5)

    def test_prompt_errored_in_either_arm_excluded(self):
        b = [dict(x) for x in self.same]
        b[0]["error"] = "boom"
        r = K.score_forced_diff(self.ref, self.worse, b, "a", "b", "q8")
        self.assertEqual((r["n_prompts_used"], r["n_prompt_errors"]), (5, 1))

    def test_order_mismatch_raises(self):
        with self.assertRaises(ValueError):
            K.score_forced_diff(self.ref, self.same, list(reversed(self.same)), "a", "b", "q8")

    def test_different_positions_raise(self):
        b = [_forced_block(x["id"], list(x["pos"]), positions=[1, 0]) for x in self.ref]
        with self.assertRaises(ValueError):
            K.score_forced_diff(self.ref, self.same, b, "a", "b", "q8")

    def test_cli(self):
        d = _scratch("forced-diff-cli")
        files = {}
        for name, blocks in (("ref", self.ref), ("a", self.worse), ("b", self.same)):
            files[name] = os.path.join(d, f"{name}.jsonl")
            with open(files[name], "w") as f:
                f.writelines(json.dumps(x) + "\n" for x in blocks)
        out = os.path.join(d, "diff.json")
        _run_main(["score-forced-diff", "--ref", files["ref"], "--arm-a", files["a"], "--arm-b", files["b"],
                   "--label-a", "a", "--label-b", "b", "--ref-label", "q8", "--out", out])
        self.assertEqual(json.load(open(out))["verdict"], "b lower")


# ------------------------------------------------------------------ token-id keying (2026-11-13, §10 item 1)
class TestTokenIdParsing(unittest.TestCase):
    """Each top-k entry keeps its token id when the engine sends one: llama.cpp/radiance `id`, vLLM "token_id:N"
    (return_tokens_as_token_ids). A row's ids are kept only when EVERY kept entry has one."""

    def test_tok_id_vllm_placeholder(self):
        self.assertEqual(K._tok_id("token_id:123"), 123)
        self.assertEqual(K._tok_id("token_id:0"), 0)

    def test_tok_id_malformed_is_none(self):
        for s in ("token_id:", "token_id:x", "token_id:1.5", "token_id:-3", "token_id: 4", "token_id:5 ",
                  "xtoken_id:5", "token_id", "abc", "", None, 5, "token_id:007", "token_id:00", "token_id:٣"):
            self.assertIsNone(K._tok_id(s), s)

    def test_llamacpp_entries_keep_ids(self):
        top, ids = K._topk_parse([{"id": 5, "token": "a", "logprob": lp(0.6), "bytes": [97]},
                                  {"id": 6, "token": "", "logprob": lp(0.3), "bytes": []}])
        self.assertEqual(top, [("a", lp(0.6)), ("", lp(0.3))])
        self.assertEqual(ids, [5, 6])

    def test_vllm_dict_map_ids(self):
        top, ids = K._topk_parse({"token_id:5": lp(0.6), "token_id:6": lp(0.3)})
        self.assertEqual(ids, [5, 6])
        self.assertEqual([t for t, _ in top], ["token_id:5", "token_id:6"])

    def test_one_entry_without_id_drops_the_row_ids(self):
        _top, ids = K._topk_parse([{"id": 5, "token": "a", "logprob": -0.1}, {"token": "b", "logprob": -2.0}])
        self.assertIsNone(ids)

    def test_malformed_placeholder_drops_the_row_ids(self):
        top, ids = K._topk_parse({"token_id:5": -0.1, "token_id:x": -2.0})
        self.assertIsNone(ids)
        self.assertEqual(len(top), 2)

    def test_bool_or_negative_id_is_not_an_id(self):
        self.assertIsNone(K._topk_parse([{"id": True, "token": "a", "logprob": -0.1}])[1])
        self.assertIsNone(K._topk_parse([{"id": -1, "token": "a", "logprob": -0.1}])[1])

    def test_legacy_rows_have_no_ids(self):
        self.assertIsNone(K._topk_parse({"a": -0.1, "b": -2.0})[1])
        self.assertIsNone(K._topk_parse([_entry("a", 0.5)])[1])
        self.assertEqual(K._topk_parse(None), ([], None))

    def test_ids_stay_aligned_when_entries_are_skipped(self):
        top, ids = K._topk_parse([{"id": 1, "token": "a", "logprob": float("nan")},
                                  {"id": 2, "token": "b", "logprob": -0.1}])
        self.assertEqual((top, ids), ([("b", -0.1)], [2]))
        top, ids = K._topk_parse([{"id": i, "token": str(i), "logprob": -0.1} for i in range(30)])
        self.assertEqual(ids, list(range(K.TOP_K)))

    def test_topk_entries_signature_unchanged(self):
        top, mass = K._topk_entries([{"id": 5, "token": "a", "logprob": lp(0.5)}])
        self.assertEqual(top, [("a", lp(0.5))])
        self.assertAlmostEqual(mass, 0.5, delta=1e-12)


def _rad_lp():
    """radiance /v1/completions: the legacy dict (collapsed: two '' tokens -> one key) AND the content array."""
    return {"tokens": ["a"], "top_logprobs": [{"a": lp(0.6), "": lp(0.2)}],
            "content": [{"id": 5, "token": "a", "logprob": lp(0.6), "bytes": [97],
                         "top_logprobs": [{"id": 5, "token": "a", "logprob": lp(0.6), "bytes": [97]},
                                          {"id": 6, "token": "", "logprob": lp(0.2), "bytes": [226]},
                                          {"id": 7, "token": "", "logprob": lp(0.1), "bytes": []}]}]}


class TestNormalizePrefersContent(unittest.TestCase):
    def test_radiance_both_shapes_prefers_content(self):
        toks, tops = K.normalize_logprobs(_rad_lp())
        self.assertEqual(toks, ["a"])
        top, ids = K._topk_parse(tops[0])
        self.assertEqual(ids, [5, 6, 7])            # the legacy dict had only 2 keys (server-side collision)
        self.assertEqual(len(top), 3)
        self.assertEqual(K._content_ids(_rad_lp()), [5])
        self.assertIn("content=list[1]", K.logprobs_shape(_rad_lp()))

    def test_empty_content_falls_back_to_legacy(self):
        lpo = {"tokens": ["a"], "top_logprobs": [{"a": -0.1}], "content": []}
        self.assertEqual(K.normalize_logprobs(lpo), (["a"], [{"a": -0.1}]))
        self.assertIsNone(K._content_ids(lpo))
        self.assertEqual(K.logprobs_shape(lpo), "tokens=1, top_logprobs=list[1] row=dict-map[1]")

    def test_empty_content_alone(self):
        self.assertEqual(K.normalize_logprobs({"content": []}), ([], []))
        self.assertIsNone(K._content_ids({"content": []}))

    def test_legacy_only_unchanged(self):
        lpo = {"tokens": ["a", "b"], "top_logprobs": [{"a": -0.1}, {"b": -0.2}]}
        self.assertEqual(K.normalize_logprobs(lpo), (["a", "b"], [{"a": -0.1}, {"b": -0.2}]))
        self.assertIsNone(K._content_ids(lpo))

    def test_vllm_placeholder_tokens_give_generated_ids(self):
        lpo = {"tokens": ["token_id:5", "token_id:9"], "top_logprobs": [{"token_id:5": -0.1}, {"token_id:9": -0.1}]}
        self.assertEqual(K._content_ids(lpo), [5, 9])
        self.assertIsNone(K._content_ids({"tokens": ["token_id:5", "token_id:x"], "top_logprobs": [{}, {}]}))


class TestEngineScopedRequests(unittest.TestCase):
    """vLLM gets return_tokens_as_token_ids; llama.cpp and radiance requests stay byte-for-byte as before."""

    def test_detect_engine(self):
        for owned, want in (("vllm", "vllm"), ("llamacpp", "llamacpp"), (None, None)):
            srv = _ForcedServer(owned_by=owned)
            try:
                self.assertEqual(K.detect_engine(srv.url), want)
            finally:
                srv.close()

    def test_forced_flag_only_for_vllm(self):
        for engine, flagged in (("vllm", True), ("llamacpp", False), ("radiance", False), (None, False)):
            srv = _ForcedServer()
            try:
                blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": _ref_block()}, engine=engine)[0]
            finally:
                srv.close()
            self.assertIsNone(blk["error"], engine)
            for b in srv.completions():
                self.assertEqual("return_tokens_as_token_ids" in b, flagged, engine)
                if flagged:
                    self.assertIs(b["return_tokens_as_token_ids"], True)
            self.assertTrue(all("return_tokens_as_token_ids" not in b for p, b in srv.bodies if p == "/tokenize"))

    def test_greedy_fetch_and_selftest_flag_for_vllm(self):
        srv = _ForcedServer()
        try:
            blk = K.fetch(srv.url, "m", [("p1", "hello")], max_tokens=1, engine="vllm")[0]
            ok, checks = K.selftest(srv.url, "m", engine="vllm")
            bodies = srv.completions()
        finally:
            srv.close()
        self.assertTrue(bodies and all(b.get("return_tokens_as_token_ids") is True for b in bodies))
        self.assertIsNone(blk["error"])
        self.assertEqual(blk["ids"], [3])                  # "token_id:3" -> 3
        self.assertEqual(blk["top_ids"], [[3, 9999]])
        self.assertTrue(ok)
        self.assertEqual(checks["engine"], "vllm")
        self.assertTrue(checks["topk_ids"])

    def test_selftest_without_engine_unchanged_requests(self):
        srv = _ForcedServer()
        try:
            _ok, checks = K.selftest(srv.url, "m")
            bodies = srv.completions()
        finally:
            srv.close()
        self.assertTrue(all("return_tokens_as_token_ids" not in b for b in bodies))
        self.assertIsNone(checks["engine"])
        self.assertFalse(checks["topk_ids"])

    def test_forced_rows_store_ids_per_engine_shape(self):
        for kw, engine, want in (({"llama_shape": True}, None, [7, 7]), ({"radiance_shape": True}, None, None),
                                 ({}, "vllm", None), ({}, None, "absent")):
            srv = _ForcedServer(**kw)
            try:
                blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": _ref_block()}, engine=engine)[0]
            finally:
                srv.close()
            self.assertIsNone(blk["error"], kw)
            if want == "absent":
                self.assertNotIn("top_ids", blk)           # a legacy-shape engine: the row is as before
            elif want is None:                              # radiance / vLLM: the ids follow the prefix length
                self.assertEqual(blk["top_ids"], [[n, 9999] for n in (3, 4, 5, 6)], kw)
            else:
                self.assertEqual(blk["top_ids"], [want] * 4)

    def test_forced_cli_auto_detects_vllm(self):
        d = _scratch("forced-engine-cli")
        cal, ref = os.path.join(d, "cal.jsonl"), os.path.join(d, "kld-q8.jsonl")
        src = os.path.join(d, "p.txt")
        open(src, "w").write("hello world")
        with open(cal, "w") as f:
            f.write(json.dumps({"id": "p1", "src": src, "char_cut": 5}) + "\n")
        with open(ref, "w") as f:
            f.write(json.dumps(_ref_block("p1")) + "\n")
        for owned, flagged in (("vllm", True), ("llamacpp", False), (None, False)):
            srv = _ForcedServer(owned_by=owned)
            out = os.path.join(d, f"kld-{owned}.jsonl")
            try:
                self.assertEqual(_run_main(["forced", "--url", srv.url, "--model", "m", "--calibration", cal,
                                            "--ref", ref, "--out", out]), 0)
                bodies = srv.completions()
            finally:
                srv.close()
            self.assertTrue(bodies)
            self.assertTrue(all(("return_tokens_as_token_ids" in b) == flagged for b in bodies), owned)
        srv = _ForcedServer(owned_by="llamacpp")     # an explicit --engine wins over the detection
        try:
            _run_main(["forced", "--url", srv.url, "--model", "m", "--calibration", cal, "--ref", ref,
                       "--out", os.path.join(d, "kld-pin.jsonl"), "--engine", "vllm"])
            self.assertTrue(all(b.get("return_tokens_as_token_ids") for b in srv.completions()))
        finally:
            srv.close()


def _fref(top, ids=None, chosen=("", 2), pid="p1"):
    """A one-position forced reference block; ids = the row's top ids (None = an old, string-only row)."""
    b = {"id": pid, "toks": [chosen[0]], "ids": [chosen[1]], "prompt_tokens": 3, "error": None,
         "pos": [(chosen[0], top)]}
    if ids is not None:
        b["top_ids"] = [ids]
    return b


def _farm(tops, ids=None, pid="p1", tok=""):
    b = _forced_block(pid, [(tok, t) for t in tops])
    if ids is not None:
        b["top_ids"] = ids
    return b


class TestIdJoin(unittest.TestCase):
    """Scoring joins by id when BOTH sides carry ids for every entry of the position; otherwise the string path
    runs exactly as before. The id path reuses kl_position: ints pass canon_tok untouched, duplicate ids merge by
    logsumexp in canon_top, and the tail bucket is the same code."""

    # two distinct tokens that both render '' (control specials, partial UTF-8): the string bucket merges them
    REF = [("", lp(0.5)), ("", lp(0.3)), ("a", lp(0.1))]
    ARM = [("", lp(0.3)), ("", lp(0.5)), ("a", lp(0.1))]      # ids 1 and 2 swapped their mass

    def test_id_join_sees_what_the_string_bucket_hides(self):
        ref = [_fref(self.REF, [1, 2, 3])]
        r = K.score_forced(ref, [_farm([self.ARM], [[1, 2, 3]])], "x", "q8")
        want = 0.5 * math.log(0.5 / 0.3) + 0.3 * math.log(0.3 / 0.5)      # tail: 0.1·ln(0.1/0.1) = 0
        self.assertAlmostEqual(r["kl_nats_per_tok"], round(want, 6), places=6)
        self.assertAlmostEqual(r["dnll_nats_per_tok"], round(math.log(0.3 / 0.5), 6), places=6)   # chosen id 2
        self.assertEqual(r["top1_agreement"], 0.0)
        self.assertEqual((r["join"], r["join_counts"]), ("id", {"id": 1, "string": 0}))
        s = K.score_forced([_fref(self.REF)], [_farm([self.ARM])], "x", "q8")       # same rows, no ids
        self.assertEqual((s["kl_nats_per_tok"], s["join"]), (0.0, "string"))

    def test_vllm_placeholder_arm_joins_a_llamacpp_reference(self):
        arm = [("token_id:1", lp(0.3)), ("token_id:2", lp(0.5)), ("token_id:3", lp(0.1))]
        r = K.score_forced([_fref(self.REF, [1, 2, 3])], [_farm([arm], [[1, 2, 3]], tok="")], "x", "q8")
        self.assertAlmostEqual(r["kl_nats_per_tok"], round(0.2 * math.log(5 / 3), 6), places=6)
        self.assertEqual(r["join"], "id")

    def test_mixed_one_side_lacks_ids_is_the_string_path(self):
        base = K.score_forced([_fref(self.REF)], [_farm([self.ARM])], "x", "q8")
        for ref_ids, arm_ids in (([1, 2, 3], None), (None, [[1, 2, 3]]), ([1, 2, None], [[1, 2, 3]])):
            r = K.score_forced([_fref(self.REF, ref_ids)], [_farm([self.ARM], arm_ids)], "x", "q8")
            self.assertEqual(r["join"], "string", (ref_ids, arm_ids))
            self.assertEqual({k: r[k] for k in base}, base)

    def test_mixed_rows_within_an_arm(self):
        ref = _fref(self.REF, [1, 2, 3])
        ref["toks"], ref["ids"] = ["", ""], [2, 2]
        ref["pos"], ref["top_ids"] = ref["pos"] * 2, ref["top_ids"] * 2
        r = K.score_forced([ref], [_farm([self.ARM, self.ARM], [[1, 2, 3], None])], "x", "q8")
        self.assertEqual((r["join"], r["join_counts"]), ("mixed", {"id": 1, "string": 1}))

    def test_duplicate_ids_merge_by_logsumexp(self):
        ref = [("x", lp(0.4)), ("x", lp(0.2)), ("y", lp(0.3))]
        arm = [("x", lp(0.3)), ("y", lp(0.6))]
        r = K.score_forced([_fref(ref, [5, 5, 6], chosen=("x", 5))], [_farm([arm], [[5, 6]], tok="x")], "x", "q8")
        # merged ref {5: 0.6, 6: 0.3} vs arm {5: 0.3, 6: 0.6}; unmerged entries would clamp to 0
        self.assertAlmostEqual(r["kl_nats_per_tok"], round(0.3 * math.log(2), 6), places=6)
        self.assertEqual(r["join"], "id")

    def test_tail_bucket_math_identical_on_both_paths(self):
        ref = [("a", lp(0.5)), ("b", lp(0.2))]
        arm = [("a", lp(0.4)), ("c", lp(0.3))]
        s = K.score_forced([_fref(ref, chosen=("a", 1))], [_farm([arm], tok="a")], "x", "q8")
        i = K.score_forced([_fref(ref, [1, 2], chosen=("a", 1))], [_farm([arm], [[1, 3]], tok="a")], "x", "q8")
        self.assertEqual(i["join"], "id")
        for k in ("kl_nats_per_tok", "kl_per_position", "dnll_nats_per_tok", "top1_agreement", "ref_missing_frac"):
            self.assertEqual(i[k], s[k], k)

    def test_placeholders_on_the_string_path_raise(self):
        arm = [("token_id:1", lp(0.3)), ("token_id:2", lp(0.5))]
        with self.assertRaisesRegex(ValueError, "token_id"):
            K.score_forced([_fref(self.REF)], [_farm([arm], [[1, 2]])], "x", "q8")
        # a vLLM row with one malformed placeholder has no ids, but its block is still a placeholder block
        with self.assertRaisesRegex(ValueError, "token_id"):
            K.score_forced([_fref(self.REF)], [_farm([[("token_id:1", lp(0.3)), ("token_id:x", lp(0.5))]])],
                           "x", "q8")

    def test_real_text_token_starting_with_token_id_is_scored_by_string(self):
        # fix round 2: a genuine text token "token_id:5" (old llama.cpp data, no ids) must not raise
        ref = [("token_id:5", lp(0.5)), ("a", lp(0.3))]
        arm = [("token_id:5", lp(0.4)), ("a", lp(0.4))]
        r = K.score_forced([_fref(ref, chosen=("token_id:5", 2))], [_farm([arm], tok="token_id:5")], "x", "q8")
        self.assertEqual(r["join"], "string")
        self.assertAlmostEqual(r["kl_nats_per_tok"], round(0.5 * math.log(0.5 / 0.4) + 0.3 * math.log(0.3 / 0.4)
                                                           + 0.2 * math.log(0.2 / 0.2), 6), places=6)
        g = K.score([_blk("p1", [("token_id:5", ref)])], [_blk("p1", [("token_id:5", arm)])], "x", "note")
        self.assertEqual(g["join"], "string")

    def test_one_entry_real_text_row_is_not_a_placeholder_block(self):
        # a single "token_id:5" text entry is not evidence of a vLLM block (<2 entries)
        self.assertFalse(K._placeholder_block({"pos": [("token_id:5", [("token_id:5", lp(0.9))])]}))
        self.assertTrue(K._placeholder_block({"pos": [("x", [("token_id:1", lp(0.5)), ("token_id:2", lp(0.4))])]}))
        r = K.score_forced([_fref([("token_id:5", lp(0.9))], chosen=("token_id:5", 2))],
                           [_farm([[("token_id:5", lp(0.8))]], tok="token_id:5")], "x", "q8")
        self.assertEqual(r["join"], "string")

    def test_mixed_placeholder_block_raises_valueerror_not_stopiteration(self):
        # placeholder block, but this position's rows are plain text: a ValueError naming the mix
        with self.assertRaisesRegex(ValueError, "mixes id and text rows"):
            K.join_keys("a", [("a", lp(0.5))], None, None, "a", [("a", lp(0.5))], None, None, placeholder=True)

    def test_greedy_dnll_uses_the_merged_top_on_the_id_path(self):
        # fix round 2: id 5 twice (0.3 + 0.3): the merged ref logprob of the chosen id is ln 0.6, not ln 0.3
        rtop = [("x", lp(0.3)), ("x", lp(0.3)), ("y", lp(0.35))]
        atop = [("x", lp(0.6)), ("y", lp(0.3))]
        ref, arm = _blk("p1", [("x", rtop)]), _blk("p1", [("x", atop)])
        ref["ids"], ref["top_ids"], arm["ids"], arm["top_ids"] = [5], [[5, 5, 6]], [5], [[5, 6]]
        r = K.score([ref], [arm], "x", "note")
        self.assertEqual(r["join"], "id")
        self.assertAlmostEqual(r["dnll_nats_per_tok"], 0.0, places=6)

    def test_greedy_score_pairs_on_ids(self):
        top = [("", lp(0.5)), ("a", lp(0.3))]
        ref = _blk("p1", [("", top), ("a", top)])
        arm = _blk("p1", [("", top), ("a", top)])
        ref["ids"], arm["ids"] = [7, 1], [8, 1]       # same string, different token at position 0
        r = K.score([dict(ref)], [dict(arm)], "x", "note")
        self.assertEqual((r["n_positions"], r["first_divergent_pos"]["n_diverged"], r["join"]), (2, 0, "string"))
        ref["top_ids"], arm["top_ids"] = [[7, 1], [7, 1]], [[8, 1], [8, 1]]
        r = K.score([ref], [arm], "x", "note")
        self.assertEqual((r["n_positions"], r["n_positions_dropped"], r["first_divergent_pos"]["n_diverged"]),
                         (1, 1, 1))
        self.assertEqual(r["join"], "id")

    def test_forced_diff_refuses_different_joins(self):
        # one arm id-joined, the other string-joined: the same distribution reads 0.102 vs 0.0 -> not comparable
        ref = [_fref(self.REF, [1, 2, 3])]
        with self.assertRaisesRegex(ValueError, "join"):
            K.score_forced_diff(ref, [_farm([self.ARM], [[1, 2, 3]])], [_farm([self.ARM])], "a", "b", "q8")
        ref2 = _fref(self.REF, [1, 2, 3])                        # both arms "mixed" -> refused too
        ref2["toks"], ref2["ids"], ref2["pos"], ref2["top_ids"] = ["", ""], [2, 2], ref2["pos"] * 2, ref2["top_ids"] * 2
        mixed = _farm([self.ARM, self.ARM], [[1, 2, 3], None])
        with self.assertRaisesRegex(ValueError, "mixed"):
            K.score_forced_diff([ref2], [mixed], [dict(mixed)], "a", "b", "q8")
        r = K.score_forced_diff(ref, [_farm([self.ARM], [[1, 2, 3]])], [_farm([self.REF], [[1, 2, 3]])], "a", "b", "q8")
        self.assertEqual((r["join_a"], r["join_b"]), ("id", "id"))
        self.assertAlmostEqual(r["kl_a"], round(0.2 * math.log(5 / 3), 6), places=6)

    def test_forced_diff_cli_refuses_with_nonzero_exit(self):
        d = _scratch("forced-diff-join-cli")
        files = {}
        for name, blocks in (("ref", [_fref(self.REF, [1, 2, 3])]), ("a", [_farm([self.ARM], [[1, 2, 3]])]),
                             ("b", [_farm([self.ARM])])):
            files[name] = os.path.join(d, f"{name}.jsonl")
            with open(files[name], "w") as f:
                f.writelines(json.dumps(x) + "\n" for x in blocks)
        out = os.path.join(d, "diff.json")
        code = _run_main(["score-forced-diff", "--ref", files["ref"], "--arm-a", files["a"], "--arm-b", files["b"],
                          "--label-a", "a", "--label-b", "b", "--ref-label", "q8", "--out", out])
        self.assertNotEqual(code, 0)
        self.assertFalse(os.path.exists(out))

    def test_greedy_top1_uses_the_merged_top(self):
        # id 5 appears twice (0.3 + 0.3 = 0.6 > id 6's 0.35): merged argmax is 5, last-wins/raw argmax would be 6
        rtop = [("x", lp(0.3)), ("x", lp(0.3)), ("y", lp(0.35))]
        atop = [("x", lp(0.6)), ("y", lp(0.3))]
        ref, arm = _blk("p1", [("x", rtop)]), _blk("p1", [("x", atop)])
        ref["ids"], ref["top_ids"], arm["ids"], arm["top_ids"] = [5], [[5, 5, 6]], [5], [[5, 6]]
        r = K.score([ref], [arm], "x", "note")
        self.assertEqual((r["join"], r["top1_agreement"], r["top1_agreement_paired"]), ("id", 1.0, 1.0))


class TestOldDataBitIdentical(unittest.TestCase):
    """Rows already on disk carry no top ids, so re-scoring them must reproduce the pre-change numbers exactly.
    Golden values captured from kld_probe.py BEFORE the token-id change, on this file's existing fixtures."""

    def setUp(self):
        self.ref = [_ref_block(f"p{i}", ids=(10, 11)) for i in range(6)]
        self.same = [_forced_block(b["id"], list(b["pos"])) for b in self.ref]
        off = ("r10", [("z", -0.05), ("r10", -3.0)])
        self.worse = [_forced_block(b["id"], [off, b["pos"][1]]) for b in self.ref]

    def _assert_golden(self, r, golden):
        self.assertEqual({k: r[k] for k in golden}, golden)
        self.assertIn(r.get("join", r.get("join_a")), ("string",))

    def test_forced(self):
        self._assert_golden(K.score_forced(self.ref, self.worse, "worse", "q8"), {
            "n_prompts": 6, "n_prompt_errors": 0, "n_positions": 12, "kl_nats_per_tok": 1.329627,
            "ci95_nats": [1.329627, 1.329627],
            "kl_per_position": {"median": 1.329627, "p90": 2.659255, "max": 2.659255},
            "top1_agreement": 0.5, "dnll_nats_per_tok": 1.475,
            "arm_topk_short": {"n_short": 12, "frac_short": 1.0, "top_k": 20}, "ref_missing_frac": 0.0})

    def test_forced_diff(self):
        r = K.score_forced_diff(self.ref, self.worse, self.same, "worse", "same", "q8")
        self._assert_golden(r, {"n_prompts_used": 6, "n_prompt_errors": 0, "n_positions": 12, "kl_a": 1.329627,
                                "kl_b": 0.0, "diff_nats_per_tok": 1.329627, "ci95_nats": [1.329627, 1.329627],
                                "verdict": "same lower", "frac_prompts_a_lower": 0.0})
        self.assertEqual(r["join_b"], "string")

    def test_forced_canonical_specials(self):
        ref = [{"id": "p1", "toks": [""], "ids": [5], "prompt_tokens": 3, "error": None,
                "pos": [("", [("", -0.001), ("\n", -7.0), ("", -9.0)])]}]
        arm = [{"id": "p1", "mode": "forced", "positions": [0], "error": None,
                "pos": [("", [("<|im_end|>", -0.002), ("\n", -6.5), ("x", -8.0)])]}]
        self._assert_golden(K.score_forced(ref, arm, "x", "q8"), {
            "n_positions": 1, "kl_nats_per_tok": 0.000667, "ci95_nats": [0.000667, 0.000667],
            "kl_per_position": {"median": 0.000667, "p90": 0.000667, "max": 0.000667},
            "top1_agreement": 1.0, "dnll_nats_per_tok": 0.001124, "ref_missing_frac": 0.0})

    def test_greedy_with_generated_ids_but_no_top_ids_pairs_on_strings(self):
        # llama.cpp greedy files on disk carry generated `ids` (ref and arm) but no top ids: pairing must stay on
        # the strings (p1 position 2 is '' on both sides with ids 7 vs 8 — the old code paired it)
        top_a = [("a", lp(0.7)), ("b", lp(0.2))]
        top_b = [("b", lp(0.6)), ("a", lp(0.3))]
        top_e = [("", lp(0.5)), ("a", lp(0.3)), ("", lp(0.1))]
        ref = [_blk("p1", [("a", top_a), ("a", top_a), ("", top_e), ("a", top_a)]),
               _blk("p2", [("b", top_b), ("a", top_a)])]
        arm = [_blk("p1", [("a", top_a), ("a", top_b), ("", top_a), ("b", top_b)]),
               _blk("p2", [("b", top_a), ("b", top_b)])]
        ref[0]["ids"], arm[0]["ids"], ref[1]["ids"], arm[1]["ids"] = [1, 1, 7, 1], [1, 1, 8, 2], [2, 1], [2, 2]
        self._assert_golden(K.score(ref, arm, "x", "note"), {
            "n_positions": 6, "n_positions_dropped": 0, "kl_nats_per_tok": 0.321686,
            "ci95_nats": [0.287938, 0.389182], "pooled_ci_nats": [0.194978, 0.448393],
            "dnll_nats_per_tok": 0.260177, "top1_agreement": 0.33333,
            "first_divergent_pos": {"mean": 2.0, "median": 3, "n_diverged": 2, "n_prompts": 2},
            "coverage_ref_mean": 0.9, "coverage_arm_mean": 0.9, "top1_agreement_paired": 0.16667,
            "kl_per_position": {"median": 0.373386, "p90": 0.404978, "max": 0.404978,
                                "note": "over paired positions; p90 = nearest rank"},
            "floor_substitutions": {
                "ref_tokens_missing_from_arm": 2, "ref_entries": 13, "ref_missing_frac": 0.153846,
                "positions_with_floor": 1, "ref_mass_floored_mean": 0.1, "arm_tokens_missing_from_ref": 1,
                "arm_entries": 12, "arm_missing_frac": 0.083333,
                "note": "ref tokens absent from the arm top-k are scored at the arm floor (lower-bound KL); "
                        "arm tokens absent from the ref top-k do not enter KL(ref||arm)"}})


class TestPromptIds(unittest.TestCase):
    """The reference stores its own /tokenize prompt ids (fetch --prompt-ids); every forced arm is sent THOSE ids
    and its own /tokenize must equal them id for id, not just in length."""

    def test_fetch_prompt_ids_stored(self):
        srv = _ForcedServer(prompt_ids=(4, 5, 6))
        try:
            blk = K.fetch(srv.url, "m", [("p1", "hello")], max_tokens=1, prompt_ids=True)[0]
            tok = [b for p, b in srv.bodies if p == "/tokenize"]
        finally:
            srv.close()
        self.assertIsNone(blk["error"])
        self.assertEqual(blk["prompt_ids"], [4, 5, 6])
        self.assertEqual(len(tok), 1)

    def test_fetch_prompt_ids_length_disagreement_quarantines(self):
        srv = _ForcedServer(usage_delta=1)
        try:
            blk = K.fetch(srv.url, "m", [("p1", "hello")], max_tokens=1, prompt_ids=True)[0]
        finally:
            srv.close()
        self.assertIn("prompt ids", blk["error"])

    def test_fetch_default_sends_no_tokenize(self):
        srv = _ForcedServer()
        try:
            blk = K.fetch(srv.url, "m", [("p1", "hello")], max_tokens=1)[0]
            paths = [p for p, _ in srv.bodies]
        finally:
            srv.close()
        self.assertNotIn("prompt_ids", blk)
        self.assertEqual(paths, ["/v1/completions"])

    def test_forced_sends_the_reference_prompt_ids(self):
        ref = _ref_block()
        ref["prompt_ids"] = [1, 2, 3]
        srv = _ForcedServer(prompt_ids=(1, 2, 3))
        try:
            blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": ref})[0]
        finally:
            srv.close()
        self.assertIsNone(blk["error"])
        self.assertEqual(blk["prompt_ids"], [1, 2, 3])
        self.assertEqual([b["prompt"][:3] for b in srv.completions()], [[1, 2, 3]] * 4)

    def test_forced_same_length_different_ids_quarantines(self):
        ref = _ref_block()
        ref["prompt_ids"] = [1, 2, 3]
        srv = _ForcedServer(prompt_ids=(1, 2, 4))         # same length: the old length check passed this
        try:
            blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": ref})[0]
        finally:
            srv.close()
        self.assertIn("prompt ids differ", blk["error"])
        self.assertIn("index 2", blk["error"])
        self.assertEqual(srv.completions(), [])
        self.assertEqual(blk["prompt_ids"], [1, 2, 4])

    def test_tokenizer_check_reports_id_equality(self):
        top = [("a", lp(0.9))]
        ref, arm = _blk_pt("p1", [("a", top)], 3), _blk_pt("p1", [("a", top)], 3)
        ref["prompt_ids"], arm["prompt_ids"] = [1, 2, 3], [1, 2, 4]
        g = K.tokenizer_check([ref], [arm])
        self.assertEqual(g["verdict"], "MISMATCH")
        self.assertEqual(g["mismatches"], [{"id": "p1", "ref": 3, "arm": 3, "ids_equal": False}])
        self.assertEqual((g["n_ids_compared"], g["n_ids_mismatch"]), (1, 1))
        arm["prompt_ids"] = [1, 2, 3]
        g = K.tokenizer_check([ref], [arm])
        self.assertEqual((g["verdict"], g["n_ids_compared"], g["n_ids_mismatch"]), ("ok", 1, 0))

    def test_score_forced_carries_the_tokenizer_check(self):
        ref = _fref([("a", lp(0.9))], chosen=("a", 1))
        ref["prompt_ids"] = [1, 2, 3]
        arm = _farm([[("a", lp(0.9))]], tok="a")
        arm["prompt_tokens"], arm["prompt_ids"] = 3, [1, 2, 3]
        g = K.score_forced([ref], [arm], "x", "q8")["tokenizer_check"]
        self.assertEqual((g["verdict"], g["n_compared"], g["n_ids_compared"]), ("ok", 1, 1))


class TestPromptIdsReuse(unittest.TestCase):
    """Fix round 1, MAJOR 2: a cached file fetched before ids were kept is never silently reused when ids are
    required, and never renamed or moved: fetch/forced/cache-status refuse loudly and name a new --out path."""

    def setUp(self):
        self.d = _scratch("pids-" + self._testMethodName)
        self.cal = os.path.join(self.d, "cal.jsonl")
        src = os.path.join(self.d, "p.txt")
        open(src, "w").write("hello world")
        with open(self.cal, "w") as f:
            f.write(json.dumps({"id": "p1", "src": src, "char_cut": 5}) + "\n")
        self.out = os.path.join(self.d, "kld-q8.jsonl")

    def _fetch(self, srv, *extra):
        return _run_main(["fetch", "--url", srv.url, "--model", "m", "--calibration", self.cal, "--out", self.out,
                          "--max-tokens", "1", *extra])

    def _status(self, *extra):
        return _run_main(["cache-status", "--calibration", self.cal, "--out", self.out, "--max-tokens", "1", *extra])

    def _snapshot(self):
        return sorted(os.listdir(self.d)), open(self.out, "rb").read()

    def test_fetch_prompt_ids_refuses_a_cache_without_them(self):
        srv = _ForcedServer(llama_shape=True)
        try:
            self.assertEqual(self._fetch(srv), 0)                    # an old-style fetch: no prompt_ids
            before, n = self._snapshot(), len(srv.bodies)
            self.assertEqual(self._status(), 0)
            self.assertEqual(self._status("--prompt-ids"), 2)       # cached, but not with prompt ids
            self.assertNotEqual(self._fetch(srv, "--prompt-ids"), 0)
            self.assertEqual(len(srv.bodies), n)                     # nothing requested
        finally:
            srv.close()
        self.assertEqual(self._snapshot(), before)                   # nothing renamed, moved or rewritten

    def test_fetch_prompt_ids_cache_with_them_is_reused(self):
        srv = _ForcedServer(llama_shape=True)
        try:
            self.assertEqual(self._fetch(srv, "--prompt-ids"), 0)
            n = len(srv.bodies)
            self.assertEqual(self._status("--prompt-ids"), 0)
            self.assertEqual(self._fetch(srv, "--prompt-ids"), 0)
            self.assertEqual(len(srv.bodies), n)
        finally:
            srv.close()
        row = _rows(self.out)[0]
        self.assertEqual((row["prompt_ids"], row["top_ids"]), ([1, 2, 3], [[7, 7]]))

    def test_forced_cache_without_prompt_ids_refused_when_the_reference_has_them(self):
        ref = os.path.join(self.d, "ref.jsonl")
        rb = _ref_block("p1")
        rb["prompt_ids"] = [1, 2, 3]
        with open(ref, "w") as f:
            f.write(json.dumps(rb) + "\n")
        argv = ["forced", "--url", None, "--model", "m", "--calibration", self.cal, "--ref", ref, "--out", self.out]
        st = ["cache-status", "--calibration", self.cal, "--out", self.out, "--forced-ref", ref]
        srv = _ForcedServer()
        try:
            argv[2] = srv.url
            self.assertEqual(_run_main(argv), 0)
            self.assertEqual(_run_main(st), 0)
            rows = _rows(self.out)
            del rows[0]["prompt_ids"]                                # a row fetched before prompt ids were sent
            with open(self.out, "w") as f:
                f.write(json.dumps(rows[0]) + "\n")
            before, n = self._snapshot(), len(srv.bodies)
            self.assertEqual(_run_main(st), 2)
            self.assertNotEqual(_run_main(argv), 0)
            self.assertEqual(len(srv.bodies), n)
        finally:
            srv.close()
        self.assertEqual(self._snapshot(), before)

    def test_tokenizer_check_ids_not_checked_without_reference_prompt_ids(self):
        top = [("a", lp(0.9))]
        ref, arm = _blk_pt("p1", [("a", top)], 3), _blk_pt("p1", [("a", top)], 3)
        arm["prompt_ids"] = [1, 2, 3]
        g = K.tokenizer_check([ref], [arm])
        self.assertEqual(g["verdict"], "ok")                         # the length check, as before
        self.assertEqual(g["ids_verdict"], "not checked (reference has no prompt_ids)")
        ref["prompt_ids"] = [1, 2, 3]
        self.assertEqual(K.tokenizer_check([ref], [arm])["ids_verdict"], "ok")
        arm["prompt_ids"] = [1, 2, 4]
        self.assertEqual(K.tokenizer_check([ref], [arm])["ids_verdict"], "MISMATCH")


class TestRefTokenGuard(unittest.TestCase):
    """Fix round 1, MAJOR 3: each forced arm row records the reference token it was forced on; at score time it
    must equal the reference's token (and id, where both carry one), else the prompt is quarantined."""

    def setUp(self):
        self.ref = [_ref_block("p1", ids=(10, 11)), _ref_block("p2", ids=(20,))]
        self.same = [_forced_block(b["id"], list(b["pos"])) for b in self.ref]

    def test_fetch_forced_records_forced_ids(self):
        srv = _ForcedServer()
        try:
            blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": _ref_block()})[0]
        finally:
            srv.close()
        self.assertEqual(blk["forced_ids"], [10, 11, 12, 13])

    def test_token_mismatch_quarantines_the_prompt(self):
        arm = [dict(b) for b in self.same]
        arm[0]["pos"] = [("r99", arm[0]["pos"][0][1]), arm[0]["pos"][1]]   # forced on another token
        r = K.score_forced(self.ref, arm, "x", "q8")
        self.assertEqual((r["n_prompt_errors"], r["n_positions"]), (1, 1))
        self.assertEqual(r["ref_token_mismatches"], [{"id": "p1", "position": 0, "arm": "r99", "ref": "r10"}])

    def test_id_mismatch_quarantines_the_prompt(self):
        arm = [dict(b) for b in self.same]
        arm[0]["forced_ids"], arm[1]["forced_ids"] = [10, 12], [20]
        r = K.score_forced(self.ref, arm, "x", "q8")
        self.assertEqual((r["n_prompt_errors"], r["n_positions"]), (1, 1))
        self.assertEqual(r["ref_token_mismatches"][0]["position"], 1)
        self.assertEqual(K.score_forced(self.ref, self.same, "x", "q8")["ref_token_mismatches"], [])

    def test_diff_quarantines_a_mismatch_in_either_arm(self):
        b = [dict(x) for x in self.same]
        b[1]["pos"] = [("r21", b[1]["pos"][0][1])]
        r = K.score_forced_diff(self.ref, self.same, b, "a", "b", "q8")
        self.assertEqual((r["n_prompts_used"], r["n_prompt_errors"]), (1, 1))
        self.assertEqual(r["ref_token_mismatches"], [{"id": "p2", "arm_label": "b", "position": 0,
                                                     "arm": "r21", "ref": "r20"}])


class TestEngineDetectionLoud(unittest.TestCase):
    """Fix round 1, MINOR 4: under --engine auto, a /v1/models that errors or does not parse is a loud failure,
    not a silent engine None (which would silently drop vLLM's token ids)."""

    def test_detect_engine_raises(self):
        for models in ("500", "garbage"):
            srv = _ForcedServer(models=models)
            try:
                with self.assertRaises(RuntimeError):
                    K.detect_engine(srv.url)
            finally:
                srv.close()

    def test_no_owned_by_is_none(self):
        srv = _ForcedServer(owned_by=None)
        try:
            self.assertIsNone(K.detect_engine(srv.url))
        finally:
            srv.close()

    def test_auto_undetected_engine_is_said_on_stderr(self):
        import contextlib
        import io
        d = _scratch("engine-undetected")
        cal, ref = os.path.join(d, "cal.jsonl"), os.path.join(d, "ref.jsonl")
        src = os.path.join(d, "p.txt")
        open(src, "w").write("hello world")
        with open(cal, "w") as f:
            f.write(json.dumps({"id": "p1", "src": src, "char_cut": 5}) + "\n")
        with open(ref, "w") as f:
            f.write(json.dumps(_ref_block("p1")) + "\n")
        for owned, warned in ((None, True), ("llamacpp", False)):
            srv = _ForcedServer(owned_by=owned)
            err = io.StringIO()
            try:
                with contextlib.redirect_stderr(err):
                    code = _run_main(["forced", "--url", srv.url, "--model", "m", "--calibration", cal, "--ref", ref,
                                      "--out", os.path.join(d, f"kld-{owned}.jsonl")])
            finally:
                srv.close()
            self.assertEqual(code, 0)
            self.assertEqual("engine undetected: string join, no vLLM id flag" in err.getvalue(), warned, owned)

    def test_forced_cli_auto_refuses_and_pinned_engine_runs(self):
        d = _scratch("engine-loud")
        cal, ref = os.path.join(d, "cal.jsonl"), os.path.join(d, "ref.jsonl")
        src = os.path.join(d, "p.txt")
        open(src, "w").write("hello world")
        with open(cal, "w") as f:
            f.write(json.dumps({"id": "p1", "src": src, "char_cut": 5}) + "\n")
        with open(ref, "w") as f:
            f.write(json.dumps(_ref_block("p1")) + "\n")
        srv = _ForcedServer(models="500")
        try:
            argv = ["forced", "--url", srv.url, "--model", "m", "--calibration", cal, "--ref", ref,
                    "--out", os.path.join(d, "kld-x.jsonl")]
            self.assertNotEqual(_run_main(argv), 0)
            self.assertEqual(srv.completions(), [])
            self.assertEqual(_run_main(argv + ["--engine", "llamacpp"]), 0)
        finally:
            srv.close()


class TestPlaceholderReference(unittest.TestCase):
    """Fix round 1, MINOR 10: a reference whose tokens are vLLM placeholders cannot run the partial-UTF-8 skip
    rule (no text), so forcing on it is refused instead of silently using a different position set."""

    def test_placeholder_reference_refused(self):
        ref = _ref_block()
        ref["pos"] = [(f"token_id:{i}", top) for i, (_t, top) in zip(ref["ids"], ref["pos"])]
        srv = _ForcedServer()
        try:
            blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": ref})[0]
        finally:
            srv.close()
        self.assertIn("placeholder", blk["error"])
        self.assertEqual(srv.completions(), [])

    def test_no_ids_message_names_the_engines(self):
        ref = _ref_block()
        del ref["ids"]
        srv = _ForcedServer()
        try:
            blk = K.fetch_forced(srv.url, "m", [("p1", "hello")], {"p1": ref})[0]
        finally:
            srv.close()
        self.assertIn("no token ids", blk["error"])
        self.assertNotIn("fetch it from a llama.cpp server)", blk["error"])
        # fix round 2: the sources it recommends are the ones fetch_forced accepts (a vLLM reference
        # is refused, so vLLM is named only as NOT usable)
        self.assertIn("llama.cpp", blk["error"])
        self.assertIn("radiance", blk["error"])
        self.assertNotIn("vLLM with --engine vllm", blk["error"])
        self.assertIn("vLLM reference is not supported", blk["error"])



class TestFixRound2Cli(unittest.TestCase):
    """Fix round 2: the ids refusal names what it checks (prompt_ids); score-forced refuses like score-forced-diff."""

    def test_ids_refusal_names_prompt_ids_only(self):
        d = _scratch("ids-refusal-text")
        cal = _calibration(d, 1)
        out = os.path.join(d, "kld-x.jsonl")
        with open(out, "w") as f:
            f.write(json.dumps({"id": "cal-001", "toks": ["a"], "pos": [["a", [["a", -0.1]]]], "error": None}) + "\n")
        json.dump(K.cache_key(cal, None, K.N_MAX, None, None), open(K.key_path(out), "w"))
        code, reason = K.cache_status(out, cal, None, K.N_MAX, prompt_ids=True)
        self.assertEqual(code, 2)
        self.assertIn("prompt_ids", reason)
        self.assertNotIn("top_ids", reason)

    def test_score_forced_cli_refuses_when_nothing_is_scorable(self):
        d = _scratch("score-forced-refused")
        ref = [_ref_block("p1", ids=(10, 11))]
        arm = [_forced_block("p1", [("r99", ref[0]["pos"][0][1]), ref[0]["pos"][1]])]   # every prompt quarantined
        files = {}
        for name, blocks in (("ref", ref), ("arm", arm)):
            files[name] = os.path.join(d, f"{name}.jsonl")
            with open(files[name], "w") as f:
                f.writelines(json.dumps(x) + "\n" for x in blocks)
        out = os.path.join(d, "kldf.json")
        code = _run_main(["score-forced", "--ref", files["ref"], "--arm", files["arm"], "--label", "x",
                          "--ref-label", "q8", "--out", out])
        self.assertEqual(code, 2)
        self.assertFalse(os.path.exists(out))

if __name__ == "__main__":
    unittest.main(verbosity=2)
