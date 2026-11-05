## Methodology and caveats

**What was measured.** 14 cells × 5 tasks × 3 reps = **210 graded replies** (n=15 per cell). Tasks: `rate-limiter`, `lru-cache`, `async-memo`, `expr-eval`, `pricing-deferred`. Held fixed in every cell: llama.cpp Vulkan **b9950**, `-ub 2048 -b 4096 -fa on`, MTP on, ctx **163840**, prefix cache, the prompt, the grader, the judge, REPS 3. Varied: model/quant (axis 1), reasoning budget (axis 2), sampling (axis 3, 35B only), KV type (forced — see confound 4).

**The depth label is nominal — and it is not a confound.** Cells are labelled `120k`; the real prompt is **~132.9k tokens** (522,260 chars ÷ ~3.93 chars/tok on TypeScript). Two causes, both benign: `build_context.py` uses `CHARS_PER_TOK = 4` as an estimate, and it overshoots its char budget because it breaks *after* appending a file. **Deliberately not fixed** — changing the prompt would invalidate all 210 replies. **Every cell runs the identical prompt**, so all internal comparisons are sound; only the label is approximate. The one place it matters is the reference comparison, where the true ~213× depth ratio is the number to use.

**Known confounds and limitations, worst first.**

1. **Underpowering — the top limitation.** 5 tasks, rep sd 9.8 → resolution **≳12 pts**. Only 2 of 13 printed comparisons are significant. **The fix is more tasks, not more reps.**
2. ✅ **FIXED 2026-07-16 — was: "the sampling axis is baselined against the wrong cell."** The digest's default paired tests run against `Q4_K_M` (27B, dense) — so the sampling cells' original verdicts were *cross-model*. `aggregate.py` now takes `--baseline`; re-run within-model, the temp-0.3 "significant" result **evaporated** (−7.5, t=−2.60, ns) and only the whole `qwen-gen` preset survives. **The default digest still uses Q4_K_M** (correct for the quant ladder) — read the sampling axis only from a `--baseline a3b-…` run.
3. **The sampling axis is fully confounded with the model.** All five sampling cells are the MoE. Nothing here establishes temperature behaviour for the dense 27B.
4. **KV is not uniform (by design).** Q5_K_M and Q6_K at rb4096 run **q8_0** KV because f16 caps them below the needed context (`README` §2). **Mitigated and now bounded:** the `q5-d128-f16-rb4096` cell supplies the direct control (74.3 f16 vs 76.5 q8_0) and the effect sits below the noise floor.
5. **The reference ladder is not depth-matched.** 213× shallower, one-shot. Both sides are n=3 and the ladder is now complete across all 5 tasks — but depth is the confound, and more reps cannot fix it.
6. **2 of 5 tier labels are contradicted by measurement**, 1 is a ceiling. See Tier semantics.
7. **The judge was not significance-tested.** Its 2.7–3.6 spread is quoted as printed. The only judge number that clearly stands out is the Unsloth preset's **2.7**, which agrees with its deterministic score and its rep sd.
8. **rep sd is estimated from 3 reps** and is itself noisy. The digest warns that a Δ sd within ±1 pt is not a change; we extend that caution to all rep-sd comparisons, none of which are tested.
9. **Single box, single build.** llama.cpp Vulkan b9950 only. RDNA4 performance swings hard across builds, so every timing number is build-specific.
10. **One reply lost its judge row** (`a3b-d128-f16-rbmax` · `rate-limiter` · rep 1 — the 31,093-token runaway; the judge column shows `—`). Its deterministic score (45) is intact and counted.

**Provenance.** This campaign's `out/` = **MEASURED**. External sources = **CLAIMED**, linked below, each fetched and verified to resolve and to contain the cited claim. Reasoning = **INFERRED**, marked in place. Never blended.

---

