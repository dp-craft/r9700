<!-- meta
date: 2026-07-10
takeaway: Batch/backend tuning: prefill scales with `-ub` up to ~2048 (not 32/64); RADV often beats ROCm on RDNA4; ollama has no ubatch knob (only `num_batch`); rocWMMA FA needs ROCm ≥7.
-->

# RDNA4 (gfx1201 / R9700) llama.cpp + ollama Backend & Tuning Research

**Date:** 2026-07-10
**Hardware:** AMD Radeon AI PRO R9700 — gfx1201, RDNA4, 32 GB (~31.86 GiB usable)
**Software:** Ubuntu 24.04, ROCm 7.x, `HSA_OVERRIDE_GFX_VERSION=12.0.1`
**Models under test:** Qwen3.6-35B-A3B (MoE, 3B active) and Qwen3.6-27B (dense), both GGUF Q4, 64K context
**Runtimes:** llama.cpp (b1295 gfx120X ROCm/HIP build) and ollama
**Our own measurements (baseline):**
- llama.cpp prefill scales *up* with `-ub`: ub32 = 529 → ub64 = 681 → ub512 = 1489 tok/s (35B)
- ollama prefill ≈ 2× llama.cpp on the same GGUF: 2975 vs 1489 tok/s (35B)

> This is a **web-research** document. No GPU work was performed. All numbers below are from
> third-party sources on RDNA4/gfx1201 hardware (R9700, RX 9070, RX 9070 XT) and are cited in the
> Sources section. Treat them as directional; our own hardware sweep is the source of truth.

---

## TL;DR — Recommended configs

### llama.cpp (ROCm/HIP, fully on GPU)
```
llama-server \
  -m <model>.gguf \
  -ngl 99 \
  -c 65536 \
  -b 16384 -ub 2048 \        # big logical batch + large micro-batch → best prefill
  -fa on \                    # flash attention (also unlocks KV quant)
  -ctk q8_0 -ctv q8_0 \       # 64K KV fits comfortably in 32 GB at q8
  --parallel 1 \              # single-stream = max prefill/tok
  --no-mmap                   # force full VRAM residency (optional, minor)
```
- **Prefill keeps improving as `-ub` rises to ~2048** on RDNA4 — this matches our own sweep and
  directly contradicts the "ub 32/64 is fastest on RDNA4" claim. Expect a **plateau near 1024–2048**
  and diminishing/negative returns at 4096 (VRAM pressure, no more MFMA/WMMA occupancy to gain).
- **MoE offload flags (`-ot`/`--override-tensor`, `--n-cpu-moe`, `--cpu-moe`) are irrelevant here** —
  they only matter when spilling expert tensors to CPU/RAM. We run fully on GPU, so leave them off.

### ollama
```
# environment (service-wide)
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_CONTEXT_LENGTH=65536
OLLAMA_NUM_PARALLEL=1
# per-model (Modelfile or API options) — ollama has NO ubatch knob:
PARAMETER num_batch 2048     # or options.num_batch=2048 via API
PARAMETER num_ctx 65536
```
- ollama exposes **only `num_batch`** (= llama.cpp `n_batch`/`-b`). There is **no separate ubatch
  control and no `OLLAMA_NUM_BATCH` env var.** Raise `num_batch` from its default 512 → 1024/2048.

### Should you test Vulkan? **Yes.** RDNA4 ROCm support is new/immature; RADV (Mesa) has native
gfx1201 shaders and frequently matches or beats ROCm — especially for MoE/decode. It is a cheap,
high-upside experiment on this exact GPU class.

---

## 1) llama.cpp performance tuning on RDNA4 / gfx1201 / ROCm 7

### `-b` (logical batch) vs `-ub` (physical micro-batch)
llama.cpp uses **two-level batching**:
- **`-b` / `--batch-size` (`n_batch`)** — the *logical* batch: how many new tokens are submitted to
  the graph / accepted into the KV cache in one prompt-processing step. Default **2048** in current
  llama.cpp (ollama still pins it to 512). Must be ≥ 32 or the BLAS prefill kernels aren't used.
