#!/usr/bin/env python3
"""Unit tests for report.py's agentic kind (gen_campaign kind agentic run dirs).

Builds two synthetic arms in a temp dir — one vLLM (10 s logger windows, UTC container clock) and one
llama.cpp (llama-swap follower log that REPLAYS an earlier load) — with hand-computed expected values,
so a regression in the window, decode, acceptance or loop-signal formulas fails the suite.

Run:  python3 bench/lib/test_report.py -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import report  # noqa: E402

T0 = "2026-10-31T10:00:00.000Z"


def _msg(mid, ts, out, tools=0, think="", stop="tool_use"):
    content = ([{"type": "thinking", "thinking": think}] if think else []) + \
              [{"type": "tool_use", "name": "Bash", "input": {}}] * tools
    return {"type": "assistant", "timestamp": ts,
            "message": {"id": mid, "stop_reason": stop, "usage": {"output_tokens": out}, "content": content}}


def _arm(root, name, server_txt, log_lines, msgs, stop_ts=None):
    arm = os.path.join(root, "rep1", name)
    os.makedirs(os.path.join(arm, "claude-project"))
    with open(os.path.join(arm, "claude-project", "s.jsonl"), "w") as f:
        f.write(json.dumps({"type": "user", "timestamp": T0}) + "\n")
        for m in msgs:
            f.write(json.dumps(m) + "\n")
    open(os.path.join(arm, "server.txt"), "w").write(server_txt)
    open(os.path.join(arm, "server-container.log"), "w").write("\n".join(log_lines) + "\n")
    if stop_ts:
        open(os.path.join(arm, "stop_when.txt"), "w").write(f"call=0\nts={stop_ts}\n")
    rows = ["unix_ts,vram_used_mib,vram_total_mib,gtt_used_mib,power_w,temp_c,mem_temp_c,sclk_mhz,mclk_mhz,gpu_busy_pct,fan_pct"]
    base = 1793440800  # 2026-10-31T10:00:00Z
    for i, (pw, mc) in enumerate([(100, 875), (200, 875), (150, 1250)]):
        rows.append(f"{base + 10 + i},{30000 + i},32624,{160 + i},{pw},50,60,2200,{mc},90,40")
    rows.append(f"{base + 5000},31999,32624,999,300,50,60,2200,875,90,40")   # after the window: ignored
    rows.append("# load_vram_used_mib=29999 peak_vram_used_mib=31999")
    open(os.path.join(arm, "gpu_samples.csv"), "w").write("\n".join(rows) + "\n")
    return arm


VLLM_LOG = [
    "(APIServer pid=1) INFO 10-31 09:59:50 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, "
    "Avg generation throughput: 99.0 tokens/s, Running: 1 reqs",                    # before the window
    "(APIServer pid=1) INFO 10-31 10:00:10 [loggers.py:335] Engine 000: Avg prompt throughput: 1000.0 tokens/s, "
    "Avg generation throughput: 10.0 tokens/s, Running: 1 reqs",                    # prefill window: not decode
    "(APIServer pid=1) INFO 10-31 10:00:10 [metrics.py:120] SpecDecoding metrics: Accepted: 70 tokens, Drafted: 140 tokens",
    "(APIServer pid=1) INFO 10-31 10:00:20 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, "
    "Avg generation throughput: 50.0 tokens/s, Running: 1 reqs",
    "(APIServer pid=1) INFO 10-31 10:00:30 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, "
    "Avg generation throughput: 70.0 tokens/s, Running: 1 reqs",
    "(APIServer pid=1) INFO 10-31 10:00:30 [metrics.py:120] SpecDecoding metrics: Accepted: 30 tokens, Drafted: 140 tokens",
    "(APIServer pid=1) INFO 10-31 10:00:40 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, "
    "Avg generation throughput: 0.0 tokens/s, Running: 0 reqs",                     # idle
    "(APIServer pid=1) INFO 10-31 10:20:00 [loggers.py:335] Engine 000: Avg prompt throughput: 0.0 tokens/s, "
    "Avg generation throughput: 80.0 tokens/s, Running: 1 reqs",                    # after stop_when + 10 s
]
LLAMA_LOG = [
    "0.1 I slot print_timing: id  0 | task 0 | prompt eval time =  1000.00 ms /  9999 tokens",   # replayed load
    "0.2 I slot print_timing: id  0 | task 0 |        eval time =  1000.00 ms /  9999 tokens",
    "0.3 I llama_server: initializing",
    "0.4 I slot print_timing: id  0 | task 1 | prompt eval time =  2000.00 ms /   800 tokens",
    "0.5 I slot print_timing: id  0 | task 1 |        eval time = 10000.00 ms /   300 tokens",  # 30 tok/s
    "0.6 I slot print_timing: id  0 | task 1 | draft acceptance = 0.5 (  100 accepted /   200 generated), mean len =  2.0",
    "0.7 I slot print_timing: id  0 | task 2 | prompt eval time =  1000.00 ms /   200 tokens",
    "0.8 I slot print_timing: id  0 | task 2 |        eval time = 10000.00 ms /   500 tokens",  # 50 tok/s
    "0.9 I slot print_timing: id  0 | task 3 |        eval time =  1000.00 ms /   100 tokens",  # < 256: not in median
]
LOOPY = "\n".join(["I should check the import order again now."] * 3 + ["Then the tests need a fixture file."])


class Agentic(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.vllm = _arm(self.root, "v-arm", "docker_argv=docker run ... --speculative-config.num_speculative_tokens 7 ...",
                         VLLM_LOG, [_msg("m1", "2026-10-31T10:00:05Z", 1000, 2, "abc"),
                                    _msg("m2", "2026-10-31T10:00:25Z", 20000, 1, LOOPY),
                                    _msg("m3", "2026-10-31T10:30:00Z", 500, 3, "late")],   # after stop: excluded
                         stop_ts="2026-10-31T10:01:00Z")
        other = os.path.join(self.root, "other")
        self.llama = _arm(other, "l-arm", "llama-swap row ...", LLAMA_LOG,
                          [_msg("n1", "2026-10-31T10:00:30Z", 300, 1, "x" * 10, stop="max_tokens")])

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_vllm_arm(self):
        r = report._agentic_arm(self.vllm)
        self.assertEqual(r["engine"], "vllm")
        self.assertEqual(r["stepA_s"], 60)
        self.assertEqual(r["messages"], 2)
        self.assertEqual(r["tool_calls"], 3)
        self.assertEqual(r["thinking_chars"], 3 + len(LOOPY))
        self.assertEqual(r["max_msg_out"], 20000)
        self.assertEqual(r["msgs_gt16k"], 1)
        self.assertEqual(r["longest_think_repeat_pct"], 50.0)       # 2 of 4 lines seen before
        self.assertEqual((r["loop_blocks"], r["loop_out_tokens"]), (0, 0))   # 4 lines: no 40-line window
        self.assertEqual(r["gen_tokens"], 1300)                     # (10 + 50 + 70 + 0) * 10
        self.assertEqual(r["prompt_tokens"], 10000)
        self.assertEqual(r["decode_tok_s"], 60.0)                   # median of the pure-decode windows 50, 70
        self.assertEqual(r["accept_rate"], 0.357)                   # 100 / 280
        self.assertEqual(r["mean_accept_len"], 3.5)                 # 1 + 100 / (280 / 7)
        self.assertEqual(r["power_w_max"], 200.0)
        self.assertEqual(r["mclk_lt1000_pct"], 66.7)
        self.assertEqual(r["vram_load_mib"], 29999)
        self.assertEqual(r["vram_peak_mib"], 30002)
        self.assertEqual(r["gtt_peak_mib"], 162)

    def test_llamacpp_arm_skips_the_replayed_load(self):
        r = report._agentic_arm(self.llama)
        self.assertEqual(r["engine"], "llama.cpp")
        self.assertEqual(r["gen_tokens"], 900)
        self.assertEqual(r["prompt_tokens"], 1000)
        self.assertEqual(r["decode_tok_s"], 40.0)                   # median of 30 and 50 (>= 256 tokens only)
        self.assertEqual(r["accept_rate"], 0.5)
        self.assertEqual(r["at_cap"], 1)
        self.assertEqual(r["stepA_s"], 30)                          # no stop_when: last transcript event

    def test_loop_window_rule(self):
        uniq = ["step %02d: checking the next file in the plan list" % i for i in range(30)]
        loop = "\n\n".join(uniq + ["Let me reconsider whether the eslint config registers it."] * 60)
        # 40-line window, >= 32 repeats: 7 unique lines + the loop line's first (non-repeat) occurrence may precede it
        self.assertEqual(report._loop_onset(loop), loop.find(uniq[23]))
        code = "\n".join(uniq[:10] + ["import { type Screen } from '../ui/screen.js';", "export const a = 1;"] * 5
                         + [u + " again" for u in uniq])
        self.assertIsNone(report._loop_onset(code))                 # repeated imports: not a loop
        arm = _arm(os.path.join(self.root, "loopy"), "x-arm", "llama-swap row ...", LLAMA_LOG,
                   [_msg("k1", "2026-10-31T10:00:30Z", 5000, 1, loop), _msg("k2", "2026-10-31T10:00:40Z", 700, 1, code)])
        r = report._agentic_arm(arm)
        self.assertEqual((r["loop_blocks"], r["loop_out_tokens"]), (1, 5000))

    def test_detect_and_render_with_include(self):
        self.assertEqual(report.detect(self.root), "agentic")
        files, ap = report.render_agentic(self.root, include=[os.path.join(self.root, "other")])
        self.assertEqual(set(files), {"agentic_speed.svg", "agentic_loops.svg"})
        table = [l for l in ap if l.startswith("| ")]
        self.assertTrue(table[0].startswith("| l-arm | llama.cpp |"), "included arms are listed first")
        self.assertTrue(table[1].startswith("| v-arm | vllm |"))


if __name__ == "__main__":
    unittest.main()
