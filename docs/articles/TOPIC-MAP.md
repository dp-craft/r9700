# Topic map — what the repo knows, how sure it is, and what to do next

**Date:** 2026-11-16. **Sources:** `docs/catalog.jsonl` (99 docs, via the script-made prep table), `docs/articles/CANDIDATES.md`
(15 article candidates C1–C15, 41 errata entries in its §4), the campaign tree under `campaigns/`, and a few spot checks in source docs.
**Relation to the other files:** `docs/CATALOG.md` says *where* a fact lives; `docs/articles/CANDIDATES.md` holds the
*article plans* (thesis, outline, evidence map, errata). This file groups the 99 docs into 24 reader questions (topics),
rates trust, names gaps, and ends in a ranked shortlist. It cites candidates as C1…C15 without repeating their evidence maps.

Provenance follows iron rule 1: every number is `MEASURED`, `CLAIMED` or `INFERRED` and carries a doc label
(`YYYY-MM-DD slug`, as the catalog prints it). All cost and effort estimates are `INFERRED`. Model names are kept as each doc
uses them: Qwen3.6-27B and Qwen3.8-27B are different checkpoints, and so are Ornith-1.0-35B and Ornith 1.5.

---

## 1. How to decide

Every option below falls into one of four tracks. Pick by readiness first, then value, then cost.

| Track | Fits when | Typical cost (`INFERRED`) | Output |
|---|---|---|---|
| **A. Write now** | CANDIDATES marks it *ready*; every quoted number is tagged and from a named doc; no open erratum changes a number, verdict or tag it quotes. Wording-only errata (path, stale cross-note, label) and errata sidestepped by quoting one named source do not block; §6 names them per pick as "fix first" (≤1 h) | S: 3–5 h writing; M: 6–10 h; GPU 0 | article in `docs/articles/` |
| **B. Fix docs, then write** | An open erratum (CANDIDATES §4) changes a number, verdict or tag the piece would quote, so the source doc must be corrected first | 1–3 h of doc fixes + `docs/reindex.py` and a catalog refresh, then track A | corrected findings + article |
| **C. Measure, then write** | The headline rests on one depth, n=1, a per-build rate from a build four or more releases old, or was never measured (rules 2, 16, 17, 18); a ratio replicated on several engines is not a per-build rate | 1–2 h design (benchmark-new-campaign skill); GPU 0.5–10 h (arms-speed minimal tier: 7–8 h); 3–6 h write-up | campaign + findings doc, then an article |
| **D. Research or tool work** | The answer is external (`CLAIMED` only), a tool cannot do the job, or an incident lives only in CLAUDE.md prose | 2–6 h; GPU 0 | research note, tool change, or a findings note for an incident |

**Criteria, in order:** (1) *value* — who changes a setting or purchase because of it; (2) *readiness* — errata and missing
rows between evidence and text; (3) *cost* — writing plus GPU hours (GPU can run overnight beside writing); (4) *risk* —
version drift, n=1, checkpoint naming; (5) *unblocks* — how many topics or candidates it feeds.

---

## 2. Topic overview

Maturity: **solid** = repeated or multi-depth `MEASURED` evidence on a current-enough stack; **partial** = real data with
named holes; **thin** = one or two docs, n=1, or mostly `CLAIMED`; **stale** = solid once, but the build or model has moved.
Size: S ≤ half a day, M ≈ 1–2 days, L > 2 days (`INFERRED`).

| id | topic (reader question) | docs | what we know (headline) | maturity | article options | main gap | next action + size | value |
|---|---|---|---|---|---|---|---|---|
| T01 | What is the fastest llama.cpp config on this card? | 5 · 2026-07-10 rdna4-r9700-tuning-optimum, 2026-07-11 sweep-35b-rocm-vs-vulkan | Vulkan prefill peaks at `-ub 2048` (3372 tok/s; 4096 is −19.6%), FA on +5.6% (`MEASURED`, 2026-07-11 sweep-35b-rocm-vs-vulkan) | stale | how-to section of C14; new short "tuning on b11448" note | the sweep is Qwen3.6 on b9950; production is Qwen3.8-27B on b11448 | re-run `sweep.py` on the production model and build (C, M) | every llama.cpp operator on RDNA4 |
| T02 | Vulkan or ROCm? | 9 · 2026-09-11 llamacpp-b10909-build-check, 2026-09-15 stew675-buildcmp, 2026-07-19 ornith-vs-gemma | a build bump moved ROCm prefill +40.2% at 30720 (b10375 → b10909, 489.6 → 686.2) and Vulkan +4.0%, so the backend gap depends on the build (`MEASURED`, 2026-09-11 llamacpp-b10909-build-check) | partial | C14 | no same-commit Vulkan vs ROCm curve at ≥4 depths on a current build | 4-depth same-commit curve, one dense + one MoE (C, M) | backend choice for any llama.cpp user |
| T03 | Is the newest llama.cpp build safe to promote? | 14 · 2026-10-07 llamacpp-b11448-build-check, 2026-10-08 llamacpp-b11448-build-check (15:55) | the promoted `latest-vulkan` b11448 was checked only up to the 2048/512 shape at r=2: 19.1 → 19.0 s, NEUTRAL (`MEASURED`, 2026-10-07 llamacpp-b11448-build-check) | partial | feeds C14, C4, C13; no standalone piece | no 32k shape on the promoted build; ROCm 10.1 stew675 rebuild failed three times (exit 134), a fourth check contradicts which arm fails | one 32768/2048 compare b10969 → b11448 Vulkan (C, S) | protects every later number |
| T04 | MTP and draft knobs on llama.cpp: what helps, what costs | 9 · 2026-07-16 mtp-sampler-tax, 2026-09-11 benchy-ideas-27b | any penalty sampler costs ~2 ms/token; 35B MTP-on decode 161.1 → 115.1 tok/s (−28.6%) with a byte-identical reply (`MEASURED`, 2026-07-16 mtp-sampler-tax) | solid (b9950) | C1; published July articles (2.25x is cross-file; same-file MTP 2.0x) | ~2 ms is a b9950 number | one pp 0 vs 0.01 pair on b11448 (C, S), then write C1 (A, S) | speculative-decoding operators |
| T05 | Is q8_0 KV free? | 8 · 2026-07-11 deep-context-35b, 2026-09-11 benchy-ideas-27b, 2026-11-09 27b-arms-kld | quality: no resolved KL cost (Qwen3.8-27B Q6_K), but per-task TS drops at 128k (lru-cache 78 → 47); speed: −39.8% prefill at 200K on b9950, tie to 18.4k on b10909 (all `MEASURED`: 2026-11-09 27b-arms-kld; 2026-07-13 27b-quality-at-depth-detailed; 2026-07-11 deep-context-35b; 2026-09-11 benchy-ideas-27b) | stale | C12 | no f16 vs q8_0 curve on b11448 at ≥4 depths | 8k–160k curve, both KV types, one model (C, M) | context sizing on 32 GB |
| T06 | How much context fits, per model and engine? | 6 · 2026-07-12 27b-maxctx-f16, 2026-09-12 vllm-window-budgets-and-rocm-knobs, 2026-10-22 vllm-sly-mxfp4-dflash-170k | the 27B is hybrid: f16 KV 64 KiB/tok (`INFERRED`); a 200K f16 load succeeded, its 29.0 GiB is unsampled (2026-07-12 27b-maxctx-f16, superseded) | partial | C4 §5 (formula error); new how-to "sizing a window on 32 GB" | no one table of measured ceilings per model × engine; `gguf_kv.py` cannot size gemma4 | capacity table from existing boot logs (D, S) + gemma4 support in the tool (D, S) | anyone choosing a model or ctx |
| T07 | Do engine rankings hold across depth? | 7 · 2026-09-10 hipfire-final-analysis, 2026-09-12 vllm-window-budgets-and-rocm-knobs | prefill exponents llama.cpp f16 −0.294 vs hipfire default −1.324; 901 vs 469 tok/s at 18k, 594 vs 80.5 at 73k (`MEASURED`, 2026-09-10 hipfire-final-analysis) | partial | C7 | Sly/Radiance vs llama.cpp b11448 never compared on one model at ≥4 depths | run the scaffolded arms-speed campaign (C, M: ~7–8 h minimal tier) | engine evaluators |
| T08 | What decides agentic latency: prefill or prefix reuse? | 4 · 2026-07-13 27b-serving-substrate, 2026-10-22 vllm-sly-mxfp4-depth | a warm 32K prefix cut TTFT 42.66 s → 3.12 s (13.7x, identical prompt) (`MEASURED`, 2026-07-13 27b-serving-substrate) | solid | C2 | a turn that appends thousands of new tokens on llama.cpp (only a ~25-token changed tail was probed); two-agent cache sharing beyond hipfire | write C2 now (A, S) | agent builders |
| T09 | vLLM forks (Sly, native Radiance) on RDNA4: what to set | 17 · 2026-11-04 ornith15-radiance-vs-sly-35b-27b, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth | one flag (`--moe-backend triton_unfused`) took Qwen3.5-35B-A3B MXFP4 decode 16.6 → 110.2 tok/s at 10k (`MEASURED`, 2026-11-04 ornith15-radiance-vs-sly-35b-27b) | partial | C3; C8, C10 sides | 3 depths only in the Ornith 1.5 / 35B comparison (the 27B δ 0 curve has 4); 27B Sly decode 122.3 / 100.2 / 86.9 unreconciled; triton_unfused correctness untested | write C3 (A, M), optional correctness check first (C, S); arms-speed campaign (C, M) | vLLM/Radiance operators on AMD |
| T10 | Is hipfire worth adopting? | 4 · 2026-09-10 hipfire-final-analysis, 2026-09-10 hipfire-bench-rocm713-final | decode +81% at short context (120.00 vs 66.32 tok/s) but prefill collapses at depth (`MEASURED`, 2026-09-10 hipfire-bench-rocm713-final) | stale | C7 §2; short "why we did not adopt" note | 0.3.0-beta only; residency incident undocumented | none until a new release (park) | engine evaluators |
| T11 | Does lossy speculative acceptance pay off in agent loops? | 5 · 2026-10-31 redhat191-sharp-w208-blind, 2026-10-31 reasoning-replay-sharp-template-cactus-loops | δ 0.5: decode +65% but 2.4x wall and 4.1x tokens (`MEASURED`, 2026-10-31 redhat191-sharp-w208-blind) | partial | C8 | n=1 per arm; quality drop sits on the threshold | second δ 0.5 rep (C, M), or a case study once the 0900 decode conflict is fixed or avoided (B) | spec-decoding and agent users |
| T12 | Why do engines fault, and how do we know? | 8 · 2026-10-23 vllm-gpu-fault-solved-hip-kernarg, 2026-10-07 rocm-fa-hsa-memory-fault | `HIP_FORCE_DEV_KERNARG=0`: 3/3 boots × 4 turns clean after ~12 of ~21 boots faulted (`MEASURED`, 2026-10-23 vllm-gpu-fault-solved-hip-kernarg) | partial | C10 | n=3, kernel -34 only; llama.cpp ROCm `-fa on` fault not tested with the same variable | fix three cross-note wordings, write C10 (A, M); kernarg test on the llama.cpp FA fault (C, S) | ROCm users, HIP developers |
| T13 | Which driver/OS stack, and what does an upgrade break? | 5 · 2026-10-07 rocm-10.1-vs-10.0-7.13, driver-upgrade-runbook | both ROCm llama.cpp builds load core-10.0 although 10.1 is active (`MEASURED`, 2026-10-07 rocm-10.1-vs-10.0-7.13) | thin | C14 sidebar | kernel -34 vs -38 attribution test pending; runbook headline `CLAIMED` from an off-repo log | commit the CASK log; run the reboot test (D/C, S); rebuild the ROCm llama.cpp builds against core-10.1 (C, S) | anyone upgrading ROCm/Mesa |
| T14 | How far is each quant from Q8_0 (KLD)? | 4 · 2026-11-09 27b-arms-kld | all six MXFP4 arms sit at KL 0.056–0.066, about 7–8x the IQ4R-L-V4 arm (`MEASURED`, 2026-11-09 27b-arms-kld) | solid (distance ranking) | C5 | short contexts only; KL is closeness to Q8_0, not task quality; count errata | fix the KLD errata (B, S); KL at depth (C, L) | quant choosers, KL method builders |
| T15 | Which local model codes best? | 8 · 2026-07-14 hardest-tasks-27b-vs-35b, 2026-07-19 ornith-vs-gemma | Qwen3.6-35B-A3B 73.3% vs Ornith-1.0-35B 62.2% TS at ~120k, t=−1.16, not resolved (`MEASURED`, 2026-07-19 ornith-vs-gemma) | partial | C9 §7; new "model choice" piece after data | three of the four current models (Qwen3.8-27B, Ornith 1.5, Qwen3.5-35B-A3B) never ran the TS-TDD suite; only Qwen3.6-35B-A3B has a score | hardest-tasks on the production trio (C, L) | everyone picking a local coder |
| T16 | Thinking budget and sampler at depth | 16 · 2026-07-14 hardest-tasks-27b-vs-35b, 2026-07-13 27b-quality-at-depth-detailed, 4 published articles | 4x the 27B budget (4096 → 16384) moved TS by +0.3 pts (t=0.37) and cost +60 s per reply (`MEASURED`, 2026-07-14 hardest-tasks-27b-vs-35b) | solid at 128k / partial for the shallow cap (Qwen3.6, b9950) | C9 (direct follow-up to the published four) | recommendation-doc errata; Qwen3.6 only; the 1024 cap is shallow-only (at 64k it is 11 pts below 4096) | fix errata, write C9 (B, M) | readers of the July articles |
| T17 | Does long-context recall survive at 131K? | 1 · 2026-09-02 mrcr-v2-qwen38-27b-q6k | MRCR v2 8-needle 0.8500 (n=35, CI ±0.113) on Qwen3.8-27B UD-Q6_K (`MEASURED`, 2026-09-02 mrcr-v2-qwen38-27b-q6k) | partial | C11 | one bucket, one quant, one run | fix errata, write C11 (B, S); 64K bucket (C, M) | long-context planners |
| T18 | A local 27B in a real agentic loop: review quality and token cost | 10 · 2026-10-31 agentic-thinking-volume-and-levers, 2026-10-31 redhat-sharp-w208-blind | a chat-template swap alone cut thinking 38% and tool calls 35% (`MEASURED`, n=1, 2026-10-31 redhat-sharp-w208-blind) | thin | C15 | n=1 everywhere; dp-sharp V2 grade pending | ~8–9 runs per arm on one template pair to resolve a 20% step gap (`INFERRED` power; 3 per arm only estimates variance) (C, L); the authoritative V2 grade (D, S) | agent-harness and template engineers |
| T19 | What to hand a free local worker vs Haiku | 5 · 2026-11-05 ornith-use-cases, 2026-11-04 sly-radiance-ornith-vs-haiku-high-effort | Ornith 1.5 put 32/35 facts on the exact line, 0 invented, at 117k (`MEASURED`, 2026-11-04 sly-radiance-ornith-vs-haiku-high-effort) | partial | C6 | mostly n=1; 3 depths for speed | write C6 now (A, M) | operators splitting local vs API work |
| T20 | How many agents per card? | 4 · 2026-07-11 campaign-combo35b, 2026-11-06 ornith-manual | at 4 streams MTP lowers per-stream decode 8% (Vulkan 47.5 → 43.5 tok/s, MTP off → on) (`MEASURED`, 2026-07-11 campaign-combo35b) | thin | C7/C1 section; new piece after data | no np × depth grid on any current stack; one campaign undocumented | arms-speed n=2 cells (C, part of M); doc the batched-2x32k campaign (D, S) | multi-agent users |
| T21 | Power, clocks and efficiency | 5 · 2026-07-10 rdna4-r9700-tuning-optimum, 2026-07-16 mtp-sampler-tax | forcing dpm=high cost −20% prefill and −11% decode (`MEASURED`, 2026-07-10 rdna4-r9700-tuning-optimum) | thin | new piece (perf per watt) | no tok/J or power-cap sweep; power is a side column everywhere | power-cap sweep 150–300 W at 3–4 depths (C, M) | desktop and electricity-cost readers |
| T22 | Can we trust our numbers? (instruments and method) | 14 · 2026-07-13 27b-quality-at-depth-detailed, 2026-07-27 runner-benchmark-unified, GUIDE | the same 120 answers scored 24–33% under a grader that never ran vitest and 67–79% after a re-grade (`MEASURED`, 2026-07-13 27b-quality-at-depth-detailed) | solid (method) / partial (numbers) | C4 | GUIDE pins b9949/b9950; runner-doc count errata | write C4 (A, M); refresh GUIDE (B, S) | anyone publishing local benchmarks |
| T23 | Silent GPU contention on a desktop-shared card | 6 · known-issues, 2026-10-08 llamacpp-b11448-build-check (15:55) | native Radiance default headroom left 113 MiB free at peak; the desktop crashed ~7 min later (`MEASURED`; cause `INFERRED`, known-issues) | partial | C13 | four incidents exist only in CLAUDE.md | findings note citing the discarded rows (D, S) | workstation operators |
| T24 | Can this card fine-tune? | 2 · 2026-07-14 gfx1201-llm-training-feasibility | serving the 27B already peaks 30.2 of 32.6 GiB, so train-while-serve is out (`MEASURED`, 2026-07-14 gfx1201-llm-training-feasibility); the rest is `CLAIMED` | thin | parked | no training run on this box | one QLoRA smoke run on an 8B (C, M) | owners wanting a local fine-tune loop |

