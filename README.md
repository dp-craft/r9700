# Radeon AI PRO R9700 — local LLM benchmarks & tuning

Benchmarks, tuning experience, and research for running **coding LLMs on the AMD Radeon AI PRO
R9700** (RDNA4, gfx1201, 32 GB) under ROCm and Vulkan. Focus: max prefill/decode throughput for
27B–35B (A3B MoE) models at long context (64K–100K) inside 32 GB VRAM.

## TL;DR — best config (MEASURED 2026-07-11, current harness)

**Interactive / single-stream:** llama.cpp **Vulkan (RADV) + MTP** (`--spec-type draft-mtp`),
`-ngl 99 -fa on -ub 2048 -b 4096 -ctk f16 -ctv f16 -c 65536` → Qwen3.6-35B-A3B ≈ **140 decode
tok/s** (8K) / **117** (32K), prefill ~2.4–2.8K tok/s. MTP is **+30–40 % decode single-stream**.
**Parallel agent fleet:** same config with **`-np 4` and MTP OFF** (MTP reverses to −8…−15 % under
concurrency) → **4 agents inside 32 GB**, ~48 tok/s/stream, TTFT p95 ~11 s.
**KV:** keep **f16** — q8_0 fails the ≤5 % rule at 32K (ROCm −7.5 % decode, Vulkan −29.7 % prefill)
and saves only ~0.35 GiB; it earns its place only at 64 K+ where f16 nears the ceiling.
Full picture: [sweep](docs/analysis/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md) ·
[serving campaign](docs/analysis/2026-07-11-1844-campaign-combo35b.md).

## The harness in one paragraph

`bench/` is a reproducible benchmarking harness with two tracks: an **adaptive tuning-optimum
search** (grid expands until the peak is bracketed by measured, slower neighbors; KV q8_0 accepted
only if it costs ≤5% at the target depth) and a **serving-combo matrix** (backend × MTP × KV ×
context depth × parallel agent streams on real code workloads, resumable, full provenance —
server cmdline, `/props`, VRAM/power samples per run). Vendor-parameterizable: AMD auto-detected,
NVIDIA works by pointing it at a CUDA llama.cpp build; the cross-engine side is pure HTTP.
**Full capability tour: [`bench/README.md`](bench/README.md).**

## Layout

| Path | What |
|------|------|
| [`docs/INDEX.md`](docs/INDEX.md) | Register of every report, newest first — **start here** |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | **How to run the benchmarks yourself, step by step** |
| `docs/analysis/` | Our measurements on this box (dated) |
| `docs/research/` | External, sourced research (dated) |
| `bench/model-bench/` | **Tuning microscope** — `run.sh` (manual) + `sweep.py` (**adaptive optimum search** + KV ≤5% rule) |
| `bench/engine-bench/` | **Cross-engine + serving combos** — probe (concurrency/thinking), `serve_llamacpp.sh`, `campaign.sh` (MTP×KV×depth×parallel matrix), llama-benchy |
| `bench/workloads/` | Prompt fixtures + `build_prompt.py` + tracked `corpus/` (TS+Python, ~565K tokens) |
| `bench/lib/` | Vendor abstraction (AMD/NVIDIA) + VRAM/power sampler |
| `bench/runs/` | Dated campaign outputs `YYYY-MM-DD-HHMM-<slug>/` |
| `bench/legacy/` | ⚠️ Original harness — **frozen, superseded** (see `bench/legacy/README.md`) |
| `install.sh` | ROCm stack install (`amdgpu-install` + render/video groups) |
| `CLAUDE.md` | Map + working rules for AI sessions |

Big build artifacts (`bench/llamacpp*/`, `bench/dl/`, `unsloth_compiled_cache/`), `bench/runs/*/`
logs and `bench/workloads/generated/` are gitignored; tracked content is scripts + `results_*.jsonl` + docs.
See [`bench/README.md`](bench/README.md) for the two-track rationale.

## Setup

```bash
./install.sh                 # ROCm via amdgpu-install; adds render/video groups (re-login after)
export HSA_OVERRIDE_GFX_VERSION=12.0.1
```

## Run a benchmark

Full step-by-step in [`docs/RUNBOOK.md`](docs/RUNBOOK.md). The short version (vendor env is
auto-detected — works on NVIDIA too by pointing `LLAMA_BENCH`/`LLAMA_SERVER` at a CUDA build):

```bash
# adaptive tuning-optimum search (grid expands until the peak is bracketed; KV ≤5% rule):
cd bench/model-bench
./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm

# serving combination matrix: backend × MTP × KV × context depth × concurrency, resumable:
cd ../engine-bench
./campaign.sh
```
Everything writes to `bench/runs/<stamp>-<track>-<slug>/` with full meta (cmdline, /props,
GPU/VRAM samples).

New measurements and research are documented to a fixed spec via the `/benchmark` and `/research`
skills (`.claude/skills/`) — English, summary + table first, one file per run.
