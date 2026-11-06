<!-- meta
date: 2026-10-22 14:30
slug: vllm-sly-mxfp4-depth
title: Sly radiance 1.6.0 (vLLM docker) · Qwen3.8-27B AMD MXFP4 · fp8 KV — depth curve + growing conversation
takeaway: SlyBase/vllm-sly-radiance **1.6.0** (docker, vLLM 0.31.0) serving **amd/Qwen3.8-27B-Quark-AWQ-MXFP4** on one R9700, fp8 KV, ctx 150000, **no speculative decoding** (MEASURED): **prefill 2,845 → 1,500 tok/s** (8k → 136k, k −0.21) — ~2.3–3.2× the repo's earlier llama.cpp/radiance-0.9.3 prefill on the same fixtures — but **decode only 33.8 → 17.9 tok/s** (k −0.23), below llama.cpp+MTP; the drafter is the missing piece. Growing 9-turn conversation to 131k: prefix cache live (turn-8 TTFT 15.1 s vs 90.2 s cold). Power sits at the 210 W cap in both phases (no config suspect). **Reliability: 1 GPU memory fault in 27 requests** (`radiance_mxfp4_fp8_gemm_atiled`, prefill at ~131k) killed the engine after a 6.5-min hang — not reported upstream. Setup lessons: NVFP4 load peak crashed the desktop (→ boot watchdog), containerd image store ignores docker `data-root`, vLLM 0.31 streams `delta.reasoning`.
-->

# Benchmark: Sly radiance vLLM · Qwen3.8-27B MXFP4 · fp8 KV — R9700 (gfx1201)

- **Date:** 2026-10-22 13:37–14:00 local · **Track:** engine-bench campaign (`gen_campaign.py`, new `engine: vllm`)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB, power cap **210 W** (card minimum; `POWER_SAVING` profile, −100 mV, −21 MHz offset — user tuning, left as is) · Ryzen 5 3600, 31 GB RAM · kernel 7.0.0-38
- **Runtime:** `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` @ `sha256:bf153fa38868…7506` (reports **vLLM 0.31.0**, `RADIANCE_VERSION=1.6.0`, ROCm 10.1 in-image) · launcher `stack/serve/vllm/serve_vllm.sh`, profile `sly-radiance/qwen38-mxfp4`
- **Model:** `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` @ `5233554c` (Quark MXFP4 W4A8, 19 GB) · KV **fp8** · ctx **150000** · max-num-seqs 1 · gpu-mem-util 0.90 · **no speculative decoding**
- **Data:** `campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/` (consolidated `results.jsonl`; attempt 1 quarantined in `quarantine/`) · smoke boots: `campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/2026-10-22-1252-vllm-sly-1.6.0-smoke/`

## Summary

On one R9700, Sly radiance 1.6.0 with AMD's MXFP4 checkpoint is **a prefill engine**: 2,845 tok/s at 8k and still 1,500 tok/s at 136k (MEASURED), roughly 2.3–3.2× what this repo previously measured for llama.cpp+MTP and for radiance 0.9.3 on the same fixture family. Without a drafter, **decode is the weak side**: 33.8 tok/s at 8k decaying to 17.9 tok/s at 136k — about half of llama.cpp+MTP at shallow depth. A growing 9-turn agentic conversation to 131k confirms prefix caching works on this GDN hybrid (each turn pays only its ~15k new tokens). Power sits at the 210 W cap in both phases, so the run is not on a degraded path. The caveat is **reliability**: one GPU memory fault in Sly's own W4A8 prefill GEMM killed the engine at ~131k context (1 of 27 requests, 1 of 1 boots affected).

## Legend

