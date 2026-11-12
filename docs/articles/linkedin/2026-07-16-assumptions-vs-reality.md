We published the wrong root cause first. Then we tested it and corrected it in the open.

Benchmarking Qwen3.6-27B reasoning-budget tuning on an AMD R9700, four assumptions we walked in with didn't survive contact with the data:

"--reasoning-budget 0 means no thinking." Wrong — 0 means uncapped, and it produced 1,736 thinking tokens, more than our 2048 cap. Zero is the opposite of off.

"MTP draft-tuning caused the runaway replies." Wrong. Every uncapped config ran away at exactly 7.1% regardless of draft settings. Every capped config: 0%. The draft params are live, they just gate draft depth/speed, not reasoning length. We inferred causality from correlation, then a follow-up run refuted it.

"The built-in truncated_thinking flag will catch runaways." It reported 0% on cells we measured at 7.1%. Our explicit signal (finish_reason=length AND no answer) caught what the framework's own flag missed.

The fix that actually holds: cap the thinking budget. 100% deterministic accuracy across every capped config, 40-55% fewer tokens, 0% runaways. That part was never in question — what we got wrong was the story about why things failed before capping.

Caveat: this is reps=1 on shallow (50-100 token) prompts. The fine ranking inside the safe plateau is noise; the plateau itself and the runaway pattern are not.

Every number here is tagged MEASURED, CLAIMED, or INFERRED. That's not paperwork — it's what let us catch our own wrong causal story before it shipped in someone's config.

[full write-up ↓ / link in comments]

#LLM #LocalLLM #AMD #ROCm #AIEngineering
