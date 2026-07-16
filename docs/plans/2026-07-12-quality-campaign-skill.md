# Plan: teach `benchmark-new-campaign` to scaffold **quality** campaigns

- **Date:** 2026-07-12 · **Status:** ready to implement · **Owner:** Claude (next session)
- **Why:** `gen_campaign.py` now emits two campaign kinds — `throughput` (servers × probes) and
  **`quality`** (model shootout: configs × task-suite + deterministic scoring + blind LLM-judge).
  The `/benchmark-new-campaign` skill (`.claude/skills/benchmark-new-campaign/SKILL.md`) still only
  knows the throughput model, so there is **no guided path to design a quality campaign** — the
  27B finetune campaign's `spec.json` was hand-authored. This plan closes that loop.
- **Scope:** documentation/judgement only. `gen_campaign.py`, `capture_engine.py`, `report.py`,
  and `bench/lib/graders/` already implement everything; do **not** re-touch them.

## 0. Ground truth already shipped (reference, don't rebuild)

- `bench/gen_campaign.py emit` dispatches on `spec.kind`; `example --quality` prints a valid spec.
- Quality driver (generated `run.sh`): per config → serve one llama-server → `vram_sampler.py` →
  `capture_engine.py tasks` → `graders/score_deterministic.py` → `report.py`. Resumable
  (`out/done/`), continue-on-fail, pre-flight VRAM guard (per-model filesize + `kv_kib_per_tok`).
- Judge: `graders/prepare_judge.py` (blind, shuffled, opaque ids) → in-session Claude prompt →
  `graders/apply_judge_scores.py` (clamp 0–5, coverage warnings).
- Report: `report.py` auto-detects `quality` and emits 8 SVGs + `appendix.md`.
- Reference campaign to mirror: `campaigns/2026-07-12-27b-finetune-quality/{spec.json,plan.md}`.

## 1. Authoritative quality `spec.json` schema (put this in SKILL.md verbatim)

```jsonc
{
  "kind": "quality",                    // REQUIRED — selects the quality driver
  "slug": "27b-finetune-quality",       // REQUIRED — campaign dir = <date>-<slug>
  "date": "2026-07-12",                 // optional (default today)
  "title": "…", "notes": ["…"],         // optional (plan.md H1 + # NOTE lines)

  "backend": "vulkan", "port": 8081,    // one server at a time on this port
  "models_dir": "/home/dev/models/gguf",// base dir for each config's `file`
  "ctx": 32768,                         // fixed context for ALL configs (keeps VRAM comparable)
  "kv": "f16",                          // KV type (selects kv_kib_per_tok[kv] for the guard)
  "tuning": {"ub": 2048, "b": 4096, "fa": "on"},
  "api": "chat",                        // chat = template applied (needed for thinking models)
  "reps": 1,                            // repeats per task (>1 = self-consistency variance)
  "max_tokens": 8192,                   // GENEROUS — thinking models truncate mid-<think> if low
  "tasks": "tasks/tasks.jsonl",         // relative to the campaign dir

  "vram": {                             // OPTIONAL but recommended (enables the guard)
    "kv_kib_per_tok": {"f16": 64, "q8_0": 34},   // per KV type; guard picks [kv]
    "budget_mib": 32400,                // < physical VRAM → VRAM-only, no GTT spill
    "overhead_mib": 2000                // non-KV compute buffers (default 2000)
  },

  "configs": [                          // REQUIRED — one server run each; labels UNIQUE
    {"label": "model-a",         "file": "A-Q4_K_S.gguf", "mtp": 0},
    {"label": "model-b-mtp-off", "file": "B-MTP-Q4_K_M.gguf", "mtp": 0},
    {"label": "model-b-mtp-on",  "file": "B-MTP-Q4_K_M.gguf", "mtp": 1}   // same file, MTP on
  ]
}
```

Key differences from a throughput spec: `configs[]` (not `servers[]`/`probes[]`), a single fixed
`ctx`/`kv` (not a depth matrix), `tasks` (not prompt files), `models_dir`, and the guard uses
`vram.kv_kib_per_tok` **without** `weights_gib` (weights are read per-model from the file at runtime).

## 2. `tasks.jsonl` schema (one JSON object per line)

```jsonc
// deterministic (auto-graded — no model needed):
{"id":"math-primes","category":"deterministic","type":"math","headline":true,
 "prompt":"… end with a line: FINAL: <number>",
 "grader":{"kind":"final_match","answer":"10","normalize":"int"}}
{"id":"code-x","category":"deterministic","type":"code",
 "prompt":"… Output ONLY a ```python code block …",
 "grader":{"kind":"pyexec","tests":"assert f(…)==… \n…"}}
