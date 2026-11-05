#!/usr/bin/env python3
"""gen_refs.py: write the skill's references/briefs.md from the briefs the tests actually ran, so the two can't drift."""
import os, sys, tempfile
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H)
sys.dont_write_bytecode = True
import briefs, doc_briefs, notes_briefs
OUT = "/home/dev/work/dippe/skills-agents/skills/ornith/references/briefs.md"
ROOT = "<ROOT>"
PICK = [
    ("Log triage", "read", "log", "V2"),
    ("Bug or finding text: classify and extract", "read", "bugs", "V1"),
    ("JSON and JSONL questions", "data", "json", "V3"),
    ("Fixed-form report summary", "read", "summary", "V1"),
    ("Grouping documents by type", "read", "classify", "V2"),
    ("Python code inventory", "read", "codeinv", "V0"),
]
CODE = [("Code from a clear spec", "impl"), ("Writing tests", "testgen"), ("Multi-file rename", "edit"), ("Bug fix", "bugfix")]
parts = ["""# Tested Ornith briefs

Generated from the briefs the tests ran. Replace `<ROOT>` with the absolute work directory. Change the file names, labels and output format to fit your task, and keep the HOW, RULES and VALIDATE parts.
The `read`, `data` and `code` labels are the `ornith.sh --profile` to use.
"""]
for title, prof, task, v in PICK:
    parts.append(f"## {title} (`--profile {prof}`, tested as `{task}` {v})\n\n```text\n{briefs.build(task, v, ROOT).rstrip()}\n```\n")
for title, task in CODE:
    parts.append(f"## {title} (`--profile code`, tested as `{task}` V0)\n\nRun from inside the repository.\n\n```text\n{briefs.build(task, 'V0', ROOT).rstrip()}\n```\n")
parts.append(f"## Split a document (`--profile data`, tested as `docsplit` V3)\n\n```text\n{doc_briefs.brief('docsplit', 'V3', ROOT).rstrip()}\n```\n")
parts.append(f"## Sort mixed sections into topic files (`--profile data`, tested as `docreorg` V3)\n\n```text\n{doc_briefs.brief('docreorg', 'V3', ROOT).rstrip()}\n```\n")
with tempfile.TemporaryDirectory() as t:
    os.makedirs(f"{t}/docs")
    open(f"{t}/docs/<REPORT>", "w").close()
    parts.append(f"## Per-document notes (`--profile read`, tested as `docnotes` V2)\n\nOne session per document.\n\n```text\n{notes_briefs.brief('V2', t).replace(t, ROOT).rstrip()}\n```\n")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write("\n".join(parts))
print(OUT, sum(len(p) for p in parts))
