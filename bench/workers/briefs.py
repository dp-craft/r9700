#!/usr/bin/env python3
"""briefs.py TASK VARIANT ROOT: print one brief. V0 = task and format only. V1 = + how-to and rules. V2 = V1 + validation. V3 (json) = compute with tools."""
import sys
RULES="""RULES
- Use only what the files say. No outside knowledge. Never guess a number, name or path: if you cannot find it, write none.
- Copy numbers, names and paths exactly as printed.
- Output files are plain text in exactly the format above: no markdown, no comments, no extra lines.
- Think briefly. Do not draft the output in your reasoning; write it once with the Write tool.
"""
T={}
T["log"]=dict(v0="""Find the problems in the log file {R}/app.log.
Write {R}/out/report.txt with one line per distinct problem, in this format:
CLASS|<line number of first occurrence>|<number of occurrences>|<level>|<short message>
Then reply with only: DONE
""",how="""HOW
1. Do not read the whole file: it can be far larger than your memory. Use the Grep tool on app.log with output_mode "content", -n true, head_limit 0, and this pattern: (WARNING|ERROR|CRITICAL) |^Traceback|^\\S*Error:|^\\S*Exception:|[Ff]ault|Killed|panic
2. Skip lines at INFO level unless they report a failure.
3. Group lines: the same source location and the same message, ignoring numbers, are one class.
4. Count = lines in the class. First occurrence = its lowest line number. Level = WARNING, ERROR or CRITICAL; use ERROR when the line has no level.
""",val="""VALIDATE, after writing the file
a. For each CLASS, Grep a distinctive fixed part of its message with output_mode "count", and correct the count if it differs.
b. Run one more case-insensitive Grep for: abort|fatal|died|timeout|exhausted|evicted|core dumped. Add any class you missed.
c. If anything changed, Write the file again. Then reply with only: DONE
""")
T["bugs"]=dict(v0="""Classify the findings in {R}/findings.txt. Each one starts with a line "## <id>".
Write {R}/out/rows.txt with one line per finding, in this format:
<id>|<kind>|<severity>|<paths>
kind is one of: defect, gap, risk, note. severity is one of: blocking, high, med, low. paths is every file name or path the finding mentions, comma-separated, or none.
Then reply with only: DONE
""",how="""HOW
1. Read the whole file. If Read says it is too large, read it in chunks with offset and limit=400 until the end.
2. Choose kind from what the text describes:
   defect = something behaves wrongly now. gap = something needed is missing, such as a test, check or feature. risk = it works now but could fail later. note = information with nothing broken.
3. Choose severity from the impact:
   blocking = stops the work or a release. high = wrong results, lost data or a broken main path. med = a limited or workaround-able problem. low = cosmetic or minor.
4. Decide from the finding's own text only. If unsure between two severities, take the lower.
5. For paths, copy each token ending in .ts, .tsx, .mjs, .md, .json, .jsonl, .py, .sh, .yml or .yaml.
""",val="""VALIDATE, after writing the file
a. Grep findings.txt for ^## with output_mode "count". Grep out/rows.txt for ^\\S+\\| with output_mode "count". They must match. Add any missing id and remove any duplicate.
b. Check that every kind and severity is one of the allowed words.
c. Grep findings.txt for \\.(tsx?|mjs|md|jsonl?|py|sh|ya?ml)\\b with output_mode "content", -n true, -o true, head_limit 0, and compare it with your paths column.
d. If anything changed, Write the file again. Then reply with only: DONE
""")
T["json"]=dict(v0="""Answer the questions in {R}/questions.txt about the JSONL file {R}/results.jsonl (one JSON object per line).
Write {R}/out/answers.txt with one line per question, in this format:
Q<n>|<answer>
Answers are a bare number or a bare label, with no unit or explanation.
Then reply with only: DONE
""",how="""HOW
1. Read questions.txt.
2. For counts, use the Grep tool with output_mode "count". For example, label "x" is the pattern "label": "x",
3. For a question about values, use Grep with output_mode "content" to list only the rows it needs, then copy the values one by one.
4. Work out sums and means digit by digit, once. Read results.jsonl fully only if Grep cannot answer the question.
""",val="""VALIDATE, after writing the file
a. Recheck each count with a second, different Grep pattern.
b. Recompute each sum and mean by adding the values in reverse order.
c. For highest or lowest, Grep the value and confirm the row it is on.
d. If anything changed, Write the file again. Then reply with only: DONE
""",v3="""HOW
Compute every answer with a command, never by reading. Use Bash with python3 or jq on results.jsonl. Copy the command's output to the answer.
Rows may lack a field: treat a missing number as 0 in a sum.
""")
T["summary"]=dict(v0="""Summarize the report {R}/report.md in English.
Write {R}/out/summary.txt in this format:
GOAL: <one sentence>
RESULT: <the main conclusion, max 2 sentences>
KEY: <number with unit> | <what it is, naming the model or configuration it belongs to>
  (exactly 5 KEY lines)
CAVEAT: <the most important limitation stated by the report>
OPEN: <one question the report leaves unanswered, or none>
Then reply with only: DONE
""",how="""HOW
1. Read the whole report. If Read says it is too large, read it in chunks with offset and limit=400 until the end.
2. Take RESULT from the report's own summary and conclusion, not from one table.
3. Keep the report's certainty: if it says untested, inferred, not significant or a tie, say so too. Never call something best or proven when the report does not.
4. Before using a number, read its table row and column. Name the model or configuration from that same row. Never move a number from one configuration to another.
5. Choose KEY numbers that decide the conclusion, not context such as dates or file sizes.
""",val="""VALIDATE, after writing the file
a. For each number in the summary, Grep report.md for it with -n true and read the matching line. Confirm that the line is about the model or configuration you named.
b. Reread RESULT and CAVEAT against the report's summary section. Remove anything stronger than the report's wording.
c. If anything changed, Write the file again. Then reply with only: DONE
""")
LABELS="benchmark-report, research, feature-spec, task-list, code-review, skill, agent-definition, plan"
T["classify"]=dict(v0="""Classify the documents in {R}/items.txt. Each one starts with "=== ITEM <nnn> ===" and shows the start of a document.
Write {R}/out/labels.txt with one line per item, in this format:
<nnn>|<label>
label is one of: """+LABELS+""".
Then reply with only: DONE
""",how="""HOW
1. Read the whole file. If Read says it is too large, read it in chunks with offset and limit=400 until the end.
2. Choose by the document's purpose:
   benchmark-report = our own measurements on hardware, with results.
   research = external knowledge from sources or a study of options, not our measurements.
   feature-spec = requirements for a feature: user stories, functional requirements, acceptance criteria.
   task-list = a checklist of implementation tasks, often with IDs such as T001.
   code-review = findings about existing code or a change.
   skill = instructions for an AI skill, usually with front matter holding name and description.
   agent-definition = a role definition for an AI subagent, usually with front matter and "You are".
   plan = how a piece of work will be done: phases, steps, decisions, design.
3. Use the content, not one keyword. Pick exactly one label, and never leave an item out.
""",val="""VALIDATE, after writing the file
a. Grep items.txt for "^=== ITEM" with output_mode "count". Grep out/labels.txt for "^[0-9]+\\|" with output_mode "count". They must match. Add any missing item and remove any duplicate.
b. Check that every label is one of the allowed words.
c. Reread the items where you hesitated, and test the label against its definition.
d. If anything changed, Write the file again. Then reply with only: DONE
""")
T["codeinv"]=dict(v0="""List the top-level functions and classes of the Python files in {R}/src.
Write {R}/out/inventory.txt with one line per definition, in this format:
<file name>|<name>|<line number>|<one-sentence purpose>
Include only top-level definitions, not methods or nested functions.
Then reply with only: DONE
""",how="""HOW
1. Use Glob to list src/*.py.
2. Use Grep on each file with pattern ^(async def|def|class) \\w+, output_mode "content", -n true, head_limit 0. This gives the exact names and line numbers. Indented definitions are not top level.
3. Read each file so that each purpose comes from the code and its docstring.
""",val="""VALIDATE, after writing the file
a. For each file, compare the number of its rows with the Grep's count. Add what is missing and remove what is extra.
b. Check each line number against the Grep output.
c. If anything changed, Write the file again. Then reply with only: DONE
""")
CODE_V1="""RULES
- Change only what the task names. No refactors, new dependencies or new files beyond those it asks for.
- Follow the style of the surrounding code.
- Run the commands below and fix what fails. Never report success without running them.
- Think briefly: decide, write and test, instead of drafting the code in your reasoning.
"""
T["impl"]=dict(code=True,v0="Implement SPEC.md in this repository. Then reply with only: DONE\n",how="""Implement SPEC.md in this repository.

HOW
1. Read SPEC.md fully and read tests/smoke.test.ts.
2. Write src/logfmt.ts as a small hand-written scanner, not a regular expression. Track the index, because errors need exact columns.
3. Use strict TypeScript: no any, and check for undefined when indexing.
4. Run: npx vitest run --reporter=dot --no-color
5. Run: npx tsc --noEmit
""",val="""VALIDATE, before replying
a. Go through SPEC.md one sentence at a time. For each rule, each error case and its column, and each quoting trigger, add a test to tests/logfmt.test.ts.
b. Work out each expected value from SPEC.md, not from your code. If a test fails, decide from SPEC.md which side is wrong.
c. Run both commands again until they pass.
d. Run git status and confirm that only src/logfmt.ts and tests/logfmt.test.ts changed.
""",end="Then reply with only: DONE\n")
T["testgen"]=dict(code=True,v0="Write tests for src/semver.ts in tests/semver.test.ts, using vitest. Then reply with only: DONE\n",how="""Write tests for src/semver.ts in tests/semver.test.ts, using vitest (import from "vitest", and from "../src/semver").

HOW
1. Read src/semver.ts. Do not edit it.
2. For each exported function, list its behaviours from the code and comments: normal cases, boundaries, each branch, each error.
3. Write one small test per behaviour, with exact expected values. Compare both directions where order matters.
4. Run: npx vitest run --reporter=dot --no-color
5. Run: npx tsc --noEmit
""",val="""VALIDATE, before replying
a. Go through src/semver.ts line by line. For each if, comparison, return and regular expression part, name the test that would fail if it were inverted or removed. Add a test where you cannot name one.
b. Run both commands again until they pass.
c. Run git status and confirm that only tests/semver.test.ts changed.
""",end="Then reply with only: DONE\n")
T["edit"]=dict(code=True,v0="Do the change in CHANGE.md. Then reply with only: DONE\n",how="""Do the change in CHANGE.md.

HOW
1. Read CHANGE.md fully.
2. Grep for the old name with pattern \\bget_price\\b, output_mode "content", -n true, across the whole repository, including tests and docs. The word boundary keeps get_price_history out.
3. Decide for each hit whether to change it, using the "keep unchanged" list in CHANGE.md.
4. Edit each file, then pass the new parameter through every layer it names.
5. Run: python3 -m pytest -q
""",val="""VALIDATE, before replying
a. Grep \\bget_price\\b again. Only the route string in shop/api.py and vendor/ may remain.
b. Grep get_price_history. It must have the same hits as before.
c. Add the cases from CHANGE.md to tests/test_shop.py: the new currency default, the ValueError, and the cart passing currency down.
d. Run the tests again until they pass.
e. Run git diff --stat and confirm that vendor/ is untouched.
""",end="Then reply with only: DONE\n")
T["bugfix"]=dict(code=True,v0="Fix the bug described in BUG.md. Then reply with only: DONE\n",how="""Fix the bug described in BUG.md.

HOW
1. Read BUG.md, movstats.py and tests/test_movstats.py.
2. Run: python3 -m pytest -q
3. For each symptom, find the root cause in the code before editing. Look for more than one cause: the failing test can hide a second bug.
4. Make the smallest fix that removes each root cause. Do not change rolling_max.
5. Run the tests again.
""",val="""VALIDATE, before replying
a. Compare rolling_median and rolling_max line by line. Any difference in how they build windows must be justified.
b. Add tests to tests/test_movstats.py for each BUG.md symptom, for a window of 1, an odd window, the last window, and an input shorter than the window. Work out each expected value by hand.
c. Run the tests again until they pass.
d. Run git diff and confirm that rolling_max is unchanged.
""",end="Then reply with only: DONE\n")
def build(task,v,root):
    t=T[task]
    if t.get("code"):
        if v=="V0": s=t["v0"]
        elif v=="V1": s=t["how"]+"\n"+CODE_V1+t["end"]
        else: s=t["how"]+"\n"+CODE_V1+"\n"+t["val"]+t["end"]
        return s
    s=t["v0"]
    done="Then reply with only: DONE\n"
    if v=="V0": pass
    elif v=="V1": s=s.replace(done,"")+"\n"+t["how"]+"\n"+RULES+done
    elif v=="V2": s=s.replace(done,"")+"\n"+t["how"]+"\n"+RULES+"\n"+t["val"]
    elif v=="V3": s=s.replace(done,"")+"\n"+t["v3"]+"\n"+RULES+done
    return s.replace("{R}",root)
if __name__=="__main__": print(build(sys.argv[1],sys.argv[2],sys.argv[3]),end="")
