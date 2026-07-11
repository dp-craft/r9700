---
name: research
description: Gather external knowledge (backends, drivers, tuning, models) for the R9700 / RDNA4 benchmarking repo from authoritative sources, then save a structured, sourced, hallucination-resistant report to docs/research/. Use whenever a session needs facts from the internet — driver/runtime behavior, tuning parameters, model characteristics, someone else's benchmark numbers — before acting on them. Output is always English and always written to a file.
---

# research — sourced, hallucination-resistant external research

Deterministic pipeline: same topic → same report shape, every time. **Every run saves a file.**
Output language: **English**, no exceptions.

## When to use
Before making any claim that isn't already in our own `docs/analysis/` or `results_*.jsonl`.
Driver/runtime behavior, tuning knobs, model specs, or external benchmark numbers → research first.

## Non-negotiables
1. **Provenance tagging.** Every fact is tagged inline: `[MEASURED-BY-US]`, `[CLAIMED:<source>]`,
   or `[INFERRED]`. Never present a `CLAIMED` number as if it were ours.
2. **Whitelist first, corroborate the rest.** Prefer Tier-1 sources below. A Tier-2 claim needs a
   Tier-1 corroboration OR an explicit `low-confidence` flag. If sources conflict, report the
   conflict — do not silently pick one.
3. **No number without a version.** A tok/s figure with no runtime build / driver / model / quant /
   context is unusable — record it or drop it.
4. **If you can't source it, say so.** Write "no authoritative source found" rather than filling
   the gap. Preferred: whitelist. Fallback (only if whitelist is dry): reputable secondary sources,
   flagged `low-confidence`.
5. **Save the file every time**, even for a small query. Report the path back to the user.

## Source whitelist

**Tier 1 — primary / authoritative (default):**
- llama.cpp: `github.com/ggml-org/llama.cpp` — issues, discussions, PRs (perf regressions, flags)
- ollama: `github.com/ollama/ollama` — issues, docs
- ROCm / AMD: `github.com/ROCm/*`, `rocm.docs.amd.com` (rocWMMA, hipBLASLt, rocBLAS, gfx1201)
- vLLM: `github.com/vllm-project/vllm`
- Mesa / RADV / Vulkan: `docs.mesa3d.org`, `gitlab.freedesktop.org/mesa/mesa`
- Models: official HuggingFace model cards (Qwen team, unsloth GGUF repos)
- Benchmarks: `phoronix.com`, `openbenchmarking.org`

**Tier 2 — corroborate or flag `low-confidence`:**
- `r/LocalLLaMA`, technical forums, expert blogs, Medium/Towards AI.
- **Signal of a trustworthy Tier-2 author:** correct, non-trivial jargon (see below). People who
  actually benchmark say "`-ub` sweep", "F32-accumulate regression", "rocWMMA flash-attn",
  "num_batch", "SPIR-V warm-up" — not "make it faster". Jargon-free perf posts are noise.

**Never cite:** SEO listicles, AI-generated content farms, marketing pages, unversioned "X tok/s" screenshots.

## Domain jargon → search keywords (use these to find expert sources)
- **Batching:** batch size `-b`, micro-batch / ubatch `-ub`, `num_batch`, prompt/prefill batch
- **Attention / KV:** flash attention `-fa`, rocWMMA, KV cache quant `q8_0` / `f16` (`-ctk`/`-ctv`), KV heads
- **Decode accel:** MTP, multi-token prediction, speculative decode, draft model, `--spec-type draft-mtp`
- **Backends:** ROCm, HIP, hipBLASLt, rocBLAS, Vulkan, RADV, AMDVLK, Mesa, F32-vs-F16 accumulate
- **HW / precision:** RDNA4, gfx1201, WMMA, FP8 E4M3, FP4, `HSA_OVERRIDE_GFX_VERSION`
- **System:** `power_dpm_force_performance_level`, PCIe ASPM, VRAM ceiling, `-ngl`
- **Models:** MoE, A3B, active params, dense, GGUF, AWQ, Q4_K_M, quantization
- **Metrics:** prefill tok/s, decode tok/s, TG, PP, context length `-c`/`num_ctx`

Combine hardware + jargon for precision, e.g. `gfx1201 llama.cpp -ub prefill regression`,
`RDNA4 RADV vs ROCm flash attention`, `Qwen3 A3B MoE KV heads context`.

## Token policy
Fan out the actual searching/reading to **haiku** subagents (one per source cluster) and ask each
for a compact structured digest with URLs + access date. Synthesize their digests in the main
context. Do not paste raw pages into the main context.

## Process
1. Restate the question and what's already known from our `docs/`/`results_*.jsonl` (don't re-research it).
2. Derive 2–5 targeted queries from the jargon table.
3. Fan out to haiku subagents against Tier-1 sources; expand to Tier-2 only for gaps.
4. Cross-check numbers; record versions; tag provenance; note conflicts and unknowns.
5. Write the report; register it in `docs/INDEX.md`.

## Output contract → `docs/research/YYYY-MM-DD-HHMM-<slug>.md`

**Path is relative to the REPO ROOT** (`/home/dev/work/dp-craft/amd/docs/research/`), never to this
skill's directory — write with an absolute path. (A past run created a stray
`.claude/skills/research/docs/` tree; don't repeat that.)

```markdown
# Research: <topic>

- **Date:** YYYY-MM-DD HH:MM   · **Question:** <one line>
- **Confidence:** high / medium / low   · **Sources:** N (Tier-1: n, Tier-2: m)

## Summary
<3–5 sentences: the answer, the key caveat, what it means for our R9700 work.>

## Key findings
| # | Finding | Provenance | Source | Confidence |
|---|---------|-----------|--------|-----------|
| 1 | ... | CLAIMED / MEASURED / INFERRED | <url> | high/med/low |

## Detail
<Per finding: mechanism, the numbers WITH versions, when it applies / doesn't.>

## Conflicts & unknowns
- <where sources disagree, or what has no authoritative answer yet>

## Actionable for this repo
- <concrete next step: a config to try, a run to add to bench/model-bench|engine-bench/, a claim to verify>

## Sources
- <name> — <url> — accessed YYYY-MM-DD — Tier 1/2 — <what it backed>
```

Filename: date + **HH:MM** + slug (e.g. `2026-07-11-1430-rdna4-vulkan-fa-regression.md`).
After writing: append a one-line entry to `docs/INDEX.md` and report the path to the user.