| Term | What it is | Effect on this box (this run) | How it's tested here |
|------|------------|-------------------------------|----------------------|
| MXFP4 / W4A8 | 4-bit microscaled weights; Sly unpacks them in registers and runs the GEMM on gfx1201's **fp8 WMMA** with fp8 activations | weights 13.7 GiB resident (MEASURED, vLLM log); the prefill speed source — and the faulting kernel | fixed (model A) |
| KV `fp8` | 8-bit E4M3 KV cache (`--kv-cache-dtype fp8`) | KV pool **433,957 tokens** in 13.74 GiB at ctx 150000 (2.89× concurrency, MEASURED) | fixed — user decision, no 16-bit arm |
| depth / `crN` | code-review fixture padded to N tokens (`codereview-N.txt`), unique prefix, chat API, 256-token answer | prefill and decode both decay as power laws (fits below) | 4 cold depths × 2 reps |
| conversation | growing multi-turn chat: turn 0 = 10k tokens, each turn adds the reply + 15k new tokens, prior turns cached (iron rule 17) | per-turn cost = prefill of NEW tokens + decode at the grown depth | `capture_engine.py conversation`, 2 reps to ~131k |
| `cached` / `new` | vLLM `prompt_tokens_details.cached_tokens`; new = prompt − cached | cached = previous prompt rounded down to the 64-token KV block (MEASURED) | per turn |
| phase power | GPU power averaged over each request's prefill window (start → first token) and decode window (first token → end) | 179–217 W prefill, 207–215 W decode: at the cap (MEASURED) | `stack/gpu/phase_power.py`, flag < 150 W |
| mclk / sclk | memory / core clock from `gpu_samples.csv` | decode: mclk **1258 MHz in 100 % of samples**; prefill: mclk 456–875, sclk 2.1–2.5 GHz (power-limited) | per phase, skill rule 16 |

## Results — cold depth curve (all MEASURED, per request; 256 generated tokens)

| Config | depth (prompt tok) | rep | TTFT s | Prefill tok/s | Decode tok/s | think tok | VRAM@load MiB | Peak VRAM MiB | Peak GTT MiB | Prefill W avg | Decode W avg |
|--------|-------------------:|----:|-------:|--------------:|-------------:|----------:|--------------:|--------------:|-------------:|--------------:|-------------:|
| mxfp4 fp8kv ctx150k | 8,141 | 0 | 2.84 | 2,870 | 33.8 | 126 | 29,655 | 30,035 | 77 | 217 | 207 |
| | 8,142 | 1 | 2.86 | 2,845 | 33.8 | 142 | | | | | |
| | 20,080 | 0 | **10.74** | **1,870** ⚠ | 31.0 | 136 | 30,035 | 30,035 | 77 | 179 | 210 |
| | 20,080 | 1 | 7.80 | 2,574 | 30.9 | 151 | | | | | |
| | 39,981 | 0 | **20.12** | **1,987** ⚠ | 27.5 | 157 | 30,035 | 30,037 | 77 | 193 | 215 |
| | 39,982 | 1 | 17.45 | 2,291 | 27.4 | 159 | | | | | |
| | 135,689 | 0 | 90.22 | 1,504 | 17.9 | 150 | 30,037 | 30,039 | 77 | 215 | 212 |
| | 135,690 | 1 | 90.48 | 1,500 | 17.9 | 149 | | | | | |

⚠ = first request at that depth, slowed by **Triton JIT compilation during inference** (vLLM log 11:42:32 `kernel_unified_attention_3d`, `reduce_segments`) — see finding 4. The clean (rep 1) prefill is 2,574 @ 20k and 2,291 @ 40k. Peak GTT 77 MiB = the idle baseline: **no host-RAM spill**.

**Depth fits** (log-log, `y = a·depth^k`, MEASURED points; valid only inside 8k–136k):

| Shape | Metric | k | R² | n |
|-------|--------|--:|---:|--:|
| cold | prefill (p50, includes the JIT-hit points) | −0.206 | 0.845 | 4 |
| cold | decode | −0.227 | 0.924 | 4 |
| conversation | prefill of new tokens | −0.360 | 0.882 | 17 |
| conversation | decode | −0.229 | 0.934 | 17 |

**Prefill vs depth** — ![Prefill vs depth](../../../campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/charts/depth_prefill.svg)

