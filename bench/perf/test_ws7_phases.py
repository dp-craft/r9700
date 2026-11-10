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
