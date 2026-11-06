# Qwen3.6-27B quality tuning — sampling × thinking-budget × MTP-draft on HARD agentic tasks (R9700)

*This README is the campaign's runbook. Results write-up lands in `analysis.md` (co-located,
registered in `docs/INDEX.md`) after Phase C.*

- **Date:** 2026-07-13 · **Status:** scaffolded, ready to run · **Campaign 2 of 3**
  (plan: `docs/plans/2026-07-12-27b-agentic-config-campaign-series.md`)
- **Owner split:** Phase A (GPU capture + deterministic scoring) = one `run_capture.sh` invocation
  by the user; Phase B (LLM-judge of the 3 rubric tasks, blind) + Phase C (aggregate + write-up) =
  Claude. Same contract as `campaigns/2026-07-12-27b-finetune-quality/`.

## Why this is a custom driver (not `gen_campaign.py`)
`benchmark-new-campaign`/`gen_campaign.py` emit **engine-bench throughput** probes (`openai_probe`:
prefill/decode tok/s). This is a **quality** campaign — it needs per-task replies graded for
correctness (deterministic verifiers + an LLM judge), which is the **finetune-quality** machinery
(`capture.py` + `graders/` + judge), not a throughput matrix. So we **reuse** that campaign's
`capture.py` and `graders/score_deterministic.py` verbatim (by path) and drive them with a
config-sweep `run_capture.sh`. Applied the skill's discipline anyway: VRAM checked (below), iron
rules honored (chat API, f16 default + one q8 confirm, MTP-on single-stream, one variable per
phase), gap-analysis done.

## 0. Inputs from Campaign 1 (frozen substrate)
Vulkan b9950 · **KV f16** · **MTP-on** (unsloth) · `-ub 2048 -b 4096 -fa on`. Prefix-cache reuse is
automatic (built-in). **This campaign changes only quality knobs on that fixed substrate.**
The big correction it acts on: **the finetune-quality run used temp 1.0**, but Qwen3.6 thinking mode
officially wants **temp 0.6** (`docs/research/2026-07-12-2310-qwen36-sampling-llamacpp-serving-knobs.md`)
— B0 re-baselines this first.

## 1. VRAM (skill step 2 — non-binding, documented)
Both models ~15.4/15.9 GiB weights, 64 KiB/tok f16 (hybrid, from `bench/gguf_kv.py`). At **CTX 32768
f16 → ~20.4 GiB predicted** (q8_0 ~19.4), ~12 GiB under the 32400 budget. No guard needed at this
depth; the driver samples actual VRAM/GTT/power per server into `out/gpu_<name>.csv` → `out/vram.jsonl`.

## 2. The matrix — `configs.jsonl` (13 server configs · 17 sampling points)
Each **server config** = model × mtp × kv × `extra_args` (reasoning-budget / spec-draft flags) → one
server load. Sampling-only points (temp/top_p/top_k) reuse the same server (no reload) via `capture.py`.

| phase | question (one variable) | configs |
|-------|-------------------------|---------|
| **B0** | temp **0.6 vs 1.0** re-baseline (the challenge) | `jr-t06/jr-t10`, `un-t06/un-t10` |
| **B2** | sampling: temp 0.7 / top_p 0.8 variant | `jr-t07`, `un-t07` |
| **B3** | `--reasoning-budget {2048,1024,512,0}` (−1 = the B0 rows) at temp 0.6 | `jr-rb2048/1024/512/0`, `un-rb2048/1024/512` |
| **B4** | MTP draft: `--spec-draft-p-min {0.5,0.75}`, `--spec-draft-n-max 5` (default 0/3 = `un-t06`) | `un-pmin05`, `un-pmin075`, `un-nmax5` |
| **B5** | KV **q8_0** quality spot-check at temp 0.6 (one confirmatory point) | `jr-q8` |

Runtime estimate: 14 tasks × 17 samplings × reps 1 ≈ **~2–3 h** (thinking burns 1000s of tokens;
temp-1.0 rows may runaway to the 8192 cap and run longer). `REPS=3` (recommended near grade
boundaries at temp>0) ≈ 3× that. `ONLY=` subsets by config/server name.

## 3. Tasks — `tasks/tasks.jsonl` (14 HARD tasks; the discriminator)
Deliberately **harder** than finetune-quality (which saturated) so a thinking-budget/sampling change
is *detectable*. **11 deterministic** (auto-graded, verified) + **3 judge** (rubric). Borrowed from
IFEval/AgentIF (verifiable multi-constraint + tool-call schema + agentic rules).

