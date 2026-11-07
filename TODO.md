# TODO

Deferred items with a blocking precondition. Owner decisions live in
`amd-private/notes/restructure/2026-11-07-final-report.md` ("Needs your decision").

## GPU gate — needs the GPU (27B vLLM on :8000 must be stopped first; owner: "not now")

- [ ] Stop the 27B vLLM (`~/.config/claude/local_vllm_direct/vllm.sh stop`) — needs the owner's yes (it also serves subagents)
- [ ] Start/stop llama-swap once and check the models serve (plan 2.8)
- [ ] Boot one vLLM profile end to end (plan 2.8)
- [ ] `stack/gpu/gpu_exclusive.sh` with a free-VRAM floor (plan 2.8)
- [ ] One tiny throughput campaign end to end: raw → `tmp/`, rows → `results/`, charts + `gpu_peaks.json` (plan 3.6)

## stack repo (github.com/dp-craft/stack — pushed 2026-11-07, commit 4a750a1)

- [x] Write the stack repo's `README.md` — done 2026-11-07: `stack/README.md` (231 lines; overview, layout, quick start, current status, links to the three dir readmes + back to `dp-craft/r9700`), commit `4a750a1`. Facts verified by the main session against repo sources; one error (templates symlink) fixed before commit
