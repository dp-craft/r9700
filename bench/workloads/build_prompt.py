#!/usr/bin/env python3
"""
build_prompt.py — assemble a realistic, target-sized prompt for benchmarking.

A benchmark prompt here = [unique run-id] + [task instruction] + [real source context padded to N
tokens]. The unique run-id defeats server-side prefix caching (so prefill is really measured); the
context is real code/text so decode behaves like a real dev/research task; the size is deterministic
so a campaign is reproducible.

Token count is approximated as chars / --chars-per-token. MEASURED on this repo's corpus with the
Qwen3.6 tokenizer via llama-server /tokenize: source code averages ~3.55 chars/token, so the
default is 3.6 (the old 4.0 overshot real token counts by ~12% on code). Verify a built fixture's
REAL token count against your server's /tokenize before sizing context windows with it.

v2 changes:
  - --src is repeatable (sources are consumed in the order given; see corpus/README.md)
  - FAILS (exit 1) if the gathered context can't reach --min-fill × target (was: silent short file)
  - --variants N writes N files that differ only in the run-id (out-v1.txt … out-vN.txt) — use
    these as fixed per-stream prompts for concurrency tests where each stream must miss the
    prefix cache independently.

Usage:
  # 64K-token code-review prompt padded from the tracked corpus (TS first, then Python):
  python3 build_prompt.py --task tasks/codereview-large.task.md \
        --src corpus/ts-agentic-code-runner --src corpus/py-rich --target-tokens 64000 \
        --out generated/codereview-64000.txt

  # thinking-mode prompt needs no big context:
  python3 build_prompt.py --task tasks/thinking-hard.prompt.txt --target-tokens 0 \
        --out generated/thinking-hard.txt

  # 4 per-stream variants of an 8K agentic prompt:
  python3 build_prompt.py --task tasks/agentic-implement.task.md \
        --src corpus/ts-agentic-code-runner --target-tokens 8000 --variants 4 \
        --out generated/agentic-8000.txt
"""
import argparse, pathlib, sys, uuid

TEXT_EXT = {".py", ".sh", ".md", ".txt", ".c", ".cpp", ".h", ".hpp", ".rs", ".go",
            ".js", ".ts", ".java", ".json", ".yaml", ".yml", ".toml"}

def gather(sources, budget_chars):
    """Concatenate real files (per-source sorted, deterministic) until budget is hit."""
    if not sources or budget_chars <= 0:
        return ""
    buf, used = [], 0
    for src in sources:
        root = pathlib.Path(src)
        if not root.is_dir():
            sys.exit(f"error: --src is not a directory: {src}")
        files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix in TEXT_EXT)
        for p in files:
            try:
                t = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            header = f"\n\n===== FILE: {root.name}/{p.relative_to(root)} =====\n"
            chunk = header + t
            if used + len(chunk) > budget_chars:
                buf.append(chunk[: budget_chars - used])
                return "".join(buf)
            buf.append(chunk); used += len(chunk)
    return "".join(buf)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True, help="task instruction file (prepended)")
    ap.add_argument("--src", action="append", default=[],
                    help="dir of real files to pad context from (repeatable, consumed in order)")
    ap.add_argument("--target-tokens", type=int, required=True, help="approx total tokens (0 = task only)")
    ap.add_argument("--chars-per-token", type=float, default=3.6,
                    help="tokenizer calibration (3.6 ≈ Qwen3.6 on source code; prose is ~4)")
    ap.add_argument("--min-fill", type=float, default=0.97,
                    help="fail if gathered prompt < this fraction of target (default 0.97)")
    ap.add_argument("--variants", type=int, default=1,
                    help="write N copies differing only in run-id: out-v1.txt … out-vN.txt")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    task = open(a.task, encoding="utf-8", errors="replace").read()
    target_chars = int(a.target_tokens * a.chars_per_token)
    # context is gathered once; only the run-id differs between variants
    probe_run_id = f"[run-id {'x'*12} — unique prefix to defeat prefix cache]\n\n"
    overhead = len(probe_run_id) + len(task)
    context = gather(a.src, max(0, target_chars - overhead)) if a.target_tokens else ""

    outputs = []
    for i in range(a.variants):
        run_id = f"[run-id {uuid.uuid4().hex[:12]} — unique prefix to defeat prefix cache]\n\n"
        prompt = run_id + task
        if context:
            prompt += "\n\n===== CONTEXT (real sources) =====\n" + context
        if a.target_tokens and len(prompt) < target_chars * a.min_fill:
            sys.exit(f"error: gathered only {len(prompt)} chars ≈ {int(len(prompt)/a.chars_per_token)} tokens "
                     f"< {a.min_fill:.0%} of target {a.target_tokens} tokens — "
                     f"add more/bigger --src trees (see corpus/README.md)")
        out = pathlib.Path(a.out)
        if a.variants > 1:
            out = out.with_name(f"{out.stem}-v{i+1}{out.suffix}")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(prompt, encoding="utf-8")
        outputs.append((out, len(prompt)))

    for out, n in outputs:
        print(f"wrote {out}: {n} chars ≈ {int(n/a.chars_per_token)} tokens "
              f"(target {a.target_tokens})", file=sys.stderr)

if __name__ == "__main__":
    main()
