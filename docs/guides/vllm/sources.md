# vLLM track — sources (where to look)

External keywords + repos for the vLLM track. **Tier-1 first** (iron rule 3): the upstream repos, not
secondary coverage.

## Keywords that work

- **SlyBase** / **vllm-sly-radiance** — the Sly MXFP4 docker track (the current base + official recipe)
- **stilldeadcode** / **vllm-radiance** / **radiance** / **R4D** — the native upstream R4D build
- **gfx1201** — the R9700 arch (the key filter for RDNA4-specific kernel support)
- **MXFP4** / **W4A8** — 4-bit weights, fp8 activations on RDNA4's fp8 WMMA
- **DFlash2** / **speculative decoding** — the drafter track
- **libr4d** — the native radiance kernels (codeberg)

## Where the truth is (upstream repos)

- `github.com/slybase/vllm-sly-radiance` — Sly main (1.7.0 = 2026-10-20, vLLM 0.32.0, no kernarg fix);
  the MXFP4 docker images `ghcr.io/slybase/vllm-sly-radiance:<tag>`.
- `codeberg.org/StillDeadcode/vllm-radiance` + `codeberg.org/StillDeadcode/libr4d` — the native
  R4D build + kernels (Docker Hub `stilldeadcode/vllm-radiance`).
- `hub.docker.com/r/stilldeadcode/vllm-radiance`, `hub.docker.com/r/magiccodingman/vllm-radiance`
  — mirror tags.
- `github.com/drwolfen/radiance-vllm-r9700` — an R9700 radiance fork.
- `vllm-project/vllm` — the upstream vLLM (spec-decode, mamba, attention backends).
- `ROCm/aiter` (#900), `ROCm/TransformerEngine` (#520), `vllm-project/vllm` (#28649) — the
  FP8/attention gaps on gfx1201.
- `incoai/Qwen3.8-27B-DFlash2` — the source of the `syvai/...W4A16` drafter quant.
- Model cards: `recipes.vllm.ai/Qwen/Qwen3.6-27B`, the `amd/` and `slybase/` HF model repos.

## What to exclude

- **Aggregator blogs** and **Puget marketing** (e.g. the "Ultimate 2x R9700 guide for Qwen 3.8 27B
  MXFP4") — secondary coverage of the radiance build, not the primary source. Corroborate, don't cite.
- `daimonionnn/amd-r9700-vllm-and-tuning-toolkit`, `ThePie88/vLLM-ROCm-Windows` — third-party
  toolkits, not the track's upstream.

## Notes

- The radiance "tuned" build is **undisclosed** in Puget's article (2× R9700, Qwen3.6-27B-FP8 TP=2);
  it is `stilldeadcode/vllm-radiance` + `libr4d` (the 0.9.3 image, now a dead image).
- The FP8/attention gap: `gfx1201` is missing from AITER's `_ARCH_TO_DEVICE` table, so FP8 silently
  falls back to FP32 (~18–22 vs ~35–40 tok/s) — revisit when upstream merges gfx1201 into AITER and
  vLLM supports FP8 for RDNA4. See `docs/research/vllm/2026-07-12-2300-rdna4-vllm-aiter-fp8-status.md`.
