## 3. Measurements

### 3.1 Workload A — phase-1, every arm

| Arm | Sample | Runner | Green | Attempts | Tool calls | Token cost (unit differs) | Wall | Tests shipped |
|---|---|---|---|---|---|---|---|---|
| **BASE** (Opus, production) | 1 | arm B | **9/9** | n/a | n/a | 776 k subagent (588 k impl + 188 k gates) | 1451 s (1019 impl + 432 gates) | **24 cases** / 3 files |
| **SIM** (Sonnet, runner payload) | 1 | arm B | **9/9** | n/a | n/a | 822 k subagent | 1382 s | 0 |
| Brian6145/27B-…-Q4_K_M | 1 | **arm A** | **9/9** | 9 | 101 | 2 001 111 in · 16 245 gen | 1555 s | 0 |
| Brian6145/27B-…-Q4_K_M | 2 | arm B | **9/9** | 9 | 113 | 1 632 911 in · 20 745 gen | 1549 s | 0 |
| Brian6145/27B-…-Q4_K_M | 3 | arm B | **9/9** | 11 | n/a | 2 029 009 in · 21 346 gen | 1830 s | 0 |
| unsloth/27B-Q4_K_M | 1 | arm B | **9/9** | 10 | n/a | 2 248 736 in · 20 217 gen | 1681 s | 0 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 1 | arm B | **7/9** | 14 | n/a | 4 817 037 in · 107 241 gen | 2059 s | 0 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 2 | arm B | **9/9** | 9 | n/a | 3 411 151 in · 29 312 gen | 1371 s | 0 |
| unsloth/35B-A3B-UD-Q5_K_M | 1 | arm B | **8/9** | 11 | n/a | 3 770 117 in · 67 638 gen | 1791 s | 0 |
| unsloth/35B-A3B-UD-Q5_K_M | 2 | arm B | **9/9** | 11 | 165 | 2 246 265 in · 41 630 gen | 1405 s | 0 |
| unsloth/35B-A3B-UD-Q4_K_M | 1 | arm B | **7/9** | 16 | 357 | 6 782 581 in · 181 545 gen | 3072 s | 0 |
| unsloth/35B-A3B-UD-Q4_K_M | 2 | arm B | **9/9** | 10 | 163 | 2 523 283 in · 39 801 gen | 1361 s | 0 |
| ThinkingCap-27B-Q6_K_L · **q8_0** | 1 | arm B | **9/9** | **9** | n/a | 1 144 471 in · 17 406 gen | **1456 s** | 0 |
| ThinkingCap-27B-Q6_K_L · **q8_0** | 2 | arm B | **9/9** | 11 | n/a | 1 198 756 in · 16 027 gen | 1554 s | 0 |
| ThinkingCap-27B-Q6_K_L · **q8_0** | 3 | arm B | 8/8 ⁵ | 9 ⁵ | n/a | 889 544 in · 9 965 gen ⁵ | 1340 s ⁵ | 0 |
| ThinkingCap-27B-Q6_K_L · **f16** | 1 | arm B | **9/9** | 10 | n/a | 920 834 in · 12 715 gen | 3754 s | 0 |
| ThinkingCap-27B-Q6_K_L · **f16** | 2 | arm B | **9/9** | 10 | n/a | 1 008 583 in · 13 550 gen | 4197 s | 0 |

⁵ Sample 3's T022 yields **no metric** and is excluded from every figure in its row: the benchmark's own thermal watchdog (95 °C junction threshold) stopped `llama-server` mid-attempt, so the task died with `failureClass: connectivity`, 0 tokens, `ECONNREFUSED 127.0.0.1:8097`. Per the rules of evidence a crashed tool is not a red. The threshold was wrong, not the run — this workload reaches 97 °C at 194–215 W against a hardware `crit` of 110 °C; the guard was raised to 105 °C afterwards.

Tool-call totals are missing where the worktree was cleaned up before the per-task JSON was harvested — a collection gap, not a measurement failure. Only local arms have attempts/tool-call telemetry; only BASE was required to produce tests.

### 3.2 Workload B — T010 (local models only)