| id | cat | grader | what it tests |
|----|-----|--------|---------------|
| math-modular ★ | det | final_match | 7^2026 mod 100 = 49 (modular reasoning) |
| math-inclusion ★ | det | final_match | inclusion-exclusion, all pairwise lcm=30 trap = 734 |
| math-pipes | det | final_match | rates 1/12+1/18−1/36 = 9 |
| math-increasing | det | final_match | C(9,4) strictly-increasing digits = 126 |
| math-gcd | det | final_match | largest divisor of n⁵−n = 30 |
| logic-knave ★ | det | final_match | knights/knaves, A = knight |
| code-intervals ★ | det | pyexec | merge_intervals + edge cases |
| code-toposort | det | pyexec | cycle detection (can_finish) |
| code-fixbug ★ | det | pyexec | fix an infinite-loop binary search |
| instr-multirule ★ | det | constraints | exactly 7 lines, `- ` prefix, sorted, unique |
| json-plan ★ | det | json_schema | valid tool-call plan JSON (goal + ≥3 {tool,args}) |
| review-concurrency | judge | rubric | race + fd-leak + path-injection + no exception safety |
| design-ratelimiter ★ | judge | rubric | token-bucket: lazy refill, per-key lock, memory bound |
| agentic-plan ★ | judge | rubric | obey 4 agent rules (read-before-edit, test-after, stop-on-2-fails, no vendor/) |

★ = thinking-sensitive headline tasks. All deterministic answers + pyexec tests were **verified**
against reference solutions before commit. Rubric anchors are embedded in each judge task's `grader`.

⚠️ **Grader coverage note:** the existing `constraints` grader checks line-count/prefix/sorted/unique
only. To reach AgentIF-style *11-constraint* hardness (forbidden tokens, keyword counts, ordering,
regex), extend `score_deterministic.py` with a richer `multi_constraint` grader — a documented v2
follow-up, not required for this run.

## 4. Run — Phase A (user)
```bash
cd /home/dev/work/dp-craft/amd
bash campaigns/2026-07-13-27b-quality-tuning/run_capture.sh            # all configs, reps 1
# subset:            ONLY='jr-*'          bash .../run_capture.sh
# majority-vote:     REPS=3               bash .../run_capture.sh
# at agentic depth:  CONTEXT_PREFIX=codereview-8000.txt bash .../run_capture.sh
```
The driver serves each config (with its `EXTRA_ARGS`), samples VRAM/power, sends all 14 tasks via
`capture.py` at the config's sampling, is **resumable** (`out/done/<label>` markers) and **continues
past a failed server** (`out/failures.txt`). It finishes by running `score_deterministic.py`.

⚠️ **`CONTEXT_PREFIX` and ctx:** default (no prefix) runs at CTX 32768 — fine. If you prepend a code
context, raise CTX so `prompt + max_tokens(8192) ≤ CTX`: `codereview-8000` → CTX≥16384 default ok;
`codereview-32000` needs `CTX=40960` (`CTX=40960 CONTEXT_PREFIX=codereview-32000.txt …`). Valid
prefixes: any `bench/workloads/generated/*.txt` (missing ones auto-build via the campaign recipe if
you run them through a gen_campaign campaign first, else build with `build_prompt.py`).
⚠️ **capture.py sampling:** supports temp/top_p/top_k/seed only. `min_p`/`presence_penalty`
(Qwen-recommended anti-repetition) need a small `capture.py` extension — noted, out of scope for v1.

## 5. Phase B — LLM judge (Claude)
Score the 3 rubric tasks per config, **blind** (shuffle+anonymize), 0–5 on correctness/depth/clarity
against each task's embedded `grader.anchors`, into `out/judge_scores.jsonl`. Same protocol as
finetune-quality Phase B.

## 6. Phase C — aggregate & write up (Claude → benchmark-results skill)
Per config: deterministic pass%, judge /5, mean think/answer tokens, ttfa, **runaway rate**
(`finish_reason=length ∧ ¬has_answer` — the built-in `truncated_thinking` flag under-counts), VRAM.
Headline questions to answer:
1. **temp 0.6 vs 1.0** — does 0.6 remove the runaways/instability? (challenge #1)
2. **reasoning-budget curve** — quality-per-latency vs budget; does capping preserve quality while
   killing runaways? best budget per model. (challenge #2)
3. **MTP draft** — does `p-min` 0.5/0.75 stop the MTP correctness regression at temp 0.6? decode cost?
4. **KV q8 quality** — any accuracy loss vs f16 (pairs with Campaign 1's perf rejection).
Write `analysis.md` (summary + table first, **memory column mandatory**), `<!-- meta -->` block,
`docs/reindex.py`. Deliverable of the series: the stable `{substrate + sampling + reasoning-budget +
MTP settings}` combo per model.

## File map
```
tasks/tasks.jsonl     14 hard tasks + grader specs (verified)
configs.jsonl         13 server configs × 17 sampling points (the matrix)
run_capture.sh        Phase-A driver (server sweep → capture.py → graders); reuses ../2026-07-12-27b-finetune-quality/{capture.py,graders}
out/                  GENERATED: outputs.jsonl, vram.jsonl, gpu_<name>.csv, scores_deterministic.jsonl, judge_scores.jsonl, done/, failures.txt
analysis.md           Phase-C write-up
```
