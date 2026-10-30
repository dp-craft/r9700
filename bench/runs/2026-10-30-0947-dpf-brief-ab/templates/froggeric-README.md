---
license: apache-2.0
tags:
  - jinja
  - chat-template
  - qwen
  - qwen3.5
  - qwen3.6
  - qwen3.8
  - lm-studio
  - mlx
  - llama.cpp
  - vllm
  - tool-calling
  - thinking
---

# Fixed jinja chat templates for Qwen 3.5, 3.6 & 3.8 (v22.5)

This is a universal drop-in Jinja template that fixes rendering errors, KV cache invalidation, token waste, empty think poisoning, and fatal agentic stalling across official Qwen chat templates.

It works across LM Studio, llama.cpp, vLLM, SGLang, MLX, oMLX, KoboldCPP, and any engine that supports Hugging Face Jinja templates. You only need the single `chat_template.jinja` file at the root of this repository for all Qwen 3.5, 3.6, 3.8, and 3.8 Flash-Next model sizes.

---

## What is New with Qwen 3.8 (v22 / v22.1 / v22.2 / v22.3 / v22.4)

Qwen 3.8 introduces prompt-steered reasoning depth and new model architectures (`Qwen3.8-2.4T-A95B`, `Qwen3.8-27B`). While the official template added reasoning effort steering, it also introduced several lockdowns, regressions, and syntax crashes.

The v22 generation delivers full Qwen 3.8 support with all official bugs resolved:

| Feature / Fix | Official Qwen 3.8 Template | This Template (v22.5) |
|---|---|---|
| **Default Reasoning Baseline** | Hardcodes `xhigh` by default, often exhausting the token budget on reasoning before generating answers. | Defaults to `medium` (zero injected tokens), preserving KV cache parity with v21 and preventing empty-content timeouts. |
| **Non-Reasoning Fast Mode** | The `Qwen3.8-2.4T-A95B` template throws a fatal exception if `enable_thinking=false` (the `Qwen3.8-27B` template accepts it). | Full non-reasoning mode restored via kwargs (`enable_thinking=false`, `reasoning_effort="none"`) or inline `<\|think_off\|>`. |
| **History Reasoning Extraction** | Drops in-content thinking extraction, prepending blank `<think></think>` blocks to real thoughts in chat history. | Extracts reasoning across OpenAI (`reasoning_content`), Anthropic (`thinking`), and in-content tags (`<think>`) without tag duplication. |
| **Tool Argument Wire Format** | Crashes on serialized JSON strings from standard OpenAI API clients. | Canonical XML default with universal argument handling: safely renders stringified JSON arguments in history without syntax crashes or KV cache invalidation. |
| **Client Reasoning Aliases** | Rejects non-standard effort names. | Maps OpenAI, Claude Code, Cursor, and Cline aliases automatically: `high`, `max`, `ultracode`, `extreme` $\to$ `xhigh`; `minimal` $\to$ `low`; `none`, `off` $\to$ disabled. |
| **Inline Chat Tags** | Not supported. | Inline steering via chat text: `<\|think_low\|>`, `<\|think_medium\|>`, `<\|think_xhigh\|>`, `<\|think_ultracode\|>`, `<\|think_off\|>`. Tags are stripped before inference and stay in effect for later turns until another tag replaces them. |
| **Leading System Prompts** | Treats multiple leading system messages as separate turns. | Merges consecutive leading `system` and `developer` messages into a single system turn joined by double newlines. |
| **Tool Error Recovery** | Not supported or triggers false warnings on search results containing words like "error". | Two-tier error recovery with smart code/grep disambiguation to avoid false warnings on search results like `throw new Error(...)`. Structural signals escalate on payloads of any size. |
| **llama.cpp Flag Support** | Requires manual template kwargs. | Native alias support for `--reasoning-preserve` CLI flag via `preserve_reasoning`. |
| **Diagnostic Tool** | None provided. | Includes `scripts/check_applied.py` to inspect model directories and GGUFs for active template versions. |

---

<details open>
<summary><b>Quick Install & Engine Setup</b></summary>

