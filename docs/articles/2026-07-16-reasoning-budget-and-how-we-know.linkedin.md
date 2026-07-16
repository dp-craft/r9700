Capping a reasoning model's thinking tokens cut latency and token cost 40-55% with zero accuracy loss. We didn't believe it either, so we tried to break it.

Setup: Qwen3.6-27B on an AMD R9700 (RDNA4, 32GB), llama.cpp Vulkan, 14 hard agentic-coding tasks, blind LLM judging.

What held up:
Deterministic accuracy stayed at 100% at every capped budget down to 512 tokens. Judge quality plateaus, it doesn't slope, best score (4.83/5) landed at the cheapest capped point, 1024 tokens. Uncapped runs had a 7.1% runaway rate: the model thinking to the token ceiling and never answering.

Here's the part we're actually proud of. Our first read blamed the runaways on MTP (multi-token prediction / speculative decode) draft-tuning knobs, since the bad cells overlapped with MTP configs. We tested that claim directly. It was wrong. Those knobs gate draft depth and speed, not reasoning length. The real cause, confirmed by a follow-up run, was simply the missing budget cap. We're publishing the correction alongside the finding.

Gotcha: --reasoning-budget 0 means uncapped on this build, not "don't think."

Caveat: reps=1, so the fine ranking inside the plateau (1024 vs 2048) is noise-level. Every task here is shallow (50-100 prompt tokens) against a real target of 10-50K agentic context. That's next.

Recommended: --reasoning-budget 2048 for real agentic depth, 1024 as the economy option once validated at your context length. Never 0.

A benchmark you can trust is one that looks for reasons its own conclusion might be wrong.

[full write-up ↓ / link in comments]

#LLM #LocalLLM #AMD #ROCm #Inference #AIEngineering
