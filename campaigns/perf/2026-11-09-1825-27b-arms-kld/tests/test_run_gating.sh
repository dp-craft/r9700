#!/usr/bin/env bash
# No-GPU gating tests for run.sh — resume / subset / reuse / boot-failure behavior.
#
# The 2026-11-10 short run exposed four pipeline bugs in this script (P1, P3, P4, P6); the 2026-11-11
# review added P9-P12 (T10-T16c, see the bottom of this header):
#   P1 resume with a subset (ONLY=...) re-boots: ws7_prologue / arm_d / arm_rad gate on
#      the FULL round-1 slug set, so "all done" is never true for a subset -> every
#      resume re-boots (3.5 min) and re-labels the WS7 "cold" boot (3 invocations saw
#      this).
#   P3 a failed prologue boot leaves no trace in failures.txt (the WS7 gap is silent).
#   P4 arm_d's reuse check (served name + image only) accepts a FOREIGN server (the
#      user-session 1.11.0 dflash server) -> arm D rows' provenance is tainted.
#   P6 a failed boot discards the container log -> undiagnosable (kld-ref-fp8 x2,
#      d prologue x1 in the short run).
#   P9  arm D fetched its KLD set after a FAILED sly selftest (arm_rad was gated, arm_d was not) -> T13.
#   P10 a cached KLD fetch / reference with errored rows was kept as complete (rule 18), and partial
#      arms or a partial reference were scored -> T10/T11 (cache), T14/T14c (score). T15 = end-to-end
#      with the real kld_probe.py fetch against a canned loopback server (written after the fix:
#      a stress test, not a red-first test).
#   P12 a re-run whose cells were all done returned at "skip (done)" before the KLD pass, so a
#      failed KLD fetch was never retried (the "re-run to re-fetch" message was a no-op) -> T16, T16c.
#      T2 and T9 (the P1 guards) now set up a complete KLD pass: a finished arm includes its KLD fetch.
#
# Method: source run.sh with WS_NO_MAIN=1 in a subshell, in a SCRATCH CAMPAIGN_DIR
# (real inputs/ copied so preflight runs for real), PATH-stubbed docker+curl so nothing
# touches the machine, serve-script paths (SERVE_VLLM/SERVE_RAD) and the state dir
# (SERVER_STATE_DIR) pointed at the scratch, every GPU-touching leaf stubbed
# (start/stop server, engine-bench run, KLD). No GPU, no containers, port 8000 never
# touched — safe to run while the user's own server is up.
#
# Preflight needs the real pins present (2 .rad, 4 model dirs, 4 images, calibration
# sha256) — that is the point: the tested script is the production script.
#
# Run: bash campaigns/perf/2026-11-09-1825-27b-arms-kld/tests/test_run_gating.sh
set -uo pipefail

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
CAMPAIGN="$(cd "$HERE/.." && pwd)"
RUN_SH="$CAMPAIGN/run.sh"
TMP_BASE="$CAMPAIGN/tmp/gating-tests"
mkdir -p "$TMP_BASE"
PASS=0; FAIL=0
SCRATCHES=()

cleanup () { local s; for s in "${SCRATCHES[@]:-}"; do [ -n "$s" ] && rm -rf "$s"; done; }
trap cleanup EXIT

# --- assertion helpers (run inside the scenario subshell; $scratch is dynamic) -------
aok ()  { echo "ok $1" >> "$scratch/assert.log"; }
abad () { echo "FAIL $1 :: $2" >> "$scratch/assert.log"; }
assert_count () {   # label calls_file regex expected
  local n; n=$(grep -c "$2" "$1" 2>/dev/null || true)
  if [ "$n" -eq "$3" ]; then aok "$4"; else abad "$4" "count=$n want=$3 (regex '$2' in $1)"; fi
}
mk_kld_ok () {   # file served image -> a COMPLETE cached KLD fetch for KLD_N=1 (one clean row, cal-001)
  # + its cache key (item C: a cache without a matching <file>.key.json is never reused)
  KLD_N=1
  printf '%s\n' '{"id": "cal-001", "toks": ["x"], "pos": [], "error": null}' > "$1"
  python3 "$ROOT/bench/perf/kld_probe.py" cache-key --calibration "$KLD_CAL" --limit 1 \
    --model "$2" --image "$3" > "$1.key.json"
}
assert_contains () {   # label file needle
  if [ -f "$2" ] && grep -qF "$3" "$2"; then aok "$1"; else abad "$1" "missing '$3' in $2"; fi
}

# --- gate-port helper (2026-11-11, t29/t34/t35) ---------------------------------------------
# An ephemeral 127.0.0.1 listener so the gate sees a HELD port without ever touching port 8000.
# Call it WITHOUT $(...): it sets HOLDER_PORT (the port) and HOLDER_PID (the listener; its stdio is
# detached, so nothing blocks). The scenario body MUST kill "$HOLDER_PID" when done, on every path.
HOLDER_PORT=""; HOLDER_PID=""
hold_port () {
  local _i
  HOLDER_PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  python3 -c 'import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", int(sys.argv[1])))
s.listen(1)
time.sleep(120)' "$HOLDER_PORT" </dev/null >/dev/null 2>&1 &
  HOLDER_PID=$!
  for _i in $(seq 100); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$HOLDER_PORT") 2>/dev/null; then return 0; fi
    sleep 0.1
  done
  echo "hold_port: listener on $HOLDER_PORT never came up" >&2
  return 1
}

# --- scenario body: fresh scratch env, run.sh sourced, leaves stubbed -----------------
scenario () {   # name   (GATING_ONLY='t17 t18' runs a subset — red/green loops)
  local name=$1 scratch
  if [ -n "${GATING_ONLY:-}" ] && ! [[ " $GATING_ONLY " == *" $name "* ]]; then return 0; fi
  scratch=$(mktemp -d "$TMP_BASE/$name.XXXXXX")
  SCRATCHES+=("$scratch")
  (
    set -uo pipefail
    export CAMPAIGN_DIR="$scratch"
    export CALLS="$scratch/calls.log"
    export CURL_MODELS="${CURL_MODELS:-}"
    export FAKE_SERVE_RC=1
    : > "$CALLS"; : > "$scratch/assert.log"
    mkdir -p "$scratch/inputs" "$scratch/stubbin" "$scratch/fake-eb" "$scratch/state"
    cp -r "$CAMPAIGN/inputs/." "$scratch/inputs/"

    cat > "$scratch/stubbin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "${1:-}" in
  images) printf '%s\n' \
    stilldeadcode/radiance:1.11.0 stilldeadcode/radiance:1.17.0 \
    ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 \
    ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 ;;
  logs) [ -n "${MOCK_LOG_FILE:-}" ] && cat "$MOCK_LOG_FILE" 2>/dev/null; exit 0 ;;
  inspect) [ -n "${MOCK_DOCKER_ENV:-}" ] && printf '%b\n' "$MOCK_DOCKER_ENV"; exit "${MOCK_INSPECT_RC:-0}" ;;
  image) [ "${2:-}" = inspect ] && echo "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; exit 0 ;;
  *) exit 0 ;;
esac
EOF
    cat > "$scratch/stubbin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
[ -n "${CURL_MODELS:-}" ] && printf '%s\n' "$CURL_MODELS"
exit 0
EOF
    printf '%s\n' '#!/usr/bin/env bash' 'echo "eb-run $SLUG" >> "$CALLS"' 'exit 0' > "$scratch/fake-eb/run.sh"
    chmod +x "$scratch/stubbin/"* "$scratch/fake-eb/run.sh"
    export PATH="$scratch/stubbin:$PATH"
    export WS_NO_MAIN=1
    export RUN_TAG="gate-$name"
    source "$RUN_SH"

    # ---- after-source overrides (run.sh sets these at source time) ----
    EB="$scratch/fake-eb"
    SERVER_STATE_DIR="$scratch/state"
    SERVE_VLLM="$scratch/fake-eb/serve-vllm.sh"
    SERVE_RAD="$scratch/fake-eb/serve-rad.sh"
    SERVE_LLAMA="$scratch/fake-eb/serve-llama.sh"
    printf '%s\n' '#!/usr/bin/env bash' 'echo fake-llama-server' > "$scratch/fake-eb/llama-server"
    chmod +x "$scratch/fake-eb/llama-server"
    LLAMA_BIN="$scratch/fake-eb/llama-server"
    echo gguf > "$scratch/fake.gguf"; GGUF_Q4KXL="$scratch/fake.gguf"
    # item B (2026-11-11): on `start` the fakes can print a canned stderr (FAKE_SERVE_STDERR), write a
    # state-dir engine log the way serve_vllm.sh's stop/died paths do (FAKE_STATE_LOG -> FAKE_STATE_DST),
    # and take FAKE_SERVE_SLEEP seconds; the vllm fake logs the IMAGE it was handed
    for _f in "$SERVE_VLLM:serve-vllm \$* IMAGE=\${IMAGE:-}" "$SERVE_RAD:serve-rad \$* EXTRA_ARGS=\${EXTRA_ARGS:-}" \
              "$SERVE_LLAMA:serve-llama \$* MODEL=\${MODEL:-} LLAMA_SERVER=\${LLAMA_SERVER:-} BACKEND=\${BACKEND:-} CTX=\${CTX:-} NP=\${NP:-} KV=\${KV:-} MTP=\${MTP:-} EXTRA_ARGS=\${EXTRA_ARGS:-}"; do
      printf '%s\n' '#!/usr/bin/env bash' "echo \"${_f#*:}\" >> \"\$CALLS\"" \
        'if [ "${1:-}" = start ]; then' \
        '  [ -n "${FAKE_SERVE_SLEEP:-}" ] && sleep "$FAKE_SERVE_SLEEP"' \
        '  [ -n "${FAKE_STATE_LOG:-}" ] && cp "$FAKE_STATE_LOG" "$FAKE_STATE_DST"' \
        '  [ -n "${FAKE_SERVE_STDERR:-}" ] && cat "$FAKE_SERVE_STDERR" >&2' \
        'fi' 'exit "${FAKE_SERVE_RC:-1}"' > "${_f%%:*}"
    done
    chmod +x "$SERVE_VLLM" "$SERVE_RAD" "$SERVE_LLAMA"
    # item B/G/H: boot diagnostics leaves pointed at the scratch (no rocm-smi, no real sysfs, no real cache)
    printf '%s\n' '#!/usr/bin/env bash' 'echo "sampler $*" >> "$CALLS"' \
      'echo "unix_ts,vram_used_mib,vram_total_mib,gtt_used_mib" > "$2"' \
      'while :; do echo "$(date +%s.%N),2048,32624,64" >> "$2"; sleep 0.1; done' > "$scratch/fake-eb/sampler.sh"
    chmod +x "$scratch/fake-eb/sampler.sh"
    BOOT_VRAM_SAMPLER="$scratch/fake-eb/sampler.sh"
    mkdir -p "$scratch/drm/card0/device" "$scratch/vllm-cache"
    echo 1073741824 > "$scratch/drm/card0/device/mem_info_vram_used"
    # boot gate (2026-11-11, t26-t37): the gate must never see the real card or real port 8000 (the
    # user's 27B server is up). total 32768 MiB - used 1024 MiB = free 31744 MiB >= floor 30000, so
    # every existing scenario that reaches the real start_server/start_rad passes the gate; the gate
    # port is a free ephemeral port (the refusal tests re-set GATE_PORT to a held port via hold_port).
    echo 34359738368 > "$scratch/drm/card0/device/mem_info_vram_total"
    GATE_PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
    DRM_ROOT="$scratch/drm"
    VLLM_CACHE_ROOT="$scratch/vllm-cache"
    export FAKE_STATE_DST="$scratch/state/8000.log"
    # fake KLD tool: logs the call and writes one clean row to --out (no GPU, no server)
    cat > "$scratch/fake-eb/kld.py" <<'PY'
import os, sys
a = sys.argv[1:]
with open(os.environ["CALLS"], "a") as f:
    f.write("kld-" + a[0] + " " + " ".join(a[1:]) + "\n")
with open(a[a.index("--out") + 1], "w") as f:
    f.write('{"id": "cal-001", "toks": ["x"], "pos": [], "error": null}\n')
PY
    KLD="$scratch/fake-eb/kld.py"
    # keep the REAL start_server/start_rad (T7/T8 exercise them with the fake SERVE_VLLM/
    # SERVE_RAD scripts) before the stubs below shadow them
    eval "$(declare -f start_server | sed '1s/^start_server/real_start_server/')"
    eval "$(declare -f start_rad | sed '1s/^start_rad/real_start_rad/')"
    # T10/T11 exercise the REAL KLD cache logic (kld_fetch / kld_ref_ensure) against a fake KLD tool
    eval "$(declare -f kld_fetch | sed '1s/^kld_fetch/real_kld_fetch/')"
    eval "$(declare -f kld_ref_ensure | sed '1s/^kld_ref_ensure/real_kld_ref_ensure/')"
    eval "$(declare -f kld_score_all | sed '1s/^kld_score_all/real_kld_score_all/')"
    eval "$(declare -f kld_selftest | sed '1s/^kld_selftest/real_kld_selftest/')"
    eval "$(declare -f start_llama | sed '1s/^start_llama/real_start_llama/')"
    eval "$(declare -f stop_llama | sed '1s/^stop_llama/real_stop_llama/')"
    eval "$(declare -f stop_current | sed '1s/^stop_current/real_stop_current/')"
    eval "$(declare -f kld_score_pairs | sed '1s/^kld_score_pairs/real_kld_score_pairs/')"
    start_server () { echo "start_server $*" >> "$CALLS"; CURRENT=""; CURRENT_CONTAINER=""; return "${STUB_START_RC:-0}"; }
    start_rad ()    { echo "start_rad $*" >> "$CALLS"; CURRENT=radiance; CURRENT_CONTAINER=""; return "${STUB_START_RC:-0}"; }
    stop_server ()  { echo "stop_server" >> "$CALLS"; CURRENT=""; CURRENT_CONTAINER=""; }
    stop_rad ()     { echo "stop_rad" >> "$CALLS"; CURRENT=""; CURRENT_CONTAINER=""; }
    start_llama ()  { echo "start_llama $*" >> "$CALLS"; CURRENT=llamacpp; CURRENT_CONTAINER=""; return "${STUB_START_RC:-0}"; }
    stop_llama ()   { echo "stop_llama" >> "$CALLS"; CURRENT=""; CURRENT_CONTAINER=""; }
    kld_selftest ()    { echo "kld_selftest $*" >> "$CALLS"; }
    kld_fetch ()       { echo "kld_fetch $*" >> "$CALLS"; }
    kld_ref_ensure ()  { echo "kld_ref_ensure" >> "$CALLS"; }
    kld_score_all ()   { echo "kld_score_all $*" >> "$CALLS"; }
    residency_check () { echo "residency_check $*" >> "$CALLS"; }

    "body_$name"
  ) > "$scratch/out.log" 2>&1

  [ -f "$scratch/assert.log" ] || { echo "FAIL $name :: no assert.log (scenario crashed — see $scratch/out.log)"; FAIL=$((FAIL+1)); return 1; }
  local line had_fail=0
  while IFS= read -r line; do
    case "$line" in
      FAIL*) echo "$line"; had_fail=1; FAIL=$((FAIL+1)) ;;
      *) echo "ok ${line#ok }"; PASS=$((PASS+1)) ;;
    esac
  done < "$scratch/assert.log"
  if [ "$had_fail" -eq 1 ]; then
    echo "  --- out.log tail ($scratch/out.log) ---"
    tail -6 "$scratch/out.log" | sed 's/^/  /'
  fi
  return 0
}

