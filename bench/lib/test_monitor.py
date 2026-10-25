#!/usr/bin/env python3
"""Unit tests for monitor.py — the calculation core.

Test data is captured from a live vLLM server (swift-1.5, 2026-10-25):
  - METRICS_RAW: a real /metrics scrape (subset) — exercises parse_prom.
  - METRICS_CURRENT / METRICS_PREV: a snapshot pair for the diffed (per-call) +
    cumulative (session) calculations.
  - LOG_LINES: real loggers.py / metrics.py lines — exercises parse_log / log_throughput /
    log_spec.

Run:  python3 bench/lib/test_monitor.py -v

Every assertion is a hand-computed expected value (from the captured numbers), so a
regression in any formula fails the suite. No server / GPU is needed.
"""
import os
import sys
import time
import unittest

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
        # (no default value). The `0`/`9` fallbacks are no-op names that never match a
        # string key, so an absent metric yields None (None-safe downstream).
        m = {"x": 1.0}
        self.assertEqual(monitor._first(m, "x", 0), 1.0)   # x present
        self.assertIsNone(monitor._first(m, "y", 9))      # y absent (9 is a no-op name)
        self.assertIsNone(monitor._first(m, "y"))         # y absent

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


# --------------------------------------------------------------------------- collect
class TestCollect(unittest.TestCase):
    def _snap(self, prev_t):
        # g=None (no GPU), log_lines=LOG_LINES. prev_t is a past time so the diff runs.
        return monitor.collect(METRICS_CURRENT, METRICS_PREV, prev_t, None, LOG_LINES)

    def test_per_call_diff(self):
        per = self._snap(time.time() - 2)["per"]
        # current - prev, hand-computed:
        self.assertEqual(per["in_tok"], 7257022 - 6900000)           # 357022
        self.assertEqual(per["out_tok"], 77587 - 70000)              # 7587
        self.assertEqual(per["computed_tok"], 332302 - 315000)       # 17302
        self.assertEqual(per["n_req"], 76 - 70)                      # 6
        self.assertTrue(approx(per["ttft_s"], (176.24972200393677 - 165.0) / (76 - 70)))
        self.assertTrue(approx(per["e2e_s"], (798.9756617546082 - 740.0) / (76 - 70)))
        self.assertTrue(approx(per["prefill_tps"], 17302 / (162.62987626999893 - 155.0)))
        self.assertTrue(approx(per["decode_tps"], 7587 / (622.7413164660284 - 590.0)))

    def test_session_cumulative(self):
        session = self._snap(time.time() - 2)["session"]
        self.assertEqual(session["in_tok"], 7257022.0)
        self.assertEqual(session["out_tok"], 77587.0)
        self.assertEqual(session["n_req"], 76.0)
        self.assertTrue(approx(session["ttft_s"], 176.24972200393677 / 76.0))
        self.assertTrue(approx(session["prefill_tps"], 332302 / 162.62987626999893))
        self.assertTrue(approx(session["decode_tps"], 77587 / 622.7413164660284))
        self.assertTrue(approx(session["e2e_s"], 798.9756617546082 / 76.0))
        self.assertTrue(approx(session["itl_ms"], (622.7413164660284 / 15038.0) * 1000))
        self.assertTrue(approx(session["queue_ms"], (0.0013048779946984723 / 76.0) * 1000))

    def test_state_gauges(self):
        state = self._snap(time.time() - 2)["state"]
        self.assertEqual(state["kv"], 0.12)
        self.assertTrue(approx(state["kv_pct"], 12.0))
        self.assertTrue(approx(state["prefix_block"], 6924720 / 7257022))
        self.assertTrue(approx(state["prefix_tok"], 6924720 / 7257022))
        self.assertTrue(approx(state["spec"], 62649 / 105255))
        self.assertEqual(state["running"], 2.0)
        self.assertEqual(state["waiting"], 0.0)

    def test_state_log_derived(self):
        # log_throughput / log_spec use the LAST matching line:
        state = self._snap(time.time() - 2)["state"]
        self.assertTrue(approx(state["log_prompt_tps"], 0.0))    # last loggers.py @10:23:56
        self.assertTrue(approx(state["log_gen_tps"], 0.0))
        self.assertTrue(approx(state["log_spec_len"], 4.04))     # last metrics.py @10:23:46
        self.assertTrue(approx(state["log_spec_rate"], 43.4))

    def test_first_poll_has_no_per(self):
        # prev=None -> per is empty (no diff on the first sample).
        per = monitor.collect(METRICS_CURRENT, None, None, None, LOG_LINES)["per"]
        self.assertEqual(per, {})
        # session/state still populated from the single snapshot:
        snap = monitor.collect(METRICS_CURRENT, None, None, None, LOG_LINES)
        self.assertEqual(snap["session"]["n_req"], 76.0)
        self.assertEqual(snap["state"]["kv_pct"], 12.0)

    def test_reset_all_diffs_none(self):
        # A full server restart: every counter resets -> all per-call values are None.
        reset = {k: 0.0 for k in METRICS_CURRENT}
        snap = monitor.collect(reset, METRICS_PREV, time.time() - 2, None, LOG_LINES)
        self.assertIsNone(snap["per"]["in_tok"])
        self.assertIsNone(snap["per"]["out_tok"])
        self.assertIsNone(snap["per"]["n_req"])
        self.assertIsNone(snap["per"]["ttft_s"])
        self.assertIsNone(snap["per"]["e2e_s"])
        self.assertIsNone(snap["per"]["prefill_tps"])
        self.assertIsNone(snap["per"]["decode_tps"])

    def test_idle_state_detection(self):
        # The render() idle flag is derived from state; verify the inputs directly.
        idle_m = dict(METRICS_CURRENT)
        idle_m["vllm:kv_cache_usage_perc"] = 0.0
        idle_m["vllm:num_requests_running"] = 0.0
        idle_m["vllm:num_requests_waiting"] = 0.0
        state = monitor.collect(idle_m, None, None, None, LOG_LINES)["state"]
        self.assertEqual(state["kv"], 0.0)
        self.assertEqual(state["running"], 0.0)
        self.assertEqual(state["waiting"], 0.0)


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


