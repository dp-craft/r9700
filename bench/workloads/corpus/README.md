# corpus/ — real source trees used to pad benchmark prompts

`build_prompt.py --src` sources. Both trees are **real code including their tests**, so padded
prompts exercise the model like an actual coding task (mixed prose/code, realistic token
distribution), not synthetic filler. Tracked in git so prompt fixtures are reproducible.

| Dir | Language | Size (text) | Provenance |
|-----|----------|-------------|------------|
| `ts-agentic-code-runner/` | TypeScript | ~913 K chars ≈ 228 K tokens | Copied 2026-07-11 from local project `/home/dev/work/dippe/AiChatney/tools/agentic-code-runner` (src + scripts + README; `node_modules`, logs, caches excluded) |
| `py-rich/` | Python | ~1.35 M chars ≈ 337 K tokens | [Textualize/rich v14.0.0](https://github.com/Textualize/rich/archive/refs/tags/v14.0.0.tar.gz) (`rich/` + `tests/` + README), MIT license (see `py-rich/LICENSE`), downloaded 2026-07-11 |

Combined ≈ 565 K tokens of gatherable text — enough for 100 K-token prompts from either language
alone or mixed (`--src` is repeatable; sources are concatenated in the order given).

**Do not edit these trees** — they are frozen fixtures. If you need a bigger corpus, add a new
dated dir with provenance here instead of growing an existing one.