# --- scenarios ------------------------------------------------------------------------
# T1 (guard) fresh subset: exactly TWO boots for the whole arm D pass — the cold
# prologue boot + the one-time ws7 warm reboot (both by design); arm_d reuses the
# prologue boot (name+image+ctx match), so no third boot.
body_t1 () {
  export ONLY='d-10k-tg512-n1,d-100k-tg512-n1'
  export CURL_MODELS='qwen38-27b-redhat-mxfp4-dflash'
  printf '%s\n' 'docker run --gpus all ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 \
vllm serve ... --max-model-len 260000 --gpu-memory-utilization 0.93' > "$SERVER_STATE_DIR/8000.cmdline"
  ws7_prologue; arm_d; ws7_warm
  assert_count "$CALLS" '^start_server ' 2 "T1 cold + one-time warm boot only (arm_d reused)"
  assert_count "$CALLS" 'eb-run d-10k-tg512-n1' 1 "T1 d-10k probed once"
  assert_count "$CALLS" 'eb-run d-100k-tg512-n1' 1 "T1 d-100k probed once"
}

# T2 (P1) resume subset, ALL selected done + WS7 already measured (markers present), and the arm's
# KLD pass complete (P12: a finished arm includes its KLD fetch), no server up: zero boots.
# (Realistic resume of a finished short pass.)
body_t2 () {
  export ONLY='d-10k-tg512-n1,d-100k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/d-10k-tg512-n1" "$RAW/done/d-100k-tg512-n1" \
        "$RAW/done/ws7-cold" "$RAW/done/ws7-warm" "$RAW/done/kld-selftest-sly"
  mk_kld_ok "$RES/kld-d.jsonl" qwen38-27b-redhat-mxfp4-dflash "$IMAGE"
  ws7_prologue; arm_d; ws7_warm
  assert_count "$CALLS" '^start_server ' 0 "T2 resume with all selected done: no boot (P1)"
  assert_count "$CALLS" 'eb-run' 0 "T2 no probe re-run"
}

# T3 (guard) resume subset, one selected missing: prologue + arm_d boot (the real
# second is an instant already-up no-op), only the missing cell is probed.
body_t3 () {
  export ONLY='d-10k-tg512-n1,d-100k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/d-10k-tg512-n1" "$RAW/done/ws7-cold" "$RAW/done/ws7-warm"
  ws7_prologue; arm_d; ws7_warm
  assert_count "$CALLS" 'eb-run d-100k-tg512-n1' 1 "T3 missing cell probed once"
  assert_count "$CALLS" 'eb-run d-10k-tg512-n1' 0 "T3 done cell not re-probed"
  assert_count "$CALLS" '^start_server ' 2 "T3 prologue + arm_d boot (missing cell needs the server)"
}

# T4 (P4) foreign server on 8000 (right name+image, WRONG ctx): must not be reused.
body_t4 () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS='qwen38-27b-redhat-mxfp4-dflash'
  printf '%s\n' 'docker run --gpus all ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 \
vllm serve ... --max-model-len 4096 --gpu-memory-utilization 0.80' > "$SERVER_STATE_DIR/8000.cmdline"
  arm_d
  assert_count "$CALLS" '^start_server ' 1 "T4 foreign ctx 4096 rejected: boots its own (P4)"
}

# T5 (guard) matching server (name+image+ctx): reused, no boot.
body_t5 () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS='qwen38-27b-redhat-mxfp4-dflash'
  printf '%s\n' 'docker run --gpus all ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 \
vllm serve ... --max-model-len 260000 --gpu-memory-utilization 0.93' > "$SERVER_STATE_DIR/8000.cmdline"
  arm_d
  assert_count "$CALLS" '^start_server ' 0 "T5 matching name+image+ctx: reused, no boot"
}

# T6 (P3) prologue boot failure is recorded in failures.txt (the WS7 gap is not silent).
body_t6 () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  STUB_START_RC=1
  ws7_prologue
  assert_contains "T6 WS7 gap recorded on prologue boot failure (P3)" \
    "$RES/failures.txt" 'WS7 COLD BOOT NOT MEASURED'
}

# T7 (P6 -> item B) vllm boot failure: the serve script's own start output (its "container DIED" tail —
# the container is already removed when start returns) lands in the boot tail $RAW/boot-<name>.txt.
body_t7 () {
  export CURL_MODELS=
  printf '%s\n' 'MOCK LINE one' 'MOCK LINE two' > "$scratch/mock.log"
  export FAKE_SERVE_STDERR="$scratch/mock.log"
  if real_start_server d-redhat-sly1100 260000 fp8 0 2; then
    abad "T7 boot failed as expected" "start_server returned 0"
  fi
  assert_contains "T7 SERVER-FAILED recorded" "$RES/failures.txt" 'SERVER-FAILED'
  assert_contains "T7 vllm boot output captured in the boot tail (B)" \
    "$RAW/boot-d-redhat-sly1100.txt" 'MOCK LINE two'
}

# T8 (P6 -> item B) radiance boot failure: same, boot tail $RAW/boot-<arm>.txt.
body_t8 () {
  export CURL_MODELS=
  printf '%s\n' 'RAD MOCK a' 'RAD MOCK b' > "$scratch/mock.log"
  export FAKE_SERVE_STDERR="$scratch/mock.log"
  if real_start_rad a "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4; then
    abad "T8 boot failed as expected" "start_rad returned 0"
  fi
  assert_contains "T8 SERVER-FAILED recorded" "$RES/failures.txt" 'SERVER-FAILED: radiance arm a'
  assert_contains "T8 radiance boot output captured in the boot tail (B)" "$RAW/boot-a.txt" 'RAD MOCK b'
}

# T9 (P1) arm_rad resume, selected cell done and the arm's KLD pass complete (P12): no boot
# (the P1 fix is arm-generic).
body_t9 () {
  export ONLY='c-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/c-10k-tg512-n1" "$RAW/done/kld-selftest-radiance"
  mk_kld_ok "$RES/kld-c.jsonl" qwen38-27b-iq4r-l-v4 "$IMG_RAD_BC"
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^start_rad ' 0 "T9 radiance resume with selected done: no boot (P1)"
}

# T10 (rule 18) a cached KLD fetch holding an ERRORED prompt row is incomplete: it is re-fetched,
# not cached. (2026-11-11: kld_fetch cached by file existence, so one transient per-prompt error
# was never retried and the arm silently ran on fewer prompts.)
body_t10 () {
  export CURL_MODELS=
  local out="$RES/kld-x.jsonl"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "ReadTimeout: x"}' > "$out"
  real_kld_fetch qwen38-27b-fp8 "$out"
  assert_count "$CALLS" '^kld-fetch ' 1 "T10 errored cached fetch is re-fetched (rule 18)"
  assert_count "$out" '"error": "' 0 "T10 re-fetched file carries no errored rows"
}

# T10b (guard) a COMPLETE cached fetch is still cached: no re-fetch.
body_t10b () {
  export CURL_MODELS=
  local out="$RES/kld-y.jsonl"
  mk_kld_ok "$out" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  real_kld_fetch qwen38-27b-fp8 "$out" "$KLD_REF_IMAGE"
  assert_count "$CALLS" '^kld-fetch ' 0 "T10b complete cached fetch: no re-fetch"
}

# T11 (rule 18) the KLD reference cache follows the same rule: an errored cached ref is re-booted.
body_t11 () {
  export CURL_MODELS=
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "HTTP 500"}' > "$RAW/kld-ref.jsonl"
  real_kld_ref_ensure
  assert_count "$CALLS" '^start_server kld-ref-fp8' 1 "T11 errored cached reference is re-booted (rule 18)"
}

# T11b (guard) a COMPLETE cached reference is kept: no boot.
body_t11b () {
  export CURL_MODELS=
  mk_kld_ok "$RAW/kld-ref.jsonl" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  real_kld_ref_ensure
  assert_count "$CALLS" '^start_server' 0 "T11b complete cached reference: no boot"
}

# T12 (rule 2) every invocation records its repo commit + dirty count. meta.txt was write-once,
# so a resumed run hid the code its later rows came from.
body_t12 () {
  export CURL_MODELS=
  assert_contains "T12 meta records this invocation" "$RES/meta.txt" 'invocation='
  assert_contains "T12 invocation line carries repo_commit" "$RES/meta.txt" 'repo_commit='
}

# T13 (contract) arm D must NOT fetch after a FAILED sly selftest (no marker). arm_rad already gates
# on the marker; arm_d did not, so the 2026-11-10 short run fetched 16 errored rows straight after
# "KLD SELFTEST FAILED: sly".
body_t13 () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  arm_d
  assert_count "$CALLS" '^kld_fetch ' 0 "T13 failed sly selftest: arm D does not fetch (contract)"
}

# T13b (guard) a PASSED selftest (marker present): arm D fetches once.
body_t13b () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/kld-selftest-sly"
  arm_d
  assert_count "$CALLS" '^kld_fetch ' 1 "T13b passed sly selftest: arm D fetches once (guard)"
}

# T16 (P12, retry contract) every selected D cell is done, but the KLD fetch has errored rows (rule 18:
# not complete). A re-run must boot and re-fetch. arm_d used to return at "skip (done)" before the KLD
# pass, so the "re-run to re-fetch" message never led to a re-fetch.
body_t16 () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/d-10k-tg512-n1" "$RAW/done/kld-selftest-sly"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "HTTP 500"}' > "$RES/kld-d.jsonl"
  arm_d
  assert_count "$CALLS" '^start_server ' 1 "T16 cells done + KLD incomplete: arm D boots for the re-fetch"
  assert_count "$CALLS" '^kld_fetch ' 1 "T16 cells done + KLD incomplete: arm D re-fetches (retry contract)"
  assert_count "$CALLS" '^eb-run ' 0 "T16 cells done: no cell re-runs on the KLD-only boot"
}

# T16b (guard) cells done and the KLD fetch complete: arm D neither boots nor re-fetches.
body_t16b () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/d-10k-tg512-n1" "$RAW/done/kld-selftest-sly"
  mk_kld_ok "$RES/kld-d.jsonl" qwen38-27b-redhat-mxfp4-dflash "$IMAGE"
  arm_d
  assert_count "$CALLS" '^start_server ' 0 "T16b cells done + KLD complete: arm D does not boot (guard)"
  assert_count "$CALLS" '^kld_fetch ' 0 "T16b cells done + KLD complete: arm D does not re-fetch (guard)"
}

# T16c (P12, radiance) the same retry contract for an arm_rad arm.
body_t16c () {
  export ONLY='c-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/c-10k-tg512-n1" "$RAW/done/kld-selftest-radiance"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "HTTP 500"}' > "$RES/kld-c.jsonl"
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^start_rad ' 1 "T16c cells done + KLD incomplete: arm C boots for the re-fetch"
  assert_count "$CALLS" '^kld_fetch ' 1 "T16c cells done + KLD incomplete: arm C re-fetches (retry contract)"
  assert_count "$CALLS" '^eb-run ' 0 "T16c cells done: no cell re-runs on the KLD-only boot"
}

# T14 (rule 18) an arm whose fetch has errored rows is NOT scored: a partial arm would otherwise
# enter the data as a KL number (the short run's d file: 16 of 16 rows errored).
body_t14 () {
  export CURL_MODELS=
  mk_kld_ok "$RAW/kld-ref.jsonl" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "HTTP 500"}' > "$RES/kld-d.jsonl"
  real_kld_score_all
  assert_count "$CALLS" '^kld-score ' 0 "T14 incomplete arm is not scored (rule 18)"
  assert_contains "T14 skip recorded in failures.txt" "$RES/failures.txt" 'KLD SCORE SKIPPED: d'
}

# T14b (guard) a complete arm against a complete reference is scored once.
body_t14b () {
  export CURL_MODELS=
  mk_kld_ok "$RAW/kld-ref.jsonl" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  mk_kld_ok "$RES/kld-d.jsonl" qwen38-27b-redhat-mxfp4-dflash "$IMAGE"
  real_kld_score_all
  assert_count "$CALLS" '^kld-score ' 1 "T14b complete arm is scored once (guard)"
}

# T14c (rule 18) an incomplete REFERENCE blocks every score: a partial reference would silently
# shift every arm's KL.
body_t14c () {
  export CURL_MODELS=
  mk_kld_ok "$RES/kld-d.jsonl" qwen38-27b-redhat-mxfp4-dflash "$IMAGE"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "HTTP 500"}' > "$RAW/kld-ref.jsonl"
  real_kld_score_all
  assert_count "$CALLS" '^kld-score ' 0 "T14c incomplete reference: no arm scored (rule 18)"
  assert_contains "T14c reference skip recorded" "$RES/failures.txt" 'KLD SCORE SKIPPED: reference'
}

