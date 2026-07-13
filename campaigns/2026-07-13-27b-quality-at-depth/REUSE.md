# REUSE.md — run this benchmark against another model / add a knob axis

The eval (`ts-harness/`), grader (`score_typescript.py`), context builder (`build_context.py`) and
charts (`make_charts.py`) are **model-agnostic**. Only *what to run* lives in `configs.jsonl`. Four
recipes, cheapest first.

---

## 1. Add another **local GGUF** model — one line

Append a row to `configs.jsonl` (any text editor). Fields:

| field | meaning |
|-------|---------|
| `label` | unique cell name; also the chart/series key. Convention: `<model>-d<depth>-<kv>-rb<budget>`. |
| `model` | filename inside `$MODELS_DIR` (default `/home/dev/models/gguf`). |
| `mtp` | `1` if the GGUF carries a Multi-Token-Prediction draft (unsloth build), else `0`. |
| `kv` | `f16` or `q8_0`. |
| `depth` / `tokens` | depth label (`64k`/`128k`) and the target context tokens (`64000`/`128000`). |
| `ctx` | server context window; must exceed `tokens` + `budget` + a margin (we use 98304 / 163840). |
| `budget` | `--reasoning-budget` (thinking-token cap). |
| `temp`,`top_p`,`top_k`,`min_p` | sampling (keep the Qwen3.6-thinking defaults unless comparing sampling). |
| `role` | free label (`primary`/`crosscheck`/…); only for your own bookkeeping. |
| `optin` | `true` → skipped unless `RUN_OPTIN=1`. Omit for normal cells. |

```jsonc
{"label":"mymodel-d64-f16-rb2048","model":"MyModel-Q4_K_M.gguf","mtp":0,"kv":"f16",
 "depth":"64k","tokens":64000,"ctx":98304,"budget":2048,
 "temp":0.6,"top_p":0.95,"top_k":20,"min_p":0,"role":"primary"}
```

Then `ONLY='mymodel-*' bash run_capture.sh`. Done — it serves, captures, grades, and charts the new
cells alongside the rest.

> **Pre-flight VRAM:** a big model at 128k-f16 may not fit 32 GB. Check first with
> `python3 ../../bench/gguf_kv.py $MODELS_DIR/MyModel-Q4_K_M.gguf --weights-gib <G>` (KiB/tok + max ctx).
> If f16 won't fit, use `kv:"q8_0"` or a smaller `ctx`.

---

## 2. Benchmark a model behind an **OpenAI-compatible endpoint** (vLLM / hosted API / remote box)

`capture.py` talks plain HTTP to `/v1/chat/completions`, so it works against any OpenAI-compatible
server — you just skip the local `serve_llamacpp.sh` step. Point it at the URL directly:

```bash
# 1. build the task prompts at the depth you want (once):
python3 - "$PWD" 64000 out/tasks-64k.jsonl <<'PY'
import sys, json, os; here,toks,out=sys.argv[1],int(sys.argv[2]),sys.argv[3]
sys.path.insert(0,here); import build_context
for t in [json.loads(l) for l in open(f"{here}/tasks.jsonl") if l.strip()]:
    p=build_context.build(f"{here}/ts-harness/tasks/{t['id']}", toks)
    open(out,"a").write(json.dumps({"id":t["id"],"type":"ts-tdd","category":t["tier"],"prompt":p})+"\n")
PY

# 2. capture against the remote model (set OPENAI_BASE_URL / model name to taste):
python3 ../2026-07-12-27b-finetune-quality/capture.py --config mymodel-remote \
  --tasks out/tasks-64k.jsonl --out out/outputs.jsonl \
  --base-url https://my-endpoint/v1 --reps 3 --max-tokens 10240 \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0

# 3. grade + chart (same as the local path):
python3 score_typescript.py batch --outputs out/outputs.jsonl --tasks tasks.jsonl --out out/scores_typescript.jsonl
python3 ../2026-07-12-27b-finetune-quality/make_charts.py --dir out --charts charts \
  --order mymodel-remote --calibration calibration.jsonl,calibration-hard.jsonl
```

> **Caveat:** `--reasoning-budget` is a **llama.cpp** server flag — it has no effect over a generic
> OpenAI endpoint. For other engines, set the equivalent thinking cap in the server config, or drop the
> budget axis and treat the endpoint as a single capability point. Everything else (depth, grading,
> capability bands) is engine-independent.

---

## 3. Add a **new knob axis** (e.g. a sampling sweep)

The driver already passes `temp/top_p/top_k/min_p` **per config**, so a sampling sweep is just more
`configs.jsonl` lines at different values (same model/depth/budget). To chart the axis as a trend, add
a sweep spec to `out/sweeps.json` (a JSON array): one `series` per line, `points` referencing the cell
labels, `metrics` from `{ts_score, ts_hardpass, total_tokens, ttfa_s, decode_tps, …}`. `make_charts.py`
draws a small-multiple line chart per metric, with the haiku/Sonnet/Opus reference bands on the quality
panels. (See the budget-sweep example the runner emits.)

---

## 4. Copy the whole campaign for a **different eval or system-under-test**

Fork this directory. Keep `ts-harness/`, `score_typescript.py`, `build_context.py`, `make_charts.py`,
`run_capture.sh` as-is. Change: `configs.jsonl` (your models/knobs), `tasks.jsonl` +
`ts-harness/tasks/*` (your tasks — follow the admission rule: a task is only kept if a weak model
hard-fails it and a stronger one scores higher; recalibrate with `calibration*.jsonl`), and the corpus
in `ts-harness/corpus/` if you want different deep context. Re-run `score_typescript.py selftest` to
confirm the grader still discriminates before spending GPU time.

## 5. Swap the LLM judge

The blind judge (`judge.py`) has two transports — pick per your environment:
- **`--engine claude-tmux`** (`JUDGE_ENGINE=claude-tmux`, the default) — **one** interactive `claude`
  session driven **through tmux** by typed keystrokes (`claude_ask.sh`, no headless `-p`) that **fans out
  one blind `haiku` subagent per batch** (`JUDGE_SUBAGENT_MODEL`, default haiku; `JUDGE_MODEL` is the
  orchestrator). Use when the model under test is the strongest thing you have locally (a 27B can't judge
  itself). Needs the `claude` CLI authenticated **and** a tmux session (headless/background is
  restricted); the runner errors with the start command if it's missing.
- **`--engine http`** (`JUDGE_BASE_URL=<…/v1> JUDGE_MODEL=<name> JUDGE_API_KEY=<env>`) — any stronger
  OpenAI-compatible endpoint.

Either way a judge must be **stronger** than the candidate. Both save parsed scores
(`judge_scores.jsonl`) **and** the full prompt + raw reply (`judge_raw.jsonl`), so judgements are
auditable and re-scoreable. To change what's judged, edit `AXES` + `RUBRIC` at the top of `judge.py`
(and mirror it in `JUDGE.md`); `make_charts.py` averages whatever numeric axes it finds — no chart change
needed. Full rubric + a manual (no-CLI) run mode: **`JUDGE.md`**.

---

**Golden rule (repo policy):** extend the shared tools, don't fork them. `capture.py`,
`score_typescript.py`, `make_charts.py` and `build_context.py` are the deterministic layer — if one is
missing a capability, add it there (and say so) rather than writing a one-off. Corpus must stay
secret-free (auth/crypto/token/config/idb files and anything matching a secret pattern are excluded).
