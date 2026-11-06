## Results — all 14 cells

All rows MEASURED from `out/summary.md`. n = 15 per cell (5 tasks × 3 reps). **Row order is not a ranking.**

| cell | model | KV | budget | temp/pp | TS % | 95% CI | rep sd | hard % | judge/5 | think tok | full s | decode t/s | peak VRAM | peak GTT |
|---|---|---|---:|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `un-d128-f16-rb4096` | 27B Q4_K_M | f16 | 4096 | 0.6 / 0 | **78.3** | [71.7, 85.0] | 4.9 | 0 | 3.6 | 4095 | 156.9 | 46.1 | 29809 | 1825 |
| `xl-d128-f16-rb4096` | 27B UD-Q4_K_XL | f16 | 4096 | 0.6 / 0 | **69.8** | [60.7, 78.9] | 7.6 | 0 | 3.2 | 3990 | 156.7 | 45.4 | 30536 | 1902 |
| `q5-d128-q8-rb4096` | 27B Q5_K_M | q8_0 | 4096 | 0.6 / 0 | **76.5** | [71.3, 81.7] | 7.6 | 0 | 3.4 | 3492 | 189.3 | 35.4 | 27466 | 1776 |
| `q5-d128-f16-rb4096` | 27B Q5_K_M | **f16** | 4096 | 0.6 / 0 | **74.3** | [67.9, 80.8] | 7.4 | 0 | 3.6 | 3433 | 157.0 | 43.1 | 31415 | 2829 |
| `q6-d128-q8-rb4096` | 27B Q6_K | q8_0 | 4096 | 0.6 / 0 | **80.9** | [74.7, 87.1] | 6.5 | 7 | 3.5 | 3666 | 212.6 | 32.6 | 30214 | 1776 |
| `un-d128-f16-rb16384` | 27B Q4_K_M | f16 | 16384 | 0.6 / 0 | **78.6** | [72.4, 84.8] | 5.2 | 0 | 3.6 | 6834 | 216.7 | 45.7 | 29864 | 1901 |
| `q5-d128-f16-rb16384` | 27B Q5_K_M | f16 | 16384 | 0.6 / 0 | **77.5** | [71.5, 83.5] | 4.8 | 0 | 3.6 | 5691 | 230.8 | 43.1 | **31918** | **2841** |
| `a3b-d128-f16-rb4096` | 35B-A3B | f16 | 4096 | 0.6 / 0 | **73.3** | [62.1, 84.4] | 15.7 | 7 | 3.2 | 4063 | **60.9** | 120.1 | 27081 | 1551 |
| `a3b-d128-f16-rb16384` | 35B-A3B | f16 | 16384 | 0.6 / 0 | **77.5** | [67.7, 87.3] | 11.1 | 7 | 3.3 | 8541 | 96.2 | 120.1 | 27196 | 1629 |
| `a3b-d128-f16-rbmax` | 35B-A3B | f16 | **−1** | 0.6 / 0 | **75.4** | [64.7, 86.0] | 12.6 | 7 | 3.3 | 9522 | 104.4 | 119.3 | 30773 | 1668 |
| `a3b-…-rb16384-t03` | 35B-A3B | f16 | 16384 | **0.3** / 0 | **70.0** | [62.3, 77.7] | 11.2 | 0 | 3.1 | 8121 | 92.6 | 120.2 | 27835 | 1704 |
| `a3b-…-rb16384-t10` | 35B-A3B | f16 | 16384 | **1.0** / 0 | **68.4** | [55.0, 81.8] | 12.1 | 7 | 3.1 | 9120 | 103.7 | 115.7 | 27671 | 1652 |
| `a3b-…-rb16384-qwen-gen` | 35B-A3B | f16 | 16384 | **1.0 / 1.5** | **62.1** | [52.5, 71.8] | 13.5 | 0 | 3.0 | 7974 | 133.8 | **78.1** | 27345 | 1645 |
| `a3b-…-rb16384-unsloth-reason` | 35B-A3B | f16 | 16384 | **1.0 / 2.0** | **63.0** | [53.9, 72.2] | 16.3 | 0 | **2.7** | 9226 | 161.0 | **72.6** | 27344 | 1643 |

**Health (MEASURED, digest Health line):** 0 failures, 0 `grade_error` rows across all 14 cells. Runaway/truncation > 0 in exactly one cell: **`a3b-d128-f16-rbmax`** (the unlimited-budget cell) at 7%. ⚠ **GTT spill > 500 MiB in all 14 cells.**

![Config scorecard](charts/scorecard.svg)

> Bar order is **NOT a ranking** — no pair of cells in the quant ladder is resolvable (all CIs overlap). Read this for the *shape* of the trade: the 35B's time bar and the two presence_penalty cells' collapse are the only differences that clearly beat the noise. MEASURED, all 14 cells.

---

