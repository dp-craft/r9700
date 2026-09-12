# vLLM on the R9700 with Qwen3.8-27B (pp512+tg256, pp32768+tg2048) — Brainstorm

- **Date:** 2026-09-11
- **Status:** Brainstorm complete — parked (awaiting go / specification). **Nothing was installed, downloaded,
  deleted or run on the GPU** during the brainstorm (only CPU-only source/registry/index reads).
- **Chosen approach:** A — host Python venv with the official vLLM **0.29.0+rocm723** wheels, serving
  **`RedHatAI/Qwen3.8-27B-INT4`** from `~/models/vllm`, two boots (**MTP off / MTP on**), measured with
  **llama-benchy**, compared to today's **b10909 llama-bench** numbers (indicative).

---

**Sections:** [Problem Statement](#problem-statement) | [Orient](#orient--key-decisions) | [Investigations](#investigation-index) | [Approaches](#approaches) | [Comparison](#comparison-matrix) | [Stress-Test](#stress-test-summary) | [Recommendation](#recommendation) | [Questions](#resolved-questions) | [Evolution](#evolution-path)

---

## Problem Statement

Test vLLM on the AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB) with Qwen3.8-27B at two request shapes —
**pp512 + tg256** and **pp32768 + tg2048** — in the easiest way, with a configuration that performs well from
the first run. The preferred input was the already-downloaded `unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf` (or an Unsloth
download if GGUF is unsupported). Constraints fixed during the session: **no Docker**, models in **`~/models/vllm`**,
a simple engine install, the **GPU is freed manually** (vLLM must not start while the GPU is in use), only very
cheap experiments during the brainstorm, and **do not download the 35B**.

## Orient — Key Decisions

### Research before choosing a config?
Options considered:
- Research now (web + direct verification)
- GGUF load test on the GPU first
- Skip research, use prior knowledge

**Decision:** Research now.
Qwen3.8 and the current vLLM/ROCm state post-date prior knowledge; the user asked for "good performance from the
beginning". Four haiku agents ran; every decision-relevant claim was then **re-verified directly** (HF API, Docker
Hub API, wheel indexes, vLLM source at tag) — which corrected several agent claims (Marlin on ROCm, vLLM version,
install sizes).

### Can vLLM use the downloaded GGUF?
Options considered:
- GGUF in vLLM
- A native vLLM quant format (safetensors)

**Decision:** No GGUF — BLOCKER. Arch `qwen35` is absent from transformers' GGUF mapping, vllm#36456 is open, and
the ROCm image ships no ggml kernels. See [gguf feasibility](sub-results/vllm-gguf-qwen35-feasibility.md).

### Which checkpoint? (incl. the user's "maybe Unsloth")
Options considered:
- RedHatAI/Qwen3.8-27B-INT4 (c-t int4 sym g128, 19.5 GB)
- SergiioB GPTQ-Int4 G128 MTP-BF16 (19.6 GB)
- Both
- FP8 (Qwen/Unsloth, 30.9 GB)
- Unsloth bnb-4bit (22.3 GB) / NVFP4

**Decision:** **RedHatAI/Qwen3.8-27B-INT4**, GPTQ build as fallback.
Maintainer-published, MTP head kept BF16, g128 + `actorder: static` pass every `RDNAHybridW4A16` gate. Unsloth has
no vLLM format that fits and runs fast on RDNA4 (FP8 too big, bnb unsupported/slow, NVFP4 needs FP4); Unsloth's
GGUF remains the llama.cpp side. See [checkpoints](sub-results/qwen38-27b-checkpoints-options.md).

### Packaging and model location
Options considered:
- Docker 0.23.0 rdna image (remove old image)
- Docker 0.19.1 first, then 0.23.0
- Docker 0.19.1 only
- Docker 0.23.0, free other space

**Decision (user override):** **no Docker** — "a very simple vLLM engine (max 4 GB)", models in **`~/models/vllm`**.
This moved the design to a host venv. The user later designated `rocm/vllm:rocm10.0.0_ubuntu24.04_py3.14_pytorch_2.12.0_vllm_0.27.0`
as the **official AMD image** — documented (gfx1201 in its arch list, ROCm 10.0.0 = host), not used.

### How is the start gated on a free GPU?
Options considered:
- Check only, never kill
- `bench/lib/gpu_exclusive.sh` on confirm (unloads llama-swap, kills holders)
- Manual go only

