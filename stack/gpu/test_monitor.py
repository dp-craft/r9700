#!/usr/bin/env python3
"""Unit tests for monitor.py — the calculation core.

Test data is captured from a live vLLM server (swift-1.5, 2026-10-25):
  - METRICS_RAW: a real /metrics scrape (subset) — exercises parse_prom.
  - METRICS_CURRENT / METRICS_PREV: a snapshot pair for the diffed (per-call) +
    cumulative (session) calculations.
  - LOG_LINES: real loggers.py / metrics.py lines — exercises parse_log / log_throughput /
    log_spec.

Also covers the radiance engine (stilldeadcode/radiance: native, vLLM-compatible metric names, no
prefill-time histogram, request counters tick at FINISH) with a live idle snapshot (RAD_CUR).

Run:  python3 stack/gpu/test_monitor.py -v

Every assertion is a hand-computed expected value (from the captured numbers), so a
regression in any formula fails the suite. No server / GPU is needed.
"""
import calendar
import contextlib
import io
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import types
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monitor  # noqa: E402


# --------------------------------------------------------------------------- fixtures
# Real /metrics scrape (subset) — the exact lines a live swift-1.5 server emitted.
# (Only the metrics the monitor reads; the rest of the scrape is irrelevant.)
METRICS_RAW = """
# HELP vllm:request_prompt_tokens Number of prompt tokens.
# TYPE vllm:request_prompt_tokens histogram
vllm:request_prompt_tokens_sum{engine="0",model_name="swift-1.5"} 7.257022e+06
vllm:request_prompt_tokens_count{engine="0",model_name="swift-1.5"} 76.0
vllm:request_prompt_tokens_created{engine="0",model_name="swift-1.5"} 1.7929241535583959e+09
vllm:request_generation_tokens_sum{engine="0",model_name="swift-1.5"} 77587.0
vllm:request_generation_tokens_count{engine="0",model_name="swift-1.5"} 76.0
vllm:request_prefill_kv_computed_tokens_sum{engine="0",model_name="swift-1.5"} 332302.0
vllm:request_decode_time_seconds_sum{engine="0",model_name="swift-1.5"} 622.7413164660284
vllm:request_decode_time_seconds_count{engine="0",model_name="swift-1.5"} 76.0
vllm:request_prefill_time_seconds_sum{engine="0",model_name="swift-1.5"} 162.62987626999893
vllm:inter_token_latency_seconds_sum{engine="0",model_name="swift-1.5"} 622.7413164660284
vllm:inter_token_latency_seconds_count{engine="0",model_name="swift-1.5"} 15038.0
vllm:request_queue_time_seconds_sum{engine="0",model_name="swift-1.5"} 0.0013048779946984723
vllm:request_queue_time_seconds_count{engine="0",model_name="swift-1.5"} 76.0
vllm:time_to_first_token_seconds_sum{engine="0",model_name="swift-1.5"} 176.24972200393677
vllm:time_to_first_token_seconds_count{engine="0",model_name="swift-1.5"} 76.0
vllm:e2e_request_latency_seconds_sum{engine="0",model_name="swift-1.5"} 798.9756617546082
vllm:e2e_request_latency_seconds_count{engine="0",model_name="swift-1.5"} 76.0
vllm:kv_cache_usage_perc{engine="0",model_name="swift-1.5"} 0.0
vllm:num_requests_running{engine="0",model_name="swift-1.5"} 0.0
vllm:num_requests_waiting{engine="0",model_name="swift-1.5"} 0.0
vllm:prefix_cache_hits_total{engine="0",model_name="swift-1.5"} 6.92472e+06
vllm:prefix_cache_queries_total{engine="0",model_name="swift-1.5"} 7.257022e+06
vllm:prompt_tokens_cached_total{engine="0",model_name="swift-1.5"} 6.92472e+06
vllm:prompt_tokens_total{engine="0",model_name="swift-1.5"} 7.257022e+06
vllm:spec_decode_num_accepted_tokens_total{engine="0",model_name="swift-1.5"} 62649.0
vllm:spec_decode_num_draft_tokens_total{engine="0",model_name="swift-1.5"} 105255.0
"""

# A snapshot pair: METRICS_PREV (70 reqs) -> METRICS_CURRENT (76 reqs).
# Diffing these is the "per-call" window; METRICS_CURRENT alone is the "session".
METRICS_PREV = {
    "vllm:request_prompt_tokens_sum": 6900000.0,
    "vllm:request_prompt_tokens_count": 70.0,
    "vllm:request_generation_tokens_sum": 70000.0,
    "vllm:request_generation_tokens_count": 70.0,
    "vllm:request_prefill_kv_computed_tokens_sum": 315000.0,
    "vllm:request_decode_time_seconds_sum": 590.0,
    "vllm:request_prefill_time_seconds_sum": 155.0,
    "vllm:time_to_first_token_seconds_sum": 165.0,
    "vllm:time_to_first_token_seconds_count": 70.0,
    "vllm:e2e_request_latency_seconds_sum": 740.0,
    "vllm:e2e_request_latency_seconds_count": 70.0,
    "vllm:inter_token_latency_seconds_sum": 590.0,
    "vllm:inter_token_latency_seconds_count": 14000.0,
    "vllm:request_queue_time_seconds_sum": 0.0010,
    "vllm:request_queue_time_seconds_count": 70.0,
    "vllm:kv_cache_usage_perc": 0.12,
    "vllm:num_requests_running": 2.0,
    "vllm:num_requests_waiting": 0.0,
    "vllm:prefix_cache_hits_total": 6600000.0,
    "vllm:prefix_cache_queries_total": 6900000.0,
    "vllm:prompt_tokens_cached_total": 6600000.0,
    "vllm:prompt_tokens_total": 6900000.0,
    "vllm:spec_decode_num_accepted_tokens_total": 58000.0,
    "vllm:spec_decode_num_draft_tokens_total": 96000.0,
}
METRICS_CURRENT = {
    "vllm:request_prompt_tokens_sum": 7257022.0,
    "vllm:request_prompt_tokens_count": 76.0,
    "vllm:request_generation_tokens_sum": 77587.0,
    "vllm:request_generation_tokens_count": 76.0,
    "vllm:request_prefill_kv_computed_tokens_sum": 332302.0,
    "vllm:request_decode_time_seconds_sum": 622.7413164660284,
    "vllm:request_prefill_time_seconds_sum": 162.62987626999893,
    "vllm:time_to_first_token_seconds_sum": 176.24972200393677,
    "vllm:time_to_first_token_seconds_count": 76.0,
    "vllm:e2e_request_latency_seconds_sum": 798.9756617546082,
    "vllm:e2e_request_latency_seconds_count": 76.0,
    "vllm:inter_token_latency_seconds_sum": 622.7413164660284,
    "vllm:inter_token_latency_seconds_count": 15038.0,
    "vllm:request_queue_time_seconds_sum": 0.0013048779946984723,
    "vllm:request_queue_time_seconds_count": 76.0,
    "vllm:kv_cache_usage_perc": 0.12,
    "vllm:num_requests_running": 2.0,
    "vllm:num_requests_waiting": 0.0,
    "vllm:prefix_cache_hits_total": 6924720.0,
    "vllm:prefix_cache_queries_total": 7257022.0,
    "vllm:prompt_tokens_cached_total": 6924720.0,
    "vllm:prompt_tokens_total": 7257022.0,
    "vllm:spec_decode_num_accepted_tokens_total": 62649.0,
    "vllm:spec_decode_num_draft_tokens_total": 105255.0,
}

