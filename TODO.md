# TODO

Deferred items with a blocking precondition. Owner decisions live in
`amd-private/notes/restructure/2026-11-07-final-report.md` ("Needs your decision").

## GPU gate — needs the GPU (27B vLLM on :8000 must be stopped first; owner: "not now")

- [ ] Stop the 27B vLLM (`~/.config/claude/local_vllm_direct/vllm.sh stop`) — needs the owner's yes (it also serves subagents)
- [ ] Start/stop llama-swap once and check the models serve (plan 2.8)
- [ ] Boot one vLLM profile end to end (plan 2.8)
- [ ] `stack/gpu/gpu_exclusive.sh` with a free-VRAM floor (plan 2.8)
- [ ] One tiny throughput campaign end to end: raw → `tmp/`, rows → `results/`, charts + `gpu_peaks.json` (plan 3.6)

## stack repo (github.com/dp-craft/stack — pushed 2026-11-07, commit c6fbde8)

- [ ] Write the stack repo's `README.md`: what the repo is (the machine — installs/builds/serves for the R9700), describe the five dirs (`gpu/`, `install/`, `llamacpp/`, `llama-swap/`, `serve/`) and their key scripts, current status (which builds exist and what `latest-*` points at, ROCm/Mesa fixpoints), and link the existing readmes (`llamacpp/README.md`, `llama-swap/README.md`, `serve/vllm/README.md`) plus back to `dp-craft/r9700`. New reports stay in r9700's `docs/`; this repo holds code + config only
