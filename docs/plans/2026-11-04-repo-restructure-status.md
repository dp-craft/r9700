# Repo restructure: planning status

Living status for the publishable-repo cleanup. New findings are appended as each audit reports.
**Nothing has been moved or deleted.** This file is the only repo change so far, and it is uncommitted.

**Evidence levels:** audit findings are reported by Haiku subagents and have not been independently
checked. Everything under "Provisional recommendations" can change until all audits are in.

## Audit progress

| ID | Scope | Status | Detail file (session scratchpad) |
|----|-------|--------|----------------------------------|
| C1 | Campaigns: July small (6) | running | `audit-c1.md` |
| C2 | Campaigns: 07-13 27B quality (2) | **stopped by owner, not rerun** | none |
| C3 | Campaigns: hardest-tasks, Ornith vs Gemma (2) | running | `audit-c3.md` |
| C4 | Campaigns: September, 10-22 vLLM (5) | running | `audit-c4.md` |
| C5 | Campaigns: 10-30 vLLM depth (10) | running | `audit-c5.md` |
| C6 | Campaigns: W2-08 agentic (5) | running | `audit-c6.md` |
| R1 | `bench/runs`: July + ABORTED (67 dirs) | **done** | `audit-r1.tsv` |
| R2 | `bench/runs`: September (57 dirs) | **done** | `audit-r2.tsv` |
| R3 | `bench/runs`: October, November (102 dirs + 4 logs) | **done** | `audit-r3.tsv` |
| D1 | `docs/analysis` (31) + README check | running | `audit-d1.md` |
| D2 | `docs/research` (59) | **done** | `audit-d2.md` |
| D3 | Plans, articles, brainstorm, vLLM docs, `mrcr_v2` | **done** | `audit-d3.md` |
| K1 | Core bench tooling, legacy, skills | running | `audit-k1.md` |
| K2 | Engine scripts, llama-swap, root scripts | running | `audit-k2.md` |
| S1 | Publication safety | running | `audit-s1.md` |

Scratchpad: `/tmp/claude-1001/-home-dev-work-dp-craft-amd/192814b7-7136-4999-8e8c-c469bd3a3bab/scratchpad/`

## Working rules

