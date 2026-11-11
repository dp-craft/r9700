# TODO

Deferred items with a blocking precondition. Owner decisions live in
`amd-private/notes/restructure/2026-11-07-final-report.md` ("Needs your decision").

## GPU gate — needs the GPU (27B vLLM on :8000 must be stopped first; owner: "not now")

- [ ] Stop the 27B vLLM (`~/.config/claude/local_vllm_direct/vllm.sh stop`) — needs the owner's yes (it also serves subagents)
- [ ] Start/stop llama-swap once and check the models serve (plan 2.8)
- [ ] Boot one vLLM profile end to end (plan 2.8)
- [ ] `stack/gpu/gpu_exclusive.sh` with a free-VRAM floor (plan 2.8)
- [ ] One tiny throughput campaign end to end: raw → `tmp/`, rows → `results/`, charts + `gpu_peaks.json` (plan 3.6)

## Owner run — real docker, no GPU (2026-11-11)

- [ ] Run `bash stack/serve/vllm/tests/starters_test.sh` once: `1742be1` changed its C6/C8d ornith calls to a settings
      fixture on port 19995 (the radiance starters now let the settings file's port win), and it was not run (it uses
      real docker and the real settings file). It never targets port 8000.

## stack repo (github.com/dp-craft/stack — pushed 2026-11-07, commit 4a750a1)

- [x] Write the stack repo's `README.md` — done 2026-11-07: `stack/README.md` (231 lines; overview, layout, quick start, current status, links to the three dir readmes + back to `dp-craft/r9700`), commit `4a750a1`. Facts verified by the main session against repo sources; one error (templates symlink) fixed before commit

## Re-review subagent work — operating mode (from 2026-11-08)

This main session itself runs on **Ornith** (`rad-ornith`). So:
- **All delegated subagents run strictly SEQUENTIALLY (one at a time, max 1 concurrently).** Do not parallelize — this
  session + 2 background subagents would put 3 full sequences on one card and risk an OOM. One background non-model scan
  is fine; never two subagents. Briefs are in `amd-private/briefs/` (Ornith variants named `-ornith.md`). Free-checks
  between runs stay on the mechanical side (sha256 / hash diffs / grep) — NOT judgement work.
- **Do NOT attempt complex/judgement tasks inline.** The items below need a stronger model. Add them here, do not solve:

### R7 done this session (2026-11-08) — PASS (mechanical, no judgement needed)
- [x] **R7 recipe fidelity across all 30 old campaign dirs** → `notes/tmp/2026-11-06-1958-b0f4c2d5/21-ornith-review-r7.md`.
      Independently verified by the main session's own Bash (the delegated Ornith run was sandbox-blocked and reported
      failed). Result: **PASS** — 121 CHANGED recipe files, all whitelisted-only (`spec.json` `"date"`; README/docs `<!--meta-->`+path strings; analysis→findings rename meta+relative paths; `.sh` two-root re-emit per plan `63107b4`). No
      `configs.jsonl`/`tasks/*.jsonl`/`calibration*.jsonl` in the CHANGED set → config/task matrices byte-identical. 0 MISSING, 0 UNCLASSIFIED, 0 real content-loss. Delegated run was blocked by sandbox (no mirror access) — free-checks needing the
      mirror should be done by the main session's Bash, not `local.sh`.

### Deferred to a later stronger model (Opus/Sonnet) — do not run on this session
- [ ] **Phase-2 consolidation report** (`amd-private/notes/restructure/2026-11-08-review-report.md`): per-item verdict table,
      every UNEXPECTED diff, fixes applied (separate commits), Phase-0 re-run results, residual list. Then commit plan+report in amd-private.
- [ ] **R3 — findings/research/guides content classification** (`find /dev/null`-style DELETED-line classification:
      path-string \| replaced \| UNEXPECTED). Ornith is weak on path recall + fine judgement here (per `refs/ornith.md`).
- [ ] **R9 — root README.md + CLAUDE.md grading** vs owner criteria (user-friendly / minimal / complete) + edit list. Grading = judgement.
- [ ] **Semantic review of any Ornith diff-classification result** that feeds a published cell/conclusion before it lands in the report.

### Deferred because GPU-gated (unrelated to the above; still needs the owner's yes per existing gate)
- [ ] Stop 27B vLLM → llama-swap serve, one vLLM profile, `gpu_exclusive.sh` floor, one tiny campaign end-to-end (see top of this file).

