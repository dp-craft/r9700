# Depth run — deterministic digest (`aggregate.py`)

_All numbers computed in Python from out/*.jsonl. The analysis LLM writes prose from THIS + charts/appendix.md — it does not read the per-reply jsonl._

## Per-cell aggregates

| cell | model | depth | kv | budget | n | TS % | worst | best | hard % | judge/5 | judge d·c·r | think tok | ttfa s | full s | decode t/s | peak VRAM | peak GTT | runaway % | fails |
|------|-------|-------|----|-------:|--:|-----:|------:|-----:|-------:|--------:|:-----------:|----------:|-------:|-------:|-----------:|----------:|---------:|----------:|------:|
| ornith-d128-f16-rb4096 | Ornith-1.0-35B-UD-Q4_K_M | 120k | f16 | 4096 | 15 | 62 | 31 | 97 | 7 | — | — | 3543 | 75.3 | 111.5 | 70.9 | 25400 | 815 | 0 | 0 |
| gemma-d128-q8-rb4096 | gemma-4-31B-it-qat-UD-Q4_K_XL | 120k | q8_0 | 4096 | 5 | 57 | 23 | 86 | 0 | — | — | 1357 | 351.6 | 484.7 | 11.6 | 27097 | 90 | 0 | 0 |

## Findings (computed, not inferred)

- **(c) The strict-code wall (fractional, mean across cells):** lint 0.23 · types 0.27 · tests 0.66 · edge 0.72 · reuse 1.00.
- **(d) Capability (hardest tasks):** best local cell = 62% TS. Reference: haiku 81% (Δ-19) · sonnet 91% (Δ-28) · opus 94% (Δ-32).
- **Health:** **GTT spill (>500 MiB) in: ornith-d128-f16-rb4096** — freeze risk, flag loudly

## Uncertainty — is the ladder resolvable? (READ BEFORE QUOTING ANY Δ)

| cell | n | TS % | sd | SE | 95% CI |
|---|--:|--:|--:|--:|:--:|
| ornith-d128-f16-rb4096 (f16) | 15 | 62.2 | 20.7 | 5.4 | [51.7, 72.7] |
| gemma-d128-q8-rb4096 (q8_0) | 5 | 56.6 | 27.1 | 12.1 | [32.9, 80.4] |

**Rep noise (MEASURED):** mean within-(cell,task) sd = **9.1 pts** → SE of a 3-rep mean ≈ **5.3 pts**. A single-task cell-vs-cell gap must exceed ~**21 pts** to beat rep noise alone.

## Fluctuation & rerun value (the mean hides both)

_`rep sd` = mean within-(cell,task) sd — how much the same cell swings on the same task; compare it ACROSS cells to see whether a setting **changed** the fluctuation. `best-of-R` takes the best rep per task, then averages over tasks; `Δ rerun` = best-of-R − mean = what re-rolling buys. `hard@1` = per-reply strict-clean rate; `hard@R` = share of TASKS where **any** rep is strictly clean — the toolchain (tsc/eslint/vitest) picks the winner, so this is a real strategy, not an oracle._

| cell | n | mean | worst | best | range | **rep sd** | best-of-R | **Δ rerun** | worst-of-R | hard@1 | **hard@R** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| ornith-d128-f16-rb4096 (f16) | 15 | 62.2 | 31 | 97 | 67 | **9.1** | 70.9 | **8.7** | 54.4 | 7% | **20%** |
| gemma-d128-q8-rb4096 (q8_0) | 5 | 56.6 | 23 | 86 | 63 | **—** | 56.6 | **0.0** | 56.6 | 0% | **0%** |

## Per-rep detail — every rep + haiku/sonnet/opus reference (nothing averaged away)

_Local cells show all REPS individually (full objective vector 0–1) then a **mean** row; references are one-shot. `— (no calib)` = reference point not yet collected (see README add-on D)._

> **TIER is a difficulty class, NOT a score band.** It names the weakest REFERENCE tier that produces a strictly-clean **hard_pass** — so a task can be `tier opus` while every model scores 60–90% on partial credit. Each header below prints the label next to the MEASURED hard-pass evidence; trust the evidence.
> **The references are NOT depth-matched:** they are one-shot on a ~550–620-token prompt, while local cells answer the same task at ~132.9k tokens (**~213× deeper**), and each reference is a single sample (n=1) vs the local n=3. Reference-vs-local Δ are therefore indicative only — do not quote them as a like-for-like capability gap.

### lru-cache · tier `sonnet` — measured weakest hard-pass: **sonnet** (haiku 83%✗0/3 · sonnet 96%✓1/3 · opus 93%✗0/3)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ornith-d128-f16-rb4096 (f16) | 0 | 76 | ✗ | 0.33 | 0.40 | 0.93 | 1.00 | 1.00 | 0.37 | 1.00 | 3444 | — |
| ornith-d128-f16-rb4096 (f16) | 1 | 40 | ✗ | 0.33 | 0.60 | 0.00 | 0.00 | 1.00 | 0.75 | 1.00 | 4095 | — |
| ornith-d128-f16-rb4096 (f16) | 2 | 39 | ✗ | 0.00 | 0.00 | 0.82 | 0.00 | 1.00 | 0.00 | 1.00 | 4095 | — |
| **ornith-d128-f16-rb4096 (f16) — mean** | – | **52** | 0% | 0.22 | 0.33 | 0.58 | 0.33 | 1.00 | 0.37 | 1.00 | | |
| gemma-d128-q8-rb4096 (q8_0) | 0 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.40 | 1.00 | 1961 | — |
| **gemma-d128-q8-rb4096 (q8_0) — mean** | – | **67** | 0% | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.40 | 1.00 | | |
| _haiku_ ref | 0 | 82 | ✗ | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.44 | 1.00 | | |
| _haiku_ ref | 1 | 85 | ✗ | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.78 | 1.00 | | |
| _haiku_ ref | 2 | 81 | ✗ | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.29 | 1.00 | | |
| _**haiku — mean**_ | – | **83** | 0% | 1.00 | 0.80 | 1.00 | 0.50 | 1.00 | 0.50 | 1.00 | | |
| _sonnet_ ref | 0 | 97 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.57 | 1.00 | | |
| _sonnet_ ref | 1 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| _sonnet_ ref | 2 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| _**sonnet — mean**_ | – | **96** | 33% | 1.00 | 0.87 | 1.00 | 1.00 | 1.00 | 0.74 | 1.00 | | |
| _opus_ ref | 0 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 91 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.92 | 1.00 | | |
| _**opus — mean**_ | – | **93** | 0% | 1.00 | 0.53 | 1.00 | 1.00 | 1.00 | 0.97 | 1.00 | | |

### rate-limiter · tier `sonnet` — measured weakest hard-pass: **sonnet** (haiku 90%✗0/3 · sonnet 97%✓1/3 · opus 97%✗0/3)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ornith-d128-f16-rb4096 (f16) | 0 | 31 | ✗ | 0.00 | 0.00 | 0.14 | 0.00 | 1.00 | 0.86 | 1.00 | 2602 | — |
| ornith-d128-f16-rb4096 (f16) | 1 | 45 | ✗ | 0.67 | 0.80 | 0.00 | 0.00 | 1.00 | 0.42 | 1.00 | 3487 | — |
| ornith-d128-f16-rb4096 (f16) | 2 | 42 | ✗ | 0.00 | 0.00 | 0.85 | 0.00 | 1.00 | 0.38 | 1.00 | 3587 | — |
| **ornith-d128-f16-rb4096 (f16) — mean** | – | **39** | 0% | 0.22 | 0.27 | 0.33 | 0.00 | 1.00 | 0.55 | 1.00 | | |
| gemma-d128-q8-rb4096 (q8_0) | 0 | 23 | ✗ | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.20 | 1.00 | 1048 | — |
| **gemma-d128-q8-rb4096 (q8_0) — mean** | – | **23** | 0% | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.20 | 1.00 | | |
| _haiku_ ref | 0 | 94 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _haiku_ ref | 1 | 90 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | 1.00 | 0.33 | 1.00 | | |
| _haiku_ ref | 2 | 86 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**haiku — mean**_ | – | **90** | 0% | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.78 | 1.00 | | |
| _sonnet_ ref | 0 | 93 | ✗ | 1.00 | 0.80 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _sonnet_ ref | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _sonnet_ ref | 2 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**sonnet — mean**_ | – | **97** | 33% | 1.00 | 0.87 | 0.93 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 0 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **97** | 0% | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |

### async-memo · tier `opus` — measured weakest hard-pass: **sonnet** (haiku 82%✗0/3 · sonnet 93%✓1/3 · opus 90%✗0/3)  ⚠ **LABEL CONTRADICTED BY DATA** (label says `opus`, measured weakest hard-pass = `sonnet`)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ornith-d128-f16-rb4096 (f16) | 0 | 97 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 0.67 | 1.00 | 1980 | — |
| ornith-d128-f16-rb4096 (f16) | 1 | 86 | ✗ | 0.67 | 0.80 | 0.86 | 1.00 | — | 0.86 | 1.00 | 4095 | — |
| ornith-d128-f16-rb4096 (f16) | 2 | 95 | ✗ | 1.00 | 1.00 | 0.80 | 1.00 | — | 1.00 | 1.00 | 4095 | — |
| **ornith-d128-f16-rb4096 (f16) — mean** | – | **93** | 33% | 0.89 | 0.93 | 0.89 | 1.00 | — | 0.84 | 1.00 | | |
| gemma-d128-q8-rb4096 (q8_0) | 0 | 86 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 0.75 | 1.00 | 1418 | — |
| **gemma-d128-q8-rb4096 (q8_0) — mean** | – | **86** | 0% | 0.67 | 0.60 | 1.00 | 1.00 | — | 0.75 | 1.00 | | |
| _haiku_ ref | 0 | 88 | ✗ | 1.00 | 0.80 | 0.67 | 1.00 | — | 1.00 | 1.00 | | |
| _haiku_ ref | 1 | 82 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 0.25 | 1.00 | | |
| _haiku_ ref | 2 | 77 | ✗ | 0.67 | 0.60 | 0.67 | 1.00 | — | 0.67 | 1.00 | | |
| _**haiku — mean**_ | – | **82** | 0% | 0.78 | 0.67 | 0.78 | 1.00 | — | 0.64 | 1.00 | | |
| _sonnet_ ref | 0 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 1 | 88 | ✗ | 0.67 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 2 | 91 | ✗ | 0.67 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _**sonnet — mean**_ | – | **93** | 33% | 0.78 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 0 | 93 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 93 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 83 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **90** | 0% | 1.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |

### expr-eval · tier `opus` — measured weakest hard-pass: **NONE (ceiling)** (haiku 65%✗0/3 · sonnet 81%✗0/3 · opus 93%✗0/3)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ornith-d128-f16-rb4096 (f16) | 0 | 57 | ✗ | 0.00 | 0.00 | 0.95 | 1.00 | — | 0.00 | 1.00 | 4095 | — |
| ornith-d128-f16-rb4096 (f16) | 1 | 64 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.67 | 1.00 | 4095 | — |
| ornith-d128-f16-rb4096 (f16) | 2 | 58 | ✗ | 0.00 | 0.00 | 0.96 | 1.00 | — | 0.04 | 1.00 | 4095 | — |
| **ornith-d128-f16-rb4096 (f16) — mean** | – | **60** | 0% | 0.00 | 0.00 | 0.97 | 1.00 | — | 0.24 | 1.00 | | |
| gemma-d128-q8-rb4096 (q8_0) | 0 | 33 | ✗ | 0.00 | 0.00 | 0.00 | 1.00 | — | 0.00 | 1.00 | 651 | — |
| **gemma-d128-q8-rb4096 (q8_0) — mean** | – | **33** | 0% | 0.00 | 0.00 | 0.00 | 1.00 | — | 0.00 | 1.00 | | |
| _haiku_ ref | 0 | 66 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 0.87 | 1.00 | | |
| _haiku_ ref | 1 | 67 | ✗ | 0.00 | 0.00 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _haiku_ ref | 2 | 62 | ✗ | 0.00 | 0.20 | 1.00 | 1.00 | — | 0.00 | 1.00 | | |
| _**haiku — mean**_ | – | **65** | 0% | 0.00 | 0.07 | 1.00 | 1.00 | — | 0.62 | 1.00 | | |
| _sonnet_ ref | 0 | 73 | ✗ | 0.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 1 | 90 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _sonnet_ ref | 2 | 78 | ✗ | 0.00 | 0.80 | 1.00 | 1.00 | — | 0.82 | 1.00 | | |
| _**sonnet — mean**_ | – | **81** | 0% | 0.33 | 0.53 | 1.00 | 1.00 | — | 0.94 | 1.00 | | |
| _opus_ ref | 0 | 90 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 93 | ✗ | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _opus_ ref | 2 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **93** | 0% | 1.00 | 0.60 | 1.00 | 1.00 | — | 1.00 | 1.00 | | |

### pricing-deferred · tier `opus` — measured weakest hard-pass: **sonnet** (haiku 85%✗0/3 · sonnet 86%✓1/3 · opus 98%✓1/3)  ⚠ **LABEL CONTRADICTED BY DATA** (label says `opus`, measured weakest hard-pass = `sonnet`)

| model (kv) | rep | TS % | hard | types | lint | tests | edge | reuse | bdd | novj | think | judge d·c·r |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ornith-d128-f16-rb4096 (f16) | 0 | 71 | ✗ | 0.33 | 0.00 | 0.95 | 1.00 | 1.00 | 0.48 | 1.00 | 4095 | — |
| ornith-d128-f16-rb4096 (f16) | 1 | 59 | ✗ | 0.33 | 0.40 | 0.60 | 0.50 | 1.00 | 0.53 | 1.00 | 4095 | — |
| ornith-d128-f16-rb4096 (f16) | 2 | 72 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.44 | 1.00 | 1184 | — |
| **ornith-d128-f16-rb4096 (f16) — mean** | – | **68** | 0% | 0.33 | 0.13 | 0.85 | 0.83 | 1.00 | 0.48 | 1.00 | | |
| gemma-d128-q8-rb4096 (q8_0) | 0 | 74 | ✗ | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.73 | 1.00 | 1707 | — |
| **gemma-d128-q8-rb4096 (q8_0) — mean** | – | **74** | 0% | 0.33 | 0.00 | 1.00 | 1.00 | 1.00 | 0.73 | 1.00 | | |
| _haiku_ ref | 0 | 82 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.54 | 1.00 | | |
| _haiku_ ref | 1 | 83 | ✗ | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.67 | 1.00 | | |
| _haiku_ ref | 2 | 89 | ✗ | 1.00 | 0.40 | 1.00 | 1.00 | 1.00 | 0.62 | 1.00 | | |
| _**haiku — mean**_ | – | **85** | 0% | 1.00 | 0.13 | 1.00 | 1.00 | 1.00 | 0.61 | 1.00 | | |
| _sonnet_ ref | 0 | 99 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.83 | 1.00 | | |
| _sonnet_ ref | 1 | 64 | ✗ | 0.67 | 0.40 | 0.00 | 1.00 | 1.00 | 0.85 | 1.00 | | |
| _sonnet_ ref | 2 | 96 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.87 | 1.00 | | |
| _**sonnet — mean**_ | – | **86** | 33% | 0.89 | 0.73 | 0.67 | 1.00 | 1.00 | 0.85 | 1.00 | | |
| _opus_ ref | 0 | 100 | ✓ | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _opus_ ref | 1 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 0.95 | 1.00 | | |
| _opus_ ref | 2 | 97 | ✗ | 1.00 | 0.80 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | | |
| _**opus — mean**_ | – | **98** | 33% | 1.00 | 0.87 | 1.00 | 1.00 | 1.00 | 0.98 | 1.00 | | |

