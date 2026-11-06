## Summary

The Q4_K_XL arm did not think less per decision. Every arm spends 3.0-3.6k thinking characters per tool call, including the old
template run. What differs is how many steps the agent takes:
- **Steps:** Q4 70, RedHat 1.9.1 80, RedHat 1.8.1 100, old template 155.
- **Distinct files read:** 15, 18, 25 and 26.

Step count is a trajectory property with large run-to-run variance. The two RedHat δ 0 + sharp runs have an identical sampling
distribution and still differ by 20% in steps and 39% in messages. So the Q4 gap cannot be pinned on the weights, the engine or the
KV dtype at n = 1. The literature also says 4-bit weights do not lengthen reasoning (T1).

The more useful discovery is that **every run auto-compacted at 136-143k tokens**. Our Claude Code window is 180000 at 85%, while the
servers accept 260-262k. Each compaction costs 3-7 minutes and throws away 109-122k tokens of working context.

That points to three levers that serve both goals:
1. move the compaction window;
2. spend the speed headroom on a second, independent review and merge the two (union coverage +2…+5 weighted points);
3. close three blind spots that no configuration has ever found, in the review protocol.

δ 0.3 is +51% decode, but its only run skipped the blind step. Its 15.8% "loop signal" turned out to be repeated `import` lines,
not a loop (corrected 17:45, see [the replay / Cactus analysis](2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md)).

## Methodology & caveats

- **n = 1 per arm.** All per-arm differences are single trajectories. The only within-config pair (RedHat 1.8.1 vs 1.9.1 + sharp δ 0)
  is the noise estimate quoted above.
- **Blind grades:**
  - Q4, RedHat 1.8.1 ± sharp and heretic were graded in one four-way pass; 1.9.1 δ 0 in a two-way pass with RedHat 1.8.1 + sharp as
    the anchor.
  - The anchor scored 22 with the identical finding set both times (test-retest).
  - Union scores assume a perfect merger (INFERRED).
- **Measurement details:**
  - Thinking is counted in characters. Both engines run the same tokenizer family, so the arms are comparable; tokens were not
    counted per block.
  - Tool-call categories use a first-match regex on the Bash command (`thinking_digest.py`).
  - "Re-read" means the same path read again, so a different line slice of the same file counts.
- **Compaction formula:** the 0.85 × (W − 20000) fit is INFERRED from four runs. The documented semantics (window sets the base,
  percentage can only lower the trigger) are CLAIMED T1.
- **Rule-6 note:**
  - `thinking_digest.py` is a one-off analysis script stored with its output in
    `bench/runs/2026-10-31-agentic-thinking-volume/`.
  - The reusable parts (thinking per tool call, compaction count and seconds, distinct files read) belong in `bench/lib/report.py`'s
    agentic kind. That extension is proposed, not done.
- The δ 0.5 arm is done: +65% decode, 2.4× wall, 49% of tokens in 7 loops (one hit the 64k cap), 16/38 blind grade (−5 at the Δ ≥ 5 threshold) —
  see `campaigns/2026-10-31-redhat191-sharp-w208-blind/analysis.md`.
- The `sharp-sly2` (k = 1) replay arm is done: 1.65× keep-all wall, 1.4× tokens, 2.5× thinking/tool call, 0 exact loops, no review written
  (hit the 1 h cap — quarantined, rule 18); keep-all (sharp) remains the best single arm — see
  `campaigns/2026-10-31-redhat191-sharpsly2-w208-blind/analysis.md`.

## Legend

| Term | What it is | Effect here | How measured |
|---|---|---|---|
| step | one tool call by the agent | 43-155 per step A; the main driver of total thinking and wall time | `tool_use` blocks before the blind boundary |
| thinking / tool call | thinking characters ÷ tool calls | **flat at 3.0-3.6k across arms** | transcript `thinking` blocks |
| auto-compaction | Claude Code summarizes the history when context passes its threshold | 136-143k trigger; −109…−122k tokens; 179-437 s each | `compact_boundary` records (`preTokens`, `postTokens`, `durationMs`) |
| sharp template | froggeric v22.5 + a terseness directive | cut steps 155 → 100 (same server) without changing thinking per step | the 2026-10-31 RedHat+sharp campaign |
| Cactus δ | relaxed speculative acceptance (0 = exact) | δ 0.3: decode +51%, acceptance 0.34 → 0.55 | `RADIANCE_CACTUS_DELTA`, verified in the container env |
| Opus weighted | blind-graded coverage of the 19 Opus findings, high 3 / med 2 / low 1, max 38 | 20-23 for all non-heretic arms; **dp-sharp 16 (authoritative Opus grade 2026-11-02, prompt-only; precision 11/12)**; Δ ≥ 5 pre-registered as significant | one Opus grader per pass; anchor re-graded 22 → 22 |

