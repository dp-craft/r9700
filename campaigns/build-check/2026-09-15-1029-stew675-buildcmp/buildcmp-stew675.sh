#!/usr/bin/env bash
# buildcmp-stew675 — benchmark comparison: stock vs stew675-patched llama.cpp builds.
#
# Resumable: re-run to pick up new builds or failed arms. Already-done arms are detected
# by valid llama-bench.json in the output dir and skipped. Use --force to re-run all.
#
# Re-uses existing stock-vulkan baseline (b10969-vulkan-1.4.357.1) from 2026-09-14.
#
# Builds:
#   stock-vulkan    — b10969-vulkan-1.4.357.1  (SKIP: re-use baseline)
#   stock-rocm      — b10909-rocm              (RUN)
#   stew675-vulkan  — b790cf51aa-stew675-vulkan-1.4.357.1  (RUN)
#   stew675-rocm    — b790cf51aa-stew675-rocm              (RUN, if build complete)
#
# Knobs: UB=2048, BATCH=4096, KV=q8_0, FA=on, NGL=99, REPS=1
# Shapes: (128,64), (512,256), (2048,512), (8192,1024), (32768,2048)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BUILD="$REPO/llamacpp/builds"
MODEL="/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf"
FORCE=0

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[ -f "$MODEL" ] || { echo "model not found: $MODEL" >&2; exit 1; }

# --- knobs ---
UB=2048; BATCH=4096; CTK=q8_0; CTV=q8_0; FA=on; NGL=99; REPS=1
declare -a SHAPES=("128,64" "512,256" "2048,512" "8192,1024" "32768,2048")

# --- existing baseline ---
EXISTING_BASELINE="$REPO/bench/runs/2026-09-14-2350-model-buildcmp-b10969-vulkan-1.4.357.1"

# --- find or create output dir ---
# Look for the most recent buildcmp-stew675 dir to resume from
LATEST_OUT=$(ls -1dt "$REPO/bench/runs/"*-buildcmp-stew675 2>/dev/null | head -1 || true)

if [ -n "$LATEST_OUT" ] && [ "$FORCE" -eq 0 ]; then
  # Check if any arms are missing — if all done, print results and exit
  echo "Resuming: $LATEST_OUT"
  ROOT_OUT="$LATEST_OUT"
else
  STAMP="$(date '+%Y-%m-%d-%H%M')"
  ROOT_OUT="$REPO/bench/runs/${STAMP}-buildcmp-stew675"
  mkdir -p "$ROOT_OUT"
  echo "New run: $ROOT_OUT"
fi

# --- arms definition ---
# label:symlink:action (baseline = re-use existing, run = build and benchmark)
declare -a ARMS_DEF=(
  "stock-vulkan:latest-vulkan:baseline"
  "stock-rocm:latest-rocm:run"
  "stew675-vulkan:latest-stew675-vulkan:run"
  "stew675-rocm:latest-stew675-rocm:run"
)

# --- check which arms are already done ---
arm_done() {  # label
  [ -f "$ROOT_OUT/$1/llama-bench.json" ] &&
    python3 -c "import json; rows=json.load(open('$ROOT_OUT/$1/llama-bench.json')); assert len(rows) >= 7" 2>/dev/null
}

declare -a TODO_ARMS=()
declare -a DONE_ARMS=()

for def in "${ARMS_DEF[@]}"; do
  IFS=: read -r label symlink action <<<"$def"

  # Baseline arms: copy from existing baseline
  if [ "$action" = "baseline" ]; then
    if arm_done "$label"; then
      echo "DONE [$label]: existing results valid"
      DONE_ARMS+=("$label")
    elif [ -f "$EXISTING_BASELINE/llama-bench.json" ]; then
      mkdir -p "$ROOT_OUT/$label"
      cp "$EXISTING_BASELINE/llama-bench.json" "$ROOT_OUT/$label/llama-bench.json"
      echo "BASELINE [$label]: copied from $EXISTING_BASELINE"
      DONE_ARMS+=("$label")
    else
      echo "WARN: baseline missing for $label" >&2
    fi
    continue
  fi

  # Run arms: check if build exists and if results already valid
  if arm_done "$label"; then
    echo "DONE [$label]: existing results valid (use --force to re-run)"
    DONE_ARMS+=("$label")
    continue
  fi

  link="$BUILD/$symlink"
  if [ ! -L "$link" ]; then
    echo "SKIP [$label]: $symlink symlink missing"
    continue
  fi

  dir="$(readlink -f "$link")"
  if [ ! -x "$dir/bin/llama-bench" ]; then
    echo "SKIP [$label]: llama-bench not found in $dir/bin/ (build incomplete?)"
    continue
  fi

  TODO_ARMS+=("$label")
done