# Real loggers.py / metrics.py lines (captured).
LOG_LINES = [
    "(APIServer pid=1) INFO 10-25 10:23:26 [metrics.py:120] SpecDecoding metrics: Mean acceptance length: 3.87, Accepted throughput: 12.90 tokens/s, Drafted throughput: 31.50 tokens/s, Accepted: 129 tokens, Drafted: 315 tokens, Per-position acceptance rate: 0.978, 0.711, 0.489, 0.289, 0.222, 0.111, 0.067, Avg Draft acceptance rate: 41.0%",
    "(APIServer pid=1) INFO 10-25 10:23:36 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, Avg generation throughput: 14.6 tokens/s, Running: 0 reqs, Waiting: 0 reqs, GPU KV cache usage: 0.0%, Prefix cache hit rate: 83.1%",
    "(APIServer pid=1) INFO 10-25 10:23:36 [metrics.py:120] SpecDecoding metrics: Mean acceptance length: 5.25, Accepted throughput: 11.90 tokens/s, Drafted throughput: 19.60 tokens/s, Accepted: 119 tokens, Drafted: 196 tokens, Per-position acceptance rate: 0.964, 0.929, 0.679, 0.536, 0.464, 0.357, 0.321, Avg Draft acceptance rate: 60.7%",
    "(APIServer pid=1) INFO 10-25 10:23:46 [loggers.py:335] Engine 000: Avg prompt throughput: 188.4 tokens/s, Avg generation throughput: 43.2 tokens/s, Running: 0 reqs, Waiting: 0 reqs, GPU KV cache usage: 0.0%, Prefix cache hit rate: 85.0%",
    "(APIServer pid=1) INFO 10-25 10:23:46 [metrics.py:120] SpecDecoding metrics: Mean acceptance length: 4.04, Accepted throughput: 32.50 tokens/s, Drafted throughput: 74.90 tokens/s, Accepted: 325 tokens, Drafted: 749 tokens, Per-position acceptance rate: 0.907, 0.729, 0.533, 0.364, 0.224, 0.159, 0.121, Avg Draft acceptance rate: 43.4%",
    "(APIServer pid=1) INFO 10-25 10:23:56 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, Avg generation throughput: 0.0 tokens/s, Running: 0 reqs, Waiting: 0 reqs, GPU KV cache usage: 0.0%, Prefix cache hit rate: 85.0%",
    "(APIServer pid=1) INFO 10-25 10:23:56 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, Avg generation throughput: 0.0 tokens/s, Running: 0 reqs, Waiting: 0 reqs, GPU KV cache usage: 0.0%, Prefix cache hit rate: 85.0%",
    "(APIServer pid=1) INFO 10-25 10:23:57 [some.py:10] irrelevant line that should be ignored",
]


# Live radiance idle snapshot (one consistent scrape). No vllm:request_prefill_time_seconds, no
# vllm:prompt_tokens_cached_total, no spec_decode_*; prefill time = engine_step − engine_step_decode.
RAD_CUR = {
    "vllm:request_prompt_tokens_sum": 39090358.0,
    "vllm:prompt_tokens_total": 39090358.0,
    "vllm:request_generation_tokens_sum": 498375.0,
    "vllm:time_to_first_token_seconds_sum": 200.0,
    "vllm:time_to_first_token_seconds_count": 100.0,
    "vllm:e2e_request_latency_seconds_sum": 900.0,
    "vllm:e2e_request_latency_seconds_count": 100.0,
    "vllm:inter_token_latency_seconds_count": 408.0,
    "vllm:num_requests_running": 0.0,
    "vllm:num_requests_waiting": 0.0,
    "vllm:kv_cache_usage_perc": 0.64,
    "radiance:prefill_tokens_total": 1288374.0,
    "radiance:linear_cached_tokens_total": 37801984.0,
    "radiance:engine_step_seconds_total": 3389.46,
    "radiance:engine_step_seconds_decode_total": 3023.65,
    "radiance:draft_accepted_total": 276630.0,
    "radiance:draft_tokens_total": 664017.0,
    "radiance:decode_tokens_total": 497969.0,
}
# One request earlier: +90358 prompt, +375 out, +374 computed, +2.0 s prefill, +1 request (ttft 3.0, e2e 20.0).
RAD_PREV = dict(RAD_CUR, **{
    "vllm:request_prompt_tokens_sum": 39000000.0,
    "vllm:request_generation_tokens_sum": 498000.0,
    "vllm:time_to_first_token_seconds_sum": 197.0,
    "vllm:time_to_first_token_seconds_count": 99.0,
    "vllm:e2e_request_latency_seconds_sum": 880.0,
    "vllm:e2e_request_latency_seconds_count": 99.0,
    "radiance:prefill_tokens_total": 1288000.0,
    "radiance:engine_step_seconds_total": 3387.46,
})
GPU10 = (1000, 2000, 10, 17.0, 52.0, 60.0, 1900.0, 1600.0, 65.0, 40.0)  # busy_pct = index 8
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip(s):
    return ANSI.sub("", s)


def approx(a, b, tol=1e-6):
    """True if a == b within tol (or both None); b may be None to assert a is None."""
    if b is None:
        return a is None
    if a is None:
        return False
    return abs(a - b) <= tol


# --------------------------------------------------------------------------- helpers
class TestPromParse(unittest.TestCase):
    def test_parse_prom_extracts_names_and_values(self):
        d = monitor.parse_prom(METRICS_RAW)
        self.assertEqual(d["vllm:request_prompt_tokens_sum"], 7257022.0)
        self.assertEqual(d["vllm:request_prompt_tokens_count"], 76.0)
        self.assertEqual(d["vllm:request_generation_tokens_sum"], 77587.0)
        self.assertEqual(d["vllm:time_to_first_token_seconds_sum"], 176.24972200393677)
        self.assertEqual(d["vllm:kv_cache_usage_perc"], 0.0)

    def test_parse_prom_drops_help_and_comment(self):
        d = monitor.parse_prom(METRICS_RAW)
        self.assertNotIn("vllm:request_prompt_tokens", d)  # the HELP name (no _sum)
        self.assertIn("vllm:request_prompt_tokens_sum", d)

    def test_parse_prom_empty_and_none(self):
        self.assertEqual(monitor.parse_prom(None), {})
        self.assertEqual(monitor.parse_prom(""), {})

    def test_parse_prom_sums_label_lines(self):
        # A metric with two label lines SUMS them (multi-engine correctness).
        text = 'm:a{b="1"} 1.0\nm:a{b="2"} 2.0\n'
        self.assertEqual(monitor.parse_prom(text)["m:a"], 3.0)

    def test_parse_prom_gauge_max(self):
        # A gauge (kv_cache_usage_perc) takes max across engines, not sum.
        text = 'vllm:kv_cache_usage_perc{engine="0"} 0.5\nvllm:kv_cache_usage_perc{engine="1"} 0.3\n'
        self.assertEqual(monitor.parse_prom(text)["vllm:kv_cache_usage_perc"], 0.5)