# --------------------------------------------------------------------------- render
class TestRender(unittest.TestCase):
    def _snap(self):
        return monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2, None, LOG_LINES)

    def test_history_row_shape(self):
        # A history deque of one snapshot -> a header + 1 row.
        history = [self._snap()]
        rows = monitor._history_rows(history)
        self.assertEqual(len(rows), 2)
        self.assertIn("time", rows[0])
        self.assertIn("in_tok", rows[0])
        self.assertIn("comp", rows[0])     # non-cached input tokens
        self.assertIn("full", rows[0])     # full round-trip time

    def test_idle_cache_block(self):
        # Reproduce render's idle condition: kv==0, running==0, waiting==0 -> single line.
        m = dict(METRICS_CURRENT)
        m["vllm:kv_cache_usage_perc"] = 0.0
        m["vllm:num_requests_running"] = 0.0
        m["vllm:num_requests_waiting"] = 0.0
        snap = monitor.collect(m, None, None, None, LOG_LINES)
        state = snap["state"]
        idle = state.get("kv") is not None and state.get("kv") == 0 \
            and (state.get("running") or 0) == 0 \
            and (state.get("waiting") or 0) == 0
        self.assertTrue(idle)

    def test_session_rows_shape(self):
        session = {
            "n_req": 123.0, "in_tok": 12613999.0, "cached_tok": 12079760.0,
            "comp_tok": 534239.0, "out_tok": 180298.0, "ttft_s": 2.37,
            "prefill_tps": 1992.0, "decode_tps": 124.7, "itl_ms": 42.0,
            "queue_ms": 0.017, "e2e_s": 14.13,
        }
        rows = monitor._session_rows(session)
        self.assertEqual(len(rows), 2)
        self.assertIn("req", rows[0])
        self.assertIn("cached", rows[0])
        self.assertIn("comp", rows[0])
        self.assertIn("gap(ms)", rows[0])
        self.assertIn("full(s)", rows[0])

    def test_row_jsonl(self):
        # The session record must carry the expected keys and values.
        snap = self._snap()
        row = monitor._row(snap)
        self.assertEqual(row["input_tokens"], 357022)
        self.assertEqual(row["output_tokens"], 7587)
        self.assertEqual(row["n_requests"], 6)
        self.assertEqual(row["running"], 2.0)
        self.assertNotIn("vram_used_mib", row)    # g=None -> GPU fields omitted
        # gpu fields present when g is provided:
        snap_g = monitor.collect(METRICS_CURRENT, METRICS_PREV, time.time() - 2,
                                (1000, 2000, 10, 17.0, 52.0, 1900.0, 1600.0, 65.0), LOG_LINES)
        row_g = monitor._row(snap_g)
        self.assertEqual(row_g["vram_used_mib"], 1000)
        self.assertEqual(row_g["vram_total_mib"], 2000)
        self.assertEqual(row_g["busy_pct"], 65.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
