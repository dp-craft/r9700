Capping a reasoning model's thinking budget cut tokens and latency 40-55% with zero accuracy loss. Runaway generations went from 7.1% to 0%.

We ran Qwen3.6-27B (dense, Q4_K_M) through 14 hard agentic-coding tasks on an AMD Radeon AI PRO R9700, sweeping llama.cpp's --reasoning-budget flag, the hard cap on how many tokens a thinking model can burn before it has to answer.

What we found:

Deterministic accuracy stayed at 100% at every capped budget we tried (512, 1024, 2048). Capping cost nothing on tasks with a verifiable answer.
Open-ended judge quality wasn't a slope, it was a plateau. It rose from 512 to 1024, then flattened and dipped from there. Best score, 4.83/5, came from the cheapest budget past the knee (1024).
Every uncapped run showed a 7.1% runaway rate: the model thinking until it hit the generation ceiling and never answering. Every capped run, including the smallest cap, showed 0%.

The gotcha: --reasoning-budget 0 does not mean "don't think." On our build it meant uncapped, and it produced the most thinking of any config we tested (1736 tokens). If you want a model to skip thinking, that flag isn't it.

Honest caveat: this is reps=1 on ~50-100 token prompts. The fine ranking inside the plateau is noisy, and we haven't yet tested this at the 10-50K token context depth real agentic work actually runs at. That's next.

If your reasoning model's default is "think as long as it wants," you're paying for a free lunch nobody's serving you.

[full write-up ↓ / link in comments]

#LLM #LocalLLM #Inference #AIEngineering #ROCm
