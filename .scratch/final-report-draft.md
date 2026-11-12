# Report — unified `start_*` server starters + vllm stop-bug fix

## What was broken (and now fixed)

1. **Ornith starter missing in `~/.config/claude` and dp-forge** — it only existed as a
   tracked file inside the amd repo (`stack/serve/radiance/ornith_rad_mtp.sh`). Now:
   canonical at `stack/serve/radiance/start_ornith_35b_vllm_rad.sh`, symlinked from
   dp-forge root, amd root, and `~/.config/claude/local_vllm_direct/` (as `ornith_rad_mtp.sh`).
2. **Ornith's git-root lookup broke under symlinks** — `git rev-parse --show-toplevel` from a
   copy/symlink in `~/.config` (itself a git repo) resolved to `~/.config`, so `gpu_exclusive.sh`
   was "not found" (exit 127) whenever the script was run from outside the amd repo. Now an
   explicit `AMD_ROOT` (default `/home/dev/work/dp-craft/amd`).
3. **Ornith banner showed the 27B name** — it is an *alias* (Ornith serves under the 27B's model
   name so the shared `settings-redhat.json` works unchanged; you said keep the settings). The
   banner now says so explicitly instead of hiding it.
4. **`vllm.sh` dead line** — a `claude --settings … --verbose` line ran after EVERY invocation
   (including stop/status). Moved into the start branch only.
5. **THE stop bug you reported** (had to kill as root / old `stop` worked): four defects in
   `serve_vllm.sh stop`, all fixed:
   - it only managed containers named `vllm-$PORT` — a port held by another container
     (e.g. `radiance-8000` from Ornith) → "no container" and **silently did nothing**;
   - it printed "stopped" (false success) even when the port was still held;
   - `docker rm -f` had no timeout — a GPU process wedged in the driver (D-state) hung the stop
     forever → your root/reboot escalation;
   - start-mode takeover SIGKILL'd foreign containers (no graceful stop).
   New behavior: stop names the actual holder (container or pid) and **fails loudly** if it
   cannot free the port; `docker rm -f` is bounded (60 s) with a "GPU may need a reboot" hint;
   stale state files are cleaned; takeover is graceful-first (`docker stop -t 60`, docker
   escalates itself). This matches what you remembered: stop says what to run, and it works.

## What you asked for (deliverables)

- **Four starters, unified `start_` prefix, `start|stop|status|logs`:**
  | starter | what it runs | where |
  |---|---|---|
  | `start_redhat_27b.sh` | RedHatAI Qwen3.8-27B-MXFP4 + DFlash2 (was `vllm.sh`) | amd `stack/serve/vllm/`, amd root, dp-forge root, `~/.config/claude/local_vllm_direct/vllm.sh` (symlink) |
  | `start_heretic_27b.sh` | heretic Qwen3.8-27B MXFP4 (was `vllm-heretic.sh`) | same four places |
  | `start_ornith_35b_vllm_rad.sh` | native Radiance, Ornith 1.5-35B-A3B w4a8 (was `ornith_rad_mtp.sh`) | amd `stack/serve/radiance/`, amd root, dp-forge root, `~/.config/.../ornith_rad_mtp.sh` (symlink) |
  | `start_llama_swap.sh` | llama-swap router :9292, default model = 27B unsloth Q4_K_XL row | amd `stack/llama-swap/`, amd root (dp-forge root already had it) |
- **No `cd` needed**: everything is invoked by absolute path / symlink; `AMD_ROOT` makes the
  radiance starter independent of where it's linked from.
- **Settings files**: untouched, as ordered. dp-forge legacy `vllm.sh`/`vllm-heretic.sh` kept as
  repointed symlinks (an old campaign script references `$FORGE/vllm.sh`).
- **Unit tests**: subagent wrote `stack/serve/vllm/tests/starters_test.sh` (no GPU, ports
  19995-19999, dummy containers; requirements in `.scratch/starters-test-brief.md`).
  Result: [FILL IN — pass/fail counts, failures verbatim].

## Interpretation decisions (flagged for you)

- "llama starter" = `start_llama_swap.sh`. dp-forge's `start_llama.sh` (11.7 KB) is the
  agentic-runner supervisor — different tool, left alone.
- **Heretic's name check**: `settings.json` requests `qwen38-27b-redhat-mxfp4-dflash` but the
  heretic profile serves `swift-1.5`, so a bare `start_heretic_27b.sh start` fails its pre-boot
  check (exit 2, says exactly that). Your tested-and-working flow is presumably
  `SERVED_NAME=qwen38-27b-redhat-mxfp4-dflash start_heretic_27b.sh start` (the profile honors the
  override); the test covers both paths. Settings left untouched per your order.
- Ornith keeps serving under the 27B alias name (settings work unchanged); banner is honest now.

## Verified (measured this session)

- `bash -n` clean on all five scripts.
- All symlink chains resolve to the right canonical (readlink -f).
- Ornith via dp-forge symlink: port-busy → `port 8000 is in use` exit 1; checkpoint-missing →
  exit 1 fast (no GPU); fake checkpoint → `gpu_exclusive.sh` ABORT on the VRAM floor naming the
  live server's pid — proof the `AMD_ROOT` chain works from dp-forge root, no container created.
- `serve_vllm.sh stop`: own dummy container → removed, "stopped … (log kept: …)" exit 0;
  foreign container holding the port → exit 1 naming `container(s) other-19996` + "stop it with
  ITS starter", container untouched; free port → "no container" exit 0.
- redhat `status` → live server reported with full cmdline (untouched); heretic `start` →
  expected exit-2 name mismatch, nothing started; llama-swap `status` → "not running".
- Port 8000 (your active server) never touched; leaked `radiance-8000` container removed [FILL IN].

## Commits [FILL IN: list per repo]
