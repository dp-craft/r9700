## KV decision (the ≤5% rule) — q8_0 REJECTED, hard

| Depth | f16 pf / dec / TTFT | q8_0 pf / dec / TTFT | Δpf% | Δdec% | ΔTTFT | VRAM saved | Verdict |
|------:|--------------------:|---------------------:|-----:|------:|------:|-----------:|---------|
| 200K (MTP=1) | 1125 / 82.4 / 171.7 s | 677 / 64.5 / 285.5 s | **−39.8%** | **−21.7%** | **+113.8 s (+66%)** | ~2 GiB (not needed) | **REJECT** — fails ≤5% on both axes by ~4–8× |

f16 already fits 200K (~3.9 GiB KV) with ~24 GB headroom; q8_0's ~2 GiB saving buys nothing and
costs a *catastrophic* prefill/TTFT regression. This is a stronger rejection than the 64K sweep's
−29.7% prefill — **the q8_0 penalty scales with context depth** (see finding 3).

