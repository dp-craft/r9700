# What a model needs to work well in opencode (via llama.cpp) — sourced

opencode is an **agentic** coder: it drives the model in a loop of *think → call a tool (read file,
run bash, edit) → read the result → continue*. So the model must do more than chat.

## The 3 things a model MUST support

1. **Tool / function calling (the hard requirement).** Without reliable tool calls opencode can't
   act. opencode's own docs note only a few local models are "good at **both** generating code and
   tool calling." On llama.cpp this needs:
   - **`--jinja`** — mandatory. `chat.h` only adds OpenAI-style function calling when the server is
     started with `--jinja`. Without it, tool requests 500 or are ignored.
   - A **chat template that supports tools**. llama.cpp has **native** tool-call handlers for:
     Llama 3.1/3.2/3.3, Functionary v3.1/3.2, Hermes 2/3, **Qwen 2.5 (and the Qwen3.x line)**,
     Mistral Nemo, Firefunction v2, Command R7B, DeepSeek R1. If the template isn't recognized, a
     **generic fallback** kicks in (works, but more tokens / less efficient). You can inspect the
     gguf's `chat_template` / `chat_template_tool_use`, and override with `--chat-template-file`.
   - Returned as OpenAI `tool_calls` with `finish_reason: "tool_calls"`.
2. **A correct chat template for the tool loop.** It must accept `system`/`user`/`assistant`/`tool`
   roles in the order opencode sends them. Known Qwen quirk: some Qwen3.x templates 500 when the
   system message isn't strictly first (opencode#1890) — `--jinja` with the model's own template
   handled our Qwen3.6 GGUFs correctly (verified: clean tool_calls, no 500).
3. **Streaming.** opencode consumes SSE streaming (`stream: true`); the endpoint must support it.

## Reasoning / thinking (optional, but our models do it)

llama.cpp `--reasoning-format` decides where `<think>…</think>` goes:

| value | effect |
|---|---|
| `none` | thoughts left inline in `message.content` |
| `auto` (**default**) | auto-detects from the template; populates `reasoning_content` for think-models |
| `deepseek` | thoughts moved to `message.reasoning_content` |
| `deepseek-legacy` | keeps `<think>` tags in content **and** fills `reasoning_content` |

**⚠ MEASURED on this box:** passing **`--reasoning-format deepseek` CORRUPTS the speculative-decode
(MTP) batch → `Invalid input batch` crash at depth.** With the **default (`auto`)** — i.e. just
`--jinja`, no explicit reasoning-format — tool_calls AND `reasoning_content` both work AND MTP is
stable. **So: do not set `--reasoning-format deepseek` when MTP is on.** (llama.cpp's own docs don't
mention this interaction; it's our measurement.)

## Also matters

- **Context length** — the tool loop accumulates file/tool output fast, so give it room; declare it
  to opencode via `limit.context` / `limit.output` so it tracks remaining context.
- **Prompt/prefix caching** — each agent step re-sends a growing prefix; llama.cpp's prefix cache
  makes step N+1 cheap. (On by default.)
- **Sampling** — use the model's coding recipe (Qwen: temp 0.6 / top_p 0.95 / top_k 20 / min_p 0),
  **no penalties** (presence/frequency>0 is a ~2 ms/tok host tax and hurts tool-following).

## The recommended llama.cpp "format" config for opencode (what we run)

```
--jinja                       # REQUIRED for tool calling
# (no --reasoning-format)     # default 'auto' → reasoning_content works, MTP stays alive
-fa on -ngl 99 -ub 2048 -b 4096 -np 1
-ctk … -ctv …                 # KV type per model
--temp 0.6 --top-p 0.95 --top-k 20 --min-p 0   # Qwen coding recipe, no penalties
--spec-type draft-mtp         # MTP where the gguf has an nextn tensor (big decode win on MoE)
```

## opencode side (provider config)

- `@ai-sdk/openai-compatible` provider → `baseURL` of the OpenAI-compatible server, dummy `apiKey`.
- Per model: `limit.context` / `limit.output`; `options` for provider-specific reasoning knobs
  (e.g. `reasoningEffort`, or Anthropic's `thinking.budgetTokens`) — not needed for llama.cpp.
- opencode infers tool-call/streaming support from the AI SDK; it does not need explicit capability
  flags for a custom openai-compatible provider.

## Sources
- opencode docs — Providers & Models: https://opencode.ai/docs/providers/ , https://opencode.ai/docs/models/
- llama.cpp server README (flags: `--jinja`, `--reasoning-format`, `--chat-template-file`):
  https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- llama.cpp function-calling guide (native handlers, `--jinja`, generic fallback):
  https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md
- opencode#1890 (Qwen template + tool-call 500 without --jinja):
  https://github.com/anomalyco/opencode/issues/1890
- MTP × `--reasoning-format deepseek` crash: MEASURED here 2026-07-20 (this repo's llama-swap setup).
