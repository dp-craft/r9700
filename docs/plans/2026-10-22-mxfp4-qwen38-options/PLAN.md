# PLAN — stable MXFP4 Qwen3.8-27B at 150k (8-bit KV) + two llama-swap additions

> **STATUS 2026-10-23: SOLVED — `HIP_FORCE_DEV_KERNARG=0`** (`docs/analysis/2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg.md`; working notes in `FASTPATH.md`). The unchanged Sly 1.6.0 + DFlash config (`sly-radiance/qwen38-mxfp4-dflash`, llama-swap `qwen38-27b-mxfp4-dflash-kvfp8-vllm`) is the solution; the batches/options below are kept for history and are not needed for the fault.

- **Written:** 2026-10-22 (end of the Sly-radiance fault session) · **Executor:** a fresh Claude session; a small model can run it
- **Background (read only if stuck):** `docs/analysis/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md`
- **This folder:** `PLAN.md` (this file), `claudetest.sh` (**the fault gate**, see below), `vllmtest.sh`, `swaptest.sh`, `fixtures/p0..p4.json`, `results.tsv` (created by the scripts), `logs/`

## Rules for the executor (from CLAUDE.md — do not skip)

1. **One GPU, one job.** Run every GPU test sequentially. No parallel subagents on the GPU. Haiku subagents may do **web research only**.
2. **Before every boot, make the GPU free:**
   - Run `bench/lib/gpu_exclusive.sh 30000`. It unloads llama-swap via `GET /unload`.
   - `vllmtest.sh` does this unload itself.
3. **Never use `pkill -f` or `pgrep -f` with a pattern.**
   - Stop vLLM with `PORT=8000 bench/engine-bench/vllm/serve_vllm.sh stop`.
   - Stop llama-swap's model with `curl -s http://127.0.0.1:9292/unload`.
4. **Ask the user before:**
   - committing (we are on `main`; branch first),
   - deleting any model file,
   - posting anything upstream (issues, comments),
   - editing a file this plan does not name.
5. **Don't investigate deeply.**
   - If an option fails, write one line into the results table at the bottom and go to the next option.
   - Max one retry per option, and only for an obvious typo or a missing pull.
6. **A boot takes 5–10 min**, longer than the earlier 7 min, because `vllmtest.sh` disables the compile cache.
   - The 5 prompts take about 1–3 min.
   - Run tests with `run_in_background` and wait for the notification. Don't poll.
7. **Data tags:** every number written into a doc is tagged MEASURED (from `results.tsv` / `logs/`), CLAIMED (web, with URL) or INFERRED.

## What "working" means (acceptance test)

```bash
D=/home/dev/work/dp-craft/amd/docs/plans/2026-10-22-mxfp4-qwen38-options
bash $D/claudetest.sh <label> <engine>/<profile> [ENV=VAL ...] # THE GATE: boots :8000 like vllmtest, load = real Claude Code
bash $D/vllmtest.sh <label> <engine>/<profile> [ENV=VAL ...]   # vLLM option, boots its own server on :8000
bash $D/swaptest.sh <llama-swap-model-id> [label]              # anything already in llama-swap
```

- **Gate = `claudetest.sh`** (added 2026-10-22 evening). It boots exactly like `vllmtest.sh` (same temp profile, `VLLM_DISABLE_COMPILE_CACHE=1`, same knobs: `IMAGE KV_DTYPE MAXLEN MAXSEQS GPU_UTIL EXTRA_ARGS`), then drives a **real `claude -p` session** with `~/.config/claude/local_vllm_direct/settings.json` (= `local_muxik` pointed at `:8000`, **no llama-swap**): 4 read-heavy turns chained with `--continue`, so the context grows like an agent's. The served model name is read from `/v1/models` and written into a per-run copy of the settings (`logs/<label>.settings.json`), so it works for every profile. **PASS** = all 4 turns exit 0 with `is_error=false` and no `MEMORY_FAULT`. Result line: `PASS | FAULT@tN | CLAUDE_FAIL@tN | BOOT_FAILED`.
  - **Why it replaces the fixtures as the gate** (MEASURED 2026-10-22): the unchanged baseline PASSed `vllmtest.sh` once (`baseline-rerun`, 14/9/5/6/6 s) and then faulted on the **first** real Claude request, ~5 s in (`claude-direct`, `radiance_mxfp4_fp8_gemm_folded`), with llama-swap not involved. The fixtures only reach the `atiled` path and fault intermittently; Claude's request shapes reach `folded` at once.
  - `vllmtest.sh` stays for timing comparisons (fixed p0..p4 shape).
  - **Budget (user, 2026-10-22, synced):** `~/.config/claude/local_muxik` (via llama-swap) and `local_vllm_direct` (direct, `:8000`) now differ only in URL + model id. Both: `CLAUDE_CODE_MAX_CONTEXT_TOKENS=180000`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=33000`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75`, no `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. The llama-swap row `qwen38-27b-mxfp4-dflash` is at ctx 180000 (id unchanged). The gate boots at `MAXLEN` = that window (override with `MAXLEN=`) and takes every other budget value from `local_vllm_direct`. `~/.config/claude/local_vllm_direct/vllm.sh start|stop|status|logs` serves the same config by hand. vLLM accepts prompts only up to 180000 − 33000 = 147k. Compaction was 85% ≈ 153k, which left a 147k–153k HTTP 400 gap; then 81%, now **75% ≈ 135k** (user, 2026-10-22: "safe values") — 81% sat only ~1k under the 147k limit, and Claude Code's own token estimate can differ from vLLM's count. If MAXLEN or the output budget changes, keep PCT < (MAXLEN − MAX_OUTPUT) / MAXLEN.
- **`vllmtest.sh` PASS** means all 5 prompts (shared-prefix series: p0 ~25k tokens cold, p1/p2 cache hits, p3/p4 ~5k new tokens each on a cached prefix) return HTTP 200 with no `MEMORY_FAULT`.
- **Baseline** (Sly 1.6.0 profile, MEASURED 2026-10-22): `vllmtest.sh` FAULT@p4 in `radiance_mxfp4_fp8_gemm_atiled` (p0..p3 13 / 7 / 5 / 5 s), then once PASS (`baseline-rerun`); `claudetest`-style run FAULT@t0 in `radiance_mxfp4_fp8_gemm_folded`.
- **Task 3 uses stricter rules** (see "Batched search"): the gate is `claudetest.sh`, and a PASS counts only after a second, identical confirmation boot also PASSes.
- **Confirmed winner** → § "Apply a winner", then one real Claude Code session:
  ```
  claude --settings /home/dev/.config/claude/local_muxik/settings.json
  ```
  Give it a prompt that reads a few repo files.

## Baseline — the reference config (every option changes ONE thing from this)

This is the exact config that ran the DFlash performance campaigns and reproduces the fault (MEASURED 2026-10-22, test #12 in `ISSUE-SUMMARY.md`). `vllmtest.sh <label> sly-radiance/qwen38-mxfp4-dflash` with **no extra arguments** boots exactly this. Every option below adds or changes **one** item, so a PASS/FAULT difference has one cause. Do not "also fix" anything else in the same run.

| Layer | Value |
|---|---|
| Image | `ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1` (vLLM 0.31.0) |
| Profile | `bench/engine-bench/vllm/profiles/sly-radiance/qwen38-mxfp4-dflash.env` → sources `qwen38-mxfp4.env` + `_engine.env` (**files unchanged**) |
| Model | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` @5233554c (`/mnt/Lin1/work/vllm/sly-radiance/models/amd__Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c`) · `--quantization quark` |
| Drafter | `syvai/Qwen3.8-27B-DFlash2-W4A16`, `num_speculative_tokens 7`, greedy, drafter attention TRITON_ATTN · cudagraph sizes `[8]` |
| Plugin env | `RADIANCE_MXFP4=1 RADIANCE_MXFP4_W4A8=1 RADIANCE_MXFP4_W4A8_MIN_M=0 RADIANCE_MXFP4_DECODE_MAX_M=128 RADIANCE_MXFP4_A_TILED_MIN_M=513 RADIANCE_MXFP4_WPERM=1 RADIANCE_LMHEAD_INT4=1 RADIANCE_FUSED_NORM_QUANT=1 RADIANCE_KV_GROUP_SIZE=8 RADIANCE_EMBED_INT8=1 RADIANCE_EMBED_BITS=4 RADIANCE_MXFP4_WIDE_MAX_M=192 RADIANCE_ADAPTIVE_WIDTH=perseq` |
| Engine env | `HIP_VISIBLE_DEVICES=0 GPU_MAX_HW_QUEUES=2 RADIANCE_RUN_BWTEST=0` + (test harness only) `VLLM_DISABLE_COMPILE_CACHE=1` |
| Engine args | `--max-model-len 150000 --max-num-seqs 1 --gpu-memory-utilization 0.90 --kv-cache-dtype fp8 --mamba-ssm-cache-dtype bfloat16 --attention-backend R4D_HYBRID --max-num-batched-tokens 2048 --compilation-config.cudagraph_mode FULL_DECODE_ONLY --enable-prefix-caching --chat-template /opt/qwen-fixed.jinja` (+ tool/reasoning parsers, sampler overrides from `_engine.env`) |
| NOT in baseline | sharp template, RAM KV tier (`KVCACHE=ram`), ctx 180000, np 8 — all ruled out as causes, add back only after a fix is found |
| Baseline result | p0 13.1 s · p1 7.3 · p2 4.9 · p3 5.0 · **FAULT@p4** (`radiance_mxfp4_fp8_gemm_atiled`). KV pool 345,297 tok |

