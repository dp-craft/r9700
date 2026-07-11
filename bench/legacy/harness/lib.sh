#!/usr/bin/env bash
# Shared helpers + VRAM/RAM safety guard.

vram_used_mb() { rocm-smi --showmeminfo vram 2>/dev/null | awk '/Used Memory/{printf "%.0f",$NF/1048576}'; }
host_avail_mb() { awk '/MemAvailable/{printf "%.0f",$2/1024}' /proc/meminfo; }

# wait_http URL TIMEOUT_S  -> 0 if healthy, 1 if timed out
wait_http() {
  local url="$1" to="${2:-300}" i
  for ((i=0;i<to;i+=2)); do
    curl -s -o /dev/null -w '%{http_code}' -m 3 "$url" 2>/dev/null | grep -q 200 && return 0
    sleep 2
  done
  return 1
}

# Safety guard: kills $killcmd if VRAM free < 350MB or host avail < 900MB.
# Prevents the whole-machine freeze seen on VRAM/RAM exhaustion.
# NB: stdout/stderr of the backgrounded subshell MUST be redirected away from the
# caller's command-substitution pipe, else `g=$(start_guard ...)` hangs waiting for
# EOF that never comes while the guard loop keeps fd 1 open (classic bash gotcha).
start_guard() {
  local killcmd="$1" log="$2"
  ( : > "$log"
    for ((i=0;i<1200;i++)); do
      local vu ha vfree
      vu=$(vram_used_mb); ha=$(host_avail_mb)
      vfree=$(( 32603 - ${vu:-0} ))   # ~31.86GiB total
      echo "$(date +%T) vram_used=${vu}MB vram_free=${vfree}MB host_avail=${ha}MB" >> "$log"
      if [ "${vfree:-9999}" -lt 350 ] || [ "${ha:-9999}" -lt 900 ]; then
        echo "GUARD-KILL vfree=$vfree host_avail=$ha" >> "$log"; eval "$killcmd" >> "$log" 2>&1; break
      fi
      sleep 2
    done ) >/dev/null 2>&1 &
  echo $!
}
