---
name: benchmark-results
description: Run a benchmark on the R9700 (RDNA4) box AND document it to a fixed, reproducible spec — every run's full parameterization and measured numbers (including VRAM/GTT memory) captured, nothing lost. Routes between two tracks: model-bench (llama-bench tuning; sweep.py adaptive optimum search with the KV ≤5% rule) and engine-bench (cross-engine + serving combos: MTP × KV × context depth × concurrency via campaign.sh). Use when the user wants to measure a runtime/model/tuning config, compare backends/engines, find an optimum, test parallel/agentic throughput, or turn a bench/runs/ result into a report. Produces canonical run data plus an English analysis doc co-located in the campaign dir (campaigns/<date>-<slug>/analysis.md, summary + table first). May pull external context via the research skill. To plan/scaffold a new campaign first, use the benchmark-new-campaign skill.
---

# benchmark-results — measure, then document (nothing lost)

The measured counterpart to the research skill. **Every configuration tested becomes a data row AND
a documented line in the report.** Output language: **English**. Deterministic shape every time.
Full how-to for a human: `docs/GUIDE.md`. Standard campaign: `campaigns/2026-07-11-starter-baseline/`.

## Route first — which track?
| If the goal is… | Tool | Dir |
|-----------------|------|-----|
| THE tuning optimum for one engine (peak bracketed both sides + KV f16/q8_0 ≤5% verdict) | **`sweep.py`** | `bench/model-bench/` |
| Quick manual knob check (fixed grid, one invocation) | `run.sh` | `bench/model-bench/` |
| Real-workload cross-engine / thinking / **concurrency** numbers against running servers | `run.sh` (capture_engine probe) | `bench/engine-bench/` |
| The **combination matrix** — backend × MTP × KV × depth × parallel streams, server restarts handled, resumable | **`campaign.sh`** | `bench/engine-bench/` |
| Community-comparable synthetic serving curves | llama-benchy (`bench/dl/benchy-venv`) | `bench/engine-bench/` |

llama-bench = synthetic tokens (no real prompts, no thinking, no MTP, no concurrency). Serving-only
knobs (MTP `--spec-type draft-mtp`, `-np` slots, prefix cache) live in engine-bench. Don't force
one track to do the other's job; llama-bench optima must be validated at the serving operating
point (campaign.sh) before they go in a TL;DR.

## Iron rules for a valid measurement
1. **Capture full parameterization, always** — the scripts do this (meta.txt, server cmdline,
   `/props`, build_commit, GPU samples). If you bypass them, you own the bookkeeping.
2. **Cold vs warm prefill**: identical prompts hit the server prefix cache from request 2 —
   `PREFIX_MODE=unique` for honest prefill (measured 2.4× inflation without it). `shared` only
   when studying the cache itself.
3. **Chat template for instruction prompts**: `--api chat` for thinking/bare-instruction fixtures
   (raw /completions can EOS after 1 token — measured); it also gives MEASURED `ttfa_s`.
4. **One variable per comparison**; differences within ±3% (`plateau_within_noise`) are a tie,
   not a winner. REPS ≥ 2 on engine-bench, ≥ 3 on model-bench.
5. **KV q8_0 decision** comes only from the sweep's A/B at target depth (≤5% rule), never from
   defaults. Quantify the payoff (VRAM saved → extra ctx/slots) from the gpu_samples data.
6. **Provenance tags**: our `bench/runs/` = `MEASURED` (cite run dir), external = `CLAIMED`
   (research skill, with source), reasoning = `INFERRED`. Never blend in one table.
7. **Failures are results**: campaign `failures.txt` rows (e.g. MTP mid-stream crash, OOM combos)
   go in the report as FAILED — an OOM at f16 that fits at q8_0 is a finding, not a gap. A server the
   pre-flight guard **SKIPPED** (predicted VRAM > budget, never launched) is also a result: report it
   as `SKIPPED (predicted N GiB > budget)`, distinct from a launched-then-OOMed FAILED row.