### llama.cpp / llama-server / koboldcpp
Run `llama-server` with the template file and DeepSeek reasoning format:
```bash
llama-server -m your_model.gguf --jinja --chat-template-file chat_template.jinja --reasoning-format deepseek
```
*Why `--reasoning-format deepseek` matters:* When connecting coding agents like OpenCode, Claude Code, or Pi.dev to `llama-server`, this flag extracts `<think>` blocks into the dedicated `reasoning_content` API response field. This prevents raw thinking tokens from leaking into the text stream and stopping tool calls midway.

*Native CLI flag:* On recent `llama.cpp` builds, you can pass `--reasoning-preserve` directly for 100% Prefix KV Cache retention.

### LM Studio
1. Open your Qwen model in the right side panel.
2. Scroll down to **Prompt Template**.
3. Replace the template with the contents of `chat_template.jinja`.
4. Click **Save**.

### vLLM
Replace the `"chat_template"` string in your `tokenizer_config.json` with `chat_template_oneline.txt` (or raw `chat_template.jinja`).
```bash
vllm serve Qwen/Qwen3.8-2.4T-A95B --reasoning-parser qwen3 --tool-call-parser qwen3_xml
```
*Reasoning parser:* Use `--reasoning-parser qwen3` on vLLM to split `<think>` blocks into the response reasoning field. Note that vLLM's parser checks the top-level `enable_thinking: false` request parameter or `reasoning_effort: "none"`, but does not inspect Jinja-internal dynamic `<|think_off|>` tags in prompt bodies. To disable reasoning on vLLM, pass `"enable_thinking": false` in your request parameters.

*Tool parser selection:* Use `--tool-call-parser qwen3_xml` on current vLLM releases. If you are on an older vLLM build, use `--tool-call-parser qwen3_coder`. If you explicitly set `tool_call_format="json"`, use `--tool-call-parser hermes`.

### SGLang
Launch SGLang with `--chat-template` pointing directly to `chat_template.jinja`:
```bash
python3 -m sglang.launch_server --model-path Qwen/Qwen3.8-27B --chat-template chat_template.jinja
```
*Why `--chat-template` matters on SGLang:* By default, SGLang 0.5.x ignores a local `chat_template.jinja` file in the model directory and falls back to the embedded template in `tokenizer_config.json`. Passing `--chat-template` (or using `chat-template: /path/to/chat_template.jinja` in YAML configuration) ensures the fixed template is loaded.

### oMLX / MLX
Overwrite `chat_template.jinja` in your local model directory and launch with `--jinja`.

### Recommended Sampling Parameters

Official Qwen sampling recommendations differ between thinking mode and non-thinking mode, reflecting an architectural refinement introduced in Qwen 3.8:

| Model & Mode | Temperature | Top-P | Top-K | Min-P | Presence Penalty | Description |
|---|---|---|---|---|---|---|
| **Qwen 3.8: Thinking Mode (All Tasks / Coding & General)** | **`1.0`** | `0.95` | `20` | `0.0` | `0.0` | **Official 3.8 default**: Prevents reasoning collapse in `<think>` blocks, allowing broad exploration and self-correction on coding (SWE-bench) and reasoning tasks. Presence penalty must stay at `0.0`. |
| **Qwen 3.5 / 3.6: Thinking Mode (Precise Coding & WebDev)** | **`0.6`** | `0.95` | `20` | `0.0` | `0.0` | **Official 3.5/3.6 coding default**: Tailored for older checkpoints where lower temperature prevented logical drift during code synthesis. |
| **All Models: Non-Thinking / Instruct Mode (`enable_thinking: false`)** | **`0.7`** | `0.80` | `20` | `0.0` | `1.5` | Stable direct instruction following when `enable_thinking=false` (or `<|think_off|>`). |

* *Top-K:* Keeping `top_k: 20` is an official standard baseline across all Qwen models (especially quantized weights) to truncate long-tail token noise and prevent hallucinations.
* *Min-P:* Official presets default to `min_p: 0.0`. On engines like `llama.cpp` or KoboldCPP, community users often use `min_p: 0.05` alongside `temp: 0.6` as a dynamic filter.
* *Presence Penalty evolution:* In Qwen 3.5, the model card suggested `presence_penalty=1.5` for general thinking tasks, but set `0.0` for coding. Starting with Qwen 3.6 and 3.8, the official team standardized `presence_penalty=0.0` across all thinking modes because non-zero penalty during chain-of-thought causes language mixing and degrades code syntax. In non-thinking mode, `presence_penalty=1.5` remains officially recommended across all versions to prevent repetitive loops.

