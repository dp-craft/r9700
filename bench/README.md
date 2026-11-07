# bench/ — the benchmarking harness

## What this is

A **reproducible benchmarking and tuning harness for local LLM inference**. It answers two
questions people usually answer with folklore and one-off runs:

1. *"What is the fastest configuration of this engine on my GPU?"* — not "which of the three
   values I happened to try", but a real optimum, **bracketed on both sides by measured,
   slower neighbors**.
2. *"Which engine/config wins on my actual workload?"* — long-context code review, thinking-mode
   reasoning, and **N parallel agent streams**, not synthetic 512-token prompts.

Born on an AMD Radeon AI PRO R9700 (RDNA4, 32 GB), but **vendor-parameterizable**: AMD/NVIDIA is
auto-detected (`stack/gpu/gpu_env.sh`), the cross-engine track is pure HTTP, and the tuning track runs
against any llama.cpp build you point it at (ROCm, Vulkan, CUDA, Metal…).

## What it can do

- **Adaptive optimum search** (`perf/model-bench/sweep.py`): coordinate descent over `-ub` → `-b` →
  `-fa`; each axis grid *expands* (×2/÷2) while the best value sits on a boundary, and stops only
  when the peak is interior or a hard cap/OOM is hit. Ties inside the ±3% noise band are flagged
  `plateau_within_noise`, not sold as wins.
- **KV-cache acceptance rule built in**: at the winning config it A/Bs f16 vs q8_0 KV *at the
  target context depth* and accepts q8_0 only if prefill AND decode lose ≤5% — reporting the
  measured VRAM saving (= extra context / extra parallel slots) either way. "f16 OOMs where q8_0
  fits" is recorded as a finding.
- **Serving-combo matrix** (`perf/engine-bench/campaign.sh`): backend × MTP (speculative decode) ×
  KV type × context depth (8K→64K) × concurrency (1/2/4) on real workloads, with server
  restarts handled, per-point failure tolerance, and **resume** after interruption. This is where
  llama-bench optima get validated at the real serving operating point (they don't transfer
  automatically to `-np`>1 + MTP).
- **Agentic / parallel measurement** (`bench/core/capture_engine.py (probe mode)`): concurrency waves against
  any OpenAI-compatible endpoint; per-stream *and* aggregate tok/s, TTFT p50/p95, measured
  `ttfa_s` for thinking models (chat template applied), cold-cache (`unique`) vs shared-prefix
  modes, server-reported token counts. Zero install. For community-comparable synthetic curves,
  **llama-benchy** is installed and wired in as an alternative backend.
- **Realistic, reproducible workloads** (`workloads/`): prompts padded from a tracked real-code
  corpus (TypeScript + Python incl. tests, ~565K tokens), token-calibrated against the actual
  tokenizer (±3%), with per-stream variants for concurrency tests. The builder fails loudly if a
  target size can't be filled.
- **Full provenance, automatically**: every run dir gets `meta.txt` (GPU/driver/build/knobs),
  the exact server command line + `/props`, raw per-invocation JSON, and **VRAM/power samples**
  during the run (OOM headroom + throttling detection). An unversioned number never ships.

## What you get out of it

- A `sweep-summary.json` with the tuning curves, the KV verdict, and a **copy-pasteable
  recommended `llama-server` command**.
- A campaign `results/results.jsonl` (per-request + aggregate + `gpu` memory rows) that turns into a
  report at `docs/findings/<topic>/<stamp>-<slug>.md` (its meta block names the campaign) via the
  `/benchmark-results` skill — summary + table first (memory column mandatory), raw data linked 1:1.
- **A one-command visual report**: `core/report.py <campaign-dir>` renders a campaign (quality,
  throughput or sweep) into theme-aware **SVG charts** (`results/charts/*.svg`), a `results/appendix.md`
  that embeds them in the Markdown write-up and `results/gpu_peaks.json` (MEASURED peak VRAM/GTT per
  run, so the memory column survives the ignored sample CSVs) — tuning curves, KV verdict, quality-vs-cost, depth/concurrency,
  failure notes, color-independent data tables. Stdlib Python only; works offline.