## Results — per-step thinking, exploration, compaction (MEASURED)

Window: session start → first tool call that **reads** the Opus reference (the blind boundary; `ls`/`test`/`wc` do not count).
Source: `thinking_digest.jsonl`. "Thinking" = characters in `thinking` blocks. Opus weighted = blind grade, max 38.

| Arm | Steps (tool calls) | Asst. msgs | Thinking chars | **Thinking / tool call** | Thinking p50 / p90 / max per msg | Top-10% msgs' share | Distinct files read | Re-reads after a compaction | Auto-compactions (s each) | Window s | Compaction % of window | Opus weighted |
|---|---:|---:|---:|---:|---|---:|---:|---:|---|---:|---:|---:|
| Q4_K_XL + sharp | **70** | 65 | 241,694 | **3,453** | 719 / 11,966 / 64,038 | 62% | **15** | 2 | 1 (437) | 3,789 | 11.5% | **23** |
| RedHat 1.9.1 + sharp δ 0 | 80 | 62 | 291,269 | **3,641** | 794 / 13,539 / 53,700 | 50% | 18 | 3 | 1 (327) | 2,181 | 15.0% | 21 |
| RedHat 1.9.1 + dp-sharp V1 δ 0 | 73 | 54 | 226,522 | **3,103** | 901 / 8,858 / 43,229 | 70% | 17 | 0 | 0 | 1,242 | 0% | **16\*** |
| RedHat 1.9.1 + dp-sharp V2 δ 0 | 125 | 276 | 387,609 | 3,101 | — | — | — | — | — | 2,384 | 0% | **~26\*\*** |
| RedHat 1.8.1 + sharp δ 0 | 100 | 101 | 304,314 | **3,043** | 596 / 7,387 / 58,253 | 60% | 25 | 3 | 2 (344, 270) | 2,820 | 21.8% | 22 |
| RedHat 1.8.1 old template δ 0 | 155 | 143 | 488,931 | **3,154** | 1,156 / 6,964 / 56,605 | 58% | 26 | 7 | 2 (179, 219) | 3,867 | 10.3% | 20 |
| RedHat 1.9.1 + sharp δ 0.3 | 43 | 32 | 116,056 | 2,699 | 1,577 / 8,350 / 26,874 | 50% | 15 | 0 | 0 | 514 | 0% | **FAILED — no blind review** |

\* **dp-sharp V1** (added 2026-11-01, campaign `2026-11-01-redhat191-dp-sharp-w208-blind`; Opus grade 2026-11-02): the official sharp keep-all template with the dp terse prompt (V1), the one variable vs `RedHat 1.9.1 + sharp δ 0` (keep-all replay + δ 0 held fixed). Its **Opus weighted (16) is the authoritative Opus grade** (prompt-only, no tools — `grading-opus.md`): 8/19 reference findings (high 3/6, med 2/7, low 3/6), precision **11/12** (7 matched + 4 real review-only, 0 wrong, 1 unverifiable; 1 false claim inside finding W7). This run was on a **throttled GPU** (mclk 1,258 MHz, power mean 203 W vs the arms above at 875 MHz / ~137 W), so its **Window (1,242 s)** and the speed table's clock/power are **not comparable** to the other rows; the transcript-derived columns (tool calls, thinking chars, distinct files read, compactions) and the review content are. It **completed** step A (wrote the review), unlike `sharp δ 0.3` above.