# T15 END-TO-END stress (written after the fix, per rule 11): the REAL kld_probe.py fetch against a
# canned loopback server where one prompt always errors. The cached file must be incomplete, and a
# second invocation must re-fetch it (both prompts requested again).
body_t15 () {
  export CURL_MODELS=
  local srv_dir="$scratch/canned" port srv out="$RES/kld-e2e.jsonl"
  mkdir -p "$srv_dir"
  printf 'hello\n' > "$srv_dir/good.txt"
  printf 'BOOM\n' > "$srv_dir/boom.txt"
  printf '%s\n' \
    "{\"id\": \"cal-good\", \"src\": \"$srv_dir/good.txt\", \"char_cut\": 6}" \
    "{\"id\": \"cal-boom\", \"src\": \"$srv_dir/boom.txt\", \"char_cut\": 4}" > "$srv_dir/cal.jsonl"
  cat > "$srv_dir/server.py" <<'PY'
import http.server, json, os, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        with open(os.environ["CALLS"], "a") as f:
            f.write("canned-completion\n")
        if "BOOM" in body.get("prompt", ""):
            self.send_response(500); self.end_headers(); return
        data = json.dumps({"choices": [{"logprobs": {
            "tokens": ["a", "b"],
            "top_logprobs": [{"a": -0.1, "b": -2.0}, {"b": -0.3, "c": -1.5}]}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(f"{srv.server_address[1]}\n")
srv.serve_forever()
PY
  python3 "$srv_dir/server.py" "$srv_dir/port" &
  srv=$!
  for _ in $(seq 50); do [ -s "$srv_dir/port" ] && break; sleep 0.1; done
  port=$(cat "$srv_dir/port" 2>/dev/null)
  if [ -n "$port" ]; then aok "T15 canned server up"; else abad "T15 canned server up" "no port file"; fi
  KLD="$ROOT/bench/perf/kld_probe.py"
  KLD_URL="http://127.0.0.1:$port/v1"; KLD_CAL="$srv_dir/cal.jsonl"; KLD_N=""
  real_kld_fetch qwen38-27b-fp8 "$out"
  assert_count "$out" '"error": null' 1 "T15 good prompt fetched cleanly (1 clean row)"
  assert_contains "T15 errored prompt is recorded as an error row" "$out" '"error": "'
  if kld_complete "$out"; then abad "T15 incomplete fetch is not complete" "kld_complete said complete"
  else aok "T15 incomplete fetch is not complete"; fi
  real_kld_fetch qwen38-27b-fp8 "$out"
  assert_count "$CALLS" '^canned-completion' 3 "T15 second invocation re-requests only the errored prompt (2 + 1 requests, item D)"
  assert_count "$out" '"id": "cal-' 2 "T15 exactly one row per prompt id after the resume (item D)"
  kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null
}

# ---- item A (2026-11-11): C spec-off variant c0 -------------------------------------------------
# T17 (guard) the spec-on radiance command line stays byte-identical: EXTRA_ARGS for arm c (print + start).
body_t17 () {
  export CURL_MODELS=
  real_start_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 || true
  assert_count "$CALLS" '^serve-rad print EXTRA_ARGS=--gpu-headroom-mib 596 --num-speculative-tokens 7$' 1 "T17 spec-on print EXTRA_ARGS byte-identical"
  assert_count "$CALLS" '^serve-rad start EXTRA_ARGS=--gpu-headroom-mib 596 --num-speculative-tokens 7$' 1 "T17 spec-on start EXTRA_ARGS byte-identical"
}

# T17b (A) the spec-off variant passes --num-speculative-tokens 0, nothing else changes.
body_t17b () {
  export CURL_MODELS=
  real_start_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0 || true
  assert_count "$CALLS" '^serve-rad start EXTRA_ARGS=--gpu-headroom-mib 596 --num-speculative-tokens 0$' 1 "T17b spec-off start EXTRA_ARGS = ... tokens 0"
}

# T18 (A) arm c0: own slugs, own KLD fetch file, selftest keyed by family+spec, spec 0 reaches start_rad.
body_t18 () {
  export ONLY='c0-10k-tg512-n1,c0-100k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/kld-selftest-radiance-spec0"
  arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0
  assert_count "$CALLS" '^start_rad c0 .* 0$' 1 "T18 c0 boots once with spec tokens 0"
  assert_count "$CALLS" '^eb-run c0-10k-tg512-n1$' 1 "T18 c0-10k-tg512-n1 probed"
  assert_count "$CALLS" '^eb-run c0-100k-tg512-n1$' 1 "T18 c0-100k-tg512-n1 probed"
  assert_count "$CALLS" '^kld_selftest radiance-spec0 ' 1 "T18 c0 selftest keyed by family+spec (radiance-spec0)"
  assert_count "$CALLS" '^kld_fetch qwen38-27b-iq4r-l-v4 .*/kld-c0\.jsonl' 1 "T18 c0 fetches into kld-c0.jsonl"
}

# T18b (A) the c-* glob in ONLY does not select c0 (and still selects c).
body_t18b () {
  export ONLY='c-*'
  export CURL_MODELS=
  arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0
  assert_count "$CALLS" '^start_rad c0 ' 0 "T18b ONLY=c-* does not select c0"
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^start_rad c ' 1 "T18b ONLY=c-* still selects c"
}

# T19 (A) a PASSED spec-on selftest must not skip the spec-off selftest (marker keyed by family+spec).
body_t19 () {
  export ONLY='c0-10k-tg512-n1'
  export CURL_MODELS=
  kld_selftest () { real_kld_selftest "$@"; }
  touch "$RAW/done/kld-selftest-radiance"
  arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0
  assert_count "$CALLS" '^kld-selftest ' 1 "T19 spec-off selftest runs although spec-on passed"
  if [ -f "$RAW/done/kld-selftest-radiance-spec0" ]; then aok "T19 spec-off marker written"; else abad "T19 spec-off marker written" "no kld-selftest-radiance-spec0"; fi
  assert_count "$CALLS" '^kld_fetch .*/kld-c0\.jsonl' 1 "T19 c0 fetches after its own selftest passed"
}

# T19b (guard) the spec-on arm still skips its selftest once the historical marker exists.
body_t19b () {
  export ONLY='c-10k-tg512-n1'
  export CURL_MODELS=
  kld_selftest () { real_kld_selftest "$@"; }
  touch "$RAW/done/kld-selftest-radiance"
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^kld-selftest ' 0 "T19b spec-on arm skips its passed selftest (marker kld-selftest-radiance)"
}

# T20 (A, P12 for c0) cells done + complete c0 fetch: no boot; incomplete: boot + re-fetch.
body_t20 () {
  export ONLY='c0-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/c0-10k-tg512-n1" "$RAW/done/kld-selftest-radiance-spec0"
  mk_kld_ok "$RES/kld-c0.jsonl" qwen38-27b-iq4r-l-v4 "$IMG_RAD_BC"
  arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0
  assert_count "$CALLS" '^start_rad ' 0 "T20 c0 cells done + KLD complete: no boot"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "HTTP 500"}' > "$RES/kld-c0.jsonl"
  arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0
  assert_count "$CALLS" '^start_rad c0 ' 1 "T20 c0 cells done + KLD incomplete: boots for the re-fetch (P12)"
  assert_count "$CALLS" '^kld_fetch .*/kld-c0\.jsonl' 1 "T20 c0 re-fetches"
}

# T21 (A) the score pass includes c0, under its own label.
body_t21 () {
  export CURL_MODELS=
  mk_kld_ok "$RAW/kld-ref.jsonl" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  mk_kld_ok "$RES/kld-c0.jsonl" qwen38-27b-iq4r-l-v4 "$IMG_RAD_BC"
  real_kld_score_all
  assert_count "$CALLS" '^kld-score .*--arm .*/kld-c0\.jsonl --label c0 ' 1 "T21 c0 scored under label c0"
}

# T22 (A, end-to-end entry point) `run-arm.sh c0` through the REAL run-arm.sh + run.sh: every leaf that could
# touch the machine is replaced via env (SERVE_RAD/SERVE_VLLM fakes, EB fake, KLD fake, KLD_URL on a closed
# port, PATH-stubbed docker/curl/amd-smi/rocm-smi, BOOT_VRAM_SAMPLER fake, DRM_ROOT fake). No GPU, no port 8000.
runarm_c0 () {
  if [ -n "${GATING_ONLY:-}" ] && ! [[ " $GATING_ONLY " == *" t22 "* ]]; then return 0; fi
  local scratch; scratch=$(mktemp -d "$TMP_BASE/t22.XXXXXX"); SCRATCHES+=("$scratch")
  mkdir -p "$scratch/inputs" "$scratch/stubbin" "$scratch/fake" "$scratch/state" "$scratch/drm/card0/device"
  cp -r "$CAMPAIGN/inputs/." "$scratch/inputs/"
  : > "$scratch/calls.log"
  # boot gate (2026-11-11): same isolation as the scenario harness — a free ephemeral gate port, so the
  # real port 8000 (held by the user's server) never reaches run-arm.sh's start_rad/start_server
  local gate_port; gate_port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  printf '%s\n' '#!/usr/bin/env bash' 'echo "docker $*" >> "$CALLS"' \
    'case "${1:-}" in images) printf "%s\n" stilldeadcode/radiance:1.11.0 stilldeadcode/radiance:1.17.0 ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 ;; esac' \
    'exit 0' > "$scratch/stubbin/docker"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "curl $*" >> "$CALLS"' 'exit 0' > "$scratch/stubbin/curl"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "amd-smi $*" >> "$CALLS"' 'exit 0' > "$scratch/stubbin/amd-smi"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "rocm-smi $*" >> "$CALLS"' 'exit 1' > "$scratch/stubbin/rocm-smi"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-rad $* EXTRA_ARGS=${EXTRA_ARGS:-}" >> "$CALLS"' 'exit 0' > "$scratch/fake/serve-rad.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-vllm $*" >> "$CALLS"' 'exit 1' > "$scratch/fake/serve-vllm.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "eb-run $SLUG" >> "$CALLS"' 'exit 0' > "$scratch/fake/run.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "sampler $*" >> "$CALLS"' 'exit 0' > "$scratch/fake/sampler.sh"
  cat > "$scratch/fake/kld.py" <<'PY2'
import os, sys
a = sys.argv[1:]
with open(os.environ["CALLS"], "a") as f:
    f.write("kld-" + a[0] + " " + " ".join(a[1:]) + "\n")
if "--out" in a:
    with open(a[a.index("--out") + 1], "w") as f:
        f.write('{"id": "cal-001", "toks": ["x"], "pos": [], "error": null}\n')
PY2
  echo 1073741824 > "$scratch/drm/card0/device/mem_info_vram_used"
  echo 34359738368 > "$scratch/drm/card0/device/mem_info_vram_total"
  chmod +x "$scratch/stubbin/"* "$scratch/fake/"*.sh
  ( cd "$scratch" && env PATH="$scratch/stubbin:$PATH" CALLS="$scratch/calls.log" CAMPAIGN_DIR="$scratch" \
      RUN_TAG=gate-t22 ONLY='c0-10k-tg512-n1' SERVER_STATE_DIR="$scratch/state" \
      SERVE_RAD="$scratch/fake/serve-rad.sh" SERVE_VLLM="$scratch/fake/serve-vllm.sh" EB="$scratch/fake" \
      KLD="$scratch/fake/kld.py" KLD_URL="http://127.0.0.1:9/v1" BOOT_VRAM_SAMPLER="$scratch/fake/sampler.sh" \
      DRM_ROOT="$scratch/drm" VLLM_CACHE_ROOT="$scratch/vllm-cache" GATE_PORT="$gate_port" \
      bash "$CAMPAIGN/run-arm.sh" c0 ) > "$scratch/out.log" 2>&1
  local rc=$? res="$scratch/tmp/runs/gate-t22/results" raw="$scratch/tmp/runs/gate-t22/tmp" n
  if [ "$rc" -eq 0 ]; then echo "ok T22 run-arm.sh c0 exits 0"; PASS=$((PASS+1)); else echo "FAIL T22 run-arm.sh c0 exits 0 :: rc=$rc"; FAIL=$((FAIL+1)); tail -8 "$scratch/out.log" | sed 's/^/  /'; fi
  n=$(grep -c '^serve-rad start EXTRA_ARGS=--gpu-headroom-mib 596 --num-speculative-tokens 0$' "$scratch/calls.log")
  if [ "$n" -eq 1 ]; then echo "ok T22 run-arm.sh c0 boots radiance spec-off once"; PASS=$((PASS+1)); else echo "FAIL T22 run-arm.sh c0 boots radiance spec-off once :: count=$n"; FAIL=$((FAIL+1)); fi
  n=$(grep -c '^eb-run c0-10k-tg512-n1$' "$scratch/calls.log")
  if [ "$n" -eq 1 ]; then echo "ok T22 run-arm.sh c0 probes c0-10k-tg512-n1"; PASS=$((PASS+1)); else echo "FAIL T22 run-arm.sh c0 probes c0-10k-tg512-n1 :: count=$n"; FAIL=$((FAIL+1)); fi
  if [ -f "$res/kld-c0.jsonl" ]; then echo "ok T22 run-arm.sh c0 writes results/kld-c0.jsonl"; PASS=$((PASS+1)); else echo "FAIL T22 run-arm.sh c0 writes results/kld-c0.jsonl :: missing"; FAIL=$((FAIL+1)); fi
  n=$(grep -c ':8000\|localhost:8000' "$scratch/calls.log" | head -1)
  n=$(grep -c 'kld-selftest --url http://127.0.0.1:9/v1' "$scratch/calls.log")
  if [ "$n" -eq 1 ]; then echo "ok T22 KLD calls use the overridden KLD_URL (no port 8000)"; PASS=$((PASS+1)); else echo "FAIL T22 KLD calls use the overridden KLD_URL :: count=$n"; FAIL=$((FAIL+1)); fi
}

# ---- item C (2026-11-11): KLD caches record their key ------------------------------------------
# T23 (C) a complete cache fetched with KLD_N=1 is NOT reused by a KLD_N=2 run (its key says n=1): re-fetched.
body_t23 () {
  export CURL_MODELS=
  local out="$RES/kld-z.jsonl"
  mk_kld_ok "$out" qwen38-27b-fp8 "$KLD_REF_IMAGE"          # KLD_N=1 cache
  KLD_N=2
  if kld_complete "$out" qwen38-27b-fp8 "$KLD_REF_IMAGE"; then abad "T23 N=1 cache is not complete for N=2" "kld_complete said complete"
  else aok "T23 N=1 cache is not complete for N=2"; fi
  real_kld_fetch qwen38-27b-fp8 "$out" "$KLD_REF_IMAGE"
  assert_count "$CALLS" '^kld-fetch .*--limit 2' 1 "T23 KLD_N change re-fetches (no reuse of the N=1 rows)"
}

# T23b (C) a cache keyed to another image is not reused by arm_rad's P12 early return: the arm boots.
body_t23b () {
  export ONLY='c-10k-tg512-n1'
  export CURL_MODELS=
  touch "$RAW/done/c-10k-tg512-n1" "$RAW/done/kld-selftest-radiance"
  mk_kld_ok "$RES/kld-c.jsonl" qwen38-27b-iq4r-l-v4 stilldeadcode/radiance:1.16.0
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^start_rad c ' 1 "T23b image change: cached fetch not reused, arm boots to re-fetch"
}

# T23c (C) the fetch passes the image (cache key) and the /metrics window file (item H).
body_t23c () {
  export CURL_MODELS=
  real_kld_fetch qwen38-27b-fp8 "$RES/kld-w.jsonl" "$KLD_REF_IMAGE"
  assert_count "$CALLS" "^kld-fetch .*--image $KLD_REF_IMAGE" 1 "T23c fetch records the image in its cache key"
  assert_count "$CALLS" '^kld-fetch .*--window-out .*/kld-fetch-windows\.jsonl' 1 "T23c fetch appends its /metrics window"
}

# ---- item B (2026-11-11): boot failure diagnosis — every call site, bounded tail, rc + seconds ---
jq_boot () {   # file field-expr -> python-evaluated value of the LAST boots.jsonl row (r = row)
  python3 - "$1" "$2" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
r = rows[-1]
print(eval(sys.argv[2]))
PY
}

# T24 (B) the FP8 reference boot fails: IMAGE reaches the serve script, failures.txt names the boot
# tail and records start rc + seconds waited, the tail holds the start stderr AND the fresh
# state-dir engine log, the logs mode was asked, results/*-boot.log is no longer written.
body_t24 () {
  export CURL_MODELS=
  printf '%s\n' 'INFO boot line' 'Traceback (most recent call last):' \
    'NotImplementedError: fp8 w8a8 not supported on gfx1201 (MOCK)' 'container DIED during startup' > "$scratch/err.txt"
  printf '%s\n' 'engine log line' 'torch.OutOfMemoryError: HIP out of memory (MOCK)' > "$scratch/state.txt"
  export FAKE_SERVE_STDERR="$scratch/err.txt" FAKE_STATE_LOG="$scratch/state.txt"
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then abad "T24 boot failed as expected" "returned 0"; fi
  assert_count "$CALLS" "^serve-vllm start IMAGE=$KLD_REF_IMAGE\$" 1 "T24 the FP8 reference IMAGE reaches serve start"
  assert_count "$RES/failures.txt" "SERVER-FAILED.*kld-ref-fp8.*start_rc=1 waited_s=[0-9][0-9]* boot tail: $RAW/boot-kld-ref-fp8.txt" 1 \
    "T24 failures line: start rc, seconds waited, boot tail path"
  assert_contains "T24 boot tail holds the start stderr" "$RAW/boot-kld-ref-fp8.txt" 'NotImplementedError: fp8 w8a8'
  assert_contains "T24 boot tail holds the fresh state-dir engine log" "$RAW/boot-kld-ref-fp8.txt" 'torch.OutOfMemoryError'
  assert_count "$CALLS" '^serve-vllm logs' 1 "T24 the serve script logs mode is captured"
  if [ -e "$RES/server-kld-ref-fp8-boot.log" ]; then abad "T24 no results/*-boot.log any more" "exists"
  else aok "T24 no results/*-boot.log any more"; fi
  [ "$(jq_boot "$RES/boots.jsonl" 'r["start_rc"], r["ok"], r["image"], r["image_id"][:7], r["slug"]')" \
    = "(1, False, '$KLD_REF_IMAGE', 'sha256:', 'kld-ref-fp8')" ] && aok "T24 boots.jsonl row (rc, ok, image, image id)" \
    || abad "T24 boots.jsonl row (rc, ok, image, image id)" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 400)"
  [ "$(jq_boot "$RES/boots.jsonl" 'r["boot_tail"].endswith("boot-kld-ref-fp8.txt"), r["cache_state"]')" = "(True, 'cold')" ] \
    && aok "T24 boots.jsonl names the boot tail, cache measured cold (empty cache dir)" \
    || abad "T24 boots.jsonl names the boot tail, cache measured cold" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 400)"
}

# T24b (B) two failed attempts -> one tail file each (second = -boot2, fresh_slug), two boots.jsonl rows (nothing overwritten)
body_t24b () {
  export CURL_MODELS=
  real_start_server kld-ref-fp8 8192 fp8 0 1
  real_start_server kld-ref-fp8 8192 fp8 0 1
  assert_count "$RAW/boot-kld-ref-fp8.txt" '^=== boot attempt' 1 "T24b first failed attempt keeps its tail block"
  assert_count "$RAW/boot-kld-ref-fp8-boot2.txt" '^=== boot attempt' 1 "T24b second failed attempt gets its own -boot2 tail"
  assert_count "$RES/boots.jsonl" '"kind": "boot"' 2 "T24b one boots.jsonl row per attempt"
}

# T24c (B) radiance failure at its call site: failures line names the tail, rc + seconds recorded
body_t24c () {
  export CURL_MODELS=
  printf '%s\n' 'container exited during boot; last log lines:' 'RuntimeError: out of memory (MOCK)' > "$scratch/err.txt"
  export FAKE_SERVE_STDERR="$scratch/err.txt"
  real_start_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0
  assert_count "$RES/failures.txt" "SERVER-FAILED: radiance arm c0 (image=$IMG_RAD_BC) start_rc=1 waited_s=[0-9][0-9]* boot tail: $RAW/boot-c0.txt" 1 \
    "T24c radiance failures line: rc, seconds, boot tail"
  assert_contains "T24c radiance tail holds the start stderr" "$RAW/boot-c0.txt" 'RuntimeError: out of memory'
  [ "$(jq_boot "$RES/boots.jsonl" 'r["engine"], r["rad_path"] is not None, r["rad_bytes"] is not None, r["cache_state"]')" \
    = "('radiance', True, True, None)" ] && aok "T24c boots.jsonl radiance row (rad path+size, no vllm cache)" \
    || abad "T24c boots.jsonl radiance row" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 400)"
}

