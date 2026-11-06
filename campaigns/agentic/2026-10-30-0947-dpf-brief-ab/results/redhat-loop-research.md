# Why RedHat MXFP4 loops in thinking and heretic (mostly) does not: research report

Written 2026-10-30 (investigator, read-only). Provenance: MEASURED = local file/log (path given), CLAIMED = external (URL),
INFERRED = my reasoning. Times are UTC unless noted (local = UTC+1). Container logs are in UTC (checked: heretic 08:51 log = 08:51Z jsonl).

## Summary

1. **Correction to the premise:** heretic also looped once. At 09:07:53Z it produced a 246,214-char thinking block, 55 distinct of 1,072 non-empty lines
   (ratio 0.05), 371.7 s, thinking-only, followed by Claude Code's "Output token limit hit" message (MEASURED, `heretic/session-0.jsonl`, msg `chatcmpl-8579f827545131d6`).
   RedHat did the same thing 5 times in 83 min (+ 10 shorter thinking-only turns). So the failure mode is **shared**; RedHat is far more susceptible. It is not "heretic never loops".
2. **Runaway blocks end at the output cap, not by EOS.** The 6 runaway windows contain 65.6k-67.3k generated tokens (accepted + steps, from SpecDecoding counters; INFERRED token estimate, window slack of +-10 s) and each is followed by the client message "Output token limit hit" (MEASURED, 5 of 5 on RedHat, 1 of 1 on heretic).
3. **The signature in the server log is acceptance length 7.4-7.8 (max 8 = k+1) during every runaway block**, for both models (MEASURED, `docker logs vllm-8000`, `heretic/server-container.log`). Normal text gives 5.0-5.5. This is exactly the symptom of **Sly issue #164** (Cactus acceptance rule, `RADIANCE_CACTUS_DELTA=0.5`): "Draft acceptance went to ~99 % and generation never ended" (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance/issues/164).
4. **The image under test (1.8.1) has the unfixed Cactus rule AND the chat template that replays all old reasoning** (`_preserve_thinking = true` default, MEASURED `docker exec vllm-8000 sed /opt/qwen-fixed.jinja` line 13). Sly 1.9.0/1.9.1 (26 and 29 Oct) fix both after measuring 11/32 vs 2/16 verbatim loops (Cactus 0.5 vs stock) and 35/64 vs 6/64 no-result runs (full replay vs new template) (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance/releases).
5. **A third co-factor sits in the client config:** Claude Code sends `output_config.effort=high` (MEASURED in the one captured request, `bench/engine-bench/vllm/warmup/claude-first/req-001_v1_messages.json`; `effortLevel: "high"` in settings), vLLM maps it to `reasoning_effort=high`, and the template turns that into the system line "Reasoning effort is set to xhigh. ... validate key assumptions, consider plausible alternatives" (MEASURED, `/opt/qwen-fixed.jinja` lines 17-30, 82-86). The Sly maintainer could not reproduce #164 at medium effort, reporters hit it at xhigh (CLAIMED, issue #164).
6. **No thinking budget is active**: `MAX_THINKING_TOKENS=0` makes Claude Code send no `thinking` field (INFERRED from capture, which has none), so vLLM's `thinking_token_budget` (exists in 0.32, MEASURED in container source) is never set. Only the 64k cap stops a loop.

**Cheapest fix with the best evidence:** `RADIANCE_CACTUS_DELTA=0` for the RedHat profile (first experiment), then upgrade the image to 1.9.1 (fade + cap + template), lower effort to medium, and add a thinking budget.

## Ranked hypotheses

