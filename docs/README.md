# docs/

Written reports about the AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB) running local coding LLMs.
**Start at [`INDEX.md`](INDEX.md)**: every report, newest first, with its one-line takeaway.

| Dir | What is in it |
|---|---|
| [`findings/<topic>/`](findings/) | Our own measurements. One write-up per campaign; its `campaign:` meta line names the dir under `campaigns/` that holds the data |
| [`research/<topic>/`](research/) | External knowledge: what upstream repos, vendor docs and model cards say, sourced and dated |
| [`guides/`](guides/) | How-tos: [`GUIDE.md`](guides/GUIDE.md) (running benchmarks), the driver-upgrade runbook, the [vLLM knowledge base](guides/vllm/) |
| [`articles/`](articles/) | Published write-ups built from the findings |

## Reading a finding

- **Summary and table first**, method and detail below.
- Every number carries its provenance: `MEASURED` (a row in the campaign's `results/`, cited by its `label`),
  `CLAIMED` (external, with a source) or `INFERRED` (reasoned, and it says so).
- The data sits in `campaigns/<type>/<stamp>-<slug>/` (named on the report's `campaign:` line): the recipe at the root,
  fixtures in `inputs/`, committed rows, summaries and charts in `results/` (`results/appendix.md` embeds the charts).
  Raw replies, server logs and GPU sample CSVs stay in `tmp/` on the bench box and are not in git.
- Versions matter on RDNA4: each report names the ROCm, Mesa, llama.cpp build, model, quant and KV settings it ran with.

## Adding a report

1. File it as `findings/<topic>/YYYY-MM-DD-HHMM-<slug>.md` (with `campaign: campaigns/<type>/<stamp>-<slug>`) or
   `research/<topic>/YYYY-MM-DD-HHMM-<slug>.md`. English.
2. Start it with a meta block:
   ```
   <!-- meta
   date: 2026-11-07 16:00
   takeaway: one line: the result, with its key number
   campaign: campaigns/perf/2026-11-07-1600-example
   -->
   ```
3. Run `docs/reindex.py`. It rebuilds `INDEX.md` and fails when a report has no meta block or its `campaign:` does not
   exist (`docs/reindex.py --check` only verifies).
