<!-- meta
date: 2026-11-04 17:02
takeaway: Switching amd/Qwen3.5-35B-A3B-MXFP4 from the EMULATION MoE backend to --moe-backend triton_unfused lifts DFlash K=7 decode from 16.6 to 110 t/s at 10k (6.6x, MEASURED), which confirms EMULATION as the root cause, but it only reaches parity with the 27B, not 2x. CORRECTED: this report's estimate that nothing could reach ~200 t/s was wrong. It missed Ornith-1.5-35B-A3B w4a8 on native Radiance, later measured at 220 t/s.
-->

# Configuring vLLM + Radiance for a 35B-A3B on one R9700, and whether anything reaches 2x the 27B

**Date:** 2026-11-04 · **Kind:** technical research + direct measurement · **Method:** `/research` technical (intake questions skipped: the request stated its goal and stop rule). Web research by two subagents; the key Sly figures were re-fetched from the primary doc. Tags per iron rule 1.

> **Correction (2026-11-04 17:46).** This report concluded that no alternative had a big chance of ~200 t/s. That was wrong. Its native Radiance row covered only the Qwen3.6 FP8 file and missed `keptn/ornith-1.5-35b-a3b-w4a8` in Radiance's own model list, which has an official single-card config and measured 219.8 t/s at 10k (`MEASURED`, `docs/analysis/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`). The step times below are also corrected: the 35B on `triton_unfused` takes about 27 ms per step at 10k, not 37 ms, so it is faster per step than the 27B rather than equal.

## Summary

| Question | Answer | Tag |
|---|---|---|
| Is there a published recipe for Qwen3.5/3.6-35B-A3B on Radiance? | No. Sly's docs do not mention it | not found (searched Sly docs and issues, StillDeadcode, HF) |
| Root cause of ~16 t/s decode? | The `EMULATION` MoE backend. Same drafter and graphs, backend changed: 16.6 → 110 t/s at 10k | `MEASURED` |
| Working configuration? | `--moe-backend triton_unfused` + DFlash K=7, KV group size 2 | `MEASURED`, short replies only |
| Does it reach 2x the 27B (~200 t/s)? | No: 110 / 93 / 67 t/s at 10k / 50k / 100k | `MEASURED` |
| Does an alternative have a big chance of ~200 t/s? | **Yes: Ornith 1.5 w4a8 on native Radiance**, 219.8 t/s at 10k. The original answer here, "no candidate found", was wrong | `MEASURED`, see the correction above |

## Measurements

Run: `bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/`. Sly 1.9.1 (vLLM 0.32.0), ctx 262000, util 0.93, fp8 KV, 256 tokens, temp 1.0, unique prefix, mean of 3. All `MEASURED`; 0 cached tokens and no error rows or GPU faults in these arms. Labels: `<arm>-<depth>`.

| Arm | MoE backend | Full-model CUDA graph | Decode t/s 10k / 50k / 100k | TTFT s 10k / 50k / 100k | Full time s 10k / 50k / 100k |
|---|---|---|---|---|---|
| `dflash-unfused` (K=7) | `TRITON_UNFUSED` | yes | **110.2 / 92.9 / 67.3** | 2.05 / 13.25 / 30.85 | 4.37 / 16.06 / 34.65 |
| `dflash-k7` | `EMULATION` | yes | 16.6 / 15.4 / 15.8 | 1.77 / 10.41 / 26.63 | 17.1 / 27.1 / 43.1 |
| `mtp-k4` | `EMULATION` | **no (0 captured)** | 16.8 / 14.9 / 12.5 | 2.23 / 14.78 / 45.37 | 17.5 / 32.0 / 65.7 |
| `nospec-unfused` | `TRITON_UNFUSED` | **no (0 captured)** | 8.7 / 8.6 / 9.0 | 2.33 / 13.41 / 33.35 | 31.7 / 43.0 / 61.6 |
| `nospec` | `EMULATION` | **no (0 captured)** | 6.2 / 6.1 / 6.0 | 1.79 / 10.98 / 29.29 | 42.8 / 52.9 / 71.9 |

`dflash-unfused` details: 448,702 KV tokens (1.71x at 262k, against 1.17x with `EMULATION`), peak VRAM 31,327 MiB, peak GTT 180 MiB, peak power 368 W, 27.9% draft acceptance (1734/6216, including warmup), 2.95 tokens per step.

## Root cause

- **The clean comparison is the two DFlash rows.** Both captured the full-model graph and use the same drafter at K=7. Step time falls from about 173 ms to about 27 ms at 10k (tokens per step ÷ decode, `INFERRED` arithmetic, 2.88 and 2.95 tokens per step). For comparison, the 27B takes about 40 ms per step on the same probe.
- **The no-drafter rows are not a valid baseline.** Their logs show `Capturing CUDA graphs (FULL): 0it`, so they ran without a captured full-model graph. Their 8.7 vs 6.2 t/s therefore says little about backend cost. The `mtp-k4` numbers carry the same caveat. Why no graph was captured was not investigated.
- **An interim conclusion in this session was wrong.** Based on the no-drafter rows alone, `EMULATION` was described as not the main cause. The DFlash rows overturn that. The takeaway of `2026-11-04-1630-qwen35-35b-a3b-vllm-rocm-decode-gap.md` (EMULATION is the cause) stands; its prediction of 40–80 t/s was low.

## Caveats on the working configuration

