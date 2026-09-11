# hipfire rollout — short plan

Companion to `2026-09-10-0100-hipfire-alongside-llama-swap-technical.md` (full research, evidence,
config snippets). This file is the execution checklist only.

**Target:** `qwen3.8:27b-mq4-pro` + `qwen3.8:27b-draft-mq4` (DFlash) on gfx1201 / R9700.
**Shape:** three gated phases. Each phase is independently reversible. Do not start a phase until the
previous gate has actually passed.

## Phase 0 — prerequisites (system-level, unavoidable)

| # | Step | Done when |
|---|---|---|
| 0.1 | ~~Check what owns `/opt/rocm/core-7.13`~~ **DONE** — dpkg-unowned orphan, 26 files (amd_smi python only). Safe to install over. | done |
| 0.2 | **REVISED** — repos already configured (`rocmradeon/apt/26.12`, per-gfx-arch). RDNA4 bundle is `gfx120x`: `sudo apt update && sudo apt install amdrocm-core-sdk-gfx120x amdrocm-llvm-dev` | `hipcc --version` works |
| 0.3 | Verify SDK completeness | `libamdhip64.so`, `libhsa-runtime64.so`, `hip_runtime.h`, `hipcc` all present |
| 0.4 | `rocminfo` reports gfx1201 | no `HSA_OVERRIDE_GFX_VERSION` needed |
| 0.5 | ~~Rust toolchain via rustup~~ **DONE** — cargo 1.98.1 at `~/.cargo/bin` | done |

**Risks:** kernel 7.0 is newer than ROCm's tested 6.8/6.17; ROCm issue #6110 (gfx1201 "has 2 ISAs").

**ENVIRONMENT TRAP (hit 2026-09-10, cost one full build).** `/home/dev/scripts/cc` is a personal
shortcut that launches `claude --dangerously-skip-permissions`, and `/home/dev/scripts/` precedes
`/usr/bin` on PATH — so it **shadows the C compiler**. Every Rust link step ran the Claude launcher
instead of gcc and failed with `error: linking with 'cc' failed`. The real compiler is intact at
`/usr/bin/cc` -> gcc-13. This breaks any native build that shells out to `cc` (cargo, autotools,
node-gyp), not just hipfire.

