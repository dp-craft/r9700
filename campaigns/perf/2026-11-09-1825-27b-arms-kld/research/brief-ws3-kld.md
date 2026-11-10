# WS3 research brief — KLD quantization-fidelity probe (two-round)

**Context.** We are comparing four 27B checkpoints of Qwen3.8-27B served on the R9700 (campaign
`2026-11-09-27b-arms-kld`): A = Quark-MXFP4 .rad (radiance 1.11.0 baseline), B = same @ radiance 1.17.0,
C = IQ4R-L-V4 .rad @ radiance 1.17.0, D = RedHat-MXFP4 (HF) @ sly 1.10.0. For each arm we want a
**KL-divergence distance to a local FP8 reference** (`Qwen__Qwen3.8-27B-FP8@017b9c7a`) — nats/tok, with
an honest precision statement. The implementation target is a ~100-line `bench/perf/kld_probe.py`.

**Repo rules that bind you:** provenance tags (MEASURED / CLAIMED / INFERRED — say which for every
number), Tier-1 sources first (paper arXiv pages, official docs, the local `src/` trees below), English,
tables first. Result files go in this same `research/` dir.

## Round 1 — holistic (big picture, no tool selection) → write `research/ws3-kld-r1.md`

How the field measures quantization-fidelity KLD:
- GPTQ's KL calibration objective (the original: frantar et al. 2022, arXiv 2210.17323 — the per-layer
  E[KL(p || q)] with p = fp16/bf16 output distribution, q = quantized; note the direction used there).
- Other quantization-fidelity papers/metrics that report a divergence (SpQR, AQLM, QuIP#, AWQ/LLM.int8()
  evals): what metric, what reference, what support (full vocab vs top-k), what units (nats/tok vs
  bits/tok vs "average KL"), forward vs reverse KL and why each is chosen.
- OSS evals/tools that expose KL out of the box (GPTQModel `quantize` reports, gptq-for-llama, AutoGPTQ
  evals, llm-compressor, vLLM's own serving-related logprob tooling, any "quantization quality" harness).
- Reporting conventions: per-token mean vs total, calibration-set size norms, how CIs are (or are not)
  given.

Deliverable: the standard practice in ~½ page + a table of (source, metric, reference, support, units,
direction) + **its limitations for comparing SERVED models** (no weight access — only the HTTP API;
reference and quantized may run on different engines with different logits scaling; sampling drift if
you generate).

Seed URLs: https://arxiv.org/abs/2210.17323 (GPTQ), https://arxiv.org/abs/2306.03078 (SpQR),
https://arxiv.org/abs/2306.07629 (QuIP#), https://arxiv.org/abs/2303.09488 (AWQ),
https://docs.vllm.ai/en/latest/serving/openai_compatible_api.html (logprobs in the serving API),
Semantic Scholar search "quantization KL divergence perplexity" via
https://api.semanticscholar.org/graph/v1/paper/search?query=quantization+KL+divergence+perplexity

## Round 2 — drill down (OUR stack; local Tier-1 first) → write `research/ws3-kld-r2.md`

Local sources (read them — these are Tier-1 for us):
1. **sly's own fidelity tools:** `/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0/` — find and read
   `bench_fidelity.py` and `check_fidelity.py` (grep for them). Extract the EXACT method: KL direction,
   support (top-20? tail mass?), pairing (position-by-position? same prompt?), temperature, CI method,
   units, how they pick the calibration input.
2. **radiance logprob API:** the radiance image is stilldeadcode/radiance (docs: https://radiance.stilldeadcode.com
   or the repo docs under /mnt/Lin1/work/radiance if present locally — check; also `spec.md` /
   `rad_core.h` if vendored anywhere under /mnt/Lin1/work). What does its OpenAI-compatible
   `/v1/chat/completions` expose: `logprobs`, `top_logprobs` (bound?), `prompt_logprobs`?
3. **vLLM logprobs API semantics** (sly 1.10.0 is a vLLM derivative — local src:
   `/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0/`): `prompt_logprobs` vs completion logprobs, the
   top_logprobs cap, temperature/top_p interaction with returned logprobs (raw logits vs sampled-scale),
   whether prompt_logprobs works with reasoning models (Qwen3 `enable_thinking`).
4. **Implementation candidates** for the ~100-line probe: stdlib+requests vs numpy (is numpy available
   on this host? check `python3 -c "import numpy"`), and what existing repo tooling can be reused
   (`bench/core/capture_engine.py` for the HTTP layer?).
5. **Calibration-set practice:** size vs CI width for per-token KL means (delta method / bootstrap on
   i.i.d.-ish positions); domain mix (TS/Python code vs prose) for a coding-model population.

Deliverables in `research/ws3-kld-r2.md`:
- the exact formula we will implement, with every choice sourced (direction, support, tail handling,
  pairing, units, CI method);
- the **mode decision**: prompt-scoring (score fixed-corpus tokens via `prompt_logprobs` — no sampling
  drift; preferred if both engine families support it — state how the selftest verifies it) vs
  greedy-generation (temp 0, paired top-20/position, sly's method) fallback — with the deciding
  evidence from sources 2–3;
- a precision statement: resolution (top-k support mass), CI method + worst-case error on a synthetic
  known-shape distribution;
- an open-questions list for the implementer.
