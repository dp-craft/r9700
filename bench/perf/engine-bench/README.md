# engine-bench — cross-engine comparator + serving-level combos

**Same real workload → every engine → apples-to-apples**, at the level users actually feel:
an OpenAI-compatible server endpoint. This is also where the *serving-only* knobs live —
**MTP** (`--spec-type draft-mtp`), **parallel slots** (`-np`), prefix caching — that
`model-bench`/llama-bench cannot measure.

## The pieces

| Script | What |
|--------|------|
| `capture_engine.py probe` | zero-install measurement client: real prompt files, **concurrency waves**, reps, TTFT p50/p95, per-stream + **aggregate tok/s**, thinking `ttfa_s`, prefix modes |
| `run.sh` | drive a set of already-running engines with one workload (probe or benchy) |
| `serve_llamacpp.sh` | parameterized llama-server launcher: `BACKEND/MTP/KV/CTX/NP/UB/B/FA/PORT`, health-wait, records exact cmdline + `/props` |
| `campaign.sh` | the **combination matrix**: backend × MTP × KV × depth × concurrency, resumable |
| llama-benchy | standardized synthetic pp/tg/depth/concurrency curves (installed in `bench/dl/benchy-venv`, v0.4.0 verified) |

## Probe metrics (why these)

| Field | Meaning | Matters for |
|-------|---------|-------------|
| `ttft_s` p50/p95 | time to first token | large-context UX (prefill-bound) |
| `prefill_tok_s` | prompt_tokens / ttft (server-reported tokens) | prefill at real context |
| `decode_tok_s_per_stream_p50` | sustained per-stream decode | single-agent feel |
| `aggregate_tok_s` | total generated tokens / wave wall time | **what N parallel agents get out of the box** |
| `ttfa_s` | time to first *answer* token (chat api: measured via `reasoning_content`) | thinking-mode perceived latency |
| `tok_count_source` | `usage` (exact) or `sse_chunks` (approx) | trust level of token counts |

Probe knobs: `--concurrency N --reps R --prefix-mode unique|shared|none --api completions|chat`.
- `unique`: per-request unique prefix → **cold prefix cache every request** (use for honest
  prefill numbers; identical prompts hit the server prefix cache from rep 2 on — measured 2.4×
  inflated "prefill" when we tried).
- `shared`: identical prompt each stream → prefix-cache best case (agent turns sharing a system prompt).
- `--api chat`: REQUIRED for bare-instruction/thinking prompts (raw completions can EOS after
  1 token — measured); gives measured `ttfa_s`.

## Typical runs

```bash
# cross-engine, one workload (start servers first — GUIDE §3):
PROMPT_FILE=$PWD/../workloads/generated/codereview-64000.txt SLUG=cr64k \
  MAX_TOKENS=256 PREFIX_MODE=unique ./run.sh

# full combination campaign on the 35B (server restarts handled for you, resumable):
./campaign.sh                      # defaults: rocm+vulkan × mtp0/1 × f16/q8_0, Part A+B
CAMPAIGN_DIR=... ./campaign.sh     # resume an interrupted campaign

# llama-benchy (synthetic, standardized — good for community-comparable numbers):
BENCHY_ARGS="--pp 2048 8192 --tg 128 --depth 0 16384 --concurrency 1 4 --runs 3 \
  --save-result out.json --format json" USE_BENCHY=1 SLUG=benchy ./run.sh
```

## Known issue (upstream, measured 2026-07-11, build b9950)
`--spec-type draft-mtp` on the 35B GGUF (embedded `nextn_predict_layers=1`) works on the chat
path (+24% decode measured) and on long code prompts, but **crashed mid-stream on a short raw
/completions prompt** at CTX=4096 (`init: invalid token[1] = 248320` → `Invalid input batch`).
`campaign.sh` tolerates per-point failures (`failures.txt`); if an MTP point fails, rerun it or
mark it FAILED in the report — don't average it away.

> Fairness rules: identical prompt file + `max_tokens`, warm each server once (probe `--warmup 1`
> is default), `unique` prefix for prefill honesty, and keep each engine's `/props` + cmdline
> (run.sh and campaign.sh save both automatically).