| Rank | Hypothesis | Verdict | Key evidence for | Key evidence against |
|---|---|---|---|---|
| 1 | **H5 Spec-decode acceptance rule (Cactus delta 0.5) locks repetition in** | Most likely primary cause | Acceptance len 7.4-7.8 in all 6 runaway windows vs 5.0-5.5 normal (MEASURED, section B1); Sly #164 same symptom, same fix (CLAIMED); kernel code: with the point-mass lookup draft the accept probability is `h(q)=q+sqrt(2*delta*q*(1-q))` instead of `q`, i.e. q=0.1 -> 0.40 (INFERRED from MEASURED `rejection_sampler_utils.py:761-768`); Sly's own A/B 11/32 vs 2/16 loops (CLAIMED) | heretic runs the same delta and mostly does not loop, so Cactus alone does not explain the model difference |
| 2 | **H1 x H5 interaction: model/quant susceptibility** (RedHat = base Qwen3.8 W4A4 GPTQ+AWQ, calibrated FP8 KV scales; heretic = Swift finetune, weight-only GPTQ A16) | Probable amplifier, unproven | RedHat per-position acceptance 0.97...0.81 vs heretic 0.91...0.44 over the whole run (MEASURED): drafter matches RedHat better, so Cactus has more to lift; RedHat checkpoint is W4A4 + AWQ smoothing but engine runs W4A8 ("not the checkpoint's W4A4 ... not bit-identical", MEASURED boot log); heretic recipe differs (A16, 89 samples, no AWQ, no KV scales) (MEASURED `recipe.yaml`) | RedHat card shows 95.7-101% accuracy recovery incl. AIME 2025 92.5% (CLAIMED, https://huggingface.co/RedHatAI/Qwen3.8-27B-MXFP4); the checkpoint is not RTN (calibrated GPTQ+AWQ, 512 samples) |
| 3 | **H7 Template/effort/prompt co-factors** (full reasoning replay in 1.8.1 template, effort high -> "xhigh" instruction, contradictory brief) | Likely contributor | Replay default in template (MEASURED); Sly: 35/64 vs 6/64 no-result (CLAIMED); effort high -> xhigh text (MEASURED); loop topic is one self-contradictory spec question (MEASURED, section A6); Sly reporter blamed a self-contradictory brief (CLAIMED #164) | Same template and effort in both arms |
| 4 | **H4 No thinking budget + 64k output cap** | Enabler (not cause) | 5 caps x ~6 min = ~30 min of dead decode on RedHat; compaction by looping model took 531-699 s vs 90-103 s (MEASURED section A7); 3 further compactions failed "summarization produced empty response" (MEASURED) | Does not explain why the loop starts |
| 5 | **H2 Lossy engine knobs (int4 lm_head, int4 embed, W4A8, fp8 KV) compound with RedHat quant** | Possible, unproven | int4 head "~3x the per-weight RMS error of fp8 ... decides the target argmax ... ships only behind GSM8K / accept-length gate"; int4 embed "~16x the error ... ships only behind the GSM8K gate"; both written for the Quark target (MEASURED, docstrings in `radiance_lmhead_int4.py`, `radiance_embed_int8.py`); not validated for RedHat (not found in any Sly doc) | Same knobs on heretic (a Sly-validated checkpoint) still produced one loop; heretic completed; no direct test yet |
| 6 | **H3 Sampling too permissive** (temp 1.0, presence_penalty 0) | Weak as cause, cheap mitigation | Qwen card says presence_penalty 0-2 "to reduce endless repetition" with slight quality cost (CLAIMED, https://huggingface.co/Qwen/Qwen3.8-27B) | Thinking-mode card values ARE temp 1.0/top_p 0.95/top_k 20/pp 0.0 = what we run (CLAIMED + MEASURED); RedHat's own evals use the same (CLAIMED, card) |
| 7 | **H6 Long context / fp8 KV** | Unlikely as primary | RedHat's first long block at input 54.9k tokens, first cap at 74k; heretic's loop at 125.6k; RedHat also produced normal short turns at 150-200k ctx (MEASURED) -> no threshold. Uncalibrated-FP8-KV loops are reported by one blog (CLAIMED, Tier-2) but RedHat ships calibrated scales and the R4D path reads `_k_scale_float`/`_v_scale_float` (MEASURED) | Cannot rule out a decode-path scale bug (not verified) |

## Fixes (ordered by value / cost)

| # | Change (exact) | Expected effect | Cost | Cheapest discriminating experiment |
|---|---|---|---|---|
| F1 | New `bench/engine-bench/vllm/profiles/sly-redhat/redhat-mxfp4-dflash-nocactus.env`: `source redhat-mxfp4-dflash.env` then `ENGINE_ENV+=(RADIANCE_CACTUS_DELTA=0)` (the layer already supports `CACTUS_DELTA=0` env override: `_engine.env` line `RADIANCE_CACTUS_DELTA=${CACTUS_DELTA:-0.5}`, so simply boot with `CACTUS_DELTA=0`) | Removes the lossy acceptance bias; Sly reports loops go from 11/32 to 2/16 (CLAIMED) | Sly: 18% slower decode on one setup (CLAIMED, #164); we still have DFlash k=7 | Replay experiment (below), 5 repeats each of delta 0.5 vs 0 |
| F2 | Image `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (`IMAGE=` in `_engine.env`), keep Cactus 0.5 to use the new fade (`RADIANCE_CACTUS_FADE_START=4096`, `_FADE_END=16384`) and cap (`RADIANCE_CACTUS_CAP_R=0.5`) plus template without old-reasoning replay | Fix path chosen by Sly; keeps ~72% of the Cactus gain (CLAIMED) | Image pull, re-verify boot flags; 1.9.x pins not documented | Same replay, arm "1.9.1 defaults" |
| F3 | Client: `settings-redhat.json` `"effortLevel": "medium"` (or `low`) | Removes the "xhigh ... consider plausible alternatives" system line; maintainer saw no loop at medium (CLAIMED) | Less deliberate reasoning on hard tasks | Replay with `output_config.effort` high vs medium |
| F4 | Thinking budget: set `MAX_THINKING_TOKENS=12000` in the settings env (Claude Code would then send `thinking:{type:"enabled",budget_tokens:12000}`; INFERRED, not verified, check with `capture_proxy.py`) and add `--reasoning-config '{"reasoning_end_str":"\n\nI should stop deliberating and answer.\n</think>\n\n"}'` to `ENGINE_ARGS` (vLLM 0.32 `ReasoningConfig`, MEASURED in container `config/reasoning.py`; `thinking_token_budget` maps from `budget_tokens`, MEASURED `anthropic/serving.py` `_handle_thinking`) | Caps a runaway at ~12k tokens (about 1 min) instead of 64k (about 6 min); forces `</think>` so a visible reply follows | A forced end can cut real reasoning; flag semantics of `reasoning_end_str` need a smoke test | Boot check with a tiny request, then replay |
| F5 | Lower the client output cap: `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` | Halves wasted time per runaway; Claude Code already reports `maxOutputTokens 32000` in modelUsage (MEASURED `result` event) | A legit long write could be cut | None needed |
| F6 | Sampling: `--override-generation-config '{"temperature":1.0,"top_p":0.95,"top_k":20,"min_p":0.0,"presence_penalty":0.5}'` (new RedHat profile only) | Qwen card endorses presence_penalty to curb endless repetition (CLAIMED); mild | Possible quality dip / language mixing (CLAIMED) | Replay arm with pp 0.5 and 1.0 |
| F7 | Disable lossy knobs for RedHat only: `RADIANCE_LMHEAD_INT4=0` (keeps `RADIANCE_LMHEAD_FP8=1`), `RADIANCE_EMBED_INT8=0` (embeds stay bf16; the checkpoint excludes `embed_tokens` and `lm_head`, MEASURED `recipe.yaml`) | Removes ~3x/16x extra weight error on the two tensors that decide the argmax | VRAM: head int4 -> fp8 +0.61 GiB, embed int4 -> bf16 +1.76 GiB (CLAIMED in docstrings: "freed 1.76 GiB" each, MEASURED boot log); KV pool shrinks 12.9 GiB -> ~10.5 GiB (INFERRED), still > 262k? NOT verified, may need `--max-model-len` lower | Replay arm, only after F1 (otherwise confounded) |
| F8 | Spec decoding off: existing `profiles/sly-redhat/redhat-mxfp4.env` (no drafter) or `redhat-mxfp4-mtp.env` | Eliminates the whole acceptance path (H5) -> pure model baseline | Decode drops from ~150 to ~35-60 tok/s (CLAIMED for Sly docs; our own throughput table in `docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md`); MTP keeps Cactus 0.5 and may still be exposed (MEASURED comment in `redhat-mxfp4-mtp.env`) | Run it as the control arm: if it still loops, H5 is wrong |
| F9 | KV dtype: `KV_DTYPE=auto` (bf16) with a smaller `MAXLEN` (e.g. 131072) | Rules out H6/calibration | Roughly doubles KV bytes per token (INFERRED), window must shrink | Only if F1+F2+F3 do not fix |

### Prompt-level mitigation (one sentence for the runbook)
Add to RUNBOOK part A: *"In the blind review, record a spec contradiction (for example a function arity that differs from its contract) as ONE finding line with both quotes, and do not decide or design the fix until part C; if you catch yourself re-deriving the same point twice, write the finding and move on."* (INFERRED; targets the loop topic seen in section A6.)

### Replay experiment (describe only, not run)
Goal: measure loop rate in minutes, not hours, on the exact context that triggers it.
1. Context to replay: the request that preceded RedHat's first runaway (input 74,290 tokens at 09:45:07Z; a second one at 76,431 tokens at 09:54:34Z showed the same state reproduces the loop: MEASURED, ctx before/after = 74290/74334, i.e. the capped block is dropped and the same context is resent).
2. Capture the real body: start `bench/engine-bench/vllm/capture_proxy.py 8001 http://127.0.0.1:8000 /tmp/cap` against an idle server, run `claude -p --resume 542daf86-9d3d-45e8-a6e2-f7977c66f47d` with `ANTHROPIC_BASE_URL=http://127.0.0.1:8001` and kill it after the first request (no file with the raw body exists yet; the transcript lives in `~/.claude/projects/` and is copied into `redhat/claude-project/` only at the end of the arm). Note the resume point differs from 09:45, so instead truncate the transcript to the message before the 09:45:07Z assistant turn (jsonl uuid in `session-0.jsonl`) into a copy session, then capture.
3. Replay: POST the saved body to `/v1/messages` with `stream:false` (or stream) and `max_tokens` 20000, N=5 per config, seeds fixed via `seed` where supported. Per run record: thinking chars, distinct-line ratio, finish (`stop_reason`), and the SpecDecoding acceptance length from the log. A loop = ratio < 0.3 or no `</think>` within 20k tokens.
4. Configs (one server boot each, about 3.5 min boot + about 3 min of requests): A baseline (as run); B `CACTUS_DELTA=0`; C no drafter (`redhat-mxfp4.env`); D image 1.9.1 defaults; E effort medium (edit body `output_config.effort`, no reboot); F presence_penalty 0.5 (body field `presence_penalty` if the override allows). E and F can run on A without rebooting.
5. Run FIRST: A and E on the current baseline server? No: run **B vs A** first (see recommendation), then C only if B fails.

### Recommended first experiment
**Replay with `CACTUS_DELTA=0` vs baseline (B vs A), 5 repeats each.** Reasons: (1) it directly tests the best-supported hypothesis, with a measured signature (acceptance 7.4-7.8) and an upstream bug that matches; (2) one env var, no new image; (3) minutes, not hours; (4) if loops persist at delta 0, run C (no drafter) to separate "model" from "any spec-decode effect".

---

## A. Log forensics (both arms, same parser)

Parser: per-`message.id` aggregation of `assistant` events from `heretic/session-0.jsonl` and `redhat/session-0..4.jsonl`. Findings on the format (MEASURED): `stop_reason` is `null` and `usage.output_tokens` is `0` on every streamed assistant event in both arms (they are message_start snapshots), so **per-message stop reason and output tokens are not available from the jsonl**; context size = `usage.input_tokens` at message start (cache fields are absent, input_tokens carries the full prompt). Stop cause is therefore derived from (a) Claude Code's injected follow-up user message and (b) token counts from the server SpecDecoding counters. Thinking duration is in `thinking_duration_ms`. Message counts: heretic 149 messages (408 events), RedHat 71 messages in session files 0-4 (the run was still in progress; call 4 was still running at the time of writing).

### A1. Thinking length per message
| Arm | messages | median chars | p90 chars | max chars | > 20k chars | distinct-line ratio < 0.3 (len > 2000) | thinking-only (no text/tool) |
|---|---|---|---|---|---|---|---|
| heretic | 149 | 683 | 10,667 | 246,214 | 7 | 1 | 1 |
| redhat | 71 | 7,986 | 84,996 | 260,925 | 24 | 11 | 15 |

### A2. Twelve longest thinking blocks (ts = block end, UTC; ctx = input tokens; "vis" = visible text or tool call in the same message)
heretic:

| ts | chars | ratio | stop_reason | out tok | ctx | vis |
|---|---|---|---|---|---|---|
| 09:07:53 | 246,214 | 0.05 | n/a (cap msg follows) | n/a | 125,651 | n |
| 09:25:06 | 41,792 | 0.81 | n/a | n/a | 66,170 | y |
| 08:53:56 | 28,902 | 0.85 | n/a | n/a | 58,657 | y |
| 08:55:35 | 24,869 | 0.85 | n/a | n/a | 71,060 | y |
| 09:12:17 | 24,797 | 0.99 | n/a | n/a | 62,420 | y |
| 09:29:54 | 21,443 | 0.91 | n/a | n/a | 113,245 | y |
| 08:58:41 | 20,053 | 0.79 | n/a | n/a | 95,247 | y |
| 09:23:17 | 15,246 | 0.83 | n/a | n/a | 59,232 | y |
| 09:26:19 | 13,102 | 0.97 | n/a | n/a | 83,437 | y |
| 08:59:14 | 12,307 | 0.73 | n/a | n/a | 102,084 | y |
| 09:16:26 | 12,297 | 0.91 | n/a | n/a | 102,098 | y |
| 09:26:56 | 12,154 | 0.88 | n/a | n/a | 90,496 | y |

redhat:

| ts | chars | ratio | follow-up client message | ctx | vis |
|---|---|---|---|---|---|
| 11:16:34 | 260,925 | 0.04 | Output token limit hit | 141,072 | n |
| 09:45:07 | 246,747 | 0.08 | Output token limit hit | 74,290 | n |
| 10:20:09 | 235,414 | 0.05 | Output token limit hit | 96,704 | n |
| 10:48:20 | 235,296 | 0.04 | Output token limit hit | 128,354 | n |
| 09:54:34 | 216,736 | 0.09 | Output token limit hit | 76,431 | n |
| 10:14:02 | 136,922 | 0.08 | "no visible output" nudge | 96,681 | n |
| 11:01:29 | 87,560 | 0.16 | "no visible output" nudge | 128,562 | n |
| 11:04:06 | 84,996 | 0.28 | none | 128,581 | n |
| 11:29:15 | 60,450 | 0.27 | none | 185,852 | n |
| 10:55:48 | 58,570 | 0.22 | "no visible output" nudge | 128,398 | n |
| 11:43:27 | 56,010 | 0.32 | none | 201,010 | n |
| 11:05:54 | 55,517 | 0.29 | "no visible output" nudge | 128,658 | n |

Source for both: parser over `*/session-*.jsonl`; ratio = distinct non-empty stripped lines / non-empty lines.

### A3. Cap or EOS?
- Cap case: 5 RedHat blocks (09:45, 09:54, 10:20, 10:48, 11:16) and 1 heretic block (09:07) are each followed immediately by the client text "Output token limit hit. Resume directly ..." (MEASURED). Their windows contain 65.6k-67.3k tokens by the SpecDecoding counters (accepted + drafted/7; the cap is 64,000: `CLAUDE_CODE_MAX_OUTPUT_TOKENS`; INFERRED agreement) and take 360-379 s of `thinking_duration_ms` (MEASURED). Count: RedHat 5, heretic 1.
- EOS-without-content case: the other thinking-only messages end with Claude Code's "[Your previous response had no visible output...]" nudge (RedHat 8 of 10 such messages followed by that nudge, the remaining 2-5 were last messages before a session end; they are 41k-137k chars = about 11k-37k tokens, far below the cap, so the model closed thinking (or emitted EOS) without a reply). Count: RedHat 10 (A3 list in section A2 plus 10:55:48 etc.), heretic 0 (its 1 thinking-only message is the cap case). Whether the model wrote `</think>` and then EOS or EOS inside thinking cannot be told from the jsonl (INFERRED gap).

### A4. Context at onset
- RedHat: first block > 20k chars at 09:38:10 with ctx 54,921 (33,552 chars, ratio 0.49; a normal long think); first runaway at ctx 74,290; runaways at ctx 74k, 76k, 97k, 128k, 141k. Short normal turns also occur at 150-200k ctx. No threshold. (MEASURED)
- heretic: only runaway at ctx 125,651; max ctx 134,273, median 92,099; RedHat max 201,010, median 118,788 (MEASURED). Heretic never reached the depths RedHat did, because it finished the task.
- After a cap hit the next request has the same context (74,290 -> 74,334): the capped block is dropped and the model re-enters the same state, hence repeated runaways at about the same depth (MEASURED).

### A5. Identical tool calls
| Arm | tool calls | runs of 2+ identical consecutive calls | longest run | most repeated signature |
|---|---|---|---|---|
| heretic | 161 | 0 | 1 | 2x (a `Read`) |
| redhat | 83 | 0 consecutive (calls alternate A,B,A,B) | 15 (calls equal to one of the previous two) | `sed -n '/C7/,$p' ...02-contracts.md | head -60` 17x, `grep -n 'max-params\|max-lines\|max-complexity\|no-magic-num' eslint.config.mjs | head -30` 16x |

### A6. Top repeated lines (>=120 chars shortened) in the three worst RedHat blocks
- 11:16:34 (260,925 chars, 1,397 lines, 56 distinct): "Actually, I think the "## Probes" section is for verifying the code blocks in the brief..." 535x; "Actually, let me reconsider the whole thing. The REFINE-CHECK is a review of the brief..." 264x; "Actually, let me reconsider. ..." 263x; "OK, I'm going in circles. Let me just do the probes..." 263x.
- 09:45:07 (246,747 chars, 2,585 lines, 202 distinct): a lone ``` line 246x, `"openInEditor(path, env, tty)"` 50x, `export const openInEditor = (path: string, env: NodeJS.ProcessEnv, tty: boolean, deps?: ExternalDeps): Promise<void>;` 25x, "But the tests need injection (M8). So the brief must have injection." 25x.
- 10:48:20 (235,296 chars, 2,515 lines, 104 distinct): ``` 306x; a brief table row for `src/ui/external.ts` 31x; "But for openInEditor, the C7 contract shows 3 params without deps..." 31x; "1. The C7 contract is wrong (should show deps as a 4th param)." 31x.
Topic confirmed: arity vs contract C7 / max-params dilemma, and a REFINE-CHECK "Probes" self-doubt loop. Heretic's single runaway: the same pattern (an "M9 re-check" dilemma, "Let me reconsider" 170x, 229x repeated sentence) (MEASURED, parser output). Both arms loop on a **decision/ambiguity** in the brief, not on random text.

### A7. Compaction
| Arm | # | trigger | pre tokens | post tokens | duration |
|---|---|---|---|---|---|
| heretic | 1 | auto | 189,736 | 14,535 | 103 s |
| heretic | 2 | auto | 138,150 | 20,034 | 90 s |
| redhat | 1 | auto | 140,516 | 19,096 | 699 s |
| redhat | 2 | auto | 142,443 | 74,197 | 531 s |

Additionally RedHat had 8 compaction attempts that failed with "summarization produced empty response" (5 in call 0, 3 in call 2/3 and 1 in call 4; counts are of status events, partly duplicated across resumes) (MEASURED, `compact_result: failed`). The 74k-token summary after compaction 2 is itself a loop product. The compaction request goes through the same Cactus path.

## B. Server-side evidence

### B1. Spec-decode metrics
Whole-run (windows with > 200 accepted tokens; MEASURED from `docker logs vllm-8000` and `heretic/server-container.log`):

| | heretic | redhat |
|---|---|---|
| windows | 243 | 779 |
| mean acceptance length (per-window mean) | 5.52 | 7.18 |
| median acceptance length | 5.11 | 7.95 |
| windows with length >= 7.0 | 38 (16%) | 562 (72%) |
| accepted/drafted | 0.643 | 0.882 |
| per-position acceptance (1..7) | .91 .81 .71 .62 .55 .49 .44 | .97 .94 .90 .87 .85 .83 .81 |
| median accepted throughput (tok/s) | 87 | 146 |

Runaway windows (block end time minus duration, `thinking_duration_ms` taken from the jsonl):

| arm | block end | mean acceptance length in window | accepted tok/s |
|---|---|---|---|
| redhat | 09:45:07 | 7.48 | 152 |
| redhat | 09:54:34 | 7.37 | 149 |
| redhat | 10:14:02 | 7.53 | 152 |
| redhat | 10:20:09 | 7.67 | 152 |
| redhat | 10:48:20 | 7.74 | 147 |
| redhat | 11:16:34 | 7.83 | 145 |
| heretic | 09:07:53 | 7.69 | 148 |
| heretic, the 371 s *before* the block (control) | - | 5.03 | 84 |

So acceptance jumps to near the k+1 = 8 ceiling in every loop (including heretic's), and RedHat spends most of its decode time at that ceiling (72% of windows). Mean acceptance in the first 3 minutes of both servers was about 5.0-6.0 (MEASURED), i.e. same at the start. Note: high acceptance during repetition is expected for any engine (repeated text is easy to draft; the Radiance lookup drafter "enter 8 stay 3 hot 3" also proposes n-grams from history, MEASURED boot log) — so by itself it is a symptom, not proof. The causal argument is the Cactus rule below plus Sly's A/B.

Cactus rule (MEASURED, container `vllm/v1/worker/gpu/spec_decode/rejection_sampler_utils.py` lines 9-10, 761-768): `accepted = log(h) > log(u) + draft_logprob`, `h = clip(q + sqrt(2*delta*q*(1-q)))`, delta from `RADIANCE_CACTUS_DELTA` (default 0.5 in code; 0 = stock). With the lookup draft (point-mass, `draft_logprob = 0`), P(accept) = h(q). INFERRED consequences: q=0.01 -> 0.11, q=0.1 -> 0.40, q=0.5 -> 1.0. A token the target gives 10% is accepted 4x too often, and the accepted token is the draft's token, i.e. copied history. Repeating an earlier sentence is therefore systematically favoured, and each repeat makes the next n-gram match more likely: a positive feedback loop. Sly's maintainer: "The looping comes from the drift, which accumulates over the sequence" (CLAIMED, #164).

### B2. Warnings and kernel paths
Both boot logs normalised and diffed (MEASURED): the only differences are compile-cache hashes, timings, shard-load counts, KV pool size (heretic 389,416 tokens / 13.13 GiB vs RedHat 383,443 tokens / 12.94 GiB), model load 14.8 vs 14.83 GiB. Identical in both: `quantization=compressed-tensors`, `Using RadianceMxfp4W4A8LinearKernel for MXFP4 GEMM`, `W4A8 fp8-WMMA GEMM ENABLED for M>0 (NOTE: W4A8, not the checkpoint's W4A4 -- more precise activations, not bit-identical)`, lm_head -> int4 W4A16 group 128 clip=mse, embed_tokens -> int4, `KV cache group size 8 (stock heuristic: 5)`, `lookup draft: active`, `RADIANCE_DYNAMIC_DRAFT=ON tau=0.35`, same `Attempted to load weight ...weight_scale float16 into bfloat16` warnings (drafter), same TritonBundler cubin warnings, same `Draft model does not support external multimodal embeddings`. No nan/inf/overflow/fallback lines in either. So the `RADIANCE_*` knobs report being applied identically to both formats (the log does not show a different kernel path per checkpoint); `RADIANCE_MXFP4_SANITIZE` has no log line and no Python reference in the image (grep found none; likely inside the `.so`, not found). Note the log shows a W4A8 engine path for a W4A4-calibrated checkpoint; RedHat's activation scales are dynamic (no stored input scales) so no load-time mismatch is logged.

### B3. Earlier throughput campaigns
`bench/runs/2026-10-30-*-engine-redhat-sly*`, `*-engine-heretic-sly-*`, `campaigns/2026-10-30-vllm-*-depth` generated 256 tokens per request and store only rate rows and spec counters, no text and no finish reasons (MEASURED: `results.jsonl` row kinds; analysis file lines 119, 136-137). DFlash acceptance there: 0.549 / 0.367 / 0.423 at 10k/50k/100k on code-review prompts (MEASURED, analysis table). The analysis already notes: "Quality was not measured. Sly runs with Cactus delta 0.5 ... Sly issue #164" (`docs/analysis/2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md` line 136). Not found: any evidence of repetition in those runs (256-token outputs cannot show it).

## C. Engine knob semantics

Sources: `docs/vllm/settings.md`, `known-issues.md`, `profiles/**/*.env` comments, container docstrings (MEASURED), Sly releases (CLAIMED).

| Knob (our value) | What it does | Lossy? | Default | Validated for specific checkpoints? |
|---|---|---|---|---|
| `RADIANCE_CACTUS_DELTA=0.5` | Acceptance transform inside the spec-decode rejection kernel (see B1) | **Yes: changes the sampled distribution** ("more drift from the target distribution", README quoted in `_engine.env` comment) | 0.5 in image code; docs claim "0 = bit-exact stock" (CLAIMED #164) | Tuned on Swift-1.5 (CLAIMED releases); open bug #164 |
| `RADIANCE_MXFP4=1`, `_WPERM=1`, `_AT_PSW`, `_A_TILED_MIN_M=513`, `_WIDE_MAX_M=192`, `_DECODE_MAX_M=128`, `RADIANCE_ADAPTIVE_WIDTH=perseq` | Kernel/layout/dispatch choices for the MXFP4 GEMM | No (speed/layout; WPERM is a repack) (INFERRED from docs wording; not verified bit-exactness) | image-specific | Kernel path works on both (boot log) |
| `RADIANCE_MXFP4_W4A8=1`, `_W4A8_MIN_M=0` | 4-bit weights with fp8 activations for all M | Yes vs the checkpoint's definition: RedHat is W4A4 (activations MXFP4, dynamic) so W4A8 is "more precise activations, not bit-identical" (MEASURED boot log); vs heretic (A16 weight-only) it is an extra fp8 activation rounding | off unless set | Quark (`amd/...Quark-AWQ-MXFP4`) track; Sly's heretic GPTQ is A16 |
| `RADIANCE_MXFP4_SANITIZE=0` | Not found in the image .py; name suggests no clamp/sanitize of inputs | unknown | unknown | not found |
| `RADIANCE_LMHEAD_FP8=1` / `RADIANCE_LMHEAD_INT4=1` | INT4 takes precedence: lm_head int4 W4A16 g128, MSE clip search; "~3x the per-weight RMS error of per-channel fp8"; "the layer decides the target argmax and the drafter's top-16" | **Yes** | off | Docstring: ships only behind the GSM8K / accept-length gate, written for the Quark target. Boot log: applied to both |
| `RADIANCE_EMBED_INT8=1`, `RADIANCE_EMBED_BITS=4` | embed_tokens as int4 g128 RTN nibbles | **Yes**: "~16x the error [of int8] and ships only behind the GSM8K gate" | off, bits default 8 | same as above |
| `RADIANCE_KV_GROUP_SIZE=8` | Hybrid KV-manager layer grouping (log: "KV cache group size 8 (stock 5); layer buckets [48,16,5]") | No (memory layout; INFERRED) | stock heuristic | n/a |
| `RADIANCE_FUSED_NORM_QUANT=1` | Fused add+RMSNorm+quant epilogues (fp8) | Probably rounding-level (INFERRED) | off in docs | n/a |
| `--kv-cache-dtype fp8` | fp8 KV; checkpoint RedHat ships calibrated per-layer `k_scale`/`v_scale` for 16 attention layers; heretic ships none (scale 1.0) (MEASURED safetensors index); R4D path reads `_k_scale_float`/`_v_scale_float` and builds descale buffers (MEASURED `radiance_r4d_hybrid_attn.py:329-345`) | Yes (fp8 rounding) | auto | Whether the decode-attention path applies RedHat's scales identically: not verified |

Hypothesis test: "lossy knobs tuned on Sly's GPTQ checkpoint compound with RedHat's quantization error". For: docstrings gate int4 head/embed on GSM8K tests that were done on the Quark checkpoint, not RedHat; not found: any Sly validation statement for RedHat. Against: Sly's own checkpoint (heretic) loops under the same knobs (once), and the only Sly-documented loop mechanism is Cactus. Neither confirmed nor refuted; the discriminating test is F7 after F1.

## D. External research

### D1. Qwen3.8-27B card (https://huggingface.co/Qwen/Qwen3.8-27B)
Thinking mode: `temperature=1.0, top_p=0.95, top_k=20, min_p=0.0, presence_penalty=0.0, repetition_penalty=1.0`. Instruct mode: `temperature=0.7, top_p=0.80, top_k=20, min_p=0.0, presence_penalty=1.5`. `presence_penalty` 0-2 "to reduce endless repetition", higher values may cause occasional language mixing and a slight performance drop. Recommended max output: 262,144 tokens for reasoning and 131,072 for the final response. `reasoning_effort` xhigh (default), medium, low; the card warns that lower effort can cause insufficient analysis, more failures, repeated retries. No coding-specific set, no loop section. (CLAIMED, fetched summary.)

### D2. RedHatAI/Qwen3.8-27B-MXFP4 (https://huggingface.co/RedHatAI/Qwen3.8-27B-MXFP4)
GPTQ with AWQ activation smoothing via LLM Compressor, W4A4 MXFP4 (weights and activations) + FP8 KV, 512 `perfectblend` samples, max seq 4096; `lm_head`, `embed_tokens`, `visual`, `linear_attn.in_proj_a/b` kept bf16 (CLAIMED card; MEASURED local `recipe.yaml`/`config.json` identical, `ignore` n=208). Recovery vs bf16: IFEval 99.7%, GSM8K Platinum 98.9%, MATH-500 101.2%, AIME 2025 95.7%, GPQA-D 97.9%; sampling in their evals: temp 1.0, top_p 0.95, top_k 20, max 32,000-65,536 new tokens, vLLM on B200 (CLAIMED, card). Deploy command is plain `vllm serve ... --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_xml` (no spec decoding, no W4A8 re-quant). Community tab: no discussions (CLAIMED, fetched page). Not tested by the vendor: ROCm, Sly engine knobs.

### D3. slybase/Swift-1.5-...-heretic-MXFP4-GPTQ (local README, MEASURED `heretic` model dir; HF mirror https://huggingface.co/slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ)
Lineage: Qwen3.8-27B -> ukisai/Swift-1.5 -> akumaburn heretic (abliterated BF16) -> slybase GPTQ MXFP4A16 (weight-only), 89 calibration samples, seq 2048. Quality: "No quality figures are published for this checkpoint on its own yet." It is "the checkpoint the vllm-sly-radiance image is benchmarked with" together with the same DFlash2 drafter. Nothing says it is trained for agentic use, short thinking or anti-repetition (not found). Swift's own training objective: not found. INFERRED: Swift-1.5's behavior as a finetune is the likeliest reason for fewer deliberation loops, but this cannot be shown without a test on the base model under identical settings.

### D4. syvai/Qwen3.8-27B-DFlash2-W4A16 (https://huggingface.co/syvai/Qwen3.8-27B-DFlash2-W4A16)
"DFlash2 block drafter for Qwen3.8-27B"; vLLM 0.27.1 + patch or main with PR #52816; recommends FLASH_ATTN and bf16 KV; at default sampling acceptance is ~5% lower than greedy. No statement about `draft_sample_method`, losslessness or repetition (not found). Our drafter is therefore matched to the Qwen3.8 base = RedHat's base, not to the Swift finetune (INFERRED; consistent with RedHat's higher acceptance). Stock vLLM probabilistic rejection sampling is distribution-preserving by construction; the Cactus patch is what breaks that (MEASURED code).

### D5. vLLM 0.32 reasoning budget and the Anthropic endpoint
MEASURED in container `vllm/`:
- `thinking_token_budget` exists in `SamplingParams` (`sampling_params.py:424`), applied by `v1/sample/thinking_budget_state.py` / `v1/worker/gpu/sample/thinking_budget.py` when a `ReasoningConfig` is present. `--reasoning-config` exists (`engine/arg_utils.py:1859`); with `--reasoning-parser` set, a default `ReasoningConfig` is created (`_set_default_reasoning_config_args`, line 3057) and `reasoning_end_str` is the string forced when the budget runs out. It is **per request only**; there is no server-wide default flag for the budget (not found). Our argv has no `--reasoning-config`. Upstream docs/PR: https://docs.vllm.ai/en/latest/api/vllm/v1/sample/thinking_budget_state/ (CLAIMED via search; the closed PR https://github.com/vllm-project/vllm/pull/37112 proposed a different `reasoning_budget`).
- `/v1/messages` (`entrypoints/anthropic/serving.py` `_handle_thinking`, `_handle_output_config`): `thinking.type=="enabled"` -> `thinking_token_budget = budget_tokens`; `disabled` -> `reasoning_effort = <probed "none"-like value>` (template honours `none`/`off` by clearing thinking, `/opt/qwen-fixed.jinja` lines 20-23); `adaptive` pins nothing; `output_config.effort` -> `reasoning_effort`; `temperature/top_p/top_k` pass through from the request if present (else the `--override-generation-config` defaults apply).
- Therefore: (a) with no `thinking` field the server default `enable_thinking: true` wins and thinking is on, no budget; (b) if Claude Code sent `thinking.type=disabled` the template would turn thinking off — not what we see; (c) the captured Claude Code body has `max_tokens 33000`, `output_config.effort high`, **no `thinking`, no `temperature`** (MEASURED, `req-001_v1_messages.json`, an earlier session 2026-10-22, so INFERRED to hold for the 2.1.312 runs; recapture to be sure). The model-usage block of our sessions shows `maxOutputTokens 32000` (MEASURED) while the settings say 64000: the cap that actually applies per request was not captured; the 65.6k-token windows suggest 64,000 applied (INFERRED).
- Claude Code behavior of `MAX_THINKING_TOKENS` (budget -> `thinking.enabled.budget_tokens`): not verified against Anthropic docs here; test by capturing a request.

### D6. Known issues
- **Sly #164** (open, bug): Cactus lock-in, acceptance 99.8%, fixed in 1.9.0 (fade 4096->16384 output tokens, cap R 0.5) and 1.9.1 (template replay), reported by several users incl. 1.8.0 at xhigh (CLAIMED, https://github.com/SlyBase/vllm-sly-radiance/issues/164; releases https://github.com/SlyBase/vllm-sly-radiance/releases).
- 16/288 corrupted responses with spec decoding + async scheduling vs 0/288 without (CLAIMED, community report on a Qwen3.8 NVFP4 model: https://huggingface.co/RadixArk/Qwen3.8-Flash-Next-NVFP4/discussions/3, Tier-2). We already run `--no-async-scheduling`.
- Uncalibrated fp8 KV causing repetition after ~500 tokens (CLAIMED, https://ai-muninn.com/en/blog/dgx-spark-fp8-kvcache-repetition, Tier-2 single blog; our case differs: loops not at 500 tokens, and RedHat has calibrated scales).
- Laguna fp8-KV loop threads (Tier-2): https://huggingface.co/poolside/Laguna-S-2.1-NVFP4/discussions/10 . Not specific to Qwen.

## E. Not verified / gaps
- Raw Claude Code request body of the 2.1.312 runs (thinking/temperature/max_tokens/effort) was not captured; the only capture is from 2026-10-22.
- Exact output token count per message (the jsonl has none); I derived runaway token counts from server counters.
- Why RedHat's non-runaway thinking-only turns (10) end without content: no tool access to the raw token stream.
- Whether `RADIANCE_MXFP4_SANITIZE=0` matters (no source found).
- Whether the decode attention path applies RedHat's calibrated KV scales (only the hybrid prefill code read).
- Memory/VRAM effects of F7 are INFERRED from docstring numbers, not MEASURED (iron rule 7: measure before publishing).
- No GPU or HTTP access was used; nothing was replayed.

## Sources
- https://github.com/SlyBase/vllm-sly-radiance/issues/164 : Cactus repetition lock-in, symptom, maintainer analysis, workaround
- https://github.com/SlyBase/vllm-sly-radiance/releases : 1.9.0 fade/cap env vars, 1.9.1 template replay fix, measured loop rates
- https://huggingface.co/Qwen/Qwen3.8-27B : sampling for thinking mode, presence_penalty guidance, reasoning_effort note
- https://huggingface.co/RedHatAI/Qwen3.8-27B-MXFP4 : quantization recipe, accuracy recovery, deployment command
- https://huggingface.co/slybase/Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ : lineage, weight-only GPTQ, no published quality
- https://huggingface.co/syvai/Qwen3.8-27B-DFlash2-W4A16 : drafter target and recommended settings
- https://docs.vllm.ai/en/latest/api/vllm/v1/sample/thinking_budget_state/ : vLLM thinking budget mechanism (via search result)
- https://github.com/vllm-project/vllm/pull/37112 : closed reasoning_budget PR
- https://huggingface.co/RadixArk/Qwen3.8-Flash-Next-NVFP4/discussions/3 : spec-decoding corruption report (Tier-2)
- https://ai-muninn.com/en/blog/dgx-spark-fp8-kvcache-repetition : uncalibrated fp8 KV repetition (Tier-2)
- Local MEASURED: `heretic|redhat/session-*.jsonl`, `heretic/server-container.log`, `docker logs vllm-8000`, `*/server.cmdline`, `/opt/qwen-fixed.jinja`, container `vllm/v1/worker/gpu/spec_decode/rejection_sampler_utils.py`, `vllm/entrypoints/anthropic/{serving,protocol}.py`, `radiance_lmhead_int4.py`, `radiance_embed_int8.py`, `radiance_r4d_hybrid_attn.py`, model dirs under `/mnt/Lin1/work/vllm/sly-radiance/models/` (`config.json`, `recipe.yaml`, `README.md`), `bench/engine-bench/vllm/warmup/claude-first/req-001_v1_messages.json`, `docs/vllm/{settings,known-issues}.md`, `bench/engine-bench/vllm/profiles/**`
