# Host (no-Docker) vLLM install — footprint and disk budget

**Brainstorm:** [vllm-qwen38-r9700](../vllm-qwen38-r9700.md)
**Type:** cost-analysis
**Date:** 2026-09-11

---

User constraints: **no Docker image**, "a very simple vLLM engine (max 4 GB)", models in **`~/models/vllm`**.
Outcome: 4 GB is not achievable with vLLM-on-ROCm today; the user chose the **full pip install (~10.5 GB)**
and **removing the unused 0.19.1 Docker image** for disk headroom.

## 1. Host facts (VERIFIED, local reads)

| Item | Value |
|---|---|
| Python | 3.12.3 (`/usr/bin/python3.12`), `pip3`, `venv` module OK; **no `uv`** |
| Existing torch installs under /home/dev | none (nothing to reuse) |
| Host ROCm | `/opt/rocm` real dir with `core-7.13` and `core-10.0`; `hipconfig --version` = **7.15.26333**; `amd-smi` reports **ROCm 10.0.0**, AMDSMI 27.0.0. (CLAUDE.md still says "ROCm 7.x".) |
| ROCm libs present (`/opt/rocm/lib`, soname → real) | amdhip64.so.7, hsa-runtime64.so.1, amd_comgr.so.3, rocblas.so.5, hipblas.so.3, hipblaslt.so.1, MIOpen.so.1, rccl.so.1, hipsparse.so.4, hipsparselt.so.0, rocsparse.so.1, hipfft.so.0, rocfft.so.0, hiprand.so.1, rocrand.so.1, hipsolver.so.1, rocsolver.so.0, roctracer64.so.4, roctx64.so.4, rocprofiler-sdk.so.1 — **all present** |
| `~/models/vllm` | exists, empty |
| Disk `/` | 366 G, 315 G used, **32 G free** (91 %) — Docker lives on the same FS |
| Docker | 5 images, **52.27 GB, 52.17 GB reclaimable**, 0 containers; `rocm/vllm …vllm_0.19.1` = 50.4 GB of it |
| Other large users | HF cache 9.8 G and build/ 5.5 G are on `/`. **`~/models` → `/mnt/LinBackup/models` is a separate partition** (`/dev/sdb4` on the same Samsung 860 EVO M.2 SATA SSD, 458 G, 55 G free after the model download) — models/gguf/unsloth 127 G and mradermacher 18 G live there, **not on `/`** (corrected during execution) |

## 2. Candidate install paths and real sizes

### 2a. Official vLLM ROCm wheels — `https://wheels.vllm.ai/rocm/` (VERIFIED)
Download sizes from HTTP `Content-Length`; **installed sizes read from each wheel's zip central directory via
HTTP Range requests (no download)**:

| Wheel (cp312, manylinux_2_39) | Download | Installed | Notes |
|---|---:|---:|---|
| `vllm-0.29.0+rocm723` | 0.26 GB | **1.48 GB** (2974 files; `_rocm_C.abi3.so` 0.82) | pins everything below |
| `torch-2.12.0+git6bbd260` | 1.35 GB | **2.00 GB** (12342 files) | **bundles no ROCm libs** (no libamdhip64/rocblas/hipblaslt/MIOpen/rccl in `torch/lib`) → uses host `/opt/rocm`; Requires-Dist has no rocm-sdk packages |
| `triton-3.7.1+gitf0b55c07` | 0.37 GB | **1.09 GB** | includes NVIDIA bits (ptxas-blackwell, cupti) — not trimmable |
| `amd_aiter-0.1.19` | 0.68 GB | **4.88 GB** (19164 files) | not built for gfx1xxx; must be off on gfx1201 |
| `flash_attn-2.8.3` | 0.13 GB | **0.50 GB** | likely not built for gfx1xxx (Dockerfile strips gfx1) |
| `amdsmi-26.2.2`, `torchvision-0.27.1`, `torchaudio-2.11.0` | ~0 | small | |
| **Total (5 big wheels)** | **2.78 GB** | **9.96 GB** | + transformers ≥ 5.10.4, conch-triton-kernels 1.2.1 and ~75 other pure-Python deps → **≈ 10.5 GB** (INFERRED) |

