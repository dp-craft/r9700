---
name: llamacpp-build
description: Build a new llama.cpp for the R9700 — fetch the newest upstream release tag (or a given bNNNNN) into build/<ver>-src, compile build/<ver>-vulkan and build/<ver>-rocm, benchmark both against the previous build (llama-bench, Qwen3.8-27B Q4 + q8_0 KV, five request shapes pp128+tg64 … pp32768+tg2048, optionally 2 concurrent 32k requests), write the dated comparison report, and promote build/latest-{vulkan,rocm} — the symlinks llama-swap serves. Use whenever the user wants to update, upgrade, rebuild or try a new llama.cpp release/tag/commit, asks whether a newer llama.cpp is faster or regressed, or wants llama-swap rolled back to an older llama.cpp build — even if they never say "skill" or "build".
argument-hint: "[bNNNNN] [--backend vulkan|rocm|both] [--parallel 2]"
---
<!-- LLM-PRIMARY: Fetch → build → benchmark-vs-previous → promote a llama.cpp build into build/latest-* (served by llama-swap). -->

# llamacpp-build

## User input

```text
$ARGUMENTS
```

Empty → newest upstream tag, both backends. `bNNNNN` → that tag. `--backend` narrows to one backend. `--parallel 2` → also 2 concurrent Very large requests per build (step 3); only when the user asks for it.

## Process

1. **Status** — `bench/build_llamacpp.sh status`. No tag given and the newest tag is already the target of every requested `latest-*` → report "up to date", stop.
2. **Build** — `bench/build_llamacpp.sh build [--tag bNNNNN] [--backend B]` in background; wait for the exit notification.
   - `-j` is capped by free RAM (no swap). Printed ROCm `-j` < 4 → ask the user whether to unload llama-swap first (`curl -s http://127.0.0.1:9292/unload`).
   - Failure → show the printed log tail + `build.log` path, stop. Re-running resumes.
   - Duration (MEASURED, b10909): Vulkan 174 s at `-j10`; ROCm is the long one (hipcc TUs, RAM-capped `-j4`). A resume after a fix = relink only (seconds).
3. **Benchmark + report** — tell the user llama-swap is stopped for the run (the tool restarts it, also on failure; opencode requests fail meanwhile), then `bench/model-bench/compare_builds.py run --new bNNNNN [--backend B] [--parallel 2]` in background (prints plan + ETA first). It writes `docs/analysis/<stamp>-llamacpp-<ver>-build-check.md`, reindexes `docs/INDEX.md`, and ends with `VERDICT {...}`.
   - Measures five request shapes per build — pp128+tg64, pp512+tg256, pp2048+tg512, pp8192+tg1024, pp32768+tg2048 — each as `pp P` (prefill t/s) + `-pg P,G` (whole request; decode t/s = G / (t_pg − t_pp)), n=1 after one warmup pass.
   - `--parallel 2` (optional): per build also 2 × pp32768+tg2048 at once via `llama-batched-bench` (`run.sh NPL=2`) — total prefill/decode t/s, per-stream decode, request time, throughput vs 2 in a row. Its cells count in the verdict.
   - Duration (MEASURED, b10909, both backends): 4 shape arms 4.0–4.8 min each, 17.2 min total; `--parallel 2` adds 3.0–3.9 min per build (one-off, 2026-09-11) → ≈ 32 min. The printed ETA (754/51 t/s) runs ~20% low: llama-bench decode has no MTP (~28 t/s).
   - Refused up front (`exposes no … device` = silent CPU fallback, or `gpu_exclusive.sh refused`) → show the message, stop; nothing was measured.
4. **Promote per verdict** (table below) — `bench/build_llamacpp.sh promote bNNNNN --backend B`.
5. **Present** — in this order, tables verbatim from the tool's stdout:
   1. Summary table.
   2. Conclusion, 2–4 sentences: what moved, by how much, at which request shape.
   3. Recommendation + report path.
   4. **At the end, the detail tables** — *Results per request shape* (prefill t/s, decode t/s: prev → new, Δ, request time per shape), then *N concurrent requests* when `--parallel` ran. MUST NOT omit or summarize them away.

