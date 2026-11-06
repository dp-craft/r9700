#!/usr/bin/env python3
"""notes_briefs.py VARIANT ROOT: docnotes brief for one report, from the earlier report's note format. V1 reads and writes. V2 adds the table-search step that report proposed."""
import os, sys
READ = """You analyze one benchmark report and write short structured notes that a script will parse.

Report: {R}/docs/{N}
Output: {R}/out/01.txt

STEPS
1. Read the whole report with the Read tool. The left column it prints is the line number. If Read says the file is too large, read it in chunks with offset and limit=400 until the end. The report is not done until you have seen its last line.
"""
SEARCH = """2. Incidents are often only in a table row. Grep the report with -n true, -i true, output_mode "content", head_limit 0, and this pattern: crash|fault|interrupt|discard|contaminat|exclud|redone|re-?collect|re-?run|killed|OOM|abort|invalid|quarantin|DNF|hang|hung
   Check each hit against the report and keep those that describe a real event in a run.
3. Write the note, then reply with only: DONE 1
"""
PLAIN = "2. Write the note, then reply with only: DONE 1\n"
RULES = """
RULES
- Use only what the report says. No outside knowledge. If something is not in the report, write none.
- Copy numbers and paths exactly as printed.
- Every line number must be the one Read printed for that exact text.
- Plain text only: no markdown, no extra lines, no commentary. Think briefly.

NOTE format (one field per line, these labels, this order):
DOC: <file name>
TOPIC: <one sentence: what was tested or researched>
VERDICT: <the report's main conclusion, max 2 sentences, your own words>
CONFIG: <model; engine or runtime; key settings; or none>
PATHS: <every distinct path in the report that contains bench/runs/ or campaigns/, comma-separated; or none>
FACT|<line>|<number with unit as printed>|<what it measures, max 12 words>
  (exactly 5 FACT lines: the 5 numbers that matter most for the conclusion)
INCIDENT|<line>|<what went wrong, max 15 words>
  (one line for each place where a run crashed, faulted, was interrupted, discarded, contaminated, excluded, redone or re-collected; if there is none write INCIDENT|none)
OPEN: <one question the report leaves unanswered; or none>
"""


# V5 = V2 without "Think briefly". V6 = V5, and step 2 checks hits, footnotes and caveats against the INCIDENT definition, without the "real event in a run" filter.
CHECK = ("   Check each hit against the report and keep those that describe a real event in a run.\n",
         "   Check each hit, and every footnote, table note and caveat, against the INCIDENT definition below; keep each that fits it, run failures or not.\n")


def brief(v, r):
    n = os.listdir(f"{r}/docs")[0]
    b = READ + (SEARCH if v in ("V2", "V5", "V6") else PLAIN) + RULES
    if v in ("V5", "V6"):
        b = b.replace(" Think briefly.", "")
    if v == "V6":
        b = b.replace(*CHECK)
    return b.replace("{R}", r).replace("{N}", n)


if __name__ == "__main__":
    print(brief(sys.argv[1], sys.argv[2]), end="")
