## Results — single-stream depth curve (concurrency 1, f16 KV, MEASURED)

Prefill = p50 tok/s, Decode = per-stream tok/s p50, TTFT = p50 s. `cr*` = code-review completions;
`think` = chat, 1024-tok budget. All `PREFIX_MODE=unique`, REPS=2.

| Config | MTP | depth | real prompt tok | Prefill tok/s | Decode tok/s | TTFT s | wall s (256 gen) |
|--------|:---:|------:|----------------:|--------------:|-------------:|-------:|-----------------:|
| deep-mtp0-cr8000   | 0 | 8K   | 8 133   | **3077** | 104.2 | 2.64  | 3.8 |
| deep-mtp0-cr128000 | 0 | 128K | 124 062 | 1611     | 71.3  | 76.0  | 79.9 |
| deep-mtp0-cr200000 | 0 | 200K | 193 347 | 1254     | 61.0  | 154.0 | 158.1 |
| deep-mtp1-cr8000   | 1 | 8K   | 8 130   | 2789     | 119.3 | 2.91  | 3.7 |
| deep-mtp1-cr128000 | 1 | 128K | 124 061 | 1472     | 85.1  | 84.0  | 87.2 |
| deep-mtp1-cr200000 | 1 | 200K | 193 347 | 1125     | **82.4** | 171.7 | 174.8 |
| deep-mtp0-think    | 0 | ~0   | 236     | 716      | 106.8 | 0.28  | 9.8 (1024 gen) |
| deep-mtp1-think    | 1 | ~0   | 239     | 652      | **120.6** | 0.31  | 8.3 (1024 gen) |
