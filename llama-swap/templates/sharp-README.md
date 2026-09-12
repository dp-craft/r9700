---
license: apache-2.0
base_model: froggeric/Qwen-Fixed-Chat-Templates
base_model_relation: finetune
tags:
  - jinja
  - chat-template
  - qwen
  - qwen3.5
  - qwen3.6
  - qwen3.8
  - mlx
  - llama.cpp
  - lm-studio
  - vllm
  - tool-calling
  - thinking
  - token-efficient
---

# Qwen Sharp Chat Templates

This is a drop-in fix for any Qwen3.5, 3.6, or 3.8 model, optimizing the models for knowledge work and coding.

<div align="center">
  <img src="plates/sharp_template_plate.png" alt="Qwen3.8-27b gets more accurate and uses fewer tokens with the template applied" width="100%">
</div>

With the *Sharp* template, Qwen3.8-27b (medium effort) gets smarter **and** uses fewer thinking tokens before it answers, and the effect is comparable for other compatible models.

<div align="center">
  <img src="plates/claweval_sharp_plate.png" alt="ThinkingCap-Qwen3.6-27B on Claw-Eval: answer score +7.4, overall +3.8, answer tokens -59% with the Sharp template" width="100%">
</div>

*Sharp* makes Qwen's models *more intelligent per token*, and makes them communicate *more information per token* by cutting filler without sacrificing correctness or substance, saving time and effort for both the model and the user.

<div align="center">
  <img src="plates/card_swe_sharp.png" alt="SWE-bench-Live: Sharp Qwen3.8-27B and Nail (Sharp 35B-A3B MoE) vs the stock template and cloud frontier Opus 5 / Sonnet 5 — same weights, ~2x faster to a fix on the solvable band, still out-solving Opus 5 (high)" width="100%">
</div>

