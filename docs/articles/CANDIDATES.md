# Article candidates — what in this repo could become a published article

Generated **2026-11-16** from `docs/catalog.jsonl` (99 docs: 44 rated "high", 36 "medium", 19 "low" by
the note-takers), `docs/CATALOG-problems.md`, the note-takers' errata
(`notes/tmp/2026-11-16-1055-5775a676/errata.md`) and a handful of spot checks in the source docs. This
file is a plan, not an article. Each candidate below carries enough evidence pointers that a later session
can write it **without re-reading the source docs**: open only the cited section.

**How to use it**

- The full card for any cited doc: `python3 docs/catalog.py show <path-substring>`. Add `--outline` to get
  its headings with line numbers. `docs/CATALOG-problems.md` lists the problems/fixes per doc.
- `§Heading (Lnn)` = the heading in the source doc and its line number (from the catalog manifest). Read
  that section, not the whole doc.
- Every number is tagged per iron rule 1: `MEASURED` (campaign row behind the doc), `CLAIMED` (external),
  `INFERRED` (arithmetic or reasoning). Keep the tag when you quote it.
- Before quoting, check §4 *Errata* for the docs you use, and the candidate's own *Gaps* list.
- Naming: the families are distinct checkpoints (`Qwen3.6-27B` vs `Qwen3.8-27B`, `Ornith-1.0-35B` vs
  `Ornith 1.5`, plus `Qwen3.5-35B-A3B` / `Qwen3.6-35B-A3B`; CLAUDE.md lists them since 2026-11-16).
  Use the name the cited doc used, with its exact checkpoint (the cards' `versions:` line), and do not merge the families.

Already published (do not duplicate): `docs/articles/2026-07-16-27b-coding-model-on-one-amd-card.md`,
`…-assumptions-vs-reality.md`, `…-reasoning-budget-free-lunch.md`, `…-reasoning-budget-and-how-we-know.md`
and their four LinkedIn derivatives in `docs/articles/linkedin/`. All four rest on one shallow-prompt,
reps=1 sweep of Qwen3.6-27B (MTP 2.25x, an MTP file vs a no-MTP file; thinking cap 512–2048 = free lunch; runaways 7.1% → 0%;
`--reasoning-budget 0` is uncapped). Their own stated gap is "depth untested". C9 is that follow-up.

---

## 1. Ranked summary

| # | Working title | One-line thesis | Evidence | Readiness | Effort | Overlap with published |
|---|---|---|---|---|---|---|
| 1 | A sampler setting that changes no tokens still costs 29% of decode | Any penalty sampler adds a fixed ~2 ms/token host cost, which hurts most on the fastest (MTP) step; the other draft knobs (p_min, n_max) trade speed for nothing | strong | ready after a b11448 confirm pair (~30 min GPU; headline is a b9950 per-build rate) | S | follow-up to *assumptions-vs-reality* (p_min test) |
| 2 | Prefix reuse, not raw prefill, decides agentic latency | The "slow prefill" was a small-prompt artifact; a warm prefix cuts TTFT 13.7–17.4x on two engines and turns a 135k-token Sly turn into 15 s, and one engine's cache is zero under two agents | strong | ready (text fixes: MRCR 13.9x; only 1055's prefix rows) | S | none |
| 3 | One flag, 6.6x: where vLLM's MoE decode gap on RDNA4 came from | The default EMULATION MoE backend, not the GPU, held a 35B-A3B at 16.6 tok/s; our own "no 35B reaches 200 tok/s" verdict then fell to a 219.8 tok/s measurement | strong | ready (text fixes: one source per number; drop the quarantined ROCM_ATTN row; say correctness untested) | M | none |
| 4 | When the ruler is broken | Six times our instrument lied (grader that never ran, string-keyed scorer, cache answering for the engine, flags and gates that read green); the rules that catch it | strong | ready (text fixes: 29.0 GiB unsampled; runner rows recomputed) | M | partial: *assumptions-vs-reality* (truncated flag) — cite, don't retell |
| 5 | Quant fidelity on one card: Q6_K, IQ4R, and MXFP4 at 7–8x on every engine | Teacher-forced KL over 4096 positions: the 4-bit format, not the engine, sets distance; q8_0 KV and DFlash show no resolved cost | strong | needs fixes (count errata) | M | none |
| 6 | What to hand a free local model, and what not to | Ornith is trustworthy where a script can check the output (extraction, JSON, splitting) and not for judgement, completeness or retyping; the effort knob does nothing | mixed | ready (text fixes: the manual's dp-prompt rule; 16, 16, 21 of 21) | M | none |
| 7 | Depth is a variable: rankings that flip between 8k and 160k | Prefill decays as a power law with engine-specific exponents; three engine rankings invert with depth or workload; speed-ups shrink or grow with depth | mixed–strong | needs fixes | M | none |
| 8 | Faster per token, slower per task: lossy acceptance traps an agent in loops | Cactus δ 0.5 decodes 65% faster yet takes 2.4x the wall; on 1.8.1 a drafted token with p ≥ 0.5 is accepted with certainty, so loops have no exit | mixed | needs fixes | M | none |
| 9 | The free lunch at 128k: what survives at depth | Follow-up to the published sweep: at ~133k a 4x thinking budget buys +0.3 pts on the 27B, the vendor coding sampler wins, the quant ladder is a null, and the wall is lint/types | mixed | needs fixes | M | direct follow-up to all four published articles |
| 10 | A random GPU memory fault, a cleared bit 44, and one environment variable | An investigation narrative: wrong suspects, a pointer log, `HIP_FORCE_DEV_KERNARG=0`, and why `/health` lied the whole time | mixed | ready (text fixes: three cross-note wordings in 1745, 1506, 0023) | M | none |
| 11 | MRCR v2 at 131K on one 32 GB card: 0.85, and the failures are counting errors | A local 27B Q6_K matches the published frontier band on the hardest bucket; failures are wrong-instance picks, not context loss | mixed | needs fixes | S | none |
| 12 | q8_0 KV on RDNA4: free in quality, not in speed, and the answer moved with the build | Quality cost is unresolved/near zero; the prefill penalty grew with depth on b9950 (−11.8% at 32K, −39.8% at 200K) but tied on b10909 to 18.4k | mixed | needs new data | M | none |
| 13 | The GPU is not yours: silent contention on a desktop-shared card | Orphans, resident llama-swap models, paging allocators and thin headroom turn contention into fake findings or a crashed desktop; gate on free VRAM first | mixed | needs fixes (incidents not in a findings doc) | M | none |
| 14 | Vulkan or ROCm on RDNA4? It depends on model, build and depth | Vulkan won July; ROCm prefill moved +40% between two builds; a patch helps one backend and hurts the other; for Gemma the driver chose | mixed | needs new data | L | none |
| 15 | Agentic token cost is set by steps and templates, not thinking density | Thinking per tool call is flat; step count, chat template and reasoning replay drive the bill | thin | needs new data | M | none |

---

## 2. Candidates

### C1 — A sampler setting that changes no tokens still costs 29% of decode

- **Thesis.** Enabling any penalty sampler (presence/frequency/repeat) costs a fixed ~2 ms of host work per
  token. On a slow step that is noise; on a fast MTP step it is Amdahl's law: a 29% decode loss with a
  byte-identical reply. The two "obvious" draft knobs do not help either: raising `--spec-draft-p-min`
  buys acceptance and loses speed, and drafting past n_max 3 loses to MTP off.
- **Hook.** `presence_penalty 0.01`, too small to change a token, cut 35B-A3B decode from 161.1 to 115.1
  tok/s (−28.6%) with an identical reply sha1 and identical draft acceptance 69.06% (`MEASURED`, b9950).
- **Audience / format.** llama.cpp operators tuning speculative decoding; long-form blog (1,500–2,000
  words) + LinkedIn teaser. Part 2 of series A.
- **Outline.**
  1. The anomaly: a no-op setting that costs 29%.
  2. Isolating it: byte-identical pairs, same acceptance, three configs, same ~2 ms.
  3. Why fast steps suffer most (Amdahl) and what the GPU counters do and do not say.
  4. It does not grow with depth (133k confirm).
  5. The other two knobs: p_min (acceptance up, speed down) and n_max (peak at 2–3; 8 is worse than off).
  6. What to set: penalties 0, default n_max, vendor coding sampler; the quality side agrees.
- **Evidence map.**
  - §1–2: `docs/findings/llamacpp/2026-07-16-0927-mtp-sampler-tax.md` §Summary — the answer in one table (L25):
    host Δ +1.97 (27B dense, MTP on), +2.07 (35B, MTP off), +1.95 ms/tok (35B, MTP on); 35B MTP-on decode
    161.1 → 115.1 tok/s (−28.6%), reply sha1 30303b0c79da, draft 585/404 (`MEASURED`).
  - §3: same doc §What the GPU counters say — and what they do *not* say (L59): server CPU 0.64–0.69 of 12
    threads; GPU busy 93.4% (pp 0.0) vs 80.6% (pp 0.01); sclk 3162 → 2084 MHz; power 220 → 146 W
    (`MEASURED`). Vocabulary-scan explanation of the 2 ms is `INFERRED` (not profiled).
  - §4: same doc §Depth confirm at ~132.9k tokens — the tax is ~2 ms/tok, depth-invariant (L125): MTP off
    +1.37/+1.29, MTP on n-max 3 +1.94/+1.69 ms/tok; pp 1.5 total +3.35/+3.72 ms/tok with acceptance 83 → 66
    and 64 → 47 (`MEASURED`, n=2, one prompt).
  - §5a: `docs/research/llamacpp/2026-07-16-1016-spec-draft-p-min-mtp.md` §Research: llama.cpp
    `--spec-draft-p-min` and the MTP path: p_min 0 / 0.5 / 0.9 / 0.99 → draft tok/pass 2.98 / 2.10 / 1.05 /
    0.46, acceptance 69 / 82 / 99 / 100%, decode 159.9 / 146.9 / 125.9 / 106.5 tok/s (`MEASURED`, 35B, seed
    42); 6/6 distinct replies across seeds 42–47 at every p_min (`MEASURED`); default 0.0f on b9950
    (`CLAIMED`, source reading) §1–2 (L44).
  - §5b: sampler-tax doc §`--spec-draft-n-max` (L92): n-max 1/2/3/4/6/8 → 134.7/155.0/159.6/151.6/128.9/80.2
    tok/s, MTP off 107.6 (`MEASURED`, ctx 4096, n=1); MTP not output-preserving: seed 42 e40c532d vs
    30303b0c (`MEASURED`). Second box/build: `docs/findings/llamacpp/2026-09-11-1950-benchy-ideas-27b.md`
    §Consequences & root causes (L110): 3 → 5 drafts = verify step 54 → 75 ms (+39%), tau +23%, decode
    −11.4% (depth 0) / −19.6% (16384) (`MEASURED`, b10909, n=3).
  - §6: `docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b.md` §Axis 3 (L195): Qwen general
    preset (temp 1.0, pp 1.5) 62.1 TS vs coding recipe 77.5, Δ −15.4, t=−3.41 (`MEASURED`); §The
    penalty-sampler tax (L226): decode 78.1 / 72.6 vs 115.7–120.2 tok/s at pp 0 (`MEASURED`).
- **Gaps before publishing.**
  - Scouting probe: ctx 4096, ~24-token prompt, n=1 on most cells; the depth confirm is n=2 on one prompt.
    Say "scouting" in the text.
  - The ~2 ms is a Ryzen 5 3600 number on b9950; latest-vulkan is b11448. Run one confirmation pair
    (pp 0 vs 0.01, MTP on) on b11448 before publishing (~30 min GPU, `INFERRED`); it protects the headline.
  - Errata: the hardest-tasks doc gives acceptance 81.5% → 77.4% (campaign cells) where the sampler-tax depth
    confirm gives 83 → 66 (pp 1.5 pair); they are different measurements — name which one you quote.
  - The hardest-tasks "Δ host CPU" column does not match its step-time columns (errata p03): quote host cost
    from the sampler-tax doc only.

### C2 — Prefix reuse, not raw prefill, decides agentic latency

- **Thesis.** A cold-prefill number at agentic depth measures a request shape that rarely occurs (iron
  rule 17). Agent turns grow a cached prefix; with reuse, a 32K turn costs seconds. The real risks are
  the engines where the cache silently is not there.
- **Hook.** A warm 32K prefix cut time-to-first-token from 42.66 s to 3.12 s (13.7x), and the earlier
  "~200 tok/s prefill" was a per-request floor on 51–99-token prompts (`MEASURED`, llama.cpp b9950).
- **Audience / format.** Agent builders on local GPUs; medium blog post (1,200–1,500 words). Series A part 1.
- **Outline.**
  1. The artifact: why tiny prompts made prefill look 4x slower.
  2. The real curve at 8K/32K/64K, and the warm-prefix number.
  3. Same effect on vLLM (GDN hybrid) and Radiance, and the MRCR bucket that became affordable.
  4. Where the cache is zero: hipfire with two agents; DFlash's coarse cache alignment.
  5. How to benchmark it: a growing multi-turn probe, not a cold one-shot.
- **Evidence map.**
  - §1–2: `docs/findings/llamacpp/2026-07-13-0733-27b-serving-substrate.md` §Results (L46): cold prefill
    830.8 / 756.3 / 666.1 tok/s at 8K / 32K / 64K (`MEASURED`); §Consequences & root causes (L96): TTFT
    42.66 s cold → 3.12 s warm (13.7x); cache-reuse flags 3.11 s (no change) (`MEASURED`, reps 3–4).
  - §3a: `docs/findings/vllm/2026-10-22-1324-vllm-sly-mxfp4-depth.md` §Consequences & root causes (L102):
    turn-8 TTFT 15.1 s for 15,084 new tokens vs 90.2 s for a cold 135,689-token prompt (`MEASURED`).
  - §3b: `docs/findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md` §Findings (L102):
    32,294-token prompt 43.93 s → 2.53 s (17.4x); with the last ~25 tokens changed, partial hits match full
    hits on both engines (radiance 2.526 vs 2.428 s, llama.cpp 3.341 vs 3.357 s; cold 44.312 / 38.167 s) (`MEASURED`).
  - §3c: `docs/findings/quality/2026-09-02-1437-mrcr-v2-qwen38-27b-q6k.md` §Throughput, and why the bench
    figures were wrong here (L220): sample 1 551 s (132,997 tokens prefilled), samples 2+ ~40 s (median
    39.5, range 27.6–65.5) with 2,052 tokens prefilled; 35 samples in 1928 s (`MEASURED`).
  - §3d: `docs/findings/vllm/2026-10-22-1406-vllm-sly-mxfp4-dflash.md` §What moved the needle (L118):
    9-turn conversation to 131k 108.3 s vs 184.8 s baseline, 86% of it prefill (`MEASURED`).
  - §4a: `docs/findings/hipfire/2026-09-10-0100-hipfire-final-analysis.md` §3.6 The cache that is not a
    cache (L219): with two agents, agent A's 400-char follow-up took 52.4 s, same as cold; ~7 min per agent
    switch at 73k (`MEASURED`).
  - §4b: 1406 doc §Consequences & root causes (L124): with the drafter, cached prefix alignment 64 → 880
    tokens, KV pool −20% (`MEASURED`).
  - §5: CLAUDE.md iron rule 17; `docs/guides/GUIDE.md` §Measurement rules (L218): without
    `PREFIX_MODE=unique` repeat-2 prefill read 2.4x high (`MEASURED` per the guide).
- **Gaps before publishing.**
  - The 0733 warm probe used an identical prompt. The 1055 partial-hit rows change only the last ~25 tokens
    (partial ≈ full on llama.cpp and radiance); a turn that appends thousands of tokens is unmeasured on llama.cpp.
  - The 1324 pair (15,084 new tokens vs a cold 135,689) is not size-matched; present it as an illustration.
  - MRCR speed-up: the doc says 12.5x, its own numbers give ~13.9x (551/39.5) — errata p03; recompute.
  - 1055 carries many internal conflicts (see §4); quote only the prefix-caching rows, and no warm-TTFT winner
    (its findings 19 and 23 disagree).
  - 1324 and 1406 ran on Sly 1.6.0 before the kernarg fix; fine for TTFT, say so.

### C3 — One flag, 6.6x: where vLLM's MoE decode gap on RDNA4 came from

- **Thesis.** A 35B-A3B MXFP4 model decoded 5x slower than the dense 27B on the same vLLM image because the
  default MoE backend (EMULATION) dequantizes every expert on every step. One flag fixed most of it.
  Then our own "no 35B can reach 200 tok/s on this card" verdict was overturned by a model our search had
  missed. Around it: three more vLLM defaults that cost you on RDNA4.
- **Hook.** Switching only `--moe-backend` from EMULATION to `triton_unfused` took Qwen3.5-35B-A3B MXFP4
  from 16.6 to 110.2 tok/s decode at 10k (`MEASURED`, Sly 1.9.1, DFlash K=7, mean of 3).
- **Audience / format.** vLLM/Radiance operators on AMD consumer cards; long-form blog. Series B part 1.
- **Outline.**
  1. The gap: 35B at 14–17 tok/s vs 27B at 74–100 on the same image.
  2. Diagnosis by arithmetic: ~96 GB of traffic per step under EMULATION.
  3. The flag and what it costs (prefill −14–21%, KV pool up).
  4. The verdict we got wrong: native Radiance + Ornith 1.5 at 219.8 tok/s.
  5. The other defaults: ROCM_ATTN decode collapse (only after a rerun: its row is quarantined), fp8 KV as an
     exact null on a hybrid, KV group size.
  6. The price of fast: 96 MiB default headroom crashed the desktop.
- **Evidence map.**
  - §1: `docs/research/vllm/2026-11-04-1630-qwen35-35b-a3b-vllm-rocm-decode-gap.md` §1. The 27B reference,
    verified (L23): 35B 17.07 / 15.51 / 14.22 tok/s at 10k/50k/100k (`MEASURED`, p50, n=3); 27B DFlash2
    100.2 / 73.9 / 93.9 / 80.5 tok/s at 10k/50k/100k/145k (`MEASURED`, mean of 2).
  - §2: same doc §2. Which code path decides decode speed (L35): ~180 ms/step vs 37–44 ms (`INFERRED`);
    ~96 GB/step (64.4 GB bf16 written + 17.1 GB packed reads + 14.5 GB GEMM) (`INFERRED`); 640 GB/s
    bandwidth (`CLAIMED`, press listings).
  - §3: `docs/research/vllm/2026-11-04-1702-qwen35-35b-a3b-radiance-config-alternatives.md` §Measurements
    (L22): triton_unfused 110.2 / 92.9 / 67.3 vs EMULATION 16.6 / 15.4 / 15.8 tok/s (`MEASURED`, mean of 3);
    acceptance 27.9%, 2.95 tok/step, KV 448,702 tokens, peak 31,327 MiB (`MEASURED`); §Root cause (L36) step
    ~173 → ~27 ms (`INFERRED`). `docs/guides/vllm/settings.md` §`--moe-backend triton_unfused` (L33): KV
    305,666 → 448,702 tokens; prefill −14–21% (`MEASURED`, short replies).
  - §4: 1702 correction box (L10) and §Why 2x remains unlikely on Sly (L49): 200 tok/s needs ~5.4 tok/step
    at 27 ms (`INFERRED`); MiniCPM-V 4.7 169.4 vs 132.4 (`CLAIMED`).
    `docs/findings/radiance/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md` §Results (L35): Ornith 1.5
    w4a8 native Radiance decode 219.8 / 205.0 / 174.5, prefill 13,059 / 8,029 / 5,301 tok/s at
    10k/50k/100k (`MEASURED`, mean of 3); Ornith MXFP4 on Sly: MTP fails to load, DFlash K=3 95.2 / 71.0 /
    66.5 (`MEASURED`).
  - §5a: `docs/findings/vllm/2026-09-11-2047-vllm-qwen38-27b-int4.md` §Results (L35): ROCM_ATTN 2.8–2.9
    tok/s at 32k is a quarantined, gauge-derived row, not a result (rule 18; rerun before quoting); TRITON_ATTN 14.12 (`MEASURED`); TRITON_ATTN
    prefill 222.4 vs ~470 (`MEASURED`, log-derived); §Kernel-level root causes (L62): 963 kernels/step,
    22.89 ms idle in a 59.0 ms step (`MEASURED`, torch profiler).
  - §5b: `docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md` §Finding A3 (L267): fp8 KV
    pool identical to the digit (65,381 / 138,416 tokens); MTP-8 cuts pool/GiB 25,529 → 12,972 at ctx 36864
    (`MEASURED`, boot logs). settings.md §`RADIANCE_*` knobs (L71): KV group 5 does not boot at 262000 with
    DFlash K=7 (`MEASURED`).
  - §6: `docs/guides/vllm/known-issues.md` §Native Radiance default headroom starves the desktop (L35):
    232.52 MiB free at load, 113 MiB at peak; Chrome and GNOME Shell crashed ~7 min later (crash cause
    `INFERRED`); 1746 §Consequences & root causes (L104).
- **Gaps before publishing.**
  - Errata (1630): its meta tags the ~180 ms step `MEASURED`, its body `INFERRED` — use `INFERRED`; its
    summary says no non-emulated MXFP4 MoE runs on gfx1201 while its table leaves triton_unfused untested —
    tell it as "the doc's prediction, then the test".
  - Errata (1702 vs 1630): 100k decode 15.8 (mean of 3) vs 14.22 (p50); 27B 3.45 vs 3.68 tok/step —
    quote one source per number.
  - Errata (27B Sly decode): 122.3 tok/s at 10k (radiance/2026-10-30-0900, Sly 1.8.1, δ 0.5, ctx 110000)
    vs 86.9 (1746, Sly 1.9.1, ctx 262000) — unreconciled; do not use the 27B as a single reference number.
  - triton_unfused correctness and MTP on it are untested; short replies only; three depths (rule 16: fits
    from 1746 are indicative only). Ornith (Radiance) vs Sly arms change model and engine at once.
  - 1535 §2 MTP-off row (36,864 ctx, pool 197,973) not marked superseded by the c3 rerun (184,320).
  - [fixed in CLAUDE.md 2026-11-16] 1746 called CLAUDE.md's "no swap" stale (box has 4.7 GiB swap); CLAUDE.md now words it as a
    recommendation, so print the box as 1746 measured it.

### C4 — When the ruler is broken

- **Thesis.** Most of our wrong conclusions were not model or engine effects; they were the instrument.
  A grader that never ran, a scorer keyed by string, a prefix cache answering for the engine, a truncation
  flag and green gates that missed real failures, a KV formula with the wrong architecture. Each has a
  cheap guard; the guards are now repo rules.
- **Hook.** The same 120 frozen answers scored 24–33% under a grader whose vitest step never executed and
  67–79% after a CPU-only re-grade — a 27B "below Haiku" became "between Haiku and Sonnet" (`MEASURED`).
- **Audience / format.** Anyone publishing local-model benchmarks; long-form methodology essay, one short
  case per section. Series C part 1.
- **Outline.**
  1. The grader that never ran (vitest fault).
  2. The scorer that made a re-run look 60x noisier (KLD string keys).
  3. The cache that answered for the engine (18.5 vs 805 tok/s).
  4. Flags and gates that read green (truncated_thinking; ThinkingCap overwriting translations).
  5. The formula that under-called the ceiling (260 vs 64 KiB/tok).
  6. Variance bigger than any effect (between-block +78%).
  7. The guards: pre-grade self-check, noise floors, unique prefixes, quarantine (iron rule 18).
- **Evidence map.**
  - §1: `docs/findings/quality/2026-07-13-1657-27b-quality-at-depth-detailed.md` §1.4 Incident record
    (L116): voided 24–33% vs clean re-grade 67–79% on the same 10 cells (`MEASURED`); §TL;DR (L29): best cell
    79% vs haiku 74, sonnet 85, opus 95 one-shot references (`MEASURED`, references not depth-matched).
    Superseded original: `…/2026-07-13-1657-27b-quality-at-depth.md` §Summary (L26) — cite only as the record.
  - §2: `docs/findings/quality/2026-11-09-1825-27b-arms-kld.md` §7.5 Scorer fix (2026-11-12) (L345): Q8_0
    re-run floor 0.1106 before, 0.00176 after; arm d 0.167 → 0.0638 (`MEASURED`).
  - §3: `docs/findings/hipfire/2026-09-10-0100-hipfire-bench-baseline.md` §Prefix-cache defeat (methodology
    correction) (L34): 18.5 tok/s with wall 0.53 s and prompt_n ~4; with a unique per-request prefix
    805–843 tok/s (`MEASURED`). GUIDE §Measurement rules (L218): 2.4x inflation on repeat 2.
  - §4a: `docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md` §Truncation / runaway — and a flag
    bug (L93): three runaways at the 8192 cap with empty answers, flag False for all three (`MEASURED`). The
    published *assumptions-vs-reality* §Assumption 3 (L53) already tells the 0% vs 7.1% version — link it.
  - §4b: `docs/findings/quality/2026-07-27-0000-runner-benchmark-unified.md` §4.5 Gate reality (L280):
    ThinkingCap-27B-Q6_K_L passed all runner gates and overwrote working `hu.ts` translations in 4 of 5
    samples; judge 3-4-2 (`MEASURED`).
  - §5: `docs/findings/llamacpp/2026-07-12-0006-27b-maxctx-f16.md` banner + §Ceiling vs formula (L64): the
    27B is hybrid, f16 KV 64 KiB/tok not 260 (`INFERRED` from GGUF geometry); 200K f16 loaded in 31 s; the
    banner's 29.0 GiB was never sampled (no gpu_samples), so tag it unsampled, not usage (rule 7); formula under-called the ceiling 8–11% (`MEASURED`).
    Also `docs/findings/llamacpp/2026-07-11-1844-campaign-combo35b.md` §Results — single stream (L29): the
    cr64000 fixture (~65,019 tokens) could not fit a 65,536 window, all 8 configs returned no tokens.
  - §6: runner doc §3.4 Variance (L143): Brian6145 27B T010 wall 318.3 s vs 566.5 s between blocks (+78%)
    (`MEASURED`); §5 Key findings (L307): `RUNNER_SEED=12345` twice → byte-identical output (`MEASURED`).
  - §7: hardest-tasks §Health (L428): grader fix held across 210 replies, no grade_error rows (`MEASURED`);
    KLD §4 Noise floors (L232): llama.cpp re-run 0.00176, vLLM re-boot +0.000004 (4083/4096 rows
    bit-identical), radiance re-boot 0.0 (`MEASURED`); CLAUDE.md iron rule 18.
- **Gaps before publishing.**
  - Runner doc errata (p03): its σ are population SD labelled sample SD; headline counts (119 runs, five
    local models) omit the ThinkingCap arm; "ThinkingCap fastest / Brian6145 cheapest" are wrong on its own
    table; "q8_0 no spill" vs 1,431 MiB GTT. Quote only §4.5 and §3.4 rows, recomputed.
  - hipfire baseline errata (p01): headline vs per-run tables swap the two 27B models — §3 only needs the
    cache-vs-unique contrast, not the model attribution.
  - maxctx-f16's banner calls its 29.0 GiB `MEASURED`, but no VRAM was sampled: quote it as unsampled (fix first).
  - Keep the truncated-flag section short (published).

### C5 — Quant fidelity on one card: Q6_K, IQ4R, and MXFP4 at 7–8x on every engine

- **Thesis.** Teacher-forced KL against a Q8_0 reference resolves quant differences that task scores
  cannot: UD-Q6_K is closest, the radiance-native IQ4R-L-V4 sits between Q6 and Q4_K_XL, and every MXFP4
  arm sits 7–8x further whatever the engine. q8_0 KV and DFlash show no resolved cost; an int4 LM head
  does.
- **Hook.** All six MXFP4 arms sit at KL 0.056–0.066 from Q8_0 on both radiance and Sly vLLM, about 7–8x
  the IQ4R-L-V4 arm; the 4-bit format drives the distance, not the engine (`MEASURED`, 4096 positions per
  arm, cluster-bootstrap CIs).
- **Audience / format.** People choosing quants/KV types; people building KL comparisons; long-form blog
  with the scorecard chart. Series D part 1.
- **Outline.**
  1. Why KL and not task scores (the "silent zone").
  2. Method: 128 prompts × 32 positions, paired differences, noise floors.
  3. The ranking.
  4. Format vs engine: MXFP4 everywhere.
  5. What does not cost (q8_0 KV, DFlash) and what does (int4 LM head, the heretic fine-tune).
  6. The scorer bug and how the floors caught it.
  7. Limits: short contexts, Q8_0 reference, ~2x above Unsloth's published values.
- **Evidence map.**
  - §1: arms-kld §8 What KLD means, in plain words (L450); external KV evidence:
    `docs/research/models-sampling/2026-10-31-1630-kv-cache-quantization-long-context.md` §Evidence (L65):
    Qwen3 8B PPL q8_0 7.3195 vs f16 7.3203; Hopper FA3 fp8 needle at 128k 91% → 13% before the two-level
    accumulation fix, 89% after (`CLAIMED`).
  - §2: arms-kld §7.2 How it is measured (L297), §7.4 Positions rule (L335), §4 Noise floors (L232).
  - §3: §2 Scorecard (L99): UD-Q6_K 0.00448 [0.00295, 0.00628], top-1 98.97%; IQ4R-L-V4 (radiance 1.17.0)
    0.00794 [0.00554, 0.01070], c − q6k +0.00347 resolved; UD-Q4_K_XL 0.01636 [0.00948, 0.02505]
    (`MEASURED`).
  - §4: §1 Summary (L47): MXFP4 0.056–0.066; c − d −0.0558 [−0.0746, −0.0398], c lower on 100% of prompts
    (`MEASURED`).
  - §5: §1 Summary: q6kf16 − q6k −0.00003 (not resolved); q4kxlf16 − q4kxl +0.0009 [+0.0002, +0.0018]
    (`MEASURED`); §5 DFlash and MTP (L248): forced d − d0 +0.0031 (not resolved), greedy KL 0.0059, 16
    prompts (`MEASURED`); §6 The lm-head finding (L270): dfh − d0 −0.00451 resolved, ~7% of d0 distance
    (`MEASURED`); heretic e 0.0887, e − d181 +0.0225 resolved (`MEASURED`).
  - §6: §7.5 (L345) 0.1106 → 0.00176 (`MEASURED`).
  - §7: §7.9 Comparison with Unsloth's published KLD (L429): ours ~2x above (Q4_K_XL 0.0172 vs ~0.0075;
    Q6_K 0.0044 vs ~0.0025) (`INFERRED`; Unsloth values `CLAIMED`, read off chart images, ~10%);
    §10 Limitations (L556).
