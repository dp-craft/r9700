## What moved the needle (deltas)

| Change | Prefill Δ | Decode Δ | Net (256-tok request) | Note |
|--------|----------:|---------:|----------------------:|------|
| 8K → 200K depth (f16, MTP0) | 3077 → 1254 (**−59%**) | 104 → 61 (**−41%**) | TTFT 2.6 → 154 s | attention O(n) prefill + KV-bandwidth decode |
| MTP on @ 8K | −9.4% | **+14.5%** | wall ~flat (3.8→3.7 s) | decode-light → small win |
| MTP on @ 128K | −8.6% | **+19.4%** | wall +7.3 s (79.9→87.2) | **net loss** — prefill penalty > decode gain |
| MTP on @ 200K | −10.3% | **+35.1%** | wall **+16.7 s** (158→175) | **net loss** — prefill dominates |
| MTP on @ thinking (~0 prompt) | −8.9% | **+13.0%** | wall −1.5 s (9.8→8.3) | decode-dominated → net win |
| f16 → q8_0 @ 200K | **−39.8%** | −21.7% | wall +114 s | reject |
| np 2 → 4 @ 32K prompts | 2142 → 1141 /stream | collapses | TTFT p95 24 → 49 s, aggregate 5.5 → 6.0 | prefill-bound, no batching win |

