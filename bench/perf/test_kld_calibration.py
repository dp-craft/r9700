#!/usr/bin/env python3
"""Tests for kld_calibration.py: mid-text cuts, the mix, determinism, loader compatibility."""
import json
import os
import random
import shutil
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kld_calibration as C  # noqa: E402
import kld_probe as K  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCRATCH = os.path.join(ROOT, "campaigns/perf/2026-11-09-1825-27b-arms-kld/tmp/unit-kld-calibration")


class TestMidCut(unittest.TestCase):
    def test_cut_is_inside_on_a_line_boundary(self):
        text = "".join(f"line {i} " + "x" * 40 + "\n" for i in range(200))
        for s in range(50):
            cut = C.mid_cut(text, random.Random(s))
            self.assertIsNotNone(cut)
            self.assertEqual(text[cut - 1], "\n")
            self.assertGreaterEqual(cut, 800)
            self.assertGreaterEqual(len(text) - cut, 1000)
            self.assertLessEqual(cut, C.MAX_CHARS)

    def test_short_text_refused(self):
        self.assertIsNone(C.mid_cut("a\n" * 500, random.Random(0)))   # 1000 chars: no room for both sides

    def test_no_newline_before_target_refused(self):
        self.assertIsNone(C.mid_cut("x" * 5000, random.Random(0)))


class TestBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = os.path.join(SCRATCH, "a")
        shutil.rmtree(SCRATCH, ignore_errors=True)
        os.makedirs(cls.out)
        cls.prompts, cls.man = C.build(ROOT, cls.out, "cal-test", seed=0)

    def test_mix_and_count(self):
        kinds = {}
        for m in self.man:
            kinds[m["kind"]] = kinds.get(m["kind"], 0) + 1
        self.assertEqual(kinds, {"code-py": 45, "code-ts": 45, "prose-md": 14, "chat-agentic": 12, "chat-tools": 12})
        self.assertEqual(len({p["id"] for p in self.prompts}), 128)

    def test_cut_prompts_never_whole_files(self):
        for m in self.man:
            if m["kind"].startswith(("code", "prose")):
                self.assertLess(m["char_cut"], len(open(os.path.join(ROOT, m["src"]), encoding="utf-8").read()))

    def test_chat_prompts_end_at_open_assistant_turn(self):
        for m in self.man:
            if m["kind"].startswith("chat"):
                txt = open(os.path.join(ROOT, m["src"]), encoding="utf-8").read()
                self.assertTrue(txt.rstrip().endswith("<|im_start|>assistant\n<think>"), m["src"])
                self.assertEqual(m["char_cut"], len(txt))
                if m["kind"] == "chat-tools":
                    self.assertIn("<tools>", txt)

    def test_first_16_mix_kinds(self):
        self.assertGreaterEqual(len({m["kind"] for m in self.man[:16]}), 3)

    def test_loader_reads_it_and_sha_file_matches(self):
        pfile = os.path.join(self.out, "cal-test-prompts.jsonl")
        loaded = K.load_prompts(pfile, ROOT)
        self.assertEqual(len(loaded), 128)
        self.assertTrue(all(t for _, t in loaded))
        import hashlib
        sha = open(os.path.join(self.out, "cal-test.sha256")).read().split()[0]
        self.assertEqual(sha, hashlib.sha256(open(pfile, "rb").read()).hexdigest())

    def test_deterministic(self):
        out2 = os.path.join(SCRATCH, "b")
        os.makedirs(out2, exist_ok=True)
        _, man2 = C.build(ROOT, out2, "cal-test", seed=0)
        strip = lambda ms: [(m["kind"], m["char_cut"], m["sha256"]) for m in ms]  # noqa: E731
        self.assertEqual(strip(self.man), strip(man2))


if __name__ == "__main__":
    unittest.main()