### GitHub Copilot Desktop Canvas
GitHub Copilot Desktop requires OpenAI-standard JSON tool calls. Launch your server with `tool_call_format="json"` and use `--tool-call-parser hermes` (e.g. on vLLM or llama-server) so Copilot can interact seamlessly with canvas tools.

</details>

---

## Why you need this

The official Qwen templates contain engine restrictions, Python-specific Jinja logic, and regressions that break local inference and agent workflows.

<details open>
<summary><b>Critical Issues Fixed</b></summary>

| Area | Issue in Official Templates | The Fix |
|---|---|---|
| **Qwen 3.8 Support** | Official 3.8-2.4T-A95B crashes if `enable_thinking=false`. | **Restored Fast Mode**. Supports fast non-reasoning mode via kwargs or `<\|think_off\|>`. |
| **Qwen 3.8 Token Safety** | Official `xhigh` default burns token budgets with zero content returned. | **Safe `medium` Default**. Zero prompt injection unless explicitly requested. |
| **Qwen 3.8 Regression** | Official 3.8 injects duplicate blank `<think></think>` in chat history. | **Cured Empty Think Poisoning**. Multi-format reasoning extraction. |
| **Reasoning Control** | Inability to change reasoning effort in chat interfaces. | **Inline Chat Tags**. Full support for `<\|think_low\|>`, `<\|think_medium\|>`, and `<\|think_xhigh\|>`. |
| **Compatibility** | `llama.cpp --reasoning-preserve` CLI flag compatibility. | **Native Alias Support**. Supports both `preserve_reasoning` and `preserve_thinking`. |
| **Compatibility** | JSON-string tool arguments (OpenAI / Ollama) crash official templates. | **Universal Tool Parsing**. Safely handles mappings, JSON strings, and scalar args. |
| **Agentic Loop** | Model aborts turn when combining conversational text and a tool call. | Cured "Empty Think" poisoning and softened imperative system directives. |
| **Agentic Loop** | Model gets stuck emitting the identical failing tool call. | Added two-tier error escalation to force correction while retaining reasoning. |
| **Agentic Loop** | Model panics and debates internal rules after fetching data. | Broadened `<think>` instructions to authorize conversational synthesis. |
| **Agentic Loop** | API returns containing the word "error" trigger false retry loops. | Replaced broad matching with strict structural guards. |
| **Performance** | Mutated past turns destroy the prefix cache. | Enforced chronological history for a 100% KV Cache hit rate. |
| **Performance** | Deep Jinja nesting drops `llama.cpp` speed by 80%. | Flattened the AST architecture to maximize throughput. |
| **Compatibility** | Python-specific filters crash C++ inference engines. | Rewrote all filters to be 100% `minijinja` safe. |
| **Compatibility** | Qwen-native parsers (like vLLM) crash on JSON formatting. | Maintained canonical Qwen XML format as the default. |
| **Compatibility** | Older API setups and wrappers crash on native XML. | Added a `tool_call_format="json"` opt-in override. |
| **Compatibility** | Anthropic `message.thinking` payloads are rejected. | Added native Anthropic reasoning support. |
| **Stability** | Massive tool data returns blow out the context window. | Added dynamic payload truncation limits. |
| **Stability** | Mid-conversation system prompts crash the template. | Added native support for arbitrary system and developer messages. |
| **Edge Cases** | Text duplicates during streaming generation. | Restored canonical spacing to the generation prompt. |
| **Edge Cases** | Model hallucinates reasoning tags when thinking is disabled. | Injected strict boundaries to force clean reasoning bypass. |

</details>

---

## Customization & Kwarg Reference

<details open>
<summary><b>1. Reasoning Effort Steering (Qwen 3.8)</b></summary>

Qwen 3.8 has 3 native prompt-steered reasoning levels. You can control this via template kwargs or directly inline in your chat messages:

**Via Template Kwargs (`chat_template_kwargs`):**
```json
{
  "reasoning_effort": "xhigh"
}
```
* **`"medium"` (Default / Safe Baseline):** No extra instruction text injected. Preserves 100% Prefix KV Cache parity with v21 and lets the model reason naturally without token-budget traps.
* **`"xhigh"` (Deep Reasoning):** Injects Qwen's official deep reasoning instruction:
  > *"Reasoning effort is set to xhigh. Please think carefully through the task, validate key assumptions, consider plausible alternatives, and prioritize correctness, consistency, and clarity in the final answer."*
