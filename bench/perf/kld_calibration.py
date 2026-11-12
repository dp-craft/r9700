#!/usr/bin/env python3
"""Build a KLD calibration set for bench/perf/kld_probe.py (deterministic, seed-pinned).

Why (2026-11-12, campaigns/perf/2026-11-09-1825-27b-arms-kld): the v1 set used whole-file heads, and a model
asked to continue a COMPLETE file just emits end-of-text — 77 of the 87 whole-file prompts ended after <5
tokens, so ~60% of the set measured nothing. Every prompt here is cut MID-TEXT (or ends at an open assistant
turn), so the continuation is real work.

Mix (default 128): 90 code (45 .py + 45 .ts from bench/workloads/corpus/, cut at a line boundary at 35-75%
of the file, ≤ 8000 chars), 14 English markdown (docs/findings + docs/research, cut the same way), 24 chat
turns rendered with the PRODUCTION chat template (12 agentic coding tasks over a corpus excerpt, 12 with a
tool list) ending at the open assistant turn ("<think>"). Chat texts are written as files under
<out-dir>/<name>/ (kld_probe.py prompts are {id, src, char_cut}: src resolved against the repo root).
The order is shuffled with the seed, so any first-N subset (KLD_N / DIAG_N) mixes all kinds.

  python3 bench/perf/kld_calibration.py build --out-dir <campaign>/inputs --name calibration-v2
  -> <name>-prompts.jsonl, <name>-manifest.jsonl (kind, sha256, bytes, char_cut), <name>.sha256, <name>/chat-*.txt
"""
import argparse
import hashlib
import json
import os
import random
import re

ROOT_DEFAULT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEMPLATE = "stack/serve/vllm/templates/dp-sharp-chat_template.jinja"
MAX_CHARS = 8000
HU = re.compile(r"[őűŐŰ]")   # Hungarian-only letters: older docs are HU/mixed; the prose slice is English

TOOLS = [
    {"type": "function", "function": {"name": "read_file", "description": "Read a text file from the repository.",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "grep", "description": "Search the repository with a regular expression.",
     "parameters": {"type": "object", "properties": {"pattern": {"type": "string"}, "path": {"type": "string"}},
                    "required": ["pattern"]}}},
    {"type": "function", "function": {"name": "edit_file", "description": "Replace an exact string in a file.",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "old": {"type": "string"},
                    "new": {"type": "string"}}, "required": ["path", "old", "new"]}}},
    {"type": "function", "function": {"name": "run_tests", "description": "Run the test suite, optionally filtered.",
     "parameters": {"type": "object", "properties": {"filter": {"type": "string"}}}}},
]
AGENTIC = [
    "Review this file for bugs and risky edge cases. List each issue with the line and a concrete fix.",
    "Write unit tests for the public functions in this file. Cover the edge cases, not only the happy path.",
    "Refactor the longest function in this file into smaller ones without changing behaviour. Show the new code.",
    "Explain what this module does, how its parts connect, and where it would break first under load.",
]
TOOL_TASKS = [
    "Find where `{sym}` is defined in {path}, check how it is used across the repo, and fix any caller that passes the wrong type.",
    "The tests for {path} started failing after the last change to `{sym}`. Investigate and fix it.",
    "Add input validation to `{sym}` in {path} and update the tests.",
]
SYSTEM = "You are a coding agent working in a TypeScript and Python repository. Think, then act."


def _files(root, rel, exts, min_chars):
    out = []
    for dp, _, fns in os.walk(os.path.join(root, rel)):
        for fn in fns:
            if fn.endswith(exts):
                p = os.path.join(dp, fn)
                try:
                    txt = open(p, encoding="utf-8").read()
                except (UnicodeDecodeError, OSError):
                    continue
                if len(txt) >= min_chars:
                    out.append((os.path.relpath(p, root), txt))
    return sorted(out)


def mid_cut(text, rng, lo=0.35, hi=0.75, max_chars=MAX_CHARS, min_prompt=800, min_rest=1000):
    """A line-boundary cut strictly inside the text: prompt ≥ min_prompt chars, ≥ min_rest chars left after it.
    Returns the cut (chars) or None when the text cannot satisfy both."""
    n = len(text)
    target = min(int(n * rng.uniform(lo, hi)), max_chars, n - min_rest)
    if target < min_prompt:
        return None
    cut = text.rfind("\n", 0, target) + 1
    return cut if cut >= min_prompt else None