Check the booted config matches: `bench/.servers/8000.cmdline` (written by `serve_vllm.sh`) — diff it against a baseline boot's cmdline if in doubt.

## Current state you inherit (fix at the end, whichever option wins)

- **`~/.config/llama-swap/models.yaml`, vLLM row `qwen38-27b-mxfp4-dflash`:** this is a TEST state.
  - Current values: ctx 150000, np 1, no `templates: [sharp]`, no `kv_ram_gib`.
  - Its generated id is `qwen38-27b-mxfp4-dflash-kvfp8-vllm`.
- **`~/.config/claude/local_muxik/settings.json`:** still points at `qwen38-27b-mxfp4-dflash-kvfp8-vllm-sharp`, an **id that no longer exists**.
  - Point it at whatever id wins, after asking the user.
- **`CLAUDE_CODE_MAX_OUTPUT_TOKENS` is 64000 in the same settings file.** vLLM rejects prompt + max_tokens > max-model-len (HTTP 400, MEASURED), so at ctx 150000 requests break once the prompt passes ~86k. Recommended: **28000** (ok up to a ~122k prompt at ctx 150k, near Claude Code's compaction point). **Ask the user before changing it** — pending their approval since 2026-10-22.
- **Regenerate the llama-swap config** after any `models.yaml` edit:
  ```bash
  cd ~/.config/llama-swap
  python3 generate.py && python3 -m pytest tests -q
  ```
  If only the golden test fails, and only because of your intended change, regenerate it:
  `python3 -m pytest tests/test_golden.py --regenerate-golden -q`.
  llama-swap runs with `-watch-config`, so it reloads by itself.
- **Disk:**
  - `/mnt/LinBackup` (GGUF models dir `/home/dev/models/gguf`) has **~28 GB free**.
  - `/` (docker images) has ~66 GB free.
  - The flint GGUF (25 GB) fits, but afterwards there is no room for another big GGUF. **Ask the user what to delete** before Option C.

---

## Task 1 — upstream ("normal") radiance image + the official AMD MXFP4 checkpoint in llama-swap

The "normal" radiance is `stilldeadcode/vllm-radiance` (Docker Hub; source <https://codeberg.org/StillDeadcode/vllm-radiance>).
- Latest Docker Hub tag on 2026-10-22: **`0.9.3`** (vLLM 0.27.1).
- We used it for the INT4 W4A16 model in September (`docs/analysis/2026-09-12-1055-vllm-radiance-r9700-evaluation.md`).
- **Unknown:** whether 0.9.3 can load the Quark MXFP4 checkpoint. The boot test answers that.
- The author also published `StillDeadcode/qwen3.8-27b-mxfp4` on HF, so MXFP4 support likely exists in a newer build.

1. **Check for a newer tag**, and use the newest one in the steps below:
   ```bash
   curl -s "https://hub.docker.com/v2/repositories/stilldeadcode/vllm-radiance/tags?page_size=5&ordering=last_updated" \
     | python3 -c "import json,sys;[print(t['name'],t['last_updated'][:10]) for t in json.load(sys.stdin)['results']]"
   ```
2. **Pull the image** (~14 GB on disk):
   ```bash
   docker pull stilldeadcode/vllm-radiance:0.9.3
   ```
3. **Create the engine profile** `bench/engine-bench/vllm/profiles/radiance/_engine.env`.
   - The args are taken from the last working llama-swap row for this image (git `~/.config/llama-swap` b589e8b, `config.yaml` line 336ff).
   - `--language-model-only` is dropped: that flag was INT4-specific.
   - **CORRECTED 2026-10-23:** this line used to say the AMD checkpoint has no MTP head. **Wrong.** `config.json` has `mtp_num_hidden_layers: 1` and the safetensors header holds 15 BF16 `mtp.*` tensors (MEASURED, header read). MTP profiles now exist; see Task 1b.
   - **Superseded 2026-10-23:** the block below is the first version. The live `radiance/_engine.env` also restores the measured AITER `=0` matrix and `RADIANCE_FAST_DRAFT/DRAFT_TAU/SKINNY_GEMM` (both from git `b589e8b` `config.yaml:346-362`), and adds Sly's template, kwargs and sampler. See Task 1b. Also on 2026-10-23 the live `sly-radiance/_engine.env` runs `RADIANCE_CACTUS_DELTA=0` (the 10-22 fault-reproduction default was the image's 0.5) and `--enforce-eager` (the `FULL_DECODE_ONLY` flags are gone) — to reproduce the 10-22 baseline exactly: `CACTUS_DELTA=0.5` + restore the two `--compilation-config` lines.
   ```bash
   # Engine layer: upstream StillDeadcode/vllm-radiance (https://codeberg.org/StillDeadcode/vllm-radiance).
   # Args from the 2026-09 llama-swap row that ran this image (git ~/.config/llama-swap b589e8b).
   IMAGE=${IMAGE:-stilldeadcode/vllm-radiance:0.9.3}
   GPU_UTIL=${GPU_UTIL:-0.90}
   MAXSEQS=${MAXSEQS:-1}
   KV_DTYPE=${KV_DTYPE:-fp8}
   FREE_MIB_FLOOR=${FREE_MIB_FLOOR:-30000}
   CACHE_MOUNTS=(cache:/cache)
   ENGINE_ENV=(
     HIP_VISIBLE_DEVICES=0
     VLLM_ROCM_USE_AITER=1 VLLM_ROCM_USE_AITER_UNIFIED_ATTENTION=1
     VLLM_CACHE_ROOT=/cache/vllm TORCHINDUCTOR_CACHE_DIR=/cache/inductor
     TRITON_CACHE_DIR=/cache/triton AITER_ROOT_DIR=/cache/aiter TRITON_CACHE_AUTOTUNING=1
   )
   ENGINE_ARGS=(
     --max-num-seqs "$MAXSEQS" --gpu-memory-utilization "$GPU_UTIL" --kv-cache-dtype "$KV_DTYPE"
     --max-num-batched-tokens 16384
     --attention-backend R4D --enable-prefix-caching --mamba-cache-mode align
     --enable-auto-tool-choice --tool-call-parser qwen3_xml --reasoning-parser qwen3
     --enable-force-include-usage --enable-prompt-tokens-details
     --no-async-scheduling
   )
   ```
4. **Create the model profile** `bench/engine-bench/vllm/profiles/radiance/qwen38-mxfp4.env`:
   ```bash
   MODEL_DIR=${MODEL_DIR:-/mnt/Lin1/work/vllm/sly-radiance/models/amd__Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c}
   SERVED_NAME=${SERVED_NAME:-qwen38-27b-mxfp4-radiance}
   MAXLEN=${MAXLEN:-150000}
   MODEL_ENV=()
   MODEL_ARGS=(--quantization quark)
   ```
   - The checkpoint is already on disk (pinned rev 5233554c). Do NOT download it again.
5. **Dry-run the command line**, check it looks sane, then run the acceptance test:
   ```bash
   PROFILE=radiance/qwen38-mxfp4 bench/engine-bench/vllm/serve_vllm.sh print
   bash $D/vllmtest.sh radiance-093 radiance/qwen38-mxfp4
   ```
   - **If it fails because of an argument** the old vLLM doesn't know (`unrecognized arguments: X`): delete that argument from `_engine.env` and retry once.
   - **If it fails on `--model /model`:** this image may want the model path as a positional argument. Report it and don't hack `serve_vllm.sh`.
   - **If it fails because MXFP4/quark is unsupported:** record "0.9.3 cannot load MXFP4" and stop Task 1. Tell the user. A newer upstream build or Option D may be needed.
6. **Add to llama-swap** (only if step 5 booted, PASS or FAULT). Append to `models.yaml` next to the existing vLLM row:
   ```yaml
   - id: qwen38-27b-mxfp4-radiance
     vllm_profile: radiance/qwen38-mxfp4
     ctx: 150000
     kv: fp8
     family: QWEN38
     backends: [vllm]
     np: 1
   ```
   - Regenerate (see "Current state"), then `grep -n "mxfp4-radiance" ~/.config/llama-swap/config.yaml` to get the generated id.
   - Run `bash $D/swaptest.sh <generated-id> radiance-swap`.
   - The id rule: `useModelName` rewrites the request to the profile's `SERVED_NAME`. Make sure the generated row's `useModelName` equals `qwen38-27b-mxfp4-radiance`, same as the Sly row works.

## Task 1b — Sly vs upstream radiance, identical configs: performance A/B (POSTPONED, user 2026-10-23)

**Status:** configs written and reviewed **without a GPU** (2026-10-23). Not booted. Run this after Task 2, or whenever the user asks for it.

**Image:** `stilldeadcode/vllm-radiance:0.9.3` (vLLM 0.27.1). It is the newest Docker Hub tag **and** the newest code on Codeberg (last commit 2026-08-26, "add dflash2 support"). `docker pull` on 2026-10-23 confirmed the local copy is current.

**What was verified without a GPU (2026-10-23):**
- **Flags:** all present in the 0.9.3 source (grep): `--override-generation-config`, `--default-chat-template-kwargs`, the Quark MXFP4 scheme, `dflash`, `R4D`, the Anthropic `/v1/messages` endpoint, and `--kv-offloading-size`.
- **Template:** `templates/qwen-fixed-sly-1.6.0.jinja` was extracted from Sly's `/opt/qwen-fixed.jinja`. md5 `5c928b42…` equals `~/.config/llama-swap/templates/froggeric-chat_template.jinja`. Note that `amd/llama-swap/templates/froggeric…` is a **different** file.
- **Dry run:** every llama-swap vLLM row passes `serve_vllm.sh print` through the config-dir symlink (exit 0). The llama-swap sampler is the **last** `--override-generation-config` in the argv, so it wins. 2026-10-23 re-print after `--enforce-eager`: all 5 rows show it, and the Sly rows no longer show the `--compilation-config` flags.

**The A/B design: identical model-facing settings, each engine's own tuned kernels.**

| Same on both engines | Engine-specific (each engine's measured recipe) |
|---|---|
| checkpoint `amd__Qwen3.8-27B-Quark-AWQ-MXFP4@5233554c`, `--quantization quark` | attention: Sly `R4D_HYBRID` · radiance `R4D` |
| DFlash: drafter `syvai…DFlash2-W4A16@4d30ec73`, k=7, greedy draft, drafter `TRITON_ATTN` | `--max-num-batched-tokens`: Sly 2048 · radiance 16384 |
| MTP: `{"method":"mtp","num_speculative_tokens":4,"attention_backend":"R4D","disable_padded_drafter_batch":true}` + `--no-async-scheduling` (Sly `serve.sh:155-159` = our 2026-09 radiance row) · `--enforce-eager` on **both** (2026-10-23) | — (cudagraph removed; see the eager note below) |
| template (md5 above) · `reasoning_effort: medium` · sampler 1.0/0.95/20/0, `presence_penalty` 0 | plugin env: Sly `RADIANCE_MXFP4_*` (W4A8) · radiance AITER matrix + `FAST_DRAFT` |
| ctx 190000 · np 1 · fp8 KV · util 0.90 · `HIP_FORCE_DEV_KERNARG=0` | Sly-only: Cactus (`RADIANCE_CACTUS_DELTA`), KVCACHE=ram tier |

**Cactus confound, and why the Sly arms must run at delta 0:**
- Sly's Cactus (image default delta 0.5) is a **lossy** acceptance transform. It patches the V2-runner rejection kernel for every sampled spec request (`sly/patch_cactus.py`).
- Upstream radiance has no Cactus, so it runs stock acceptance, which equals Sly at `RADIANCE_CACTUS_DELTA=0`.
- So the **identical** comparison is Sly at delta 0. Delta 0.5 is a separate "as shipped" arm.
- Delta 0.5 is also the main suspect for the infinite loops (Sly issue #164).

**Eager mode (DEPLOYED 2026-10-23, user decision):** `--enforce-eager` is now in both `_engine.env` files.
- Sly: replaces the README quickstart's `FULL_DECODE_ONLY` + capture sizes (`README.md:125-126,226`). Radiance: overrides the 0.27 default.
- Verified in both images' source: `enforce_eager` → `CompilationMode.NONE`, `CUDAGraphMode.NONE`, capture sizes cleared, one warning (1.6.0 = vLLM 0.31 `config/vllm.py:1694-1712,1967-1972`; 0.9.3 = vLLM 0.27 `config/vllm.py:1210,1442`) — a clean override, not a flag conflict.
- vLLM's own ROCm eager fallback applies only to encoder-decoder models (`config/model.py:_verify_cuda_graph` in both images), which Qwen3.8 does not trigger — so without this flag, both arms would have been graphing.
- INFERRED rationale: the ROCm fault history (`ISSUE-SUMMARY.md`) and Cactus #164 make the graph path a variable the A/B does not need.
- If a graph on/off comparison is wanted later: restore Sly `FULL_DECODE_ONLY` + `CUDAGRAPH_SIZES` and run as separate S*/R* arms — do not mix with the eager arms.

**Arms** (one boot each, sequentially, `bench/lib/gpu_exclusive.sh 30000` before each):

| # | Profile | Extra env | Purpose |
|---|---|---|---|
| S1 | `sly-radiance/qwen38-mxfp4-dflash` | — (profile default: Cactus 0) | identical twin of R1 |
| S1c | `sly-radiance/qwen38-mxfp4-dflash` | `CACTUS_DELTA=0.5` | as shipped; loop check |
| S2 | `sly-radiance/qwen38-mxfp4-mtp` | — (profile default: Cactus 0) | identical twin of R2 |
| R1 | `radiance/qwen38-mxfp4-dflash` | — | |
| R2 | `radiance/qwen38-mxfp4-mtp` | — | |
| R2k8 | `radiance/qwen38-mxfp4-mtp` | `SPEC_K=8` | radiance's own default depth (dynamic draft treats k as a ceiling) |
| R0 | `radiance/qwen38-mxfp4` | — | no speculation; separates the engine from the drafter |

**Cactus knob (DEPLOYED 2026-10-23, user decision):** `sly-radiance/_engine.env` now sets `RADIANCE_CACTUS_DELTA=${CACTUS_DELTA:-0}`, so every Sly profile and llama-swap row runs Cactus **off**. For the S1c arm, prefix the run with `CACTUS_DELTA=0.5`.

**Procedure**
1. **Boot gate:** `bash $D/vllmtest.sh <arm> <profile>`. PASS means the profile boots and loads. If 0.9.3 rejects Quark MXFP4 or the drafter, record that and drop the radiance arms (Task 1 step 5 rules). If a boot rejects ctx 190000 (KV pool too small), rerun it at `MAXLEN=150000` and use 150000 for **all** arms.
2. **Throughput:** scaffold a campaign via **`/benchmark-new-campaign`** (rule 6; do not hand-write a driver). Use `capture_engine.py probe` against `serve_vllm.sh start`.
   - Prefill at **≥4 depths** (e.g. 8k/36k/90k/160k). Fit log-log and quote the exponent and R² (rule 16).
   - Also measure multi-turn growth with prefix reuse (rule 17), decode tok/s, TTFT, and draft acceptance.
   - Read the KV pool tokens from the boot log, and the VRAM peak from `vram_sampler.py` (rule 7).
3. **Loop check** (S1c vs S1, plus the MTP arms):
   - One long-output thinking task with `max_tokens` 32k, n=3 per arm.
   - A run that exceeds 3× the median length with no tool call / `stop` counts as a loop.
   - Report loops/n per arm. A killed run is quarantined, not graded (rule 18).
4. **RAM tier smoke** (Sly llama-swap rows, `kv_ram_gib: 8`):
   - `bash $D/swaptest.sh qwen38-27b-mxfp4-dflash-kvfp8-vllm ramtier`, then the same for `qwen38-27b-mxfp4-mtp-kvfp8-vllm`.
   - Before 2026-10-23 the RAM tier faulted 3/3. Those runs predate the kernarg fix, so this re-checks it.
5. **Document** via **`/benchmark-results`** into a co-located `analysis.md`. The memory column is mandatory. Record the ROCm/image digest/model rev per arm.

**llama-swap rows** (`~/.config/llama-swap/models.yaml`, generated ids):
- Sly: `qwen38-27b-mxfp4-dflash-kvfp8-vllm`, `qwen38-27b-mxfp4-mtp-kvfp8-vllm` (both `kv_ram_gib: 8`).
- radiance: `qwen38-27b-mxfp4-radiance-kvfp8-vllm`, `qwen38-27b-mxfp4-radiance-dflash-kvfp8-vllm`, `qwen38-27b-mxfp4-radiance-mtp-kvfp8-vllm`.
- All take the sampler from `generate.py` (`vllm_sampler()`, QWEN38 planning recipe, `presence_penalty` pinned 0).

## Task 2 — flint GGUF in llama-swap

Model: `unsloth/flint-GGUF`, file `flint-UD-Q4_K_XL.gguf`.
- **CLAIMED, HF API:** 25.05 GB, arch `flint`, 39.8B params, context_length 262144, revision `20468edfc38ab43d6914cc88b08cbecb05d0fc62`.
- **CLAIMED, card:** temperature 1.0, top-p 0.95, top-k 20. Thinking model; keep `reasoning_content`.
- **Config:** hidden 2048 with a sparse step, so it is probably MoE. It mixes sliding and full attention, so KV is small.

Use the **`/llama-swap-add-model` skill**. It owns the download → `models.yaml` → `generate.py` → review steps. Inputs for the skill:

1. **Download** into `/home/dev/models/gguf/unsloth/`:
   ```bash
   cd /home/dev/models/gguf/unsloth && \
   wget -c "https://huggingface.co/unsloth/flint-GGUF/resolve/20468edfc38ab43d6914cc88b08cbecb05d0fc62/flint-UD-Q4_K_XL.gguf"
   ls -l flint-UD-Q4_K_XL.gguf     # expect 25,05x,xxx,xxx bytes
   ```
2. **Check that our llama.cpp knows the `flint` arch** before touching `models.yaml`. The arch is new:
   ```bash
   bench/lib/gpu_exclusive.sh 28000
   /home/dev/work/dp-craft/amd/llamacpp/builds/latest-vulkan/bin/llama-cli \
     -m /home/dev/models/gguf/unsloth/flint-UD-Q4_K_XL.gguf -ngl 99 -c 4096 -p "hi" -n 16 -no-cnv 2>&1 | tail -5
   ```
   - If it says `unknown model architecture: 'flint'`, **stop Task 2** and tell the user. A newer llama.cpp is needed, via the `/llamacpp-build` skill, which is the user's decision.
3. **Get the KV size and max ctx** (don't hand-calculate):
   ```bash
   python3 bench/gguf_kv.py /home/dev/models/gguf/unsloth/flint-UD-Q4_K_XL.gguf --weights-gib 23.3
   ```
   - Weights are 25.05 GB, which is 23.3 GiB.
   - Pick ctx = min(262144, the f16 max). If f16 can't reach 150000, use q8_0 KV.
4. **`models.yaml` row** (adjust ctx and kv from step 3):
   ```yaml
   - id: flint-q4kxl
     path: unsloth/flint-UD-Q4_K_XL.gguf
     ctx: 150000
     kv: f16
     family: QWEN38      # placeholder: sampler 1.0/0.95/20 matches the card; if QWEN38 differs, add family FLINT per the skill
     backends: [vulkan]
   ```
   - The `QWEN38` family: check that its coding sampler is temp 1.0 / top-p 0.95 / top-k 20 (`grep -n "Q38_" ~/.config/llama-swap/generate.py`).
   - If it isn't, add a one-entry family `FLINT` exactly as the skill describes.
5. **Regenerate the config**, then `bash $D/swaptest.sh <generated flint id> flint` (it just has to answer; this is a smoke test).
6. Commit only after the user says yes.

## Task 3 — if the running test fails: options in order of likelihood

**Goal:** a working **MXFP4 Qwen3.8-27B, ctx 150000, 8-bit KV**, without quality loss.

**What we know** (MEASURED 2026-10-22):
- **Reproducible without llama-swap:** the unchanged baseline on `:8000`, driven by a real Claude Code session, faulted on its first request (`claude-direct`, `_folded`). llama-swap is not a cause.
- The fault is an intermittent GPU "page not present" fault inside Sly's MXFP4 **W4A8** GEMM kernels: `radiance_mxfp4_fp8_gemm_atiled` and `_folded`.
- It is prompt-dependent.
- It is NOT caused by ctx 180k, the sharp template, the RAM KV tier, np, request order, or A-tiled alone.
- Kernel source is not in the image (compiled `.so`), so we can't patch it.
- Ruled out as fixes:
  - `RADIANCE_MXFP4_SYNC=1` can't boot (sync inside HIP graph capture).
  - `PYTORCH_HIP_ALLOC_CONF=expandable_segments:True` can't boot.
  - `RADIANCE_MXFP4_PADOUT` only pads the output, but the author says the kernel never writes out of bounds, so it doesn't target the bug.

### Image-version options — DO THESE FIRST (user, 2026-10-22)

The fault is in Sly's compiled W4A8 kernels, so the cheapest test is another Sly image with the profile unchanged (`IMAGE=` override only):

| # | Option | How | Status |
|---|--------|-----|--------|
| V1 | **Sly 1.5.1** (older published image, `ghcr.io/slybase/vllm-sly-radiance:1.5.1-rocm10.1`) — does the fault predate 1.6.0? | `IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.5.1-rocm10.1 bash $D/claudetest.sh v151 sly-radiance/qwen38-mxfp4-dflash` | **FAULT 1/2** (v151 PASS t0..t3 = 151/90/96/211 s; v151-2 FAULT@t0 after 5 s, `_atiled`, grid [139264,7,1]) → the fault **predates 1.6.0**; 1.5.1 is not a fallback |
| V2 | **Sly 1.7.0 / `main`, custom build** (vLLM 0.32.0, AITER 0.1.24.post1, transformers 5.19.0 per Sly README; no published image) — does `main` still fault? Upstream will ask this first | build from Sly's Dockerfile as `vllm-sly-radiance:1.7.0-local` (CPU only), then the same gate with `IMAGE=` | optional — 1.5.1 also faults, so 1.7.0 matters only if its changelog/kernel changed (none mentions this fault) |
| L1 | **Context ladder** (user, 2026-10-22) on the mhist config (unchanged 1.6.0 + DFlash + `RADIANCE_MXFP4_MHIST=1`, which PASSed once @160k): 120k → 135k → 150k → 165k → 180k, 2 gate runs per step, stop at the first non-PASS. A shorter window = a different KV pool = a different layout, so this tests whether some ctx is reliably clean, not whether long prompts fault | `bash $D/ladder.sh lad sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_MHIST=1` (`START/STEP/END/RUNS` knobs). Gate compaction per step = min(75, floor((MAXLEN − 33000)/MAXLEN·100) − 3): 69/72/75/75/75 % | **FAULT at the first step** (lad-120k-r1, t0 after 25 s, `_atiled`, grid [65536,7,1]) → a smaller window does not avoid it; mhist @160k was luck |

1.5.1 vs 1.6.0 (MEASURED, md5 inside the images): same vLLM 0.31.0 / AITER 0.1.23 / transformers 5.17.0 / `/opt/qwen-fixed.jinja`, every RADIANCE_* var the profile sets exists; **only `radiance_mxfp4_fp8.so` differs** (`3f57393c…` vs `89d18c15…`; autoround/escha/gdn/paroquant .so identical) → V1 isolates exactly the faulting kernel library. 1.5.1's plugin also has debug knobs `RADIANCE_MXFP4_CHECKX/SANITIZE/CLONE/SHADOW`.
Our 1.6.0 image (MEASURED): vLLM 0.31.0, AITER 0.1.23, transformers 5.17.0, torch 2.13.0+rocm10.1.0, triton 3.8.0. Host ROCm is 10.1.0 (HIP 7.16) — the container brings its own user space, so only the kernel driver is shared.
If V1 PASSes 2/2, 1.6.0 introduced the regression → it becomes the serving fallback and the bisect target for the upstream issue. If it faults, go to V2.

### Batched search — DO THIS (the table further down is the reference catalog)

A vLLM boot costs ~10 min, so several **quality- and ctx-neutral** changes go into ONE boot. If a batch PASSes, split it in half and test again (bisect) until one change is left. If a batch FAULTs, every change in it is ruled out together and you move to the next batch.

**Rules for batches**
- **Stop rule:** the first confirmed winner (PASS twice, and bisected if it was a multi-change batch) ends Task 3 → § "Apply a winner". Later batches run only if nothing has passed, or if the user asks for alternatives (e.g. llama.cpp for comparison).
- **Order:** Batch 1 → 2 → 3 → 4 → 5; Batch 6 only if the user agrees (lowest priority, optional). Batch 2 needs the Task 1 `radiance` profile; Batch 3 needs the user's OK for disk space.
- **Gate = `claudetest.sh`** (real Claude Code, 4 turns). A batch "PASSes" only with all 4 turns clean. The commands below were written for `vllmtest.sh ROUNDS=2` and are now given as `claudetest.sh`; same arguments, same env knobs. If a batch PASSes `claudetest.sh`, also run `ROUNDS=2 bash $D/vllmtest.sh <label>-fx …` once with the same arguments, for the timing comparison against the baseline and as a second load shape.
- **Confirm before bisecting:** a PASS can be luck (the fault is stochastic). Re-run the same batch once. Bisect only if the second run also PASSes (cost: 1 extra boot; saves a whole bisection built on luck).
- Only combine changes that keep quality, keep ctx 150000 and keep 8-bit KV. Never put an image change and knob changes in the same batch.
- Write each run's line into the Results table at the bottom (`results.tsv` has the raw line).
- `$D=/home/dev/work/dp-craft/amd/docs/plans/2026-10-22-mxfp4-qwen38-options` in all commands.

**Batch 1 — Sly 1.6.0, four perturbations together**

| Change | How | Why |
|---|---|---|
| no DFlash (user: try first) | profile `sly-radiance/qwen38-mxfp4` instead of `…-dflash` | different M shapes (no 8-token verify batches); also changes cudagraph sizes to `[1,2,4,8]` |
| PADOUT 65536 | `RADIANCE_MXFP4_PADOUT=65536` | moves every following buffer (allocator perturbation) |
| more free VRAM | `GPU_UTIL=0.85` | more unreserved VRAM around the activation buffers (see note below). KV pool should still be ~2× 150k (INFERRED) — check the `GPU KV cache size` line in `logs/<label>.server` is ≥ 150,000 |
| other chunk rhythm | `EXTRA_ARGS="--max-num-batched-tokens 4096"` | different chunk remainders M |

```bash
GPU_UTIL=0.85 EXTRA_ARGS="--max-num-batched-tokens 4096" \
  bash $D/claudetest.sh B1 sly-radiance/qwen38-mxfp4 RADIANCE_MXFP4_PADOUT=65536
```
- **FAULT** → all four ruled out (INFERRED: a combination could in principle mask a single fix, accepted to save boots). Chunk **1024** is not covered by Batch 1; it stays untested unless the user asks. Go to Batch 2.
- **PASS** → re-run as `B1-confirm`. If that also PASSes, bisect:

| Step | Run | Command  |
|---|---|---|
| 1a | no DFlash + util 0.85 | `GPU_UTIL=0.85 bash $D/claudetest.sh B1a sly-radiance/qwen38-mxfp4` |
| 1b | (only if 1a FAULTs) DFlash on + PADOUT + chunk 4096 | `EXTRA_ARGS="--max-num-batched-tokens 4096" bash $D/claudetest.sh B1b sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_PADOUT=65536` |
| 2 | split the passing pair into its two single changes (one boot each; each = baseline + ONE change) | if 1a passed: `bash $D/claudetest.sh B1-nodflash sly-radiance/qwen38-mxfp4` and `GPU_UTIL=0.85 bash $D/claudetest.sh B1-util sly-radiance/qwen38-mxfp4-dflash`. If 1b passed: `bash $D/claudetest.sh B1-pad sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_PADOUT=65536` and `EXTRA_ARGS="--max-num-batched-tokens 4096" bash $D/claudetest.sh B1-chunk sly-radiance/qwen38-mxfp4-dflash` |
| — | if BOTH halves FAULT | the fix needs the combination → keep the full Batch 1 set (it passed twice) and stop bisecting |
| — | winner | the smallest set that passed; confirm it once more, then **Apply a winner** |

If a single winner costs speed (no DFlash = slower decode; util 0.85 = smaller KV pool), report the p-times to the user and let them choose; don't decide alone.

**Batch 2 — upstream radiance** (Option D / Task 1): `stilldeadcode/vllm-radiance:0.9.3` or newer, via the `radiance/qwen38-mxfp4` profile from Task 1. It uses libr4d directly, not Sly's W4A8/WPERM plugin, so different kernel code. Task 1 (MEASURED 2026-10-22): `vllmtest.sh` PASS and llama-swap PASS, but ~40–57 s per prompt vs the baseline's 5–14 s (no drafter, no Sly MXFP4 kernels — INFERRED). For the stability verdict run the gate:
```bash
bash $D/claudetest.sh B2-upstream radiance/qwen38-mxfp4
```
If it cannot load MXFP4 (BOOT_FAILED), record it and move on.

**Batch 3 — other engine** (Option B, llama.cpp MXFP4 GGUF): follow § "Option B detail" (ask the user about disk space first; it needs ~15–17 GB on `/mnt/LinBackup`, which flint fills). No vLLM boot; `bash $D/swaptest.sh <id> B3-gguf` twice (the two calls = PASS + confirm).

**Batch 4 — other checkpoint on Sly 1.6.0** (Option H): one boot per checkpoint, gate `claudetest.sh`.

**Batch 5 — Hail Mary (Sly 1.6.0, baseline config + one change each; one boot each)**

| Run | Command | Note |
|---|---|---|
| 5a PADOUT 128 | `bash $D/claudetest.sh B5a-pad128 sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_PADOUT=128` | Smaller padding than Batch 1's 65536. 128 bf16 = 256 B, likely below the allocator's 512 B rounding, so it may change nothing (INFERRED). Skip if Batch 1 (which had PADOUT 65536) already FAULTed and you are short on time |
| 5b KV int8 | first list the accepted names: `docker run --rm --entrypoint python3 ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1 -c "import typing,vllm.config.cache as c;print(typing.get_args(c.CacheDType))"`, then `KV_DTYPE=<the int8 name> bash $D/claudetest.sh B5b-int8 sly-radiance/qwen38-mxfp4-dflash` | **Expect BOOT_FAILED**: FROM-CODE, R4D_HYBRID only accepts `auto/float16/bfloat16/fp8*`; int8 variants exist only on TRITON_ATTN. The fp8 KV scale (1.0) and the W4A8 activation scales are separate tensors in separate kernels, so an interaction is unlikely (INFERRED). Record the result either way. Do not switch the attention backend to make it boot (that changes more than one thing) |

**Batch 6 — OPTIONAL, lowest priority (user: only if time allows)**
- 6a older Sly tags, baseline config. If 1.4.0 passes at 150k / util 0.90, the fault is a 1.6.0 regression:
  ```bash
  docker pull ghcr.io/slybase/vllm-sly-radiance:1.5.1-rocm10.1
  IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.5.1-rocm10.1 bash $D/claudetest.sh B6a-151 sly-radiance/qwen38-mxfp4-dflash
  docker pull ghcr.io/slybase/vllm-sly-radiance:1.4.0-rocm10.1
  IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.4.0-rocm10.1 bash $D/claudetest.sh B6a-140 sly-radiance/qwen38-mxfp4-dflash
  ```
  An older image may not know a `RADIANCE_*` knob (silently ignored, fine) or an engine arg (boot error → record BOOT_FAILED with the error line and move on; do not edit `_engine.env`).
- 6b magiccodingman fork: `docker pull magiccodingman/vllm-radiance:1.0.397`, then `IMAGE=magiccodingman/vllm-radiance:1.0.397 bash $D/claudetest.sh B6b-magic radiance/qwen38-mxfp4`.

**Last resort** — W4A8 off (Option A, MEASURED stable on 5 requests but ~12× slower) and the upstream report (Option I, user decides).

**Note on the "KV cache squeezes the activation workspace at 150k but not 140k" idea** (external, 2026-10-22): the mechanism doesn't hold as stated — vLLM sizes the KV pool once at boot from `--gpu-memory-utilization`, not from `--max-model-len` (MEASURED: 331k–355k tokens at both 150k and 180k), and no 140k run exists to compare. Its useful core (the over-read only faults when it crosses into unmapped memory, so free VRAM headroom may matter) is tested by `GPU_UTIL=0.85` in Batch 1.

**Cost/benefit:** every option is one `vllmtest.sh` or `swaptest.sh` line. Superseded by **Batched search** above (no DFlash is in Batch 1). This table explains each option; when running one alone, stop at the first one that PASSes twice. The probability ranking is INFERRED.

| # | Option | Why it might work | Quality / ctx impact | Command |
|---|--------|-------------------|----------------------|---------|
| **E** (in Batch 1) | Sly 1.6.0 **without DFlash** | Different M shapes reach the GEMMs (no 8-token verify batches); the fault is shape-dependent | none; decode slower | `bash $D/vllmtest.sh E-nodflash sly-radiance/qwen38-mxfp4` (this profile = baseline minus the drafter; it also falls back to the engine's default cudagraph sizes `[1,2,4,8]`, an unavoidable second difference) |
| **A** | Sly 1.6.0, **W4A8 off** (aiter W4A4 MXFP4 path) | The two faulting kernels are W4A8-only, so they are never called. W4A4 is the checkpoint's native scheme. | None expected; **MEASURED 2026-10-22: PASS on all 5 prompts, but steady state ~60 s vs ~5 s (~12× slower)**. Already done; last resort | `bash $D/vllmtest.sh A-w4a4 sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_W4A8=0` |
| **A2** (obsolete: A booted fine once the compile cache was off) | A, plus the other W4A8-only knobs off | Only needed if A fails at **boot** with a W4A8-related error (not `radiance_wref`; that was the compile cache, now disabled by the script) | same as A | `bash $D/vllmtest.sh A2 sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_W4A8=0 RADIANCE_MXFP4_A_TILED_MIN_M=0 RADIANCE_MXFP4_DECODE_MAX_M=0 RADIANCE_MXFP4_WIDE_MAX_M=0` |
| **A3** (Batch 1 / 5a) | Sly 1.6.0, **`RADIANCE_MXFP4_PADOUT`** (allocator perturbation) | Pads the GEMM output inside a larger slab. Not aimed at the suspected input over-read, but it shifts the allocation geometry of every following buffer — the author noted earlier bugs vanished when "perturbing the allocator" (CLAIMED, plugin comment). Value is bf16 elements per side: 128 = 256 B (probably below the allocator's 512 B rounding → may change nothing), 65536 = 128 KiB | none (extra VRAM per GEMM call, small) | `bash $D/vllmtest.sh A3-pad128 sly-radiance/qwen38-mxfp4-dflash RADIANCE_MXFP4_PADOUT=128`; then `… A3-pad64k … RADIANCE_MXFP4_PADOUT=65536`. Note any speed change in p1–p3 |
| **B** (Batch 3) | **llama.cpp + an MXFP4 GGUF** (`quark75/Qwen3.8-27B-MXFP4-GGUF`, HF search 2026-10-22) | A different engine with no radiance kernels; llama.cpp is our stable baseline | MXFP4 = same weight format; q8_0 KV; 150k fits (27B: 64 KiB/tok f16, MEASURED) | see § Option B |
| **C** (Batch 6, optional) | **Older Sly tags**: `1.5.1-rocm10.1`, then `1.4.0-rocm10.1` (do NOT go below 1.0.0: the 0.x tags are ROCm 10.0 builds and likely predate Qwen3.8 MXFP4 + DFlash2 support) | The fault may be a 1.6.0 regression (the A-tiled kernel is recent, dated 2026-09-01 in the plugin notes) | none | `docker pull ghcr.io/slybase/vllm-sly-radiance:1.5.1-rocm10.1` then `IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.5.1-rocm10.1 bash $D/vllmtest.sh C-151 sly-radiance/qwen38-mxfp4-dflash` |
| **D** (Batch 2; magiccodingman = Batch 6, optional) | **Upstream radiance** (Task 1 result), then the **`magiccodingman/vllm-radiance`** fork | Different kernel code (libr4d, not Sly's MXFP4 plugin) | none | stilldeadcode: already tested in Task 1 step 5; reuse that result. magiccodingman (Docker Hub tag `1.0.397`, pushed 2026-10-18, 4.1 GB compressed; MXFP4 support UNKNOWN): `docker pull magiccodingman/vllm-radiance:1.0.397`, then `IMAGE=magiccodingman/vllm-radiance:1.0.397 bash $D/vllmtest.sh D-magic radiance/qwen38-mxfp4` (reuses the Task 1 `radiance` profile; if args are rejected, remove the unknown arg once, else record and move on) |
| **F** (Batch 1) | Sly 1.6.0, **different prefill chunk** (1024 or 4096 tokens) | Changes the remainder M of the last prefill chunk, a suspect for the over-read (INFERRED) | none | `EXTRA_ARGS="--max-num-batched-tokens 4096" bash $D/vllmtest.sh F-4096 sly-radiance/qwen38-mxfp4-dflash`, then the same with `1024` (the last flag wins in vLLM argparse) |
| **G** (Batch 5b) | Sly 1.6.0, **KV int8 instead of fp8** (your idea) | Low: the fault is in the weight GEMM, not in KV. But it's cheap. | int8 KV is still 8-bit | first `docker run --rm --entrypoint python3 ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1 -c "import vllm.config.cache as c,inspect;print([l for l in inspect.getsource(c).splitlines() if 'CacheDType' in l][:3])"` and use the listed 8-bit name (`int8`/`fp8_e5m2`): `KV_DTYPE=int8 bash $D/vllmtest.sh G-int8 sly-radiance/qwen38-mxfp4-dflash` |
| **H** (Batch 4) | **Other MXFP4 checkpoints** on Sly 1.6.0: `Capicua25x/Qwen3.8-27B-MXFP4-Quark-RDNA4`, `RedHatAI/Qwen3.8-27B-MXFP4` | Different packing may route to different kernels | unknown quality (not AMD's official quant) | `bench/engine-bench/vllm/fetch_model.sh <repo> <sha>` (sha from `https://huggingface.co/api/models/<repo>`), then `MODEL_DIR=/mnt/Lin1/work/vllm/sly-radiance/models/<org>__<repo>@<sha8> bash $D/vllmtest.sh H-<name> sly-radiance/qwen38-mxfp4-dflash` |
| **I** | **Report upstream** to SlyBase/vllm-sly-radiance | The kernel author can fix the over-read | — | Draft the issue text into this folder (`ISSUE-draft.md`, repro = `vllmtest.sh` + fixtures + the kernel line from `logs/*.server`). **State prominently that every repro/fix attempt must run with `VLLM_DISABLE_COMPILE_CACHE=1`** — the AOT compile cache is not keyed on `RADIANCE_*` env vars, so a cached graph can make a fix look like it works or fails (MEASURED: `KeyError 'radiance_wref'`). Use `ISSUE-SUMMARY.md` as the source. **Do not post. Ask the user.** |

**Optional research** (haiku subagent, web only, ≤10 min, before C/D/H). Prompt:
> "Search github.com/SlyBase/vllm-sly-radiance (issues, releases, commits) and codeberg.org/StillDeadcode/vllm-radiance for: 'memory fault', 'Page not present', 'atiled', 'gemm_folded', 'W4A8', 'MXFP4'. Return a table: link, date, one-line summary, which version fixed it. Also list the vllm-sly-radiance release notes for 1.4.0–1.6.0 and any newer tag. Only facts with URLs."

If the research names a fixed version or a specific env flag, test that **first** (same `vllmtest.sh` form).

### Option B detail (llama.cpp MXFP4 GGUF)

1. **List the files** and pick the one MXFP4 file for the 27B (~15–17 GB expected):
   ```bash
   curl -s "https://huggingface.co/api/models/quark75/Qwen3.8-27B-MXFP4-GGUF?blobs=true" \
     | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['sha']);[print(s['rfilename'],round(s.get('size',0)/1e9,1)) for s in d['siblings']]"
   ```
2. **Disk:** `/mnt/LinBackup` will not have room after flint. **Ask the user** which GGUF to delete, or whether to store it elsewhere.
3. **Download** to `/home/dev/models/gguf/quark75/<file>`. Add a row via `/llama-swap-add-model`:
   - id `qwen38-27b-mxfp4-gguf-q8`
   - ctx 150000, kv q8_0, family QWEN38, backends [vulkan]
   - no MTP unless the GGUF has nextn tensors; check with `python3 bench/gguf_kv.py <file>`
4. **Test:** `bash $D/swaptest.sh <generated id> B-gguf`.
5. **If Vulkan errors on the MXFP4 tensor type**, try `backends: [rocm]` once.

## Apply a winner (vLLM option)

1. **Make the fix permanent in the profile.** Ask the user first, because it edits an existing file.
   - **What llama-swap can and cannot carry:** the generated command passes only `PROFILE PORT CONTAINER_NAME SERVED_NAME MAXLEN MAXSEQS KV_DTYPE` to `serve_vllm.sh` (`~/.config/llama-swap/generate.py` ~line 807). So every other winning change must live **in a profile file**. Prefer a NEW sibling profile (one file, easy to revert) over editing `qwen38-mxfp4.env`. Mapping per Batch 1 change:

     | Winning change | Put in the sibling profile | llama-swap row consequence |
     |---|---|---|
     | PADOUT 65536 | `MODEL_ENV+=(RADIANCE_MXFP4_PADOUT=65536)` | none |
     | util 0.85 | `GPU_UTIL=${GPU_UTIL:-0.85}` (the profile is sourced before `_engine.env`, whose `${GPU_UTIL:-0.90}` then keeps it) | none |
     | chunk 4096 | `EXTRA_ARGS="${EXTRA_ARGS:-} --max-num-batched-tokens 4096"` (appended after the engine args; the last flag wins) | none |
     | no DFlash | source `qwen38-mxfp4.env` instead of `qwen38-mxfp4-dflash.env` | **the served name changes** to `qwen38-27b-mxfp4` (the DFlash profile hard-codes `qwen38-27b-mxfp4-dflash`; the plain one takes `SERVED_NAME` from llama-swap). The row `id` must change (e.g. `qwen38-27b-mxfp4`), so the generated id and the Claude settings ids change too. Decode is slower without the drafter: report the p-times |
     | older/other image | `IMAGE=${IMAGE:-<tag>}` | the compile cache dir is per tag (`cache/<tag>`), so no stale-graph risk on the first boot |

   - Check with `PROFILE=sly-radiance/<new> bench/engine-bench/vllm/serve_vllm.sh print` that the argv equals the winning test's (compare against `logs/<label>.boot` / `bench/.servers/8000.cmdline` of that run), apart from `VLLM_DISABLE_COMPILE_CACHE`.
   - Either add the env to `bench/engine-bench/vllm/profiles/sly-radiance/qwen38-mxfp4.env` `MODEL_ENV`,
   - or create a sibling profile, e.g. `qwen38-mxfp4-dflash-w4a4.env`:
     ```bash
     source "$(dirname "${BASH_SOURCE[0]}")/qwen38-mxfp4-dflash.env"
     MODEL_ENV=("${MODEL_ENV[@]/RADIANCE_MXFP4_W4A8=1/RADIANCE_MXFP4_W4A8=0}")
     ```
   - **Compile cache:** the first boot after changing `RADIANCE_*` must not reuse a stale compiled graph. Delete only that image's compile cache:
     ```
     /mnt/Lin1/work/vllm/sly-radiance/cache/vllm-sly-radiance@1.6.0-rocm10.1/root-cache/vllm
     ```
     Ask the user first. Or keep `VLLM_DISABLE_COMPILE_CACHE=1` in `MODEL_ENV`; that costs a few minutes per boot.
2. **Point the llama-swap row at it** (`vllm_profile:`), keep `ctx: 150000`, `kv: fp8`, `np: 1`, regenerate.
   - The user's original target was ctx 180000 + `templates: [sharp]`. Ask whether to restore those now; they were ruled out as fault causes.
3. **Run the checks:**
   - `bash $D/swaptest.sh <id> final-swap`
   - then one real Claude Code session through llama-swap: `claude --settings /home/dev/.config/claude/local_muxik/settings.json` (the direct-to-vLLM gate `claudetest.sh` already passed by then; this checks the llama-swap path)
4. **Update `~/.config/claude/local_muxik/settings.json`** model ids to the new llama-swap id (ask first).
5. **Speed note for the user:** compare the p0..p3 times in `results.tsv` with the baseline (13 / 7 / 5 / 5 s). Also report decode (`output_tokens / time` from `logs/<label>.p*.out`).
6. **Document:** append a dated "Update" section to `docs/analysis/2026-10-22-1643-vllm-mxfp4-atiled-fault-and-llama-swap-serving.md`. Use a table of every option tried, with result and provenance tags, then run `python3 docs/reindex.py`.

## Results (fill in as you go — one line per run; `results.tsv` has the raw lines)

| # | Label | Result | Boot | p0..p4 times | Note |
|---|-------|--------|------|--------------|------|
| baseline | baseline | FAULT@p4 | ~7 min | 13/7/5/5 s | atiled kernel (2026-10-22) |
| — | sync1 | BOOT_FAILED | — | — | hipErrorStreamCaptureUnsupported |
| — | expseg | BOOT_FAILED | — | — | silent death at weight load |
| A | w4a4 (first try) | BOOT_FAILED | — | — | KeyError 'radiance_wref' = stale AOT compile cache, not W4A4 |
| A | w4a4 + VLLM_DISABLE_COMPILE_CACHE=1 | **PASS** (1 run) | ~10 min | 295/152/63/61/62 s (steady ~12× baseline) | stable but too slow; keep as the last resort. Start the new session at Batch 1 (Batched search) |
| T1 | radiance-093 (`vllmtest.sh`, upstream `stilldeadcode/vllm-radiance:0.9.3`, no drafter, no plugin env) | **PASS** (1 run) | 403 s | 57/40/43/43/43 s | loads Quark MXFP4; stable but ~6–8× slower than baseline (no DFlash drafter = likely cause, INFERRED) (2026-10-22) |
| T1 | radiance-swap (`swaptest.sh qwen38-27b-mxfp4-radiance-kvfp8-vllm`) | **PASS** | in p0 | 391(incl. boot)/40/44/45/43 s | llama-swap row added; `useModelName` = `qwen38-27b-mxfp4-radiance` (2026-10-22) |
| baseline | baseline-rerun (unchanged Sly 1.6.0 DFlash profile, after the `serve_vllm.sh` contract changes) | PASS (1 run, ROUNDS=1) | 260 s | 14/9/5/6/6 s | speed matches the original baseline; no fault at p4 this time → the atiled fault is intermittent, 1 PASS proves nothing (2026-10-22) |
| baseline | claude-direct (unchanged Sly 1.6.0 DFlash profile on :8000, NO llama-swap; real `claude -p` with `~/.config/claude/local_vllm_direct/settings.json`) | **FAULT@t0** (1st Claude request, ~5 s in) | 188 s | — | MEMORY_FAULT in `radiance_mxfp4_fp8_gemm_folded<2,true,true,false>`, grid [20480,7,1] — a different kernel from the atiled one in the synthetic test; llama-swap ruled out as the cause (2026-10-22) |
| baseline | claude-baseline-2 (`claudetest.sh`, unchanged Sly 1.6.0 DFlash profile) | **FAULT@t0** (~10 s into the 1st turn) | 158 s | — | 2nd independent repro, same `radiance_mxfp4_fp8_gemm_folded<2,true,true,false>`; also the end-to-end check of `claudetest.sh` (cleanup verified: container gone, temp profile removed, :8000 free) (2026-10-22) |
| B1 | B1 (`claudetest.sh`: no DFlash + PADOUT 65536 + util 0.85 + chunk 4096) | **CLAUDE_FAIL@t1** — not a fault | 188 s | t0=397 s (9 tool rounds, clean) | no MEMORY_FAULT; t1 hit HTTP 400 prompt 86001 + max_tokens 64000 > 150000 (the known `CLAUDE_CODE_MAX_OUTPUT_TOKENS` issue, a gate bug). KV pool 384,224 tok at util 0.85 (≥150k ✓). Caveat: chunk 4096 moves the prefill remainder M, so surviving t0 may be shape luck, not a fix (2026-10-22) |
| diag | mhist (`claudetest.sh`, unchanged baseline + `RADIANCE_MXFP4_MHIST=1`, MAXLEN 160000) | **no fault**; CLAUDE_FAIL@t3 | 166 s | t0..t2 = 85/66/75 s | t3 = HTTP 400 at prompt 127,001 + 33,000 output > 160,000 (compaction at 90% ≈ 144k never reached). The N=5120 K=6144 layer ran at M=1760 and 1706/1587/1560 (all 7 tiles of 256, i.e. the faulting grid's shape class) with NO fault. KV pool 349,295 (vs 345,297 at 150k) → a small change in memory layout made the 2/2 fault vanish; consistent with a placement-dependent over-read, NOT proof. Faulting shape not captured (2026-10-22) |
| baseline | swap-180k (`swaptest.sh qwen38-27b-mxfp4-dflash-kvfp8-vllm`, unchanged Sly 1.6.0 DFlash via llama-swap, ctx 180000, KV pool 354,661) | **FAULT@p0** | in p0 | p0 = HTTP 500 after 537 s (fault + hang) | `radiance_mxfp4_fp8_gemm_atiled<2,…>`, grid [20480,7,1] — same launch shape as the direct repros; fixture load (not Claude) faults at 180k too. llama-swap unloaded (GET /unload 200), VRAM 575 MiB after (2026-10-22) |
| V1 | v151 (`claudetest.sh`, `IMAGE=…1.5.1-rocm10.1`, unchanged DFlash profile, MAXLEN 180000) | PASS | 494 s | t0..t3 = 151/90/96/211 s | decode med 59 tok/s, prefill med 2226 / max 3194 tok/s, accept 4.64 (`speeds.py`, 10 s windows) (2026-10-22) |
| V1 | v151-2 (same, 2nd boot) | **FAULT@t0** (5 s) | 322 s | — | `radiance_mxfp4_fp8_gemm_atiled`, grid [139264,7,1] → 1.5.1 faults too (2026-10-22) |
| L1 | lad-120k-r1 (`ladder.sh`: unchanged 1.6.0 DFlash + `RADIANCE_MXFP4_MHIST=1`, MAXLEN 120000, compaction 69%) | **FAULT@t0** (25 s) | 167 s | — | `radiance_mxfp4_fp8_gemm_atiled`, grid [65536,7,1]; ladder stopped, no ctx is clean (2026-10-22) |