- **`-ub` / `--ubatch-size` (`n_ubatch`)** — the *physical* micro-batch: how that logical batch is
  chopped into GPU forward passes. This is the knob that sets **GPU compute granularity** and thus
  matmul (rocBLAS/hipBLASLt/WMMA) efficiency. Default **512**.
- Relationship: `n_ubatch ≤ n_batch`. A large `-b` lets you feed a long prompt in fewer logical
  steps; a large `-ub` makes each GPU matmul bigger and more efficient (better MFMA/WMMA occupancy),
  which is what actually raises **prefill (pp) throughput**. Larger `-ub` costs peak VRAM during
  prefill.

### Does raising `-ub` past 512 keep helping? Where does it plateau?
**Yes, up to ~2048 on RDNA4.** Community RDNA4 tuning on the *exact* R9700 (Discussion #21043) found
the optimal combo **`-b 16384 -ub 2048`**:
- 35B MoE prefill pp2048: **2381 → 3074 tok/s (+29%)**
- 27B dense prefill pp2048: **799 → 823 tok/s (+3%)**
- decode (tg) unchanged.

The gfx1151 (Strix Halo) prefill-defaults issue (#21284) independently lands on
`--batch-size 2048 --ubatch-size 2048` as the good operating point (and shows kernel-level prefill
gains of ~20% from MMQ tuning). The recurring theme across RDNA3.5/RDNA4 ROCm reports is
**"bigger batch/ubatch → better prefill,"** the opposite of the "ub 32/64 is fastest" folklore.

> **Origin of the ub 32/64 myth:** it appears to come from Strix Halo (gfx1151) APU threads where
> *bad defaults* hurt prefill; the actual fix there was to **raise** batch/ubatch to 2048, not lower
> it. It does not apply to a discrete 32 GB RDNA4 card. Our own 529→681→1489 sweep confirms it's
> wrong for the R9700.

**Practical guidance:** sweep `-ub ∈ {512, 1024, 2048, 4096}` with `llama-bench`/`llama-batched-bench`.
Expect the knee at **1024–2048**; 4096 usually gives little/no prefill gain and eats VRAM you want
for 64K KV. The dense 27B is much less `-ub`-sensitive than the MoE 35B (dense already saturates the
matmul).

### `--flash-attn` / `-fa`
- Values: `on` / `off` / `auto` (default `auto`). Enables fused attention → faster prefill at long
  context, smaller per-token attention memory, and it is a **hard prerequisite for KV-cache quant**.
- On RDNA4 the measured prefill benefit is modest (**~+2–3%**, Discussion #21043) because prefill is
  dominated by the FFN/expert matmuls, not attention — but at **64K context the long-context and
  memory-footprint benefits matter**, and you need it on for `-ctk/-ctv` quant. **Recommend `-fa on`.**
- **rocWMMA flash-attention path:** on RDNA4 this needs **rocWMMA ≥ 2.0 (ROCm 7)**; rocWMMA 1.7
  (ROCm 6.4.2) won't even compile the RDNA4 WMMA fattn instantiation (#13110, #13444). Where the
  WMMA path *is* built, it gives large gains only in **compute-bound / small-tile** attention
  (~2.4×) and shrinks to a few percent once attention is bandwidth-bound (i.e. long-context decode).
  If your b1295 build was made with `-DGGML_HIP_ROCWMMA_FATTN=OFF`, FA still works via the generic
  path — you just miss the matrix-core attention kernels.

### KV-cache quant `-ctk` / `-ctv`
- Requires `-fa on`. At 64K on 32 GB, **`-ctk q8_0 -ctv q8_0`** is the sweet spot (≈½ the f16 KV
  footprint, negligible quality loss). Discussion #21043: q8_0/q8_0 is fine up to ~40K on 32 GB;
  dense models tolerate **`q4_0`** for even more headroom.
- **Avoid `q4_1`, `iq4_nl`, `q5_0`, `q5_1`** KV types on this stack (reported slow/buggy paths).

### `--no-mmap`, `-ngl`, threads, `--split-mode`, `--parallel`
- **`-ngl 99`** — put all layers on GPU (both models fit in 32 GB at Q4). This is the single biggest
  lever; partial offload tanks throughput.
- **`--no-mmap`** — forces the weights fully into memory instead of memory-mapping the file. With a
  full GPU offload it has little steady-state effect; it mainly avoids first-token page-in stalls.
  Optional.
- **threads (`-t`)** — with everything on GPU, CPU threads barely matter for prefill/decode; set to
  physical core count and stop tuning it (confirmed "no-effect" in #21043).
- **`--split-mode` / `-sm`** — single-GPU: irrelevant. On **dual R9700**, `-sm row`/tensor helped
  ROCm dense prefill in #21043 (27B Q8 hit **960 tok/s** single-request with tensor split). N/A for
  one card.
- **`--parallel` / `-np`** — number of concurrent sequence slots. For **max single-stream prefill,
  use `--parallel 1`** (splitting the batch across slots lowers per-request throughput). Raise only
  if you actually serve concurrent requests.

### hipBLASLt vs rocBLAS (this is likely why our llama.cpp prefill is low)
- There is a **known RDNA4 HIP prefill regression** (#12764): a commit that switched GEMM compute to
  `CUBLAS_COMPUTE_32F` (F32 accumulate) **almost halved prefill on gfx1201: ~2147 → ~1260 tok/s.**
  The workaround is F16-accumulate / reverting that path. **A build carrying this regression will
  look ~2× slower than one that doesn't** — a strong candidate for our 1489-vs-2975 gap (see §2).
- `ROCBLAS_USE_HIPBLASLT=1` — mixed/limited impact in RDNA4 reports (#15021, vachsark). Worth an A/B,
  but don't expect miracles; the F32-vs-F16 accumulate issue above dominates.
- A known-good native gfx1201 build (tlee933 repo, ROCm 7.11) compiles **30,957 hipBLASLt kernels
  (145 gfx1201-specific)** + **570 rocBLAS kernels (56 gfx1201-specific)** with rocWMMA — i.e. a
  *properly targeted* build matters a lot on this brand-new arch.

### MoE-specific flags (Qwen3-A3B) — **not needed for us**
`-ot`/`--override-tensor`, `--n-cpu-moe`, `--cpu-moe` all exist to **keep some/all expert tensors on
CPU/RAM** when the model doesn't fit in VRAM. The 35B-A3B at Q4 fits in 32 GB, so **run experts fully
on GPU and skip these flags entirely.** (They'd only slow you down by forcing PCIe expert traffic.)

---

## 2) ollama tuning — batch/ubatch and why it was ~2× faster

### Does ollama expose the micro-batch? **No.**
- ollama exposes **`num_batch`** only: as API `options.num_batch`, or Modelfile
  `PARAMETER num_batch <n>`. It maps to llama.cpp **`n_batch` (`-b`)**, default **512** (ollama pins
  the old 512 default, not llama.cpp's newer 2048).
- **There is no `OLLAMA_NUM_BATCH` env var and no ubatch/`-ub` knob.** ollama's embedded server uses
  older batching code that never wired up `--ubatch-size` (#3554); effectively `n_ubatch` tracks the
  batch. So the *only* prefill-batch lever you have in ollama is `num_batch`.
- Raising it helps: community report of **`num_batch` 512 → 1024 giving ~+60% throughput for <1 GB
  extra VRAM** (#1800, #12560 threads). Try **`num_batch 2048`** for our long prompts; back off if
  VRAM-tight at 64K.

### The other ollama knobs
| Variable | Default | Recommended (our case) | Notes |
|---|---|---|---|
| `OLLAMA_FLASH_ATTENTION` | off (moving toward default-on) | **1** | Needed for KV quant; long-ctx win |
| `OLLAMA_KV_CACHE_TYPE` | `f16` | **`q8_0`** | ≈½ KV memory, tiny quality loss; requires FA |
| `OLLAMA_CONTEXT_LENGTH` | 4096 (tiered 4K/32K/256K by VRAM in ≥0.15.5) | **65536** | Must set explicitly for 64K |
| `OLLAMA_NUM_PARALLEL` | 1 (some builds auto 4/1 by VRAM) | **1** | 1 = max single-stream; >1 splits KV/batch |
| `OLLAMA_MAX_LOADED_MODELS` | 3×GPU | 1 | avoid co-resident models eating VRAM |

### Why was ollama prefill ~2× llama.cpp (2975 vs 1489)?
Most likely a **build/kernel difference, not a config difference** — leading candidates, in order:
1. **Different ggml/ROCm build.** ollama ships its own bundled ROCm ggml. If our `b1295 gfx120X`
   llama.cpp build carries the **F32-accumulate prefill regression (#12764)** and ollama's build
   doesn't (or uses F16 accumulate / better hipBLASLt kernels), that alone explains a ~2× prefill
   gap on RDNA4.
2. **Newer/differently-targeted kernels.** A build with proper gfx1201 hipBLASLt/rocBLAS + rocWMMA
   (like the tlee933 native build) vs a generic/overridden target changes prefill dramatically. Our
   `HSA_OVERRIDE_GFX_VERSION=12.0.1` override can land on a non-native code path.
3. **Flash-attention default.** If ollama effectively runs FA (or a fused path) while our llama.cpp
   invocation didn't, some of the gap closes.
4. **Measurement framing.** ollama's reported prompt-eval rate can differ from llama.cpp's pp number
   (warm cache, prompt reuse, how tokens are counted). Verify apples-to-apples.

**Action:** rather than "tune ollama up," the bigger win is to **fix/replace the llama.cpp build** so
its prefill matches ollama's, then llama.cpp's `-ub 2048` should *exceed* ollama (which is capped at
`num_batch` with no ubatch lever). Confirm by A/B testing a fresh native gfx1201 build with
`-b 16384 -ub 2048` vs ollama `num_batch 2048`.

---

## 3) Backends / drivers on RDNA4 — ROCm/HIP vs Vulkan

**Context:** ROCm gfx1201 support is genuinely new — **ROCm 7.2 (March 2026) was the first release
to officially support RX 9070/9070 XT.** Because of that immaturity, **Vulkan (RADV/Mesa) is often
competitive or faster on RDNA4**, unlike on mature CDNA/older RDNA where ROCm dominates.

### Vulkan vs ROCm — the numbers
- **RADV (Mesa) Vulkan vs ROCm HIP, direct llama.cpp A/B (vachsark, RX 9070-class):** Vulkan **+20%
  on an 8B model, +9% on a 14B**; Vulkan hit **77–79% of theoretical bandwidth vs ROCm's 63–72%**.
  Cause: **RADV compiles native gfx1201 shaders; ROCm needed an override that targeted the wrong
  micro-arch variant.** Tuning `ROCBLAS_USE_HIPBLASLT` had limited impact; switching to RADV gave the
  +20%.
- **llama-server Vulkan vs vLLM ROCm (ivangotoy / digtvbg, RX 9070 XT, Qwen3.5-9B Q6_K):** Vulkan
  **62 t/s vs vLLM 48 t/s (+29%)** — because vLLM has no native gfx1201 FP8 kernels and silently
  falls back to FP32 dequant. (This is Vulkan-vs-vLLM, not vs llama.cpp-ROCm, but it shows how weak
  the ROCm-native path still is on RDNA4.) Their flags: `-ngl 999 -c 65536 -b 2048 -ub 2048
  --parallel 1`.
- **Raw ROCm HIP llama.cpp on RX 9070 XT (Discussion #15021):** pp512 ≈ **5055 t/s**, tg128 ≈ **101
  t/s** (FA off); FA on was slightly *lower* pp (4903) — so on RDNA4 ROCm, FA is not a prefill win by
  itself. (These are small-model `llama-bench` numbers, much higher than our 35B/27B real-workload
  numbers, but useful as a backend sanity ceiling.)

### The nuance: it's model-dependent (Discussion #21043, the definitive R9700 deep-dive)
- **ROCm wins for dense models > ~20B** — 27B-Q8 reached **960 tok/s prefill** on ROCm with tensor
  split; ROCm's big-GEMM path is strong for dense.
- **Vulkan wins/ties for smaller MoE** and for decode consistency.
- A **1-line Vulkan patch** (`rm_kq = 2 → 1` in `ggml-vulkan.cpp`) gave **+13% dense decode on
  AMDVLK**; `GGML_VK_ALLOW_GRAPHICS_QUEUE=1` **helped MoE +4–5% but hurt dense −8%**; **RADV vs
  AMDVLK: RADV dense prefill 798 vs 203 t/s (+293%)** — so on Vulkan, **prefer RADV**, and the
  right driver/flags matter more than Vulkan-vs-ROCm per se.
- System-level wins that stack on either backend: **`power_dpm_force_performance_level=high`
  (+14% TG on 80B MoE)** and **PCIe ASPM `performance` (+10.8% dense decode)**.

### Does ollama support Vulkan? **Yes, experimental (0.12.6+).**
Enable with **`OLLAMA_VULKAN=1`**. It targets AMD/Intel GPUs where ROCm/SYCL is weak. Note: ollama's
bundled ROCm libs (6.x TensileLibrary) historically **lack gfx1201 kernels**, so on some ollama
builds the Vulkan path is actually the *better* RDNA4 route. Worth an A/B against ollama-ROCm.

### Installing the Vulkan stack + a Vulkan llama.cpp on Ubuntu 24.04
```bash
# driver + tools (RADV comes from mesa)
sudo apt update
sudo apt install -y mesa-vulkan-drivers libvulkan1 libvulkan-dev vulkan-tools \
                    glslc spirv-headers build-essential cmake git
# verify the R9700 shows up (not just llvmpipe); ensure user is in render+video groups
vulkaninfo | grep -i "deviceName"

# build llama.cpp with the Vulkan backend
cmake -B build -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
# run (same batch/ubatch guidance as ROCm)
./build/bin/llama-server -m <model>.gguf -ngl 99 -c 65536 -b 2048 -ub 2048 -fa on --parallel 1
```
Prefer a **recent Mesa (25.x)** — it added RADV memory/queue improvements that reduce CPU overhead
for llama.cpp Vulkan. `AMDVLK` is the alternative ICD but RADV was faster for prefill in the RDNA4
tests above; if you install AMDVLK, use `VK_ICD_FILENAMES`/`VK_DRIVER_FILES` to select the driver.

---

## 4) Synthesized "optimal config" per runtime (64K, both models)

### llama.cpp — ROCm/HIP (primary), fully on GPU
```
-ngl 99 -c 65536 -b 16384 -ub 2048 -fa on -ctk q8_0 -ctv q8_0 --parallel 1 --no-mmap
```
- **Reasoning:** `-ub 2048` maximizes prefill on RDNA4 (matches our sweep + #21043's +29% MoE);
  large `-b 16384` lets a long 64K prompt flow in few logical steps; `-fa on` + `q8_0` KV keeps 64K
  KV inside 32 GB with headroom; single-stream for peak per-request throughput. MoE offload flags
  omitted on purpose (fits in VRAM). **Prerequisite:** use a build *without* the #12764 F32-accumulate
  prefill regression and *with* native gfx1201 hipBLASLt/rocBLAS(+rocWMMA) kernels — otherwise
  prefill is ~½ what it should be.
- **Per-model:** 27B dense is `-ub`-insensitive (already matmul-bound) and tolerates `-ctk/-ctv q4_0`
  for extra headroom; 35B MoE is where `-ub 2048` earns its ~+29%.

### ollama
```
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_CONTEXT_LENGTH=65536 OLLAMA_NUM_PARALLEL=1
# per model:  PARAMETER num_batch 2048   PARAMETER num_ctx 65536
```
- **Reasoning:** `num_batch 2048` is the only prefill lever (no ubatch); FA + q8 KV mirror the
  llama.cpp config; single parallel slot for throughput. ollama is already fast on this GPU because
  its bundled build apparently avoids the llama.cpp prefill regression — so it's the safe default,
  but it can't beat a *fixed* llama.cpp build once you add `-ub 2048` (ollama has no ubatch).

### Vulkan (worth trying on either runtime)
- llama.cpp Vulkan: `-DGGML_VULKAN=ON`, run with `-ngl 99 -c 65536 -b 2048 -ub 2048 -fa on
  --parallel 1`, **RADV** driver, Mesa 25.x. Test `GGML_VK_ALLOW_GRAPHICS_QUEUE=1` (helps MoE, hurts
  dense).
- ollama Vulkan: `OLLAMA_VULKAN=1`.

### System-level (applies to all)
```bash
echo high | sudo tee /sys/class/drm/card*/device/power_dpm_force_performance_level   # +~14% TG
echo performance | sudo tee /sys/module/pcie_aspm/parameters/policy                   # +~11% dense decode
```

---

## What to test next on the actual GPU (checklist)

1. **`-ub` sweep** with `llama-bench`/`llama-batched-bench`: `-ub 512 / 1024 / 2048 / 4096`, both
   models, at pp512 and at a real 64K-ish prompt. Confirm the knee (expect 1024–2048) and watch VRAM.
2. **`-b` sweep** at fixed `-ub 2048`: `-b 2048 / 8192 / 16384` — verify #21043's `-b 16384` helps or
   is neutral for our prompt lengths.
3. **Diagnose the llama.cpp-vs-ollama gap:** rebuild llama.cpp from current master (or the tlee933
   native gfx1201 build) and re-measure prefill. Check whether our `b1295` build has the #12764
   F32-accumulate regression. A/B `ROCBLAS_USE_HIPBLASLT=0/1`.
4. **Flash attention A/B:** `-fa on` vs `off` for prefill *and* decode at 64K (RDNA4 FA prefill gain
   is small; the real payoff is KV quant + long-ctx memory).
5. **KV quant A/B:** `q8_0/q8_0` vs `f16` vs (dense) `q4_0/q4_0` — measure quality-neutral VRAM
   savings and any speed delta; confirm 64K fits.
6. **ollama `num_batch`:** 512 → 1024 → 2048, measure prompt-eval rate and VRAM.
7. **Vulkan backend:** build llama.cpp Vulkan (RADV, Mesa 25.x) and A/B prefill+decode vs ROCm for
   both models. Try `OLLAMA_VULKAN=1`. Try the `rm_kq=1` Vulkan patch if building from source.
8. **System levers:** `power_dpm_force_performance_level=high`, PCIe ASPM `performance` — cheap,
   stack on any backend.
9. **rocWMMA build:** confirm the build used `-DGGML_HIP_ROCWMMA_FATTN=ON` with rocWMMA ≥ 2.0 (ROCm
   7); if it failed to compile, FA is on the generic path (leaving matrix-core attention on the table).

---

## Sources

- llama.cpp Discussion #21043 — *RDNA4 Llama Experiments: Squeezing Every Token/s from the R9700* (the definitive R9700 deep-dive; `-b 16384 -ub 2048`, RADV vs AMDVLK, rm_kq patch, ROCm-vs-Vulkan by model, system levers): https://github.com/ggml-org/llama.cpp/discussions/21043
- llama.cpp Issue #21284 — *Inefficient defaults for gfx1151 cost substantial prefill (ROCm)* (batch/ubatch 2048, MMQ tuning ~+20%): https://github.com/ggml-org/llama.cpp/issues/21284
- llama.cpp Issue #12764 — *(HIP) RDNA4 prefill almost halved with CUBLAS_COMPUTE_32F* (F32-vs-F16 accumulate; ~2147→1260 t/s regression): https://github.com/ggml-org/llama.cpp/issues/12764
- llama.cpp Discussion #15021 — *Performance of llama.cpp on AMD ROCm (HIP)* (RX 9070 / 9070 XT pp512/tg128; rocWMMA build difficulties): https://github.com/ggml-org/llama.cpp/discussions/15021
- llama.cpp Issue #13110 — *Flash attention with rocWMMA 6.4 broken on gfx1201*: https://github.com/ggml-org/llama.cpp/issues/13110
- llama.cpp Discussion #13444 — *Cannot link rocwmma with flash attention* (rocWMMA ≥ 2.0 / ROCm 7 needed on RDNA4): https://github.com/ggml-org/llama.cpp/discussions/13444
- tlee933/llama.cpp-rdna4-gfx1201 — native gfx1201 ROCm 7.11 build (kernel counts, 98.97 tok/s): https://github.com/tlee933/llama.cpp-rdna4-gfx1201
- ollama Issue #3554 — *server.cpp not accepting --ubatch-size* (ollama has no ubatch knob; n_batch=512): https://github.com/ollama/ollama/issues/3554
- ollama Issue #12560 — *Does num_batch do anything?* (num_batch = n_batch, no ubatch): https://github.com/ollama/ollama/issues/12560
- ollama Issue #1800 — *OOM solved by reducing num_batch from 512* (num_batch↔VRAM/throughput): https://github.com/ollama/ollama/issues/1800
- ollama Issue #11247 — *Add Vulkan GPU Backend for AMD/Intel*: https://github.com/ollama/ollama/issues/11247
- ollama envconfig/config.go — env var defaults: https://github.com/ollama/ollama/blob/main/envconfig/config.go
- ollama FAQ (context length, flash attn, KV cache, parallel defaults): https://docs.ollama.com/faq
- ollama GPU / hardware support docs: https://docs.ollama.com/gpu
- Phoronix — *ollama Rolls Out Experimental Vulkan Support* (0.12.6, OLLAMA_VULKAN=1): https://www.phoronix.com/news/ollama-Experimental-Vulkan
- Vache Sarkissian — *Vulkan Beats ROCm: +20% LLM Inference on RDNA 4* (RADV +20%/+9%, bandwidth util, hipBLASLt limited impact): https://vachsark.com/blog/vulkan-beats-rocm/
- Ivan Angelov / digtvbg — *Local LLM Inference on AMD RX 9070 XT: Vulkan vs ROCm* (62 vs 48 t/s; llama-server flags): https://digtvbg.com/blog/llama-server-vulkan-rdna4-vllm-rocm-benchmark/
- ivangotoy/llama-server-rdna4-vulkan — benchmark scripts/methodology: https://github.com/ivangotoy/llama-server-rdna4-vulkan
- OpenBenchmarking — *ROCm vs Vulkan llama.cpp RDNA4 RX 9070 XT*: https://openbenchmarking.org/result/2509078-NE-ROCMVSVUL92
- knightli.com — *llama.cpp GPU Benchmark: CUDA vs ROCm vs Vulkan; pp512/tg128 explained*: https://knightli.com/en/2026/04/23/llama-cpp-gpu-benchmark-cuda-rocm-vulkan-scoreboard/
- RADV / Mesa docs (Vulkan driver for AMD): https://docs.mesa3d.org/drivers/radv.html
- llama.cpp DeepWiki — batch/ubatch pipeline & HIP backend: https://deepwiki.com/ggml-org/llama.cpp/3.5-batch-processing-pipeline , https://deepwiki.com/ggml-org/llama.cpp/5.5-hip-cann-and-other-backends
- llama-server(1) manpage (flag reference): https://manpages.debian.org/unstable/llama.cpp-tools/llama-server.1.en.html
