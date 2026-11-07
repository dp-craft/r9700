# Radeon AI PRO R9700 — local LLM benchmarks & tuning

Benchmarks, tuning experience, and research for running **coding LLMs on the AMD Radeon AI PRO
R9700** (RDNA4, gfx1201, 32 GB) under ROCm and Vulkan. Focus: max prefill/decode throughput for
27B–35B (A3B MoE) models at long context (64K–256K) inside 32 GB VRAM.

## TL;DR — best config (MEASURED 2026-07-11, current harness)

**Interactive / single-stream:** llama.cpp **Vulkan (RADV) + MTP** (`--spec-type draft-mtp`),
`-ngl 99 -fa on -ub 2048 -b 4096 -ctk f16 -ctv f16 -c 65536` → Qwen3.6-35B-A3B ≈ **140 decode
tok/s** (8K) / **117** (32K), prefill ~2.4–2.8K tok/s. MTP is **+30–40 % decode single-stream**.
**Parallel agent fleet:** same config with **`-np 4` and MTP OFF** (MTP reverses to −8…−15 % under
concurrency) → **4 agents inside 32 GB**, ~48 tok/s/stream, TTFT p95 ~11 s.
**Deep context:** f16 KV runs the **full native 262144** ctx (~21 KiB/tok → ~27 GB) — **VRAM is
not the limit, the RoPE cap is**; MEASURED to 200K single-stream. At depth, **MTP flips to a net
loss** for read-a-lot/answer-short requests (200K: +18 s prefill vs +1 s decode saved) — MTP on only
when generation dominates prefill.
**KV:** keep **f16 everywhere** — q8_0 fails the ≤5 % rule and **gets *worse* with depth** (32K
Vulkan −29.7 % prefill → 200K **−40 % prefill / −22 % decode / TTFT +66 %**); f16 fits 262144 so
q8_0 never earns its place here.
Full picture: [sweep](docs/findings/llamacpp/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md) ·
[serving campaign](docs/findings/llamacpp/2026-07-11-1844-campaign-combo35b.md) ·
[deep context to 200K](docs/findings/llamacpp/2026-07-11-2200-deep-context-35b.md).

## The harness in one paragraph

`bench/` is a reproducible benchmarking harness with two tracks: an **adaptive tuning-optimum
search** (grid expands until the peak is bracketed by measured, slower neighbors; KV q8_0 accepted
only if it costs ≤5% at the target depth) and a **serving-combo matrix** (backend × MTP × KV ×
context depth × parallel agent streams on real code workloads, resumable, full provenance —
server cmdline, `/props`, VRAM/power samples per run). Vendor-parameterizable: AMD auto-detected,
NVIDIA works by pointing it at a CUDA llama.cpp build; the cross-engine side is pure HTTP.
**Full capability tour: [`bench/README.md`](bench/README.md).**

## Layout

Dependency direction: `stack/` ← `bench/` ← `campaigns/` ← `docs/`.

| Path | What |
|------|------|
| [`docs/INDEX.md`](docs/INDEX.md) | Register of every report, newest first — **start here** |
| [`docs/guides/GUIDE.md`](docs/guides/GUIDE.md) | **How to run the benchmarks yourself, step by step** |
| `docs/findings/<topic>/` | Our measurements on this box (dated); each names the campaign that holds its data |
| `docs/research/<topic>/` | External, sourced research (dated) |
| `campaigns/<type>/<stamp>-<slug>/` | One experiment each (perf, build-check, quality, agentic, workers, investigation): recipe at the root, `inputs/`, committed `results/` (rows, scores, charts), ignored `tmp/` (raw) |
| `bench/core/` | Campaign scaffolder (`gen_campaign.py`), the prober (`capture_engine.py`), charts (`report.py`), KV geometry (`gguf_kv.py`) |
| `bench/perf/model-bench/` | **Tuning microscope** — `run.sh` (manual grid) + `sweep.py` (**adaptive optimum search** + KV ≤5% rule) |
| `bench/perf/engine-bench/` | **Cross-engine + serving combos** — `run.sh` probe (concurrency/thinking), `campaign.sh` (MTP×KV×depth×parallel matrix) |
| `bench/build-check/` | New llama.cpp build vs the previous one → verdict + report |
| `bench/quality/` | TS coding-quality harness (tsc + eslint + vitest grading, blind judge, charts) |
| `bench/workloads/` | Prompt fixtures + `build_prompt.py` + tracked `corpus/` (TS+Python, ~565K tokens) |
| `stack/` | The machine: ROCm install, llama.cpp builds, llama-swap config, server launchers (llama.cpp, vLLM, radiance), GPU tools (vendor abstraction, VRAM/power sampler, `gpu_exclusive.sh`) |
| `CLAUDE.md` | Map + working rules for AI sessions |

Every `tmp/` and `var/` dir is git-ignored: builds, venvs, server state, raw replies, logs and GPU sample
CSVs stay local. Tracked content is scripts, campaign recipes and `results/`, and docs.
See [`bench/README.md`](bench/README.md) for the track rationale.

## Setup

```bash
stack/install/install.sh     # ROCm via amdgpu-install; adds render/video groups (re-login after)
export HSA_OVERRIDE_GFX_VERSION=12.0.1
```

## Run a benchmark

Full step-by-step in [`docs/guides/GUIDE.md`](docs/guides/GUIDE.md). The short version (vendor env is
auto-detected — works on NVIDIA too by pointing `LLAMA_BENCH`/`LLAMA_SERVER` at a CUDA build). Every
run writes into a campaign dir: raw to its `tmp/`, rows to its `results/`.

```bash
# adaptive tuning-optimum search (grid expands until the peak is bracketed; KV ≤5% rule):
bench/perf/model-bench/sweep.py --campaign-dir campaigns/perf/<stamp>-<slug> \
  --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm

# serving combination matrix: backend × MTP × KV × context depth × concurrency, resumable:
CAMPAIGN_DIR=campaigns/perf/<stamp>-<slug> bench/perf/engine-bench/campaign.sh

# or plan + scaffold a whole campaign (spec.json → resumable run.sh + README):
bench/core/gen_campaign.py emit --spec campaigns/perf/<stamp>-<slug>/spec.json
```

New measurements and research are documented to a fixed spec via the `/benchmark-results` and
`/research` skills (plan a campaign first with `/benchmark-new-campaign`) in `.claude/skills/` —
English, summary + table first, one file per run.
