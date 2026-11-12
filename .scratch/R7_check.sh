#!/usr/bin/env bash
# R7 — Recipe fidelity across all OLD campaign dirs -> new campaigns/<type>/.
# Method: scripted sha256 comparison of OLD (mirror @ fb9276c) vs NEW (restructure tree),
# classified per file type. Same approach as the R1 bulk audit.  Requires read access to the
# bare mirror AND the restructure working tree from a shell (NOT available in this sandbox).
set -euo pipefail

MIRROR=/home/dev/work/dp-craft/amd-private/archive/amd-pre-restructure-2026-11-06.git
OLD_COMMIT=fb9276c            # = refs/heads/main in the mirror (packed-refs confirms)
NEW_ROOT=/home/dev/work/dp-craft/amd          # branch 'restructure'
MOVES=/home/dev/work/dp-craft/amd-private/notes/restructure/moves.tsv

OUT=/tmp/R7
mkdir -p "$OUT/old" "$OUT/new"
total=0; identical=0; whitelisted=0; changed=0; missing=0

# 1) The 30 dated old campaign dirs under campaigns/ at base commit.
mapfile -t CAMPS < <(git -C "$MIRROR" ls-tree --name-only "$OLD_COMMIT" campaigns/ \
                       | sed -n 's#.*/##p' | grep -E '^2026-')

# 2) moves.tsv: src\tdst\tclass\tnote  -> build old_src -> new_rel map.
declare -A DST=()
while IFS=$'\t' read -r src dst cls note; do DST["$src"]="$dst"; done < "$MOVES"

for camp in "${CAMPS[@]}"; do
  # every recipe input file currently under that old dir (spec/configs/calibration/tasks/run.sh/README).
  mapfile -t files < <(git -C "$MIRROR" ls-tree -r --name-only "$OLD_COMMIT" "campaigns/$camp")
  for rel in "${files[@]}"; do
    src="campaigns/$camp/$rel"; dst="${DST[$src]:-}"
    [ -z "$dst" ] && { echo "UNMAPPED   $src"; continue; }
    ((total++))

    # --- materialize OLD bytes via git show (reliable where archive|tar pipe is not) ---
    git -C "$MIRROR" show "$OLD_COMMIT:$src" > "$OUT/old/$rel" || { echo "GITSHOW_FAIL $src"; continue; }
    old_h=$(sha256sum "$OUT/old/$rel" | awk '{print $1}')

    # --- resolve NEW bytes under the restructure working tree ---
    np="$NEW_ROOT/$dst"
    if [ ! -f "$np" ]; then echo "MISSING    $src -> $np"; ((missing++)); continue; fi
    new_h=$(sha256sum "$np" | awk '{print $1}')

    # --- classify by file type ---
    base=${rel##*/}
    verdict=CHANGED
    if [ "$base" = "spec.json" ]; then
      # whitelisted: an added/changed "date" field, nothing else substantive.
      if jq -S --argignore date . <(jq 'del(.date)' "$OUT/old/$rel") \
            == jq -S --argignore date . <(jq 'del(.date)' "$np"); then
        verdict=whitelisted(date)
      fi
    elif [[ $base =~ \.jsonl$ ]] || [ "$base" = "tasks.jsonl" ]; then
      # content must match byte-for-byte (paths may relocate to inputs/, that is a finding)
      [ "$old_h" = "$new_h" ] && verdict=identical
    elif [ "$base" = "run.sh" ]; then
      # only structural two-root re-emit allowed (RAW=tmp/ RES=results/ CAMPAIGN_DIR default);
      # label+param matrix must be identical -> compare normalized command matrix.
      if diff <(sed -E 's#(?:tmp|results)/[^[:space:]]+#<ROOT>#g' "$OUT/old/$rel") \
              <(sed -E 's#(?:tmp|results)/[^[:space:]]+#<ROOT>#g' "$np") >/dev/null; then
        verdict=whitelisted(structural-two-root)
      fi
    elif [[ $base =~ ^README ]] || [ "$base" != "spec.json" ]; then
      # README/docs: path strings + added <!-- meta --> only.
      if diff <(grep -v '<!-- meta -->|campaigns/' "$OUT/old/$rel") \
              <(grep -v '<!-- meta -->|campaigns/' "$np") >/dev/null; then
        verdict=whitelisted(path+meta)
      fi
    fi

    case $verdict in
      identical)   ((identical++)) ;;
      whitelisted) ((whitelisted++)) ;;
      *)           ((changed++)); echo "CHANGED    $src ($base): old=$old_h new=$new_h" ;;
    esac
  done
done

echo "TOTAL=$total IDENTICAL=$identical WHITELISTED=$whitelisted CHANGED=$changed MISSING=$missing"
