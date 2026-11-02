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

# Fixed jinja chat templates for Qwen 3.5, 3.6 & 3.8 (v22.1)

This is a universal drop-in Jinja template that fixes rendering errors, KV cache invalidation, token waste, empty think poisoning, and fatal agentic stalling across official Qwen chat templates.

It works across LM Studio, llama.cpp, vLLM, MLX, oMLX, KoboldCPP, and any engine that supports Hugging Face Jinja templates. You only need the single `chat_template.jinja` file at the root of this repository for all Qwen 3.5, 3.6, and 3.8 model sizes.

---

## What is new: The Qwen 3.8 Update

Qwen has released their 3.8 generation starting with `Qwen3.8-2.4T-A95B` and `Qwen3.8-27B`. While the official 3.8 template adopted our default reasoning preservation, it also introduced severe regressions and rigid lockdowns that break local setups. This release brings full Qwen 3.8 support while fixing these official bugs:

1. **Prompt-Steered Reasoning Effort:** Qwen 3.8 introduces 3 core reasoning levels (`xhigh`, `medium`, `low`). The template injects official steering instructions when requested, and auto-suppresses them when thinking is turned off. Client API aliases (`high` / `max` for `xhigh`, `minimal` for `low`, and `none` for thinking off) are supported automatically for OpenAI and vLLM client compatibility.
2. **Safe Default Reasoning Baseline (`medium`):** In official Qwen 3.8, `reasoning_effort` defaulted to `xhigh`. On complex tasks with finite token limits, this pushed the model to explore alternate branches until hitting `max_tokens`, returning zero content. We set the default to `medium` (zero injected tokens), preserving 100% prefix cache parity with v21.3 while eliminating empty-content failures.
3. **Inline Chat Tags for Direct Effort Steering:** You can steer thinking depth directly inside chat prompts (for LM Studio, OpenCode, or WebUI) using inline tags:
   * `<|think_low|>`: Enables thinking with concise reasoning instructions.
   * `<|think_medium|>`: Enables thinking with standard baseline instructions.
   * `<|think_xhigh|>`: Enables thinking with deep reasoning instructions.
   * `<|think_off|>`: Turns off reasoning completely for fast responses.
   *(All tags are automatically stripped from the rendered prompt, so the model never sees raw control tags)*.
4. **Restored Fast Mode (No Reasoning):** Official 3.8 throws a fatal runtime exception if you pass `enable_thinking=false`. We removed this lockdown, giving you complete freedom to disable reasoning via kwargs or inline `<|think_off|>` tags.
5. **Cured Official 3.8 Empty Think Bug:** Official 3.8 removed the in-content thinking parser. In multi-turn chats where reasoning is stored inside message content, official 3.8 injects a blank `<think></think>` block before the real thoughts. This template extracts reasoning cleanly without duplicating tags.
6. **Universal Tool Arguments:** Official 3.8 crashes with `TypeError: Can only get item pairs from a mapping` when clients send standard OpenAI string arguments. This template handles both Python dictionaries and JSON strings seamlessly.
7. **Native llama.cpp `--reasoning-preserve` Support:** Added native support for the new `llama.cpp` CLI flag via the `preserve_reasoning` alias.
8. **Diagnostic Tooling:** Added `scripts/check_applied.py` to check whether `chat_template.jinja` or `tokenizer_config.json` is actively loaded by your runtime.

---

<details open>
<summary><b>Quick Install & Engine Setup</b></summary>

### llama.cpp / llama-server / koboldcpp
Run `llama-server` with the template file and DeepSeek reasoning format:
```bash
llama-server -m your_model.gguf --jinja --chat-template-file chat_template.jinja --reasoning-format deepseek
```
*Why `--reasoning-format deepseek` matters:* When connecting coding agents like OpenCode, Claude Code, or Pi.dev to `llama-server`, this flag extracts `<think>` blocks into the dedicated `reasoning_content` API response field. This prevents raw thinking tokens from leaking into the text stream and stopping tool calls midway.

*Native CLI flag:* On recent `llama.cpp` builds, you can pass `--reasoning-preserve` directly to ensure 100% Prefix KV Cache retention.

### LM Studio
1. Open your Qwen model in the right side panel.
2. Scroll down to **Prompt Template**.
3. Replace the template with the contents of `chat_template.jinja`.
4. Click **Save**.

### vLLM
Replace the `"chat_template"` string in your `tokenizer_config.json` with `chat_template_oneline.txt` (or raw `chat_template.jinja`).
```bash
vllm serve Qwen/Qwen3.8-2.4T-A95B --tool-call-parser qwen3_xml
```
*Parser selection:* Use `--tool-call-parser qwen3_xml` on current vLLM releases. If you are on an older vLLM build, use `--tool-call-parser qwen3_coder`. If you explicitly set `tool_call_format="json"`, use `--tool-call-parser hermes`.