8. **Memory is a first-class number** — every server records `vram_used_mib_at_load` and
   `peak_vram_mib`/`peak_gtt_mib` during the probe (from `gpu_samples.csv`, sampled by
   `vram_sampler.py`). **A memory column is mandatory in the results table.** `peak_gtt_mib` must
   stay near its **idle baseline** (tens of MiB — ~77 on this box, NOT 0); a peak hundreds–thousands
   of MiB above baseline means the model spilled into GPU-accessible system RAM (GTT) — the freeze
   risk — so flag it loudly. For max-context runs, fit the **measured** VRAM-vs-ctx line from the
   rungs that loaded and report the **calculated** max ctx per budget (safe budget + physical VRAM),
   not just the a-priori formula. Physical VRAM on this box = **32624 MiB**.

## Token policy
Running is shell work — do it directly. For interpreting large logs or pulling external comparison
numbers, fan out to **haiku** subagents (return digests only). Never read `bench/llamacpp*/`
binaries or `*.err`/`*.log` into the main context — parse the JSON/JSONL
(`sweep-summary.json`, `results.jsonl` aggregate rows first).

## Process
1. **Route** (table above) and **define the question** — what varies, what's fixed.
2. **(Optional)** research skill for external baselines.
3. **Run**; results land in `bench/runs/<stamp>-*/` (campaigns are resumable via `CAMPAIGN_DIR`).
4. **Analyze — ultrathink.** Don't stop at deltas (% prefill / % decode / % aggregate, noise-band
   ties, failures): hunt for **relations** (MTP × KV interaction, depth-scaling shape, where
   concurrency saturates, VRAM cliffs), **root causes**, and **consequences for practice** (which
   config for which workload; what the saved VRAM buys). Every causal claim carries a provenance
   tag: MEASURED correlation, INFERRED reasoning (spell the logic out), or CLAIMED. If a root
   cause can't be established from our data, **run the research skill** to find or validate it
   (known upstream issues, RDNA4/driver facts) instead of guessing; anomalies that survive stay
   in the doc marked **OPEN**, never papered over.
5. **Document** to the contract below; register via the `<!-- meta -->` block + `docs/reindex.py`.

## Output contract → `campaigns/<date>-<slug>/analysis.md`
The analysis is **co-located in the campaign dir** next to `spec.json` / `run.sh` / `README.md`
(one self-contained folder: plan → driver → write-up). Use the **same `<date>-<slug>` as the
campaign and the `bench/runs/` dir** (1:1 raw data ↔ report). A one-off measurement with no campaign
dir still writes `docs/analysis/YYYY-MM-DD-HHMM-<slug>.md` (reindex scans both locations).