- **Gaps before publishing.**
  - Errata (p03): "fifteen arms" = 12 distinct + 3 floor re-runs — say 12; 78/128 vs 77/87 counts; IQ6R
    boot vs the `--tp 2` claim; "6–9 GiB" vs "40–52%"; q6k boot peak quoted below the at-ready figure. Fix
    in the source doc first.
  - Short contexts only (no depth); MTP not measured; fp8 KV share of arm c and the MXFP4 arms unmeasured;
    most arms mix weights + KV + engine (only q6kf16 and q4kxlf16 are weights-only).
  - KL measures closeness, not task correctness; near the reference it stops predicting task scores.
  - Naming: Qwen3.8-27B here.

### C6 — What to hand a free local model, and what not to

- **Thesis.** A free local 35B-A3B worker (Ornith 1.5 on native Radiance) is reliable when a script can
  check its output and unreliable when the job needs completeness or judgement. Retyping is the cliff.
  The effort setting does nothing; one document per session and a terse system prompt help.
- **Hook.** Across seven reports at 117k tokens Ornith put 32 of 35 facts on the exact cited line and
  invented none, but its verdicts on four deep reports scored 8 and 9 of 12 against Haiku-high's 12 and 11
  (`MEASURED`, blind-graded).
- **Audience / format.** Operators splitting work between a local model and a paid API; practical
  long-form guide with a routing table. Series E part 1.
