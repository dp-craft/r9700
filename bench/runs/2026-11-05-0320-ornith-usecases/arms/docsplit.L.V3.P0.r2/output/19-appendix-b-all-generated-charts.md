## Appendix B — all generated charts

Every chart is generated over **all 14 cells** by `make_charts.py` / `make_charts_detailed.py`. Charts embedded in the body above are not repeated here.

**Cell-level** (`charts/`):

| Chart | What it shows |
|---|---|
| [`quality_deterministic.svg`](charts/quality_deterministic.svg) | deterministic objective accuracy per cell |
| [`quality_judge.svg`](charts/quality_judge.svg) | blind-judge score per cell — a 2.7-3.6 band, not resolvable |
| [`hard_pass.svg`](charts/hard_pass.svg) | hard-pass rate per cell (0-7%) |
| [`quality_vs_cost.svg`](charts/quality_vs_cost.svg) | quality against token cost |
| [`quality_vs_time.svg`](charts/quality_vs_time.svg) | quality against full-answer time — the 35B's trade, at a glance |
| [`throughput.svg`](charts/throughput.svg) | prefill / decode throughput per cell |
| [`latency.svg`](charts/latency.svg) | ttft to ttfa per cell |
| [`token_economy.svg`](charts/token_economy.svg) | thinking tokens vs answer tokens — the budget axis, visually |
| [`task_heatmap.svg`](charts/task_heatmap.svg) | cell x task score matrix |

**Per-task** (`charts/detailed/`):

| Chart | What it shows |
|---|---|
| [`d1_capability_by_task.svg`](charts/detailed/d1_capability_by_task.svg) | local cells vs the reference ladder, per task |
| [`d3_quant_cost.svg`](charts/detailed/d3_quant_cost.svg) | quant ladder against cost |
| [`d4_efficiency_by_task.svg`](charts/detailed/d4_efficiency_by_task.svg) | efficiency per task |
| [`d5_hardpass_by_task.svg`](charts/detailed/d5_hardpass_by_task.svg) | hard-pass by task |
| [`d6_model_by_task.svg`](charts/detailed/d6_model_by_task.svg) | 27B vs 35B per task |
| [`d7_judge_axes_by_task.svg`](charts/detailed/d7_judge_axes_by_task.svg) | design / clarity / robustness per task — robustness is the low axis nearly everywhere |
| [`d8_objective_by_task.svg`](charts/detailed/d8_objective_by_task.svg) | objective breakdown per task |

**Full verdict tables.** The complete blind-judge table — one row per candidate (config x task x rep) with TS %, hard-pass, the three judge axes, the judge's one-line note and the deterministic `fails:` list — is in [`charts/appendix.md`](charts/appendix.md), together with the cell-level data table. Per-task equivalents: [`charts/detailed/appendix.md`](charts/detailed/appendix.md).
