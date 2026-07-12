# Plan: Qwen3.6-27B fine-tune shootout — output quality + token usage (R9700)

- **Date:** 2026-07-12 · **Status:** ready to execute in a fresh session
- **Campaign dir:** `campaigns/2026-07-12-27b-finetune-quality/`
- **Owner split:** Phase A (downloads + GPU capture + deterministic scoring) is **run manually by the
  user**; Phase B (LLM-judge of open-ended tasks) + Phase C (aggregation & write-up) are **done by
  Claude** from the Phase-A output files. This doc is the contract between the two.

## 0. Why this campaign / what changed

We compare four community **Qwen3.6-27B** fine-tunes on **answer quality** and **token economy**
(how many thinking tokens each burns for the same task), plus MTP on/off for the one MTP build.

**The max-context question is already resolved and is NOT part of this campaign.** All four are the
identical `qwen35` **hybrid** architecture (48 SSM / Gated-DeltaNet linear-attention layers + **16
full-attention layers** + 1 nextn/MTP), so they share one KV cache geometry:

| KV | KiB/tok (16 attn layers) | Max ctx @ Q4 weights (~15 GiB), 32400 MiB budget |
|----|--------------------------|--------------------------------------------------|
| f16 | **64** | **≈ 240K** (VRAM-bound, just under native 262K) |
| q8_0 | **34** | **262K** (native/RoPE-capped; VRAM allows more) |

This corrects an earlier error (a prior spec claimed 260 KiB/tok / "200K impossible" by counting all
65 blocks instead of the 16 attention layers). **MEASURED confirmation:** local `Qwen3.6-27B-Q4_K_S`
loaded at **200K f16 in 31 s using 29.0 GiB VRAM / 0.95 GiB GTT** — fits comfortably. Source tool:
`bench/gguf_kv.py` (now hybrid-aware; counts `blk.*.attn_k` tensors). Because all four share this,
a max-context bisection would return the same number four times → dropped, per the user's decision.

## 1. Models under test (all ~Q4 class, apples-to-apples)

| Config label | HF repo | Quant / file | MTP |
|--------------|---------|--------------|:---:|
| `rico03-distilled` | `rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF` | Q4_K_S (~15.6 GB) | off |
| `unsloth-mtp-off` | `unsloth/Qwen3.6-27B-MTP-GGUF` | Q4_K_M (~17.1 GB) | off |
| `unsloth-mtp-on` | *(same file as above)* | Q4_K_M | **on** |
| `hauhau-uncensored` | `HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive` | IQ4_XS (~15 GB) | off |
| `jackrong-qwopus` | `Jackrong/Qwopus3.6-27B-v1-preview-GGUF` | Q4_K_M (~16.5 GB) | off |

5 configs, 4 downloads (~64 GB; 160 GB free). The MTP build is the only one exercised both ways.

## 2. Fixed serving config (held constant so only the model varies)

`backend=vulkan` (:8081) · `-ub 2048 -b 4096 -fa on` · **KV f16** · `ctx 32768` · `np 1`.
Sampling (Qwen3.6 card / GGUF defaults): **temp 1.0, top_p 0.95, top_k 20, seed 42** (fixed seed for
reproducibility). ctx 32768 is far more than any task needs (prompt < 1K, thinking budget 2048) and
keeps VRAM identical across configs so the memory column is comparable. MTP via `MTP=1`
(`--spec-type draft-mtp`) for `unsloth-mtp-on` only.

## 3. Task set — `campaigns/2026-07-12-27b-finetune-quality/tasks/tasks.jsonl`

**9 deterministic** (auto-graded, objective — no judge) + **3 judge** (open-ended, rubric):

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

Per config × task × rep (`out/outputs.jsonl`, streamed so latency is real):
- **Tokens / economy:** `prompt_tokens`, `completion_tokens`, `total_tokens`, `cached_tokens`,
  **`think_tokens`** (headline), `answer_tokens`.
- **Throughput** (llama.cpp `timings`): `prefill_tps`, `decode_tps`, `prompt_n/ms`,
  `predicted_n/ms`, per-token ms (raw `timings` stored too).
- **Latency:** `ttft_s` (first token), **`ttfa_s`** (first *answer* token, post-`</think>` — what the
  user waits for), `think_time_s`, `latency_s`.
