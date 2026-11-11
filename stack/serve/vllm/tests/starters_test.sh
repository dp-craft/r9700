#!/usr/bin/env bash
# starters_test.sh — unit tests (NO GPU) for the four start_* starters + serve_vllm.sh stop paths:
#   A. symlink integrity: repo-root, dp-forge and ~/.config/claude/local_vllm_direct copies resolve
#      (readlink -f) to the canonical amd-repo files, content sha256 equal
#   B. serve_vllm.sh stop paths (the reported bug — top priority):
#        B1 no container + free port   -> exit 0, "no container", stale state file removed
#        B2 own container holding port -> removed, log kept, exit 0, state file gone
#        B3 foreign container          -> exit 1, holder named + "stop it with ITS starter" hint,
#                                         foreign container NOT killed
#        B4 foreign raw pid            -> exit 1, pid (or the documented ss -ltnp fallback) named,
#                                         holder NOT killed
#        B5 stuck-rm (docker rm hang)  -> cannot be unit-tested; assert the timeout wiring exists
#   C. starter-level behavior (usage; pre-boot aborts; stop/status/logs), incl. no-cd operation
#      via the repo-root symlinks with cwd=/tmp
#   D. regression: the existing serve_vllm_test.sh still passes (it owns port 19999)
#
# Safety (brief's hard constraints):
#   * port 8000 (the user's ACTIVE server) is never started/stopped — only READ (ss, docker inspect,
#     and the one /v1/models GET that serve_vllm.sh itself does in its instance check); the pre-test
#     snapshot of its state is asserted unchanged after every start test
#   * NO GPU work: every serve_vllm.sh start here uses EXCLUSIVE=<stub> (exits 1), so it aborts
#     BEFORE docker run; the ornith starter has no EXCLUSIVE hook, so only its pre-gpu_exclusive
#     paths are exercised (usage, port-busy, checkpoint-missing, stop, status, logs)
#   * llama-swap is never started (it would grab VRAM from the live server) — status/stop/badarg only
#   * test ports 19995–19998 only, each pre-checked free; 19999 belongs to serve_vllm_test.sh
#   * dummy containers = python3 http.server in the local image; EVERY dummy is docker rm -f'd by
#     the trap cleanup, together with all state files this test creates
#
# Like serve_vllm_test.sh: bash, PASS/FAIL counters, exit 0 iff all pass. Ports are fixed (no
# overrides); total runtime < ~3 min. Run: bash stack/serve/vllm/tests/starters_test.sh
set -u
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
VD="$(cd "$HERE/.." && pwd)"                # stack/serve/vllm
REPO="$(cd "$VD/../../.." && pwd)"          # /home/dev/work/dp-craft/amd
SERVE="$VD/serve_vllm.sh"
RUNDIR="$REPO/stack/serve/var/servers"

C_RED="$VD/start_redhat_27b.sh"
C_HER="$VD/start_heretic_27b.sh"
C_ORN="$REPO/stack/serve/radiance/start_ornith_35b_vllm_rad.sh"
C_LLAMA="$REPO/stack/llama-swap/start_llama_swap.sh"

IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1       # dummy-container image (= sly-redhat's image)
HERETIC_IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.8.1-rocm10.1   # sly-official's image (heretic start)
SERVED_REDHAT=qwen38-27b-redhat-mxfp4-dflash   # ANTHROPIC_MODEL in settings-redhat.json (2026-11-09: settings.json carries the heretic served name swift-1.5)

P1=19995   # B1 (stop: no container) + the ornith stop/start cases
P2=19996   # B2 (stop: own container)
P3=19997   # B3 (stop: foreign container)
P4=19998   # B4 (stop: foreign raw pid)

mkdir -p "$REPO/tmp"
TMP=$(mktemp -d -p "$REPO/tmp")
MDIR=$(mktemp -d -p "$REPO/tmp")   # empty dir -> ornith "checkpoint missing"
STUB="$TMP/exclusive_stub.sh"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
echo "exclusive-stub: free-VRAM floor refused (unit test -- no GPU)"
exit 1
EOF
chmod +x "$STUB"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }   # literal substring check (parens safe)

