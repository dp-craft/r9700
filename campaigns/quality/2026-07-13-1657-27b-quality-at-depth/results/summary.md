# Depth run — deterministic digest (`aggregate.py`)

_All numbers computed in Python from out/*.jsonl. The analysis LLM writes prose from THIS + charts/appendix.md — it does not read the per-reply jsonl._

## Per-cell aggregates

| cell | model | depth | kv | budget | n | TS % | hard % | judge/5 | judge d·c·r | think tok | ttfa s | full s | decode t/s | peak VRAM | peak GTT | runaway % | fails |
|------|-------|-------|----|-------:|--:|-----:|-------:|--------:|:-----------:|----------:|-------:|-------:|-----------:|----------:|---------:|----------:|------:|
| un-d128-f16-rb1024 | Qwen3.6-27B-MTP-Q4_K_M | 128k | f16 | 1024 | 12 | 24 | 0 | 4.0 | 4.0·4.2·3.8 | 1023 | 56.7 | 84.8 | 43.6 | 29940 | 2028 | 0 | 0 |
| un-d128-f16-rb2048 | Qwen3.6-27B-MTP-Q4_K_M | 128k | f16 | 2048 | 12 | 30 | 0 | 4.2 | 4.2·4.6·3.8 | 2047 | 128.6 | 168.9 | 44.5 | 30301 | 2017 | 0 | 0 |
| un-d128-f16-rb4096 | Qwen3.6-27B-MTP-Q4_K_M | 128k | f16 | 4096 | 12 | 26 | 0 | 4.1 | 3.9·4.2·4.1 | 3905 | 122.7 | 147.2 | 44.3 | 30509 | 2049 | 0 | 0 |
| un-d128-q8-rb2048 | Qwen3.6-27B-MTP-Q4_K_M | 128k | q8_0 | 2048 | 12 | 28 | 0 | 4.1 | 4.2·4.1·3.9 | 2043 | 105.1 | 135.8 | 35.4 | 25880 | 2035 | 0 | 0 |
| un-d64-f16-rb1024 | Qwen3.6-27B-MTP-Q4_K_M | 64k | f16 | 1024 | 12 | 26 | 0 | 4.0 | 4.2·3.9·4.0 | 1023 | 33.8 | 52.4 | 54.4 | 25178 | 1383 | 0 | 0 |
| un-d64-f16-rb2048 | Qwen3.6-27B-MTP-Q4_K_M | 64k | f16 | 2048 | 12 | 28 | 0 | 4.1 | 4.1·4.2·4.1 | 2047 | 53.0 | 70.6 | 54.8 | 24988 | 1369 | 0 | 0 |
| un-d64-f16-rb4096 | Qwen3.6-27B-MTP-Q4_K_M | 64k | f16 | 4096 | 12 | 33 | 0 | 4.0 | 3.9·4.2·3.9 | 3986 | 89.6 | 105.9 | 54.3 | 25058 | 1386 | 0 | 0 |
| jr-d128-f16-rb2048 | Qwopus3.6-27B-v1-preview-Q4_K_M | 128k | f16 | 2048 | 12 | 25 | 0 | 3.9 | 3.8·4.2·3.8 | 1970 | 123.1 | 193.6 | 21.1 | 28187 | 1001 | 0 | 0 |
| jr-d128-q8-rb2048 | Qwopus3.6-27B-v1-preview-Q4_K_M | 128k | q8_0 | 2048 | 12 | 28 | 0 | 4.1 | 4.0·4.5·3.8 | 1762 | 122.2 | 184.7 | 22.1 | 22779 | 974 | 0 | 0 |
| jr-d64-f16-rb2048 | Qwopus3.6-27B-v1-preview-Q4_K_M | 64k | f16 | 2048 | 12 | 27 | 0 | 4.1 | 4.2·4.2·3.8 | 2026 | 94.7 | 143.1 | 24.9 | 23361 | 785 | 0 | 0 |

## Findings (computed, not inferred)

- **(a) Budget curve — does the optimum rise with depth?** unsloth-f16 TS% by budget:  64k: 1024→26%, 2048→28%, 4096→33% (peak 4096). 128k: 1024→24%, 2048→30%, 4096→26% (peak 2048). Optimum **falls** with depth.
- **(b) Depth 64k→128k (budget 2048):** TS% 28→30 (Δ2); reuse-objective 1.00→1.00 (the lost-in-the-middle sensor).
- **(c) KV f16 vs q8 @128k (budget 2048):** TS% 30→28 (Δ-2.3%, within the ≤5% rule). VRAM 30301→25880 MiB (saves 4421)
- **(d) Capability:** best local cell = 33% TS. Reference: haiku 74% (Δ-42) · sonnet 85% (Δ-52) · opus 95% (Δ-63).
- **Health:** **GTT spill (>500 MiB) in: un-d64-f16-rb1024, un-d64-f16-rb2048, un-d64-f16-rb4096, un-d128-f16-rb1024, un-d128-f16-rb2048, un-d128-f16-rb4096, un-d128-q8-rb2048, jr-d64-f16-rb2048, jr-d128-f16-rb2048, jr-d128-q8-rb2048** — freeze risk, flag loudly