class TestHelpers(unittest.TestCase):
    def test_first(self):
        # _first(m, *names) returns the first present name's value; all args are NAMES
        # (no default value). An absent metric yields None (None-safe downstream).
        m = {"x": 1.0}
        self.assertEqual(monitor._first(m, "x"), 1.0)   # x present
        self.assertIsNone(monitor._first(m, "y"))      # y absent
        self.assertEqual(monitor._first(m, "x", "y"), 1.0)  # first present wins

    def test_diff_normal(self):
        self.assertEqual(monitor._diff({"a": 5.0}, {"a": 2.0}, "a"), 3.0)
        self.assertIsNone(monitor._diff({"a": 5.0}, {}, "a"))   # prev missing
        self.assertIsNone(monitor._diff({}, {"a": 2.0}, "a"))   # current missing

    def test_diff_reset_returns_none(self):
        # Server restart: counter dropped -> must NOT produce a negative delta.
        self.assertIsNone(monitor._diff({"a": 0.0}, {"a": 7.0}, "a"))
        self.assertIsNone(monitor._diff({"a": 3.0}, {"a": 7.0}, "a"))
        self.assertEqual(monitor._diff({"a": 7.0}, {"a": 7.0}, "a"), 0.0)  # equal -> 0

    def test_avg_diff(self):
        m = {"b_sum": 11.0, "b_count": 6.0}
        prev = {"b_sum": 10.0, "b_count": 5.0}
        self.assertEqual(monitor._avg_diff(m, prev, "b"), 1.0)   # (11-10)/(6-5)
        self.assertIsNone(monitor._avg_diff(m, prev, "c"))      # no such histogram
        self.assertIsNone(monitor._avg_diff(m, {"b_sum": 0.0, "b_count": 6.0}, "b"))  # count reset

    def test_avg(self):
        self.assertEqual(monitor._avg({"b_sum": 100.0, "b_count": 4.0}, "b"), 25.0)
        self.assertIsNone(monitor._avg({"b_sum": 100.0, "b_count": 0.0}, "b"))  # no requests
        self.assertIsNone(monitor._avg({}, "b"))

    def test_ratio(self):
        self.assertEqual(monitor._ratio(10.0, 4.0), 2.5)
        self.assertIsNone(monitor._ratio(10.0, 0.0))    # divide by zero
        self.assertIsNone(monitor._ratio(None, 4.0))
        self.assertIsNone(monitor._ratio(10.0, None))
        self.assertIsNone(monitor._ratio(10.0, -1.0))   # negative denominator

    def test_ttft_base(self):
        self.assertEqual(monitor._ttft_base({"vllm:time_to_first_token_seconds_sum": 1.0}),
                         "vllm:time_to_first_token_seconds")  # new vLLM
        self.assertEqual(monitor._ttft_base({"vllm:request_time_to_first_token_seconds_sum": 1.0}),
                         "vllm:request_time_to_first_token_seconds")  # old vLLM
        self.assertIsNone(monitor._ttft_base({}))

    def test_trend(self):
        # _trend: ▲ rising, ▼ falling, – flat, " " (keeps the line from shifting) when either is None.
        self.assertEqual(monitor._trend(1.0, 0.5), "▲")
        self.assertEqual(monitor._trend(0.5, 1.0), "▼")
        self.assertEqual(monitor._trend(1.0, 1.0), "–")
        self.assertEqual(monitor._trend(None, 1.0), " ")
        self.assertEqual(monitor._trend(1.0, None), " ")

    def test_with_unit(self):
        self.assertEqual(monitor._with_unit(12.345, ".1f", "%"), "12.3%")
        self.assertEqual(monitor._with_unit(None, ".1f", "%"), "n/a")

    def test_visible_len(self):
        # _visible_len ignores ANSI escape codes (so colored lines align correctly).
        self.assertEqual(monitor._visible_len("hello"), 5)
        self.assertEqual(monitor._visible_len("\033[31mhello\033[0m"), 5)
        self.assertEqual(monitor._visible_len("a\033[31mb\033[0mc"), 3)


# --------------------------------------------------------------------------- sources
class TestSources(unittest.TestCase):
    def test_computed_tok(self):
        self.assertEqual(monitor._computed_tok(METRICS_CURRENT), 332302.0)   # vllm counter
        self.assertEqual(monitor._computed_tok(RAD_CUR), 1288374.0)          # radiance counter
        both = {"vllm:request_prefill_kv_computed_tokens_sum": 5.0, "radiance:prefill_tokens_total": 9.0}
        self.assertEqual(monitor._computed_tok(both), 5.0)                   # vllm wins
        self.assertIsNone(monitor._computed_tok({}))

    def test_prefill_seconds(self):
        self.assertEqual(monitor._prefill_seconds(METRICS_CURRENT), 162.62987626999893)
        self.assertAlmostEqual(monitor._prefill_seconds(RAD_CUR), 3389.46 - 3023.65, places=6)
        self.assertIsNone(monitor._prefill_seconds({}))
        self.assertIsNone(monitor._prefill_seconds({"radiance:engine_step_seconds_total": 9.0}))
        self.assertIsNone(monitor._prefill_seconds({"radiance:engine_step_seconds_decode_total": 4.0}))

    def test_cached_tok(self):
        self.assertEqual(monitor._cached_tok(METRICS_CURRENT), 6924720.0)
        self.assertEqual(monitor._cached_tok(RAD_CUR), 37801984.0)
        self.assertIsNone(monitor._cached_tok({}))


