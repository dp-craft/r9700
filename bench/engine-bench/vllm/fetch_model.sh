#!/usr/bin/env bash
# Fetch a PINNED Hugging Face snapshot for the vLLM docker track.
#   fetch_model.sh <org/repo> <revision-sha> [<org/repo> <revision-sha> ...]
# Lands in $VLLM_ROOT/models/<org>__<repo>@<rev8>/ (bind-mounted read-only at /model) and writes
# SOURCE.txt (repo, full revision, UTC date, size) next to the weights -- iron rule 2: an unpinned
# checkpoint is an unreproducible number. Resumable: re-running skips files already complete.
# CPU at nice 19 / idle IO class so a running GPU job is not starved; network is not capped.
set -euo pipefail

VLLM_ROOT=${VLLM_ROOT:-/mnt/Lin1/work/vllm/sly-radiance}
HF=${HF:-$VLLM_ROOT/tools/hf-venv/bin/hf}
WORKERS=${WORKERS:-8}
export HF_HOME=${HF_HOME:-/mnt/Lin1/work/hf}   # shared Lin1 HF cache (same one the containers mount), not ~

[ $# -ge 2 ] && [ $(( $# % 2 )) -eq 0 ] || { echo "usage: $0 <org/repo> <rev> [...]" >&2; exit 2; }
[ -x "$HF" ] || { echo "hf CLI not found at $HF (python3 -m venv $VLLM_ROOT/tools/hf-venv && .../pip install 'huggingface_hub[hf_xet]')" >&2; exit 2; }

while [ $# -gt 0 ]; do
  repo=$1 rev=$2; shift 2
  [[ $rev =~ ^[0-9a-f]{40}$ ]] || { echo "revision must be a full 40-hex sha, got '$rev'" >&2; exit 2; }
  dest=$VLLM_ROOT/models/${repo/\//__}@${rev:0:8}
  echo "== $repo @ $rev -> $dest"
  nice -n 19 ionice -c3 "$HF" download "$repo" --revision "$rev" --local-dir "$dest" --max-workers "$WORKERS"
  cat > "$dest/SOURCE.txt" <<EOF
repo=$repo
revision=$rev
url=https://huggingface.co/$repo/tree/$rev
fetched_utc=$(date -u +%FT%TZ)
size=$(du -sh --exclude=.cache "$dest" | cut -f1)
EOF
  echo "== done $repo ($(sed -n 's/^size=//p' "$dest/SOURCE.txt"))"
done
