70 tok/s decode on a dense 27B coding model, on one 32GB AMD card, at 100% task accuracy.

We ran Qwen3.6-27B (Q4_K_M) through llama.cpp Vulkan on an AMD Radeon AI PRO R9700 (RDNA4, gfx1201). No NVIDIA, no multi-GPU, stock ROCm 7.x.

The finding that surprised us: MTP (multi-token prediction, llama.cpp's built-in speculative decode) is not a speed/quality trade-off here. It's just free.

Same context, same sampling, same reasoning-budget cap, two GGUF builds:

MTP off: 31 tok/s decode, 100% accuracy, judge score 4.56/5
MTP on: 70 tok/s decode, 100% accuracy, judge score 4.83/5

That's 2.25x the decode speed with zero accuracy cost and the best quality score in the whole sweep. Cost: about 1.6 GiB more VRAM. Against a 32 GB card, that's nothing. Peak usage stayed under 21 GiB, no spill, no throttling.

The other lever worth stealing: capping the thinking budget (--reasoning-budget) cut tokens and latency by 40-55% with zero accuracy loss, and dropped runaway generations (thinking straight through the token ceiling without answering) from 7.1% to 0%.

Caveat we're not glossing over: this is reps=1, on shallow ~50-100 token prompts. Real agentic context (10-50K tokens) is the next test.

Recommended starting point: MTP on, --reasoning-budget 2048 for real workloads, KV cache f16, ctx 32768.

[full write-up ↓ / link in comments]

#LocalLLM #AMD #ROCm #LLMInference #AIEngineering