cleanup() {
  docker rm -f "vllm-$P2" "other-$P3" "radiance-$P1" >/dev/null 2>&1
  [ -n "${HOSTPID:-}" ] && kill "$HOSTPID" 2>/dev/null
  for p in "$P1" "$P2" "$P3" "$P4"; do
    rm -f "$RUNDIR/$p.container" "$RUNDIR/$p.cmdline" "$RUNDIR/$p.watchdog" "$RUNDIR/$p.log"
  done
  rm -rf "$TMP" "$MDIR"
}
trap cleanup EXIT

port_held()         { ss -ltn | grep -q ":$1 "; }
container_exists()  { docker inspect "$1" >/dev/null 2>&1; }
container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }

start_dummy() {   # <name> <port> — dummy "server": python3 http.server holding <port> (no GPU)
  local name=$1 port=$2
  docker rm -f "$name" >/dev/null 2>&1
  docker run -d --name "$name" -p "127.0.0.1:$port:8001" --entrypoint python3 "$IMAGE" -m http.server 8001 >/dev/null || return 1
  for _ in $(seq 20); do port_held "$port" && return 0; sleep 1; done
  return 1
}

# ------------------------------ pre-checks ------------------------------
command -v script >/dev/null || { echo "needs script(1) (util-linux)" >&2; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "needs local image $IMAGE (docker pull $IMAGE)" >&2; exit 2; }
for p in "$P1" "$P2" "$P3" "$P4" 19999; do
  port_held "$p" && { echo "test port $p is held -- free it first" >&2; exit 2; }
done
for f in "$SERVE" "$C_RED" "$C_HER" "$C_ORN" "$C_LLAMA"; do
  [ -f "$f" ] || { echo "missing script: $f" >&2; exit 2; }
done
# deterministic start: clear state files of the test ports from earlier runs (NEVER 8000)
for p in "$P1" "$P2" "$P3" "$P4"; do
  rm -f "$RUNDIR/$p.container" "$RUNDIR/$p.cmdline" "$RUNDIR/$p.watchdog" "$RUNDIR/$p.log"
done

# snapshot of the ACTIVE server (port 8000): asserted unchanged after every start test
P8000_HELD=0; port_held 8000 && P8000_HELD=1
V8000_UP=0;   container_running vllm-8000 && V8000_UP=1

assert_8000_unchanged() {   # $1 = test label — the active server must survive every start test
  local h=0; port_held 8000 && h=1
  if [ "$h" -eq "$P8000_HELD" ]; then ok "$1 port 8000 hold state unchanged"; else bad "$1 port 8000 hold state CHANGED"; fi
  if [ "$V8000_UP" -eq 1 ]; then
    container_running vllm-8000 && ok "$1 vllm-8000 still running" || bad "$1 vllm-8000 STOPPED"
  fi
}

# ================= A. symlink integrity (no docker, no GPU) =================
check_link() {   # <path> <expected canonical (absolute)>
  local p=$1 want=$2 got
  [ -L "$p" ] || { bad "A $p is not a symlink"; return; }
  [ -e "$p" ] || { bad "A $p is a broken symlink"; return; }
  got=$(readlink -f "$p")
  [ "$got" = "$want" ] || { bad "A $p resolves to $got (want $want)"; return; }
  [ "$(sha256sum "$p" | cut -d' ' -f1)" = "$(sha256sum "$want" | cut -d' ' -f1)" ] || { bad "A $p content differs from $want"; return; }
  ok "A $p -> ${want#"$REPO"/}"
}
# 2026-11-09 (D7): the installed launcher set is the 12 dp_-prefixed links of the managed scripts
# (stack/serve/install.sh) — checked in the repo root and dp-forge. The legacy prefix-less links are
# migrated away by the installer. The ~/.config/claude/local_vllm_direct aliases (vllm.sh /
# vllm-heretic.sh / ornith_rad_mtp.sh) are NOT in the managed set — checked as-is, never touched by
# install/uninstall.
managed_links() {   # <target-dir> — the 12 dp_ links install.sh manages
  local dir=$1 n want
  for n in start_ornith_35b_vllm_rad.sh start_qwen38_27b_iq4r-l-v4_rad.sh start_heretic_27b.sh start_redhat_27b.sh \
           claude-rad-mxfp4.sh claude-rad-iq4rlv4.sh claude-rad-iq4rlv4-dflash.sh claude-rad-iq4rlv4-nospec.sh \
           claude-rad-heretic.sh claude-sly-redhat.sh claude-sly-heretic.sh claude-sly-amd.sh; do
    case "$n" in
      start_ornith*|start_qwen38*) want="$REPO/stack/serve/radiance/$n";;
      start_*)                    want="$REPO/stack/serve/vllm/$n";;
      *)                          want="$REPO/clients/claude/$n";;
    esac
    check_link "$dir/dp_$n" "$want"
  done
}
echo "== A: symlink integrity (managed dp_ set in repo root + dp-forge; legacy aliases as-is) =="
managed_links "$REPO"
managed_links /home/dev/work/dippe/dp-forge
check_link "$REPO/start_llama_swap.sh"                 "$C_LLAMA"   # not managed — out of scope
check_link /home/dev/work/dippe/dp-forge/vllm.sh              "$C_RED"
check_link /home/dev/work/dippe/dp-forge/vllm-heretic.sh      "$C_HER"
check_link /home/dev/.config/claude/local_vllm_direct/vllm.sh         "$C_RED"
check_link /home/dev/.config/claude/local_vllm_direct/vllm-heretic.sh "$C_HER"
check_link /home/dev/.config/claude/local_vllm_direct/ornith_rad_mtp.sh "$C_ORN"

