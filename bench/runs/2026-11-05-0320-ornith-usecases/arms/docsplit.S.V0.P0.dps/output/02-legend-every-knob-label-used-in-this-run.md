## Legend — every knob & label used in this run

| Term | What it is | Effect on this box (R9700 / RDNA4, 32 GB) — this run | How it's tested here |
|------|------------|-------------------------------------------------------|----------------------|
| `-ub 2048` / `-b 4096` | prefill micro-batch / logical batch | sweep optimum, held fixed all runs | fixed (not swept here) |
| `-fa on` | flash attention | on everywhere (required for the deep KV to fit/run) | fixed |
| KV `f16` | 16-bit KV cache — the baseline | ~21 KiB/tok → 200K ≈ 3.9 GiB KV; **ran to 200K, no OOM** | baseline of the KV A/B |
| KV `q8_0` | 8-bit block-quantized KV | **−40% prefill / −22% decode / +66% TTFT at 200K**; penalty grows with ctx → **rejected** | one confirmatory point @200K, MTP=1 |
| MTP | multi-token-prediction speculative decode (`--spec-type draft-mtp`, draft layer in the GGUF) | **+14→+35% decode (grows with depth)**, but **−9% prefill flat** → net loss when prefill dominates | on/off axis on the single-stream servers |
| depth / `crN` | code-review prompt padded to N tokens (real 8.1K / 124K / 193K) | prefill throughput ~halves 8K→200K; decode sags as KV fills | `run.sh` (openai_probe) vs a fresh server, `PREFIX_MODE=unique`, 256-tok decode |
| `thinking` | reasoning fixture, chat API, 1024-tok budget | tiny prompt → decode-dominated; MTP wins net here | `SLUG=deep-mtp{0,1}-think`, `API=chat` |
| `deep-par-npN` | N parallel agentic-32K streams on `-np N` slots (each slot = 262144/N) | 32K prompts EOS early → **prefill-bound**; concurrency trades latency for ~0 aggregate | `CONCURRENCY=N`, `-np N`, MTP off |
| TTFT p50/p95 | time to first token, median / 95th pct | at depth this is dominated by prefill (200K ≈ 154–172 s) | per-request timing in openai_probe |
| `prefix_mode=unique` | cold prompt cache (honest prefill) | every request a fresh prefill (no 2.4× warm inflation) | default for all rows |
| `plateau_within_noise` | difference inside ±3% run-variance | a tie, never sold as a win | REPS=2 per probe |
