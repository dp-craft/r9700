# Unit-test brief — the four `start_*` server starters + serve_vllm.sh stop paths

Hand this whole file to the test-writing subagent. It contains the requirements, the API
surface, and what to test — NOT an implementation.

## Context

Repo: /home/dev/work/dp-craft/amd (branch `restructure`). Four starters, all taking
`start|stop|status|logs` (bad/missing arg → usage on stderr, exit 2):

1. `stack/serve/vllm/start_redhat_27b.sh` — RedHatAI 27B vLLM server (profile
   `sly-redhat/redhat-mxfp4-dflash`, container `vllm-$PORT`, port from
   `settings-redhat.json`, default 8000).
2. `stack/serve/vllm/start_heretic_27b.sh` — heretic 27B vLLM server (profile
   `sly-official/heretic-mxfp4`, container `vllm-$PORT`, port from `settings.json`, default 8000).
3. `stack/serve/radiance/start_ornith_35b_vllm_rad.sh` — native Radiance serving Ornith 35B
   (container `radiance-$PORT`, port/model from `settings-redhat.json`, default 8000;
   checkpoint dir `$MODEL_DIR` must contain `ornith-1.5-35b-a3b-w4a8.rad`;
   `AMD_ROOT` (default /home/dev/work/dp-craft/amd) locates `stack/gpu/gpu_exclusive.sh`).
4. `stack/llama-swap/start_llama_swap.sh` — llama-swap router on :9292 (pidfile
   `~/.config/llama-swap/var/logs/llama-swap.pid`; subcommands `start|stop|status|restart`;
   bad arg → usage exit 1).

`serve_vllm.sh` (shared by 1+2) env knobs: `PORT`, `PROFILE`, `MAXLEN`, `MAXSEQS`, `KV_DTYPE`,
`WATCHDOG_MIB`, `GPU_UTIL`, `EXCLUSIVE` (path to a fake gpu_exclusive.sh — the unit-test hook;
start-mode only), `CONTAINER_NAME` (default `vllm-$PORT`). State files under
`stack/serve/var/servers/<port>.{container,cmdline,log}` (gitignored).

Root/dp-forge/~.config copies are **symlinks** to the canonicals (see the "symlink integrity"
section below).

## HARD CONSTRAINTS (violating any of these breaks the machine)

- **NEVER touch port 8000** — the user's ACTIVE server (this very Claude session runs on it).
  No start/stop/status probes against 8000, no `docker ps --filter publish=8000` kills, nothing.
- **NO GPU work**: every `serve_vllm.sh start` must use `EXCLUSIVE=<stub>` where the stub exits 1
  ("free-VRAM floor refused (unit test)"), so start aborts BEFORE `docker run`.
  (The ornith starter has NO EXCLUSIVE hook — its `gpu_exclusive.sh` is called directly; test it
  only on paths that exit BEFORE that call: usage, port-busy, checkpoint-missing. See below.)
- Test ports only: **19995–19999**, each freed before use (`ss -ltn | grep :PORT` must be empty).
- Dummy containers: `python3 -m http.server` in the local image
  `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` (already on disk), e.g.
  `docker run -d --name vllm-19997 -p 127.0.0.1:19997:8001 --entrypoint python3 $IMAGE -m http.server 8001`.
  ALWAYS `docker rm -f` every dummy in a `trap cleanup EXIT`.
- Follow the existing pattern: `stack/serve/vllm/tests/serve_vllm_test.sh` — bash, PASS/FAIL
  counters, `check() { ...; } ok/bad`, `script(1)` for TTY cases, single test file exits 0 iff
  all pass. Total runtime < ~3 min. No GPU sample, no amd-smi in hot loops.
- Do not edit anything outside `stack/serve/vllm/tests/` (new test file(s) there) and
  `stack/serve/radiance/tests/` if the subagent wants a second file for the ornith starter —
  its choice; one file is fine.

## What to test (the API surface)

### A. Symlink integrity (no docker, no GPU)
- Each of: `/home/dev/work/dp-craft/amd/start_{redhat_27b,heretic_27b,ornith_35b_vllm_rad,llama_swap}.sh`,
  `/home/dev/work/dippe/dp-forge/start_{redhat_27b,heretic_27b,ornith_35b_vllm_rad}.sh`,
  `/home/dev/work/dippe/dp-forge/{vllm.sh,vllm-heretic.sh}`,
  `/home/dev/.config/claude/local_vllm_direct/{vllm.sh,vllm-heretic.sh,ornith_rad_mtp.sh}`
  resolves (readlink -f) to the correct canonical file in /home/dev/work/dp-craft/amd, and
  `sha256sum` of the resolved file equals the canonical's.

### B. serve_vllm.sh stop paths (the reported bug — top priority)
Use dummy containers on fresh test ports; invoke `serve_vllm.sh stop` with `PORT=<test port>`:
1. **No container, port free** → exit 0, stderr+stdout contains `no container vllm-<port>`.
   (Also: pre-create a stale `stack/serve/var/servers/<port>.container` file → it is removed.)
