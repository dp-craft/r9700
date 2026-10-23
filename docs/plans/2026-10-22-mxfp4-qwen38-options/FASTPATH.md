# Fast path to a working fast vLLM (short plan + results) — 2026-10-22/23

> **SOLVED (2026-10-23, MEASURED hostka-1..3):** `HIP_FORCE_DEV_KERNARG=0` in the container env. The fault was a corrupted
> kernel-argument pointer (bit 44 cleared) — kernargs placed in device memory are written by the host over the PCIe BAR;
> with host-memory kernargs: 3/3 boots × 4 Claude turns clean at full speed (decode med 111–150, prefill med 2.4–3.0k tok/s).
> Not the 7.0.0-38 driver (-34 faulted too), not Sly 1.6.0 (1.5.1 faulted), not an M-tail over-read (padding didn't help).
> INFERRED next: the 2026-10-07 llama.cpp ROCm `-fa on` faults (same 0x6… address shape) are probably the same — retest with it.

Target: ≥50 tok/s decode, ≥1000 tok/s prefill, ctx ≥100k; ideally the Sly 1.6.0 + DFlash speed (MEASURED mhist: decode med 106, prefill med 2627 tok/s).

## Diagnosis that drives the order (INFERRED, strong)
Every fault: `radiance_mxfp4_fp8_gemm_{folded,atiled}`, **grid.y = 7** (seen [20480|57344|65536|139264, 7, 1]).
Prefill chunk = `--max-num-batched-tokens 2048` → Claude's first request leaves an M=1760 chunk; 7 × 256-row tiles = 1792 →
the kernel reads A / x_scale **32 rows past the buffer end**; faults only when that end touches an unmapped page (layout luck → 1.5.1 and 1.6.0 both ~50%, any ctx).

## Root-cause finding (MEASURED ptrlog-4, 2026-10-22)
Fault addr `0x6c94bc6a2000` + 2^44 = inside the **down_proj weight** (N=5120 K=17408, offset 0x20a2000 of 0x2a80000);
operands all live at 0x7c9…, every recorded fault addr is 0x6… → the kernel forms the W address with **bit 44 cleared**.
Not an M-tail over-read (padding A/out: still faults). Per-boot placement: faults hit the first real request only;
every boot that survived it stayed clean (mhist, v151, ptrlog-2/3, B1, baseline-rerun) → **P0 warm start**: boot, replay
a captured Claude first request (`bench/engine-bench/vllm/warmup/claude-first/`, via `capture_proxy.py`), reboot on fault
(`bench/engine-bench/vllm/warm_start.sh`, `claudetest.sh WARM=1`).

## Update — likely system-level (2026-10-22 late)
split-3 faulted in Sly's **decode** kernel too → not one kernel's bug. The 2026-10-07 llama.cpp ROCm `-fa on` faults
(`mul_mat_q`, dmesg PERMISSION_FAULTS=0x3) also hit **0x6…** addresses (0x6bc67f82e000, 0x6e0dfaeb9000) — same pattern,
different engine. That report's open suspect: amdgpu in kernel **7.0.0-38**; its reboot test to -34 was never run.
**Next = P-K: boot 7.0.0-34, run `kerneltest.sh`** (3× unchanged gate). PASS ×3 → driver regression: pin -34, the
unpatched Sly 1.6.0 DFlash config is the fast solution (decode ~105, prefill ~2.6–3.1k tok/s). FAULT → engine-side,
continue with split/W4A4 fallbacks + upstream issue.

## Order (cheapest × most likely first)
| # | Step | Cost | Status |
|---|------|------|--------|
| P1 | **PAD_A overlay**: zeroed 256-row tail on A + x_scale before each W4A8 launch (`overlays/sly-pad-a`, profile `sly-radiance/qwen38-mxfp4-dflash-pada`, `serve_vllm.sh PY_OVERLAY`). Gate 3 boots × 2 turns, then 4-turn + speeds | ~40 min | A-only: **FAULT** (pada-1); A+out tail: running (padao) |
| P2 | if P1 faults: avoid ragged M — `--max-num-batched-tokens` a multiple of 256 doesn't help (remainder chunk is prompt-dependent); instead route M%256≠0 to PADDED M (copy A into Mpad rows, launch with Mpad, slice out) | ~30 min | — |
| P3 | if still faulting: hypothesis wrong → capture with 1.5.1 `CHECKX`/MHIST; fall back to upstream radiance 0.9.3 + issue upstream | — | — |

## Results
| label | config | result | notes |
|---|---|---|---|
| pada-1 | overlay, A + x_scale tail only | **FAULT@t0** 5 s, `_folded` [20480,7,1] (N=5120 K=6144 via mxfp4_linear, padded) | A over-read is NOT the cause → test out-tile write (old PADOUT 64k elem/side = 128 KB < 320 KB needed) |
| padao-1 | overlay, A + x_scale + out tails (256 rows) | **FAULT@t0** 5 s, `_atiled` [20480,7,1] | tail over-read/over-write is NOT the cause |
| ptrlog-1 | + `_PtrLog` proxy on `_ext` | BOOT_FAILED | proxy object breaks the engine (replaced by inline `_plog`) |
| ptrlog-2 | padao + inline pointer log (`RADIANCE_MXFP4_PTRLOG=1`, 12,768 lines/request) | **PASS** (1 turn, 122 s) | decode med 101, prefill med 2629 / max 3159 tok/s, accept 4.18; M=1760 ran 10k× → host-side delay may hide a race (timing, not layout)? repeating |
| ptrlog-3 / -4 | same | PASS (86/61 s; decode 99, prefill med 3159) / **FAULT@t0** | ptrlog-4 gave the address map above |
| warm-1 | `WARM=1` (warm_start.sh), plain 1.6.0 DFlash | **FAULT@t0** 15 s (warmup boot 1 faulted, boot 2 passed warmup, then Claude t0 faulted) | warm start is NOT enough → placement is not fixed at the first request |
| split-1 | **`sly-radiance/qwen38-mxfp4-dflash-split`**: A-tiled off + overlay `RADIANCE_MXFP4_SPLIT_M=192` (prefill GEMMs as ≤192-row slices on the decode/wide kernels) | **PASS** (2 turns, 86/65 s) | decode med 108, prefill med 3154 / max 3251 tok/s, accept 4.37 — full speed; repeating ×3 (4 turns) with a split-path counter |
| split-2 / split-3 | split profile, 4 turns, SPLIT counter confirms slices | PASS (90/65/76/146 s; decode 107, prefill med 2354) / **FAULT@t3** in `radiance_mxfp4_fp8_gemm_decode` | decode kernel faults too → not prefill-kernel-specific |
| k34-1 | kernel **7.0.0-34**, unchanged 1.6.0 DFlash | no fault in 4 turns; CLAUDE_FAIL@t3 = HTTP 400 budget (one turn jumped from <135k to 147,001 + 33,000 > 180,000) | decode 110, prefill med 2323 / max 3270, accept 4.78 |
| k34-2 | same | **FAULT@t0** 10 s `_atiled` | **-34 faults too → not the -38 driver regression** |
| hostka-1..3 | `HIP_FORCE_DEV_KERNARG=0` (kernel args stay in host memory instead of device memory written over the PCIe BAR), unchanged 1.6.0 DFlash, kernel -34 | **PASS 3/3** (12 turns, 0 faults); t0..t3 = 91/65/256/236, 81/75/70/126, 70/51/75/151 s | decode med 150/111/111, prefill med 2362/2958/2364 (max 5580), accept 6.21/4.83/4.90 → **FIX**; now default in `sly-radiance/_engine.env` + `radiance/_engine.env` |
| swap-ka | **via llama-swap** row `qwen38-27b-mxfp4-dflash-kvfp8-vllm` (profile carries `HIP_FORCE_DEV_KERNARG=0`), fixtures p0..p4 | **PASS**, 0 faults | p0 = 181 s (incl. boot), p1..p4 = 7/4/4/5 s (2026-10-23) |
