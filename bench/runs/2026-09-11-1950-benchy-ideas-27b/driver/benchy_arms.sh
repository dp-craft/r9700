#!/usr/bin/env bash
# Glue (tool gap, stated): campaign.sh has no EXTRA_ARGS / llama-benchy knob and gen_campaign.py emits
# probe-only run.sh. This loop only SEQUENCES the existing tools per arm:
#   gpu_exclusive.sh → engine-bench/serve_llamacpp.sh → engine-bench/run.sh USE_BENCHY=1 → serve stop
# then an interleaved rm_kq A/B via model-bench/run.sh (llama-bench: no MTP, low noise).
# Usage: benchy_arms.sh CAMP_DIR PR_VER      (resumable: an arm with CAMP/<arm>.done is skipped)
set -uo pipefail
REPO=/home/dev/work/dp-craft/amd
CAMP=$1; PR_VER=$2
PORT=8095
MODEL=/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf
TPL=/home/dev/.config/llama-swap/templates/froggeric-chat_template.jinja
# = served row qwen38-27b-q4kxl-180k-f16-ctx160k-mtp-frog-coding minus --spec-type (set per arm)
BASE="--kv-unified --jinja --temp 0.7 --top-p 0.80 --top-k 20 --min-p 0 --presence-penalty 1.5 --chat-template-file $TPL"
BENCHY_BASE="--tokenizer Qwen/Qwen3.8-27B --pp 2048 --tg 512 --depth 0 16384 --runs 3 --exact-tg --no-cache --format json"
mkdir -p "$CAMP"
trap 'bash ~/.config/llama-swap/restart_llama_swap.sh start 2>&1 | tail -1' EXIT

run_arm() {  # NAME BUILD KV SPEC...
  local name=$1 build=$2 kv=$3; shift 3; local spec="$*" t0=$SECONDS out
  [ -f "$CAMP/$name.done" ] && { echo "skip $name (done)"; return 0; }
  echo "=== $name  build=$build kv=$kv spec=[$spec]  $(date +%T)"
  "$REPO/bench/lib/gpu_exclusive.sh" 28000 >/dev/null || { echo "$name: GPU not free" | tee -a "$CAMP/failures.txt"; return 1; }
  if ! GGML_VK_ALLOW_GRAPHICS_QUEUE=1 LLAMA_SERVER="$REPO/build/$build/bin/llama-server" MODEL="$MODEL" \
       CTX=163840 NP=1 UB=2048 B=4096 FA=on KV="$kv" MTP=0 PORT=$PORT WAIT=300 \
       EXTRA_ARGS="$BASE $spec" "$REPO/bench/engine-bench/serve_llamacpp.sh" start; then
    echo "$name: server failed to start" | tee -a "$CAMP/failures.txt"
    cp "$REPO/bench/.servers/$PORT.log" "$CAMP/$name.server.log" 2>/dev/null; return 1
  fi
  out=$(USE_BENCHY=1 SAMPLE_VRAM=1 SLUG="benchy-$name" ENGINES_LIST="$name|http://127.0.0.1:$PORT/v1|qwen38-27b" \
        BENCHY_ARGS="$BENCHY_BASE --save-result $CAMP/$name.json" timeout 420 "$REPO/bench/engine-bench/run.sh" 2>&1)
  PORT=$PORT "$REPO/bench/engine-bench/serve_llamacpp.sh" stop
  cp "$REPO/bench/.servers/$PORT.log" "$CAMP/$name.server.log"
  cp "$REPO/bench/.servers/$PORT.cmdline" "$CAMP/$name.cmdline"
  echo "$out" | sed -n 's/^→ results: //p' > "$CAMP/$name.rundir"
  if [ -s "$CAMP/$name.json" ]; then touch "$CAMP/$name.done"
  else echo "$name: no benchy result" | tee -a "$CAMP/failures.txt"; echo "$out" | tail -5; fi
  echo "    $name: $(( SECONDS - t0 ))s"
}

run_arm base-mtp3        b10909-vulkan        f16  --spec-type draft-mtp
run_arm mtp-nmax5        b10909-vulkan        f16  --spec-type draft-mtp --spec-draft-n-max 5
run_arm mtp-ngram        b10909-vulkan        f16  --spec-type draft-mtp,ngram-mod --spec-draft-n-max 2 \
                                                   --spec-ngram-mod-n-match 24 --spec-ngram-mod-n-min 24 --spec-ngram-mod-n-max 86
run_arm kvq8-mtp3        b10909-vulkan        q8_0 --spec-type draft-mtp
run_arm pr-mtp3          "$PR_VER-vulkan"     f16  --spec-type draft-mtp
run_arm pr-adaptive12    "$PR_VER-vulkan"     f16  --spec-type draft-mtp-adaptive --spec-draft-n-max 12
run_arm base-mtp3-repeat b10909-vulkan        f16  --spec-type draft-mtp

# rm_kq A/B, interleaved ABAB (a ~1% kernel effect is below benchy's MTP noise → llama-bench)
i=0
for b in b10909-vulkan b10909-rmkq1-vulkan b10909-vulkan b10909-rmkq1-vulkan; do
  i=$((i + 1)); [ -f "$CAMP/rmkq-$i.done" ] && continue
  echo "=== rmkq-$i $b  $(date +%T)"
  "$REPO/bench/lib/gpu_exclusive.sh" 28000 >/dev/null || { echo "rmkq-$i: GPU not free" | tee -a "$CAMP/failures.txt"; continue; }
  out=$(GGML_VK_ALLOW_GRAPHICS_QUEUE=1 LLAMA_BENCH="$REPO/build/$b/bin/llama-bench" MODEL="$MODEL" SLUG="rmkq$i-$b" \
        PP=512 TG=128 DEPTH=0 UB=2048 BATCH=4096 CTK=f16 CTV=f16 REPS=5 timeout 300 "$REPO/bench/model-bench/run.sh" 2>&1)
  echo "$out" | sed -n 's/^→ results: //p' > "$CAMP/rmkq-$i.rundir"
  [ -s "$(cat "$CAMP/rmkq-$i.rundir")/llama-bench.json" ] && touch "$CAMP/rmkq-$i.done" \
    || { echo "rmkq-$i: failed" | tee -a "$CAMP/failures.txt"; echo "$out" | tail -5; }
done
echo "ALL DONE $(date +%T)"
