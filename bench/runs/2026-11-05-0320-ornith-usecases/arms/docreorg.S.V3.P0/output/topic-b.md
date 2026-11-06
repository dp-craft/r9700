## 1. Linux Kernel Version Landscape

| Release | Date | Notes |
|---------|------|-------|
| 7.0 | April 12, 2026 | The user's current system runs 7.0.0-34-generic (HWE); this is the version with the flash-attention regression |
| 7.1 | June 14, 2026 | First post-regression stable release — any amdgpu fixes merged in ~May would be here |
| 7.2 | August 16, 2026 | Latest stable; 7.2.9 (as of October 2026) — ~6 months of amdgpu change log |
| 7.3 | rc6 (October 2026) | Next development branch |

**Key point:** The user is on kernel 7.0.0-34 (August 2026 stable), but the regression is also present there. The question is whether 7.1, 7.2, or newer kernels have amdgpu fixes that resolve it.

## 2. RDNA4 / gfx1201 Kernel Support

RDNA 4 debuted February 28, 2025 with the RX 9000 series. The amdgpu open-source driver has supported RDNA4 from early kernel releases after launch. Per the Wikipedia article on RDNA 4, the architecture operates alongside the open-source `amdgpu` driver [^wikipedian4].

The amdgpu driver documentation confirms it supports "all AMD Radeon GPUs based on the Graphics Core Next (GCN), Radeon DNA (RDNA), and Compute DNA (CDNA) architectures" [^amdgd]. RDNA4 is not a new architecture that needs separate kernel backporting — it has been in mainline since shortly after its 2025 launch, and all kernels from 7.0 onwards include the full gfx1201 driver stack.

**Conclusion on driver maturity:** gfx1201 is not a driver-maturity problem. The amdgpu driver has had full RDNA4 support for ~20 months. The flash-attention regression is a code logic bug, not a missing feature.

## 3. CachyOS Analysis

### 3.1 Distribution Overview

CachyOS is a high-performance Arch-derived Linux distribution that markets itself as "a noticeably faster Arch Linux experience with the same rolling-release flexibility" [^cachyos]. It provides multiple custom kernel options:

- **linux-cachyos** — CachyOS's own kernel with BORE scheduler, custom tuning patches, and performance optimizations
- Scheduling options: **BORE, sched-ext, BMQ, and RT** [^cachyos]

### 3.2 Kernel Availability on CachyOS

As a rolling-release Arch-based distro, CachyOS typically ships mainline kernels within days of release. The latest stable mainline is 7.2 (released August 16, 2026) and CachyOS would have 7.2 available shortly after launch. CachyOS also maintains backports of newer kernels to older stable branches for early access.

However, CachyOS kernel packages follow Arch's build and test cycle, not a long-term stable track. This means:

- **Pros:** Access to the latest kernels sooner than Ubuntu LTS
- **Cons:** No LTS guarantee; kernels get replaced frequently; regression risk with each upgrade

### 3.3 ROCm on CachyOS/Arch

ROCm packages are available on Arch Linux via AUR (Arch User Repository). Key packages include:

- `roc-minimal` — Minimal ROCm stack (core libraries + HIP)
- `rocm-core` — ROCm core utilities (rocminfo, rocminv, etc.)
- Various ROCm component packages in AUR

There is **no official ROCm package** in Arch's official repos — users must build from AUR. This has implications:

- **Pros:** Rolling AUR gives access to latest ROCm versions
- **Cons:** No official support from AMD; AUR packages may lag behind official ROCm releases; build-from-source increases failure surface

**Critical concern:** ROCm's official support matrix targets specific Ubuntu, RHEL, SLES, Debian, and Rocky Linux releases. Arch/CachyOS is **not** on the official supported platforms list.

## 4. Ubuntu 26.04 LTS "Resolute Raccoon" Analysis

### 4.1 Release Details

- **Codename:** Resolute Raccoon (not Noble Numbat — Noble was 24.04) [^ubuntureleases]
- **Release:** April 2026
- **Default kernel:** 7.0 [^ubuntudl]
- **LTS support:** 5 years free (until May 2031), extended to 15 years with Ubuntu Pro
- **Architectures:** amd64, arm64, and others [^ubuntureleases]

Ubuntu 26.04.1 images show update timestamps through August 27, 2026, indicating ongoing HWE kernel updates [^ubuntudl]. The HWE (Hardware Enablement) stack in Ubuntu provides newer kernels for LTS releases — so Ubuntu 26.04 will ship kernel 7.0 at release but receive 7.1, 7.2 via HWE updates without requiring a full OS upgrade.

### 4.2 ROCm Support on Ubuntu 26.04

ROCm 10.1.0 is the current release and supports Ubuntu, RHEL, SLES, Debian, and Rocky Linux [^rocm101]. The compatibility matrix targets specific Ubuntu releases, but the exact supported Ubuntu versions require checking the official matrix at https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html [^rocmgithub].

ROCm 10.1.0 requires:
- **amdgpu drivers:** 30.10.2 to 31.60.0 range [^rocm101]
- **HIP:** 10.1.0
- **LLVM:** 24.0.0
- **Python:** 3.10–3.14
- **AI frameworks:** PyTorch, JAX, TensorFlow, vLLM, MIGraphX [^rocm101]

