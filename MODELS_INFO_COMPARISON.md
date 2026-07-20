# MODELS_INFO variants — comparison & evaluation

Evaluation of the seven `MODELS_INFO*.md` docs in this directory, all apparent runs of the **same
prompt**. Validation of factual claims was done **only against the official `huggingface.co` model
pages** (no aggregators/blogs). Compiled 2026-07-20.

## The prompt they were written against

> collect all models in the `~/models` dir. all is from hugging face, and the dir describes from
> where. collect all model pages and put the list into the project root `MODELS_INFO_6_gemma.md`
> file. a simple list (model-link) on the top of the page and below a description about the model:
> **1** summary — what is it for, benefits, improvements; **2** configuration notes in detail
> (parameters, use cases); **3** any other important notes

So the spec is: **(A)** cover all models under `~/models`; **(B)** a link-list **on top**;
**(C)** per model exactly **3 sections** — summary+benefits+improvements / config **in detail**
(params, use cases) / other notes; **(D)** accuracy (it's a reference doc).

**Note on scope/timing:** the Brian6145 Opus-DeepSeek distill was added to `~/models` **after** the
first seven docs were written, so it existed for only `_8_ds_opus`. Its absence in the others is
**not** counted against them, and its presence in `_8` is **not** counted as a merit — every file is
judged on how well it covers the models that existed when it was written.

## Final ranking

Judged on merit (structure / accuracy / detail), **not** on Brian6145 coverage:

| Rank | File | List-on-top + 3-sec structure | Accuracy | Detail | Look | Grade |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 🥇 | **MODELS_INFO.md** | ✓ full inventory + 3 cross-tables | Gemma license wrong; else clean | high | A− | **A** |
| 🥇 | **MODELS_INFO_8_ds_opus.md** | ✓ Quick Links top; cleanest 3-sec + config tables | Ornith MTP=No ✓, Qwen 77.2 ✓; Gemma license wrong, self-inconsistent GPQA | high | A | **A** |
| 🥈 | **MODELS_INFO_5_distill_plan.md** | ✓ (4 sections, not 3) | correct SWE 77.2, real numbers; Gemma license wrong | high | A | **A** |
| 🥉 | **MODELS_INFO_7_hauhau.md** | ✓ list top, 3-sec | Gemma ctx **and** license, "beats Opus" wrong | high | A | **B+** |
| 5 | **MODELS_INFO_4_35q4plan.md** | ✗ no list on top; merges 27B/35B | only 2 real errors (verified) | very high | A | **B+** |
| 5 | **MODELS_INFO_2.md** | ✓ exact 3-sec, "Recommended for"=use cases | accurate | shallow | A | **B+** |
| 7 | **MODELS_INFO_3.md** | ✓ 3-sec | 27B="MoE 981M" halluc, scrape residue, format bug | med | B+ | **B−** |
| 8 | **MODELS_INFO_6_gemma.md** | literal target but no title, GGUF links, gave up on hauhau | thin | fails "in detail" | C+ | **C** |

**Common error, not distinguishing:** nearly every file lists Gemma's license as "Apache 2.0" — it's
actually the **Gemma Terms of Use**. This is a shared miss (MODELS_INFO.md, _5, _7, _8 all have it),
so it doesn't separate them.

## Per-file notes

**MODELS_INFO_8_ds_opus.md — A (co-top on merit).** Judged like the rest — setting aside that it
happens to include the later-added Brian6145 model — it earns the top tier on **structure and
accuracy**: the cleanest execution of the exact 3-section spec (Summary+Benefits+Improvements /
Configuration **table** / Notes), detailed, with per-model download counts, and an end comparison
table that **correctly** marks Ornith MTP = **No** and Qwen 27B SWE-bench = **77.2** — the exact
points that tripped up _4 and _7. (Its Brian6145 section does match our live setup — temp **0.6** /
top-p **0.95**, MTP **depth 3**, and the local gguf really carries an nextn/MTP layer, MEASURED via
`gguf_kv.py` — but that model is not scored for/against any file.) Remaining slips: the shared Gemma
license miss; an internal inconsistency (§2 cites base GPQA **73.7** while §8 lists Qwen3.6-27B GPQA
**87.8**, and the official Qwen card says **87.8**); "Dense Transformer" glosses the hybrid
Gated-DeltaNet attention; the ThinkingCap "Charles University / EuroHPC" attribution looks unsourced.

**MODELS_INFO.md — A (best overall / canonical).** Most accurate and complete. The only one with
three end-of-doc **cross-tables** (architecture, sampling, license); its *Recommended Sampling
(Thinking Mode)* table is the production source for `~/.config/llama-swap/generate.py`. Full leltár
on top, full architecture depth. Weakness: a few unsourced marketing figures ("2M+ downloads",
"beats models 10× its size"), none config-critical.

**MODELS_INFO_5_distill_plan.md — A.** Complete `Model List` table on top, best factual accuracy of
the batch (Qwen 27B **SWE-bench 77.2** correct; real ThinkingCap ablation numbers). Bonus
**Quantization Reference** + **Common Serving Parameters** tables. Uses 4 blocks
(Summary/Benefits/Config/Notes) rather than the prompt's 3 — minor deviation.

**MODELS_INFO_7_hauhau.md — B+.** Rich, well-formatted (Quick Links on top, clean 3-section, deep
DeltaNet/expert detail). Real errors: Gemma context *"~8K to 128K"* (**wrong — 256K/262K**); Gemma
*"Apache 2.0"* (**wrong — Gemma license**); Qwen *"77.2 (beats Opus 80.9)"* (**77.2 < 80.9**);
*"HauhauCS (Hauhau Character Suffix)"* (**invented**); Ornith *"active count TBD"*.

**MODELS_INFO_4_35q4plan.md — B+.** Richest per-model config detail + benchmark tables; best Gemma
section (sliding-window 1024, p-RoPE, image budgets, modality order). Prompt miss: **no link-list on
top** and an awkward merged 27B/35B section. After HF validation only **2 real errors remain** (see
below) — more faithful to the cards than it first appeared.

**MODELS_INFO_2.md — B+.** Cleanest quick-ref: exact 3-section shape, accurate, useful "Recommended
for" lines (= use cases). Weakness: shallow — no cross-tables, less architecture; fails the prompt's
"in detail" only partially.

**MODELS_INFO_3.md — B−.** Weakest content: calls the dense Qwen3.6-27B a *"Dense MoE, 981M
activated"* (**hallucination**, repeated across tables); web-scrape residue ("see search results…",
typo URL `Jackrqng`); a formatting bug (orphan "4. Ethical usage" under HauhauCS). Visuals fine.