**Decision (user):** **manual, with a simple start script.** The user frees the GPU; the script never kills
anything (a refuse-only free-VRAM read is compatible with this and is recommended).

### Install footprint (4 GB cap)
Options considered:
- Trimmed official wheels, ~5 GB (skip amd-aiter + flash-attn)
- Full `pip install`, ~10.5 GB
- TheRock gfx120X torch + vLLM source build (smallest, 30–60 min build)

**Decision (user):** **Full pip install (~10.5 GB)**, cap overridden.
Measured from the wheels' own zip indexes: vllm 1.48 + torch 2.00 + triton 1.09 GB = 4.6 GB minimum; the full set is
9.96 GB (amd-aiter alone 4.88 GB). See [install footprint](sub-results/host-install-footprint-cost-analysis.md).

### Disk headroom
Options considered:
- Remove the old `rocm/vllm` 0.19.1 image (~50 GB)
- Accept ~2 GB free
- Delete some GGUFs instead

**Decision (user):** **Remove the old 0.19.1 Docker image** (executed at go: freed ~13 GB → `/` 45 GB free).
Correction found during execution: `~/models` is a symlink to `/mnt/LinBackup/models` (separate partition), so the
model never counted against `/` and the "~2 GB left" estimate was overstated — the removal was harmless (image
unused) but not strictly required.

### MTP arms
Options considered:
- MTP off + on (two boots)
- MTP on only
- MTP off only

**Decision (user):** **MTP off + on.** Off = like-for-like with the no-MTP llama.cpp baseline; on = the
performance-first config (recipe `{"method":"mtp","num_speculative_tokens":3}`).

### Baseline
Options considered:
- Re-measure llama.cpp with the same llama-benchy (+`--ignore-eos`, MTP off/on)
- Reuse today's llama-bench b10909 numbers
- vLLM only

**Decision (user):** **Reuse today's b10909 llama-bench numbers**, labelled **indicative** (harness, KV type, quant
and MTP differ). See [harness](sub-results/benchmark-harness-technical.md).

### Where the start script lives
Options considered:
- `bench/engine-bench/serve_vllm.sh` (rule-6 tool layer)
- One-off `start.sh` in the run dir
- Documented command only

**Decision (user):** **project root `start_vllm.sh`.** Rule-6 note recorded: no repo tool launches vLLM
(`serve_llamacpp.sh` is llama.cpp-only); fold into `bench/engine-bench/` later if vLLM becomes a regular engine.

### Scope exclusions (user)
- **Do not download the 35B** — the plan downloads only `RedHatAI/Qwen3.8-27B-INT4` (19.5 GB).

## Investigation Index

### [vLLM on RDNA4 — status landscape](sub-results/vllm-rdna4-status-landscape.md)
- **Type:** landscape
- **Scope:** vLLM releases/images for gfx1201, the official AMD image, open issues, community numbers, July history.
- **Key finding:** vLLM 0.29.0 (wheels) and AMD's ROCm-10 image both include gfx1201; bimodal decode (ROCm#6347) and AITER-on-gfx1201 (aiter#3294) are still open.

### [Qwen3.8-27B checkpoints](sub-results/qwen38-27b-checkpoints-options.md)
- **Type:** options
- **Scope:** every quantized Qwen3.8-27B on HF, sizes and quant configs verified via the HF API.
- **Key finding:** only ~19.5–21 GB INT4 builds fit; FP8 is 30.9 GB; RedHat INT4 keeps the MTP head in BF16.

### [GGUF in vLLM](sub-results/vllm-gguf-qwen35-feasibility.md)
- **Type:** feasibility
- **Scope:** can vLLM load the `qwen35` GGUF.
- **Key finding:** BLOCKER — no arch mapping, no ggml kernels in the ROCm build, upstream issue open.

### [ROCm W4A16 / FP8 kernel paths](sub-results/rocm-w4a16-kernels-technical.md)
- **Type:** technical
- **Scope:** which kernel runs the INT4 weights on gfx1201 in vLLM 0.19.1 vs 0.29.0.
- **Key finding:** 0.29.0 adds `RDNAHybridW4A16` (Triton prefill + HIP skinny decode, gfx11/12, bf16 OK, g32/64/128); MTP k=3 keeps verify on the skinny kernel (M ≤ 5).

