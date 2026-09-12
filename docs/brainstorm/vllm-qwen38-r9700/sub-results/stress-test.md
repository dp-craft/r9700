# Stress-test — chosen design (A) and alternatives

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** stress-test
**Date:** 2026-09-11

---

Severity: **BLOCKER** · **RISK** · **TRADEOFF** · **NOTE**.

## 3a. Assumptions audit (chosen design A)

| Assumption | Status | If wrong |
|---|---|---|
| Official torch `2.12.0+git6bbd260` (built vs ROCm 7.2.3) runs on host ROCm 10.0 / HIP 7.15 via `/opt/rocm/lib` | **unverified** (sonames match — VERIFIED) | torch import / first kernel fails → fall back to C (TheRock + source build) or B with a different torch |
| vLLM 0.29.0 picks `RDNAHybridW4A16` for RedHat INT4 g128 on gfx1201 | source-verified gates; runtime unverified | falls to Triton/Conch/Exllama → slower; check the server log for the chosen MP kernel |
| `wvSplitK_int4_g` is compiled for gfx1201 in the wheel | source `__HIP__GFX1X__` + arch list include gfx1201 (VERIFIED) | decode on Triton path |
| MTP works with the Gated-DeltaNet hybrid on ROCm | CLAIMED (recipe) — not seen on ROCm | MTP arm fails/crashes → report MTP-off only |
| pip resolves the ROCm wheels, not PyPI CUDA `vllm-0.29.0` | INFERRED (local version `+rocm723` sorts higher) | CUDA torch installed → nothing runs; mitigate by pinning `vllm==0.29.0+rocm723` |
| 36,864-token max-model-len + bf16 KV fits in `--gpu-memory-utilization 0.90` | INFERRED: 19.5 GB weights (less vision with `--language-model-only`) + ~2.3 GB KV + graphs/activations | lower `--max-num-batched-tokens`, then util |
| GPU is freed manually before boot | user decision | vLLM refuses at startup (free < util × total); script's pre-flight read refuses earlier |

## 3b. Failure modes

| Finding | Severity | Approach(es) | Blast radius / mitigation |
|---|---|---|---|
| Disk: model + full venv leaves ~2 GB on `/` — **overstated**: `~/models` is on `/mnt/LinBackup` (separate partition), so `/` keeps ~33 GB after the venv; image removal executed (freed ~13 GB) | NOTE (was BLOCKER) | A, B | install with `pip --no-cache-dir` |
| ROCm 7.2.3-built torch on host ROCm 10.0 | **RISK — partly materialised, resolved at link level** | A, B | hit as (1) missing OpenMPI 4 runtime → contained libs in `bench/dl/vllm-venv/mpi-libs`, (2) amdsmi lib clash when `/opt/rocm/lib` is on `LD_LIBRARY_PATH` → kept off; torch + vLLM extensions now import against host ROCm 10 libs. GPU-level check pending |
| ROCm#6347 bimodal decode (33 vs 26 t/s per process spawn) | **RISK** | all vLLM | 2 boots are 2 *different* configs, not repeats → a slow-mode boot is indistinguishable from a slow config; mitigation: if decode lands near the slow-mode ratio, one cheap re-boot of that arm |
| First-boot Triton/torch.compile JIT (~15–20 min CLAIMED) | **TRADEOFF** | all vLLM | caches in `~/.cache/vllm`, `~/.triton` persist; second arm boots faster |
| Wrong kernel selected silently | **RISK** | A, B, C | perf looks like July; mitigation: grep server log for the MP kernel name and record it in the report |
| MTP verify leaves the HIP skinny kernel for down_proj (K=17408) at any k ≥ 1 (routing needs K·M ≤ 32768) — corrected during execution; the "k ≤ 4" note was incomplete | **NOTE** | MTP arm | keep k=3 (recipe); read τ + decode together |
| Attention decode on Triton (RDNA custom paged attention needs head_size 128 + block 16; model has 256 / 1568) | **NOTE** | all vLLM | structural for this model on 0.29.0 |
| Orphaned vLLM server holds ~29 GB and fakes later findings (2026-07-15 class) | **RISK** | all | `start_vllm.sh` must use a pidfile + `stop` + port-free check (rule 14) |
| Interrupted llama-benchy run enters the data | **RISK** | all | rule 18: quarantine partial runs |

## 3c. Architectural ripple effects
- New root file `start_vllm.sh` (user's choice) — outside the `bench/` tool layer; rule 6 note: no repo tool
  launches vLLM (`serve_llamacpp.sh` is llama.cpp-only). Later fold-in candidate: `bench/engine-bench/serve_vllm.sh`.
- New venv (recommended `bench/dl/vllm-venv`, gitignored) and model dir `~/models/vllm` (outside repo).
- No change to existing tools, campaigns or llama-swap config. llama-swap must be stopped **by the user**.
- Docker image removal is outside the repo; July's report remains valid documentation.

## 3d. Second-order consequences
- Enables: any future vLLM test on this card (same venv), concurrency tests (vLLM's real strength), the g32 AWQ
  builds, FP8 once aiter#3294 lands.
- Debt: a root-level script outside the tool registry; a baseline measured with a different harness.
- If vLLM wins decode with MTP but loses prefill, the natural next question is llama.cpp **with** MTP via the
  same llama-benchy → the "re-measure llama.cpp" option comes back.

## 3e. What we give up
- Like-for-like comparison (user chose indicative baseline) — costs ~10 min of extra boots to get later.
- The 4 GB footprint (user overrode).
- Rule-16 depth curve — two single points only (raised once, user's shapes stand).
- 80 % version: MTP-on arm only + one llama-benchy pass would answer "is vLLM worth it?" at half the time, but
  loses the like-for-like MTP-off row.

## Expected outcome (INFERRED — for sanity-checking results, not a claim)
Decode of a dense 27B at 4-bit is weight-bandwidth-bound: ~14 GB INT4 language-model weights + ~2.5 GB BF16
lm_head read per token; at a spec-level ~640 GB/s (256-bit GDDR6 @ 20 Gbps, not measured) the ceiling is roughly
~40 t/s. llama.cpp's 28–30 t/s is ~70–75 % of that. **vLLM MTP-off should land at or below llama.cpp; only the
MTP arm can plausibly beat 30 t/s.** Prefill on the Triton W4A16 path is the big unknown. A decode far below 20 t/s
= kernel fallback or slow bimodal mode, not "vLLM is slow".