**MODELS_INFO_6_gemma.md — C.** The file the prompt literally targets, yet weakest on the spec: no
page title (starts mid-list), **GGUF-repo links** instead of original model pages, 3–6 lines per
model (fails "in detail"), and gives up on the gated hauhau model (*"N/A"*). Only virtue: strictest
literal 1/2/3 section shape.

## HF-only validation of the MODELS_INFO_4 claims

Four claims were checked against the official pages; **two dissolve, two are real errors**:

| Claim in _4 | Official HF page says | Verdict |
|---|---|---|
| Ornith base "Gemma 4 / Qwen 3.5" | Ornith card: "post-trained on top of Gemma 4 and Qwen 3.5" | **Not an error** — echoes the card |
| Opus-Distilled "context up to 8192" | rico03 card: trains at 8192; vLLM example uses `--max-model-len 8192` | **Not a clean error** — follows the card |
| Ornith "MTP drafter = BF16-…-of-00002.gguf" | Ornith card: **no MTP mentioned**; that shard is the full model, not a drafter | **Real error** (matches our MEASURED 0-nextn on the local file) |
| Qwen 27B "outperforms Opus, 75.0 vs 80.9" | Qwen3.6-27B card: SWE-bench **77.2** vs Opus **80.9** (trails by 3.7) | **Real error** — wrong number + false "outperforms" |

Note: some third-party sources describe *community-grafted* Ornith MTP variants, but the **official
Ornith card omits MTP**, and the local GGUF we run has 0 nextn (MEASURED) — so for our stack Ornith
cannot use MTP.

## Recommendations

- Keep **MODELS_INFO.md** as the single canonical source (already the sampling source of truth) — it
  just needs the later-added Brian6145 model appended.
- Good merge base for a rewrite is **`_8_ds_opus`** (cleanest per-model 3-section + config tables) or
  **MODELS_INFO.md** (has the cross-tables). Whichever is chosen, fold in **_5**'s correct benchmarks
  + serving tables and **_4**'s Gemma depth, and fix the verified errors: Ornith fake-drafter; Qwen
  "outperforms"; **Gemma license = Gemma Terms (not Apache 2.0)**; Gemma context = 256K; the _8 GPQA
  baseline inconsistency (§2 73.7 vs §8 87.8 — official card says **87.8**).
- Archive/remove **_3** (the "27B = MoE 981M" claim is misleading) and **_6_gemma** (too thin).
- Naming pattern (`_gemma`, `_hauhau`, `_distill_plan`, `_35q4plan`) suggests each file is a
  different local model's run of the same prompt; if so, the hauhau-35B and distill runs produced
  the best docs, the gemma run (file 6) the weakest.

## Sources (HF model pages only)

- https://huggingface.co/deepreinforce-ai/Ornith-1.0-35B
- https://huggingface.co/rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled
- https://huggingface.co/Qwen/Qwen3.6-27B