arr_or_none() { [ $# -gt 0 ] && echo "$*" || echo "none"; }

echo ""
echo "To run: $(arr_or_none "${TODO_ARMS[@]}")"
echo "Done: $(arr_or_none "${DONE_ARMS[@]}")"
echo ""

# --- write/update meta ---
{
  echo "date=$(date -Iseconds)"
  echo "model=$MODEL"
  echo "knobs: UB=$UB BATCH=$BATCH CTK=$CTK CTV=$CTV FA=$FA NGL=$NGL REPS=$REPS"
  echo "run_arms: $(arr_or_none "${TODO_ARMS[@]}")"
  echo "done_arms: $(arr_or_none "${DONE_ARMS[@]}")"
} > "$ROOT_OUT/meta.txt"

# --- run pending arms ---
if [ ${#TODO_ARMS[@]} -gt 0 ]; then
for label in "${TODO_ARMS[@]}"; do
  # Resolve symlink
  for def in "${ARMS_DEF[@]}"; do
    IFS=: read -r lbl sym act <<<"$def"
    [ "$lbl" = "$label" ] && { dir="$(readlink -f "$BUILD/$sym")"; break; }
  done

  LLAMA_BENCH="$dir/bin/llama-bench"
  VER_LINE="$("$dir/bin/llama-server" --version 2>&1 | grep -m1 '^version:' || echo 'version: unknown')"
  echo "=== $label: $VER_LINE ==="

  # Build pg string
  PG_STR=""
  for shape in "${SHAPES[@]}"; do
    PG_STR+=" ${shape}"
  done
  PG_STR="${PG_STR# }"

  ARM_DIR="$ROOT_OUT/${label}"
  mkdir -p "$ARM_DIR"

  # Run model-bench/run.sh (same invocation pattern as compare_builds.py)
  LLAMA_BENCH="$LLAMA_BENCH" \
  MODEL="$MODEL" \
  SLUG="buildcmp-${label}" \
  PP="1000,128,512,2048,8192,32768" \
  TG=0 \
  UB="$UB" BATCH="$BATCH" CTK="$CTK" CTV="$CTV" \
  FA="$FA" NGL="$NGL" REPS="$REPS" \
  WARMUP=0 PG="$PG_STR" VRAM_SAMPLE=0 \
  bash "$HERE/run.sh" 2>"$ARM_DIR/run.err" | tee "$ARM_DIR/run.log" || {
    echo "WARN: run.sh failed for $label" >&2
  }

  # Copy results from model-bench output dir back to our arm dir
  LATEST_RUN=$(ls -1dt "$REPO/bench/runs/"*-model-buildcmp-${label}* 2>/dev/null | head -1)
  if [ -n "$LATEST_RUN" ]; then
    cp "$LATEST_RUN/llama-bench.json" "$ARM_DIR/llama-bench.json"
    cp "$LATEST_RUN/llama-bench.err" "$ARM_DIR/llama-bench.err"
    echo "  → saved to $ARM_DIR/llama-bench.json"
  else
    echo "WARN: could not find run output for $label" >&2
  fi
done
fi

# --- derive decode speeds and print summary ---
echo ""
echo "=== Results (decode tok/s, derived as G / (t_pg − t_pp)) ==="
echo ""

python3 - "$ROOT_OUT" <<'PY'
import json, sys, os

root = sys.argv[1]
labels = ["stock-vulkan", "stock-rocm", "stew675-vulkan", "stew675-rocm"]
shapes = [(128,64), (512,256), (2048,512), (8192,1024), (32768,2048)]

def derive_speeds(jf):
    """Parse llama-bench.json → decode speeds derived from pp-only + pg tests."""
    rows = json.load(open(jf))
    pp_time = {}
    for r in rows:
        if r.get("n_gen") == 0 and r.get("n_prompt"):
            pp_time[r["n_prompt"]] = r["avg_ns"] / 1e9

    results = {}
    for r in rows:
        pp = r.get("n_prompt", 0)
        tg = r.get("n_gen", 0)
        if tg == 0:
            continue
        total_s = r["avg_ns"] / 1e9
        pp_t = pp_time.get(pp, 0)
        dec_s = total_s - pp_t
        if dec_s <= 0:
            continue
        results[(pp, tg)] = {
            "pp_speed": pp / pp_t if pp_t > 0 else 0,
            "dec_speed": tg / dec_s,
            "pp_time": pp_t,
            "pg_time": total_s
        }
    return results

all_results = {}
for label in labels:
    jf = f"{root}/{label}/llama-bench.json"
    if os.path.exists(jf):
        all_results[label] = derive_speeds(jf)

if not all_results:
    print("No results found.")
    sys.exit(0)

# Decode table
print(f"{'Shape':>12} {'Label':<20} {'Decode t/s':>12} {'Prefill t/s':>12}")
print("-" * 60)
for pp, tg in shapes:
    for label in labels:
        r = all_results.get(label, {}).get((pp, tg))
        if r:
            print(f"  ({pp:>5},{tg:>4}) {label:<20} {r['dec_speed']:>12.1f} {r['pp_speed']:>12.1f}")
        else:
            print(f"  ({pp:>5},{tg:>4}) {label:<20} {'N/A':>12} {'':>12}")

# Delta vs stock-vulkan
if "stock-vulkan" in all_results:
    base = all_results["stock-vulkan"]
    print(f"\n{'Shape':>12} {'Label':<20} {'Decode Δ%':>10}")
    print("-" * 45)
    for pp, tg in shapes:
        bp = base.get((pp, tg))
        if not bp:
            continue
        for label in ["stock-rocm", "stew675-vulkan", "stew675-rocm"]:
            r = all_results.get(label, {}).get((pp, tg))
            if r:
                delta = ((r["dec_speed"] - bp["dec_speed"]) / bp["dec_speed"]) * 100
                sign = "+" if delta > 0 else ""
                print(f"  ({pp:>5},{tg:>4}) {label:<20} {sign}{delta:>9.1f}%")

# Write summary.jsonl
with open(f"{root}/summary.jsonl", "w") as f:
    for label in labels:
        for (pp, tg), v in all_results.get(label, {}).items():
            f.write(json.dumps({
                "label": label, "pp": pp, "tg": tg,
                "decode_tok_s": round(v["dec_speed"], 2),
                "prefill_tok_s": round(v["pp_speed"], 2),
                "pg_time_s": round(v["pg_time"], 3)
            }) + "\n")
print("\n→ summary.jsonl written")
PY

echo ""
echo "→ results: $ROOT_OUT"
