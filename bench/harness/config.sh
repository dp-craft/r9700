#!/usr/bin/env bash
# ── Unified benchmark configuration ─────────────────────────────────────────
# R9700 (gfx1201, RDNA4, 32GB). Single fixed context, both KV precisions, 30GB VRAM ceiling.
# ALL work files live under the git repo; only large model blobs live in ~/models,
# docker images in ~/dockers (both too big to version-control).

export REPO=/home/dev/work/dippe/amd
export CTX=65536                    # 64K context for ALL runs (user requirement)
export VRAM_CEIL_MB=30720           # 30 GB ceiling; configs exceeding are flagged
export N_DECODE=256                 # decode tokens to measure
export MODELS=/home/dev/models
# GGUFs copied to the root disk (sdb3) because the backup drive /mnt/LinBackup is
# root/bip-owned 700 and unreadable to the 'dev' user; host-run llama.cpp/ollama need
# a dev-readable path. AWQ weights stay on the drive (only Docker/root reads those).
export GGUFDIR="$MODELS/gguf"   # drive readable by dev again (setfacl u:dev:rx); local copy removed
export LC="$REPO/bench/llamacpp"    # llama.cpp b1295 gfx120X binaries (gitignored)
export HSA=12.0.1
export IMG=rocm/vllm:rocm7.13.0_gfx120X-all_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1
export HARNESS="$REPO/bench/harness"
export LONGPROMPT="$REPO/bench/longprompt.txt"
export RENDER_GID=992 VIDEO_GID=44
export OLLAMA_MODELS=/home/dev/models-local/ollama   # sdb3 (dev-writable); backup drive is 700/bip

# ── Model registry ──────────────────────────────────────────────────────────
export GGUF_35B="$GGUFDIR/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf"
export GGUF_35B_MTP="$GGUFDIR/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"   # unsloth MTP-preserved
export GGUF_27B="$GGUFDIR/Qwen3.6-27B-Q4_K_S.gguf"        # unsloth 27B-MTP repo (MTP-capable)
export AWQ_35B="$MODELS/Qwen3.6-35B-A3B-AWQ-4bit"
export AWQ_27B="$MODELS/Qwen3.6-27B-AWQ-INT4"

export OLL_35B="q35:local"
export OLL_27B="q27:local"

export RESULTS="${RESULTS:-$REPO/bench/harness/results.jsonl}"
