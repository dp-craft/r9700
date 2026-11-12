# dpf brief-fix A/B — Swift-1.5 heretic vs RedHat MXFP4 (both + DFlash2, Sly 1.8.1) vs the Opus reviews

Raw data for one agentic quality test: each local 27B runs dp-forge's 27B brief-fix RUNBOOK
(`docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md`) on the three briefs left in it,
W2-06 · W2-07 · W2-08: A blind review → B compare with the Opus review → C fix → D progress line.
The write-up (comparison, grading summary) is `docs/findings/agentic/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md`; everything it cites is here.

## Layout

```
README.md                 this file
run_all.sh, run_arm.sh    the driver as run (one-off; no repo tool runs a headless agentic task)
opus-reference/           the reference: Opus reviews W2-06/07/08 (dp-forge @ de110510) + findings.tsv (39 rows)
heretic/  redhat/         one dir per model, same layout:
  driver.log              timeline: boot, each claude call, resumes, cap, teardown, stray-write check
  summary.txt             wall_s, calls, session id, W2 progress lines
  server-start.txt, server.cmdline, server-stop.txt   the vLLM server as booted (profile, image, full argv)
  gpu_samples.csv         vram_sampler.py, 2 s interval, whole session
  session-N.jsonl/.err    claude -p stream-json per call (N=0 first prompt, N>0 resumes) + stderr
  claude-project/         Claude Code's own transcript dir for the worktree
  worktree-add.txt, wt-status-before.txt, wt-status-after.txt, wt.diff   worktree state and every tracked-file change
  inputs/                 the W2 briefs + progress.md as the model got them
  outputs/                W2-0x.md (fixed briefs), W2-0x.refine-27b.md (blind reviews), W2-0x.compare.md, progress.md
  dp-refine/              /tmp/dp-refine probe files the model wrote (moved here after the run)
  main-fp-before/after.txt  fingerprint of the main dp-forge checkout (stray-write check)
  metrics.json            (added after the run) turns, tool calls, tokens, compactions, empty replies, cap hits, runaway blocks, rule breaks
  grading.md              (added after the run) every Opus finding and every model-only finding, graded with evidence
  server-container.log    the vLLM container's full log, boot to stop (spec-decode acceptance every 10 s)
metrics.py, opus_reuse.py post-run tools (metrics.json; Opus-code reuse in the fixed briefs)
redhat-loop-research.md   why RedHat loops: log forensics, server signature, engine knobs, sources, fixes
replay/                   replay A/B of one captured W2-08 request (B capture + A x3 control; see Status)
delta0-w208/              W2-08 to the end on RedHat with CACTUS_DELTA=0 (same layout as redhat/, W2-08 only), part 1
delta0-w208-part2/        the same session resumed after part 1's 1 h cap
replay-tools/             run_replay.sh, replay.py, pick_body.py, stop_if_stable.sh, continue_w208.sh, continue_w208_v2.sh as run
slowness.py, slowness.json, slowness.md   why RedHat is slow: time split, tokens, context, compactions, repetition, template
digest.py, thinking-digest/   sampled thinking blocks per run (input of the qualitative haiku read)
compliance.py, compliance.json   RUNBOOK compliance counters per brief window
templates/                the served chat templates (1.8.1: froggeric v22.5; 1.9.1: v22.5-sly2) + their diff, the models' stock
                          template, the froggeric README; render_test.py/.txt = which tool-chain steps' reasoning each one replays
sly191-w208/              W2-08 on RedHat, Sly 1.9.1 defaults (Cactus 0.5 + fade/cap, template v22.5-sly2) + the token-budget
                          RUNBOOK (RUNBOOK.orig/optimized/diff); driver run_redhat_w208.sh; same layout as redhat/
template_tokens.py/.json  which template each W2-08 session ran + its prompt tokens with the other template (needs tokenizers)
```

## Setup (identical for both arms except the model)

- dp-forge worktree at `de110510` (`/home/dev/work/dippe/dpf-bench-<arm>`) + the uncommitted W2-06/07/08 briefs
  (written by the 27B on 2026-10-29) and `progress.md` (9 W1 lines) copied in. The `Repo <path>` line of the three W2
  briefs and of `01-writer-brief.md` was rewritten to the worktree path so no edit lands in the main checkout.
  `node_modules` dirs symlinked from the main checkout.