# T24d (H) a successful vllm boot: boots.jsonl ok, VRAM before/ready (sysfs) + peak (sampler CSV), cache
# warm (files in the image's cache dir), engine-log numbers parsed from the live container log; no tail.
body_t24d () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=0 FAKE_SERVE_SLEEP=0.6
  local cd="$VLLM_CACHE_ROOT/vllm-sly-radiance@1.11.0-rocm10.1/triton"; mkdir -p "$cd"; echo x > "$cd/kernel.bin"
  printf '%s\n' 'INFO GPU KV cache size: 123,456 tokens' 'INFO Maximum concurrency for 260,000 tokens per request: 1.90x' > "$scratch/mock.log"
  export MOCK_LOG_FILE="$scratch/mock.log"
  real_start_server d-redhat-sly1100 260000 fp8 0 2 || abad "T24d boot ok" "start_server returned nonzero"
  [ "$(jq_boot "$RES/boots.jsonl" 'r["ok"], r["start_rc"], r["boot_tail"], r["cache_state"], r["vram_before_mib"], r["vram_ready_mib"]')" \
    = "(True, 0, None, 'warm', 1024, 1024)" ] && aok "T24d boots.jsonl ok row (rc 0, no tail, cache warm, VRAM before/ready)" \
    || abad "T24d boots.jsonl ok row" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 600)"
  [ "$(jq_boot "$RES/boots.jsonl" 'r["vram_peak_boot_mib"], r["engine_log"]["kv_cache_tokens"], r["boot_seconds"] >= 0.5')" \
    = "(2048, 123456, True)" ] && aok "T24d boots.jsonl peak VRAM (CSV), KV tokens (engine log), boot_seconds" \
    || abad "T24d boots.jsonl peak/engine-log/boot_seconds" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 600)"
  assert_count "$CALLS" '^sampler --out ' 1 "T24d the boot VRAM sampler ran once"
  if [ -e "$RAW/boot-d-redhat-sly1100.txt" ]; then abad "T24d no boot tail on success" "exists"; else aok "T24d no boot tail on success"; fi
}

# ---- item G (2026-11-11): WS7 cold vs warm from the MEASURED cache state (no wipe) -----------------
# T25 the prologue labels the boot from the cache dir of the image it boots (files counted before boot)
body_t25 () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  ws7_prologue > "$scratch/ws7.out" 2>&1
  assert_contains "T25 empty cache dir -> label cold (MEASURED)" "$scratch/ws7.out" 'cache state = cold (MEASURED'
}
body_t25b () {
  export ONLY='d-10k-tg512-n1'
  export CURL_MODELS=
  local cd="$VLLM_CACHE_ROOT/vllm-sly-radiance@1.11.0-rocm10.1/root-cache"; mkdir -p "$cd"; echo x > "$cd/a.so"
  ws7_prologue > "$scratch/ws7.out" 2>&1
  assert_contains "T25b files in the cache dir -> label warm (MEASURED)" "$scratch/ws7.out" 'cache state = warm (MEASURED'
}

# ---- boot gate + state-dir log provenance (2026-11-11) ------------------------------------------
# RED tests for the two approved changes (stage A; stage B implements run.sh):
#   CHANGE 1: the failure-path tail / boots.jsonl engine_log must use $SERVER_STATE_DIR/8000.log only
#     when THIS boot wrote it (signature inode:size:mtime-ns before/after the serve call).
#   CHANGE 2: pre-boot gate in start_server AND start_rad — refuse (nonzero; BOOT REFUSED line; no
#     serve call, no sampler, no stop, no boots.jsonl row) when GATE_PORT (default 8000) is
#     LISTEN-held or free VRAM (sysfs under DRM_ROOT) < FREE_MIB_FLOOR (default 30000).
# Fixture (after-source overrides above): used 1024 MiB, total 32768 MiB -> free exactly 31744 MiB.
# t26 (-): a stale state-dir log (old mtime) + a failing boot that did NOT write it: the section is
# omitted and the tail states the file was not written by this boot. Protects: an earlier boot's
# engine log leaking into this boot's tail (the 2026-11-10 boot-c0.txt showed an earlier kld-ref-fp8
# ValidationError inside a c0 port-refusal tail).
body_t26 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  printf '%s\n' 'STALE_C1_T26 engine line from an earlier boot' > "$SERVER_STATE_DIR/8000.log"
  touch -d '2 hours ago' "$SERVER_STATE_DIR/8000.log"
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T26 boot failed as expected" "start_server returned 0"
  fi
  assert_contains "T26 failures line SERVER-FAILED" "$RES/failures.txt" 'SERVER-FAILED'
  assert_contains "T26 tail states the state-dir log was not written by this boot" \
    "$RAW/boot-kld-ref-fp8.txt" 'not written by this boot'
  if grep -q 'STALE_C1_T26' "$RAW/boot-kld-ref-fp8.txt"; then
    abad "T26 stale state-dir content excluded from the tail" "STALE_C1_T26 present"
  else aok "T26 stale state-dir content excluded from the tail"; fi
  if grep -q '^--- state-dir engine log:' "$RAW/boot-kld-ref-fp8.txt"; then
    abad "T26 stale state-dir section omitted" "section present"
  else aok "T26 stale state-dir section omitted"; fi
}
# t27 (edge): the state-dir log is ABSENT: the failure path still states it was not written by this
# boot and nothing crashes (it completes: SERVER-FAILED + boot row with empty engine_log).
body_t27 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  rm -f "$SERVER_STATE_DIR/8000.log"   # fresh scratch: make the absence explicit
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T27 boot failed as expected" "start_server returned 0"
  fi
  assert_contains "T27 failure path completes (SERVER-FAILED recorded)" "$RES/failures.txt" 'SERVER-FAILED'
  assert_contains "T27 tail states the absent log was not written by this boot" \
    "$RAW/boot-kld-ref-fp8.txt" 'not written by this boot'
  [ "$(jq_boot "$RES/boots.jsonl" 'r["engine_log"]["parsed"]')" = "[]" ] \
    && aok "T27 boot row recorded with empty engine_log" \
    || abad "T27 boot row recorded with empty engine_log" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 300)"
}
# t28 (edge): a stale log that THIS boot rewrites within the same second as its start: the section IS
# included (and no stale statement). Protects: an over-corrective mtime-window check dropping a
# same-second rewrite (its mtime second is unchanged).
body_t28 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  printf 'STALE_C1_T28 about to be replaced\n' > "$SERVER_STATE_DIR/8000.log"   # mtime = now (1 s resolution)
  printf 'FRESH_C1_T28 this boot wrote it\n' > "$scratch/state.txt"
  export FAKE_STATE_LOG="$scratch/state.txt"
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T28 boot failed as expected" "start_server returned 0"
  fi
  assert_contains "T28 state-dir section included (written by this boot)" \
    "$RAW/boot-kld-ref-fp8.txt" 'state-dir engine log:'
  assert_contains "T28 tail holds this boot's fresh engine log" "$RAW/boot-kld-ref-fp8.txt" 'FRESH_C1_T28'
  if grep -q 'not written by this boot' "$RAW/boot-kld-ref-fp8.txt"; then
    abad "T28 no stale statement when the section is included" "statement present"
  else aok "T28 no stale statement when the section is included"; fi
}
# t29 (-): a stale state log AND a gate refusal (ephemeral listener on the gate port): the refusal
# tail carries the refusal facts, never the stale content; no serve call, no sampler, no stop, no
# boots.jsonl row (no boot was attempted).
body_t29 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  printf 'STALE_C2_T29 engine line from an earlier boot\n' > "$SERVER_STATE_DIR/8000.log"
  touch -d '2 hours ago' "$SERVER_STATE_DIR/8000.log"
  hold_port || { kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null; abad "T29 ephemeral listener up" "hold_port failed"; return 0; }
  local port; port=$HOLDER_PORT
  GATE_PORT=$port
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T29 refusal returned nonzero" "start_server returned 0"
  fi
  assert_contains "T29 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_contains "T29 refusal names the held gate port and its holder slot" "$RES/failures.txt" "port=$port held by"
  [ -f "$RAW/boot-kld-ref-fp8.txt" ] && aok "T29 refusal tail written" \
    || abad "T29 refusal tail written" "no $RAW/boot-kld-ref-fp8.txt"
  assert_contains "T29 refusal tail carries free MiB" "$RAW/boot-kld-ref-fp8.txt" 'free_mib=31744'
  assert_contains "T29 refusal tail carries the floor" "$RAW/boot-kld-ref-fp8.txt" 'floor_mib=30000'
  assert_contains "T29 refusal tail carries the port state" "$RAW/boot-kld-ref-fp8.txt" "port=$port held"
  if grep -q 'STALE_C2_T29' "$RAW/boot-kld-ref-fp8.txt"; then
    abad "T29 stale content absent from the refusal tail" "STALE_C2_T29 present"
  else aok "T29 stale content absent from the refusal tail"; fi
  assert_count "$CALLS" '^serve-vllm' 0 "T29 no serve-script call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T29 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T29 no stop on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T29 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T29 no boots.jsonl row (no boot attempted)"; fi
  kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
}
# t30 (-): a stale state log carrying a PARSEABLE engine line never feeds boots.jsonl engine_log
# (no stale engine numbers: kv_cache_tokens must stay null).
body_t30 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  printf 'INFO GPU KV cache size: 777,777 tokens\nSTALE_C3_T30\n' > "$SERVER_STATE_DIR/8000.log"
  touch -d '2 hours ago' "$SERVER_STATE_DIR/8000.log"
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T30 boot failed as expected" "start_server returned 0"
  fi
  [ "$(jq_boot "$RES/boots.jsonl" 'r["engine_log"]["kv_cache_tokens"], r["engine_log"]["parsed"]')" = "(None, [])" ] \
    && aok "T30 stale log never feeds boots.jsonl engine_log" \
    || abad "T30 stale log never feeds boots.jsonl engine_log" "$(tail -1 "$RES/boots.jsonl" 2>&1 | head -c 300)"
  if grep -q 'STALE_C3_T30' "$RES/boots.jsonl"; then
    abad "T30 boots.jsonl free of the stale text" "STALE_C3_T30 present"
  else aok "T30 boots.jsonl free of the stale text"; fi
}
# t31 (+ guard): free 31744 MiB >= default floor 30000: the gate passes and the serve start is
# called (the gate must not block a clean boot).
body_t31 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T31 boot failed as expected" "start_server returned 0"
  fi
  assert_count "$CALLS" '^serve-vllm print ' 1 "T31 gate passed: serve print called"
  assert_count "$CALLS" '^serve-vllm start ' 1 "T31 gate passed: serve start called"
  assert_count "$CALLS" '^sampler --out ' 1 "T31 sampler started (after the gate)"
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 0 "T31 no refusal"
}
# t32 (+ boundary): free == floor exactly (FREE_MIB_FLOOR overridden to the fixture free 31744):
# allowed. Also pins the floor override being honoured (+ side).
body_t32 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  FREE_MIB_FLOOR=31744
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T32 boot failed as expected" "start_server returned 0"
  fi
  assert_count "$CALLS" '^serve-vllm start ' 1 "T32 free == floor: allowed (serve start called)"
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 0 "T32 no refusal at free == floor"
}
# t33 (-): free (31744) == floor (31745) - 1: refused — failures line starts BOOT REFUSED with the
# free/floor facts; no serve call, no sampler, no stop, no boots.jsonl row.
body_t33 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  FREE_MIB_FLOOR=31745
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T33 refusal returned nonzero" "start_server returned 0"
  fi
  if grep -q '^BOOT REFUSED' "$RES/failures.txt"; then aok "T33 failures line starts BOOT REFUSED"
  else abad "T33 failures line starts BOOT REFUSED" "$(grep -o '^[A-Z-]*' "$RES/failures.txt" 2>/dev/null | tr '\n' ' ')"; fi
  assert_contains "T33 refusal states free MiB" "$RES/failures.txt" 'free_mib=31744'
  assert_contains "T33 refusal states the floor" "$RES/failures.txt" 'floor_mib=31745'
  assert_count "$CALLS" '^serve-vllm' 0 "T33 no serve-script call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T33 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T33 no stop on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T33 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T33 no boots.jsonl row (no boot attempted)"; fi
}
# t34 (-): the gate port is LISTEN-held by an ephemeral listener (never 8000): refused in the vLLM
# path; the refusal names the port and its holder slot; no serve call, no sampler, no stop, no row.
body_t34 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  hold_port || { kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null; abad "T34 ephemeral listener up" "hold_port failed"; return 0; }
  local port; port=$HOLDER_PORT
  GATE_PORT=$port
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T34 refusal returned nonzero" "start_server returned 0"
  fi
  assert_contains "T34 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_contains "T34 refusal names the held gate port and its holder slot" "$RES/failures.txt" "port=$port held by"
  [ -f "$RAW/boot-kld-ref-fp8.txt" ] && aok "T34 refusal tail written" \
    || abad "T34 refusal tail written" "no $RAW/boot-kld-ref-fp8.txt"
  assert_contains "T34 refusal tail carries free MiB" "$RAW/boot-kld-ref-fp8.txt" 'free_mib=31744'
  assert_contains "T34 refusal tail carries the port state" "$RAW/boot-kld-ref-fp8.txt" "port=$port held"
  assert_count "$CALLS" '^serve-vllm' 0 "T34 no serve-script call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T34 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T34 no stop on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T34 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T34 no boots.jsonl row (no boot attempted)"; fi
  kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
}
# t35 (-): the same port-held refusal in the RADIANCE path (start_rad).
body_t35 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  hold_port || { kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null; abad "T35 ephemeral listener up" "hold_port failed"; return 0; }
  local port; port=$HOLDER_PORT
  GATE_PORT=$port
  if real_start_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0; then
    abad "T35 refusal returned nonzero" "start_rad returned 0"
  fi
  assert_contains "T35 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_contains "T35 refusal names the held gate port" "$RES/failures.txt" "port=$port held"
  [ -f "$RAW/boot-c0.txt" ] && aok "T35 refusal tail written" \
    || abad "T35 refusal tail written" "no $RAW/boot-c0.txt"
  assert_count "$CALLS" '^serve-rad' 0 "T35 no serve-rad call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T35 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T35 no stop on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T35 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T35 no boots.jsonl row (no boot attempted)"; fi
  kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
}
# t36 (-): sysfs unreadable (DRM_ROOT points at a dir with no cards): fail closed — refused,
# free_mib=unreadable; no serve call, no sampler, no stop, no row.
body_t36 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  DRM_ROOT="$scratch/drm-unreadable"   # intentionally absent
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T36 refusal returned nonzero" "start_server returned 0"
  fi
  assert_contains "T36 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_contains "T36 refusal states VRAM unreadable" "$RES/failures.txt" 'free_mib=unreadable'
  [ -f "$RAW/boot-kld-ref-fp8.txt" ] && aok "T36 refusal tail written" \
    || abad "T36 refusal tail written" "no $RAW/boot-kld-ref-fp8.txt"
  assert_count "$CALLS" '^serve-vllm' 0 "T36 no serve-script call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T36 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T36 no stop on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T36 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T36 no boots.jsonl row (no boot attempted)"; fi
}
# t37 (-): mem_info_vram_total missing on the card: fail closed — refused, free_mib=unreadable;
# no serve call, no sampler, no row.
body_t37 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  mkdir -p "$scratch/drm-nototal/card0/device"
  echo 1073741824 > "$scratch/drm-nototal/card0/device/mem_info_vram_used"
  DRM_ROOT="$scratch/drm-nototal"
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T37 refusal returned nonzero" "start_server returned 0"
  fi
  assert_contains "T37 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_contains "T37 refusal states VRAM unreadable" "$RES/failures.txt" 'free_mib=unreadable'
  assert_count "$CALLS" '^serve-vllm' 0 "T37 no serve-script call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T37 no sampler on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T37 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T37 no boots.jsonl row (no boot attempted)"; fi
}