# ================= B. serve_vllm.sh stop paths (the reported bug) =================
echo "== B1: stop, no container + free port -> exit 0, 'no container', stale state file removed =="
docker rm -f "vllm-$P1" >/dev/null 2>&1
printf 'stale\n' > "$RUNDIR/$P1.container"
OUT=$(PORT=$P1 bash "$SERVE" stop 2>&1); rc=$?
has "$OUT" "no container vllm-$P1" && ok "B1 'no container' message" || bad "B1 message (got: $OUT)"
[ "$rc" -eq 0 ] && ok "B1 exit 0" || bad "B1 rc=$rc"
[ ! -e "$RUNDIR/$P1.container" ] && ok "B1 stale state file removed" || bad "B1 stale state file still present"

echo "== B2: stop, own container holding the port -> removed, log kept, exit 0, state gone =="
if start_dummy "vllm-$P2" "$P2"; then
  OUT=$(PORT=$P2 bash "$SERVE" stop 2>&1); rc=$?
  has "$OUT" "stopped vllm-$P2 (log kept:" && ok "B2 'stopped' message" || bad "B2 message (got: $OUT)"
  [ "$rc" -eq 0 ] && ok "B2 exit 0" || bad "B2 rc=$rc"
  container_exists "vllm-$P2" && bad "B2 container still exists" || ok "B2 container removed"
  port_held "$P2" && bad "B2 port still held" || ok "B2 port free"
  [ ! -e "$RUNDIR/$P2.container" ] && ok "B2 state file gone" || bad "B2 state file still present"
  [ -f "$RUNDIR/$P2.log" ] && ok "B2 log captured" || bad "B2 log missing"
else bad "B2 dummy container did not come up"; fi

echo "== B3: stop, foreign container on the port -> exit 1 names the holder; foreign NOT killed =="
if start_dummy "other-$P3" "$P3"; then
  OUT=$(PORT=$P3 bash "$SERVE" stop 2>&1); rc=$?
  has "$OUT" "no container vllm-$P3" && ok "B3 'no container' part" || bad "B3 (got: $OUT)"
  has "$OUT" "still held by: container(s) other-$P3" && ok "B3 names the foreign container" || bad "B3 holder not named (got: $OUT)"
  has "$OUT" "stop it with ITS starter" && ok "B3 hint present" || bad "B3 hint missing (got: $OUT)"
  [ "$rc" -eq 1 ] && ok "B3 exit 1" || bad "B3 rc=$rc"
  container_running "other-$P3" && ok "B3 foreign container NOT killed" || bad "B3 foreign container WAS killed"
else bad "B3 dummy container did not come up"; fi

