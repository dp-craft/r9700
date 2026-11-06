<!-- meta
date: 2026-11-04 17:46
takeaway: Best 35B on one R9700 at 210 W is Ornith-1.5-35B-A3B w4a8 on native Radiance 1.16.0 with MTP K=3: 220/205/175 t/s decode and 13059/8029/5301 t/s prefill at 10k/50k/100k, 2.1-2.5x Qwen3.8-27B on Sly 1.9.1 (87/96/82 t/s). Ornith on Sly with Radiance's serving values and DFlash K=3 reaches only 95/71/67 t/s, and MTP does not load there on any usable backend. The Qwen3.5-35B slowdown on Sly is the EMULATION MoE backend (16.6 to 110 t/s with triton_unfused). Radiance's default 96 MiB headroom crashed the desktop once, and coding quality is untested.
-->

# Benchmark: Ornith 1.5 on native Radiance vs Sly (Qwen3.8-27B, Qwen3.5-35B) — R9700 (gfx1201)

- **Date:** 2026-11-04 17:46 · **Track:** engine-bench, one-off (no campaign dir)
- **GPU/Host:** R9700, 32624 MiB, power cap 210 W (`MEASURED`, hwmon `power1_cap`), PCIe link limited to 8 GT/s x16 by the slot (Radiance boot log), kernel 7.0.0-38, CPU governor `powersave`, 31 GB RAM, 4.7 GiB swap
- **Runtimes:** `stilldeadcode/radiance:1.16.0` @ `sha256:b1017ce0e615…`; `ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1` @ `sha256:9744caf31e96…` (vLLM 0.32.0)
- **Models:** `keptn/ornith-1.5-35b-a3b-w4a8@cfed0f8f`; `RedHatAI/Qwen3.8-27B-MXFP4@16a86728` + `syvai/Qwen3.8-27B-DFlash2-W4A16@4d30ec73`; `amd/Qwen3.5-35B-A3B-MXFP4@2e19c657` + `z-lab/Qwen3.5-35B-A3B-DFlash@52cb554b`; `Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4@9e488f46` + `ornith-ai/Ornith-1.5-35B-A3B-DFlash@942d20fe`
- **Data:** `bench/runs/2026-11-04-1730-ornith15-w4a8-radiance/`, `bench/runs/2026-11-04-1740-27b-sly-baseline/`, `bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k/`, `bench/runs/2026-11-04-1802-ornith15-sly-dflash/`

## Summary

Ornith 1.5 w4a8 on native Radiance reached the target of about 200 t/s decode and 10k t/s prefill at 10k depth: 219.8 t/s and 13,059 t/s (`MEASURED`). Decode stays near 200 at 50k and falls to 174.5 at 100k, while prefill falls to 8,029 and 5,301 t/s. On the same probe that is 2.5x / 2.1x / 2.1x the decode of the 27B on Sly, which measured 87 / 96 / 82 t/s.

Sly cannot get there with Ornith. With Radiance's serving values and DFlash K=3 it measures 95.2 / 71.0 / 66.5 t/s and 3,802 / 3,122 / 2,604 t/s prefill, and MTP fails at load on `triton_unfused`, `triton` and `aiter`. The engines use different MoE backends and weights, so the same configuration is not possible (see Consequences).

Three caveats decide how far this goes. The configuration measured here left about 232 MiB of VRAM free and Chrome and GNOME Shell then crashed, so close Chrome if VRAM gets tight. Extra headroom is optional and its effect on speed has not been measured. Coding quality has not been tested at all.

## Legend

