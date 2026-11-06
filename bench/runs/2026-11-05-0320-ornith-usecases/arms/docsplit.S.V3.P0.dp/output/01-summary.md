## Summary

Pushing the 35B to its native **262144** RoPE ceiling on Vulkan. **f16 KV ran cleanly at 200K
tokens with no OOM on both MTP off and on** — confirming the campaign premise that at ~21 KiB/token
VRAM is *not* the binding limit (the RoPE cap is). Along the depth curve prefill throughput decays
**3077 → 1611 → 1254 tok/s** and decode **104 → 71 → 61 tok/s** from 8K → 128K → 200K (f16, MTP
off). **MTP's decode gain *grows* with depth (+14% at 8K → +35% at 200K), but for a deep-prefill /
short-decode request MTP is a net loss**: at 200K it adds ~18 s of prefill to save ~1 s of decode
over 256 tokens → **−17 s wall (158 → 175 s)**. The single confirmatory **q8_0 point is
catastrophic at depth — prefill −40%, decode −22%, TTFT +66% (+114 s)** — and the penalty *scales
with* context, the opposite of where you'd reach for it; **f16 is the only sane KV here.** Parallel
at 32K prompts is **prefill-bound**: going np2 → np4 doubles TTFT p95 (24 → 49 s) for essentially no
aggregate-throughput gain (5.5 → 6.0 tok/s), and a fresh long prefill starves an already-decoding
slot to ~6.7 tok/s. **Winning config: Vulkan + f16, MTP on only when generation dominates prefill.**

