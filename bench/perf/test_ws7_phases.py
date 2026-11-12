#!/usr/bin/env python3
"""Unit tests for ws7_phases.py — synthetic logs, no GPU, no files on disk.

Case 1 mirrors the 1.9.1 cold boot (475 s) anchor values from
campaigns/perf/2026-11-09-1825-27b-arms-kld/research/ws7-boot-r2.md section 1, so the
assertions double as documentation of what the parser must extract.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws7_phases as W


def L(iso, msg):
    return f"{iso} stdout=P {msg}"


# Case 1: full cold boot, docker ISO prefix + container-local vLLM clock, r2 values.
# t0=16:43:42 (60222 s), INFO 16:44:49 (+67), engine 16:46:24 (+162 => cli 95 s),
# engine-done 16:51:28 (+466 => engine wall 304 s), up_after 475 => done_to_health 9.
FULL = "\n".join([
    L("2026-10-30T16:43:42.100000000Z", "16:43:42 [entrypoint] container start, bwtest running"),
    L("2026-10-30T16:44:09.100000000Z", "16:44:09 [aiter] finish build [module_aiter_core], cost 27.4s"),
    L("2026-10-30T16:44:49.100000000Z", "INFO 10-30 16:44:49 [api_server.py:101] INFO Starting vLLM API server"),
    L("2026-10-30T16:46:24.100000000Z", "INFO 10-30 16:46:24 [llm_engine.py:233] Initializing a V1 LLM engine (v0.32.0)"),
    L("2026-10-30T16:47:10.100000000Z", "INFO 10-30 16:47:10 [mm.py:88] Multi-modal warmup completed in 18.263s"),
    L("2026-10-30T16:47:52.100000000Z", "INFO 10-30 16:47:52 [llm_engine.py:410] Model loading took 18.47 GiB memory and 42.59 seconds"),
    L("2026-10-30T16:47:55.100000000Z", "INFO 10-30 16:47:55 [llm_engine.py:410] Model loading took 1.19 GiB memory and 2.90 seconds"),
    L("2026-10-30T16:48:40.100000000Z", "INFO 10-30 16:48:40 [backends.py:512] Dynamo bytecode transform time: 12.15 s"),
    L("2026-10-30T16:49:15.100000000Z", "INFO 10-30 16:49:15 [backends.py:560] Compiling a graph for compile range (1, 4096) takes 30.79 s"),
    L("2026-10-30T16:49:16.100000000Z", "INFO 10-30 16:49:16 [backends.py:601] torch.compile took 50.92 s in total"),
    L("2026-10-30T16:49:17.100000000Z", "INFO 10-30 16:49:17 [aot.py:77] saved AOT compiled function to /root/.cache/vllm/torch_aot_compile/2ecc9d86c2/rank_0_0/model"),
    L("2026-10-30T16:50:40.100000000Z", "INFO 10-30 16:50:40 [llm_engine.py:520] Initial profiling/warmup run took 76.50 s"),
    L("2026-10-30T16:50:50.100000000Z", "INFO 10-30 16:50:50 [backends.py:601] torch.compile took 30.39 s in total"),
    L("2026-10-30T16:50:54.100000000Z", "INFO 10-30 16:50:54 [dflash.py:44] dflash_head warmup run took 3.09 s"),
    L("2026-10-30T16:50:56.100000000Z", "INFO 10-30 16:50:56 [backends.py:601] torch.compile took 1.52 s in total"),
    L("2026-10-30T16:51:02.100000000Z", "INFO 10-30 16:51:02 [gpu_worker.py:310] Graph capturing finished in 5 secs, took 0.29 GiB"),
    L("2026-10-30T16:51:25.100000000Z", "INFO 10-30 16:51:25 [jit_monitor.py:55] JIT kernel warmup (72 compile keys) finished in 55.98s"),
    L("2026-10-30T16:51:28.100000000Z", "INFO 10-30 16:51:28 [gpu_worker.py:310] Graph capturing finished in 3 secs, took 0.28 GiB"),
    L("2026-10-30T16:51:28.500000000Z", "INFO 10-30 16:51:28 [llm_engine.py:601] init engine (profile, create kv cache, warmup model) took 248.11 s (compilation: 82.82 s)"),
    L("2026-10-30T16:51:31.100000000Z", "INFO 10-30 16:51:31 [api_server.py:201] /health 200"),
    L("2026-10-30T16:52:01.100000000Z", "INFO 10-30 16:52:01 [jit_monitor.py:71] Triton kernel JIT compilation during inference: _radiance_w4a16_splitk_kernel"),
    L("2026-10-30T16:52:02.100000000Z", "INFO 10-30 16:52:02 [jit_monitor.py:71] Triton kernel JIT compilation during inference: _prepare_dflash_inputs_kernel"),
    L("2026-10-30T16:52:03.100000000Z", "INFO 10-30 16:52:03 [jit_monitor.py:71] Triton kernel JIT compilation during inference: _triton_w4a16_skinny_fmt_kernel"),
])


def test_full_cold_boot():
    out = W.parse(FULL, 475)
    sr, ch = out["self_reported_s"], out["chain_s"]
    assert sr["aiter_build_s"] == 27.4
    assert sr["mm_warmup_s"] == 18.26
    assert sr["weight_gib"] == [18.47, 1.19]
    assert sr["weight_load_s"] == 45.49                      # 42.59 + 2.90 (main + draft)
    assert sr["torch_compile_modules_s"] == [50.92, 30.39, 1.52]
    assert sr["compilation_s"] == 82.82                      # from the init-engine line
    assert sr["compilation_module_sum_s"] == 82.83           # cross-check vs module sum
    assert sr["profiling_warmup_s"] == 79.59                 # 76.50 + 3.09
    assert sr["jit_kernel_warmup_s"] == 55.98 and sr["jit_keys"] == 72
    assert sr["graph_capture_s"] == 8.0                      # 5 + 3 (two rounds)
    assert sr["engine_init_total_s"] == 248.11
    assert ch["entrypoint_to_cli_s"] == 67.0                 # 16:43:42 -> 16:44:49
    assert ch["cli_to_engine_s"] == 95.0
    assert ch["engine_to_done_s"] == 304.0
    assert ch["done_to_health_s"] == 9.0
    assert ch["chain_sum_s"] == 475.0 and ch["unaccounted_s"] == 0.0
    assert out["cacheable_per_r2_s"] == 218.39               # 82.82 + 79.59 + 55.98 (r2 sec 2 mapping)
    assert out["jit_monitor_warnings"] == 3 and out["memory_fault"] == 0
    assert len(out["aot_paths"]) == 1
    assert out["missing"] == []
    assert out["t0"].startswith("16:43:42")


# Case 2: sly 1.11.0 dflash boot — real log shape from
# campaigns/perf/2026-11-09-1825-27b-arms-kld tmp/runs/short-20261110-121812 (2026-11-10):
#  - vLLM banner/timer lines are process-prefixed: (APIServer pid=1) / (EngineCore pid=339)
#  - aiter build lines carry a [pid=.. pname=..] tag + ANSI color codes
#  - uvicorn lines ("Application startup complete.", "GET /health ...") have NO in-message
#    clock -> the docker ISO prefix (UTC, same instant) must serve as the fallback clock
#  - the "JIT kernel warmup" line no longer exists in 1.11.0 (null + missing, not a crash)
V110 = "\n".join([
    L("2026-11-10T11:52:05.100000000Z",
      "\x1b[1;38;5;39m┌─[ RADIANCE · GPU TOPOLOGY & BANDWIDTH (rocm-bandwidth-test) ]──\x1b[0m"),
    L("2026-11-10T11:52:05.300000000Z", "RocmBandwidthTest Version: 2.6.0"),
    L("2026-11-10T11:52:40.000000000Z",
      "[aiter] [pid=1 pname=MainProcess] start build [module_aiter_core] under /opt/vllm/lib/python3.12/site-packages/aiter/jit/build/module_aiter_core"),
    L("2026-11-10T11:53:08.600000000Z",
      "[aiter] [pid=1 pname=MainProcess] \x1b[32mfinish build [module_aiter_core], cost 28.6s \x1b[0m"),
    L("2026-11-10T11:53:28.000000000Z",
      "(APIServer pid=1) INFO 11-10 11:53:28 [api_utils.py:347]  ▄▄ ▄█ version 0.32.0"),
    L("2026-11-10T11:54:01.000000000Z",
      "(APIServer pid=1) INFO 11-10 11:54:01 [base.py:280] Multi-modal warmup completed in 18.537s"),
    L("2026-11-10T11:54:09.000000000Z",
      "(EngineCore pid=339) INFO 11-10 11:54:09 [core.py:133] Initializing a V1 LLM engine (v0.32.0) with config: model='/model'"),
    L("2026-11-10T11:55:10.000000000Z",
      "(EngineCore pid=339) INFO 11-10 11:55:10 [model_runner.py:433] Model loading took 14.83 GiB memory and 59.457149 seconds"),
    L("2026-11-10T11:55:12.000000000Z",
      "(EngineCore pid=339) INFO 11-10 11:55:12 [monitor.py:62] [backbone] torch.compile took 0.82 s in total"),
    L("2026-11-10T11:55:14.000000000Z",
      "(EngineCore pid=339) INFO 11-10 11:55:14 [monitor.py:91] [backbone] Initial profiling/warmup run took 2.36 s"),
    L("2026-11-10T11:55:18.000000000Z",
      "(EngineCore pid=339) INFO 11-10 11:55:18 [model_runner.py:1136] Graph capturing finished in 1 secs, took 0.32 GiB"),
    L("2026-11-10T11:55:22.000000000Z",
      "(EngineCore pid=339) INFO 11-10 11:55:22 [core.py:395] init engine (profile, create kv cache, warmup model) took 12.52 s (compilation: 0.97 s)"),
    # uvicorn lines: no in-message HH:MM:SS -> ISO-prefix fallback clock
    L("2026-11-10T11:55:52.000000000Z", "INFO:     Application startup complete."),
    L("2026-11-10T11:55:52.100000000Z",
      'INFO:     172.17.0.1:39918 - "GET /health HTTP/1.1" 200 OK'),
])


def test_v110_dflash_boot():
    out = W.parse(V110, 206)
    sr, ch = out["self_reported_s"], out["chain_s"]
    assert out["t0"].startswith("11:52:05")          # first ISO line (bandwidth banner)
    assert sr["aiter_build_s"] == 28.6               # prefix + ANSI-tolerant
    assert sr["mm_warmup_s"] == 18.54
    assert sr["weight_gib"] == [14.83]
    assert sr["weight_load_s"] == 59.46
    assert sr["torch_compile_modules_s"] == [0.82]
    assert sr["compilation_s"] == 0.97               # from the init-engine line
    assert sr["profiling_warmup_s"] == 2.36
    assert sr["graph_capture_s"] == 1.0
    assert sr["engine_init_total_s"] == 12.52
    assert sr["jit_kernel_warmup_s"] is None         # marker gone in 1.11.0
    assert ch["entrypoint_to_cli_s"] == 83.0         # 11:52:05 -> 11:53:28 (banner)
    assert ch["cli_to_engine_s"] == 41.0
    assert ch["engine_to_done_s"] == 73.0
    assert ch["done_to_health_s"] == 9.0             # 206 - 197
    assert ch["chain_sum_s"] == 206.0 and ch["unaccounted_s"] == 0.0
    assert out["cacheable_per_r2_s"] is None         # no JIT marker -> not computable
    assert out["missing"] == ["jit_kernel_warmup_s"]
    assert out["jit_monitor_warnings"] == 0 and out["memory_fault"] == 0


def test_ansi_stripped_from_paths():
    # ANSI codes must not leak into extracted values (AOT paths, timers).
    log = "\n".join([
        "INFO 11-10 09:00:01 [api_server.py:101] INFO Starting vLLM API server",
        "INFO 11-10 09:01:00 [aot.py:77] saved AOT compiled function to \x1b[32m/root/.cache/vllm/model\x1b[0m",
    ])
    out = W.parse(log, 100)
    assert out["aot_paths"] == ["/root/.cache/vllm/model"]


def test_container_local_only():
    # No docker prefix: parser falls back to the container-local clock.
    log = "\n".join([
        "INFO 10-30 09:00:01 [api_server.py:101] INFO Starting vLLM API server",
        "INFO 10-30 09:00:30 [llm_engine.py:233] Initializing a V1 LLM engine",
        "INFO 10-30 09:02:00 [llm_engine.py:601] init engine (profile, create kv cache, warmup model) took 60.00 s (compilation: 10.00 s)",
    ])
    out = W.parse(log, 130)
    assert out["chain_s"]["entrypoint_to_cli_s"] == 0.0      # INFO is the first timed line
    assert out["chain_s"]["cli_to_engine_s"] == 29.0
    assert out["chain_s"]["engine_to_done_s"] == 90.0
    assert out["chain_s"]["done_to_health_s"] == 11.0        # 130 - 119
    assert out["chain_s"]["chain_sum_s"] == 130.0
    assert out["self_reported_s"]["engine_init_total_s"] == 60.0
    assert "aiter_build_s" in out["missing"]                  # marker absent, not a crash


def test_truncated_log():
    # Log cut after weight load: markers missing -> null + `missing`, no crash.
    log = FULL.split("\n")[:7]
    out = W.parse("\n".join(log), 475)
    assert out["self_reported_s"]["weight_load_s"] == 45.49
    assert "engine_init_total_s" in out["missing"]
    assert "compilation_s" in out["missing"]
    assert out["self_reported_s"]["engine_init_total_s"] is None
    assert out["cacheable_per_r2_s"] is None
    assert out["chain_s"]["done_to_health_s"] is None         # no engine-done anchor


def test_no_timestamps():
    out = W.parse("some line\nanother line\n", 100)
    assert out["missing"] == ["no parseable timestamps in log"]
    assert out["t0"] is None


def test_main_empty_file():
    with tempfile.NamedTemporaryFile("w", suffix=".log", delete=False) as f:
        f.write("")
        path = f.name
    rc = W.main(["--log", path, "--up-after-s", "10", "--cache", "cold",
                 "--out", path + ".json"])
    assert rc == 1
    os.unlink(path)


def main():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok {fn.__name__}")
    print(f"ws7_phases tests: {len(fns)} OK")


if __name__ == "__main__":
    main()