| Term | What it is | Effect on this box | How it's tested here |
|---|---|---|---|
| depth | Code-review prompt padded to about N tokens | Prefill falls with depth on all arms; see the fits | 10k / 50k / 100k fixtures, 3 reps each |
| `prefix_mode` unique | Every request gets a unique prefix, so nothing is cached | 0 cached tokens on the Sly arms (`MEASURED`); `cache 0` in the Radiance log | Probe flag |
| MTP | The model's own head drafts tokens | K=3 on Ornith: 50.0% accepted (1522/3042) (`MEASURED`) | Creator's `--num-speculative-tokens 3` |
| DFlash / DFlash2 | A separate small drafter model | K=7: 35.1% accepted on the 27B, 27.9% on the 35B (`MEASURED`) | `sly-redhat` and `sly-amd` profiles |
| `EMULATION` | vLLM MXFP4 MoE backend that dequantizes experts | 16.6 t/s decode on the 35B at 10k (`MEASURED`) | The default chosen on gfx1201 |
| `triton_unfused` | vLLM's unfused Triton MoE backend | 110.2 t/s on the 35B at 10k; activations fall back to BF16 (`MEASURED`, log) | `--moe-backend triton_unfused` |
| `--gpu-headroom-mib` | VRAM Radiance leaves unclaimed | Default 96 left 232 MiB free; desktop crashed (`MEASURED` values, cause `INFERRED`) | Not yet measured with another value |

## Results

All `MEASURED`. Mean of 3 requests, 256 tokens, temperature 1.0. Rows in `results.jsonl`, labels `<arm>-<depth>`. Memory columns are per run, not per depth.

| Config | ctx | Depth | KV | Drafter | Prefill t/s | Decode t/s | TTFT s | Full time s | Peak VRAM MiB | Min free MiB | Peak GTT MiB |
|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| **Ornith 1.5 w4a8, Radiance** | 262144 | 10k | fp8 | MTP K=3 | **13,059** | **219.8** | 0.78 | 1.94 | 32,511 | 113 | 339 ⚠ |
| | | 50k | | | **8,029** | **205.0** | 6.15 | 7.39 | | | |
| | | 100k | | | **5,301** | **174.5** | 18.48 | 19.95 | | | |
| Ornith 1.5 MXFP4, Sly, `triton_unfused` | 262144 | 10k | fp8 | DFlash K=3 | 3,802 | 95.2 | 2.75 | 5.45 | 31,510 | 1,114 | 78 |
| | | 50k | | | 3,122 | 71.0 | 15.81 | 19.45 | | | |
| | | 100k | | | 2,604 | 66.5 | 37.62 | 41.47 | | | |
| Ornith 1.5 MXFP4, Sly, MTP K=3 | 262144 | — | fp8 | MTP K=3 | **FAILED at load** on `triton_unfused`, `triton`, `aiter` | | | | | | |
| Qwen3.8-27B MXFP4, Sly | 262000 | 10k | fp8 | DFlash2 K=7 | 3,257 | 86.9 | 3.21 | 6.16 | 31,197 | 1,427 | 48 |
| | | 50k | | | 2,768 | 96.0 | 17.92 | 20.64 | | | |
| | | 100k | | | 2,402 | 82.5 | 40.90 | 44.01 | | | |
| Qwen3.5-35B MXFP4, Sly, `triton_unfused` | 262000 | 10k | fp8 | DFlash K=7 | 4,946 | 110.2 | 2.05 | 4.37 | 31,327 | 1,297 | 180 |
| | | 50k | | | 3,721 | 92.9 | 13.25 | 16.06 | | | |
| | | 100k | | | 3,175 | 67.3 | 30.85 | 34.65 | | | |
| Qwen3.5-35B MXFP4, Sly, `EMULATION` | 262000 | 10k | fp8 | DFlash K=7 | 5,739 | 16.6 | 1.77 | 17.1 | 31,597 | 1,027 | 279 |
| | | 50k | | | 4,740 | 15.4 | 10.41 | 27.1 | | | |
| | | 100k | | | 3,679 | 15.8 | 26.63 | 43.1 | | | |

⚠ 339 MiB of GTT is above this box's idle baseline. The Radiance log says the whole expert plane is resident, so a weight spill looks unlikely (`INFERRED`), but this was not traced.

