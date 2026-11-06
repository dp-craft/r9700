<!-- meta
date: 2026-10-07 17:45
takeaway: Every ROCm bench with `-fa on` crashes with `HSA_STATUS_ERROR_MEMORY_FAULT`; `sudo dmesg` confirms a real GPU page **permission** fault in `llama-bench` (PERMISSION_FAULTS=0x3, MAPPING_ERROR=0 — not OOM/contention). Reproduced twice (bench run + isolated test on a free GPU) and identically on both the 10.0 and 10.1 runtimes; `-fa off` is clean. No matching upstream issue found (4 searches, 2026-10-07). Kernel diff -34→-38 (done): six amdkfd/SVM/userq-fence patches landed in that window — one **gfx12-specific** (`6c1f4f7`, EOP interrupt routing) — a coherent suspect set for the signature. Attribution test = reboot to 7.0.0-34 (installed). ROCm bench arms are blocked until resolved; `latest-rocm` stays on the 10.0 build per user decision.
-->

# ROCm `-fa on` → HSA memory fault on gfx1201 — kernel evidence & attribution

- **Date:** 2026-10-07 · **Track:** our measurements (analysis) + kernel log evidence
- **Context:** step 4a of the toolchain-upgrade bench (ROCm 10.0 → 10.1, one variable) failed on both
  arms; this report isolates the cause and records what a driver chase needs.

## Summary

| Fact | Value | Provenance |
|---|---|---|
| Symptom | `llama-bench` / ROCm arm exits 134 (SIGABRT), `HSA_STATUS_ERROR_MEMORY_FAULT`, reported from the `mul_mat_q` kernel | MEASURED (step-4a bench logs, 2026-10-07 12:21) |
| Kernel evidence | `[gfxhub] page fault` in `llama-bench`; `GCVM_L2_PROTECTION_FAULT_STATUS:0x00801030`, **PERMISSION_FAULTS=0x3, MAPPING_ERROR=0** | MEASURED (`sudo dmesg -T`) |
| Fault type | Permission fault with PTE present — access denied by mapping permissions, **not** an unmapped/OOM access | INFERRED from the register decode below |
| Reproduction | 2× (bench run 12:21, isolated test 12:51), both on a free GPU; identical on ROCm 10.0 **and** 10.1 runtimes | MEASURED |
| Control | Same build/model/shape with `-fa off`: clean (pp16 ≈ 273 t/s, tg8 ≈ 21.3 t/s); Vulkan `-fa on` also clean (steps 3a/3b) | MEASURED |
| Upstream match | None — 4 targeted web searches, zero results (2026-10-07) | MEASURED (search activity) |
| Suspect | amdgpu kernel **7.0.0-38** (box moved from -34 during the upgrade window); alt: llama.cpp ROCm FA path on gfx1201 | INFERRED |

## dmesg evidence (MEASURED, `sudo dmesg -T`, 2026-10-07)

Two complete fault blocks, same signature, attributed to the bench process:

```
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0: [gfxhub] page fault (src_id:0 ring:24 vmid:8 pasid:7023)
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:  Process llama-bench pid 65591 thread llama-bench pid 65591
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:   in page starting at address 0x00006bc67f82e000 from client 10
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0: GCVM_L2_PROTECTION_FAULT_STATUS:0x00801030
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:      Faulty UTCL2 client ID: TCP (0x8)
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:      MORE_FAULTS: 0x0
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:      WALKER_ERROR: 0x0
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:      PERMISSION_FAULTS: 0x3
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:      MAPPING_ERROR: 0x0
[Wed Oct  7 12:21:30 2026] amdgpu 0000:09:00.0:      RW: 0x0
```

Second block at **12:51:11** (isolated `-fa on` test, free GPU): identical fields, `pasid:7777`,
address `0x00006e0dfaeb9000`. A third partial block at 12:21:20 (header truncated in the capture)
shows the same status word.

### Register decode (INFERRED — standard amdgpu fault-status semantics)

| Field | Value | Meaning |
|---|---|---|
| `PERMISSION_FAULTS` | `0x3` | **both** read- and write-permission bits set — the access was denied by PTE permissions |
| `MAPPING_ERROR` | `0x0` | a PTE **exists** at the faulting address → not an unmapped/OOM-style access |
| `WALKER_ERROR` | `0x0` | page-table walk itself succeeded |
| Faulty UTCL2 client | `TCP (0x8)` | L2 cache client that caught the fault (as printed by the driver) |