```markdown
# Benchmark: <what was measured> — R9700 (gfx1201)

- **Date:** YYYY-MM-DD HH:MM · **Track:** model-bench sweep / engine-bench / campaign
- **GPU/Host:** <from meta.txt> · **Runtimes/builds:** <build_commit / Mesa / ROCm / image>
- **Models:** <model / quant> · **Data:** bench/runs/<stamp>-<slug>/

## Summary
<3–5 sentences: winning config, the deltas that mattered, one caveat.>

## Legend — every knob & label used in this run
<Copy the canonical rows below for every term that appears in this doc (drop unused ones, add
run-specific ones); tailor the "effect on this box" cell to what THIS run showed, with provenance.>
| Term | What it is | Effect on this box (R9700 / RDNA4, 32 GB) | How it's tested here |
|------|------------|-------------------------------------------|----------------------|

## Results (table first — pick the columns that apply; a memory column is MANDATORY)
| Config | build | ctx | depth | ub | b | fa | KV | MTP | conc | Prefill tok/s | Decode/stream | Aggregate tok/s | TTFT p50/p95 | ttfa | VRAM@load MiB | Peak VRAM MiB | Peak GTT MiB |
|--------|-------|----:|------:|---:|--:|:--:|:--:|:---:|-----:|--------------:|--------------:|----------------:|-------------:|-----:|--------------:|-------------:|------------:|
(all MEASURED; mark plateau ties; FAILED and SKIPPED rows stay in the table. Peak GTT must be ~0 —
a nonzero value means a host-RAM spill; call it out.)

## Max-context (if the run pinned a ceiling)
| KV | ctx | VRAM@load MiB | peak GTT MiB | fits? | measured KV MiB/tok (slope) | **calculated max ctx** @safe-budget / @physical |
(Fit `VRAM@load ≈ intercept + slope·ctx` from the rows that loaded; the intercept absorbs
weights+compute, the slope is KV/tok. Report the calculated ceiling at the guard's safe budget AND
at physical 32624 MiB — not just the a-priori formula. Guard-SKIPPED rows show predicted VRAM only.)

## KV decision (if the sweep ran)
| Depth | f16 pp/tg | q8_0 pp/tg | Δpp% | Δtg% | VRAM saved | Verdict (≤5% rule) |

## What moved the needle (deltas vs baseline)
| Change | Prefill Δ | Decode Δ | Aggregate Δ | Note |

## Consequences & root causes (ultrathink)
<Numbered findings. Each one: observation → explanation → consequence for practice ("therefore
use X for Y"). Tag every causal claim MEASURED / INFERRED / CLAIMED (with source via the research
skill). Interactions and anomalies belong here (MTP × KV, depth cliffs, saturation points);
unexplained ones stay listed as OPEN.>

## Recommended config
```
<exact llama-server / sweep.py command line — copy-pasteable, incl. MTP/KV flags>
```

## Methodology & caveats
<fixtures + real token counts, prefix mode, api, warm-up, reps, noise band, failures, throttling
(gpu_samples), what was held fixed.>

## External comparison (if any)
<CLAIMED numbers with sources — separate from MEASURED rows.>
```