| Config | Boot | KV capacity (log) | Tokens per step | Step time at 10k / 50k / 100k (`INFERRED`) |
|---|---:|---|---:|---|
| Ornith 1.5 w4a8, Radiance | 45 s | 992,288 tokens, 3.8 sessions at 262,144 | 2.50 | 11.4 / 12.2 / 14.3 ms |
| Ornith 1.5 MXFP4, Sly, DFlash K=3 | 587 s (first boot, includes kernel compile) | 612,807 tokens, 2.34x | 2.52 | 26.5 / 35.5 / 37.9 ms |
| Qwen3.8-27B, Sly | 176 s | 383,443 tokens, 1.46x | 3.45 | 39.7 / 35.9 / 41.8 ms |
| Qwen3.5-35B, Sly, `triton_unfused` | 399 s | 448,702 tokens, 1.71x | 2.95 | 26.8 / 31.8 / 43.9 ms |
| Qwen3.5-35B, Sly, `EMULATION` | not recorded here | 305,666 tokens, 1.17x | 2.88 | 173 / 187 / 182 ms |

Step time is tokens per step ÷ decode rate. Tokens per step is 1 + accepted ÷ drafts over the whole server run, including warm-up, and is applied to every depth.

**Decode vs depth (p50 per stream)**

![Decode vs depth](../../bench/runs/2026-11-04-1740-27b-sly-baseline/comparison/charts/depth_decode.svg)

> The chart plots p50 and the tables use means, so values differ slightly. The arms differ in model as well as engine, so the gap is not a pure engine comparison.

**Prefill vs depth (p50)**

![Prefill vs depth](../../bench/runs/2026-11-04-1740-27b-sly-baseline/comparison/charts/depth_prefill.svg)

> Ornith's lead narrows with depth because its prefill decays fastest. All arms are cold prefill, which a real cached conversation does not repeat on every turn.

### Depth fits

Log-log fits on p50 from `bench/lib/report.py`. **Three depths only**, one short of iron rule 16's minimum, so treat these as indicative. Valid for 10k–100k.

| Config | Prefill exponent | R² | Decode exponent | R² |
|---|---:|---:|---:|---:|
| Ornith 1.5 w4a8, Radiance | −0.383 | 0.968 | −0.104 | 0.893 |
| Qwen3.8-27B, Sly | −0.132 | 0.967 | +0.021 | 0.056 (no trend, noise) |
| Qwen3.5-35B, Sly, `triton_unfused` | −0.192 | 0.997 | −0.186 | 0.902 |
| Qwen3.5-35B, Sly, `EMULATION` | −0.184 | 0.908 | −0.077 | 0.962 |

## What moved the needle

All ratios derived from the `MEASURED` means above.

| Change | Prefill at 10k / 50k / 100k | Decode at 10k / 50k / 100k | Full time at 10k / 50k / 100k | Note |
|---|---|---|---|---|
| 27B on Sly → Ornith on Radiance | 4.0x / 2.9x / 2.2x | 2.5x / 2.1x / 2.1x | 3.2x / 2.8x / 2.2x faster | Model and engine both change |
| Ornith on Sly (DFlash K=3) → Ornith on Radiance (MTP K=3) | 3.4x / 2.6x / 2.0x | 2.3x / 2.9x / 2.6x | 2.8x / 2.6x / 2.1x faster | Same base model; engine, quantization and drafter change |
| 35B `EMULATION` → `triton_unfused` | −14% / −21% / −14% | 6.6x / 6.0x / 4.3x | 3.9x / 1.7x / 1.2x faster | Only the MoE backend changes |
| 27B → 35B `triton_unfused` (both Sly) | 1.5x / 1.3x / 1.3x | 1.27x / 0.97x / 0.82x | 1.4x / 1.3x / 1.3x faster | No 2x; slower decode at depth |

## Consequences & root causes