### oMLX / MLX
Overwrite `chat_template.jinja` in your local model directory and launch with `--jinja`.

</details>

---

## Why you need this

The official Qwen templates contain engine restrictions, Python-specific Jinja logic, and regressions that break local inference and agent workflows.

<details open>
<summary><b>Critical Issues Fixed</b></summary>

| Area | Issue in Official Templates | The Fix |
|---|---|---|
| **Qwen 3.8 Support** | Official 3.8 crashes if `enable_thinking=false`. | **Restored Fast Mode**. Supports fast non-reasoning mode via kwargs or `<\|think_off\|>`. |
| **Qwen 3.8 Token Safety** | Official `xhigh` default burns token budgets with zero content returned. | **Safe `medium` Default**. Zero prompt injection unless explicitly requested. |
| **Qwen 3.8 Regression** | Official 3.8 injects duplicate blank `<think></think>` in chat history. | **Cured Empty Think Poisoning**. Robust multi-format reasoning extraction. |
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
To prevent errors when calling the model through standard API proxies:
* `"high"` and `"max"` automatically map to `"xhigh"` (standard OpenAI API clients send `"high"`).
* `"minimal"` automatically maps to `"low"`.
* `"none"` disables thinking entirely.

**Via Inline Chat Tags (Per-Prompt Steering):**
* `Solve this proof <|think_xhigh|>` (Deep reasoning)
* `Explain recursion briefly <|think_low|>` (Concise reasoning)
* `What is the capital of France? <|think_off|>` (No reasoning / fast mode)

*(Note: When thinking is disabled, reasoning effort instructions are automatically suppressed).*

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

</details>

<details>
<summary><b>3. Tool Call Format Override (JSON vs XML)</b></summary>

Qwen models are natively trained to output tool calls in XML (`<function=name>`). By default, this template uses native XML to maximize reliability.

**When to use the JSON override:**
If you are using a framework or harness (such as specific Hermes Agent configurations) that strictly requires Hermes JSON (`{"name": "...", "arguments": {...}}`), pass:
```json
{
  "tool_call_format": "json"
}
```
*(When opting into JSON format, argument truncation is safely bypassed to avoid corrupting JSON syntax)*.

</details>

<details>
<summary><b>4. Dynamic Payload Truncation</b></summary>

To prevent oversized tool returns from blowing out context limits:
* `max_tool_arg_chars` (default `0` / disabled): Slices oversized tool call arguments.
* `max_tool_response_chars` (default `0` / disabled): Slices oversized tool output data.

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
Tests cover 34 automated verification cells including `reasoning_effort` levels, monotonic API mappings, inline chat tags, multi-part payloads, tool call serialization, dynamic truncation, error escalation, and multi-turn history parsing.

</details>

---

