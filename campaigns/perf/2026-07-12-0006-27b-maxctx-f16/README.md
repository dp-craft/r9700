# 27B dense — validate f16 max context (and highest q8_0 context) (R9700, 2026-07-12)

> ⚠️ **CORRECTED (2026-07-12).** The "260 KiB/tok / VRAM-binds-at-64K" premise below is **wrong** —
> Qwen3.6-27B is **hybrid** (16 of 65 blocks full-attention; 48 SSM/linear-attn with no growing KV),
> so f16 KV is **64 KiB/tok** and it reaches **~240K (f16) / native 262K (q8_0)**. MEASURED: 200K f16
> = 29.0 GiB. This campaign only tested up to 64K/120K; those are not ceilings. See `analysis.md`'s
> correction banner and `bench/gguf_kv.py` (hybrid-aware).

Scaffolded by `bench/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue).

## Why this campaign (the question)
The deep-context 35B study showed f16 KV fits the **full native 262144** context because the MoE's
KV is tiny (~21 KiB/tok). **The 27B dense is the opposite regime.** Parsed from the GGUF:
`block_count 65 · head_count_kv 4 · key_length 256 · value_length 256` →
**f16 KV = 65 × 4 × (256+256) × 2 B = 260 KiB/token (~12× the MoE)**. So VRAM — not the RoPE cap —
binds context here. `bench/gen_campaign.py vram-ctx` (weights 15.01 GiB, budget 30–31 GiB):

| KV | KiB/tok | formula max `-c` (30 GiB / 31 GiB) | vs native 262144 |
|----|--------:|-----------------------------------:|------------------|
| f16  | 260 | **~54.9K / ~58.8K** | VRAM-bound (RoPE irrelevant) |
| q8_0 | 138 | **~103K / ~111K**   | VRAM-bound |

**Goal: pin both ceilings empirically** (trust the live OOM over the formula — real Vulkan compute
buffers add ~1–2 GiB, so the true ceiling sits a few K below the formula). The f16 bracket tops out
at the requested **64K**; the q8_0 bracket walks up to the **highest context that still loads**.

## Decisions locked (2026-07-12)
- **Backend:** Vulkan/RADV only (decode winner on this box) · **tuning:** `-ub 2048 -b 4096 -fa on`
  (35B sweep optimum, held fixed — *not* re-derived for the dense model; a `-ub` re-sweep is separate
  scope). `-fa on` is also **required for q8_0 KV**.
- **MTP:** **off everywhere** — the 27B dense GGUF has **no embedded MTP/draft layer** (MoE-only
  feature). Not a knob here.
- **KV:** **f16** for the primary ceiling test (per the ask), plus a **q8_0** arm to find the highest
  context q8_0 reaches (~2× f16 depth, at a speed cost documented in the deep-context report).
- **One reused fixture:** `codereview-40000.txt` (~40K tok) fits every slot (smallest = 49152,
  40K+256 gen). The KV is allocated to full `-c` at load, so **server-start success is the ceiling
  gate**; the 40K prefill confirms the server actually serves (and yields our first 27B-dense
  prefill/decode numbers at depth). `PREFIX_MODE=unique`, REPS=2.
- **No VRAM fallback:** a server that OOMs at start is the finding — it lands in `failures.txt` and
  brackets the ceiling from above. Do **not** lower `-c` to force it green.
- **`run.sh` is hand-edited** for bracket tolerance: a server start-failure is recorded and the run
  **continues** (the stock generator does `exit 1`, which would let the f16 OOM kill the q8 arm).
  ⚠️ If you ever regenerate from `spec.json`, re-apply this — see the header comment in `run.sh`.

## Expected outcome (to be confirmed)
f16: PASS at 48K/56K, FAIL by 64K → ceiling ≈ 56–60K. q8_0: PASS to ~104K, FAIL by 120K → ceiling
≈ 104–112K. Deviations from these formula predictions are the interesting result.

## Fixed parameters
- Model `Qwen3.6-27B-Q4_K_S.gguf` (15.01 GiB, dense, **no MTP layer**) · backend **vulkan** ·
  tuning `-ub 2048 -b 4096 -fa on` · server on :8081 · llama.cpp build b9950 (record if different).

## Build fixtures first (~1 min)
```bash
export ROOT=/home/dev/work/dp-craft/amd
cd "$ROOT/bench/workloads" && mkdir -p generated
python3 build_prompt.py --task tasks/codereview-large.task.md \
  --src corpus/ts-agentic-code-runner --src corpus/py-rich \
  --target-tokens 40000 --out generated/codereview-40000.txt
```
Builder errors out if the 40K target can't be filled ≥97 % (the ~565K-tok corpus is ample).

## Run
```bash
bash campaigns/2026-07-12-27b-maxctx-f16/run.sh
# resume after interruption: same command (done/ markers skip finished probes)
```

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| f16-c48k | 49152 | 1 | f16 | 0 | `maxctx-f16-c48k` | 1 | codereview-40000.txt |
| f16-c56k | 57344 | 1 | f16 | 0 | `maxctx-f16-c56k` | 1 | codereview-40000.txt |
| f16-c60k | 61440 | 1 | f16 | 0 | `maxctx-f16-c60k` | 1 | codereview-40000.txt |
| f16-c64k | 65536 | 1 | f16 | 0 | `maxctx-f16-c64k` | 1 | codereview-40000.txt |
| q8-c96k | 98304 | 1 | q8_0 | 0 | `maxctx-q8-c96k` | 1 | codereview-40000.txt |
| q8-c104k | 106496 | 1 | q8_0 | 0 | `maxctx-q8-c104k` | 1 | codereview-40000.txt |
| q8-c112k | 114688 | 1 | q8_0 | 0 | `maxctx-q8-c112k` | 1 | codereview-40000.txt |
| q8-c120k | 122880 | 1 | q8_0 | 0 | `maxctx-q8-c120k` | 1 | codereview-40000.txt |

⚠️ **Watch points**
- **Runtime OOM ≠ start OOM.** A server can allocate `-c` KV at load but OOM mid-prefill when the
  compute buffer grows. The 40K probe exercises a real prefill, but it does *not* fill the biggest
  slots to the top — so a green server here means "loads + serves to ≥40K", not "usable to the last
  token." Spot-checking a near-full prompt on the highest passing server is a cheap follow-up.
- **q8_0 speed cost.** Expect q8_0 prefill/decode well below f16 (the 35B saw −40 %/−22 % at depth
  on this Vulkan path). The q8_0 arm answers "how deep can we go", not "should we" — pair the ceiling
  with its throughput row in the write-up.
- **Dense decode is slow.** The 27B reads all ~15 GiB of weights per token (vs ~3B active for the
  MoE), so decode tok/s will be far below the MoE's ~100. That's expected, not a regression.

## Out of scope (deliberately)
- **`-ub`/`-b` re-sweep for the dense model** (uses the MoE optimum; separate tuning campaign) ·
  **ROCm backend** · **concurrency / parallel slots** (np=1 only — max-context is a single-slot
  question) · **MTP** (no draft layer) · **filling contexts to the very top** (40K probe validates
  serving, not last-token usability) · **>262144** (RoPE cap, not reached here anyway).

## Write-up
`/benchmark-results` → co-located `campaigns/2026-07-12-27b-maxctx-f16/analysis.md`; `report.html` auto-generated by `run.sh`'s last
step (`bench/lib/report.py`). Add a `<!-- meta -->` block to the report and run `docs/reindex.py`.
Report the **pinned f16 and q8_0 ceilings** (measured, with the OOM bracket) vs the formula, plus the
first 27B-dense prefill/decode-at-40K numbers.
