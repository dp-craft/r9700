# 27B arm bench + KLD + upgrade validation

**Campaign:** `campaigns/perf/2026-11-09-1825-27b-arms-kld/` · **Plan:** `notes/plans/2026-11-09-27b-queue-and-runbook.md` (v5)
**GPU:** R9700 (gfx1201, 32 GB) · **Runtime fixpoints:** stilldeadcode/radiance 1.11.0 / 1.17.0, ghcr.io/slybase/vllm-sly-radiance 1.11.0-rocm10.1 (+ 1.8.1 for arm E), ROCm 10.1, `HSA_OVERRIDE_GFX_VERSION=12.0.1`

One script, one machine, two rounds: the 27B arm matrix (4 native arms + 1 KLD-only), a quantization-fidelity
KLD probe against the local FP8 reference, and the sly 1.11.0 first-boot measurement (WS7). No LLM in the GPU
loop — `run.sh` is plain bash + the repo's deterministic tools, run from **your terminal**.

## Arms

| Arm | Model | Runtime | Role |
|---|---|---|---|
| A | Quark-MXFP4 `.rad` (DFlash2 drafter merged) | radiance **1.11.0** (default) | **baseline** |
| B | Quark-MXFP4 `.rad` | radiance **1.17.0** | upgrade validation (A vs B = bench-vs-previous) |
| C | IQ4R-L-V4 `.rad` (DFlash2 drafter merged) | radiance **1.17.0** (image floor) | quality arm (KL 0.00297 vs bf16, +4 % decode — CLAIMED, unsloth) |
| c0 | IQ4R-L-V4 `.rad` (DFlash2 drafter merged) | radiance **1.17.0** (image floor) | **C spec-off** — same boot as C but `--num-speculative-tokens 0`; isolates the spec-decode contribution (item A) |
| D | RedHatAI Qwen3.8-27B-MXFP4 (HF) | sly **1.11.0**-rocm10.1 | sly upgrade validation (vs the 1.9.1 MEASURED row) |
| E (optional, KLD only) | heretic MXFP4 GPTQ + DFlash2 drafter | sly **1.8.1**-rocm10.1, profile `sly-official/heretic-mxfp4` | heretic retest (quality never measured; `run.sh --kld heretic`) |

All perf arms: **ctx 260000 / max-seqs 2 / fp8 KV** (`27b.conf` after WS1.2). Radiance arms carry
`--gpu-headroom-mib 596 --num-speculative-tokens 7` (27b.conf HEADROOM_MIB/SPEC_K). D uses the starter-exact
env (`WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0` + dp-sharp chat template). Fixtures are deterministic
(`build_prompt.py` codereview tasks, TS+Python mix), auto-built by `run.sh`, identical across arms.
`.rad`/model paths are preflight-verified (exact pins below, from the D6 re-check).

## Grid (two rounds)

| | Depths | tg (max-tokens) | n (concurrency) | Cells/arm |
|---|---|---|---|---|
| **Round 1 — MANDATORY** | 10k, 100k | 512, 1024 | 1, 2 | 8 |
| **Round 2 — OPTIONAL** (`--round 2`) | 50k (all tg) + tg 4096 at 10k/100k | 512, 1024, 4096 | 1, 2 | 10 (+ arm E) |

reps 1, prefix_mode unique (fresh prompts; engine-comparison-safe). Round 1 gives 2-point depth slopes per tg
(GO/NO-GO + upgrade verdicts); round 2 adds 50k for 3-point fits + R² (rule 16). Each probe cell = one
`capture_engine.py probe` wave (barrier-synced n-parallel requests) → rows + aggregate in
`results/results.jsonl`; per-cell VRAM folded in via `vram_sampler.py`.

**KLD runs in round 1**, per arm during its own boot (independent of the grid) — see below.

**Round-1 total ≈ 3–4 h** (INFERRED, 2026-11-10 re-estimate): probe cells + boots ≈ 50 min, plus the KLD pass
≈ 2–3 h — 5 fetches (ref + 4 arms) × 128 prompts × 512 tokens ≈ 65k tokens each at ~40–60 t/s + 128 TTFTs per
arm. The plan's earlier "45–70 min" covered cells + boots only (the KLD design post-dated that budget). Round 2
≈ +1.5 h (INFERRED). During the run, port 8000 is the campaign's — no Claude session on 8000 in that window.

## KLD (WS3)

`bench/perf/kld_probe.py` (math core TDD: `bench/perf/test_kld_probe.py`, 60/60 OK on synthetic
fixtures). Method locked by `research/ws3-kld-r1.md` / `r2.md` (every choice sourced there):

