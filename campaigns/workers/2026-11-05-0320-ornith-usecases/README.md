# 2026-11-05-0320-ornith-usecases

Campaign type `workers`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): Local-agent Ornith 1.5 on native Radiance is eligible for high-volume mechanical doc extraction up to about 110k tokens / 7 docs per session (117k: 32/35 facts on the exact line, 0 fabricated, 9/9 planted incidents at 185k context), but not unattended for judgement: on the same 4 reports at depth, two blind passes gave verdicts of 8-9/12 against Haiku high's 11-12/12. Across its 6 deep notes it had 3 critical errors (2 in both Opus passes, 1 found by a later Haiku check), 19 incidents missed and 0 cross-report conflicts found. Haiku medium had the best path recall (43/45) and clean formatting but missed more incidents than high or low. Ornith has no effort levels (only thinking on/off), reasoning replay costs 7.4-9.2k of window per doc, and local-agent.sh loads CLAUDE.md plus 48 tools (33.2k tokens) unless given clean flags.

- **Write-up:** [`2026-11-04-2207-sly-radiance-ornith-vs-haiku-high-effort.md`](../../../docs/findings/workers/2026-11-04-2207-sly-radiance-ornith-vs-haiku-high-effort.md) · [`2026-11-05-0814-ornith-use-cases.md`](../../../docs/findings/workers/2026-11-05-0814-ornith-use-cases.md) · [`2026-11-06-0930-haiku-manual.md`](../../../docs/findings/workers/2026-11-06-0930-haiku-manual.md) · [`2026-11-06-0930-ornith-manual.md`](../../../docs/findings/workers/2026-11-06-0930-ornith-manual.md)
- **Recipe (as run):** `scripts/`. The write-up's method section has the commands.
- **`inputs/`** — fixtures (committed): `2026-11-05-0320-ornith-usecases/`
- **`results/`** — rows, summaries, charts (committed): `2026-11-05-0320-ornith-usecases/`, `2026-11-05-0934-ornith-radiance-c3.md`
- **`tmp/`** — raw data: server logs, replies, GPU sample CSVs (git-ignored, local only)
- **Migrated from:** `bench/runs/2026-11-05-0320-ornith-usecases/`, `bench/runs/2026-11-05-0934-ornith-radiance-c3.md/`
