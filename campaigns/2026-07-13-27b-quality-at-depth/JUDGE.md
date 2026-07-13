# JUDGE.md — the blind LLM judge (rubric + how to run it)

**Why a separate doc.** The eval grades *functional* correctness deterministically (real
`tsc`+`eslint`+`vitest` in `score_typescript.py`). A judge only adds the **subjective** engineering
quality a toolchain can't see. A judge must be **stronger than the model under test** — and here the
27B *is* the strongest **local** model, so nothing on the box can judge it. **The judge is Claude**
(via the `claude` CLI) or any stronger hosted model. This file is the human-readable source of the
prompt; `judge.py` carries the same rubric for the automated path — **keep the two in sync.**

The judge is **blind**: it is never told which config/model produced the code.

---

## The rubric (exact prompt the judge receives)

> You are a strict senior TypeScript reviewer. A candidate solved the task below; its functional
> correctness, types, lint and tests are ALREADY machine-graded — do NOT re-score those. Judge only the
> SUBJECTIVE engineering quality on three axes, each 0-5 (5 = excellent, 0 = poor):
> - **design** — right abstraction, single-responsibility, no over/under-engineering
> - **clarity** — readable, well-named, easy to follow; comments only where they earn their place
> - **robustness** — anticipates edge cases and failure modes beyond the literal spec
>
> Reply with ONLY a JSON object: `{"design":N,"clarity":N,"robustness":N,"notes":"<=1 sentence"}`.
>
> `[TASK SPEC]` … (the task's `spec.md`) … `[CANDIDATE SOLUTION]` … (the model's code, thinking stripped) …

Output rows (`out/judge_scores.jsonl`): `{config, task_id, rep, tier, design, clarity, robustness, notes}`.
The full prompt + raw reply is also saved to `out/judge_raw.jsonl` — so every judgement is auditable.
`make_charts.py` averages whatever numeric axes it finds (the judge chart + per-task heatmap), so you
can change `AXES`/`RUBRIC` (here and in `judge.py`) without touching the charts.

---

## Three ways to run it

### 1. Automatic — Claude via tmux, **one session fanning out subagents** (default; fully hands-off)
Headless/background `claude` is restricted here, so claude runs as an **interactive** session driven
**through tmux** — as a human would (no `claude -p`). But judging one reply is a small self-contained
review, so we do **not** boot claude per reply. **One** claude session fans out **one cheap blind
`haiku` subagent per batch of candidates, in parallel**. Start the tmux session **once**, then the runner
does the rest:

```bash
tmux new-session -d -s claude-run                      # ONCE (name overridable: CLAUDE_TMUX_SESSION)
bash run_capture.sh                                    # judges (and writes analysis.md) automatically
# or judge an existing run without re-capturing:
python3 judge.py --engine claude-tmux --model opus --subagent-model haiku \
  --outputs out/outputs.jsonl --tasks tasks.jsonl \
  --out out/judge_scores.jsonl --raw out/judge_raw.jsonl
```
Mechanism: **Python does the deterministic prep** — for each not-yet-judged reply it strips `<think>`,
extracts the code to `out/.judge-io/candidates/<id>.txt`, and splits the work into batch manifests
(`out/.judge-io/batches/*.jsonl`) plus a single `rubric.txt`. Then `claude_ask.sh` opens **one**
interactive `claude` in a tmux window and **types a one-line request** pointing it at an orchestration
prompt (the heavy content lives in files, so only a short line is ever typed → reliable keystrokes). That
claude session is a pure **orchestrator**: it launches one `--subagent-model` (`haiku`) subagent per batch
via the Task tool, each of which reads the rubric + a candidate's spec + code and writes
`out/.judge-io/results/<id>.json`. **Python then re-collects and parses** those verdict files
(`parse_scores`, robust to fenced/extra text) into `out/judge_scores.jsonl` — so the fragile bit stays
deterministic. It runs `--cwd` inside the (trusted) repo (no folder-trust dialog; `acceptEdits` covers the
in-workspace writes); each subagent sees only spec + code, never which model/config produced it, so the
judge stays **blind**. If the tmux session is missing it **errors with the start command** — never a
silent headless fallback. Resumable at both levels: replies already in `out/judge_scores.jsonl` are
skipped in prep, and a subagent skips any candidate whose verdict file already exists.

### 2. Automatic — any stronger hosted model (OpenAI-compatible)
```bash
JUDGE_BASE_URL=https://api.example/v1 JUDGE_MODEL=<name> JUDGE_API_KEY=<key> bash run_capture.sh
```

### 3. Manual — a Claude session (no CLI needed)
Open a Claude conversation and paste, per reply you want judged (strip `<think>…</think>` first):
the rubric above + the task's `spec.md` + the candidate code. Record the returned JSON as a line in
`out/judge_scores.jsonl` with `config`/`task_id`/`rep` added. This is exactly how Campaign 2's judge
was done. Fine for spot-checks; use mode 1 for the whole run.

---

*After judging, re-run the charts (the runner does this automatically):*
`python3 ../2026-07-12-27b-finetune-quality/make_charts.py --dir out --charts charts --order <labels> --calibration calibration.jsonl,calibration-hard.jsonl`
→ the judge score appears as its own chart, in the per-task heatmap, and as a panel in the budget sweep.