- Only Haiku subagents read and collect data, including regenerating result files.
- Opus finalizes docs, and only where that is reasonable.
- Audits run in parallel in context-sized batches (owner's instruction, overrides rule 19 for this job).
- Report partial results immediately in this file.

## Open decisions for the owner

1. **C2:** rerun on Haiku, or leave out? Without it, `2026-07-13-27b-quality-at-depth` and
   `2026-07-13-27b-quality-tuning` (about 23 MB) have no audit.
2. **`2026-09-11-1756-batched-2x32k`:** valid 2-stream 32k build comparison, uncited. Keep or drop?
3. **`2026-07-31-1730`, `-1921`, `-2000`, `-1955`:** uncited 27B Q4 MTP depth points. Only the 64k
   point is published, and rule 16 needs at least 4 depths. Keep to complete the curve, or drop?
4. **Git history:** `.git` is 306 MB, so removing files from the tree will not shrink it or remove
   their content from history. Fresh public repo, or filtered history? Waiting on S1.
5. **Remote visibility:** `dp-craft/r9700` could not be checked because `gh` is not installed. Is it
   private today?

## Baseline inventory

Collected directly in the main thread, before the Haiku-only rule.

- 7,095 tracked files, 130 commits, one author.
- Tracked size by area: `bench/runs` 242.04 MB, `campaigns` 47.75 MB, `docs/plans` 8.97 MB,
  `bench/workloads` 6.80 MB.
- `2026-10-30-0947-dpf-brief-ab` alone is 114.86 MB (309 files).
- A regex scan of the working tree for common API key formats found nothing. **History has not been
  scanned yet** (S1), so this does not clear the repo for publishing.

### External consumers: must keep working

| Consumer | Depends on |
|----------|-----------|
| `~/.config/llama-swap` symlinks | `llama-swap/{restart_llama_swap.sh,start_llama_swap.sh,opencode-model-notes.md}` |
| `~/.config/llama-swap` symlinks | `bench/engine-bench/radiance/serve_radiance.sh`, `vllm/serve_vllm.sh`, `vllm/templates` |
| `~/.config/llama-swap` symlinks | `bench/engine-bench/claude/{monitor.sh,claude-sly-heretic.sh,claude-sly-redhat.sh}` |
| `dp-forge` root symlinks | `llama-swap/{restart_llama_swap.sh,start_llama_swap.sh}` |
| `dp-forge/monitor.sh` | `cd ~/work/dp-craft/amd/bench/engine-bench/claude` |
| `~/.config/llama-swap/generate.py` | `build/latest-{vulkan,rocm}/bin/llama-server`, `bench/dl/radiance-cache` |
| `~/.config/llama-swap/config.yaml` | `build/latest-{vulkan,rocm}/bin/llama-server` |
| `~/.config/claude/local_vllm_direct/vllm.sh` | `vllm/serve_vllm.sh`, `vllm/templates/dp-sharp-chat_template.jinja` |
| `~/.config/claude/local_vllm_direct/vllm-heretic.sh` | `vllm/serve_vllm.sh` |

The repo's `llama-swap/generate.py`, `models.yaml` and `config.yaml` differ from the live copies in
`~/.config/llama-swap` (K2 is checking which is the source of truth).

## Provisional recommendations

- **Run data:** of all 226 run dirs, 66 keep an aggregate only, 110 move to the archive, 50 are noise.
- **Agentic transcripts leave git:** 189.1 MB of the 203.1 MB marked keep in R3 is session transcripts.
  Keep their small result files (11.1 MB at most, some of it transcript-like and still to be sorted).
  Whether transcripts may ever be public waits on S1.
- **Fix before publishing:** rule 18 conflict from error rows inside published data, and build-check
  docs that may report numbers from crashed ROCm arms. See the R3 findings below.
- **Fix `.gitignore`:** 54 `.log`, 70 `.err` and 53 transcripts are tracked in the R3 batch alone, though
  CLAUDE.md says logs are ignored.
- **Plans and brainstorm:** archive nearly all of it. Keep only `2026-10-25-vllm-llama-swap-path.md`.
- **Articles:** do not republish as they are. All four are from July on the older 27B and b9950, and the
  three worth keeping need the fixes listed under D3. Rewrite decision comes after D1.
- **`mrcr_v2`:** drop the vendored upstream tree and keep only our result, marked as a partial run.
- **Changed from the D3 audit:** D3 suggests moving 212 raw plan logs (8.7 MB) to `bench/runs/`. I
  recommend the archive instead, since raw logs are what we are taking out of git.
- **Decision for the owner:** do you plan to publish in Hungarian? If not, the HU articles go to the
  archive too.
- **Order matters:** fold archived child dirs' raw rows into the kept parent aggregate **before**
  removing them from git (R2 method note).
- **Research:** keep 11 of 59 files in 6 topic folders, and archive the rest.
- **Published claims:** do not publish "ROCm ~92x slower" without a warning. See the R1 findings below.

## Findings log

### D2: `docs/research`

- Keep 11, archive 48 (14 reports, 34 non-report files in the hipfire folder). One of the 48 is a stray
  `.pyc` to delete, and four are quarantined runs.
- Keep groups: RDNA4 driver/engine stack (2), benchmark methodology and quality evals (2), sampling,
  thinking and context (4), models (1), hipfire verdict (1), fine-tuning (1).
- Overlaps that could collapse: Qwen3.6 sampling, llama.cpp RDNA4 tuning, harness, fine-tuning, the
  hipfire folder, driver/kernel upgrade, thinking volume. `07-16-1016` (MTP) contradicts its own erratum.
- **Private content to scrub:** `07-14-1550` names `AiChatney`. `07-19-1821` has absolute `/home/dev`
  cache paths. Hipfire files 04 and 05 name `dp-forge`.
- **Broken links:** the hipfire README and files 01-05 point at files that do not exist.
- Tracked noise outside this batch: 16 more `.pyc` files, an `outputs.jsonl.bak` in
  `campaigns/2026-07-19-ornith-vs-gemma/out/`, and `unsloth_compiled_cache/`.
- **Not verified:** no web access, so vendor and upstream claims are unchecked. `07-12-2300` (vLLM AITER
  status) and `07-13-1712` (two unverified citations) need a re-check before publishing.

### R2: `bench/runs` September

| Action | Dirs | MB |
|--------|-----:|---:|
| Keep, aggregated | 14 | 7.32 |
| Archive | 32 | 2.98 |
| Drop as noise | 11 | 0.78 |

- **Bad rows in a kept result:** the muse parent `results.jsonl` holds 5 bad rows from `2026-09-15-2203`
  (errored d32768 attempt) and `-2205` (degenerate d65536/d98304). Filter before keeping.
- **Aborted or empty:** the three `1025` dirs printed usage text and never ran. The three `1029` dirs
  are 0-byte. `2026-09-12-1345` is a smoke test.
- **Rule 2 gaps:** `2026-09-12-1330` and `2026-09-12-1345` have no `meta.txt`.
- Kept dirs that still need aggregating: `2047` (243 files, including `quarantine/` subdirs) and `1330`
  (a 16-row quarantined arm).
- The 2026-09-10 hipfire contamination in CLAUDE.md matches no dir in this batch.

### R1: `bench/runs` July + ABORTED

| Action | Dirs | MB |
|--------|-----:|---:|
| Keep, aggregated | 12 | 2.85 |
| Archive | 34 | 6.50 |
| Drop as noise | 21 | 3.67 |

- **Check before archiving:** `2026-07-11-2244-campaign-combo35b` is an uncited re-run with 4 failures,
  against 8 in the cited `1844`. Does it fix those failures?
- **Keep despite no name citation:** `2026-07-12-27b-serving-substrate-cachereuse`, because analysis
  lines 70-71 depend on it.
- **Weak evidence:** `2026-07-13-0836-engine-hip-pf-cr32000` is the only source of "ROCm ~92x slower"
  and has one results row; the rest is in gitignored logs. CLAUDE.md says the figure did not hold in a
  later run (prefill about 600 tok/s).
- **Links that would break:** `bench/README.md:78` (`2026-07-13-0734`) and `:83` (`2026-07-11-1734`).
- **Empty evidence:** `campaigns/2026-07-12-27b-maxctx-f16/analysis.md:22` globs `2026-07-12-0021`,
  which has 0 rows.
- **Duplicate:** `2026-07-11-deep-context` has the same 41 rows as `2026-07-11-2200-deep-context`, with
  different file bytes.
- **Partial check only:** of the 07-13 arms, `0734` and `0746` match the consolidated
  `2026-07-12-27b-serving-substrate` values exactly. The other 11 were matched by label only.

### R3: `bench/runs` October, November

| Action | Dirs | MB |
|--------|-----:|---:|
| Keep, aggregated | 40 (+3 logs) | 203.1 |
| Archive | 44 (+1 log) | 10.4 |
| Drop as noise | 18 | 4.4 |

The keep figure is raw size today, not what stays in git.

| Agentic dirs (8), by content | Files | MB |
|------------------------------|-----:|---:|
| Session and `claude-project` transcripts (`dpf-brief-ab` alone: 103.4 MB) | 53 | 189.1 |
| Small result and aux files | 490 | 11.1 |
| Logs (not read) | 61 | 4.1 |

- **Groups (keep/archive/drop):** llamacpp-buildcheck-oct 18/0/12, redhat-sly191-depth 6/17/0,
  redhat-sly-depth 3/9/0, mx-conv 1/5/5, dx-conv 1/5/0, radiance-depth 1/3/0, heretic-sly-depth 1/3/0,
  fill170k 1/1/0, sly-smoke 1/1/0, w208-agentic 5/0/1, dpf-brief-ab 1/0/0, agentic-thinking-volume 1/0/0.
- **Safe to archive:** 43 per-point dirs are exact line-subsets or a copy of their campaign parent,
  checked line by line. This is stronger evidence than the label-only match in R1.
- **Duplicate kept dir:** the 2026-10-30 `dflash-vs-mtp-merged` dir duplicates the union of two parents.
- **Drop:** the five 2026-10-22 `133x`/`1335` mx dirs are pre-fix capture runs ("no tokens received"),
  and the `attempt1-falsestop` dir.
- **Rule 18 conflict:** three `no tokens received` error rows remain in published data: mx-conv turn 8 in
  the mx parent, and fill170k turn 7 in both the child and the 170k parent.
- **Crashed ROCm arms:** nine arms hold a gdb backtrace in `llama-bench.json` instead of results.
  Orchestrators `2026-10-07-1221`, `2026-10-08-1311` and `2026-10-08-1436` have no valid arm, and their
  docs say FAILED. The docs for `1326` and `1527` contain no crash wording. **Not checked:** published
  numbers were not compared with the arm data, so this is an open question, not a confirmed error.
- **Uncited but needed:** `1207`, `1209`, `1215`, `1216`, `1316-model`, `1320`, `1327`, `1527-model`,
  `1555-model` are the only raw numbers behind cited build-check orchestrators. Marked keep.
- **Doc drift:** `bench/.gitignore` only ignores `runs/*/invocations/*.err`, and `bench/runs/INDEX.md`
  was built 2026-09-16, with no October or November entries.
- **Not checked:** the four top-level `.log` files were classified by citation only, and transcripts
  were not checked for personal data. S1 covers transcripts.

### D3: plans, articles, brainstorm, vLLM docs, `mrcr_v2`

| Cluster | Files | Recommendation |
|---------|-----:|----------------|
| `docs/plans/2026-10-22-mxfp4-qwen38-options` | 227 (9.36 MB) | Archive PLAN, FASTPATH, ISSUE-SUMMARY; move repro scripts and fixtures to `bench/engine-bench/vllm/repro/`; raw logs (212 files, 8.7 MB) leave git |
| Top-level `docs/plans` | 5 | Archive 4 shipped or superseded; keep `2026-10-25-vllm-llama-swap-path.md` (Plan B still open) |
| `docs/brainstorm` | 9 | Archive (parked, the work was done later) |
| `docs/vllm` | 7 | Keep; scrub `dp-forge`/`dpf` and one `/home/dev` path |
| `docs/GUIDE.md` | 1 | Keep; fix `/home/dev` paths and the stale `bench/llamacpp*` location |
| `_diag.txt` | 1 | Drop (empty) |
| `analysis_summary_last_run.md` | 1 | Drop (**contains a LAN IP**) |
| `MODELS_INFO_COMPARISON.md` | 1 | Archive (the seven files it grades are not tracked) |

**Articles** (all 2026-07-16, Qwen3.6-27B on llama.cpp b9950):

| Article | Verdict | Needs |
|---------|---------|-------|
| 27B coding model on one AMD card | Keep after fixes | The 2.25x compares different fine-tunes (same-model figure: 2.0x); VRAM "GiB" values are really MiB; "100% accuracy" covers only the 11 deterministic tasks |
| Four things we were wrong about | Keep after fixes | Corrections still hold; "shallow only" caveat and the 2048 depth recommendation are stale, since the 128k campaign measured depth |
| Free lunch hiding in defaults | Keep after fixes | Tag its uncited generalization; add a depth caveat |
| How we know we didn't fool ourselves | Archive | Duplicates the "four things" piece |

- Variants: EN `.linkedin.md` to `docs/articles/linkedin/` as posting drafts. HU long-form to
  `docs/articles/hu/`, only if publishing in Hungarian. Drop HU `.linkedin.hu.md`.
- Images: `reasoning_budget_sweep.png` to `docs/articles/assets/`; drop the unreferenced
  `quality_vs_cost.png`.

**`mrcr_v2`:** upstream is Google DeepMind's MRCR v2, Apache-2.0, with no recorded version.

- **Result:** Qwen3.8-27B UD-Q6_K scored 0.850 on the 65k-131k bucket, **35 of 103 rows, CI ±0.113**.
  That is a partial run and must be labeled as one wherever it appears.
- **Move:** the result doc to `docs/analysis/` (needs MEASURED tags, a meta block and an INDEX entry) and
  `run_local.py` to `bench/lib/`. The CSV stays with the result; the log leaves git.
- **Drop:** the vendored upstream tree, since `download.sh` re-fetches it.
  **Reproducibility gap:** with no recorded upstream version, pin a commit before dropping it.

**Restructure risk:** 102 campaign script files depend on `bench/` paths, so moving `bench/` is expensive.
`bench/llamacpp*` and `bench/dl` references are already missing on a fresh clone because both are
gitignored. Full path list: `audit-d3.md` section 5.