On SWE-bench-Live (real bugs and issues in live open-source codebases), the Sharp template gets the *same* Qwen weights to each fix in **half the time** — [**Dirk**](https://huggingface.co/peculiar-ragdoll/Dirk-Qwen3.8-27B-GGUF) (Qwen3.8-27b) out-solves cloud-frontier Opus 5 (high), and [**Nail**](https://huggingface.co/peculiar-ragdoll/Nail-Qwen3.6-35B-A3B-GGUF) (Qwen3.6-35B-A3B MoE) matches Sonnet 5 (high) — all on your own hardware. Provisional, judge-free, still settling.

## Straight to the point

This is froggeric's [Qwen-Fixed-Chat-Templates](https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates)
`v22.1`, with a force-appended system prompt spliced in. The base fixes issues, the addition makes it better.

> **v22.1 (current upstream).** Covers Qwen 3.8 alongside 3.5/3.6 and adds prompt-directed
> reasoning-effort steering (`none`/`minimal`/`low`/`medium`/`high`/`xhigh`) plus inline
> `<|think_…|>` control tags. As of **v22.1 the default effort is `medium`** — a neutral baseline
> that injects **no** steering line when the caller asks for nothing. (Earlier v22 forced `xhigh`
> by default; froggeric fixed that upstream, so this Sharp build no longer suppresses anything —
> out of the box you get the tuned terseness behavior and nothing else, exactly as v1.) An
> *explicit* effort still renders; pass it via `chat_template_kwargs` (a bare top-level
> `reasoning_effort` field is dropped by OpenAI-style servers before the template sees it):
>
> ```json
> {"messages": [...], "chat_template_kwargs": {"reasoning_effort": "low"}}
> ```

[Dagger-Qwen3.6-27B](https://huggingface.co/peculiar-ragdoll/Dagger-Qwen3.6-27B-MLX) and
[Nail-Qwen3.6-35B-A3B](https://huggingface.co/peculiar-ragdoll/Nail-Qwen3.6-35B-A3B-MLX) shipped with
the **v1** template baked into those builds — that is the exact template embedded in those GGUF and
MLX builds (`template_version = "qwen3.6-froggeric-v21.3"`, terseness, no reasoning-effort steering),
and it lives here in [`archive/v1-qwen3.6-froggeric-v21.3/`](archive/v1-qwen3.6-froggeric-v21.3). The
`chat_template.jinja` at the root of this repo is the newer **v22.1** described above; drop it in to
move a model onto it. The template is published separately because it is the portable part — the
thing worth reusing is not tied to either model.

## What it changes

Eleven inserted lines. Everything else is byte-identical to upstream v22.1.

```jinja
{%- set _terse %}
Answer directly, after thinking. Lead with the answer, then only what it needs to be correct and usable.
Never: open with preamble or pleasantries; restate the question; add filler transitions; hedge with niceties; or repeat a point you've already made.
Always: keep essential steps, caveats, uncertainties, and specifics — never drop correctness or a needed warning for brevity. Keep the final answer lean. Use the least structure that conveys it (plain prose when short; lists or code only when they earn their place). If genuinely uncertain, say so and explain why — never omit uncertainty for the sake of brevity.
If a user request is genuinely ambiguous, ask a sharp question, don't guess.
{%- endset %}
{%- if not _sc %}
    {%- set _sc = _terse | trim %}
{%- else %}
    {%- set _sc = (_sc | trim) ~ '\n\n' ~ (_terse | trim) %}
{%- endif %}
```

One thing happens here: the `if/else` keeps **your own system prompt** — the terseness block is
appended after it, nothing you pass in is replaced. No effort-suppression is needed anymore: v22.1
already defaults to `medium`, which injects no reasoning-effort line unless you ask for one (earlier
v22 forced `xhigh`; see the v22.1 note above). An explicit `reasoning_effort` still renders.

## Impact

The terseness instruction targets prose padding: preamble, restating the question, filler
transitions. Where the deliverable is mostly code or a structured artifact there is less paddingto remove, so expect less from it — and the prompt deliberately protects those 
(*"lists or code only when they earn their place"*, *"never drop correctness for brevity"*).

In addition to reducing thinking tokens while retaining or increasing accuracy, like shown in the graphs up top, the template avoids amnesia and loops by turning on thinking retention: with this template, the model remembers what it thought last turn by default, instead of discarding it. This also increases time to first token on subsequent turns by guaranteeing a cache hit, instead of invalidating the cache by ripping out previous thinking blocks.

## Use

**MLX / transformers** — drop `chat_template.jinja` into the model directory.

```bash
hf download peculiar-ragdoll/Qwen-Sharp-Chat-Templates chat_template.jinja \
  --local-dir /path/to/your-model
```

> **Two places can hold a template, and old runtimes disagree about which wins.** A model
> directory can carry it as `chat_template.jinja` *and* as a `chat_template` key inside
> `tokenizer_config.json`. Anything on transformers ≥ 4.51 — which includes current oMLX and
> LM Studio — prefers the `.jinja` file, so the drop-in just works. Older runtimes read only
> the embedded key and ignore the file, and then the drop-in silently does nothing.
>
> If the directory has both and you are unsure of your runtime, patch both — that is what
> `chat_template_oneline.txt` is for: paste it as the `chat_template` value. Or run
> `scripts/check_applied.py` (below), which reports every source and flags a mismatch.

**oMLX** — drop `chat_template.jinja` into the model directory and rescan. Verified on oMLX
(transformers 5.12.1) by loading a model with the Sharp template as `chat_template.jinja` *and*
a deliberately different template embedded in `tokenizer_config.json`: the `.jinja` file won,
and the model reported the terseness rules with the caller's own system prompt still in force.

**GGUF** — rewrite the embedded template without requantizing:

```bash
pip install gguf
gguf-new-metadata \
  --chat-template-file chat_template.jinja \
  input.gguf output.gguf
```

**tokenizer_config.json** — use `chat_template_oneline.txt`, the minified single-line form. It
renders identically to the full template (verified by `scripts/verify_template.py`).

**llama.cpp at runtime, without touching the file** — pass it per-run instead:

```bash
llama-server -m model.gguf --chat-template-file chat_template.jinja -ngl 99
llama-cli    -m model.gguf --chat-template-file chat_template.jinja -ngl 99
```

Same effect, and it fully replaces whatever is embedded in the GGUF — verified against a build
whose embedded template names a specific model: with the flag, the served template is
byte-identical to this file and the model name is gone. Check it yourself with
`curl localhost:8080/props | jq -r .chat_template`, or render a prompt through
`POST /apply-template`.

Two caveats. `--jinja` is enabled by default in current llama.cpp, so you usually do not need
it — on older builds you do, and it must come *before* `--chat-template-file`. And the flag is
per-invocation: forget it once and you silently get the embedded template back. Rewriting the
GGUF with `gguf-new-metadata` is the durable version; the flag is right for trying it out or for
running one template across several models.

## Did it actually apply?

Point `check_applied.py` at a model directory or a `.gguf`. It finds every template source,
renders each, and tells you whether they agree — exits non-zero if the prompt is missing or the
two sources disagree.

```bash
python3 scripts/check_applied.py /path/to/model-dir
python3 scripts/check_applied.py model.gguf
```

```
  [chat_template.jinja]  17143 bytes
     terseness prompt ......... yes
     keeps your system prompt . yes

  [tokenizer_config.json]  110 bytes
     terseness prompt ......... NO (found 0x)

  *** THE TWO SOURCES DISAGREE ***
  Recent transformers uses chat_template.jinja; oMLX and others read the
  copy embedded in tokenizer_config.json. Right now those differ, so what
  you get depends on your runtime. Patch both to the same content.
```

That case — a fresh `.jinja` dropped in next to a stale embedded copy — is the most common way
this silently does nothing. It also warns if the template names a specific model, which happens
when the file was taken from a model repo rather than from here.

## Setting reasoning effort

By default there is no reasoning-effort instruction — you get the tuned terseness behavior and
nothing else (that is exactly what `medium` renders). To turn steering *on* for a request, set
`reasoning_effort` to `low`, `high`, or `xhigh`. **How you pass it depends on the runtime, and one obvious-looking channel does
not work:**

| How you pass it | oMLX | llama.cpp | transformers | Works? |
|---|:--:|:--:|:--:|:--:|
| `chat_template_kwargs: {"reasoning_effort": "low"}` (in the request body) | ✅ | ✅ | — | **yes — use this** |
| `apply_chat_template(..., reasoning_effort="low")` (Python) | — | — | ✅ | **yes** |
| top-level `reasoning_effort` field (the OpenAI API param) | ❌ | ❌ | — | **no** |

```json
{"messages": [...], "chat_template_kwargs": {"reasoning_effort": "low"}}
```

The last row is the trap. The OpenAI-style **top-level** `reasoning_effort` field is *consumed by
the server* (oMLX and llama.cpp both use it internally to pick reasoning-parse behavior for formats
like harmony/gpt-oss) and is **never handed to the chat template** — so a custom Qwen template can't
see it, and it silently has no effect here. This isn't something the template can fix: a template
only reads the variables the runtime binds at render time. If you need the literal top-level field
to work against these servers, put a thin proxy in front that copies `reasoning_effort` into
`chat_template_kwargs` before forwarding. Otherwise, use the `chat_template_kwargs` channel above —
it works everywhere and needs no code.

Verified on both runtimes: with `chat_template_kwargs` the steering line renders (oMLX prompt grows
+38 tokens for `xhigh`, +26 for `low`; llama.cpp/minja `POST /apply-template` shows the same line);
with the bare top-level field it does not.

## What it doesn't do

- **It is not a fine-tune**, despite the `base_model_relation: finetune` tag — that is the closest
  vocabulary HuggingFace offers for "derived from," and it exists so this repo is linked from
  froggeric's. No weights are involved. It changes what the model is asked for, not what it knows.
- **It does not fix thinking retention by itself** — that comes from froggeric's upstream template,
  which this builds on. If you splice only the terseness block into a stock Qwen template, you get
  the brevity and not the retention.
- **It is not tuned per model.** Every model responds a little differently to a terseness
  instruction; measure yours. The numbers above are from a 27B; a 4B may need firmer wording.
- **The table's figures are Qwen3.6 (the plate above is the 3.8 result).** The template covers 3.5,
  3.6, and 3.8 alike — upstream unified them into one file — but every figure in the table was
  measured on a 3.6 model.

## Credits

Everything structural here is [froggeric](https://huggingface.co/froggeric)'s work — the retention
fix, the tool-calling handling, the whole template. This repo adds a system prompt and nothing
else. `scripts/minify_jinja.py` is froggeric's, with one patch: it now preserves newlines inside
`{% set %}…{% endset %}` blocks, which upstream's template doesn't contain and this one does.

Apache-2.0, matching upstream.
