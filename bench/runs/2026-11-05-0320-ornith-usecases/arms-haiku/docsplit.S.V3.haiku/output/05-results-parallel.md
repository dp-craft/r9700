## Results — parallel at the ceiling (MTP off, agentic-32K streams, MEASURED)

Each slot = 262144 / np. Prompts EOS early (16–256 gen tok), so these are **prefill-bound**.

| Config | np | streams | Prefill tok/s p50 | Decode tok/s/stream p50 | Aggregate tok/s | TTFT p50 / p95 s |
|--------|:--:|:-------:|------------------:|------------------------:|----------------:|-----------------:|
| deep-par-np2 | 2 | 2×32K | 2142 | 69.7 (other stream starved to **6.7**) | 5.53 | 23.7 / 24.3 |
| deep-par-np4 | 4 | 4×32K | 1141 | 6.96 (spread 0.7 → 52) | 6.04 | 38.9 / **49.4** |

