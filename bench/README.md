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
auto-detected (`lib/gpu_env.sh`), the cross-engine track is pure HTTP, and the tuning track runs
against any llama.cpp build you point it at (ROCm, Vulkan, CUDA, Metal…).

## What it can do

- **Adaptive optimum search** (`model-bench/sweep.py`): coordinate descent over `-ub` → `-b` →
  `-fa`; each axis grid *expands* (×2/÷2) while the best value sits on a boundary, and stops only
  when the peak is interior or a hard cap/OOM is hit. Ties inside the ±3% noise band are flagged
  `plateau_within_noise`, not sold as wins.
- **KV-cache acceptance rule built in**: at the winning config it A/Bs f16 vs q8_0 KV *at the
  target context depth* and accepts q8_0 only if prefill AND decode lose ≤5% — reporting the
  measured VRAM saving (= extra context / extra parallel slots) either way. "f16 OOMs where q8_0
  fits" is recorded as a finding.
- **Serving-combo matrix** (`engine-bench/campaign.sh`): backend × MTP (speculative decode) ×
  KV type × context depth (8K→64K) × concurrency (1/2/4) on real workloads, with server
  restarts handled, per-point failure tolerance, and **resume** after interruption. This is where
  llama-bench optima get validated at the real serving operating point (they don't transfer
  automatically to `-np`>1 + MTP).
- **Agentic / parallel measurement** (`engine-bench/openai_probe.py`): concurrency waves against
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
- A campaign `results.jsonl` (per-request + aggregate + `gpu` memory rows) that turns into a report
  co-located at `campaigns/<date>-<slug>/analysis.md` via the `/benchmark-results` skill — summary +
  table first (memory column mandatory), raw data linked 1:1.
- **A one-command visual report**: `lib/report.py <run-dir> [...]` renders any run dir (sweep or
  campaign) into a self-contained `report.html` — tuning curves, KV verdict, depth/concurrency
  charts, failure banner, raw-number tables. Stdlib Python + vendored Chart.js; works offline.
- Honest numbers: cold prefix cache by default (identical prompts inflate "prefill" 2.4× from the
  second request — measured), chat template where raw completions would silently EOS, failures
  kept in the table instead of averaged away.

## Layout

| Dir | Track | Tool | Answers |
|-----|-------|------|---------|
| `model-bench/` | **Model / tuning microscope** — one engine | `run.sh` (manual grid) + `sweep.py` (**adaptive optimum search**, KV ≤5% rule) over `llama-bench` | "Which `-ub`/`-b`/`-fa`/KV is fastest — with the peak bracketed on both sides?" |
| `engine-bench/` | **Cross-engine + serving combos** | `openai_probe.py` (concurrency, thinking, prefix modes) + `serve_llamacpp.sh` + `campaign.sh` (MTP×KV×depth×parallel) + `llama-benchy` (`dl/benchy-venv`) | "Which engine/combo is fastest on my real task, single-stream and under N parallel agents?" |
| `workloads/` | Prompt fixtures | `build_prompt.py` + tracked `corpus/` (TS+Python, ~565K tok) | shared stimulus for both tracks |
| `lib/` | Shared plumbing | `gpu_env.sh` (AMD/NVIDIA vendor abstraction), `vram_sampler.py`, `report.py` (run dir → self-contained HTML report) | vendor-neutral meta + VRAM/power/throttle capture + visualization |
| `runs/` | Dated campaign outputs `YYYY-MM-DD-HHMM-<slug>/` | — | raw results + per-run meta |

**Scaffolding & bookkeeping (repo-level):**
- **`bench/gen_campaign.py`** — deterministic campaign scaffolder: a JSON `spec.json` → a resumable
  `run.sh` (per-probe `done/` markers) + README skeleton under `campaigns/<date>-<slug>/` (project
  root). The emitted driver **continues past a failed server** and **skips (before launch) any
  server predicted over the VRAM budget** (GPU/VRAM-only, no system-RAM spill), and honors
  `ONLY=`/`REPS=`/`MAX_TOKENS=`/`VRAM_BUDGET_MIB=` for subset/short runs. Also
  `gen_campaign.py vram-ctx …` = the VRAM-budget → max-context calculator. `--help` for both.
- **`/benchmark-new-campaign` skill** — the *judgement* layer over `gen_campaign.py`: works out the
  VRAM budget, the MTP/KV/depth/concurrency matrix (honoring your explicit ladder), and the gaps
  (fixtures, ctx headroom) **before** you spend GPU hours, then emits the spec + driver.
- **`docs/reindex.py`** — regenerates `docs/INDEX.md` from each report's `<!-- meta -->` block
  (scans `docs/{analysis,research}/` and `campaigns/*/analysis.md`; fails if one is missing).

**How to run everything (offline, solo): [`docs/GUIDE.md`](../docs/GUIDE.md).**
**Campaign plans (runbooks): [`starter-baseline`](../campaigns/2026-07-11-starter-baseline/README.md) ·
[`deep-context`](../campaigns/2026-07-11-deep-context/README.md). New one → `/benchmark-new-campaign`.**

## Legacy (frozen)
`bench/legacy/` holds the original harness (`harness/` + the pre-harness `*.sh` + `*_results.jsonl`).
⚠️ Frozen and superseded by the two tracks above; it hardcodes the old path `/home/dev/work/dippe/amd`
and does not run here. See `bench/legacy/README.md`. Do not add new work there.

## Not tracked (gitignored)
`llamacpp/`, `llamacpp-vulkan/`, `llamacpp-rocm-b9950/`, `dl/` (multi-GB binaries + benchy venv),
`.servers/` (runtime pids/logs), `workloads/generated/`, `*.log`, `runs/*/report.html`
(regenerate with `lib/report.py`).