# ---- boot gate wait behavior (FLOOR_WAIT polling; 2026-11-11) -------------------------------------
# The gate POLLS up to FLOOR_WAIT seconds (default 90, read at call time) until BOTH hold: the gate
# port is free AND free VRAM >= FREE_MIB_FLOOR — only then does it pass; the wait exhausted (or
# FLOOR_WAIT=0) refuses with a BOOT REFUSED line carrying waited_s; an invalid FLOOR_WAIT
# (non-integer or negative) fails closed and says so. t38/t42/t44 pass after the wait; t39/t41/t45
# exhaust it; t40 is the no-wait check; t43 is the fail-closed validation.
# t38 (+ wait, vLLM path): VRAM below the floor at t=0 (used 31000 MiB), freed to 1024 MiB by a
# background writer after about 1 s, FLOOR_WAIT=10: the gate polls and passes once the VRAM holds —
# serve start called exactly once, no BOOT REFUSED line. Protects: the gate waiting out a transient
# VRAM squeeze instead of refusing a boot that would have fit a second later.
body_t38 () {
  export CURL_MODELS=
  echo 32505856000 > "$DRM_ROOT/card0/device/mem_info_vram_used"   # used 31000 MiB (free 1768 < floor)
  ( sleep 1; echo 1073741824 > "$DRM_ROOT/card0/device/mem_info_vram_used" ) &
  local WRITER=$!
  FLOOR_WAIT=10
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T38 serve start failed as expected (fake rc=1)" "start_server returned 0"
  fi
  kill "$WRITER" 2>/dev/null; wait "$WRITER" 2>/dev/null
  assert_count "$CALLS" '^serve-vllm start ' 1 "T38 gate passed after the wait: serve start called once"
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 0 "T38 no BOOT REFUSED line"
}
# t39 (- wait exhausted, vLLM): VRAM stays below the floor (used 31000 MiB) through the whole
# FLOOR_WAIT=2 wait: refused with a BOOT REFUSED line whose waited_s lies in [2,10]; no serve call, no
# sampler, no stop, no boots.jsonl row. Protects: the gate giving up on a card that never frees up
# instead of booting into it (or waiting forever).
body_t39 () {
  export CURL_MODELS=
  echo 32505856000 > "$DRM_ROOT/card0/device/mem_info_vram_used"   # used 31000 MiB (free 1768 < floor), stays there
  FLOOR_WAIT=2
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T39 refusal returned nonzero" "start_server returned 0"
  fi
  assert_contains "T39 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  local waited
  waited=$(grep 'BOOT REFUSED' "$RES/failures.txt" | grep -o 'waited_s=[0-9]*' | head -1 | cut -d= -f2)
  if [ -n "$waited" ] && [ "$waited" -ge 2 ] && [ "$waited" -le 10 ]; then aok "T39 waited_s=$waited within [2,10]"
  else abad "T39 waited_s within [2,10]" "waited_s='${waited:-<absent>}'"; fi
  assert_count "$CALLS" '^serve-vllm' 0 "T39 no serve-script call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T39 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T39 no stop on refusal"
  if [ -f "$RES/boots.jsonl" ] && grep -q '"kind": "boot"' "$RES/boots.jsonl"; then
    abad "T39 no boots.jsonl row (no boot attempted)" "row present"
  else aok "T39 no boots.jsonl row (no boot attempted)"; fi
}
# t40 (- no wait): FLOOR_WAIT=0 with VRAM below the floor: refused immediately (under 5 s), and the
# BOOT REFUSED line carries waited_s=0. Protects: FLOOR_WAIT=0 meaning "check once" (the suite's
# default for every non-wait test) rather than the 90 s default.
body_t40 () {
  export CURL_MODELS=
  echo 32505856000 > "$DRM_ROOT/card0/device/mem_info_vram_used"   # used 31000 MiB (free 1768 < floor)
  FLOOR_WAIT=0
  local t0 t1; t0=$(date +%s)
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T40 refusal returned nonzero" "start_server returned 0"
  fi
  t1=$(date +%s)
  if [ $((t1 - t0)) -lt 5 ]; then aok "T40 refused in under 5 s ($((t1 - t0)) s)"
  else abad "T40 refused in under 5 s" "took $((t1 - t0)) s"; fi
  assert_contains "T40 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  local waited
  waited=$(grep 'BOOT REFUSED' "$RES/failures.txt" | grep -o 'waited_s=[0-9]*' | head -1 | cut -d= -f2)
  if [ "$waited" = "0" ]; then aok "T40 waited_s=0"
  else abad "T40 waited_s=0" "waited_s='${waited:-<absent>}'"; fi
}
# t41 (- port held through the whole wait, vLLM): the gate port is LISTEN-held (VRAM fine) through the
# whole FLOOR_WAIT=2 wait: refused after about 2 s; the failures line names the held port and its
# holder slot; waited_s >= 2. Protects: neither condition alone (port OR VRAM) clearing the gate —
# BOTH must hold, and a held port is waited out, not waved through.
body_t41 () {
  export CURL_MODELS=
  hold_port || { kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null; abad "T41 ephemeral listener up" "hold_port failed"; return 0; }
  local port; port=$HOLDER_PORT
  GATE_PORT=$port
  FLOOR_WAIT=2
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T41 refusal returned nonzero" "start_server returned 0"
  fi
  assert_contains "T41 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_contains "T41 refusal names the held gate port and its holder slot" "$RES/failures.txt" "port=$port held by"
  local waited
  waited=$(grep 'BOOT REFUSED' "$RES/failures.txt" | grep -o 'waited_s=[0-9]*' | head -1 | cut -d= -f2)
  if [ -n "$waited" ] && [ "$waited" -ge 2 ]; then aok "T41 waited_s=$waited >= 2"
  else abad "T41 waited_s >= 2" "waited_s='${waited:-<absent>}'"; fi
  kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
}
# t42 (+ port released during the wait, vLLM): the gate port is LISTEN-held but released after about
# 1 s (VRAM fine): the gate polls and passes once the port frees — serve start called once, no
# BOOT REFUSED line. Protects: the gate waiting out a transient port holder instead of refusing.
body_t42 () {
  export CURL_MODELS=
  hold_port || { kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null; abad "T42 ephemeral listener up" "hold_port failed"; return 0; }
  local port; port=$HOLDER_PORT
  GATE_PORT=$port
  FLOOR_WAIT=10
  ( sleep 1; kill "$HOLDER_PID" 2>/dev/null ) &
  local REL=$!
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T42 serve start failed as expected (fake rc=1)" "start_server returned 0"
  fi
  kill "$REL" 2>/dev/null; wait "$REL" 2>/dev/null
  kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null
  assert_count "$CALLS" '^serve-vllm start ' 1 "T42 gate passed after the port freed: serve start called once"
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 0 "T42 no BOOT REFUSED line"
}
# t43 (- invalid FLOOR_WAIT, fail closed): FLOOR_WAIT=abc, then FLOOR_WAIT=-1 (both invalid): the gate
# refuses without polling, and each BOOT REFUSED line names FLOOR_WAIT as invalid; no serve call.
# Protects: a garbage wait setting not being silently coerced to 0 or 90 — fail closed, and say so.
body_t43 () {
  export CURL_MODELS=
  FLOOR_WAIT=abc
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T43 (FLOOR_WAIT=abc) refusal returned nonzero" "start_server returned 0"
  fi
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 1 "T43 (abc) one BOOT REFUSED line"
  assert_contains "T43 (abc) refusal names FLOOR_WAIT" "$RES/failures.txt" 'FLOOR_WAIT'
  assert_contains "T43 (abc) refusal says invalid" "$RES/failures.txt" 'invalid'
  assert_count "$CALLS" '^serve-vllm' 0 "T43 (abc) no serve-script call"
  FLOOR_WAIT=-1
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T43 (FLOOR_WAIT=-1) refusal returned nonzero" "start_server returned 0"
  fi
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 2 "T43 (-1) second BOOT REFUSED line"
  assert_contains "T43 (-1) refusal names FLOOR_WAIT" "$RES/failures.txt" 'FLOOR_WAIT'
  assert_count "$CALLS" '^serve-vllm' 0 "T43 (-1) no serve-script call"
}
# t44 (+ radiance path wait): VRAM below the floor at t=0 (used 31000 MiB), freed to 1024 MiB by a
# background writer after about 1 s, FLOOR_WAIT=10: start_rad's gate polls and passes — serve-rad
# start called once. Protects: the radiance path getting the same wait behavior as the vLLM path (the
# serve_radiance.sh contract, not just serve_vllm.sh's).
body_t44 () {
  export CURL_MODELS=
  echo 32505856000 > "$DRM_ROOT/card0/device/mem_info_vram_used"   # used 31000 MiB (free 1768 < floor)
  ( sleep 1; echo 1073741824 > "$DRM_ROOT/card0/device/mem_info_vram_used" ) &
  local WRITER=$!
  FLOOR_WAIT=10
  if real_start_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0; then
    abad "T44 serve-rad start failed as expected (fake rc=1)" "start_rad returned 0"
  fi
  kill "$WRITER" 2>/dev/null; wait "$WRITER" 2>/dev/null
  assert_count "$CALLS" '^serve-rad start ' 1 "T44 gate passed after the wait: serve-rad start called once"
  assert_count "$RES/failures.txt" 'BOOT REFUSED' 0 "T44 no BOOT REFUSED line"
}
# t45 (- radiance path wait exhausted): VRAM stays below the floor (used 31000 MiB) through the whole
# FLOOR_WAIT=2 wait: start_rad refuses — BOOT REFUSED line; no serve-rad call, no sampler, no stop.
# Protects: the radiance path not booting into a card that never frees up during the wait.
body_t45 () {
  export CURL_MODELS=
  echo 32505856000 > "$DRM_ROOT/card0/device/mem_info_vram_used"   # used 31000 MiB (free 1768 < floor), stays there
  FLOOR_WAIT=2
  if real_start_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0; then
    abad "T45 refusal returned nonzero" "start_rad returned 0"
  fi
  assert_contains "T45 failures line BOOT REFUSED" "$RES/failures.txt" 'BOOT REFUSED'
  assert_count "$CALLS" '^serve-rad' 0 "T45 no serve-rad call on refusal"
  assert_count "$CALLS" '^sampler' 0 "T45 no sampler on refusal"
  assert_count "$CALLS" '^stop_' 0 "T45 no stop on refusal"
}
# t46 (-): an EARLIER boot of the same slug left a tail. No-overwrite rule (user 2026-11-11, supersedes the
# B2b overwrite): the earlier tail stays byte-identical and the refusal writes its own <slug>-boot2 tail.
body_t46 () {
  export CURL_MODELS=
  FLOOR_WAIT=0   # not a wait test (the gate's FLOOR_WAIT default is 90 s)
  FREE_MIB_FLOOR=31745   # free is 31744 (the fixture), so it refuses, as t33 does
  mkdir -p "$RAW"
  echo 'OLD_TAIL_T46 section from an earlier boot' > "$RAW/boot-kld-ref-fp8.txt"
  if real_start_server kld-ref-fp8 8192 fp8 0 1; then
    abad "T46 refusal returned nonzero" "start_server returned 0"
  fi
  if [ "$(cat "$RAW/boot-kld-ref-fp8.txt")" = 'OLD_TAIL_T46 section from an earlier boot' ]; then
    aok "T46 earlier tail kept byte-identical"
  else abad "T46 earlier tail kept byte-identical" "changed"; fi
  assert_contains "T46 refusal tail in its own -boot2 file" "$RAW/boot-kld-ref-fp8-boot2.txt" 'free_mib=31744'
}