> The tool's "p50" over 2 reps is the **minimum** of each metric, so the 20k and 40k points are the JIT-hit reps (1,870 / 1,987). The clean reps make the cold curve monotone (2,845 → 2,574 → 2,291 → 1,500). MEASURED.

**Decode vs depth** — ![Decode vs depth](../../../campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/charts/depth_decode.svg)

> Decode is reproducible to ±0.1 tok/s between reps at every depth (MEASURED), so the decay is real, not noise.

## Results — growing conversation (iron rule 17; all MEASURED)

| Turn | Context tok | Cached | New | Prefill new tok/s (rep 0 / 1) | Decode tok/s (rep 0 / 1) | TTFT s (rep 0 / 1) |
|-----:|------------:|-------:|----:|------------------------------:|-------------------------:|-------------------:|
| 0 | 10,412 | 0 | 10,412 | 2,196 ⚠ / 2,749 | 32.9 / 32.9 | 4.74 / 3.79 |
| 1 | 26,370 | 9,984 | 16,386 | 2,296 / 2,269 | 29.5 / 29.5 | 7.14 / 7.22 |
| 2 | 41,430 | 25,792 | 15,638 | 1,972 / 1,974 | 27.2 / 27.3 | 7.93 / 7.92 |
| 3 | 55,841 | 40,768 | 15,073 | 1,651 / 1,649 | 25.2 / 25.2 | 9.13 / 9.14 |
| 4 | 71,406 | 55,744 | 15,662 | 1,498 / 1,497 | 23.3 / 23.3 | 10.46 / 10.47 |
| 5 | 87,208 | 70,720 | 16,488 | 1,244 / 1,234 | 21.7 / 21.8 | 13.26 / 13.26 |
| 6 | 101,891 | 86,528 | 15,363 | 1,214 / 1,212 | 20.3 / 20.4 | 12.66 / 12.46 |
| 7 | 115,981 | 101,504 | 14,477 | 1,154 / 1,148 | 19.3 / 19.5 | 12.54 / 12.48 |
| 8 | 130,732 | 115,648 | 15,084 | 1,002 / **FAILED** | 18.3 / — | 15.06 / **402 s, engine dead** |

Wall per conversation: rep 0 = 9 turns in **184.8 s** (92.9 s of it TTFT). VRAM 30,039–30,041 MiB, GTT 79 MiB. ⚠ = Triton JIT again (log 11:47:28, `kernel_unified_attention_2d`).

**Conversation: prefill of new tokens per turn** — ![Conversation prefill](../../../campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/charts/conv_prefill_new.svg)

> Each turn prefills only its ~15k new tokens, but they get slower as the cached history they attend to grows (k −0.36). MEASURED.

**Conversation: TTFT per turn** — ![Conversation TTFT](../../../campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/charts/conv_ttft.svg)

> The agent-facing cost: 4–15 s per turn up to 131k context, against 90 s for one cold 136k prefill. MEASURED.

**Power by phase** — ![Power by phase](../../../campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/charts/power_phase.svg)

> Both phases sit at the 210 W cap. Peaks up to 315 W are sub-second transients over an averaging limit. No probe was flagged (threshold 150 W). MEASURED.

## FAILED / interrupted rows (results, not gaps)

| What | Where | Evidence (MEASURED) | Handling |
|------|-------|---------------------|----------|
| **GPU memory fault, engine dead** | conversation rep 1, turn 8 (prefill of ~15k new tokens on a ~131k context) | `HSA_STATUS_ERROR_MEMORY_FAULT`, faulting kernel `radiance_mxfp4_fp8_gemm_atiled<2,true,128,false,4,false,0>`, "Page not present", grid [20480,4,1]; GPU hang analysis, then `EngineDeadError` at 11:59:26 (~6.5 min after the hang began) | row recorded with `error`, conversation stopped (iron rule 18); rep 0 at the identical shape succeeded |
| Attempt 1: every request "no tokens received" | whole campaign, first run | vLLM 0.31 streams thinking as `delta.reasoning`; `capture_engine` read only `reasoning_content`, and all 256 tokens were thinking | quarantined in `quarantine/results.attempt1-reasoning-field.jsonl`; tool fixed; full re-collection |