- **Health flags:** `finish_reason`, `think_closed`, `has_answer`, **`truncated_thinking`** (hit
  `max_tokens` mid-`<think>` → no answer; auto-fails grading — a real inefficiency signal).
- **Provenance:** `sampling` (temp/top_p/top_k/seed), `max_tokens`.

Per config (`out/vram.jsonl` + `out/gpu_<config>.csv` from the sampler): `vram_used_mib_at_load`,
`peak_vram_used_mib`, **`peak_gtt_used_mib`** (host-RAM spill), `avg_power_w`, `peak_power_w`,
`peak_temp_c`, `avg/peak_sclk_mhz`, `load_time_s`, `weights_gib`; plus `props_<config>.json`
(build + effective server settings). Derived in Phase C: deterministic **pass%**, judge scores,
mean think/total tokens, **quality-per-1k-tokens**, MTP on/off decode delta, truncation rate.

⚠️ **`max_tokens` must be generous (default 8192).** These thinking models burn 1000s of tokens
reasoning (measured: even "2+2" spent 512 think tokens / 16 s). Too low truncates mid-`<think>`
(`finish_reason=length`, no answer), which invalidates both the grade and the token-economy number.

---

## Phase A — MANUAL (user, fresh session, GPU box)

### A1. Download the four models (~64 GB)
```bash
pip install -U "huggingface_hub[cli]"          # provides the `hf` command
export M=/home/dev/models/gguf
hf download rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF --include "*Q4_K_S*.gguf" --local-dir "$M/_dl/rico03"
hf download unsloth/Qwen3.6-27B-MTP-GGUF                            --include "*Q4_K_M*.gguf" --local-dir "$M/_dl/unsloth"
hf download HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive     --include "*IQ4_XS*.gguf" --local-dir "$M/_dl/hauhau"
hf download Jackrong/Qwopus3.6-27B-v1-preview-GGUF                  --include "*Q4_K_M*.gguf" --local-dir "$M/_dl/jackrong"
```
Then **rename/symlink each to the exact filename `run_capture.sh` expects** (upstream filenames vary;
adjust if a repo split the file or uses a different name):
```bash
ln -sf "$M"/_dl/rico03/*Q4_K_S*.gguf   "$M/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-Q4_K_S.gguf"
ln -sf "$M"/_dl/unsloth/*Q4_K_M*.gguf  "$M/Qwen3.6-27B-MTP-Q4_K_M.gguf"
ln -sf "$M"/_dl/hauhau/*IQ4_XS*.gguf   "$M/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf"
ln -sf "$M"/_dl/jackrong/*Q4_K_M*.gguf "$M/Qwopus3.6-27B-v1-preview-Q4_K_M.gguf"
```
*(Alternatively edit the `CONFIGS` array in `run_capture.sh` to point at the real filenames.)*

### A2. (Optional but recommended) sanity-check each model's KV geometry
```bash
for f in "$M"/Qwen3.6-27B-*.gguf; do python3 bench/gguf_kv.py "$f"; echo; done
```
Expect `HYBRID: 16 full-attention KV layers … 64 KiB/tok` for all — confirms they're the same arch.

### A3. Run the capture + deterministic scoring
```bash
cd /home/dev/work/dp-craft/amd
bash campaigns/2026-07-12-27b-finetune-quality/run_capture.sh          # all 5 configs, reps 1
# subset / more reps to average sampling noise:
# ONLY='unsloth*' REPS=3 bash campaigns/.../run_capture.sh
```
The driver serves each config, logs VRAM at load, sends all 12 tasks via `capture.py`, stops the
server, is **resumable** (per-config markers in `out/done/`) and **continues past a failed config**
(`out/failures.txt`). It finishes by running `graders/score_deterministic.py` and printing a pass%
table. ⚠️ `pyexec` **runs model-generated code** in a subprocess+timeout — fine on this box, but be
aware. Est. runtime: ~12 tasks × 5 configs × (thinking ≤2048 tok) ≈ **30–60 min** at reps 1.

### A4. Hand back to Claude
Provide these three files (or just point Claude at the campaign dir in the new session):
`out/outputs.jsonl`, `out/vram.jsonl`, `out/scores_deterministic.jsonl`.

---

## Phase B — LLM JUDGE (Claude)

