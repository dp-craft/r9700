# hipfire vs llama.cpp on gfx1201 (R9700) — full evaluation + ROCm 10 upgrade

All material from the 2026-09-10 session, consolidated. Hardware: AMD Radeon AI PRO R9700
(gfx1201, RDNA4, 32 GB, 210 W cap). Model: Qwen3.8-27B — `mq4-pro` on hipfire, `Q4_K_XL` on
llama.cpp.

## Read in this order

| File | What it is |
|---|---|
| `01-research-technical.md` | How to install/configure/wire hipfire alongside llama-swap. Support matrix, three integration approaches, the config-generator problem. |
| `02-rollout-plan.md` | Three gated phases (bench → opencode → llama-swap), rollback table. **Contains the `cc`-shim environment trap.** |
| `03-bench-baseline.md` | llama.cpp baseline only. Superseded by `04`. |
| `04-bench-rocm713-final.md` | Full cross-engine comparison **on ROCm 7.13**. Verdict, feature deltas, methodology corrections. Numbers superseded by `05` §16–17. |
| `05-rocm10-upgrade-log.md` | The ROCm 7.13 → 10.0 upgrade: survey, four install attempts, results, reversals. **Current state of knowledge.** |
| `06-final-analysis.md` | **Start here for the conclusions.** Synthesis of the whole evaluation: pros and cons, when and how to use hipfire, the trap list, stability record, complexity, and what would actually move the needle. |

## Headline result

ROCm 10.0.0 (which ships **HIP 7.15**, not 10.x) fixes hipfire's long-context prefill collapse:

| 55K-token prefill, CASK off | prefill tok/s | wall |
|---|---|---|
| hipfire, ROCm 7.13 | 186.2 | 296.59 s |
| **hipfire, ROCm 10.0** | **550.9** | **100.45 s** |
| llama.cpp Vulkan | 595.3 | 95.34 s |

Prefill degradation 6.4K → 55K went from **3.30×** to **1.005× (flat)**. The gap to llama.cpp went
from 3.2× to 8 %.

> **Do not quote "flat" as settled.** That row is a *cold one-shot* prefill at a fixed depth. Measured
> 2026-09-10 with an *incremental multi-turn* workload — the shape real agent traffic has — hipfire's
> 27B prefill decayed as `depth^-1.324` (R² 0.961): 469 tok/s at 18k, 80.5 at 73k. **That decay was a
> misconfiguration, since fixed** — see the next block. The two results were never reconciled
> (`05` §27.14); the leading hypothesis is that §19 ran `--warmups 2 --reps 2`, so its reps were warm.

**The −1.324 decay was a dispatcher threshold, and it is fixed** (`05` §28.1–28.2, 2026-09-10). On
gfx1201 hipfire's fast WMMA prefill-attention kernel is default-on only up to 32 768 tokens — a
ceiling certified on an `nh=8, nkv=2` model, not on this 27B (`nh=24, nkv=4`). Past it, dispatch falls
to a legacy kernel roughly 3.4× slower per attention pass. `developer.flash_prefill=1` overrides the
envelope. Paired with `developer.flash_prefill_min_ctx=1000000`, which keeps the same opt-in from
rerouting the speculation-verify forward (`05` §28.5), it gives:

| 27B prefill | @18k | @37k | @55k | @73k |
|---|---|---|---|---|
| before | 469 | 260 | 109 | 80.5 |
| **after** (median of 5–6 runs) | 469 | 326 | **232** | **146.7** |

**1.82× at 73k** (median; the range across five runs is 1.79–2.27×), exponent **−1.324 → −0.797**.
An earlier revision of this block quoted 182.5 tok/s and 2.27× from a single run. Deep-context
prefill repeats to only ±27% on this card while shallow prefill repeats to ±3%, so the maximum of
five samples was not a rate (`05` §28.11.5).

**Engine verdict at depth (27B, 2026-09-10, post-fix).** Prefill-decay exponents still differ enough
to reverse the ranking, so no single-depth comparison is valid:

| arm | exponent | R² | @18k | @73k | proj. @164k |
|---|---|---|---|---|---|
| llama.cpp f16 KV | **−0.294** | 0.992 | 901 | 594 | **~476** |
| llama.cpp q8_0 KV | −0.499 | 0.989 | 853 | 424 | ~292 |
| hipfire 27B q8_0, fixed | −0.797 | 0.939 | 469 | 146.7 | ~88 |
| hipfire 27B q8_0, before the fix | −1.324 | 0.961 | 469 | 80.5 | ~28 |