# --------------------------------------------------------------------------- collect
class TestCollect(unittest.TestCase):
    def _snap(self, prev_t):
        # g=None (no GPU), log_lines=LOG_LINES. prev_t is a past time so the diff runs.
        return monitor.collect(METRICS_CURRENT, METRICS_PREV, prev_t, None, LOG_LINES)

    def _rad(self, cur=RAD_CUR, prev=RAD_PREV):
        return monitor.collect(cur, prev, time.time() - 2, None, [])

    def test_per_call_diff(self):
        per = self._snap(time.time() - 2)["per"]
        # current - prev, hand-computed:
        self.assertEqual(per["in_tok"], 7257022 - 6900000)           # 357022
        self.assertEqual(per["out_tok"], 77587 - 70000)              # 7587
        self.assertEqual(per["computed_tok"], 332302 - 315000)       # 17302
        self.assertEqual(per["n_req"], 76 - 70)                      # 6
        self.assertTrue(approx(per["ttft_s"], (176.24972200393677 - 165.0) / (76 - 70)))
        self.assertTrue(approx(per["e2e_s"], (798.9756617546082 - 740.0) / (76 - 70)))
        self.assertTrue(approx(per["prefill_t"], 162.62987626999893 - 155.0))
        self.assertTrue(approx(per["prefill_tps"], 17302 / (162.62987626999893 - 155.0)))
        self.assertTrue(approx(per["decode_tps"], 7587 / (622.7413164660284 - 590.0)))

    def test_per_call_radiance(self):
        per = self._rad()["per"]
        self.assertEqual(per["in_tok"], 90358)
        self.assertEqual(per["out_tok"], 375)
        self.assertEqual(per["computed_tok"], 374)
        self.assertEqual(per["n_req"], 1)
        self.assertTrue(approx(per["ttft_s"], 3.0))
        self.assertTrue(approx(per["e2e_s"], 20.0))
        self.assertTrue(approx(per["prefill_t"], 2.0, 1e-6))
        self.assertTrue(approx(per["prefill_tps"], 374 / 2.0, 1e-4))

    def test_radiance_prefill_gauge_has_no_effect(self):
        # Regression: comp moved + gauge 0.0 used to raise ZeroDivisionError. Any gauge value is ignored.
        results = []
        for gauge in (0.0, 44.0, 999.0):
            cur = dict(RAD_CUR, **{"radiance:prefill_tokens_per_second": gauge})
            results.append(self._rad(cur)["per"]["prefill_tps"])
        self.assertTrue(all(approx(r, 187.0, 1e-4) for r in results))

    def test_prefill_tps_none_without_prefill_time(self):
        no_step = {k: v for k, v in RAD_CUR.items() if "engine_step" not in k}
        no_step_prev = {k: v for k, v in RAD_PREV.items() if "engine_step" not in k}
        per = self._rad(no_step, no_step_prev)["per"]
        self.assertEqual(per["computed_tok"], 374)
        self.assertIsNone(per["prefill_t"])
        self.assertIsNone(per["prefill_tps"])
        # prefill time flat (0 s) while comp moved -> no rate either
        per = self._rad(RAD_CUR, dict(RAD_PREV, **{"radiance:engine_step_seconds_total": 3389.46}))["per"]
        self.assertEqual(per["prefill_t"], 0)
        self.assertIsNone(per["prefill_tps"])

    def test_comp_zero_with_decode_running_not_widened(self):
        # Prompt grew while decode ran, but the computed counter is flat: comp stays 0, not in_tok.
        prev = {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 300}
        cur = {"vllm:request_prompt_tokens_sum": 350, "radiance:prefill_tokens_total": 300}
        self.assertEqual(self._rad(cur, prev)["per"]["computed_tok"], 0)

    def test_legacy_widens_comp_only_without_counter(self):
        per = self._rad({"vllm:request_prompt_tokens_sum": 300}, {"vllm:request_prompt_tokens_sum": 100})["per"]
        self.assertEqual(per["computed_tok"], 200)
        self.assertIsNone(per["prefill_tps"])

    def test_comp_none_on_counter_reset_or_missing_in_prev(self):
        cur = {"vllm:request_prompt_tokens_sum": 300, "radiance:prefill_tokens_total": 50}
        reset = {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 400}
        self.assertIsNone(self._rad(cur, reset)["per"]["computed_tok"])        # reset: not widened
        absent = {"vllm:request_prompt_tokens_sum": 100}
        self.assertIsNone(self._rad(cur, absent)["per"]["computed_tok"])       # new in cur only

    def test_server_restart_then_normal_poll(self):
        reset = {k: 0.0 for k in RAD_CUR}
        per = self._rad(reset, RAD_CUR)["per"]
        self.assertIsNone(per["in_tok"])
        self.assertIsNone(per["computed_tok"])
        self.assertIsNone(per["prefill_t"])
        nxt = dict(reset, **{"vllm:request_prompt_tokens_sum": 500.0, "radiance:prefill_tokens_total": 100.0,
                             "radiance:engine_step_seconds_total": 12.0,
                             "radiance:engine_step_seconds_decode_total": 8.0})
        per = self._rad(nxt, reset)["per"]
        self.assertEqual(per["in_tok"], 500)
        self.assertEqual(per["computed_tok"], 100)
        self.assertTrue(approx(per["prefill_tps"], 100 / 4.0))

    def test_session_cumulative(self):
        session = self._snap(time.time() - 2)["session"]
        self.assertEqual(session["in_tok"], 7257022.0)
        self.assertEqual(session["out_tok"], 77587.0)
        self.assertEqual(session["n_req"], 76.0)
        self.assertEqual(session["cached_tok"], 6924720.0)
        self.assertEqual(session["comp_tok"], 332302.0)
        self.assertTrue(approx(session["ttft_s"], 176.24972200393677 / 76.0))
        self.assertTrue(approx(session["prefill_tps"], 332302 / 162.62987626999893))
        self.assertTrue(approx(session["decode_tps"], 77587 / 622.7413164660284))
        self.assertTrue(approx(session["e2e_s"], 798.9756617546082 / 76.0))
        self.assertTrue(approx(session["itl_ms"], (622.7413164660284 / 15038.0) * 1000))
        self.assertTrue(approx(session["queue_ms"], (0.0013048779946984723 / 76.0) * 1000))

    def test_session_radiance_correct_from_first_snapshot(self):
        # A monitor started late (prev=None) shows the true lifetime value.
        s = monitor.collect(RAD_CUR, None, None, None, [])["session"]
        self.assertEqual(s["comp_tok"], 1288374.0)
        self.assertEqual(s["cached_tok"], 37801984.0)
        self.assertTrue(approx(s["prefill_tps"], 1288374 / (3389.46 - 3023.65), 1e-4))

    def test_session_sly_mid_request_unchanged(self):
        # A request at first token bumps only the cached/prompt_tokens_total counters (not finished).
        mid = dict(METRICS_CURRENT, **{"vllm:prompt_tokens_cached_total": 6924720.0 + 50000,
                                       "vllm:prompt_tokens_total": 7257022.0 + 60000})
        before = monitor.collect(METRICS_CURRENT, None, None, None, [])["session"]
        after = monitor.collect(mid, None, None, None, [])["session"]
        self.assertEqual(after["comp_tok"], before["comp_tok"])
        self.assertEqual(after["prefill_tps"], before["prefill_tps"])

    def test_session_comp_legacy_fallback(self):
        legacy = {"vllm:prompt_tokens_total": 1000.0, "vllm:prompt_tokens_cached_total": 300.0}
        self.assertEqual(monitor.collect(legacy, None, None, None, [])["session"]["comp_tok"], 700.0)
        self.assertIsNone(monitor.collect({}, None, None, None, [])["session"]["comp_tok"])

    def test_state_gauges(self):
        state = self._snap(time.time() - 2)["state"]
        self.assertEqual(state["kv"], 0.12)
        self.assertTrue(approx(state["kv_pct"], 12.0))
        self.assertTrue(approx(state["prefix_block"], 6924720 / 7257022))
        self.assertTrue(approx(state["prefix_tok"], 6924720 / 7257022))
        self.assertEqual(state["prefix_tok_n"], 6924720.0)
        self.assertTrue(approx(state["spec"], 62649 / 105255))
        self.assertEqual(state["gen_counter"], 15038.0)             # vllm ITL count
        self.assertEqual(state["running"], 2.0)
        self.assertEqual(state["waiting"], 0.0)

    def test_state_radiance_fallbacks(self):
        state = monitor.collect(RAD_CUR, None, None, None, [])["state"]
        self.assertTrue(approx(state["spec"], 276630 / 664017))
        self.assertEqual(state["spec_accepted"], 276630.0)
        self.assertEqual(state["spec_draft"], 664017.0)
        self.assertTrue(approx(state["prefix_tok"], 37801984 / 39090358))
        self.assertEqual(state["prefix_tok_n"], 37801984.0)
        self.assertEqual(state["gen_counter"], 497969.0)             # radiance decode tokens, not ITL count

    def test_state_log_derived(self):
        # log_throughput / log_spec use the LAST matching line:
        state = self._snap(time.time() - 2)["state"]
        self.assertTrue(approx(state["log_prompt_tps"], 0.0))    # last loggers.py @10:23:56
        self.assertTrue(approx(state["log_gen_tps"], 0.0))
        self.assertTrue(approx(state["log_spec_len"], 4.04))     # last metrics.py @10:23:46
        self.assertTrue(approx(state["log_spec_rate"], 43.4))

    def test_first_poll_has_no_per(self):
        # prev=None -> per is empty (no diff on the first sample); session/state still populated.
        snap = monitor.collect(METRICS_CURRENT, None, None, None, LOG_LINES)
        self.assertEqual(snap["per"], {})
        self.assertEqual(snap["session"]["n_req"], 76.0)
        self.assertEqual(snap["state"]["kv_pct"], 12.0)

    def test_per_keys(self):
        self.assertEqual(set(self._snap(time.time() - 2)["per"]),
                         {"in_tok", "out_tok", "computed_tok", "n_req", "ttft_s", "e2e_s",
                          "prefill_t", "decode_t", "prefill_tps", "decode_tps"})

    def test_gpu_passed_through_unchanged(self):
        snap = monitor.collect(RAD_CUR, RAD_PREV, time.time() - 2, GPU10, [])
        self.assertIs(snap["gpu"], GPU10)

    def test_reset_all_diffs_none(self):
        # A full server restart: every counter resets -> all per-call values are None.
        reset = {k: 0.0 for k in METRICS_CURRENT}
        snap = monitor.collect(reset, METRICS_PREV, time.time() - 2, None, LOG_LINES)
        for key in ("in_tok", "out_tok", "n_req", "ttft_s", "e2e_s", "prefill_tps", "decode_tps"):
            self.assertIsNone(snap["per"][key], key)


