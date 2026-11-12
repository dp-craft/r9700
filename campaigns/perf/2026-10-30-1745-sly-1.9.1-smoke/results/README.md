# Sly 1.9.1 smoke test — RedHat MXFP4 + DFlash2 (2026-10-30 17:43–17:52 local)

Gate for switching the `sly-redhat` profile from Sly 1.8.1 to 1.9.1 (no config was changed for the test: `IMAGE=` override).
Driver: `smoke_191.sh` (as run; OUT=this dir). Server args = dp-forge `vllm.sh` (MAXLEN 262000, MAXSEQS 1, fp8 KV, util 0.93, WATCHDOG_MIB 32).

| Check | Result (MEASURED, `summary.txt`) |
|---|---|
| Boot | rc 0 in 475 s (first boot on this tag: compile; cache is per image tag) · VRAM used 1,303 → 30,852 MiB · KV pool 370,702 tok @262000 (= 1.8.1) |
| Image | `RADIANCE_VERSION=1.9.1`, vLLM 0.32.0, `RADIANCE_CACTUS_DELTA=0.5` (fade/cap at their code defaults) |
| Template | `qwen3.8-froggeric-v22.5-sly2` |
| Reasoning replay (`/v1/messages`, input_tokens) | base 56 · long reasoning on the OLDER assistant turn 56 (not replayed) · on the NEWEST turn 1,225 (replayed) — the sly2 behaviour |
| One generation (TS Fibonacci, max 3000) | end_turn, 749 out tok in 5.6 s; acceptance length 6.38 (short code prompt) |
| Teardown | port 8000 free, VRAM 1,223 MiB |

Verdict: pass → `profiles/sly-redhat/_engine.env` and `claude-sly-redhat.sh` default to 1.9.1 (rollback lines in both);
heretic (`sly-official`) stays on 1.8.1. Files: `print.txt` (resolved argv), `start.txt`, `server.cmdline`, `requests.json`
(replay + generation bodies), `server-container.log`, `stop.txt`.
