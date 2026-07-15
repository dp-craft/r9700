# Research: Qwen3.6 sampling, thinking budget & output-variance control (llama.cpp GGUF, R9700)

<!-- meta
date: 2026-07-15 10:00
question: What do Qwen/Unsloth/llama.cpp officially recommend for Qwen3.6 sampling (thinking vs non-thinking), thinking budget on HARD coding tasks, and reducing run-to-run output variance?
confidence: high on sampling + reasoning-budget semantics (primary sources verified directly); low on Unsloth-specific extras (page 404s) and on llama.cpp determinism internals (unverified)
sources: 8 verified (Tier-1: 8) + 3 unverified-and-flagged
takeaway: Our campaign's temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 / presence_penalty 0 is EXACTLY Qwen's "thinking mode, precise coding" recommendation — vendor-correct, do not change it. The real finding: Qwen recommends **32,768 output tokens** (81,920 for highly complex problems) while we run `--reasoning-budget 4096` and the model **saturates it every time** (3629–4095 MEASURED) — we have been truncating thinking ~8× below vendor guidance, a plausible driver of the erratic outputs. 16384 is the practical ceiling at 128k depth (32768 does NOT fit ctx 163840). `--reasoning-budget 0` is NOT "non-thinking mode": it forces an immediate end-of-thinking, whereas Qwen's non-thinking recipe (temp 0.7 / top_p 0.80 / presence_penalty 1.5) belongs to the `enable_thinking=false` template path — conflating them confounds budget with sampling. Qwen3.6 docs contain NO greedy-decoding warning and NO variance-reduction guidance beyond presence_penalty for repetition: "lower temp = less variance" is FOLKLORE here. MTP (on in every cell) is a documented output-changing mechanism (llama.cpp #23335, closed) and is an untested variance suspect.
-->

