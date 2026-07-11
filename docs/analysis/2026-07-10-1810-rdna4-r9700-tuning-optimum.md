<!-- meta
date: 2026-07-10 18:10
takeaway: 64K sweep: **llama.cpp Vulkan + MTP wins** (35B 2993 pf / 135.9 dec). ROCm→Vulkan +67%/+46%; MTP +29–132% decode; `-ub 512→2048` +21% prefill; `dpm=high` −15% (use `auto`). vLLM/HF not competitive.
-->

# RDNA4 / R9700 — llama.cpp · ollama tuning & backend optimum (64K)

- **Date:** 2026-07-10 18:10
- **GPU:** AMD Radeon AI PRO R9700 — gfx1201, RDNA4, 32 GB (31.86 GiB usable)
- **Host:** Ubuntu 24.04, 31 GB RAM (no swap), PCIe ASPM = `performance`, `power_dpm_force_performance_level = auto`
- **Context:** 64K (65 536) for **every** run · prompt ≈ **6 990 tokens** (code-review prompt, unique-prefixed to defeat prefix cache) · decode = 256 tokens · single stream
- **Models:** `Qwen3.6-35B-A3B` (MoE, ~3B active) · `Qwen3.6-27B` (SSM/Mamba-Transformer hybrid, MTP-capable), both GGUF Q4
- **Harness:** `bench/harness/*.sh` + `bench/harness/probe.py` (runtime-native timings) — see [Reproducing](#reproducing)
- **Companion research:** [`docs/research/2026-07-10-rdna4-llamacpp-ollama-backend-tuning.md`](../research/2026-07-10-rdna4-llamacpp-ollama-backend-tuning.md)

---

## 1. TL;DR — the optimum

**llama.cpp + Vulkan (RADV / Mesa) is the winning backend for both models — by a wide margin — and MTP
speculative decode is the single biggest decode win on each.** vLLM is **not competitive** on RDNA4 (§3.9).

> **All numbers below were re-verified in a final pass at `power_dpm_force_performance_level=auto`
> (the canonical state), same harness, same 64K/~6990-tok prompt, 256-token decode.** Values reproduce the
> earlier runs within ±3 %. `dpm=high` was tested and is *slower* — do not use it (§3.8).

### 35B-A3B (MoE) — 64K, prefill / decode tok/s
| Runtime · backend | best config | prefill | decode | VRAM |
|---|---|---:|---:|---:|
| **llama.cpp · Vulkan + MTP** 🏆 | `-ub 2048 -b 8192 f16 --spec-type draft-mtp` · **MTP-GGUF** | 2993 | **135.9** | 25.1 GB |
| **llama.cpp · Vulkan (RADV)** | `-ub 2048 -b 8192 -fa on -ctk/-ctv f16` | **3221** | 114.3 | 22.6 GB |
| llama.cpp · ROCm/HIP (b1295) | `-ub 2048 -b 8192 -fa on -ctk/-ctv f16` | 1927 | 78.4 | 22.9 GB |
| ollama · ROCm 7.2 | `num_batch 2048`, q8 KV | 2882 | 63.2 | 22.4 GB |
| vLLM 0.19.1 · ROCm (AWQ) | `--dtype float16` (fp16 KV) | 1048 | **19.7** ⚠️ | 29.2 GB |

→ **Vulkan beats llama.cpp-ROCm by +67 % prefill / +46 % decode, ollama by +12 % / +81 % decode, and vLLM by ~3×/~6×.**
**MTP** (on the MTP-preserved GGUF) lifts decode to **135.9** (+29 % same-model) — the top 35B decode. Pick the plain
Vulkan row if you want max prefill on the faster HauhauCS blob; the MTP row for max decode.

### 27B (SSM hybrid) — 64K
| Runtime · backend | best config | prefill | decode | VRAM |
|---|---|---:|---:|---:|
| **llama.cpp · Vulkan (RADV) + MTP** 🏆 | `-ub 2048 -b 8192 f16 --spec-type draft-mtp` | 854 | **73.5** | 23.4 GB |
| llama.cpp · ROCm (b1295) + MTP | `-ub 2048 -b 8192 f16 --spec-type draft-mtp` | 790 | 51.8 | 23.9 GB |
| ollama · ROCm 7.2 | `num_batch 2048`, q8 KV | **1065** | 27.0 | 18.6 GB |
| llama.cpp · Vulkan (RADV), no MTP | `-ub 2048 -b 8192 f16` | 906 | 31.7 | 20.8 GB |
| llama.cpp · ROCm/HIP (b1295), no MTP | `-ub 2048 -b 8192 f16` | 888 | 29.0 | 21.0 GB |
| vLLM 0.19.1 · ROCm | — | — | **LOAD_FAIL** ⚠️ | — |

→ 27B is **matmul/scan-bound**: insensitive to `-ub`/`num_batch`, so **decode is the only lever — and MTP on Vulkan
wins big: 73.5 tok/s (2.3× the non-MTP Vulkan)** while keeping prefill at 854 (82 % draft acceptance). Pick ollama
only if you need max prefill (1065) and don't care about decode. vLLM can't load it at all (group_size=32 kernel gap, §3.9).

All llama.cpp/ollama configs fit **well under the 30 GB ceiling** at 64K with **both** KV precisions — nothing was excluded for VRAM.

---

## 2. What moved the needle (deltas)

| Lever | Model | Effect | Note |
|---|---|---|---|
| **Backend: ROCm→Vulkan (RADV)** | 35B | **prefill +67 %, decode +46 %** | biggest single win; RADV has native gfx1201 shaders |
| **MTP speculative decode** | 27B | **decode +132 %** on Vulkan (31.7→73.5), +79 % on ROCm | llama.cpp only; 82 % draft acceptance |
| **MTP speculative decode** | 35B | **decode +29 %** on Vulkan (105→135.9) | needs the MTP-GGUF; 56 % draft acceptance |
| **`-ub` 512→2048** | 35B | prefill +21 % | MoE benefits; knee at 2048, regresses ≥8192 |
| **`-b` 2048→8192** (at ub2048) | 35B | prefill +10 % | prompt fits one 8192 logical batch; b16384 no better |
| **ollama `num_batch` 512→2048** | 35B | prefill +39 % | ollama's *only* prefill knob (= `-b`, default 512) |
| **`-ub` / `-b` / `num_batch`** | 27B | ≈ 0 % (±3 %) | dense/SSM already saturates matmul |
| **KV f16 vs q8** | both | decode +2–5 %, +0.5–2 GB VRAM | f16 slightly faster decode; q8 for headroom |

---

## 3. Sweeps in detail

### 3.1 llama.cpp `-ub` micro-batch sweep (ROCm b1295, f16 KV, 64K)
| -ub | -b | 35B prefill | 35B decode | 27B prefill | 27B decode |
|---:|---:|---:|---:|---:|---:|
| 512  | 2048 | 1434 | 77.3 | 835 | 29.0 |
| 1024 | 2048 | 1702 | 76.9 | 858 | 28.9 |
| 2048 | 2048 | 1731 | 76.4 | 865 | 28.8 |
| 4096 | 4096 | **1812** | 75.8 | 839 | 28.8 |
| 8192 | 8192 | 1600 | 72.2 | 849 | 28.8 |

- **35B (MoE):** prefill rises 512→4096 (peak 1812) then **regresses at 8192** (ub > prompt length = wasted buffers, and decode drops as compute buffers grow). Decode is mildly *inversely* related to ub (77→72).
- **27B (SSM):** essentially flat — **`-ub` does nothing for this model.** This directly **refutes the "ub 32/64 is fastest on RDNA4" folklore** (our earlier baseline: ub32=529 → ub512=1489 → here ub4096=1812).

### 3.2 llama.cpp `-b` logical-batch sweep (ub 2048 fixed, f16 KV)
| -b | 35B prefill | 27B prefill |
|---:|---:|---:|
| 2048  | 1753 | 878 |
| 8192  | **1928** | 860 |
| 16384 | 1861 | 860 |

- **35B: `-b 8192` is the sweet spot (+10 % over b2048).** Our ~7K prompt fits in a single 8192-token logical batch, so `-b 16384` (the community R9700 recommendation) gives **no** extra benefit here and is marginally slower. → **`-ub 2048 -b 8192` is the ROCm 35B optimum.**
- **27B: no effect** (matmul-bound).

### 3.3 Backend comparison (ub2048 / b8192 / f16 KV, identical GGUF)
| Backend | 35B prefill | 35B decode | 27B prefill | 27B decode |
|---|---:|---:|---:|---:|
| **Vulkan RADV (b9950, warm)** | **3221** | **114.3** | 906 | **31.7** |
| ROCm/HIP (lemonade b1295) | 1927 | 78.4 | 888 | 29.0 |
| ROCm 7.2 official (b9950) | *CPU fallback* | — | — | — |

*(Numbers refreshed from the final dpm=auto verification pass; within ±3 % of the earlier warm runs.)*

- **Vulkan/RADV wins decisively on the MoE** (prefill +63 %, decode +46 %) and edges the dense 27B on decode (+10 %) while tying on prefill — exactly the model-dependent pattern the research predicted ("Vulkan wins MoE + decode; ROCm ties on dense prefill").
- ⚠️ **Warm vs cold:** RADV compiles SPIR-V pipelines on first inference. The *first* probe on a cold shader cache reported 35B prefill = 2320; once cached, three consecutive runs gave **2819 / 3137 / 3160** and decode **111 / 113**. The harness now runs a warm-up probe before measuring Vulkan (`run_vk_warm.sh`). ROCm needs no warm-up (kernels are precompiled).
- ⚠️ **Official ROCm 7.2 build ran on CPU** (47 tok/s prefill, VRAM idle): the release tarball ships only `libggml-hip.so` with **no bundled ROCm runtime**, and it couldn't bind a gfx1201-capable rocBLAS/hipBLASLt from the system → silent CPU fallback. The **lemonade b1295 build works because it bundles its own ROCm 7.15 runtime** (libamdhip64/rocblas/hipblaslt).

### 3.4 ollama `num_batch` sweep (q8 KV, FA on, 64K)
| num_batch | 35B prefill | 35B decode | 27B prefill | 27B decode |
|---:|---:|---:|---:|---:|
| 512  | 2072 | 62.4 | 1013 | 26.8 |
| 1024 | 2713 | 63.0 | 1036 | 26.8 |
| 2048 | **2882** | 63.2 | 1025 | 26.8 |

- **`num_batch` is ollama's only prefill lever** (= llama.cpp `-b`; there is **no ubatch knob and no `OLLAMA_NUM_BATCH` env**). Raising the default 512→2048 gives **+39 % prefill on the 35B**; the 27B is flat.
- ollama's ROCm 7.2 prefill (2882) is **~1.5× the llama.cpp-ROCm b1295 prefill (1928)** at the same work — strong evidence the **b1295 build carries the known RDNA4 `CUBLAS_COMPUTE_32F` prefill regression (llama.cpp #12764)** that ollama's build avoids.

### 3.5 `OLLAMA_VULKAN=1` — did not switch backends
Setting `OLLAMA_VULKAN=1` did **not** move ollama to Vulkan: the serve log reports
`library=ROCm compute=gfx1201 libdirs=ollama,rocm_v7_2`. ollama 0.31.2 **bundles a gfx1201-capable ROCm 7.2** and its scheduler keeps ROCm when it works (the numbers are identical to ollama-ROCm: 2983/62.5). Forcing ollama onto Vulkan would require disabling the ROCm device (e.g. `ROCR_VISIBLE_DEVICES=""`) — not pursued, since llama.cpp already proves the RADV advantage and ollama's decode kernels (63) are the weak point regardless of backend.

### 3.6 KV 8-bit vs 16-bit (baseline, both fit at 64K)
Both precisions fit comfortably under 30 GB at 64K. **f16 KV is ~2–5 % faster decode** than q8_0 for ~0.5–2 GB more VRAM (35B: 77.3 vs 75.5; 27B: 28.9 vs 28.2). Use **f16 for speed, q8 for headroom** — the difference is small. (Prefill is unaffected by KV precision.)

### 3.7 MTP on the 35B MoE — a solid +29 % decode (verified @ auto)
Using the MTP-preserved `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` (UD-Q4_K_M), same-model A/B on Vulkan, **dpm=auto**:
| 35B config (Vulkan, ub2048/b8192/f16) | prefill | decode | draft acc. |
|---|---:|---:|---:|
| no MTP (MTP-GGUF) | 3288 | 105.0 | — |
| **+ MTP** | 2993 | **135.9** | 160/285 = 56 % |

- **MTP gives +29 % decode on the 35B** (105.0→135.9) for −9 % prefill — the **top 35B decode of any config**, though a smaller relative win than the 27B's +132 % (draft acceptance is only **56 %** vs 82 % on the 27B, because the 3B-active MoE already decodes fast and is less latency-bound per token).
- The two 35B GGUFs differ: the **HauhauCS** blob has faster *base* decode (114.3 no-MTP) than the **unsloth UD** blob (105.0), but only the UD blob preserves the MTP tensors. Net best decode = **UD + MTP = 135.9**; net best prefill = **HauhauCS = 3221**. The ROCm b1295 build **hung loading this GGUF's MTP tensors** — use the Vulkan build for 35B MTP.
- ⚠️ Earlier draft of this section reported 127.0 at `dpm=high`; the auto figure (135.9) supersedes it.

### 3.8 ⚠️ `power_dpm_force_performance_level=high` is *slower* here (revert to `auto`)
Clean same-config A/B (GPU cool at 53 °C, so **not** thermal throttling), high vs the earlier `auto` runs:
| config | auto | high | Δ |
|---|---:|---:|---:|
| 35B Vulkan (HauhauCS) | 3137 / 113 | 2514 / 100.8 | **−20 % pf / −11 % dec** |
| 27B Vulkan + MTP | 843 / 72.2 | 721 / 67.7 | −14 % / −6 % |

- **`high` consistently *lost* ~15 %.** On this single-stream workload `auto` already boosts to peak under load, while forcing `high` appears to pin a fixed, lower-boost P-state (mclk capped at 1258 MHz). The research's "+14 % on 80B MoE" does not generalise to this GPU/workload.
- **Recommendation: keep `auto`.** `echo auto | sudo tee /sys/class/drm/card*/device/power_dpm_force_performance_level`
- ⚠️ All §3.8 numbers were taken at `high`; the canonical optimum tables in §1 use the better `auto` state.

### 3.9 ⚠️ vLLM on RDNA4 — not competitive (CPU/launch-bound decode; gfx1201 unsupported)
vLLM 0.19.1 on ROCm 7.13 (`rocm/vllm` image, PyTorch 2.10), AWQ / compressed-tensors weights, 64K:
| model | KV | prefill | decode | VRAM | outcome |
|---|---|---:|---:|---:|---|
| 35B-A3B-AWQ | fp8 | 545 | **8.6** | 29.3 GB | runs, ~13× slower than Vulkan |
| 35B-A3B-AWQ | fp16 | 1048 | **19.7** | 29.2 GB | runs, ~6× slower than Vulkan |
| 27B (compressed-tensors uint4 **g32**) | — | — | **LOAD_FAIL** | — | no kernel supports group_size=32 |

**Root cause of the slow decode — measured, not guessed:**
- **It is not Docker / not the RAM cap.** A/B with the container memory cap relaxed 26 GB→30 GB changed decode by <10 % (19.7→21.3); the container used only **5.8 GB** host RAM. Ruled out.
- **It is CPU / kernel-launch-overhead bound.** During decode the GPU draws only **50–150 W** (of ~300 W) with low utilisation, while **~2 CPU cores peg at 100 %** — the GPU sits idle between tokens waiting on the host. No RDNA4-tuned fused MoE/AWQ kernels + weak HIP-graph capture.
- **fp8 KV is *slower* than fp16** here (8.6 vs 19.7) — the fp8 path is unoptimised and only adds overhead.
- **27B won't load at all:** `Group size (32) not supported by ConchLinearKernel (supports [-1, 128])` + `ExllamaLinearKernel: uint4 not supported`. The model's group_size=32 has no matching ROCm kernel.

**This is a known, unresolved state — confirmed by upstream issues (web research):**
- **gfx1201 is not in vLLM's official kernel support** (vLLM 0.19–0.20) nor AITER's arch table; FP8 silently falls back, AITER must be disabled (`VLLM_ROCM_USE_AITER=0`). [ROCm/aiter#3294], [vllm#28649]
- The **bimodal / low-util decode on R9700** is reported and unfixed. [ROCm#6347], [vllm#40081]
- MoE kernels are tuned for MI300, **no RDNA4 fused-MoE** path. [ROCm vLLM MoE blog]
- Community consensus & benchmarks: **llama.cpp/Vulkan is the production path on RDNA4**, ~20–29 % faster than even a working vLLM. [ggml-org/llama.cpp#21043]

**Verdict: do not use vLLM for these models on R9700.** Getting it merely *running* needs AITER disabled, FP8-WMMA patches, group_size=128 repacks, and patched container images — and even then it loses to llama.cpp/Vulkan. Revisit only when gfx1201 lands in official vLLM/AITER kernels.

### 3.10 transformers / "unsloth-family" (HF `generate()` on ROCm) — both fail to load
Best-effort path loading the AWQ weights via `AutoModelForCausalLM.from_pretrained(..., device_map="cuda")` in the same ROCm container:
| model | outcome |
|---|---|
| 35B-A3B-AWQ | **FAIL** — `Loading an AWQ quantized model requires gptqmodel` (dep not in the image; no autoawq/gptqmodel ROCm build bundled) |
| 27B (compressed-tensors) | **FAIL** — `QuantizationArgs: strategy group requires group_size to be positive` (same g32 quant that vLLM rejected) |

- Neither model runs through plain transformers on this image without adding a ROCm-built `gptqmodel`/`autoawq`, and the 27B's group quant is malformed for the loader. **Not a viable path as-is** — and even if patched, it would inherit the same CPU-bound decode as vLLM (§3.9). For 4-bit on RDNA4, **use the GGUF + llama.cpp/Vulkan path** instead.

---

## 4. Exact optimum configurations (per runtime)

### 4.1 llama.cpp — **Vulkan / RADV** (recommended for BOTH models) 🏆
Build: **ggml-org release b9950**, `ubuntu-vulkan-x64` (dir `bench/llamacpp-vulkan/`); driver: **Mesa RADV 25.2.8**.
```bash
VK=bench/llamacpp-vulkan          # the Vulkan llama.cpp build dir
LD_LIBRARY_PATH=$VK $VK/llama-server \
  -m <MODEL>.gguf \
  --host 127.0.0.1 --port 8899 \
  -c 65536 -ngl 99 \
  -b 8192 -ub 2048 \
  --flash-attn on -ctk f16 -ctv f16 \
  --parallel 1 --no-webui
# NB: first inference compiles SPIR-V shaders (one-time ~10 s); all numbers are warm-state.
```
**Per-model results (dpm=auto, 64K, ~6990-tok prompt / 256-tok decode):**

| MODEL (GGUF) | extra flags | prefill | decode | VRAM |
|---|---|---:|---:|---:|
| `Qwen3.6-35B-A3B-…-HauhauCS-…-Q4_K_M` | *(none — max prefill)* | 3221 | 114.3 | 22.6 GB |
| `Qwen3.6-35B-A3B-UD-Q4_K_M` (MTP-GGUF) | `--spec-type draft-mtp --spec-draft-n-max 3` | 2993 | **135.9** | 25.1 GB |
| `Qwen3.6-27B-Q4_K_S` | *(none)* | 906 | 31.7 | 20.8 GB |
| `Qwen3.6-27B-Q4_K_S` | `--spec-type draft-mtp --spec-draft-n-max 3` | 854 | **73.5** | 23.4 GB |

- **Max decode** ⇒ add `--spec-type draft-mtp --spec-draft-n-max 3` (MTP). For the 35B this **requires the MTP-preserving `UD-Q4_K_M` GGUF** (the HauhauCS blob has no MTP tensors); the 27B GGUF is already MTP-capable.
- **Max 35B prefill** ⇒ the HauhauCS blob without MTP (3221).

### 4.2 llama.cpp — **ROCm/HIP** (lemonade b1295, self-contained runtime)
Build: **lemonade b1295 gfx120X** (dir `bench/llamacpp/`), bundles its own ROCm 7.15 runtime — **use this, not the
ggml-org ROCm release b9950, which ships no runtime and silently falls back to CPU** (§3.3). Slower than Vulkan; use only if Vulkan is unavailable.
```bash
LC=bench/llamacpp
LD_LIBRARY_PATH=$LC $LC/llama-server \
  -m <MODEL>.gguf --host 127.0.0.1 --port 8899 \
  -c 65536 -ngl 99 \
  -b 8192 -ub 2048 \            # 35B MoE optimum; 27B is insensitive (b2048/ub2048 equally fine)
  --flash-attn on -ctk f16 -ctv f16 \
  --parallel 1 --no-webui
# dpm=auto:  35B: 1927 / 78.4 · 27B: 888 / 29.0
# 27B + MTP (--spec-type draft-mtp --spec-draft-n-max 3): 790 / 51.8
# ⚠️ b1295 HANGS loading the 35B MTP-GGUF's MTP tensors — do 35B-MTP on the Vulkan build (§4.1).
```

### 4.3 ollama — ROCm 7.2 (bundled)
```bash
OLLAMA_FLASH_ATTENTION=1 \
OLLAMA_KV_CACHE_TYPE=q8_0 \
OLLAMA_CONTEXT_LENGTH=65536 \
OLLAMA_NUM_PARALLEL=1 \
OLLAMA_MAX_LOADED_MODELS=1 \
ollama serve
# per request / Modelfile:  PARAMETER num_batch 2048   (both models; 27B is insensitive)
# dpm=auto:  35B: 2882 / 63.2 · 27B: 1065 / 27.0   (q8_0 KV)
```
ollama is the **easiest fast-prefill option** and its bundled ROCm 7.2 is well-targeted for gfx1201, but its **decode is the weakest** (63 vs Vulkan's 114 on the 35B) and it exposes no ubatch/MTP control. `OLLAMA_VULKAN=1` does **not** switch it to Vulkan (§3.5).

### 4.4 vLLM 0.19.1 — ⚠️ NOT recommended on RDNA4 (documented for completeness)
Runs the 35B-AWQ but decode is **6–13× slower** than Vulkan (CPU/launch-bound, §3.9); the 27B won't load. Command that reproduces the (slow) 35B result:
```bash
docker run --rm --device /dev/kfd --device /dev/dri \
  --group-add 992 --group-add 44 --ipc=host --shm-size=8g \
  -e HSA_OVERRIDE_GFX_VERSION=12.0.1 -e VLLM_ROCM_USE_AITER=0 \
  -v <AWQ_DIR>:/model:ro -p 8000:8000 \
  rocm/vllm:rocm7.13.0_gfx120X-...vllm_0.19.1 \
  vllm serve /model --served-model-name m --quantization awq --dtype float16 \
  --max-model-len 65536 --gpu-memory-utilization 0.92
# 35B-AWQ fp16 KV: 1048 prefill / 19.7 decode (vs Vulkan 3221 / 114).  Use llama.cpp instead.
```

---

## 5. Cross-runtime picture

- **Prefill (35B):** Vulkan 3221 ≳ ollama 2882 ≫ llama.cpp-ROCm 1927 ≫ vLLM 1048.
- **Decode (35B):** **Vulkan+MTP 136 > Vulkan 114** ≫ llama.cpp-ROCm 78 > ollama 63 ≫ **vLLM 20 / transformers-HF ✗**.
- **35B verdict:** **llama.cpp + Vulkan wins everything** — plain for max prefill (3221), +MTP on the UD-GGUF for max decode (136).
- **27B verdict:** **llama.cpp + Vulkan + MTP wins overall** (854 prefill / **73.5** decode) — best decode *and* near-best prefill. Pick ollama only for max prefill (1065) with no decode care; vLLM/transformers can't even load it.
- The dense/SSM 27B decodes ~3–4× slower than the 3B-active MoE 35B — the MoE is the better interactive-coding model on this GPU.
- **vLLM & transformers-HF are dead ends on RDNA4 today** (§3.9–3.10): gfx1201 is unsupported upstream, decode is CPU-bound, and the 4-bit quant kernels are missing. **Stay on GGUF + llama.cpp/Vulkan.**

---

## 6. Status — all planned cases complete

Every runtime × model case has now been measured (or its failure precisely characterised), all at `dpm=auto`:

| Case | Status |
|---|---|
| llama.cpp Vulkan (35B/27B, ±MTP) | ✅ done — the optimum (§1, §4.1) |
| llama.cpp ROCm b1295 (35B/27B, ±MTP) | ✅ done (§4.2) |
| ollama ROCm 7.2 (35B/27B) | ✅ done (27B re-verified 1065/27; 35B 2882/63) |
| MTP on Vulkan (27B **and** 35B) | ✅ done — 73.5 / **135.9** decode (§3.7) |
| `dpm=high` A/B | ✅ done — **it *hurts* ~15 %; keep `auto`** (§3.8) |
| vLLM 0.19.1 (35B-AWQ, 27B) | ✅ done — **not competitive / 27B won't load** (§3.9) |
| transformers-HF (35B/27B AWQ) | ✅ done — **both fail to load** (§3.10) |

**Nothing actionable remains for these models on this GPU.** Optional future work only if the ecosystem moves:
- Re-test **vLLM** once **gfx1201 lands in official vLLM/AITER kernels** (today it needs AITER off + FP8-WMMA patches + g128 repacks and still loses).
- Try a **group_size=128** AWQ/GPTQ repack of the 27B if a vLLM path is ever needed.

---

## 7. Reproducing <a name="reproducing"></a>

All scripts are version-controlled under `bench/harness/` and write JSONL via the shared `probe.py`
(runtime-native timings; `ignore_eos` forces exactly 256 decode tokens so rates can't blow up on early EOS).

| Script | What it does |
|---|---|
| `config.sh` | central config (paths, CTX=65536, VRAM ceiling, model registry) |
| `run_ub_sweep.sh` | llama.cpp `-ub` 512→8192 sweep, both models |
| `run_b_sweep.sh` | llama.cpp `-b` 2048→16384 sweep at ub2048 |
| `run_backend.sh` | any llama.cpp build (ROCm / Vulkan) at a fixed config |
| `run_vk_warm.sh` | Vulkan measurement with a warm-up probe (fair prefill) |
| `run_ollama_batch.sh` | ollama `num_batch` 512/1024/2048 sweep |
| `run_ollama_vulkan.sh` | `OLLAMA_VULKAN=1` A/B (documents backend selection) |
| `run_mtp_backend.sh` | 27B MTP speculative decode, Vulkan vs ROCm, matched config |
| `run_llama_final.sh` | **consolidated verify+MTP batch @ auto** (Vulkan/ROCm × 35B/27B ± MTP) — reads dpm from sysfs |
| `run_rocm_verify.sh` | ROCm re-verify on the b1295 (`$LC`) build (b9950 falls back to CPU) |
| `run_ollama_clean.sh` | monitored ollama re-import + nb2048 probe (visible create, timeouts) |
| `run_vllm.sh` · `run_vllm27.sh` · `ab_vllm.sh` | vLLM AWQ sweep · 27B auto-quant retry · Docker-vs-kernel A/B |
| `run_unsloth.sh` | transformers-HF `generate()` on AWQ (both models) |
| `show.py` / `fixup.py` / `del_rows.py` | format / post-process / prune results |

**Data files:** `bench/harness/results_2026-07-10_1548.jsonl` (baseline: KV 8/16, MTP) ·
`bench/harness/results_tuning_2026-07-10_1714.jsonl` (ub/b sweeps, backends, num_batch, MTP@auto, vLLM) ·
transformers-HF rows in `bench/harness/results.jsonl`.

**Builds:** llama.cpp ROCm = lemonade **b1295** gfx120X (bundled ROCm 7.15, dir `bench/llamacpp/`) · llama.cpp Vulkan = ggml-org
release **b9950** (dir `bench/llamacpp-vulkan/`) · ollama **0.31.2** (bundled ROCm 7.2) · Mesa RADV **25.2.8** ·
vLLM **0.19.1** + ROCm **7.13** rc2 + PyTorch **2.10** (`rocm/vllm` image, gfx120X).

**Environment gotchas hit during this session (for faithful reproduction):**
- Models live on an internal backup partition (`/dev/sdb4`) mounted `700 bip` → the `dev` user can't read it. Grant access with `sudo setfacl -m u:dev:rx /mnt/LinBackup && sudo setfacl -R -m u:dev:rX /mnt/LinBackup/models` (host llama.cpp/ollama run as `dev`; Docker runs as root and bypasses this).
- Docker: set `data-root` **and** `TMPDIR` to a path on a disk with space (a stale systemd `TMPDIR=` pointing at an unmounted drive breaks every `docker run`). The vLLM image is **50 GB**; ensure the root disk has headroom before pulling.
- The ggml-org **ROCm b9950** release runs on **CPU** (no bundled runtime) — always use the lemonade **b1295** build for ROCm.
