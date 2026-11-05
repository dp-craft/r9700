## What is stable vs what is not

The single most useful table in this report. "Stable" = survives the digest's own significance/resolution rules, or is far larger than the noise floor.

| Claim | Status | Evidence (MEASURED) |
|---|---|---|
| The wall is cleanliness, not logic | **STABLE** | lint 0.36 · types 0.47 vs tests 0.84 · edge 0.87 · reuse 0.99; holds in all 14 cells and in the references |
| 35B-A3B is far faster | **STABLE** | decode 115.7–120.2 vs 32.6–46.1 t/s; full answer 60.9 s (a3b rb4096) vs 212.6 s (Q6_K) — orders above noise |
| `presence_penalty > 0` costs decode throughput | **STABLE** (mechanism CORRECTED 2026-07-16) | 78.1 / 72.6 t/s vs 115.7–120.2. **Not** draft rejection — a fixed ~2 ms/tok host tax on the penalties sampler; reproduces MTP-off + on the 27B (`2026-07-16-0927-mtp-sampler-tax.md`) |
| Budget > 4096 does not pay on the 27B | **STABLE** | paired Δ +0.3, t=0.37, ns, **sd 1.8** — a tight null, not an underpowered one |
| Unlimited budget is harmful | **STABLE** | 14/15 replies identical to rb16384; the one freed reply ran to 31,093 tok and fell 77→45; runaway 7% |
| Reruns pay | **STABLE** | Δ rerun +4.6 … +17.5 pts across all cells; hard@R 20% vs hard@1 7% |
| GTT spill | **STABLE** (MEASURED) | 1551–2841 MiB, all 14 cells |
| Per-rep determinism at a fixed seed | **STABLE** | replies are identical across cells wherever the budget did not bind |
| Q5_K_M at f16 KV / ctx 163840 fits | **STABLE** (MEASURED) | peak VRAM **31918** MiB of 32624; 0 failures |
| Temp 0.6 beats temp 0.3 on the 35B | ⚠ **WITHDRAWN 2026-07-16 — NOT resolvable** | Within-model (`--baseline a3b-…-rb16384`): t03 meanΔ −7.5, t=−2.60 < 2.776, **ns**. The old "−8.3, t=−4.11" was vs the 27B Q4_K_M (wrong model) |
| Qwen "thinking general" **preset** is worse | **SIGNIFICANT (within-model, corrected)** | qwen-gen meanΔ **−15.4, t=−3.41** vs the 35B coding recipe. Splits ~−9 temp / −6 pp; **neither component alone is resolvable** |
| **The quant ladder** | **NOT RESOLVABLE** | all paired Δ ns (\|t\| ≤ 1.98 < 2.776); all CIs overlap; resolution ≳12 pts |
| **27B vs 35B-A3B quality** | **NOT RESOLVABLE** | paired Δ −5.1, t=−1.70, ns |
| **KV f16 vs q8_0** | **NOT RESOLVABLE** (and bounded small) | Q5_K_M 74.3 (f16) vs 76.5 (q8_0); no test printed; CIs overlap |
| Budget 4096→16384 on the **35B** | ⚠ **RESOLVED 2026-07-16 — SIGNIFICANT** | Within-model paired: **−4.3, t=−5.45** (`--baseline a3b-…-rb16384`). The MoE genuinely benefits from a bigger budget; the dense 27B does not (+0.3, ns) |
| More budget steadies the 35B | **NOT RESOLVABLE** | rep sd 15.7 → 11.1 → 12.6; sd from 3 reps is itself noisy; no test |
| The judge separates the cells | **NOT RESOLVABLE** | 2.7–3.6 band on 0–5; no significance test run |
| The Unsloth-only preset is worse | **NOT SIGNIFICANT** | Within-model: meanΔ −14.5, t=−1.84 < 2.776 — large and unresolved |

> **⚠ Updated 2026-07-16 after within-model re-baselining (`aggregate.py --baseline`).** The **default** digest (vs Q4_K_M) marks exactly two comparisons SIGNIFICANT — both sampling cells — but one of those, *"temp 0.3 vs Q4_K_M"*, is a **cross-model artifact** and does **not** survive within-model (see the two withdrawn/corrected rows above). The comparisons that are **genuinely** significant after correction: the whole **general-mode preset** (−15.4, t=−3.41, within-model) and the **35B budget** 4096→16384 (−4.3, t=−5.45). Everything else is *not* significant — a large-but-unresolved Δ (Unsloth preset −14.5; Q4_K_XL −8.5) means **unresolved**, not "no effect".

---