- Honest numbers: cold prefix cache by default (identical prompts inflate "prefill" 2.4× from the
  second request — measured), chat template where raw completions would silently EOS, failures
  kept in the table instead of averaged away.

## Results so far — headline table

Every number below is **MEASURED** on the R9700 (32 GB, gfx1201): either quoted from a report's
summary (its `results.jsonl` rows) or read directly from the run dir's aggregate row (label cited).
Per-run detail: each campaign's `results/` · full write-ups: [`docs/INDEX.md`](../docs/INDEX.md). Newest first.

| Date | Campaign (run dir) | Model · stack | Headline result | Report |
|------|--------------------|---------------|-----------------|--------|
| 2026-09-15 | [muse-glimmer vulkan-vs-rocm](../campaigns/perf/2026-09-15-2016-muse-glimmer-vulkan-vs-rocm/) | Muse-Glimmer-30B Q5_K_L + dflash drafter · stew675, ctx128k f16, MTP-dflash | 4-depth curve 8k→98k: prefill 941→842 tok/s (rocm) / 865→740 (vulkan); decode 33.3→31.1 / 37.6→36.4 t/s; rocm2 re-run 899→786 pf / 28.8→26.9 dec (2301/2305 clean; 2205 pass had no token counts) | [analysis](../docs/findings/llamacpp/2026-09-15-2016-muse-glimmer-vulkan-vs-rocm.md) |
| 2026-09-15 | [stew675 vs stock buildcmp](../campaigns/build-check/2026-09-15-1029-stew675-buildcmp/) | Qwen3.8-27B Q4_K_XL · llama-bench pp128→pp32768 | stew675 patch: **+14–20 % prefill on ROCm**, decode flat, Vulkan prefill flat/slightly worse | [analysis](../docs/findings/llamacpp/build-checks/2026-09-15-1029-stew675-buildcmp.md) |
| 2026-09-14 | [b10969 build check](../campaigns/build-check/2026-09-14-2345-llamacpp-b10969/results/2026-09-14-2345-buildcmp-b10969/) | Qwen3.8-27B Q4_K_XL · Vulkan, q8_0 KV | **NEUTRAL** vs b10909 (32k-in/2k-out request −0.1 %) | [build check](../docs/findings/llamacpp/build-checks/2026-09-14-2345-llamacpp-b10969-build-check.md) |
| 2026-09-12 | [vLLM/radiance vs llama.cpp](../campaigns/perf/2026-09-12-1330-depth-curve-mtp/) | Qwen3.8-27B-INT4 · vllm-radiance R4D+MTP8 vs llama.cpp MTP | 4-depth curve: **llama.cpp+MTP wins decode at every depth by 9–33 %**; radiance's only win = prefill/TTFT at 8k; radiance decode does not decay with depth | [radiance eval](../docs/findings/radiance/2026-09-12-1055-vllm-radiance-r9700-evaluation.md) · [window budgets](../docs/findings/vllm/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md) |
| 2026-09-11 | [vLLM stock 0.29.0 + INT4](../campaigns/perf/2026-09-11-2047-vllm-qwen38-27b-int4/) | RedHatAI/Qwen3.8-27B-INT4 · stock vLLM ROCm | default attention backend collapses decode (**2.8 tok/s @32k**); `TRITON_ATTN` → **14.1 tok/s** but prefill 222 tok/s — still loses to llama.cpp b10909 (28.2 tok/s / 872 tok/s) | [vllm-int4](../docs/findings/vllm/2026-09-11-2047-vllm-qwen38-27b-int4.md) |
| 2026-09-11 | [forum tuning ideas](../campaigns/perf/2026-09-11-1950-benchy-ideas-27b/results/2026-09-11-1950-benchy-ideas-27b/) | Qwen3.8-27B Q4_K_XL · Vulkan b10909, MTP-3 | **none beats the served MTP config**: n-max5 −11/−20 %, ngram −11 %, adaptive MTP −15/−5 %, `rm_kq=1` +0.4 % tie; q8_0 KV ties f16 ≤18k, saves 4.8 GB | [benchy-ideas](../docs/findings/llamacpp/2026-09-11-1950-benchy-ideas-27b.md) |
| 2026-09-11 | [b10909 build check](../campaigns/build-check/2026-09-11-1716-llamacpp-b10909/results/2026-09-11-1716-buildcmp-b10909/) | Qwen3.8-27B Q4_K_XL · vs b10655 (Vulkan) / b10375 (ROCm) | **IMPROVEMENT both backends**: 32k-in/2k-out −6.1 % Vulkan, −14.6 % ROCm | [1537](../docs/findings/llamacpp/build-checks/2026-09-11-1537-llamacpp-b10909-build-check.md) · [1716](../docs/findings/llamacpp/build-checks/2026-09-11-1716-llamacpp-b10909-build-check.md) |
| 2026-07-31 | [27B Q4 MTP q8_0 depth ladder](../campaigns/perf/2026-07-31-1727-27b-q4-mtp-depth/results/2026-07-31-1727-engine-27b-q4-mtp-q8-cr64000/) | JackRong & unsloth Qwen3.6-27B Q4 MTP · Vulkan, q8_0 KV | 64k: pf 478/557 tok/s, dec 31.0/44.9 t/s (JackRong/unsloth); 128k: pf 310–383, dec 26.1–31.1; TTFT 136/112 s @64k (aggregate rows, labels `27b-q4-mtp-q8-*` / `unsloth-*`) | none yet |
| 2026-07-16 | [MTP sampler tax](../campaigns/perf/2026-07-16-0927-mtp-sampler-tax/results/2026-07-16-0927-mtp-sampler-probe/) | 27B-MTP + 35B-A3B · penalty samplers × MTP | any penalty sampler = **fixed ~2 ms/tok host tax** (depth-invariant to 132.9k); draft acceptance unchanged (`pp=0.01` sha1-identical reply, −30 % decode) | [sampler-tax](../docs/findings/llamacpp/2026-07-16-0927-mtp-sampler-tax.md) |
| 2026-07-13 | [serving-substrate matrix](../campaigns/perf/2026-07-13-0733-27b-serving-substrate/results/2026-07-13-0734-engine-pf-cr8000/) | Qwen3.6-27B · Vulkan vs HIP, KV f16/q8, MTP on/off | real prefill at depth 666–831 tok/s (not 75); **cache reuse: 32k TTFT 42.7→3.1 s (13.7×)**; MTP 2.0× decode; q8_0 rejected (−12/−19 % pf); frozen substrate = Vulkan·f16·MTP | [substrate](../docs/findings/llamacpp/2026-07-13-0733-27b-serving-substrate.md) |
| 2026-07-12 | [maxctx ladder](../campaigns/perf/2026-07-12-0006-27b-maxctx-f16/) | Qwen3.6-27B Q4_K_S · Vulkan, f16 vs q8_0 KV, ctx 48k→120k | hybrid arch → **200k f16 loads in 31 s @29.0 GiB** (old 64k/120k "ceiling" was the highest tested, not the cap); @40k pf ~742 f16 / 635 q8_0, decode flat 28.5 | [maxctx](../docs/findings/llamacpp/2026-07-12-0006-27b-maxctx-f16.md) |
| 2026-07-11 | [deep-context 35B matrix](../campaigns/perf/2026-07-11-2200-deep-context/results/2026-07-11-2200-deep-context/) | Qwen3.6-35B-A3B · Vulkan, MTP×KV×depth×np, 8k→200k | prefill 3077→1254 tok/s, decode 104→61 (8k→200k); MTP a **net loss** for deep-prefill/short-decode; **q8_0 KV −40 % prefill** at depth → keep f16; np2→np4 doubles TTFT ~0 gain | [deep-context](../docs/findings/llamacpp/2026-07-11-2200-deep-context-35b.md) |
| 2026-07-11 | [35B adaptive sweeps](../campaigns/perf/2026-07-11-1833-starter-baseline/results/2026-07-11-1833-sweep-35b-rocm/) | Qwen3.6-35B-A3B · `sweep.py`, ROCm vs Vulkan | optima `-ub 4096` ROCm / `-ub 2048` Vulkan (interior peaks), `-fa on` +6–9 % pf; q8_0 rejected both (ROCm −7.5 % dec, Vulkan −29.7 % pf); Vulkan decode +53 % | [sweep](../docs/findings/llamacpp/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md) |
| 2026-07-11 | [35B serving combo](../campaigns/perf/2026-07-11-1833-starter-baseline/results/2026-07-11-1844-campaign-combo35b/) | Qwen3.6-35B-A3B · backend×MTP×KV×depth×conc | **Vulkan+MTP+f16 ≈140 decode** single-stream; MTP +30–40 % but −8…−15 % at c4 → off for parallel; 4 agents fit 32 GB (~48 tok/s/stream) | [combo](../docs/findings/llamacpp/2026-07-11-1844-campaign-combo35b.md) |
| 2026-07-11 | harness smokes (archived) | 27B/35B · both tracks | pipeline validation runs (sweep micro, mini campaign, engine run.sh) — no published findings | none |