| Model | Block | Runner | True green | Attempts (mean · range) | Wall mean · σ · CV | Per-iteration wall | Tool calls | chars/s |
|---|---|---|---|---|---|---|---|---|
| Brian6145/27B-…-Q4_K_M | 1 | **arm A** | **3/3** | 2.33 · 1–4 | 542.1 s · 163.5 · 30 % | 363.0 / 505.0 / 758.2 | 254 | 6.84 |
| Brian6145/27B-…-Q4_K_M | 1 | arm B | **3/3** | 1.33 · 1–2 | 318.3 s · 118.3 · 37 % | 224.3 / 485.2 / 245.3 | 131 | 8.62 |
| Brian6145/27B-…-Q4_K_M | 2 | arm B | **2/3** | 2.67 · 1–4 | 566.5 s · 222.8 · 39 % | 252.7 / 699.4 / 747.5✗ | 292 | 4.89 |
| unsloth/27B-Q4_K_M | 1 | arm B | **3/3** | 2.00 · 2–2 | 365.8 s · 71.6 · 20 % | 275.2 / 371.7 / 450.5 | 183 | 9.79 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 1 | arm B | **3/3** | 1.33 · 1–2 | 213.4 s · 47.8 · 22 % | 182.3 / 176.9 / 281.0 | 123 | 10.97 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 2 | arm B | **3/3** | 1.33 · 1–2 | 237.1 s · 79.3 · 33 % | 185.0 / 349.2 / 177.1 | 150 | 10.22 |
| unsloth/35B-A3B-UD-Q5_K_M | 1 | arm B | **3/3** | 2.00 · 1–3 | 281.2 s · 80.7 · 29 % | 395.2 / 227.4 / 220.9 | 183 | 8.96 |
| unsloth/35B-A3B-UD-Q5_K_M | 2 | arm B | **3/3** | 1.00 · 1–1 | 201.7 s · 36.0 · 18 % | 157.8 / 201.2 / 246.1 | 115 | 9.53 |
| unsloth/35B-A3B-UD-Q4_K_M | 1 | arm B | **3/3** | 2.00 · 2–2 | 257.5 s · 5.8 · **2.3 %** | 260.6 / 249.4 / 262.5 | 209 | **14.35** |

✗ = `local-exhausted`, +0/−0 lines — the file was never changed, so the triple verification failed on "Changed: NO". Zero false greens in all 29 iterations.

### 3.3 Serving-level throughput — MTP, prefill, decode

Extracted from the per-run `llama-server` logs. **All five local models ran with MTP speculative decoding active** (`--spec-type draft-mtp`), and all show healthy draft acceptance — none silently fell back to plain decoding.

| Model | Prefill (median) | Decode (median) | Draft acceptance (mean) | Mean draft length |
|---|---|---|---|---|
| Brian6145/27B-…-Q4_K_M | 558 t/s | **68.7 t/s** | 0.852 | 3.56 |
| mradermacher/27B-A3B-Coder-Q5_K_M | 1605 t/s | 155.7 t/s | 0.826 | 3.48 |
| unsloth/35B-A3B-UD-Q5_K_M | 1366–1465 t/s | 149.3–154.1 t/s | 0.787–0.834 | 3.36–3.50 |
| unsloth/35B-A3B-UD-Q4_K_M | 1909–1928 t/s | 151.1–151.8 t/s | 0.766–0.785 | 3.30–3.35 |
| unsloth/27B-Q4_K_M | not captured | not captured | not captured | — |

**The campaign's cleanest structural result.** The dense build decodes at **68.7 t/s** while every A3B (3B-active MoE) build decodes at ~150 t/s — a **2.2× gap** — and its prefill is 2.5–3.5× slower. The MoE builds are hardware-cheaper per token by a wide margin. That they do *not* dominate the wall-clock results is the whole story: they spend the advantage on emitting far more tokens. `unsloth/27B-Q4_K_M` has no serving metrics — its worktree was removed before the logs were preserved. Not re-run (deliberate).

### 3.4 Variance — two layers, and the second is bigger

**Layer 1 — within a block** (3 iterations, one loaded server): CV ranges from 2.3 % to 39 % (§3.2). On its own this would suggest some models are far more predictable than others.

**Layer 2 — between blocks / between samples** of the same model on the same runner. This layer was not measured before this campaign, and it dominates:

| Model | T010 block 1 | T010 block 2 | Between-block shift |
|---|---|---|---|
| Brian6145/27B-…-Q4_K_M (arm B) | 3/3 · 318.3 s | **2/3** · 566.5 s | **+78 %**, and reliability dropped |
| mradermacher/27B-A3B-Coder-Q5_K_M | 3/3 · 213.4 s | 3/3 · 237.1 s | **+11 %** |
| unsloth/35B-A3B-UD-Q5_K_M | 3/3 · 281.2 s | 3/3 · 201.7 s | −28 % |