* **`"low"` (Concise Reasoning):** Injects concise thinking instructions for fast, summary-oriented reasoning:
  > *"Reasoning effort is set to low. Keep your thinking brief and focused, moving directly to the conclusion without unnecessary elaboration."*

*API Compatibility Aliases:*
To prevent errors when calling the model through standard API proxies and coding agent harnesses:
* `"high"`, `"max"`, `"ultracode"`, and `"extreme"` automatically map to `"xhigh"` (supported by OpenAI, Claude Code, Cline, Cursor).
* `"minimal"` and `"low"` automatically map to `"low"`.
* `"none"` and `"off"` disable thinking entirely.

**Via Inline Chat Tags (Per-Prompt Steering):**
* `Solve this proof <|think_xhigh|>` or `<|think_ultracode|>` (Deep reasoning)
* `Explain recursion briefly <|think_low|>` (Concise reasoning)
* `What is the capital of France? <|think_off|>` (No reasoning / fast mode)

Tags are sticky: the template scans the whole conversation and the last tag found wins, so a tag in an earlier message stays in effect for later turns until another tag replaces it.

*(Note: When thinking is disabled, reasoning effort instructions are automatically suppressed. On vLLM, prefer request-level `enable_thinking=false` or `reasoning_effort="none"` over `<|think_off|>`; see the vLLM setup notes above).*

**Editing defaults without kwargs (LM Studio and other UIs that cannot pass `chat_template_kwargs`):**
Three variables near the top of `chat_template.jinja` hold the defaults. Edit them before pasting the template:
* `_default_reasoning_effort = 'medium'` - effort used when no `reasoning_effort` kwarg is passed: `'low'`, `'medium'`, `'xhigh'`, or `'none'` (thinking off). The aliases listed above work too.
* `enable_thinking = enable_thinking if enable_thinking is defined else true` - change `true` to `false` to default to non-thinking mode.
* `_tool_format = tool_call_format if tool_call_format is defined else 'xml'` - change `'xml'` to `'json'` for harnesses that need Hermes JSON.

</details>

<details>
<summary><b>2. KV Cache Preservation (`preserve_reasoning` & `preserve_thinking`)</b></summary>

By default, this template **preserves** all past `<think>` blocks in the chat history. This prevents the model from suffering "amnesia stalls" during complex agentic loops and guarantees a 100% Prefix KV Cache hit rate on local inference engines.

* On recent `llama.cpp` builds, pass `--reasoning-preserve` directly.
* Or pass via template kwargs:
```json
{
  "preserve_thinking": true
}
```

If you are on severely memory-constrained hardware and need to save context tokens, set `"preserve_thinking": false` (or `"preserve_reasoning": false`) to strip past thoughts.

> **KV cache trade-off:** `preserve_thinking: false` keeps reasoning only for the turns that follow the most recent user query, so historical thoughts are dropped as soon as a new user turn begins. That rewrites already-rendered history and invalidates the prefix cache from the first assistant turn of the previous segment. The 100% Prefix KV Cache hit rate applies to the default (`true`) setting; enable stripping only when context pressure outweighs prompt reprocessing cost.

</details>

<details>
<summary><b>3. Tool Call Format (XML vs JSON)</b></summary>

Qwen models are natively trained on XML tool calls (`<function=name>`). By default, this template uses **`xml`** format:
* **`"xml"` (Default):** Generates canonical XML instructions for tool calls and safely handles both dictionary arguments and serialized JSON strings in assistant history without corrupting XML tags or mutating system prompts between turns. Dictionary arguments render as `<parameter=...>` blocks; a serialized JSON string is rendered verbatim inside the `<function=...>` block as a best-effort fallback (Jinja cannot parse JSON), so dictionaries are preferred. vLLM converts string arguments to dictionaries before rendering, so it always takes the `<parameter>` path.
* **`"json"` (Optional Override):** Forces Hermes JSON format (`{"name": "...", "arguments": {...}}`) for both system prompt instructions and history rendering.