vLLM `Requires-Dist` (VERIFIED from METADATA): `torch==2.12.0+git6bbd260; triton==3.7.1+gitf0b55c07;
torchvision==0.27.1+df56172; torchaudio==2.11.0+34c52a6; amdsmi==26.2.2+c2d9476115; flash-attn==2.8.3;
amd-aiter==0.1.19; transformers>=5.10.4; conch-triton-kernels==1.2.1` (83 total).

Built against `rocm/dev-ubuntu-22.04:7.2.3-complete` (VERIFIED, Dockerfile) → **ABI risk** on host ROCm 10.0 /
HIP 7.15: sonames match (.so.7/.so.5/.so.1 …), symbol-level compatibility unverified (INFERRED risk).

### 2b. Trimmed official install (VIABLE, not chosen) — ~5 GB
`--no-deps` for vllm/torch/triton + the pure-Python deps, **skip amd-aiter + flash-attn** (5.4 GB of kernels
that can't run on gfx1201). Evidence they're optional at runtime (VERIFIED, v0.29.0 source): `vllm/_aiter_ops.py`
wraps `import aiter` in `try`, `is_aiter_found()` = `find_spec("aiter")`; `envs.py` `VLLM_ROCM_USE_AITER: bool =
False`; `v1/attention/backends/fa_utils.py` flash-attn import inside `try`. Minimum = 1.48+2.00+1.09 = 4.57 GB + deps.

### 2c. AMD TheRock gfx120X-only wheels (VIABLE, not chosen)
`https://rocm.nightlies.amd.com/v2/gfx120X-all/` (VERIFIED listing): torch `2.9.1+rocm7.13.0a20260513` /
`+rocm7.14.0a20260611` cp312 **0.34 GB**; `rocm-sdk-core` ~0.27 GB, `rocm-sdk-libraries-gfx120x-all` ~0.40 GB,
`triton-3.7.0+rocm7.13` 0.64 GB (older-version listing, indicative). **No vLLM wheel on that index** (404) →
vLLM must be **built from source** against it (30–60 min hipcc build). Also `repo.amd.com/rocm/whl-multi-arch/`
torch 2.13.0+rocm7.14.0 0.20 GB. Smallest footprint, but the opposite of "very simple".

### 2d. pytorch.org ROCm torch
Index parse returned no cp312 matches for rocm7.0/7.1/7.2 (page format or absence — not resolved); irrelevant
because vLLM pins its own torch build.

### Research-agent output (weak — mostly not used)
Agent estimated "3.5–5.5 GB" and "2.5–3.5 GB" footprints with **all sizes NOT FOUND**, named vLLM 0.29.0 while a
previous agent said 0.28.0, and recommended a **cp313** AMD wheel while stating "Python 3.12 only". Superseded by
the direct index/zip measurements above.

## 3. Disk budget (corrected during execution — MEASURED `df`)

The brainstorm assumed `~/models` was on `/`. It is not: `~/models` → `/mnt/LinBackup/models` on `/dev/sdb4`
(separate partition of the same SATA SSD). The "~2 GB left on `/`" blocker was therefore **overstated** — without
the image removal `/` would still have had ~21 GB after the venv. The removal was harmless (image unused, user
doesn't want Docker) but not strictly required.

| Step | `/` free | `/mnt/LinBackup` free |
|---|---:|---:|
| brainstorm start | 32 GB | — |
| `docker rmi rocm/vllm:…vllm_0.19.1` (executed) | **45 GB** (freed ~13 GB, not the ~50 GB `docker system df` suggested) | — |
| model `RedHatAI/Qwen3.8-27B-INT4` (19.45 GB, rev `bf08f3db…`) → `~/models/vllm/` | unchanged (44 GB) | 55 GB after |
| full venv (~10.5 GB, `pip --no-cache-dir`) | → ~33 GB expected | — |
| vLLM/Triton/torch.compile caches, logs | ample | — |

## 4. Install recipe (design, not executed)
- `python3.12 -m venv <venv>` (location: recommended default `bench/dl/vllm-venv`, gitignored like `benchy-venv`).
- `<venv>/bin/pip install --no-cache-dir "vllm==0.29.0+rocm723" --extra-index-url https://wheels.vllm.ai/rocm/`
  — pin the exact local version so pip can't resolve PyPI's CUDA `vllm-0.29.0`.
- Smoke (only when the GPU is free): `python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"` → ABI gate.

## 5. Execution findings (MEASURED during the install, 2026-09-11)

- `pip install --no-cache-dir "vllm==0.29.0+rocm723" --extra-index-url https://wheels.vllm.ai/rocm/` → exit 0;
  vllm 0.29.0+rocm723, torch 2.12.0+git6bbd260 (hip 7.2.53211), triton 3.7.1, transformers 5.17.0, amdsmi 26.2.2;
  **venv 12 GB** (`du`). All serve flags used by `start_vllm.sh` exist in the installed source.
- **Blocker 1 — OpenMPI 4 runtime missing:** `import torch` → `OSError: libmpi_cxx.so.40`. `libtorch_cpu`,
  `libtorch_global_deps`, `libtorch_python` have DT_NEEDED `libmpi.so.40` + `libmpi_cxx.so.40` (174 undefined
  MPI/ompi symbols incl. data symbols → an empty stub won't do). Only these two sonames were unresolved across
  torch/vllm/triton.
  - `sudo apt install libopenmpi3t64` (4.1.6-7ubuntu2) would install **15 packages including Ubuntu's ROCm 5.7
    runtime** (libamdhip64-5, libhsa-runtime64-1 5.7.1, libhsakmt1, libamd-comgr2 — via ROCm-enabled UCX/libfabric);
    `/opt/rocm/lib` is not in ld.so.conf, so a system `libhsa-runtime64.so.1` 5.7 would shadow ROCm 10's for any
    program that doesn't pin its path → **rejected**.
  - **Chosen (user):** contained copy — `dpkg -x` of `libopenmpi3t64`, `libhwloc15`, `libevent-pthreads-2.1-7t64`
    into `bench/dl/vllm-venv/mpi-libs` (10 MB, provenance in `SOURCES.txt`), only that dir on `LD_LIBRARY_PATH`.
    No ROCm 5.7 libs pulled in.
- **Blocker 2 — amdsmi clash (self-inflicted):** with `/opt/rocm/lib` on `LD_LIBRARY_PATH`, the pip `amdsmi` 26.2.2
  (which bundles its own `libamd_smi.so`) loaded the host `libamd_smi.so.27` → `AttributeError: … undefined symbol:
  amdsmi_set_gpu_clk_range`. Fix: keep `/opt/rocm/lib` **off** `LD_LIBRARY_PATH`.
- **ABI (link level) — OK:** without `/opt/rocm/lib` on the path, `import torch` loads the host ROCm 10 libs via its
  RUNPATH — libamdhip64 7.15, hipblas 3.6, hipblaslt 1.4, rocblas 5.6, MIOpen, hsa-runtime64 1.21, rccl — and
  `vllm._C_stable_libtorch`, `vllm._rocm_C`, `vllm._moe_C_stable_libtorch` import OK. GPU-level execution still
  unverified (needs the free GPU).

## Sources
- https://wheels.vllm.ai/rocm/ (vllm, torch, triton, amd-aiter, flash-attn, amdsmi, torchvision listings)
- https://raw.githubusercontent.com/vllm-project/vllm/v0.29.0/docker/Dockerfile.rocm_base
- https://raw.githubusercontent.com/vllm-project/vllm/v0.29.0/vllm/_aiter_ops.py · …/vllm/envs.py · …/vllm/v1/attention/backends/fa_utils.py
- https://rocm.nightlies.amd.com/v2/gfx120X-all/ · https://repo.amd.com/rocm/whl-multi-arch/
- https://docs.vllm.ai/en/latest/getting_started/installation/gpu/