| Model | Phase-1 green | Generated tokens | Wall |
|---|---|---|---|
| Brian6145/27B-…-Q4_K_M (arm B, s2→s3) | 9/9 → 9/9 | 20 745 → 21 346 (+3 %) | 1549 → 1830 s (+18 %) |
| mradermacher/27B-A3B-Coder-Q5_K_M | **7/9 → 9/9** | 107 241 → 29 312 (**−73 %**) | 2059 → 1371 s (−33 %) |
| unsloth/35B-A3B-UD-Q5_K_M | **8/9 → 9/9** | 67 638 → 41 630 (−38 %) | 1791 → 1405 s (−22 %) |
| unsloth/35B-A3B-UD-Q4_K_M | **7/9 → 9/9** | 181 545 → 39 801 (**−78 %**) | 3072 → 1361 s (−56 %) |
| ThinkingCap-27B-Q6_K_L · q8_0 (s1→s2) | 9/9 → 9/9 | 17 406 → 16 027 (−8 %) | 1456 → 1554 s (+7 %) |

**ThinkingCap is the first arm whose sample-to-sample spread is small.** ±8 % on generated tokens and ±7 % on wall, against −38 % to −78 % token swings for every MoE arm. Its instability sits elsewhere entirely — not in cost, but in *whether the `hu.ts` regression fires* (4 of 5 samples). Cost predictability and behavioural predictability are independent properties, and this arm has the first without the second.

**Consequence.** A single block's tight σ does not mean the model is predictable — `unsloth/35B-A3B-UD-Q4_K_M` produced the campaign's tightest T010 block (CV 2.3 %) *and* its worst phase-1 sample (181 545 generated tokens, 4.6× its own second sample). Any ranking built on one block or one sample is unsafe, in either direction.

### 3.5 The harness change: arm A vs arm B

`Brian6145/27B-…-Q4_K_M` is the only model measured on both. All T010 iterations pooled:

| | Arm A (`d7532e4f`) | Arm B (`8d2c3a00`) |
|---|---|---|
| T010 iterations | 5 | 6 |
| True-green | **5/5** | **5/6** |
| Wall, green runs only | 483.5 s · σ 197.9 | 381.4 s · σ 207.2 |
| Phase-1 samples | 1 × 9/9 | 2 × 9/9 |

Difference in wall = 102.1 s, standard error 128.1 s, **t = 0.80** — not distinguishable. Resolving a gap this size at 80 % power would take **~61 iterations per arm** (~10 h GPU each). Re-running arm A for precision is not worth it; **pinning `RUNNER_SEED` and running a paired comparison** answers the same question at a fraction of the cost, and that capability is exactly what `b282b32d` added.

**One signal deserves a follow-up.** Deep retries are rare — only 2 of 11 T010 iterations reached ≥3 attempts — and the two arms split on them:

| Arm | Deep-retry case | Outcome |
|---|---|---|
| Arm A | 4 attempts, 758.2 s | **converged to true-green** |
| Arm B | 4 attempts, 747.5 s | **`local-exhausted`, +0/−0 lines** |

In arm A the deleted sampling ladder raised temperature 0.6 → 0.8 from attempt 3; in arm B every attempt stays at 0.6 with only a seed offset for diversity. The campaign's single failed T010 iteration is arm B's deep-retry case. This is n=1 vs n=1 — **not evidence of regression** — but it is the first data of any kind touching `1dc121f8`, with a plausible mechanism: temperature escalation may supply escape diversity at depth that seed variation does not. Resolving it needs a workload that reliably reaches attempt ≥3, not more random sampling.

### 3.6 Where the work actually goes — failure and cost concentration

Across **90 phase-1 task-runs** (local arms), there were 5 failures, and they are not spread across the 9 tasks:

| Task | Failures | Shape |
|---|---|---|
| **T031** | **3** | `failed`, `gate-fail`, **0-byte patch** — the run consumed 663 k–1 217 k input tokens and produced no edit at all |
| **T022** | **2** | `local-exhausted` — 5 attempts (Coder-Q5) and **7 attempts** (UD-Q4), 57 k and 147 k generated tokens |
| T001, T002, T003, T004, T014, T021, T030 | **0** | — |

Two tasks account for 100 % of the failures. The cost concentration is even sharper — the worst single task-run in the campaign:

| `unsloth/35B-A3B-UD-Q4_K_M` sample 1, task T022 | Value | Share of that whole 9-task sample |
|---|---|---|
| Attempts | 7 | — |
| Input tokens | 4 335 421 | **64 %** |
| Generated tokens | 147 538 | **81 %** |
| Wall | 1600 s | **52 %** |
| Result | `local-exhausted` at the `lint` stage | wasted |

One task out of nine consumed over half the wall-clock and four fifths of the generated tokens, and produced nothing. The same model's second sample solved T022 in **1 attempt**. Successful T022 patches range from 1 880 to **12 323 bytes** — a 6.5× spread in solution size for one statement.

---

