# Qwen3.6-27B fine-tune shootout — output quality + token usage (R9700)

*This is the campaign **runbook** (a plan, run across sessions). The results write-up lands in
`docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md` (registered in `docs/INDEX.md`) after
Phase C. Scaffolded from `spec.json` by `bench/core/gen_campaign.py` (`kind: quality`) → generated
`run.sh`.*

> **⚠ Reproducing the committed data vs. running fresh (2026-07-16 merge note).** The results in
> `docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md` (from this dir's `tmp/` + `results/`)
> were captured by this dir's own `run_capture.sh`, which drives the shared tools
> `bench/quality/capture.py` + `bench/quality/graders/` — **that is the authoritative reproduction path**: it
> carries the `--min-p`/`--presence-penalty` passthrough, the incomplete-stream guard (Iron Rule 15), and
> the row-level resume the committed rows depend on. The `spec.json` → `run.sh` →
> `bench/core/capture_engine.py` pipeline described below is the **go-forward** path for *new* runs; per the
> merge review it is **not yet a drop-in reproducer** for the committed rows (capture_engine lacks those
> three capabilities), so use `run_capture.sh` to reproduce and `run.sh` for fresh work until they are
> ported.

- **Date:** 2026-07-12 · **Status:** ready to execute
- **Owner split:** Phase A (downloads + GPU capture + deterministic scoring) is **run manually**;
  Phase B (blind LLM-judge of open-ended tasks, in a Claude session) + Phase C (charts + write-up)
  are **Claude's**. This doc is the contract between them.

## 0. Why this campaign / what changed

We compare four community **Qwen3.6-27B** fine-tunes on **answer quality** and **token economy** (how
many thinking tokens each burns for the same task), plus MTP on/off for the one MTP build.

**Max-context is already resolved and is NOT part of this campaign.** All four are the identical
`qwen35` **hybrid** architecture (48 SSM / Gated-DeltaNet linear-attention layers + **16 full-attention
layers** + 1 nextn/MTP), so they share one KV geometry:

| KV | KiB/tok (16 attn layers) | Max ctx @ Q4 weights (~15 GiB), 32400 MiB budget |
|----|--------------------------|--------------------------------------------------|
| f16 | **64** | **≈ 240K** (VRAM-bound, just under native 262K) |
| q8_0 | **34** | **262K** (native/RoPE-capped; VRAM allows more) |

This corrects an earlier error (a prior spec claimed 260 KiB/tok / "200K impossible" by counting all
65 blocks instead of the 16 attention layers). **MEASURED:** local `Qwen3.6-27B-Q4_K_S` loaded at
**200K f16 in 31 s using 29.0 GiB VRAM / 0.95 GiB GTT**. Tool: `bench/core/gguf_kv.py` (hybrid-aware;
counts `blk.*.attn_k` tensors). Since all four share this, a max-context bisection would return the
same number four times → dropped.

## 1. Models under test (all ~Q4 class, apples-to-apples)

| Config label | HF repo | Quant / file | MTP |
|--------------|---------|--------------|:---:|
| `rico03-distilled` | `rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF` | Q4_K_S (~15.6 GB) | off |
| `unsloth-mtp-off` | `unsloth/Qwen3.6-27B-MTP-GGUF` | Q4_K_M (~17.1 GB) | off |
| `unsloth-mtp-on` | *(same file as above)* | Q4_K_M | **on** |
| `hauhau-uncensored` | `HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive` | IQ4_XS (~15 GB) | off |
| `jackrong-qwopus` | `Jackrong/Qwopus3.6-27B-v1-preview-GGUF` | Q4_K_M (~16.5 GB) | off |

5 configs, 4 downloads (~64 GB). The MTP build is the only one exercised both ways. Config list +
fixed serving live in **`spec.json`**; edit there and regenerate `run.sh`.

## 2. Fixed serving config (held constant so only the model varies)

`backend=vulkan` (:8081) · `-ub 2048 -b 4096 -fa on` · **KV f16** · `ctx 32768` · `np 1`.
Sampling (Qwen3.6 card / GGUF defaults): **temp 1.0, top_p 0.95, top_k 20, seed 42** (fixed seed).
ctx 32768 is far more than any task needs and keeps VRAM identical across configs so the memory
column is comparable. MTP via `mtp:1` (`--spec-type draft-mtp`) for `unsloth-mtp-on` only.

## 3. Task set — `inputs/tasks/tasks.jsonl`

**9 deterministic** (auto-graded, objective — no judge) + **3 judge** (open-ended, blind rubric):

| id | cat | grader | checks |
|----|-----|--------|--------|
| math-primes ★ | det | final_match | primes in [100,150] = 10 |
| math-clock | det | final_match | clock angle = 7.5° |
| logic-knights ★ | det | final_match | A=knight, B=knave |
| math-trains | det | final_match | meet at 120 min |
| code-anagram | det | pyexec | anagram grouping vs hidden asserts |
| code-parsekv | det | pyexec | 'a=1;b=2' → dict |
| code-fixbug | det | pyexec | fix second-largest-distinct |
| json-invoice | det | json_schema | required keys + item shape |
| instr-langs | det | constraints | exactly 5, sorted, unique, `- ` prefix |
| review-code | judge | rubric | catch eval-injection / path-traversal / no error-handling |
| explain-hybrid ★ | judge | rubric | SSM+attention long-ctx trade-offs, KV implications |
| refactor-fn | judge | rubric | dict→querystring refactor + rationale |

★ = headline reasoning tasks for the token-economy comparison. Every task records tokens regardless
of grader. Deterministic tasks demand a strict answer format (`FINAL: …` or a single ```python
block) so grading needs no model.

## 4. Metrics captured (everything measurable)

Per config × task × rep (`tmp/outputs.jsonl`, streamed so latency is real) — captured by
`bench/core/capture_engine.py tasks`:
- **Tokens / economy:** `prompt/completion/total/cached_tokens`, **`think_tokens`** (headline),
  `answer_tokens`.
- **Throughput** (llama.cpp `timings`): `prefill_tps`, `decode_tps`, `prompt_n/ms`, `predicted_n/ms`,
  per-token ms (raw `timings` stored too).
- **Latency:** `ttft_s` (first token), **`ttfa_s`** (first *answer* token, post-`</think>` — what the
  user waits for), `think_time_s`, `latency_s`.
- **Health flags:** `finish_reason`, `think_closed`, `has_answer`, **`truncated_thinking`** (hit
  `max_tokens` mid-`<think>` → no answer; auto-fails grading — a real inefficiency signal).
- **Provenance + full response text** (saved for re-analysis / the judge).

Per config (`tmp/vram.jsonl` + `tmp/gpu_<config>.csv` from `vram_sampler.py`):
`vram_used_mib_at_load`, `peak_vram_used_mib`, **`peak_gtt_used_mib`** (host-RAM spill), `avg/peak_
power_w`, `peak_temp_c`, `avg/peak_sclk_mhz`, `load_time_s`, `weights_gib`; plus
`props_<config>.json` (build + effective settings).

⚠️ **`max_tokens` must be generous (default 8192).** These thinking models burn 1000s of tokens
(measured: even "2+2" spent 512 think tokens / 16 s). Too low truncates mid-`<think>`
(`finish_reason=length`, no answer), invalidating both the grade and the token-economy number.

---

## Phase A — MANUAL (fresh session, GPU box)

### A1. Download the four models (~64 GB)
```bash
pip install -U "huggingface_hub[cli]"          # provides the `hf` command
export M=/home/dev/models/gguf
hf download rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF --include "*Q4_K_S*.gguf" --local-dir "$M/_dl/rico03"
hf download unsloth/Qwen3.6-27B-MTP-GGUF                            --include "*Q4_K_M*.gguf" --local-dir "$M/_dl/unsloth"
hf download HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive     --include "*IQ4_XS*.gguf" --local-dir "$M/_dl/hauhau"
hf download Jackrong/Qwopus3.6-27B-v1-preview-GGUF                  --include "*Q4_K_M*.gguf" --local-dir "$M/_dl/jackrong"
```
Then symlink each to the exact filename in `spec.json`'s `configs` (upstream names vary; adjust
`spec.json` + regenerate `run.sh` if a repo split the file):
```bash
ln -sf "$M"/_dl/rico03/*Q4_K_S*.gguf   "$M/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-Q4_K_S.gguf"
ln -sf "$M"/_dl/unsloth/*Q4_K_M*.gguf  "$M/Qwen3.6-27B-MTP-Q4_K_M.gguf"
ln -sf "$M"/_dl/hauhau/*IQ4_XS*.gguf   "$M/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf"
ln -sf "$M"/_dl/jackrong/*Q4_K_M*.gguf "$M/Qwopus3.6-27B-v1-preview-Q4_K_M.gguf"
```

### A2. (Recommended) sanity-check each model's KV geometry
```bash
for f in "$M"/Qwen3.6-27B-*.gguf "$M"/Qwopus3.6-27B-*.gguf; do python3 bench/core/gguf_kv.py "$f"; echo; done
```
Expect `HYBRID: 16 full-attention KV layers … 64 KiB/tok` for all — confirms same arch.

### A3. Run capture + deterministic scoring (resumable, VRAM-guarded)
```bash
cd /home/dev/work/dp-craft/amd
bash campaigns/quality/2026-07-12-1736-27b-finetune-quality/run.sh          # all 5 configs, reps 1
# subset / more reps to average sampling noise:
# ONLY='unsloth*' REPS=3 bash campaigns/quality/2026-07-12-1736-27b-finetune-quality/run.sh
```
The generated `run.sh` serves each config, samples VRAM/GTT/power/thermal across the probe, sends all
12 tasks via `capture_engine tasks`, stops the server; **resumable** (`tmp/done/`), **continues past a
failed config** (`results/failures.txt`), and **skips any model predicted over the VRAM budget**. It ends
by running `bench/quality/graders/score_deterministic.py` (pass% table) and `bench/core/report.py`
(SVG charts + `results/appendix.md`). ⚠️ `pyexec` **runs model-generated code** in a subprocess+timeout — fine
on this box; be aware. Est. runtime ≈ **30–60 min** at reps 1.

> **Clean re-run:** if a previous partial run left stale rows, `rm -rf
> campaigns/quality/2026-07-12-1736-27b-finetune-quality/tmp` before re-running so every config captures the full
> schema uniformly (done-markers would otherwise skip finished configs).

---

## Phase B — BLIND LLM-JUDGE (in a Claude session)

The 3 `judge` tasks have no deterministic answer. Judge them **blind** (opaque ids, shuffled — a name
like "uncensored"/"opus" must not bias the grade):

```bash
python3 bench/quality/graders/prepare_judge.py \
  --outputs campaigns/quality/2026-07-12-1736-27b-finetune-quality/tmp/outputs.jsonl \
  --tasks   campaigns/quality/2026-07-12-1736-27b-finetune-quality/inputs/tasks/tasks.jsonl \
  --out     campaigns/quality/2026-07-12-1736-27b-finetune-quality/tmp/judge_bundle.md
```

Paste the **entire** `judge_bundle.md` into a Claude session under this exact prompt:

> You are grading LLM answers to open-ended tasks. For EACH `## Block <id>` below, score three axes as
> integers 0–5: **correctness** (factually right, no errors), **depth** (completeness / insight),
> **clarity** (well-structured, readable — penalize padding). Be strict and consistent; use the whole
> 0–5 range. Output ONLY a JSON array, one object per block, exact shape:
> `[{"id": "b01", "correctness": 0, "depth": 0, "clarity": 0, "note": "one-line reason"}]`
> No prose outside the JSON.

**Anchors** for a strict grade (apply within the blind text): `review-code` full credit requires
flagging **`eval()` on file contents (arbitrary code exec)**, **path traversal via `name`**, and **no
error handling / unclosed file**. `explain-hybrid` must state **only full-attention layers grow a KV
cache** while SSM layers keep a **fixed-size state** → sub-linear KV growth / more context per GB;
bonus for the recall trade-off of linear attention. `refactor-fn` expects `is not None` (not
`!= None`), `isinstance`, f-strings/`str()` unification, `urllib.parse.urlencode` or clear naming.

Save Claude's JSON array to `tmp/judge_raw.json`, then fold it in and re-render:
```bash
python3 bench/quality/graders/apply_judge_scores.py \
  --raw campaigns/quality/2026-07-12-1736-27b-finetune-quality/tmp/judge_raw.json \
  --out campaigns/quality/2026-07-12-1736-27b-finetune-quality/results/judge_scores.jsonl
python3 bench/core/report.py campaigns/quality/2026-07-12-1736-27b-finetune-quality   # re-render WITH judge data
```
`apply_judge_scores.py` clamps to 0–5 and warns on any unknown/unscored/out-of-range block, so a bad
paste can't silently corrupt the analysis.

## Phase C — AGGREGATE, CHART & WRITE UP (Claude → benchmark-results skill)

Charts are already generated by `run.sh` / the Phase-B re-render (`bench/core/report.py` →
`results/charts/*.svg` + `results/appendix.md`): quality-vs-cost scatter (headline efficient frontier),
deterministic accuracy, judge
score, token economy (think vs answer), throughput (decode/prefill), latency (ttft→ttfa dumbbell),
memory·power·thermal small-multiples, per-task heatmap. One fixed color per config across all charts,
one axis each, direct labels + data table (validated palette).

Write the write-up (`docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md`; summary + table
first; **memory column mandatory**), one row/config:

| config | mtp | det pass% | judge /5 | mean think tok | mean total tok | quality/1k tok | decode tok/s | ttfa s | peak VRAM | peak GTT | avg W |
|--------|:---:|----------:|---------:|---------------:|---------------:|---------------:|-------------:|-------:|----------:|---------:|------:|

Then: per-dimension judge breakdown; **token-economy finding** (think-token spread on ★ tasks — who
reasons efficiently vs who rambles); **MTP on/off** decode delta on the unsloth build; truncation rate;
efficient-frontier read. Rows `MEASURED` (cite `tmp/` + `results/`); judge scores `INFERRED` (blind
LLM-judge, temp noted). Embed `results/appendix.md` at the end of the write-up, add a `<!-- meta -->`
block, run `docs/reindex.py`.

## File map (campaign dir)
```
spec.json          the campaign definition (configs, serving, vram guard) — edit + regenerate run.sh
plan.md            this runbook
run_capture.sh     Phase-A driver — this dir's own; drives bench/quality/capture.py + bench/quality/graders/
run.sh             GENERATED by gen_campaign.py — Phase-A driver (serve×config → capture → score → report)
inputs/tasks/      tasks.jsonl — 12 tasks + grader specs
tmp/               GENERATED (gitignored): outputs.jsonl, vram.jsonl, gpu_<cfg>.csv, props_<cfg>.json,
                   done/ markers, failures.txt; Phase-B working files (judge_bundle.md, judge_raw.json)
results/           GENERATED (committed): scores_deterministic.jsonl, judge_scores.jsonl, charts/ (SVGs),
                   appendix.md (embeds charts/ into the write-up)
```
Write-up (Phase C, benchmark-results skill):
`docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md` + the charts appendix embedded from
`results/appendix.md`.
Shared machinery (not in this dir): `bench/quality/capture.py` (tasks capture),
`bench/core/capture_engine.py` (the go-forward engine path),
`bench/quality/graders/` (score_deterministic + prepare_judge + apply_judge_scores),
`bench/core/report.py` (charts), `stack/gpu/vram_sampler.py`.

## Risks / notes
- **Same arch ⇒ quality differences are from fine-tuning data, not capacity.** Frame findings that way.
- **`pyexec` executes model code** — subprocess+timeout only; run on a disposable box if paranoid.
- **Sampling noise:** temp 1.0 makes single-rep pass/fail noisy; use `REPS=3` near a boundary
  (majority vote in Phase C).
- **MTP correctness:** `unsloth-mtp-on` needs the draft-mtp layer; if it fails to start it's logged in
  `tmp/failures.txt` and the others still complete.
- **IQ4_XS vs Q4_K_M** quant mismatch across repos is a minor confound (note it); pick a common quant
  to eliminate it.