# --------------------------------------------------------------------------- fold
def _per(**kw):
    base = {"in_tok": 0, "out_tok": 0, "computed_tok": None, "n_req": 0, "ttft_s": None, "e2e_s": None,
            "prefill_t": None, "decode_t": None, "prefill_tps": None, "decode_tps": None}
    base.update(kw)
    return base


class TestFoldRequest(unittest.TestCase):
    def test_radiance_prefill_held_until_finish(self):
        row, pend = monitor._fold_request({}, _per(computed_tok=100, prefill_t=1.0))
        self.assertIsNone(row)
        row, pend = monitor._fold_request(pend, _per(computed_tok=200, prefill_t=3.0))
        self.assertIsNone(row)
        row, pend = monitor._fold_request(pend, _per(in_tok=5000, out_tok=50, computed_tok=50, prefill_t=0.5,
                                                     n_req=1, ttft_s=2.0, e2e_s=9.0))
        self.assertEqual(row["computed_tok"], 350)
        self.assertEqual(row["prefill_t"], 4.5)
        self.assertTrue(approx(row["prefill_tps"], 350 / 4.5))
        self.assertEqual(row["in_tok"], 5000)
        self.assertEqual(row["e2e_s"], 9.0)
        self.assertEqual(pend, {})

    def test_sly_ttft_arrives_polls_before_finish(self):
        row, pend = monitor._fold_request({}, _per(n_req=1, ttft_s=1.5))      # first token
        self.assertIsNone(row)
        row, pend = monitor._fold_request(pend, _per(in_tok=100, out_tok=5, computed_tok=80, prefill_t=2.0))
        self.assertEqual(row["n_req"], 1)
        self.assertEqual(row["ttft_s"], 1.5)
        self.assertEqual(row["prefill_tps"], 40.0)
        self.assertEqual(pend, {})

    def test_ttft_is_weighted_by_n_req(self):
        _, pend = monitor._fold_request({}, _per(n_req=1, ttft_s=1.0))
        row, _ = monitor._fold_request(pend, _per(in_tok=10, n_req=3, ttft_s=2.0))
        self.assertEqual(row["n_req"], 4)
        self.assertEqual(row["ttft_s"], (1.0 * 1 + 2.0 * 3) / 4)

    def test_idle_polls_leave_nothing_behind(self):
        row, pend = monitor._fold_request({}, {})                              # first poll
        self.assertIsNone(row)
        row, pend = monitor._fold_request(pend, _per(computed_tok=0, prefill_t=0.0))   # idle
        self.assertIsNone(row)
        row, _ = monitor._fold_request(pend, _per(in_tok=70, computed_tok=70, prefill_t=2.0, n_req=1, ttft_s=1.0))
        self.assertEqual(row["computed_tok"], 70)
        self.assertEqual(row["prefill_t"], 2.0)
        self.assertEqual(row["prefill_tps"], 35.0)


# --------------------------------------------------------------------------- log
class TestLogParse(unittest.TestCase):
    def test_parse_log_rows(self):
        rows = monitor.parse_log(LOG_LINES)
        # 4 unique timestamps: 10:23:26, 10:23:36, 10:23:46, 10:23:56
        self.assertEqual(len(rows), 4)
        self.assertEqual([r["time"] for r in rows],
                         ["10:23:26", "10:23:36", "10:23:46", "10:23:56"])

    def test_parse_log_merges_loggers_and_metrics(self):
        # 10:23:46 has a loggers.py AND a metrics.py line -> one merged row.
        row = [r for r in monitor.parse_log(LOG_LINES) if r["time"] == "10:23:46"][0]
        self.assertEqual(row["prompt"], 188.4)
        self.assertEqual(row["gen"], 43.2)
        self.assertEqual(row["in"], 1884.0)     # 188.4 * 10
        self.assertEqual(row["out"], 432.0)     # 43.2 * 10
        self.assertEqual(row["run"], 0)
        self.assertEqual(row["wait"], 0)
        self.assertEqual(row["kv"], 0.0)
        self.assertEqual(row["pref"], 85.0)
        self.assertEqual(row["acc"], 4.04)      # from metrics.py
        self.assertEqual(row["accR"], 43.4)

    def test_parse_log_spec_only_row(self):
        # 10:23:26 has only a metrics.py line -> spec fields, no throughput.
        row = [r for r in monitor.parse_log(LOG_LINES) if r["time"] == "10:23:26"][0]
        self.assertEqual(row["acc"], 3.87)
        self.assertEqual(row["accR"], 41.0)
        self.assertNotIn("prompt", row)
        self.assertNotIn("kv", row)

    def test_parse_log_ignores_unrelated_lines(self):
        # The "some.py" line and the duplicate loggers.py must not create new rows.
        rows = monitor.parse_log(LOG_LINES)
        self.assertEqual(len(rows), 4)
        self.assertFalse(any(r["time"] == "10:23:57" for r in rows))

    def test_log_throughput_last_line(self):
        self.assertEqual(monitor.log_throughput(LOG_LINES), (0.0, 0.0))   # last loggers.py
        self.assertEqual(monitor.log_throughput([]), (None, None))

    def test_log_spec_last_line(self):
        self.assertEqual(monitor.log_spec(LOG_LINES), (4.04, 43.4))      # last metrics.py
        self.assertEqual(monitor.log_spec([]), (None, None))

    def test_log_table_shape(self):
        lines = monitor.log_table(LOG_LINES)
        # 1 header + up to 5 rows (we have 4) -> 5 lines.
        self.assertEqual(len(lines), 5)
        self.assertIn("prompt", lines[0])
        self.assertIn("acc", lines[0])


class TestLogStale(unittest.TestCase):
    def test_log_stale(self):
        import os
        import tempfile

        # Missing file -> stale.
        self.assertTrue(monitor.log_stale("/nonexistent/path/to/log.log"))

        # Fresh file -> not stale.
        fd, path = tempfile.mkstemp()
        os.close(fd)
        try:
            self.assertFalse(monitor.log_stale(path, max_age=120.0))
            # A file whose mtime is forced into the past -> stale.
            old = time.time() - 300
            os.utime(path, (old, old))
            self.assertTrue(monitor.log_stale(path, max_age=120.0))
        finally:
            os.unlink(path)


