## 7. Recommendations

### 7.1 Which arm for which job

| Situation | Choose | Why |
|---|---|---|
| Work that must merge — locked contracts, named locators, multi-clause statements | **BASE** (production `/speckit.implement`) | Sole arm reading statements to the end (8/9), sole arm shipping tests, sole arm creating downstream locators |
| Cost-controlled bulk on well-specified, single-clause tasks | **SIM**-shaped setup (Sonnet on the runner payload) | Cleanest rule execution, zero scope creep, no fails, wall comparable to BASE without the gate overhead |
| Default **local** model for mixed phase work | `Brian6145/27B-…-Q4_K_M` | Best coverage and rule compliance (7 · 2 · 0), cheapest generated tokens, three clean 9/9 samples. Accept that it ignores locked contracts and ships no tests |
| A **local** task with a locked contract or plan-specified prop shape | `unsloth/35B-A3B-UD-Q4_K_M` | Only model matching the six-prop contract verbatim and respecting renderer purity |
| Anything test-bearing (`mode: tdd`, first-test creation) | `unsloth/35B-A3B-UD-Q4_K_M` | Sole local model with real test discipline — semantic matchers, snapshot, locked cases |
| Accessibility- or ARIA-sensitive UI | `Brian6145/27B-…-Q4_K_M` or `UD-Q4` — **not** `A3B-Coder-Q5` | A3B-Coder shipped an Alert with no `role="alert"` and a dead `data-testid` on a Radix Root |
| Throughput-bound bulk on trivial tasks | any local model | T002, T004, T021 came out effectively identical; use the fastest (`UD-Q4`, 151 t/s decode) |
| Contract-, a11y- or generation-sensitive UI | **not** `unsloth/27B-Q4_K_M` | One patch does not type-check, one abandons the contract for hardcoded enums, one uses the wrong shadcn generation |
| Not recommended as a general default | `mradermacher/27B-A3B-Coder-Q5_K_M` | Two outright failures and four rule breaches, despite the best T010 block-to-block consistency |
| Anything touching an **existing translated file** | **not** `ThinkingCap-27B-Q6_K_L` | Overwrote four working `hu.ts` values with English in 4 of 5 samples; no gate catches it |
| Throughput- or attempt-bound bulk where output is **separately reviewed** | `ThinkingCap-27B-Q6_K_L` at `q8_0` | 1.0–1.22 attempts/task, 1456 s wall, ~16–17 k generated tokens — the best cost/attempt profile measured. Only with a human or judge reading the diff |

**ThinkingCap does not change the recommendation, and that is the finding.** It arrived with the best numbers any local arm has posted — fewest attempts, lowest wall, lowest input cost — and still lands at 3 · 4 · 2, tied with the bottom tier. Every metric the harness can measure without an LLM said "adopt this"; the only signal that said otherwise was a judge reading the diff. Selecting a local model on gate-pass rate, attempts or wall would have picked the one model in the campaign that silently deletes working translations.

**The practical reading.** `Brian6145/27B-Q4` and `UD-Q4` are **complementary, not ranked**: the first is better at *doing what the statement says*, the second at *obeying what the plan and the rules lock down*. Routing by task shape — statement-driven tasks to the first, contract-driven and test-bearing tasks to the second — would beat either used alone, and that is a `roleProfiles` change in `runner.config.json`, not a model change. Above them, BASE's edge is likewise structural: the workflow forces tests and locators, which is exactly what every other arm omits.

### 7.2 Which measurements to run next