**Reading:** the GPU dereferenced an address that *is* mapped but whose mapping does not permit the
access — consistent with either (a) a kernel touching memory whose SVM/userptr mapping was being
re-validated mid-flight, or (b) an out-of-bounds access landing in a mapped-but-differently-permitted
region. It is **not** what VRAM contention looks like (that presents as allocation failure for an
engine that reserves its KV window at load — iron rule 15).

### Correlated SVM activity (MEASURED, same window)

```
[Wed Oct  7 12:41:54 … 12:45:27] workqueue: svm_range_restore_work [amdgpu] hogged CPU for >10000us … (up to ×67)
[Wed Oct  7 12:41:59 …]          workqueue: amdgpu_amdkfd_restore_userptr_worker [amdgpu] hogged CPU …
[Wed Oct  7 12:50:42]            amdgpu: VM memory stats for proc llama-server(67328) … is non-zero when fini
```

The amdgpu **SVM/userptr restore workers were heavily active between the two faults** (INFERRED:
ROCm routes some allocations through amdkfd/SVM; heavy restore traffic around a permission fault
points at the SVM mapping path as part of the picture). The `llama-server … non-zero when fini` line
is llama-swap cycling a server during the bench — an observation, not a fault.

## Isolation matrix (all MEASURED, 2026-10-07)

| Condition | Result |
|---|---|
| ROCm arm, `-fa on` (step 4a bench, both arms: stew675-r4 on 10.0 **and** 10.1) | exit 134, `HSA_STATUS_ERROR_MEMORY_FAULT` |
| Clean `b11448-rocm` (10.1), `-fa on`, free GPU (isolated test) | same crash |
| Same build, `-fa off`, free GPU | clean — pp16 ≈ 273 t/s, tg8 ≈ 21.3 t/s |
| Vulkan arms, `-fa on` (steps 3a/3b, same model/shapes) | clean |

The fault is specific to the **ROCm + flash-attention** path; runtime version (10.0 vs 10.1) does not
change it; contention is excluded by the free-GPU reproduction.

## Upstream search (2026-10-07, MEASURED activity)

Four targeted queries, **zero results**: amdgpu 7.0 RDNA4 page-fault/PERMISSION_FAULTS regression ·
llama.cpp ROCm FA gfx1201 `HSA_STATUS_ERROR_MEMORY_FAULT` · the exact dmesg signature with
`svm_range_restore_work` · llama.cpp ROCm FA crash on RX 9070/RDNA4. No public issue matches this
signature as of today — if it is a driver regression, it is not (yet) documented.

## Kernel diff — 7.0.0-34 vs 7.0.0-38 (test #2, completed 2026-10-07)

**Upstream bases (MEASURED from the `linux-hwe-7.0` source changelog, via `apt-get changelog`):**
both kernels are Resolute-based (Ubuntu 26.04 kernel tree). The 7.0.0-31/34 line synced
"upstream stable patchset **2026-07-21**"; the 7.0.0-38 line synced "**2026-08-26**". Note the
`v7.0.y` stable series ended at **v7.0.14 (2026-06-27)** — by July/August the active series was
v7.1/v7.2 — so these "stable patchset" syncs are Ubuntu's continued cherry-pick stream onto the 7.0
base, not released v7.0.y tags (INFERRED from the changelog wording + tag list).

The 7.0.0-38 source-changelog entry enumerates **every** patch applied since -34; ~60 touch
`drm/amdgpu`/`amdkfd`/`amd/display`. Six sit directly on the fault's code paths (SVM/HMM page
permissions, userptr mapping, HSA user-queue fences — all `MEASURED` as present in the -38 entry;
upstream SHAs resolved from commit subjects):