## Charts — generate them, then EMBED them (don't just link)
A campaign that produces charts but never shows them is a half-written report. **Never hand-draw an
SVG or hand-write an appendix** — the tools own that (iron rule #6).

1. **Generate** (quality campaigns): `campaigns/2026-07-12-27b-finetune-quality/make_charts.py --dir out
   --charts charts [--order …] [--calibration …]` → cell-level SVGs + `charts/appendix.md`. Per-task views:
   the campaign's own `make_charts_detailed.py --dir out --charts charts/detailed` → `charts/detailed/`.
   Throughput runs: `bench/lib/report.py <run_dir>` → `report.html` instead. Wire the call into the
   campaign's `run_capture.sh` so charts regenerate with the data — a chart built from a stale
   `summary*.json` is a correctness bug, not a cosmetic one.
2. **Embed the decision-grade charts INLINE at the finding they support** — a chart belongs next to the
   claim it proves, not in a pile at the end. Use a bold caption + the embed + a short interpretive
   blockquote saying *what to read off it*:
   ```markdown
   **Config scorecard — quality · judge · full time · memory**

   ![Config scorecard](charts/scorecard.svg)

   > <what the chart shows, what it does NOT license, provenance tag>
   ```
   Paths are **campaign-root-relative** (`charts/x.svg`) — that is what the generated `appendix.md`
   already assumes. Typical map: scorecard → Summary · memory/power → Health · objective breakdown →
   the wall/capability finding · quality-vs-time + throughput + latency → the speed finding · judge →
   Judge verdicts · task heatmap → per-task results.
3. **Link the rest**, don't dump all of them: name the appendix-only SVGs and point at
   `charts/appendix.md` + `charts/detailed/appendix.md`. Roughly 10–15 inline is right for a long
   report; the reference shape is `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/analysis.md`.
4. **A caption must not out-claim the statistics.** If the doc says the configs are not resolvable
   (overlapping CIs), every bar-chart caption must say the bar order is **not a ranking** — charts are
   the easiest place to quietly reintroduce a ranking the data does not support. Same for
   non-depth-matched reference lines: state the caveat *at the chart*, not only in prose.
5. **Verify before committing**: every embedded path resolves from the campaign dir, no chart is stale
   (regenerate and diff — it must reproduce byte-identically), and the appendix-only list matches what
   is actually not embedded.

After writing: add a `<!-- meta` block (date + one-line takeaway) at the top of the report, then
run `docs/reindex.py` to regenerate `docs/INDEX.md` (it fails if the meta block is missing). Report
the path to the user.

## Canonical legend rows (copy into the doc's Legend, trim to what the run used)
Definitions are stable; the **effect column below is the generic starting point** — overwrite it
with what THIS run measured (tag it), keep the definition wording as-is.

| Term | What it is | Effect on this box (generic; replace with run-specific) | How it's tested here |
|------|------------|--------------------------------------------------------|----------------------|
| `-ub` (n_ubatch) | micro-batch: tokens per forward pass during prefill | bigger = better GPU occupancy until a VRAM/cache cliff; peak is interior, not "max it out" | sweep.py grid, expanded until the peak is bracketed both sides |
| `-b` (n_batch) | logical batch: max tokens per submission (≥ ub) | usually flat once ≥ ub (plateau within noise) | sweep.py second axis, after ub is fixed |
| `-fa` (flash attention) | fused attention kernel | on/off A/B; also **required for quantized KV** | sweep.py on/off pair at the winning ub/b |
| KV `f16` | 16-bit KV-cache entries — the baseline | reference quality & speed; biggest VRAM consumer at long ctx | baseline side of the KV A/B |
| KV `q8_0` | 8-bit block-quantized KV cache | ~halves KV VRAM (→ more ctx or slots); may cost decode speed | accepted only if pp AND tg lose ≤5% vs f16 at depth 32768 (sweep.py A/B) |
| MTP | multi-token prediction speculative decoding (`--spec-type draft-mtp`, draft layer embedded in the 35B GGUF) | speeds decode when draft acceptance is high; serving-only (invisible to llama-bench) | campaign.sh on/off axis on live servers |
| depth / `crN` | code-review workload prompt padded to N tokens (cr8000/cr32000/cr64000) from the tracked corpus | prefill grows ~linearly, decode sags as KV fills; 64K approaches the 32 GB ceiling | capture_engine probe vs a fresh server, `PREFIX_MODE=unique`, 256-tok decode sample |
| `thinking` | reasoning fixture via chat API (template applied) | reasoning burns tokens before the first answer token | `ttfa_s` = time to first answer token; null if the think budget ran out |
| `agentic-cN` | N parallel streams with distinct 8K prompts on `-np 4` slots | per-stream tok/s drops, aggregate usually rises; per-slot ctx = CTX/NP | capture_engine probe concurrency wave, REPS ≥ 2 |
| `pp` / `tg` | llama-bench prompt processing / text generation tok/s | synthetic upper bound — no prompts, no MTP, no concurrency | llama-bench, ≥ 3 reps, stddev recorded |
| TTFT p50/p95 | time to first token, median / 95th pct | p95 is the agent-facing latency number under load | per-request timing in capture_engine |
| per-stream vs aggregate | one stream's decode rate vs the sum of all streams | the gap quantifies the concurrency payoff | aggregate rows in results.jsonl |
| `prefix_mode` | `unique` = cold prompt cache, `shared` = warm | shared inflates prefill ~2.4× from request 2 (measured) | probe flag; `unique` is the default for honest numbers |
| `plateau_within_noise` | difference inside the ±3% run-variance band | a tie — never sold as a win | sweep.py noise gate |
| `Q4_K_M` (etc.) | GGUF weight quantization of the model itself | at 32 GB memory-bound long-ctx, Q4 is the optimum, not a compromise | fixed per run; recorded in meta.txt |