Workaround used: prepend `/usr/bin` to PATH and set `CC=/usr/bin/cc CXX=/usr/bin/c++` for the build.
Permanent fix (user's call, not done): rename the shim to something that is not a toolchain name.

**Also:** `install.sh` exited **0 despite the build failing**. Never trust its exit status — gate on
`hipfire --version` / `hipfire diag` instead.
**Rollback:** ROCm is the one step that genuinely changes the machine. Vulkan llama.cpp must still
work afterwards — verify before continuing.

## Phase 1 — install + standalone bench (GATE)

| # | Step | Done when |
|---|---|---|
| 1.1 | `install.sh --branch beta --rocm-root /opt/rocm --gpu-arch gfx1201 --strict-rocm` | binary on PATH |
| 1.2 | `hipfire diag` | reports gfx1201 cleanly — **hard stop if not** |
| 1.3 | ~~pull model + draft~~ **PRE-STAGED** — both in `~/.hipfire/models/`, byte-exact (16,464,182,272 + 1,209,603,072). 38 GB free remains. | done |
| 1.4 | `hipfire config set host 127.0.0.1` | not bound to 0.0.0.0 — default has **no auth, no TLS** |
| 1.5 | `hipfire serve qwen3.8:27b-mq4-pro` (foreground) | `/health` and `/v1/models` respond on :11435 |
| 1.6 | Temporary `runner.config.json` bench profile → `:11435/v1` | `/dp-test-llm` runs |
| 1.7 | ~~Bench vs baseline~~ **BASELINE DONE** — `docs/test/2026-09-10-hipfire-vs-llamacpp-baseline.md`. Targets to beat: decode **54.90** / prefill **843.33** tok/s (Qwen3.8-27B Q4_K_XL). | baseline recorded |
| 1.8 | Repeat with `speculation.dflash` on **and** off | tuned on tok/s, not acceptance rate |

**GATE:** beats the current Vulkan 27B row on tok/s at comparable output quality?
**No →** delete the temp profile and stop. Nothing else has changed.
**Yes →** Phase 2.

## Phase 2 — opencode provider, manual driving (GATE)

| # | Step | Done when |
|---|---|---|
| 2.1 | Add hand-maintained `hipfire` provider to `~/.config/opencode/opencode.json` | appears in `/models` |
| 2.2 | Confirm `python3 generate.py` does not clobber it | provider survives a regeneration |
| 2.3 | Drive it manually on real work | subjective quality assessed |
| 2.4 | Settle **real** usable context depth | `limit.context` is measured, not the 65536 placeholder |
| 2.5 | Settle how reasoning effort reaches it | request-body `variants` vs `hipfire config` — decided |

`sync_opencode()` mutates only `.provider["llama-swap"].models`; `ollama-local` already proves a second
provider survives. 2.2 is confirmation, not discovery.

**GATE:** satisfying to actually use? **Yes →** Phase 3.

## Phase 3 — llama-swap backend (the expensive part)

| # | Step | Done when |
|---|---|---|
| 3.1 | `generate.py`: `HIPFIRE_BIN` + `"hipfire"` macro (`serve 127.0.0.1 ${PORT}`, **no `-d`**) | macro emitted |
| 3.2 | `hipfire` added to `backends:` vocabulary; `full_id()` gets an `hf` tag | hipfire rows cannot collide with llama.cpp rows |
| 3.3 | `hipfire_tag:` field in `models.yaml`, emitted as `useModelName` | replaces `path:` for this backend |
| 3.4 | New `hipfire_cmd_for()`; `main()` branches on `be == "hipfire"` and **never** calls `cmd_for()` | no llama-server flags emitted |
| 3.5 | Skip the vulkan/rocm env blocks on hipfire rows | no `HSA_OVERRIDE_GFX_VERSION`, no `LD_LIBRARY_PATH` |
| 3.6 | **Raise** if a hipfire row sets llama.cpp-only keys (`templates`, `kv_unified`, `np`, `draft`, `spec_p_min`, `ctk`) | matches existing `mtp`+`draft` defensive posture |
| 3.7 | `cmdStop: hipfire stop`; leave `checkEndpoint` at default `/health` | hipfire exposes `/health` |
| 3.8 | `python3 generate.py` + `./start_llama_swap.sh restart` | model answers at `:9292` |
| 3.9 | Stop the standalone daemon; retire or bypass-only the Phase 2 provider | two swappers never race for the GPU |

**Why 3.6 matters:** hipfire keeps sampling in *persistent config overlays*, not argv. Two hipfire rows
differing only in temperature would emit byte-identical commands and silently share whatever the config
last said — the exact failure `full_id()`'s docstring already warns about.

## Open questions carried into execution

1. ~~Does v0.2.1 include the Qwen 3.8 27B ladder?~~ **RESOLVED 2026-09-10: it does not.** The v0.2.1
   release notes list arches `qwen35, llama, qwen2, dots-ocr, deepseek4, minimax, lfm2moe` with no
   Qwen 3.8, and the v0.2.1 `MODELS.md` has no "Qwen 3.8 dense" section; master does. **`--branch beta`
   is required, not optional** — a pinned v0.2.1 install cannot serve the target model.
2. Real usable context depth for a 16.46 GB model with q8 KV on 32 GB.
3. Does hipfire honour per-request reasoning-effort fields, or is effort config-only?
4. Published gfx1201 numbers are **Qwen 3.6 35B-A3B MoE**, not 3.8 27B dense — Phase 1 is the only
   evidence that will actually apply.

## Rollback summary

| Phase | Undo |
|---|---|
| 3 | remove `models.yaml` row → regenerate → restart |
| 2 | delete the `hipfire` provider block |
| 1 | delete the temp `runner.config.json` profile; `rm -rf ~/.hipfire` |
| 0 | ROCm stays — verify Vulkan llama.cpp still works after 0.2 |