### [Host install footprint](sub-results/host-install-footprint-cost-analysis.md)
- **Type:** cost-analysis
- **Scope:** no-Docker install options, real wheel/installed sizes, host ROCm, disk budget.
- **Key finding:** 4 GB impossible (4.6 GB floor, 9.96 GB full set); official torch uses host `/opt/rocm` (ROCm 10.0) though built for 7.2.3.

### [Benchmark harness and baseline](sub-results/benchmark-harness-technical.md)
- **Type:** technical
- **Scope:** llama-benchy mechanics, llama.cpp exact-length handling, baseline numbers.
- **Key finding:** llama-benchy (`--exact-tg` via `min_tokens`, natural-text prompts, reasoning-aware TTFT) fits vLLM; b10909 baseline is indicative only.

### [Approaches](sub-results/approaches.md)
- **Type:** approaches
- **Scope:** all runtime × weights × MTP × measurement combinations.
- **Key finding:** A (host venv + RedHat INT4) is the only approach that satisfies every user constraint.

### [Stress-test](sub-results/stress-test.md)
- **Type:** stress-test
- **Scope:** assumptions, failure modes, ripple effects, what we give up, expected-outcome sanity bounds.
- **Key finding:** the top risk is the ROCm-7.2.3-built torch running on host ROCm 10; the disk blocker is resolved by removing the old image.

## Approaches

### Approach A: Host venv + official vLLM 0.29.0 wheels (full) + RedHat INT4 + MTP off/on + llama-benchy — CHOSEN
- **What:** `pip install "vllm==0.29.0+rocm723" --extra-index-url https://wheels.vllm.ai/rocm/` into a Python 3.12
  venv; serve `~/models/vllm/Qwen3.8-27B-INT4`; two boots.
- **How:** `RDNAHybridW4A16` handles the INT4 g128 weights (Triton prefill, HIP `wvSplitK_int4_g` decode);
  CUDA/HIP graphs + torch.compile on; MTP k=3.
- **Strength:** newest vLLM with gfx1201 in its build and RDNA-specific 4-bit kernels; one pip command; no Docker.
- **Weakness:** ~10.5 GB venv; torch built for ROCm 7.2.3 on host ROCm 10.0 (ABI risk); needs the old image removed.
- **Complexity:** S · **Reversibility:** Easy · **Architectural impact:** Local
  See: [approaches](sub-results/approaches.md), [stress-test](sub-results/stress-test.md), [install](sub-results/host-install-footprint-cost-analysis.md)

### Approach B: A with a trimmed install (~5 GB) — VIABLE
- **What:** skip amd-aiter + flash-attn via `--no-deps` (imported only when enabled — source-verified).
- **How:** vllm/torch/triton + pure-Python deps by hand.
- **Strength:** closest to the 4 GB wish. **Weakness:** dependency fiddling.
- **Complexity:** S/M · **Reversibility:** Easy · **Architectural impact:** Local

### Approach C: TheRock gfx120X torch (or AMD ROCm-10 wheels) + vLLM from source — VIABLE
- **What:** smallest, arch-specific torch; vLLM compiled with hipcc; can match the host's ROCm 10.
- **Strength:** removes A's ABI risk; smallest footprint. **Weakness:** 30–60 min build, not "simple".
- **Complexity:** L · **Reversibility:** Easy · **Architectural impact:** Local

### Approach D0: Official AMD image `rocm/vllm:rocm10.0.0_…_vllm_0.27.0` — ELIMINATED (no Docker), documented
- gfx1201 in its arch list, ROCm 10.0.0 = host, 27.2 GB compressed. Reference and fallback source for C.

### Approach D / E: Docker 0.23.0 rdna / Docker 0.19.1 — ELIMINATED (no Docker; 0.19.1 lacks RDNA kernels)

### Approach F: vLLM + GGUF — ELIMINATED (BLOCKER)

### Approach G: FP8 30.9 GB — ELIMINATED (doesn't fit with 34k ctx; AITER FP32 fallback)

### Approach H: Unsloth bnb-4bit — ELIMINATED (unsupported on ROCm quant list; slow)

### Approach I: AWQ g32 builds (cyankiwi / abhishekchohan, 21.0 GB) — VIABLE ALTERNATIVE
- New in 0.29.0: `RDNAHybrid` accepts g32, so July's failure mode is gone. Not chosen: RedHat is the trusted g128 build.