# ---- compare round (2026-11-11): check 5, pairwise KLD, llama.cpp arm --------------------------
# t47 (-): a sly container with RADIANCE_LMHEAD_INT2=1 in its env -> no fetch, REFUSED line (check 5).
body_t47 () {
  export CURL_MODELS=
  export MOCK_DOCKER_ENV='PATH=/usr/bin\nRADIANCE_LMHEAD_FP8=1\nRADIANCE_LMHEAD_INT2=1'
  CURRENT_CONTAINER=vllm-8000; KLD_N=1
  real_kld_fetch qwen38-27b-redhat-mxfp4-dflash "$RES/kld-d.jsonl" "$IMAGE"
  assert_count "$CALLS" '^kld-fetch' 0 "T47 lmhead knob set -> no fetch"
  assert_contains "T47 refusal names the knob" "$RES/failures.txt" 'RADIANCE_LMHEAD_INT2=1'
  if grep -q 'RADIANCE_LMHEAD_FP8' "$RES/failures.txt"; then abad "T47 FP8 not named" "named"; else aok "T47 FP8 not named"; fi
}
# t48 (+): INT2 =0 and the full-row FP8/INT4 heads (arm D's profile, a real lm_head quantization — measured,
# not refused; 2026-11-11 first compare batch) -> the fetch runs (check 5 passes).
body_t48 () {
  export CURL_MODELS=
  export MOCK_DOCKER_ENV='PATH=/usr/bin\nRADIANCE_LMHEAD_INT2=0\nRADIANCE_LMHEAD_FP8=1\nRADIANCE_LMHEAD_INT4=1\nHIP_VISIBLE_DEVICES=0'
  CURRENT_CONTAINER=vllm-8000; KLD_N=1
  real_kld_fetch qwen38-27b-redhat-mxfp4-dflash "$RES/kld-d.jsonl" "$IMAGE"
  assert_count "$CALLS" '^kld-fetch' 1 "T48 knob =0 -> fetch runs"
  assert_count "$CALLS" '^docker inspect' 1 "T48 env read from the live container"
}
# t48b (-): docker inspect fails on a sly container -> unverifiable -> refused, no fetch.
body_t48b () {
  export CURL_MODELS=
  export MOCK_INSPECT_RC=1
  CURRENT_CONTAINER=vllm-8000; KLD_N=1
  real_kld_fetch qwen38-27b-redhat-mxfp4-dflash "$RES/kld-d.jsonl" "$IMAGE"
  assert_count "$CALLS" '^kld-fetch' 0 "T48b inspect failure -> no fetch"
  assert_contains "T48b refusal says unverifiable" "$RES/failures.txt" 'unverifiable'
}
# t48c (+): radiance / llama.cpp servers (no vllm container) are not inspected.
body_t48c () {
  export CURL_MODELS=
  CURRENT_CONTAINER=radiance-8000; KLD_N=1
  real_kld_fetch qwen38-27b-iq4r-l-v4 "$RES/kld-c.jsonl" "$IMG_RAD_BC"
  assert_count "$CALLS" '^docker inspect' 0 "T48c radiance not inspected"
  assert_count "$CALLS" '^kld-fetch' 1 "T48c radiance fetch runs"
}
# t49 (+/-): pairs over a, b (complete), c (errored row = incomplete) and the FP8 ref (complete):
# 3 names -> 6 ordered scores, c left out loudly, one matrix call, ref labelled fp8.
body_t49 () {
  export CURL_MODELS=
  mkdir -p "$RAW"
  mk_kld_ok "$RES/kld-a.jsonl" qwen38-27b-mxfp4 "$IMG_RAD_A"
  mk_kld_ok "$RES/kld-b.jsonl" qwen38-27b-mxfp4 "$IMG_RAD_BC"
  mk_kld_ok "$RES/kld-c.jsonl" qwen38-27b-iq4r-l-v4 "$IMG_RAD_BC"
  printf '%s\n' '{"id": "cal-001", "toks": [], "pos": [], "error": "boom"}' > "$RES/kld-c.jsonl"
  mk_kld_ok "$RAW/kld-ref.jsonl" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  mkdir -p "$RES/kld-pairs-20200101-000000.d"; echo earlier > "$RES/kld-pairs-20200101-000000.d/kld-pair-zz-vs-a.json"
  real_kld_score_pairs a b c
  assert_count "$CALLS" '^kld-score ' 6 "T49 6 ordered pair scores (a, b, fp8)"
  assert_count "$CALLS" '^kld-score .*--label c ' 0 "T49 incomplete c never scored"
  assert_count "$CALLS" '^kld-score .*--ref-label fp8 ' 2 "T49 fp8 is a reference twice"
  assert_count "$CALLS" '^kld-score .*--ref [^ ]*kld-b.jsonl .*--label a --ref-label b ' 1 "T49 a-vs-b: ref file and labels agree"
  assert_count "$CALLS" '^kld-matrix ' 1 "T49 one matrix call"
  assert_contains "T49 c left out loudly" "$RES/failures.txt" 'KLD PAIRS: c left out'
  if [ "$(cat "$RES/kld-pairs-20200101-000000.d/kld-pair-zz-vs-a.json")" = earlier ]; then aok "T49 earlier pass kept"; else abad "T49 earlier pass kept" "changed/removed"; fi
  local nd; nd=$(ls -d "$RES"/kld-pairs-*.d | wc -l)
  [ "$nd" -eq 2 ] && aok "T49 new pass in its own dir" || abad "T49 new pass in its own dir" "dirs=$nd"
  assert_count "$CALLS" '^kld-score .*--out [^ ]*/kld-pairs-[0-9-]*\.d/kld-pair-a-vs-b\.json' 1 "T49 pair written inside the new dir"
  if grep -q '^rm ' "$CALLS"; then abad "T49 no rm" "rm called"; else aok "T49 no rm"; fi
}
# t50 (-): one complete fetch only -> no score, no matrix, loud line.
body_t50 () {
  export CURL_MODELS=
  mk_kld_ok "$RES/kld-a.jsonl" qwen38-27b-mxfp4 "$IMG_RAD_A"
  real_kld_score_pairs a b
  assert_count "$CALLS" '^kld-score ' 0 "T50 no pair with one fetch"
  assert_count "$CALLS" '^kld-matrix ' 0 "T50 no matrix with one fetch"
  assert_contains "T50 loud line" "$RES/failures.txt" 'fewer than 2 complete fetches'
}
# t51 (+): real start_llama: serve_llamacpp.sh gets the pinned shape; CURRENT=llamacpp; a boots row.
body_t51 () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=0
  if real_start_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-q4kxl; then aok "T51 start returns 0"; else abad "T51 start returns 0" "nonzero"; fi
  assert_count "$CALLS" "^serve-llama start MODEL=$GGUF_Q4KXL LLAMA_SERVER=$LLAMA_BIN BACKEND=vulkan CTX=260000 NP=2 KV=q8_0 MTP=0 EXTRA_ARGS=--alias qwen38-27b-q4kxl\$" 1 "T51 pinned launch shape"
  [ "$CURRENT" = llamacpp ] && aok "T51 CURRENT=llamacpp" || abad "T51 CURRENT=llamacpp" "CURRENT='$CURRENT'"
  assert_contains "T51 boots row engine llamacpp" "$RES/boots.jsonl" '"engine": "llamacpp"'
  assert_contains "T51 server record names the gguf" "$RES/server-q4kxl.txt" "gguf=$GGUF_Q4KXL"
}
# t51b (+): LLAMA_CTX / LLAMA_NP override the launch shape (q8 arm: 27 GiB weights, ctx 32768, 1 seq).
body_t51b () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=0
  if LLAMA_CTX=32768 LLAMA_NP=1 real_start_llama q8 "$GGUF_Q4KXL" qwen38-27b-q8; then aok "T51b start returns 0"; else abad "T51b start returns 0" "nonzero"; fi
  assert_count "$CALLS" "^serve-llama start MODEL=$GGUF_Q4KXL LLAMA_SERVER=$LLAMA_BIN BACKEND=vulkan CTX=32768 NP=1 KV=q8_0 MTP=0 EXTRA_ARGS=--alias qwen38-27b-q8\$" 1 "T51b ctx/np override reaches serve_llamacpp.sh"
}
# t52 (-): a failed llama boot -> SERVER-FAILED + tail + stop_llama, nonzero.
body_t52 () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=1
  if real_start_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-q4kxl; then abad "T52 start fails" "returned 0"; else aok "T52 start fails"; fi
  assert_contains "T52 SERVER-FAILED line" "$RES/failures.txt" 'SERVER-FAILED: llama.cpp arm q4kxl'
  assert_count "$CALLS" '^stop_llama' 1 "T52 stop after failure"
  [ -f "$RAW/boot-q4kxl.txt" ] && aok "T52 boot tail written" || abad "T52 boot tail written" "absent"
}
# t52b (-): boot gate refuses (VRAM floor) -> no serve-llama call at all.
body_t52b () {
  export CURL_MODELS=
  FLOOR_WAIT=0; FREE_MIB_FLOOR=31745
  if real_start_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-q4kxl; then abad "T52b refused" "returned 0"; else aok "T52b refused"; fi
  assert_count "$CALLS" '^serve-llama' 0 "T52b no serve call on refusal"
}
# t53 (+): arm_llama order: start -> residency -> selftest(llamacpp) -> fetch (build as key) -> cells -> stop.
body_t53 () {
  export CURL_MODELS=
  export ONLY='q4kxl-10k-tg512-n1'
  touch "$RAW/done/kld-selftest-llamacpp"
  arm_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-q4kxl
  local seq; seq=$(grep -oE '^(start_llama|residency_check|kld_selftest|kld_fetch|eb-run|stop_llama)' "$CALLS" | tr '\n' ' ')
  if [ "$seq" = "start_llama residency_check kld_selftest kld_fetch eb-run stop_llama " ]; then aok "T53 order"; else abad "T53 order" "got '$seq'"; fi
  assert_count "$CALLS" '^kld_selftest llamacpp qwen38-27b-q4kxl' 1 "T53 selftest family llamacpp"
  assert_count "$CALLS" "^kld_fetch qwen38-27b-q4kxl $RES/kld-q4kxl.jsonl $(readlink -f "$LLAMA_BIN")\$" 1 "T53 fetch keyed by the resolved build"
}
# t53b (-): selftest failed (no marker) -> no fetch, cells still run.
body_t53b () {
  export CURL_MODELS=
  export ONLY='q4kxl-10k-tg512-n1'
  arm_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-q4kxl
  assert_count "$CALLS" '^kld_fetch' 0 "T53b no fetch without a passed selftest"
  assert_count "$CALLS" 'eb-run q4kxl-10k-tg512-n1' 1 "T53b cells still run"
}
# t53c (-): missing gguf -> PIN-FAIL, no boot.
body_t53c () {
  export CURL_MODELS=
  export ONLY='q4kxl-10k-tg512-n1'
  arm_llama q4kxl "$scratch/absent.gguf" qwen38-27b-q4kxl
  assert_count "$CALLS" '^start_llama' 0 "T53c no boot on missing gguf"
  assert_contains "T53c PIN-FAIL" "$RES/failures.txt" 'PIN-FAIL: llama.cpp arm q4kxl'
}
# t54 (+): the EXIT trap dispatch stops a llama server via stop_llama, not the vllm stop.
body_t54 () {
  export CURL_MODELS=
  CURRENT=llamacpp; real_stop_current
  assert_count "$CALLS" '^stop_llama' 1 "T54 llamacpp -> stop_llama"
  assert_count "$CALLS" '^stop_server' 0 "T54 no vllm stop"
}