Doc counts = the appendix mappings (up to three topics per doc). A card's Docs line may add docs marked *(secondary)*: cited for context, mapped to other topics in the appendix and not counted here.

---

## 3. Topic cards

*Linked* lists topics that share data with the card; it is context, not an order (several pairs link both ways). The order is §6.

### T01 — What is the fastest llama.cpp config on this card?
- **Docs:** 2026-07-10 rdna4-r9700-tuning-optimum (partial), 2026-07-11 sweep-35b-rocm-vs-vulkan, 2026-07-09 runtime-benchmark-r9700 (partial, HU, superseded for these models), 2026-07-10 rdna4-llamacpp-ollama-backend-tuning (research), 2026-10-07 rdna4-llama-cpp-vulkan-compile-settings (research, partial).
- **What we know:**
  - Vulkan prefill optimum `-ub 2048` (3372 tok/s), ROCm `-ub 4096` (3880); FA on +9.1% ROCm, +5.6% Vulkan, no decode cost (`MEASURED`, 2026-07-11 sweep-35b-rocm-vs-vulkan, Qwen3.6-35B-A3B).
  - MTP is the largest decode lever on the 27B: 31.7 → 73.5 tok/s, prefill 906 → 854 (`MEASURED`, 2026-07-10 rdna4-r9700-tuning-optimum, Qwen3.6-27B).
  - ollama prefilled ~2x faster than llama.cpp ROCm on the 30B coder (2526 vs 1112 tok/s) (`MEASURED`); the GEMM-library cause is `INFERRED` (2026-07-09 runtime-benchmark-r9700).
  - `GGML_VK_SUBALLOCATION_BLOCK_SIZE=4294967296` fixes a ~78% decode cliff at 131072 ctx (`CLAIMED`, issue 27734, 2026-10-07 rdna4-llama-cpp-vulkan-compile-settings) — never tested here.
- **Status and trust:** the Vulkan numbers are b9950 (July) on Qwen3.6; the July ROCm arm is lemonade b1295 (its b9949-rocm directory is called b9950 elsewhere). The served stack is Qwen3.8-27B on b11448. The 1810 "64K" is the window, the prompt is ~7k (CANDIDATES §4). CLAUDE.md's quoted fastest config (`-ub 2048 -b 8192 -fa on`) has no current-build sweep behind it.
- **Possibilities:** a short how-to "tuning llama.cpp on RDNA4 in 2026" once re-measured; otherwise a section of C14.
- **Gaps:** re-sweep on b11448 with the production model; the undocumented campaign `campaigns/perf/2026-07-11-1738-sweep-27b-micro` (4 result files) never got a write-up; the compile-settings doc's bench step 3b is pending.
- **Ideas:** `bench/perf/model-bench/sweep.py` on Qwen3.8-27B Q4_K_XL, Vulkan b11448, depths 0/16k/32k/64k, ub {1024, 2048, 4096}, b {4096, 8192}, KV q8_0 and f16, r=3; add the suballocation env var as one arm.
- **Linked:** T03 (which build), T05 (KV choice).