## Verdict → action

| Verdict | Meaning | Action |
|---|---|---|
| IMPROVEMENT | ≥1 cell ▲, no ▼ | promote |
| NEUTRAL | all cells flat | promote |
| REGRESSION | ≥1 cell ▼ (≥ 5% at n=1; also > 2σ when `--reps` > 1) | show the ▼ cells, ASK the user before promoting; offer a `--reps 3` re-run of that backend first |
| FAILED | new build's bench failed (a failed `--parallel` arm included) | FORBIDDEN to promote; show the `arm-<build>*.log` tail |
| NO-BASELINE / CONTENDED | previous build's arm failed (its `--parallel` arm included) / VRAM held by another engine at arm start | re-run step 3 for that backend; MUST NOT promote on it |

Verdicts are per backend — act on each separately.

## Layout (fixed naming)

| Path | Content |
|---|---|
| `build/<ver>-src` | shallow checkout of upstream tag `<ver>` (`bNNNNN`); untagged commits use `git describe` (`b10655-4-g6fdd0ac`) |
| `build/<ver>-vulkan`, `build/<ver>-rocm` | CMake binary dir: `bin/`, `BUILD_INFO` (flags, compiler, version), `build.log` |
| `build/latest-vulkan`, `build/latest-rocm` | symlink → promoted build; llama-swap `generate.py` `VULKAN_BIN` / `ROCM_BIN` = `build/latest-*/bin/llama-server` |
| `build/b10375-rocm/bin/*` | wrappers: the prebuilt asset in `dist/` borrows its HIP runtime from `build/b9949-rocm` |
| `bench/llamacpp*`, `llama.cpp-src` | compat symlinks to migrated builds — old campaigns and tool defaults use them |
| `bench/runs/<stamp>-buildcmp-<ver>/` | `arms.json` + `arm-<build>[-par<N>].log`; per arm `bench/runs/<stamp>-model-buildcmp-[par<N>-]<build>/` (`llama-bench.json` or `batched-bench.json`, `meta.txt`, `gpu_samples.csv`) |

## Rules

| Rule | Why |
|---|---|
| MUST run every step through the two tools; FORBIDDEN: hand-run cmake/llama-bench/batched-bench, hand-write or hand-edit the report | history stays in one identical format (iron rule 6) |
| Switching builds MUST go through `promote`; MUST NOT edit `generate.py` / `config.yaml` for it | wired once to `latest-*`; llama-swap picks the new binary at the next model load — no restart, no config reload |
| Rollback = `promote <older-ver> --backend B`, only to a build that passed a build check | NOT runnable: `b9950-rocm` (no HIP runtime → CPU); Vulkan older than b10655 device-lost (row below) |
| MUST NOT delete builds or compat symlinks unless the user asks | rollback targets / old campaign paths; report `df` when < 10 GB free |
| MUST NOT commit in `~/.config` | shared, already dirty git tree |
| MUST NOT edit either tool (or `bench/model-bench/run.sh`) while it runs | bash reads scripts lazily (iron rule 14) |
| FORBIDDEN as a Vulkan baseline: builds older than b10655 (6fdd0ac) | b9950 + b10375 Vulkan `llama-bench` hit `vk::DeviceLostError` on this workload (2026-09-11); a RADV device loss can take down the desktop session |
| Out of scope: MTP / served-path throughput | llama-bench and batched-bench have no speculative decoding; that is `bench/engine-bench/` (`serve_llamacpp.sh MTP=1` + `capture_engine.py probe`) |
| Tool gap (new backend, new metric, other model) → extend `build_llamacpp.sh` / `compare_builds.py` and say so | never fork the logic into a one-off |