# --------------------------------------------------------------------------- window
class TestWindow(unittest.TestCase):
    def test_window_avg_weighted_by_time(self):
        # prefill TPS weighted by prefill TIME = Σ tokens / Σ time (the exact aggregate),
        # NOT Σ(tps·tokens)/Σ(tokens) which would be skewed toward short bursts.
        window = [
            (100, {"ttft_s": 0.5, "prefill_tps": 100.0, "prefill_t": 10.0, "computed_tok": 1000.0}),
            (102, {"ttft_s": 0.2, "prefill_tps": 500.0, "prefill_t": 1.0, "computed_tok": 500.0}),
            (104, {"ttft_s": None, "prefill_tps": None, "prefill_t": None, "computed_tok": None}),
        ]
        # Σ tokens / Σ time = (1000+500)/(10+1) = 136.36
        self.assertTrue(approx(monitor._window_avg(window, "prefill_tps", "prefill_t"),
                               (1000.0 + 500.0) / (10.0 + 1.0)))
        # TTFT weighted by requests = Σ ttft·n / Σ n = (1.0·1 + 0.2·4)/(1+4) = 0.36
        window2 = [
            (100, {"ttft_s": 1.0, "n_req": 1}),
            (102, {"ttft_s": 0.2, "n_req": 4}),
        ]
        self.assertTrue(approx(monitor._window_avg(window2, "ttft_s", "n_req"),
                               (1.0 * 1 + 0.2 * 4) / (1 + 4)))
        self.assertIsNone(monitor._window_avg(window, "missing", "prefill_t"))
        self.assertIsNone(monitor._window_avg([], "prefill_tps", "prefill_t"))

    def test_window_sum(self):
        # Sum of per[key] over the window (a TOTAL over the window, not a rate):
        # Σ per[key] across all samples. None when no sample has the value (all None)
        # — an idle window shows 'n/a', not a misleading 0.
        window = [
            (100, {"n_req": 6, "computed_tok": 17302, "out_tok": 7587}),
            (102, {"n_req": 2, "computed_tok": 500, "out_tok": 100}),
            (104, {"n_req": None, "computed_tok": None, "out_tok": None}),
        ]
        self.assertEqual(monitor._window_sum(window, "n_req"), 8)
        self.assertEqual(monitor._window_sum(window, "computed_tok"), 17802)
        self.assertEqual(monitor._window_sum(window, "out_tok"), 7687)
        self.assertIsNone(monitor._window_sum([(104, {"n_req": None})], "n_req"))  # all None
        self.assertIsNone(monitor._window_sum([], "n_req"))                        # empty


# --------------------------------------------------------------------------- idle / avg / lines
class TestIdleAndAvg(unittest.TestCase):
    def test_is_server_idle(self):
        self.assertTrue(monitor._is_server_idle({"running": 0, "waiting": 0, "kv": 0.0}))
        self.assertTrue(monitor._is_server_idle({"running": 0, "waiting": 0, "kv": 0.64}))   # retained prefix cache
        self.assertFalse(monitor._is_server_idle({"running": 1, "waiting": 0, "kv": 0.0}))
        self.assertFalse(monitor._is_server_idle({"running": 0, "waiting": 2, "kv": 0.0}))
        self.assertFalse(monitor._is_server_idle({"running": None, "waiting": 0, "kv": 0.0}))

    def test_avg_snapshot(self):
        window = [
            (100, {"ttft_s": 1.0, "n_req": 1, "prefill_tps": 100.0, "prefill_t": 10.0, "computed_tok": 1000,
                   "decode_tps": 50.0, "decode_t": 2.0, "out_tok": 100}),
            (102, {"ttft_s": 0.2, "n_req": 4, "prefill_tps": 500.0, "prefill_t": 1.0, "computed_tok": 500,
                   "decode_tps": 100.0, "decode_t": 2.0, "out_tok": 200}),
        ]
        a = monitor._avg_snapshot(window)
        self.assertTrue(approx(a["ttft"], (1.0 * 1 + 0.2 * 4) / 5))
        self.assertTrue(approx(a["prefill"], 1500 / 11.0))
        self.assertTrue(approx(a["decode"], 300 / 4.0))
        self.assertEqual((a["n_req"], a["comp"], a["out"]), (5, 1500, 300))

    def test_avg_line_same_width_for_none_and_numbers(self):
        nums = {"ttft": 2.32, "prefill": 6553.0, "decode": 199.8, "n_req": 5, "comp": 108696, "out": 1038}
        none = dict.fromkeys(nums)
        line_n = monitor._avg_line(nums, nums)
        line_x = monitor._avg_line(none, none)
        self.assertEqual(monitor._visible_len(line_x), monitor._visible_len(line_n))
        for bad in ("n/a s", "n/a tok"):
            self.assertNotIn(bad, strip(line_x))

    def test_metric_line_bar_column_is_stable(self):
        def bar_col(v):
            return re.search("[█░]", strip(monitor._metric_line("GPU", v, ".0f", 100, 50, 80, "%"))).start()
        self.assertEqual(bar_col(2), bar_col(100))
        self.assertNotIn("n/a%", strip(monitor._metric_line("GPU", None, ".0f", 100, 50, 80, "%")))


# --------------------------------------------------------------------------- render
class TestTables(unittest.TestCase):
    HEADER = ["time", "req", "in", "comp", "out", "TTFT(s)", "prefill(t/s)", "decode(t/s)", "full(s)",
              "KV(%)", "GPU(%)"]

    def _entry(self, per, kv_pct=70.0, g=GPU10):
        return {"ts": time.time(), "per": per, "state": {"kv_pct": kv_pct}, "gpu": g}

    def test_history_rows_header_and_total(self):
        per = _per(in_tok=5000, out_tok=50, computed_tok=350, n_req=1, ttft_s=2.0, e2e_s=12.34,
                   prefill_tps=77.0, decode_tps=31.5)
        rows = monitor._history_rows([self._entry(per)])
        self.assertEqual(rows[0].split(), self.HEADER)
        self.assertIn("12.34", rows[1])
        self.assertNotIn("full_t", rows[0])
        self.assertNotIn("gen_t", rows[0])

    def test_history_rows_aligned_and_unfiltered(self):
        full = _per(in_tok=5000, out_tok=50, computed_tok=350, n_req=1, ttft_s=2.0, e2e_s=12.34,
                    prefill_tps=77.0, decode_tps=31.5)
        empty = _per()   # nothing moved: still shown
        rows = monitor._history_rows([self._entry(full, 95.0), self._entry(empty, 10.0, None)])
        self.assertEqual(len(rows), 3)
        for r in rows[1:]:
            self.assertEqual(monitor._visible_len(r), monitor._visible_len(rows[0]))

    def test_session_rows_shape(self):
        session = {
            "n_req": 123.0, "in_tok": 12613999.0, "cached_tok": 12079760.0,
            "comp_tok": 534239.0, "out_tok": 180298.0, "ttft_s": 2.37,
            "prefill_tps": 1992.0, "decode_tps": 124.7, "itl_ms": 42.0,
            "queue_ms": 0.017, "e2e_s": 14.13,
        }
        for s in (session, dict.fromkeys(session)):
            rows = monitor._session_rows(s)
            self.assertEqual(len(rows), 2)
            self.assertEqual(monitor._visible_len(rows[0]), monitor._visible_len(rows[1]))
        rows = monitor._session_rows(session)
        for col in ("req", "cached", "comp", "gap(ms)", "queue(ms)", "full(s)"):
            self.assertIn(col, rows[0])
        self.assertNotIn("gen_t", rows[0])
        self.assertIn("14.13", rows[1])

    def test_row_jsonl(self):
        snap = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, None, LOG_LINES)
        row = monitor._row(snap)
        self.assertEqual(row["input_tokens"], 357022)
        self.assertEqual(row["output_tokens"], 7587)
        self.assertEqual(row["n_requests"], 6)
        self.assertEqual(row["running"], 2.0)
        self.assertTrue(approx(row["e2e_s"], (798.9756617546082 - 740.0) / 6))          # per-window
        self.assertTrue(approx(row["session_e2e_s"], 798.9756617546082 / 76.0))
        self.assertTrue(approx(row["session_itl_ms"], (622.7413164660284 / 15038.0) * 1000))
        self.assertTrue(approx(row["session_queue_ms"], (0.0013048779946984723 / 76.0) * 1000))
        self.assertNotIn("vram_used_mib", row)    # g=None -> GPU fields omitted
        snap_g = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, GPU10, LOG_LINES)
        row_g = monitor._row(snap_g)
        self.assertEqual(row_g["vram_used_mib"], 1000)
        self.assertEqual(row_g["vram_total_mib"], 2000)
        self.assertEqual(row_g["busy_pct"], 65.0)