echo "== B4: stop, foreign raw pid on the port -> exit 1 names the pid (or ss fallback); holder NOT killed =="
docker rm -f "vllm-$P4" >/dev/null 2>&1
python3 -m http.server "$P4" --bind 127.0.0.1 >/dev/null 2>&1 &
HOSTPID=$!
for _ in $(seq 10); do port_held "$P4" && break; sleep 1; done
if ! port_held "$P4"; then bad "B4 host process did not bind port $P4"; HOSTPID=""; fi
if [ -n "${HOSTPID:-}" ]; then
  OUT=$(PORT=$P4 bash "$SERVE" stop 2>&1); rc=$?
  has "$OUT" "no container vllm-$P4" && ok "B4 'no container' part" || bad "B4 (got: $OUT)"
  has "$OUT" "still held by:" && ok "B4 holder named" || bad "B4 holder not named (got: $OUT)"
  { has "$OUT" "pid(s) $HOSTPID" || has "$OUT" "unknown — ss -ltnp"; } && ok "B4 pid (or documented ss fallback) in message" || bad "B4 neither pid $HOSTPID nor ss fallback (got: $OUT)"
  [ "$rc" -eq 1 ] && ok "B4 exit 1" || bad "B4 rc=$rc"
  kill -0 "$HOSTPID" 2>/dev/null && ok "B4 foreign process NOT killed" || bad "B4 foreign process WAS killed"
fi

echo "== B5: stuck-rm path — timeout wiring exists (a docker rm hang cannot be unit-tested) =="
grep -q 'timeout 60 docker rm -f' "$SERVE" && ok "B5 'timeout 60 docker rm -f' present" || bad "B5 timeout wiring missing"