# T55 (compare round 2026-11-11): run-compare.sh end to end, hermetic — ARMS="c c0 q4kxl": three boots in
# order, the default ONLY cells, a KLD fetch per arm, then all 6 ordered pair scores + one matrix.
runcompare () {
  if [ -n "${GATING_ONLY:-}" ] && ! [[ " $GATING_ONLY " == *" t55 "* ]]; then return 0; fi
  local scratch; scratch=$(mktemp -d "$TMP_BASE/t55.XXXXXX"); SCRATCHES+=("$scratch")
  mkdir -p "$scratch/inputs" "$scratch/stubbin" "$scratch/fake" "$scratch/state" "$scratch/drm/card0/device"
  cp -r "$CAMPAIGN/inputs/." "$scratch/inputs/"
  : > "$scratch/calls.log"
  local gate_port; gate_port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  printf '%s\n' '#!/usr/bin/env bash' 'echo "docker $*" >> "$CALLS"' \
    'case "${1:-}" in images) printf "%s\n" stilldeadcode/radiance:1.11.0 stilldeadcode/radiance:1.17.0 ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 ;; esac' \
    'exit 0' > "$scratch/stubbin/docker"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "curl $*" >> "$CALLS"' 'exit 0' > "$scratch/stubbin/curl"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "amd-smi $*" >> "$CALLS"' 'exit 0' > "$scratch/stubbin/amd-smi"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-rad $* EXTRA_ARGS=${EXTRA_ARGS:-}" >> "$CALLS"' 'exit 0' > "$scratch/fake/serve-rad.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-vllm $*" >> "$CALLS"' 'exit 1' > "$scratch/fake/serve-vllm.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-llama $* MODEL=${MODEL:-} EXTRA_ARGS=${EXTRA_ARGS:-}" >> "$CALLS"' 'exit 0' > "$scratch/fake/serve-llama.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$scratch/fake/llama-server"
  echo gguf > "$scratch/fake.gguf"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "eb-run $SLUG" >> "$CALLS"' 'exit 0' > "$scratch/fake/run.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "sampler $*" >> "$CALLS"' 'exit 0' > "$scratch/fake/sampler.sh"
  # fake KLD: logs the call, writes one clean row to --out; a fetch also writes the REAL cache key
  # (kld_probe.py cache-key), so kld_complete — and with it kld_score_pairs — treats it as complete
  cat > "$scratch/fake/kld.py" <<'PY2'
import os, subprocess, sys
a = sys.argv[1:]
with open(os.environ["CALLS"], "a") as f:
    f.write("kld-" + a[0] + " " + " ".join(a[1:]) + "\n")
def opt(k):
    return a[a.index(k) + 1] if k in a else None
if "--out" in a:
    with open(opt("--out"), "w") as f:
        f.write('{"id": "cal-001", "toks": ["x"], "pos": [], "error": null}\n')
if a[0] == "fetch":
    cmd = [sys.executable, os.environ["REAL_KLD"], "cache-key", "--calibration", opt("--calibration"), "--model", opt("--model")]
    for k in ("--limit", "--image"):
        if opt(k) is not None:
            cmd += [k, opt(k)]
    with open(opt("--out") + ".key.json", "w") as f:
        f.write(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout)
PY2
  echo 1073741824 > "$scratch/drm/card0/device/mem_info_vram_used"
  echo 34359738368 > "$scratch/drm/card0/device/mem_info_vram_total"
  chmod +x "$scratch/stubbin/"* "$scratch/fake/"*.sh "$scratch/fake/llama-server"
  ( cd "$scratch" && env PATH="$scratch/stubbin:$PATH" CALLS="$scratch/calls.log" CAMPAIGN_DIR="$scratch" \
      RUN_TAG=gate-t55 ARMS='c c0 q4kxl' KLD_N=1 SERVER_STATE_DIR="$scratch/state" \
      SERVE_RAD="$scratch/fake/serve-rad.sh" SERVE_VLLM="$scratch/fake/serve-vllm.sh" SERVE_LLAMA="$scratch/fake/serve-llama.sh" \
      LLAMA_BIN="$scratch/fake/llama-server" GGUF_Q4KXL="$scratch/fake.gguf" EB="$scratch/fake" \
      KLD="$scratch/fake/kld.py" REAL_KLD="$(cd "$CAMPAIGN/../../.." && pwd)/bench/perf/kld_probe.py" KLD_URL="http://127.0.0.1:9/v1" \
      BOOT_VRAM_SAMPLER="$scratch/fake/sampler.sh" DRM_ROOT="$scratch/drm" VLLM_CACHE_ROOT="$scratch/vllm-cache" \
      GATE_PORT="$gate_port" bash "$CAMPAIGN/run-compare.sh" ) > "$scratch/out.log" 2>&1
  local rc=$? res="$scratch/tmp/runs/gate-t55/results" seq want n
  _t55 () { if [ "$2" = "$3" ]; then echo "ok T55 $1"; PASS=$((PASS+1)); else echo "FAIL T55 $1 :: got '$2' want '$3'"; FAIL=$((FAIL+1)); fi; }
  _t55 "run-compare.sh exits 0" "$rc" 0
  [ "$rc" -eq 0 ] || tail -8 "$scratch/out.log" | sed 's/^/  /'
  seq=$(grep -oE '^serve-(rad|llama) start' "$scratch/calls.log" | tr '\n' ',')
  _t55 "boot order rad, rad, llama" "$seq" "serve-rad start,serve-rad start,serve-llama start,"
  _t55 "llama alias" "$(grep -c "^serve-llama start MODEL=$scratch/fake.gguf EXTRA_ARGS=--alias qwen38-27b-ud-q4kxl\$" "$scratch/calls.log")" 1
  want="c-10k-tg512-n1,c-100k-tg512-n1,c0-10k-tg512-n1,c0-100k-tg512-n1,q4kxl-10k-tg512-n1,q4kxl-100k-tg512-n1,"
  _t55 "default cells, arm order" "$(grep -oE '^eb-run .*' "$scratch/calls.log" | cut -d' ' -f2 | tr '\n' ',')" "$want"
  _t55 "one fetch per arm" "$(grep -c '^kld-fetch ' "$scratch/calls.log")" 3
  _t55 "6 ordered pair scores" "$(grep -c '^kld-score .*--ref-label ' "$scratch/calls.log")" 6
  _t55 "one matrix" "$(grep -c '^kld-matrix ' "$scratch/calls.log")" 1
  _t55 "no FP8 reference boot by default" "$(grep -c '^serve-vllm start' "$scratch/calls.log")" 0
  n=$(ls "$res"/kld-pairs-*.d/kld-pair-q4kxl-vs-c.json 2>/dev/null | wc -l)
  _t55 "pair file written" "$n" 1
}

# t56 (-): no-overwrite on a RE-BOOT of the same slug (user 2026-11-11 — the resume re-boots arm D for its
# KLD fetch): sly, radiance and llama.cpp each boot twice; the first boot's records stay byte-identical and
# the second boot writes <slug>-boot2 files; boots.jsonl gets 2 rows per engine (append).
body_t56 () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=0
  local f sum1 sum2
  real_start_server d-redhat-sly1100 260000 fp8 0 2 >/dev/null
  real_start_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 >/dev/null
  real_start_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl >/dev/null
  sum1=$(cat "$RES/server-d-redhat-sly1100.txt" "$RES/server-c.txt" "$RES/server-q4kxl.txt" "$RAW/boot-c-vram.csv" | md5sum)
  real_start_server d-redhat-sly1100 260000 fp8 0 2 >/dev/null
  real_start_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 >/dev/null
  real_start_llama q4kxl "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl >/dev/null
  sum2=$(cat "$RES/server-d-redhat-sly1100.txt" "$RES/server-c.txt" "$RES/server-q4kxl.txt" "$RAW/boot-c-vram.csv" | md5sum)
  [ "$sum1" = "$sum2" ] && aok "T56 first-boot records byte-identical" || abad "T56 first-boot records byte-identical" "changed"
  for f in "$RES/server-d-redhat-sly1100-boot2.txt" "$RES/server-c-boot2.txt" "$RES/server-q4kxl-boot2.txt" \
           "$RAW/boot-d-redhat-sly1100-boot2-vram.csv" "$RAW/boot-c-boot2-vram.csv" "$RAW/boot-q4kxl-boot2-vram.csv"; do
    [ -e "$f" ] && aok "T56 $(basename "$f")" || abad "T56 $(basename "$f")" "absent"
  done
  assert_count "$RES/boots.jsonl" '"slug": "c-boot2"' 1 "T56 boots row slug c-boot2"
  assert_count "$RES/boots.jsonl" '"arm": "c"' 2 "T56 both c boots keep arm c"
  assert_count "$RES/boots.jsonl" '' 6 "T56 6 boots rows (append)"
}
# t57 (-): kld_score_all never rewrites an existing score.
body_t57 () {
  export CURL_MODELS=
  mkdir -p "$RAW"
  mk_kld_ok "$RAW/kld-ref.jsonl" qwen38-27b-fp8 "$KLD_REF_IMAGE"
  mk_kld_ok "$RES/kld-a.jsonl" qwen38-27b-mxfp4 "$IMG_RAD_A"
  mk_kld_ok "$RES/kld-b.jsonl" qwen38-27b-mxfp4 "$IMG_RAD_BC"
  echo earlier > "$RES/kld-a.json"
  real_kld_score_all
  [ "$(cat "$RES/kld-a.json")" = earlier ] && aok "T57 kld-a.json kept" || abad "T57 kld-a.json kept" "rewritten"
  assert_count "$CALLS" '^kld-score .*--label a ' 0 "T57 a not re-scored"
  assert_count "$CALLS" '^kld-score .*--label b ' 1 "T57 b scored"
}
# t58 (-): a re-run selftest after an earlier (failed) one writes a new -2 JSON, the earlier JSON stays.
body_t58 () {
  export CURL_MODELS=
  echo '{"earlier": true}' > "$RES/kld-selftest-llamacpp.json"
  real_kld_selftest llamacpp qwen38-27b-ud-q4kxl
  [ "$(cat "$RES/kld-selftest-llamacpp.json")" = '{"earlier": true}' ] && aok "T58 earlier selftest kept" || abad "T58 earlier selftest kept" "rewritten"
  assert_count "$CALLS" "^kld-selftest .*--out $RES/kld-selftest-llamacpp-2.json" 1 "T58 new selftest -2"
}

# --- forced batch (2026-11-12, user: "option B teacher-forced", KLD_N=128, 32 positions, q8 f16 baseline) ---
# t59 (+): KLD_FORCED_REF set -> kld_fetch runs `forced` against that reference (positions, limit, image),
# never the greedy `fetch`; a GREEDY-keyed cache of the same file is not reused (mode differs).
body_t59 () {
  export CURL_MODELS=
  mk_kld_ok "$RES/kld-q8.jsonl" qwen38-27b-q8 /fake/llama-server
  mk_kld_ok "$RES/kld-a.jsonl" qwen38-27b-mxfp4 "$IMG_RAD_A"      # greedy cache: must NOT count
  KLD_FORCED_REF="$RES/kld-q8.jsonl"
  CURRENT=radiance   # as start_rad leaves it: kld_engine pins --engine from the server that is up (2026-11-13)
  real_kld_fetch qwen38-27b-mxfp4 "$RES/kld-a.jsonl" "$IMG_RAD_A"
  assert_count "$CALLS" "^kld-forced --url $KLD_URL --model qwen38-27b-mxfp4 --engine radiance --calibration $KLD_CAL --ref $RES/kld-q8.jsonl --positions 32 --repo-root $ROOT --out $RES/kld-a.jsonl --limit 1 --image $IMG_RAD_A\$" 1 "T59 forced fetch shape"
  assert_count "$CALLS" '^kld-fetch ' 0 "T59 no greedy fetch in forced mode"
}
# t59b (-): the reference is incomplete (absent) -> refused loudly, no forced call.
body_t59b () {
  export CURL_MODELS=
  KLD_N=1; KLD_FORCED_REF="$RES/kld-q8.jsonl"
  real_kld_fetch qwen38-27b-mxfp4 "$RES/kld-a.jsonl" "$IMG_RAD_A"
  assert_count "$CALLS" '^kld-forced ' 0 "T59b no forced fetch without a complete reference"
  assert_contains "T59b loud line" "$RES/failures.txt" 'KLD FORCED REFUSED: qwen38-27b-mxfp4'
}
# t59c (+): a complete FORCED cache keyed to this reference is reused (no call); forced key built by the real tool.
body_t59c () {
  export CURL_MODELS=
  mk_kld_ok "$RES/kld-q8.jsonl" qwen38-27b-q8 /fake/llama-server
  printf '%s\n' '{"id": "cal-001", "mode": "forced", "error": null}' > "$RES/kld-a.jsonl"
  python3 "$ROOT/bench/perf/kld_probe.py" cache-key --calibration "$KLD_CAL" --limit 1 --model qwen38-27b-mxfp4 \
    --image "$IMG_RAD_A" --forced-ref "$RES/kld-q8.jsonl" --positions 32 > "$RES/kld-a.jsonl.key.json"
  KLD_FORCED_REF="$RES/kld-q8.jsonl"
  real_kld_fetch qwen38-27b-mxfp4 "$RES/kld-a.jsonl" "$IMG_RAD_A"
  assert_count "$CALLS" '^kld-' 0 "T59c complete forced cache reused"
  # and a CHANGED reference invalidates it (ref_sha256 in the key)
  echo '{"id": "cal-001", "toks": ["y"], "pos": [], "error": null}' > "$RES/kld-q8.jsonl"
  real_kld_fetch qwen38-27b-mxfp4 "$RES/kld-a.jsonl" "$IMG_RAD_A"
  assert_count "$CALLS" '^kld-forced ' 1 "T59c changed reference -> re-fetch"
}
# t60 (+): LLAMA_KV / LLAMA_MTP reach serve_llamacpp.sh (q8 f16 baseline; q4mtp MTP=1 diagnostic).
body_t60 () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=0
  LLAMA_KV=f16 LLAMA_CTX=32768 LLAMA_NP=1 real_start_llama q8 "$GGUF_Q4KXL" qwen38-27b-q8 >/dev/null
  LLAMA_MTP=1 real_start_llama q4mtp "$GGUF_Q4KXL" qwen38-27b-ud-q4kxl-mtp >/dev/null
  assert_count "$CALLS" "^serve-llama start .* CTX=32768 NP=1 KV=f16 MTP=0 EXTRA_ARGS=--alias qwen38-27b-q8\$" 1 "T60 q8 f16 KV"
  assert_count "$CALLS" "^serve-llama start .* CTX=260000 NP=2 KV=q8_0 MTP=1 EXTRA_ARGS=--alias qwen38-27b-ud-q4kxl-mtp\$" 1 "T60 MTP=1"
}
# t60b (+): KLD_ONLY=1 boots an arm with no selected cells for its KLD fetch; without it the arm is skipped.
body_t60b () {
  export CURL_MODELS=
  export ONLY='none'
  touch "$RAW/done/kld-selftest-llamacpp"
  arm_llama q8f "$GGUF_Q4KXL" qwen38-27b-q8
  assert_count "$CALLS" '^start_llama' 0 "T60b no boot without KLD_ONLY"
  KLD_ONLY=1 arm_llama q8f "$GGUF_Q4KXL" qwen38-27b-q8
  assert_count "$CALLS" '^start_llama q8f' 1 "T60b KLD_ONLY boots"
  assert_count "$CALLS" "^kld_fetch qwen38-27b-q8 $RES/kld-q8f.jsonl" 1 "T60b KLD_ONLY fetches"
  assert_count "$CALLS" '^eb-run' 0 "T60b KLD_ONLY runs no cells"
}
# t60c (+): the new sly diagnostic boots — d0 (no DFlash) and dfh (no DFlash, full-precision lm head) use
# their own profiles + served names with arm D's starter extras; boots.jsonl arms d0 / dfh.
body_t60c () {
  export CURL_MODELS=
  export FAKE_SERVE_RC=0
  real_start_server d0-redhat-sly1100 110000 fp8 0 2 >/dev/null
  real_start_server dfh-redhat-sly1100 8192 fp8 0 1 >/dev/null
  assert_contains "T60c d0 profile" "$CALLS" 'serve-vllm start IMAGE='
  [ "$(grep -c '^serve-vllm start' "$CALLS")" -eq 2 ] && aok "T60c two starts" || abad "T60c two starts" "$(grep -c '^serve-vllm start' "$CALLS")"
  assert_contains "T60c d0 arm" "$RES/boots.jsonl" '"arm": "d0"'
  assert_contains "T60c dfh arm" "$RES/boots.jsonl" '"arm": "dfh"'
  assert_contains "T60c d0 served" "$RES/boots.jsonl" '"served": "qwen38-27b-redhat-mxfp4-sly"'
  assert_contains "T60c dfh served" "$RES/boots.jsonl" '"served": "qwen38-27b-redhat-mxfp4-fullhead"'
}