\*\* **dp-sharp V2** (rep2, 2026-11-02): same arm with an updated terse prompt (V2: explicit step-by-step mechanics tracing, boundary/failure-case simulation, end-to-end continuity, "never stop at surface/structural checks"). **Preliminary** mapping (pending authoritative Opus grade via `opus-grade-prompt-rep2.md`): **11/19** reference findings (high 4/6, med 3/7, low 4/6), weighted **~26/38**. Recovered #2 (walk duplication, high) and #8 (empty-line→schema, med) that V1 missed; kept all of V1's matches. Still missed #1 (confirm-chain), #4 (T3 source-vs-`@tmp`) — the two remaining highs are cross-contract data-flow defects. 19 findings total (vs V1's 12). Wall 2,384 s (~1.9× V1) on the same throttled GPU.

Tool-call mix (MEASURED). `search` = grep/rg/find/ls · `read` = cat/sed/head/tail/wc + Read · `probe` = tsc/eslint/vitest/npx/node:

| Arm | search | read | probe | write/edit |
|---|---:|---:|---:|---:|
| Q4_K_XL + sharp | 28 | 17 | 18 | 5 |
| RedHat 1.9.1 + sharp δ 0 | 27 | 24 | 16 | 11 |
| RedHat 1.9.1 + dp-sharp δ 0 | 18 | 22 | 14 | 13 |
| RedHat 1.8.1 + sharp δ 0 | 30 | 38 | 26 | 1 |
| RedHat 1.8.1 old template δ 0 | 28 | 44 | 63 | 13 |
| RedHat 1.9.1 + sharp δ 0.3 | 19 | 19 | **1** | 0 |

Speed and memory (MEASURED, `report.py` agentic; window = first transcript event → `stop_when` ts, so counts differ by ±1 call
from the table above). Decode = median of the pure-decode 10 s windows (vLLM) or of per-request rates ≥256 tokens (llama.cpp). The
two methods differ, so cross-engine ratios are approximate.

| Arm | Wall s | Decode tok/s | Accept rate (MAL) | Generated tok | Prefilled tok (per call) | Longest-think repeated lines | mclk p50 MHz (<1000 MHz) | VRAM load / peak MiB | Peak GTT MiB |
|---|---:|---:|---|---:|---:|---:|---|---|---:|
| Q4_K_XL + sharp | 3,789 | 32.6 | 0.615 (—) | 102,490 | 148,450 (~2.1k) | 0.0% | 875 (100%) | 28,043 / 28,975 | 1,017 |
| RedHat 1.9.1 + sharp δ 0 | 2,182 | 55.8 | 0.34 (3.38) | 120,001 | 313,201 (~3.9k) | 0.6% | 875 (100%) | 31,046 / 32,285 | 217 |
| RedHat 1.9.1 + dp-sharp δ 0 (throttled) | 1,242 | N/A | N/A | N/A | N/A | 3.9% | 1,258 (13%) | 31,550 / 31,649 | 143 |
| RedHat 1.8.1 + sharp δ 0 | 2,819 | 55.5 | 0.348 (3.44) | 144,380 | 447,097 (~4.5k) | 0.0% | 875 (100%) | 30,884 / 32,057 | 261 |
| RedHat 1.9.1 + sharp δ 0.3 | 514 | **84.2** | 0.55 (4.85) | 38,570 | 138,471 (~3.2k) | **15.8%** | 875 (100%) | 31,238 / **32,433** | 217 |

> The repeated-line column is `report.py`'s loop signal. It counts legitimate code repetition too: δ 0.3's 15.8% is `import` lines, and
> the 40-line-window detector (`loop_onset.py`) finds no loop in any arm of this table (corrected 17:45).
>
> Peak VRAM of the δ 0.3 arm is 191 MiB below physical 32,624 MiB. The Q4 arm's GTT peak of 1,017 MiB is ~940 MiB above the ~77 MiB
> idle baseline: a host-RAM spill to flag. It is consistent with `--cache-ram 12288` prompt-cache traffic (INFERRED, OPEN).
>
> The **dp-sharp** row is **throttled** (mclk 1,258 MHz, power 203 W vs the arms above at 875 MHz / ~137 W), so its Wall / mclk /
> power are **not comparable**; its Decode/Gen/Prefilled are **N/A** because the vLLM logger reported `output_tokens = 0` (the engine
> was mislabelled `llama.cpp` by `report.py` for the same reason). Its VRAM / GTT (peak 31,649 / 143 MiB) are still valid — no host-RAM
> spill (GTT within ~150 MiB of idle). See `campaigns/2026-11-01-redhat191-dp-sharp-w208-blind/analysis.md`.