- **Mode — paired greedy continuation (r2 §2):** reference and each arm generate N=512 tokens at
  temp 0 with `logprobs: 20`; positions pair **while the generated tokens match** (contexts then
  identical by construction); the first-divergent position IS included (its context is still
  identical), the rest of that prompt is dropped. **Radiance never returns prompt logprobs**
  (1.17.0 `oai.cpp`: "never leave the card") — so prompt-scoring cannot be the uniform campaign
  mode; it stays an optional labeled bonus pass on sly-served pairs (r2 §5.8), not mixed in.
- **KL — sly `kv4/kl_compare.py` verbatim (r2 §3):** per position `KL(ref ‖ arm)` =
  `max(0, Σ_{t∈ref top-20} p_t·(r_t − a_t) + rt·ln(rt/at))` with a **floor** (arm's min top-20
  logprob) for tokens missing from the arm's top-20 ⇒ the estimate is a **lower bound**; ε=1e-9.
- **CI:** cluster bootstrap (block = prompt), B=2000, percentile 95 % (headline); pooled
  1.96·SD/√n (sly convention) reported alongside as cross-check (synthetic study: pooled is ~1.46×
  too narrow at intra-text ρ≈0.3). Per-1k segments of the pooled KL.
- **Extras (r2 §3/§4):** paired dNLL, top-1 agreement over all generated positions, mean top-20
  coverage (ref and arm), median/mean first-divergent position. **Noise floors must accompany every
  number:** the A-vs-B pair (same checkpoint, radiance 1.11.0 vs 1.17.0) = engine-version floor; a
  reference self-run bounds boot noise.
- **Reference:** local FP8 `Qwen__Qwen3.8-27B-FP8@017b9c7a` (D8 — bf16 unavailable on this stack;
  the limitation is stated in the report). One dedicated boot (profile `sly-radiance/qwen38-fp8`,
  IMAGE pinned to 1.11.0 for logprob-semantics parity with arm D); its fetch cached in `tmp/`
  (resumable). ref and arm D are same-engine ⇒ D's delta = quantization-only; A/B/C deltas also
  carry the engine-family difference (r2 §5.1).
- **Calibration set:** `inputs/calibration-prompts.jsonl` — file-head prompts (first `char_cut`
  chars of a corpus file, raw text, NO chat template: templates differ between engine families and
  would break pairing) from `bench/workloads/corpus/`, ~96–160 prompts × 200–2000-token heads
  (code-dominated mix, r2 §3-item-5; target n ≈ 20k paired positions ⇒ 95 % half-width ≈ 1.6e-4
  nats/tok). **Hash-pinned**: `inputs/calibration-manifest.jsonl` (per-source sha256 + bytes + cut)
  + `inputs/calibration.sha256` over the prompts file. Selection rule (deterministic, no randomness):
  per corpus dir (`py-rich`, `ts-agentic-code-runner`), all `.py`/`.ts` files ≥ 800 B, sorted
  lexicographically by full path, first 64 each → **128 prompts** (64/64), ids `cal-001…cal-128` in
  global sorted order, char_cut = min(bytes, 8000) — heads ≈ 828–8000 chars ≈ 207–2000 tokens
  (token estimate at 4 chars/tok; the manifest pins bytes, not tokens).
