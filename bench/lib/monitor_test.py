#!/usr/bin/env python3
"""Unit tests for bench/lib/monitor.py — focused on the prefill source that differs between the two
vLLM variants this repo runs: sly (ghcr.io/slybase/vllm-sly-radiance, standard per-request prefill
histogram) and radiance (stilldeadcode/radiance, forked vLLM that only emits a windowed
radiance:* scheduler gauge). Run:  python3 -m unittest -v bench/lib/monitor_test

Each test drives collect() with synthetic /metrics-shaped dicts and checks the per-call + session
prefill values AND their provenance label (histogram vs radiance), so the two variants are never
treated as interchangeable.
"""
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monitor  # noqa: E402


def _pre(cur, prev):
    """Run one per-call snapshot; returns its `per` dict. `cur`/`prev` are the two polls."""
    return monitor.collect(cur, prev, time.time() - 1, None, [])["per"]


class TestSlyPrefill(unittest.TestCase):
    """sly keeps the standard vLLM per-request prefill histogram."""

    def setUp(self):
        # prev -> cur : prompt +200, prefilled-kv-computed +200, prefill time +3.0s.
        self.prev = {
            "vllm:request_prompt_tokens_sum": 100,
            "vllm:request_generation_tokens_sum": 0,
            "vllm:request_prefill_time_seconds_sum": 5.0,
            "vllm:request_decode_time_seconds_sum": 2.0,
            "vllm:request_prefill_kv_computed_tokens_sum": 500,
        }
        self.cur = {
            "vllm:request_prompt_tokens_sum": 300,
            "vllm:request_generation_tokens_sum": 20,
            "vllm:request_prefill_time_seconds_sum": 8.0,
            "vllm:request_decode_time_seconds_sum": 3.0,
            "vllm:request_prefill_kv_computed_tokens_sum": 700,
            "vllm:prompt_tokens_cached_total": 120,   # sly exposes prefix-cache metric too
        }

    def test_per_call_prefill_from_histogram(self):
        p = _pre(self.cur, self.prev)
        self.assertEqual(p["prefill_from"], "histogram")
        self.assertAlmostEqual(p["prefill_tps"], 200 / 3.0, places=5)   # computed/Δt = 200/3
        self.assertEqual(p["prefill_w"], 3.0)                           # weight == histogram delta

    def test_session_prefill_from_histogram(self):
        snap = monitor.collect(self.cur, self.prev, time.time() - 1, None, [])
        s = snap["session"]
        self.assertEqual(s["prefill_from"], "histogram")
        self.assertAlmostEqual(s["prefill_tps"], (300 - 120) / 8.0, places=5)   # comp/sum


class TestRadiancePrefill(unittest.TestCase):
    """radiance drops the per-request histogram; only the windowed gauge is present."""

    def setUp(self):
        self.prev = {
            "vllm:request_prompt_tokens_sum": 100,
            "vllm:request_generation_tokens_sum": 0,   # no prefill-time metric at all
        }
        self.cur = {
            "vllm:request_prompt_tokens_sum": 300,
            "vllm:request_generation_tokens_sum": 20,
            "radiance:prefill_tokens_per_second": 44.0,   # the windowed scheduler gauge
            "radiance:prefill_tokens_total": 1000,        # variant marker
        }

    def test_per_call_prefill_from_gauge(self):
        p = _pre(self.cur, self.prev)
        self.assertEqual(p["prefill_from"], "radiance")
        self.assertAlmostEqual(p["prefill_tps"], 44.0, places=5)   # gauge value
        self.assertAlmostEqual(p["prefill_w"], 44.0, places=5)     # weight present (was None before)

    def test_session_prefill_from_gauge_without_cached(self):
        snap = monitor.collect(self.cur, self.prev, time.time() - 1, None, [])
        s = snap["session"]
        self.assertEqual(s["prefill_from"], "radiance")
        self.assertAlmostEqual(s["prefill_tps"], 44.0, places=5)   # no cached/prefix metrics -> still fine


class TestWindowAvg(unittest.TestCase):
    """The 5-min weighted average used by the 'avg' line: weight must survive for radiance."""

    def test_radiance_sample_is_included(self):
        prev = {"vllm:request_prompt_tokens_sum": 100}
        cur = {"vllm:request_prompt_tokens_sum": 300, "radiance:prefill_tokens_per_second": 44.0,
               "radiance:prefill_tokens_total": 1000}
        p = _pre(cur, prev)
        avg = monitor._window_avg([(0.0, p)], "prefill_tps", "prefill_w")
        self.assertAlmostEqual(avg, 44.0, places=5)   # was None/n/a before the fix

    def test_sly_sample_is_included(self):
        prev = {"vllm:request_prompt_tokens_sum": 100, "vllm:request_prefill_time_seconds_sum": 5.0,
                "vllm:request_prefill_kv_computed_tokens_sum": 500}
        cur = {"vllm:request_prompt_tokens_sum": 300, "vllm:request_prefill_time_seconds_sum": 8.0,
               "vllm:request_prefill_kv_computed_tokens_sum": 700}
        p = _pre(cur, prev)
        avg = monitor._window_avg([(0.0, p)], "prefill_tps", "prefill_w")
        self.assertAlmostEqual(avg, 200 / 3.0, places=5)


class TestNeitherPresent(unittest.TestCase):
    """No prefill source at all -> prefill stays n/a (provenance None), not a fake number."""

    def test_prefill_none_when_no_source(self):
        p = _pre({"vllm:request_prompt_tokens_sum": 300}, {})
        self.assertIsNone(p["prefill_tps"])
        self.assertIsNone(p["prefill_from"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