Ubuntu 26.04 ships with kernel 7.0, which is the same kernel generation the user is currently running (7.0.0-34). The key question becomes: will Ubuntu 26.04's HWE updates bring a kernel with the flash-attention fix?

### 4.3 Practical Viability

**Advantages of Ubuntu 26.04:**
- Officially supported by AMD for ROCm
- LTS = stable base with HWE kernel updates (can get newer kernel without OS change)
- Proven ROCm install path with official documentation
- Same kernel generation as current (7.0) but newer HWE kernels (7.1, 7.2) available
- Better tooling and community for ROCm issues

**Disadvantages of Ubuntu 26.04:**
- Same kernel generation (7.0) at release — the flash-attention regression exists here too
- HWE kernel updates may take weeks to months to propagate
- Less "bleeding edge" than CachyOS for kernel updates

## 5. ROCm System Requirements — Detailed

Per ROCm 10.1.0 documentation [^rocm101]:

### Supported Hardware
- AMD Instinct accelerators (CDNA4, CDNA3, CDNA2)
- AMD Radeon desktop GPUs (RDNA4, RDNA3)
- Ryzen AI processors
- gfx1201 (RDNA4) is covered under RDNA4 support [^rocmgithub]

### Supported Operating Systems
- Ubuntu (specific versions in compatibility matrix)
- RHEL
- SLES
- Oracle Linux
- Debian
- Rocky Linux
- Windows 11

### Kernel Requirements
The ROCm compatibility matrix specifies exact kernel version requirements per OS. AMD directs users to the official matrix for precise kernel-GPU-OS pairings [^rocmgithub]. The amdgpu driver version requirement ranges from 30.10.2 to 31.60.0 depending on GPU [^rocm101].

### Virtualization
- KVM passthrough and SR-IOV via GIM 9.3.0.K [^rocm101]
- Compute partitioning: SPX, DPX, CPX modes
- NPS configurations for bare-metal and virtualized setups

### ROCm Version on Current System
The user's CLAUDE.md confirms: ROCm 10.1 (clang 24), HSA_OVERRIDE_GFX_VERSION=12.0.1, Mesa/RADV 26.2.4, Ubuntu 24.04, kernel 7.0.0-34-generic [^claude].

## 6. Comparison Summary

| Factor | CachyOS | Ubuntu 26.04 LTS |
|--------|---------|------------------|
| ROCm official support | No (AUR only) | Yes |
| Kernel recency | Rolling, latest first | LTS base + HWE updates |
| Current kernel on system | N/A (would install fresh) | 7.0 (same regression) |
| Path to newer kernel | `pacman -Syu` | HWE kernel stack updates |
| Driver maturity (RDNA4) | Same mainline amdgpu | Same mainline amdgpu |
| Support when things break | Community/Arch Wiki | AMD official + Ubuntu community |
| Stability | Rolling = more change surface | LTS = more stable base |
| Flash-attention fix path | Newer kernel via rolling update | Newer kernel via HWE updates |

## 7. Verdict

**Ubuntu 26.04 is the better path.** The key reasons:

1. **ROCm officially supports Ubuntu.** CachyOS/Arch is not on the supported platforms list. This means bug reports, kernel fixes, and driver updates are targeted at Ubuntu first.

2. **Same amdgpu driver code.** CachyOS kernels ship the same mainline amdgpu code as Ubuntu (with CachyOS-specific patches on top). The flash-attention regression fix, if it exists, would be in mainline regardless of distro.

3. **HWE kernel updates.** Ubuntu 26.04 will receive 7.1, 7.2, and potentially newer kernels via the HWE stack without requiring a full OS reinstall. This is the practical path to a fixed kernel.

4. **No advantage to CachyOS for this use case.** The BORE scheduler and performance optimizations don't help with the flash-attention regression. The ROCm install is more fragile on Arch/CachyOS (AUR builds, no official support).

**Recommendation:** If the flash-attention regression is blocking, the fastest path is not switching distros but finding which specific kernel version (if any) contains the fix. Check kernel 7.1 or 7.2 changelogs for amdgpu fixes, or consider backporting a fix. Switching to Ubuntu 26.04 would give you a clean official ROCm+RDNA4 installation with HWE kernel updates, but the kernel at release (7.0) has the same regression as the current system.

---

[^wikipedian4]: Wikipedia, "RDNA 4" — https://en.wikipedia.org/wiki/RDNA_4
[^amdgd]: AMDGPU Documentation, https://www.kernel.org/doc/html/latest/gpu/amdgpu/index.html
[^cachyos]: CachyOS website — https://cachyos.org/
[^ubuntureleases]: Ubuntu Releases page — https://ubuntu.com/about/release-cycle
[^ubuntudl]: Ubuntu 26.04 downloads — https://releases.ubuntu.com/26.04/
[^rocmgithub]: GitHub README for ROCm — https://github.com/RadeonOpenCompute/ROCm
[^rocm101]: ROCm 10.1.0 compatibility and system requirements documentation — https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html
[^claude]: Project CLAUDE.md — /home/dev/work/dp-craft/amd/CLAUDE.md