**When to use the JSON override:**
If you are using a framework or harness (such as specific Hermes Agent configurations) that strictly requires Hermes JSON, pass:
```json
{
  "tool_call_format": "json"
}
```
*(When opting into JSON format, structured JSON responses and tool arguments are protected from truncation to preserve JSON syntax, while plain-text logs are safely sliced)*.

</details>

<details>
<summary><b>4. Dynamic Payload Truncation</b></summary>

To prevent oversized tool returns from blowing out context limits:
* `max_tool_arg_chars` (default `0` / disabled): Slices oversized tool call arguments. Applies to mapping arguments and to serialized JSON string arguments alike.
* `max_tool_response_chars` (default `0` / disabled): Slices oversized tool output data.

In JSON mode (`tool_call_format="json"`), tool call arguments and structured JSON responses (`{...}`, `[...]`) are preserved intact to prevent syntax corruption, while long plain-text outputs (e.g. bash transcripts) remain safely governed by `max_tool_response_chars`.

</details>

---

<details>
<summary><b>Diagnostic Script & Test Suite</b></summary>

### Check Active Template on Your Model
Run the included diagnostic utility on your model folder or GGUF:
```bash
python3 scripts/check_applied.py /path/to/your/model
```

### Running the Test Suite
```bash
python3 scripts/test_v22.py
```
Tests cover 105 automated verification cells including `reasoning_effort` levels, monotonic API mappings, inline chat tags, multi-part and vision payloads, tool call serialization across wire formats, dynamic truncation, error escalation precision, malformed input handling, multi-turn history parsing, prefix KV cache stability, and parity between `chat_template.jinja` and `chat_template_oneline.txt`. Set `QWEN_TEMPLATE_FILE=chat_template_oneline.txt` to run the entire suite against the minified build. Test 105 is a deterministic property fuzzer (`scripts/fuzz_template.py`) asserting nine structural invariants over generated conversations; run it standalone with `python3 scripts/fuzz_template.py --cases 2000`.

</details>

---