- **Live selftest per engine family (r2 §2, 5 checks):** first radiance boot (arm A) AND first sly
  boot (arm D): (1) `logprobs:20` shape, (2) `prompt_logprobs` availability (informational),
  (3) `/tokenize` ids recorded (`ids` or `tokens` key; `prompt` or `content` body) — the enforced
  tokenizer guard is at score time: every report carries `tokenizer_check`, the per-prompt
  `usage.prompt_tokens` of ref vs arm (`ok` | `MISMATCH` with the prompt ids | `unavailable`),
  (4) logprobs identical at temp 0 vs 1 (raw distribution), (5) every sly fetch (D, E, reference) —
  no `RADIANCE_LMHEAD_INT2` (other than `=0`) in the live `vllm-8000` container env (`docker inspect`;
  the two-stage greedy head returns garbage non-winner logprobs) — checked in `kld_fetch`, which
  refuses the fetch otherwise. `RADIANCE_LMHEAD_FP8`/`INT4` (arm D's profile) are a full-row lm_head
  quantization and are measured, not refused (verified in the 1.11.0 image source, 2026-11-11).
  llama.cpp's `content`-style logprobs are normalized to the same rows (`normalize_logprobs`). A failed selftest aborts **the KLD pass only**, not the campaign;
  logprobs-refusing arms fall out of the KLD pass with the reason recorded (r2 §5.2: arm A's
  1.11.0 support is unverified — the selftest covers it at runtime).
- KLD results land in `results/kld-<arm>.json` (the score compares each arm to the cached
  reference fetch, same boots — one boot per arm).

## WS7 prologue (sly 1.11.0 first boot)

Before arm D: timed boot of sly 1.11.0 (this boot **doubles as arm D's** boot) → per-phase breakdown
(docker start → engine init → weight load → kernel compile → warmup → /health) from the timestamped container
log → stop → **warm reboot** → seconds. The phase parser is `bench/perf/ws7_phases.py` (TDD:
`bench/perf/test_ws7_phases.py`, markers from `research/ws7-boot-r2.md` §1; every number tagged MEASURED =
the log's own timers, INFERRED = timestamp-difference chains / the r2 cacheable mapping). Cache pre-check
(session 1, CPU): whether `/mnt/Lin1/work/vllm/sly-radiance/cache/` already holds a 1.11.0 tag dir decides
cold vs warm-first (measured 1.9.1 cold = 400–475 s, 2026-10-30, stands as the historical MEASURED row;
**no silent wipes** — a cold measurement requires a user-approved cache wipe). Results →
`results/ws7-boot.json` + `tmp/ws7-boot-*.log`.

## Boot diagnosis + measurables (item B/G/H, 2026-11-11)

Every boot — vllm (`start_server`) and radiance (`start_rad`) — records a bounded diagnosis **and** its
measurables via `bench/perf/boot_diag.py` (TDD: `bench/perf/test_boot_diag.py`, 18 OK). A failed serve script
`docker rm -f`'s its container on the way out, so a `docker logs` taken afterwards finds nothing; the diagnosis
is therefore captured from what the **driver itself saw**: the **start stderr** (the serve script's own
"container DIED" tail), the **state-dir engine log** (`stack/serve/var/servers/8000.log`, written by the serve
script's stop/died path), and the serve script's own `logs` mode.

- **Failure → `$RAW/boot-<name>.txt`** (radiance: `$RAW/boot-<arm>.txt`): an appended `=== boot attempt <ts> ===`
  block holding those three sections (bounded to diagnostic-pattern lines + the last 300) plus `start_rc=` /
  `waited_s=`. `failures.txt` names it: `SERVER-FAILED … start_rc=N waited_s=S boot tail: …/boot-<name>.txt`.
  The old `results/server-<name>-boot.log` is **no longer written**.
- **Measurables → `$RES/boots.jsonl`** (one append-only row per attempt, `kind: "boot"`): start_rc / ok /
  boot_seconds / image + image_id (docker inspect) / the resolved config (from `serve … print`) /
  `vram_before_mib` + `vram_ready_mib` (sysfs `mem_info_vram_used`, MEASURED) + `vram_peak_boot_mib`
  (`vram_sampler.py` CSV peak in the boot window — MEASURED, never calculated, rule 7) + `cache_state`
  (cold/warm, a bounded walk of the image's host cache dir) + `engine_log` (the engine's own boot numbers — KV
  tokens, model load, graph capture — parsed from the log; null when a line is absent, never invented). Radiance
  rows carry `rad_path` / `rad_bytes` and no vllm cache (cache_state null).
- **WS7 cold/warm (item G):** the prologue labels the boot from the **MEASURED** `cache_state` of the image's
  host cache dir (`boot_diag cache_probe`), not a dir-existence guess — it prints
  `cache state = cold (MEASURED …)` / `warm (MEASURED …)`. No silent cache wipes.

## How to run (your terminal)

**Precondition:** no local-model Claude session running — `run.sh` calls `gpu_exclusive.sh` per arm (inherited
from `serve_radiance.sh` / `serve_vllm.sh` start modes) and kills any session server on port 8000.

### Compare batch (run-compare.sh) — every existing model, one terminal command (2026-11-11)

```sh
cd /home/dev/work/dp-craft/amd
bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run-compare.sh                    # all arms, defaults
ARMS="c c0 q4kxl" KLD_N=32 bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run-compare.sh   # subset
RUN_TAG=compare-<stamp> bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run-compare.sh      # resume
```

- **Arms, in order** (`ARMS`, default `d a b c c0 q4kxl e`): the five campaign arms, plus the
  llama.cpp GGUF arm `q4kxl` = unsloth UD-Q4_K_XL (`q6k` = UD-Q6_K exists but is opt-in only — user
  2026-11-11), on `latest-vulkan` (resolved build recorded), **KV q8_0** (llama.cpp has no fp8
  KV — a documented asymmetry), MTP off — and arm `e` (heretic, KLD only).
- Per arm: boot gate → boot → residency → KLD selftest → KLD fetch (`KLD_N`, default 16) → cells
  (`<arm>-10k-tg512-n1`, `<arm>-100k-tg512-n1`, `REPS` default 2) → stop. A failed arm is recorded
  and the batch continues; a Memory Fault aborts the batch (rule 15 — resume with the same `RUN_TAG`).
- **Pairwise KLD, no FP8 boot needed:** every ordered pair of complete fetches is scored
  (`kld_probe.py score --ref-label`) → `results/kld-pair-<arm>-vs-<ref>.json`, and `kld_probe.py matrix`
  writes `results/kld-matrix.md` (KL(ref‖arm) nats/tok + CI95 + top-1, and each pair's tokenizer check).
  A cell is the distance **between two quantizations**, not to the truth; `a`-vs-`b` (same checkpoint,
  engine 1.11.0 vs 1.17.0) and `c`-vs-`c0` (spec on/off) are the noise floors to read the rest against.
- `KLD_FP8=1` (optional, last): boots the local FP8 reference, scores every arm vs it (`kld-<arm>.json`)
  and adds it to the matrix as `fp8`.
- Unique dir per invocation: `tmp/runs/compare-<YYYYmmdd-HHMMSS>/`. Port 8000 must be free.
- **No-overwrite (user 2026-11-11):** a resume only ADDS. A re-boot of a slug records as `<slug>-boot2…`
  (server/boot/VRAM files), each pairwise pass gets its own `results/kld-pairs-<stamp>.d/`, an existing
  score or selftest JSON is never rewritten (`-2` file instead); rows (`results.jsonl`, `boots.jsonl`,
  `failures.txt`) are append-only. Exception: `bench/core/report.py` regenerates `results/charts/` +
  `appendix.md` at the end of every pass.

### Short validation run first (user decision 2026-11-10 — no 3–4 h unattended pass up front)

The round-1 run was **split**: run the short pass first, check that every measurement path works and
the data looks sane, *then* decide on the full grid after analysis.

```sh
cd /home/dev/work/dp-craft/amd
bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run-short.sh      # ~1 h, unique dir per run
```

- **Arms C + D only** (the redhat-vs-iq4 pair the user cares about most): D = RedHat-MXFP4 @ sly 1.11.0
  (WS7 cold+warm prologue included — the first 1.11.0 boot *is* the WS7 cold measurement), C = IQ4R-L-V4 @
  radiance 1.17.0.
- **Cells**: 10k/100k × tg512 × n1 (2 per arm), **REPS=2** (n=2; no 3-rep run up front — if a value
  looks suspicious or high-spread, re-run: the new unique dir **doubles** the data, never overwrites).
- **KLD**: selftest + fetch with **KLD_N=16** prompts (short; the full 128 stays for the canonical run —
  decide after analysis) + score.
- **Unique dir per invocation**: `tmp/runs/short-<YYYYmmdd-HHMMSS>/` (results + raw + done markers).
  Pin `RUN_TAG=<same>` to **resume** an interrupted short run; a bare re-run gets a fresh dir.
- Knobs (env): `REPS` `KLD_N` `RUN_TAG` + every run.sh pin (`IMAGE`, `IMG_RAD_BC`, `RAD_IQRV4`, …).
- All temporary output in the project gitignored `tmp/`, never machine `/tmp` (repo rule — a reboot
  wipes `/tmp` and would lose every sub-result).

```sh
bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run.sh            # round 1: A→D × 8 cells + KLD + WS7
# ... round-1 summary table prints at the end ...
bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run.sh --round 2  # optional: 50k/tg4096 cells
bash campaigns/perf/2026-11-09-1825-27b-arms-kld/run.sh --kld heretic   # optional: arm E boot + KLD pass only
```

Resumable: per-cell done markers in `tmp/done/`; an interrupted run quarantines nothing — it simply resumes
at the first missing marker (iron rule 18: a cut probe never appends its rows; the whole cell re-runs).
Failure semantics:

- **Memory-Fault watcher** (rule 15): while a probe is in flight, `run.sh` polls the serve log; on
  `Memory Fault` it kills the probe, stops the server, and aborts loudly (no done marker → re-run resumes).
- **Residency check** (rule 15b): after each radiance boot, `amd-smi process -g 0` recorded vs the
  weights-only floor (INFERRED, warning-only) in `results/residency-<arm>.txt`.
- VRAM precondition: the serve scripts refuse to boot below their free-VRAM floor (rule 14).

Outputs: rows → `results/results.jsonl` (probe), `results/kld-*.json`, `results/ws7-boot.json`,
`results/residency-*.txt`; raw → `tmp/` (replies, serve logs, VRAM CSVs, done markers — git-ignored).
`bench/core/report.py` runs at the end → `results/charts/*.svg` + `results/appendix.md` +
`results/gpu_peaks.json`.

### Standalone runs (run-arm.sh) — any model / vLLM version manually

`run-arm.sh` is a thin wrapper around `run.sh` (`WS_NO_MAIN=1`, same preflight, same resume markers,
same KLD machinery) that runs **one** arm — for ad-hoc runs with other models or engine versions:

```sh
cd campaigns/perf/2026-11-09-1825-27b-arms-kld
./run-arm.sh a                 # arm A as pinned (radiance 1.11.0 + MXFP4)
./run-arm.sh c                 # arm C (radiance 1.17.0 + IQ4R-L-V4, spec-on)
./run-arm.sh c0                # arm C spec-OFF (same boot, --num-speculative-tokens 0) — item A
./run-arm.sh d                 # arm D (sly 1.11.0) — WS7 prologue included
./run-arm.sh e                 # arm E: heretic KLD-only pass (sly 1.8.1)

# different engine version / model — env overrides (run.sh pins):
IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.10.0-rocm10.1 ./run-arm.sh d
IMG_RAD_BC=stilldeadcode/radiance:1.16.0 ./run-arm.sh b
RAD_IQRV4=/mnt/Lin1/work/radiance/models/<other-model@rev>/<f>.rad ./run-arm.sh c
KLD_REF_IMAGE=... ./run-arm.sh d      # change the KLD reference engine
ROUND=2 ./run-arm.sh b                # round-2 cells (adds 50k)
# other knobs: ONLY='d-100k-*' REPS=2 MAX_TOKENS=256 VRAM_BUDGET_MIB=...
```

Recovery semantics are identical to `run.sh`: per-cell `tmp/done/` markers, a fault-killed probe
leaves no marker and is redone on re-run; KLD ref fetch is cached at `tmp/kld-ref.jsonl` and
reused by every subsequent arm run (including a different arm). Each standalone run appends to the
same consolidated `results/results.jsonl` and re-emits charts.

**start && selftest gate:** an arm fetches its KLD set **only after its family's live selftest passes** — the
`tmp/done/kld-selftest-<family>` marker (item A keys radiance by family *and* spec tokens, so a passed spec-on
selftest never skips the spec-off one). A failed selftest skips the KLD fetch for that arm (recorded in
`failures.txt`) but never aborts the run; re-running re-attempts the selftest + fetch.

## Pins (D6 re-check)

Model dirs / images / `.rad` files verified by `run.sh` preflight; confirmed pins (D6 re-check,
2026-11-09, MEASURED via `ls`/`docker images`):

| Item | Path / tag |
|---|---|
| arm A/B | `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@60bd4139/qwen3.8-27b-mxfp4.rad` (19,377,119,232 B) |
| arm C | `/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef/qwen3.8-27b-iq4r-l-v4.rad` (18,700,496,896 B) |
| arm D | `/mnt/Lin1/work/vllm/sly-radiance/models/RedHatAI__Qwen3.8-27B-MXFP4@16a86728` |
| arm E | `/mnt/Lin1/work/vllm/sly-radiance/models/slybase__Swift-1.5-Qwen3.8-27B-heretic-MXFP4-GPTQ@3bb379dc` (+ drafter `syvai__Qwen3.8-27B-DFlash2-W4A16@4d30ec73`) |
| KLD ref | `/mnt/Lin1/work/vllm/sly-radiance/models/Qwen__Qwen3.8-27B-FP8@017b9c7a` |
| images | `stilldeadcode/radiance:1.11.0` (616 MB), `stilldeadcode/radiance:1.17.0` (858 MB), `ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1` (8.71 GB, pulled 2026-11-10, id `22baa741ab04`), `ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1` (9.99 GB) |
| calibration | `inputs/calibration-prompts.jsonl` sha256 `91dfac5adf69f393a5277bd0fc0f5c3b8727cfa10f9474765978a904e31b019a` |

**WS7 cache pre-check (MEASURED, 2026-11-09, re-verified 2026-11-10 for 1.11.0, session-1 CPU):** under
`/mnt/Lin1/work/vllm/sly-radiance/cache/` there are dirs `vllm-radiance@0.9.3` (525 M, unrelated),
`vllm-sly-radiance@1.8.1-rocm10.1` (2.9 G: aiter + root-cache + triton — arm E boots **warm-first**) and
`vllm-sly-radiance@1.9.1-rocm10.1` (3.0 G — historical; its cold-boot MEASURED 400–475 s stands and is
untouched). **There is NO `vllm-sly-radiance@1.11.0-rocm10.1` cache dir** ⇒ arm D's first boot is genuinely
cold — no wipe needed, the cold measurement is what actually happens (rule: no silent cache wipes).

## Manual-test runbook (step 3 — after round 1, your call)

Port 8000 is shared: one server at a time. Commands run from any installed target (amd root, amd-private,
dp-forge, `~/.local/bin`) via the `dp_` names.

| I want to… | Command | Notes |
|---|---|---|
| claude on MXFP4 (Quark .rad, radiance) | `dp_claude-rad-mxfp4.sh` | boot ~55 s; auto-stop on claude exit (`KEEP=1` to leave it) |
| claude on IQ4R-L-V4 (radiance 1.17.0) | `dp_claude-rad-iq4rlv4.sh` | image ≥1.17.0 pinned |
| **spec-decode A/B** | `dp_claude-rad-iq4rlv4-dflash.sh` then `dp_claude-rad-iq4rlv4-nospec.sh` | same real task both; note t/s + quality; differ only in `--num-speculative-tokens` 7 vs 0 |
| claude on RedHat-MXFP4 (sly, daily driver) | `dp_claude-sly-redhat.sh` | boot time = WS7 question |
| claude on heretic (sly) / qwen35 (sly) | `dp_claude-sly-heretic.sh` · `dp_claude-sly-amd.sh` | |
| Ornith (radiance, own window 262144/3) | `dp_start_ornith_35b_vllm_rad.sh start` then manual claude | |
| server only | `dp_start_qwen38_27b_iq4r-l-v4_rad.sh start` … `stop` | stop silent on success; `status`/`logs` |
| **radiance 1.17.0 promotion check** (WS4) | `IMAGE=stilldeadcode/radiance:1.17.0 dp_claude-rad-mxfp4.sh` | explicit OK → promote (driver IMAGE 1.11.0→1.17.0, ornith starter 1.16.0→1.17.0) |
| **sly 1.11.0 promotion check** (WS4) | `IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 dp_claude-sly-redhat.sh` | explicit OK → promote (profile `_engine.env`) |
| **compaction check** (WS6) | any of the above | expect trigger **~205k**; or `grep AUTO_COMPACT` the per-run settings (`stack/serve/var/servers/8000.claude-settings.json`) |

## Rule-6 provenance of `run.sh`

`gen_campaign.py emit --spec spec.json` produced the arm-D (vllm) server block + probe scaffolding
(knobs, fixtures, resume, report). Hand-added blocks — the genuine gap: **`server: radiance` is not a
gen_campaign kind** (arm A/B/C boots, the sly KLD-reference boot, the WS7 prologue, the Memory-Fault
watcher, the KLD wiring). Recommendation, per iron rule 6: *extend `gen_campaign.py` with
`server: radiance | vllm` kinds* (a radiance kind wrapping `serve_radiance.sh` the way the vllm kind wraps
`serve_vllm.sh` would make A/B/C emitted rather than hand-written).

### Hand-edit spec (applied to the emitted run.sh; the emitted arm-D block is replaced, A/B/C added)

Emitted shape (from `gen_campaign.py` `emit_runsh`, vllm kind): global `export ENGINES_LIST="vllm-…|
http://localhost:8000/v1|<served>"`; functions `server_needed`/`probes_selected`/`guard_ok`/
`run_probe`/`stop_server`/`start_server` (start_server: `case "$name"` → per-server env prefix
`PROFILE=… IMAGE="$IMAGE" MAXLEN=… MAXSEQS=… KV_DTYPE=… <spec env> PORT=8000` → `serve_vllm.sh print →
$RES/server-$name.txt` then `start`); per-server block `if ! server_needed; elif ! probes_selected; elif
guard_ok; then start_server → probes → stop_server`; `trap stop_server EXIT`; `report.py` at the end.

Hand edits (keep the emitted scaffold; replace/add exactly these):

1. **Arg parsing** at top: `--round 2` (sets ROUND=2), `--kld heretic` (sets KLD_HERETIC=1, skips the
   grid). ROUND guards the round-2 probe lists (round 1 = 8 cells; `--round 2` adds the 10).
2. **Pins + preflight** (after D6): exact `.rad` paths (A/B = Quark mxfp4, C = iqr-v4 — resolved by
   `ls -d <glob>` asserting exactly one match), model dirs for D/E/ref, `docker images | grep` for the
   four tags. Any missing → loud exit 1 before any GPU work (rule 2).
3. **`trap` replacement**: the emitted `trap stop_server EXIT` (vllm-only) becomes
   `trap stop_current EXIT` with `stop_current()` dispatching on `CURRENT` (`radiance` → `stop_rad`,
   else `stop_server`) — a crash mid-radiance-arm must not leak `radiance-8000`.
4. **`start_rad <name> <image> <rad_file> <served_name>`**:
   `RAD_FILE=… IMAGE=… PORT=8000 MAXLEN=260000 MAXSEQS=2 KV_DTYPE=fp8 TP=1 SERVED_NAME=… WAIT=900
   EXTRA_ARGS="--gpu-headroom-mib 596 --num-speculative-tokens 7" CONTAINER_NAME=radiance-8000
   serve_radiance.sh print → $RES/server-<name>.txt`, then `start`; on failure → failures.txt + return 1
   (run continues, per the emitted contract). Sets `CURRENT=radiance`. `stop_rad` = port-scoped
   `serve_radiance.sh stop` + verify port free. `serve_radiance.sh start` already calls `gpu_exclusive.sh`
   first (inherited precondition — do NOT re-invoke).
5. **Arms A/B/C blocks** (same shape as the emitted D block): `server_needed`-style skip via the
   per-arm done markers (`tmp/done/<slug>`), `start_rad`, per-cell
   `ENGINES_LIST="radiance-<arm>|http://localhost:8000/v1|<served>" run_probe <slug> …` (bash
   temp-assignment to a function call → inherited by engine-bench/run.sh), `stop_rad`.
6. **WS7 prologue** (before arm D): cache-state label (1.11.0 tag dir under
   `/mnt/Lin1/work/vllm/sly-radiance/cache/`? → "cold" vs "warm-first; historical 1.9.1 400–475 s MEASURED
   stands"), then `t0=$SECONDS; start_server d-redhat-sly1100 260000 fp8 0 2` (the emitted function — this
   boot **is** arm D's), record `up_after_s` + `vllm_version` from `stack/serve/var/servers/8000.cmdline`,
   `docker logs vllm-8000 > $RAW/ws7-boot-cold.log`, phase breakdown via `bench/perf/ws7_phases.py`
   (TDD: `bench/perf/test_ws7_phases.py`) → `results/ws7-boot.json`, `touch $RAW/done/ws7-cold`.
7. **Arm D block**: pre-check `curl -s localhost:8000/v1/models` served name ==
   `qwen38-27b-redhat-mxfp4-dflash` → reuse the prologue boot (serve_vllm.sh start would refuse non-TTY on
   a held port); else `start_server`. After all D cells done: `stop_server`, timed **warm reboot** via the
   same `start_server`, `ws7-warm` marker, `stop_server`.
8. **Memory-Fault watcher** (rule 15) wrapping every `run_probe`: probe in background, poll
   `docker logs --tail 300 $CURRENT_CONTAINER 2>&1 | grep -q 'Memory Fault'` every 5 s; on sight → kill
   probe, stop server, loud failure, exit 1 (no done marker → resume after fresh boot).
9. **Residency check** (rule 15b): after each radiance `/health` OK,
   `amd-smi process -g 0 > $RES/residency-<arm>.txt`; warn (do not abort) below the INFERRED weights-only
   floor (~16.4 GiB for the 27B MXFP4/IQ4R weights — stated as INFERRED in the file header).
10. **KLD flow** (round 1, `bench/perf/kld_probe.py`): per-family selftest marker
    (`tmp/done/kld-selftest-{radiance,sly}`) gated once — radiance at arm A's boot, sly at arm D's boot —
    then `fetch` per arm during its own boot (`$RES/kld-<arm>.jsonl`) and `score` vs the reference.
    Reference = one dedicated boot of profile `sly-radiance/qwen38-fp8` with `IMAGE=…1.11.0-rocm10.1`
    (served `qwen38-27b-fp8`), its fetch cached at `$RAW/kld-ref.jsonl` (resumable — skip if present +
    sha-ok). Any selftest/fetch failure aborts **the KLD pass only** (campaign continues). Uniform mode =
    paired greedy continuation (ws3-kld-r2 decision; the emitted `--mode` flag was not needed).
11. **Round 2 + arm E**: ROUND-guarded cells (50k × tg{512,1024,4096} × n{1,2} + tg4096 × 10k/100k ×
    n{1,2}; fixture `codereview-50000.txt` auto-built by the emitted `ensure_fixtures`); `--kld heretic`
    boots `sly-official/heretic-mxfp4` (served `swift-1.5`, image 1.8.1) → sly-family selftest (marker) +
    fetch + score vs the cached reference → stop.
12. **Summary table** at the end (per-arm decode/prefill at the grid depths + KLD one-liners + WS7
    seconds) so the user's go/no-go for `--round 2` is one screen.
13. **Gating fixes (2026-11-10/11):** the eight bugs the short run and the 2026-11-11 review exposed,
    plus the 2026-11-11 TDD pass (items A–H: c0 spec-off arm, boot-failure diagnosis, KLD cache keys,
    resumable fetch, score extras, measured WS7 cache state, per-boot measurables).
    Gating tests are in **`tests/test_run_gating.sh`** (91 asserts, no GPU —
    PATH-stubbed docker/curl, scratch CAMPAIGN_DIR under `tmp/gating-tests/`):
    - **P1** subset resume re-booted (gates checked the full slug set) → `selected_slugs` gates boots
      on the ONLY-selected set (supersedes `probes_selected`; T2/T9).
    - **P3** silent prologue boot failure → failures.txt line `WS7 COLD BOOT NOT MEASURED` (T6).
    - **P4** foreign-server reuse (item 7's name+image-only check) → reuse now also pins
      `--max-model-len $D_CTX` from `8000.cmdline` (T4/T5).
    - **P6** boot failures discarded the container log → now superseded by **item B** (below): the diagnosis
      is the appended `$RAW/boot-<name>.txt` + the `boots.jsonl` measurables row (T7/T8).
    - **P9** arm D fetched KLD rows after a *failed* sly selftest (arm_rad was gated, arm_d was not) →
      arm_d fetches only after the selftest marker (T13/T13b).
    - **P10** a cached KLD fetch or reference with errored rows was kept as complete (rule 18), and
      arms or a reference with errored rows were scored → `kld_complete()` gates the fetch cache, the
      reference cache and every score (`KLD SCORE SKIPPED` in failures.txt) (T10/T10b, T11/T11b, T14/T14b/T14c);
      T15 runs the real `kld_probe.py fetch` against a canned loopback server.
    - **P11** selftest JSON recorded no `model`/`url` (rule 2) → both recorded (`bench/perf/test_kld_probe.py`).
    - **P12** a re-run whose cells were all done skipped the KLD pass entirely (arm D and arm C returned at
      "skip (done)"), so a failed KLD fetch was never retried and the "re-run to re-fetch" message was a no-op.
      An arm now skips only when its probes are done **and** its KLD fetch is complete (T16, T16b, T16c);
      the P1 guards T2/T9 now set up a complete KLD pass.
    - **2026-11-11 TDD pass (items A–H), added to the same suite** (T17–T25b, plus `bench/perf/test_boot_diag.py`):
      - **A** spec-off arm **c0**: `start_rad` takes `spec_tokens` (default 7 → byte-identical, T17); c0 passes
        0; `arm_rad` keys the selftest marker by family *and* spec tokens (`radiance-spec0`); `kld_score_all`
        scores c0 under its own label; `print_summary` glob `kld-[a-z][0-9]*.json` (T17–T21, T22 end-to-end).
      - **B** boot-failure diagnosis: on a failed boot the driver appends its own view (start stderr + state-dir
        engine log + `serve … logs`) to `$RAW/boot-<name>.txt` / `boot-<arm>.txt`, records `start_rc` +
        `waited_s` in failures.txt, and writes a `boots.jsonl` row; the old `results/server-<name>-boot.log`
        is gone (T7/T8, T24, T24b).
      - **C** KLD caches record their **key** (`<file>.key.json`: n / calibration sha256 / max_tokens / top_k /
        image / model); a mismatch or a legacy keyless file is renamed `*.stale-<stamp>` (never deleted) then
        re-fetched — a `KLD_N=16` cache is never reused by a `KLD_N=128` run (T23, T23b, T23c).
      - **D** resumable fetch: `kld_probe.py fetch` keeps the clean key-matching rows and re-requests only the
        errored/missing prompts (rule 18 — an errored prompt is re-fetched, never cached as data) (T15).
      - **F** score extras (added, none renamed): `topk_len`, `floor_substitutions` (both directions),
        `top1_agreement_paired`, `kl_per_position` quantiles — the 19-vs-20 top-k question, quantified
        (`bench/perf/test_kld_probe.py`).
      - **G** WS7 cold/warm from the **MEASURED** cache state (`boot_diag cache_probe` of the image's host
        cache dir), not a dir-existence guess (T25, T25b).
      - **H** `boots.jsonl` measurables per boot: start_rc / ok / boot_seconds / image_id / resolved config /
        vram before+ready (sysfs) + peak (sampler CSV) / cache_state / engine_log numbers (T24d).
    - Each invocation appends `invocation=… repo_commit=… repo_dirty=…` to `results/meta.txt` (T12).
    New overridables: `SERVER_STATE_DIR`, `SERVE_VLLM`, `SERVE_RAD`, `D_CTX`, plus the boot-diagnosis leaves
    `BOOT_DIAG` / `BOOT_VRAM_SAMPLER` / `DRM_ROOT` / `VLLM_CACHE_ROOT`. Companion code (same TDD discipline):
    `ws7_phases.py` 1.11.0 format drift (7 tests), `kld_probe.py` logprobs-shape normalizer + `logprobs_shape()`
    diagnostics + provenance + cache-key sidecar + resumable fetch + score extras (60 tests), `capture_engine.py`
    raw SSE tail on "no tokens received" (6 tests), `boot_diag.py` (new) boot diagnosis + measurables (18 tests).
    Full detail: `tmp/runs/short-20261110-121812/results/analysis.md` §4.

Execution order: preflight → prologue (cold boot) → D (reused boot) → WS7 warm reboot → A → B → C
(ascending-depth cells per arm; radiance arms after sly so the WS7 numbers precede the grid noise).