| Upstream commit | Subject | Why it fits the signature |
|---|---|---|
| [`6c1f4f7`](https://github.com/torvalds/linux/commit/6c1f4f7ff08448e0e18cd7fc4e59d6c96a36f25d) | `drm/amdgpu/gfx12: fix EOP interrupt routing for KQ and userq` (2026-07-01) | **gfx12 = our IP family.** End-of-pipe interrupts for kernel/user queues — misrouting means fence completion is signaled wrong; CPU proceeds while GPU-side state (incl. page-permission updates) is mid-flight |
| [`12f52fa`](https://github.com/torvalds/linux/commit/12f52fab11500d0dce7d23c71909eaf0cf9aa701) | `drm/amdgpu: rework userq fence signal processing` (2026-04-28 mainline; picked up in this window) | HSA submits through **user queues + doorbells**; a fence-signal bug lets the CPU run the next kernel before an SVM mapping transition completes → access with stale PTE permissions = exactly `PERMISSION_FAULTS=0x3, MAPPING_ERROR=0` |
| [`b89d58b`](https://github.com/torvalds/linux/commit/b89d58b6595d79dc3fe75e213e1f4c5efd0251d4) | `drm/amdkfd: Use exclusive bounds for SVM split alignment checks` (2026-06-17) | Changes **where SVM ranges are split** → which sub-ranges get which PTE permissions during restore/migration; correlates with the heavy `svm_range_restore_work` activity in dmesg |
| [`9d01579`](https://github.com/torvalds/linux/commit/9d01579f3f868b333acc901815972685989092c7) | `drm/amdgpu: fix lifetime issue of amdgpu_vm_get_task_info_pasid()` (2026-07-08) | PASID task-info **use-after-free**; our fault headers carry live pasids (7023, 7777) — a stale PASID context corrupts VM/fault handling |
| [`631849f`](https://github.com/torvalds/linux/commit/631849ff5d603841e74f19f4a5e30fe1f7d7cf30) | `drm/amdgpu: fix check in amdgpu_hmm_invalidate_gfx` | HMM invalidate is the **SVM page-migration path** itself — the path whose restore workers hogged CPU between the two faults |
| [`528b193`](https://github.com/torvalds/linux/commit/528b19377affc1cc7362a70a254c1dda793595f9) | `drm/amdgpu: check amdgpu_vm_bo_find() result in GET_MAPPING_INFO` | **userptr mapping-info** path — ROCm routes allocations through amdkfd/userptr; unchecked lookup can return a mapping with wrong/absent permissions |

Also in the window (secondary): `amdgpu_bo_move()` GTT→GTT fix, "Respect placement requirements in
`amdgpu_gtt_mgr`", `amdkfd: Avoid double-unpin of DOORBELL/MMIO BOs on free`, `amdkfd: fix redundant
MQD iterations in GFX v12.1` (v12.1 = our IP version), and a userq doorbell/reset rework series.

**Reading (INFERRED):** the -38 kernel absorbed a batch of amdkfd/SVM + userq-fence changes at once;
any one of the six above can produce *a PTE that exists but denies the access* while ROCm FA is
running — matching the dmesg signature and the SVM-restore activity. This does **not** prove which,
and it doesn't exclude an engine-side bug (the same `-fa on` crash shape could be a llama.cpp ROCm FA
OOB write landing in a permitted-but-wrong region). The reboot test (#1) still discriminates: if the
fault follows the driver → one of these six is the culprit; if it persists on -34 → engine-side.

## Attribution status & next steps

| # | Test | Distinguishes | Cost / status |
|---|---|---|---|
| 1 | **Reboot to kernel 7.0.0-34** (installed: -31/-34/-38 all present), re-run the failing cell (`llama-bench … -fa on`) | driver regression (-38) vs engine bug | disruptive — reboot drops the served model + GUI; **pending a convenient window** |
| 2 | Diff amdgpu RDNA4/SVM/gfxhub changes between 7.0.0-34 and 7.0.0-38 (kernel source) | narrows suspect without hardware | **DONE — six candidates above** |
| 3 | If -34 also faults: file upstream (llama.cpp ROCm FA / amdgpu) with this dmesg data + minimal repro (gfx1201, model, shape, `-fa on`, kernel -38) | engine bug confirmation | — |

**Recommendation:** take #1 at the next convenient reboot window. If the fault follows the driver →
pin 7.0.0-34 (or wait for a fixed kernel) and re-run step 4a/4b; if it follows the engine → ROCm
`-fa on` is unusable on this box until an upstream fix, and ROCm benches would need `-fa off`
(documented methodology change vs the Vulkan arms).

## Impact on current work

- Steps 4a/4b **skipped** per user decision (option 3); `latest-rocm` stays on the 10.0 build
  (`b790cf51aa-stew675-rocm`, patch set r4).
- The refreshed stew675 **r23** rebuild (`ba55e952b8-stew675-rocm`, base b11376, ROCm 10.1) is
  compiling — it will be benched **after** the FA fault is resolved, otherwise every `-fa on` cell
  fails again for environmental reasons.
- Vulkan arms are unaffected; `latest-vulkan` = b11448/SDK 1.4.363.0 stands.