## Layout

| Dir | Track | Tool | Answers |
|-----|-------|------|---------|
| `perf/model-bench/` | **Model / tuning microscope** — one engine | `run.sh` (manual grid) + `sweep.py` (**adaptive optimum search**, KV ≤5% rule) over `llama-bench` | "Which `-ub`/`-b`/`-fa`/KV is fastest — with the peak bracketed on both sides?" |
| `perf/engine-bench/` | **Cross-engine + serving combos** | `run.sh` (`capture_engine.py probe`: concurrency, thinking, prefix modes) + `campaign.sh` (MTP×KV×depth×parallel), servers via `stack/serve/` | "Which engine/combo is fastest on my real task, single-stream and under N parallel agents?" |
| `perf/hipfire/` | hipfire engine evaluation | driver rebuild + bench scripts | hipfire vs llama.cpp (see `docs/findings/hipfire/`) |
| `build-check/` | **New llama.cpp build vs previous** | `compare_builds.py run` (one campaign per check) | "Is the new build faster, neutral or a regression — promote or not?" |
| `quality/` | **Coding quality** | `run_capture.sh <campaign>`: capture → `score_typescript.py` (tsc + eslint + vitest) → `aggregate.py` → `make_charts*.py`; `judge.py` (blind judge), `graders/` | "Which model/config writes the best TypeScript at depth, and at what cost?" |
| `workers/` | Subagent workers | Ornith / Haiku / local-27B task harness (fixtures, scoring) | "Which worker does this kind of task well enough?" |
| `workloads/` | Prompt fixtures | `build_prompt.py` + tracked `corpus/` (TS+Python, ~565K tok); built fixtures → `workloads/tmp/` | shared stimulus for every track |
| `core/` | Shared plumbing | `capture_engine.py` (THE prober: probe + tasks), `capture_proxy.py`, `report.py` (campaign → SVG charts + appendix.md + gpu_peaks.json), `gguf_kv.py`, `gen_campaign.py` | capture + visualization + scaffolding |

