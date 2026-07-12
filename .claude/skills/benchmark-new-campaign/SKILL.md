---
name: benchmark-new-campaign
description: Design AND scaffold a new benchmark campaign for the R9700 harness. Use when the user wants to plan a new set of runs (a "campaign") — pick the model/backend, work out the VRAM budget and max context, decide the MTP/KV/depth/concurrency matrix, catch gaps BEFORE burning expensive GPU time, then emit a resumable run.sh + README via bench/gen_campaign.py. The judgement lives here; the deterministic emission lives in gen_campaign.py. Produces campaigns/<date>-<slug>/{spec.json,run.sh,README.md}. Hand off to the benchmark-results skill to write up results (co-located as campaigns/<date>-<slug>/analysis.md).
---

# benchmark-new-campaign — plan first, then scaffold deterministically

Campaign runs are **expensive** (server loads + deep prefills = hours). This skill spends cheap
thinking to avoid costly re-runs: reason the matrix through, then let `bench/gen_campaign.py`
emit the mechanical driver. Output language: **English**. Concrete run plans are the *runbooks*;
the generic how-to is `docs/GUIDE.md`.

## Process

1. **Elicit the question.** What single thing is being learned? What varies (backend, MTP, KV,
   depth, concurrency), what is fixed (model, quant, tuning knobs, reps)? Which model + backend?
   If the user is vague, propose a concrete matrix and confirm.
   ⚠️ **Honor the user's explicit ladder.** If the user gives concrete ctx values (or MTP/KV/depth
   points), scaffold **those exact points** — do NOT silently expand them into a fine auto-bracket.
   `gen_campaign.py` is a dumb emitter (one server per spec entry); the granularity is *your*
   judgement and must match what was asked. You may *recommend* extra points (e.g. finer steps to
   pin a maximum, or a guard-skip point to prove a ceiling), but add them only with the user's
   agreement, and say why. A "much more steps / very different sizes than I asked" outcome is the
   failure mode this rule exists to prevent.

2. **VRAM budget → max context** (deterministic) — and this is now the **safety guard**, not just a
   sizing hint. **Get KV-per-token from the model file, never an online calculator** (online tools —
   and naïve hand-math — get **HYBRID** archs badly wrong): run
   **`bench/gguf_kv.py /path/model.gguf --weights-gib G`** — it prints f16 & q8_0 KiB/tok, the max
   ctx per budget, AND a paste-ready `vram` block. (Under the hood: **only full-attention layers
   cache KV** = `n_attn_layers × head_count_kv × (key_length+value_length) × 2 B`; q8_0 ≈ 0.53× f16.
   For a hybrid model like Qwen3.6 — SSM/Gated-DeltaNet linear-attn layers keep a *fixed* state, not
   a per-token cache — `n_attn_layers` ≪ `block_count`; the tool counts `blk.*.attn_k` tensors, so
   don't multiply by all layers. E.g. Qwen3.6-27B = 16 attn layers of 65 blocks → **64 KiB/tok f16,
   not 260** → 200K f16 fits in ~29 GiB, MEASURED. Trust the tool over any formula or calculator.)
   For a quick what-if, `bench/gen_campaign.py vram-ctx --weights-gib G --kv-kib-per-tok K --budget-mib M`.
   - The generated `run.sh` carries a **pre-flight guard**: for every server it computes predicted
     VRAM and **skips it before launching** if it exceeds `VRAM_BUDGET_MIB`. This is the hard
     "**GPU/VRAM only, never spill to system RAM**" enforcement — an over-budget config is never
     started, so it cannot fall back to GTT and freeze the box. **The guard needs a `vram` block in
     the spec** (`weights_gib` + `kv_kib_per_tok` per KV type + `budget_mib`); without it the guard
     is a silent no-op (and `gen_campaign.py emit` prints a loud warning). Never ship a spec that
     the guard can't act on. Set the budget just under **physical VRAM** (≈32624 MiB total on this
     card; default guard ~32400) so genuine near-edge configs still run, while gross overcommits
     (35 GiB+) are refused. A conservative "safe operating" budget (e.g. 31000) is a *reporting*
     number, computed post-hoc from measured VRAM — not the guard.
   - **To find a maximum, measure from safely below the edge, then calculate.** Ladder a spread of
     depths that all *fit* (good VRAM-vs-ctx slope), log measured VRAM at each, and extrapolate the
     exact max ctx per budget in the write-up. Don't push the ladder itself past the edge.
   - Take **min(max-ctx, model native context)** — RoPE cap can win (it did for the 35B MoE; the
     27B dense is VRAM-bound instead).

