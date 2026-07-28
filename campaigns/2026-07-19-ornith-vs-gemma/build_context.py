#!/usr/bin/env python3
"""build_context.py — assemble a long-context TDD prompt: [real-codebase context up to N tokens,
including the planted reuse-target util] + [rules] + [task spec]. The reuse-target lib/*.ts files are
always appended at the END of the context (deepest position → hardest retrieval / lost-in-the-middle).

  python3 build_context.py --task ts-harness/tasks/lru-cache --tokens 64000 --out out/prompt-lru-64k.txt
  python3 build_context.py --task ts-harness/tasks/count-words --tokens 0            # no filler (logic-only)
"""
import argparse, os, glob, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "ts-harness")
CHARS_PER_TOK = 4  # rough; calibrate against the real tokenizer later


def gather_corpus(target_tokens):
    budget = target_tokens * CHARS_PER_TOK
    files = sorted(glob.glob(os.path.join(HARNESS, "corpus", "**", "*.ts"), recursive=True))
    out, used = [], 0
    for p in files:
        if used >= budget:
            break
        txt = open(p, encoding="utf-8", errors="ignore").read()
        rel = os.path.relpath(p, HARNESS)
        out.append(f"// ==== {rel} ====\n{txt}")
        used += len(txt)
    return "\n\n".join(out), used


def lib_sources():
    parts = []
    for p in sorted(glob.glob(os.path.join(HARNESS, "lib", "*.ts"))):
        rel = os.path.relpath(p, HARNESS)
        parts.append(f"// ==== {rel} (SHARED UTIL — reuse, do not redefine) ====\n"
                     + open(p, encoding="utf-8").read())
    return "\n\n".join(parts)


def base_project(task_dir):
    """Multi-file tasks ship a green mini-project in base/ that the model EDITS. Embed those files
    verbatim (with their real relpaths as headers) so the model knows the paths to emit `// FILE:`
    blocks for. Returns ("", None) for single-file tasks."""
    base = os.path.join(task_dir, "base")
    if not os.path.isdir(base):
        return "", None
    parts = []
    for p in sorted(glob.glob(os.path.join(base, "**", "*.ts"), recursive=True)):
        rel = os.path.relpath(p, base)
        parts.append(f"// ==== {rel} ====\n" + open(p, encoding="utf-8").read())
    return "\n\n".join(parts), base


def build(task_dir, target_tokens):
    spec = open(os.path.join(task_dir, "spec.md")).read()
    rules = open(os.path.join(task_dir, "rules.md")).read()
    filler, _ = gather_corpus(target_tokens) if target_tokens > 0 else ("", 0)
    ctx = "[CONTEXT — existing TypeScript codebase; treat as background you may reuse from]\n\n"
    if filler:
        ctx += filler + "\n\n"
    ctx += lib_sources() + "\n\n"          # reuse targets last = deepest
    proj, base = base_project(task_dir)
    if base:                               # multi-file task: show the editable project + emit-all instruction
        return (ctx
                + "[PROJECT FILES — this is the current project; EDIT these by re-emitting whole files]\n\n"
                + proj + "\n\n"
                + "[CODING RULES — obey ALL]\n" + rules + "\n\n"
                + "[TASK]\n" + spec + "\n\n"
                + "Respond with ONLY the changed/added files, each preceded by its `// FILE: <path>` "
                  "marker (paths relative to the project root, as shown above). No prose.\n")
    return (ctx
            + "[CODING RULES — obey ALL]\n" + rules + "\n\n"
            + "[TASK]\n" + spec + "\n\n"
            + "Respond with ONLY the two files, each preceded by its `// FILE:` marker. "
              "No prose, no explanation.\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--tokens", type=int, default=0)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    prompt = build(a.task, a.tokens)
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        open(a.out, "w").write(prompt)
        print(f"wrote {a.out}  (~{len(prompt)//CHARS_PER_TOK} tok, {len(prompt)} chars)", file=sys.stderr)
    else:
        sys.stdout.write(prompt)


if __name__ == "__main__":
    main()
