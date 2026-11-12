#!/usr/bin/env python3
"""Unit tests for boot_diag.py — synthetic text and files only (no GPU, no docker, no server).

Added 2026-11-11 (campaign 2026-11-09-1825-27b-arms-kld, items B/G/H): boot failures left no
retained diagnosis, the WS7 "cold" label was a dir-existence guess, and boots recorded no
measurables. Temp files go under the campaign's gitignored tmp/ (iron rule 19), never /tmp.
Run: python3 bench/perf/test_boot_diag.py -v
"""
import json
import os
import shutil
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import boot_diag as B  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
TMP = os.path.join(REPO, "campaigns", "perf", "2026-11-09-1825-27b-arms-kld", "tmp", "unit-boot-diag")


def scratch(name):
    d = os.path.join(TMP, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    return d


class TestBootTail(unittest.TestCase):
    def test_short_text_kept_whole(self):
        out = B.boot_tail("a\nb\nc", n=300)
        self.assertIn("a\nb\nc", out)

    def test_bounded_to_last_n_plus_matches(self):
        lines = [f"line {i}" for i in range(1000)]
        lines[10] = "torch.OutOfMemoryError: HIP out of memory"
        lines[20] = "Traceback (most recent call last):"
        lines[30] = "plain line, nothing to see"
        out = B.boot_tail("\n".join(lines), n=300)
        self.assertIn("11: torch.OutOfMemoryError", out)      # 1-based line number kept
        self.assertIn("21: Traceback", out)
        self.assertNotIn("plain line, nothing to see", out)
        self.assertIn("line 999", out)
        self.assertIn("line 700", out)
        self.assertNotIn("line 699\n", out)

    def test_pattern_set(self):
        for word in ("error", "Traceback", "OutOfMemory", "OOM", "memory", "fault", "conflict",
                     "refused", "in use", "unsupported", "not support"):
            self.assertTrue(B.DIAG_RE.search(f"xx {word} yy"), word)

    def test_matches_capped(self):
        text = "\n".join(["error %d" % i for i in range(5000)] + ["x"] * 300)
        out = B.boot_tail(text, n=300, max_matches=50)
        self.assertEqual(out.count("\n"), out.count("\n"))  # sanity
        self.assertIn("capped at 50", out)


class TestVramPeak(unittest.TestCase):
    HDR = ("unix_ts,vram_used_mib,vram_total_mib,gtt_used_mib,power_w,temp_c,mem_temp_c,sclk_mhz,"
           "mclk_mhz,gpu_busy_pct,fan_pct\n")

    def test_missing_csv_is_none(self):
        self.assertIsNone(B.vram_peak(os.path.join(TMP, "nope.csv"), 0, 10))

    def test_window_peak(self):
        d = scratch("vram")
        p = os.path.join(d, "g.csv")
        with open(p, "w") as f:
            f.write(self.HDR)
            f.write("100.0,1000,32000,50,,,,,,,\n")
            f.write("101.0,25000,32000,60,,,,,,,\n")
            f.write("102.0,31000,32000,70,,,,,,,\n")     # outside the window below
            f.write("# load_vram_used_mib=1000 peak_vram_used_mib=31000\n")
        self.assertEqual(B.vram_peak(p, 100, 101.5), 25000)
        self.assertEqual(B.vram_peak(p, 0, 1e12), 31000)
        self.assertEqual(B.csv_peak(p, 0, 1e12, "gtt_used_mib"), 70)
        self.assertIsNone(B.vram_peak(p, 200, 300))     # no sample in window

    def test_header_only_is_none(self):
        d = scratch("vram2")
        p = os.path.join(d, "g.csv")
        open(p, "w").write(self.HDR)
        self.assertIsNone(B.vram_peak(p, 0, 1e12))


class TestCacheProbe(unittest.TestCase):
    def test_absent_is_cold(self):
        r = B.cache_probe(os.path.join(TMP, "does-not-exist"))
        self.assertFalse(r["exists"])
        self.assertEqual(r["cache_state"], "cold")

    def test_empty_dirs_are_cold(self):
        d = scratch("cache-empty")
        os.makedirs(os.path.join(d, "root-cache"))       # serve_vllm.sh mkdir -p's the mounts
        r = B.cache_probe(d)
        self.assertTrue(r["exists"])
        self.assertEqual(r["files"], 0)
        self.assertEqual(r["cache_state"], "cold")

    def test_files_are_warm_with_bytes_and_mtime(self):
        d = scratch("cache-warm")
        os.makedirs(os.path.join(d, "triton"))
        p = os.path.join(d, "triton", "k.bin")
        open(p, "wb").write(b"x" * 1234)
        os.utime(p, (1_700_000_000, 1_700_000_000))
        r = B.cache_probe(d)
        self.assertEqual(r["cache_state"], "warm")
        self.assertEqual(r["files"], 1)
        self.assertEqual(r["bytes"], 1234)
        self.assertEqual(r["newest_mtime"], 1_700_000_000)
        self.assertIsNotNone(r["scan_s"])

    def test_budget_exhausted_with_no_file_is_unknown(self):
        d = scratch("cache-budget")
        os.makedirs(os.path.join(d, "a", "b"))
        r = B.cache_probe(d, budget_s=0.0)
        self.assertTrue(r["truncated"])
        self.assertEqual(r["cache_state"], "unknown")


class TestEngineLog(unittest.TestCase):
    V1 = ("(EngineCore_DP0 pid=80) INFO 11-10 12:01:02 [gpu_model_runner.py:2000] Model loading took "
          "17.85 GiB memory and 41.20 seconds\n"
          "(EngineCore_DP0 pid=80) INFO 11-10 12:03:00 [kv_cache_utils.py:1000] GPU KV cache size: "
          "1,234,567 tokens\n"
          "(EngineCore_DP0 pid=80) INFO [gpu_worker.py:300] Available KV cache memory: 9.87 GiB\n"
          "(EngineCore_DP0 pid=80) INFO [kv_cache_utils.py:1004] Maximum concurrency for 260,000 tokens "
          "per request: 4.75x\n"
          "INFO [gpu_model_runner.py:3000] Graph capturing finished in 12 secs, took 0.45 GiB\n"
          "INFO [backends.py:200] torch.compile takes 33.3 s in total\n"
          "INFO [core.py:100] init engine (profile, create kv cache, warmup model) took 98.76 seconds\n")

    def test_vllm_lines(self):
        r = B.parse_engine_log("\x1b[32m" + self.V1)
        self.assertEqual(r["kv_cache_tokens"], 1234567)
        self.assertEqual(r["kv_available_gib"], 9.87)
        self.assertEqual(r["max_concurrency"], 4.75)
        self.assertEqual(r["max_concurrency_tokens_per_request"], 260000)
        self.assertEqual(r["model_load_s"], 41.2)
        self.assertEqual(r["model_load_gib"], 17.85)
        self.assertEqual(r["graph_capture_s"], 12.0)
        self.assertEqual(r["torch_compile_s"], 33.3)
        self.assertEqual(r["init_engine_s"], 98.76)

    def test_absent_lines_are_null_never_invented(self):
        r = B.parse_engine_log("nothing useful here\nup after 55s")
        for k in B.ENGINE_KEYS:
            self.assertIsNone(r[k], k)
        self.assertEqual(r["parsed"], [])


class TestServerTxt(unittest.TestCase):
    def test_vllm_print(self):
        t = ("#   IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1\n"
             "#   SERVED_NAME=qwen38-27b-fp8  MAXLEN=8192  GPU_UTIL=0.95  MAXSEQS=1  KV_DTYPE=fp8  "
             "FREE_MIB_FLOOR=30000MiB\n"
             "# profile=sly-radiance/qwen38-fp8 \n"
             "docker_argv=docker run -d --name vllm-8000 x --max-model-len 8192 --gpu-memory-utilization 0.95\n")
        r = B.parse_server_txt(t)
        self.assertEqual(r["maxlen"], 8192)
        self.assertEqual(r["maxseqs"], 1)
        self.assertEqual(r["gpu_util"], 0.95)
        self.assertEqual(r["kv_dtype"], "fp8")
        self.assertEqual(r["served"], "qwen38-27b-fp8")
        self.assertEqual(r["profile"], "sly-radiance/qwen38-fp8")
        self.assertEqual(r["free_mib_floor"], 30000)
        self.assertIsNone(r["spec_tokens"])

    def test_radiance_print(self):
        t = ("docker run -d --network host --init --name radiance-8000 stilldeadcode/radiance:1.17.0 "
             "--model /models/q.rad --host 127.0.0.1 --port 8000 --tp 1 --max-model-len 260000 "
             "--kv-cache-dtype fp8 --max-num-seqs 2 --served-model-name qwen38-27b-iq4r-l-v4 "
             "--gpu-headroom-mib 596 --num-speculative-tokens 0 \n")
        r = B.parse_server_txt(t)
        self.assertEqual(r["maxlen"], 260000)
        self.assertEqual(r["maxseqs"], 2)
        self.assertEqual(r["kv_dtype"], "fp8")
        self.assertEqual(r["spec_tokens"], 0)
        self.assertEqual(r["served"], "qwen38-27b-iq4r-l-v4")
        self.assertIsNone(r["gpu_util"])

    def test_vllm_speculative_config(self):
        t = (r'docker_argv=docker run x --speculative-config \{\"method\":\ \"dflash\"\,'
             r'\ \"num_speculative_tokens\":\ 7\}' "\n")
        self.assertEqual(B.parse_server_txt(t)["spec_tokens"], 7)


class TestRecord(unittest.TestCase):
    def test_failure_record_line(self):
        d = scratch("record")
        out = os.path.join(d, "boots.jsonl")
        tail = os.path.join(d, "boot-kld-ref-fp8.txt")
        open(tail, "w").write("torch.OutOfMemoryError: HIP out of memory\n")
        srv = os.path.join(d, "server-kld-ref-fp8.txt")
        open(srv, "w").write("#   SERVED_NAME=qwen38-27b-fp8  MAXLEN=8192  GPU_UTIL=0.95  MAXSEQS=1  "
                             "KV_DTYPE=fp8  FREE_MIB_FLOOR=30000MiB\n")
        cj = os.path.join(d, "cache.json")
        json.dump({"cache_state": "warm", "files": 3}, open(cj, "w"))
        rc = B.main(["record", "--out", out, "--name", "kld-ref-fp8", "--arm", "ref", "--kind", "vllm",
                     "--served", "qwen38-27b-fp8", "--image", "img:1", "--image-id", "sha256:abc",
                     "--server-txt", srv, "--t0", "100.5", "--t1", "160.0", "--rc", "1",
                     "--vram-before", "900", "--vram-ready", "", "--vram-csv", os.path.join(d, "none.csv"),
                     "--log", tail, "--cache-json", cj, "--boot-tail", tail])
        self.assertEqual(rc, 0)
        rows = [json.loads(l) for l in open(out)]
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertFalse(r["ok"])
        self.assertEqual(r["start_rc"], 1)
        self.assertEqual(r["boot_seconds"], 59.5)
        self.assertIsNone(r["ready_epoch"])
        self.assertEqual(r["image_id"], "sha256:abc")
        self.assertEqual(r["maxlen"], 8192)
        self.assertEqual(r["gpu_util"], 0.95)
        self.assertEqual(r["cache_state"], "warm")
        self.assertEqual(r["vram_before_mib"], 900)
        self.assertIsNone(r["vram_ready_mib"])
        self.assertIsNone(r["vram_peak_boot_mib"])        # CSV missing -> null
        self.assertEqual(r["boot_tail"], tail)
        self.assertIn("provenance", r)
        # a second attempt appends, never overwrites
        B.main(["record", "--out", out, "--name", "kld-ref-fp8", "--arm", "ref", "--kind", "vllm",
                "--t0", "1", "--t1", "2", "--rc", "0"])
        self.assertEqual(len(open(out).read().splitlines()), 2)

    def test_tail_cli_sections_and_append(self):
        d = scratch("tailcli")
        a = os.path.join(d, "start.txt")
        open(a, "w").write("starting vllm-8000\ncontainer DIED during startup\n")
        out = os.path.join(d, "boot-x.txt")
        B.main(["tail", "--out", out, "--section", f"start output={a}",
                "--section", f"absent={os.path.join(d, 'nope')}", "--meta", "start_rc=1"])
        B.main(["tail", "--out", out, "--section", f"start output={a}", "--meta", "start_rc=1"])
        txt = open(out).read()
        self.assertEqual(txt.count("=== boot attempt"), 2)
        self.assertIn("container DIED during startup", txt)
        self.assertIn("start_rc=1", txt)
        self.assertIn("absent: (no file)", txt)


if __name__ == "__main__":
    unittest.main(verbosity=2)