def _symbol(text):
    m = re.search(r"^\s*(?:export\s+)?(?:async\s+)?(?:def|function|class)\s+([A-Za-z_]\w*)", text, re.M)
    return m.group(1) if m else "main"


def render_chat(root, messages, tools=None):
    import jinja2
    env = jinja2.Environment(extensions=["jinja2.ext.loopcontrols"])

    def _raise(msg):
        raise jinja2.TemplateError(msg)
    env.globals["raise_exception"] = _raise
    tpl = env.from_string(open(os.path.join(root, TEMPLATE), encoding="utf-8").read())
    return tpl.render(messages=messages, tools=tools, add_generation_prompt=True)


def build(root, out_dir, name, seed=0, n_code=45, n_prose=14, n_agentic=12, n_tool=12):
    rng = random.Random(seed)
    items = []   # (kind, src_rel, char_cut)

    def take_cut(pool, k, kind):
        got = 0
        for rel, txt in rng.sample(pool, len(pool)):
            if got == k:
                break
            cut = mid_cut(txt, rng)
            if cut:
                items.append((kind, rel, cut))
                got += 1
        if got < k:
            raise SystemExit(f"{kind}: only {got}/{k} files long enough for a mid-text cut")

    py = _files(root, "bench/workloads/corpus", (".py",), 2500)
    ts = _files(root, "bench/workloads/corpus", (".ts",), 2500)
    md = [f for f in _files(root, "docs/findings", (".md",), 3000) + _files(root, "docs/research", (".md",), 3000)
          if not HU.search(f[1])]
    take_cut(py, n_code, "code-py")
    take_cut(ts, n_code, "code-ts")
    take_cut(md, n_prose, "prose-md")

    chat_dir = os.path.join(out_dir, name)
    os.makedirs(chat_dir, exist_ok=True)
    code = py + ts
    for i in range(n_agentic + n_tool):
        rel, txt = rng.choice(code)
        excerpt = txt[: txt.rfind("\n", 0, 2500) + 1]
        if i < n_agentic:
            kind = "chat-agentic"
            user = f"{AGENTIC[i % len(AGENTIC)]}\n\nFile `{rel}`:\n```\n{excerpt}```"
            text = render_chat(root, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
        else:
            kind = "chat-tools"
            user = TOOL_TASKS[i % len(TOOL_TASKS)].format(sym=_symbol(txt), path=rel)
            text = render_chat(root, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], TOOLS)
        fp = os.path.join(chat_dir, f"chat-{i + 1:02d}.txt")
        with open(fp, "w", encoding="utf-8") as f:
            f.write(text)
        items.append((kind, os.path.relpath(fp, root), len(text)))

    rng.shuffle(items)
    prompts, manifest = [], []
    for j, (kind, rel, cut) in enumerate(items, 1):
        raw = open(os.path.join(root, rel), "rb").read()
        pid = f"cal2-{j:03d}"
        prompts.append({"id": pid, "src": rel, "char_cut": cut})
        manifest.append({"id": pid, "kind": kind, "src": rel, "sha256": hashlib.sha256(raw).hexdigest(),
                         "bytes": len(raw), "char_cut": cut})
    pfile = os.path.join(out_dir, f"{name}-prompts.jsonl")
    with open(pfile, "w", encoding="utf-8") as f:
        f.writelines(json.dumps(p) + "\n" for p in prompts)
    with open(os.path.join(out_dir, f"{name}-manifest.jsonl"), "w", encoding="utf-8") as f:
        f.writelines(json.dumps(m) + "\n" for m in manifest)
    with open(os.path.join(out_dir, f"{name}.sha256"), "w", encoding="utf-8") as f:
        f.write(f"{hashlib.sha256(open(pfile, 'rb').read()).hexdigest()}  {name}-prompts.jsonl\n")
    return prompts, manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--out-dir", required=True)
    b.add_argument("--name", default="calibration-v2")
    b.add_argument("--seed", type=int, default=0)
    b.add_argument("--repo-root", default=ROOT_DEFAULT)
    a = ap.parse_args()
    _, man = build(a.repo_root, os.path.abspath(a.out_dir), a.name, a.seed)
    kinds = {}
    for m in man:
        kinds[m["kind"]] = kinds.get(m["kind"], 0) + 1
    print(f"{len(man)} prompts {kinds} -> {a.out_dir}/{a.name}-prompts.jsonl")


if __name__ == "__main__":
    main()
