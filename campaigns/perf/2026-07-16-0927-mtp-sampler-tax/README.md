# 2026-07-16-0927-mtp-sampler-tax

Campaign type `perf`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): **Corrects the 27b-vs-35b campaign's `presence_penalty × MTP` mechanism.** Enabling ANY penalty sampler (presence/frequency/repeat) costs a **fixed ~2 ms/token of host work** — MEASURED +1.95/+2.07/+1.97 ms/tok across 35B-MTP-on/off and 27B-dense, and **CONFIRMED at ~132.9k depth (+1.3–1.9 ms/tok, depth-invariant)** — while draft acceptance is **unchanged**: `pp=0.01` emits a **sha1-identical** reply with identical draft counts and acceptance to the decimal, yet loses ~30% decode. Not an MTP interaction — MTP just shortens the step so the same fixed tax eats a bigger fraction (Amdahl). The campaign's implied +4.16 ms/tok was a **pp=1.5** figure that stacks the fixed tax **plus** genuine draft rejection at high penalty (the minority component the campaign over-generalized to the whole effect); the pure tax is ~2 ms at every depth, not 4, and session-degradation is excluded. `min_p` is free; `top_k 40`/`top_p 1.0` ~free. Also: `--spec-draft-n-max` 2–3 optimal shallow AND at depth (n-max 8 → 80 t/s, *worse than MTP off*), **MTP is not output-preserving** (on/off diverge at a fixed seed), and **MTP costs ~84 MiB GTT** — a lead on the campaign's unattributed spill.

- **Write-up:** [`2026-07-16-0927-mtp-sampler-tax.md`](../../../docs/findings/llamacpp/2026-07-16-0927-mtp-sampler-tax.md)
- **Recipe (as run):** `scripts/`. The write-up's method section has the commands.
- **`results/`** — rows, summaries, charts (committed): `2026-07-16-0927-mtp-sampler-probe/`, `2026-07-16-1111-spec-draft-pmin-mtp/`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-07-16-0927-mtp-sampler-probe/`, `bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/`