1. **Pin `RUNNER_SEED` and re-run the arm A / arm B T010 comparison as a paired test.** Highest value per GPU-hour of anything left; converts a question needing ~61 iterations/arm into one needing a handful.
2. **Build a deep-retry fixture** — a task that reliably reaches attempt ≥3 — and run both arms on it. The only way to settle whether deleting the 0.6 → 0.8 temperature rung costs escape diversity.
3. **Second T010 block for `unsloth/35B-A3B-UD-Q4_K_M` and `unsloth/27B-Q4_K_M`.** Both currently rank on a single block; the Q4's 2.3 % CV is the campaign's most load-bearing unreplicated number.
4. **Apply the Coder card's verbosity levers** (repetition penalty, top-8 routing override) and re-measure phase-1.
5. **Re-measure phase-1 after task statements are regenerated under `6bb7869f`.** Today's numbers are the "before" side of that comparison.
6. ~~Judge `unsloth/35B-A3B-UD-Q5_K_M`'s output~~ — **done** (judge pass 3, §4.2 / §6): Q5 loses 3 · 6 to Q4's 6 · 3; the 4 GB is not earned on these task shapes.
7. **Re-run Q5 and Q4 3× on T001, T022 and T031 only.** Those three shapes produced every difference between them; T004 and T021 came out byte-identical, so quantisation is invisible on low-degree-of-freedom tasks. A 3× paired run on the discriminating three costs a fraction of a full phase-1 pass and converts pass 3's n=1 into a rate.
8. **Reproduce a T031 failure with capture enabled** (§8.6) — the surviving evidence narrows the mechanism to two candidates but cannot separate them, because the artifacts lived in worktrees that were deleted.

### 7.3 Which tasks to fix, and how to improve task generation

1. **T031's 0-byte termination — partially executed, see §8.6.** The "wrote nothing" reading is now verified against runner source rather than inferred from a post-run diff. What remains open is *why*: either every edit's anchor missed (a documented silent no-op) or no write tool was ever called. Separating those needs one reproduction with capture enabled.
2. **Deliver the locked contract to the model.** `planContext` matches only Module Placement Map rows by file path, so a contract authored as a `### Surface:` block never reaches the payload (§4.6) — verified on T022, with no placement row at all on T001, T030, T031 either. Until this is fixed, "contract fidelity" is not something any runner arm can be measured on. Fix in the nav builder, not in the statements.
3. **Every i18n statement must name its exact key names.** Not because a deliverable was omitted, but because the statements name no key identifiers at all — and six arms across two experiments produced mutually incompatible sets. This is what `6bb7869f` requires and what `i18n-keys.md` already demands of the model; the task side never satisfies it.
4. **Fix T022's contract.** Add `typeFieldLabel`/`sourceFieldLabel` + `className` to the locked prop list, give the signature an importable return type instead of the bare `React.ReactElement`, and change locked test case 2 to assert the trigger's *text* rather than its accessible name. Then split the renderer creation from its test — its successful patches range 1 880–12 323 bytes, a 6.5× disagreement about what "create the renderer" means. (Fixing the contract only helps once item 2 delivers it.)
5. **Add a per-task cost guard to task generation.** One task consuming 64 % of a phase's input tokens and 81 % of its generated tokens is detectable before the phase ends; a mid-phase abort above, say, 3× the phase median would have saved 1600 s in one run alone.
6. **Treat "wrote nothing" and "attempts ≥5" as task-generation feedback signals**, not just run outcomes. Both occurred exclusively on the two tasks that also under-deliver against their statements.
7. **Decide the phase-boundary policy for the commit gates.** A phase that creates a component consumed in the next phase currently cannot commit (§4.5); either baseline the orphan window or group creator and consumer into one phase.

### 7.4 Using the runner

- **Never rank models or harness versions on a single block or a single phase-1 sample.** Measured between-block shift reaches 78 % in wall and 2 tasks of green; between-sample generated tokens moved 4.6×.
- **Do not compare input-token counts across runs** — they measure round count, not work. Generated tokens are the meaningful cost signal.
- **Read `unverified` as success in `impl` mode**; only `failed` / `local-exhausted` / `discarded` are failures.
- **Preserve the `llama-server` log with the run.** Prefill/decode/draft-acceptance are only recoverable from it, and one model in this campaign lost its serving metrics to worktree cleanup.

---

