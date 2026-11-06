#!/bin/bash
# claudetest.sh LABEL PROFILE [ENV=VAL ...]
#   Same boot as vllmtest.sh (serve_vllm.sh profile on :8000, ctx = CLAUDE_CODE_MAX_CONTEXT_TOKENS of $CFG unless MAXLEN=, 1 seq, KV fp8, temp profile with
#   VLLM_DISABLE_COMPILE_CACHE=1 + the ENV=VAL pairs), but the load is a REAL Claude Code session, not fixtures:
#   `claude -p` with ~/.config/claude/local_vllm_direct/settings.json (= local_muxik with ANTHROPIC_BASE_URL
#   -> :8000, no llama-swap), TURNS (default 4) read-heavy turns chained with --continue so the context grows.
#   Why: 2026-10-22 the unchanged baseline PASSed vllmtest.sh once but faulted on the FIRST real Claude
#   request (~5 s, radiance_mxfp4_fp8_gemm_folded) -- Claude's request shapes hit the fault far more reliably.
#   Polls the server log for MEMORY_FAULT every 5 s and aborts the turn on sight.
#   Prints one line:  [LABEL] RESULT PASS|FAULT@tN|CLAUDE_FAIL@tN|BOOT_FAILED  boot=… tN=…s <kernel>
#   PASS = every turn exits 0 with is_error=false and no fault. Knobs: IMAGE KV_DTYPE MAXLEN MAXSEQS GPU_UTIL
#   WARM=1 (boot via warm_start.sh: replay a real Claude first request, reboot on fault), EXTRA_ARGS (to serve_vllm.sh), TURNS (1..4), TURN_TIMEOUT (s, default 1500), AUTOCOMPACT_PCT (default
#   min(75, floor((MAXLEN - max output)/MAXLEN*100) - 3): compaction must fire before prompt + output > MAXLEN,
#   or vLLM answers HTTP 400 = CLAUDE_FAIL, not a fault; the -3 covers Claude's token estimate vs vLLM's count).
#   Results append to results.tsv; logs to logs/<label>.{boot,server,settings.json,tN.json,tN.err}.
#   Kills only its own container (vllm-8000).
set -u
H=$(cd "$(dirname "$0")" && pwd)
VD=/home/dev/work/dp-craft/amd/bench/engine-bench/vllm
CFG=/home/dev/.config/claude/local_vllm_direct/settings.json
REPO=/home/dev/work/dp-craft/amd
label=$1; prof=$2; shift 2
eng=${prof%%/*}; P=$VD/profiles/$eng
[ -f "$VD/profiles/$prof.env" ] || { echo "profile not found: $prof" >&2; exit 2; }
[ -f "$CFG" ] || { echo "Claude config not found: $CFG" >&2; exit 2; }
tmp=_ct_$label
# default ctx = the real config's window, so the gate tests what Claude Code will actually send
: "${MAXLEN:=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["env"]["CLAUDE_CODE_MAX_CONTEXT_TOKENS"])' "$CFG")}"
{ echo "source \"\$(dirname \"\${BASH_SOURCE[0]}\")/${prof#*/}.env\""
  echo 'MODEL_ENV+=("VLLM_DISABLE_COMPILE_CACHE=1")'
  for e in "$@"; do echo "MODEL_ENV+=(\"$e\")"; done; } > "$P/$tmp.env"
LOG=$H/logs/$label; mkdir -p "$H/logs"
cp=""
cleanup() { [ -n "$cp" ] && kill "$cp" 2>/dev/null; PORT=8000 "$VD/serve_vllm.sh" stop >/dev/null 2>&1; rm -f "$P/$tmp.env"; }
trap cleanup EXIT
curl -s http://127.0.0.1:9292/unload >/dev/null; sleep 3          # llama-swap: GET, not POST
t0=$(date +%s)
PROFILE=$eng/$tmp PORT=8000 MAXLEN=$MAXLEN MAXSEQS=${MAXSEQS:-1} KV_DTYPE=${KV_DTYPE:-fp8} \
  "$VD/$([ "${WARM:-0}" = 1 ] && echo warm_start.sh || echo serve_vllm.sh)" start > "$LOG.boot" 2>&1
if [ $? -ne 0 ]; then
  docker logs vllm-8000 > "$LOG.server" 2>&1
  res=BOOT_FAILED; why=$(grep -E "Error|error:" "$LOG.boot" "$LOG.server" 2>/dev/null | grep -v '  File' | tail -1 | cut -c1-160)
  echo "[$label] RESULT $res  ($why)"; printf "%s\t%s\t%s\t%s\t%s\n" "$(date +%F_%T)" "$label" "claude: $prof $*" "$res" "$why" >> "$H/results.tsv"; exit 1
