# workloads — realistic prompt fixtures (large context, thinking, agentic)

The stimulus shared by both tracks. These model the *real* jobs this box is for — **large
development tasks, research, and parallel agent streams** — so the numbers reflect actual
performance, not synthetic tokens.

## Build the standard fixture set

```bash
mkdir -p generated
# context-depth series (single-stream prefill/decode curve):
for T in 8000 32000 64000 100000; do
  python3 build_prompt.py --task tasks/codereview-large.task.md \
      --src corpus/ts-agentic-code-runner --src corpus/py-rich \
      --target-tokens $T --out generated/codereview-${T}.txt
done
# thinking-mode prompt (tiny context, long reasoning):
python3 build_prompt.py --task tasks/thinking-hard.prompt.txt --target-tokens 0 \
    --out generated/thinking-hard.txt
# agentic per-stream variants (4 files differing only in run-id → cold cache per stream):
python3 build_prompt.py --task tasks/agentic-implement.task.md \
    --src corpus/ts-agentic-code-runner --target-tokens 8000 --variants 4 \
    --out generated/agentic-8000.txt
```

`build_prompt.py` assembles `[unique run-id] + [task instruction] + [real context from corpus/]`.
It **fails hard** if the corpus can't fill ≥97% of the target (no more silently short prompts).
`generated/` is gitignored; `tasks/` and `corpus/` are tracked (reproducible).

## Token calibration (MEASURED 2026-07-11)

Nominal sizes are estimated at **3.6 chars/token** — calibrated against the Qwen3.6 tokenizer via
llama-server `/tokenize` on this corpus (source code ≈ 3.55 chars/token; the old chars/4 rule
overshot real counts by ~12%). Real counts of the standard set: `codereview-8000` → **8110**,
`codereview-64000` → **62347**, `codereview-100000` → **97921**, `agentic-8000` → **8089** tokens.
When sizing server context (`-c`, and per-slot ctx = `-c`/`-np`), budget
`real prompt tokens + max_tokens + margin`, and trust the probe's recorded `prompt_tokens`
(server-reported) over the nominal name.

## The workloads

| Task file | Profile | Context | Output | Stresses |
|-----------|---------|---------|--------|----------|
| `codereview-large.task.md` | review a big codebase slice | 8–100K | medium | prefill@depth, TTFT |
| `agentic-implement.task.md` | implement a feature (per-stream variants) | 8K × N streams | medium | parallel decode, slot contention |
| `research-synth.task.md` | synthesize many docs w/ citations | 64K+ | long | prefill + decode together |
| `thinking-hard.prompt.txt` | hard reasoning, long think block | tiny | long | `ttfa_s` (use `--api chat`!) |

> **`--api chat` for instruction prompts.** Raw `/v1/completions` applies no chat template — an
> instruct/thinking model can emit EOS after 1 token (measured on Qwen3.6-35B). The probe's chat
> mode applies the template and measures `ttfa_s` directly from `delta.reasoning_content`.
> Continuation-shaped prompts (codereview/agentic with padded context) are fine on `completions`.
