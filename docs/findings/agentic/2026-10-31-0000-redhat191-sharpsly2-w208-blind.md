<!-- meta
date: 2026-10-31 20:05
slug: redhat191-sharpsly2-w208-blind
title: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 + sharp-sly2 (k=1 reasoning replay) — W2-08 blind review (RUNBOOK step A), Cactus δ 0
takeaway: sharp-sly2 (keep-newest reasoning replay) did not complete step A — it hit the 3600 s cap still probing, 1.65x the keep-all wall (2182 s). It generated 1.4x more tokens (167,814 vs 120,001) and thought 1.9x more per step (563,748 chars, 2.5x per tool call). k=1 replay did not speed up a real agentic review: the model re-derived its reasoning instead of replaying it. No exact loops (0/60 blocks), but semantic circling is present. Not a blind-grade result (no review written — rule 18); sharp-sly2 is not a winner over keep-all on this workload.
campaign: campaigns/agentic/2026-10-31-0000-redhat191-sharpsly2-w208-blind
-->

# Benchmark: RedHat Qwen3.8-27B-MXFP4 on Sly 1.9.1 + sharp-sly2 (k=1) template — W2-08 blind review (RUNBOOK step A), Cactus δ 0 — R9700 (gfx1201)

- **Date:** 2026-10-31, 18:48–19:48 UTC · **Track:** agentic campaign (`gen_campaign.py` `kind: agentic` → `run.sh`, real
  `claude -p` session, fresh server + fresh worktree per arm)