## Authorship & Contributors
| Role | Author / Contributor |
|------|----------------------|
| Original models | Alibaba Cloud (Qwen team) |
| Template fixes | [Frédéric Guigand](https://huggingface.co/froggeric) (`@froggeric`) |
| Property fuzzer, error tiering & test suite | [Juan Calderon-Perez](https://huggingface.co/g-a-b-y) (`@g-a-b-y`) |
| Multi-tool alignment, reasoning fields & docs | [Gabriel Devenyi](https://huggingface.co/gdevenyi) (`@gdevenyi`) |
| C++ AST optimizations | [barubary](https://github.com/spiritbuun/buun-llama-cpp) / `spiritbuun` |

## License
Apache-2.0, inherited from Qwen.

---

<details>
<summary>Technical Details of the Critical Fixes</summary>

### 1. The "Empty Think" Poisoning and Logic Trap Cure
Previous templates attempted to save tokens by replacing past thoughts with empty `<think>\n</think>` blocks, combined with an absolute system prompt demanding a tool be called immediately after `</think>`. This created a toxic pattern where the model associated empty thoughts with tools, causing an 80%+ premature turn abort rate. We abolished empty think injection and rewrote the `<IMPORTANT>` directives to explicitly authorize conversational synthesis after thinking. In this release, we also cured official Qwen 3.8's history bug where missing in-content parsers created duplicate blank think tags.

### 2. Upfront Pre-Scan for Control Tags & Inline Effort Steering
In Jinja templates, system prompts are assembled before iterating over message history. We introduce an upfront pre-scan covering raw strings, string lists, and multi-part content lists (`[{'type': 'text', 'text': '...'}]`). This resolves `<|think_off|>`, `<|think_on|>`, `<|think_low|>`, `<|think_medium|>`, and `<|think_xhigh|>` states before the system message is built, preventing reasoning instructions from being injected into non-reasoning turns and cleanly stripping all tags during rendering.

### 3. KV Cache Safety and Autoregressive Normalization
Llama.cpp and vLLM utilize prefix KV caching to speed up generation. Because this template preserves historical thoughts chronologically by default and defaults `reasoning_effort` to `medium` (zero system tokens), rendered history perfectly synchronizes with cached generated tokens. Combined with strict single newline normalization at autoregressive boundaries, this achieves a 100% KV Cache hit rate in multi-turn sessions.

### 4. Native XML Tool Format and Universal Serialization
The model was trained with the XML tool format used by Qwen3-Coder. We restored this format natively while bypassing the `|items` crash by handling both mapping dictionaries and JSON strings. This eliminates crashes when standard OpenAI proxies pass stringified arguments.

### 5. Two-Tier Agentic Error Escalation
When a tool call fails validation repeatedly, the model can enter a degenerate reasoning spiral. This template leverages a two-tier escalation system driven by a forward-tracked `consecutive_failures` counter. On the first error, a diagnostic warning is injected. On the second consecutive error, an urgent system warning forces a fundamentally different approach while retaining the reasoning block so the model can plan its correction.

### 6. Smart False-Positive Detection
Instead of broad substring matching that triggers false retry loops on successful database returns containing words like "error", this template utilizes strict structural guards evaluated over the first 120 characters of the payload.

Signals are split into two tiers. **Strong signals** are unambiguous structural markers (`"error":`, `Traceback (most recent call last):`, `command not found`, `Exception:`, `fatal:`, nonzero exit codes, `invalid syntax`) and fire unconditionally. **Weak signals** are bare prefixes (`error:`, `err!`) and remain gated by a length ceiling plus shell echo (`$ `) and timing (`took `) exclusions. Code and search results are excluded up front via `throw new`, `console.error`, `logger.error` and similar patterns.

Tiering matters because the earlier flat gate suppressed every signal on payloads of 600 characters or more: a routine multi-frame Python traceback exceeds that ceiling, and any output echoing a shell prompt or a timing figure was discarded outright. Strong signals now escalate regardless of payload size.

### 7. minijinja Compatibility Constraints
Python-only Jinja2 features crash or misbehave on `minijinja` (the C++ runtime used by llama.cpp, LM Studio, and MLX). All instances have been refactored for universal support:
* `content | replace('<|think_on|>', '')` became `content.split('<|think_on|>') | join('')` (fixes a bug where `minja` silently drops the entire text payload if the replaced string is found at index 0).
* `| items` became `mapping.items()` iteration, which `minijinja` implements natively.
* `loop.previtem` became explicit array indexing.
* `map('string')` became `join('|')`.
* `| first` became `'$ ' in content`.

### 8. AST Flattening for C++ Throughput
Deeply nested Jinja loops and macros create severe parsing bottlenecks in C++ inference engines. We flattened the AST architecture, effectively curing an 80% inference throughput drop on `llama.cpp` by streamlining how `ns_state` tracking and historical rendering loops are evaluated.

### 9. Dynamic Payload Truncation
Massive API or database returns can instantly blow out a model's context window. We implemented `max_tool_arg_chars` and `max_tool_response_chars` limiters that safely slice oversized payloads. Argument truncation covers both mapping arguments and serialized JSON string arguments, so the OpenAI proxy wire format is limited on the same terms as native dictionaries. In JSON mode (`tool_call_format="json"`), structured JSON payloads (`{...}`, `[...]`) and tool arguments are protected from truncation to guarantee JSON parse validity, while plain-text outputs (such as bash logs) are safely truncated according to `max_tool_response_chars`.

### 10. Reasoning Bypass Hallucination Mitigation
When thinking is disabled, Qwen models often hallucinate reasoning tags due to their training bias. In v22.5, we fully aligned the `# Tools` system prompt block: when thinking is disabled (`enable_thinking=false` or `reasoning_effort="none"`), the template omits `<think>` examples and planning directives entirely, instructing the model to output tool calls immediately without conversational prefixes. This prevents the model from attempting to reason or hallucinating closing tags after the prefilled closed `<think>\n\n</think>\n\n` block.

</details>

---

<details>
<summary>Update History & Changelog</summary>

> **2026-09-03 Update (v22.5): Non-Thinking Tool Prompt Alignment, Video URL Support, and Engine Hardening.**
> 1. **Non-Thinking Tool Prompt Coherence:** When thinking is disabled (`enable_thinking=false` or `reasoning_effort="none"`), the `# Tools` system block now omits `<think>` examples and planning directives, perfectly aligning with the prefilled closed `<think>\n\n</think>\n\n` block and eliminating model stalling on non-reasoning agent loops (#94).
> 2. **Multi-Part Video URL Detection:** Added `'video_url' in item` support in multi-part message parsing, mirroring `'image_url'` handling and eliminating unhandled exceptions on OpenAI-compatible multi-modal video payloads (#94).
> 3. **Smart Response Truncation in JSON Mode:** Replaced the flat `_tool_format != 'json'` bypass with structural JSON detection (`[:1] in ('{', '['))`. Structured JSON tool payloads remain protected from mid-syntax slicing, while long plain-text terminal logs in JSON mode are safely truncated according to `max_tool_response_chars` (#94).
> 4. **SGLang & Qwen 3.8 Flash-Next Support:** Added deployment documentation and verified compatibility for SGLang (`--chat-template`) and Qwen 3.8 Flash-Next (#101, #102).
> 5. **Sampling Parameters & Harness Guidance:** Added recommended sampling parameters and GitHub Copilot Desktop Canvas configuration guidance (#86, #100).
> 6. **Expanded Test Suite (102 -> 105):** Added automated regression tests for non-thinking tool prompt coherence, video URL parsing, and smart JSON response truncation.
>
> **2026-08-24 Update (v22.4): Multi-Tool Token Parity, Extended Reasoning Formats, and UI Default Knobs.**
> 1. **Parallel Tool Call Token Parity:** Consecutive `<tool_call>` blocks in assistant history are now separated by a single newline (`\n`) instead of double newlines (`\n\n`), restoring exact token alignment with official Qwen model generation and preventing prefix KV cache divergence during multi-tool turns (#87).
> 2. **vLLM & Responses API Reasoning Support:** Added native support for `message.reasoning` (used by vLLM OpenAI-compatible endpoints and Responses API schemas) alongside `reasoning_content` and `thinking` (#88).
> 3. **Top-Level `_default_reasoning_effort` Knob:** Added an explicit `_default_reasoning_effort` configuration variable at the top of the template and removed dead assignment code, allowing LM Studio and WebUI users who cannot pass kwargs to change the default reasoning level cleanly without template errors (#91).
> 4. **Documented Sticky Inline Tags & UI Configuration:** Documented inline tag persistence across turns, string-argument fallbacks in XML, and clarified vLLM launch commands (`--reasoning-parser qwen3` alongside `--tool-call-parser qwen3_xml`) (#89, #90).
> 5. **Expanded Test Suite (101 -> 102):** Added automated test coverage for `message.reasoning` extraction, `_default_reasoning_effort` knob behavior, and updated parallel tool call assertions.
>
> *(Credits: Huge thanks to Gabriel Devenyi (@gdevenyi) for their contributions to the v22.4 release!)*
>
> **2026-08-20 Update (v22.3): Error Detection Tiering, Reasoning De-duplication, and Test Suite Expansion.**
> 1. **Two-Tier Error Signals:** Structural error markers now escalate regardless of payload size. The previous flat 600-character ceiling plus whole-body `$ ` and `took ` exclusions silently suppressed warnings on ordinary multi-frame tracebacks and on any shell transcript that echoed its command. Successful exit-code reports (`Exit code: 0`) and JSON success envelopes (`"error": null` / `false` / `""`) are excluded from the strong tier so success payloads do not escalate.
> 2. **Reasoning De-duplication:** When `reasoning_content` or `thinking` is supplied, a leading think block in `content` is stripped so clients that populate both no longer emit two consecutive think blocks. Literal tags later in the answer (for example inside code fences) are preserved verbatim; full heuristic extraction still applies when no explicit reasoning field is present.
> 3. **Single-Line Think Blocks:** `<think>...</think>` written without surrounding newlines is now extracted instead of leaking raw tags into rendered history.
> 4. **Complete Argument Serialization:** Scalar and list tool arguments are serialized via `| tojson` rather than silently dropped, in both XML and JSON wire formats.
> 5. **Consistent Truncation:** `max_tool_arg_chars` now applies to serialized JSON string arguments, and `max_tool_response_chars` is bypassed under `tool_call_format="json"` as documented.
> 6. **KV Cache Documentation:** Documented that `preserve_thinking: false` rewrites rendered history at each new user turn and therefore voids the prefix cache guarantee, which applies to the default setting.
> 7. **Test Suite Expansion (44 -> 101):** Added coverage for control tag and alias completeness, malformed input and exception paths, vision payloads, agentic wire-format shapes, reasoning extraction variants, error detection precision, prefix KV cache stability, and jinja/oneline build parity.
> 8. **Property-Based Fuzz Harness:** Added `scripts/fuzz_template.py`, a deterministic conversation generator asserting nine structural invariants (render success, jinja/oneline parity, token balance, verbatim content preservation, XML parameter fidelity, JSON tool-call validity, warning precision, prefix KV stability, no-think prefill). Prefix stability is checked at generation boundaries: merged system blocks and consecutive tool-result batches are atomic, since the model only generates after a full batch is appended.
>
> *(Credits: Huge thanks to Juan Calderon-Perez (@g-a-b-y) for their massive contributions to the v22.3 release, including the property-based fuzz harness, the two-tier error signal architecture, and extensive test coverage!)*
>
> **2026-08-19 Update (v22.2): Extended Effort Aliases, String Argument Safety, and Error Disambiguation.**
> 1. **Universal Tool Argument Handling:** Hardened XML tool argument parsing to safely handle both mappings and serialized JSON strings in assistant history without syntax crashes or KV cache mutation.
> 2. **Reasoning Effort Aliases:** Added `"ultracode"` and `"extreme"` mappings to `'xhigh'`, with inline `<|think_ultracode|>` and `<|think_extreme|>` support (#78).
> 3. **Multi-System Message Merging:** Merged consecutive leading `system` and `developer` messages into a single unified system turn with `\n\n`.
> 4. **Grep / Search Error Disambiguation:** Eliminated false-positive tool error warnings on code search results containing patterns like `throw new Error` or `console.error` (#66).
> 5. **Safe XML Primitive Serialization:** Boolean and null XML parameter values now serialize to `true`, `false`, and `null` via `| tojson`.
> 6. **Zero-Crash Resilience:** Maintained full resilience without fatal `raise_exception` aborts across all runtime engines.

> **2026-08-16 Update (v22.1): The Qwen 3.8 Update (Bounded Reasoning Defaults, Inline Chat Tags, and Diagnostic Utility).**
> 1. **Full Qwen 3.8 Support:** Single drop-in template covering all Qwen 3.5, 3.6, and 3.8 model variants (`Qwen3.8-2.4T-A95B`, `Qwen3.8-27B`).
> 2. **Default `reasoning_effort` to `medium`:** Replaced the unsafe `xhigh` default with `medium` (zero injected tokens). Eliminates the runaway reasoning token-burn failure where models explore branches until hitting `max_tokens` with empty content (#72).
> 3. **Inline Chat Tags:** Added support for `<|think_low|>`, `<|think_medium|>`, and `<|think_xhigh|>` tags directly inside chat messages (#70).
> 4. **API Mapping & Aliasing:** Added case-insensitive alias support for client and serving runtimes (`high`/`max` -> `xhigh`, `minimal` -> `low`, `none` -> thinking off).
> 5. **Sequential Control Tag Stripping:** All 7 control tags are cleanly stripped across system, user, and multi-part content without prompt leakage.
> 6. **Cured Official 3.8 Empty Think Bug:** Fixed a regression in the official Qwen 3.8 template where removing `<think>` extraction caused blank `<think></think>` blocks to be prepended to real thoughts in chat history.
> 7. **Restored Fast Mode:** Replaced official 3.8's hard exception on `enable_thinking=false`, restoring full user freedom to disable reasoning via kwargs or `<|think_off|>`.
> 8. **Universal Tool Arguments:** Hardened tool call parsing to handle both dictionary structures and JSON-serialized strings without crashing.
> 9. **Diagnostic Utility:** Added `scripts/check_applied.py` to inspect model folders and GGUFs for template consistency.

> **2026-08-13 Update (v22): Qwen 3.8 Support, Reasoning Effort Controls, and Engine Hardening.** 

> **2026-07-02 Update (v21.3): Optional JSON Tool Format Kwarg.** Added an optional `tool_call_format="json"` override for `chat_template_kwargs`.

> **2026-07-02 Update (v21.2): Reasoning Bypass Hallucination Fix.** Adjusted `<IMPORTANT>` block instructions to remove explicit mentions of `</think>` during tool definitions.

> **2026-07-02 Update (v21.1): Reliability Overhaul & XML Revert.** Reverted to native XML format for vLLM `qwen3_coder` compatibility and restored `preserve_thinking` default to `true`.

</details>