Boot attempts with MXFP4: 2 smoke/campaign boots, 0 boot failures, **1 of 2 boots later faulted** (this one; the smoke boot served only one short request).

## Consequences & root causes

1. **Prefill is the strength, and it comes from the W4A8 fp8-WMMA path.** 2,845 tok/s at 8k and 1,500 at 136k (MEASURED). The repo's earlier runs on the same `codereview-N` fixtures (unique prefix, chat, 256 tokens; `campaigns/perf/2026-09-12-1844-vllm-window-budgets/results/2026-09-12-1943-vllm-bigwindow-depthcurve`, MEASURED there) gave llama.cpp b10909 + MTP **890 @ 8k / 637 @ 98k** and radiance 0.9.3 INT4 + MTP-3 **1,242 / 662**. That is 2.3–3.2× faster at 8k and >2× at depth. Not like-for-like (different builds, quants, speculation, and an unknown power cap then), so this is a direction, not a ranking. INFERRED cause: all 304 linears run on gfx1201's fp8 WMMA instead of a W4A16 dequant-to-fp16 GEMM (Sly PERFORMANCE.md:163, CLAIMED).
   **→ For agent workloads that re-read large contexts, prefill is the cost that grows, and this engine is the best this repo has measured at it.**

2. **Decode without speculation is below llama.cpp+MTP.** 33.8 → 17.9 tok/s (MEASURED) vs llama.cpp+MTP's 67.4 @ 8k / 35.4 @ 98k in the earlier run. Bandwidth bound (INFERRED): ~14.7 GB of weights per token at 640 GB/s (CLAIMED, AMD spec: 256-bit GDDR6 @ 20 Gbps) caps decode at ~43 tok/s, so 33.8 at 8k is ~78 % of the roofline. At 131k the fp8 KV adds 16 attn layers × 4 KV heads × 256 × 2 B ≈ 32 KiB/token (INFERRED from the model card's geometry, CLAIMED) ≈ 4.2 GB/token, which caps decode at ~34 tok/s; the measured 18.3 is ~54 %. **OPEN:** the decode attention kernel loses efficiency with depth. The memory clock was pinned at maximum (1,258 MHz) in 100 % of decode samples, so the 210 W cap is not the limiter here.
   **→ The drafter (Sly's headline 149.6 tok/s is CLAIMED *with* DFlash2 k=7) is the next measurement. Without it, llama.cpp+MTP remains the decode choice.** *Update: measured in [`../2026-10-22-vllm-sly-mxfp4-dflash/analysis.md`](2026-10-22-1406-vllm-sly-mxfp4-dflash.md) — 136.6 tok/s @ 8k, 100.5 @ 136k cold (MEASURED).*

3. **Prefix caching works on this GDN hybrid.** Cached tokens = the previous turn's prompt rounded down to the 64-token block. Turn 8's TTFT is 15.1 s for 15,084 new tokens, vs 90.2 s for a cold 135,689-token prompt (MEASURED) — the skill-rule-11 check (wall ≈ delta/rate, not ctx/rate) passes. The previous reply is *not* cached: the Qwen template drops prior reasoning from history, so its tokens differ (INFERRED from cached = previous prompt only).
   **→ An agent loop to ~130k pays ~15 s per turn of prefill here, not ~90 s.**

4. **Triton JIT compilation during inference slows the first request at a new shape.** It hit the first 20k request (−27 % prefill), the first 40k (−13 %) and the conversation's first turn (−20 %). vLLM itself warns about it (`jit_monitor.py`, MEASURED). It appeared because the time-saving change set `warmup 0` on the deeper probes. The compiled kernels persist in the per-tag Triton cache (`cache/vllm-sly-radiance@1.6.0-rocm10.1/triton`), so later boots should not pay it again (INFERRED; check in the next run).
   **→ Report rep 1, or warm each new shape once. A single-rep number on a fresh cache is biased low.**

5. **Reliability: a memory fault in Sly's own prefill GEMM.** One fault in 27 prefill requests (1 of 2 boots) at the deepest shape. The identical shape succeeded in rep 0, so it is intermittent (MEASURED). No matching issue exists upstream (GitHub search 2026-10-22: "MEMORY_FAULT", "memory access fault", "page not present" → 0 hits). The A-tiled kernel serves prefill chunks with M ≥ 513 (`RADIANCE_MXFP4_A_TILED_MIN_M=513`, profile). **OPEN — root cause unknown.** Candidates to bisect (INFERRED, untested): the A-tiled path (`RADIANCE_MXFP4_A_TILED_MIN_M` above the chunk size), the prefix-cache plus partial-block interaction at deep context, and 1.6.0's new default prefill stack (#167). The hang lasted 6.5 min before vLLM declared the engine dead, so a client without a timeout would wait that long, and `/health` keeps answering in the meantime (INFERRED, same shape as CLAUDE.md rule 15).
   **→ Not yet production-safe for long unattended agent runs. A harness must watch `docker logs` for `MEMORY_FAULT` while a request is in flight (recommended tool change; not done).**

6. **Power is healthy.** Prefill averaged 179–217 W and decode 207–215 W (MEASURED), against the user's expectation of 180–210 W and the 210 W cap. Prefill is power-limited (sclk 2.1–2.5 GHz vs 3.1–3.3 GHz in decode, mclk lowered), consistent with Sly's CLAIMED "210 W costs ~20 % prefill vs 300 W". The power profile was not changed (user decision: monitor only).

7. **Memory is flat and safe.** vLLM reserves 0.90 × VRAM at boot, so VRAM is 29,655 → 30,041 MiB regardless of depth, and GTT stays at the 77 MiB baseline (MEASURED). The KV pool (433,957 tokens) holds ~2.9 full 150k contexts, so `max-num-seqs` could rise for parallel agents without touching the window (INFERRED; untested).

## Setup experience & issues (chronological, for the next engine)

| # | Issue | Cause | Fix / status |
|---|-------|-------|--------------|
| 1 | `/mnt/Lin1` unreadable | owned by user `bip`, mode 700 | user: `install -d -o dev /mnt/Lin1/work` + `chmod o+x` |
| 2 | root disk 96 % full | docker `data-root` on `/` | user moved `data-root` → `/mnt/Lin1/work/docker` |
| 3 | images still on `/` after the move | Docker 29 uses the **containerd image store** (`io.containerd.snapshotter.v1`), which ignores `data-root` and keeps images in `/var/lib/containerd` | user: `root = "/mnt/Lin1/work/containerd"` in `/etc/containerd/config.toml` + `RequiresMountsFor=/mnt/Lin1` drop-ins (the mount is `nofail`) |
| 4 | `docker run`: `stat /home/dev/dockers/tmp` | two stale `TMPDIR` systemd drop-ins | user removed them |
| 5 | `hf` CLI broken | `huggingface_hub` missing from the user site | dedicated venv `tools/hf-venv`; shared `HF_HOME=/mnt/Lin1/work/hf` with a default ACL (containers write as root) |
| 6 | Sly scripts disagree on the image | README pins `1.1.0-rocm10.1`, `serve.sh` defaults to `ggz14/...`, compose to `stilldeadcode/...:0.9.3`, `setup-mxfp4.sh` re-quantizes the MTP head | used the README docker recipe on `1.6.0-rocm10.1`, which serves AMD's checkpoint directly |
| 7 | **NVFP4 boot crashed the desktop session** | load-time NVFP4→MXFP4 requant + fp8→bf16 lm_head transient: 32,600/32,624 MiB + 2,956 MiB GTT (MEASURED); `--gpu-memory-utilization` does not bound the load phase; the GUI shares the card | NVFP4 dropped (user); **boot watchdog** in `serve_vllm.sh` (sysfs, 0.2 s, kills the container below 256 MiB free) |
| 8 | orphaned container after the crash | the session died mid-boot | stopped via `serve_vllm.sh stop`, VRAM verified idle (iron rule 14) |
| 9 | FP8 checkpoint impractical on one card | ~25 GiB of weights (INFERRED) | download parked at 21/31 GB (resumable) |
| 10 | `pkill -f` killed its own shell | the pattern matched the command line (iron rule 14) | split-pattern idiom from then on |
| 11 | tool gaps (iron rule 6) | `gen_campaign.py` could only start llama.cpp; no growing-conversation probe; no per-phase power; vLLM `/tokenize` body | **extended the tools** (below), regression-tested byte-identical on all 6 existing campaigns |
| 12 | attempt 1 all "no tokens" | `delta.reasoning` vs `reasoning_content`; also `engine-bench/run.sh` exited 0 on a failed probe, so the campaign marked it done | both fixed; attempt 1 quarantined |
| 13 | image version | PR #162 says 1.6.0 moved to vLLM 0.32.0; the pulled `1.6.0-rocm10.1` reports 0.31.0 | **OPEN** (recorded by digest) |

Tool changes made in this session (all stress-tested; mock-server end-to-end + real run):
`bench/engine-bench/vllm/{serve_vllm.sh,fetch_model.sh,profiles/}` (new) · `gen_campaign.py` (`engine: vllm`, `mode: conversation`, per-probe `warmup`) · `capture_engine.py` (`conversation` mode, wall-clock phase times, vLLM `/tokenize` + `delta.reasoning`, cut-stream = interrupted) · `stack/gpu/phase_power.py` (new) · `engine-bench/run.sh` (`MODE=conversation`, phase power, nonzero exit on failure) · `report.py` (conversation charts, power table + flag, per-series log-log fits).

## Recommended config (what this campaign ran)

```bash
PROFILE=sly-radiance/qwen38-mxfp4 PORT=8000 stack/serve/vllm/serve_vllm.sh      # MAXLEN=150000 KV_DTYPE=fp8 MAXSEQS=1
# exact docker argv + image digest + model revision: stack/serve/var/servers/8000.cmdline (copied per boot)
```
Use it for **prefill-heavy, interactive** work with a client-side timeout. For long unattended runs, wait for the fault to be bisected. For decode-heavy work, llama.cpp+MTP stays ahead until the DFlash drafter is measured.

## Methodology & caveats

- Fixtures `codereview-{8000,20000,40000,140000}.txt` (vLLM counts 8,141 / 20,080 / 39,981 / 135,689 tokens) and `codereview-150000.txt` as the conversation source. Unique prefix per request, chat API, server-default `reasoning_effort: medium` (cold) / `low` (conversation), 256 max tokens (thinking consumed ~126–159 of them), temperature 0.2.
- 2 reps (the tool's "p50" of 2 is the minimum per metric — use the per-request table). One warm-up request (16 tokens at 8k) only.
- Warm boot 236 s (load 6.2 s, compile 0.5 s from cache, engine init 127 s); the cold first boot was 435 s (smoke). `RADIANCE_RUN_BWTEST=0`.
- Speculation off throughout; the decode numbers are not comparable to Sly's CLAIMED 149.6 tok/s (DFlash2 k=7, 300 W, 0.98 util).
- Not measured: concurrency > 1, quality/accuracy, a two-conversation interleave (skill rule 18), the f16 KV arm (user decision).

## External comparison (CLAIMED, not measured here)

Sly README (1.5.1 reference, 300 W, fp8 KV, **with DFlash2 k=7**): decode 149.6 tok/s single stream, prefill ~3,024 tok/s at 1.5k / 2,430 at 47k, 439,031-token KV pool. Our drafter-off pool (433,957 @ 0.90 util) matches it closely. Our 40k prefill (2,291 clean) vs their 2,430 @ 47k is ~6 % lower at 210 W vs 300 W.

Full chart appendix: [`appendix.md`](../../../campaigns/perf/2026-10-22-1324-vllm-sly-mxfp4-depth/results/appendix.md) (adds `conv_decode.svg`, `memory.svg`).