- **GPU/Host:** Radeon AI PRO R9700 (gfx1201, 32,624 MiB), kernel 7.0.0-38-generic, `power1_cap` 210 W, dpm `manual`, profile `POWER_SAVING`
- **Engine:** `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (vLLM 0.32.0), profile `sly-redhat/redhat-mxfp4-dflash`
  (DFlash2 k = 7, KV fp8, `max_model_len` 262,000, `max_num_seqs` 1, gpu util 0.93), Cactus δ 0 (exact acceptance)
- **Template:** `sharp-sly2-chat_template.jinja` (sly2 keep-newest reasoning replay + sharp terseness block), header
  `qwen3.8-froggeric-v22.5-sly2+sharp`, sha256 `f76daf0a…`
- **Client:** Claude Code 2.1.312, `settings-redhat.json`, sampling temperature 1.0 / top_p 0.95 / top_k 20 / min_p 0 / presence 0
- **Model:** `RedHatAI/Qwen3.8-27B-MXFP4` (W4A8 MXFP4) · **Task:** dp-forge W2-08 brief, RUNBOOK step A (blind review), base `de110510`
- **Data:** `campaigns/agentic/2026-10-31-0000-redhat191-sharpsly2-w208-blind/` (arm `rep1/r191-sharpsly2-d0/`)

## Summary

The `sharp-sly2` arm — the one variable being tested against the keep-all `r191-sharp-d0` run — is the **k = 1** reasoning-replay
template: it keeps only the newest assistant turn's reasoning in the context and drops all earlier turns'. It was **not** faster, and
it did **not** finish. The run ran to the full 1-hour budget (the pre-set `cap_s: 3600`, rc = 137 SIGKILL) and was still probing
`tsc`/`eslint` when the cap killed it — it never read the Opus reference and never wrote the blind review (rule 18: an interrupted
run is not a result; the 2-way blind pass for this arm therefore has nothing to grade).

What it did measure: it took **1.65× the keep-all wall** (3,601 s vs 2,182 s), generated **1.4× more tokens** (167,814 vs 120,001)
and thought **1.9× more per step** (563,748 chars, 2.5× per tool call). The k = 1 model **re-derived** its reasoning instead of
replaying it — that is what the extra tokens and wall time are. The "2.3× context" savings of k = 1 replay did not show up as fewer
tokens: total processed tokens were *higher* (638,197 vs 433,202). No exact loops (0/60 thinking blocks on the 40-line detector), but a
cheap semantic pass (haiku) found circling (re-derivation) in 2–6 of the largest blocks. **Conclusion:** on this workload, k = 1 replay
does not beat keep-all — it is slower and did not complete. `sharp-sly2` is not a winner over keep-all (n = 1, single arm).

## Results (all MEASURED, `report.py` agentic; `results/appendix.md`)

Reference rows are the keep-all arms from the same δ-ladder campaign (same charts). `r191-sharpsly2-d0` is the k = 1 arm.

| Arm | Replay | Status | Wall s | Decode tok/s | Accept (MAL) | Gen tok | Prompt tok | Tool calls | Thinking chars | Think/call | Loops blk / tok | VRAM load / peak MiB | Peak GTT MiB | Blind weighted (max 38) |
|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `r191-sharpsly2-d0` | **k = 1** (newest) | **CAP: no review** | **3,601** | 54.0 | 0.313 (3.19) | **167,814** | **470,383** | 63 | **563,748** | **8,948** | 0 / 0 | 30,869 / 32,294 | 190 | — |
| `r191-sharp-d0` (keep-all) | all | done | 2,182 | 55.8 | 0.34 (3.38) | 120,001 | 313,201 | 81 | 291,269 | 3,596 | 0 / 0 | 31,046 / 32,285 | 217 | 21 |
| `r191-sharp-d03` (keep-all) | all | FAILED: no review | 514 | 84.2 | 0.55 (4.85) | 38,570 | 138,471 | 44 | 116,056 | 2,638 | 0 / 0 | 31,238 / 32,433 | 217 | — |
| `r191-sharp-d05` (keep-all) | all | done, looped | 5,337 | 92.0 | 0.675 (5.72) | 491,925 | 725,012 | 131 | 1,424,431 | 10,873 | 7 / 239,521 | 31,017 / 32,296 | 222 | 16 |

- **Wall** = first transcript event → the `stop_when` call (first read of the Opus review) or, for this arm, the pre-set `cap_s: 3600`
  (rc 137). This arm's 3,601 s is the cap, not a completion.
- **Decode** = median of the pure-decode 10 s windows of the vLLM logger. **Loops** = thinking blocks with a 40-line window (lines ≥
  20 chars) of which ≥ 80% were seen earlier in the same block (`report.py _loop_onset`). **Think/call** = thinking chars ÷ tool calls.
- **Accept** — both δ 0 arms are bit-exact; the 0.313 vs 0.34 (MAL 3.19 vs 3.38) difference is within run-to-run noise (INFERRED).
- **Memory:** peak GTT stays within ~60 MiB of this box's idle reading (~156 MiB at load), so no host-RAM spill. Peak VRAM 32,294 MiB
  is 330 MiB below physical 32,624 MiB. **Clocks:** mclk p50 875 MHz, 100% of samples below 1,000 MHz; power mean 137.3 W (max 262 W,
  an instantaneous spike above the 210 W cap — the cap bounds the mean, not the spike) (`gpu_samples.csv`).

**Speed and loop panels: one row per arm (MEASURED)**

![Agentic speed](../../../campaigns/agentic/2026-10-31-0000-redhat191-sharpsly2-w208-blind/results/charts/agentic_speed.svg)

> The k = 1 arm is the only row that did not finish: its step-A wall is the cap (3,601 s). Decode is comparable to keep-all (54.0 vs
> 55.8 tok/s), but it generated 1.4× the tokens, so the wall is longer. Read the wall, not the decode.

![Agentic loops](../../../campaigns/agentic/2026-10-31-0000-redhat191-sharpsly2-w208-blind/results/charts/agentic_loops.svg)

> No arm in this table has an exact 40-line loop in this pass. The k = 1 arm's longest thinking block is 0.0% repeated lines — the
> "circling" a semantic pass found (haiku) is re-derivation, not an exact repetition, so it does not trip the detector.

## Re-derivation under k = 1 (the replay effect)

`thinking_reuse.py` (window = session start → first read of the Opus reference; the model never reached it, so the window is the whole
run; lexical units = identifiers + word 5-grams). MEASURED:

| Unit | Units out | Visible | Novel | From newest thinking (kept by k = 1) | **Only in older thinking (dropped → re-derived)** |
|---|---:|---:|---:|---:|---:|
| Identifiers | 4,352 | 65.9% | 22.3% | 3.29% | **8.5%** (370 units) |
| Word 5-grams | 84,821 | 8.7% | 87.2% | 1.17% | **2.95%** |

- The k = 1 model **re-derived 8.5% of its identifiers** (370) — units that existed only in thinking ≥ 2 steps back, were not in any
  visible content, and (under k = 1) were **not** in its context. That is the cost of the keep-newest replay: it re-thinks what the
  keep-all arms simply replay.
- For comparison, the keep-all arms of the δ-ladder have `only older than k=1` of **3.4–6.7%** (units *available to them* in older
  thinking but dropped under k = 1); the other k = 1 run in the replay analysis (δ 0.5, 1745 doc) re-derived **3.6%**. This δ 0 k = 1
  arm re-derives more (8.5%) than either — a clean (δ 0) trajectory has no loop repetition to re-derive from, so it has to genuinely
  re-think.
- 1.4% of the re-derived identifiers reached a tool input or text (the findings that landed in the work), and 39.7% sat in an older
  block's last 20% (its conclusion) — so a written conclusion of the dropped turns would have captured most of them (the lever the
  1745 doc already proposes, plan P2).

## What moved the needle (vs keep-all `r191-sharp-d0`, both δ 0)

| Change | Wall Δ | Decode Δ | Gen tok Δ | Prompt tok Δ | Total tok Δ | Think/call Δ | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| keep-all → k = 1 (sharp-sly2) | **+65%** (1.65×) | −3% (tie) | **+40%** | +50% | **+47%** | **+149%** (2.5×) | **CAP: no review** |

The only variable changed is the replay rule (keep-all → keep-newest), both at Cactus δ 0. The k = 1 arm generated 1.4× more tokens and
thought 2.5× more per tool call. That is the whole story: the replay rule cost wall time because it made the model re-derive, not
replay.

## Consequences & root causes

1. **k = 1 replay does not speed up a real agentic review — it re-derives instead.** MEASURED: the k = 1 arm took 1.65× the wall
   (3,601 vs 2,182 s) and generated 1.4× the tokens (167,814 vs 120,001) at the same decode (54.0 vs 55.8 tok/s). The cause is
   INFERRED from the token split: it thought 2.5× more per tool call (8,948 vs 3,596 chars) and re-derived 8.5% of its identifiers
   (370 units) that were not in its context (MEASURED). Under keep-all those same units are replayed for free; under k = 1 the model
   re-thinks them, and the re-thinking is the extra tokens. → *Do not adopt keep-newest replay to save wall time on a long agentic
   review; it saves context on paper and spends it back as re-derivation.*

2. **The "2.3× context" savings did not show up as fewer tokens.** MEASURED: total processed tokens were *higher* for k = 1 (638,197 =
   167,814 gen + 470,383 prompt) than for keep-all (433,202 = 120,001 + 313,201). The k = 1 template drops the model's earlier
   reasoning from the prompt, but the model re-derives and re-checks (its last tool calls were three back-to-back `eslint`/`tsc`
   probes), so the prompt and generation both grew. → *A replay rule that removes context from a model that re-derives does not reduce
   total tokens; it shifts them from input to output.*

3. **It did not finish in 1 hour.** MEASURED: status `cap` at 3,601 s (rc 137), still probing. The keep-all arm finished in 2,182 s; a
   k = 1 arm that needs 1.4× the tokens at the same decode would need ~1.65× the wall, i.e. past the 1-hour cap. A longer cap (e.g.
   4,500 s) would confirm whether it completes, but the direction (slower, more tokens) is already clear. → *If k = 1 is to be
   retested, give it ≥ 4,500 s and accept it is not a speed win.*

4. **No exact loops, but circling is present.** MEASURED: 0/60 thinking blocks trip the 40-line loop detector; a semantic haiku pass
   flagged circling (20–35% repeated content) in 2–6 of the largest blocks (e.g. blocks 041, 047, 050, 051, 053, 055) and ~10
   cross-block re-derivations of the same finding. This is the k = 1 re-derivation showing up as semantic repetition, not an exact loop
   the detector catches. → *The loop guard (levers doc P4) is aimed at the δ 0.5 exact loops; the k = 1 circling is a different,
   milder failure and does not need a hard stop.*

5. **Memory is not the limit.** MEASURED: peak VRAM 32,294 MiB (330 MiB below physical), peak GTT within ~60 MiB of idle. None of the
   outcome above is a spill artefact.

6. **The blind step never happened.** MEASURED: no `W2-08.refine-27b.md` and no probe directory of the review at the cap; the
   `stop_when` (first read of the Opus reference) never fired. Under rule 18 this is a quarantined run: it is not a grade, and it must
   not be read as a quality row. The 2-way blind pass (this arm vs the keep-all anchor) was built (`blind-grading-4way/`) but has no
   review to grade on this side. → *The sharp-vs-sly2 quality question (L7 in the levers doc) is still open; this run only answers the
   speed side.*

## Recommended config

```
# No change: keep-all (sharp) at Cactus δ 0 remains the best-measured single arm for this workload.
# sharp-sly2 (k=1) is not a winner over keep-all (slower, did not complete). Do not adopt it.
PROFILE=sly-redhat/redhat-mxfp4-dflash CACTUS_DELTA=0 PORT=8000 stack/serve/vllm/serve_vllm.sh start
#   image ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1, KV fp8, max_model_len 262000, max_num_seqs 1, gpu util 0.93
#   template: sharp-chat_template.jinja (keep-all) — NOT sharp-sly2-chat_template.jinja
```

## Methodology & caveats

- **n = 1, single arm.** The arm is `sharp-sly2` (k = 1) only; the keep-all reference row is the existing `r191-sharp-d0` run (same
  δ 0, same engine, same base). One variable (replay rule) at a time.
- **The run did not complete** (cap, rc 137). Under iron rule 18 an interrupted run is not a result: no review was written, so there is
  no blind grade and the arm must not be read as a quality row. The wall-time and token measurements are still valid (they are the run
  itself), and the loop/re-derivation measurements are valid (the transcript is complete up to the cap).
- **Loop detector vs semantic pass:** the 40-line detector reports 0 loop blocks; the semantic haiku pass found circling. They are
  different measures (exact repetition vs re-derivation) and are not contradictory.
- **Accept rate** for the two δ 0 arms differs by 0.03 (MAL 3.19 vs 3.38) — within run-to-run noise for exact acceptance; not a signal.
- **The power max (262 W) exceeds the 210 W cap** because the cap bounds the mean, not the instantaneous spike; the mean (137.3 W) is
  well under the cap.
- The `thinking_reuse.py` window runs to the cap (the model never reached the Opus reference), so the "re-derived" figure is for the
  whole run, not a step-A-only window; the other arms' figures are step-A-only.