fi
boot=$(( $(date +%s) - t0 ))
served=$(curl -s http://127.0.0.1:8000/v1/models | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
echo "[$label] up after ${boot}s, served=$served, env: $*"
# per-run settings: the profile decides the served name (dflash / plain / upstream radiance differ)
pct=$(python3 - "$CFG" "$LOG.settings.json" "$served" "$MAXLEN" "${AUTOCOMPACT_PCT:-}" <<'EOF'
import json,sys
d=json.load(open(sys.argv[1])); e=d['env']
e['ANTHROPIC_BASE_URL']='http://127.0.0.1:8000'
for k in ('ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL'):
    e[k]=sys.argv[3]
# output budget comes from $CFG unchanged; the window follows the booted MAXLEN and compaction is kept below it
m=int(sys.argv[4]); out=int(e['CLAUDE_CODE_MAX_OUTPUT_TOKENS'])
pct=sys.argv[5] or str(min(75, (m-out)*100//m - 3))
e['CLAUDE_CODE_MAX_CONTEXT_TOKENS']=str(m); e['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']=pct
json.dump(d,open(sys.argv[2],'w'),indent=2)
print(pct)
EOF
)
echo "[$label] compaction ${pct}% of $MAXLEN"

TURN=(
 "Read CLAUDE.md, docs/GUIDE.md, bench/engine-bench/vllm/serve_vllm.sh and bench/lib/capture_engine.py in full. Then explain end to end how a vLLM benchmark run flows through these files."
 "Now read bench/gen_campaign.py and bench/lib/report.py in full and explain how they connect to the flow you described. Quote 3 concrete function names."
 "Read docs/plans/2026-10-22-mxfp4-qwen38-options/PLAN.md and docs/plans/2026-10-22-mxfp4-qwen38-options/ISSUE-SUMMARY.md in full and list every open hypothesis about the memory fault."
 "Read bench/model-bench/sweep.py and bench/model-bench/compare_builds.py in full and list 5 concrete risks in them, with line references."
)
res=PASS; times=""; [ "${WARM:-0}" = 1 ] && times=" $(grep -oE 'OK after [0-9]+' "$LOG.boot" | sed 's/OK after /warmboots=/')"
cd "$REPO"
for i in $(seq 0 $(( ${TURNS:-4} - 1 ))); do
  c=(); [ "$i" -gt 0 ] && c=(--continue)
  ts=$(date +%s)
  timeout "${TURN_TIMEOUT:-1500}" claude --settings "$LOG.settings.json" -p ${c[@]+"${c[@]}"} \
    --allowedTools "Read Glob Grep" --max-turns 40 --output-format json "${TURN[$i]}" > "$LOG.t$i.json" 2> "$LOG.t$i.err" & cp=$!
  while kill -0 $cp 2>/dev/null; do
    docker logs vllm-8000 2>&1 | grep -q MEMORY_FAULT && { kill $cp 2>/dev/null; res="FAULT@t$i"; break; }
    sleep 5
  done
  wait $cp; rc=$?; cp=""
  times="$times t$i=$(( $(date +%s) - ts ))s"
  [ "$res" = PASS ] || break
  err=$(python3 -c "import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print('nojson'); sys.exit()
u=d.get('usage',{}); print('err' if d.get('is_error') else 'ok', 'turns=%s in=%s cache_read=%s out=%s' % (d.get('num_turns'),u.get('input_tokens'),u.get('cache_read_input_tokens'),u.get('output_tokens')))" "$LOG.t$i.json")
  echo "  t$i: rc=$rc $err"
  [ "$rc" = 0 ] && [ "${err%% *}" = ok ] || { res="CLAUDE_FAIL@t$i(rc=$rc,${err%% *})"; break; }
done
docker logs vllm-8000 > "$LOG.server" 2>&1
kern=""; [ "$res" = PASS ] || kern=$(grep -oE 'kernel: void [a-z0-9_]+' "$LOG.server" | head -1)
echo "[$label] RESULT $res  boot=${boot}s$times $kern"
printf "%s\t%s\t%s\t%s\t%s\n" "$(date +%F_%T)" "$label" "claude: $prof $* MAXLEN=$MAXLEN COMPACT=${pct}% GPU_UTIL=${GPU_UTIL:-0.90} EXTRA_ARGS=${EXTRA_ARGS:-} IMAGE=${IMAGE:-default} TURNS=${TURNS:-4}" "$res" "boot=${boot}s$times $kern" >> "$H/results.tsv"
