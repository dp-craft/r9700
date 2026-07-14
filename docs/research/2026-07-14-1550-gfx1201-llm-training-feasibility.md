# Research: LLM fine-tuning/training feasibility on the R9700 (gfx1201, 32 GB, ROCm 7.x)

<!-- meta
date: 2026-07-14 15:50
question: Can we train (QLoRA/LoRA/full/DPO/GRPO) on the R9700 today, with which stack, and what fits in 32 GB?
confidence: medium-high
sources: 14 (Tier-1: 10, Tier-2: 4)
takeaway: QLoRA on gfx1201 is FEASIBLE but fragile — official ROCm 7.0.2+ support, LLaMA-Factory + AMD bitsandbytes fork is the one proven path (32B QLoRA @ ~28 GiB precedent on R9700); flash-attn/liger/unsloth broken or unofficial; 27B fits only at short seq; LoRA-16bit/DPO/GRPO on 27B do NOT fit 32 GB; train-while-serve impossible.
-->

- **Date:** 2026-07-14 15:50 · **Question:** Which mainstream training stacks work on gfx1201 today, what fits in 32 GB for 27B-class and ~4–8B-class models, and what are the realistic options for a background finetune loop?
- **Confidence:** medium-high · **Sources:** 14 (Tier-1: 10, Tier-2: 4)
- **Companion:** `2026-07-14-1430-radeon-llm-finetune-frameworks.md` (framework-level deep-dive from the same spike)
- **Purpose:** feasibility spike for the AiChatney smart-gateway background finetune loop (distill gateway traces into local model improvements). This doc decides *whether/how*, not *what to train on*.

## Summary