GPU plumbing (vendor abstraction `gpu_env.sh`, `vram_sampler.py`, `gpu_exclusive.sh`, `monitor.py`) lives in
`stack/gpu/`; server launchers in `stack/serve/`. Every run writes into a campaign dir
`campaigns/<type>/<stamp>-<slug>/`: raw to `tmp/` (ignored), rows to `results/` (committed).

**Scaffolding & bookkeeping (repo-level):**
- **`bench/core/gen_campaign.py`** — deterministic campaign scaffolder: a JSON `spec.json` → a resumable
  `run.sh` (per-probe `done/` markers in `tmp/`) + README skeleton under `campaigns/<type>/<stamp>-<slug>/`.
  The emitted driver **continues past a failed server** and **skips (before launch) any
  server predicted over the VRAM budget** (GPU/VRAM-only, no system-RAM spill), and honors
  `ONLY=`/`REPS=`/`MAX_TOKENS=`/`VRAM_BUDGET_MIB=` for subset/short runs. Also
  `gen_campaign.py vram-ctx …` = the VRAM-budget → max-context calculator. `--help` for both.
- **`/benchmark-new-campaign` skill** — the *judgement* layer over `gen_campaign.py`: works out the
  VRAM budget, the MTP/KV/depth/concurrency matrix (honoring your explicit ladder), and the gaps
  (fixtures, ctx headroom) **before** you spend GPU hours, then emits the spec + driver.
