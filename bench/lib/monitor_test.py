#!/usr/bin/env python3
"""Unit tests for bench/lib/monitor.py — the prefill/comp source that differs between the two vLLM
variants this repo runs: sly (ghcr.io/slybase/vllm-sly-radiance) and radiance (stilldeadcode/radiance,
a forked vLLM). The fix resolves each metric from what its engine actually exposes and never fakes one:

  - comp (truly prefilled / uncached tokens): sly uses `request_prefill_kv_computed_tokens_sum`, radiance
    uses `radiance:prefill_tokens_total`. NEITHER widens to full prompt — the "comp" column shows only what
    actually went through compute.
  - prefill t/s = computed prefilled tokens / prefill *time*. sly has a per-request/cumulative prefill-time
    metric -> a real mean. radiance exposes NO prefill-time metric, so it is reconstructed from the engine's
    OWN throughput gauge (t = tokens / rate): the per-window time is `computed / gauge`, the per-row prefill
    then reduces to that gauge (an honest active-window rate), and the server-line mean is comp total / that
    accumulated window time — a true since-start average that stays > 0 once any call prefilled.

  - GPU sample preservation (regression guard). main() hands collect() a normalised GPU tuple via the `g`
    parameter, and collect() must return it unchanged in snap["gpu"]. If a per-window body ever reuses that
    name for another value (the radiance throughput gauge was one such bug — it turned snap["gpu"] into a float
    and crashed render's unpack), this catches it before the monitor crashes live.

Each test drives collect() with synthetic /metrics-shaped dicts and checks the comp + prefill values. Run:  python3 -m unittest -v bench/lib/monitor_test
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


# A 10-tuple matching read_amd()'s shape (used,total,gtt,power,temp,mem_temp,sclk,mclk,busy,fan). main() normalises
# gpu()'s return to a tuple-or-None and hands it to collect() as `g`; the monitor must snap["gpu"] it back unchanged.
GPU_TUPLE = (32059, 32624, 76, 23.0, 58.0, 71.0, 1600, 2400, 88.0, 45.0)


class TestSlyPrefill(unittest.TestCase):
    """sly keeps the standard vLLM per-request prefill histogram + kv-computed counter: both comp and
    prefill t/s are real numbers (no gauge, no fabricated weight). Its behaviour is unchanged."""

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
        self.assertAlmostEqual(p["prefill_tps"], 200 / 3.0, places=5)   # computed/Δt = 200/3
        self.assertEqual(p["prefill_t"], 3.0)                          # real window time from the histogram

    def test_session_prefill_cumulative_average(self):
        snap = monitor.collect(self.cur, self.prev, time.time() - 1, None, [])
        s = snap["session"]
        # Server row = cumulative average since start: whole computed tokens / whole prefill time.
        self.assertAlmostEqual(s["prefill_tps"], (300 - 120) / 8.0, places=5)   # comp/sum = 180/8


class TestRadiancePrefill(unittest.TestCase):
    """radiance has NO per-request/cumulative prefill *time* metric: it is reconstructed from the engine's own
    throughput gauge (t = tokens / rate). `comp` resolves from its computed-prefill counter and must NOT widen to
    full prompt. The per-row prefill reduces to the gauge; the server-line mean is comp total / that accumulated
    window time — > 0 once any call prefilled, never a decaying value."""

    def setUp(self):
        # prompt grows +200 (100->300) but only +250 of *computed* prefill (50->300): comp != full prompt.
        # gauge 44 = instantaneous prefill tok/s over the scheduler's recent window.
        self.prev = {
            "vllm:request_prompt_tokens_sum": 100,
            "radiance:prefill_tokens_total": 50,        # the computed-prefill counter (no per-request time)
        }
        self.cur = {
            "vllm:request_prompt_tokens_sum": 300,
            "radiance:prefill_tokens_total": 300,         # -> comp delta is 250, not the +200 full prompt
            "radiance:prefill_tokens_per_second": 44.0,   # instantaneous prefill tok/s gauge
        }

    def test_fixture_carries_gauge(self):
        # The red test must carry a live nonzero gauge — otherwise it passes even on a buggy fallback impl.
        self.assertGreater(self.cur["radiance:prefill_tokens_per_second"], 0.0)

    def test_comp_is_computed_not_full_prompt(self):
        p = _pre(self.cur, self.prev)
        self.assertEqual(p["computed_tok"], 250)          # radiance:prefill_tokens_total delta
        self.assertNotEqual(p["computed_tok"], 200)       # and it is NOT the full-prompt delta (in_tok)

    def test_per_call_prefill_reduced_to_gauge(self):
        p = _pre(self.cur, self.prev)
        # per-window prefill time reconstructed as tokens / rate; per-row prefill then equals the gauge.
        self.assertAlmostEqual(p["prefill_t"], 250 / 44.0, places=9)   # window seconds
        self.assertAlmostEqual(p["prefill_tps"], 44.0, places=5)      # computed / reconstructed time == gauge
        # no separate instantaneous readout — it is folded into the single prefill column now.
        self.assertNotIn("live_pf", p)

    def test_session_prefill_reconstructed_from_gauge(self):
        # main() accumulates each window's reconstructed time (per["prefill_t"]) and turns comp total / that sum
        # into a true since-start mean; the single helper is what it calls.
        session = {"prefill_tps": None, "comp_tok": 300}
        self.assertIsNone(monitor.session_prefill_from_accum(session, 0.0),
                          "n/a until at least one call with throughput prefilled")
        pf_time_acc = 250 / 44.0    # the one accumulated window's reconstructed prefill time
        self.assertAlmostEqual(monitor.session_prefill_from_accum(session, pf_time_acc),
                               300 * 44.0 / 250.0, places=9)   # 52.8 = comp total / accumulated time

    def test_session_prefill_helper_leaves_sly_value_untouched(self):
        # sly carries its real histogram -> collect() set the mean already; the accumulator must not touch it.
        session = {"prefill_tps": 180 / 8.0, "comp_tok": 180}
        self.assertAlmostEqual(monitor.session_prefill_from_accum(session, 999.0), 180 / 8.0, places=9)


class TestWindowAvg(unittest.TestCase):
    """The 5-min weighted-average 'avg' line weights prefill by TIME (per['prefill_t']). On sly that is the real
    time; on radiance it is the reconstructed window time, so radiance now *participates* in the mean rather than
    being excluded — and it is NOT dragged to ~0 by a decaying gauge."""

    def test_sly_sample_is_included(self):
        prev = {"vllm:request_prompt_tokens_sum": 100, "vllm:request_prefill_time_seconds_sum": 5.0,
                "vllm:request_prefill_kv_computed_tokens_sum": 500}
        cur = {"vllm:request_prompt_tokens_sum": 300, "vllm:request_prefill_time_seconds_sum": 8.0,
               "vllm:request_prefill_kv_computed_tokens_sum": 700}
        p = _pre(cur, prev)
        self.assertAlmostEqual(monitor._window_avg([(0.0, p)], "prefill_tps", "prefill_t"), 200 / 3.0, places=5)

    def test_radiance_sample_is_included(self):
        # radiance now carries a real (reconstructed) time weight, so its gauge-weighted sample counts. A single
        # sample is weighted average == its value; this proves it participates and is NOT ~0 or n/a.
        prev = {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 50}
        cur = {"vllm:request_prompt_tokens_sum": 300, "radiance:prefill_tokens_total": 300,
               "radiance:prefill_tokens_per_second": 44.0}
        p = _pre(cur, prev)
        self.assertAlmostEqual(monitor._window_avg([(0.0, p)], "prefill_tps", "prefill_t"), 44.0, places=5)


class TestNeitherPresent(unittest.TestCase):
    """No prefill metric at all -> prefill t/s stays n/a, not a fake number (the honest fallback for legacy).

    The counter-diff itself is the single source for these deltas: it must never yield a negative (a server that
    restarted between polls would otherwise register as having DELETED tokens)."""

    def test_prefill_none_when_no_source(self):
        p = _pre({"vllm:request_prompt_tokens_sum": 300}, {})
        self.assertIsNone(p["prefill_tps"])

    def test_counter_reset_returns_none(self):
        # Monotonic counters: m < prev means a restart -> the diff is dropped, not shown as a negative.
        self.assertEqual(monitor._diff({"n": 300}, {"n": 100}, "n"), 200)     # normal forward delta
        self.assertIsNone(monitor._diff({"n": 100}, {"n": 200}, "n"))         # reset (m < prev)


class TestCompEdgeCases(unittest.TestCase):
    """The per-window `comp` (truly prefilled / uncached tokens) and the per-row prefill must resolve from the
    engine's real accounting in every corner, never widen to a full prompt, and never fabricate a rate.

      - legacy engine (neither sly nor radiance counter): comp widens to the full-prompt delta (caller's choice),
        prefill stays n/a.
      - radiance whose throughput gauge is absent: comp is still the real uncached delta; only prefill is n/a.
      - the 106-row case: decode running while nothing was computed this window -> comp is exactly 0 (never the
        growing full prompt), prefill is a honest n/a (the guard must not build a rate from an empty compute)."""

    def test_legacy_widens_to_full_prompt_when_no_counters(self):
        p = _pre({"vllm:request_prompt_tokens_sum": 300}, {"vllm:request_prompt_tokens_sum": 100})
        self.assertEqual(p["computed_tok"], 200)       # widens to the full-prompt delta (legacy fallback), not a phantom
        self.assertNotEqual(p["computed_tok"], None)   # and it is a real number, not an absent source

    def test_radiance_gauge_absent_still_reports_real_comp(self):
        p = _pre(
            {"vllm:request_prompt_tokens_sum": 300, "radiance:prefill_tokens_total": 300},   # current poll ...
            {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 50},    # ... previous poll
        )  # no throughput gauge in either snapshot
        self.assertEqual(p["computed_tok"], 250)       # uncached delta is still real and honest
        self.assertIsNone(p["prefill_tps"])            # ...but with no gauge we build no fake prefill rate

    def test_comp_zero_with_decode_running_not_widened(self):
        # Prompt grew +250 this window and decode produced 40 tokens, yet nothing was PREFILLED (counter flat).
        prev = {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 300,
                "vllm:request_generation_tokens_sum": 50}
        cur = {"vllm:request_prompt_tokens_sum": 350, "radiance:prefill_tokens_total": 300,
               "vllm:request_generation_tokens_sum": 90, "radiance:prefill_tokens_per_second": 44.0}
        p = _pre(cur, prev)
        self.assertEqual(p["computed_tok"], 0)                 # comp stays 0 ...
        self.assertNotEqual(p["computed_tok"], 250)            # ... it must NOT widen to the growing full prompt
        self.assertEqual(p["out_tok"], 40)                     # decode ran, so the window was genuinely active
        self.assertIsNone(p["prefill_tps"])                    # no compute this window -> honest n/a, not a gauge readout


class TestSessionComp(unittest.TestCase):
    """The server-line comp is cumulative since start. For radiance (no cache metric) it must come from the engine's
    own computed-prefill counter directly, never from a prompt-minus-cache arithmetic that has no meaning without one."""

    def test_radiance_session_comp_uses_computed_counter_not_promptcache(self):
        m = {"vllm:request_prompt_tokens_sum": 1000, "radiance:prefill_tokens_total": 880}
        snap = monitor.collect(m, None, None, GPU_TUPLE, [])
        self.assertEqual(snap["session"]["comp_tok"], 880)      # the computed-prefill counter ...
        self.assertNotEqual(snap["session"]["comp_tok"], 1000)  # ... is NOT the full prompt total


class TestGpuSamplePreserved(unittest.TestCase):
    """REGRESSION GUARD for the crash that took the monitor live: collect() receives the normalised GPU tuple as the
    `g` parameter and must return it unchanged in snap["gpu"]. If a per-window body reuses that name for the radiance
    throughput gauge, snap["gpu"] becomes a float and render's unpack crashes. cur carries the gauge so the old bug is
    exercised; a successful test proves g survived the window untouched."""

    def test_gpu_sample_survives_collect_despite_radiance_gauge(self):
        prev = {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 50}
        cur = {"vllm:request_prompt_tokens_sum": 300, "radiance:prefill_tokens_total": 300,
               "radiance:prefill_tokens_per_second": 44.0}     # the value that used to clobber g
        snap = monitor.collect(cur, prev, time.time() - 1, GPU_TUPLE, [])
        self.assertEqual(snap["gpu"], GPU_TUPLE)
        self.assertIsInstance(snap["gpu"], tuple)
        self.assertNotEqual(snap["gpu"], 44.0)                  # must not have become the gauge float
        self.assertIsNotNone(snap["gpu"])
        # non-vacuous: the reconstruction still works with g intact, so this isn't a trivial pass.
        self.assertEqual(snap["per"]["computed_tok"], 250)
        self.assertAlmostEqual(snap["per"]["prefill_tps"], 44.0, places=5)


class TestServerLineIntegration(unittest.TestCase):
    """End-to-end the way main()'s accumulation loop produces it: accumulate each window's reconstructed prefill time
    (t = tokens / gauge), then fold comp total / that sum into the server line. The mean is a true cumulative average
    since start — > 0 once any call prefilled, and it must never decay to n/a on later idle polls."""

    def test_server_line_mean_stays_positive_and_cumulative(self):
        prev1 = {"vllm:request_prompt_tokens_sum": 100, "radiance:prefill_tokens_total": 50}
        cur1 = {"vllm:request_prompt_tokens_sum": 300, "radiance:prefill_tokens_total": 300,
                "radiance:prefill_tokens_per_second": 44.0}     # Δcomp +250 -> t = 250/44; cumulative comp 300
        prev2 = dict(cur1)
        cur2 = {"vllm:request_prompt_tokens_sum": 600, "radiance:prefill_tokens_total": 600,
                "radiance:prefill_tokens_per_second": 44.0}     # Δcomp +300 -> t = 300/44; cumulative comp 600

        acc = 0.0
        s1 = monitor.collect(cur1, prev1, time.time() - 1, GPU_TUPLE, [])
        self.assertIsNone(s1["session"]["prefill_tps"], "collect() sets radiance server prefill to n/a")  # main fills it
        if s1["per"].get("prefill_t") is not None:
            acc += s1["per"]["prefill_t"]
        mean1 = monitor.session_prefill_from_accum(s1["session"], acc)

        s2 = monitor.collect(cur2, prev2, time.time() - 1, GPU_TUPLE, [])
        if s2["per"].get("prefill_t") is not None:
            acc += s2["per"]["prefill_t"]
        mean2 = monitor.session_prefill_from_accum(s2["session"], acc)

        self.assertAlmostEqual(mean1, 300 * 44.0 / 250.0, places=9)   # 52.8 = comp300 / (Δcomp250/gauge)
        self.assertAlmostEqual(mean2, 600 * 44.0 / 550.0, places=9)   # 48.0 = comp600 / (Σt)
        self.assertGreater(mean1, 0.0)                                 # stays positive once any call prefilled
        self.assertGreater(mean2, 0.0)                                 # never decays to n/a on a later poll


class TestFullWall(unittest.TestCase):
    """full_t = total request wall-time incl. the prefilled-compute term, and it must be None-safe (a missing window
    term shows n/a, never a fabricated number). gen_t keeps being the server-reported generation latency (ttft+decode)."""

    def test_full_wall_is_ttft_plus_prefill_compute_plus_decode(self):
        per = {"ttft_s": 0.5, "computed_tok": 100, "prefill_tps": 50, "out_tok": 60, "decode_tps": 30}
        # ttft(0.5) + comp/prefill(100/50=2) + out/decode(60/30=2) = 4.5
        self.assertAlmostEqual(monitor._full_wall(per), 0.5 + 100 / 50 + 60 / 30, places=9)

    def test_full_wall_none_when_prefill_tps_absent(self):
        per = {"ttft_s": 0.5, "computed_tok": 100, "out_tok": 60, "decode_tps": 30}  # no prefill t/s
        self.assertIsNone(monitor._full_wall(per))

    def test_full_wall_none_when_decode_absent(self):
        per = {"ttft_s": 0.5, "computed_tok": 100, "prefill_tps": 50}  # no out_tok/decode
        self.assertIsNone(monitor._full_wall(per))


if __name__ == "__main__":
    unittest.main(verbosity=2)