# The request behind the reported 986762 t/s row: the poll deltas said 4096 tokens in ~4 ms.
REQ_DONE = ("2026-11-05T07:38:40.123456789Z I req msg_a done from 127.0.0.1:38422 finish=tool_calls "
            "prompt=65906 (cache 63488) gen=4046 reason=3580 ttft=0.68s 198.5 tok/s 21.06s")
REQ_NEXT = ("2026-11-05T07:38:41.000000000Z I req msg_b done from 127.0.0.1:38422 finish=stop "
            "prompt=70000 (cache 70000) gen=5 reason=1 ttft=0.09s 150.0 tok/s 0.12s")
REQ_CHAT = ("2026-11-05T07:38:40.200000000Z I req msg_b chat stream from 127.0.0.1:38422 model=m msgs=8 tools=4 "
            "prompt=70000 tok n=1 max_tokens=64000")


class TestRequestLog(unittest.TestCase):
    def test_parse_real_line(self):
        (rid, ts, per), = monitor.parse_requests(REQ_CHAT + "\nINFO: 172.17.0.1 POST\n" + REQ_DONE)
        self.assertEqual(rid, "msg_a")
        self.assertEqual(time.strftime("%H:%M:%S", time.gmtime(ts)), "07:38:40")
        self.assertEqual((per["in_tok"], per["cached_tok"], per["computed_tok"], per["out_tok"]), (65906, 63488, 2418, 4046))
        self.assertTrue(approx(per["prefill_tps"], 2418 / 0.68))
        self.assertEqual((per["ttft_s"], per["decode_tps"], per["e2e_s"], per["n_req"]), (0.68, 198.5, 21.06, 1))

    def test_nothing_computed_has_no_rate(self):
        (_, _, per), = monitor.parse_requests(REQ_NEXT)
        self.assertEqual(per["computed_tok"], 0)
        self.assertIsNone(per["prefill_tps"])

    def test_streams_sorted_by_time(self):
        self.assertEqual([r[0] for r in monitor.parse_requests(REQ_NEXT + "\n" + REQ_DONE)], ["msg_a", "msg_b"])

    def test_fetch(self):
        done = types.SimpleNamespace(returncode=0, stdout="out\n", stderr="err\n")
        with unittest.mock.patch.object(subprocess, "run", return_value=done) as run:
            self.assertEqual(monitor.fetch_request_log("radiance-8000"), "out\nerr\n")
        self.assertIn("radiance-8000", run.call_args[0][0])
        failed = types.SimpleNamespace(returncode=1, stdout="", stderr="No such container")
        with unittest.mock.patch.object(subprocess, "run", return_value=failed):
            self.assertIsNone(monitor.fetch_request_log("x"))
        for exc in (FileNotFoundError("docker"), subprocess.TimeoutExpired("docker", 3)):
            with unittest.mock.patch.object(subprocess, "run", side_effect=exc):
                self.assertIsNone(monitor.fetch_request_log("x"))

    def _rows(self, text, seen=None, pending=None):
        snap = monitor.collect(RAD_CUR, RAD_PREV, time.time() - 2, None, [])
        with unittest.mock.patch.object(monitor, "fetch_request_log", return_value=text):
            return (snap,) + monitor._finished_rows(snap, pending or {}, seen, "radiance-8000")

    def test_first_read_gives_no_rows(self):
        snap, rows, _, seen = self._rows(REQ_DONE)
        self.assertEqual(rows, [])
        self.assertEqual(seen, {"msg_a"})
        self.assertEqual(snap["requests"], [])

    def test_impossible_poll_delta_never_reaches_a_row(self):
        snap = monitor.collect(RAD_CUR, RAD_PREV, time.time() - 2, None, [])
        snap["per"].update(computed_tok=4096, prefill_t=0.00415, prefill_tps=986762.0)
        with unittest.mock.patch.object(monitor, "fetch_request_log", return_value=REQ_DONE):
            rows, _, _ = monitor._finished_rows(snap, {}, set(), "radiance-8000")
        self.assertEqual(rows[0]["per"]["computed_tok"], 2418)
        self.assertTrue(approx(rows[0]["per"]["prefill_tps"], 2418 / 0.68))

    def test_two_requests_in_one_poll_get_their_own_rows(self):
        snap, rows, _, seen = self._rows(REQ_DONE + "\n" + REQ_NEXT, seen=set())
        self.assertEqual([r["per"]["in_tok"] for r in rows], [65906, 70000])
        self.assertEqual([r["per"]["e2e_s"] for r in rows], [21.06, 0.12])
        self.assertEqual(rows[0]["ts"] + 1, rows[1]["ts"])
        self.assertEqual(len(snap["requests"]), 2)
        self.assertEqual(seen, {"msg_a", "msg_b"})

    def test_request_shown_once(self):
        _, rows, _, seen = self._rows(REQ_DONE, seen={"msg_a"})
        self.assertEqual(rows, [])
        self.assertEqual(seen, {"msg_a"})

    def test_log_failure_keeps_rows_without_prefill(self):
        snap, rows, pending, _ = self._rows(None)
        self.assertTrue(snap["request_log_failed"])
        self.assertEqual(pending, {})
        per = rows[0]["per"]
        self.assertIsNone(per["computed_tok"])
        self.assertIsNone(per["prefill_tps"])
        self.assertEqual(per["e2e_s"], 20.0)

    def test_other_engines_never_call_docker(self):
        snap = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, None, [])
        with unittest.mock.patch.object(monitor, "fetch_request_log", side_effect=AssertionError):
            rows, _, _ = monitor._finished_rows(snap, {}, None, "radiance-8000")
        self.assertTrue(approx(rows[0]["per"]["prefill_tps"], 17302 / (162.62987626999893 - 155.0)))
        self.assertNotIn("requests", snap)

    def test_jsonl(self):
        snap, _, _, _ = self._rows(REQ_DONE, seen=set())
        row = monitor._row(snap)
        self.assertIsNone(row["prefill_tps"])
        self.assertEqual(row["requests"][0]["computed_tok"], 2418)
        json.dumps(row)
        snap, _, _, _ = self._rows(REQ_DONE, seen={"msg_a"})
        self.assertNotIn("requests", monitor._row(snap))
        other = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, None, [])
        self.assertTrue(approx(monitor._row(other)["prefill_tps"], 17302 / (162.62987626999893 - 155.0)))

    def test_log_tail(self):
        text = ("2026-11-05T07:00:03.000000000Z I gbnf: compiled\n"
                "2026-11-05T07:00:01.000000000Z \n"
                "\n"
                "2026-11-05T07:00:02.000000000Z I req msg_a chat stream from 127.0.0.1:1 model=m msgs=8 prompt=5 tok\n"
                "2026-11-05T07:00:04.000000000Z W " + "x" * 300 + "\n")
        tail = monitor.container_log_tail(text)
        local = lambda sec: time.strftime("%H:%M:%S", time.localtime(calendar.timegm((2026, 11, 5, 7, 0, sec))))
        self.assertEqual(tail[0], f"{local(2)} I req msg_a chat stream msgs=8 prompt=5 tok")
        self.assertEqual(tail[1], f"{local(3)} I gbnf: compiled")
        self.assertEqual(len(tail), 3)
        self.assertEqual(len(tail[2]), monitor.LOG_TAIL_WIDTH)
        many = "\n".join(f"2026-11-05T07:00:{i:02d}.000000000Z I line {i}" for i in range(9))
        self.assertTrue(monitor.container_log_tail(many)[-1].endswith("I line 8"))
        self.assertEqual(len(monitor.container_log_tail(many)), 5)
        self.assertEqual(monitor.container_log_tail(""), [])

    def test_finished_rows_sets_the_log_tail(self):
        snap, _, _, _ = self._rows(REQ_DONE, seen=set())
        self.assertIn("I req msg_a done finish=tool_calls", snap["log_tail"][0])
        snap, _, _, _ = self._rows(None)
        self.assertNotIn("log_tail", snap)

    def test_recomputed_is_radiance_only(self):
        cur = dict(RAD_CUR, **{"radiance:prefix_hit_cut_tokens_total": 22256.0})
        self.assertEqual(monitor.collect(cur, None, None, None, [])["state"]["prefix_recomputed"], 22256.0)
        self.assertIsNone(monitor.collect(METRICS_CURRENT, None, None, None, [])["state"]["prefix_recomputed"])

    def test_block_hit_uses_the_radiance_gauge(self):
        cur = dict(RAD_CUR, **{"vllm:gpu_prefix_cache_hit_rate": 0.9})
        self.assertEqual(monitor.collect(cur, None, None, None, [])["state"]["prefix_block"], 0.9)
        both = dict(METRICS_CURRENT, **{"vllm:gpu_prefix_cache_hit_rate": 0.1})
        self.assertTrue(approx(monitor.collect(both, None, None, None, [])["state"]["prefix_block"], 6924720 / 7257022))
        self.assertIsNone(monitor.collect(RAD_CUR, None, None, None, [])["state"]["prefix_block"])


