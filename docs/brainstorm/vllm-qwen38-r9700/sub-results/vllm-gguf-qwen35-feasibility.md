# Can vLLM serve the downloaded Qwen3.8-27B GGUF? — feasibility

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** feasibility
**Date:** 2026-09-11

---

**Verdict: BLOCKER — no.** Two independent reasons, either one sufficient.

## 1. Local image inspection (VERIFIED — CPU-only `docker run`, no GPU devices passed)

Image `rocm/vllm:rocm7.13.0_gfx120X-all_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1`:

| Check | Result |
|---|---|
| versions | vllm `0.19.1+rocm7.13.0rc2`, transformers `5.8.1` |
| transformers GGUF config mapping (`transformers.integrations.ggml`) | bloom, deci, falcon, gemma2, gemma3, gpt2, gpt_oss, lfm2, llama, mamba, minimax_m2, mistral, nemotron, phi3, **qwen2, qwen2_moe, qwen3, qwen3_moe**, stablelm, starcoder2, t5, umt5 — **no `qwen35`, no `qwen3next`** |
| gguf-py knows the arch names | yes: `qwen3next`, `qwen35`, `qwen35moe` (reader side only) |
| `gguf_loader.py` mentions qwen35 / qwen3_next | **no** |
| compiled `ggml_*` ops in `torch.ops._C` after `import vllm._C` | **none** → the GGUF dequant/matmul kernels are not built into this ROCm image |
| model registry | has `Qwen3_5ForConditionalGeneration`, `Qwen3_5MTP`, `Qwen3NextForCausalLM`, `Qwen3NextMTP` → the arch itself is served fine from **safetensors** |

Our file: `arch=qwen35`, 65 blocks, 16 attn-KV layers + 48 linear-attn + 1 nextn (VERIFIED, `bench/gguf_kv.py`).

## 2. Upstream status (research agent, CLAIMED)

- **vllm#36456** — "architecture qwen35 is not supported yet" when loading Qwen3.5 GGUF — **OPEN, stale 90+ days**.
- **vllm#36740** — respects `--hf-config-path` as a workaround; **OPEN, stale**; does not add qwen35 support.
- transformers PR #43830 (merged 2026-02-09) adds Qwen3.5 *model* support; whether `qwen35` entered
  `GGUF_SUPPORTED_ARCHITECTURES` — NOT FOUND (and the 5.8.1 we inspected does not have it).
- GGUF support is moving out-of-tree to `vllm-project/vllm-gguf-plugin`; its qwen35 status — NOT FOUND.
- docs.vllm.ai GGUF page: *"GGUF support in vLLM is highly experimental and under-optimized at the moment,
  it might be incompatible with other features."* Documented example is Q4_K_M; IQ types not documented.
  Our file is an Unsloth "UD" dynamic mix (Q4_K/Q5_K/Q6_K/IQ tensor types).
- Performance: GGUF "most likely slower than other quant types" in vLLM (vllm discussions/10326). No AMD numbers found.

Agent also suggested a "`repo:quant` HF-format bypass" — **unverified and irrelevant** here: it would still
need qwen35 mapping and GGUF kernels, neither of which exists.

## 3. Consequence

Even in the best case (arch mapping added), GGUF in vLLM runs a dequant path that is explicitly
"under-optimized" — contrary to the user's "good performance from the beginning". The right vLLM input is
a **native vLLM quant format** (compressed-tensors / GPTQ INT4) → see the checkpoints sub-result.

## Sources
- https://github.com/vllm-project/vllm/issues/36456 · https://github.com/vllm-project/vllm/pull/36740
- https://github.com/huggingface/transformers/pull/43830
- https://docs.vllm.ai/en/stable/features/quantization/gguf/
- https://github.com/vllm-project/vllm-gguf-plugin
- https://github.com/vllm-project/vllm/discussions/10326
