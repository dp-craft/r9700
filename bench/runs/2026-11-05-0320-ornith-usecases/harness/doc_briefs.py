#!/usr/bin/env python3
"""doc_briefs.py TASK VARIANT ROOT: document-refactoring briefs. V0 task and format. V1 + copy rules. V2 + run the checker and repair. V3 line-range manifest, no retyping."""
import sys
SK = "/home/dev/work/dippe/skills-agents/skills/ornith/scripts"
TASK = {
    "docsplit": """Split the document {R}/doc.md into smaller files, one per top-level section (a line starting with "## ").
Write the files in {R}/out/, named NN-<short-slug>.md with NN = 01, 02, ... in document order. Anything before the first "## " line goes to out/00-intro.md.
Also write out/README.md with one line per file, in order: - [<section heading>](<file name>)
""",
    "docreorg": """The document {R}/doc.md is a mix of sections from different reports, in random order. {R}/TOPICS.txt lists the target files and what each is about.
Reorganize it: put each section (a "## " line and everything up to the next "## " line) into the target file it belongs to, in {R}/out/. Within a file, order the sections so the report reads logically, starting with its summary or conclusion when it has one.
""",
}
FORMAT = {"docsplit": "", "docreorg": "Write only the target files named in TOPICS.txt.\n"}
DONE = "Then reply with only: DONE\n"
RULES = """RULES
- The content must not change. Every line of the source ends up in the output exactly once, character for character: every number, table row, path, code block, comment and punctuation mark.
- Do not summarize, shorten, reword, translate, correct, renumber or reformat anything. Keep heading levels. Keep wrong-looking or odd text as it is.
- Add nothing except what the task asks for.
- Read the whole document first. If Read says it is too large, read it in chunks with offset and limit=400 until the end.
- Do not draft the output in your reasoning; copy each file once with the Write tool.
"""
CHECK = """VALIDATE, after writing the files
Run: python3 {SK}/doc_check.py {R}/doc.md {R}/out --ignore README.md
It prints every lost, altered, added or duplicated line. Fix each one with Write or by editing the output, then run it again. Repeat until it prints PASS.
"""
MANIFEST = """METHOD
Do not retype any document text. You decide which lines go where; a script moves the bytes.
1. Find the section boundaries with the Grep tool on doc.md, pattern ^## , output_mode "content", -n true, head_limit 0. Read only the parts you need to decide.
2. Write {R}/out/manifest.json in this form, ranges 1-based and inclusive, in output order:
{{"files":[{{"path":"<file name>","ranges":[[1,40],[90,120]]}}]}}
A section runs from its "## " line to the line before the next "## " line. The last one runs to the last line of the file. Get the line count with Grep pattern ^ and output_mode "count".
3. Run: python3 {SK}/doc_apply.py {R}/doc.md {R}/out/manifest.json {R}/out
It refuses overlaps and bad ranges, and lists unassigned lines that are not blank. Fix the manifest and rerun until nothing is unassigned.
4. Run: python3 {SK}/doc_check.py {R}/doc.md {R}/out --ignore README.md
Repeat until it prints PASS. Write any README.md only after that.
"""


def brief(task, v, r):
    t = TASK[task] + FORMAT[task]
    if v == "V0":
        b = t + DONE
    elif v == "V1":
        b = t + DONE + "\n" + RULES
    elif v == "V2":
        b = t + DONE + "\n" + RULES + "\n" + CHECK
    elif v == "V3":
        b = t + "\n" + MANIFEST + "\n" + DONE
    else:
        raise SystemExit(f"no variant {v} for {task}")
    return b.replace("{{", "\0").replace("}}", "\1").replace("{R}", r).replace("{SK}", SK).replace("\0", "{").replace("\1", "}")


if __name__ == "__main__":
    print(brief(sys.argv[1], sys.argv[2], sys.argv[3]))