## Authorship
| Role | Author |
|------|--------|
| Original models | Alibaba Cloud (Qwen team) |
| Template fixes | [froggeric](https://huggingface.co/froggeric) |
| C++ AST optimizations | [barubary](https://github.com/spiritbuun/buun-llama-cpp) / `spiritbuun` |

## License
Apache-2.0, inherited from Qwen.

---

<details>
<summary>Technical Details of the Critical Fixes</summary>

### 1. The "Empty Think" Poisoning and Logic Trap Cure
Previous templates attempted to save tokens by replacing past thoughts with empty `<think>\n</think>` blocks, combined with an absolute system prompt demanding a tool be called immediately after `</think>`. This created a toxic pattern where the model associated empty thoughts with tools, causing an 80%+ premature turn abort rate. We abolished empty think injection and rewrote the `<IMPORTANT>` directives to explicitly authorize conversational synthesis after thinking. In this release, we also cured official Qwen 3.8's history bug where missing in-content parsers created duplicate blank think tags.

### 2. Upfront Pre-Scan for Control Tags & Inline Effort Steering
In Jinja templates, system prompts are assembled before iterating over message history. We introduce a comprehensive upfront pre-scan covering raw strings, string lists, and multi-part content lists (`[{'type': 'text', 'text': '...'}]`). This resolves `<|think_off|>`, `<|think_on|>`, `<|think_low|>`, `<|think_medium|>`, and `<|think_xhigh|>` states before the system message is built, ensuring reasoning instructions are never injected into non-reasoning turns and all tags are cleanly stripped during rendering.

### 3. KV Cache Safety and Autoregressive Normalization
Llama.cpp and vLLM utilize prefix KV caching to speed up generation. Because this template preserves historical thoughts chronologically by default and defaults `reasoning_effort` to `medium` (zero system tokens), rendered history perfectly synchronizes with cached generated tokens. Combined with strict single newline normalization at autoregressive boundaries, this achieves a 100% KV Cache hit rate in multi-turn sessions.

### 4. Native XML Tool Format and Universal Serialization
The model was trained with the XML tool format used by Qwen3-Coder. We restored this format natively while bypassing the `|items` crash by handling both mapping dictionaries and JSON strings. This eliminates crashes when standard OpenAI proxies pass stringified arguments.

### 5. Two-Tier Agentic Error Escalation
When a tool call fails validation repeatedly, the model can enter a degenerate reasoning spiral. This template leverages a two-tier escalation system driven by a forward-tracked `consecutive_failures` counter. On the first error, a diagnostic warning is injected. On the second consecutive error, an urgent system warning forces a fundamentally different approach while retaining the reasoning block so the model can plan its correction.

### 6. Smart False-Positive Detection
Instead of broad substring matching that triggers false retry loops on successful database returns containing words like "error", this template utilizes strict structural guards looking for `Exception:`, `"error":`, `Traceback`, and `command not found`, combined with length gates and shell echo exclusions (`$ `).

### 7. minijinja Compatibility Constraints
Python-only Jinja2 features crash or misbehave on `minijinja` (the C++ runtime used by llama.cpp, LM Studio, and MLX). All instances have been refactored for universal support:
* `content | replace('<|think_on|>', '')` became `content.split('<|think_on|>') | join('')` (fixes a bug where `minja` silently drops the entire text payload if the replaced string is found at index 0).
* `| items` became `for key in mapping`.
* `loop.previtem` became explicit array indexing.
* `map('string')` became `join('|')`.
* `| first` became `'$ ' in content`.

### 8. AST Flattening for C++ Throughput
Deeply nested Jinja loops and macros create severe parsing bottlenecks in C++ inference engines. We flattened the AST architecture, effectively curing an 80% inference throughput drop on `llama.cpp` by streamlining how `ns_state` tracking and historical rendering loops are evaluated.

### 9. Dynamic Payload Truncation
Massive API or database returns can instantly blow out a model's context window. We implemented `max_tool_arg_chars` and `max_tool_response_chars` limiters that safely slice oversized payloads. Crucially, this truncation is automatically disabled when `tool_call_format="json"` is active, as slicing a serialized JSON string structurally corrupts the data and crashes downstream parsers.

### 10. Reasoning Bypass Hallucination Mitigation
When thinking is disabled, Qwen models often hallucinate reasoning tags due to their training bias. We injected a safe boundary and adjusted the `<IMPORTANT>` system block to remove explicit mentions of `</think>` during tool instructions. This stops the model from hallucinating closing tags when calling tools in a no-reasoning state.

</details>

---

<details>
<summary>Update History & Changelog</summary>

> **2026-08-16 Update (v22.1): The Qwen 3.8 Update (Bounded Reasoning Defaults, Inline Chat Tags, and Diagnostic Utility).**
> 1. **Full Qwen 3.8 Support:** Single drop-in template covering all Qwen 3.5, 3.6, and 3.8 model variants (`Qwen3.8-2.4T-A95B`, `Qwen3.8-27B`).
> 2. **Default `reasoning_effort` to `medium`:** Replaced the unsafe `xhigh` default with `medium` (zero injected tokens). Eliminates the runaway reasoning token-burn failure where models explore branches until hitting `max_tokens` with empty content (#72).
> 3. **Inline Chat Tags:** Added support for `<|think_low|>`, `<|think_medium|>`, and `<|think_xhigh|>` tags directly inside chat messages (#70).
> 4. **API Mapping & Aliasing:** Added case-insensitive alias support for client and serving runtimes (`high`/`max` -> `xhigh`, `minimal` -> `low`, `none` -> thinking off).
> 5. **Sequential Control Tag Stripping:** Ensured all 7 control tags are cleanly stripped across system, user, and multi-part content without prompt leakage.
> 6. **Cured Official 3.8 Empty Think Bug:** Fixed a regression in the official Qwen 3.8 template where removing `<think>` extraction caused blank `<think></think>` blocks to be prepended to real thoughts in chat history.
> 7. **Restored Fast Mode:** Replaced official 3.8's hard exception on `enable_thinking=false`, restoring full user freedom to disable reasoning via kwargs or `<|think_off|>`.
> 8. **Universal Tool Arguments:** Hardened tool call parsing to handle both dictionary structures and JSON-serialized strings without crashing.
> 9. **Diagnostic Utility:** Added `scripts/check_applied.py` to inspect model folders and GGUFs for template consistency.

> **2026-08-13 Update (v22): Qwen 3.8 Support, Reasoning Effort Controls, and Engine Hardening.** 

> **2026-07-02 Update (v21.3): Optional JSON Tool Format Kwarg.** Added an optional `tool_call_format="json"` override for `chat_template_kwargs`.

> **2026-07-02 Update (v21.2): Reasoning Bypass Hallucination Fix.** Adjusted `<IMPORTANT>` block instructions to remove explicit mentions of `</think>` during tool definitions.

> **2026-07-02 Update (v21.1): Reliability Overhaul & XML Revert.** Reverted to native XML format for vLLM `qwen3_coder` compatibility and restored `preserve_thinking` default to `true`.

</details>