## Consequences & root causes

1. **"Q4 thought less" is a step-count effect, not a thinking-density effect.** MEASURED: thinking per tool call is 3,453 (Q4) vs
   3,043-3,641 (RedHat), and the spread *within* RedHat is larger than the gap to Q4. Total thinking = steps × ~3.3k chars. The same
   holds for the template: sharp cut thinking −38% (489k → 304k) by cutting steps (155 → 100), not by thinking less per step
   (3,154 → 3,043). → *Therefore, to change thinking volume, change the trajectory (task framing, compaction, exploration), not the
   sampler.*

2. **The step-count difference cannot be attributed to a parameter at n = 1.** The settings the arms share are MEASURED: sampler,
   template sha, Claude Code env (`AUTO_COMPACT_WINDOW 180000`, `PCT_OVERRIDE 85`, `MAX_THINKING_TOKENS 0`, `MAX_OUTPUT_TOKENS 64000`).
   The ones that differ are weights (Q4_K_XL weight-only vs MXFP4 **W4A4**), engine, KV (q8_0 vs calibrated fp8) and draft (MTP vs
   DFlash; both exact).
   - **Noise floor (MEASURED):** RedHat 1.8.1 vs 1.9.1 + sharp δ 0 have an identical sampling distribution (δ 0 is bit-exact, and
     the template is the same file). They still differ by 20% in steps (100 vs 80), 39% in messages and 23% in wall. Q4's 70 is
     12.5% below 80.
   - **External (CLAIMED, T1):** W4G128 quantization leaves reasoning length ≈ BF16. Only W3 or W4A4KV4 lengthen it, mostly at 1.5B.
   - **External (snippet):** agentic step counts vary with CV ≈ 15%. Resolving a 20% difference would take ~8-9 runs per arm
     (INFERRED power calculation).

   → *Treat "fewer steps" as a sample, not a property of Q4.*

3. **Fewer steps did not cost quality, and here it came with the best grade.** Q4 read 15 distinct files and ran 18 probes, and
   scored 23. The old-template run read 26 files and ran 63 probes, and scored 20 (MEASURED). Within this range more exploration did
   not buy coverage. All non-heretic arms sit in 20-23, a tie under the Δ ≥ 5 rule. → *There is room to cut work further without a
   measurable quality cost. Quality has to come from somewhere other than "more of the same exploration" (consequences 5-6).*

4. **Every run auto-compacted at ~136-143k, and the trigger is ours, not the server's.**
   - The Claude Code env sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=180000` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85` on both arms. The
     observed `preTokens` are 136,042-142,709, which fits 0.85 × (180000 − 20000) = 136000 (INFERRED fit; the documented knob
     semantics are CLAIMED T1).
   - The servers accept 260,000 (llama.cpp) and 262,000 (vLLM).
   - Each compaction took 179-437 s (10-22% of the window per run) and dropped 109-122k tokens.
   - Claude Code keeps at most 5 recent files after compaction, and files over 5k tokens come back as bare paths (CLAIMED T1).
   - Re-reads after compaction were few (2-7; MEASURED), so compaction is not the main driver of the step count. Its costs are
     direct wall time and the loss of probe outputs from working memory before the review is written.

   → *The compaction window is a speed and quality lever we control (lever L1).*