## Comparison Matrix

| Dimension | A (chosen) | B trimmed | C TheRock+src | D0 AMD image | F GGUF | G FP8 |
|---|---|---|---|---|---|---|
| Solves the core problem | Y | Y | Y | Y | N | N |
| Complexity | S | S/M | L | S | — | — |
| Risk level | Med | Med | Med | Low/Med | Blocker | Blocker |
| Reversible | Y | Y | Y | Y | — | — |
| Architectural side effects | Local | Local | Local | Local | — | — |
| Maintenance burden | Low | Med | High | Low | — | — |
| Future optionality | Opens | Opens | Opens | Neutral | — | — |
| Honors user constraints | Y (cap overridden by user) | closest to 4 GB | Y | **N (Docker)** | — | — |

## Stress-Test Summary

| Finding | Severity | Approach(es) affected |
|---|---|---|
| Disk on `/` — estimated ~2 GB left; **corrected**: the model lives on `/mnt/LinBackup`, `/` keeps ~33 GB after the venv (image removal executed, freed ~13 GB) | NOTE (was BLOCKER; overstated) | A, B |
| Official torch built vs ROCm 7.2.3, running on host ROCm 10.0 / HIP 7.15 — during install it surfaced as a missing OpenMPI 4 runtime (fixed: contained libs in the venv) and an amdsmi clash (fixed: `/opt/rocm/lib` kept off `LD_LIBRARY_PATH`); link level now OK, GPU level pending | RISK (partly resolved) | A, B |
| ROCm#6347 bimodal decode; the two boots are different configs, not repeats | RISK | all vLLM |
| `RDNAHybridW4A16` selection is source-verified, not runtime-verified — record the chosen kernel from the log | RISK | A, B, C |
| MTP on ROCm with the Gated-DeltaNet hybrid is untested here | RISK | MTP arm |
| pip could resolve PyPI's CUDA vllm — pin `vllm==0.29.0+rocm723` | RISK | A, B |
| Orphaned server holds VRAM (2026-07-15 class) — pidfile + stop + port-free check | RISK | all |
| First-boot JIT ~15–20 min (CLAIMED); caches persist | TRADEOFF | all vLLM |
| Baseline differs in harness, KV type, quant, MTP → indicative only | TRADEOFF | A |
| MTP verify: down_proj (K=17408) leaves the HIP skinny kernel for any k ≥ 1 (K·M > 32768 LDS limit); k=3 kept (recipe) — corrected during execution | NOTE | MTP arm |
| Attention decode falls back to Triton: RDNA custom paged attention needs head_size 128 + block 16; Qwen3.8 has head_dim 256, hybrid block 1568 (found during execution) | NOTE | all vLLM |
| Two single points ≠ engine verdict (rule 16 depth curve is the follow-up) | NOTE | all |
| CLAUDE.md says "ROCm 7.x"; host is ROCm 10.0.0 / HIP 7.15 (doc drift, not edited) | NOTE | — |

See: [full stress-test](sub-results/stress-test.md)

## Recommendation

Go with **Approach A**. It is the only option that satisfies every stated constraint (no Docker, simple install,
models in `~/models/vllm`, manual GPU gate), and it is the first vLLM build whose source shows a dedicated
gfx12 4-bit decode kernel — the component that made July's vLLM decode 3–6× too slow. Keep **B** (trimmed) as the
disk fallback and **C** (TheRock / AMD ROCm-10 wheels + source build) as the fallback if the official torch fails on
the host's ROCm 10. Expect (INFERRED) MTP-off decode at or below llama.cpp's ~28–30 t/s, with only the MTP arm able to
beat it; prefill is the open question.

### Implementation notes