- **Date:** 2026-07-15 10:00 · **For:** `campaigns/2026-07-14-hardest-tasks-27b-vs-35b` budget/variance extension
- **Method:** haiku fan-out (CLAUDE.md rule #4) → **every decision-relevant claim re-verified by hand** against the primary source or our own build. Digest-only claims that failed verification are listed as UNVERIFIED and are **not** used.

## Summary — what is documented vs what is folklore

| # | Question | Answer | Provenance |
|---|----------|--------|-----------|
| 1 | Thinking-mode sampling for **coding** | `temp 0.6 · top_p 0.95 · top_k 20 · min_p 0.0 · presence_penalty 0.0 · rep 1.0` | **CLAIMED (verified primary)** — Qwen model cards |
| 2 | Non-thinking (Instruct) sampling | `temp 0.7 · top_p 0.80 · top_k 20 · min_p 0.0 · presence_penalty 1.5 · rep 1.0` | **CLAIMED (verified primary)** |
| 3 | Recommended output length | **32,768** tokens; **81,920** for "highly complex problems" | **CLAIMED (verified primary)** |
| 4 | `--reasoning-budget` legal values | `-1` unrestricted · `0` immediate end · `N>0` budget | **MEASURED** — our b9950 build's `--help` |
| 5 | Greedy-decoding warning in Qwen3.6 docs | **NONE FOUND** (both cards) | verified absence |
| 6 | Official variance-reduction guidance | **NONE** beyond `presence_penalty` 0–2 for *endless repetition* | verified absence |
| 7 | Does MTP change output? | Documented as changing the committed token stream | **CLAIMED** — llama.cpp #23335 (**closed**, resolution unverified) |
| 8 | Unsloth's own recommendations | **None** — its card explicitly attributes sampling to the **Qwen Team** | **CLAIMED (verified primary)** |

**Bottom line for the campaign:** our sampling is already vendor-correct; our **thinking budget is not**. Do not chase variance with sampler tweaks that no vendor documents — fix the budget first.

---

## 1. Sampling parameters (VERIFIED against primary sources)

Fetched directly from the model cards on 2026-07-15 (not via the digest):

**`Qwen/Qwen3.6-27B`** — verbatim:
- Thinking, general: `temperature=1.0, top_p=0.95, top_k=20, min_p=0.0, presence_penalty=0.0, repetition_penalty=1.0`
- **Thinking, precise coding:** `temperature=0.6, top_p=0.95, top_k=20, min_p=0.0, presence_penalty=0.0, repetition_penalty=1.0`
- Instruct (non-thinking): `temperature=0.7, top_p=0.80, top_k=20, min_p=0.0, presence_penalty=1.5, repetition_penalty=1.0`

**`Qwen/Qwen3.6-35B-A3B`** — verbatim, differs from the 27B in one place:
- Thinking, general: `temperature=1.0, top_p=0.95, top_k=20, min_p=0.0, **presence_penalty=1.5**, repetition_penalty=1.0`
- **Thinking, precise coding:** `temperature=0.6, top_p=0.95, top_k=20, min_p=0.0, presence_penalty=0.0, repetition_penalty=1.0` (same as 27B)
- Instruct: `temperature=0.7, top_p=0.80, top_k=20, min_p=0.0, presence_penalty=1.5, repetition_penalty=1.0`

> **Finding 1 (the reassuring one).** The campaign's `temp 0.6 / top_p 0.95 / top_k 20 / min_p 0` **is exactly Qwen's "thinking mode, precise coding" recipe**, for *both* models, including `presence_penalty=0.0`. **INFERRED:** the erratic outputs are **not** caused by off-guidance sampling. Changing temperature to chase stability would move us *away* from vendor guidance.

> **Finding 2 (a real asymmetry).** Qwen recommends a **different `presence_penalty` for the MoE** in *general* thinking mode (1.5 for 35B-A3B vs 0.0 for 27B) — but **both drop to 0.0 for precise coding**. **INFERRED:** Qwen considers the MoE more repetition-prone in open-ended use. Our tasks are coding, so 0.0 is correct — but this is the only vendor hint that the A3B behaves less stably than the dense model, which matches our MEASURED result (35B-A3B carries the run's widest CI, sd 23.8).

**Unsloth adds nothing of its own.** `unsloth/Qwen3.6-35B-A3B-GGUF` exists and reproduces the table above, explicitly **attributed to the Qwen Team** (verified). It offers **no KV-cache guidance** and **no Qwen3.6-specific UD accuracy numbers**. Treat Unsloth's params as Qwen's, not independent corroboration.

### Reconciliation with `docs/research/2026-07-12-2310-qwen36-sampling-llamacpp-serving-knobs.md`

That earlier report is **not contradicted** — but two of its numbers are **Qwen3-family, not Qwen3.6**, and this report supersedes them for Qwen3.6:

| Point | 07-12 report | This report (Qwen3.6 cards, verified) | Verdict |
|---|---|---|---|
| Thinking sampling for coding | `0.6 / 0.95 / 20 / 0` | `0.6 / 0.95 / 20 / 0`, `presence_penalty 0.0` | ✅ **confirmed** on the Qwen3.6 cards |
| "**never greedy**" | asserted as official | **not present** on either Qwen3.6 card | ⚠️ its cited sources are **Qwen3** (`qwen.readthedocs.io` quickstart, `Qwen/Qwen3-8B`) — a Qwen3 claim carried to Qwen3.6. Still a reasonable prior; **not** Qwen3.6-documented. |
| Output length | "32768 typical; up to **38912** for hard math/competition-code" | "32,768 for most queries… **81,920** for highly complex problems" | ⚠️ **38912 is the Qwen3-2507 figure.** For Qwen3.6 the number is **81,920** — use this report's. |
| `presence_penalty` 0–2, language-mixing caution | ✅ | ✅ verbatim on the Qwen3.6 cards | ✅ confirmed |

The 07-12 report's central inference — *temp 1.0 was too hot for our earlier campaign* — also stands, and is now sharper: **1.0 is Qwen's *general* thinking value; 0.6 is the *precise-coding* value.** Both are official; they are for different jobs. The current campaign already uses the coding one.

---

## 2. Thinking budget — the campaign's actual problem

**Qwen guidance (verbatim, both cards):**
> "We recommend using an output length of 32,768 tokens for most queries. For benchmarking on highly complex problems...we suggest setting the max output length to 81,920 tokens."

**Our reality (MEASURED, campaign `out/summary.md`):** `--reasoning-budget 4096`, and every cell spends **3629–4095** of it — **saturated in all five cells**, truncation 0 %.

> **Finding 3 — the headline.** We run a thinking budget **~8× below Qwen's recommended output length**, on tasks explicitly designed to be the hardest, and the model **hits the ceiling every single time**. A saturated budget means `--reasoning-budget` **forced** an end-of-thinking and made the model answer mid-reasoning. **INFERRED:** this is a strong candidate cause of both (a) the lint/types wall and (b) the run-to-run fluctuation — *where* in its reasoning the model gets cut off varies per rep. This is the best-supported reason to test 16384, and it is a **sourced** hypothesis, not a hunch.

**Ceiling at 128k depth (planning arithmetic — NOT a VRAM/usage figure):** with ctx 163840 and a ~132.9k-token prompt (~1.65k answer):

| budget | tokens needed | vs ctx 163840 |
|---|---:|---|
| 0 | 134,550 | FITS (+29,290) |
| 4096 (current) | 138,646 | FITS (+25,194) |
| **16384** | **150,934** | **FITS (+12,906)** |
| 32768 (Qwen's rec) | 167,318 | **DOES NOT FIT (-3,478)** |

> **Finding 4.** **16384 is the practical ceiling at this depth** — Qwen's recommended 32,768 cannot be tested at a 128k prompt on a 163840 window. The 16k choice is the maximum reachable point, not an arbitrary one. Testing Qwen's full recommendation would require a shallower prompt — a different campaign.

---

## 3. `--reasoning-budget 0` ≠ non-thinking mode (a confound trap)

**MEASURED — our own b9950 build (`961e4b26a`, the exact build the campaign ran), verbatim `--help`:**
```
--reasoning-budget N     token budget for thinking: -1 for unrestricted, 0 for immediate end,
                         N>0 for token budget (default: -1)
-rea, --reasoning [on|off|auto]
                         Use reasoning/thinking in the chat ('on', 'off', or 'auto',
                         default: 'auto' (detect from template))
```

So there are **two different ways to get "no thinking"**, and they are not the same thing:

| Mechanism | What it does | Qwen's matching sampling recipe |
|---|---|---|
| `--reasoning-budget 0` | **Forces an immediate end-of-thinking.** The thinking block is opened and terminated at once; the model is still on the *thinking* template path. | Ambiguous — it is still "thinking mode", just with zero budget |
| `--reasoning off` (`enable_thinking=false`) | Selects the **non-thinking template path** — the Instruct persona | `temp 0.7 · top_p 0.80 · presence_penalty 1.5` |

> **Finding 5 — the trap.** Qwen's non-thinking recipe (`0.7 / 0.80 / pp 1.5`) is written for the **`enable_thinking=false` template path**, *not* for "thinking mode with budget 0". Applying it to `--reasoning-budget 0` changes **budget + 3 sampling params at once** — the budget axis stops being single-variable and the result becomes uninterpretable. **INFERRED, and this is the main methodological recommendation of this report.**

**Consequence for practice:** hold sampling **fixed** at Qwen's coding recipe (`0.6 / 0.95 / 20 / 0 / pp 0`) across the whole budget axis (0 / 4096 / 16384) so the axis is clean. If the vendor's non-thinking recipe is of interest, test it as **one separate cell** at rb0 — that isolates the sampling effect instead of smearing it across the budget axis.

---

## 4. Variance reduction — mostly folklore, one documented lever

**Verified absence (both Qwen3.6 cards):**
- **No greedy-decoding warning.** Older Qwen3 docs warned that greedy decoding in thinking mode causes endless repetition; **Qwen3.6's cards do not repeat it**. So "never use temp 0" is, for Qwen3.6, **UNSOURCED** — neither endorsed nor warned against.
- **No run-to-run variance / consistency guidance at all.**

**The one documented lever** (verbatim, both cards):
> "you can adjust the `presence_penalty` parameter between 0 and 2 to reduce endless repetitions. However, using a higher value may occasionally result in language mixing."

That targets **repetition**, not score variance — and Qwen sets it to **0.0** for precise coding. It is not a variance fix.

| Lever | Status | Note |
|---|---|---|
| Lower temperature (<0.6) | **FOLKLORE** for Qwen3.6 | Mathematically reduces sampling entropy, but 0.6 *is* the vendor's precise-coding value; going lower is off-guidance and untested here |
| `min_p` > 0 to stabilize | **FOLKLORE** | Qwen explicitly recommends `min_p=0.0`. ⚠️ llama.cpp's **own default is `min_p=0.05`** — confirmed in our `/props` — so min_p must be sent explicitly per request (our `configs.jsonl` does set `min_p: 0`) |
| `presence_penalty` | **DOCUMENTED** but for repetition only, and 0.0 for coding | not a variance lever |
| Adequate thinking length | **DOCUMENTED** (32,768) | the best-sourced lever we have — see Finding 3 |
| Fixed seed | **MEASURED-adjacent** | not currently pinned in the campaign; see below |
| MTP off | **suspect** | see Finding 6 |

> **Finding 6 — MTP is an untested variance suspect.** llama.cpp issue **#23335** — *"Eval bug: draft-mtp changes deterministic output on Qwen3.6 MTP model"* — **exists and is CLOSED** (verified: title + status). It reports that `draft-mtp` produces **different committed tokens than the no-speculative baseline** at temp 0 with a fixed seed. **CLAIMED, and its resolution is UNVERIFIED** — "closed" may mean fixed, dismissed, or expected-behavior; I could not establish which, so this must not be quoted as settled. **Relevance:** MTP is **on in every cell of our campaign**. If MTP perturbs the token stream, it is a variance source we have never controlled — and it is entangled with the 35B-A3B's entire speed advantage (116 t/s). **This is the highest-value untested hypothesis for "the outputs are very random".**

---

## 5. Recommendations for the extension (ranked)

1. **Keep sampling fixed at `temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 / presence_penalty 0`** across all budget cells. It is Qwen's precise-coding recipe (verified) and it keeps the budget axis single-variable. **Do not** apply the non-thinking recipe to rb0 cells (Finding 5).
2. **Test budget 16384** — best-sourced hypothesis in this report (Finding 3); 16384 is the reachable ceiling at 128k depth (Finding 4).
3. **Add ONE rb0 cell at Qwen's non-thinking recipe** (`0.7 / 0.80 / pp 1.5`) *in addition to* the fixed-sampling rb0 cell, if the vendor recipe is of interest. Two cells isolate sampling from budget; one cell confounds them. rb0 cells are cheap (no thinking tokens).
4. **Pin a seed per rep** if not already done — reps should differ by seed *deliberately*, not by whatever the server chose. Without it, "variance" mixes sampling noise with unknown nondeterminism.
5. **Consider an MTP on/off pair** on the 35B-A3B (Finding 6). This is the only lever that could explain variance *mechanically* rather than statistically — but it is out of the scope you specified, and it would cost the 35B's speed story. Recommended as a follow-up, not a blocker.

**Explicitly NOT recommended:** lowering temperature below 0.6, or adding min_p/repetition_penalty, to "stabilize" output. Both are folklore for Qwen3.6 and would put us off vendor guidance while confounding the budget axis.

---

## 5b. Sampling sweep for the 35B-A3B — which points are vendor-grounded?

Requested follow-up: *"I want to see e.g. temp 0.3, 0.6 and 1 … research other parameters for these settings"*. Qwen **ties `presence_penalty` to the temperature preset** — they are not independent knobs in the vendor's guidance. All four documented points (verified by direct fetch of both cards):

| # | Label (verbatim) | temp | top_p | top_k | min_p | pp | Source | Status |
|---|---|---:|---:|---:|---:|---:|---|---|
| 1 | "Thinking mode for precise coding tasks (e.g. WebDev)" | **0.6** | 0.95 | 20 | 0.0 | **0.0** | Qwen **and** Unsloth cards | ✅ **our current baseline** |
| 2 | "Thinking mode for general tasks" | **1.0** | 0.95 | 20 | 0.0 | **1.5** | Qwen **and** Unsloth cards | ✅ documented |
| 3 | "Instruct (or non-thinking) mode" | 0.7 | 0.80 | 20 | 0.0 | 1.5 | Qwen **and** Unsloth cards | ✅ documented (non-thinking path only) |
| 4 | "Instruct (or non-thinking) mode **for reasoning tasks**" | **1.0** | **1.0** | **40** | 0.0 | **2.0** | **Unsloth card ONLY** | ⚠️ **see below** |
| — | temp **0.3** | 0.3 | — | — | — | — | **nowhere** | ❌ **FOLKLORE** — undocumented by either vendor |

> **Finding 7 — Unsloth ships a recipe Qwen does not.** Qwen's `Qwen3.6-35B-A3B` card lists **exactly three** parameter sets (verified; asked directly, answer was an explicit **NO** on the existence of a top_k=40 set). Unsloth's `Qwen3.6-35B-A3B-GGUF` card lists **four** — adding set #4 (`temp 1.0 / top_p 1.0 / top_k 40 / pp 2.0`) — while attributing the block to the Qwen team ("we recommend the following settings"). **CLAIMED, both verified by direct fetch.** Since we run **Unsloth GGUFs**, set #4 is the only vendor-shipped source for a `top_k 40` / `top_p 1.0` point — but its Qwen attribution is **not supported** by Qwen's own card. Treat it as **Unsloth-only**, not as Qwen guidance.

> **Finding 8 — the temp sweep has a built-in confound.** Qwen pairs temp 0.6 with `pp 0.0` and temp 1.0 with `pp 1.5`. Sweeping "temperature" by walking the vendor presets therefore moves **temp AND presence_penalty together** — a 2-variable step whose result cannot be attributed to temperature. **Recommendation:** sweep **temp {0.3, 0.6, 1.0} with everything else pinned at the coding recipe** (`top_p 0.95 / top_k 20 / min_p 0 / pp 0.0`) → a clean single-variable temperature axis; then add the vendor presets (#2, #4) as **separate labelled points**, which answers "is the vendor's paired recipe better?" without polluting the axis. Note **temp 0.3 is folklore** — worth testing precisely *because* it is undocumented, but it must be reported as an unsourced probe, not as a vendor setting.

---

## 6. UNVERIFIED — reported by the haiku digests, could NOT be confirmed (do not cite)

These are recorded so nobody re-derives them and mistakes them for sourced facts. Each was searched for and failed verification:

| Claim | Why it is unverified |
|---|---|
| `common/reasoning-budget.cpp` implementation + "budget=0, forcing immediately" code quote | File/quote not confirmed; no llama.cpp source tree locally (build dirs are binaries only). The **behavior** is separately confirmed by our build's `--help`, which is what we rely on. |
| PR **#20297** / commit `acb7c790…` introduced `--reasoning-budget` | Not verified. (The flag's *existence and semantics* are MEASURED locally; the attribution is not.) |
| PR **#16016** "Deterministic inference mode (CUDA)" + batch-invariant kernel quotes | Not verified. Would be CUDA-only and irrelevant to our Vulkan box regardless. |
| Vulkan non-determinism issues **#18969** (F16 overflow), **#19842** (memory leak) | Not verified. Plausible but unconfirmed — do not use to explain our variance. |
| Unsloth `--cache-type-k bf16 --cache-type-v bf16` KV workaround, and "top-performing in 21 of 22 sizes" attributed to a Qwen3.6 page | **The cited page 404s.** `unsloth.ai/docs/models/qwen3.6-how-to-run-and-fine-tune` does not exist (the real one is a **Qwen3** tutorial). Treat as fabricated until proven. |
| Unsloth UD-2.0 numbers (KLD 0.265540→0.258192; MMLU 71.47 % vs QAT 70.64 %) | Those are **Gemma 3** figures, **not Qwen3.6** — irrelevant to our ladder even if real. |
| Historical Qwen3 greedy-decoding warning | Not found in **Qwen3.6** cards (verified absence). Do not carry it over. |

> **Method note.** The digests were substantially accurate on the primary-source facts (sampling tables, output length, reasoning-budget semantics, #23335's existence all checked out) and substantially unreliable on secondary detail (PR numbers, file paths, a 404 URL, cross-model number transplants). That pattern — right on the well-indexed headline, invented on the specifics — is exactly why rule #3 exists.

---

## Sources (all accessed 2026-07-15)

**Verified directly (primary):**
- Unsloth model card — `unsloth/Qwen3.6-35B-A3B-GGUF`: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF — **four** parameter sets incl. the Unsloth-only `top_k 40 / top_p 1.0 / pp 2.0` set #4; attributes the block to the Qwen team
- Qwen model card — `Qwen/Qwen3.6-27B`: https://huggingface.co/Qwen/Qwen3.6-27B — sampling tables, output-length guidance, presence_penalty note
- Qwen model card — `Qwen/Qwen3.6-35B-A3B`: https://huggingface.co/Qwen/Qwen3.6-35B-A3B — as above, incl. the MoE presence_penalty=1.5 asymmetry
- Unsloth model card — `unsloth/Qwen3.6-35B-A3B-GGUF`: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF — confirms params are attributed to the **Qwen Team**; no KV guidance
- llama.cpp issue **#23335** "Eval bug: draft-mtp changes deterministic output on Qwen3.6 MTP model": https://github.com/ggml-org/llama.cpp/issues/23335 — **exists, CLOSED**, resolution unverified

**Verified locally (MEASURED, this box):**
- `bench/llamacpp-rocm-b9950/llama-server --version` → `9950 (961e4b26a)` — matches the campaign's `/props` `build_info` exactly
- `llama-server --help` (b9950) → `--reasoning-budget` legal values; `-rea/--reasoning on|off|auto`; `--spec-type … draft-mtp`
- `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/out/props_*.json` → `build_info: b9950-961e4b26a`, server default `min_p 0.05`, `reasoning_format: none`

**404 / not found:**
- `unsloth.ai/docs/models/qwen3.6-how-to-run-and-fine-tune` — **404**; `docs.unsloth.ai` 301-redirects to `unsloth.ai/docs/`