The fix closes the gap from ~10× to ~4.5× at 160k but does not reverse it. **Parity is impossible by
configuration**: hipfire's best-case draft-free 18k prefill, 569–606 tok/s, is what llama.cpp f16
sustains at 73k. **For 160k+ agentic work llama.cpp remains the engine, f16 KV the configuration**
(`05` §27.18, §27.20, §28.10). Projections past 73k are `INFERRED`.

Three further results from the same campaign (`05` §28):

- **Multi-agent prefix reuse is zero.** hipfire keeps one conversation's KV; any divergence resets it
  to position 0. Two agents alternating re-prefill in full on every switch — 52 s to add 400
  characters. Architectural, not a setting (§28.6, §28.7).
- **n-gram speculation is the one speculator that pays**, and only on copy-heavy output: 119 tok/s at
  18k, 42 at 73k, byte-identical to plain decoding. On free prose it falls back to AR speed (§28.8).
- **A GPU memory fault wedges 7 of 19 draft-free boots** on the first large request, with `/health`
  still answering `ok`. Warm-up requests do not prevent it. Keeping the DFlash draft loaded is the
  only known avoidance (§28.3).

## Open items — read before acting on any of this

1. **DFlash silently stops speculating on the coding workload under ROCm 10** (`tau` absent, decode
   150.2 → 28.7). Unresolved; `05` §17.2. This is the workload closest to real runner traffic.
2. `memory.cask.enabled` **must be false** on ROCm 10 — CASK is now a 1.88× penalty (`05` §17.1).
3. ROCm 7.13 is still installed alongside 10.0. `rocm-upgrade/purge-rocm-7.13.sh --apply` removes it
   (gated, dry-run by default).
4. `04-bench-rocm713-final.md`'s verdict ("don't replace llama.cpp") predates the ROCm 10 data and
   should not be quoted without `05`.
5. Phases 2 (opencode provider) and 3 (`generate.py` llama-swap backend) never started.
6. **The 160k figures are extrapolated** from measurements topping out at 73k — a power law taken
   2.2× past its data. Strong fits (R² 0.96–0.99), but an assumption, not a measurement.
7. `hipfire bench`'s **batch and slots backends emitted no rows** (`batch backend unavailable:
   hipfire_client::Engine has no public multi-inflight API`). That is the in-process client the bench
   drives, **not** the daemon's HTTP continuous-batching path, which did serve 4/4 (`05` §27.11,
   §27.21). Do not conflate them.
8. Scope from 2026-09-10: **27B single-stream only**. Concurrency is settled — 4 streams buy 1.28×
   aggregate, not 4× (`05` §27.21) — and the 35B is out of scope.

## Subdirectories

- `bench/` — the harness (`bench.py`, `report.py`), every raw `.jsonl`, `discarded/` (cache-
  contaminated and under-warmed runs, kept deliberately), and `drivers-*.sh` (the exact scripts that
  produced the ROCm 10 arms).
- `rocm-upgrade/` — `install-rocm-10.sh`, `purge-rocm-7.13.sh`, and `pre-upgrade-state.txt`
  (verbatim pre-upgrade system capture).

## Reproducing a measurement

The GPU must be exclusive — llama-swap holds ~20 GB of 32.6 GB and will starve hipfire silently.
**Use the gate, don't hand-roll it:**

```bash
bench/lib/gpu_exclusive.sh 26000     # unload + kill + assert floor; non-zero names the holder
```

It exists because this section's advice was already here on 2026-09-10 and the run was contaminated
anyway. Two traps it now encodes:

- `/unload` is **GET**. `POST` returns **405**, and `curl -sf … >/dev/null 2>&1` swallows it — a
  cleanup step reports success and frees nothing.
- hipfire is a **split process shape** (`bin/daemon` + `hipfire serve`). Killing only the daemon
  leaves `serve` holding `:11435` and answering `/health` with a stale model, so every request 500s.

And assert a **free-VRAM floor before boot**, not just after your own kill: hipfire's VMM
`kv_backend` has no allocation to fail, so contention shows up as *slowdown only* — no OOM, nothing
in `serve.log` or `dmesg`. The only evidence is residency (`amd-smi process -g 0`) far below the
known working set. Readiness gating has a matching trap: `/health` returns
`{"model":null,"loading_model":null}` *before a load starts*, so wait for a **non-null `model`**,
never merely for `loading_model":null`.

Both engines must be measured cold: `bench.py` prepends a UUID nonce per request because a repeated
6k prompt otherwise served from KV cache read as 18.5 tok/s instead of 843 (a 45× error). hipfire
needs `--warmups 10` — it graph-captures per batch size and only then reaches steady state.
