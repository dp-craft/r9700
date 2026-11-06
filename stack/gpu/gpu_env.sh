# gpu_env.sh — vendor detection + vendor-neutral GPU meta. Source this, don't execute.
#
#   source "$REPO/bench/lib/gpu_env.sh"
#   gpu_setup_env      # AMD only: exports HSA_OVERRIDE_GFX_VERSION (respects pre-set value)
#   gpu_meta           # prints gpu_vendor= / gpu_name= / gpu_driver= / vram_total_mib= lines
#
# Vendor is auto-detected (rocm-smi → amd, nvidia-smi → nvidia), override with GPU_VENDOR=.
# On non-AMD boxes nothing AMD-specific is exported — point LLAMA_BENCH/LLAMA_SERVER at a
# CUDA (or other) build of llama.cpp and everything else works unchanged.

gpu_detect_vendor() {
  if [ -n "${GPU_VENDOR:-}" ]; then echo "$GPU_VENDOR"; return; fi
  if command -v rocm-smi >/dev/null 2>&1 && rocm-smi --showproductname >/dev/null 2>&1; then
    echo amd; return
  fi
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    echo nvidia; return
  fi
  echo unknown
}

gpu_setup_env() {
  local vendor; vendor="$(gpu_detect_vendor)"
  if [ "$vendor" = amd ]; then
    # gfx1201 (R9700) needs 12.0.1; other AMD cards: pre-set HSA_OVERRIDE_GFX_VERSION yourself.
    : "${HSA_OVERRIDE_GFX_VERSION:=12.0.1}"
    export HSA_OVERRIDE_GFX_VERSION
  fi
}

gpu_meta() {
  local vendor; vendor="$(gpu_detect_vendor)"
  echo "gpu_vendor=$vendor"
  case "$vendor" in
    amd)
      echo "gpu_name=$(rocm-smi --showproductname 2>/dev/null | grep -m1 'Card Series' | sed 's/.*: *//;s/^[[:space:]]*//')"
      echo "gpu_driver=rocm-smi-lib $(rocm-smi --version 2>/dev/null | grep -m1 LIB | sed 's/.*: *//')"
      echo "vram_total_mib=$(rocm-smi --showmeminfo vram --json 2>/dev/null \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print(int(next(iter(d.values()))["VRAM Total Memory (B)"])//2**20)' 2>/dev/null)"
      echo "hsa_override=${HSA_OVERRIDE_GFX_VERSION:-}"
      ;;
    nvidia)
      nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null \
        | head -1 | awk -F', *' '{printf "gpu_name=%s\ngpu_driver=nvidia %s\nvram_total_mib=%s\n",$1,$2,$3}' | sed 's/ MiB$//'
      ;;
    *)
      echo "gpu_name=unknown"
      ;;
  esac
}