- **Outline.**
  1. The rule: give it work a script can verify.
  2. Where it is trustworthy: JSON to 131k, code inventory, splitting with zero lost lines, quoting.
  3. Where it is not: verdicts, incidents in prose, exhaustive lists, paths, retyping.
  4. Knobs: effort is inert; thinking-off; the dp prompt; one document per session.
  5. Speed and capacity on one card (3 sessions = 1.46x total).
  6. Haiku as the complement (and as a grader).
- **Evidence map.**
  - §1–2: `docs/findings/workers/2026-11-05-0814-ornith-use-cases.md` §Summary table; What decides a good
    result 1 (L23): JSON score 1.0 at S/M/L to 131k, 17 s with jq/python3 vs 48–89 s reasoning; split 0 lost
    lines in 6/6 runs to 55k (`MEASURED`). `docs/findings/workers/2026-11-04-2207-sly-radiance-ornith-vs-haiku-high-effort.md`
    §Summary; Results table (L27): 32/35 on exact line, 0 fabricated; 9/9 planted needles at ~185k (`MEASURED`).
  - §3: 2207 §Blind quality grading (L76): verdict 8/12, 9/12 vs Haiku high 12/12, 11/12; Ornith missed 19
    incidents in both passes vs Haiku 8, 9 (`MEASURED`); 0814 §Summary table: retyping 6k = one clean run in
    480 s, 69k generated tokens, two more cut at 600–720 s; Haiku max 242 s (`MEASURED`).
  - §4: `docs/findings/workers/2026-11-06-0930-ornith-manual.md` §Thinking, effort and sampler (L75):
    low/medium/high/xhigh/invalid effort → identical token counts at temp 0; thinking off 26 vs 591 tokens
    (`MEASURED`); §System prompt (L87): dp prompt −33% tokens, +.02 over 9 tasks on the data profile
    (`MEASURED`); 0814 §System prompt repeats (L134): 29/34 pairs tie, 0.83x tokens (`MEASURED`); §What
    decides a good result 4 (L44): one doc per session 10/12 vs 7/12 (`MEASURED`).
  - §5: manual §Speed and capacity (L58): decode 219.8 / 205.0 / 174.5 at 10k/50k/100k; 3 sessions 254
    tok/s total vs 174 alone (1.46x); reasoning 41–97% of output (`MEASURED`). 0814 §Ornith vs Haiku (L51):
    Haiku max took 1.1–12.7x as long, median 3.9x, 15 paired arms (`MEASURED`, remote wall time).
  - §6: `docs/findings/workers/2026-11-06-0930-haiku-manual.md` §Strengths (L26): 21/21 error classes in a
    340k log vs Ornith 16, 16 and 21 of 21 over three runs; path recall .969/.941 vs .756/.569 (`MEASURED`); §As a grader (L67): verdict
    exact on 26/40 notes vs Opus; of 6 Haiku-only critical flags 1 real (`MEASURED`).
