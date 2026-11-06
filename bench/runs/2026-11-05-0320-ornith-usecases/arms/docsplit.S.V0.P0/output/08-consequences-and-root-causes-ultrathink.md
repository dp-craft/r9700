## Consequences & root causes (ultrathink)

1. **VRAM is not the ceiling — the RoPE cap is. (MEASURED)** Both f16 servers (`-c 262144`) ran the
   193K-token prompt to completion with no OOM and no fallback, on MTP off *and* on. **Observation:**
   the campaign premise (f16 KV ≈ 21 KiB/tok → 200K ≈ 3.9 GiB, native 262144 ≈ 27 GB) holds on the
   served path. **Consequence:** on this 32 GB card, *use the full native context in f16* — don't
   pre-emptively quantize KV or cap context for VRAM reasons at ≤200K. Going beyond 262144 is a
   RoPE/YaRN quality question, not a memory one (out of scope here).

2. **MTP's decode gain grows with depth, but MTP is a net LOSS whenever prefill dominates. (MEASURED
   + INFERRED)** Decode speedup climbs +14.5% (8K) → +19.4% (128K) → +35.1% (200K); INFERRED cause:
   base decode is KV-bandwidth-bound and *slows* with depth (104 → 61 tok/s), so each accepted draft
   token — which skips one full KV-reading forward pass — saves proportionally more the deeper you
   are (draft acceptance stays high on code). **But** MTP costs a flat ~9% on prefill (draft-layer
   overhead per micro-batch), and for a 256-token generation at 200K the prefill penalty (~+18 s)
   dwarfs the decode saving (~+1 s), for **−17 s wall**. The crossover is set by the
   generation-to-prompt ratio: MTP wins net only when decode work is large relative to prefill (the
   `thinking` fixture, ~0 prompt / 1024 gen → −1.5 s wall, a win). **Consequence for practice: MTP on
   for chat/generation-heavy single-user turns; MTP OFF for deep-context / short-answer requests
   (RAG-style "read 200K, answer in 3 lines"), where it strictly hurts.** This *refines* the prior
   campaign's blanket "MTP on for single-stream" — it depends on the workload's decode:prefill ratio,
   not just concurrency.

3. **q8_0 KV overhead scales with context — it is worst exactly where it's marketed as a fix.
   (MEASURED + INFERRED)** At 64K the sweep saw −29.7% prefill; at 200K here it's −39.8% prefill,
   −21.7% decode, +66% TTFT. **INFERRED cause:** prefill must quantize 193K KV writes and every
   attention step dequantizes a proportionally larger cache; on the RDNA4/Vulkan path this q8_0 KV
   kernel is unoptimized, so its cost rises with cache size. Stacking MTP (extra draft-verify steps,
   each re-touching the quantized KV) makes it worst-case. **Consequence:** q8_0 KV is not a
   "reach for it at depth to save VRAM" tool on this box — it's a depth-*amplified* regression, and
   f16 fits anyway. **Keep f16 to 262144.** (OPEN: whether a future Mesa/llama.cpp build narrows this
   — the ROCm path's smaller −7.5% decode penalty in the sweep hints the Vulkan q8_0 KV kernel is the
   specific weak point; would need a rebuild to confirm.)

4. **Prefill decays ~59% and decode ~41% across the depth curve — different bottlenecks.
   (MEASURED + INFERRED)** Prefill 3077 → 1254 tok/s reflects attention's O(n) growth (each new
   micro-batch attends over an ever-longer KV); decode 104 → 61 tok/s reflects KV *read* bandwidth
   (every generated token streams the whole ~3.9 GiB cache). **Consequence:** deep-context TTFT is
   almost entirely prefill (200K: 154 s TTFT of 158 s wall) — the lever that matters for interactive
   deep-context UX is **prefix caching / prompt reuse**, not decode tuning. A cold 200K prompt is a
   ~2.5-minute wait to first token regardless of KV type or MTP.

5. **Parallel at 32K prompts is prefill-bound: concurrency buys latency, not throughput here.
   (MEASURED + INFERRED)** np2 → np4 leaves aggregate throughput flat (5.5 → 6.0 tok/s) while TTFT
   p95 doubles (24 → 49 s). **INFERRED cause:** the agentic prompts EOS after 16–256 tokens, so the
   run is ~99% prefill; continuous batching's win is a *decode-phase* phenomenon (batching many
   streams' token steps), and there's almost no decode phase to batch — 4× 32K prefill just
   serializes on the one GPU. **Sub-finding (MEASURED): a fresh long prefill starves an
   already-decoding slot** — in np2, whichever stream finishes prefill first then decodes at only
   ~6.7 tok/s until the sibling's prefill completes, after which the survivor runs alone at ~70. So
   mixing a big new prompt into a busy slot pool tanks in-flight decode latency. **Consequence:** for
   deep/prefill-heavy agent fleets on a single R9700, prefer serializing (np1, queue) over np≥2 —
   parallel slots add TTFT without adding aggregate tokens. (This *does not* contradict the prior
   8K-prompt c4 result of ~48 tok/s/stream: at 8K the prefill is light and decode dominates, so
   batching pays. The rule is depth-dependent.)
   **CAVEAT/OPEN:** early-EOS under-measures aggregate decode scaling at depth. To isolate the true
   decode-batching win at 32K, re-run with `ignore_eos`/larger `max_tokens` so every slot generates a
   long fixed output. Filed for a follow-up.