- Prompt = the user's 2026-10-29 runbook prompt, first paragraph verbatim. Resume prompt (same session, only if fewer
  than 3 W2 lines are recorded): `Continue: follow …/RUNBOOK.md exactly; resume after the last line of review/27b-fix/progress.md.`
  At most 5 resumes, 3 h wall-clock cap per arm.
- `claude -p … --settings <settings> --dangerously-skip-permissions --output-format stream-json --verbose`.
  heretic: dp-forge `vllm-heretic.sh` + `local_vllm_direct/settings.json` (served `swift-1.5`);
  redhat: dp-forge `vllm.sh` + `local_vllm_direct/settings-redhat.json` (served `qwen38-27b-redhat-mxfp4-dflash`).
  Both: Sly 1.8.1 sly-official engine layer, DFlash2 k=7, window 262000, MAXSEQS 1, fp8 KV, util 0.93.
- Order: heretic first, then redhat (one GPU). `/tmp/dp-refine/` emptied before each arm.

## Status (2026-10-30 19:40 local)

| Part | State | Result so far | Where |
|---|---|---|---|
| heretic arm | done 10:32 | Finished all 3 briefs in 41 min (1 call). Blind recall 11/39 (high 6/10); 19/20 own findings real. Fixes mostly Opus's code; W2-06 fix not lint-clean. 1 runaway thinking block (output-cap hit), recovered | `heretic/grading.md`, `heretic/metrics.json` |
| redhat arm | done 13:35 (3 h cap) | **Did not finish:** 0/3 progress lines. W2-06 only: blind recall 3/9 (incl. O5, which heretic missed), 3/3 real; compare accepted all 9 with no own verification; 1/9 fixes in the brief. 9 runaway blocks, 8 output-cap hits, 15 failed compactions, `Prompt is too long` at 237k context | `redhat/grading.md`, `redhat/metrics.json` |
| Loop root-cause research | done | Every runaway block (both models) coincides with spec-decode acceptance pinned at the max (7.8–8.0 of 8) vs 4.5–5.5 normally (MEASURED). Matches Sly #164: the Cactus acceptance rule `RADIANCE_CACTUS_DELTA=0.5` changes the sampled distribution (MEASURED in the image's kernel) and locks in repetition (CLAIMED). Co-factors: 1.8.1 template replays old reasoning; effort high | `redhat-loop-research.md` (Sonnet subagent, read-only; key claims re-checked by the main session) |
| Replay A/B | done, cut down (13:35–13:49) | Planned: capture one W2-08 request, replay it 5× on each of 4 configs (**B** `CACTUS_DELTA=0` · **A** 0.5 · **C** 0.5 + presence_penalty 0.3 · **D** MTP head). What ran: the **B capture** (real Claude Code session on W2-08, delta 0): 28 requests in 4.5 min, 0 runaway blocks, largest thinking block 7.8k chars, every thinking line distinct, acceptance 3.6–5.3. It stopped early: the trigger fired on the first Write to `W2-08.refine-27b.md`, which was Part 1 (derivation) only; the model writes Part 2 (findings) separately (trigger design error). `stop_if_stable.sh` then skipped the B replays, C and D (user: stop if stable) and ran **A ×3** on the same request: 0/3 loops, acceptance mean 3.85, 0 windows ≥ 7. **Neither delta loops on this request, so it says nothing about the cause.** | `replay/` (driver.log, results.jsonl, `A-r*.json`, `capture-*`, server cmdlines + logs), tools in `replay-tools/` |
| W2-08 to the end, delta 0 — part 1 | done 14:59 (1 h cap) | Resumed the B capture's session (same worktree) on a `CACTUS_DELTA=0` server. **Stable for 64 min** (4.5 capture + 60): 0 runaway blocks, 0 output-cap hits, 0 empty turns, **3/3 compactions OK, 0 failed**; largest thinking block 56.6k chars (223/230 lines distinct); acceptance mean 3.40, 0 of 352 windows ≥ 7 (10 s windows with generation > 5 tok/s). The δ 0.5 run had ~3 loops/h. Blind review written (13:43:28Z, before the first Opus read at 13:43:36Z): **9/19 Opus findings, 4/6 high** (heretic: 4/19, 3/6) + 4 own, likely real (preliminary, INFERRED). Ran out of time in step B (compare); no fix, no progress line. **Cost: decode 70.4 tok/s** vs 113.2 tok/s in the δ 0.5 run's normal windows (acceptance 5.28) and 102.9 for heretic, i.e. about −38 % (INFERRED: different content and depth). In the δ 0.5 RedHat run 777 of 1,067 decode windows (73 %) were loop windows (acceptance ≥ 7) | `delta0-w208/` (`session-0.jsonl` = copy of the capture; `metrics.json`; `summary.txt` says `continuation_calls=2`, true count 1), driver `replay-tools/continue_w208.sh` |
| W2-08 delta 0 — part 2 | done 15:49 (47 min) | **W2-08 finished**, progress line in the RUNBOOK format. Still 0 runaway blocks, 0 cap hits, 3/3 compactions OK. Compare: ~30 verification tool calls, **rejected 2 Opus findings with reasons** (O7, O18; both arms accepted all). Fix: 20/20 of its real findings in the brief, own design (21 % Opus code reuse vs heretic 67 %), final probes 0 lint errors + 1 warn, tsc clean, base sha updated. Cost: W2-08 took ~111 min vs heretic's ~12 min (~5-7× more work, 1.5× slower decode) | `delta0-w208/grading.md` (A-E for both parts), `delta0-w208-part2/` |
| Comparison doc | done 15:52 | heretic vs RedHat δ 0.5 vs RedHat δ 0 vs Opus: summary table, loop cause and fix options, quality per RUNBOOK step, weak spots per model, limits, tool recommendation | `docs/analysis/2026-10-30-1552-dpf-brief-fix-heretic-vs-redhat.md` |
| Why slow + template | done 16:50, added to the doc | W2-08 RedHat δ 0 vs heretic: **8.7× session time = 6.8× generated tokens (490k vs 72k) × 1.35× slower decode (75 vs 102 tok/s)**; 4.8× the steps, 1.4× the thinking per step, 6 compactions (21 min) vs 1. Not context (median 90k vs 103k), not tools (2.4 %), not literal repetition (distinct 0.96 vs 0.93). δ 0.5: loops (75 % duplicate lines, 133 "Wasted call" re-reads). Template = froggeric v22.5 (latest upstream, byte-identical), the same for both; it replays all old reasoning (MEASURED: next prompt +1.07-1.10× the output) and turns effort high into xhigh; RedHat ships the stock Qwen template unchanged. Sly 1.9.1's `v22.5-sly2` would stop the replay (CLAIMED) | `slowness.md`, `slowness.json`, `thinking-digest/`, `templates/` |
| Rule compliance | done, added to the doc | On W2-08 heretic broke the RUNBOOK's expensive required steps (whole brief read before the blind derivation, 0 probes in A, 19/19 Opus rows accepted with 22/26 evidence refs copied from Opus, one combined "tsc: none" probe line, old SITES sha, no RUNBOOK re-read after its reset). RedHat δ 0 followed them (68 vs 6 tsc/eslint runs, 26 B checks) but broke "Read ≤ 80 lines" 13× (427k vs 77k chars of tool results). Compliance explains most of the extra steps and the quality edge; no rule bounds the work | `compliance.json`, doc § "Rule compliance" |
| W2-08, RedHat on Sly 1.9.1 + budget RUNBOOK | done 19:29 (87 min, 1 call) | Config: Sly 1.9.1, `RADIANCE_CACTUS_DELTA=0.5` + fade 4096→16384 + cap R 0.5 (code defaults), template `v22.5-sly2`, budget RUNBOOK; inputs/prompts/settings/cap as the δ 0 W2-08 run. **Faster:** 87 vs ~111 min; 2 compactions vs 6; decode 102.0 tok/s in non-loop windows vs 74.5. **Fix good:** all 6 high Opus findings fixed (15/19 + 2 partial), final probe tsc 0 / eslint 0 (re-run), 12 % Opus code; O7's code stayed in the probe. **Review collapsed:** blind 1/19 (high 1/6), 0 probes in A; B 7 tool calls, 2 of 3 rejections wrong (O12, O19). **Loops back, shorter:** 3 decision loops, 1 output-cap hit (241k chars on the progress count), 11.3 % loop windows. Incident: blind review first written into `opus/W2-08.md`, restored by the model with `git restore` (content identical, blind kept) | `sly191-w208/grading.md`, `metrics.json`, `compliance.json`, `template_tokens.json`, doc § "RedHat on Sly 1.9.1" |

Data notes:
- Both container logs are kept in-run: `*/server-container.log`. `bench/.servers/8000.log` is overwritten on every stop.
- `redhat/summary.txt` says `calls=7`; the true count is 6 (driver off-by-one).
- `metrics.py` and `opus_reuse.py` (post-run tools) are in the run root.
