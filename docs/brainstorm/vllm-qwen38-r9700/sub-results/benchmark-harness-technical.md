# Measuring pp512+tg256 and pp32768+tg2048 on vLLM — harness and baseline

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** technical
**Date:** 2026-09-11

---

## 1. Tool choice — `llama-benchy` (already installed: `bench/dl/benchy-venv/bin/llama-benchy`)

Adopted per `docs/research/2026-07-11-0918-benchmark-harness-build-vs-adopt.md` (OpenAI-endpoint HTTP bench
for cross-engine). Mechanics (VERIFIED by reading its installed source, `llama_benchy/*.py`):

| Aspect | Behaviour | Implication |
|---|---|---|
| Shapes | `--pp … --tg …` lists (cross-product), `--runs N` (default 3), warm-up on by default | run the two shapes as **two invocations** to avoid the extra 512/2048 and 32768/256 cells |
| Prompt text | `TokenizedCorpus(book_url)`, default `https://www.gutenberg.org/files/1661/1661-0.txt` (natural English prose) | realistic MTP draft acceptance (random tokens would understate MTP) |
| Tokenizer | `--tokenizer` (HF name or local dir with `tokenizer.json`), else model name | point it at `~/models/vllm/Qwen3.8-27B-INT4` → exact 32768-token prompts in the model's own tokenization |
| Endpoint | `POST {base_url}/chat/completions`, streaming, `stream_options.include_usage` | chat template applied by the server |
| `--exact-tg` | sends **`min_tokens = max_tokens`** (`client.py:67`) | vLLM honours `min_tokens` ✅ |
| TTFT / prefill | first **content-bearing** delta: `content` **or** `reasoning_content` **or** `reasoning` (`client.py:364–381`) | a reasoning parser does **not** inflate TTFT ✅ |
| `--no-cache` | unique prompts per request | keeps prefix caching from faking prefill; also leave `--enable-prefix-caching` off on the server |

Rejected alternatives:
- `bench/lib/capture_engine.py probe` — the repo's prober, but it has **no min_tokens / ignore_eos** → replies
  may stop early; would need extending (rule 6) for no gain here.
- `vllm bench serve --dataset-name random --ignore-eos` — engine-specific, random-token prompts (hurts MTP),
  TTFT/TPOT output not in llama-bench shape.

## 2. llama.cpp side (for completeness — user chose to reuse existing numbers)

- llama-server has **no `min_tokens`**; per-request `ignore_eos` exists (README L575) and a server-wide
  **`--ignore-eos`** flag ("ignore end of stream token and continue generating (implies --logit-bias EOS-inf)",
  README L125) (VERIFIED, upstream README). → llama-benchy's `--exact-tg` alone would be silently ignored.
- `bench/engine-bench/serve_llamacpp.sh` supports `EXTRA_ARGS` and `MTP=1` (→ `--spec-type draft-mtp`)
  (VERIFIED) → a like-for-like re-measure would be `EXTRA_ARGS="--ignore-eos"` + the same llama-benchy command.

## 3. Baseline chosen by the user — today's llama-bench build check (MEASURED)

Source: `docs/analysis/2026-09-11-1716-llamacpp-b10909-build-check.md` (`bench/runs/2026-09-11-1716-buildcmp-b10909`),
`Qwen3.8-27B-UD-Q4_K_XL.gguf`, KV **q8_0**, `-ngl 99 -fa on -ub 2048 -b 4096`, r=1, **no MTP**, llama-bench in-process.

| Shape | Backend (b10909) | Prefill t/s | Decode t/s | Request |
|---|---|---:|---:|---:|
| pp512 + tg256 | vulkan | 1009.0 | 30.2 | 9.0 s |
| pp512 + tg256 | rocm | 1109.3 | 27.8 | 9.7 s |
| pp32768 + tg2048 | vulkan | 872.4 | 28.2 | 110.2 s |
| pp32768 + tg2048 | rocm | 952.1 | 24.8 | 117.1 s |

**Comparability caveats (must be printed next to any vLLM-vs-llama.cpp statement):** in-process llama-bench vs
HTTP llama-benchy (TTFT includes HTTP + chat templating); q8_0 KV vs vLLM bf16 KV; different 4-bit quants
(UD-Q4_K_XL GGUF vs INT4 g128); no llama.cpp MTP row → the vLLM MTP-on arm has **no counterpart**; r=1 there.
→ label every comparison **indicative**.

## 4. Repo-rule hooks for the run
- Rule 7 / `/benchmark-results`: memory column mandatory → run `bench/lib/vram_sampler.py --out gpu_samples.csv`
  for the whole server lifetime; report MEASURED peak VRAM/GTT.
- Rule 2: record vLLM version, torch/triton versions, host ROCm (10.0.0 / HIP 7.15), model repo + revision,
  every serve flag, llama-benchy version + args.
- Rule 18: an interrupted llama-benchy run is quarantined, not reported.
- Rule 16 (raised once, user's two shapes stand): two single points are an indicative comparison, not an
  engine verdict; a depth curve (≥ 4 depths, log-log exponent) is the follow-up if vLLM looks competitive.

## Sources
- `bench/dl/benchy-venv/lib/python3.12/site-packages/llama_benchy/{config,client,corpus,prompts,runner}.py`
- https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md
- `bench/engine-bench/serve_llamacpp.sh`
- `docs/analysis/2026-09-11-1716-llamacpp-b10909-build-check.md`
