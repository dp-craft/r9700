## 5. Key findings

| # | Finding | Evidence |
|---|---|---|
| 1 | **The harness change is outcome-neutral** | Within the model measured on both arms: phase-1 9/9 on arm A, 9/9 twice on arm B; T010 5/5 vs 5/6 true-green, wall means 102 s apart at t = 0.80. No regression, no improvement |
| 2 | **The seed is the only proven new capability** | Two runs with `RUNNER_SEED=12345` on a clean tree produced **byte-identical output** and identical generated-token counts (4006). Unpinned it is inert |
| 3 | **`8d2c3a00` (lint ranking) remains unvalidated** | It needs lint and tsc/test to fail in the same attempt; across 119 runs, lint failed once |
| 4 | **Between-block variance is the dominant noise term** | Larger than within-block σ and larger than any measured difference between models or arms. Single-block rankings are unsafe |
| 5 | **MoE builds are 2.2× faster per token and spend it all on emitting more tokens** | Decode 149–156 t/s vs the dense build's 68.7 t/s; prefill up to 3.5× faster. Yet generated totals on the same 9 tasks run 16 245 → 181 545. Throughput is not the bottleneck; verbosity is |
| 6 | **Reliability does not separate the local models** | All five reached 3/3 on T010 and 9/9 on phase-1 at least once. Zero false greens in 29 verified T010 iterations |
| 7 | **Two tasks own every failure and most of the waste** | T031 (3 failures, always 0-byte) and T022 (2 exhaustions, up to 7 attempts and 147 k tokens). Both task-side, corroborated by the same model both failing and passing them |
| 8 | **Gate-green is not spec-complete** | Passing runs omitted T014's helper text, mis-keyed i18n against each other, and shipped a T022 patch that does not type-check. This is the failure mode `6bb7869f` targets — upstream of the runner |
| 9 | **The false-green defences work** | Zero false greens in 29 verified iterations; every 0-byte run was reported `failed`, not success — the `443d47cb` / `1d4370c7` D12 fix confirmed on live output |
| 10 | **The gap between local models and the frontier is coverage, not quality** | SIM's code is frequently the cleanest of its pass, yet it lost three named deliverables it never attempted; the local models' failures cluster on judgement-heavy naming and contract work, not on mechanical edits |
| 11 | **Every harness-visible metric can point the wrong way at once** | `ThinkingCap-27B-Q6_K_L` posted the campaign's best attempts/task (1.0), lowest wall (1456 s), lowest input cost and joint-lowest generated tokens — and judged 3 · 4 · 2, bottom tier, while silently overwriting four working `hu.ts` translations in 4 of 5 samples. Gate-pass rate, attempt count and wall are **not** proxies for output quality; only reading the diff separated them |
| 12 | **A gate named in LEARNED-RULES is not a gate that exists** | R-023 demands that a missing/renamed i18n key fail the commit gate. `const en: TranslationStructure` is typed, `const hu = {` is not — so a locale can be silently de-translated with all seven gates green. The rule has been written down for longer than this campaign has run |

---

