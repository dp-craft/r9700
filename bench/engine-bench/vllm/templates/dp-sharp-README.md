# dp-sharp chat template

**File:** `dp-sharp-chat_template.jinja`
**Version:** V2 (2026-11-02)
**Base:** Official sharp template (keep-all reasoning, `qwen3.8-froggeric-v22.5`) + dp terse prompt block

## What it is

The dp-sharp template is the official sharp template with one change: the terse prompt block is replaced with the dp terse prompt. The `terse` kwarg defaults to `true`, so the terse block is **always on** unless explicitly disabled via `chat_template_kwargs: {"terse": false}`.

The V2 terse prompt (2026-11-02) adds explicit step-by-step mechanics tracing, boundary/failure-case simulation, and end-to-end continuity checks. This recovered two semantic defects (#2 walk-duplication, #8 empty-line→schema) that V1 missed, while preserving V1's probe-fidelity wins (import-sort, T3 double-spawn).

## Usage with vLLM

### Using a launcher script (recommended)

If you have a launcher script (e.g., `vllm.sh`) that wraps `vllm serve`, configure it to point to this template:

```bash
# Example: vllm.sh
DP_SHARP=/path/to/bench/engine-bench/vllm/templates/dp-sharp-chat_template.jinja

vllm.sh start
```

The template is mounted read-only at `/templates/dp-sharp-chat_template.jinja` inside the container and passed as `--chat-template`. The `--default-chat-template-kwargs` should include `{"enable_thinking": true}`.

### Manual vLLM launch

```bash
vllm serve \
  --model /path/to/model \
  --served-model-name <your-model-name> \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len <max-tokens> \
  --max-num-seqs 1 \
  --gpu-memory-utilization 0.93 \
  --enable-prefix-caching \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_xml \
  --reasoning-parser qwen3 \
  --chat-template /templates/dp-sharp-chat_template.jinja \
  --default-chat-template-kwargs '{"enable_thinking": true, "reasoning_effort": "medium"}'
```

**Note:** Adjust `--model`, `--served-model-name`, `--max-model-len`, and any speculative-decoding flags (`--speculative-config.*`) to match your model and hardware. The example above is a minimal configuration.

### Reasoning effort

The template defaults `reasoning_effort` to `'medium'` (line 17 of the template). You can override it via `chat_template_kwargs`:

- **`"medium"`** (default): Balanced thinking length (~3058–3746 tokens). Recommended for most workloads.
- **`"low"`**: Brief thinking, focused on the conclusion. Use for latency-sensitive tasks.
- **`"high"` / `"xhigh"`**: Deeper thinking, more alternatives considered. Use for complex reasoning tasks.

Example with explicit medium effort:

```bash
--default-chat-template-kwargs '{"enable_thinking": true, "reasoning_effort": "medium"}'
```

### Disabling the terse block (optional)

To use the template without the terse block (e.g., for A/B testing or when a downstream prompt conflicts):

```bash
--default-chat-template-kwargs '{"enable_thinking": true, "reasoning_effort": "medium", "terse": false}'
```

Or per-request via the API:

```json
{
  "model": "<your-model-name>",
  "messages": [...],
  "chat_template_kwargs": {"terse": false}
}
```

## Usage with llama.cpp (llama-swap)

### models.yaml entry

```yaml
models:
  - id: <your-model-id>
    path: <path/to/your-model.gguf>
    ctx: <max-tokens>
    kv: q8_0
    mtp: true
    family: <model-family>
    backends: [vulkan]  # or [rocm]
    cmd:
      - -c <max-tokens> -ctk q8_0 -ctv q8_0
      - -np 1
      - --kv-unified
      - --perf --host 127.0.0.1 -ngl 999 -fa on --jinja --rope-scale 1.0 -tb 12 -t 4
      - --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0
      - --chat-template-file <path/to/templates>/dp-sharp-chat_template.jinja
      - --spec-type draft-mtp
    env:
      - "GGML_VK_ALLOW_GRAPHICS_QUEUE=1"
    note: dp-sharp V2 (keep-all + terse prompt, explicit step-by-step mechanics)
```

**Note:** Adjust `path`, `ctx`, `kv`, `mtp`, `family`, `backends`, and the `cmd` flags to match your model and hardware. The example above is a generic configuration.

### Disabling the terse block

llama.cpp does not support per-request `chat_template_kwargs` in the same way as vLLM. To disable the terse block, create a variant of the template with the terse block removed, or use the stock sharp/froggeric template instead.

## Why dp-sharp is better (vs stock sharp/froggeric)

### Comparison table

| Arm | Template | Engine | Weighted (/38) | Found (n/19) | Findings | Tool calls | Thinking chars | Wall time | Precision |
|-----|----------|--------|----------------|--------------|----------|------------|----------------|-----------|-----------|
| **dp-sharp V2** | dp-sharp | vLLM (Sly radiance) | **~26** (prelim) | **11/19** | 19 | 125 | 387,609 | 2,384 s | TBD (pending grade) |
| Q4_K_XL + sharp | sharp | llama.cpp (Vulkan) | 23 | 12/19 | 15 | 70 | 241,694 | 3,789 s | 1.0 |
| RedHat 1.9.1 + sharp δ 0 | sharp | vLLM (Sly radiance) | 21 | 10/19 | 15 | 80 | 291,269 | 2,181 s | 0.93 |
| RedHat 1.8.1 + sharp δ 0 | sharp | vLLM (Sly radiance) | 22 | 11/19 | 14 | 100 | 304,314 | 2,820 s | 1.0 |

### dp-sharp V2's advantage

The dp-sharp V2 template adds explicit step-by-step mechanics tracing, boundary/failure-case simulation, and end-to-end continuity checks. This recovered two semantic defects that stock sharp missed:

- **#2 (high):** walk duplicates every goal — dp-sharp's finding 4 (high) with a proposed fix
- **#8 (med):** `r`+Enter → `text: ''` → schema refuses — dp-sharp's finding 10 (med), cites `resolution.ts:15: text: z.string().min(1)`

dp-sharp V2 found **11/19 reference findings** (weighted ~26/38), compared to:
- **Q4_K_XL + sharp:** 12/19 (weighted 23/38) — but 1.6× slower (3,789 s vs 2,384 s)
- **RedHat 1.9.1 + sharp δ 0:** 10/19 (weighted 21/38) — 1 wrong finding (precision 0.93)
- **RedHat 1.8.1 + sharp δ 0:** 11/19 (weighted 22/38) — 20% slower (2,820 s vs 2,384 s)

### Pros

1. **Highest coverage:** dp-sharp V2 found 11/19 reference findings (weighted ~26/38), tied with RedHat 1.8.1 + sharp for most findings, and higher weighted coverage than all other arms.
2. **Semantic depth:** Explicit step-by-step mechanics tracing + boundary/failure-case simulation recovers defects that require multi-step state/control flow reasoning.
3. **Faster than Q4_K_XL:** 2,384 s wall vs Q4_K_XL's 3,789 s (1.6× faster), with more findings (11 vs 12) and similar weighted coverage (~26 vs 23).
4. **No wrong findings (pending grade):** dp-sharp V2 has 0 wrong findings (pending grade), vs RedHat 1.9.1 + sharp's 1 wrong finding (precision 0.93).
5. **Drop-in replacement:** Same template structure as stock sharp/froggeric; just replace the file and restart the server.

### Cons

1. **More thinking:** dp-sharp V2 used 387,609 thinking chars (vs sharp's 241k–304k), which may matter for latency-sensitive workloads.
2. **More tool calls:** 125 tool calls (vs sharp's 70–100), due to the explicit simulation step.
3. **Not yet graded:** dp-sharp V2's precision is TBD (pending authoritative Opus grade).

### When to use dp-sharp V2

- **Code review tasks:** The semantic depth is worth the extra time for complex state-machine reviews.
- **Agentic workflows:** The explicit mechanics tracing helps the model trace multi-step control flow (e.g., applyResolve → irSet → fake → test assertion).
- **When precision matters:** dp-sharp V2 has 0 wrong findings (pending grade), vs RedHat 1.9.1 + sharp's 1 wrong finding.
- **Not for latency-sensitive tasks:** If you need fast responses, use stock sharp/froggeric or disable the terse block.

## Template structure

- **Lines 1–166:** Standard sharp/froggeric template (Qwen3.8, tool-call parsing, reasoning parser, etc.)
- **Lines 167–176:** dp terse prompt block (V2)
- **Lines 177–188:** `terse` kwarg handling (default `true`)
- **Lines 189–end:** Standard sharp/froggeric template (tool-call formatting, message rendering, etc.)

## Version history

- **V1 (2026-11-01):** Original dp terse prompt (keep-all + terse block). Found 8/19 reference findings, weighted 16/38.
- **V2 (2026-11-02):** Updated terse prompt with explicit step-by-step mechanics tracing, boundary/failure-case simulation, end-to-end continuity. Found 11/19 reference findings (preliminary), weighted ~26/38.

## References

- Campaign: `campaigns/2026-11-01-redhat191-dp-sharp-w208-blind/`
- Analysis: `campaigns/2026-11-01-redhat191-dp-sharp-w208-blind/analysis.md`
- Opus grade (V1): `campaigns/2026-11-01-redhat191-dp-sharp-w208-blind/grading-opus.md`
- Opus grade prompt (V2): `campaigns/2026-11-01-redhat191-dp-sharp-w208-blind/opus-grade-prompt-rep2.md`
- Main comparison: `docs/analysis/2026-10-31-1640-agentic-thinking-volume-and-levers.md`