# t63 (+): DIAG_ARMS: an arm in the list gets a second, GREEDY fetch of DIAG_N prompts -> kld-<arm>-greedy.jsonl,
# and a finished arm whose diag fetch is missing is NOT skipped (a resume re-boots for it).
body_t63 () {
  export CURL_MODELS=
  export ONLY='c-10k-tg512-n1'
  touch "$RAW/done/kld-selftest-radiance" "$RAW/done/c-10k-tg512-n1"
  mk_kld_ok "$RES/kld-c.jsonl" qwen38-27b-iq4r-l-v4 "$IMG_RAD_BC"
  DIAG_ARMS='c'; DIAG_N=1
  real_kld_fetch () { :; }
  kld_fetch () { echo "kld_fetch $* forced=${KLD_FORCED_REF:-none} n=$KLD_N" >> "$CALLS"; }
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^start_rad c ' 1 "T63 missing diag fetch -> boot"
  assert_count "$CALLS" "^kld_fetch qwen38-27b-iq4r-l-v4 $RES/kld-c-greedy.jsonl $IMG_RAD_BC forced=none n=1\$" 1 "T63 greedy diag fetch"
  : > "$CALLS"; DIAG_ARMS=''
  arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
  assert_count "$CALLS" '^start_rad' 0 "T63 no diag wanted + all done -> skip"
}
# t63b (-): preflight checks EVERY calibration*.sha256: a changed v2 prompt file fails the pins.
body_t63b () {
  export CURL_MODELS=
  echo '{"id": "tampered"}' >> "$CAMPAIGN_DIR/inputs/calibration-v2-prompts.jsonl"
  if ( preflight ) > "$scratch/pf.txt" 2>&1; then abad "T63b preflight fails" "passed"; else aok "T63b preflight fails"; fi
  assert_contains "T63b names the v2 pin" "$scratch/pf.txt" 'PIN-FAIL: calibration-v2.sha256 mismatch'
}

# T62: run-forced.sh end to end, hermetic — ARMS="q8 q8f c q4kxl q4mtp", DIAG_ARMS="c q4kxl", DEPTH cells, calibration
# v2, q8 greedy reference first, then forced fetches vs it, greedy diag fetches, the q4mtp-vs-q4kxl diag pair.
runforced () {
  if [ -n "${GATING_ONLY:-}" ] && ! [[ " $GATING_ONLY " == *" t62 "* ]]; then return 0; fi
  local scratch; scratch=$(mktemp -d "$TMP_BASE/t62.XXXXXX"); SCRATCHES+=("$scratch")
  mkdir -p "$scratch/inputs" "$scratch/stubbin" "$scratch/fake" "$scratch/state" "$scratch/drm/card0/device"
  cp -r "$CAMPAIGN/inputs/." "$scratch/inputs/"
  : > "$scratch/calls.log"
  local real_kld; real_kld="$(cd "$CAMPAIGN/../../.." && pwd)/bench/perf/kld_probe.py"
  local gate_port; gate_port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  printf '%s\n' '#!/usr/bin/env bash' 'echo "docker $*" >> "$CALLS"' \
    'case "${1:-}" in images) printf "%s\n" stilldeadcode/radiance:1.11.0 stilldeadcode/radiance:1.17.0 ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1 ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1 ;; esac' \
    'exit 0' > "$scratch/stubbin/docker"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "curl $*" >> "$CALLS"' 'exit 0' > "$scratch/stubbin/curl"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "amd-smi $*" >> "$CALLS"' 'exit 0' > "$scratch/stubbin/amd-smi"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-rad $* EXTRA_ARGS=${EXTRA_ARGS:-}" >> "$CALLS"' 'exit 0' > "$scratch/fake/serve-rad.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-vllm $*" >> "$CALLS"' 'exit 1' > "$scratch/fake/serve-vllm.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "serve-llama $* KV=${KV:-} CTX=${CTX:-} NP=${NP:-} MTP=${MTP:-} EXTRA_ARGS=${EXTRA_ARGS:-}" >> "$CALLS"' 'exit 0' > "$scratch/fake/serve-llama.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$scratch/fake/llama-server"
  echo gguf > "$scratch/fake.gguf"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "eb-run $SLUG" >> "$CALLS"' 'exit 0' > "$scratch/fake/run.sh"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "sampler $*" >> "$CALLS"' 'exit 0' > "$scratch/fake/sampler.sh"
  # fake KLD: logs the call, writes one clean row to --out; fetch/forced also write the REAL cache key
  cat > "$scratch/fake/kld.py" <<'PY3'
import os, subprocess, sys
a = sys.argv[1:]
with open(os.environ["CALLS"], "a") as f:
    f.write("kld-" + a[0] + " " + " ".join(a[1:]) + "\n")
def opt(k):
    return a[a.index(k) + 1] if k in a else None
if "--out" in a:   # one clean row for the FIRST prompt of the calibration in use (v1 cal-001, v2 cal2-001)
    import json
    pid = json.loads(open(opt("--calibration")).readline())["id"] if opt("--calibration") else "cal-001"
    with open(opt("--out"), "w") as f:
        f.write(json.dumps({"id": pid, "toks": ["x"], "pos": [], "error": None}) + "\n")
if a[0] in ("fetch", "forced"):
    cmd = [sys.executable, os.environ["REAL_KLD"], "cache-key", "--calibration", opt("--calibration"), "--model", opt("--model")]
    for k in ("--limit", "--image"):
        if opt(k) is not None:
            cmd += [k, opt(k)]
    if a[0] == "forced":
        cmd += ["--forced-ref", opt("--ref"), "--positions", opt("--positions")]
    with open(opt("--out") + ".key.json", "w") as f:
        f.write(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout)
PY3
  echo 1073741824 > "$scratch/drm/card0/device/mem_info_vram_used"
  echo 34359738368 > "$scratch/drm/card0/device/mem_info_vram_total"
  chmod +x "$scratch/stubbin/"* "$scratch/fake/"*.sh "$scratch/fake/llama-server"
  ( cd "$scratch" && env PATH="$scratch/stubbin:$PATH" CALLS="$scratch/calls.log" CAMPAIGN_DIR="$scratch" \
      RUN_TAG=gate-t62 ARMS='q8 q8f c q4kxl q4mtp' DIAG_ARMS='c q4kxl' KLD_N=1 DIAG_N=1 SERVER_STATE_DIR="$scratch/state" \
      SERVE_RAD="$scratch/fake/serve-rad.sh" SERVE_VLLM="$scratch/fake/serve-vllm.sh" SERVE_LLAMA="$scratch/fake/serve-llama.sh" \
      LLAMA_BIN="$scratch/fake/llama-server" GGUF_Q4KXL="$scratch/fake.gguf" GGUF_Q8="$scratch/fake.gguf" EB="$scratch/fake" \
      KLD="$scratch/fake/kld.py" REAL_KLD="$real_kld" KLD_URL="http://127.0.0.1:9/v1" \
      BOOT_VRAM_SAMPLER="$scratch/fake/sampler.sh" DRM_ROOT="$scratch/drm" VLLM_CACHE_ROOT="$scratch/vllm-cache" \
      GATE_PORT="$gate_port" bash "$CAMPAIGN/run-forced.sh" ) > "$scratch/out.log" 2>&1
  local rc=$? res="$scratch/tmp/runs/gate-t62/results" calls="$scratch/calls.log"
  _t62 () { if [ "$2" = "$3" ]; then echo "ok T62 $1"; PASS=$((PASS+1)); else echo "FAIL T62 $1 :: got '$2' want '$3'"; FAIL=$((FAIL+1)); fi; }
  _t62 "run-forced.sh exits 0" "$rc" 0
  [ "$rc" -eq 0 ] || tail -8 "$scratch/out.log" | sed 's/^/  /'
  _t62 "boot order q8, q8f, c, q4kxl, q4mtp" "$(grep -oE '^serve-(rad|llama) start|--alias [a-z0-9-]+' "$calls" | tr '\n' ',')" \
    "serve-llama start,--alias qwen38-27b-q8,serve-llama start,--alias qwen38-27b-q8,serve-rad start,serve-llama start,--alias qwen38-27b-ud-q4kxl,serve-llama start,--alias qwen38-27b-ud-q4kxl-mtp,"
  _t62 "q8 + q8f: f16 KV, ctx 32768, 1 seq" "$(grep -c '^serve-llama start .*KV=f16 CTX=32768 NP=1 MTP=0 EXTRA_ARGS=--alias qwen38-27b-q8$' "$calls")" 2
  _t62 "q4mtp: MTP=1, q8_0 KV, the q4kxl shape" "$(grep -c '^serve-llama start .*KV=q8_0 CTX=260000 NP=2 MTP=1 ' "$calls")" 1
  _t62 "depth cells in order" "$(grep -oE '^eb-run .*' "$calls" | cut -d' ' -f2 | tr '\n' ',')" \
    "q8-10k-tg512-n1,q8-20k-tg512-n1,c-10k-tg512-n1,c-20k-tg512-n1,c-50k-tg512-n1,c-100k-tg512-n1,q4kxl-10k-tg512-n1,q4kxl-20k-tg512-n1,q4kxl-50k-tg512-n1,q4kxl-100k-tg512-n1,"
  _t62 "greedy fetches: q8, c diag, q4kxl diag, q4mtp" "$(grep -oE '^kld-fetch .*--out [^ ]+' "$calls" | grep -oE 'kld-[a-z0-9-]+\.jsonl' | tr '\n' ',')" "kld-q8.jsonl,kld-c-greedy.jsonl,kld-q4kxl-greedy.jsonl,kld-q4mtp.jsonl,"
  _t62 "every KLD call on calibration v2" "$(grep -E '^kld-(fetch|forced) ' "$calls" | grep -vc 'calibration-v2-prompts.jsonl')" 0
  _t62 "forced fetches vs q8: q8f, c, q4kxl" "$(grep -c "^kld-forced .*--ref $res/kld-q8.jsonl " "$calls")" 3
  _t62 "forced scores: q8f, c, q4kxl" "$(grep -c "^kld-score-forced --ref $res/kld-q8.jsonl " "$calls")" 3
  _t62 "diag pair q4mtp vs q4kxl greedy" "$(grep -c "^kld-score --ref $res/kld-q4kxl-greedy.jsonl --arm $res/kld-q4mtp.jsonl " "$calls")" 1
  _t62 "absent diag pairs are not failures" "$(grep -c 'KLD DIAG SKIPPED' "$res/failures.txt" 2>/dev/null || true)" 0
  _t62 "no arm-vs-arm greedy matrix" "$(grep -c '^kld-matrix ' "$calls")" 0
}

# ================================================================================
scenario t1
scenario t2
scenario t3
scenario t4
scenario t5
scenario t6
scenario t7
scenario t8
scenario t9
scenario t10
scenario t10b
scenario t11
scenario t11b
scenario t12
scenario t13
scenario t13b
scenario t16
scenario t16b
scenario t16c
scenario t14
scenario t14b
scenario t14c
scenario t15
scenario t17
scenario t17b
scenario t18
scenario t18b
scenario t19
scenario t19b
scenario t20
scenario t21
scenario t23
scenario t23b
scenario t23c
scenario t24
scenario t24b
scenario t24c
scenario t24d
scenario t25
scenario t25b
scenario t26
scenario t27
scenario t28
scenario t29
scenario t30
scenario t31
scenario t32
scenario t33
scenario t34
scenario t35
scenario t36
scenario t37
scenario t38
scenario t39
scenario t40
scenario t41
scenario t42
scenario t43
scenario t44
scenario t45
scenario t46
scenario t47
scenario t48
scenario t48b
scenario t48c
scenario t49
scenario t50
scenario t51
scenario t51b
scenario t52
scenario t52b
scenario t53
scenario t53b
scenario t53c
scenario t54
scenario t56
scenario t57
scenario t58
scenario t59
scenario t59b
scenario t59c
scenario t60
scenario t60b
scenario t60c
scenario t63
scenario t63b
runarm_c0
runcompare
runforced
echo
if [ "$FAIL" -eq 0 ]; then
  echo "run.sh gating tests: $PASS OK"
else
  echo "run.sh gating tests: $FAIL FAILED ($PASS ok)"
  exit 1
fi