# ================= C. starter-level behavior =================
echo "== C1: redhat starter — badarg -> usage on stderr, exit 2 =="
OUT=$(bash "$C_RED" badarg 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "C1 exit 2" || bad "C1 rc=$rc"
{ has "$OUT" "usage:" && has "$OUT" "start|stop|status|logs"; } && ok "C1 usage line" || bad "C1 usage missing (got: $OUT)"

echo "== C2: redhat starter — start: name check PASSES, pre-boot abort (no docker run), claude never launched =="
OUT=$(EXCLUSIVE=$STUB bash "$C_RED" start </dev/null 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "C2 aborted pre-boot (rc=1)" || bad "C2 rc=$rc (got: $OUT)"
has "$OUT" "serves '" && bad "C2 name check must PASS (mismatch: $OUT)" || ok "C2 name check passed (no mismatch)"
if [ "$P8000_HELD" -eq 1 ]; then
  has "$OUT" "stop it first (PORT=8000" && ok "C2 aborted at the live-instance refusal (port 8000 active)" || bad "C2 expected live-instance refusal (got: $OUT)"
else
  has "$OUT" "exclusive-stub" && ok "C2 aborted at the exclusive stub" || bad "C2 expected exclusive-stub abort (got: $OUT)"
fi
has "$OUT" "ready: claude" && bad "C2 reached the claude launch" || ok "C2 claude session never launched"
assert_8000_unchanged C2
if [ "$V8000_UP" -eq 0 ]; then
  container_exists vllm-8000 && bad "C2 vllm-8000 container appeared (docker run must not have run)" || ok "C2 no container created (abort before docker run)"
fi

echo "== C3: heretic starter — badarg -> usage, exit 2 =="
OUT=$(bash "$C_HER" badarg 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "C3 exit 2" || bad "C3 rc=$rc"
has "$OUT" "usage:" && ok "C3 usage line" || bad "C3 usage missing (got: $OUT)"

echo "== C4: heretic starter — start: name check FAILS (swift-1.5 vs redhat model), exit 2, nothing else ran =="
# 2026-11-09: the real settings.json now carries the heretic served name (swift-1.5 — the approved rename;
# the name check exists to catch exactly this drift), so the mismatch arm is built from a copy of
# settings-redhat.json (model qwen38-...): same drift, deterministic, the real file untouched.
cp /home/dev/.config/claude/local_vllm_direct/settings-redhat.json "$TMP/settings.json"
OUT=$(SETTINGS="$TMP/settings.json" bash "$C_HER" start </dev/null 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "C4 exit 2" || bad "C4 rc=$rc (got: $OUT)"
has "$OUT" "profile sly-official/heretic-mxfp4 serves 'swift-1.5' but settings.json ANTHROPIC_MODEL is '$SERVED_REDHAT' -- fix one of them" \
  && ok "C4 exact name-mismatch message" || bad "C4 message (got: $OUT)"
assert_8000_unchanged C4

echo "== C5: heretic starter — start with SERVED_NAME override: name check PASSES, pre-boot abort =="
OUT=$(SERVED_NAME="$SERVED_REDHAT" SETTINGS="$TMP/settings.json" EXCLUSIVE=$STUB AUTO_PULL=0 bash "$C_HER" start </dev/null 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "C5 aborted pre-boot (rc=1)" || bad "C5 rc=$rc (got: $OUT)"
has "$OUT" "serves '" && bad "C5 name check must PASS with the override (got: $OUT)" || ok "C5 name check passed (SERVED_NAME override honored)"
if ! docker image inspect "$HERETIC_IMAGE" >/dev/null 2>&1; then
  has "$OUT" "image not present" && ok "C5 aborted at the image check (AUTO_PULL=0)" || bad "C5 (got: $OUT)"
elif [ "$P8000_HELD" -eq 1 ]; then
  has "$OUT" "stop it first (PORT=8000" && ok "C5 aborted at the live-instance refusal (port 8000 active)" || bad "C5 (got: $OUT)"
else
  has "$OUT" "exclusive-stub" && ok "C5 aborted at the exclusive stub" || bad "C5 (got: $OUT)"
fi
has "$OUT" "ready: claude" && bad "C5 reached the claude launch" || ok "C5 claude session never launched"
assert_8000_unchanged C5
if [ "$V8000_UP" -eq 0 ]; then
  container_exists vllm-8000 && bad "C5 vllm-8000 container appeared (docker run must not have run)" || ok "C5 no container created (abort before docker run)"
fi

echo "== C6: ornith starter (no EXCLUSIVE hook — only pre-gpu_exclusive paths) =="
OUT=$(bash "$C_ORN" badarg 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "C6a exit 2" || bad "C6a rc=$rc"
has "$OUT" "usage:" && ok "C6a usage line" || bad "C6a usage missing (got: $OUT)"

OUT=$(PORT=$P1 MODEL_DIR="$MDIR" bash "$C_ORN" start 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "C6b exit 1" || bad "C6b rc=$rc (got: $OUT)"
has "$OUT" "checkpoint missing in $MDIR" && ok "C6b checkpoint-missing message" || bad "C6b message (got: $OUT)"
STATE_OK=1
container_exists "radiance-$P1" && STATE_OK=0
for f in container cmdline log watchdog; do [ ! -e "$RUNDIR/$P1.$f" ] || STATE_OK=0; done
[ "$STATE_OK" -eq 1 ] && ok "C6b no container created, no state file appeared" || bad "C6b container/state side effect"

OUT=$(PORT=$P1 bash "$C_ORN" stop 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "C6c stop (no container, free port) exit 0" || bad "C6c rc=$rc (got: $OUT)"
[ -z "$OUT" ] && ok "C6c stop silent" || bad "C6c stop not silent (got: $OUT)"

OUT=$(PORT=$P1 bash "$C_ORN" logs 2>&1); rc=$?
[ "$rc" -ne 0 ] && ok "C6d logs (no container) non-zero exit (docker logs error, no crash)" || bad "C6d rc=$rc"

OUT=$(PORT=$P1 bash "$C_ORN" status 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "C6e status (no container) exit 0, no crash" || bad "C6e rc=$rc (got: $OUT)"

if start_dummy "radiance-$P1" "$P1"; then
  OUT=$(PORT=$P1 bash "$C_ORN" start 2>&1); rc=$?
  [ "$rc" -eq 1 ] && ok "C6f start on busy port exit 1" || bad "C6f rc=$rc (got: $OUT)"
  has "$OUT" "port $P1 is in use -- stop that server first" && ok "C6f port-busy message" || bad "C6f message (got: $OUT)"
  container_running "radiance-$P1" && ok "C6f dummy untouched" || bad "C6f dummy was touched"
  OUT=$(PORT=$P1 bash "$C_ORN" stop 2>&1); rc=$?
  [ "$rc" -eq 0 ] && ok "C6g stop (dummy holding port) exit 0" || bad "C6g rc=$rc (got: $OUT)"
  [ -z "$OUT" ] && ok "C6g stop silent" || bad "C6g stop not silent (got: $OUT)"
  container_exists "radiance-$P1" && bad "C6g dummy still exists" || ok "C6g container removed"
  port_held "$P1" && bad "C6g port still held" || ok "C6g port free"
else bad "C6f dummy container did not come up"; fi

echo "== C7: llama-swap starter — status/stop while not running, badarg (exit 1, not 2) =="
OUT=$(bash "$C_LLAMA" badarg 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "C7a badarg exit 1" || bad "C7a rc=$rc"
has "$OUT" "usage:" && has "$OUT" "[start|stop|status|restart]" && ok "C7a usage line" || bad "C7a usage missing (got: $OUT)"

LLAMA_UP=0
LPIDFILE="$HOME/.config/llama-swap/var/logs/llama-swap.pid"
if [ -f "$LPIDFILE" ]; then
  LPID=$(cat "$LPIDFILE" 2>/dev/null)
  [ -n "${LPID:-}" ] && kill -0 "$LPID" 2>/dev/null && LLAMA_UP=1
fi
OUT=$(bash "$C_LLAMA" status 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "C7b status exit 0" || bad "C7b rc=$rc (got: $OUT)"
if [ "$LLAMA_UP" -eq 1 ]; then
  has "$OUT" "running (pid" && ok "C7b status reports running (it is)" || bad "C7b (got: $OUT)"
else
  has "$OUT" "not running" && ok "C7b status says not running" || bad "C7b (got: $OUT)"
fi
if [ "$LLAMA_UP" -eq 0 ]; then
  OUT=$(bash "$C_LLAMA" stop 2>&1); rc=$?
  [ "$rc" -eq 0 ] && ok "C7c stop (not running) exit 0" || bad "C7c rc=$rc (got: $OUT)"
  has "$OUT" "not running" && ok "C7c stop says not running" || bad "C7c (got: $OUT)"
else
  ok "C7c stop SKIPPED (llama-swap is running — the unit test must not stop it)"
fi

echo "== C8: no-cd operation via the repo-root symlinks (dp_ set), cwd=/tmp =="
OUT=$(cd /tmp && bash "$REPO/dp_start_redhat_27b.sh" badarg 2>&1); rc=$?
[ "$rc" -eq 2 ] && has "$OUT" "usage:" && ok "C8a redhat badarg via symlink" || bad "C8a rc=$rc (got: $OUT)"
OUT=$(cd /tmp && bash "$REPO/dp_start_heretic_27b.sh" badarg 2>&1); rc=$?
[ "$rc" -eq 2 ] && has "$OUT" "usage:" && ok "C8b heretic badarg via symlink" || bad "C8b rc=$rc (got: $OUT)"
OUT=$(cd /tmp && bash "$REPO/dp_start_ornith_35b_vllm_rad.sh" badarg 2>&1); rc=$?
[ "$rc" -eq 2 ] && has "$OUT" "usage:" && ok "C8c ornith badarg via symlink" || bad "C8c rc=$rc (got: $OUT)"
OUT=$(cd /tmp && PORT=$P1 MODEL_DIR="$MDIR" bash "$REPO/dp_start_ornith_35b_vllm_rad.sh" start 2>&1); rc=$?
[ "$rc" -eq 1 ] && has "$OUT" "checkpoint missing in $MDIR" && ok "C8d ornith start via symlink reaches the checkpoint check (no-cd)" || bad "C8d rc=$rc (got: $OUT)"
OUT=$(cd /tmp && bash "$REPO/start_llama_swap.sh" status 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "C8e llama-swap status via symlink exit 0" || bad "C8e rc=$rc (got: $OUT)"

# ================= D. regression: existing test still passes =================
echo "== D: existing serve_vllm_test.sh still passes (it owns port 19999) =="
OUT=$(bash "$HERE/serve_vllm_test.sh" 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  ok "D serve_vllm_test.sh exit 0 ($(echo "$OUT" | grep -o '[0-9]\+ passed, [0-9]\+ failed' | head -1))"
else
  bad "D serve_vllm_test.sh FAILED (rc=$rc)"
  echo "$OUT" | tail -15 >&2
fi

echo
echo "starters_test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
