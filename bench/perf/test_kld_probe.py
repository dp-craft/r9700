#!/usr/bin/env python3
"""Unit tests for kld_probe.py's math core — synthetic fixtures only, no server.

Method locked by the WS3 research (research/ws3-kld-r1.md / r2.md): paired greedy
continuation, KL(ref‖arm) per sly kv4/kl_compare.py (reference top-20 support, floor for
missing tokens, one lumped tail bucket, ε=1e-9, clamp at 0), cluster bootstrap CI
(block = prompt). Run: python3 bench/perf/test_kld_probe.py -v
"""
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