- **`docs/reindex.py`** — regenerates `docs/INDEX.md` from each report's `<!-- meta -->` block
  (scans `docs/findings/**` and `docs/research/**`; fails on a missing block or a `campaign:` that does not resolve).

**How to run everything (offline, solo): [`docs/guides/GUIDE.md`](../docs/guides/GUIDE.md).**
**Campaign plans (runbooks): [`starter-baseline`](../campaigns/perf/2026-07-11-1833-starter-baseline/README.md) ·
[`deep-context`](../campaigns/perf/2026-07-11-2200-deep-context/README.md). New one → `/benchmark-new-campaign`.**

The original pre-harness scripts and their `results_*.jsonl` (2026-07-09/10) are archived outside this repo.

## Not tracked (gitignored)
Every `tmp/` and `var/` dir: llama.cpp builds and the Vulkan SDK (`stack/llamacpp/var/`), venvs, model caches
and server state (`stack/serve/var/`), built fixtures (`workloads/tmp/`), and each campaign's raw `tmp/`
(replies, server logs, GPU sample CSVs, done markers). Charts are committed SVGs (regenerate with `core/report.py`).

## Known gaps — stated debt, not silent workarounds

CLAUDE.md rule 6 requires naming the tool that *should* own a job before hand-writing it. Two gaps
forced hand-written probes during the 2026-09-10 hipfire evaluation, and both should be closed here
rather than re-improvised per engine:

1. **No driver for engines outside llama.cpp/vLLM.** `stack/serve/llamacpp/serve_llamacpp.sh`,
   `core/capture_engine.py probe` and `gen_campaign.py` cannot launch or probe hipfire, so the whole
   evaluation ran on scratchpad scripts. **Wanted:** a generic OpenAI-compatible driver, base-URL
   parameterised, normalising `prompt_per_second`/`predicted_per_second` → `prefill_tok_s`/
   `decode_tok_s`, so a new engine is a config row instead of a fresh pile of shell.
2. **No multi-turn growth workload.** Every fixture here is a one-shot prompt of N tokens. Context
   *capacity* questions need a conversation that accumulates with prior turns cached (CLAUDE.md
   rule 17) and reports per-turn `ctx` / new-token delta / prefill / decode / wall / VRAM.
   `workloads/build_prompt.py` builds the turns; nothing drives them as a growing conversation.
3. **No interleaved-agents workload and no fault watchdog.** Multi-agent use needs an A/B/A probe
   (two conversations sharing a system prompt, alternating) to expose engines whose prefix cache is
   one conversation deep — hipfire's is (`05` §28.7). And a hipfire driver must watch `serve.log`
   for `Memory Fault` during a request, because `/health` stays `ok` on a wedged worker
   (CLAUDE.md rule 15). Both exist only as 2026-09-10 scratch scripts (`interleave.py`, `ab.sh`).
4. **No small-step cadence workload.** The agentic tool-call shape — ~5k tokens in, ~1k out, sixteen
   times, prior turns cached — is a different curve from four 18k turns; it was run once as scratch
   (`05` §28.9).

Until both exist, a hand-written probe is legitimate **only if it is stated as such in the report**,
per rule 6.

**Before any engine boots**, run `stack/gpu/gpu_exclusive.sh [required_free_mib]` — it unloads llama-swap
(`/unload` is GET; POST is 405), kills hipfire's `bin/daemon` + `hipfire serve` shape, and fails
loudly naming the holder if the free-VRAM floor is not met. See CLAUDE.md rules 14-15 for why a
post-kill check alone is not enough on a paging allocator.
