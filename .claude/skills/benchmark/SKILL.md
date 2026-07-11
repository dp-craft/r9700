---
name: benchmark
description: Run a benchmark on the R9700 (RDNA4) box AND document it to a fixed, reproducible spec — every run's full parameterization and measured numbers captured, nothing lost. Routes between two tracks: model-bench (llama-bench tuning; sweep.py adaptive optimum search with the KV ≤5% rule) and engine-bench (cross-engine + serving combos: MTP × KV × context depth × concurrency via campaign.sh). Use when the user wants to measure a runtime/model/tuning config, compare backends/engines, find an optimum, test parallel/agentic throughput, or turn a bench/runs/ result into a report. Produces canonical run data plus an English analysis doc in docs/analysis/ (summary + table first). May pull external context via the research skill.
---

# benchmark — measure, then document (nothing lost)

The measured counterpart to the research skill. **Every configuration tested becomes a data row AND
a documented line in the report.** Output language: **English**. Deterministic shape every time.
Full how-to for a human: `docs/RUNBOOK.md`. Standard campaign: `docs/campaigns/2026-07-11-starter-baseline/`.

## Route first — which track?
| If the goal is… | Tool | Dir |
|-----------------|------|-----|
| THE tuning optimum for one engine (peak bracketed both sides + KV f16/q8_0 ≤5% verdict) | **`sweep.py`** | `bench/model-bench/` |
| Quick manual knob check (fixed grid, one invocation) | `run.sh` | `bench/model-bench/` |
| Real-workload cross-engine / thinking / **concurrency** numbers against running servers | `run.sh` (openai_probe) | `bench/engine-bench/` |
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
   go in the report as FAILED — an OOM at f16 that fits at q8_0 is a finding, not a gap.

## Token policy
Running is shell work — do it directly. For interpreting large logs or pulling external comparison
numbers, fan out to **haiku** subagents (return digests only). Never read `bench/llamacpp*/`
binaries or `*.err`/`*.log` into the main context — parse the JSON/JSONL
(`sweep-summary.json`, `results.jsonl` aggregate rows first).

## Process
1. **Route** (table above) and **define the question** — what varies, what's fixed.
2. **(Optional)** research skill for external baselines.
3. **Run**; results land in `bench/runs/<stamp>-*/` (campaigns are resumable via `CAMPAIGN_DIR`).
4. **Analyze** — deltas vs baseline (% prefill / % decode / % aggregate), what moved the needle,
   noise-band ties, failures.
5. **Document** to the contract below; register in `docs/INDEX.md`.

## Output contract → `docs/analysis/YYYY-MM-DD-HHMM-<slug>.md`
Name the doc with the **same stamp+slug as the `bench/runs/` dir** (1:1 raw data ↔ report).

```markdown
# Benchmark: <what was measured> — R9700 (gfx1201)

- **Date:** YYYY-MM-DD HH:MM · **Track:** model-bench sweep / engine-bench / campaign
- **GPU/Host:** <from meta.txt> · **Runtimes/builds:** <build_commit / Mesa / ROCm / image>
- **Models:** <model / quant> · **Data:** bench/runs/<stamp>-<slug>/

## Summary
<3–5 sentences: winning config, the deltas that mattered, one caveat.>

## Results (table first — pick the columns that apply)
| Config | build | ctx | depth | ub | b | fa | KV | MTP | conc | Prefill tok/s | Decode/stream | Aggregate tok/s | TTFT p50/p95 | ttfa | VRAM peak |
|--------|-------|----:|------:|---:|--:|:--:|:--:|:---:|-----:|--------------:|--------------:|----------------:|-------------:|-----:|----------:|
(all MEASURED; mark plateau ties; FAILED rows stay in the table)

## KV decision (if the sweep ran)
| Depth | f16 pp/tg | q8_0 pp/tg | Δpp% | Δtg% | VRAM saved | Verdict (≤5% rule) |

## What moved the needle (deltas vs baseline)
| Change | Prefill Δ | Decode Δ | Aggregate Δ | Note |

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

After writing: append a one-line entry to `docs/INDEX.md` and report the path to the user.