class TestRender(unittest.TestCase):
    def _render(self, g):
        snap = monitor.collect(RAD_CUR, RAD_PREV, time.time() - 2, g, [])
        fold, _ = monitor._fold_request({}, snap["per"])
        history = [{"ts": snap["ts"], "per": fold, "state": snap["state"], "gpu": g}]
        none = dict.fromkeys(("ttft", "prefill", "decode", "n_req", "comp", "out"))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            monitor.render(types.SimpleNamespace(port=8000), snap, history, LOG_LINES, False, none, none)
        return strip(buf.getvalue()).splitlines()

    def test_render_flags_a_failed_request_log(self):
        snap = monitor.collect(RAD_CUR, RAD_PREV, time.time() - 2, None, [])
        snap["request_log_failed"] = True
        none = dict.fromkeys(("ttft", "prefill", "decode", "n_req", "comp", "out"))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            monitor.render(types.SimpleNamespace(port=8000, container="radiance-8000"), snap, [], [], False, none, none)
        self.assertIn("docker logs radiance-8000 failed", strip(buf.getvalue()))

    def _text(self, snap, log_lines=(), stale=False):
        none = dict.fromkeys(("ttft", "prefill", "decode", "n_req", "comp", "out"))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            monitor.render(types.SimpleNamespace(port=8000, container="radiance-8000"), snap, [], list(log_lines), stale, none, none)
        return strip(buf.getvalue())

    def test_render_container_log_block(self):
        snap = monitor.collect(RAD_CUR, RAD_PREV, time.time() - 2, None, [])
        snap["log_tail"] = ["09:00:00 I gbnf: compiled", "09:00:01 " + "x" * (monitor.LOG_TAIL_WIDTH - 9)]
        text = self._text(snap)
        self.assertIn("log  (docker logs radiance-8000)", text)
        self.assertIn("I gbnf: compiled", text)
        self.assertNotIn("log stale", text)
        box = [l for l in text.splitlines() if l and l[0] in "┌│└"]
        self.assertEqual({len(l) for l in box}, {len(box[0])})

    def test_render_vllm_log_block_unchanged(self):
        snap = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, None, LOG_LINES)
        self.assertIn("log  (last 5 entries)", self._text(snap, LOG_LINES))
        self.assertIn("log stale", self._text(snap, LOG_LINES, stale=True))

    def test_render_recomputed_only_when_reported(self):
        cur = dict(RAD_CUR, **{"radiance:prefix_hit_cut_tokens_total": 22256.0, "vllm:num_requests_running": 1.0})
        self.assertIn("recomputed 22.3k tok", self._text(monitor.collect(cur, RAD_PREV, time.time() - 2, None, [])))
        sly = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, None, [])
        self.assertNotIn("recomputed", self._text(sly))

    def test_render_radiance_snapshot(self):
        no_fan = GPU10[:9] + (None,)  # a passive card reports no fan
        for g in (None, GPU10, no_fan):
            with self.subTest(gpu=g):
                lines = self._render(g)
                text = "\n".join(lines)
                for bad in ("n/a%", "n/as", "n/a s", "n/a tok"):
                    self.assertNotIn(bad, text)
                box = [l for l in lines if l and l[0] in "┌│└"]
                self.assertEqual({len(l) for l in box}, {len(box[0])})
                self.assertIn("finished requests", text)
                self.assertNotIn("polls (requests)", text)
                i = next(i for i, l in enumerate(lines) if "elapsed" in l)
                self.assertNotIn("req ", lines[i])
                header = next(l for l in lines if "GPU(%)" in l)
                content_width = lambda line: len(line[3:].rstrip(" │"))  # after the "│  " box prefix
                self.assertEqual(content_width(lines[i + 1]), content_width(header))


class TestEntryPoints(unittest.TestCase):
    def test_default_log_path(self):
        p = monitor._default_log_path(8000)
        self.assertTrue(os.path.isabs(p))
        self.assertTrue(p.endswith(os.path.join("bench", ".servers", "8000.log")))
        cwd = os.getcwd()
        try:
            os.chdir(tempfile.gettempdir())
            self.assertEqual(monitor._default_log_path(8000), p)
        finally:
            os.chdir(cwd)

    def test_ctrl_c_exits_cleanly(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "monitor.py")
        proc = subprocess.Popen([sys.executable, script, "--port", str(port), "--no-gpu", "--interval", "5"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                start_new_session=True)
        try:
            time.sleep(1.5)
            os.killpg(proc.pid, signal.SIGINT)
            _, err = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            self.fail("monitor did not exit on SIGINT")
        self.assertEqual(proc.returncode, 0)
        self.assertNotIn("Traceback", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