### T02 — Vulkan or ROCm?
- **Docs:** 2026-07-10 rdna4-r9700-tuning-optimum, 2026-07-11 sweep-35b-rocm-vs-vulkan, 2026-09-11 llamacpp-b10909-build-check (15:37), 2026-09-15 stew675-buildcmp (partial), 2026-09-15 muse-glimmer-vulkan-vs-rocm (partial, confounded), 2026-07-19 ornith-vs-gemma, 2026-10-07 rocm-10.1-vs-10.0-7.13, 2026-07-09 runtime-benchmark-r9700, 2026-07-10 rdna4-llamacpp-ollama-backend-tuning.
- **What we know:**
  - The July row "Vulkan 3221 vs ROCm 1927 prefill, 114.3 vs 78.4 decode" (`MEASURED`, 2026-07-10 rdna4-r9700-tuning-optimum, ~7k prompt) is not a backend verdict: blobs and ROCm build are unmatched (that doc's problem list).
  - One binary sweep, depth flips it: ROCm leads pp8192 at depth 0 (3880 vs 3381), Vulkan leads at depth 32768 (2166 vs 1412) (`MEASURED`, 2026-07-11 sweep-35b-rocm-vs-vulkan).
  - The stew675 patch: ROCm prefill +20.1% at 32768, Vulkan −11.9% (`MEASURED`, REPS=1, 2026-09-15 stew675-buildcmp).
  - Gemma-4-31B device-losts on RADV at ~65.5k (ctx 163840); ROCm completes (`MEASURED`, 2026-07-19 ornith-vs-gemma).
- **Status and trust:** single reps on the patch numbers; build labels conflict (b9949-rocm called b1295 and b9950); muse-glimmer confounds backend and build. Current `latest-rocm` is the stew675 fork linked to ROCm 10.0.
- **Possibilities:** C14 (long-form decision table, series A part 5). Needs new data first.
- **Gaps:** a same-commit Vulkan vs ROCm curve at ≥4 depths on a current build, dense and MoE; Gemma on RADV 26.2.4 was never re-tested after the Mesa upgrade.
- **Ideas:** campaign: b11448 Vulkan vs b11448 ROCm (stock) vs stew675 ROCm, Qwen3.8-27B Q4_K_XL and Qwen3.6-35B-A3B, depths 8k/32k/64k/128k, reps 3, prefill + decode exponents. Gemma re-test on RADV with `gpu_exclusive.sh` first and a watchdog (risk: GUI crash). Test the `CLAIMED` rule "ROCm is stronger for dense models above ~20B" (2026-07-10 rdna4-llamacpp-ollama-backend-tuning) with that dense + MoE pair.
- **Linked:** T03, T13.

### T03 — Is the newest llama.cpp build safe to promote?
- **Docs:** all 13 build checks in `docs/findings/llamacpp/build-checks/` (5 current, 3 partial, 5 negative), plus 2026-10-07 rdna4-llama-cpp-vulkan-compile-settings.
- **What we know:**
  - b10909 lifted ROCm prefill +40.2% at 30720 and cut a 32k-in/2k-out ROCm request 14.6% (`MEASURED`, 2026-09-11 llamacpp-b10909-build-check, 15:37 and 17:16).
  - b10969 and the Vulkan SDK 1.4.363.0 rebuild were flat in every cell (`MEASURED`, 2026-09-14 llamacpp-b10969-build-check; 2026-10-07 llamacpp-b10969-vulkan-1.4.363.0-build-check).
  - The stew675 ROCm 10.1 rebuild failed its bench with exit 134 on three attempts (2026-10-07 12:21; 2026-10-08 13:11, 14:36); the 13:26 check has the baseline arm failing and the 10.1 arm with a memory record (`MEASURED`, stew675-10.1 build checks).
  - b11448-rocm prefill ~15% below stew675 at 8192 (1369 → 1159 tok/s) (`MEASURED`, single manual pass, 2026-10-08 llamacpp-b11448-build-check 15:55); the second ROCm arm of a sequential compare faults on its first kernel even on a clean GPU (`MEASURED`, same doc).
  - Undocumented: the 2x32k batched compare shows b10909 prefill +15.5% Vulkan and +36.6% ROCm, request −7.5% / −15.1% (`MEASURED`, `campaigns/build-check/2026-09-11-1756-batched-2x32k/results/summary.md`, no findings doc).
- **Status and trust:** the pipeline works and is versioned; the weak point is depth. The promoted b11448 Vulkan check stopped at 2048/512 at r=2, and its 128/64 cell carries ±277.6 tok/s noise. The 10-08 ROCm checks disagree about which arm failed (CANDIDATES §4).
- **Possibilities:** no standalone article; feeds C14 (build drift) and C4/C13 (failed arms, state leak).
- **Gaps:** a 32768/2048 shape on the promoted Vulkan build; write up (or fold into a doc) the batched-2x32k campaign; resolve the 10-08 contradiction.
- **Ideas:** recommend (rule 9) that `bench/build-check/compare_builds.py` refuse PROMOTE when `--shapes` drops the 32768 shape. It already runs `gpu_exclusive.sh` and an idle-VRAM check before each arm, so the open problem is the second-arm fault (T12), not a missing gate.
- **Linked:** T12 (the state-leak fault), T23.

### T04 — MTP and draft knobs on llama.cpp: what helps, what costs
- **Docs:** 2026-07-16 mtp-sampler-tax, 2026-07-16 spec-draft-p-min-mtp (superseded research), 2026-09-11 benchy-ideas-27b, 2026-07-11 campaign-combo35b, 2026-07-13 27b-serving-substrate, the published 27b-coding-model-on-one-amd-card and assumptions-vs-reality with their LinkedIn twins; 2026-07-10 rdna4-r9700-tuning-optimum and 2026-07-11 deep-context-35b (secondary).
- **What we know:**
  - MTP on vs off on the same GGUF: 2.0x decode at 32K, 27.8 → 55.2 tok/s (`MEASURED`, 2026-07-13 27b-serving-substrate). The published 2.25x (70.3 vs 31.1, 100% deterministic accuracy on 11 tasks) compares an unsloth MTP file with a jackrong no-MTP file, reps=1, shallow (`MEASURED`, 2026-07-16 27b-coding-model-on-one-amd-card): not an MTP-only effect.
  - MTP is not output-preserving: at seed 42 MTP on and off emit different text (sha1 e40c532d vs 30303b0c) (`MEASURED`, 2026-07-16 mtp-sampler-tax), so the published "pure win" heading should read "no task-accuracy cost".
  - The penalty-sampler tax: ~2 ms/token, depth-invariant to ~132.9k (`MEASURED`, 2026-07-16 mtp-sampler-tax).
  - Drafting past 3 tokens loses: n-max 8 decodes 80.2 vs 107.6 tok/s with MTP off (`MEASURED`, 2026-07-16 mtp-sampler-tax); 3 → 5 drafts cost −11.4% at depth 0 on b10909 (`MEASURED`, 2026-09-11 benchy-ideas-27b).
  - MTP's decode gain grows with depth (+14.5% at 8K → +35.1% at 200K) yet costs wall time at 200K for a short answer (`MEASURED`, 3 depths, 2026-07-11 deep-context-35b).
- **Status and trust:** strong and repeated across two builds; scouting cells are n=1–2 at ctx 4096. The ~2 ms figure is Ryzen 5 3600 + b9950.
- **Possibilities:** C1 (S, after the b11448 confirm pair, series A part 2); MTP-under-concurrency is a C7/T20 section.
- **Gaps:** one confirm pair on b11448; hardest-tasks' acceptance 81.5 → 77.4 vs sampler-tax 83 → 66 are different measurements (name which one). Undocumented campaign `campaigns/perf/2026-07-31-1727-27b-q4-mtp-depth` (Qwen3.6-27B Q4 MTP with q8_0 KV at 12k/64k/128k) has rows and no write-up.
- **Ideas:** fold the 2026-07-31 depth rows into a short MTP-at-depth note after checking them; test MTP on Gemma-4-31B with its 280 MB drafter (CLAUDE.md lists it as untested).
- **Linked:** T03 (build), T20 (concurrency reversal).

### T05 — Is q8_0 KV free?
- **Docs:** 2026-07-13 27b-serving-substrate, 2026-07-11 deep-context-35b, 2026-07-11 sweep-35b-rocm-vs-vulkan, 2026-09-11 benchy-ideas-27b, 2026-11-09 27b-arms-kld, 2026-07-14 hardest-tasks-27b-vs-35b, 2026-07-13 27b-quality-at-depth-detailed, 2026-10-31 kv-cache-quantization-long-context (research, partial).
- **What we know:**
  - Quality: on Qwen3.8-27B, UD-Q6_K q6kf16 − q6k KL −0.00003, not resolved; UD-Q4_K_XL q4kxlf16 − q4kxl +0.0009 [+0.0002, +0.0018], resolved (`MEASURED`, 2026-11-09 27b-arms-kld); Q5_K_M f16 74.3 vs q8_0 76.5 TS, within noise (`MEASURED`, 2026-07-14 hardest-tasks-27b-vs-35b).
  - The tail (Qwen3.6-27B): lru-cache 78 → 47, and jackrong Qwopus3.6-27B expr-eval 58 → 23, under q8_0 at 128k, reps=2 (`MEASURED`, 2026-07-13 27b-quality-at-depth-detailed).
  - Speed on b9950: −11.8% prefill at 32K, −19.1% at 64K (27B) and −39.8% at 200K (35B) (`MEASURED`, 2026-07-13 27b-serving-substrate; 2026-07-11 deep-context-35b).
  - Speed on b10909: ties f16 to 18.4k, saves 4799 MiB at load (`MEASURED`, 2026-09-11 benchy-ideas-27b).
- **Status and trust:** each source differs in model, build and depth; the b9950 penalty may be gone. The detailed doc's §8 (use q8 at 128k) and §9 (q8 tanks lru-cache) conflict.
- **Possibilities:** C12 (series A part 4); also an argument for the ≤5% KV rule.
- **Gaps:** an f16 vs q8_0 curve on b11448 at ≥4 depths (8k–160k), prefill and decode; long-context KV quality on our engines (the research doc's open checklist).
- **Ideas:** throughput campaign via `gen_campaign.py`: Qwen3.8-27B Q4_K_XL, Vulkan b11448, f16 vs q8_0, depths 8k/32k/64k/128k/160k, reps 3, MTP on; one paired KL run at 32k positions if the KLD tool can take long prompts.
- **Linked:** T03, T14, T06.

### T06 — How much context fits, per model and engine?
- **Docs:** 2026-07-12 27b-maxctx-f16 (superseded), 2026-09-12 vllm-window-budgets-and-rocm-knobs, 2026-10-22 vllm-sly-mxfp4-dflash-170k (superseded for the fault, memory stands), 2026-07-19 ornith-35b-gemma-4-31b-configs, settings, versions.
- **What we know:**
  - The 27B is hybrid (16 of 65 blocks full attention): f16 KV 64 KiB/tok, not 260 (`INFERRED` from GGUF geometry); a 200K f16 load succeeded in 31 s. The banner's "29.0 GiB" was never sampled (no gpu_samples in any sub-run), so it is not a usage figure (rule 7) (2026-07-12 27b-maxctx-f16, superseded).
  - A generated vLLM row (max-model-len 36864, max_tokens 24000) left 12,864 admissible prompt tokens against a 74,507-token first stage (`MEASURED`, 2026-09-12 vllm-window-budgets-and-rocm-knobs).
  - MTP-8 halves the KV pool per GiB at ctx 36864 (25,529 → 12,972); fp8 KV leaves the pool identical (`MEASURED`, same doc).
  - No VRAM creep as a 170k window fills; peak 30,259 MiB during the cold 150k prefill (`MEASURED`, 2026-10-22 vllm-sly-mxfp4-dflash-170k).
  - Q5_K_M f16 at 163840 loaded with peak VRAM 31918 MiB and GTT 2841 MiB; a 1551–2841 MiB GTT spill shows in all 14 cells, even the 35B at 27081 MiB, OPEN in the doc (cause unexplained, freeze risk) (`MEASURED`, 2026-07-14 hardest-tasks-27b-vs-35b). Its budget-4096 Q5/Q6 cells used q8_0 KV because f16 was expected not to fit. CLAUDE.md rule 13 now takes ~140000 as the pessimistic f16 bound for Q5_K_M (owner, 2026-11-17: "around 140–150k").
- **Status and trust:** good scattered measurements; no single table. Ornith-1.0-35B's 20 KiB/tok is a calculation (`INFERRED`); Gemma's ~86 KiB/tok is not measured (owner, 2026-11-17: the Gemma GGUF always fails; CLAUDE.md now says so), with `gguf_kv.py` unable to read gemma4's per-layer KV-head array.
- **Possibilities:** short how-to "sizing a context window on 32 GB" (formula error, hybrid geometry, max_tokens eats the window, MTP eats the pool); a C4 section.
- **Gaps:** a measured-capacity table per model × engine × KV type from existing boot logs (boots.jsonl, gpu_peaks.json; versions.md VRAM rows; settings.md KV pools); gemma4 support in `bench/core/gguf_kv.py`; IQ6R is deferred and its single-card fit is `INFERRED`, unmeasured (2026-11-09 27b-arms-kld §10 item 12); the GTT spill cause (OPEN); mark `campaigns/perf/2026-07-12-1736-27b-maxctx-v2` dead in its README (premise wrong).
- **Ideas:** a script that collects `gpu_peaks.json` across campaigns into one JSONL (tool, S); extend `gguf_kv.py` to reduce array `head_count_kv` and honor sliding-window layers (tool, S).
- **Linked:** T05, T23.

### T07 — Do engine rankings hold across depth?
- **Docs:** 2026-09-10 hipfire-final-analysis, 2026-09-10 hipfire-bench-rocm713-final, 2026-09-12 vllm-window-budgets-and-rocm-knobs, 2026-09-12 vllm-radiance-r9700-evaluation (partial, many conflicts), 2026-10-30 vllm-redhat-mxfp4-depth-transposed, 2026-07-11 deep-context-35b, 2026-09-15 muse-glimmer-vulkan-vs-rocm; 2026-10-22 vllm-sly-mxfp4-depth and vllm-sly-mxfp4-dflash (secondary).
- **What we know:**
  - hipfire vs llama.cpp prefill: see overview; R² 0.992 (llama.cpp Vulkan 6fdd0ac = b10655-4) vs 0.961, 18k–73k; exponents move with the build (ROCm −0.315 → −0.210 from b10375 to b10909, `INFERRED`, 2026-09-11 llamacpp-b10909-build-check). 164k projection ~476 vs ~28 tok/s is `INFERRED`, 2.2x past the data (2026-09-10 hipfire-final-analysis).
  - Decode inverts: llama.cpp 67.40 → 35.43 tok/s from 8k to 98k (exponent −0.257, R² 0.965), vllm-radiance 0.9.3 42.11 → 44.32 (+0.035, R² 0.208) (`MEASURED`, 4 depths 8k–98k, 3 reps, 2026-09-12 vllm-window-budgets-and-rocm-knobs). A Vulkan + MTP fit on other fixtures, 8k–32k, gives llama.cpp −0.125 (R² 0.94) (`MEASURED`, 2026-09-12 vllm-radiance-r9700-evaluation): quote range and fixture.
  - Workload flips a ranking at the same depth: radiance +26% on agentic-8000, llama.cpp +49% on codereview-8000 (`MEASURED`, different runs, 2026-09-12 vllm-radiance-r9700-evaluation).
  - DFlash2 vs no-spec: 6.78x → 4.63x from 10k to 100k on RedHat MXFP4, Sly 1.8.1 (`INFERRED` ratios of `MEASURED` p50, 2026-10-30 vllm-redhat-mxfp4-depth-transposed), but 4.0x → 5.6x from 8k to 136k on another MXFP4 checkpoint, Sly 1.6.0 (`MEASURED`, 2026-10-22 vllm-sly-mxfp4-dflash). The trend follows the no-spec baseline (flat vs falling); do not generalise.
- **Status and trust:** the method (rule 16) is sound and CLAUDE.md's rule-16 wording was fixed on 2026-11-16. Remaining issues: rocm713's 1.4x vs 1.7x; several docs have 3 depths (no exponent); 1535 is a deployment comparison, not quant- or window-matched.
- **Possibilities:** C7 (series A part 3), log-log charts; a methodology sidebar in C4.
- **Gaps:** the comparison that matters now — Qwen3.8-27B on llama.cpp b11448 vs Sly 1.9.1 vs native Radiance 1.17.0, same day, ≥4 depths — was planned and never run: `campaigns/perf/2026-11-13-1143-27b-arms-speed` has a `run.sh` and no results.
- **Ideas:** run that campaign (cold ladder 8k/32k/100k/200k reps 3, n=2 at 32k, growing conversation 10k → ~205k per its README; ~7–8 h minimal tier, `INFERRED` there).
- **Linked:** T09, T08, T20, T23 (its README lists headroom risks).

### T08 — What decides agentic latency: prefill or prefix reuse?
- **Docs:** 2026-07-13 27b-serving-substrate, 2026-10-22 vllm-sly-mxfp4-depth, 2026-10-22 vllm-sly-mxfp4-dflash, 2026-09-12 vllm-radiance-r9700-evaluation, 2026-09-02 mrcr-v2-qwen38-27b-q6k (secondary).
- **What we know:**
  - The "~200 tok/s prefill" was a per-request floor on 51–99-token prompts; real cold prefill 830.8/756.3/666.1 tok/s at 8K/32K/64K (`MEASURED`, 2026-07-13 27b-serving-substrate).
  - On Sly, turn-8 TTFT 15.1 s for 15,084 new tokens vs 90.2 s for a cold 135,689-token prompt (`MEASURED`, 2026-10-22 vllm-sly-mxfp4-depth).
  - With the last ~25 tokens changed, partial hits equal full hits on both engines: radiance 2.526 vs 2.428 s, llama.cpp 3.341 vs 3.357 s (means), against cold 44.312 / 38.167 s (`MEASURED`, 2026-09-12 vllm-radiance-r9700-evaluation).
  - hipfire with two agents: the cache is effectively zero, 52.4 s per follow-up, same as cold (`MEASURED`, 2026-09-10 hipfire-final-analysis, secondary).
- **Status and trust:** three engines show a large warm-prefix win; 1055's findings 19 and 23 disagree on which engine wins warm TTFT (quote no winner); the 0733 warm probe used an identical prompt; the Sly pair (15,084 new vs 135,689 cold tokens) is not size-matched; MRCR's 12.5x should be ~13.9x (`INFERRED`, 551 s / 39.5 s, CANDIDATES §4).
- **Possibilities:** C2 (S, ready, series A part 1) — the most generalizable lesson in the repo (rule 17).
- **Gaps:** a llama.cpp turn that appends 1–20k new tokens to a cached prefix (rule 17); per-engine verdict under two agents sharing one server (only hipfire measured).
- **Ideas:** the arms-speed growing-conversation probe already gives a per-engine "prefix reuse yes/partial/no" verdict; add a two-agent alternating variant later.
- **Linked:** T07, T20.

### T09 — vLLM forks (Sly, native Radiance) on RDNA4: what to set
- **Docs:** 2026-11-04 ornith15-radiance-vs-sly-35b-27b, 2026-10-30 vllm-redhat-mxfp4-depth-transposed, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth, 2026-10-22 vllm-sly-mxfp4-depth, 2026-10-22 vllm-sly-mxfp4-dflash, 2026-09-11 vllm-qwen38-27b-int4 (partial), 2026-09-12 vllm-window-budgets-and-rocm-knobs, 2026-09-12 vllm-radiance-r9700-evaluation, two superseded 2026-11-04 research notes, and the `docs/guides/vllm/` set.
- **What we know:**
  - MoE backend: EMULATION 16.6/15.4/15.8 vs triton_unfused 110.2/92.9/67.3 tok/s at 10k/50k/100k; prefill −14–21% (`MEASURED`, 2026-11-04 ornith15-radiance-vs-sly-35b-27b; settings).
  - Ornith 1.5 w4a8 on native Radiance: decode 219.8/205.0/174.5, prefill 13,059/8,029/5,301 tok/s (`MEASURED`, mean of 3, same doc).
  - At δ 0, DFlash2 k=7 beats the model's own MTP k=4 at 10k, 100k and 145k: 100.2 vs 62.8 tok/s at 10k (`MEASURED`, mean of 2, power-capped 210 W, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth).
  - ROCM_ATTN decode at 32k (2.8–2.9 tok/s) is a quarantined row, not a result (rule 18): rerun before quoting. TRITON_ATTN 14.12 tok/s (`MEASURED`, one boot per arm, 2026-09-11 vllm-qwen38-27b-int4).
  - Also set: Cactus δ 0 (default δ 0.5 loops, T11); sly-amd still defaults to EMULATION (versions.md); Radiance's default 96 MiB headroom left 113 MiB free at peak (`MEASURED`, known-issues; T23). `HIP_FORCE_DEV_KERNARG=0` is set again in every Sly profile since 2026-11-17 (defensive, `sly-official/_engine.env`; T12).
- **Status and trust:** fast-moving (Sly 1.6.0 → 1.9.1, radiance 1.16 → 1.17 within weeks). Qwen3.8-27B RedHat MXFP4 DFlash2 decode at 10k (`MEASURED`): 122.3 (Sly 1.8.1, δ 0.5, ctx 110000, 0900), 100.2 (1.9.1, δ 0, ctx 262000, 2232), 86.9 (1.9.1, ctx 262000, 1746), unreconciled; ctx alone does not explain it. Ornith-on-Radiance vs Sly arms change model and engine together; 3 depths only there. 1055's recommended config matches no measured row.
- **Possibilities:** C3 (M, ready, series B part 1); C10 and C8 complete series B. A versions-matrix explainer could come from `docs/guides/vllm/versions.md`.
- **Gaps:** triton_unfused correctness and MTP on it; a ≥4-depth curve for Ornith 1.5 and Qwen3.5-35B-A3B; the 122.3 / 100.2 / 86.9 reconciliation; 1535 §2 MTP-off row not marked superseded.
- **Ideas:** arms-speed campaign (T07); one 27B Sly 1.9.1 rerun at ctx 110000 and 262000, δ 0 and 0.5 (C, S); a triton_unfused vs EMULATION correctness check, greedy token agreement or a few TS tasks (C, S).
- **Linked:** T12, T11, T23.

### T10 — Is hipfire worth adopting?
- **Docs:** 2026-09-10 hipfire-final-analysis, 2026-09-10 hipfire-bench-rocm713-final, 2026-09-10 hipfire-bench-baseline (partial; model labels swapped), 2026-09-10 hipfire-engine-research (research; vendor numbers).
- **What we know:**
  - Two flags recover 1.82x of 73k prefill (80.5 → 146.7 tok/s) — a dispatcher threshold, not an architectural limit (`MEASURED`, median of five, 2026-09-10 hipfire-final-analysis).
  - At 3k in / 10k out the engines tie, 199.4 vs 202.0 s (`MEASURED`, same doc §9b).
  - 7 of 19 draft-free boots faulted while /health stayed ok (`MEASURED`, same doc §4.1).
  - Two agents in flight: the prefix cache is effectively zero (~7 min per agent switch at 73k); 4 streams give 1.28x aggregate decode (31.12 → 39.89 tok/s) (`MEASURED`, same doc §3.5–3.6).
- **Status and trust:** solid for 0.3.0-beta; stale as soon as a new release ships. The 2026-09-10 residency incident (daemon at 4.4 GB vs ~19.4 GB working set) lives only in CLAUDE.md.
- **Possibilities:** C7 §2 material; a short "why we did not adopt hipfire" note.
- **Gaps:** none worth GPU time until a release changes the prefill dispatcher or fault rate.
- **Ideas:** watch hipfire releases; re-test with the same 4-depth probe when one lands.
- **Linked:** T07, T12, T23.

### T11 — Does lossy speculative acceptance pay off in agent loops?
- **Docs:** 2026-10-30 dpf-brief-fix-heretic-vs-redhat (partial), 2026-10-31 redhat191-sharp-w208-blind, 2026-10-31 reasoning-replay-sharp-template-cactus-loops, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth, 2026-10-30 vllm-redhat-mxfp4-depth-transposed, known-issues.
- **What we know:**
  - δ 0.5 on Sly 1.8.1: 9 runaway blocks, 0/3 briefs in the 3 h cap, 72.8% of decode windows in loops (`MEASURED`, 2026-10-30 dpf-brief-fix-heretic-vs-redhat).
  - Mechanism: once p ≥ 0.5 the 1.8.1 rule accepts with certainty; 0/3 top loops escaped (`MEASURED`); cap arithmetic `INFERRED` (2026-10-31 reasoning-replay-sharp-template-cactus-loops).
  - 1.9.1 fade/cap: 2/3 top loops escaped (`MEASURED`, 2026-10-31 reasoning-replay-sharp-template-cactus-loops), yet 3 decision loops and 1 output-cap hit remain (`MEASURED`, known-issues); 11.3% of windows at acceptance ≥ 7 (`MEASURED`, 2026-10-30 dpf-brief-fix-heretic-vs-redhat).
  - δ 0.5 moves DFlash2 accept length +29/+30/−7% but MTP only −5 to +8% (`INFERRED`, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth).
- **Status and trust:** n=1 per arm; the 1.8.1 δ comparison is not a controlled A/B; the δ 0.5 quality drop sits on the pre-registered threshold.
- **Possibilities:** C8 (series B part 3): a case study once the 0900 decode conflict is fixed or avoided (B), or a result after a second rep (C).
- **Gaps:** second δ 0.5 rep on 1.9.1 with the same brief; a quality grade for a clean 1.9.1 δ 0.5 run (the dpf 1.9.1 grade is confounded by template and RUNBOOK).
- **Ideas:** agentic campaign via `gen_campaign.py` `kind: agentic`, W2-08 step A, δ {0, 0.5}, 3 reps each, wall/tokens/loop-window share/blind grade.
- **Linked:** T18, T09.

### T12 — Why do engines fault, and how do we know?
- **Docs:** 2026-10-23 vllm-gpu-fault-solved-hip-kernarg (partial), 2026-10-22 vllm-mxfp4-atiled-fault-and-llama-swap-serving (superseded), 2026-10-22 vllm-sly-mxfp4-dflash-170k (superseded), 2026-10-07 rocm-fa-hsa-memory-fault (partial), historical, known-issues, 2026-09-10 hipfire-final-analysis, 2026-10-08 llamacpp-b11448-build-check (15:55).
- **What we know:**
  - Root cause: a kernel-argument pointer with bit 44 cleared (`INFERRED`, strong, from one `MEASURED` pointer log, 2026-10-23 vllm-gpu-fault-solved-hip-kernarg).
  - Ruled out by test: kernel version, ctx, Sly version, A-tiled path, padding, prefill split (`MEASURED`, same doc).
  - llama.cpp ROCm `-fa on` aborts with a permission fault (PERMISSION_FAULTS=0x3) on ROCm 10.0 and 10.1, absent with `-fa off` (`MEASURED`: the abort and the clean `-fa off` run; the permission-fault decode of the dmesg registers is `INFERRED`, 2026-10-07 rocm-fa-hsa-memory-fault).
  - In vLLM and hipfire the fault left /health answering ok: vLLM's EngineDeadError ~6.5 min after the hang (`MEASURED`, 2026-10-22 vllm-sly-mxfp4-depth; 5–16 min in the superseded 1643 log), hipfire's worker wedged (`MEASURED`, 2026-09-10 hipfire-final-analysis). llama.cpp `-fa on` aborts instead.
- **Status and trust:** fix holds on n=3 (+1 via llama-swap), kernel 7.0.0-34 only; the -38 gate is open (0023 status) the recipe dropped it 2026-10-25 and sets it again since 2026-11-17, defensively (settings.md, historical.md); 1745 still names kernel -38 as first suspect; 1506 still says "not safe" though superseded; 0023 cites a plans path that does not exist (plans live in notes/plans).
- **Possibilities:** C10 (narrative, series B part 2), writable once the three cross-note wordings are fixed.
- **Gaps:** does `HIP_FORCE_DEV_KERNARG=0` also clear the llama.cpp ROCm `-fa on` fault and the sequential-arm state leak? The kernel reboot attribution test (1745) is pending.
- **Ideas:** a small investigation campaign: b11448-rocm `-fa on`, llama-bench pp2048/tg128, kernarg default vs 0, 10 boots each, count faults.
- **Linked:** T13, T23.

### T13 — Which driver/OS stack, and what does an upgrade break?
- **Docs:** 2026-10-07 rocm-10.1-vs-10.0-7.13, driver-upgrade-runbook (partial), 2026-10-07 rocm-fa-hsa-memory-fault, 2026-07-09 rdna4-r9700-llm-optimization (research, HU), 2026-10-08 rocmtos-cachyos-ubuntu2604-rdna4 (research, unverified).
- **What we know:**
  - ROCm 10.1.0-3 is active; the only visible compiler change is clang 23 → 24 (`MEASURED`, 2026-10-07 rocm-10.1-vs-10.0-7.13).
  - CASK prefill: a 1.57x win on ROCm 7.13 became a 47% loss on 10.0 (`CLAIMED`, off-repo log, same doc).
  - Six amdgpu commits between kernels -34 and -38 touch the fault's code paths (`MEASURED` commit list; the code-path overlap is `INFERRED` from changelog text, 2026-10-07 rocm-fa-hsa-memory-fault).
- **Status and trust:** thin. The runbook is a 2026-09-11 snapshot (kernel 7.0.0-31, Mesa 26.2.2); its Vulkan section is an unperformed procedure. The rocmtos research is desk-only.
- **Possibilities:** a C14 sidebar; later a "driver upgrade without losing your baselines" how-to.
- **Gaps:** commit the CASK log so the hook becomes `MEASURED`; the -34 vs -38 reboot test (vLLM already faulted on -34 without the kernarg fix, which weakens the -38 suspect; the test still decides the llama.cpp case); a rebuild of the ROCm llama.cpp builds against core-10.1 (they load 10.0).
- **Ideas:** log every driver change's smoke baseline (runbook step 1) as a campaign.
- **Linked:** T02, T12.

### T14 — How far is each quant from Q8_0 (KLD)?
- **Docs:** 2026-11-09 27b-arms-kld, 2026-10-31 kv-cache-quantization-long-context (research), 2026-10-31 quantization-reasoning-length-compaction-variance (research), 2026-07-13 27b-quality-at-depth-recommendation (secondary).
- **What we know:**
  - Qwen3.8-27B: UD-Q6_K closest at KL 0.00448, IQ4R-L-V4 0.00794, UD-Q4_K_XL 0.01636 (`MEASURED`, 4096 positions per arm, 2026-11-09 27b-arms-kld).
  - The int4 LM head (a sly-redhat production setting) adds a resolved +0.0045 nats/tok: full-head arm minus int4-head arm dfh − d0 = −0.00451 [−0.00578, −0.00325] (`MEASURED`, §6); DFlash shows no resolved cost (`MEASURED`, same doc).
  - The scorer fix moved the Q8_0 re-run floor 0.1106 → 0.00176 (`MEASURED`, same doc §7.5).
  - IQ5R-S-V4 on radiance 1.17.0 at ~98k: prefill 1939, decode 72.6 tok/s vs IQ4R-L-V4 1855/74.1, 1 rep; IQ5R-S-V4 faulted once in an agentic session (ctx 69k) and the tier was deferred; whether the speed row shares that session is not stated (`MEASURED`, same doc §10 item 12; `campaigns/perf/2026-11-13-1347-27b-iq5r-s-v4-speed-gate`).
  - MXFP4 W4A4 recovers less than NVFP4 and INT4 on Llama-3.1-8B, no reasoning models tested (`CLAIMED`, 2026-10-31 quantization-reasoning-length-compaction-variance).
- **Status and trust:** the best-instrumented topic (noise floors, cluster bootstrap, positions rule). Count errata ("fifteen arms" = 12 + 3 floors; 78/128 vs 77/87; IQ6R boot vs `--tp 2`). Our values sit ~2x above Unsloth's published ones (`INFERRED`).
- **Possibilities:** C5 (series D part 1); a method-only piece "how to build a KL comparison you can trust" from §4/§7.
- **Gaps:** short contexts only (90 of 128 prompts are TS/Python code); MTP not measurable by KL on b11448 (accepted drafts carry no logprobs, §5); KL is closeness to Q8_0, not correctness (T15's TS ladder shows no resolved quant difference); most arms mix weights, KV and engine; KL at depth.
- **Ideas:** long-position KL (positions sampled at 32k and 100k on a subset of prompts) for Q6_K, Q4_K_XL, IQ4R and one MXFP4 arm.
- **Linked:** T05, T09.

### T15 — Which local model codes best?
- **Docs:** 2026-07-14 hardest-tasks-27b-vs-35b, 2026-07-14 hardest-tasks-27b-vs-35b-pre-summary (superseded), 2026-07-13 27b-quality-at-depth-recommendation, 2026-07-19 ornith-vs-gemma (partial), 2026-07-12 27b-finetune-quality (superseded), 2026-07-27 runner-benchmark-unified, 2026-07-19 ornith-35b-gemma-4-31b-configs, 2026-07-13 hard-ts-quality-benchmark-design.
- **What we know:**
  - Qwen3.6-27B quant ladder at 128k: Q4_K_M 78.3, Q4_K_XL 69.8, Q5_K_M 76.5, Q6_K 80.9 TS%, no resolved difference (`MEASURED`, 2026-07-14 hardest-tasks-27b-vs-35b).
  - Ornith-1.0-35B 62.2% vs Qwen3.6-35B-A3B 73.3%, within-task sd 7.4 vs 12.9 (`MEASURED`, 2026-07-19 ornith-vs-gemma); Gemma-4-31B 56.6% at n=1 (`MEASURED`, same doc).
  - The dense 27B decodes ~2.2x slower than the A3B MoE builds (68.7 vs 149.3–155.7 tok/s) (`MEASURED`, 2026-07-27 runner-benchmark-unified).
  - The agentic runner finds between-block variance larger than any model difference; one model's phase-1 cost 181,545 vs 39,801 generated tokens in two samples (`MEASURED`, 2026-07-27 runner-benchmark-unified): no single-block ranking is safe.
- **Status and trust:** all TS-TDD data is Qwen3.6-27B, Qwen3.6-35B-A3B and Ornith-1.0-35B on Vulkan b9950, Gemma-4-31B on ROCm b9949; 5 tasks × 3 reps resolve only ~12-point differences.
- **Possibilities:** a "which local coder in late 2026" piece after new data; C9 §7 now.
- **Gaps:** Qwen3.8-27B, Ornith 1.5 and Qwen3.5-35B-A3B — three of the four current models — have no TS-TDD score (Qwen3.6-35B-A3B has 73.3%); Gemma needs ≥3 reps.
- **Ideas:** `bench/quality/run_capture.sh` campaign at ~120k: Qwen3.8-27B (llama.cpp b11448), Ornith 1.5 (Radiance), Qwen3.5-35B-A3B (Sly triton_unfused), 5 tasks × 3 reps, temp per model card; Gemma 2 more reps on ROCm.
- **Linked:** T16, T09.

### T16 — Thinking budget and sampler at depth
- **Docs:** 2026-07-13 27b-quality-tuning, 2026-07-13 27b-quality-at-depth-detailed, 2026-07-13 27b-quality-at-depth (superseded), 2026-07-14 hardest-tasks-27b-vs-35b, 2026-07-15 qwen36-sampling-thinking-budget-variance, 2026-07-12 qwen36-sampling-llamacpp-serving-knobs (superseded), the four published articles + LinkedIn twins.
- **What we know:**
  - Shallow: capping at ~1024 costs no verified accuracy; runaways 7.1% uncapped → 0% capped; `--reasoning-budget 0` is uncapped (`MEASURED`, reps=1, 50–100-token prompts, 2026-07-13 27b-quality-tuning, which itself recommends 2048 as the depth-safe default).
  - At 64k the budget helps, so the 1024 cap is not free there (TS 68/75/79 at 1024/2048/4096); at 128k it is flat (68/73/73) (`MEASURED`, reps=2, 2026-07-13 27b-quality-at-depth-detailed).
  - Qwen3.6-35B-A3B: vendor coding sampler (temp 0.6, pp 0) 77.5 vs Qwen general preset 62.1, Δ −15.4, t=−3.41 (`MEASURED`, 2026-07-14 hardest-tasks-27b-vs-35b).
  - On Qwen3.6-35B-A3B the budget matters: rb4096 73.3 vs rb16384 77.5, t=−5.45 (`MEASURED`, same doc).
  - The wall is lint 0.36 and types 0.47 vs tests 0.84 (`MEASURED`, same doc).
  - At 128k best-of-3 reruns beat every other lever (+4.6 to +17.5 pts); the unlimited budget gave the one runaway (TS 77 → 45); the 4096 budget was saturated in every cell (3,629–4,095 tokens) (`MEASURED`, same doc; 2026-07-15 qwen36-sampling-thinking-budget-variance).
- **Status and trust:** solid at 128k for Qwen3.6 on b9950; partial for the shallow cap. The recommendation doc's meta cites the wrong campaign and misstates two ratios; cite hardest-tasks instead.
- **Possibilities:** C9 (series E part 2), the direct follow-up the four published articles promise.
- **Gaps:** the errata; whether the conclusions carry to Qwen3.8-27B.
- **Ideas:** fold a budget axis (4096 vs 16384) into the T15 production-trio campaign rather than a separate run.
- **Linked:** T15, T22.

### T17 — Does long-context recall survive at 131K?
- **Docs:** 2026-09-02 mrcr-v2-qwen38-27b-q6k.
- **What we know:**
  - 30/35 samples ≥ 0.90, none between 0.10 and 0.90 (`MEASURED`).
  - Failures are wrong-instance picks reproduced flawlessly (`MEASURED`, example score 0.0128).
  - Prefill at 131K 294 vs 813 tok/s bench; decode 30.5 vs 45.9 (`MEASURED`).
  - Published 128K 8-needle scores: GPT-5.2 0.856, Claude Sonnet 4.6 0.849, Gemma 4 31B 0.664 (`CLAIMED`): cumulative up-to-128K aggregates, not this pointwise bucket; the doc calls the comparison indicative, not decisive; no tools in this run.
- **Status and trust:** one bucket, one run, temp 1.0; errata: MTP acceptance 54.3% (setup check) vs 94% (this run), 12.5x vs ~13.9x (`INFERRED`, 551 s / 39.5 s), Q6-only conclusion overreaches.
- **Possibilities:** C11 (S, series D part 2).
- **Gaps:** a second bucket (64K) to make a curve; a Q4 arm to test the quant claim.
- **Ideas:** MRCR at 64K and 131K for Qwen3.8-27B Q4_K_XL and Q6_K, stride 3, using `bench/quality/mrcr/`.
- **Linked:** T14, T05.

### T18 — A local 27B in a real agentic loop: review quality and token cost
- **Docs:** 2026-10-31 agentic-thinking-volume-and-levers, 2026-10-31 redhat-sharp-w208-blind, 2026-10-31 q4kxl-sharp-w208-blind, 2026-10-31 redhat191-sharp-w208-blind, 2026-10-31 redhat191-sharpsly2-w208-blind (negative), 2026-11-01 redhat191-dp-sharp-w208-blind, 2026-10-30 dpf-brief-fix-heretic-vs-redhat, 2026-10-31 reasoning-replay-sharp-template-cactus-loops, research 2026-10-31 preserved-thinking-how-much-to-keep and quantization-reasoning-length-compaction-variance.
- **What we know:**
  - Precondition: Cactus δ 0. At the Sly default δ 0.5, 0 of 3 briefs finished (777 of 1,067 windows looping) (`MEASURED`, 2026-10-30 dpf-brief-fix-heretic-vs-redhat).
  - Thinking per tool call is flat (3,453 vs 3,043–3,641 characters); steps differ 70 to 155 (`MEASURED`, 2026-10-31 agentic-thinking-volume-and-levers).
  - Dropping old reasoning (k=1) raised total tokens 47% and did not finish (`MEASURED`, 2026-10-31 redhat191-sharpsly2-w208-blind).
  - Only 3.4–6.7% of emitted identifiers came from thinking ≥2 steps back (`MEASURED`, 2026-10-31 reasoning-replay-sharp-template-cactus-loops).
  - Best single local review found 12/19 Opus findings, precision 15/15 (Q4_K_XL); the gap to RedHat δ 0 on Sly 1.8.1 (9/19) is inside the pre-registered grey zone of 3–4 findings (`INFERRED` per the doc, 2026-10-31 q4kxl-sharp-w208-blind).
  - Claude Code compaction fires at 136.0–142.7k tokens (`MEASURED`, 2026-10-31 quantization-reasoning-length-compaction-variance); the fit 0.85 × (180000 − 20000) is `INFERRED` (2026-10-31 agentic-thinking-volume-and-levers).
- **Status and trust:** n=1 per arm everywhere; one blind-graded brief (W2-08; the δ 0.5 loop evidence covers W2-06 to W2-08); one blind grader; the dp-sharp V2 grade is preliminary; GPU throttled in the 11-01 run.
- **Possibilities:** C15 after data; a "can a local 27B review code" piece (union of reviews covers 31/38 weighted, `INFERRED`).
- **Gaps:** ~8–9 runs per arm on one template pair to separate a 20% step gap at CV ~15% (`INFERRED`, 2026-10-31 quantization-reasoning-length-compaction-variance); the authoritative V2 grade; the dp-sharp campaign README still says "not run" although it has 12 result files and a doc.
- **Ideas:** agentic campaign: sharp vs froggeric template, RedHat δ 0 on Sly 1.9.1, W2-08 step A, 4 reps each as a variance pilot (8–9 to resolve a 20% gap); plus a second brief to test generality.
- **Linked:** T11, T19.

### T19 — What to hand a free local worker vs Haiku
- **Docs:** 2026-11-04 sly-radiance-ornith-vs-haiku-high-effort, 2026-11-05 ornith-use-cases, 2026-11-06 ornith-manual, 2026-11-06 haiku-manual, 2026-11-04 ornith15-radiance-vs-sly-35b-27b (secondary).
- **What we know:**
  - JSON at 131k scored 1.0 in 17 s with jq/python3 (`MEASURED`, 2026-11-05 ornith-use-cases).
  - Retyping a 6k document: one clean run in 480 s; Haiku max 242 s (`MEASURED`, same doc).
  - Verdicts on four deep reports: Ornith 8 and 9 of 12 vs Haiku-high 12 and 11 (`MEASURED`, 2026-11-04 sly-radiance-ornith-vs-haiku-high-effort).
  - Neither is safe unattended on buried incidents: Ornith missed 19 and Haiku-high 8–9 across six deep notes; Haiku effort low broke the line format at six docs, effort max wrote no file (`MEASURED`, 2026-11-04 sly-radiance-ornith-vs-haiku-high-effort; 2026-11-06 haiku-manual); session limit ~100k content, 7 docs (`INFERRED`).
  - Effort setting is inert on Ornith; Haiku finds 21/21 error classes in a 340k log vs Ornith 16, 16 and 21 of 21 over three runs (`MEASURED`, 2026-11-06 ornith-manual; 2026-11-06 haiku-manual).
- **Status and trust:** current and consistent; mostly n=1 per arm; arms differ in prompt/tools/effort; Haiku wall includes API latency. One prompt-rule conflict between 0814 and the manual (use the manual).
- **Possibilities:** C6 (M, ready, series E part 1), with a routing table.
- **Gaps:** speed at three depths only (a 4-depth Radiance run for Ornith 1.5, C, S); Ornith 1.5 vs Ornith-1.0-35B never compared.
- **Ideas:** keep the routing table as a living guide; add an Ornith 1.5 TS-TDD score via T15.
- **Linked:** T09, T20.

### T20 — How many agents per card?
- **Docs:** 2026-07-11 campaign-combo35b, 2026-07-11 deep-context-35b, 2026-11-06 ornith-manual, 2026-07-11 vllm-benchmark-serving (research); 2026-09-10 hipfire-final-analysis and 2026-09-12 vllm-radiance-r9700-evaluation (secondary).
- **What we know:**
  - Ornith 1.5 on Radiance: 3 sessions give 254 tok/s total vs 174 alone (1.46x) (`MEASURED`, 2026-11-06 ornith-manual), i.e. ~85 tok/s per session, about half the solo rate (`INFERRED`).
  - Two 32k requests on b10909 (Qwen3.8-27B UD-Q4_K_XL): Vulkan 24.3 tok/s decode per stream, ROCm 19.4 (`MEASURED`, `results/summary.md` of the undocumented `campaigns/build-check/2026-09-11-1756-batched-2x32k`).
  - Costs elsewhere (`MEASURED`): hipfire 4 streams 1.28x aggregate, 9.97 tok/s each (2026-09-10 hipfire-final-analysis); vllm-radiance + MTP c=1 ~59.7 vs c=2 ~39 tok/s aggregate (2026-09-12 vllm-radiance-r9700-evaluation); llama.cpp np2 → np4 at 32K doubles TTFT p95, 24.3 → 49.4 s, no aggregate gain (2026-07-11 deep-context-35b).
  - The 4-agent VRAM fit in combo35b is `INFERRED` (no per-point sample).
- **Status and trust:** thin; every point is a different model, engine and depth.
- **Possibilities:** a "two agents on one card" piece once a grid exists; sections of C1 and C7.
- **Gaps:** np {1, 2, 3} × depth {8k, 32k, 100k} on the production stacks (the 2–4-stream points above are on other engines or builds); per-engine prefix sharing between agents.
- **Ideas:** the arms-speed campaign's n=2 cells are the first step; add np=3 for Radiance where KV allows.
- **Linked:** T07, T08, T06.

### T21 — Power, clocks and efficiency
- **Docs:** 2026-07-10 rdna4-r9700-tuning-optimum, 2026-07-16 mtp-sampler-tax, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth, 2026-10-22 vllm-sly-mxfp4-depth, 2026-10-31 agentic-thinking-volume-and-levers; 2026-09-10 hipfire-final-analysis (secondary).
- **What we know:**
  - With pp 0.01 the GPU sat at 80.6% busy vs 93.4%, sclk 3162 → 2084 MHz, power 220 → 146 W (`MEASURED`, 2026-07-16 mtp-sampler-tax).
  - Plain AR decode 23.2–29.5 tok/s vs a 38.9 tok/s bandwidth ceiling at rated 640 GB/s (`MEASURED` vs `INFERRED`, hipfire 0.3.0-beta, Qwen3.8-27B mq4-pro, 2026-09-10 hipfire-final-analysis, "throttled card").
  - The δ 0 depth run was power-capped at 210 W (`MEASURED` setting, 2026-10-30 vllm-redhat-sly191-d0-dflash-depth); the Sly depth run decoded at the 210 W cap with mclk 1258 MHz in every sample (`MEASURED`, 2026-10-22 vllm-sly-mxfp4-depth).
- **Status and trust:** 11 docs touch power, none studies it; caps and throttling differ between runs, which is itself a confound for cross-doc speed comparisons.
- **Possibilities:** a "tokens per joule on one R9700" piece; a caveat paragraph for C7.
- **Gaps:** tok/J per engine; a power-cap sweep; a record of the cap in effect in each campaign's `meta.txt`.
- **Ideas:** campaign: Qwen3.8-27B on llama.cpp b11448 + MTP, caps 150/180/210/250/300 W, depths 8k/32k/100k, decode and prefill, `vram_sampler.py` power column → tok/J.
- **Linked:** T07, T23.

### T22 — Can we trust our numbers? (instruments and method)
- **Docs:** 2026-07-13 27b-quality-at-depth-detailed, 2026-07-13 27b-quality-at-depth (superseded), 2026-07-27 runner-benchmark-unified, 2026-07-12 27b-finetune-quality (superseded), 2026-07-12 27b-maxctx-f16 (superseded), 2026-09-10 hipfire-bench-baseline, GUIDE, the three methodology research docs, the articles 2026-07-16 assumptions-vs-reality and reasoning-budget-and-how-we-know (the count of 14 includes their 2 LinkedIn copies).
- **What we know:**
  - Prefix cache answering for the engine: 18.5 tok/s with prompt_n ~4 vs 805–843 tok/s with a unique prefix (`MEASURED`, 2026-09-10 hipfire-bench-baseline).
  - Between-block variance +78% on the same model and task (318.3 vs 566.5 s) (`MEASURED`, 2026-07-27 runner-benchmark-unified).
  - Adopt, not build: llama-bench for tuning, an HTTP client for serving (`CLAIMED` survey, 2026-07-11 benchmark-harness-build-vs-adopt).
- **Status and trust:** solid for the method (the guards are now iron rules 14–18); partial for the numbers (hipfire-bench-baseline labels conflict; maxctx-f16, the grader-fault run and the temp-1.0 run are superseded). GUIDE still pins b9949/b9950 and `/home/dev/models/gguf` as of 2026-07-11; the runner doc has many count errata.
- **Possibilities:** C4 (M, ready, series C part 1); a short "noise floors per instrument" reference.
- **Gaps:** a repo-wide table of measured noise floors (llama-bench sd, engine re-boot KL, grader repeatability ±1 finding); GUIDE refresh.
- **Ideas:** collect noise floors from existing results (no GPU) into one findings note.
- **Linked:** T23.

### T23 — Silent GPU contention on a desktop-shared card
- **Docs:** known-issues, workflows, driver-upgrade-runbook, 2026-10-08 llamacpp-b11448-build-check (15:55), 2026-10-22 vllm-mxfp4-atiled-fault-and-llama-swap-serving (superseded), 2026-07-09 rdna4-r9700-llm-optimization (research), plus CLAUDE.md iron rules 14–15.
- **What we know:**
  - NVFP4 load peak 32,600/32,624 MiB + 2,956 MiB GTT; the desktop exited 22 s later (`MEASURED`; causality `INFERRED`, known-issues).
  - The `serve_vllm.sh` watchdog kills below 256 MiB free (configured default, workflows); native Radiance has none.
  - Q5_K_M f16 at 163840 loaded with peak VRAM 31918 MiB, 0 failures, and 2841 MiB GTT; the 1551–2841 MiB spill is in all 14 cells and OPEN (`MEASURED`, 2026-07-14 hardest-tasks-27b-vs-35b). That an orphan once made it look "unstable" is recorded only in CLAUDE.md.
  - /unload is GET; POST returns 405 and a quiet curl swallows it; on 2026-09-10 and 09-11 llama-swap itself exited right after `GET /unload` (driver-upgrade-runbook).
- **Status and trust:** four incidents exist only in CLAUDE.md, with no findings doc (listed in §4: the 2026-07-15 orphan, the 2026-09-10 hipfire residency, the 2026-07-15 interrupted reply, the 2026-09-10 `/unload` POST 405).
- **Possibilities:** C13 (series C part 2).
- **Gaps:** a findings note per incident that cites the discarded rows or CSVs, so the numbers can be `MEASURED`.
- **Ideas:** one contention-incidents findings note (D, S); a Radiance launcher watchdog equivalent to the vLLM one (tool, recommend only).
- **Linked:** T12, T06.

### T24 — Can this card fine-tune?
- **Docs:** 2026-07-14 gfx1201-llm-training-feasibility, 2026-07-14 radeon-llm-finetune-frameworks (both research).
- **What we know:**
  - Qwen2.5-Coder-32B QLoRA at ~28 GiB, ~142 tok/s on an R9700 (`CLAIMED`, LLaMA-Factory issue 10511).
  - A 27B LoRA with a bf16 base cannot fit: base alone ~54 GiB (`INFERRED`).
  - bitsandbytes paged optimizers silently corrupt state on ROCm (`CLAIMED`).
- **Status and trust:** no training run on this box; parked in CANDIDATES.
- **Possibilities:** none until one run exists; then a short "QLoRA on RDNA4: what worked" note.
- **Gaps:** one QLoRA smoke run (Qwen3-8B, LLaMA-Factory ROCm Docker) with VRAM sampled.
- **Ideas:** only if a fine-tune is wanted; it competes with serving for the card.
- **Linked:** T13.

---

## 4. Cross-cutting gaps

**Coverage holes (prep §2–§4).**

| hole | evidence | what fills it |
|---|---|---|
| Thin domains | kld-fidelity 2 docs; subagent-workers 4; concurrency 5 (3 partial); power-thermal 11 docs, none about power | T14 depth KL; T20 grid; T21 cap sweep |
| Production models without quality data | Qwen3.8-27B: 0 TS-TDD runs (its coding-quality tags are agentic and KLD); Qwen3.5-35B-A3B: no quality doc at all; Ornith 1.5: 1 coding-quality doc (workers); Qwen3.6-35B-A3B, also current, has a TS-TDD score | T15 production-trio campaign |
| Models without depth curves | Gemma-4-31B and Ornith-1.0-35B: 0 depth-scaling docs; Ornith 1.5 and Qwen3.5-35B-A3B: 3 depths only | T07 arms-speed (27B), a Radiance 4-depth run for Ornith 1.5 |
| Engines never compared at ≥4 depths on the production builds | Sly vs llama.cpp b11448 (never); native Radiance 1.16+ vs anything (3 depths); upstream ROCm ≥64k on b11448 (never). Older builds have them: llama.cpp vs hipfire (2026-09-10 hipfire-final-analysis), vllm-radiance 0.9.3 vs b10909 (2026-09-12 vllm-radiance-r9700-evaluation), stew675 ROCm to 98k (2026-09-15 muse-glimmer-vulkan-vs-rocm) | T07, T02 |

**Campaigns without a write-up or never run (prep §5).**

| campaign | state | would answer |
|---|---|---|
| `campaigns/build-check/2026-09-11-1756-batched-2x32k` | 7 result files, no doc names it | b10909 under two concurrent 32k requests (T03, T20) |
| `campaigns/perf/2026-07-11-1738-sweep-27b-micro` | 4 result files (sweep-summary, sweep-log, meta, gpu_peaks), no doc | 27B micro-batch optimum on b9950 (T01) |
| `campaigns/perf/2026-07-31-1727-27b-q4-mtp-depth` | 6 run dirs (12k/64k/128k, q8_0 KV, MTP), no doc | Qwen3.6-27B MTP decode at depth (T04, T05) |
| `campaigns/perf/2026-11-13-1143-27b-arms-speed` | scaffolded (`run.sh`, `spec.json`), 0 results | Qwen3.8-27B arms speed vs depth, n=2, growing conversation (T07, T08, T09, T20) |
| `campaigns/perf/2026-07-12-1736-27b-maxctx-v2` | README says not run; premise wrong (hybrid) | nothing — mark it dead in its README |
| `campaigns/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind` | README says not run, yet 12 result files and a doc | README is stale; fix it (T18) |

**Incidents that live only in CLAUDE.md** (no findings doc; grep for them returns nothing under `docs/findings/`):
2026-07-15 orphaned `llama-server` and the false "Q5 f16 @163840 unstable" report (rule 14); 2026-07-15 interrupted
generation graded as a real reply, 0.603 with tests 0.0, cell mean moved 1.1 pts (rule 18); 2026-09-10 hipfire daemon at
4.4 GB vs ~19.4 GB working set with llama-swap holding ~27 GB, sweep discarded (rule 15); 2026-09-10 /unload POST 405
swallowed by a quiet curl (rule 14; the runbook documents the trap and a separate 2026-09-10/11 llama-swap exit after `GET /unload`, not this incident). Each blocks a `MEASURED` tag in C13.

**Stale and superseded clusters.**
- *July b9950 / Qwen3.6 cluster* (T01, T04, T05, T15, T16): 2026-07-10 … 2026-07-19, four builds and one checkpoint behind production. Solid as history; every forward-looking recommendation needs a b11448 or Qwen3.8 confirm.
- *Superseded docs* (10): 2026-07-12 27b-maxctx-f16, 2026-07-12 27b-finetune-quality, 2026-07-13 27b-quality-at-depth, 2026-07-14 …-pre-summary, 2026-07-12 qwen36-sampling-llamacpp-serving-knobs, 2026-07-16 spec-draft-p-min-mtp, 2026-10-22 vllm-sly-mxfp4-dflash-170k, 2026-10-22 vllm-mxfp4-atiled-fault…, and the two 2026-11-04 vLLM research notes. Several still carry live-sounding verdicts (1506 "not safe for unattended long runs").

**Methodology debts (iron rules 2, 16, 17, 18).**

| debt | where |
|---|---|
| n=1 per arm | all 8 agentic docs; workers docs; Gemma quality; July articles (reps=1, shallow) |
| single rep / no noise band | 2026-09-15 stew675-buildcmp, 2026-10-08 b11448-rocm checks (13:16, 15:55) |
| 3 depths, no exponent | 2026-07-11 deep-context-35b, 2026-07-13 27b-serving-substrate, 2026-11-04 ornith15-radiance-vs-sly-35b-27b, 2026-10-30 vllm-redhat-mxfp4-depth-transposed |
| cold prefill only (rule 17) | most llama.cpp depth docs; only 0733, 1324, 1406, 1055, MRCR and hipfire-final-analysis §3.6 measure reuse |
| version drift | b9950 → b11448; Sly 1.6.0 → 1.9.1; radiance 1.16.0 → 1.17.0; kernel 6.17 headers in July docs and the published 27B article |
| power state unrecorded | caps and throttling differ between runs (T21) |

---

## 5. Idea backlog

| idea | why it is interesting | needs | size |
|---|---|---|---|
| Tokens per joule on one R9700 | electricity is the only running cost of a local model; we found no doc that publishes tok/J vs depth for RDNA4 | power-cap sweep (T21), `vram_sampler.py` power column | M |
| Cost per task: local vs API | the economics tag sits on 21 docs but no doc computes $/task | wall × power (`MEASURED`) + API prices (`CLAIMED`) + T19 task set | S (desk) after T21 |
| Qwen3.6-27B vs Qwen3.8-27B: what changed | the repo switched checkpoints mid-stream; only one side-by-side row exists (decode 56.92 vs 54.90 tok/s, `MEASURED`, labels disputed, 2026-09-10 hipfire-bench-baseline) | same-build speed + TS-TDD + KL on both | M |
| KL at depth | every KLD number is short-context; quant and KV cost may grow with position | long-prompt support in the KLD tool | L |
| Production-trio TS-TDD | the served models have no coding-quality score | `bench/quality/run_capture.sh`, 3 engines | L |
| Two agents sharing one server | real use is two Claude Code sessions; prefix sharing differs per engine and only hipfire was measured | alternating-agent probe in `capture_engine.py` (tool feature) | M |
| Vulkan suballocation decode cliff | a `CLAIMED` ~78% decode cliff at 131072 ctx with a one-variable fix (issue 27734, 2026-10-07 rdna4-llama-cpp-vulkan-compile-settings) | 2-arm run at 64k/131k | S |
| Gemma on RADV 26.2.4 | the device-lost verdict is from b9950 and an older Mesa; Gemma is the only tested dense non-Qwen model | guarded retest at 24k/65k | S (risk: GUI crash) |
| Gemma MTP drafter | 280 MB drafter (`CLAIMED`, 2026-07-19 ornith-35b-gemma-4-31b-configs); decode ~11.6 tok/s on ROCm (`MEASURED`, 2026-07-19 ornith-vs-gemma) is the blocker for Gemma | download + `EXTRA_ARGS="-md …" MTP=1` smoke | S |

---

## 6. Decision shortlist

### Track A — write now
"Fix first" items are wording or quote choices outside the article's numbers (≤1 h each, §1).
1. **C2, prefix reuse (T08). Recommended first.** S, no GPU. The most transferable lesson (rule 17), `MEASURED` on three engines: warm vs cold TTFT 13.7x (llama.cpp, identical prompt), 17.4x (radiance), and Sly's turn-8 15.1 s for 15,084 new tokens vs 90.2 s for a cold 135,689 (not size-matched). Fix first: MRCR as ~13.9x (`INFERRED`, 551 s / 39.5 s, not 12.5x); quote only 1055's prefix rows and no warm-TTFT winner (its findings 19 and 23 disagree). Say that 1055's changed tail is ~25 tokens; the arms-speed probe can add a v2 section.
2. **C3, one flag 6.6x (T09).** M. Fix first: one source per number (1630 vs 1702), the 1630 step time as `INFERRED`, drop the quarantined ROCM_ATTN row, no single 27B reference number. Say "speed only; triton_unfused correctness untested; 3 depths; short replies" unless the optional correctness check (C, S) runs first — open question, see below.
3. **C4, when the ruler is broken (T22).** M. Fix first: tag maxctx-f16's 29.0 GiB as unsampled (owner OK 2026-11-17: fix the doc's banner as part of C4); recompute the runner §3.4 and §4.5 rows before quoting.
4. **C6, local worker vs Haiku (T19).** M. Fix first: use the manual's dp-prompt rule (0814 vs manual); give Ornith's log score as 16, 16 and 21 of 21. Say "mostly n=1".
5. **C10, the bit-44 fault (T12).** M. Fix first: the three cross-note wordings (1745 kernel suspect, 1506 "not safe", 0023 plans path). Say "held on 3 boots, kernel -34 only; the -38 gate is open; the recipe sets it again defensively since 2026-11-17".

### Track B — fix docs, then write
1. **C5, KLD fidelity (T14).** Count and label fixes in one doc (12 arms, 78/128 vs 77/87, IQ6R wording), 1–2 h; best-instrumented result in the repo (MXFP4 7–8x on every engine). Frame KL as closeness, not task quality.
2. **C9, the free lunch at 128k (T16).** Cite hardest-tasks instead of the recommendation doc and fix that doc's meta and ratios; say the 1024 cap is shallow-only. The follow-up the four published articles promise.
3. **C7, depth is a variable (T07).** Fix rocm713's 1.4x vs 1.7x; state that the DFlash2 depth trend follows the baseline. Better after the arms-speed run. (The rule-16 wording gate is met.)
Also B: **C8** as a case study once the 0900 decode conflict is fixed or avoided; **C11** after the MRCR errata (54.3% vs 94%, 13.9x, Q6 overreach).

### Track C — measure, then write
1. **Run `campaigns/perf/2026-11-13-1143-27b-arms-speed` (T07, T08, T09, T20). Recommended.** Approved and scaffolded; ~7–8 h minimal tier overnight (`INFERRED` in its README; M). First same-day ≥4-depth comparison of llama.cpp b11448, Sly and Radiance on Qwen3.8-27B, with n=2 cells and a prefix-reuse verdict per engine; feeds C7, C2 v2, C3, T20. Risk: headroom (q6k 31008 MiB at ready; Radiance has no watchdog): run `gpu_exclusive.sh`, keep the desktop idle.
2. **C1 confirm pair (T04), then write C1 (S).** ~30 min GPU (`INFERRED`): one pp 0 vs 0.01 pair, MTP on, b11448. C1's headline is a per-build host cost from b9950, four builds back (Track C rule); quote acceptance from the sampler-tax doc only.
3. **f16 vs q8_0 KV curve on b11448 (T05 → C12).** ~3–4 h GPU (`INFERRED`), one model, 5 depths; settles whether the July −40% still exists.
4. **Production-trio TS-TDD (T15).** L, ~2 nights (`INFERRED`); the only way to say which served model codes best; fold the T16 budget axis in.

### Track D — research or tool work
1. **Findings note for the CLAUDE.md-only incidents (T23 → C13).** S, no GPU; turns the four prose incidents into citable `MEASURED` rows from discarded campaign data (if the CSVs still exist under `tmp/`) and unblocks C13.
2. **`gguf_kv.py` gemma4 support + a measured-capacity table (T06).** S each; the CLAUDE.md TODO, answered from data already on disk.
3. **Build-check depth gate (T03).** Recommend that `compare_builds.py` refuse PROMOTE without the 32768/2048 shape; the promoted b11448 Vulkan was never checked past 2048/512. Its per-arm VRAM gate already exists.

**Valid but not shortlisted:** T03 32768/2048 compare (C, S); T12 kernarg test (C, S); T13 reboot test and core-10.1 rebuild; T18 V2 grade; T19 Ornith 1.5 4-depth run; T20 batched-2x32k write-up (D, S); stale campaign READMEs (T06, T18).

### Overall first pick
**Write C2 now, and launch the arms-speed campaign overnight the same day.** C2 is the cheapest writable piece with the
widest audience; its open items are the text fixes above, and it needs no GPU, so the card is free. The arms-speed
campaign unblocks the most (C7's modern comparison, C3's depth gap, C2's v2 section, the first concurrency grid) and is
already designed and approved. CANDIDATES ranks C1 first on hook strength; it publishes second because its headline is a
b9950 per-build number that needs the 30-minute b11448 confirm first.

### Open questions for the owner
1. **C3:** publish as a speed-only piece ("triton_unfused correctness untested"), or run the short correctness check (C, S: greedy token agreement or a few TS tasks, triton_unfused vs EMULATION) first? (open, 2026-11-17)

---

## Appendix — doc → topic map

All 99 catalog docs (prep §1) with the topics they feed; status and potential as the catalog records them. Cards cite a doc by its label: the date and slug of its path (guides by file name).

| path | topics | status | potential |
|---|---|---|---|
| `docs/articles/2026-07-16-27b-coding-model-on-one-amd-card.md` | T04, T16 | partial | high |
| `docs/articles/2026-07-16-assumptions-vs-reality.md` | T16, T04, T22 | partial | high |
| `docs/articles/2026-07-16-reasoning-budget-and-how-we-know.md` | T16, T22 | partial | medium |
| `docs/articles/2026-07-16-reasoning-budget-free-lunch.md` | T16 | partial | high |
| `docs/articles/linkedin/2026-07-16-27b-coding-model-on-one-amd-card.md` | T04, T16 | partial | low |
| `docs/articles/linkedin/2026-07-16-assumptions-vs-reality.md` | T16, T04, T22 | partial | low |
| `docs/articles/linkedin/2026-07-16-reasoning-budget-and-how-we-know.md` | T16, T22 | partial | low |
| `docs/articles/linkedin/2026-07-16-reasoning-budget-free-lunch.md` | T16 | partial | low |
| `docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md` | T11, T18 | partial | high |
| `docs/findings/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind.md` | T18 | partial | medium |
| `docs/findings/agentic/2026-10-31-0000-redhat-sharp-w208-blind.md` | T18 | partial | medium |
| `docs/findings/agentic/2026-10-31-0000-redhat191-sharp-w208-blind.md` | T11, T18 | partial | high |
| `docs/findings/agentic/2026-10-31-0000-redhat191-sharpsly2-w208-blind.md` | T18 | negative | medium |
| `docs/findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md` | T18, T21 | partial | high |
| `docs/findings/agentic/2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md` | T11, T18 | partial | high |
| `docs/findings/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind.md` | T18 | partial | medium |
| `docs/findings/hipfire/2026-09-10-0100-hipfire-bench-baseline.md` | T10, T22 | partial | medium |
| `docs/findings/hipfire/2026-09-10-0100-hipfire-bench-rocm713-final.md` | T10, T07 | partial | high |
| `docs/findings/hipfire/2026-09-10-0100-hipfire-final-analysis.md` | T10, T07, T12 | partial | high |
| `docs/findings/llamacpp/2026-07-09-0000-runtime-benchmark-r9700.md` | T01, T02 | partial | medium |
| `docs/findings/llamacpp/2026-07-10-1810-rdna4-r9700-tuning-optimum.md` | T01, T02, T21 | partial | high |
| `docs/findings/llamacpp/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md` | T01, T02, T05 | current | medium |
| `docs/findings/llamacpp/2026-07-11-1844-campaign-combo35b.md` | T04, T20 | partial | high |
| `docs/findings/llamacpp/2026-07-11-2200-deep-context-35b.md` | T07, T05, T20 | current | high |
| `docs/findings/llamacpp/2026-07-12-0006-27b-maxctx-f16.md` | T06, T22 | superseded | medium |
| `docs/findings/llamacpp/2026-07-13-0733-27b-serving-substrate.md` | T08, T05, T04 | current | high |
| `docs/findings/llamacpp/2026-07-16-0927-mtp-sampler-tax.md` | T04, T21 | current | high |
| `docs/findings/llamacpp/2026-09-11-1950-benchy-ideas-27b.md` | T04, T05 | current | medium |
| `docs/findings/llamacpp/2026-09-15-2016-muse-glimmer-vulkan-vs-rocm.md` | T02, T07 | partial | medium |
| `docs/findings/llamacpp/build-checks/2026-09-11-1537-llamacpp-b10909-build-check.md` | T03, T02 | current | medium |
| `docs/findings/llamacpp/build-checks/2026-09-11-1716-llamacpp-b10909-build-check.md` | T03 | current | medium |
| `docs/findings/llamacpp/build-checks/2026-09-14-2345-llamacpp-b10969-build-check.md` | T03 | current | low |
| `docs/findings/llamacpp/build-checks/2026-09-15-1029-stew675-buildcmp.md` | T03, T02 | partial | medium |
| `docs/findings/llamacpp/build-checks/2026-10-07-1205-llamacpp-b10969-vulkan-1.4.363.0-build-check.md` | T03 | current | low |
| `docs/findings/llamacpp/build-checks/2026-10-07-1214-llamacpp-b11448-build-check.md` | T03 | current | low |
| `docs/findings/llamacpp/build-checks/2026-10-07-1221-llamacpp-b790cf51aa-stew675-10.1-rocm-build-check.md` | T03 | negative | low |
| `docs/findings/llamacpp/build-checks/2026-10-08-1311-llamacpp-b790cf51aa-stew675-10.1-rocm-build-check.md` | T03 | negative | low |
| `docs/findings/llamacpp/build-checks/2026-10-08-1316-llamacpp-b11448-rocm-build-check.md` | T03 | partial | low |
| `docs/findings/llamacpp/build-checks/2026-10-08-1326-llamacpp-b790cf51aa-stew675-10.1-rocm-build-check.md` | T03 | negative | low |
| `docs/findings/llamacpp/build-checks/2026-10-08-1436-llamacpp-b790cf51aa-stew675-10.1-rocm-build-check.md` | T03 | negative | low |
| `docs/findings/llamacpp/build-checks/2026-10-08-1527-llamacpp-b11448-build-check.md` | T03 | negative | low |
| `docs/findings/llamacpp/build-checks/2026-10-08-1555-llamacpp-b11448-build-check.md` | T03, T12, T23 | partial | medium |
| `docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md` | T15, T22 | superseded | high |
| `docs/findings/quality/2026-07-13-1138-27b-quality-tuning.md` | T16 | current | high |
| `docs/findings/quality/2026-07-13-1657-27b-quality-at-depth-detailed.md` | T16, T22, T05 | current | high |
| `docs/findings/quality/2026-07-13-1657-27b-quality-at-depth-recommendation.md` | T15, T16, T14 | current | medium |
| `docs/findings/quality/2026-07-13-1657-27b-quality-at-depth.md` | T16, T22 | superseded | medium |
| `docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b-pre-summary.md` | T15, T16 | superseded | high |
| `docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b.md` | T15, T16, T05 | current | high |
| `docs/findings/quality/2026-07-19-0000-ornith-vs-gemma.md` | T15, T02 | partial | medium |
| `docs/findings/quality/2026-07-27-0000-runner-benchmark-unified.md` | T15, T22 | current | high |
| `docs/findings/quality/2026-09-02-1437-mrcr-v2-qwen38-27b-q6k.md` | T17 | current | high |
| `docs/findings/quality/2026-11-09-1825-27b-arms-kld.md` | T14, T05 | current | high |
| `docs/findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md` | T09, T07, T08 | partial | high |
| `docs/findings/radiance/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` | T09, T07, T11 | current | high |
| `docs/findings/radiance/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md` | T09, T19 | current | high |
| `docs/findings/rocm-driver/2026-10-07-0749-rocm-10.1-vs-10.0-7.13.md` | T13, T02 | current | low |
| `docs/findings/rocm-driver/2026-10-07-1745-rocm-fa-hsa-memory-fault.md` | T12, T13 | partial | medium |
| `docs/findings/vllm/2026-09-11-2047-vllm-qwen38-27b-int4.md` | T09 | partial | high |
| `docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md` | T06, T07, T09 | current | high |
| `docs/findings/vllm/2026-10-22-1324-vllm-sly-mxfp4-depth.md` | T09, T08, T21 | current | high |
| `docs/findings/vllm/2026-10-22-1406-vllm-sly-mxfp4-dflash.md` | T09, T08 | current | high |
| `docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` | T06, T12 | superseded | medium |
| `docs/findings/vllm/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md` | T12, T23 | superseded | medium |
| `docs/findings/vllm/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md` | T12 | partial | high |
| `docs/findings/vllm/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth.md` | T09, T11, T21 | current | high |
| `docs/findings/workers/2026-11-04-2207-sly-radiance-ornith-vs-haiku-high-effort.md` | T19 | current | high |
| `docs/findings/workers/2026-11-05-0814-ornith-use-cases.md` | T19 | current | high |
| `docs/findings/workers/2026-11-06-0930-haiku-manual.md` | T19 | current | medium |
| `docs/findings/workers/2026-11-06-0930-ornith-manual.md` | T19, T20 | current | high |
| `docs/guides/GUIDE.md` | T22 | current | medium |
| `docs/guides/driver-upgrade-runbook.md` | T13, T23 | partial | high |
| `docs/guides/vllm/README.md` | T09 | current | low |
| `docs/guides/vllm/historical.md` | T12 | current | high |
| `docs/guides/vllm/known-issues.md` | T09, T12, T23 | current | high |
| `docs/guides/vllm/settings.md` | T09, T06 | current | medium |
| `docs/guides/vllm/sources.md` | T09 | current | low |
| `docs/guides/vllm/versions.md` | T09, T06 | current | medium |
| `docs/guides/vllm/workflows.md` | T23, T09 | current | low |
| `docs/research/hipfire/2026-09-10-0100-hipfire-engine-research.md` | T10 | partial | medium |
| `docs/research/llamacpp/2026-07-10-0000-rdna4-llamacpp-ollama-backend-tuning.md` | T01, T02 | current | high |
| `docs/research/llamacpp/2026-07-16-1016-spec-draft-p-min-mtp.md` | T04 | superseded | high |
| `docs/research/llamacpp/2026-10-07-0852-rdna4-llama-cpp-vulkan-compile-settings.md` | T01, T03 | partial | medium |
| `docs/research/methodology/2026-07-11-0918-benchmark-harness-build-vs-adopt.md` | T22 | current | medium |
| `docs/research/methodology/2026-07-11-1630-vllm-benchmark-serving.md` | T22, T20 | current | low |
| `docs/research/methodology/2026-07-13-1712-hard-ts-quality-benchmark-design.md` | T22, T15 | current | medium |
| `docs/research/models-sampling/2026-07-12-2310-qwen36-sampling-llamacpp-serving-knobs.md` | T16 | superseded | medium |
| `docs/research/models-sampling/2026-07-14-1430-radeon-llm-finetune-frameworks.md` | T24 | current | medium |
| `docs/research/models-sampling/2026-07-14-1550-gfx1201-llm-training-feasibility.md` | T24 | current | medium |
| `docs/research/models-sampling/2026-07-15-1000-qwen36-sampling-thinking-budget-variance.md` | T16 | current | high |
| `docs/research/models-sampling/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md` | T15, T06 | current | high |
| `docs/research/models-sampling/2026-10-31-1630-kv-cache-quantization-long-context.md` | T05, T14 | partial | high |
| `docs/research/models-sampling/2026-10-31-1635-quantization-reasoning-length-compaction-variance.md` | T18, T14 | current | medium |
| `docs/research/models-sampling/2026-10-31-1725-preserved-thinking-how-much-to-keep.md` | T18 | partial | medium |
| `docs/research/rocm-driver/2026-07-09-0000-rdna4-r9700-llm-optimization.md` | T13, T23 | current | medium |
| `docs/research/rocm-driver/2026-10-08-0930-rocmtos-cachyos-ubuntu2604-rdna4.md` | T13 | current | low |
| `docs/research/vllm/2026-07-12-2300-rdna4-vllm-aiter-fp8-status.md` | T09 | current | medium |
| `docs/research/vllm/2026-11-04-1630-qwen35-35b-a3b-vllm-rocm-decode-gap.md` | T09 | superseded | high |
| `docs/research/vllm/2026-11-04-1702-qwen35-35b-a3b-radiance-config-alternatives.md` | T09 | superseded | high |