- **Activations change.** The log says: `No Mxfp4 MoE backend supports activation=QuantKey(u8,...) for the deployment configuration. Falling back to 'TRITON_UNFUSED' with BF16 activations.` This is the path's normal behaviour here, not an error, but it is not the exact arithmetic the checkpoint was quantized for.
- **Correctness is only lightly checked.** A sanity prompt returned the right reasoning (17×23 = 391, `s[::-1]`) with both unfused arms, but it hit the 300-token limit while still thinking, so no final answer or tool call was seen. No coding or quality test has been run.
- **MTP is untested on this backend.** A comment in vLLM (`oracle/mxfp4.py`) says "TRITON_UNFUSED has bug with MTP support".
- **Depth is under-sampled.** Three depths, and the 50k reps vary (111 / 91 / 76 t/s). Iron rules 16–17 still require at least 4 depths and a growing conversation up to 250k.

## Why 2x remains unlikely on Sly

This section applies to Qwen on Sly only; see the correction above for Ornith on native Radiance. At about 27 ms per step, 200 t/s needs about 5.4 tokens per step (`INFERRED`), against 2.95 measured here and 3.45 for the 27B (`bench/runs/2026-11-04-1740-27b-sly-baseline/`). Step time also rises to about 44 ms at 100k.

The best published MoE figure agrees: 169.4 t/s against "Qwen3.8 + DFlash2 production = 132.4 in the same window", which is 1.28x (`CLAIMED`, [Sly MINICPM-V47.md](https://github.com/SlyBase/vllm-sly-radiance/blob/main/docs/MINICPM-V47.md); one R9700, 210 W cap, 64k context, DSpark K=8, thinking off; a different model).

## Options

Chance estimates are judgement (`INFERRED`), not measurements.

| Option | Checkpoint | Decode evidence | Chance of ≥200 t/s |
|---|---|---|---|
| **Amd MXFP4 + `triton_unfused` + DFlash** | Present locally | 110 / 93 / 67 t/s (`MEASURED`) | Under 5% |
| `Qwen/Qwen3.5-35B-A3B-GPTQ-Int4` + the MiniCPM-style settings | sha `3af5ca29`, 24.46 GB, not booted here | None for this model. Sly's int4 MoE config alone: "1.2-1.7x per MoE call, ~+8 % end-to-end" (`CLAIMED`) | Under 5% |
| MiniCPM-V 4.7 W4A16 | Described by Sly; no separate W4A16 repo found | 169.4 t/s at 64k (`CLAIMED`); no coding evaluation | Under 5% |
| Ornith on vLLM (corrected: this report's search missed `Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4` and `ornith-ai/Ornith-1.5-35B-A3B-DFlash`) | Fetched for the test, deleted afterwards | 95 / 71 / 67 t/s at 10k / 50k / 100k with DFlash K=3 (`MEASURED`, `docs/analysis/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`) | Not reached |
| Native Radiance `.rad` Qwen3.6 FP8 | 34.63 GiB, built for 2 GPUs | None published | About 0% on one card |
| **Native Radiance `.rad` Ornith 1.5 w4a8** (added by the correction; not in the original table) | `keptn/ornith-1.5-35b-a3b-w4a8@cfed0f8f`, 19.74 GiB, official single-card config | 219.8 / 205.0 / 174.5 t/s at 10k / 50k / 100k (`MEASURED`) | Reached at 10k and 50k |
| hipfire | `hipfire-models/qwen3.6-35b-a3b` | 48.5 t/s plain decode on R9700 (`CLAIMED`) | Under 5% |
| llama.cpp Vulkan, Qwen3.6 Q4_K_M | Present | 104 / 71 / 61 t/s at 8k / 128k / 200k, no drafter; 135.9 at 64k with MTP (`MEASURED`, `docs/analysis/2026-07-11-2200-deep-context-35b.md`, `docs/analysis/2026-07-10-1810-rdna4-r9700-tuning-optimum.md`) | Low |

The ~200 t/s headline in the [Level1Techs guide](https://forum.level1techs.com/t/ultimate-2x-r9700-guide-for-qwen-3-8-27b-mxfp4-200t-s-c-1-500t-s-at-c-8/257789) is from two R9700s with tensor parallelism and does not transfer.

## Recommendation

Superseded by `docs/analysis/2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b.md`.

1. Original advice to stop chasing 2x: withdrawn. Ornith 1.5 w4a8 on native Radiance reaches it on speed; coding quality is untested.
2. If the 35B stays in use, set `--moe-backend triton_unfused` as the default in `profiles/sly-amd/qwen35-35b-a3b-mxfp4.env`, then run the 250k growing-conversation test and a real coding session before trusting it.

## Sources

Accessed 2026-11-04.

- [Sly: MiniCPM-V 4.7 on one R9700](https://github.com/SlyBase/vllm-sly-radiance/blob/main/docs/MINICPM-V47.md)
- [Sly: repository](https://github.com/SlyBase/vllm-sly-radiance)
- [StillDeadcode: vllm-radiance on Docker Hub](https://hub.docker.com/r/stilldeadcode/vllm-radiance)
- [StillDeadcode: Qwen3.6-35B-A3B-FP8](https://huggingface.co/StillDeadcode/qwen3.6-35b-a3b-fp8)
- [Qwen: Qwen3.5-35B-A3B-GPTQ-Int4](https://huggingface.co/Qwen/Qwen3.5-35B-A3B-GPTQ-Int4)
- [cyankiwi: Ornith-1.0-35B-AWQ-INT4](https://huggingface.co/cyankiwi/Ornith-1.0-35B-AWQ-INT4)
- [olka-fi: Ornith-1.0-35B-MXFP4](https://huggingface.co/olka-fi/Ornith-1.0-35B-MXFP4)
- [hipfire: qwen3.6-35b-a3b](https://huggingface.co/hipfire-models/qwen3.6-35b-a3b)
- [Level1Techs: 2x R9700 guide](https://forum.level1techs.com/t/ultimate-2x-r9700-guide-for-qwen-3-8-27b-mxfp4-200t-s-c-1-500t-s-at-c-8/257789)