- **Gaps before publishing.**
  - Mostly n=1 per arm; differences < 0.05 are ties; repeats of one brief varied by up to .235.
  - Ornith and Haiku ran with different prompts/tools/effort; Haiku wall includes API latency.
  - Speed at three depths only — no exponent (rule 16).
  - Errata (p04 #10): 0814 says the dp prompt is appended on every profile; the manual says the read profile
    keeps Claude Code's prompt alone — state the manual's (later) rule.
  - Naming: Ornith 1.5 here vs Ornith-1.0-35B in CLAUDE.md (different checkpoints; say which).

### C7 — Depth is a variable: rankings that flip between 8k and 160k

- **Thesis.** A single-depth engine comparison is not a result. Prefill decays as a power law whose
  exponent is engine-specific, so the winner at 8–18k can lose by several times at 73k+. Workload shape
  can flip a ranking at the same depth, and speculative speed-ups shrink or grow with depth.
- **Hook.** "The short-context number of one engine is the long-context number of the other": hipfire's
  best draft-free 18k prefill is 569–606 tok/s; llama.cpp f16 still sustains 594 tok/s at 73k
  (`MEASURED`).
- **Audience / format.** Engine evaluators; long-form with log-log charts. Series A part 3.
- **Outline.**
  1. The method: ≥4 depths, log-log fit, exponent + R², projections tagged.
  2. Flip 1: hipfire vs llama.cpp prefill (and the dispatcher fix that only narrows it).
  3. Flip 2: vLLM vs llama.cpp decode (llama.cpp decays, vLLM flat).
  4. Flip 3: same depth, different workload (radiance vs llama.cpp).
  5. Speed-ups vs depth: DFlash2 6.78x → 4.63x; MTP +14.5% → +35.1% but a wall-time loss at 200K.
  6. Projection discipline: what a 4-point fit can and cannot say at 164k.
- **Evidence map.**
  - §2: `docs/findings/hipfire/2026-09-10-0100-hipfire-final-analysis.md` §3.2 It still loses to llama.cpp
    (L95): exponents llama.cpp f16 −0.294 (R² 0.992), q8_0 −0.499 (0.989), hipfire fixed −0.797 (0.939),
    default −1.324 (0.961); @18k 901 / 853 / 469 / 469, @73k 594 / 424 / 146.7 / 80.5 tok/s (`MEASURED`, 4
    depths 18k–73k); proj. @164k ~476 / ~292 / ~88 / ~28 (`INFERRED`, 2.2x past data); §3.1 (L66): two flags
    recover 1.82x at 73k (range 1.79–2.27x, median of five) (`MEASURED`); §9b (L510): at 3k in / 10k out the
    engines tie, 199.4 vs 202.0 s (`MEASURED`).
  - §2b: `docs/findings/hipfire/2026-09-10-0100-hipfire-bench-rocm713-final.md` §Fair comparison (L33):
    hipfire decode 120.00 vs 66.32 tok/s; coding turn 150.30 vs 63.50; prefill 858.35 vs 497.10 at 6.4k
    (`MEASURED`); §Prefill degradation with context (L46): 70k 595.12 vs 292.90 (`MEASURED`, n=2).
  - §3: `docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md` §Finding B1 (L342): decode
    llama.cpp 67.40 → 35.43 tok/s (8k → 98k, exponent −0.257, R² 0.965), vllm-radiance 42.11 → 44.32 (+0.035,
    R² 0.208) (`MEASURED`, 4 depths, 3 reps).
  - §4: `docs/findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md` §Findings (L102):
    agentic-8000 radiance 58.57/60.84 vs llama.cpp 45.77/48.33 (+26%); codereview-8000 llama.cpp 56.47 vs
    radiance 37.81 (+49%) (`MEASURED`, different runs → suggestive); the earlier depth-degradation claim was
    a fixture artifact (withdrawn).
  - §5a: `docs/findings/radiance/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` §Summary (L15):
    DFlash2 vs no-spec 6.78x / 4.65x / 4.63x at 10k/50k/100k (`INFERRED` ratios of `MEASURED` p50);
    acceptance 0.5494 / 0.3671 / 0.4231 (`MEASURED`). Counter-example: `docs/findings/vllm/2026-10-22-1406-vllm-sly-mxfp4-dflash.md`
    §What moved the needle (L118): 4.0x at 8k → 5.6x at 136k (136.6 vs 33.8, 100.5 vs 17.9 tok/s) (`MEASURED`) on
    another checkpoint and Sly 1.6.0; the trend follows the no-spec baseline. `docs/findings/vllm/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth.md`
    §What moved the needle (L70): DFlash2 step cost 36.8 → 44.4 ms 10k → 145k (exponent −0.068, R² 0.895),
    MTP flat 51–54 ms (`INFERRED`, 4 points).
  - §5b: `docs/findings/llamacpp/2026-07-11-2200-deep-context-35b.md` §Consequences & root causes (L99): MTP
    decode gain +14.5% (8K) → +19.4% (128K) → +35.1% (200K), yet 200K wall 158.1 → 174.8 s (+16.7 s) for 256
    tokens (`MEASURED`, 3 depths); §Results — single-stream depth curve (L45): prefill 3077 → 1254, decode
    104.2 → 61.0 tok/s 8K → 200K (`MEASURED`).
  - §6: CLAUDE.md iron rule 16; `docs/findings/vllm/2026-10-22-1324-vllm-sly-mxfp4-depth.md` §Results — cold
    depth curve (L33): prefill k −0.206 (R² 0.845), decode k −0.227 (R² 0.924), n=4 (`MEASURED`) as a
    "clean-ish" example.
- **Gaps before publishing.**
  - [fixed in CLAUDE.md 2026-11-16] Rule 16 now gives 901 vs 469 tok/s at 18k (1.9x) and 594 vs 80.5 at 73k
    (7.4x); the 164k figure is the `INFERRED` projection. Quote the tables, as above.
  - DFlash2: the speed-up shrinks with depth on 0900 but grows on 1406 — present both, do not generalise.
  - Errata (p01 #5): rocm713 verdict says 1.4x llama.cpp prefill lead at 6.4k, its table gives 1.7x.
  - 1535 is a deployment comparison (not window-, KV- or quant-matched); 2200 and 1746 have 3 depths
    (no exponent); 1055 has the conflicts listed in §4.
  - radiance/2026-10-30-0900 is a vLLM report filed under radiance, and its Limits says "no exponent quoted"
    while it quotes −0.068.

### C8 — Faster per token, slower per task: lossy acceptance traps an agent in loops

- **Thesis.** Sly's Cactus δ relaxes speculative acceptance to buy decode speed. On long agentic work it
  backfires: once the target assigns p ≥ 0.5 to a repeated token, the 1.8.1 rule accepts it with
  certainty, so a repetition becomes absorbing. Measure wall per task and tokens per task, not tok/s.
- **Hook.** At δ 0.5 the model decoded 65% faster per token but took 2.4x the wall and generated 4.1x the
  tokens on the same review step, 49% of them inside seven loop blocks (`MEASURED`, n=1 per arm).
- **Audience / format.** Speculative-decoding operators, inference-engine developers, agentic-coding
  users; long-form blog with one mechanism diagram. Series B part 3.
- **Outline.**
  1. The setting and why it looks free (decode tok/s).
  2. The incident: 72.8% of decode windows in loops, 0 of 3 briefs finished.
  3. The mechanism: saturation and an absorbing state.
  4. The 1.9.1 fade/cap: partial escape, loops still start early.
  5. Why the relaxation helps a drafter and barely moves MTP.
  6. What to measure instead; δ 0 as the default.
- **Evidence map.**
  - §1: `docs/findings/vllm/2026-10-30-2232-vllm-redhat-sly191-d0-dflash-depth.md` §Summary (L18): δ 0.5
    changes DFlash2 accept length +29 / +30 / −7% at 10k/50k/100k, MTP only −5 to +8% (`INFERRED`).
  - §2: `docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md` §Summary (L20): 9 runaway
    thinking blocks, 0/3 briefs in the 3 h cap, 777 of 1,067 decode windows (72.8%) in loops (`MEASURED`);
    δ 0: 0 runaway blocks in 111 min (`INFERRED`, n=1); §Why RedHat δ 0 is slow (L151): W2-08 104.4 vs 12.0
    min, 490k vs 72k tokens, decode 75.3 vs 101.8 (`MEASURED`).
  - §2b: `docs/findings/agentic/2026-10-31-0000-redhat191-sharp-w208-blind.md` §Consequences & root causes
    (L89): decode 92.0 vs 55.8 tok/s, wall 5,337 vs 2,182 s, tokens 491,925 vs 120,001 (`MEASURED`); §Results
    (L35): 7 loop blocks = 239,521 tokens, one to max_tokens 64,000 (`MEASURED`); §Blind grading (L63): 16/38
    vs 21 (δ 0) and 22 (anchor) (`MEASURED`, one grader).
  - §3: `docs/findings/agentic/2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md` §5. Why δ 0.5
    loops: the mechanism (L205): kernel implements the formula, δ 0 takes the stock branch bit-exactly; on
    1.8.1 0/3 top loops escaped, all hit 64,000 (`MEASURED`); cap binds for p ≥ 0.25/(2δ+0.25) (`INFERRED`).
  - §4: same §5: 1.9.1 2/3 top loops escaped; 4 of 6 onsets before the 4,096-token fade (`MEASURED`). 1552
    §RedHat on Sly 1.9.1 (L257): 58 of 514 windows (11.3%) at acceptance ≥ 7 (`MEASURED`). Upstream 20/32 →
    3/32 loops (`CLAIMED`, `docs/guides/vllm/known-issues.md` §Cactus lossy acceptance (L89), Sly issue 164).
  - §6: 0900 §Cactus δ 0 rerun (L155) for δ 0 decode by depth (`MEASURED`, mean of 2).
- **Gaps before publishing.**
  - n=1 per arm; the δ 0.5 quality drop (5 points) sits exactly on the pre-registered threshold — run a
    second δ 0.5 rep or present quality as open.
  - 1.8.1 δ 0.5 vs δ 0 is not a controlled A/B (runbook and briefs differ); the 1.9.1 run changes four things.
  - Mechanism partly `INFERRED` (code arithmetic, confident-drafter assumption); onset tokens are estimates.
  - Errata (p05, 1725): its meta recommends keep-newest k=1 without the δ 0.5 loops its body reports — do not
    cite the k=1 recommendation as loop-safe.
  - Naming: RedHat Qwen3.8-27B-MXFP4.

### C9 — The free lunch at 128k: what survives at depth

- **Thesis.** The published sweep said "cap thinking, it's free" — at 50–100-token prompts. At ~133k with
  real TS-TDD tasks: on the dense 27B a 4x budget buys nothing, on the 35B MoE the budget matters, the
  vendor's coding sampler beats every alternative, quant choice is unresolvable at this power, and the real
  wall is strict lint and types. Best-of-3 with the toolchain as judge beats every knob.
- **Hook.** Quadrupling the 27B thinking budget from 4096 to 16384 moved TS quality by +0.3 points (t=0.37)
  and cost +60 s per reply (`MEASURED`, 5 tasks × 3 reps at ~132.9k).
- **Audience / format.** Readers of the July articles; long-form follow-up + LinkedIn post. Series E part 2.
- **Outline.**
  1. Recap of the shallow result and its stated gap.
  2. Budget × depth: helps at 64k, flat at 128k on the 27B; matters on the 35B.
  3. Sampling: coding recipe (temp 0.6, pp 0) wins; general preset −15.4.
  4. Quant ladder: an honest null.
  5. Where it fails: lint 0.36, types 0.47 vs tests 0.84.
  6. Best-of-3 and the toolchain judge.
  7. A config, with its caveats (27B vs 35B tied; 35B faster).
- **Evidence map.**
  - §1: `docs/articles/2026-07-16-reasoning-budget-free-lunch.md` §What we haven't proven yet (L79).
  - §2: `docs/findings/quality/2026-07-13-1657-27b-quality-at-depth-detailed.md` §TL;DR (L29) and §3.1
    (L199): un-f16 TS 68/75/79 at budget 1024/2048/4096 (64k); 68/73/73 (128k) (`MEASURED`, reps=2).
    `docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b.md` §Axis 2 (L162): +0.3 pts, t=0.37,
    156.9 → 216.7 s per reply (`MEASURED`); one unlimited-budget runaway, 31,093 think tokens, TS 77 → 45
    (`MEASURED`); §Combinations (L319): 35B rb4096 vs rb16384 73.3 vs 77.5, Δ −4.3, t=−5.45 (`MEASURED`).
    `docs/research/models-sampling/2026-07-15-1000-qwen36-sampling-thinking-budget-variance.md` §2 (L66):
    4096 budget saturated in every cell (3629–4095) (`MEASURED`); Qwen recommends 32,768 (`CLAIMED`); 16384 is
    the practical ceiling in a 163840 window (`INFERRED`).
  - §3: hardest-tasks §Axis 3 (L195): temp 0.6 77.5, 0.3 70.0, 1.0 68.4, Qwen general preset 62.1 (Δ −15.4,
    t=−3.41), Unsloth preset 63.0 (`MEASURED`); vendor recipe `CLAIMED` in 2026-07-15-1000 §1 (L31).
  - §4: hardest-tasks §Summary (L20) / §Axis 1 (L137): Q4_K_M 78.3, Q4_K_XL 69.8, Q5_K_M 76.5, Q6_K 80.9;
    largest |t| 1.98 vs 2.776 needed (`MEASURED`).
  - §5: hardest-tasks §The strict-code wall (L338): lint 0.36, types 0.47, tests 0.84, edge 0.87, reuse
    0.99 (`MEASURED`); detailed §4 (L264): lint 0.29, types 0.32 (`MEASURED`, earlier campaign).
  - §6: hardest-tasks §Fluctuation and rerun value (L386): rerun Δ +4.6 to +17.5 pts; hard@R 20% vs hard@1
    7% (`MEASURED`).
  - §7: hardest-tasks §Health (L420): Q5_K_M f16 at 163840 loads at 31918 MiB peak, GTT spill 1551–2841 MiB in
    every cell, cause OPEN (`MEASURED`); §Recommended config (L436–444). Speed: 35B decode 115.7–120.2 vs 27B
    32.6–46.1 tok/s; full answer 60.9 s (35B rb4096) vs 156.9 s (27B Q4_K_M) (`MEASURED`, §Health).
    Reference ladder (haiku 81, sonnet 91, opus 94) is one-shot at ~550–620 tokens — never present as a
    capability gap.
- **Gaps before publishing.**
  - Errata on `…-27b-quality-at-depth-recommendation.md` (p02): meta cites campaign 2026-07-13-1657 but the
    numbers are 2026-07-14-0000; "2.6–3.7x faster to a full answer" is the decode ratio — for the 35B at
    rb16384 (96.2 s) the full-answer ratio is 1.6–2.2x; "best-of-3 costs less than one Q6_K reply" holds for
    35B rb4096 (3 × 60.9 = 182.7 s < 212.6 s, as hardest-tasks L441–443 says) but fails for rb16384
    (3 × 96.2 = 288.6 s); the 35B −4.3 is a loss for 4096, not a benefit; Q5_K_M f16 77.5 equals the 35B
    77.5 by coincidence. Cite hardest-tasks, not the recommendation doc.
  - hardest-tasks errata (p03): speed "2.6–3.7x" in the takeaway vs 2.6x/3.5x in the body; Axis 2 table
    keeps cross-model 35B deltas against the 27B Q4_K_M cell (use the within-model −4.3); "~3 orders of
    magnitude" KLD comparison not derivable.
  - Pre-summary (p02) attributes the 7 → 20% hard-pass rerun gain to the 35B, the recommendation to Q6_K;
    hardest-tasks final §Fluctuation is authoritative.
  - Detailed doc §8 vs §9 conflict on q8_0 at 128k; superseded 1657 doc's "optimum falls with depth" is not
    confirmed by the clean re-grade.
  - Power: 5 tasks × 3 reps resolve only ~12-point differences. Build b9950 only; kernel 6.17 in the doc.

### C10 — A random GPU memory fault, a cleared bit 44, and one environment variable

- **Thesis.** A random `HSA_STATUS_ERROR_MEMORY_FAULT` hit about half of the vLLM (Sly MXFP4 + DFlash2)
  boots. Each plausible suspect (A-tiled GEMM, RAM KV tier, kernel version, context, image version) fell
  to a test; a pointer log showed valid buffers with bit 44 cleared; moving kernel arguments to host memory
  stopped it. All along `/health` said OK. Then the fix, carried as a generic rule, had to be demoted.
- **Hook.** A fault that hit about 12 of about 21 boots disappeared with `HIP_FORCE_DEV_KERNARG=0`: 3 of 3
  boots × 4 Claude Code turns clean (`MEASURED`, small n).
- **Audience / format.** ROCm users and HIP engine developers; narrative long-form. Series B part 2.
- **Outline.**
  1. Symptom: a hang of 5–16 minutes while `/health` stays OK.
  2. Suspects that fell (A-tiled, RAM tier, kernel, ctx, image).
  3. The pointer log: bit 44.
  4. The fix, its numbers, and its limits.
  5. A sibling: the ROCm `-fa on` permission fault decoded from dmesg.
  6. From fix to rule to history; watch logs, not `/health`.
- **Evidence map.**
  - §1: `docs/findings/vllm/2026-10-22-1324-vllm-sly-mxfp4-depth.md` §FAILED / interrupted rows (L93): 1
    fault in 27 prefill requests, EngineDeadError ~6.5 min after the hang (`MEASURED`);
    `docs/findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` §FAILED rows (L75): 2 faults in 84
    requests, 387 s hang (`MEASURED`).
  - §2: `docs/findings/vllm/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md` §Update 17:20
    (L183): A-tiled off → fault #5 in the folded kernel; interactive boots 3/3 first-request faults vs 0/4
    headless (`MEASURED`, small-n correlation); §Results / findings table (L89): RAM tier pins a power-of-two
    buffer (9 GiB → 16.28 GiB) (`MEASURED`). `docs/findings/vllm/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`
    §Logical path (L45): faults on kernel 7.0.0-34, at 120k–180k, on Sly 1.5.1, with 256-row padding, with
    split prefill (`MEASURED`).
  - §3: 0023 §Summary (L15): down_proj weight 0x7c930da00000 read at 0x6c94bc6a2000 (`MEASURED`, one log);
    root cause = corrupted kernel-argument pointer (`INFERRED`, strong).
  - §4: 0023 §Summary: 3/3 boots × 4 turns, 0 faults; also clean via llama-swap; decode median 111–150,
    prefill median 2.4–3.0k tok/s, DFlash acceptance 4.8–6.2 (`MEASURED`, 10 s stats windows); luck
    probability ~8% then ~3% (`INFERRED`).
  - §5: `docs/findings/rocm-driver/2026-10-07-1745-rocm-fa-hsa-memory-fault.md` §Register decode (L46):
    PERMISSION_FAULTS=0x3, MAPPING_ERROR=0 (`INFERRED` decode of `MEASURED` registers); §Isolation matrix
    (L74): same fault on ROCm 10.0 and 10.1, absent with `-fa off` (`MEASURED`); §Kernel diff (L93): six
    amdgpu commits between -34 and -38 (`MEASURED`, changelog).
  - §6: `docs/guides/vllm/historical.md` §`HIP_FORCE_DEV_KERNARG=0` (L19); hipfire's wedged-but-healthy
    daemon: `docs/findings/hipfire/2026-09-10-0100-hipfire-final-analysis.md` §4.1 (L248): 7/19 boots
    faulted, `/health` ok (`MEASURED`); CLAUDE.md iron rule 15.
- **Gaps before publishing.**
  - n=3 clean boots (+1 via llama-swap); fix confirmed on kernel 7.0.0-34 only, the 7.0.0-38 gate is still open
    (0023 status), and the sly-official recipe no longer sets it (`docs/guides/vllm/settings.md`); root cause `INFERRED`;
    the llama.cpp ROCm link is untested — present §5 as a sibling, not the same bug.
  - Errata (p04): 1745 still names kernel 7.0.0-38 as first suspect though 0023 showed -34 also faulted
    (cross-note added); 0023 cites `docs/plans/…/claudetest.sh` (plans live in `notes/plans/`); 1506 still
    says "Not safe for unattended long agent runs" though superseded. All three are wording outside the
    article's numbers: fix them first (~30 min), then write.
  - Naming: Qwen3.8-27B (amd Quark AWQ MXFP4).

### C11 — MRCR v2 at 131K on one 32 GB card: 0.85, and the failures are counting errors

- **Thesis.** On the deepest MRCR v2 8-needle bucket a local 27B Q6_K scores in the published frontier
  band, and its failures are wrong-instance picks reproduced flawlessly, not degraded copying.
- **Hook.** 86% of 35 samples scored ≥ 0.90 and none fell between 0.10 and 0.90 (`MEASURED`).
- **Audience / format.** Long-context planners; medium blog. Series D part 2.
- **Outline.** 1. Setup and scoring; 2. The score and its CI; 3. Bimodality; 4. What a failure looks like;
  5. Throughput at 131K vs bench figures, and the prefix cache; 6. How to read leaderboards against it.
- **Evidence map.** `docs/findings/quality/2026-09-02-1437-mrcr-v2-qwen38-27b-q6k.md`:
  §Score (L165) 0.8500, n=35 of 103 (stride 3), 95% CI ±0.113, median 0.9914, 0 errors (`MEASURED`);
  §The distribution is bimodal (L172) 30/35 ≥ 0.90, 0 in 0.10–0.90, 5/35 < 0.10 (`MEASURED`);
  §What a failure actually looks like (L188) score 0.0128 example (`MEASURED`);
  §Throughput (L220) prefill 294 vs 813 bench, decode 30.5 vs 45.9; prefix cache 551 s → ~40 s; MTP
  acceptance 94% (691/735) (`MEASURED`); §VRAM (L251) 29.54 GiB loaded, 30.42 under prefill (`MEASURED`);
  §Published MRCR v2 8-needle scores at 128K (L274) Gemma 4 31B 0.664, Gemini 3.1 Pro 0.849, Claude
  Sonnet 4.6 0.849, GPT-5.2 0.856 (`CLAIMED`).
- **Gaps before publishing.**
  - Errata (p03): the doc gives 54.3% MTP acceptance (L129, the setup rationale, a q8_0 safety check) and
    94% (L226, this run) — say which is which; speed-up 12.5x vs its own numbers ~13.9x; the Gemma row has
    the same subset problem the doc flags for other rows; the Q6 retrieval conclusion overreaches (only Q6
    was run); Qwen3.8 naming.
  - The published 128K scores are cumulative up-to-128K aggregates, not this pointwise bucket; the doc calls
    the comparison indicative, not decisive, and this run had no tools.
  - Single bucket, single run, temp 1.0; position-band differences not significant. A second bucket (e.g.
    64K) would make it a curve; optional.

### C12 — q8_0 KV on RDNA4: free in quality, not in speed, and the answer moved with the build

- **Thesis.** Every quality measurement we have says 8-bit KV costs nothing resolvable on average. The
  speed side is the catch: on b9950 Vulkan the prefill penalty grew with depth until it was 40% at 200K;
  on b10909 it tied f16 up to 18.4k. The decision rule (≤5%) is right; the verdict needs a current build.
- **Hook.** The same q8_0 KV that showed no KL cost at Q6 cut 35B-A3B prefill by 39.8% at 200K on b9950
  (1125 → 677 tok/s) (`MEASURED`).
- **Audience / format.** llama.cpp operators sizing context on 32 GB; medium blog. Series A part 4.
- **Outline.** 1. Quality: KL, TS cell means, and the per-task tail; 2. Speed vs depth on b9950; 3. The
  exponent view (−0.294 vs −0.499); 4. b10909 ties to 18.4k; 5. When q8_0 is still right (VRAM-bound models);
  6. A re-measurement plan.
- **Evidence map.**
  - §1: arms-kld §1 Summary (L47): q6kf16 − q6k −0.00003 not resolved (`MEASURED`); hardest-tasks §Axis 1
    (L137): Q5_K_M f16 74.3 vs q8_0 76.5, within noise (`MEASURED`); 1657-detailed §3.3 (L227): cell mean 73
    vs 71, but lru-cache 78 → 47 and jackrong expr-eval 58 → 23 (`MEASURED`, reps=2).
  - §2: `docs/findings/llamacpp/2026-07-13-0733-27b-serving-substrate.md` §KV decision (L75): 32K prefill
    756.3 → 666.9 (−11.8%), 64K 666.1 → 539.0 (−19.1%), decode tie (`MEASURED`);
    `docs/findings/llamacpp/2026-07-12-0006-27b-maxctx-f16.md` §What moved the needle (L73): 40K 742.5 →
    635.5 (−14.4%) (`MEASURED`); `docs/findings/llamacpp/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md` §KV
    decision (L54): Vulkan prefill −29.66% at 32K, ROCm decode −7.53% (`MEASURED`);
    `docs/findings/llamacpp/2026-07-11-2200-deep-context-35b.md` §KV decision (L77): 200K prefill −39.8%,
    decode −21.7%, TTFT 171.7 → 285.5 s (`MEASURED`, one point).
  - §3: hipfire final §3.2 (L95): llama.cpp f16 −0.294 vs q8_0 −0.499 (`MEASURED`, 4 depths 18k–73k).
  - §4: `docs/findings/llamacpp/2026-09-11-1950-benchy-ideas-27b.md` §Consequences & root causes (L110):
    decode −1.5% / −3.7%, prefill tie up to 18.4k, VRAM 25387 vs 30186 MiB (`MEASURED`, b10909).
  - §5: CLAUDE.md Gemma notes / `docs/research/models-sampling/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md`:
    Gemma f16 @163840 spills (`MEASURED` per CLAUDE.md; cite the campaign row); q8_0 fits.
- **Gaps before publishing.** Different models, builds and depths per source; b9950 is four builds old.
  **Needs new data:** one f16 vs q8_0 curve on latest-vulkan (b11448), one model, ≥4 depths (8k–160k),
  both prefill and decode, to fit both exponents. Detailed-doc §8 vs §9 q8 conflict (p02). MRCR's "q8_0
  collapses MTP acceptance to ~0.7% on Qwen3.6" (L129) has no row — do not quote without one.

### C13 — The GPU is not yours: silent contention on a desktop-shared card

- **Thesis.** On one 32 GB card that also drives a desktop, the dangerous failures are silent: an orphaned
  server makes a later run look unstable, a llama-swap model stays resident after your script exits, a
  paging allocator turns contention into a slowdown with no log line, thin headroom crashes the desktop,
  and a sequential ROCm A/B leaks state into its second arm. The fix is a precondition gate, not a
  post-mortem.
- **Hook.** An orphaned `llama-server` produced `invalid token`, 10x-slow prefill and a false "Q5 f16 @163840
  is unstable" report (CLAUDE.md iron rule 14); the clean measurement later loaded the same config at
  31918 MiB peak with 0 failures (`MEASURED`, hardest-tasks §Health), with the 1551–2841 MiB GTT spill that doc
  reports in every cell (2841 MiB in that cell, cause OPEN).
- **Audience / format.** Workstation operators running local inference; practical blog. Series C part 2.
- **Outline.** 1. The false finding; 2. Three shapes of contention (orphan, resident llama-swap, split
  process shape); 3. The allocator decides whether you notice; 4. Headroom and the desktop; 5. Sequential
  ROCm A/B state leak; 6. The gate (`gpu_exclusive.sh`) and the `/unload` GET trap.
- **Evidence map.**
  - §1: CLAUDE.md iron rule 14 (incident 2026-07-15, no findings doc); counter-fact:
    `docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b.md` §Health (L426): Q5_K_M f16 @163840
    peaks 31918 MiB (97.8%), 0 failures, steadiest cell (`MEASURED`).
  - §2–3: CLAUDE.md iron rules 14(a)(b) and 15: hipfire daemon at 4.4 GB vs ~19.4 GB working set while
    llama-swap held ~27 GB; sweep discarded (incident 2026-09-10, no findings doc);
    `docs/guides/vllm/workflows.md` §Debug a fault (L80): residency check (`MEASURED` per doc);
    `docs/guides/driver-upgrade-runbook.md` §1.3: `/unload` is GET, POST returns 405.
  - §4: `docs/guides/vllm/known-issues.md` §Native Radiance default headroom (L35): 232.52 MiB free, 113 MiB
    at peak (`MEASURED`); §NVFP4 load-peak OOM (L22): 32,600/32,624 MiB + 2,956 MiB GTT, desktop exited 22 s
    later (`MEASURED`; causality `INFERRED`); `docs/guides/vllm/workflows.md` §Boot a server (L6): watchdog
    polls every 0.2 s, kills below 256 MiB free (configured default). Gemma RADV device-loss took the GUI
    down: `docs/findings/quality/2026-07-19-0000-ornith-vs-gemma.md` §Gemma-4-31B-it-qat — Vulkan-blocked,
    ROCm-viable (L62) (`MEASURED`).
  - §5: `docs/findings/llamacpp/build-checks/2026-10-08-1555-llamacpp-b11448-build-check.md` §GPU state leak
    between sequential ROCm workloads (L55): second arm faults on its first kernel even on a clean GPU; the
    same binary runs standalone (`MEASURED`).
  - §6: early precedent: `docs/research/rocm-driver/2026-07-09-0000-rdna4-r9700-llm-optimization.md` §4
    (L64): a "gfx1201 segfault" was several ollama instances on 32 GB (`INFERRED`, one observation).
- **Gaps before publishing.** Four incidents (2026-07-15 orphan, 2026-09-10 hipfire residency, 2026-07-15
  interrupted reply graded 0.603, 2026-09-10 `/unload` POST 405) exist only as CLAUDE.md prose; to tag them `MEASURED` a findings note citing the discarded campaign's
  rows (or the CSV) is needed. Build-check 1555 errata: request metric t/s vs seconds; magnitude possibly
  biased by contention (its own caveat). 2026-07-09 doc: kernel 6.17 header, recommends MTP GGUFs its §9
  says cannot be downloaded.

### C14 — Vulkan or ROCm on RDNA4? It depends on model, build and depth

- **Thesis.** There is no stable backend answer on this card. In July Vulkan won decode by 42–46% and
  ROCm prefill looked broken; by September one llama.cpp build moved ROCm prefill +40% at depth, a patch
  set helped ROCm +20% and hurt Vulkan −12%, and for Gemma-4-31B the driver chose (RADV device loss). Pin
  the build in every number and re-measure per model.
- **Hook.** The same patch set lifted ROCm prefill 20.1% at 32768 tokens (827.6 → 994.1 tok/s) and cut
  Vulkan prefill 11.9% (828.9 → 730.2) (`MEASURED`, single rep).
- **Audience / format.** llama.cpp operators choosing a backend; long-form with a decision table.
  Series A part 5.
- **Outline.** 1. July: Vulkan wins (35B, 27B); 2. ROCm wins prefill at depth 0, loses at 32K; 3. Build
  drift: +40% between two ROCm builds; 4. Patches per backend; 5. When the driver chooses (Gemma);
  6. Check what runtime a binary actually loads; 7. Decision table + re-measure checklist.
- **Evidence map.**
  - §1: `docs/findings/llamacpp/2026-07-10-1810-rdna4-r9700-tuning-optimum.md` §3.3 Backend comparison
    (L97): 35B Vulkan prefill +67% (3221 vs 1927), decode +46% (114.3 vs 78.4) (`MEASURED`, ~7k prompt);
    §3.8 (L138): dpm=high −20% prefill, −11% decode (`MEASURED`). `docs/findings/llamacpp/2026-07-11-1844-campaign-combo35b.md`
    §What moved the needle (L88): Vulkan decode +42% (73.5 → 104.7) (`MEASURED`).
  - §2: `docs/findings/llamacpp/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md` §Cross-backend (L42): pp8192
    depth 0 ROCm 3880 vs Vulkan 3381; depth 32768 Vulkan 2166 vs ROCm 1412; decode 115.0 vs 75.2 (`MEASURED`,
    synthetic llama-bench, reps 3); §Results — prefill sweep (L29): ub optimum 4096 ROCm, 2048 Vulkan.
  - §3: `docs/findings/llamacpp/build-checks/2026-09-11-1537-llamacpp-b10909-build-check.md` §Results per
    depth (L29): ROCm pp at 30720 489.6 → 686.2 (+40.2%), Vulkan 736.5 → 765.7 (+4.0%) (`MEASURED`, r=3).
  - §4: `docs/findings/llamacpp/build-checks/2026-09-15-1029-stew675-buildcmp.md` §Results (L41) and
    §Consequences (L86): ROCm +14.4% to +20.1%, Vulkan −0.0 to −3.1% and −11.9% at 32768; decode ±1.5%
    (`MEASURED`, REPS=1). `docs/findings/llamacpp/2026-09-15-2016-muse-glimmer-vulkan-vs-rocm.md` §Results
    (L44): stew675 ROCm 941 → 842 vs Vulkan 865 → 740 at 8k → 98k (`MEASURED`, build-confounded).
  - §5: `docs/findings/quality/2026-07-19-0000-ornith-vs-gemma.md` §Gemma-4-31B-it-qat (L62): ErrorDeviceLost
    at ~65.5k (ctx 163840) / ~24.5k (ctx 140000) on RADV; ROCm 56.6% TS n=1, decode 11.6 tok/s (`MEASURED`).
  - §6: `docs/findings/rocm-driver/2026-10-07-0749-rocm-10.1-vs-10.0-7.13.md` §What this means for the
    llama.cpp builds on disk (L45): both ROCm builds resolve core-10.0 although 10.1 is active (`MEASURED`).
  - §7: the July "ROCm ~92x slower prefill" (`docs/findings/llamacpp/2026-07-13-0733-27b-serving-substrate.md`
    §Follow-up passes (L67): ~8.1 vs 756 tok/s, `MEASURED` from a killed probe's server log) did not hold
    later (CLAUDE.md: Gemma ROCm prefill ~600 tok/s) — use it as the cautionary tale, not a fact.
- **Gaps before publishing.** **Needs new data:** a same-commit Vulkan vs ROCm depth curve (≥4 depths) on
  latest builds for one dense and one MoE model. Errata: ROCm build dir b9949-rocm labelled b1295 and b9950
  in different docs (p01 #7); 1810's "64K" is the window, prompt ~7k (p01 #6); 2026-10-08 build checks
  contest which arm failed; 1316 says Hold and Promote anyway; 1555 single manual pass with contention;
  driver runbook's CASK 1.57x → −47% is `CLAIMED` from an off-repo log (commit it before using);
  ornith-vs-gemma decode "2x" vs "1.7x" (p03).

### C15 — Agentic token cost is set by steps and templates, not thinking density

- **Thesis.** In seven real Claude Code review sessions, thinking per tool call was flat across models and
  servers; what moved the bill was the number of steps, the chat template (−38% thinking from a one-file
  swap) and the reasoning-replay policy (dropping old reasoning raised total tokens 47% because the model
  re-derived it).
- **Hook.** Swapping only the chat template cut thinking 38% and tool calls 35% on the same server with
  no measured quality loss (`MEASURED`, n=1).
- **Audience / format.** Agent-harness and template engineers; medium blog. Series E part 3.
- **Outline.** 1. Thinking per call is flat; 2. Steps drive cost; 3. Templates; 4. Replay policy;
  5. Compaction is our own setting; 6. How many runs a real answer needs.
- **Evidence map.**
  - §1–2: `docs/findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md` §Consequences & root
    causes (L159): thinking per tool call 3,453 (Q4_K_XL) vs 3,043–3,641; steps 70 / 80 / 100 / 155
    (`MEASURED`).
  - §3: `docs/findings/agentic/2026-10-31-0000-redhat-sharp-w208-blind.md` §What the template changed (L170):
    −38% thinking (304k vs 489k chars), −35% tool calls (101 vs 156), ~−28% tokens; 11/19 vs 9/19
    (`MEASURED`; quality `INFERRED` no loss); `docs/findings/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind.md`
    §Consequences & root causes (L158): with templates equal the gap shrinks from −51%/−55% to −20%/−30%
    (`INFERRED`).
  - §4: `docs/findings/agentic/2026-10-31-0000-redhat191-sharpsly2-w208-blind.md` §Consequences (L100): total
    638,197 vs 433,202 (+47%); §Re-derivation (L69): 8.5% re-derived identifiers (`MEASURED`). 1745 §2 (L116):
    3.4–6.7% of identifiers only in thinking ≥2 steps back (`MEASURED`); 6/32 real dependencies (`INFERRED`,
    blind judge). External: `docs/research/models-sampling/2026-10-31-1725-preserved-thinking-how-much-to-keep.md`
    §Evidence (L47): keep-all 22/32 vs keep-newest 25/32, loops 35/64 vs 6/64 (`CLAIMED`, vendor-internal).
  - §5: `docs/research/models-sampling/2026-10-31-1635-quantization-reasoning-length-compaction-variance.md`
    §Key Questions (L20): trigger 136.0–142.7k (`MEASURED`), formula 0.85 × (180000 − 20000) (`INFERRED`).
  - §6: same §Key Takeaways (L33): ~8–9 runs per arm to separate a 20% step gap at CV ~15% (`INFERRED`).
- **Gaps before publishing.** n=1 per arm everywhere; **needs new data** (≥3 runs per arm on one template
  pair) before any causal claim. dp-sharp V2 (2026-11-01) is preliminary. Errata: 1635 takeaway "~6 runs"
  vs body n 8–9; 1725 meta k=1 recommendation omits the δ 0.5 loops.

---

## 3. Series and publishing order

| Series | Parts (in order) | Through-line |
|---|---|---|
| **A. Speed on one R9700** | C2 → C1 → C7 → C12 → C14 | What actually sets tokens per second and seconds per turn on one card: cache reuse, host costs, depth exponents, KV precision, backend/build |
| **B. vLLM and Radiance on RDNA4** | C3 → C10 → C8 | The vLLM fork track: defaults that cost 5x, a fault that hid behind `/health`, a lossy setting that loops |
| **C. Trusting your numbers** | C4 → C13 (C11 as a short case) | Instruments and environments that lie, and the rules that now catch them (iron rules 14–18) |
| **D. Fidelity and recall** | C5 → C11 | What quantization and long context actually cost, measured directly |
| **E. Local models in an agentic workflow** | C6 → C9 → C15 | Which work to give a local model, what survives at depth, what drives the token bill; C9 continues the four published July articles |

**Suggested publishing order (quick wins first; same as `docs/articles/TOPIC-MAP.md` §6):** C2 (S, ready after
text fixes) → C1 (S, after the b11448 confirm pair) → C3 (M) → C4 (M) → C6 (M) → C10 (M; each after its text
fixes in §1) → C5 (after the KLD count errata) → C9 (after the recommendation-doc errata) → C7 (after the
rocm713 fix; better after the arms-speed campaign) → C8 (case study after the 0900 decode conflict, or a result
after a second δ 0.5 rep) → C11 (after the MRCR errata) → C13 (after a findings note for the four incidents) →
C12 and C14 (after new runs) → C15. C1 is ranked first in §1 on hook strength but publishes second: its
headline is a b9950 per-build rate that needs the ~30-minute b11448 confirm first, while C2 needs no GPU.

---

## 4. Errata to fix before quoting

Grouped by doc; `→` names the affected candidates. Sources: `notes/tmp/2026-11-16-1055-5775a676/errata.md`
(pieces p01–p05) plus spot checks made for this plan (marked *spot check*).

**CLAUDE.md**
- **[fixed in CLAUDE.md 2026-11-16]** Iron rule 16: "hipfire leads by 2.3x at 18k and loses by ~10x at 160k" — hipfire-final-analysis §3.2
  shows hipfire behind at 18k on prefill (469 vs 901 tok/s); "~10x at 160k" is the proj. @164k column
  (`INFERRED`, 2.2x past 73k). "2.3x" likely = coding-turn decode 150.30/63.50 (rocm713 doc). *spot check* → C7
- **[fixed in CLAUDE.md 2026-11-16: worded as a recommendation]** "No swap" vs 1746 (box has 4.7 GiB swap): quote the box as 1746 measured it. → C3, C13
- **[fixed in CLAUDE.md 2026-11-16]** Model list (Qwen3.6/Ornith-1.0) vs vLLM/worker docs (Qwen3.8, Qwen3.5, Ornith 1.5). → C3, C5, C6, C8, C10, C11, C15

**docs/articles/** (published)
- `2026-07-16-27b-coding-model-on-one-amd-card.md`: kernel 6.17 vs fixpoint 7.0.0-38; the 2.25x compares an unsloth MTP
  file with a jackrong no-MTP file (same-file MTP is 2.0x at 32K, 0733); "MTP is a pure win" though MTP is not
  output-preserving (mtp-sampler-tax, seed 42) — say "no task-accuracy cost". → C1, C9 (when citing)
- `linkedin/2026-07-16-assumptions-vs-reality.md`: "1,736 exceeds the 2048 cap" is wrong (compare with rb2048 at
  1,262). → C4, C9
- `linkedin/2026-07-16-reasoning-budget-free-lunch.md`: "rb0 produced the most thinking (1,736)" contradicted
  by uncapped MTP-on configs at 2,957 and 3,690. → C9

**findings/hipfire/**
- `2026-09-10-0100-hipfire-bench-baseline.md`: headline table assigns the two 27B models opposite to its per-run
  tables. → C4, C7
- `2026-09-10-0100-hipfire-bench-rocm713-final.md`: verdict 1.4x llama.cpp prefill lead at 6.4k vs table 1.7x;
  header ROCm 7.13 vs final-analysis ROCm 10.0. → C7

**findings/llamacpp/**
- `2026-07-10-1810-rdna4-r9700-tuning-optimum.md`: "64K" is the window; prompt ~7k. → C14
- ROCm build dir `b9949-rocm` labelled b1295 in one doc and b9950 in two others (1810, 1833, 1844). → C14
- `2026-07-11-1844-campaign-combo35b.md`: cr64000 failed from fixture sizing; the 4-agent VRAM fit is not
  measured. → C4, C7
- `build-checks/2026-10-08-1316-…b11448-rocm…`: recommends both Hold and Promote; baseline arm contested by
  the 12:21 and 14:36 checks. → C14
- `build-checks/2026-10-08-1555-…b11448…`: request metric t/s vs seconds in the 13:16 report; magnitude
  possibly overstated by contention. → C13, C14

**findings/quality/**
- `2026-07-13-1657-27b-quality-at-depth-recommendation.md`: meta cites campaign 2026-07-13-1657, numbers come
  from 2026-07-14-0000; "2.6–3.7x faster to a full answer" is the decode ratio (full answer 1.6–2.2x at
  rb16384); "best-of-3 35B < one Q6_K reply" fails at rb16384 (3 × 96.2 > 212.6) but holds at rb4096
  (3 × 60.9 = 182.7, hardest-tasks L441–443, *spot check*); 35B −4.3 read as a benefit; Q5_K_M f16 77.5 =
  35B 77.5. → C9
- `2026-07-13-1657-27b-quality-at-depth.md` (superseded): budget optimum "falls with depth" not confirmed by
  the clean re-grade (73 vs 73 at 128k); runaway 0% vs a token-cap answer in the deep dive; stale "expect
  28–33%". → C4, C9
- `2026-07-13-1657-27b-quality-at-depth-detailed.md`: §8 advises q8 at 128k for headroom, §9 warns q8 tanks
  lru-cache. → C9, C12
- `2026-07-14-0000-hardest-tasks-27b-vs-35b-pre-summary.md`: attributes the 7 → 20% hard-pass rerun gain to
  35B (recommendation: Q6_K); reports fails 0 without a grader self-check. → C9
- `2026-07-14-0000-hardest-tasks-27b-vs-35b.md`: speed 2.6–3.7x (takeaway) vs 2.6x/3.5x (body); acceptance
  83 → 66 (REFUTED paragraph) vs 81.5 → 77.4 (penalty-tax section); "~3 orders of magnitude" KLD comparison
  not derivable; Axis 2 table keeps cross-model 35B deltas; Δ host CPU column does not match step times. → C1, C9
- `2026-07-19-0000-ornith-vs-gemma.md`: speed 2x vs 1.7x decode; "half as noisy" vs sd ratio 1.74. → C14
- `2026-09-02-1437-mrcr-v2-qwen38-27b-q6k.md`: 54.3% (L129, setup check) vs 94% (L226, run) MTP acceptance;
  12.5x vs ~13.9x (551/39.5); Gemma comparison has the same subset issue; Q6 retrieval conclusion
  overreaches; Qwen3.8 naming. → C2, C11
- `2026-11-09-1825-27b-arms-kld.md`: "fifteen arms" vs 12 + 3 floors; 78/128 vs 77/87; IQ6R boot vs `--tp 2`;
  6–9 GiB vs 40–52%; q6k boot peak quoted below the at-ready figure. → C5
- `2026-07-27-0000-runner-benchmark-unified.md`: σ are population SD labelled sample SD (Brian arm A 163.5 vs
  200.2); headline counts omit the ThinkingCap arm; "five local models" vs six arms; §3.3 "all local models
  healthy MTP" though unsloth 27B not captured; §4.1 two passes vs passes 1–4; §4.5 "seven gates" names six;
  ThinkingCap called fastest (1456 s) though mradermacher s2 1371 s and UD-Q5 s2 1405 s are faster; Brian6145
  called cheapest (16,245) though ThinkingCap s2 16,027; ThinkingCap q8_0 "no spill" vs 1,431 MiB GTT; §4.2
  "six tasks" though T002 differs. → C4

**findings/radiance/**
- `2026-09-12-1055-vllm-radiance-r9700-evaluation.md`: finding 19 (llama.cpp wins warm TTFT 0.43 s) vs 23
  (radiance owns warm, 2.41 vs 3.34 s); "only clean win at 8k" vs a warm-TTFT win at 32k; finding 16 still
  states the withdrawn depth claim; finding 8 OPEN though 12 tested it; host MTP prefill 1012.9–1055.0 vs
  1063.7; decode power 133 vs 137 W; recommended config uses pending R5/R6 settings; R4 +99% decode n=3 vs
  "MTP decode needs n ≥ 10"; "no host-RAM spill anywhere" vs llama.cpp 1.9–2.2 GB GTT; four per-stream rates
  under c=2. → C2, C7
- `2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md`: 10k DFlash2 decode 122.3 vs 86.9 in 1746
  (unreconciled); Limits says no exponent quoted but quotes −0.068; δ 0 GTT 161–253 vs table min 239; "mclk
  1258 in all 14 probes" vs 8 in the δ 0 rerun; a vLLM report filed under radiance. → C3, C7, C8
- `2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`: (see 0900 for the 86.9 conflict). → C3

**findings/rocm-driver/**
- `2026-10-07-1745-rocm-fa-hsa-memory-fault.md`: first suspect kernel 7.0.0-38, but 0023 shows -34 also
  faulted and the kernarg fix cleared the same address shape (cross-note added). → C10

**findings/vllm/**
- `2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`: cites `docs/plans/…/claudetest.sh`; plans live in
  `notes/plans/`. → C10
- `2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md`: still says "Not safe for unattended long agent runs"
  though superseded by 0023. → C10
- `2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md`: §2 MTP-off row (36,864 ctx, pool 197,973) not
  marked superseded by the c3 rerun (184,320). → C3

**findings/workers/**
- `2026-11-05-0814-ornith-use-cases.md` vs `2026-11-06-0930-ornith-manual.md`: dp prompt "appended on every
  profile" vs "the read profile keeps Claude Code's prompt alone". → C6

**guides/**
- `GUIDE.md`: pins llama.cpp b9949/b9950 and `/home/dev/models/gguf` (2026-07-11 state). → C4
- `driver-upgrade-runbook.md`: kernel 7.0.0-31, Mesa 26.2.2, ROCm 10.0.0~pre4 (2026-09-11 state);
  headline numbers `CLAIMED` from an off-repo log. → C14
- `vllm/README.md`: names `docs/analysis`, absent from the repo map. → none

**research/**
- `vllm/2026-11-04-1630-…decode-gap.md`: meta tags the ~180 ms step `MEASURED`, body `INFERRED`; summary says
  no non-emulated MXFP4 MoE runs on gfx1201 while its table leaves triton_unfused untested. → C3
- `vllm/2026-11-04-1702-…config-alternatives.md` vs 1630: 100k decode 15.8 (mean of 3) vs 14.22 (p50); 27B
  3.45 vs 3.68 tokens per step. → C3
- `vllm/2026-07-12-2300-rdna4-vllm-aiter-fp8-status.md`: "not today" verdict does not cover the Sly fork
  later measured. → C3
- `models-sampling/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md`: meta says Gemma emits `<think>`
  (`MEASURED`), body lists the `<|channel>` split as open; one cross-reference path elided. → C14
- `models-sampling/2026-10-31-1635-…compaction-variance.md`: takeaway ~6 runs per arm, body n 8–9. → C15
- `models-sampling/2026-10-31-1725-preserved-thinking-how-much-to-keep.md`: meta recommends k=1 without the
  δ 0.5 loops its body reports. → C8, C15
- `rocm-driver/2026-10-08-0930-rocmtos-cachyos-ubuntu2604-rdna4.md`: kernel 7.0.0-34 vs -38; ROCm on 26.04
  not verified. → parked
- `rocm-driver/2026-07-09-0000-rdna4-r9700-llm-optimization.md`: kernel 6.17 header; recommends MTP GGUFs its
  §9 says cannot be downloaded. → C13

---

## 5. Parked (strong-looking, not a candidate)

- `research/hipfire/2026-09-10-0100-hipfire-engine-research.md` — vendor numbers only (203.9 tok/s is a 35B MoE); a sidebar for C7 at most.
- `research/models-sampling/2026-07-14-1550-gfx1201-llm-training-feasibility.md` and `…-1430-radeon-llm-finetune-frameworks.md` — all `CLAIMED`, no training run on this box; needs a real QLoRA run first.
- `guides/driver-upgrade-runbook.md` — the "1.57x win became a 47% loss" hook is `CLAIMED` from an off-repo log; commit the log, then it becomes a C14 section.
- `findings/quality/2026-07-12-1736-27b-finetune-quality.md` — the 7.6x thinking spread across fine-tunes is striking, but the run was at temp 1.0 (superseded); needs a temp 0.6 rerun. Its flag bug feeds C4.
- `findings/quality/2026-07-27-0000-runner-benchmark-unified.md` — too many count errata to lead an article; §4.5 and §3.4 feed C4.
- `findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md` — eleven internal conflicts; only the prefix-caching and workload-flip rows are used (C2, C7).
- `findings/vllm/2026-09-11-2047-vllm-qwen38-27b-int4.md` — the ROCM_ATTN (1, 4) grid story is a good engine-dev note, but two depths and one boot per arm; a C3 section.
- `findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md` — "MTP costs more KV than attention on a hybrid" is niche; a C3 section and a C7 data source.
- `findings/vllm/2026-10-22-1506-vllm-sly-mxfp4-dflash-170k.md` — "no VRAM creep to 170k" is a solid sidebar for C3, not a piece.
- `findings/llamacpp/2026-07-11-1844-campaign-combo35b.md` — MTP +33% single vs −8% at four agents is strong but one table; a C7/C1 section.
- `findings/llamacpp/2026-09-15-2016-muse-glimmer-vulkan-vs-rocm.md` — backend and build confounded; a C14 data point.
- `findings/llamacpp/2026-07-09-0000-runtime-benchmark-r9700.md` (HU) — superseded; the ollama 2x prefill gap cause is unproven (`INFERRED`).
- `research/llamacpp/2026-07-10-0000-rdna4-llamacpp-ollama-backend-tuning.md`, `…/2026-10-07-0852-…vulkan-compile-settings.md` — mostly community/PR `CLAIMED`; C14 background.
- `research/methodology/*` (harness build-vs-adopt, benchmark_serving, hard TS benchmark design) — method appendices for C4 and C9.
- `research/vllm/2026-07-12-2300-rdna4-vllm-aiter-fp8-status.md` — `CLAIMED`, overtaken by Sly measurements.
- `research/rocm-driver/2026-10-08-0930-rocmtos-cachyos-ubuntu2604-rdna4.md` — desk research, unverified.
- `findings/rocm-driver/2026-10-07-0749-rocm-10.1-vs-10.0-7.13.md` — a C14 sidebar (check the runtime a binary loads).
- `findings/agentic/2026-11-01-0000-redhat191-dp-sharp-w208-blind.md` — V2 grade preliminary; a C15 section once graded.
- All 13 `findings/llamacpp/build-checks/*` — bookkeeping; feed C14 (build drift) and C4/C13 (failed arms).
- `guides/vllm/{versions,settings,known-issues,workflows,sources,README,historical}.md` — evidence backbone cited by C3, C8, C10, C13.
- `findings/llamacpp/2026-07-12-0006-27b-maxctx-f16.md` — superseded ceiling; its KV-arithmetic lesson is a C4 section.
- `docs/articles/*` and `docs/articles/linkedin/*` — published; C9 is their follow-up.