1. **The 35B slowdown on Sly is the `EMULATION` MoE backend.** With the same drafter and graph setup, changing only the backend takes each step from about 173 ms to 27 ms at 10k. (`MEASURED` correlation with one variable changed; step time `INFERRED`.) No AMD or vLLM source recommends `triton_unfused`, but the community card of `Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4` does, and warns that the default backend falls back to emulation on gfx12 (`CLAIMED`). The log says it runs BF16 activations rather than the checkpoint's quantized ones. Quality effect unmeasured.
2. **The no-drafter and MTP arms on Sly are not a fair baseline.** Their logs show `Capturing CUDA graphs (FULL): 0it`, so they ran without a captured full-model graph. `nospec` 6.2 t/s, `nospec-unfused` 8.7 t/s and `mtp-k4` 16.8 t/s therefore do not measure per-step backend cost. Why no graph was captured is **OPEN**.
3. **Radiance's lead comes from step time, not drafting.** Draft acceptance is about equal on the two Ornith arms: 50.0% with MTP K=3 on Radiance (1522/3042) and 50.6% with DFlash K=3 on Sly (1639/3237), or 2.50 and 2.52 tokens per step. Steps take about 11 ms on Radiance and 26 ms on Sly at 10k (`INFERRED` arithmetic), so the model is not the cause. What remains is the engine, MoE kernels, weights and activations together, and this data cannot split them (**OPEN**): Radiance runs 4-bit GPTQ experts with FP8 activations on `libr4d`, and Sly runs data-free MXFP4 with BF16 activations through `triton_unfused` (card and log values). The Qwen3.6 FP8 `.rad` test was cancelled because the 34.63 GiB file does not fit on one card.
4. **The 27B's ~100 t/s figure holds up approximately.** This cold probe gives 82.5–96.0 t/s means with no trend across depth, and individual requests range from 75.7 to 111.6. So 2x is reached on this probe at all three depths.
5. **Ornith's prefill advantage shrinks with depth but should not reverse inside the window.** The exponents imply parity with the 27B only far beyond 262k tokens. At 200k the fits give about 4,200 vs 2,200 t/s. Both figures are `INFERRED`: fit range 10k–100k, projected 2x past the data, from three points.
6. **Radiance's default headroom is unsafe beside a desktop.** It claims the card and left 232.52 MiB free at load (log), with 113 MiB free at peak in the samples. Chrome crashed at 17:32 and GNOME Shell at 17:33 (`/var/crash` timestamps, session restart in `ps`), about 7 minutes after the probe ended, with the server idle. The container was not OOM-killed. The VRAM cause is `INFERRED` from timing and from the same pattern in `docs/vllm/known-issues.md` (NVFP4 load peak). The crash reports and kernel log were not readable from this account, so a system RAM cause is not formally excluded, although about 9.6 GiB was available after the probe. The probe rows finished before the crash and are kept.
7. **Swap did not contribute.** The box has 4.7 GiB of swap, 566 MiB already used before the Ornith run. During the runs, traffic was 1 MiB in and 1 MiB out on Ornith, and 1 MiB in and 18 MiB out on the 27B (`vmstat`, `MEASURED`). The 35B arms had no `vmstat` logging. `CLAUDE.md` still says "no swap", which is out of date.
8. **Memory clock does not explain the gap.** Under load both new arms show the same distribution: p10 456, p50 772, p90 1258 MHz, median power 206–207 W.
9. **MTP does not load for this checkpoint on Sly (`MEASURED`, three boots).** Its experts are MXFP4 and its MTP layer's experts are unquantized BF16, and no usable backend serves both. `triton_unfused`: `not supported for unquantized MoE`. `triton`: `kernel does not support MoEActivation.SILU activation`. `aiter`: `AITER_TRITON_MXFP4_BF16 ... does not support current device rocm`. Only `EMULATION` is left, which was not tested because it ran the Qwen 35B at about 16 t/s. The first error is not evidence for vLLM's undocumented comment `TRITON_UNFUSED has bug with MTP support` ([#49446](https://github.com/vllm-project/vllm/issues/49446), open), which sits on the non-ROCm selection lists.
10. **The same configuration is not possible on both engines.** Sly is built on vLLM and `StillDeadcode/vllm-radiance`, and credits native Radiance only for one ported policy (`CLAIMED`, [README](https://github.com/SlyBase/vllm-sly-radiance)). Serving values carry over. The engine, model format, MoE backend and activations do not. Native Radiance's image contains no Python or vLLM, and no `.rad` loader was found in the Sly image (`MEASURED`, image inspection; loading was not attempted).

## Recommended config

Ornith on native Radiance. Close Chrome if VRAM gets tight (operator's choice, 2026-11-04). The 27B on Sly is stable as configured and needs no extra headroom.

```bash
./ornith_rad_mtp.sh start
```

Extra headroom is **recommended only, not required, and not measured**. It should reduce only the KV cache from 11.37 GiB to about 9.5 GiB, or roughly 3.1 sessions at 262k, because all weights stay on the card (`INFERRED`).

```bash
EXTRA_ARGS="--gpu-headroom-mib 2048" ./ornith_rad_mtp.sh start
```

The configuration that was actually measured, from the creator's `ornith-1.5-35b-a3b-w4a8-tp1.yaml`, plus local bind and a pinned image:

```bash
radiance --model /models/ornith-1.5-35b-a3b-w4a8.rad --host 127.0.0.1 --port 8000 \
  --tp 1 --max-num-seqs 8 --max-model-len 262144 --kv-cache-dtype fp8 \
  --num-speculative-tokens 3 --max-num-batched-tokens 2048 \
  --temp 1.0 --top-p 0.95 --top-k 20 --presence-penalty 1.5
```

Other 35B starters, both on Sly, slower and archived. The Ornith Sly checkpoints were deleted after the run; the fetch commands are in that script's header:

| Script | Serves | Decode t/s at 10k / 50k / 100k |
|---|---|---:|
| `bench/engine-bench/vllm/archive/ornith_sly_dflash.sh start` | Ornith 1.5 MXFP4 + official DFlash K=3 | 95.2 / 71.0 / 66.5 |
| `bench/engine-bench/vllm/archive/qwen35_sly_dflash.sh start` | Qwen3.5-35B MXFP4 + z-lab DFlash K=7, `triton_unfused` | 110.2 / 92.9 / 67.3 |

The `sly-amd` profile's default backend is still `EMULATION`; `qwen35_sly_dflash.sh` passes the override. The Ornith scripts take their port and served name from `~/.config/claude/local_vllm_direct/settings-redhat.json`, so `claude --settings` on that file works unchanged. Claude shows the 27B's name while Ornith answers.

## Methodology & caveats

- **Probe:** `capture_engine.py probe`, `--max-tokens 256 --temperature 1.0 --concurrency 1 --reps 3 --prefix-mode unique --api chat`, one untimed warm-up at the first depth. Fixtures `codereview-{10000,50000,100000}.txt`; tokenizers differ, so real prompts are 10.2k–10.4k / 49.3k–49.6k / 98.0k–98.2k. No failed or interrupted rows.
- **Not the agentic shape:** cold prefill at three depths. The growing-conversation test to 250k (iron rule 17) and an A/B/A prefix interleave were not run. Prefix reuse on Radiance is untested.
- **Coding quality is untested on Ornith 1.5.** One correct answer (391, `s[::-1]`) and one well-formed tool call are all the output checks. Ornith 1.0 scored 62.2% against Qwen3.6-35B-A3B's 73.3% in `campaigns/2026-07-19-ornith-vs-gemma/analysis.md`, but 1.5 is a different model.
- **Only the Ornith Sly arm uses Radiance's serving values.** It also sets `presence_penalty` 1.5, ctx 262144 and the same sampler. The 27B and Qwen 35B arms keep their Sly recipes. Its probe commands match the Radiance run except the `--engine` label and the client timeout. Where it still differs: drafter (MTP does not load), MoE backend, weights, util 0.93 against 96 MiB headroom, `RADIANCE_KV_GROUP_SIZE=2`, Cactus delta 0.

  | Setting (`cmdline.txt`) | Radiance, Ornith | Sly, Ornith | Sly, 27B | Sly, Qwen 35B |
  |---|---|---|---|---|
  | Drafter | MTP K=3 | DFlash K=3 | DFlash2 K=7 | DFlash K=7 |
  | `--max-num-seqs` | 8 | 8 | 1 | 1 |
  | `--max-num-batched-tokens` | 2048 | 2048 | 4096 | 4096 |
  | `RADIANCE_KV_GROUP_SIZE` | not set | 2 | 8 | 2 |

- **Excluded data:** the Ornith DFlash K=7 arm was stopped on request while starting and is quarantined as `ornith-k7-s8-INTERRUPTED`. The three MTP boots are kept as `ornith-mtp-k3-*FAILED*`. The depth charts and fits predate the Ornith Sly arm and do not include it.
- **Swap on the Ornith Sly arm:** `vmstat` sums to 1,931 MiB in and 3,996 MiB out across the run including boot, not split by phase, so finding 7 does not cover this arm.
- **Checks on the Ornith Sly arm:** sanity answer correct (391) and tool call well-formed (`read_file`, `{"path": "src/main.py"}`). No GPU faults in the log.
- **Not identical across arms:** the 27B used the production `dp-sharp` chat template, and Ornith its own. Both Ornith arms used the creator's `top_k 20` and `presence_penalty 1.5`. Ctx is 262144 on the Ornith arms and 262000 on the others. The 27B ran after the desktop restart with Chrome and PyCharm closed; the Radiance and Qwen 35B arms ran with them open; this was not recorded for the Ornith Sly arm.
- **Claude Code works on both Ornith scripts, on one smoke test each (`MEASURED`, `claude-smoke/`).** With the unchanged `settings-redhat.json`, `claude -p` used the Read tool and returned the file's marker: 2 turns, 3.7 s on Radiance and 10.5 s on Sly (318 s boot). Claude printed an `unrecognized_model` warning for the alias on Radiance. The Radiance smoke used `--gpu-headroom-mib 2048`, so it shows that setting boots and answers, and says nothing about its speed. No real coding session was run.
- **Headroom left for later:** Radiance's boot log also flags the 210 W cap, the `powersave` governor and the 8 GT/s link. None were changed.
- **Tooling:** `serve_vllm.sh` does not cover native Radiance, hence `ornith_rad_mtp.sh`. `report.py` reads depth only from `cr<N>` or `-d<N>` labels, hence `comparison/merge.py`, which relabels the aggregate rows without touching the originals. Suggested tool change: let `report.py` read depth from a numeric field instead of the label.

## External comparison

- **Ornith 1.5 w4a8:** decode 228.8 t/s on one card and prefill 10,323 t/s at 24k, median, R9700 at 215 W, radiance 1.8.1 plus PR #144 (`CLAIMED`, [model card](https://huggingface.co/keptn/ornith-1.5-35b-a3b-w4a8)). Our 219.8 t/s at 10k is close. Fidelity on the card: mean KL 0.0165 to bf16, top token match 96.2%.
- **MiniCPM-V 4.7 W4A16:** 169.4 t/s on one R9700 at 210 W and 64k, with "Qwen3.8 + DFlash2 production = 132.4 in the same window" (`CLAIMED`, [Sly doc](https://github.com/SlyBase/vllm-sly-radiance/blob/main/docs/MINICPM-V47.md)). That 132.4 is well above our cold-probe 27B numbers, on a different workload.
- **Ornith 1.5 MXFP4 on 2x R9700:** DFlash 92.5 t/s and plain 60.5 t/s on `triton_unfused`, about 22 t/s on emulation, with MTP K=3 losing to plain, short prompts at one client (`CLAIMED`, [model card](https://huggingface.co/Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4)). Our one-card 95.2 t/s at 10k is in the same range, on a different setup.
- **Single-card config:** [`ornith-1.5-35b-a3b-w4a8-tp1.yaml`](https://codeberg.org/StillDeadcode/radiance/src/branch/main/deploy/compose/ornith-1.5-35b-a3b-w4a8-tp1.yaml).
- **`triton_unfused` and MTP upstream:** [issue #49446](https://github.com/vllm-project/vllm/issues/49446) and [PR #54202](https://github.com/vllm-project/vllm/pull/54202), both open.