Training on gfx1201 is **officially supported since ROCm 7.0.2** (hipBLAS/rocBLAS gained gfx1201 kernels; PyTorch 2.8–2.9.1 validated on ROCm 7.1–7.2.4) [CLAIMED: ROCm release notes], and there is a **direct precedent on our exact GPU**: the LLaMA-Factory R9700 guide reports Qwen2.5-Coder-32B QLoRA at ~142 tok/s and ~28 GiB VRAM [CLAIMED: LLaMA-Factory #10511], plus a Qwen3-8B QLoRA success on ROCm 7.2.1/Ubuntu 24.04.4 [CLAIMED: Level1Techs, Tier-2]. But the stack is fragile: **bitsandbytes must be the AMD fork or a manual gfx1201 build** (vanilla paged optimizers reportedly corrupt model state silently on ROCm), **flash-attention on gfx1201 is disputed-to-broken** (CK `v_cmp_u_f32` error reported vs. ROCm/flash-attention README claiming RDNA4 backward support with `deterministic=False` — conflict, below), **unsloth is unofficial** (AMD support request open; AMD's own docs flag GPU memory faults with unsloth QLoRA on R9700/RHEL), **liger-kernel broken**, **axolotl/torchtune have no viable Radeon path**. Memory-wise, 32 GB is *QLoRA-native*: 27–32B fits only in 4-bit at seq ≤2k/batch ≤2; 16-bit LoRA on 27B and DPO/GRPO on 27B do **not** fit; 4–8B-class models are comfortable for QLoRA and feasible for DPO. For our loop this means: **the R9700 can finetune, but not while serving** (same 32 GB), so the realistic pattern is nightly-window training of a small model (or the A3B box), with 27B QLoRA as an occasional, fragile, offline job.

## Key findings

| # | Finding | Provenance | Source | Confidence |
|---|---------|-----------|--------|-----------|
| 1 | gfx1201 training officially supported from ROCm 7.0.2 (hipBLAS/rocBLAS kernels); PyTorch 2.8–2.9.1 validated on ROCm 7.1–7.2.4; RDNA4 (gfx1200/1201) named in PyTorch compat matrix incl. FA v3 integration | CLAIMED | rocm.docs.amd.com release notes + PyTorch compatibility matrix | high |
| 2 | Direct R9700 precedent: Qwen2.5-Coder-32B **QLoRA ≈ 28 GiB, ~142 tok/s** — with flash-attn OFF and liger-kernel OFF (both broken on gfx1201) | CLAIMED | github.com/hiyouga/LLaMA-Factory issue #10511 ("R9700 training guide") | high |
| 3 | bitsandbytes: gfx1201 listed in supported RDNA archs, but **no ROCm pip wheels** — manual build (`AMDGPU_TARGETS=gfx1201`) or AMD fork required; reported **silent model-state corruption from paged optimizers** on vanilla ROCm builds | CLAIMED | bitsandbytes releases/discussion #1339; rocm.blogs.amd.com guides (fork requirement) | med (bug itself undocumented upstream) |
| 4 | unsloth: **no official AMD support** (roadmap issue #4496 open); partial success bypassing CUDA checks (#5180); AMD's own limitations page flags **GPU memory access faults** with unsloth QLoRA (Llama-3-8B, RHEL, R9700) | CLAIMED | github.com/unslothai/unsloth #4496, #5180; rocm.docs.amd.com Radeon limitations | high |
| 5 | Frameworks: **LLaMA-Factory = the one production path** (ROCm Docker, active gfx1201 issue engagement); axolotl = no official ROCm guide (PR #1550 unmerged since 2025); torchtune = AMD PR #2536 abandoned | CLAIMED | respective GitHub repos (see companion doc) | high |
| 6 | Flash-attention conflict: ROCm/flash-attention README claims CK backend supports RDNA3/4 with backward pass (`deterministic=False` only) vs. R9700 guide reporting CK `v_cmp_u_f32` invalid-operand failure on gfx1201 → practitioners disable FA | CLAIMED (conflicting) | github.com/ROCm/flash-attention; LLaMA-Factory #10511 | conflict — treat FA-off as the safe default |
| 7 | rocBLASLt Tensile bug: loads `TensileLibrary_lazy_gfx1200.dat` on a gfx1201 GPU → load failure (open) | CLAIMED | github.com/ROCm/rocm-libraries #7192 | med |
| 8 | VRAM budgets (32 GB): 27–32B QLoRA fits at seq ≤2k/batch ≤2 (~22–28 GiB); 27B LoRA-bf16 ≫ 32 GB (impossible); 4B: QLoRA ~4–6 GiB, LoRA/full-FT marginal-to-tight; DPO ≈ 2× SFT (frozen ref model), GRPO ≈ 2–3× + rollout buffers → 27B preference-training does not fit | CLAIMED (aggregator) + INFERRED scaling | Spheron VRAM/PEFT/GRPO guides (Tier-2), unsloth long-context blog | low-med on exact numbers, high on fit/doesn't-fit verdicts |
| 9 | Beyond-QLoRA menu: DoRA (PEFT ≥0.10), PiSSA (PEFT ≥0.11), VeRA (PEFT ≥0.12), LoRA+/rsLoRA (LLaMA-Factory), GaLore/Q-GaLore (experimental in axolotl / external pkg), BAdam (research-stage) — mostly **quality** improvements at similar VRAM to (Q)LoRA, not ways to fit bigger models | CLAIMED | PEFT/LLaMA-Factory docs via aggregator | med |
| 10 | 7900 XTX (gfx1100) precedent: QLoRA works at a 10–20% penalty vs RTX 4090 | CLAIMED | Level1Techs / community reports | low-med (Tier-2) |

## Detail

### Official support vs. practical reality
The support matrix says yes (finding 1), and AMD publishes finetuning guides (torchtune how-to, QLoRA
Llama-2 single-GPU deep-dive, Llama-3.1-8B notebook — all recommending ROCm 7.2.1+, the **AMD
bitsandbytes fork**, and AMD-optimized attention). The practical reality on gfx1201 is a
workaround stack: FA off (finding 6), liger off, custom bitsandbytes (finding 3), and known open
kernel bugs (findings 6, 7). AMD's own limitations page documents Radeon-specific training failures
(finding 4) — Instinct is the first-class training target; Radeon is secondary.

### What fits in 32 GB (decision table for the finetune loop)

| Job | Fits? | Basis |
|---|---|---|
| 27B QLoRA, seq ≤2k, batch 1–2 | ✅ ~22–28 GiB | #10511 measured 32B at ~28 GiB (finding 2) |
| 27B QLoRA, seq 8–16k | ⚠️ only with gradient checkpointing + packing; activation memory scales ~linearly with seq | finding 8 + unsloth long-context blog |
| 27B LoRA (bf16 base) | ❌ | base alone ~54 GiB |
| 27B DPO/GRPO | ❌ | ref-model/rollout multipliers (finding 8) |
| 4–8B QLoRA / LoRA / DPO | ✅ | Qwen3-8B QLoRA precedent on this GPU (Tier-2); budgets in finding 8 |
| Anything while llama-server serves the 27B | ❌ | INFERRED: serving already peaks 30.2 GiB of 32.6 GiB [MEASURED-BY-US, campaigns/2026-07-13-27b-quality-at-depth] |

### Consequences for the gateway's background finetune loop
1. **Same-GPU train-while-serve is out.** The loop must be a scheduled offline window (serving down)
   or run on a second machine. The A3B box (192.168.10.104) is the natural training host for
   small-model jobs *if* it has a capable GPU — unverified, check before planning.
2. **Distill-to-small beats tune-the-big.** Curated gateway traces (hard cases the ladder's top rung
   solved) → QLoRA on a 4–8B student is cheap, proven on this GPU, and the result can serve as a
   draft/fast rung. 27B QLoRA is possible but fragile and monopolizes the box.
3. **Stack to standardize on:** LLaMA-Factory Docker (ROCm 7.2+, PyTorch 2.7.1+), AMD bitsandbytes
   fork, FA off, eager attention, bf16 compute + NF4 base. Follow #10511 as the living guide.
4. **GGUF round-trip:** merge LoRA → convert to GGUF → the existing quality campaign harness
   (capture → grade → judge) is the acceptance gate before any adapter goes live.

## Conflicts & unknowns
- **Flash-attention on gfx1201:** README-claimed (RDNA4 backward, `deterministic=False`) vs. field-reported CK assembly failure. Unresolved; assume OFF.
- **bitsandbytes corruption bug:** referenced via AMD-fork requirement in AMD guides; no upstream issue/post-mortem found. Treat the fork as mandatory, not optional.
- **unsloth ROCm:** one agent-collected claim says "Unsloth 0.7+ has ROCm support" (gfx1100 context, Tier-2) while the official roadmap issue #4496 is still open — the official position is *unsupported*; the Tier-2 claim is flagged low-confidence.
- **MoE (A3B) finetuning on this stack:** no gfx1201 report found for Qwen3.6-A3B-class MoE QLoRA — unknown; would need its own spike.
- **Exact VRAM numbers** (finding 8) come from a Tier-2 aggregator (Spheron); fit/doesn't-fit verdicts are corroborated by the Tier-1 #10511 measurement, the point numbers are not.
- **Second box GPU capability:** unverified assumption; inventory before any training plan.

## Actionable for this repo
- If/when the finetune loop is greenlit: add a `campaigns/` finetune-spike campaign — LLaMA-Factory Docker + AMD bitsandbytes fork, Qwen3-8B (or 4B) QLoRA smoke run, measure wall-time/VRAM/thermals with `vram_sampler.py`, then GGUF round-trip through the existing quality harness. That converts this CLAIMED feasibility into MEASURED.
- Verify the rocBLASLt Tensile workaround state (finding 7) at that time — it may be fixed in a newer ROCm point release.
- Inventory the A3B box's GPU before assigning it the training role.

## Sources
- ROCm 7.0.2 release notes — rocm.docs.amd.com/en/docs-7.0.2/about/release-notes.html — accessed 2026-07-14 — Tier 1 — gfx1201 kernel support
- PyTorch compatibility matrix — rocm.docs.amd.com/en/latest/compatibility/ml-compatibility/pytorch-compatibility.html — accessed 2026-07-14 — Tier 1 — PyTorch/ROCm versions, RDNA4 mentions
- Radeon limitations — rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/limitations/limitationsrad.html — accessed 2026-07-14 — Tier 1 — unsloth QLoRA memory-fault on R9700
- LLaMA-Factory issue #10511 — github.com/hiyouga/LLaMA-Factory/issues/10511 — accessed 2026-07-14 — Tier 1 — R9700 QLoRA guide: 32B @ ~28 GiB, FA/liger broken
- ROCm/rocm-libraries #7192 — github.com/ROCm/rocm-libraries/issues/7192 — accessed 2026-07-14 — Tier 1 — rocBLASLt Tensile gfx1201 bug
- ROCm/flash-attention — github.com/ROCm/flash-attention — accessed 2026-07-14 — Tier 1 — RDNA4 backward claim (`deterministic=False`)
- bitsandbytes releases + discussion #1339 — github.com/bitsandbytes-foundation/bitsandbytes — accessed 2026-07-14 — Tier 1 — gfx1201 arch list, no ROCm wheels, manual build
- unsloth #4496 / #5180 — github.com/unslothai/unsloth — accessed 2026-07-14 — Tier 1 — no official AMD support / partial bypass
- Optimum-AMD overview — huggingface.co/docs/optimum/en/amd/amdgpu/overview — accessed 2026-07-14 — Tier 1 — PEFT/TRL "works where torch works"
- AMD finetuning guides (torchtune how-to, QLoRA Llama-2, Llama-3.1-8B notebook) — rocm.blogs.amd.com / rocm.docs.amd.com ai-developer-hub — accessed 2026-07-14 — Tier 1 — recommended stack + bitsandbytes fork
- ROCm/TransformerEngine #520 — github.com/ROCm/TransformerEngine/issues/520 — accessed 2026-07-14 — Tier 1 — FP8 fallback on gfx1201
- Level1Techs R9700 report — forum.level1techs.com — accessed 2026-07-14 — Tier 2 — Qwen3-8B QLoRA success, ROCm 7.2.1
- Spheron VRAM/PEFT/GRPO guides — spheron.network/blog — accessed 2026-07-14 — Tier 2 (low-confidence numbers) — budget tables, method menu
- unsloth long-context blog — unsloth.ai/blog/long-context — accessed 2026-07-14 — Tier 2 — checkpointing/offload seq-len mitigations
