---
name: new-campaign
description: Design AND scaffold a new benchmark campaign for the R9700 harness. Use when the user wants to plan a new set of runs (a "campaign") — pick the model/backend, work out the VRAM budget and max context, decide the MTP/KV/depth/concurrency matrix, catch gaps BEFORE burning expensive GPU time, then emit a resumable run.sh + README via bench/gen_campaign.py. The judgement lives here; the deterministic emission lives in gen_campaign.py. Produces docs/campaigns/<date>-<slug>/{spec.json,run.sh,README.md}. Hand off to /benchmark to write up results.
---

# new-campaign — plan first, then scaffold deterministically

Campaign runs are **expensive** (server loads + deep prefills = hours). This skill spends cheap
thinking to avoid costly re-runs: reason the matrix through, then let `bench/gen_campaign.py`
emit the mechanical driver. Output language: **English**. Concrete run plans are the *runbooks*;
the generic how-to is `docs/GUIDE.md`.

## Process

1. **Elicit the question.** What single thing is being learned? What varies (backend, MTP, KV,
   depth, concurrency), what is fixed (model, quant, tuning knobs, reps)? Which model + backend?
   If the user is vague, propose a concrete matrix and confirm.

2. **VRAM budget → max context** (deterministic). Get weights size (`ls -la` the gguf), the f16
   **KV-per-token** (measured; Qwen3.6-35B-A3B ≈ **21 KiB/tok** — or parse the gguf: layers ×
   head_count_kv × (key_length+value_length) × 2 B, then trust a live measurement over the
   formula), and run:
   `bench/gen_campaign.py vram-ctx --weights-gib G --kv-kib-per-tok K --budget-mib M [--np N]`.
   Take **min(that, model native context)** — RoPE cap usually wins. Leave headroom (budget ≤ ~30 GB
   of the 31.86).

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
   - Failure modes expected (MTP short-ctx crash, OOM combos) are **tolerated** (the driver records
     `failures.txt`, never averages them away) and called out in the README.
   - Backends/ports match (`vulkan`→:8081, `rocm`→:8080) and the right llama.cpp builds exist.

5. **Draft `spec.json`** (servers × probes; schema: `bench/gen_campaign.py example`). Show the
   matrix table + a **runtime estimate** (deep prefills ≈ prompt_tokens / ~2000 tok/s each × reps)
   and confirm scope with the user before emitting.

6. **Emit**: `bench/gen_campaign.py emit --spec docs/campaigns/<date>-<slug>/spec.json`
   → resumable `run.sh` (per-probe `done/` markers) + a README skeleton. Flesh out the README prose
   (goal, decisions, out-of-scope). run.sh consolidates every probe into one
   `results.jsonl` and its **last step auto-generates `report.html`** (`bench/lib/report.py`).

7. **Hand off**: remind the user to (a) build fixtures (`build_prompt.py`, see `docs/GUIDE.md` §2),
   (b) run `bash docs/campaigns/<date>-<slug>/run.sh` (resumable — rerun to continue), (c) write up
   with `/benchmark`, then add a `<!-- meta -->` block and run `docs/reindex.py`.

## Token policy
Planning is reasoning — do it in the main context. Shell out for `ls`/`vram-ctx`/gguf parsing
directly. Don't read llama.cpp binaries or `*.log`. Keep the spec + README lean and English.