3. **Apply the iron rules** (same as /benchmark — never violate silently):
   - **Cold prefill**: `prefix_mode=unique` (identical prompts inflate prefill ~2.4×).
   - **Chat template** for thinking / bare-instruction prompts (`api=chat`); raw completions EOS.
   - **KV**: default **f16**; q8_0 only if a sweep A/B shows ≤5 % loss at depth. On this box q8_0 is
     usually *not* worth it (KV is small) — include at most one confirmatory q8_0 point.
   - **MTP asymmetric**: on for single-stream (+30–40 % decode), **off** for parallel (−8…−15 % at
     c4 — measured). Don't put MTP-on in a concurrency sweep without a reason.
   - **Bracket optima** (model-bench sweep.py) and validate at the serving point; one variable per
     comparison; ties within ±3 % are `plateau_within_noise`.

4. **Gap analysis — the point of this skill.** Before emitting, check:
   - **prompt tokens + max_tokens ≤ per-slot ctx** (`ctx/np`). The starter campaign's `cr64000`
     failed because a ~65 K prompt left no gen headroom in a 65536 window. Size fixtures accordingly.
   - Every referenced prompt file is **buildable** from the corpus (`build_prompt.py` fails loudly
     if a target can't be filled ≥97 %); big depths need both `--src` corpora.
   - Failure modes expected (MTP short-ctx crash, OOM combos) are **tolerated**: the generated
     driver **continues to the next server** on a start failure (records `failures.txt`), never
     `exit 1`. Over-budget servers are **SKIPPED before launch** by the guard (§2) — no hand-editing
     of `run.sh` required (that was a past defect; it is now the default).
   - Backends/ports match (`vulkan`→:8081, `rocm`→:8080) and the right llama.cpp builds exist.

5. **Draft `spec.json`** (servers × probes; schema: `bench/gen_campaign.py example`). Show the
   matrix table + a **runtime estimate** (deep prefills ≈ prompt_tokens / ~2000 tok/s each × reps)
   and confirm scope with the user before emitting. Keep probes **short and configurable**: the
   generated `run.sh` honors `ONLY="slugglob,…"` (run just a subset), `REPS=` / `MAX_TOKENS=`
   overrides (quick pass), and `VRAM_BUDGET_MIB=` (guard threshold). Set sensible per-probe defaults
   (reps 2, max_tokens 256) so the whole campaign *and* a chosen subset both give reliable numbers.

6. **Emit**: `bench/gen_campaign.py emit --spec campaigns/<date>-<slug>/spec.json`
   → resumable `run.sh` (per-probe `done/` markers) + a README skeleton, under
   `campaigns/<date>-<slug>/`. Flesh out the README prose (goal, decisions, out-of-scope). run.sh
   consolidates every probe into one `results.jsonl` (with VRAM/GTT samples per server) and its
   **last step auto-generates SVG charts + `appendix.md`** (`bench/lib/report.py`) to embed in the write-up.

7. **Hand off**: remind the user to (a) build fixtures (`build_prompt.py`, see `docs/GUIDE.md` §2),
   (b) run `bash campaigns/<date>-<slug>/run.sh` (resumable — rerun to continue; `ONLY=`/`REPS=` to
   subset or shorten), (c) write up with the **benchmark-results** skill → co-located
   `campaigns/<date>-<slug>/analysis.md`, then add a `<!-- meta -->` block and run `docs/reindex.py`.

## Token policy
Planning is reasoning — do it in the main context. Shell out for `ls`/`vram-ctx`/gguf parsing
directly. Don't read llama.cpp binaries or `*.log`. Keep the spec + README lean and English.