5. **Diversity beats repetition for coverage.**

   | Union (MEASURED from blind grades) | Weighted | Gain vs best single |
   |---|---:|---:|
   | two RedHat runs | 24 | +2 |
   | Q4 + RedHat | 27-28 | +4…+5 |
   | three sharp runs | 29 (15/19 findings) | +6 vs Q4's 23 |
   | all five arms | 31 (16/19 findings) | — |

   This assumes a merger that keeps every matched finding (INFERRED). Each review also carries 1-3 false claims, so a merge step
   must verify. → *The speed headroom of the RedHat path (~1.7× Q4's decode) is best spent on a second independent reviewer, ideally
   on different weights (lever L2).*

6. **Three Opus findings were never found by any of the five arms.**
   - #1 (high): edited goals never reach `confirmed.json`.
   - #4 (high): the test fake records argv only, so T3's assertion cannot see the value.
   - #18 (low): the wrong sibling is used as the PATTERN.

   The hits that did exist were scattered: #9, #11 and #14 only by Q4; #8 only by the old template; #16 only by RedHat 1.8.1 + sharp;
   #7 (partial) only by 1.9.1 δ 0. These are systematic blind spots of the review *protocol*: cross-function data flow to a persisted
   artifact, and test-double semantics. They are not engine noise. → *A checklist step in the dp-forge review protocol is the cheapest
   quality lever (L3, outside this repo).*

7. **δ 0.3 trades exactness for +51% decode, and its only run broke protocol.** MEASURED:
   - decode 84.2 vs 55.8 tok/s, acceptance 0.55 vs 0.34, MAL 4.85 vs 3.38;
   - it read the Opus reference after 514 s without writing its own review, and ran 1 probe;
   - its longest thinking has 15.8% repeated lines, but they are repeated `import` lines, not a loop (corrected 17:45; δ 0 runs
     have such blocks too).

   At n = 1 the protocol skip could be trajectory chance; it was a jump to step B, not a question to the user (MEASURED, last
   actions). → *Do not promote δ 0.3 on this evidence.* δ 0.5 has since looped (3 runs). Under the 1.9.x cap, δ 0.3 and δ 0.5
   accept identically for drafted tokens with target p ≥ 0.29, so δ 0.3 is not a safe middle (INFERRED, analysis 17:45 §5).

8. **Decode runs at a 875 MHz memory clock throughout.** MEASURED: mclk p50 875 MHz, 100% of samples below 1000 MHz on both engines.
   The OD_MCLK top state is 1250 MHz (power-state log 2026-10-30). Decode on a 4-bit 27B with a speculative verify is
   bandwidth-bound (INFERRED). If the memory clock can run higher **within the unchanged 210 W cap**, decode has up to ~1.4× headroom
   (1250/875, INFERRED upper bound). → *Lever L4 is a measurement question, not a cap change.*

9. **vLLM re-prefills about 2× more tokens per step than llama.cpp** (~3.9-4.5k vs ~2.1k per tool call). This is despite a 93.7%
   prefix-cache hit rate (MEASURED, last logged). INFERRED cause: hybrid models use Mamba cache mode `align`, which recomputes from
   the last aligned block. Prefill is fast, so the wall impact is small. **OPEN**, low priority.

## Levers — quality and speed, ranked (best first)

| # | Lever | Goal | Evidence | Cost / risk | Proposed test (needs approval) |
|---|---|---|---|---|---|
| **L1** | Move the compaction window | speed **and** quality | 1-2 compactions per run, 10-22% of the window, −109…−122k context each (MEASURED) | deeper context → slower prefill/decode per step (rule 16) and the unverified 130-200k KV/model region; prompt + `max_tokens` must stay ≤ 262000 | RedHat 1.9.1 + sharp δ 0 with a campaign-local settings copy: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=230000`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` (max message seen 18.3k, no cap hits). Expected trigger ≈ 178-196k (INFERRED). Compare compactions, wall and the blind grade against today's δ 0 run |
| **L2** | Two independent reviews + a verifying merge | quality, paid for by speed | union +2 (same config) … +5 (Q4 + RedHat) weighted; 3 runs → 29/38 (MEASURED grades, INFERRED merge) | ~2× generation unless run concurrently (vLLM `MAXSEQS 2`: aggregate throughput unmeasured on this workload); the merge must drop the 1-3 false claims per review | one RedHat + one Q4 review of W2-08 (both exist) → a merge pass → blind grade of the merged review |
| **L3** | Protocol checklist for the 3 never-found classes | quality, no GPU cost | #1, #4, #18 missed by all 5 arms (MEASURED) | dp-forge change, outside this repo; may lengthen step A | add "trace every persisted write to its reader" and "check what the test double records vs what the test asserts" to the review protocol, then re-run one arm |
| **L4** | Memory clock within the 210 W cap | speed | mclk 875 MHz in 100% of samples; top state 1250 MHz (MEASURED); bandwidth-bound decode (INFERRED) | system power setting (user's call); the cap stays 210 W | same arm, cap unchanged, mclk allowed to its top state; read decode with the clock trace beside it (benchmark-results rule 16) |
| **L5** | Cactus δ ladder | speed | δ 0.3: +51% decode, protocol skip, no loop (MEASURED, n = 1). δ 0.5: +65% decode, **2.4× wall**, 49% of tokens in 7 loops (one hit the 64k cap), **16/38 blind grade** (−5 at the Δ ≥ 5 threshold) (MEASURED). Mechanism: [17:45 analysis §5](2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md) | quality and loop risk; δ 0.3 ≈ δ 0.5 under the cap where loops live; **δ 0.5 is paid twice — wall and findings** | only on the template winner of L7: δ 0.5 + `CACTUS_CAP_R=0.8` + fade 0→4096 vs δ 0 (plan P3) |
| **L6** | Long-context retrieval probe for the KV dtype | quality assurance for L1 | no data on our stack above ~130k (research) | **no tool owns this** (rule 6 gap) | add a needle/MRCR probe (e.g. `capture_engine.py needle`) at 64k / 128k / 190k, A/B fp8 vs bf16 (vLLM) and q8_0 vs f16 (llama.cpp), accept at ≥95% recovery |
| **L7** | Replay rule + terseness A/B at δ 0 | quality **and** speed | keep-all replays 2.3× context; older thinking is needed for ~2-3 pp of identifiers, mostly the findings ledger (MEASURED + judge). sharp: −35-38% work, +2 findings (n.s.), weaker severity calibration | new template files (copies; current ones stay restorable) | plan P1: sly2 as shipped vs `sharp-sly2` (vs scoped terseness), n = 2, blind grade. **Result (1 run, 2026-10-31 20:05):** `sharp-sly2` (k = 1, δ 0) hit the 1 h cap still probing — 1.65× keep-all wall, 1.4× tokens, 2.5× thinking/tool call, re-derived 8.5% of identifiers (MEASURED). **Not a speed winner; no review written (quarantined, rule 18).** keep-all (sharp) remains the best single arm (21/38, 2182 s). |
| **L8** | Loop guard | speed | a looped block costs up to 64k tokens (~13-19 min) | over-filtering of code/tables; an abort makes Claude Code retry | plan P4: replay dedup + warning in the template, warn-only `loop_warning` in `capture_proxy.py`, repetition-gated δ upstream |
| **L9** | Findings ledger written to a file during step A | quality under k = 1 | all 6 judged dependencies on old thinking were the ledger (INFERRED, judge) | dp-forge RUNBOOK change, outside this repo | plan P2, on the L7 winner |
| — | Thinking-budget cap | speed | 50-62% of thinking sits in the top 10% of messages (MEASURED) | those are likely the analysis moments; the best-graded arm (Q4) had the heaviest tail (62%) | **not recommended** without an A/B |
| — | Prefill re-compute on vLLM | speed | ~2× tokens per step (MEASURED) | small wall share | OPEN, low priority |

## KV cache: how far is 8-bit "stable"? (summary of the research doc)

- **Our fp8 is the good variant.** The RedHat checkpoint ships calibrated per-tensor fp8 KV scales (MEASURED: `kv_cache_scheme`
  float8 `static_minmax`, 32 k/v scales for the 16 attention layers). The "scale = 1.0" risk from vLLM's docs does not apply.
- **q8_0 short-context error is nil.** Qwen3 8B PPL is 7.3195 vs 7.3203 for f16, and Qwen3.5-9B KLD is 0.00076 (T1, llama.cpp
  PR #21038).
- **Long context is proven on NVIDIA only.**
  - On NVIDIA fp8, Qwen3.5-27B loses ≤0.7 pt, with MRCR matching baseline to 1M.
  - Qwen3-30B-A3B reaches 94-98% MRCR recovery at 256k (T1 vendor blog).
  - A third-party calibrated-fp8 Qwen3.8-27B passed needle 9/9 to 262k (T2).
  - The known failure is a kernel accumulation cliff (needle 91% → 13% at 128k on Hopper FA3, since fixed).
  - **ROCm (radiance R4D/libr4d) and Vulkan have no published long-context data**, and that is our stack.
- **Practical answer:**
  - ≤128k: safe by analogy.
  - 128-200k: plausible, unverified on our stack.
  - Compared with the model's own decay (NoLiMa: 11/13 models below 50% of their short baseline at 32k) and with our compaction at
    ~136k, the 8-bit KV delta (0-3 pts where measured) is the smallest term.
  - Measure it ourselves before raising the working context past ~136k (lever L6).