For the 3 `judge` tasks, Claude scores each config's `response` (thinking stripped) against a fixed
rubric, **blind to the config label** (shuffle + anonymize before scoring), writing
`out/judge_scores.jsonl` (`config, task_id, rep, correctness, depth, clarity, notes`).

Rubric (0–5 each): **correctness** (factually right / catches the real issues), **depth**
(completeness, non-obvious insight), **clarity** (well-organized, concise — penalize padding). Task
anchors:
- `review-code`: full credit requires flagging **`eval()` on file contents (arbitrary code exec)**,
  **path traversal / injection via `name`**, and **no error handling / unclosed file**.
- `explain-hybrid`: must state that **only full-attention layers grow a KV cache** while SSM layers
  keep a **fixed-size state** → sub-linear KV growth / longer context per GB; bonus for the
  quality/recall trade-off of linear attention.
- `refactor-fn`: expects `is not None` (not `!= None`), `isinstance`, f-strings/`str()` unification,
  `urllib.parse.urlencode` or clear naming; justification quality matters.

## Phase C — AGGREGATE, CHART & WRITE UP (Claude → benchmark-results skill)

1. **Generate charts:** `python3 make_charts.py --dir out` → `out/charts/*.svg` + `out/charts/appendix.md`.
   Self-contained theme-aware SVGs (one fixed color per config across all charts, one axis each,
   every mark direct-labeled + a data table — validated palette). Chart set: **quality-vs-cost
   scatter** (headline efficient frontier), deterministic accuracy, judge score, token economy
   (think vs answer), throughput (decode/prefill), latency (ttft→ttfa dumbbell), memory·power·thermal
   small-multiples, and a per-task outcome heatmap.
2. **Write** `campaigns/2026-07-12-27b-finetune-quality/analysis.md` (co-located; summary + table
   first; **memory column mandatory**). Headline table, one row per config:

   | config | mtp | det pass% | judge /5 | mean think tok | mean total tok | quality/1k tok | decode tok/s | ttfa s | peak VRAM | peak GTT | avg W |
   |--------|:---:|----------:|---------:|---------------:|---------------:|---------------:|-------------:|-------:|----------:|---------:|------:|

   Then: per-dimension judge breakdown; **token-economy finding** (think-token spread on ★ tasks —
   who reasons efficiently vs who rambles); **MTP on/off** decode-speed delta on the unsloth build;
   truncation/runaway rate; efficient-frontier read from the scatter. All rows `MEASURED` (cite
   `out/…`); judge scores `INFERRED` (LLM-judge, rubric saved).
3. **Embed the charts** as an **appendix**: paste `out/charts/appendix.md` (the `![](charts/…svg)`
   references + data table) at the end of `analysis.md`. Add a `<!-- meta -->` block and run
   `docs/reindex.py`. (`report.html` optional — these are custom outputs, not standard results.jsonl.)

## File map (campaign dir)
```
tasks/tasks.jsonl              12 tasks + grader specs
capture.py                     stream one server → outputs.jsonl (tokens, timings, ttft/ttfa, flags)
graders/score_deterministic.py objective grading (final_match/pyexec/json_schema/constraints)
run_capture.sh                 Phase-A driver (serve×config, VRAM/power/thermal sampler, /props, resumable)
make_charts.py                 Phase-C: outputs → out/charts/*.svg + appendix.md (decision charts)
out/                           GENERATED: outputs.jsonl, vram.jsonl, gpu_<config>.csv, props_<config>.json,
                               scores_deterministic.jsonl, judge_scores.jsonl (Phase B), charts/, failures.txt, done/
analysis.md                    Phase-C write-up (benchmark-results skill) + charts appendix
```

## Risks / notes
- **Same arch ⇒ quality differences are from fine-tuning data, not capacity.** Frame findings that way.
- **`pyexec` executes model code** — subprocess+timeout only; run on a disposable box if paranoid.
- **Sampling noise**: temp 1.0 means single-rep pass/fail is noisy; use `REPS=3` for the deterministic
  score if a config lands near a boundary (majority vote in Phase C).
- **MTP correctness**: `unsloth-mtp-on` needs the draft-mtp layer present; if it fails to start it's
  logged in `failures.txt` and the other configs still complete.
- **IQ4_XS vs Q4_K_M** quant mismatch across repos is a minor confound (noted in the write-up); pick
  a common quant if a repo offers Q4_K_M and you want it eliminated.