**Order of operations (only after the user's go; steps 0–2 need no GPU):**
0. `docker rmi rocm/vllm:rocm7.13.0_gfx120X-all_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1` (approved decision).
1. `python3.12 -m venv bench/dl/vllm-venv` → `bench/dl/vllm-venv/bin/pip install --no-cache-dir "vllm==0.29.0+rocm723" --extra-index-url https://wheels.vllm.ai/rocm/`
   (executed: 12 GB). Then the OpenMPI 4 runtime torch needs, **contained** in `bench/dl/vllm-venv/mpi-libs` (`dpkg -x` of
   libopenmpi3t64 4.1.6, libhwloc15, libevent-pthreads; executed). Keep `/opt/rocm/lib` off `LD_LIBRARY_PATH` (amdsmi clash).
   Details: [install findings](sub-results/host-install-footprint-cost-analysis.md#5-execution-findings-measured-during-the-install-2026-09-11).
2. `hf download RedHatAI/Qwen3.8-27B-INT4 --local-dir ~/models/vllm/Qwen3.8-27B-INT4` (record the revision sha). **No 35B.**
3. User frees the GPU (stops llama-swap etc.).
4. ABI gate: `python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"` + a tiny GPU tensor op.
5. `MTP=0 ./start_vllm.sh start` → `/health` → confirm the chosen MP kernel in the log → two llama-benchy runs with
   `bench/lib/vram_sampler.py` recording → `./start_vllm.sh stop` → confirm port free + VRAM released.
6. `MTP=1` — same.
7. Document via **/benchmark-results** → `docs/analysis/<stamp>-vllm-qwen38-27b-int4.md` (memory column; baseline
   rows labelled indicative), register via `docs/reindex.py`.

**Recommended serve configuration (both arms):**

| Setting | Value | Why / provenance |
|---|---|---|
| env `VLLM_ROCM_USE_AITER` | `0` (already the default) | AITER not built for gfx12 (AMD image `AITER_ROCM_ARCH=gfx942;gfx950`; aiter#3294) — VERIFIED |
| env `HSA_OVERRIDE_GFX_VERSION` | `12.0.1` | repo fixpoint; identity on gfx1201 |
| `--language-model-only` | on | vLLM recipe; skips the vision tower — CLAIMED (recipe) |
| `--dtype` | auto (bf16) | `RDNAHybridW4A16` accepts bf16 — VERIFIED; avoids fp16 overflow risk |
| `--kv-cache-dtype` | auto (bf16) | ~36.9k × 64 KiB ≈ 2.25 GiB — no need for fp8 KV |
| `--max-model-len` | `36864` | 32768 + 2048 + chat-template headroom |
| `--max-num-batched-tokens` | `16384` | 32k prompt in 2 chunks; INFERRED — first tuning knob if prefill disappoints |
| `--max-num-seqs` | small (e.g. 4) | single-stream test; fewer graph capture sizes, less memory — INFERRED |
| `--gpu-memory-utilization` | `0.90` | ~28.7 GiB reservation; vLLM refuses if free memory is lower |
| `--mamba-backend` | `triton` | vLLM recipe — CLAIMED |
| prefix caching | **off** (`--no-enable-prefix-caching`) | benchmark hygiene (plus llama-benchy `--no-cache`) |
| `--enforce-eager` | **not set** | keep CUDA/HIP graphs + torch.compile (July's slow decode was launch-bound) |
| MTP arm | `--speculative-config '{"method":"mtp","num_speculative_tokens":3}'` | recipe — CLAIMED. Corrected: verify M=4 keeps K=5120 matmuls on the HIP skinny kernel, but down_proj (K=17408) goes to Triton for any k ≥ 1 (K·M > 32768 LDS limit) — source, INFERRED routing |

**Measurement (per arm):**
```
B=bench/dl/benchy-venv/bin/llama-benchy; M=~/models/vllm/Qwen3.8-27B-INT4
$B --base-url http://127.0.0.1:8000/v1 --model qwen38-27b-int4 --tokenizer $M --pp 512   --tg 256  --exact-tg --no-cache --runs 3
$B --base-url http://127.0.0.1:8000/v1 --model qwen38-27b-int4 --tokenizer $M --pp 32768 --tg 2048 --exact-tg --no-cache --runs 3
```

**`start_vllm.sh` behaviour (spec, not code):** `start|stop|status`; env `MODEL`, `PORT` (8000), `MTP` (0|1), `VENV`;
pre-flight free-VRAM read that **only refuses** (prints holders, never kills); pidfile + log under
`bench/.servers/<port>.{pid,log}` (rule 14); waits for `/health`; greps the log for the selected MP kernel; `stop`
kills by pidfile and verifies the port is free.

## Resolved Questions

### Q: Research before choosing a config?
- **Decision:** Research now (4 haiku agents + direct verification).
- **Reasoning:** Qwen3.8 and vLLM-on-gfx1201 state are post-cutoff; "good performance from the beginning" needs current facts.
- **Alternatives considered:** GGUF load test on the GPU first; skip research.

### Q: Which checkpoint should vLLM serve?
- **Decision:** RedHatAI/Qwen3.8-27B-INT4 (fallback: SergiioB GPTQ-Int4 G128).
- **Reasoning:** fits memory, keeps the MTP head, passes all `RDNAHybridW4A16` gates, maintainer-published.
- **Alternatives considered:** GPTQ community build; both; FP8 (too big); Unsloth bnb/NVFP4/GGUF (unsupported or slow).

### Q: Which vLLM image / packaging?
- **Decision:** No Docker — host venv; models in `~/models/vllm`.
- **Reasoning:** user wants a very simple engine without a Docker image.
- **Alternatives considered:** 0.23.0 rdna image; 0.19.1 first; 0.19.1 only; 0.23.0 + free GGUF space. The official AMD image `rocm/vllm:rocm10.0.0_ubuntu24.04_py3.14_pytorch_2.12.0_vllm_0.27.0` is documented, not used.

### Q: How is vLLM's start gated on the GPU being free?
- **Decision:** Manual, with a simple start script.
- **Reasoning:** user frees the GPU; nothing is killed automatically.
- **Alternatives considered:** check-only script; `gpu_exclusive.sh` on confirm.

### Q: Which install, given 4 GB is impossible?
- **Decision:** Full pip install (~10.5 GB).
- **Reasoning:** simplest, one command; user accepted the size.
- **Alternatives considered:** trimmed ~5 GB; TheRock + source build.

### Q: How do we get disk headroom?
- **Decision:** Remove the old `rocm/vllm` 0.19.1 image (~50 GB), at go.
- **Reasoning:** user doesn't want Docker for this; image unused; July results already documented.
- **Alternatives considered:** accept ~2 GB free; delete GGUFs.

### Q: Which vLLM MTP arms?
- **Decision:** MTP off + on.
- **Reasoning:** off = like-for-like with the baseline; on = performance-first config.
- **Alternatives considered:** on only; off only.

### Q: What is vLLM compared against?
- **Decision:** Today's b10909 llama-bench numbers, labelled indicative.
- **Reasoning:** zero extra runs.
- **Alternatives considered:** re-measure llama.cpp via llama-benchy (+`--ignore-eos`, MTP off/on); vLLM only.

### Q: Where does the start script live?
- **Decision:** project root `start_vllm.sh`.
- **Reasoning:** user's choice; rule-6 note recorded (no vLLM launcher in the tool layer).
- **Alternatives considered:** `bench/engine-bench/serve_vllm.sh`; one-off run-dir script; documented command only.

### Q: How are the OpenMPI 4 libs the official torch needs provided? (found during execution)
- **Decision:** Contained in the venv — `bench/dl/vllm-venv/mpi-libs` (3 Ubuntu debs unpacked, 10 MB), only that dir on `LD_LIBRARY_PATH`.
- **Reasoning:** no sudo, no system change; `apt install libopenmpi3t64` would install Ubuntu's ROCm 5.7 runtime into `/usr/lib` and could shadow ROCm 10's `libhsa-runtime64.so.1`.
- **Alternatives considered:** system `apt install` (15 packages); a compiled stub library (174 symbols — hack).

### Q: Charts for the write-up? (found during execution)
- **Decision:** Tables only; log the tool gap.
- **Reasoning:** `bench/lib/report.py` charts capture_engine `results.jsonl`, sweeps and quality runs — not llama-benchy JSON; 2 arms × 2 shapes read fine as tables; no edits to shared tools (rule 9). Follow-up recommendation (rule 6): add a `benchy` kind to `report.py` (llama-benchy JSON + `gpu_samples.csv`).
- **Alternatives considered:** extend `report.py` now; an adapter script to `results.jsonl`.

### Q: Where does the venv live?
- **Decision:** Deferred — recommended default: `bench/dl/vllm-venv`.
- **Why deferred:** not asked; low stakes.
- **Unblocked by:** user preference at go.
- **Reasoning for default:** matches `bench/dl/benchy-venv`, already gitignored and on the never-read list.

### Q: `--max-num-batched-tokens` and other serve knobs?
- **Decision:** Deferred — recommended defaults in the config table above (16384, util 0.90, bf16 KV).
- **Why deferred:** only a GPU run can tune them; the brainstorm allowed no GPU work.
- **Unblocked by:** the first MTP-off run (if 32k prefill is far below llama.cpp, raise the chunk size first).
- **Reasoning for default:** safe memory headroom at 36.9k context with CUDA graphs on.

### Q: Repeat boots for the bimodal decode (ROCm#6347)?
- **Decision:** Deferred — recommended default: one extra boot of an arm only if its decode looks like the slow mode.
- **Why deferred:** needs the first numbers.
- **Unblocked by:** MTP-off decode vs the ~33/26 bimodal ratio.
- **Reasoning for default:** cheap insurance without doubling the run.

### Q: Documentation target?
- **Decision:** Deferred — recommended default: `/benchmark-results` → `docs/analysis/<stamp>-vllm-qwen38-27b-int4.md`.
- **Why deferred:** only after data exists.
- **Unblocked by:** the run.
- **Reasoning for default:** repo rule 5 + mandatory memory column.

## Evolution Path

1. **This spike:** 2 arms × 2 shapes, indicative comparison.
2. **If vLLM MTP-on is competitive:** like-for-like llama.cpp re-measure via llama-benchy (`--ignore-eos`, MTP off/on) — about 10 minutes.
3. **Depth and real usage:** ≥ 4-depth curve with a log-log exponent (rule 16), multi-turn growth probe (rule 17),
   and a concurrency sweep (vLLM's actual strength).
4. **Tooling:** fold `start_vllm.sh` into `bench/engine-bench/serve_vllm.sh` (rule 6).
5. **Alternatives unlocked:** g32 AWQ builds; FP8 once aiter#3294 lands; AMD's ROCm-10 stack (matches the host) if the
   ROCm-7.2.3-built torch misbehaves.

## Sources

- https://wheels.vllm.ai/rocm/ (vllm, torch, triton, amd-aiter, flash-attn, amdsmi listings + zip central directories)
- https://raw.githubusercontent.com/vllm-project/vllm/v0.29.0/ — `docker/Dockerfile.rocm_base`, `vllm/model_executor/kernels/linear/__init__.py`, `…/mixed_precision/{rdna_hybrid_w4a16,rdna3_w4a16,triton_w4a16,conch}.py`, `csrc/rocm/skinny_gemms{,_int4}.cu`, `vllm/_aiter_ops.py`, `vllm/envs.py`, `vllm/v1/attention/backends/fa_utils.py`
- https://hub.docker.com/r/rocm/vllm/tags — incl. `rocm10.0.0_ubuntu24.04_py3.14_pytorch_2.12.0_vllm_0.27.0` (registry config blob)
- https://recipes.vllm.ai/Qwen/Qwen3.8-27B
- https://huggingface.co/RedHatAI/Qwen3.8-27B-INT4 · https://huggingface.co/SergiioB/Qwen3.8-27B-GPTQ-Int4-sym-G128-MTP-BF16 · https://huggingface.co/Qwen/Qwen3.8-27B · https://huggingface.co/Qwen/Qwen3.8-27B-FP8 · https://huggingface.co/unsloth (Qwen3.8-27B GGUF/FP8/bnb-4bit/NVFP4) · HF API search "Qwen3.8-27B"
- https://docs.vllm.ai/en/latest/getting_started/installation/gpu/ · https://docs.vllm.ai/en/stable/features/quantization/gguf/
- https://github.com/vllm-project/vllm/issues/36456 · /pull/36740 · /issues/40081 · /issues/28649 · /issues/42960 · /discussions/10326
- https://github.com/ROCm/ROCm/issues/6347 · https://github.com/ROCm/aiter/issues/3294
- https://github.com/huggingface/transformers/pull/43830 · https://github.com/vllm-project/vllm-gguf-plugin
- https://rocm.nightlies.amd.com/v2/gfx120X-all/ · https://repo.amd.com/rocm/whl-multi-arch/
- https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md
- Tier-2 (corroboration only): https://github.com/ivangotoy/llama-server-rdna4-vulkan · https://github.com/daimonionnn/amd-r9700-vllm-and-tuning-toolkit
- Local: `docs/analysis/2026-09-11-1716-llamacpp-b10909-build-check.md` · `docs/analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md` · `docs/research/2026-07-12-2300-rdna4-vllm-aiter-fp8-status.md` · `bench/gguf_kv.py` output · `bench/dl/benchy-venv/…/llama_benchy/*.py` · `bench/engine-bench/serve_llamacpp.sh`
