# Reorganized reports

Source: `../doc.md` (one file mixing sections from several reports in random order).
Each `## ` section was moved — by byte range, no retyping — into the file it belongs to.

| File | Topic | Opens with |
|---|---|---|
| `topic-a.md` | RDNA4 / R9700 — llama.cpp · ollama tuning & backend optimum (64K) | §1 TL;DR — the optimum |
| `topic-b.md` | Benchmark: Qwen3.8-27B UD-Q4_K_XL vs RedHat MXFP4 δ 0 vs heretic — W2-08 blind-review **quality** | Summary (blind-quality comparison table) |
| `topic-c.md` | Analysis: why Q4_K_XL "thought less", and the quality + speed headroom | Summary ("did not think less per decision") |

Each report leads with its summary/conclusion, then its methodology and terms, the supporting measured results,
the consequences, and finally next steps. `doc_check.py` reports PASS.
