## Methodology & caveats

- **Fixtures:** `codereview-{8000,128000,200000}.txt` (real 8 133 / 124 062 / 193 347 tok — the
  "200K" target lands at ~193K real tokens, ~3.6 chars/tok), `thinking-hard.txt` (~236 tok),
  `agentic-32000-v1..4.txt` (~32 242 tok each). Built by `build_prompt.py` (errors if <97% fill).
- **Probe:** `openai_probe.py` via `run.sh`, `PREFIX_MODE=unique` (cold prefill — no warm-cache
  inflation), **REPS=2**, warmup=1. Completions API for `cr*`/agentic, **chat** API for `think`.
  Token counts from server `usage` (`tok_count_source: usage`), except one np4 stream that fell back
  to `sse_chunks`.
- **One variable per comparison:** depth curve holds tuning fixed; MTP A/B holds depth+KV fixed; KV
  A/B holds depth+MTP fixed. Differences inside ±3% are ties.
- **q8_0 first attempt** (`2306-…-mtp1q8-cr200000`) produced an empty `results.jsonl` (server
  start/probe interrupted at depth); re-run `2310-…` succeeded and is the row used. Recorded, not
  averaged.
- **VRAM not re-sampled this run** (no `gpu_samples` from the probe path); the "no OOM at 200K" is
  the served-path evidence, and the ~21 KiB/tok → ~27 GB @262144 figure is prior-MEASURED (campaign
  README / direct sampling), cited not re-derived.
- **Held fixed:** Vulkan backend only, `-ub 2048 -b 4096 -fa on -ngl 99 -c 262144`, build
  b9950-961e4b26a, Q4_K_M weights. Out of scope: ROCm backend, full q8_0 matrix, >262144 (YaRN),
  27B (no MTP layer).