// grader kinds: final_match (normalize int|float|lower|lower_nospace),
//   pyexec (runs candidate + hidden asserts in a subprocess+timeout — RUNS MODEL CODE),
//   json_schema (required_keys/types/item_keys/min_items), constraints (exact_lines/line_prefix/sorted/unique)

// judge (open-ended — blind LLM-judge):
{"id":"explain-x","category":"judge","type":"explain","headline":true,
 "prompt":"…","grader":{"kind":"rubric"}}
```

Design rules the skill must enforce: deterministic tasks MUST demand a strict answer format
(`FINAL: …` or a single fenced ```python block) so grading is model-free; every task records tokens
regardless of grader; mark 2–3 `headline` reasoning tasks for the token-economy comparison.

## 3. SKILL.md edits (the actual work)

1. **Add a "Pick the kind" gate** at the top: throughput (fastest engine/config on a workload) vs
   quality (which fine-tune reasons best / cheapest). Route to the right schema.
2. **Add a "Quality campaign" section** mirroring the existing throughput one:
   - the §1 schema + §2 tasks schema above (verbatim);
   - **judgement to encode** (below);
   - the run/resume commands (`bash campaigns/<d>-<slug>/run.sh`, `ONLY=`/`REPS=`/`MAX_TOKENS=`);
   - the emit command: `python3 bench/gen_campaign.py emit --spec <spec.json>` (writes `run.sh`
     always; `plan.md` only if absent — so hand-write `plan.md` first for a rich runbook, or let
     the template generate);
   - the Phase A/B/C flow, pointing at `bench/lib/graders/prepare_judge.py` + the blind judge prompt
     + `apply_judge_scores.py`.
3. **Update §"benchmark tracks"** cross-refs and the `example` mention to include `--quality`.
4. **Fix the throughput section's stale bits** already partially done elsewhere: it now emits SVG
   charts + `appendix.md` (not `report.html`).

## 4. Judgement the skill must encode for a quality campaign

- **Hold everything but the model constant.** One `ctx`/`kv`/`tuning`/sampling for all configs so the
  memory + token columns are comparable. Pick `ctx` well above task need (prompts <1K, thinking
  budget in the low thousands) — e.g. 32768.
- **VRAM guard:** set `vram.kv_kib_per_tok` for the chosen `kv` (read the model's geometry with
  `bench/gguf_kv.py`; for the hybrid `qwen35` arch it is 64 KiB/tok f16 / 34 q8_0). Budget < 32624.
- **`max_tokens` generous (≥ 8192).** Too low truncates mid-`<think>` → `finish_reason=length`, no
  answer, which invalidates BOTH the grade and the token-economy number. This is the #1 footgun.
- **Sampling:** the model card's recommended values (Qwen3.6: temp 1.0 / top_p 0.95 / top_k 20) with
  a fixed seed. Note temp>0 makes single-rep pass/fail noisy → suggest `REPS=3` near a boundary.
- **Task mix:** ≥ ⅔ deterministic (objective, cheap, reproducible) + a few judge tasks for prose/
  code-review quality. Deterministic-heavy keeps the result precise; the judge adds the soft signal.
- **Judge is blind + in-session:** `prepare_judge.py` anonymizes and shuffles so a config name
  ("uncensored"/"opus") can't bias the grade; `apply_judge_scores.py` clamps + reports coverage.
  Record that the judge grade is `INFERRED` (session-dependent), everything else `MEASURED`.
- **Confounds to call out in the write-up:** quant mismatch across repos (IQ4_XS vs Q4_K_M); same
  architecture ⇒ quality deltas come from fine-tuning data, not capacity.

## 5. Acceptance criteria

- `/benchmark-new-campaign` can take "compare these N GGUF fine-tunes on quality + token usage" and
  produce a valid quality `spec.json` + `tasks.jsonl` skeleton + emitted `run.sh`, with the VRAM
  guard populated and `max_tokens` ≥ 8192.
- The emitted `run.sh` passes `bash -n`; `report.py` renders the quality kind from a dry-run's
  `out/`.
- SKILL.md has no remaining `report.html` / `openai_probe` / `servers[]`-only assumptions in the
  quality path.
- A reader can scaffold a *new* quality campaign end-to-end from the skill without reading
  `gen_campaign.py` source.

## 6. Out of scope
- No engine/harness code changes (already implemented + stress-tested).
- No changes to the existing throughput campaigns or their reports.
- Running the 27B finetune campaign itself (that is the user's Phase A, per its `plan.md`).