2. **Own container** (dummy named `vllm-<port>` holding the port) → container removed,
   port free, message `stopped vllm-<port> (log kept: ...)`, exit 0, and the `<port>.container`
   state file is gone, `<port>.log` exists (log captured).
3. **Foreign container** (dummy named `other-<port>` publishing the port, no `vllm-<port>`
   container) → exit 1, message names the holder: `port <port> is still held by: container(s) other-<port>`,
   plus the hint "stop it with ITS starter"; the foreign container is NOT killed.
4. **Foreign raw pid** (no container at all; `python3 -m http.server <port>` host process on
   127.0.0.1) → exit 1, message names the pid (or "unknown — ss -ltnp" fallback). Kill the
   host process in cleanup. (This is the "I needed to restart it as root" scenario: the tool must
   at least NAME the holder loudly instead of silently saying "no container".)
5. **The stuck-rm path** (docker rm hangs) — cannot be unit-tested reliably; SKIP, but assert
   the timeout wiring exists: `grep -q 'timeout 60 docker rm -f' serve_vllm.sh`.

### C. Starter-level behavior (each starter, both via canonical path and via ONE symlink per
   starter to prove no-cd operation from another cwd — run with `cwd=/tmp` so BASH_SOURCE
   resolution is exercised through the link)
1. `badarg` → usage line on stderr, exit 2 (llama starter: exit 1 — test that specifically).
2. **redhat**: `status` on port 8000 is NOT allowed (constraint). Instead: `PORT=<test port>`
   with port free → `stop` path delegates (covered by B). For the starter itself: verify the
   pre-boot name check — run `start` on a FREE test port with `EXCLUSIVE=stub` and the real
   profile: name check must PASS (served name == settings' ANTHROPIC_MODEL), then the start
   aborts at the exclusive stub (exit 1, stub message). If the stub is honored, assert the
   abort message contains `exclusive-stub` — proof the whole pre-boot chain ran.
3. **heretic**: same shape, but the name check must FAIL (profile serves `swift-1.5`,
   settings.json wants `qwen38-27b-redhat-mxfp4-dflash`) → exit 2 with
   `profile sly-official/heretic-mxfp4 serves 'swift-1.5' but settings.json ANTHROPIC_MODEL is
   'qwen38-27b-redhat-mxfp4-dflash' -- fix one of them`, and NOTHING else ran (no docker,
   no exclusive call — verify no `vllm-<port>` container was created).
   Also: `SERVED_NAME=qwen38-27b-redhat-mxfp4-dflash start` (the user's real override) →
   name check PASSES, then aborts at the exclusive stub (exit 1, stub message).
4. **ornith** (no EXCLUSIVE hook — test only paths that exit before `gpu_exclusive.sh`):
   - `PORT=8000 start` is FORBIDDEN (port 8000 active) — instead `PORT=<test port> start` with
     default `MODEL_DIR` → the checkpoint file IS present (it is the real path), so it would
     proceed to gpu_exclusive — DO NOT run that. Use `MODEL_DIR=/tmp/emptydir` → exit 1,
     `checkpoint missing in /tmp/emptydir`, and assert no container `radiance-<port>` was created
     and no `stack/serve/var/servers/<port>.*` file appeared.
   - `PORT=19995 start` where 19995 is held by a dummy → exit 1 `port 19995 is in use -- stop that server first`.
   - `stop` with `radiance-<port>` not existing and port free → exit 0, quiet (no error); with a
     dummy `radiance-<port>` holding the port → container removed, port free, exit 0.
   - `logs` with no container → non-zero exit, no crash (docker logs error is fine).
   - `status` with no container → prints empty docker-ps line + empty curl, exit 0 (document
     actual behavior; assert it does not crash).
5. **llama starter**: `status` and `stop` while NOT running → `not running`, exit 0.
   (Do NOT start it — it would grab VRAM from the live 8000 server. `restart`/`start` are
   out of scope for unit tests.)
   - `badarg` → usage, exit 1.

### D. Regression: existing test still passes
Run `bash stack/serve/vllm/tests/serve_vllm_test.sh` unchanged (it owns port 19999; if your
test file uses 19999, pick another). All T1–T9 must still PASS after this session's
serve_vllm.sh stop changes. If any fails, report it — do not fix serve_vllm.sh.

## Deliverables

- New file(s) under `stack/serve/vllm/tests/` (e.g. `starters_test.sh`) — executable,
  self-contained, PASS/FAIL summary line + exit code.
- Run them. Report: pass/fail counts, the full summary lines, any FAIL verbatim, and the
  docker/rm artifacts your cleanup left behind (should be none).
- Do NOT commit. Do NOT modify any file outside the tests/ dir(s).
